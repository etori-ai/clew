import type { AuthenticatedContext } from '@clew/contracts';
import type { ExecuteResult, WriteSafety } from '@clew/connectors';

export type ExecutionState = 'pending' | 'running' | 'succeeded' | 'partial' | 'failed' | 'unknown';
export type { WriteSafety };
/**
 * Payloads contain approved inputs only. Adapters encrypt them, and the two session bindings with them; a token is never
 * persisted. A binding names one of the person's own signed-in sessions (the session's digest, never its tokens), kept
 * only for a connector that acts as the person (D26): `approvingSession` is the session that approved the write and the
 * only one that may stand behind its dispatch or a replay; `checkingSession` is the latest session in which the person
 * asked to check a dispatched write again, and may stand behind its read-back only.
 */
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
  approvingSession: string | null;
  checkingSession: string | null;
}
export interface ExecutionAudit {
  actor: string;
  action: string;
  subject: string;
  at: string;
  details?: Record<string, unknown>;
}
/**
 * A durable workflow start committed with the intent it serves (D86): the registered workflow's name, its stable id
 * (`execution:<id>`, `reconcile:<id>:<attempt>`, `<watch intent id>:<generation>`) and one JSON input. The Postgres
 * adapter enqueues it on the transaction's own connection; the memory adapter records it for the unit tests.
 */
export interface WorkflowStart {
  workflow: string;
  id: string;
  input: unknown;
}

/**
 * A job (D55): one human approval over several steps, each one system's. An execute step is an ordinary execution row
 * with the decision key `<job decision>:<step>`, so dispatch, read-back, recovery and undo are unchanged. A watch step
 * writes nothing: a read repeated at committed absolute times until `expect` holds or the window ends. Steps are
 * independent; the job row only links them. The approval also commits one watch intent per watch step (D47: a row
 * with the absolute check times) and starts its `jobWatch` workflow in the same transaction (D86), which turns the
 * committed schedule into calls of `observe`, the fenced activity. A watch that ends without the fact being seen leaves a card for the person through `ExecutionTx.pushCard`.
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
 * The durable intent behind a watch step's timer (D47, D55 item 5): committed with the job, its `jobWatch` workflow
 * enqueued in the same transaction (D86). The check times are the step's own absolute times, so a late start never
 * extends the window. A step is approved once and never replaced, so its generation is 1; the fence per fire is the
 * check index and the step's state, in `observe`. The delivery columns are the retired outbox's; `deliveredAt` is the
 * commit that started the workflow.
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
  /** Keep the session in which the person asked to check an execution again (read-back only). Nothing the card shows changes, so nothing is projected. */
  keepCheckingSession(id: string, binding: string): Promise<void>;
  /** Start a durable workflow with this commit (D86): rolled back with it, dequeued by the engine once committed. Idempotent by workflow id. */
  enqueue(start: WorkflowStart): Promise<void>;
  audit(entry: ExecutionAudit): Promise<void>;
  /** Atomic uniqueness by (person, decision) for a job; returns the existing row on replay. */
  insertJob(job: Job): Promise<{ inserted: boolean; job: Job }>;
  lockJob(id: string): Promise<Job | undefined>;
  updateJob(job: Job): Promise<void>;
  /** The watch step's intent row, idempotent by id; the job row must already be in this transaction. Its workflow is a separate `enqueue`. */
  enqueueWatch(intent: WatchIntent): Promise<void>;
  /** Idempotent by card id. The adapter decides how a card is stored and announced; the use case decides that one is due. */
  pushCard(card: WatchCard): Promise<void>;
}
export interface ExecutionStore {
  readDecision(personId: string, decisionId: string): Promise<Execution | undefined>;
  read(id: string): Promise<Execution | undefined>;
  readJob(id: string): Promise<Job | undefined>;
  transaction<T>(fn: (tx: ExecutionTx) => Promise<T>): Promise<T>;
}
export interface ExecutionSource {
  /** `needsSession`: the connector acts as the person (D26), so one of their live sessions must stand behind dispatch and read-back. */
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
/** A signed-in session a binding names, while it is active: whose it is, and its delegate (D26). */
export interface StandingSession {
  personId: string;
  delegate: NonNullable<AuthenticatedContext['delegate']>;
}
/**
 * The person's own live session behind a write on a connector that acts as the person (D26). The use case decides which
 * kept binding may stand behind what, and that the session is the person's; the port only answers what a binding names now.
 */
export interface ExecutionSessions {
  /**
   * The session a binding names while it is active and still bound to its person; undefined once it ended, was revoked or
   * never was a session. Its delegate reads the session again on every call, so a session revoked after this answer yields
   * no further token. Never a stored token, a service credential or another binding's session.
   */
  find(binding: string): Promise<StandingSession | undefined>;
  /**
   * Obtain the token for the execution's connector through the persona's delegate before dispatch is recorded, so an
   * identity provider that cannot exchange one leaves the write undispatched rather than uncertain: false when the session
   * yields none (a session without IdP tokens), a throw when the identity provider cannot answer now. The token stays in
   * the session's short-lived cache for the call that follows; it is never returned or stored.
   */
  ready(persona: AuthenticatedContext, execution: Execution): Promise<boolean>;
}
export interface ExecutionDeps {
  review?: (persona: AuthenticatedContext, operation: string, payload: unknown) => Promise<void>;
  store: ExecutionStore;
  source: ExecutionSource;
  /** Absent: no session can stand behind delegated work, which then stays pending with `needs-session`. */
  sessions?: ExecutionSessions;
  watch?: WatchSource;
  clock: () => Date;
  ids: () => string;
  digest: (input: unknown) => string;
}
export class ExecutionError extends Error {}
