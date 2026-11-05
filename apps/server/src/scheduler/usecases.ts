import { Temporal } from 'temporal-polyfill';
import { timeZone } from '@clew/calendar/dates';
import type { CalendarUsecases } from '../modules/calendar/usecases/samtal';
import type { ThreadUsecases } from '../threads/usecases/cards';
import type { Job, JobQueue, People } from './model';

/**
 * Postgres-backed scheduler for v1 (D15). One nightly scan per person with a grant and one timer per undo window.
 * Jobs are claimed with a row lock by the queue adapter, so a second server process is safe. Temporal replaces this
 * when the push engine grows (D17). Built over ports (D25): the tests drive `tick()` with a queue in memory.
 */
export interface SchedulerDeps {
  jobs: JobQueue;
  people: People;
  threads: Pick<ThreadUsecases, 'ensureThreads' | 'closeReceiptWindow'>;
  calendar: Pick<CalendarUsecases, 'closeUndoWindow'>;
  clock: () => Date;
  log: (message: string, ...details: unknown[]) => void;
  pollMs?: number;
}
export const NIGHTLY = 'scan-utvecklingssamtal';
export function createScheduler(deps: SchedulerDeps) {
  const { jobs, people, threads, calendar, clock, log } = deps;
  let timer: ReturnType<typeof setInterval> | undefined;
  const threadIdOf = (job: Job) => typeof job.payload.threadId === 'string' ? job.payload.threadId : undefined;
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
    await jobs.schedule({ id: `scan:${next.toPlainDate().toString()}`, kind: NIGHTLY, runAt: new Date(next.epochMilliseconds).toISOString() });
  }
  /** Run up to ten due jobs; a failing job is finished with its error and never blocks the next. */
  async function tick() {
    for (let i = 0; i < 10; i++) {
      const job = await jobs.claim(clock().toISOString());
      if (!job) return;
      try { await run(job); await jobs.finish(job.id); }
      catch (error) { await jobs.finish(job.id, error instanceof Error ? error.message : String(error)); }
    }
  }
  function start() {
    void scheduleNightly();
    void tick();
    timer ??= setInterval(() => void tick().catch(error => log('scheduler', error)), deps.pollMs ?? 15_000);
  }
  function stop() { if (timer) clearInterval(timer); timer = undefined; }
  return { run, scheduleNightly, tick, start, stop };
}
export type Scheduler = ReturnType<typeof createScheduler>;
