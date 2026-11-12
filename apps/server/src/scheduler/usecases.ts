import { Temporal } from 'temporal-polyfill';
import { timeZone } from '@clew/calendar/dates';
import type { CalendarUsecases } from '../modules/calendar/usecases/samtal';
import type { ThreadUsecases } from '../threads/usecases/cards';
import type { Job, JobExecutions, JobQueue, People } from './model';

/**
 * The scheduled jobs (D15, D47): one nightly scan per person with a grant and one timer per undo window. Each job row
 * starts its `scheduledJob` workflow in the transaction that writes it (D86), and the durable engine runs the job
 * through `scheduledJobRunner` at its run time (D85); nothing polls the table. Built over ports (D25).
 */
export interface SchedulerDeps {
  jobs: JobQueue;
  people: People;
  threads: Pick<ThreadUsecases, 'ensureThreads' | 'closeReceiptWindow'>;
  calendar: Pick<CalendarUsecases, 'closeUndoWindow'>;
  clock: () => Date;
  log: (message: string, ...details: unknown[]) => void;
}
export const NIGHTLY = 'scan-utvecklingssamtal';
export function createScheduler(deps: SchedulerDeps) {
  const { jobs, people, threads, calendar, clock, log } = deps;
  const threadIdOf = (job: Job) => (typeof job.payload.threadId === 'string' ? job.payload.threadId : undefined);
  async function run(job: Job) {
    if (job.kind === NIGHTLY) {
      for (const id of await people.granted()) {
        const persona = await people.personaFor(id);
        if (persona) await threads.ensureThreads(persona).catch(error => log('scan', id, error));
      }
      await scheduleNightly();
    } else if (job.kind === 'undo-expiry') {
      const threadId = threadIdOf(job);
      if (threadId) await calendar.closeUndoWindow(threadId);
    } else if (job.kind === 'receipt-final') {
      const threadId = threadIdOf(job);
      if (threadId) await threads.closeReceiptWindow(threadId);
    } else throw new Error('Unsupported scheduled job kind: ' + job.kind);
  }
  /** The next 06:00 Stockholm after now. Idempotent by date, so every process may schedule it. */
  async function scheduleNightly() {
    const now = Temporal.Instant.fromEpochMilliseconds(clock().getTime()).toZonedDateTimeISO(timeZone);
    const today = now.with({ hour: 6, minute: 0, second: 0, millisecond: 0 });
    const next = today.epochMilliseconds > now.epochMilliseconds ? today : today.add({ days: 1 });
    await jobs.schedule({
      id: `scan:${next.toPlainDate().toString()}`,
      kind: NIGHTLY,
      runAt: new Date(next.epochMilliseconds).toISOString(),
    });
  }
  return { run, scheduleNightly };
}
export type Scheduler = ReturnType<typeof createScheduler>;
/**
 * The step of a job's `scheduledJob` workflow (D47, D86), which waits until the job's run time first: the row's
 * execution is claimed under its lease, the job is run by its kind and the execution completes with its audit row. An
 * `attention-release` job makes its deferred attention batch ready (D47) through `release`; every other kind is the
 * scheduler's `run`. `busy` asks the workflow to come back later; a job that is done, or not the engine's, is done.
 */
export function scheduledJobRunner(deps: {
  executions: JobExecutions;
  release: (batch: string) => Promise<void>;
  run: (job: Job) => Promise<void>;
  clock: () => Date;
}) {
  return async function runScheduledJob(id: string): Promise<'done' | 'busy'> {
    const job = await deps.executions.claimExecution(id, deps.clock().toISOString());
    if (!job) return 'done';
    if (job === 'busy') return 'busy';
    if (job.kind === 'attention-release' && typeof job.payload.batch === 'string')
      await deps.release(job.payload.batch);
    else await deps.run(job);
    await deps.executions.completed(id, job.attempt, deps.clock().toISOString());
    return 'done';
  };
}
