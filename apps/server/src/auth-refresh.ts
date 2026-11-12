/**
 * Refreshing a session's IdP tokens (D26), pure over its deps so each kind of failure is unit-tested without an
 * identity provider; the live deps are wired in `auth.ts`. Only three things end the session: the provider's answer
 * that the grant is gone (`invalid_grant`), a refreshed ID token for another subject, and a session row that is gone
 * (and, as before, sealed tokens that can no longer be opened, which no refresh can use). A provider that cannot be
 * reached, times out, refuses the client (`invalid_client` after a secret rotation), limits the rate or fails keeps the
 * session and its tokens, because Clew's own authorization never reads them; until a refresh succeeds delegation has no
 * fresh token and answers 503 (L4 of the 2026-11-12 users review). No database connection is held while the provider
 * answers (L1): the row is read, the provider is asked, and the new tokens are stored only over the ones they were
 * refreshed from, so a refresh that another process made meanwhile wins and its tokens are used.
 */
import { ResponseBodyError } from 'openid-client';

export interface RefreshRow {
  digest: string;
  subject: string;
  tokens: string;
  tokenExpiresAt: Date;
}
export interface RefreshedTokens {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
  /** The `sub` of the refreshed ID token, when the provider sent one. */
  subject?: string;
}
export interface SealedTokens {
  access_token: string;
  refresh_token: string;
  id_token: string;
}
export interface RefreshDeps<Row extends RefreshRow> {
  clock: () => number;
  /** The session's row while it is active, else undefined. */
  read: (digest: string) => Promise<Row | undefined>;
  /** One refresh grant at the provider; throws its error answer or the failure to reach it. */
  grant: (refreshToken: string) => Promise<RefreshedTokens>;
  /** Whether a thrown error is the provider's answer that the grant is gone. */
  ended: (error: unknown) => boolean;
  /** Stores new tokens over `previous`; the stored row, or undefined when the row no longer holds `previous`. */
  store: (digest: string, previous: string, next: { tokens: string; tokenExpiresAt: Date }) => Promise<Row | undefined>;
  /** Ends the session with its authentication-log action, and forgets its delegated tokens. */
  end: (digest: string, action: 'refresh-failed' | 'expired') => Promise<void>;
  open: (sealed: string, digest: string) => SealedTokens;
  seal: (tokens: SealedTokens, digest: string) => string;
  /** A refresh the provider could not answer; the caller logs it. */
  failed: (error: unknown) => void;
}
/** `fresh`: the row's tokens are current. `unavailable`: the provider could not answer; the row is unchanged. */
export type Refreshed<Row> = { state: 'fresh'; row: Row } | { state: 'unavailable'; row: Row } | { state: 'ended' };
/**
 * The provider's answer that the refresh token, or the session behind it, is gone: the one answer that ends a session.
 */
export const grantEnded = (error: unknown) => error instanceof ResponseBodyError && error.error === 'invalid_grant';
/** A token is refreshed in its last seconds; its row's expiry is capped at 300 seconds when it is stored. */
const WINDOW_MS = 15_000;
/** After the provider could not answer, a session waits this long before asking again, so that an outage does not
 * hold every request for the provider's timeout. */
const RETRY_MS = 30_000;
export function sessionRefresher<Row extends RefreshRow>(deps: RefreshDeps<Row>) {
  // Requests of one session at the same moment share one refresh, as the row lock serialized them before.
  const inflight = new Map<string, Promise<Refreshed<Row>>>();
  const waiting = new Map<string, number>();
  function refresh(row: Row): Promise<Refreshed<Row>> {
    if (row.tokenExpiresAt.getTime() > deps.clock() + WINDOW_MS) return Promise.resolve({ state: 'fresh', row });
    let pending = inflight.get(row.digest);
    if (!pending) {
      pending = attempt(row.digest).finally(() => inflight.delete(row.digest));
      inflight.set(row.digest, pending);
    }
    return pending;
  }
  async function end(digest: string, action: 'refresh-failed' | 'expired'): Promise<Refreshed<Row>> {
    waiting.delete(digest);
    await deps.end(digest, action);
    return { state: 'ended' };
  }
  function wait(digest: string) {
    const now = deps.clock();
    for (const [key, until] of waiting) if (until <= now) waiting.delete(key);
    waiting.set(digest, now + RETRY_MS);
  }
  async function attempt(digest: string): Promise<Refreshed<Row>> {
    const current = await deps.read(digest);
    if (!current) return end(digest, 'expired');
    if (current.tokenExpiresAt.getTime() > deps.clock() + WINDOW_MS) return { state: 'fresh', row: current };
    if ((waiting.get(digest) ?? 0) > deps.clock()) return { state: 'unavailable', row: current };
    let previous: SealedTokens;
    try {
      previous = deps.open(current.tokens, digest);
    } catch {
      // Tokens that cannot be opened can never be refreshed.
      return end(digest, 'refresh-failed');
    }
    let tokens: RefreshedTokens;
    try {
      tokens = await deps.grant(previous.refresh_token);
    } catch (error) {
      if (!deps.ended(error)) {
        wait(digest);
        deps.failed(error);
        return { state: 'unavailable', row: current };
      }
      // A provider that refuses a refresh token's reuse answers so when another process refreshed with it first.
      const latest = await deps.read(digest);
      if (latest && latest.tokens !== current.tokens) return { state: 'fresh', row: latest };
      return end(digest, 'refresh-failed');
    }
    waiting.delete(digest);
    if (tokens.subject !== undefined && tokens.subject !== current.subject) return end(digest, 'refresh-failed');
    const stored = await deps.store(digest, current.tokens, {
      tokens: deps.seal(
        {
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token ?? previous.refresh_token,
          id_token: tokens.id_token ?? previous.id_token,
        },
        digest,
      ),
      tokenExpiresAt: new Date(deps.clock() + Math.min(tokens.expires_in ?? 60, 300) * 1000),
    });
    if (stored) return { state: 'fresh', row: stored };
    // Not stored: another process refreshed the row meanwhile, and its tokens stand, or the session ended.
    const latest = await deps.read(digest);
    return latest ? { state: 'fresh', row: latest } : end(digest, 'expired');
  }
  return { refresh };
}
