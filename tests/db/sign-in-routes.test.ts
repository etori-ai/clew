import { afterAll, beforeAll, describe, expect, mock, spyOn, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import * as oidc from 'openid-client';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { database, schema } from '../../packages/db/src/index';
import { randomToken, tokenDigest } from '../../apps/server/src/auth-crypto';
import { logger } from '../../apps/server/src/logging';
import { authRoutes } from '../../apps/server/src/routes/auth';

/**
 * The sign-in routes on PostgreSQL, through the server's own routes and database, with the identity provider served in
 * place of the network (L11 of the 2026-11-12 users review). A callback whose code the provider refuses, or whose ID
 * token fails a claim check, sends the person back to the sign-in page as before and is said in one line with scope
 * `auth`: the OAuth error, or the claim that failed, and never the token's claims. The server's logger is watched while
 * the file runs. Run with `bun run test:db` inside the devcontainer.
 */
if (!process.env.DATABASE_URL)
  throw new Error('DATABASE_URL is not set. Run `bun run test:db` inside the devcontainer.');
const suffix = randomUUID();
const settings: Record<string, string> = {
  OIDC_ISSUER: 'https://idp.example.test/realms/routes-' + suffix,
  OIDC_CLIENT_ID: 'clew-routes-test',
  OIDC_CLIENT_SECRET: 'synthetic-secret',
  PUBLIC_URL: 'https://clew.example.test',
};
const issuer = settings.OIDC_ISSUER!,
  clientId = settings.OIDC_CLIENT_ID!;
const keys = await generateKeyPair('RS256');
const jwks = { keys: [{ ...(await exportJWK(keys.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' }] };
/** Anna's claims, which no line may carry. */
const claims = { preferred_username: 'anna.berg@example.test', email: 'anna.berg@example.test', name: 'Anna Berg' };
/** What the provider's token endpoint answers; each test says. */
let tokenAnswer: () => Response | Promise<Response> = () => new Response(null, { status: 500 });
const said: Array<{ level: 'warn' | 'error'; fields: unknown; message: unknown }> = [];
const previous: Record<string, string | undefined> = {};
const network = globalThis.fetch;
const digests: string[] = [];
beforeAll(() => {
  for (const [k, v] of Object.entries(settings)) {
    previous[k] = process.env[k];
    process.env[k] = v;
  }
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url === issuer + '/.well-known/openid-configuration')
      return Response.json({
        issuer,
        authorization_endpoint: issuer + '/auth',
        token_endpoint: issuer + '/token',
        jwks_uri: issuer + '/certs',
      });
    if (url === issuer + '/certs') return Response.json(jwks);
    if (url === issuer + '/token') return tokenAnswer();
    return network(input, init);
  }) as typeof fetch;
  for (const level of ['warn', 'error'] as const)
    spyOn(logger, level).mockImplementation(((fields: unknown, message: unknown) => {
      said.push({ level, fields, message });
    }) as never);
});
afterAll(async () => {
  mock.restore();
  globalThis.fetch = network;
  for (const [k, v] of Object.entries(previous))
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  for (const digest of digests)
    await database().delete(schema.loginTransactions).where(eq(schema.loginTransactions.digest, digest));
});
/** A sign-in that has gone to the provider: its row, and the cookie the browser holds for it. */
async function signInStarted() {
  const cookie = randomToken(),
    digest = tokenDigest(cookie);
  digests.push(digest);
  await database()
    .insert(schema.loginTransactions)
    .values({
      digest,
      state: 'state-' + suffix,
      nonce: 'nonce-' + suffix,
      verifier: oidc.randomPKCECodeVerifier(),
      returnTo: '/',
      expiresAt: new Date(Date.now() + 300_000),
    });
  return cookie;
}
const callback = (cookie: string) =>
  authRoutes.request('/callback?code=code-1&state=state-' + suffix, { headers: { Cookie: 'clew-login=' + cookie } });

describe('a callback the provider or its ID token refuses', () => {
  test('a refused code says the OAuth error and its status, never the description that names the account', async () => {
    said.length = 0;
    tokenAnswer = () =>
      Response.json(
        {
          error: 'invalid_client',
          error_description: 'AADSTS7000215: Invalid client secret for anna.berg@example.test',
        },
        { status: 401 },
      );
    const response = await callback(await signInStarted());
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/login?reason=invalid');
    expect(said).toEqual([
      {
        level: 'warn',
        fields: {
          scope: 'auth',
          failure: {
            name: 'ResponseBodyError',
            code: 'OAUTH_RESPONSE_BODY_ERROR',
            oauthError: 'invalid_client',
            status: 401,
            message: 'server responded with an error in the response body',
          },
        },
        message: 'sign-in failed at the callback',
      },
    ]);
    expect(JSON.stringify(said)).not.toContain('anna');
  });
  test('an ID token for another client says which claim failed, never the claims', async () => {
    said.length = 0;
    tokenAnswer = async () =>
      Response.json({
        access_token: 'access-1',
        token_type: 'Bearer',
        expires_in: 300,
        refresh_token: 'refresh-1',
        id_token: await new SignJWT({ nonce: 'nonce-' + suffix, sid: 'sid-anna', ...claims })
          .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
          .setIssuer(issuer)
          .setAudience('another-client')
          .setSubject('sub-anna')
          .setIssuedAt()
          .setExpirationTime('5m')
          .sign(keys.privateKey),
      });
    const response = await callback(await signInStarted());
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/login?reason=invalid');
    expect(said).toEqual([
      {
        level: 'warn',
        fields: {
          scope: 'auth',
          failure: {
            name: 'ClientError',
            code: 'OAUTH_JWT_CLAIM_COMPARISON_FAILED',
            message: 'unexpected JWT claim value encountered',
            cause: 'unexpected JWT "aud" (audience) claim value',
          },
        },
        message: 'sign-in failed at the callback',
      },
    ]);
    expect(JSON.stringify(said)).not.toContain('anna');
    // Nobody was signed in.
    const sessions = await database().select().from(schema.sessions).where(eq(schema.sessions.clientId, clientId));
    expect(sessions).toEqual([]);
  });
});
