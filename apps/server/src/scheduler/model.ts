import type { AuthenticatedContext } from '@clew/contracts';

/** The ports of the Postgres-backed scheduler (D15, D25): a claimable job queue and the people a nightly scan runs for. */
export interface Job {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
}
export interface JobQueue {
  /** One job due at or before `now`, claimed so no other process runs it; undefined when none is due. */
  claim(now: string): Promise<Job | undefined>;
  finish(id: string, error?: string): Promise<void>;
  /** Idempotent by job id. The job's durable workflow starts with the same commit (D86). */
  schedule(job: { id: string; kind: string; runAt: string; payload?: Record<string, unknown> }): Promise<void>;
}
/**
 * The engine's side of the job table (D47, D85): a job's `scheduledJob` workflow claims the row's execution under a
 * lease at the ledger's clock and completes it with its audit. The claim is `busy` before the row's run time or while
 * another claim holds the lease, and undefined for a row that is done or belongs to an old owner.
 */
export interface DurableJobs {
  claimExecution(id: string, at: string): Promise<(Job & { attempt: number }) | 'busy' | undefined>;
  /** Fenced by the claim's attempt, so a stale acknowledgement cannot complete a later claim. */
  completed(id: string, attempt: number, at: string): Promise<void>;
}
export interface People {
  /** Ids of the enabled people with an access grant and an identity binding: who the nightly scan runs for (D68). */
  granted(): Promise<string[]>;
  /** A system identity for one of them (`system-context.ts`), or undefined when the grant is gone. */
  personaFor(id: string): Promise<AuthenticatedContext | undefined>;
}
