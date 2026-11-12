import { durableJobs } from '../scheduler/adapters/durable-postgres';
import { createJobRunner } from '../scheduler/usecases';
import { scheduler, attention } from './index';
import { clock } from './ambient';
import { logger } from '../logging';

/** The `scheduledJob` workflow's activity (D85, D86): a deferred attention batch's release, or the scheduler's own kinds. */
export const runScheduledJob = createJobRunner({
  jobs: durableJobs,
  release: batch => attention.release(batch),
  run: job => scheduler.run(job),
  clock,
});
/**
 * The nightly scan is scheduled at boot (idempotent by date; the job reschedules the next one when it runs). Every job
 * row starts its workflow inside the transaction that writes it (D86), so nothing here polls for delivery; the retry is
 * only for a database that is not reachable yet.
 */
export function startJobs() {
  const seed = async () => {
    try {
      await scheduler.scheduleNightly();
    } catch (error) {
      logger.error({ scope: 'scheduler', error }, 'nightly scan could not be scheduled, retrying');
      setTimeout(() => void seed(), 2000).unref();
    }
  };
  void seed();
}
