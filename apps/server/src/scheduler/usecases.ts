import { Temporal } from 'temporal-polyfill';
import { timeZone } from '@clew/calendar/dates';
import type { CalendarUsecases } from '../modules/calendar/usecases/samtal';
import type { ThreadUsecases } from '../threads/usecases/cards';
import type { Job, JobExecutions, JobQueue, People, SignInData } from './model';

/**
 * The scheduled jobs (D15, D47): one nightly scan per person with a grant, one nightly clean-up of expired sign-in data
 * (D117) and one timer per undo window. Each job row starts its `scheduledJob` workflow in the transaction that writes
 * it (D86), and the durable engine runs the job through `scheduledJobRunner` at its run time (D85); nothing polls the
 * table. Built over ports (D25).
 */
export interface SchedulerDeps {
  jobs: JobQueue;
  people: People;
  threads: Pick<ThreadUsecases, 'ensureThreads' | 'closeReceiptWindow'>;
  calendar: Pick<CalendarUsecases, 'closeUndoWindow'>;
  signIns: SignInData;
  clock: () => Date;
  log: (message: string, ...details: unknown[]) => void;
}
export const NIGHTLY = 'scan-utvecklingssamtal';
/**
 * The nightly clean-up of sign-in machinery (D117): sessions, login transactions and logout receipts past expiry. A
 * night whose clean-up fails says so in one line and completes; the next night cleans what it left.
 */
export const SIGN_IN_CLEANUP = 'sign-in-cleanup';
export function createScheduler(deps: SchedulerDeps) {
  const { jobs, people, threads, calendar, signIns, clock, log } = deps;
  const threadIdOf = (job: Job) => (typeof job.payload.threadId === 'string' ? job.payload.threadId : undefined);
  async function run(job: Job) {
    if (job.kind === NIGHTLY) {
      for (const id of await people.granted()) {
        const persona = await people.personaFor(id);
        if (persona) await threads.ensureThreads(persona).catch(error => log('scan', id, error));
      }
      await scheduleNightly();
    } else if (job.kind === SIGN_IN_CLEANUP) {
      // The next night first. A clean-up that fails is said and left to that night, and the night completes: a job
      // that threw would be claimed again by its workflow every few minutes for as long as the failure lasted, one more
      // workflow each night, while the next night repeats the clean-up anyway.
      await scheduleCleanup();
      await signIns.removeExpired(clock()).catch(error => log('sign-in clean-up failed', error));
    } else if (job.kind === 'undo-expiry') {
      const threadId = threadIdOf(job);
      if (threadId) await calendar.closeUndoWindow(threadId);
    } else if (job.kind === 'receipt-final') {
      const threadId = threadIdOf(job);
      if (threadId) await threads.closeReceiptWindow(threadId);
    } else throw new Error('Unsupported scheduled job kind: ' + job.kind);
  }
  /** The next time it is `hour` o'clock in Stockholm after now. */
  function nextAt(hour: number) {
    const now = Temporal.Instant.fromEpochMilliseconds(clock().getTime()).toZonedDateTimeISO(timeZone);
    const today = now.with({ hour, minute: 0, second: 0, millisecond: 0 });
    return today.epochMilliseconds > now.epochMilliseconds ? today : today.add({ days: 1 });
  }
  /**
   * A nightly job's next night after now, at `hour` o'clock Stockholm, under the id `<prefix>:<date>`, and the id of
   * the night before it: the last one, at or before now.
   */
  function nextNight(prefix: string, hour: number) {
    const at = nextAt(hour),
      date = at.toPlainDate();
    return {
      id: `${prefix}:${date}`,
      last: `${prefix}:${date.subtract({ days: 1 })}`,
      runAt: new Date(at.epochMilliseconds).toISOString(),
    };
  }
  /** The next 06:00 Stockholm after now. Idempotent by date, so every process may schedule it. The night. */
  async function scheduleNightly() {
    const night = nextNight('scan', 6);
    await jobs.schedule({ id: night.id, kind: NIGHTLY, runAt: night.runAt });
    return night;
  }
  /**
   * The sign-in clean-up at the next 03:00 Stockholm after now, a quiet hour that exists on both days the clocks
   * change. Idempotent by date, so every process may schedule it, and one job runs it however many processes do. The
   * night.
   */
  async function scheduleCleanup() {
    const night = nextNight(SIGN_IN_CLEANUP, 3);
    await jobs.schedule({ id: night.id, kind: SIGN_IN_CLEANUP, runAt: night.runAt });
    return night;
  }
  /**
   * A server's start, once its durable engine runs: the next night of the scan and of the sign-in clean-up, scheduled
   * when no earlier start or night has, and the last and the next night of each taken over when a deployment left it
   * waiting under the replaced release, or an earlier start was stopped while taking it over. Only a night's run
   * schedules the night after it, so a night left there would stop its job for good (D85 item 2, as amended
   * 2026-11-13). The last night is there when the deployment's downtime spanned its time: the older release held it
   * and stopped first, and no process of this one recovers it. Taken over, it runs at once, late; a last night that
   * ran is left as it is. The ids of the nights taken over.
   */
  async function startNightly() {
    const scan = await scheduleNightly(),
      cleanup = await scheduleCleanup();
    return jobs.takeOver([scan.last, scan.id, cleanup.last, cleanup.id]);
  }
  return { run, scheduleNightly, scheduleCleanup, startNightly };
}
export type Scheduler = ReturnType<typeof createScheduler>;
/**
 * The nightly work at a server's start (D117; D85 item 2, as amended 2026-11-13). It waits for the durable engine to
 * launch, which says itself while it cannot, so that this release is the latest, which alone takes work from the
 * queue, and then schedules the nights and takes them over (`startNightly`), saying which it took over. When that
 * fails, because the database stopped answering after the engine launched or a take-over failed, it says so and tries
 * again after `retry`'s wait, until it succeeds. Resolves when the first attempt has ended.
 */
export function seedNightly(deps: {
  engine: Promise<unknown>;
  startNightly: () => Promise<string[]>;
  log: (message: string, ...details: unknown[]) => void;
  fail: (message: string, ...details: unknown[]) => void;
  retry: (run: () => Promise<void>) => void;
}) {
  const seed = async (): Promise<void> => {
    try {
      await deps.engine;
      const taken = await deps.startNightly();
      if (taken.length) deps.log('nightly work taken over from the replaced release', taken);
    } catch (error) {
      deps.fail('nightly work could not be scheduled, retrying', error);
      deps.retry(seed);
    }
  };
  return seed();
}
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
