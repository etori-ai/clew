import type { AuthenticatedContext } from '@clew/contracts';
import type { ExecuteResult, WriteSafety } from '@clew/connectors';

export type ExecutionState = 'pending' | 'running' | 'succeeded' | 'partial' | 'failed' | 'unknown';
export type { WriteSafety };
/** Payloads contain approved inputs only. Adapters encrypt them; tokens and sessions are never persisted. */
export interface Execution {
  presentation?: { threadId: string; version: string; actionId: string } | null;
  id: string; decisionId: string; personId: string; principal: string; unitId: string; authorizationVersion: string;
  connector: string; operation: string; digest: string; payload: unknown; safety: WriteSafety;
  state: ExecutionState; reason: string | null; result: ExecuteResult | null; compensates: string | null;
  createdAt: string; expiresAt: string; updatedAt: string; dispatchedAt: string | null;
  attempt: number; leaseUntil: string | null;
}
export interface ExecutionAudit { actor: string; action: string; subject: string; at: string; details?: Record<string, unknown> }
export interface DispatchIntent { id: string; executionId: string; attempt: number; leaseUntil: string | null; nextAt: string; deliveredAt: string | null; lastError: string | null }
export interface ExecutionTx {
  /** Atomic uniqueness by (person, decision); returns the existing row on replay. */
  insert(execution: Execution): Promise<{ inserted: boolean; execution: Execution }>;
  lock(id: string): Promise<Execution | undefined>;
  update(execution: Execution): Promise<void>;
  enqueue(intent: DispatchIntent): Promise<void>;
  audit(entry: ExecutionAudit): Promise<void>;
}
export interface ExecutionStore {
  read(id: string): Promise<Execution | undefined>;
  transaction<T>(fn: (tx: ExecutionTx) => Promise<T>): Promise<T>;
  /** Bounded durable delivery lease; failure or crash makes it eligible again. */
  claimDispatch(now: string, until: string): Promise<DispatchIntent | undefined>;
  finishDispatch(id: string, attempt: number, now: string, retryAt: string, error?: string): Promise<void>;
}
export interface ExecutionSource {
  authorize(persona: AuthenticatedContext, operation: string, input: unknown): Promise<{ connector: string; safety: WriteSafety; needsSession: boolean }>;
  current(personId: string): Promise<AuthenticatedContext | undefined>;
  execute(persona: AuthenticatedContext, execution: Execution): Promise<ExecuteResult>;
  /** undefined proves absence only for the declared source lookup contract; throw means unknown. */
  lookup(persona: AuthenticatedContext, execution: Execution): Promise<ExecuteResult | undefined>;
}
export interface ExecutionDeps { store: ExecutionStore; source: ExecutionSource; clock: () => Date; ids: () => string; digest: (input: unknown) => string }
export class ExecutionError extends Error {}
