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
 * independent; the job row only links them. The approval also commits one watch intent per watch step (D47: an outbox
 * row with the absolute check times), which Temporal's `jobWatch` workflow turns into calls of `observe`, the fenced
 * activity. A watch that ends without the fact being seen leaves a card for the person through `ExecutionTx.pushCard`.
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
      /** The follower's Swedish title and its system's label, as the person approved them: what the card at the window's end names. */ title: string;
      source: string;
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
      title: string;
      source: string;
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
  /** Internal origin of relative watch schedules, never supplied by the approval HTTP body. */
  scheduleOrigin?: string;
  decisionId: string;
  steps: JobStepInput[];
}
/**
 * The durable intent behind a watch step's timer (D47, D55 item 5): committed with the job, delivered once to the
 * workflow engine by the outbox dispatcher, retried on a lease. The check times are the step's own absolute times, so a
 * late delivery never extends the window. A step is approved once and never replaced, so its generation is 1; the
 * fence per fire is the check index and the step's state, in `observe`.
 */
export interface WatchIntent {
  id: string;
  jobId: string;
  stepId: string;
  personId: string;
  generation: number;
  checks: string[];
  expiresAt: string;
  attempt: number;
  leaseUntil: string | null;
  nextAt: string;
  deliveredAt: string | null;
  lastError: string | null;
}
/** The card a watch leaves when its window ends unseen (D55 item 5): the stream admits it like any pushed card (D47), in the same transaction as the step's settlement. */
export interface WatchCard {
  sourceAuthorization: string;
  id: string;
  personId: string;
  jobId: string;
  stepId: string;
  connector: string;
  topic: string;
  title: string;
  summary: string;
  reason: string;
  at: string;
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
  /** Idempotent by id; the job row must already be in this transaction. */
  enqueueWatch(intent: WatchIntent): Promise<void>;
  /** Idempotent by card id. The adapter decides how a card is stored and announced; the use case decides that one is due. */
  pushCard(card: WatchCard): Promise<void>;
}
export interface ExecutionStore {
  readDecision(personId: string, decisionId: string): Promise<Execution | undefined>;
  read(id: string): Promise<Execution | undefined>;
  readJob(id: string): Promise<Job | undefined>;
  transaction<T>(fn: (tx: ExecutionTx) => Promise<T>): Promise<T>;
  /** Bounded durable delivery lease; failure or crash makes it eligible again. */
  claimDispatch(now: string, until: string): Promise<DispatchIntent | undefined>;
  finishDispatch(id: string, attempt: number, now: string, retryAt: string, error?: string): Promise<void>;
  /** The same lease for watch intents: one delivery of the step's committed schedule to the workflow engine. */
  claimWatch(now: string, until: string): Promise<WatchIntent | undefined>;
  finishWatch(id: string, attempt: number, now: string, retryAt: string, error?: string): Promise<void>;
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
