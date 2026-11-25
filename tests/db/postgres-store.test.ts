import { afterAll, expect, test } from 'bun:test';
import { eq, inArray, like, sql } from 'drizzle-orm';
import { closeDatabase, database, schema } from '../../packages/db/src/index';
import { readAudit } from '../../packages/db/src/threads';
import { postgresThreadStore } from '../../apps/server/src/threads/adapters/postgres';
import { postgresAttention } from '../../apps/server/src/threads/adapters/attention-postgres';
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
    // A deferred delivery's release job (D47): the deliveries and the days go with the people.
    for (const person of created)
      await database()
        .delete(schema.jobs)
        .where(like(schema.jobs.id, `attention:automatic:${person}:%`));
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
    admitted: async personId =>
      (await database().select().from(schema.deliveries).where(eq(schema.deliveries.personId, personId))).map(d => ({
        id: d.id,
        threadId: d.threadId,
        kind: d.kind,
        dueAt: d.dueAt.toISOString(),
      })),
    day: (personId, at) => postgresAttention().day(personId, at),
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

test('a reopen refused by a card made on its topic at that moment says false and leaves its transaction usable (DE-L9)', async () => {
  const run = Math.random().toString(36).slice(2, 8),
    person = `test-${run}-race`;
  await database().insert(schema.people).values({ id: person, organisationId: 'test', name: person });
  created.push(person);
  const store = postgresThreadStore({ durable: testDurable });
  const first = draft(person),
    dismissedAt = '2026-11-04T06:01:00.000Z',
    at = '2026-11-04T06:02:00.000Z';
  await store.transaction(tx => tx.insertThread(first));
  await store.transaction(tx =>
    tx.updateThread(first.id, { state: 'dismissed', handledAt: dismissedAt, updatedAt: dismissedAt }),
  );
  // A refresh makes the card again on the same topic and has not committed when the reopen runs, so the reopen's own
  // check does not see it and the unique index makes the reopen wait for it.
  const again = draft(person, { topic: first.topic });
  let release!: () => void, held!: () => void;
  const ended = new Promise<void>(resolve => (release = resolve)),
    holds = new Promise<void>(resolve => (held = resolve));
  const holder = store.transaction(async tx => {
    expect(await tx.insertThread(again)).toBe(true);
    held();
    await ended;
  });
  await holds;
  const reopening = store.transaction(async tx => {
    const reopened = await tx.reopenThread(first.id, { handledAt: null, updatedAt: at });
    // The transaction goes on after the refusal: it reads the card that holds the topic and writes its row.
    const heldBy = await tx.topicHolder(first.id);
    await tx.writeAudit({ actor: 'test', action: 'thread.reopen_skipped', subject: 'thread:' + first.id, at });
    return { reopened, heldBy };
  });
  try {
    for (let waited = 0; ; waited += 20) {
      const [row] = await database().execute<{ n: number }>(
        sql`select count(*)::int as n from pg_stat_activity
            where datname = current_database() and wait_event_type = 'Lock' and query like 'update "thread"%'`,
      );
      if (row!.n > 0) break;
      if (waited > 5000) throw new Error('The reopen never waited for the card made on its topic.');
      await Bun.sleep(20);
    }
  } finally {
    release();
    await holder;
  }
  expect(await reopening).toEqual({ reopened: false, heldBy: again.id });
  expect(await store.readThread(person, first.id)).toMatchObject({ state: 'dismissed', handledAt: dismissedAt });
  expect((await store.openThread(person, first.topic))?.id).toBe(again.id);
  expect((await readAudit('thread:' + first.id)).map(r => r.action)).toEqual(['thread.reopen_skipped']);
});
