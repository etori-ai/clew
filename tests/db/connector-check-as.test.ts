import { afterAll, beforeAll, expect, test } from 'bun:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { schema } from '../../packages/db/src/index';
import { upgradeDatabase, type UpgradeDatabase } from './upgrade';

/**
 * `bun scripts/connector-check.ts --as` against services of this test's own (review 2026-11-12, R2; Q13): it refuses a
 * connector this installation has not registered, one of Clew's own, a registered id at another address and a user
 * name with no person, writing nothing and signing nothing, and otherwise writes its one audit row before the first
 * request it signs as the person. Run with `bun run test:db` inside the devcontainer.
 */
if (!process.env.DATABASE_URL)
  throw new Error('DATABASE_URL is not set. Run `bun run test:db` inside the devcontainer.');
const tag = randomUUID().slice(0, 8),
  id = 'check-as-' + tag,
  // A row as the boot writes one for a connector of Clew's own (`syncBundledRows`): no address and no secret.
  ownId = 'check-as-own-' + tag,
  personId = 'check-as-person-' + tag,
  userName = 'Check.As.' + tag,
  secret = 'check-as-secret-' + tag;
// The CLI creates the installation's signing key on its first signed read.
const masterKey = randomBytes(32).toString('base64');
let installation: UpgradeDatabase;
beforeAll(async () => {
  installation = await upgradeDatabase();
  await installation.migrate();
}, 60_000);
const checkedAs = () =>
  installation.db
    .select()
    .from(schema.audit)
    .where(and(eq(schema.audit.action, 'connector.checked_as'), eq(schema.audit.subject, 'person:' + personId)));

/** The manifest a service answers under a connector id, with a read about a person and a callback it asks for. */
const manifestFor = (connector: string) => ({
  protocol: 2,
  id: connector,
  kind: 'passthrough',
  source: 'Kontrolltjänsten',
  areas: [],
  scan: false,
  uses: ['people.directory'],
  capabilities: [
    {
      name: connector + '.person',
      kind: 'read',
      title: 'Saker per person',
      description: 'Öppna saker per person.',
      input: {
        type: 'object',
        properties: { keys: { type: 'array', items: { type: 'string' }, maxItems: 200 } },
        required: ['keys'],
      },
      output: {
        type: 'object',
        properties: {
          rows: {
            type: 'array',
            items: {
              type: 'object',
              properties: { key: { type: 'string' }, open: { type: 'string' } },
              required: ['key'],
            },
          },
        },
      },
      model: false,
      scope: { roles: ['manager'] },
      about: { entity: 'person' },
      view: { kind: 'list', title: 'open', fields: [{ key: 'open', label: 'Öppna' }] },
    },
  ],
});
/** A service that answers the check under an id, and notes for every signed request whether the audit row was there. */
function serve(connector: string) {
  const seen: Array<{ path: string; actor: string; audited: boolean }> = [];
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    async fetch(request) {
      const url = new URL(request.url);
      if (request.method === 'GET' && url.pathname === '/clew/manifest') return Response.json(manifestFor(connector));
      const body = (await request.json()) as { actor: { id: string } };
      seen.push({ path: url.pathname, actor: body.actor.id, audited: (await checkedAs()).length === 1 });
      return Response.json({ output: { rows: [] } });
    },
  });
  return { server, seen, base: `http://127.0.0.1:${server.port}` };
}
const service = serve(id);
const { base, seen } = service;
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
  return { exitCode, stdout, stderr };
};
const check = (url: string, ...args: string[]) =>
  runCli('scripts/connector-check.ts', url, '--secret', secret, ...args);
const register = async () => {
  const result = await runCli('scripts/connector-add.ts', id, base, '--secret', secret);
  expect({ exitCode: result.exitCode, stderr: result.stderr }).toEqual({ exitCode: 0, stderr: '' });
};
const others: Array<ReturnType<typeof serve>> = [];

afterAll(async () => {
  for (const s of [service, ...others]) s.server.stop(true);
  await installation?.drop();
});

test('--as refuses an unregistered connector and an unknown person, then audits before it signs as the person', async () => {
  await installation.db
    .insert(schema.people)
    .values({ id: personId, organisationId: 'test', name: 'Kontroll Person', userName });
  await installation.db
    .insert(schema.accessGrants)
    .values({ personId, unitId: 'unit-check-as', unitLabel: 'Kontrollenheten', role: 'manager', capabilities: [] });

  const unregistered = await check(base, '--id', id, '--keys', 'anna', '--as', userName.toLowerCase());
  expect(unregistered.exitCode).toBe(2);
  expect(unregistered.stderr).toContain(`--id ${id}: no connector with that id is registered in this installation`);
  expect(seen).toEqual([]);

  await register();
  const unknown = await check(base, '--id', id, '--keys', 'anna', '--as', 'nobody-' + tag);
  expect(unknown.exitCode).toBe(2);
  expect(unknown.stderr).toContain(
    `--as nobody-${tag}: no person with that user name and a grant in this installation.`,
  );
  expect(seen).toEqual([]);
  expect(await checkedAs()).toEqual([]);

  // The user name is matched without regard to case, as a sign-in matches it.
  const ran = await check(base, '--id', id, '--keys', 'anna', '--as', userName.toUpperCase());
  expect(ran.stderr).toBe('');
  expect(ran.stdout).toContain(`Connector "${id}"`);
  const rows = await checkedAs();
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    actor: 'operator:cli',
    action: 'connector.checked_as',
    subject: 'person:' + personId,
    details: { connector: id, keys: 1, reads: 1 },
  });
  // Every request the check signed came after the row, and the batch and the unknown key were signed as the person.
  expect(seen.length).toBeGreaterThan(0);
  expect(seen.every(s => s.audited)).toBe(true);
  expect(seen.filter(s => s.actor === personId).map(s => s.path)).toEqual([
    `/clew/capabilities/${id}.person`,
    `/clew/capabilities/${id}.person`,
  ]);
}, 60_000);

test("--as refuses one of Clew's own connectors and a registered id at another address, signing nothing", async () => {
  await installation.db
    .insert(schema.people)
    .values({ id: personId, organisationId: 'test', name: 'Kontroll Person', userName })
    .onConflictDoNothing();
  await installation.db
    .insert(schema.accessGrants)
    .values({ personId, unitId: 'unit-check-as', unitLabel: 'Kontrollenheten', role: 'manager', capabilities: [] })
    .onConflictDoNothing();
  await register();
  await installation.db.insert(schema.connectors).values({
    id: ownId,
    bundled: true,
    state: 'enabled',
    createdBy: 'system:boot',
    updatedBy: 'system:boot',
  });
  const before = (await checkedAs()).length;

  // A service that calls itself by the id of one of Clew's own: a callback grant for it would reach every read the
  // person may see, so nothing is signed for it.
  const own = serve(ownId);
  others.push(own);
  const ownRun = await check(own.base, '--id', ownId, '--keys', 'anna', '--as', userName);
  expect(ownRun.exitCode).toBe(2);
  expect(ownRun.stderr.trim()).toBe(
    `--id ${ownId} is one of Clew's own connectors, not a registered service; pass the id the service was registered under (bun scripts/connector-add.ts).`,
  );
  // A service that names the registered id at an address of its own is not the connector registered under it.
  const twin = serve(id);
  others.push(twin);
  const twinRun = await check(twin.base, '--id', id, '--keys', 'anna', '--as', userName);
  expect(twinRun.exitCode).toBe(2);
  expect(twinRun.stderr.trim()).toBe(
    `--id ${id} is registered at ${base}, not at ${twin.base}; --as checks a connector only at the address it is registered at.`,
  );
  expect([...own.seen, ...twin.seen]).toEqual([]);
  expect(await checkedAs()).toHaveLength(before);
}, 60_000);
