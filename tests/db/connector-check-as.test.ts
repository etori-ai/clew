import { afterAll, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { closeDatabase, database, schema } from '../../packages/db/src/index';
import { registerConnector } from '../../scripts/connector-registry';

/**
 * `bun scripts/connector-check.ts --as` against a service of this test's own (review 2026-11-12, R2; Q13): it refuses a
 * connector this installation has not registered and a user name with no person, writing nothing, and otherwise writes
 * its one audit row before the first request it signs as the person. Run with `bun run test:db` inside the devcontainer.
 */
if (!process.env.DATABASE_URL)
  throw new Error('DATABASE_URL is not set. Run `bun run test:db` inside the devcontainer.');
const tag = randomUUID().slice(0, 8),
  id = 'check-as-' + tag,
  personId = 'check-as-person-' + tag,
  userName = 'Check.As.' + tag,
  secret = 'check-as-secret-' + tag;
const db = database();
const checkedAs = () =>
  db
    .select()
    .from(schema.audit)
    .where(and(eq(schema.audit.action, 'connector.checked_as'), eq(schema.audit.subject, 'person:' + personId)));

/** A service that answers the check, and notes for every signed request whether the audit row was already there. */
const seen: Array<{ path: string; actor: string; audited: boolean }> = [];
const manifest = {
  protocol: 2,
  id,
  kind: 'passthrough',
  source: 'Kontrolltjänsten',
  areas: [],
  scan: false,
  capabilities: [
    {
      name: id + '.person',
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
};
const service = Bun.serve({
  port: 0,
  hostname: '127.0.0.1',
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/clew/manifest') return Response.json(manifest);
    const body = (await request.json()) as { actor: { id: string } };
    seen.push({ path: url.pathname, actor: body.actor.id, audited: (await checkedAs()).length === 1 });
    return Response.json({ output: { rows: [] } });
  },
});
const base = `http://127.0.0.1:${service.port}`;
const check = async (...args: string[]) => {
  const child = Bun.spawn(['bun', 'scripts/connector-check.ts', base, '--secret', secret, ...args], {
    cwd: new URL('../..', import.meta.url).pathname,
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

afterAll(async () => {
  service.stop(true);
  await db.delete(schema.audit).where(inArray(schema.audit.subject, ['person:' + personId, 'connector:' + id]));
  await db.delete(schema.connectors).where(eq(schema.connectors.id, id));
  await db.delete(schema.accessGrants).where(eq(schema.accessGrants.personId, personId));
  await db.delete(schema.people).where(eq(schema.people.id, personId));
  await closeDatabase();
});

test('--as refuses an unregistered connector and an unknown person, then audits before it signs as the person', async () => {
  await db.insert(schema.people).values({ id: personId, organisationId: 'test', name: 'Kontroll Person', userName });
  await db
    .insert(schema.accessGrants)
    .values({ personId, unitId: 'unit-check-as', unitLabel: 'Kontrollenheten', role: 'manager', capabilities: [] });

  const unregistered = await check('--id', id, '--keys', 'anna', '--as', userName.toLowerCase());
  expect(unregistered.exitCode).toBe(2);
  expect(unregistered.stderr).toContain(`--id ${id}: no connector with that id is registered in this installation`);
  expect(seen).toEqual([]);

  await registerConnector({ id, url: base, secret });
  const unknown = await check('--id', id, '--keys', 'anna', '--as', 'nobody-' + tag);
  expect(unknown.exitCode).toBe(2);
  expect(unknown.stderr).toContain(
    `--as nobody-${tag}: no person with that user name and a grant in this installation.`,
  );
  expect(seen).toEqual([]);
  expect(await checkedAs()).toEqual([]);

  // The user name is matched without regard to case, as a sign-in matches it.
  const ran = await check('--id', id, '--keys', 'anna', '--as', userName.toUpperCase());
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
