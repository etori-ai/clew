// Clew connector protocol verifier. No Clew packages or private signing material are needed.
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
/** The subject and the `caller` claim of the installation's own assertion (D119): never a person's. */
export const INSTALLATION_SUBJECT = 'clew:installation';
export const INSTALLATION_CALLER = 'installation';
/** The hosts of the development stack, the only ones Clew's keys are fetched from over plain http. */
const DEVELOPMENT_HOSTS = ['localhost', '127.0.0.1', 'clew-app-1', 'app', 'clew'];
/**
 * Where Clew's public keys are fetched: `/api/connectors/jwks` at the configured Clew URL, the trust anchor. https, or
 * plain http from a host of the development stack only; null for anything else, from which no key is ever fetched.
 * A connector's server.mjs refuses to start on null, so a wrong `CLEW_URL` is found at start, not as 401 on every call.
 */
export function keysAddress(clewUrl) {
  let url;
  try {
    url = new URL('/api/connectors/jwks', clewUrl);
  } catch {
    return null;
  }
  return url.protocol === 'https:' || (url.protocol === 'http:' && DEVELOPMENT_HOSTS.includes(url.hostname))
    ? url.toString()
    : null;
}
/**
 * What a request binds an assertion to (D117): the path it was posted to, the digest of its exact body, the operation
 * id it carries in `X-Clew-Operation-Id` (an approved write's), and, on a capability's route or an installation read's
 * (D119), the name in the route and which of the two routes it is. Clew signs the path it posts to as the `path` claim,
 * so an assertion holds on that one route: a scan's is refused on `/clew/figure`, and a connector that routes on less
 * than the exact path (by suffix or prefix, or one handler for several routes) still runs nothing an assertion was not
 * issued for. Reads a clone, so the handler can still read the body after verifying.
 */
export async function bindingOf(request) {
  const path = new URL(request.url).pathname;
  const body = bodyDigest(await request.clone().text());
  const operationId = request.headers.get('x-clew-operation-id') ?? undefined;
  const route = ROUTE.exec(path);
  if (route)
    try {
      return { path, body, operationId, capability: decodeURIComponent(route[2]), route: route[1] };
    } catch {
      return { path, body, operationId, capability: null };
    }
  return { path, body, operationId };
}
/** The claims of an assertion Clew signed for this audience and that is still valid at `now`, or null. */
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
 * Whether the assertion was issued for exactly this request: its `path` claim the path received, its `body` claim the
 * digest of the body received, its `capability` claim the capability of the route (absent on a route that names none)
 * and its `operationId` claim the request's `X-Clew-Operation-Id` (absent when it has none). Without a binding, false.
 */
function boundTo(claims, binding) {
  return (
    !!binding &&
    typeof binding.path === 'string' &&
    typeof binding.body === 'string' &&
    claims.path === binding.path &&
    claims.body === binding.body &&
    (claims.capability ?? undefined) === binding.capability &&
    (claims.operationId ?? undefined) === (binding.operationId ?? undefined)
  );
}
/**
 * The verified actor, or null. `binding` (`bindingOf(request)`) is required: the assertion must have been issued for
 * exactly that request, its path, its body, the capability of its route and its operation id, and without one nothing
 * verifies. The body's `input` and `about` are then Clew's, and an assertion cannot be replayed with another body, on
 * another route or capability, or as another operation. The installation's own assertion (D119) is never a person's:
 * it has no actor, and is refused here.
 */
export function verifyAssertion(token, jwks, audience, now, binding) {
  try {
    const claims = verifiedClaims(token, jwks, audience, now ?? Date.now());
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
    if (!boundTo(claims, binding) || binding.route === 'installation') return null;
    return actor;
  } catch {
    return null;
  }
}
/**
 * Whether the assertion is the installation's own, for exactly this request (D119): Clew reading as itself, with no
 * person behind the call. Its subject is `clew:installation`, its `caller` claim `installation`, it carries no `actor`
 * and no `callback`, and it is bound to the request as every assertion is: `binding` is required, on the installation's
 * route only, with no operation id on either. A person's assertion, however valid, is never the installation's.
 */
export function verifyInstallationAssertion(token, jwks, audience, now, binding) {
  try {
    // Only on the installation's own route: the same assertion presented on a person's route is refused.
    if (binding?.route !== 'installation' || typeof binding.capability !== 'string') return false;
    const claims = verifiedClaims(token, jwks, audience, now ?? Date.now());
    return (
      !!claims &&
      claims.caller === INSTALLATION_CALLER &&
      claims.sub === INSTALLATION_SUBJECT &&
      claims.actor === undefined &&
      claims.callback === undefined &&
      boundTo(claims, binding)
    );
  } catch {
    return false;
  }
}
/**
 * The verifier a connector calls on every request: `verify(token, key, request)` is the person behind it, or null;
 * `verify.installation(token, key, request)` is whether the installation itself sent it (D119). Each refuses the other,
 * and each refuses a call without the request, since there is then nothing to bind the assertion to. An assertion
 * verifies once: Clew signs one for every request it sends, so the same `jti` again is a copy, refused for as long as
 * the assertion would otherwise hold. The record is this process's: a connector that runs as several processes takes a
 * copy once in each, so one with manual writes runs as one process or shares the record (docs/guides/authorization.md).
 * An approved write's operation id is bound besides, so a copy that reaches another process cannot run as another
 * operation.
 */
export function createVerifier(
  { secret, jwks, clewUrl = process.env.CLEW_URL ?? '', fetch: fetchImpl = globalThis.fetch },
  audience,
) {
  let cached,
    until = 0,
    lastFetch = 0;
  // jti -> exp (seconds), oldest first: Clew signs every assertion for the same two minutes, so the ones that have run out
  // are at the front and are dropped as each new one is recorded.
  const used = new Map();
  /**
   * Records a verified assertion's `jti`; false when it was recorded already. `now` is the instant the assertion was
   * found valid at, so its own record, which runs out when it does, is never dropped while it holds; and the record is
   * looked up before anything is dropped. Synchronous, so no two requests race.
   */
  const once = (token, now) => {
    const { jti, exp } = JSON.parse(b64(String(token).split('.')[1]));
    if (used.has(jti)) return false;
    for (const [seen, expires] of used) {
      if (expires > now / 1000) break;
      used.delete(seen);
    }
    used.set(jti, exp);
    return true;
  };
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
      const url = keysAddress(clewUrl);
      if (!url) return null;
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(5000), redirect: 'error' });
      if (!response.ok) return null;
      cached = await response.json();
      until = Date.now() + 60_000;
    }
    return cached;
  };
  // The incoming request is required: the assertion is bound to it (D117), and without it nothing verifies.
  const verifier = async (token, suppliedKey, request) => {
    try {
      if (!request || !transport(suppliedKey)) return null;
      const binding = await bindingOf(request);
      const keys = await keysFor(token);
      // One instant for the whole decision: the assertion's lifetime and its jti's record are judged at the same time.
      const now = Date.now();
      const actor = keys ? verifyAssertion(token, keys, audience, now, binding) : null;
      return actor && once(token, now) ? actor : null;
    } catch {
      return null;
    }
  };
  // The installation's own call (D119), likewise only with the request.
  verifier.installation = async (token, suppliedKey, request) => {
    try {
      if (!request || !transport(suppliedKey)) return false;
      const binding = await bindingOf(request);
      const keys = await keysFor(token);
      const now = Date.now();
      return !!keys && verifyInstallationAssertion(token, keys, audience, now, binding) && once(token, now);
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
