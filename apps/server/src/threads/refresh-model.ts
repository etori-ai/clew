import type { AuthenticatedContext, Thread } from '@clew/contracts';
import type { ScanObservation } from '@clew/connectors';
import type { PersonKeys, ThreadTx } from './model';
export interface RefreshRequest {
  id: string;
  personId: string;
  connector: string;
  assignment: string;
  authorizationVersion: string;
  state: string;
  attempt: number;
  requestedAt: string;
  nextAt: string;
  leaseUntil: string | null;
  lastSuccess: string | null;
  observedAt: string | null;
  error: string | null;
  /**
   * The binding of the signed-in session that last asked for this refresh (D26): what a scan of a connector that acts as
   * the person runs with while that session is active. A session's digest, never its tokens; the adapter seals it. Null
   * when no session stands behind the request.
   */
  session: string | null;
}
export interface Occurrence {
  id: string;
  personId: string;
  connector: string;
  assignment: string;
  sourceKey: string;
  period: string;
  revision: string;
  observedAt: string;
  sourceState: 'open' | 'resolved';
  disposition: 'visible' | 'dismissed';
  threadId: string | null;
  legacy: boolean;
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
  /** Coalesce a request into the stored one by `requestChange`, with its `refresh.requested` audit row when it changes anything. */
  request(request: RefreshRequest): Promise<void>;
  claim(now: string, leaseUntil: string): Promise<RefreshRequest | undefined>;
  baseline(request: RefreshRequest): Promise<Record<string, string>>;
  statuses(personId: string): Promise<RefreshRequest[]>;
  transaction<T>(fn: (tx: RefreshTx) => Promise<T>): Promise<T>;
}
/** A signed-in session a binding names, while it is active: whose it is, when its person was last active in it, and its delegate (D26). */
export interface StandingSession {
  personId: string;
  /** Sign-in or the last activity the page reported (`POST /api/auth/activity`), ISO time. */
  lastActiveAt: string;
  delegate: NonNullable<AuthenticatedContext['delegate']>;
}
/**
 * How recently the person must have been active in the session that asked for a scan for it to stand behind the scan of
 * a connector that acts as them (D26, D100: work reaches a person through an open page). The page reports activity at
 * most every 30 seconds on a key, pointer, wheel or touch event while it is visible (`packages/ui/src/session.tsx`); a
 * session's idle limit is eight hours, the same as its absolute one, so without this bound a kept session would be
 * scanned as the person every minute for hours after the tab was closed. Fifteen minutes is far longer than the
 * reporting interval of someone using the page and short enough to mean "here". Writes have no such bound: an approval
 * is the person's own act.
 */
export const PRESENCE_MS = 15 * 60_000;
export interface RefreshDeps {
  store: RefreshStore;
  clock: () => Date;
  ids: () => string;
  key(input: unknown): string;
  current(personId: string): Promise<AuthenticatedContext | undefined>;
  sources(persona: AuthenticatedContext): Promise<string[]>;
  /** The system's word on a card's trigger ("Ekonomisystemet"); the id stays on the thread's `connector`. */
  system(connector: string): string;
  scan(persona: AuthenticatedContext, connector: string): Promise<ScanObservation>;
  /**
   * The session a kept binding names while it is active and still bound to its person (D26); undefined once it ended or
   * was revoked. Its delegate reads the session again on every call; the use case also requires its person to have been
   * active in it within `PRESENCE_MS`. Absent: no session stands behind a scan, and a connector that acts as the person
   * answers `authorization-required`, as it did before.
   */
  session?: (binding: string) => Promise<StandingSession | undefined>;
  /** Whose a source's key is (D119): a row that names a person by user name names them by id. Absent: by nobody. */
  people?: PersonKeys;
}
/** Local presentation state is an optimistic fence, independent of source versions. */
export const projectionVersion = (t: Thread) =>
  JSON.stringify([t.state, t.updatedAt, t.receipt, t.execution, t.snoozedUntil, t.items, t.waitingOn]);
/**
 * What a new request does to the stored one for the same person, source, assignment and authority (D47, D26), the same
 * in every adapter: the request itself when none is stored; a requeue when the last scan has settled and either its
 * minute has passed, another session asks, or a session asks for a scan that was blocked for want of one (no session, or
 * its person away): that is the person back, so the requeue is at once and clears the block's error, which said nothing
 * about the source. Only the new binding when another session asks while a scan is queued or running; nothing otherwise.
 * A request without a session (the nightly scan) never replaces a binding, but the scan it queues has none behind it, so
 * a requeue it makes clears it.
 */
export function requestChange(stored: RefreshRequest | undefined, next: RefreshRequest): RefreshRequest | undefined {
  if (!stored) return next;
  const settled = ['complete', 'failed', 'blocked'].includes(stored.state);
  const rebound = next.session !== null && next.session !== stored.session;
  const back = next.session !== null && stored.state === 'blocked';
  if (settled && (stored.nextAt <= next.requestedAt || rebound || back))
    return {
      ...stored,
      state: 'pending',
      requestedAt: next.requestedAt,
      nextAt: next.nextAt,
      session: next.session,
      ...(back ? { error: null } : {}),
    };
  return rebound ? { ...stored, session: next.session } : undefined;
}
