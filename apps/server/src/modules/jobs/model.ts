import type { AuthenticatedContext } from '@clew/contracts';
import type { Actor, FollowerRef } from '@clew/connectors';
import type { FollowBinding } from './contracts';

/** The ports of the jobs module (D25). The registry's followers and offers come in as functions, the ledger as a port, so no module imports another (D20). */
export type Followers = (actor: Actor, kind: string) => FollowerRef[];
export type Offered = (kind: string) => boolean;
export type JobCall = <O = unknown>(name: string, input?: unknown) => Promise<O>;
export interface BindingAudit {
  actor: string;
  action: string;
  subject: string;
  at: string;
  details?: Record<string, unknown>;
}
export interface BindingTx {
  upsert(binding: FollowBinding): Promise<void>;
  remove(id: string): Promise<void>;
  audit(entry: BindingAudit): Promise<void>;
}
export interface FollowBindingStore {
  list(kind?: string): Promise<FollowBinding[]>;
  read(id: string): Promise<FollowBinding | undefined>;
  transaction<T>(fn: (tx: BindingTx) => Promise<T>): Promise<T>;
}
/** What the ledger takes for one approval over several steps; structurally the executions module's `JobInput`, paired in composition. */
export type LedgerStep =
  | { id: string; kind: 'execute'; operation: string; payload: unknown }
  | {
      id: string;
      kind: 'watch';
      operation: string;
      input: unknown;
      expect: { path: string[]; equals: unknown };
      checks: string[];
      expiresAt: string;
      title: string;
      source: string;
    };
export interface JobLedger {
  approveJob(persona: AuthenticatedContext, input: { decisionId: string; steps: LedgerStep[] }): Promise<unknown>;
}
export interface JobBudget {
  perSourceMs: number;
  totalMs: number;
}
export interface JobDeps {
  bindings: FollowBindingStore;
  followers: Followers;
  offered: Offered;
  ledger: JobLedger;
  clock: () => Date;
  ids: () => string;
  budget?: Partial<JobBudget>;
}
export const DEFAULT_BUDGET: JobBudget = { perSourceMs: 3_000, totalMs: 4_000 };
