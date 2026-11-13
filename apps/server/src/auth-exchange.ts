/**
 * RFC 8693 token exchange behind a per-session, per-audience cache (D26): a connector that acts as the person gets a
 * token bound to its own audience, never the session's. Pure over its deps so it is unit-tested without Keycloak; the
 * live `subjectToken` and `exchange` are wired in `auth.ts`.
 */
export interface ExchangeDeps {
  /** The session's current (refreshed) IdP access token, or undefined for a session that holds none (a dev session, D6). */
  subjectToken: (digest: string) => Promise<string | undefined>;
  /** One call to the IdP's token endpoint. Throws when the IdP refuses or is away. */
  exchange: (subjectToken: string, audience: string) => Promise<{ access_token: string; expires_in?: number }>;
  clock: () => number;
  /** Milliseconds of remaining life under which a cached token is not reused. */
  marginMs?: number;
}
const AUDIENCE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;
/** An exchanged token never outlives this, whatever the IdP says, so a revoked session stops reaching the connector soon. */
const MAX_LIFE_S = 300;
export function delegationFor(deps: ExchangeDeps) {
  type Exchanged = { token: string; expiresAt: number };
  const cache = new Map<string, Exchanged | Promise<Exchanged>>();
  const margin = deps.marginMs ?? 10_000;
  /** The token for one session and audience, exchanged once and shared by every call in flight; undefined when the session has no IdP token. */
  async function token(digest: string, audience: string): Promise<string | undefined> {
    if (!AUDIENCE.test(audience)) throw new Error('Invalid delegation audience');
    // A cached exchange still needs a live session whose provider token can be refreshed.
    const subject = await deps.subjectToken(digest);
    if (!subject) return undefined;
    const key = digest + '\0' + audience;
    const cached = cache.get(key);
    if (cached instanceof Promise) return (await cached).token;
    if (cached && cached.expiresAt > deps.clock() + margin) return cached.token;
    const pending = deps.exchange(subject, audience).then(r => ({
      token: r.access_token,
      expiresAt: deps.clock() + Math.min(r.expires_in ?? 60, MAX_LIFE_S) * 1000,
    }));
    cache.set(key, pending);
    try {
      const value = await pending;
      if (cache.get(key) === pending) cache.set(key, value);
      return value.token;
    } catch (e) {
      if (cache.get(key) === pending) cache.delete(key);
      throw e;
    }
  }
  /** Drop a session's tokens on logout or when refresh ends the session. */
  function forget(digest: string) {
    for (const k of cache.keys()) if (k.startsWith(digest + '\0')) cache.delete(k);
  }
  return { token, forget };
}
export type Delegation = ReturnType<typeof delegationFor>;
