/**
 * Refreshing a session's IdP tokens (D26), pure over its deps so each kind of failure is unit-tested without an
 * identity provider; the live deps are wired in `auth.ts`. Only these end the session: an answer that the grant is gone
 * or that only the person can go on (`grantEnded`), a refreshed ID token for another subject, and a session row that is
 * gone, an abandoned refresh claim, and sealed tokens that can no longer be opened. A provider that cannot
 * be reached, times out, refuses the client (`invalid_client` after a secret rotation), limits the rate or fails keeps
 * the session and its tokens, because Clew's own authorization never reads them; until a refresh succeeds delegation
 * has no fresh token and answers 503 (L4 of the 2026-11-12 users review). No database connection is held while the
 * provider answers (L1): a short database write claims the token generation before the provider is asked. Only that
 * claim may store its answer or end the session. Another process waits briefly, then uses the new tokens or withholds
 * delegation. An abandoned claim ends the session instead of replaying a possibly consumed refresh token. What a log line
 * says about a failure is here too: `failureOf` for a refresh or a token exchange, `failureDetails` for a sign-in or a
 * logout (L11), which never carries a value a statement was given.
 */
import {
  AuthorizationResponseError,
  ResponseBodyError,
  WWWAuthenticateChallengeError,
  refreshTokenGrant,
  type Configuration,
} from 'openid-client';

export interface RefreshRow {
  digest: string;
  subject: string;
  tokens: string;
  tokenExpiresAt: Date;
  refreshClaim: string | null;
  refreshClaimUntil: Date | null;
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
  /** Atomically claims this active token generation, only while no other process owns it. */
  claim: (digest: string, previous: string, claim: { id: string; until: Date }) => Promise<Row | undefined>;
  /** Releases this exact claim after a provider failure that returned no new tokens. */
  release: (digest: string, previous: string, claim: string) => Promise<void>;
  ids: () => string;
  /** One refresh grant at the provider (`refreshGrant`); throws its error answer or the failure to reach it. */
  grant: (refreshToken: string) => Promise<RefreshedTokens>;
  /** Whether a thrown error is the provider's answer that ends the session (`grantEnded`). */
  ended: (error: unknown) => boolean;
  /** Stores new tokens over `previous`; the stored row, or undefined when the row no longer holds `previous`. */
  store: (
    digest: string,
    previous: string,
    claim: string,
    next: { tokens: string; tokenExpiresAt: Date },
  ) => Promise<Row | undefined>;
  /** Ends the session with its authentication-log action, and forgets its delegated tokens. */
  end: (
    digest: string,
    action: 'refresh-failed' | 'expired',
    expected?: { tokens: string; claim: string | null },
  ) => Promise<boolean>;
  open: (sealed: string, digest: string) => SealedTokens;
  seal: (tokens: SealedTokens, digest: string) => string;
  /** Waits before the row is read once more (`setTimeout` in the server; a test decides what happens meanwhile). */
  sleep: (ms: number) => Promise<void>;
  /** A refresh the provider could not answer; the caller logs it (`failureOf`). */
  failed: (error: unknown) => void;
}
/** `fresh`: the row's tokens are current. `unavailable`: no fresh token yet, after provider failure or another owner. */
export type Refreshed<Row> = { state: 'fresh'; row: Row } | { state: 'unavailable'; row: Row } | { state: 'ended' };
/**
 * The provider's answers that end a session: the refresh token, or the session behind it, is gone (`invalid_grant`), or
 * only the person can go on, by signing in again (`interaction_required`, `login_required`, `consent_required`). Entra
 * ID answers `interaction_required` and `consent_required` at its token endpoint, for a Conditional Access policy or a
 * consent the refresh cannot satisfy, so asking again would never heal them.
 */
const ENDING = new Set(['invalid_grant', 'interaction_required', 'login_required', 'consent_required']);
export const grantEnded = (error: unknown) => error instanceof ResponseBodyError && ENDING.has(error.error);
/**
 * One refresh grant at the provider, as `RefreshDeps.grant` takes it: the tokens, and the `sub` of the refreshed ID
 * token when the provider sent one, which openid-client has verified (signature, issuer, audience and expiry).
 */
export function refreshGrant(configuration: () => Promise<Configuration>) {
  return async (refreshToken: string): Promise<RefreshedTokens> => {
    const tokens = await refreshTokenGrant(await configuration(), refreshToken);
    return {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      id_token: tokens.id_token,
      expires_in: tokens.expires_in,
      subject: tokens.claims()?.sub,
    };
  };
}
const codeOf = (value: unknown) =>
  value && typeof value === 'object' && 'code' in value && typeof value.code === 'string' ? value.code : undefined;
const statusOf = (value: unknown) =>
  value && typeof value === 'object' && 'status' in value && typeof value.status === 'number'
    ? value.status
    : undefined;
/** A code as a log line carries it: printable ASCII, at most 64 characters, since a provider's answer can say anything. */
const printable = (value: string) => value.replace(/[^\x21-\x7e]/g, '?').slice(0, 64);
/** The OAuth error the provider answered with: in a token endpoint's body, a callback's query or a challenge. */
const oauthErrorOf = (error: unknown) =>
  error instanceof ResponseBodyError || error instanceof AuthorizationResponseError
    ? error.error
    : error instanceof WWWAuthenticateChallengeError
      ? error.cause[0]?.parameters.error
      : undefined;
/**
 * What a log line may say about a failed call to the identity provider: the OAuth error of its answer, else
 * openid-client's code (`OAUTH_TIMEOUT`, `OAUTH_RESPONSE_IS_NOT_CONFORM`, ...), else the network's (`ECONNREFUSED`,
 * `ENOTFOUND`, `UND_ERR_CONNECT_TIMEOUT`: on fetch's error under Bun, on its cause under Node), else the error's name;
 * and the HTTP status when the provider answered. Never the error itself, whose cause can carry the provider's answer.
 */
export function failureOf(error: unknown): { code: string; status?: number } {
  const cause = error instanceof Error ? error.cause : undefined;
  const code =
    error instanceof ResponseBodyError
      ? error.error
      : (codeOf(error) ?? codeOf(cause) ?? (error instanceof Error ? error.name : 'unknown'));
  const status = statusOf(error) ?? statusOf(cause);
  return { code: printable(code), ...(status ? { status } : {}) };
}
/**
 * Whether an error's message can quote a value, so that a log line never carries it: a failed statement's
 * (drizzle-orm's `DrizzleQueryError`: `Failed query: <statement>\nparams: <every value it was given>`, such as the
 * subject and the user name a sign-in looks up) and PostgreSQL's own answer (postgres.js's `PostgresError`, as in
 * `invalid input syntax for type uuid: "<the value>"`). A failed connection names the address it tried, and the
 * driver's own errors their limit.
 */
const quotesValues = (error: Error, message: string) =>
  ('query' in error && 'params' in error) || message.startsWith('Failed query:') || error.name === 'PostgresError';
/** A message as a log line carries it: at most 300 characters, and none that can quote a value. */
const messageOf = (error: Error) => {
  const message = typeof error.message === 'string' ? error.message : '';
  return message && !quotesValues(error, message) ? message.slice(0, 300) : undefined;
};
/** An error's name, or its class's where the class leaves `name` as `Error` (drizzle-orm's `DrizzleQueryError` does). */
const nameOf = (error: Error) => {
  const name = String(error.name),
    kind: unknown = error.constructor === Error ? undefined : error.constructor?.name;
  return name === 'Error' && typeof kind === 'string' && kind ? kind : name;
};
/**
 * What the log line of a failed sign-in or logout says (L11 of the 2026-11-12 users review), so that the hosting and
 * identity provider teams can tell a wrong client secret, a wrong redirect address, a clock that is off, a refused
 * logout token and a database that failed apart: the error's name, its code (openid-client's, jose's, the network's,
 * PostgreSQL's SQLSTATE or Clew's own), the OAuth error the provider answered with and the HTTP status, and the messages
 * of the error and of its cause where a message cannot quote a value. openid-client's, jose's and Clew's own name a
 * claim or a parameter, never its value; a failed statement's and PostgreSQL's can (`quotesValues`), so a database
 * failure says its SQLSTATE, or its connection's code and message, and nothing of the statement. Never the error
 * itself, nor the provider's `error_description`: a failed claim check carries the ID token's claims in its cause, a
 * ResponseBodyError the provider's answer, jose's errors the logout token's payload, a failed statement the values it
 * was given, and a description can name the account.
 */
export function failureDetails(error: unknown) {
  const cause = error instanceof Error ? error.cause : undefined;
  const code = codeOf(error) ?? codeOf(cause),
    oauthError = oauthErrorOf(error),
    status = statusOf(error) ?? statusOf(cause),
    message = error instanceof Error ? messageOf(error) : undefined,
    because = cause instanceof Error ? messageOf(cause) : undefined;
  return {
    name: error instanceof Error ? printable(nameOf(error)) : typeof error,
    ...(code ? { code: printable(code) } : {}),
    ...(oauthError ? { oauthError: printable(oauthError) } : {}),
    ...(status ? { status } : {}),
    ...(message ? { message } : {}),
    ...(because ? { cause: because } : {}),
  };
}
/** A token is refreshed in its last seconds; its row's expiry is capped at 300 seconds when it is stored. */
const WINDOW_MS = 15_000;
/** After the provider could not answer, a session waits this long before asking again, so that an outage does not
 * hold every request for the provider's timeout. */
const RETRY_MS = 30_000;
/** The provider has a five-second deadline; an abandoned owner gets a bounded window to commit its answer. */
export const REFRESH_CLAIM_MS = 30_000;
/** A contending request waits once, then keeps local access and temporarily withholds delegation. */
const CONTENDED_WAIT_MS = 2_000;
export function sessionRefresher<Row extends RefreshRow>(deps: RefreshDeps<Row>) {
  // Coalesce within this process; the database claim also serializes independent BFFs.
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
  async function latest(digest: string): Promise<Refreshed<Row>> {
    const row = await deps.read(digest);
    if (!row) {
      waiting.delete(digest);
      // An idle/absolute expiry filters an otherwise open row out of read; keep its terminal audit as logout does.
      await deps.end(digest, 'expired');
      return { state: 'ended' };
    }
    return { state: row.tokenExpiresAt.getTime() > deps.clock() + WINDOW_MS ? 'fresh' : 'unavailable', row };
  }
  async function end(
    digest: string,
    action: 'refresh-failed' | 'expired',
    expected?: { tokens: string; claim: string | null },
  ): Promise<Refreshed<Row>> {
    waiting.delete(digest);
    return (await deps.end(digest, action, expected)) ? { state: 'ended' } : latest(digest);
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
    const claim = deps.ids();
    const owned = await deps.claim(digest, current.tokens, {
      id: claim,
      until: new Date(deps.clock() + REFRESH_CLAIM_MS),
    });
    if (!owned) {
      // A claim that outlived its owner may already have consumed the refresh token. Never take it over and replay.
      for (const pause of [0, CONTENDED_WAIT_MS]) {
        if (pause) await deps.sleep(pause);
        const row = await deps.read(digest);
        if (!row) return latest(digest);
        if (row.refreshClaim !== null && row.refreshClaimUntil && row.refreshClaimUntil.getTime() <= deps.clock())
          return end(digest, 'refresh-failed', { tokens: row.tokens, claim: row.refreshClaim });
        if (row.tokens !== current.tokens || row.refreshClaim === null)
          return { state: row.tokenExpiresAt.getTime() > deps.clock() + WINDOW_MS ? 'fresh' : 'unavailable', row };
      }
      return latest(digest);
    }
    const expected = { tokens: owned.tokens, claim };
    let previous: SealedTokens;
    try {
      previous = deps.open(owned.tokens, digest);
    } catch {
      // Tokens that cannot be opened can never be refreshed.
      return end(digest, 'refresh-failed', expected);
    }
    let tokens: RefreshedTokens;
    try {
      tokens = await deps.grant(previous.refresh_token);
    } catch (error) {
      if (!deps.ended(error)) {
        wait(digest);
        deps.failed(error);
        await deps.release(digest, owned.tokens, claim);
        return latest(digest);
      }
      return end(digest, 'refresh-failed', expected);
    }
    waiting.delete(digest);
    if (tokens.subject !== undefined && tokens.subject !== owned.subject)
      return end(digest, 'refresh-failed', expected);
    const stored = await deps.store(digest, owned.tokens, claim, {
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
    // Logout or another terminal update won. A database error above deliberately leaves the claim: a later request
    // ends an abandoned generation rather than resending a token the provider may have consumed.
    return latest(digest);
  }
  return { refresh };
}
