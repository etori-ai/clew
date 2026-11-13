import type { AuthenticatedContext } from '@clew/contracts';

/**
 * The ports of the scheduler (D15, D25, D47): the job table, the engine's side of it and the people a nightly scan runs
 * for. A job runs only through its `scheduledJob` workflow, started with its row (D86); nothing polls the table.
 */
export interface Job {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
}
export interface JobQueue {
  /** Idempotent by job id. The job's durable workflow starts with the same commit (D86). */
  schedule(job: { id: string; kind: string; runAt: string; payload?: Record<string, unknown> }): Promise<void>;
  /**
   * The jobs among `ids` whose workflow a replaced release left waiting under its own version, which no process of the
   * running release recovers (D85 item 2), or a take-over stopped between its two calls left cancelled there, start
   * again from their first step under the running release. For jobs whose workflow does nothing a restart repeats
   * before it claims the job's row, and whose second run that claim fences. The ids taken over.
   */
  takeOver(ids: string[]): Promise<string[]>;
  /**
   * The ids of the jobs whose id begins with `prefix` that have not completed: waiting for their run, or claimed by a run
   * that did not complete. The later pages of a night's scan are `<night>:<page>`.
   */
  unfinished(prefix: string): Promise<string[]>;
}
/**
 * How long a claim on a job's execution holds without being renewed. A run renews it while it lasts, so only a run
 * whose process has died or stopped loses its claim, and the job's workflow claims it again once the lease has passed.
 */
export const JOB_LEASE_MS = 120_000;
/**
 * How long a run lasts before the runner says so. Every job takes seconds, a page of the nightly scan included, so a run
 * this long is waiting on something that does not answer. It keeps its claim, and so its job, for as long as its process
 * lives, since the job's step has no timeout: the runner writes one error line, and the reliability counts show the job
 * as `longRunningJobs` until the run settles or its process stops.
 */
export const JOB_RUN_LONG_MS = 10 * 60_000;
/** The engine's side of a job row (D47, D85): its execution claimed under a lease, then completed with its audit row. */
export interface JobExecutions {
  /** This attempt of the job; `busy` before its run time or while another attempt holds the lease; undefined when it is done or not the engine's to run. */
  claimExecution(id: string, at: string): Promise<(Job & { attempt: number }) | 'busy' | undefined>;
  /** Extends this attempt's lease to `JOB_LEASE_MS` after `at`. False when the attempt no longer holds the job: another attempt claimed it, or it is done. */
  renew(id: string, attempt: number, at: string): Promise<boolean>;
  /** Completes this attempt with its `job.completed` row. False, writing nothing, when the attempt no longer holds the job. */
  completed(id: string, attempt: number, at: string): Promise<boolean>;
}
export interface People {
  /**
   * Ids of the enabled people with an access grant and an identity binding, who the nightly scan runs for (D68): at
   * most `limit` of them, in id order, after `after` when it is given. The scan reads them a page at a time.
   */
  granted(page: { after?: string; limit: number }): Promise<string[]>;
  /** A system identity for one of them (`system-context.ts`), or undefined when the grant is gone. */
  personaFor(id: string): Promise<AuthenticatedContext | undefined>;
}
/** Clew's own sign-in machinery, which the nightly clean-up empties (D117). */
export interface SignInData {
  /**
   * Removes every session past either expiry at `now`, ending one still open with an `expired` row in the
   * authentication log, and the login transactions and logout receipts past theirs. The authentication log is kept.
   */
  removeExpired(now: Date): Promise<void>;
}
