import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { database, schema, closeDatabase } from '@clew/db';
import { postgresThreadStore } from '../src/threads/adapters/postgres';
import { postgresAttention } from '../src/threads/adapters/attention-postgres';
import { durableJobs } from '../src/scheduler/adapters/durable-postgres';
import { createJobRunner } from '../src/scheduler/usecases';
import { bindActivities } from '../src/dbos/workflows';
import { durableResult } from '../src/dbos/start';
import { testEngine } from './durable';

// Real PostgreSQL, the durable engine (DBOS) in production Node and a synthetic person. The engine runs under its own application name.
test(
  'a delivery deferred by quiet hours starts its release workflow in the admitting transaction, waits for its time, and only that workflow releases it',
  { timeout: 60_000 },
  async () => {
    const id = 'attention-runtime-' + randomUUID(),
      threadId = id + ':card',
      engine = testEngine('attention'),
      store = postgresThreadStore({ durable: engine.durable }),
      attention = postgresAttention();
    // 17:30 on a winter evening in Stockholm is quiet hours, so the card's delivery waits for 06:00 the next morning
    // (D47). Both lie in the real past: the workflow's own sleep is over once the engine runs it, and the job's claim is
    // fenced by the ledger's clock, which the test moves.
    const admittedAt = '2020-01-07T16:30:00.000Z',
      morning = '2020-01-08T05:00:00.000Z',
      batch = `automatic:${id}:${morning}`,
      jobId = 'attention:' + batch,
      workflowId = 'job:' + jobId;
    let now = Date.parse(admittedAt);
    const clock = () => new Date(now);
    // The production job runner on the ledger's clock; nothing but the attention release runs here.
    const runScheduledJob = createJobRunner({
      jobs: durableJobs,
      release: b => attention.release(b, clock().toISOString()),
      run: async job => {
        throw new Error('Not an attention release: ' + job.kind);
      },
      clock,
    });
    bindActivities({ runScheduledJob });
    const delivery = async () =>
      (await database().select().from(schema.deliveries).where(eq(schema.deliveries.threadId, threadId)))[0];
    const job = async () => (await database().select().from(schema.jobs).where(eq(schema.jobs.id, jobId)))[0];
    const audit = (subject: string, action: string) =>
      database()
        .select()
        .from(schema.audit)
        .where(and(eq(schema.audit.subject, subject), eq(schema.audit.action, action)));
    let launched: Awaited<ReturnType<typeof engine.launch>> | undefined;
    try {
      await database().insert(schema.people).values({ id, name: 'Synthetic attention', organisationId: 'test' });
      // A scan's card and its admission commit together, as `refresh.ts` writes them.
      await store.transaction(async tx => {
        await tx.insertThread({
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
          trigger: { reason: '', source: 'test', at: admittedAt },
          createdAt: admittedAt,
          updatedAt: admittedAt,
        });
        await tx.admitDelivery({
          id: 'delivery:' + threadId,
          personId: id,
          threadId,
          kind: 'automatic',
          at: admittedAt,
        });
        await tx.writeAudit({
          actor: 'test',
          action: 'work.discovered',
          subject: 'thread:' + threadId,
          at: admittedAt,
        });
      });

      // Admitted: the delivery waits for the morning, and its release job's workflow was committed with it (D86),
      // before any engine of this application runs.
      const waiting = await delivery();
      assert.deepEqual([waiting?.state, waiting?.batch, waiting?.dueAt.toISOString()], ['waiting', batch, morning]);
      const scheduled = await job();
      assert.deepEqual(
        [scheduled?.kind, scheduled?.status, scheduled?.runAt.toISOString(), scheduled?.payload],
        ['attention-release', 'temporal', morning, { batch }],
      );
      assert.deepEqual(await engine.row(workflowId), {
        status: 'ENQUEUED',
        executor_id: null,
        queue_name: engine.durable.queue,
      });
      assert.equal((await audit('job:' + jobId, 'job.scheduled')).length, 1);

      // Waiting: nothing announces it, not even after its time by the ledger's clock, until the workflow has run; the
      // workflow's claim is busy before the time.
      assert.deepEqual(await attention.pending(id, morning), []);
      assert.equal(await runScheduledJob(jobId), 'busy');
      assert.equal((await delivery())?.state, 'waiting');

      // Released: at the morning's time the engine runs the workflow, and the delivery is there to announce.
      now = Date.parse(morning);
      launched = await engine.launch();
      await durableResult(workflowId);
      assert.equal((await delivery())?.state, 'ready');
      assert.deepEqual(await attention.pending(id, morning), [
        { id: 'delivery:' + threadId, threadId, kind: 'automatic' },
      ]);
      assert.equal((await job())?.status, 'done');
      assert.equal((await audit('delivery:' + batch, 'attention.released')).length, 1);
      assert.equal((await audit('job:' + jobId, 'job.completed')).length, 1);

      // A step retried after its acknowledgement was lost meets the finished job and releases nothing twice.
      assert.equal(await runScheduledJob(jobId), 'done');
      assert.equal((await audit('delivery:' + batch, 'attention.released')).length, 1);
    } finally {
      await launched?.shutdown();
      await database()
        .delete(schema.audit)
        .where(inArray(schema.audit.subject, ['thread:' + threadId, 'delivery:' + batch, 'job:' + jobId]));
      await database().delete(schema.jobs).where(eq(schema.jobs.id, jobId));
      await database().delete(schema.threads).where(eq(schema.threads.personId, id));
      await database().delete(schema.people).where(eq(schema.people.id, id));
      await engine.forget();
      await closeDatabase();
    }
  },
);
