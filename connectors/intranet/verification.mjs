// Protocol 3 verifier. No Clew packages or private signing material are needed.
import { createHash, createPublicKey, verify, timingSafeEqual } from 'node:crypto';
export const b64 = value => Buffer.from(value, 'base64url');
/** SHA-256 of the exact request body, base64url: what Clew signs as the assertion's `body` claim (D117). */
export const bodyDigest = text => createHash('sha256').update(text, 'utf8').digest('base64url');
/**
 * The two routes an assertion names a capability on, exactly as Clew posts them: `/clew/capabilities/<name>` for a
 * person's call (D117) and `/clew/installation/<name>` for a read Clew makes as the installation itself (D119), at the
 * start of the request's path and with nothing after the name. A connector served under a path prefix hands the
 * verifier a request whose URL has the prefix taken off.
 */
const ROUTE = /^\/clew\/(capabilities|installation)\/([^/]+)$/;
const ROUTES = ['/clew/capabilities/', '/clew/installation/'];
/** The subject and the `caller` claim of the installation's own assertion (D119): never a person's. */
export const INSTALLATION_SUBJECT = 'clew:installation';
export const INSTALLATION_CALLER = 'installation';
/**
 * What a request binds an assertion to (D117): the digest of its exact body and, on a capability's route or an
 * installation read's (D119), the name in the route and which of the two routes it is. A path that names one of them
 * anywhere but exactly (nested, prefixed, with more after the name) binds to nothing an assertion can match. Reads a
 * clone, so the handler can still read the body after verifying.
 */
export async function bindingOf(request) {
  const path = new URL(request.url).pathname;
  const body = bodyDigest(await request.clone().text());
  const route = ROUTE.exec(path);
  if (route)
    try {
      return { body, capability: decodeURIComponent(route[2]), route: route[1] };
    } catch {
      return { body, capability: null };
    }
  return { body, capability: ROUTES.some(r => path.includes(r)) ? null : undefined };
}
/** The claims of an assertion Clew signed for this audience and that is still valid, or null. */
function verifiedClaims(token, jwks, audience, now) {
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;
  const [h, p, signature] = parts;
  const header = JSON.parse(b64(h)),
    claims = JSON.parse(b64(p));
  if (header.alg !== 'RS256' || header.typ !== 'JWT' || typeof header.kid !== 'string') return null;
  const keys =
    jwks?.keys?.filter(k => k.kty === 'RSA' && k.kid === header.kid && k.alg === 'RS256' && k.use === 'sig' && !k.d) ??
    [];
  if (
    keys.length !== 1 ||
    !verify('RSA-SHA256', Buffer.from(h + '.' + p), createPublicKey({ key: keys[0], format: 'jwk' }), b64(signature))
  )
    return null;
  const seconds = now / 1000;
  if (
    !claims ||
    typeof claims !== 'object' ||
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
  return claims;
}
/**
 * The verified actor, or null. With `binding`, the assertion must have been issued for exactly that request: its
 * `body` claim the digest of the body received, and its `capability` claim the capability of the route (absent on any
 * other route). The body's `input` and `about` are then Clew's, and an assertion cannot be replayed with another body.
 * The installation's own assertion (D119) is never a person's: it has no actor, and is refused here.
 */
export function verifyAssertion(token, jwks, audience, now = Date.now(), binding) {
  try {
    const claims = verifiedClaims(token, jwks, audience, now);
    if (!claims || claims.caller !== undefined) return null;
    const actor = claims.actor;
    if (
      !actor ||
      actor.id !== claims.sub ||
      !['id', 'name', 'unitId', 'unitLabel'].every(k => typeof actor[k] === 'string') ||
      !['manager', 'employee'].includes(actor.role)
    )
      return null;
    // A person's assertion is never valid on the installation's route, whatever it names (D119).
    if (
      binding &&
      (claims.body !== binding.body ||
        (claims.capability ?? undefined) !== binding.capability ||
        binding.route === 'installation')
    )
      return null;
    return actor;
  } catch {
    return null;
  }
}
/**
 * Whether the assertion is the installation's own, for exactly this request (D119): Clew reading as itself, with no
 * person behind the call. Its subject is `clew:installation`, its `caller` claim `installation`, it carries no `actor`
 * and no `callback`, and it is bound to the request: `binding` is required, and its `body` and `capability` must match.
 * A person's assertion, however valid, is never the installation's.
 */
export function verifyInstallationAssertion(token, jwks, audience, now = Date.now(), binding) {
  try {
    // Only on the installation's own route: the same assertion presented on a person's route is refused.
    if (
      !binding ||
      typeof binding.body !== 'string' ||
      typeof binding.capability !== 'string' ||
      binding.route !== 'installation'
    )
      return false;
    const claims = verifiedClaims(token, jwks, audience, now);
    return (
      !!claims &&
      claims.caller === INSTALLATION_CALLER &&
      claims.sub === INSTALLATION_SUBJECT &&
      claims.actor === undefined &&
      claims.callback === undefined &&
      claims.body === binding.body &&
      claims.capability === binding.capability
    );
  } catch {
    return false;
  }
}
/**
 * The verifier a connector calls on every request: `verify(token, key, request)` is the person behind it, or null;
 * `verify.installation(token, key, request)` is whether the installation itself sent it (D119). Each refuses the other.
 */
export function createVerifier(
  { secret, jwks, clewUrl = process.env.CLEW_URL ?? '', fetch: fetchImpl = globalThis.fetch },
  audience,
) {
  let cached,
    until = 0,
    lastFetch = 0;
  const transport = suppliedKey => {
    const expected = Buffer.from(secret ?? ''),
      supplied = Buffer.from(suppliedKey ?? '');
    return expected.length > 0 && expected.length === supplied.length && timingSafeEqual(expected, supplied);
  };
  /** The installation's public keys: the ones given, or fetched from the configured Clew URL and kept a minute. */
  const keysFor = async token => {
    if (jwks) return typeof jwks === 'function' ? await jwks() : jwks;
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
      if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', 'clew-app-1', 'app', 'clew'].includes(url.hostname))
        return null;
      const response = await fetchImpl(url.toString(), { signal: AbortSignal.timeout(5000), redirect: 'error' });
      if (!response.ok) return null;
      cached = await response.json();
      until = Date.now() + 60_000;
    }
    return cached;
  };
  // Pass the incoming request to bind the assertion to it (D117); every connector in this repository does.
  const verifier = async (token, suppliedKey, request) => {
    try {
      if (!transport(suppliedKey)) return null;
      const binding = request ? await bindingOf(request) : undefined;
      const keys = await keysFor(token);
      return keys ? verifyAssertion(token, keys, audience, Date.now(), binding) : null;
    } catch {
      return null;
    }
  };
  // The installation's own call (D119): only with the request, which the assertion must be bound to.
  verifier.installation = async (token, suppliedKey, request) => {
    try {
      if (!request || !transport(suppliedKey)) return false;
      const binding = await bindingOf(request);
      const keys = await keysFor(token);
      return keys ? verifyInstallationAssertion(token, keys, audience, Date.now(), binding) : false;
    } catch {
      return false;
    }
  };
  return verifier;
}
export function callbackFor(token) {
  try {
    const claims = JSON.parse(b64(String(token).split('.')[1]));
    return typeof claims.callback === 'string' ? claims.callback : '';
  } catch {
    return '';
  }
}
