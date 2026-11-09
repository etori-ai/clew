import { durableJobs } from '../scheduler/adapters/durable-postgres';
import { startDurable } from '../dbos/start';
import { scheduledJob } from '../dbos/workflows';
import { scheduler, attention } from './index';
import { clock } from './ambient';

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
export async function dispatchJobs(limit = 20) {
  for (let n = 0; n < limit; n++) {
    const job = await durableJobs.claimDelivery(clock().toISOString());
    if (!job) return;
    let error: string | undefined;
    try {
      // Idempotent by the job's natural id: a redelivery meets the running or finished workflow.
      await startDurable(scheduledJob, `job:${job.id}`, { id: job.id, dueAt: job.dueAt });
    } catch {
      error = 'timer-service-unavailable';
    }
    await durableJobs.delivered(job.id, job.attempt, clock().toISOString(), error);
  }
}
export function startJobs() {
  let busy = false,
    seeded = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      if (!seeded) {
        await scheduler.scheduleNightly();
        seeded = true;
      }
      await dispatchJobs();
    } catch {
      console.error('scheduled job outbox unavailable');
    } finally {
      busy = false;
    }
  };
  void tick();
  const timer = setInterval(() => void tick(), 2000);
  timer.unref();
  return () => clearInterval(timer);
}
