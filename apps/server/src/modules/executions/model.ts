import type { AuthenticatedContext } from '@clew/contracts';
import type { ExecuteResult, WriteSafety } from '@clew/connectors';

export type ExecutionState = 'pending' | 'running' | 'succeeded' | 'partial' | 'failed' | 'unknown';
export type { WriteSafety };
/** Payloads contain approved inputs only. Adapters encrypt them; tokens and sessions are never persisted. */
export interface Execution {
  presentation?: { threadId: string; version: string; actionId: string; newTitle?: string } | null;
  id: string;
  decisionId: string;
  personId: string;
  principal: string;
  unitId: string;
  authorizationVersion: string;
  connector: string;
  operation: string;
  digest: string;
  payload: unknown;
  safety: WriteSafety;
  state: ExecutionState;
  reason: string | null;
  result: ExecuteResult | null;
  compensates: string | null;
  createdAt: string;
  expiresAt: string;
  updatedAt: string;
  dispatchedAt: string | null;
  attempt: number;
  leaseUntil: string | null;
}
export interface ExecutionAudit {
  actor: string;
  action: string;
  subject: string;
  at: string;
  details?: Record<string, unknown>;
}
export interface DispatchIntent {
  id: string;
  executionId: string;
  attempt: number;
  leaseUntil: string | null;
  nextAt: string;
  deliveredAt: string | null;
  lastError: string | null;
}

/**
 * A job (D55): one human approval over several steps, each one system's. An execute step is an ordinary execution row
 * with the decision key `<job decision>:<step>`, so dispatch, read-back, recovery and undo are unchanged. A watch step
 * writes nothing: a read repeated at committed absolute times until `expect` holds or the window ends. Steps are
 * independent; the job row only links them. Timers for watches are a later wiring; `observe` is the fenced activity.
 */
export type WatchExpect = { path: string[]; equals: unknown };
export type WatchState = 'waiting' | 'seen' | 'expired' | 'blocked';
export interface WatchObservation {
  check: number;
  at: string;
  seen: boolean;
  error?: string;
}
export type JobStepInput =
  | { id: string; kind: 'execute'; operation: string; payload: unknown }
  | {
      id: string;
      kind: 'watch';
      operation: string;
      input: unknown;
      expect: WatchExpect;
      checks: string[];
      expiresAt: string;
    };
export type JobStep =
  | { id: string; kind: 'execute'; connector: string; operation: string; executionId: string }
  | {
      id: string;
      kind: 'watch';
      connector: string;
      operation: string;
      input: unknown;
      expect: WatchExpect;
      checks: string[];
      expiresAt: string;
      state: WatchState;
      reason: string | null;
      observations: WatchObservation[];
    };
export interface Job {
  id: string;
  decisionId: string;
  personId: string;
  principal: string;
  unitId: string;
  authorizationVersion: string;
  digest: string;
  steps: JobStep[];
  createdAt: string;
  updatedAt: string;
}
export interface JobInput {
  decisionId: string;
  steps: JobStepInput[];
}

export interface ExecutionTx {
  /** Atomic uniqueness by (person, decision); returns the existing row on replay. */
  insert(execution: Execution): Promise<{ inserted: boolean; execution: Execution }>;
  lock(id: string): Promise<Execution | undefined>;
  update(execution: Execution): Promise<void>;
  enqueue(intent: DispatchIntent): Promise<void>;
  audit(entry: ExecutionAudit): Promise<void>;
  /** Atomic uniqueness by (person, decision) for a job; returns the existing row on replay. */
  insertJob(job: Job): Promise<{ inserted: boolean; job: Job }>;
  lockJob(id: string): Promise<Job | undefined>;
  updateJob(job: Job): Promise<void>;
}
export interface ExecutionStore {
  readDecision(personId: string, decisionId: string): Promise<Execution | undefined>;
  read(id: string): Promise<Execution | undefined>;
  readJob(id: string): Promise<Job | undefined>;
  transaction<T>(fn: (tx: ExecutionTx) => Promise<T>): Promise<T>;
  /** Bounded durable delivery lease; failure or crash makes it eligible again. */
  claimDispatch(now: string, until: string): Promise<DispatchIntent | undefined>;
  finishDispatch(id: string, attempt: number, now: string, retryAt: string, error?: string): Promise<void>;
}
export interface ExecutionSource {
  authorize(
    persona: AuthenticatedContext,
    operation: string,
    input: unknown,
  ): Promise<{ connector: string; safety: WriteSafety; needsSession: boolean }>;
  current(personId: string): Promise<AuthenticatedContext | undefined>;
  execute(persona: AuthenticatedContext, execution: Execution): Promise<ExecuteResult>;
  /** undefined proves absence only for the declared source lookup contract; throw means unknown. */
  lookup(persona: AuthenticatedContext, execution: Execution): Promise<ExecuteResult | undefined>;
}
/** The read behind a watch step (D55): a `read` of the step's own connector, run as the person, never an execute. */
export interface WatchSource {
  authorize(persona: AuthenticatedContext, operation: string, input: unknown): Promise<{ connector: string }>;
  read(persona: AuthenticatedContext, operation: string, input: unknown): Promise<unknown>;
}
export interface ExecutionDeps {
  store: ExecutionStore;
  source: ExecutionSource;
  watch?: WatchSource;
  clock: () => Date;
  ids: () => string;
  digest: (input: unknown) => string;
}
export class ExecutionError extends Error {}
