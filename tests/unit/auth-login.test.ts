import { describe, expect, test } from 'bun:test';
import * as oidc from 'openid-client';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { authorizationUrl, redeemCode } from '../../apps/server/src/auth-login';

/**
 * A sign-in follows the identity provider's own session (Q9 of the 2026-11-12 users review, L9): the authorization URL
 * carries no `prompt` and no `max_age`, and an ID token without `auth_time` signs the person in. The real
 * openid-client runs against a fake provider over a fake fetch, with the ID token's signature checked against the
 * provider's keys as the server's configuration checks it.
 */
const issuer = 'https://idp.example.test',
  callback = 'https://clew.example.test/api/auth/callback';
const keys = await generateKeyPair('RS256');
const jwks = { keys: [{ ...(await exportJWK(keys.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' }] };
const request = {
  callback,
  scope: 'openid profile email',
  state: 'state-1',
  nonce: 'nonce-1',
  verifier: oidc.randomPKCECodeVerifier(),
};
/** An ID token for Anna with the given nonce and no `auth_time`, as a provider that leaves it out signs it. */
const idToken = (nonce: string) =>
  new SignJWT({ nonce })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(issuer)
    .setAudience('clew')
    .setSubject('sub-anna')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(keys.privateKey);
/** A provider whose token endpoint redeems any code with tokens that carry `nonce` in the ID token. */
function provider(nonce = request.nonce) {
  const config = new oidc.Configuration(
    {
      issuer,
      authorization_endpoint: issuer + '/authorize',
      token_endpoint: issuer + '/token',
      jwks_uri: issuer + '/jwks',
    },
    'clew',
    'synthetic-secret',
  );
  oidc.enableNonRepudiationChecks(config);
  const redeemed: URLSearchParams[] = [];
  config[oidc.customFetch] = async (url, init) => {
    if (url === issuer + '/jwks') return Response.json(jwks);
    redeemed.push(new URLSearchParams(await new Request(url, init as RequestInit).text()));
    return Response.json({
      access_token: 'access-1',
      token_type: 'Bearer',
      expires_in: 300,
      refresh_token: 'refresh-1',
      id_token: await idToken(nonce),
    });
  };
  return { config, redeemed };
}
const returnedWith = (state: string) => new URL(callback + '?code=code-1&state=' + state);
describe("a sign-in follows the identity provider's session", () => {
  test('the authorization URL asks for neither a fresh prompt nor a maximum age', async () => {
    const url = await authorizationUrl(provider().config, request);
    expect(url.origin + url.pathname).toBe(issuer + '/authorize');
    expect(url.searchParams.has('prompt')).toBe(false);
    expect(url.searchParams.has('max_age')).toBe(false);
    // What it does carry: the code flow with PKCE, the state and nonce, the callback and the scope, Swedish pages.
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'clew',
      response_type: 'code',
      redirect_uri: callback,
      scope: request.scope,
      state: request.state,
      nonce: request.nonce,
      code_challenge: await oidc.calculatePKCECodeChallenge(request.verifier),
      code_challenge_method: 'S256',
      ui_locales: 'sv',
    });
  });
  test('an ID token without auth_time signs the person in', async () => {
    const { config, redeemed } = provider();
    const tokens = await redeemCode(config, returnedWith(request.state), request);
    const claims = tokens.claims();
    expect(claims?.sub).toBe('sub-anna');
    expect(claims && 'auth_time' in claims).toBe(false);
    expect(redeemed[0]?.get('code')).toBe('code-1');
    expect(redeemed[0]?.get('code_verifier')).toBe(request.verifier);
    // The same answer is refused when a maximum age is asked for, as `maxAge: 0` did before: auth_time was required.
    await expect(
      oidc.authorizationCodeGrant(config, returnedWith(request.state), {
        pkceCodeVerifier: request.verifier,
        expectedState: request.state,
        expectedNonce: request.nonce,
        idTokenExpected: true,
        maxAge: 0,
      }),
    ).rejects.toMatchObject({ cause: { message: 'JWT "auth_time" (authentication time) claim missing' } });
  });
  test('the code is still bound to the sign-in that asked for it, by its state and its nonce', async () => {
    await expect(redeemCode(provider().config, returnedWith('another-state'), request)).rejects.toThrow();
    await expect(redeemCode(provider('another-nonce').config, returnedWith(request.state), request)).rejects.toThrow();
  });
});
