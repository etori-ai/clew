import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { eq, inArray, like, or, sql } from 'drizzle-orm';
import { database, schema, closeDatabase } from '@clew/db';
import { postgresJobQueue } from '../src/scheduler/adapters/postgres';
import { durableJobs } from '../src/scheduler/adapters/durable-postgres';
import { createScheduler, scheduledJobRunner, SIGN_IN_CLEANUP } from '../src/scheduler/usecases';
import { bindActivities } from '../src/dbos/workflows';
import {
  cancelDurable,
  durableResult,
  engineControls,
  moveToRunningVersion,
  type WorkflowControls,
} from '../src/dbos/start';
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
      jobs: postgresJobQueue({ durable: engine.durable, move: moveToRunningVersion }),
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

// A deployment (D85 item 2): the instance that holds the nights' workflows is replaced by the next release, under a new
// application version and the same executor id, and its downtime spans the clean-up's night at 03:00. The engine
// recovers only the workflows of its own version, so the nights the older release took from the queue would wait under
// it for good, and with them every later night, which only a night's run schedules. The start of the next release, at
// 04:00, takes over the clean-up's night, which has passed, and the scan's, which lies ahead; it finishes a move that an
// earlier start of it began, and a start that loses a race for a night to another leaves the night to it.
test(
  "the nights a replaced release took from the queue, one of them past, are taken over by the next release's start, run once and leave the next nights waiting under the new release",
  { timeout: 90_000 },
  async () => {
    const engine = testEngine('jobs-release');
    // Version names are unique across the applications of one system database, so the releases carry the test's.
    const releases = [engine.name + ':release-1', engine.name + ':release-2'] as const,
      instance = 'jobs-instance';
    const [scan, cleanup] = ['scan:2002-11-06', SIGN_IN_CLEANUP + ':2002-11-06'],
      nights = [scan, cleanup],
      // The next release's start schedules the clean-up's next night, which lies in the real past too and runs at once.
      cleanupNext = SIGN_IN_CLEANUP + ':2002-11-07',
      next = ['scan:2096-11-06', SIGN_IN_CLEANUP + ':2096-11-06'];
    // The scan's run waits at this gate, so the scan's night stays in its step under the new release until it opens.
    let open!: () => void;
    const gate = new Promise<void>(resolve => (open = resolve));
    const doubles = {
      people: {
        granted: async () => {
          await gate;
          return [];
        },
        personaFor: async () => undefined,
      },
      threads: { ensureThreads: async () => undefined, closeReceiptWindow: async () => undefined },
      calendar: { closeUndoWindow: async () => undefined },
    };
    const cleaned: string[] = [],
      logged: unknown[][] = [];
    const jobs = postgresJobQueue({ durable: engine.durable, move: moveToRunningVersion });
    // A start's clock. The older release starts the day before the nights, which lie in the real past, so an engine
    // that takes them from the queue runs them at once. A start never cleans.
    let startAt = Date.parse('2002-11-05T10:00:00.000Z');
    const starting = createScheduler({
      jobs,
      ...doubles,
      signIns: {
        removeExpired: async () => {
          throw new Error('a start does not clean');
        },
      },
      clock: () => new Date(startAt),
      log: (...args) => logged.push(args),
    });
    // The runs stand on a later clock, so the nights they schedule lie ahead of the real clock and wait.
    const later = () => new Date('2096-11-05T10:00:00.000Z');
    const running = createScheduler({
      jobs,
      ...doubles,
      signIns: {
        removeExpired: async at => {
          cleaned.push(at.toISOString());
        },
      },
      clock: later,
      log: (...args) => logged.push(args),
    });
    bindActivities({
      runScheduledJob: scheduledJobRunner({
        executions: durableJobs,
        release: async batch => {
          throw new Error('Not a scheduler job: ' + batch);
        },
        run: job => running.run(job),
        clock: later,
      }),
    });
    const version = async (workflowID: string) =>
      [
        ...(await database().execute<{
          status: string;
          executor_id: string | null;
          application_version: string | null;
          queue_name: string | null;
        }>(
          sql`select status, executor_id, application_version, queue_name from dbos.workflow_status where workflow_uuid = ${workflowID} and application_name = ${engine.name}`,
        )),
      ][0];
    const row = async (id: string) =>
      (
        await database()
          .select({ status: schema.jobs.status, attempts: schema.jobs.attempts })
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
    let child: ReturnType<typeof spawn> | undefined, launched: Awaited<ReturnType<typeof engine.launch>> | undefined;
    try {
      // The older release starts: it schedules both nights, and its engine takes them from the queue.
      await starting.scheduleNightly();
      await starting.scheduleCleanup();
      for (const night of nights) assert.equal((await version('job:' + night))?.status, 'ENQUEUED');
      child = spawn(
        process.execPath,
        ['--import', 'tsx', fileURLToPath(new URL('./fixtures/durable-job-child.ts', import.meta.url))],
        {
          env: { ...process.env, DURABLE_APP: engine.name, DURABLE_EXECUTOR: instance, DURABLE_RELEASE: releases[0] },
          stdio: ['ignore', 'pipe', 'inherit'],
        },
      );
      await new Promise<void>((resolve, reject) => {
        let out = '';
        const timeout = setTimeout(() => reject(new Error('the older release did not take the nights')), 30_000);
        child!.once('exit', code => reject(new Error('the older release exited during startup: ' + code)));
        child!.stdout!.on('data', chunk => {
          out += String(chunk);
          if (nights.every(night => out.includes('took job:' + night))) {
            clearTimeout(timeout);
            resolve();
          }
        });
      });
      // The deployment replaces it.
      await new Promise<void>(resolve => {
        child!.once('exit', () => resolve());
        child!.kill('SIGKILL');
      });
      for (const night of nights)
        assert.deepEqual(await version('job:' + night), {
          status: 'PENDING',
          executor_id: instance,
          application_version: releases[0],
          queue_name: engine.durable.queue,
        });

      // The instance comes back as the next release at 04:00 Stockholm, after the clean-up's night and before the
      // scan's. Its engine recovers nothing of the older version's. A first start was stopped between the two calls of
      // its move of the clean-up's night: it cancelled the night and did not rewind it.
      startAt = Date.parse('2002-11-06T03:00:00.000Z');
      launched = await engine.launch({ executorID: instance, applicationVersion: releases[1] });
      await cancelDurable('job:' + cleanup);
      assert.equal((await version('job:' + cleanup))?.status, 'CANCELLED');
      // A second start moves the scan's night, and while it holds the night between its two calls, a third start, which
      // runs once the engine has launched as `composition/jobs.ts` runs it, takes over both nights. The second finds
      // the scan's night moved under the running version and leaves it to the third.
      let third: string[] = [];
      const holding: WorkflowControls = {
        ...engineControls,
        async cancel(workflowID) {
          await engineControls.cancel(workflowID);
          third = await starting.startNightly();
        },
      };
      assert.deepEqual(await moveToRunningVersion(['job:' + scan], engine.durable.queue, holding), []);
      assert.deepEqual(third, nights);
      // The scan's night waits in its step under the new release, on the ledger's queue.
      await until(
        async () => (await version('job:' + scan))?.application_version === releases[1],
        `${scan} was not taken over`,
      );
      assert.equal((await version('job:' + scan))?.queue_name, engine.durable.queue);
      open();
      for (const night of [...nights, cleanupNext]) {
        await until(
          async () => (await version('job:' + night))?.status === 'SUCCESS',
          `${night} did not run under the next release`,
        );
        assert.equal((await version('job:' + night))?.application_version, releases[1]);
        assert.deepEqual(await row(night), { status: 'done', attempts: 1 });
        assert.deepEqual(await audited(night), ['job.scheduled', 'job.completed']);
      }
      // The clean-up's night, late, and its next night, at once.
      assert.deepEqual(cleaned, [later().toISOString(), later().toISOString()]);
      assert.deepEqual(logged, []);
      // Each run scheduled its next night, which waits in the engine under the new release.
      for (const night of next) {
        assert.deepEqual(await row(night), { status: 'temporal', attempts: 0 });
        await until(
          async () => (await version('job:' + night))?.status === 'PENDING',
          `${night} is not waiting in the engine`,
        );
        assert.equal((await version('job:' + night))?.application_version, releases[1]);
      }
      // Another start of the same release, a second instance or a restart, finds nothing to take over.
      assert.deepEqual(await starting.startNightly(), []);
      assert.equal(cleaned.length, 2);
    } finally {
      if (child && child.exitCode === null) child.kill('SIGKILL');
      open();
      await launched?.shutdown();
      const ours = [...nights, cleanupNext, ...next];
      await database()
        .delete(schema.audit)
        .where(
          inArray(
            schema.audit.subject,
            ours.map(id => 'job:' + id),
          ),
        );
      await database().delete(schema.jobs).where(inArray(schema.jobs.id, ours));
      await engine.forget();
      await database().execute(sql`delete from dbos.application_versions where application_name = ${engine.name}`);
      await closeDatabase();
    }
  },
);

async function until(done: () => Promise<boolean>, failure = 'the engine did not take the next night from the queue') {
  for (let i = 0; i < 100; i++) {
    if (await done()) return;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(failure);
}
