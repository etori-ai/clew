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
}
/** The engine's side of a job row (D47, D85): its execution claimed under a lease, then completed with its audit row. */
export interface JobExecutions {
  /** This attempt of the job; `busy` before its run time or while another attempt holds the lease; undefined when it is done or not the engine's to run. */
  claimExecution(id: string, at: string): Promise<(Job & { attempt: number }) | 'busy' | undefined>;
  completed(id: string, attempt: number, at: string): Promise<void>;
}
export interface People {
  /** Ids of the enabled people with an access grant and an identity binding: who the nightly scan runs for (D68). */
  granted(): Promise<string[]>;
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
