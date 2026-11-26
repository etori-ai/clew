// Whose token this is, by the system's own authorization server: the access token is verified here, against the
// issuer's published keys (RS256), its issuer and its expiry, and the account it names is the one the system answers
// for. Nothing of Clew's identity is trusted for that. Node's own crypto; no dependency.
import { createPublicKey, verify as verifySignature } from 'node:crypto';

/** The issuer could not be asked for its keys: the system is unavailable, which is not a refusal of the token. */
export class IssuerUnavailable extends Error {}

const decode = part => JSON.parse(Buffer.from(part, 'base64url').toString());

/**
 * `issuer` is the authorization server whose tokens the system takes. `jwks` gives the keys directly (a test); without
 * it they are read from the issuer's metadata and kept for ten minutes, and read again once when a token names a key
 * that is not among them, so a rotated key is found.
 */
export function createTokenVerifier({ issuer, jwks, fetch: fetchImpl = globalThis.fetch, clock = () => new Date() }) {
  let kept;
  const read = async url => {
    const response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new IssuerUnavailable('The issuer answered ' + response.status);
    return response.json();
  };
  async function keys(again) {
    if (jwks)
      try {
        return (typeof jwks === 'function' ? await jwks() : jwks).keys ?? [];
      } catch (error) {
        throw new IssuerUnavailable(String(error?.message ?? error));
      }
    if (kept && !again && clock().getTime() - kept.at < 600_000) return kept.keys;
    try {
      const metadata = await read(issuer.replace(/\/$/, '') + '/.well-known/openid-configuration');
      if (metadata.issuer !== issuer || typeof metadata.jwks_uri !== 'string')
        throw new IssuerUnavailable('The metadata is not the issuer’s own');
      kept = { keys: (await read(metadata.jwks_uri)).keys ?? [], at: clock().getTime() };
    } catch (error) {
      throw error instanceof IssuerUnavailable ? error : new IssuerUnavailable(String(error?.message ?? error));
    }
    return kept.keys;
  }
  /** The account an access token is for, or null for anything the system does not take. */
  return async function accountOf(token) {
    if (!issuer) throw new IssuerUnavailable('No issuer is configured');
    const parts = typeof token === 'string' ? token.split('.') : [];
    if (parts.length !== 3) return null;
    let header, claims;
    try {
      header = decode(parts[0]);
      claims = decode(parts[1]);
    } catch {
      return null;
    }
    if (header.alg !== 'RS256' || typeof header.kid !== 'string') return null;
    let key;
    for (const again of [false, true]) {
      key = (await keys(again)).find(k => k.kid === header.kid && k.kty === 'RSA' && (k.use ?? 'sig') === 'sig');
      if (key || jwks) break;
    }
    if (!key) return null;
    let signed = false;
    try {
      signed = verifySignature(
        'RSA-SHA256',
        Buffer.from(parts[0] + '.' + parts[1]),
        createPublicKey({ key, format: 'jwk' }),
        Buffer.from(parts[2], 'base64url'),
      );
    } catch {
      signed = false;
    }
    if (!signed || claims.iss !== issuer) return null;
    if (typeof claims.exp !== 'number' || claims.exp * 1000 <= clock().getTime()) return null;
    // An identity token or a refresh token is not an access token, where the server says which is which.
    if (claims.typ !== undefined && claims.typ !== 'Bearer') return null;
    return typeof claims.preferred_username === 'string' && claims.preferred_username
      ? claims.preferred_username
      : null;
  };
}
