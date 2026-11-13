import { durableJobs } from '../scheduler/adapters/durable-postgres';
import { scheduledJobRunner, seedNightly } from '../scheduler/usecases';
import { scheduler, attention } from './index';
import { clock } from './ambient';
import { logPort } from '../logging';

/** The `scheduledJob` workflow's step (D47, D86) over the live job table, the attention store and the scheduler. */
export const runScheduledJob = scheduledJobRunner({
  executions: durableJobs,
  release: batch => attention.release(batch),
  run: job => scheduler.run(job),
  clock,
});
/**
 * The nightly scan and the nightly clean-up of sign-in data (D117) are scheduled at boot (idempotent by date; each job
 * reschedules the next one when it runs), once the durable engine has launched (`seedNightly`): its version is then the
 * latest, so this release takes each night from the queue, and the last and the next night that a deployment left
 * waiting under the replaced release are taken over (D85 item 2, as amended 2026-11-13). Every job row starts its
 * workflow inside the transaction that writes it (D86), so nothing here polls for delivery. While the engine cannot
 * launch, it says so itself every 30 seconds (`dbos/runtime.ts`); the retry here, every two seconds, is for a failure
 * after it has launched, such as a database that stopped answering or a take-over that failed.
 */
export function startJobs(engine: Promise<unknown>) {
  void seedNightly({
    engine,
    startNightly: () => scheduler.startNightly(),
    log: logPort('scheduler'),
    fail: logPort('scheduler', 'error'),
    retry: run => {
      setTimeout(() => void run(), 2000).unref();
    },
  });
}
