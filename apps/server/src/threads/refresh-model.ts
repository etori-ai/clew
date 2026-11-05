import type { AuthenticatedContext, Thread } from '@clew/contracts';
import type { ScanObservation } from '@clew/connectors';
import type { ThreadTx } from './model';
export interface RefreshRequest {
  id: string; personId: string; connector: string; assignment: string; authorizationVersion: string;
  state: string; attempt: number; requestedAt: string; nextAt: string; leaseUntil: string | null; lastSuccess: string | null; observedAt: string | null; error: string | null;
}
export interface Occurrence {
  id: string; personId: string; connector: string; assignment: string; sourceKey: string; period: string; revision: string;
  observedAt: string; sourceState: 'open' | 'resolved'; disposition: 'visible' | 'dismissed'; threadId: string | null; legacy: boolean;
}
export interface RefreshTx extends ThreadTx {
  lockRequest(id: string): Promise<RefreshRequest | undefined>;
  saveRequest(request: RefreshRequest): Promise<void>;
  occurrences(request: RefreshRequest): Promise<Occurrence[]>;
  saveOccurrence(occurrence: Occurrence): Promise<void>;
  /** Existing legacy cards and row versions are captured before source I/O. */
  findTopic(personId: string, connector: string, topic: string): Promise<Thread | undefined>;
}
export interface RefreshStore {
  request(request: RefreshRequest): Promise<void>;
  claim(now: string, leaseUntil: string): Promise<RefreshRequest | undefined>;
  baseline(request: RefreshRequest): Promise<Record<string, string>>;
  statuses(personId: string): Promise<RefreshRequest[]>;
  transaction<T>(fn: (tx: RefreshTx) => Promise<T>): Promise<T>;
}
export interface RefreshDeps {
  store: RefreshStore; clock: () => Date; ids: () => string; key(input: unknown): string;
  current(personId: string): Promise<AuthenticatedContext | undefined>;
  sources(persona: AuthenticatedContext): Promise<string[]>;
  scan(persona: AuthenticatedContext, connector: string): Promise<ScanObservation>;
}
/** Local presentation state is an optimistic fence, independent of source versions. */
export const projectionVersion = (t: Thread) => JSON.stringify([t.state, t.updatedAt, t.receipt, t.execution, t.snoozedUntil, t.items, t.waitingOn]);
