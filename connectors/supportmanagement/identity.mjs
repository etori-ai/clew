// Who the person is, proven by the identity provider and not by Clew. SupportManagement trusts whatever `X-Sent-By`
// says, so for an errand's owner this connector is where the token is checked: the signature against the provider's
// keys, the issuer, the audience and the expiry. A copy of the POB connector's: a connector imports nothing. Node only.
import { createPublicKey, verify } from 'node:crypto';

const b64 = value => Buffer.from(value, 'base64url');

/** The signing algorithms accepted, by the name a token's header gives. Chosen here, never by the token. */
const ALGORITHMS = { RS256: 'RSA-SHA256', RS384: 'RSA-SHA384', RS512: 'RSA-SHA512' };

/**
 * An account as it may be sent on to SupportManagement in `X-Sent-By` and a filter: letters, digits and `.` `_` `-`
 * `@`. Anything else is refused here and never reaches SupportManagement.
 */
export const ACCOUNT_PATTERN = /^[A-Za-z0-9._@-]{1,128}$/;

/** The claims of a token that this issuer signed for this audience and that has not expired; otherwise null. */
export function verifyPersonToken(token, jwks, { issuer, audience, now = Date.now() }) {
  try {
    const parts = String(token).split('.');
    if (parts.length !== 3) return null;
    const [h, p, signature] = parts;
    const header = JSON.parse(b64(h)),
      claims = JSON.parse(b64(p));
    const algorithm = Object.hasOwn(ALGORITHMS, header.alg) ? ALGORITHMS[header.alg] : undefined;
    if (!algorithm || typeof header.kid !== 'string') return null;
    const keys =
      jwks?.keys?.filter(
        k =>
          k.kty === 'RSA' &&
          k.kid === header.kid &&
          (k.use === undefined || k.use === 'sig') &&
          (k.alg === undefined || k.alg === header.alg) &&
          !k.d,
      ) ?? [];
    if (
      keys.length !== 1 ||
      !verify(algorithm, Buffer.from(h + '.' + p), createPublicKey({ key: keys[0], format: 'jwk' }), b64(signature))
    )
      return null;
    const seconds = now / 1000;
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (
      claims.iss !== issuer ||
      !audiences.includes(audience) ||
      !Number.isFinite(claims.exp) ||
      claims.exp <= seconds ||
      (Number.isFinite(claims.nbf) && claims.nbf > seconds + 5) ||
      (Number.isFinite(claims.iat) && claims.iat > seconds + 5)
    )
      return null;
    return claims;
  } catch {
    return null;
  }
}

const kidOf = token => {
  try {
    return JSON.parse(b64(String(token).split('.')[0])).kid;
  } catch {
    return undefined;
  }
};

/**
 * The check a request passes: `{ status: 'ok', claims }`, `{ status: 'refused' }` for a token that is not this
 * provider's for this audience, or `{ status: 'unavailable' }` when the keys cannot be fetched, since nothing is then
 * known about the token. `jwks` is a key set or a function answering one (tests); otherwise the keys are fetched from
 * `jwksUrl`, the one configured address, never from anything the token names, and kept for five minutes. A key id that
 * is not among them fetches again, at most once in ten seconds.
 */
export function createTokenVerifier({
  issuer,
  audience,
  jwks,
  jwksUrl,
  insecureHosts = ['localhost', '127.0.0.1'],
  fetch: fetchImpl = globalThis.fetch,
  now = () => Date.now(),
}) {
  let cached,
    until = 0,
    lastFetch = 0;
  async function keys(kid) {
    if (jwks) return typeof jwks === 'function' ? await jwks() : jwks;
    const unknownKey = !cached?.keys?.some(key => key.kid === kid);
    if (!cached || now() >= until || (unknownKey && now() - lastFetch >= 10_000)) {
      lastFetch = now();
      const url = new URL(jwksUrl);
      if (url.protocol !== 'https:' && !(url.protocol === 'http:' && insecureHosts.includes(url.hostname)))
        throw new Error('The key address must be https.');
      const response = await fetchImpl(url.toString(), { signal: AbortSignal.timeout(5000), redirect: 'error' });
      if (!response.ok) throw new Error('The keys could not be fetched.');
      cached = await response.json();
      until = now() + 300_000;
    }
    return cached;
  }
  return async token => {
    let set;
    try {
      set = await keys(kidOf(token));
    } catch {
      // Keys that were fetched before are still the provider's: an outage of the provider does not end the list.
      if (!cached) return { status: 'unavailable' };
      set = cached;
    }
    const claims = verifyPersonToken(token, set, { issuer, audience, now: now() });
    return claims ? { status: 'ok', claims } : { status: 'refused' };
  };
}
