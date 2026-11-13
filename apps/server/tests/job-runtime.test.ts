import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq, like, or } from 'drizzle-orm';
import { database, schema, closeDatabase } from '@clew/db';
import { postgresJobQueue } from '../src/scheduler/adapters/postgres';
import { durableJobs } from '../src/scheduler/adapters/durable-postgres';
import { createScheduler, scheduledJobRunner, SIGN_IN_CLEANUP } from '../src/scheduler/usecases';
import { bindActivities } from '../src/dbos/workflows';
import { durableResult } from '../src/dbos/start';
import { testEngine } from './durable';

// A scheduled job (D86) on PostgreSQL, the durable engine and production Node: the nightly clean-up of sign-in data
// (D117), with the clean-up itself replaced by a record of the clock it ran on, which fails the first time. The engine
// runs under its own application name, and the nights lie in 2001 and 2097, so no real night's job is touched.
test(
  "a night's sign-in clean-up waits in the queue until an engine launches, runs once when due and completes in the ledger, also when it fails, and its run leaves the next night waiting in the engine",
  { timeout: 60_000 },
  async () => {
    const engine = testEngine('jobs');
    // The first nights lie in the real past, so the engine runs them as soon as it launches. The ledger's clock then
    // stands in the far future, so the night their runs schedule lies ahead of the real clock too, and waits.
    let now = Date.parse('2001-11-05T10:00:00.000Z');
    const clock = () => new Date(now);
    const cleaned: string[] = [],
      logged: unknown[][] = [];
    const scheduler = createScheduler({
      jobs: postgresJobQueue(engine.durable),
      people: { granted: async () => [], personaFor: async () => undefined },
      threads: { ensureThreads: async () => undefined, closeReceiptWindow: async () => undefined },
      calendar: { closeUndoWindow: async () => undefined },
      signIns: {
        removeExpired: async at => {
          cleaned.push(at.toISOString());
          if (cleaned.length === 1) throw new Error('the database refused the clean-up');
        },
      },
      clock,
      log: (...args) => logged.push(args),
    });
    // The live step, `scheduledJobRunner`, as `composition/jobs.ts` binds it, over the job table and this scheduler on
    // the ledger's clock; this test schedules no attention release.
    bindActivities({
      runScheduledJob: scheduledJobRunner({
        executions: durableJobs,
        release: async batch => {
          throw new Error('Not a scheduler job: ' + batch);
        },
        run: job => scheduler.run(job),
        clock,
      }),
    });
    const nights: Array<[id: string, runAt: string]> = [
        [SIGN_IN_CLEANUP + ':2001-11-06', '2001-11-06T02:00:00.000Z'],
        [SIGN_IN_CLEANUP + ':2001-11-07', '2001-11-07T02:00:00.000Z'],
      ],
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
      // A process that starts a day later schedules the night after.
      await scheduler.scheduleCleanup();
      await scheduler.scheduleCleanup();
      now = Date.parse('2001-11-06T10:00:00.000Z');
      await scheduler.scheduleCleanup();
      for (const [night, runAt] of nights) {
        assert.deepEqual(await row(night), { status: 'temporal', attempts: 0, runAt: new Date(runAt) });
        assert.equal((await engine.row('job:' + night))?.status, 'ENQUEUED');
      }

      now = Date.parse('2097-11-05T10:00:00.000Z');
      launched = await engine.launch();
      // Each night runs once and completes, the one whose clean-up failed too: a run that threw would be claimed again
      // every few minutes, and on this clock, which stands still, would never complete.
      for (const [night, runAt] of nights) {
        await durableResult('job:' + night);
        assert.equal((await engine.row('job:' + night))?.status, 'SUCCESS');
        assert.deepEqual(await row(night), { status: 'done', attempts: 1, runAt: new Date(runAt) });
        assert.deepEqual(await audited(night), ['job.scheduled', 'job.completed']);
      }
      assert.deepEqual(cleaned, ['2097-11-05T10:00:00.000Z', '2097-11-05T10:00:00.000Z']);
      assert.equal(logged.length, 1);
      assert.equal(logged[0]![0], 'sign-in clean-up failed');
      assert.equal((logged[0]![1] as Error).message, 'the database refused the clean-up');

      // Both runs scheduled the next night before they cleaned, and another process scheduling it again changes nothing.
      await scheduler.scheduleCleanup();
      assert.deepEqual(await row(next), {
        status: 'temporal',
        attempts: 0,
        runAt: new Date('2097-11-06T02:00:00.000Z'),
      });
      assert.deepEqual(await audited(next), ['job.scheduled']);
      // The engine has taken the next night from the queue and sleeps until it.
      await until(async () => (await engine.row('job:' + next))?.status === 'PENDING');
      assert.equal(cleaned.length, 2);
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
