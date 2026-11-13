import { durableJobs } from '../scheduler/adapters/durable-postgres';
import { scheduledJobRunner } from '../scheduler/usecases';
import { scheduler, attention } from './index';
import { clock } from './ambient';
import { logger } from '../logging';

/** The `scheduledJob` workflow's step (D47, D86) over the live job table, the attention store and the scheduler. */
export const runScheduledJob = scheduledJobRunner({
  executions: durableJobs,
  release: batch => attention.release(batch),
  run: job => scheduler.run(job),
  clock,
});
/**
 * The nightly scan and the nightly clean-up of sign-in data (D117) are scheduled at boot (idempotent by date; each job
 * reschedules the next one when it runs), once the durable engine has launched: its version is then the latest, so this
 * release takes each night from the queue, and a night that a deployment left waiting under the replaced release is
 * taken over (D85 item 2, as amended 2026-11-13). Every job row starts its workflow inside the transaction that writes
 * it (D86), so nothing here polls for delivery; the retry is only for a database that is not reachable yet.
 */
export function startJobs(engine: Promise<unknown>) {
  const seed = async () => {
    try {
      await engine;
      const taken = await scheduler.startNightly();
      if (taken.length)
        logger.info({ scope: 'scheduler', jobs: taken }, 'nightly work taken over from the replaced release');
    } catch (error) {
      logger.error({ scope: 'scheduler', error }, 'nightly work could not be scheduled, retrying');
      setTimeout(() => void seed(), 2000).unref();
    }
  };
  void seed();
}
