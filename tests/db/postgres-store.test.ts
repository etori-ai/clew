import { afterAll, expect, test } from 'bun:test';
import { eq, inArray, sql } from 'drizzle-orm';
import { closeDatabase, database, schema } from '../../packages/db/src/index';
import { readAudit } from '../../packages/db/src/threads';
import { postgresThreadStore } from '../../apps/server/src/threads/adapters/postgres';
import { draft, storeContract } from '../store-contract';
import { reminderStart } from '../../apps/server/src/threads/domain';
import { enqueuedWorkflows, forgetTestWorkflows, testDurable } from './durable';

/**
 * The store contract against Postgres (D25). Run with `bun run test:db` inside the devcontainer: it needs
 * DATABASE_URL and the migrations applied, which is why it is not part of `bun run check`. Every test gets two
 * people of its own, as the memory adapter gets a fresh store, and everything they owned is removed at the end.
 */
if (!process.env.DATABASE_URL)
  throw new Error('DATABASE_URL is not set. Run `bun run test:db` inside the devcontainer.');
const created: string[] = [];
afterAll(async () => {
  if (created.length) {
    const owned = await database()
      .select({ id: schema.threads.id })
      .from(schema.threads)
      .where(inArray(schema.threads.personId, created));
    const ids = owned.map(r => r.id);
    if (ids.length) {
      await database()
        .delete(schema.audit)
        .where(
          inArray(
            schema.audit.subject,
            ids.map(id => 'thread:' + id),
          ),
        );
      await database()
        .delete(schema.jobs)
        .where(
          inArray(
            schema.jobs.id,
            ids.flatMap(id => ['job:' + id, 'job:lost:' + id]),
          ),
        );
      await database().delete(schema.threads).where(inArray(schema.threads.id, ids));
    }
    await database().delete(schema.people).where(inArray(schema.people.id, created));
  }
  await forgetTestWorkflows();
  await closeDatabase();
});
storeContract('postgres', async () => {
  const run = Math.random().toString(36).slice(2, 8);
  const people: [string, string] = [`test-${run}-a`, `test-${run}-b`];
  await database()
    .insert(schema.people)
    .values(people.map(id => ({ id, organisationId: 'test', name: id })));
  created.push(...people);
  const cancelled: string[] = [];
  return {
    store: postgresThreadStore({ durable: testDurable, cancel: async id => void cancelled.push(id) }),
    enqueued: async prefix =>
      (await enqueuedWorkflows(prefix)).map(({ workflow, id, input }) => ({ workflow, id, input })),
    cancelled: async () => [...cancelled],
    people,
    auditFor: async subject =>
      (await readAudit(subject)).map(r => ({
        actor: r.actor,
        action: r.action,
        subject: r.subject,
        at: r.createdAt.toISOString(),
        details: r.details,
      })),
    hasJob: async id =>
      (await database().select({ id: schema.jobs.id }).from(schema.jobs).where(eq(schema.jobs.id, id))).length > 0,
  };
});

test('a committed start is one ENQUEUED row of the test application in the ledger queue; a rolled-back one leaves no row (D86)', async () => {
  const run = Math.random().toString(36).slice(2, 8),
    person = `test-${run}-row`;
  await database().insert(schema.people).values({ id: person, organisationId: 'test', name: person });
  created.push(person);
  const store = postgresThreadStore({ durable: testDurable });
  const t = draft(person);
  await store.transaction(tx => tx.insertThread(t));
  const input = {
    id: `reminder:${t.id}`,
    personId: person,
    threadId: t.id,
    kind: 'reminder' as const,
    unitId: 'unit',
    authorizationVersion: 'v1',
    dueAt: '2026-11-04T07:00:00.000Z',
    requestedAt: '2026-11-04T06:00:00.000Z',
  };
  await expect(
    store.transaction(async tx => {
      await tx.enqueue(reminderStart(await tx.scheduleTimer(input)));
      throw new Error('rollback');
    }),
  ).rejects.toThrow('rollback');
  const rows = (prefix: string) =>
    database().execute<{ workflow_uuid: string; status: string; queue_name: string; name: string }>(
      sql`select workflow_uuid, status, queue_name, name from dbos.workflow_status where workflow_uuid like ${prefix + '%'}`,
    );
  expect([...(await rows(input.id))]).toEqual([]);
  await store.transaction(async tx => tx.enqueue(reminderStart(await tx.scheduleTimer(input))));
  expect([...(await rows(input.id))]).toEqual([
    { workflow_uuid: `${input.id}:v2:1`, status: 'ENQUEUED', queue_name: testDurable.queue, name: 'durableReminder' },
  ]);
  expect(await enqueuedWorkflows(input.id)).toEqual([
    {
      id: `${input.id}:v2:1`,
      workflow: 'durableReminder',
      status: 'ENQUEUED',
      input: { id: input.id, generation: 1, dueAt: input.dueAt },
    },
  ]);
});
