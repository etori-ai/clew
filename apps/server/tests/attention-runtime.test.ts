import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { database, schema, closeDatabase } from '@clew/db';
import { postgresThreadStore } from '../src/threads/adapters/postgres';
import { postgresAttention } from '../src/threads/adapters/attention-postgres';
import { durableJobs } from '../src/scheduler/adapters/durable-postgres';
import { scheduledJobRunner } from '../src/scheduler/usecases';
import { every } from '../src/composition/ambient';
import { bindActivities } from '../src/dbos/workflows';
import { durableResult } from '../src/dbos/start';
import { testEngine } from './durable';

// Deferred attention (D47) on PostgreSQL, the durable engine and production Node, under its own application name and a synthetic person.
test(
  'a delivery deferred by quiet hours or by the day’s budget waits with its release job’s workflow, which the engine runs at the due time to make it ready',
  { timeout: 60_000 },
  async () => {
    const id = 'attention-runtime-' + randomUUID(),
      threadId = id + ':card',
      engine = testEngine('attention'),
      store = postgresThreadStore({ durable: engine.durable }),
      attention = postgresAttention(),
      now = () => new Date();
    // The live step over the job table and the attention store, on the real clock; this test schedules no other kind.
    bindActivities({
      runScheduledJob: scheduledJobRunner({
        executions: durableJobs,
        release: batch => attention.release(batch, now().toISOString()),
        run: async job => {
          throw new Error('Not an attention job: ' + job.kind);
        },
        clock: now,
        every,
        log: (...args) => {
          throw new Error('Unexpected scheduler log: ' + String(args[0]));
        },
      }),
    });
    let launched: Awaited<ReturnType<typeof engine.launch>> | undefined;
    const batches: string[] = [];
    try {
      await database().insert(schema.people).values({ id, name: 'Synthetic attention test', organisationId: 'test' });
      await store.transaction(tx =>
        tx.insertThread({
          id: threadId,
          personId: id,
          topic: threadId,
          kind: 'pushed',
          connector: 'clew',
          area: 'test',
          title: 'Synthetic attention',
          state: 'open',
          summary: '',
          week: null,
          items: [],
          actions: [],
          waitingOn: null,
          deadline: null,
          trigger: { reason: '', source: 'test', at: '2026-01-01T20:00:00.000Z' },
          createdAt: '2026-01-01T20:00:00.000Z',
          updatedAt: '2026-01-01T20:00:00.000Z',
        }),
      );
      const admit = (suffix: string, at: string) =>
        store.transaction(tx => tx.admitDelivery({ id: id + suffix, personId: id, threadId, kind: 'automatic', at }));
      // 21:00 in Stockholm is quiet hours and waits for 06:00; the fourth delivery of a day outside the review and the
      // bundles waits for the next bundle. Both due times lie in the real past, so a workflow waits for nothing.
      await admit(':quiet', '2026-01-01T20:00:00.000Z');
      for (const [n, hour] of ['08', '09', '10', '11'].entries())
        await admit(`:budget-${n}`, `2026-01-05T${hour}:20:00.000Z`);
      const waiting = (await database().select().from(schema.deliveries).where(eq(schema.deliveries.personId, id)))
        .filter(d => d.state === 'waiting')
        .sort((a, b) => a.id.localeCompare(b.id));
      batches.push(...waiting.map(d => d.batch));
      assert.deepEqual(
        waiting.map(d => [d.id, d.dueAt.toISOString()]),
        [
          [id + ':budget-3', '2026-01-05T15:00:00.000Z'],
          [id + ':quiet', '2026-01-02T05:00:00.000Z'],
        ],
      );
      // Each release job's workflow committed with its delivery (D86) and waits in the queue for this application.
      const workflows = waiting.map(d => 'job:attention:' + d.batch);
      for (const workflow of workflows) assert.equal((await engine.row(workflow))?.status, 'ENQUEUED');
      const pending = async () => (await attention.pending(id, now().toISOString())).map(d => d.id).sort();
      assert.deepEqual(await pending(), [id + ':budget-0', id + ':budget-1', id + ':budget-2']);
      launched = await engine.launch();
      for (const workflow of workflows) await durableResult(workflow);
      for (const workflow of workflows) assert.equal((await engine.row(workflow))?.status, 'SUCCESS');
      assert.deepEqual(
        await pending(),
        [':budget-0', ':budget-1', ':budget-2', ':budget-3', ':quiet'].map(s => id + s),
      );
      const audit = await database()
        .select()
        .from(schema.audit)
        .where(
          inArray(schema.audit.subject, [
            ...batches.map(b => 'delivery:' + b),
            ...batches.map(b => 'job:attention:' + b),
          ]),
        );
      assert.deepEqual(
        audit.map(a => [a.subject, a.action]).sort(),
        [
          ...batches.map(b => ['delivery:' + b, 'attention.released']),
          ...batches.flatMap(b => [
            ['job:attention:' + b, 'job.completed'],
            ['job:attention:' + b, 'job.scheduled'],
          ]),
        ].sort(),
      );
    } finally {
      await launched?.shutdown();
      if (batches.length) {
        await database()
          .delete(schema.audit)
          .where(
            inArray(schema.audit.subject, [
              ...batches.map(b => 'delivery:' + b),
              ...batches.map(b => 'job:attention:' + b),
            ]),
          );
        await database()
          .delete(schema.jobs)
          .where(
            inArray(
              schema.jobs.id,
              batches.map(b => 'attention:' + b),
            ),
          );
      }
      await database().delete(schema.threads).where(eq(schema.threads.personId, id));
      await database().delete(schema.people).where(eq(schema.people.id, id));
      await engine.forget();
      await closeDatabase();
    }
  },
);
