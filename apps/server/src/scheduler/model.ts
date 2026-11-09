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
export interface People {
  /** Ids of everyone with an access grant: who the nightly scan runs for. */
  granted(): Promise<string[]>;
  /** A system identity for one of them (`system-context.ts`), or undefined when the grant is gone. */
  personaFor(id: string): Promise<AuthenticatedContext | undefined>;
}
