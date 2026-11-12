import { afterAll, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { inArray, like, sql } from 'drizzle-orm';
import { database, databaseAnswers, schema } from '../../packages/db/src/index';
import { bindFirstLogin } from '../../packages/db/src/auth';
import { healthRoutes } from '../../apps/server/src/routes/health';

/**
 * The pool's five connections (L1 of the 2026-11-12 users review). A first sign-in's binding runs in a transaction that
 * holds one connection, so nothing inside it may wait for a second: before the fix, five of them at once held every
 * connection while each waited for a sixth, and every request of every person hung. `/api/ready` asks the database
 * through the same pool, so it says when that happens. Run with `bun run test:db` inside the devcontainer.
 */
if (!process.env.DATABASE_URL)
  throw new Error('DATABASE_URL is not set. Run `bun run test:db` inside the devcontainer.');
const prefix = 'test-pool-' + randomUUID().slice(0, 8),
  issuer = 'https://idp.test/' + prefix,
  // Twice the pool's five connections.
  ids = Array.from({ length: 10 }, (_, i) => `${prefix}-${i}`);
const db = database();
afterAll(async () => {
  await db.delete(schema.identityBindings).where(inArray(schema.identityBindings.personId, ids));
  await db.delete(schema.accessGrants).where(inArray(schema.accessGrants.personId, ids));
  await db.delete(schema.audit).where(
    inArray(
      schema.audit.subject,
      ids.map(id => 'person:' + id),
    ),
  );
  await db.delete(schema.authenticationAudit).where(like(schema.authenticationAudit.actor, 'person:' + prefix + '%'));
  await db.delete(schema.people).where(inArray(schema.people.id, ids));
});
test('more first sign-ins at once than the pool has connections all finish', async () => {
  await db
    .insert(schema.people)
    .values(ids.map((id, i) => ({ id, organisationId: 'test', name: 'Person ' + i, userName: id, externalId: id })));
  // Half of them have a grant and half not: the access is read inside the binding's transaction either way.
  await db
    .insert(schema.accessGrants)
    .values(
      ids
        .filter((_, i) => i % 2 === 0)
        .map(personId => ({ personId, unitId: 'u', unitLabel: 'U', role: 'employee' as const, capabilities: [] })),
    );
  const settled = await Promise.race([
    Promise.all(ids.map(id => bindFirstLogin(issuer, 'sub-' + id, 'preferred_username', id))),
    new Promise<'stuck'>(resolve => setTimeout(() => resolve('stuck'), 8000)),
  ]);
  expect(settled).not.toBe('stuck');
  if (settled === 'stuck') return;
  expect(settled.map(s => s.personId)).toEqual(ids);
  expect(settled.map(s => Boolean(s.access))).toEqual(ids.map((_, i) => i % 2 === 0));
  const bindings = await db
    .select()
    .from(schema.identityBindings)
    .where(inArray(schema.identityBindings.personId, ids));
  expect(bindings).toHaveLength(ids.length);
}, 15_000);
/** Holds every connection of the pool in an open transaction until `release` is called. */
async function holdThePool() {
  const release = Promise.withResolvers<void>();
  let holding = 0;
  const held = Array.from({ length: 5 }, () =>
    db.transaction(async tx => {
      await tx.execute(sql`select 1`);
      holding++;
      await release.promise;
    }),
  );
  while (holding < 5) await new Promise(resolve => setTimeout(resolve, 10));
  return async () => {
    release.resolve();
    await Promise.all(held);
  };
}
test('the readiness check says when the database does not answer because every connection is held', async () => {
  expect(await databaseAnswers(1000)).toBe(true);
  const release = await holdThePool();
  const started = Date.now();
  expect(await databaseAnswers(200)).toBe(false);
  expect(Date.now() - started).toBeLessThan(2000);
  await release();
  // The query that timed out was never sent, and the pool serves the next one.
  expect(await databaseAnswers(1000)).toBe(true);
}, 10_000);
test('/api/ready answers 503 while every connection is held and 200 again once one is free', async () => {
  let started = false;
  const probes = healthRoutes({ started: () => started, databaseAnswers });
  const ready = async () => {
    const response = await probes.request('/ready');
    return [response.status, await response.json()];
  };
  // Not ready before startup has finished, whatever the database says.
  expect(await ready()).toEqual([503, { ready: false }]);
  started = true;
  expect(await ready()).toEqual([200, { ready: true }]);
  const release = await holdThePool();
  const asked = Date.now();
  expect(await ready()).toEqual([503, { ready: false }]);
  expect(Date.now() - asked).toBeLessThan(3000);
  // The process itself still answers.
  expect((await probes.request('/health')).status).toBe(200);
  await release();
  expect(await ready()).toEqual([200, { ready: true }]);
}, 15_000);
