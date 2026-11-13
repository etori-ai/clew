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
 * description of the failure, the logout token's payload or the values of a statement that failed.
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
/**
 * A failed statement as drizzle-orm 0.45.4 throws it (`errors.js`: the class leaves `name` as `Error`), and
 * PostgreSQL's answer as postgres.js 4.1.1 throws it (`errors.js`: its fields assigned onto the error). The unit suite
 * never imports the database libraries (D25), so both are written here as the libraries write them;
 * `tests/db/sign-in-routes.test.ts` meets the real ones.
 */
class DrizzleQueryError extends Error {
  query: string;
  params: unknown[];
  constructor(query: string, params: unknown[], cause: unknown) {
    super(`Failed query: ${query}\nparams: ${params}`);
    this.query = query;
    this.params = params;
    this.cause = cause;
  }
}
class PostgresError extends Error {
  constructor(fields: { severity: string; code: string; message: string }) {
    super(fields.message);
    this.name = 'PostgresError';
    Object.assign(this, fields);
  }
}
/** The first statement of a sign-in once the provider has answered (`signIn`): the binding of Anna's subject. */
const bindingLookup =
  'select "person_id" from "auth_identity_binding" where ("auth_identity_binding"."issuer" = $1 and "auth_identity_binding"."subject" = $2)';

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
  test("a database that cannot be reached says the connection's code and message, never the statement's values", () => {
    const error = new DrizzleQueryError(
      bindingLookup,
      [issuer, 'sub-anna'],
      Object.assign(new Error('connect ECONNREFUSED 10.0.0.5:5432'), {
        errno: -111,
        code: 'ECONNREFUSED',
        syscall: 'connect',
        address: '10.0.0.5',
        port: 5432,
      }),
    );
    // The error's message quotes the statement and every value it was given: the reason it is never logged.
    expect(error.message).toContain('sub-anna');
    const { text, json } = line(error);
    expect(json.failure).toEqual({
      name: 'DrizzleQueryError',
      code: 'ECONNREFUSED',
      cause: 'connect ECONNREFUSED 10.0.0.5:5432',
    });
    expect(text).not.toContain('auth_identity_binding');
    expect(text).not.toContain(issuer);
    carriesNothingPersonal(text);
  });
  test("a statement PostgreSQL refused says its SQLSTATE, never PostgreSQL's message, which can quote the value", () => {
    const error = new DrizzleQueryError(
      'select $1::uuid',
      ['anna.berg@example.test'],
      new PostgresError({
        severity: 'ERROR',
        code: '22P02',
        message: 'invalid input syntax for type uuid: "anna.berg@example.test"',
      }),
    );
    const { text, json } = line(error);
    expect(json.failure).toEqual({ name: 'DrizzleQueryError', code: '22P02' });
    carriesNothingPersonal(text);
    // PostgreSQL's answer where nothing wrapped it says its SQLSTATE alone too.
    const unwrapped = new PostgresError({
      severity: 'ERROR',
      code: '22P02',
      message: 'invalid input syntax for type uuid: "anna.berg@example.test"',
    });
    expect(line(unwrapped).json.failure).toEqual({ name: 'PostgresError', code: '22P02' });
    carriesNothingPersonal(line(unwrapped).text);
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
