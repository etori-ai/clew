import { durableJobs } from '../scheduler/adapters/durable-postgres';
import { scheduledJobRunner } from '../scheduler/usecases';
import { scheduler, attention } from './index';
import { clock, every } from './ambient';
import { logger, logPort } from '../logging';

/**
 * The `scheduledJob` workflow's step (D47, D86) over the live job table, the attention store and the scheduler. Its
 * claim is renewed on the wall clock while a run lasts.
 */
export const runScheduledJob = scheduledJobRunner({
  executions: durableJobs,
  release: batch => attention.release(batch),
  run: job => scheduler.run(job),
  clock,
  every,
  log: logPort('scheduler', 'error'),
});
/**
 * The nightly scan and the nightly clean-up of sign-in data (D117) are scheduled at boot by `scheduleNights`
 * (idempotent by date; each job reschedules the next one when it runs). Every job row starts its workflow inside the
 * transaction that writes it (D86), so nothing here polls for delivery; the retry is only for a database that is not
 * reachable yet.
 */
export function startJobs() {
  const seed = async () => {
    try {
      await scheduler.scheduleNights();
    } catch (error) {
      logger.error({ scope: 'scheduler', error }, 'nightly work could not be scheduled, retrying');
      setTimeout(() => void seed(), 2000).unref();
    }
  };
  void seed();
}
