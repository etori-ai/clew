import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq, like, or } from 'drizzle-orm';
import { database, schema, closeDatabase } from '@clew/db';
import { postgresJobQueue } from '../src/scheduler/adapters/postgres';
import { durableJobs } from '../src/scheduler/adapters/durable-postgres';
import { createScheduler, SIGN_IN_CLEANUP } from '../src/scheduler/usecases';
import { bindActivities } from '../src/dbos/workflows';
import { durableResult } from '../src/dbos/start';
import { testEngine } from './durable';

// A scheduled job (D86) on PostgreSQL, the durable engine and production Node: the nightly clean-up of sign-in data
// (D117), with the clean-up itself replaced by a record of the clock it ran on. The engine runs under its own
// application name, and the nights lie in 2001 and 2097, so no real night's job is touched.
test(
  "the night's sign-in clean-up waits in the queue until an engine launches, runs once when due and completes in the ledger, and its run leaves the next night waiting in the engine",
  { timeout: 60_000 },
  async () => {
    const engine = testEngine('jobs');
    // The first night lies in the real past, so the engine runs it as soon as it launches. The ledger's clock then
    // stands in the far future, so the night that run schedules lies ahead of the real clock too, and waits.
    let now = Date.parse('2001-11-05T10:00:00.000Z');
    const clock = () => new Date(now);
    const cleaned: string[] = [];
    const scheduler = createScheduler({
      jobs: postgresJobQueue(engine.durable),
      people: { granted: async () => [], personaFor: async () => undefined },
      threads: { ensureThreads: async () => undefined, closeReceiptWindow: async () => undefined },
      calendar: { closeUndoWindow: async () => undefined },
      signIns: {
        removeExpired: async at => {
          cleaned.push(at.toISOString());
        },
      },
      clock,
      log: () => undefined,
    });
    // The step as `composition/jobs.ts` runs it: claim the execution on the ledger's clock, run the job, complete it.
    bindActivities({
      runScheduledJob: async id => {
        const job = await durableJobs.claimExecution(id, clock().toISOString());
        if (!job) return 'done';
        if (job === 'busy') return 'busy';
        await scheduler.run(job);
        await durableJobs.completed(id, job.attempt, clock().toISOString());
        return 'done';
      },
    });
    const first = SIGN_IN_CLEANUP + ':2001-11-06',
      next = SIGN_IN_CLEANUP + ':2097-11-06';
    const row = async (id: string) =>
      (
        await database()
          .select({ status: schema.jobs.status, attempts: schema.jobs.attempts, runAt: schema.jobs.runAt })
          .from(schema.jobs)
          .where(eq(schema.jobs.id, id))
      )[0];
    const audited = async (id: string) =>
      (
        await database()
          .select({ action: schema.audit.action })
          .from(schema.audit)
          .where(eq(schema.audit.subject, 'job:' + id))
          .orderBy(schema.audit.id)
      ).map(r => r.action);
    let launched: Awaited<ReturnType<typeof engine.launch>> | undefined;
    try {
      // Every process schedules the night when it starts; one row and one workflow come of it, before any engine runs.
      await scheduler.scheduleCleanup();
      await scheduler.scheduleCleanup();
      assert.deepEqual(await row(first), {
        status: 'temporal',
        attempts: 0,
        runAt: new Date('2001-11-06T02:00:00.000Z'),
      });
      assert.equal((await engine.row('job:' + first))?.status, 'ENQUEUED');

      now = Date.parse('2097-11-05T10:00:00.000Z');
      launched = await engine.launch();
      await durableResult('job:' + first);
      assert.equal((await engine.row('job:' + first))?.status, 'SUCCESS');
      assert.deepEqual(cleaned, ['2097-11-05T10:00:00.000Z']);
      assert.deepEqual(await row(first), { status: 'done', attempts: 1, runAt: new Date('2001-11-06T02:00:00.000Z') });
      assert.deepEqual(await audited(first), ['job.scheduled', 'job.completed']);

      // The run scheduled the next night before it cleaned, and another process scheduling it again changes nothing.
      await scheduler.scheduleCleanup();
      assert.deepEqual(await row(next), {
        status: 'temporal',
        attempts: 0,
        runAt: new Date('2097-11-06T02:00:00.000Z'),
      });
      assert.deepEqual(await audited(next), ['job.scheduled']);
      // The engine has taken the next night from the queue and sleeps until it.
      await until(async () => (await engine.row('job:' + next))?.status === 'PENDING');
      assert.deepEqual(cleaned, ['2097-11-05T10:00:00.000Z']);
    } finally {
      await launched?.shutdown();
      const ours = (column: typeof schema.jobs.id | typeof schema.audit.subject, prefix = '') =>
        or(like(column, prefix + SIGN_IN_CLEANUP + ':2001-%'), like(column, prefix + SIGN_IN_CLEANUP + ':2097-%'));
      await database().delete(schema.audit).where(ours(schema.audit.subject, 'job:'));
      await database().delete(schema.jobs).where(ours(schema.jobs.id));
      await engine.forget();
      await closeDatabase();
    }
  },
);

async function until(done: () => Promise<boolean>) {
  for (let i = 0; i < 100; i++) {
    if (await done()) return;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error('the engine did not take the next night from the queue');
}
