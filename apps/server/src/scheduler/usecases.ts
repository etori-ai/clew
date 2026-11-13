import { Temporal } from 'temporal-polyfill';
import { timeZone } from '@clew/calendar/dates';
import type { CalendarUsecases } from '../modules/calendar/usecases/samtal';
import type { ThreadUsecases } from '../threads/usecases/cards';
import {
  JOB_LEASE_MS,
  JOB_RUN_LONG_MS,
  type Job,
  type JobExecutions,
  type JobQueue,
  type People,
  type SignInData,
} from './model';

/**
 * The scheduled jobs (D15, D47): the nightly scan of everyone with a grant, a page at a time, one nightly clean-up of
 * expired sign-in data (D123) and one timer per undo window. Each job row starts its `scheduledJob` workflow in the
 * transaction that writes it (D86), and the durable engine runs the job through `scheduledJobRunner` at its run time
 * (D85); nothing polls the table. Built over ports (D25).
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
 * How many people one page of the nightly scan runs for. The scan grows with the installation and a page does not:
 * each page is a job of its own, so no run grows with the number of people, and a run that fails or whose process dies
 * is run again for its own page, never from the first person of the night.
 */
export const SCAN_PAGE = 500;
/**
 * The nightly clean-up of sign-in machinery (D123): sessions, login transactions and logout receipts past expiry. A
 * night whose clean-up fails says so in one line and completes; the next night cleans what it left.
 */
export const SIGN_IN_CLEANUP = 'sign-in-cleanup';
export function createScheduler(deps: SchedulerDeps) {
  const { jobs, people, threads, calendar, signIns, clock, log } = deps;
  const threadIdOf = (job: Job) => (typeof job.payload.threadId === 'string' ? job.payload.threadId : undefined);
  async function run(job: Job) {
    if (job.kind === NIGHTLY) await scanPage(job);
    else if (job.kind === SIGN_IN_CLEANUP) {
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
  /**
   * One page of the night's scan: the people with a grant after the last of the page before, in id order. The night's
   * first page, `scan:<date>`, schedules the next night before it scans, so the nights never wait on a scan. A full
   * page then schedules the next one, `scan:<date>:<page>`, to run at once, carrying where it ended; a page that is not
   * full ends the night. The pages run one after the other.
   */
  async function scanPage(job: Job) {
    const night = typeof job.payload.night === 'string' ? job.payload.night : job.id,
      page = typeof job.payload.page === 'number' ? job.payload.page : 1,
      after = typeof job.payload.after === 'string' ? job.payload.after : undefined;
    if (page === 1) await scheduleNightly();
    const ids = await people.granted({ after, limit: SCAN_PAGE });
    for (const id of ids) {
      const persona = await people.personaFor(id);
      if (persona) await threads.ensureThreads(persona).catch(error => log('scan', id, error));
    }
    if (ids.length === SCAN_PAGE)
      await jobs.schedule({
        id: `${night}:${page + 1}`,
        kind: NIGHTLY,
        runAt: clock().toISOString(),
        payload: { night, page: page + 1, after: ids[ids.length - 1] },
      });
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
   * ran is left as it is. A night of the scan is more than one job: a deployment during the scan leaves the page it had
   * reached waiting under the replaced release as well, so the last night's later pages that have not completed are
   * taken over with it, and the rest of that night runs. The ids of the nights and pages taken over.
   */
  async function startNightly() {
    const scan = await scheduleNightly(),
      cleanup = await scheduleCleanup(),
      pages = await jobs.unfinished(`${scan.last}:`);
    return jobs.takeOver([scan.last, ...pages, scan.id, cleanup.last, cleanup.id]);
  }
  return { run, scheduleNightly, scheduleCleanup, startNightly };
}
export type Scheduler = ReturnType<typeof createScheduler>;
/**
 * The nightly work at a server's start (D123; D85 item 2, as amended 2026-11-13). It waits for the durable engine to
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
 *
 * While the run lasts, its claim is renewed every quarter of the lease, so a run that outlasts the lease is never
 * claimed again beside itself; only a run whose process has died or stopped loses its claim. A run that finds its claim
 * taken all the same, or finishes after another attempt took it, says so in one line, and its completion writes nothing.
 * A run still going after `JOB_RUN_LONG_MS` is said once, with its job and attempt, since it holds the job until it
 * settles or its process stops.
 */
export function scheduledJobRunner(deps: {
  executions: JobExecutions;
  release: (batch: string) => Promise<void>;
  run: (job: Job) => Promise<void>;
  clock: () => Date;
  /** Calls `tick` every `ms` until the function it returns is called. */
  every: (ms: number, tick: () => void) => () => void;
  log: (message: string, ...details: unknown[]) => void;
}) {
  const { executions, clock, log } = deps;
  /**
   * Renews the attempt's claim, made at `claimedAt`, while its run lasts, and says once that the run has lasted
   * `JOB_RUN_LONG_MS`; the function it returns stops the renewal and waits for one under way.
   */
  function keepClaim(job: Job & { attempt: number }, claimedAt: Date) {
    let stopped = false,
      lost = false,
      long = false,
      renewing: Promise<void> | undefined;
    const renew = async () => {
      try {
        if (!(await executions.renew(job.id, job.attempt, clock().toISOString())) && !stopped) {
          lost = true;
          log('scheduled job lost its claim while it ran', job.id, job.attempt);
        }
      } catch (error) {
        if (!stopped) log('scheduled job claim not renewed', job.id, error);
      }
    };
    const cancel = deps.every(JOB_LEASE_MS / 4, () => {
      if (stopped || lost) return;
      if (!long && clock().getTime() - claimedAt.getTime() >= JOB_RUN_LONG_MS) {
        long = true;
        log(
          'scheduled job still running after ten minutes; it holds its claim until the run settles or its process stops',
          job.id,
          job.attempt,
        );
      }
      if (renewing) return;
      renewing = renew().finally(() => {
        renewing = undefined;
      });
    });
    return async () => {
      stopped = true;
      cancel();
      await renewing;
    };
  }
  return async function runScheduledJob(id: string): Promise<'done' | 'busy'> {
    const claimedAt = clock();
    const job = await executions.claimExecution(id, claimedAt.toISOString());
    if (!job) return 'done';
    if (job === 'busy') return 'busy';
    const stopRenewing = keepClaim(job, claimedAt);
    try {
      if (job.kind === 'attention-release' && typeof job.payload.batch === 'string')
        await deps.release(job.payload.batch);
      else await deps.run(job);
    } finally {
      await stopRenewing();
    }
    if (!(await executions.completed(id, job.attempt, clock().toISOString())))
      log('scheduled job finished after another attempt took it; its completion is not recorded', id, job.attempt);
    return 'done';
  };
}
