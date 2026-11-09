import { durableJobs } from '../scheduler/adapters/durable-postgres';
import { scheduler, attention } from './index';
import { clock } from './ambient';
import { logger } from '../logging';

export async function runScheduledJob(id: string): Promise<'done' | 'busy'> {
  const job = await durableJobs.claimExecution(id, clock().toISOString());
  if (!job) return 'done';
  if (job === 'busy') return 'busy';
  if (job.kind === 'attention-release' && typeof job.payload.batch === 'string')
    await attention.release(job.payload.batch);
  else await scheduler.run(job);
  await durableJobs.completed(id, job.attempt, clock().toISOString());
  return 'done';
}
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
