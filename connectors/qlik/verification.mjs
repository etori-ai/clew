// Protocol v2 verifier. No Clew packages or private signing material are needed.
import { createPublicKey, verify, timingSafeEqual } from 'node:crypto';
export const b64 = value => Buffer.from(value, 'base64url');
export function verifyAssertion(token, jwks, audience, now = Date.now()) {
  try {
    const parts = String(token).split('.');
    if (parts.length !== 3) return null;
    const [h, p, signature] = parts;
    const header = JSON.parse(b64(h)),
      claims = JSON.parse(b64(p));
    if (header.alg !== 'RS256' || header.typ !== 'JWT' || typeof header.kid !== 'string') return null;
    const keys =
      jwks?.keys?.filter(
        k => k.kty === 'RSA' && k.kid === header.kid && k.alg === 'RS256' && k.use === 'sig' && !k.d,
      ) ?? [];
    if (
      keys.length !== 1 ||
      !verify('RSA-SHA256', Buffer.from(h + '.' + p), createPublicKey({ key: keys[0], format: 'jwk' }), b64(signature))
    )
      return null;
    const seconds = now / 1000;
    if (
      claims.iss !== 'clew' ||
      claims.aud !== audience ||
      !Number.isFinite(claims.exp) ||
      !Number.isFinite(claims.iat) ||
      claims.exp <= seconds ||
      claims.iat > seconds + 5 ||
      claims.exp - claims.iat > 120 ||
      typeof claims.jti !== 'string'
    )
      return null;
    const actor = claims.actor;
    if (
      !actor ||
      actor.id !== claims.sub ||
      !['id', 'name', 'unitId', 'unitLabel'].every(k => typeof actor[k] === 'string') ||
      !['manager', 'employee'].includes(actor.role)
    )
      return null;
    return actor;
  } catch {
    return null;
  }
}
export function createVerifier(
  { secret, jwks, clewUrl = process.env.CLEW_URL ?? '', fetch: fetchImpl = globalThis.fetch },
  audience,
) {
  let cached,
    until = 0,
    lastFetch = 0;
  return async (token, suppliedKey) => {
    try {
      const expected = Buffer.from(secret ?? ''),
        supplied = Buffer.from(suppliedKey ?? '');
      if (!expected.length || expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
      if (jwks) return verifyAssertion(token, typeof jwks === 'function' ? await jwks() : jwks, audience);
      let kid;
      try {
        kid = JSON.parse(b64(String(token).split('.')[0])).kid;
      } catch {
        return null;
      }
      const unknownKey = !cached?.keys?.some(key => key.kid === kid);
      if (!cached || Date.now() >= until || (unknownKey && Date.now() - lastFetch >= 1000)) {
        lastFetch = Date.now();
        // The configured Clew URL is the trust anchor. Never use jku/x5u or any URL from the JWT.
        const url = new URL('/api/connectors/jwks', clewUrl);
        if (
          url.protocol !== 'https:' &&
          !['localhost', '127.0.0.1', 'clew-app-1', 'app', 'clew'].includes(url.hostname)
        )
          return null;
        const response = await fetchImpl(url.toString(), { signal: AbortSignal.timeout(5000), redirect: 'error' });
        if (!response.ok) return null;
        cached = await response.json();
        until = Date.now() + 60_000;
      }
      return verifyAssertion(token, cached, audience);
    } catch {
      return null;
    }
  };
}
export function callbackFor(token) {
  try {
    const claims = JSON.parse(b64(String(token).split('.')[1]));
    return typeof claims.callback === 'string' ? claims.callback : '';
  } catch {
    return '';
  }
}
