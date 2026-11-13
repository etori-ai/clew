import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { DBOS } from '@dbos-inc/dbos-sdk';
import { database, schema, closeDatabase } from '@clew/db';
import { postgresJobQueue } from '../src/scheduler/adapters/postgres';
import { durableJobs } from '../src/scheduler/adapters/durable-postgres';
import { scheduledJobRunner } from '../src/scheduler/usecases';
import { every } from '../src/composition/ambient';
import { bindActivities } from '../src/dbos/workflows';
import { durableResult } from '../src/dbos/start';
import { testEngine } from './durable';

// A scheduled job whose run outlasts its claim's lease (D47, D85), on PostgreSQL, the durable engine and production
// Node, under its own application name: the live step, `scheduledJobRunner`, over the job table with the live timer,
// as `composition/jobs.ts` binds it. The run lasts 66 seconds, past the minute after which the engine used to give up
// an attempt of the step and retry it beside the run, and the ledger's clock runs three times as fast as the wall's, so
// on that clock the run lasts more than three minutes, past the two-minute lease. The timer renews the claim every 30
// seconds of the wall's time, which is 90 on the ledger's clock and inside the lease.
test(
  'a job whose run outlasts its lease keeps its claim, runs once and completes in the ledger with one job.completed row',
  { timeout: 150_000 },
  async () => {
    const engine = testEngine('job-lease'),
      id = 'job-lease-runtime-' + randomUUID(),
      started = Date.now(),
      base = Date.parse('2097-11-05T10:00:00.000Z');
    const clock = () => new Date(base + 3 * (Date.now() - started));
    const runs: number[] = [],
      logged: unknown[][] = [];
    let secondRun: (error: Error) => void = () => undefined;
    const besideTheFirst = new Promise<never>((_resolve, reject) => {
      secondRun = reject;
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
          await new Promise(resolve => setTimeout(resolve, 66_000));
        },
        clock,
        every,
        log: (...args: unknown[]) => logged.push(args),
      }),
    });
    let launched: Awaited<ReturnType<typeof engine.launch>> | undefined;
    try {
      // Due long ago, so the engine runs it as soon as it launches.
      await postgresJobQueue(engine.durable).schedule({ id, kind: 'receipt-final', runAt: '2001-11-05T10:00:00.000Z' });
      launched = await engine.launch();
      await Promise.race([
        durableResult('job:' + id),
        besideTheFirst,
        new Promise((_resolve, reject) =>
          setTimeout(() => reject(new Error('the job did not complete within 110 seconds')), 110_000).unref(),
        ),
      ]);
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
