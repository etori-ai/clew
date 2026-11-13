import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { DBOS } from '@dbos-inc/dbos-sdk';
import { database, schema, closeDatabase } from '@clew/db';
import { postgresJobQueue } from '../src/scheduler/adapters/postgres';
import { durableJobs } from '../src/scheduler/adapters/durable-postgres';
import { JOB_LEASE_MS } from '../src/scheduler/model';
import { scheduledJobRunner } from '../src/scheduler/usecases';
import { every } from '../src/composition/ambient';
import { bindActivities } from '../src/dbos/workflows';
import { durableResult, moveToRunningVersion } from '../src/dbos/start';
import { testEngine } from './durable';

// A scheduled job whose run outlasts its claim's lease (D47, D85), on PostgreSQL, the durable engine and production
// Node, under its own application name: the live step, `scheduledJobRunner`, over the job table with the live timer,
// as `composition/jobs.ts` binds it. The ledger's clock runs three times as fast as the wall's, so the run's 66 seconds
// are more than three minutes on it, past the two-minute lease, and the timer renews the claim every 30 seconds of the
// wall's time, 90 on the ledger's clock. Forty-five seconds into the run, past the first lease, a second claimant asks
// for the job, as the job's workflow would after its process stood still: only the renewal keeps the job from it. The
// run also lasts past the minute after which the engine used to give up an attempt of the step and retry it beside the
// run.
test(
  'a job whose run outlasts its lease keeps it through the live renewal: a claim past the first lease finds it busy, and it runs once and completes with one job.completed row',
  { timeout: 150_000 },
  async () => {
    const engine = testEngine('job-lease'),
      id = 'job-lease-runtime-' + randomUUID(),
      started = Date.now(),
      base = Date.parse('2097-11-05T10:00:00.000Z');
    const clock = () => new Date(base + 3 * (Date.now() - started));
    const runs: number[] = [],
      logged: unknown[][] = [];
    let secondRun: (error: Error) => void = () => undefined,
      runBegan: (wall: number) => void = () => undefined,
      runEnded: number | undefined;
    const besideTheFirst = new Promise<never>((_resolve, reject) => {
      secondRun = reject;
    });
    const began = new Promise<number>(resolve => {
      runBegan = resolve;
    });
    bindActivities({
      runScheduledJob: scheduledJobRunner({
        executions: durableJobs,
        release: async batch => {
          throw new Error('Not a lease job: ' + batch);
        },
        run: async () => {
          runs.push(Math.round((Date.now() - started) / 1000));
          if (runs.length > 1)
            secondRun(new Error(`a second run started beside the first, at ${runs.join(' s and ')} s`));
          runBegan(Date.now());
          await new Promise(resolve => setTimeout(resolve, 66_000));
          runEnded = Date.now();
        },
        clock,
        every,
        log: (...args: unknown[]) => logged.push(args),
      }),
    });
    // Forty-five seconds into the run on the wall's clock: the job's row, and what a claim of the job finds then.
    const probe = began.then(async wall => {
      await new Promise(resolve => setTimeout(resolve, wall + 45_000 - Date.now()));
      const at = clock(),
        during = runEnded === undefined;
      const [held] = await database()
        .select({
          status: schema.jobs.status,
          attempts: schema.jobs.attempts,
          startedAt: schema.jobs.startedAt,
          leaseUntil: schema.jobs.leaseUntil,
        })
        .from(schema.jobs)
        .where(eq(schema.jobs.id, id));
      return { at, during, held: held!, claim: await durableJobs.claimExecution(id, at.toISOString()) };
    });
    let launched: Awaited<ReturnType<typeof engine.launch>> | undefined;
    try {
      // Due long ago, so the engine runs it as soon as it launches.
      await postgresJobQueue({ durable: engine.durable, move: moveToRunningVersion }).schedule({
        id,
        kind: 'receipt-final',
        runAt: '2001-11-05T10:00:00.000Z',
      });
      launched = await engine.launch();
      const [, seen] = await Promise.race([
        Promise.all([durableResult('job:' + id), probe]),
        besideTheFirst,
        new Promise<never>((_resolve, reject) =>
          setTimeout(() => reject(new Error('the job did not complete within 110 seconds')), 110_000).unref(),
        ),
      ]);
      // The claim came while the run lasted and after its first lease had ended on the ledger's clock. The renewal had
      // moved the lease past that moment, so the job was still claimed.
      assert.equal(seen.during, true, 'the claim came while the run lasted');
      assert.ok(
        seen.at.getTime() > seen.held.startedAt!.getTime() + JOB_LEASE_MS,
        'the claim came past the first lease',
      );
      assert.equal(seen.claim, 'busy', 'a claim past the first lease finds the job claimed');
      assert.deepEqual([seen.held.status, seen.held.attempts], ['executing', 1]);
      assert.ok(seen.held.leaseUntil!.getTime() > seen.at.getTime(), 'the renewal moved the lease past the claim');
      assert.equal((await engine.row('job:' + id))?.status, 'SUCCESS');
      assert.equal(runs.length, 1, 'one run, never a second beside it');
      // The engine recorded the step once, done: no attempt of it was given up at a timeout and retried beside the run.
      const steps = (await engine.steps('job:' + id)).filter(step => step.name === 'runScheduledJob');
      assert.equal(steps.length, 1, 'one step: ' + JSON.stringify(steps));
      assert.equal(steps[0]!.error, null);
      assert.match(String(steps[0]!.output), /done/);
      const [row] = await database()
        .select({ status: schema.jobs.status, attempts: schema.jobs.attempts, leaseUntil: schema.jobs.leaseUntil })
        .from(schema.jobs)
        .where(eq(schema.jobs.id, id));
      assert.deepEqual(row, { status: 'done', attempts: 1, leaseUntil: null });
      const audit = await database()
        .select({ action: schema.audit.action, details: schema.audit.details })
        .from(schema.audit)
        .where(eq(schema.audit.subject, 'job:' + id))
        .orderBy(schema.audit.id);
      assert.deepEqual(
        audit.map(a => a.action),
        ['job.scheduled', 'job.completed'],
      );
      assert.deepEqual(audit[1]?.details, { attempt: 1 });
      assert.deepEqual(logged, []);
    } finally {
      if (launched) {
        await DBOS.cancelWorkflow('job:' + id).catch(() => undefined);
        await launched.shutdown();
      }
      await database()
        .delete(schema.audit)
        .where(eq(schema.audit.subject, 'job:' + id));
      await database().delete(schema.jobs).where(eq(schema.jobs.id, id));
      await engine.forget();
      await closeDatabase();
    }
  },
);
