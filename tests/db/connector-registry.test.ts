import { afterAll, beforeAll, expect, test } from 'bun:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { asc, eq, inArray } from 'drizzle-orm';
import { schema } from '../../packages/db/src/index';
import { upgradeDatabase, type UpgradeDatabase } from './upgrade';

/**
 * The operator's scripts against an installation of this test's own (CB-10, CB-11): `connector-add.ts` writes one audit
 * row per change that happened, with the details the administration page writes, keeps an existing connector's state,
 * writes nothing for a change that did not happen, and removes as the page does; `connector-key-rotate.ts` creates the
 * installation's signing key on first use and rotates it, each with its audit row, publishing the old key for three
 * minutes. Run with `bun run test:db` inside the devcontainer.
 */
if (!process.env.DATABASE_URL)
  throw new Error('DATABASE_URL is not set. Run `bun run test:db` inside the devcontainer.');
const tag = randomUUID().slice(0, 8),
  id = 'registry-' + tag,
  ownId = 'registry-own-' + tag,
  personId = 'registry-person-' + tag,
  secret = 'registry-secret-' + tag,
  rekeyed = 'registry-rekeyed-' + tag;
const masterKey = randomBytes(32).toString('base64');
let installation: UpgradeDatabase;
beforeAll(async () => {
  installation = await upgradeDatabase();
  await installation.migrate();
}, 60_000);

/** A service that serves a manifest under `id`, with the source it is given. */
function serve(source: { name: string }) {
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch: request =>
      new URL(request.url).pathname === '/clew/manifest'
        ? Response.json({
            protocol: 1,
            id,
            kind: 'passthrough',
            source: source.name,
            areas: [],
            scan: false,
            capabilities: [
              {
                name: id + '.items',
                kind: 'read',
                title: 'Saker',
                description: 'Öppna saker.',
                input: { type: 'object', properties: {}, additionalProperties: false },
                output: { type: 'object' },
                model: false,
                scope: {},
              },
            ],
          })
        : new Response(null, { status: 404 }),
  });
  return { server, base: `http://127.0.0.1:${server.port}` };
}
const source = { name: 'Registret' };
const first = serve(source),
  moved = serve(source);
afterAll(async () => {
  first.server.stop(true);
  moved.server.stop(true);
  await installation?.drop();
});

const runCli = async (script: string, ...args: string[]) => {
  const child = Bun.spawn([process.execPath, script, ...args], {
    cwd: new URL('../..', import.meta.url).pathname,
    env: { ...process.env, DATABASE_URL: installation.url, MASTER_KEY: masterKey },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stdout: stdout.trim(), stderr };
};
const add = (...args: string[]) => runCli('scripts/connector-add.ts', id, ...args);
/** The audit rows about the connector since `from`, as action and details. */
const audited = async (from = 0) =>
  (
    await installation.db
      .select()
      .from(schema.audit)
      .where(eq(schema.audit.subject, 'connector:' + id))
      .orderBy(asc(schema.audit.id))
  )
    .slice(from)
    .map(row => ({ actor: row.actor, action: row.action, details: row.details }));
const row = async () => (await installation.db.select().from(schema.connectors).where(eq(schema.connectors.id, id)))[0];

test('registering writes a row per change that happened, keeps the state, and writes nothing when nothing changed', async () => {
  const added = await add(first.base, '--secret', secret);
  expect(added).toMatchObject({ exitCode: 0, stderr: '' });
  expect(added.stdout).toBe(`Connector "${id}" (Registret) added as draft: 1 capabilities, 0 areas.`);
  expect(await audited()).toEqual([
    {
      actor: 'bootstrap:connector',
      action: 'connector.added',
      details: { url: first.base, source: 'Registret', capabilities: 1, uses: [], delegation: null },
    },
  ]);

  expect((await add('--enable')).stdout).toBe(`Connector "${id}" enabled.`);
  expect((await add('--enable')).stdout).toBe(`Connector "${id}" is already enabled.`);
  expect(await audited(1)).toEqual([
    { actor: 'bootstrap:connector', action: 'connector.enabled', details: { from: 'draft' } },
  ]);

  // The same address, secret and manifest again: nothing changes, the state included, and nothing is written.
  const again = await add(first.base, '--secret', secret);
  expect(again.stdout).toBe(`Connector "${id}" (Registret) unchanged as enabled: 1 capabilities, 0 areas.`);
  expect(await audited(2)).toEqual([]);

  // Moving an enabled connector leaves it enabled, and the history says it moved.
  const move = await add(moved.base, '--secret', secret);
  expect(move.stdout).toBe(`Connector "${id}" (Registret) updated (url) as enabled: 1 capabilities, 0 areas.`);
  expect(await audited(2)).toEqual([
    { actor: 'bootstrap:connector', action: 'connector.url', details: { from: first.base, to: moved.base } },
  ]);

  // A new secret and a new manifest are each their own row; the state stays.
  source.name = 'Registret 2';
  const rekey = await add(moved.base, '--secret', rekeyed);
  expect(rekey.stdout).toBe(
    `Connector "${id}" (Registret 2) updated (secret, manifest) as enabled: 1 capabilities, 0 areas.`,
  );
  const [secretRow, manifestRow] = await audited(3);
  expect(secretRow).toEqual({ actor: 'bootstrap:connector', action: 'connector.secret', details: {} });
  expect(manifestRow).toMatchObject({ action: 'connector.manifest', details: { fields: ['source'] } });
  expect(await row()).toMatchObject({ state: 'enabled', url: moved.base, health: { status: 'ok' } });

  expect((await add('--disable')).stdout).toBe(`Connector "${id}" disabled.`);
  expect((await add('--disable')).stdout).toBe(`Connector "${id}" is already disabled.`);
  expect(await audited(5)).toEqual([
    { actor: 'bootstrap:connector', action: 'connector.disabled', details: { from: 'enabled' } },
  ]);
  // Registering a disabled connector again leaves it disabled.
  expect((await add(moved.base, '--secret', rekeyed)).stdout).toContain('unchanged as disabled');
}, 60_000);

test('removing closes its open cards and audits it in one transaction; an id with no row writes nothing, and one of Clew’s own is refused', async () => {
  if (!(await row())) expect((await add(first.base, '--secret', secret)).exitCode).toBe(0);
  await installation.db
    .insert(schema.people)
    .values({ id: personId, organisationId: 'test', name: 'Registret Person' });
  const card = (suffix: string, state: 'open' | 'handled') => ({
    id: `${personId}-${suffix}`,
    personId,
    kind: 'pushed' as const,
    connector: id,
    area: 'items',
    topic: `${id}:${suffix}`,
    title: 'Kort',
    state,
    trigger: { reason: 'Test', source: 'Registret', at: '2026-11-24T08:00:00.000Z' },
  });
  await installation.db.insert(schema.threads).values([card('open', 'open'), card('handled', 'handled')]);
  const before = (await audited()).length;

  const removed = await add('--remove');
  expect(removed).toMatchObject({ exitCode: 0, stdout: `Connector "${id}" removed; 1 open card(s) closed.` });
  expect(await row()).toBeUndefined();
  expect(
    (
      await installation.db
        .select({ id: schema.threads.id, state: schema.threads.state })
        .from(schema.threads)
        .where(inArray(schema.threads.id, [`${personId}-open`, `${personId}-handled`]))
        .orderBy(asc(schema.threads.id))
    ).map(t => t.state),
  ).toEqual(['handled', 'dismissed']);
  expect(await audited(before)).toEqual([
    { actor: 'bootstrap:connector', action: 'connector.removed', details: { closedCards: 1 } },
  ]);

  const gone = await add('--remove');
  expect(gone.stdout).toBe(`Connector "${id}" does not exist.`);
  expect((await add('--enable')).stdout).toBe(`Connector "${id}" does not exist.`);
  expect(await audited(before + 1)).toEqual([]);

  await installation.db
    .insert(schema.connectors)
    .values({ id: ownId, bundled: true, state: 'enabled', createdBy: 'system:boot', updatedBy: 'system:boot' });
  const own = await runCli('scripts/connector-add.ts', ownId, '--remove');
  expect(own.exitCode).not.toBe(0);
  expect(own.stderr).toContain(`Connector ${ownId} is one of Clew's own: it can be disabled, not removed.`);
  expect(await installation.db.select().from(schema.connectors).where(eq(schema.connectors.id, ownId))).toHaveLength(1);
  expect(
    await installation.db
      .select()
      .from(schema.audit)
      .where(eq(schema.audit.subject, 'connector:' + ownId)),
  ).toEqual([]);
}, 60_000);

test('the signing key is created with its audit row on first use, and a rotation audits the key it replaced and publishes it for three minutes', async () => {
  const rotated = await runCli('scripts/connector-key-rotate.ts');
  expect(rotated).toMatchObject({ exitCode: 0, stderr: '' });
  const kid = rotated.stdout.replace('Connector signing key rotated: ', '');
  const rows = await installation.db
    .select()
    .from(schema.audit)
    .where(inArray(schema.audit.action, ['connector.signing_key_created', 'connector.signing_key_rotated']))
    .orderBy(asc(schema.audit.id));
  expect(rows.map(r => r.action)).toEqual(['connector.signing_key_created', 'connector.signing_key_rotated']);
  const [created, rotation] = rows;
  const firstKid = created!.subject.replace('connector-signing:', '');
  expect(created).toMatchObject({ actor: 'system:boot', details: {} });
  expect(rotation).toMatchObject({
    actor: 'operator:connector-key-rotate',
    subject: 'connector-signing:' + kid,
    details: { previousKid: firstKid },
  });
  expect(kid).not.toBe(firstKid);
  const [key] = await installation.db.select().from(schema.connectorSigningKey);
  expect(key!.kid).toBe(kid);
  expect(key!.previous.map(p => p.key.kid)).toEqual([firstKid]);
  const overlap = Date.parse(key!.previous[0]!.until) - key!.createdAt.getTime();
  expect(overlap).toBe(180_000);
}, 60_000);
