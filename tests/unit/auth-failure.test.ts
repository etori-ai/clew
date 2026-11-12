import { describe, expect, test } from 'bun:test';
import { Writable } from 'node:stream';
import * as oidc from 'openid-client';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, jwtVerify } from 'jose';
import { AuthError } from '../../apps/server/src/auth';
import { redeemCode } from '../../apps/server/src/auth-login';
import { failureDetails } from '../../apps/server/src/auth-refresh';
import { createLogger } from '../../apps/server/src/logging';

/**
 * What the log line of a failed sign-in or logout says (L11 of the 2026-11-12 users review). Each failure is the error
 * the libraries throw for it: openid-client redeems a code against a fake provider over a fake fetch, and jose checks a
 * logout token, as the server does. The server's own logger writes the line into memory. It carries what the hosting
 * and identity provider teams need to tell the failures apart, and never the ID token's claims, the provider's
 * description of the failure or the logout token's payload.
 */
const issuer = 'https://idp.example.test',
  callback = 'https://clew.example.test/api/auth/callback';
const keys = await generateKeyPair('RS256');
const jwk = { ...(await exportJWK(keys.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
/** Anna's claims, which no line may carry. */
const claims = { preferred_username: 'anna.berg@example.test', email: 'anna.berg@example.test', name: 'Anna Berg' };
const personal = ['anna.berg@example.test', 'Anna Berg', 'sub-anna', 'sid-anna'];
const request = { state: 'state-1', nonce: 'nonce-1', verifier: oidc.randomPKCECodeVerifier() };
/** A token the provider signed for Anna, for `audience`. */
const signed = (audience: string, extra: Record<string, unknown> = {}) =>
  new SignJWT({ sid: 'sid-anna', ...claims, ...extra })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject('sub-anna')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(keys.privateKey);
/** A provider whose token endpoint answers what the test says; its key set is Anna's tokens' key. */
function provider(answer: () => Response | Promise<Response>) {
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
  config[oidc.customFetch] = async url => (url === issuer + '/jwks' ? Response.json({ keys: [jwk] }) : answer());
  return config;
}
const returned = (query: string) => new URL(callback + '?' + query);
async function thrown(run: () => Promise<unknown>) {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error('The call was expected to fail');
}
/** The line the server writes for a failure, as text and as JSON. */
function line(error: unknown) {
  const written: string[] = [];
  const sink = new Writable({
    write(chunk, _encoding, callback) {
      written.push(String(chunk));
      callback();
    },
  });
  createLogger({}, sink).warn({ scope: 'auth', failure: failureDetails(error) }, 'sign-in failed at the callback');
  const text = written.join('');
  return { text, json: JSON.parse(text) as { failure: Record<string, unknown> } & Record<string, unknown> };
}
const carriesNothingPersonal = (text: string) => {
  for (const value of personal) expect(text).not.toContain(value);
};

describe('the log line of a failed sign-in or logout', () => {
  test("a refused client secret says the OAuth error and the status, never the provider's description", async () => {
    const error = await thrown(() =>
      redeemCode(
        provider(() =>
          Response.json(
            {
              error: 'invalid_client',
              error_description: 'AADSTS7000215: Invalid client secret provided. Account anna.berg@example.test.',
            },
            { status: 401 },
          ),
        ),
        returned('code=code-1&state=state-1'),
        request,
      ),
    );
    const { text, json } = line(error);
    expect(json).toMatchObject({ level: 'warn', scope: 'auth', message: 'sign-in failed at the callback' });
    expect(json.failure).toEqual({
      name: 'ResponseBodyError',
      code: 'OAUTH_RESPONSE_BODY_ERROR',
      oauthError: 'invalid_client',
      status: 401,
      message: 'server responded with an error in the response body',
    });
    expect(text).not.toContain('AADSTS');
    carriesNothingPersonal(text);
  });
  test('an ID token for another client says which claim failed, never the claims', async () => {
    const error = await thrown(async () =>
      redeemCode(
        provider(async () =>
          Response.json({
            access_token: 'access-1',
            token_type: 'Bearer',
            expires_in: 300,
            refresh_token: 'refresh-1',
            id_token: await signed('another-client', { nonce: request.nonce }),
          }),
        ),
        returned('code=code-1&state=state-1'),
        request,
      ),
    );
    // The error itself carries Anna's claims, two causes down: the reason it is never logged.
    expect(JSON.stringify((error as { cause: { cause: unknown } }).cause.cause)).toContain('anna.berg@example.test');
    const { text, json } = line(error);
    expect(json.failure).toEqual({
      name: 'ClientError',
      code: 'OAUTH_JWT_CLAIM_COMPARISON_FAILED',
      message: 'unexpected JWT claim value encountered',
      cause: 'unexpected JWT "aud" (audience) claim value',
    });
    carriesNothingPersonal(text);
  });
  test('a sign-in the provider refused says its OAuth error, never its description', async () => {
    const error = await thrown(() =>
      redeemCode(
        provider(() => new Response(null, { status: 500 })),
        returned(
          'error=access_denied&error_description=' +
            encodeURIComponent('AADSTS50105: anna.berg@example.test is not assigned to a role') +
            '&state=state-1',
        ),
        request,
      ),
    );
    const { text, json } = line(error);
    expect(json.failure).toMatchObject({ name: 'AuthorizationResponseError', oauthError: 'access_denied' });
    expect(text).not.toContain('AADSTS');
    carriesNothingPersonal(text);
  });
  test("a provider that cannot be reached says the network's code and message", async () => {
    const error = await thrown(() =>
      redeemCode(
        provider(() => {
          throw new TypeError('fetch failed', {
            cause: Object.assign(new Error('getaddrinfo ENOTFOUND idp.example.test'), { code: 'ENOTFOUND' }),
          });
        }),
        returned('code=code-1&state=state-1'),
        request,
      ),
    );
    expect(line(error).json.failure).toEqual({
      name: 'TypeError',
      code: 'ENOTFOUND',
      message: 'fetch failed',
      cause: 'getaddrinfo ENOTFOUND idp.example.test',
    });
  });
  test("a logout token for another client says jose's code and the claim, never the token's payload", async () => {
    const token = await signed('another-client', {
      events: { 'http://schemas.openid.net/event/backchannel-logout': {} },
      jti: 'jti-1',
    });
    const error = await thrown(() =>
      jwtVerify(token, createLocalJWKSet({ keys: [jwk] }), { issuer, audience: 'clew', algorithms: ['RS256'] }),
    );
    expect(JSON.stringify((error as { payload: unknown }).payload)).toContain('sid-anna');
    const { text, json } = line(error);
    expect(json.failure).toEqual({
      name: 'JWTClaimValidationFailed',
      code: 'ERR_JWT_CLAIM_VALIDATION_FAILED',
      message: 'unexpected "aud" claim value',
    });
    carriesNothingPersonal(text);
  });
  test("Clew's own refusal says its code and status", () => {
    expect(line(new AuthError(401, 'invalid')).json.failure).toEqual({
      name: 'AuthError',
      code: 'invalid',
      status: 401,
      message: 'invalid',
    });
    expect(line('a thrown string').json.failure).toEqual({ name: 'string' });
  });
});
