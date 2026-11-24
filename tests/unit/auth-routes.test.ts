import { afterAll, afterEach, beforeAll, describe, expect, mock, spyOn, test } from 'bun:test';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { authRoutes } from '../../apps/server/src/routes/auth';
import { logger } from '../../apps/server/src/logging';

/**
 * The sign-in and logout routes where they answer before the database is read (L5 and L11 of the 2026-11-12 users
 * review): each refusal is answered as before and said in one line with scope `auth`, carrying what failed and never
 * the token's claims, and front-channel logout (D121) refuses another issuer and ends nothing without a `sid`. The
 * identity provider answers over a fake fetch, and a provider at another address answers 500. The server's logger is
 * watched while the file runs. What needs the database, a sign-in that reached the provider and the sessions a logout
 * ends, is in `tests/db/sign-in-routes.test.ts`.
 */
const settings: Record<string, string> = {
  OIDC_ISSUER: 'https://idp.example.test/realms/routes',
  OIDC_CLIENT_ID: 'clew-routes-test',
  OIDC_CLIENT_SECRET: 'synthetic-secret',
  PUBLIC_URL: 'https://clew.example.test',
};
const issuer = settings.OIDC_ISSUER!;
const keys = await generateKeyPair('RS256');
const jwks = { keys: [{ ...(await exportJWK(keys.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' }] };
const previous: Record<string, string | undefined> = {};
const network = globalThis.fetch;
/** How often the provider's keys were fetched. */
let keyFetches = 0;
/** What the routes said through the server's logger, in order. */
const said: Array<{ level: 'warn' | 'error'; fields: unknown; message: unknown }> = [];
beforeAll(() => {
  for (const [k, v] of Object.entries(settings)) {
    previous[k] = process.env[k];
    process.env[k] = v;
  }
  for (const level of ['warn', 'error'] as const)
    spyOn(logger, level).mockImplementation(((fields: unknown, message: unknown) => {
      said.push({ level, fields, message });
    }) as never);
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url === issuer + '/.well-known/openid-configuration')
      return Response.json({
        issuer,
        authorization_endpoint: issuer + '/auth',
        token_endpoint: issuer + '/token',
        jwks_uri: issuer + '/certs',
      });
    if (url === issuer + '/certs') {
      keyFetches++;
      return Response.json(jwks);
    }
    return new Response('<html>Service Unavailable</html>', { status: 500, headers: { 'Content-Type': 'text/html' } });
  }) as typeof fetch;
});
afterAll(() => {
  mock.restore();
  globalThis.fetch = network;
  for (const [k, v] of Object.entries(previous))
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
});
afterEach(() => {
  said.length = 0;
});
/** A logout token the provider signed for Anna's session, for `audience`. */
const logoutToken = (audience: string) =>
  new SignJWT({ sid: 'sid-anna', events: { 'http://schemas.openid.net/event/backchannel-logout': {} } })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject('sub-anna')
    .setJti('jti-' + audience)
    .setIssuedAt()
    .sign(keys.privateKey);
const backchannel = (body: string, type = 'application/x-www-form-urlencoded') =>
  authRoutes.request('/backchannel-logout', { method: 'POST', headers: { 'Content-Type': type }, body });
/** The provider's frame, as a browser loads it: cross-site, with no cookie of Clew's. */
const frontchannel = (query: string) =>
  authRoutes.request('/frontchannel-logout' + query, {
    headers: { 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'iframe' },
  });

describe('a refused sign-in or logout is said in one line', () => {
  test('a sign-in that cannot start, because the provider answers with an error, is said at error level', async () => {
    process.env.OIDC_ISSUER = 'https://down.example.test/realms/routes';
    try {
      const response = await authRoutes.request('/login');
      expect(response.status).toBe(303);
      expect(response.headers.get('location')).toBe('/login?reason=unavailable');
    } finally {
      process.env.OIDC_ISSUER = issuer;
    }
    expect(said).toEqual([
      {
        level: 'error',
        fields: {
          scope: 'auth',
          failure: {
            name: 'ClientError',
            code: 'OAUTH_RESPONSE_IS_NOT_CONFORM',
            status: 500,
            message: 'unexpected HTTP response status code',
          },
        },
        message: 'sign-in could not start',
      },
    ]);
  });
  test('a callback without the sign-in that asked for it says why', async () => {
    const response = await authRoutes.request('/callback?code=code-1&state=state-1');
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/login?reason=invalid');
    expect(said).toEqual([
      {
        level: 'warn',
        fields: { scope: 'auth', failure: { name: 'AuthError', code: 'invalid', status: 401, message: 'invalid' } },
        message: 'sign-in failed at the callback',
      },
    ]);
  });
  test("a back-channel logout token for another client is refused as before, and said without the token's claims", async () => {
    const response = await backchannel('logout_token=' + (await logoutToken('another-client')));
    expect(response.status).toBe(400);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ error: 'Ogiltig utloggning.' });
    expect(said).toEqual([
      {
        level: 'warn',
        fields: {
          scope: 'auth',
          failure: {
            name: 'JWTClaimValidationFailed',
            code: 'ERR_JWT_CLAIM_VALIDATION_FAILED',
            message: 'unexpected "aud" claim value',
          },
        },
        message: 'back-channel logout refused',
      },
    ]);
    expect(JSON.stringify(said)).not.toContain('anna');
  });
  test('a back-channel logout that is not a form is refused and said', async () => {
    const response = await backchannel('{}', 'application/json');
    expect(response.status).toBe(400);
    expect(said).toEqual([
      {
        level: 'warn',
        fields: { scope: 'auth', failure: { name: 'Error', message: 'Format' } },
        message: 'back-channel logout refused',
      },
    ]);
  });
});
describe('the back-channel logout address does bounded work for anyone (ID-8)', () => {
  /** A token signed with a key the provider never published, naming a key id the key set does not hold. */
  const forged = async (kid: string) => {
    const other = await generateKeyPair('RS256');
    return new SignJWT({ sid: 'sid-anna', events: { 'http://schemas.openid.net/event/backchannel-logout': {} } })
      .setProtectedHeader({ alg: 'RS256', kid })
      .setIssuer(issuer)
      .setAudience(settings.OIDC_CLIENT_ID!)
      .setSubject('sub-anna')
      .setJti('jti-' + kid)
      .setIssuedAt()
      .sign(other.privateKey);
  };
  test("forged tokens with unknown key ids do not make Clew fetch the provider's keys for each one", async () => {
    // The key set is read once, by a token it can check.
    await backchannel('logout_token=' + (await logoutToken('another-client')));
    const before = keyFetches;
    for (const kid of ['k2', 'k3', 'k4', 'k5', 'k6']) {
      const response = await backchannel('logout_token=' + (await forged(kid)));
      expect(response.status).toBe(400);
    }
    // jose's cooldown stands: within it, no unknown key id fetches the keys again.
    expect(keyFetches - before).toBe(0);
  });
  test('a body over the limit is refused before it is read whole, whether it declares its length or not', async () => {
    let pieces = 0;
    let declaredPieces = 0;
    const declaredBody = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          declaredPieces++;
          controller.enqueue(new TextEncoder().encode('logout_token=x'));
        },
      },
      { highWaterMark: 0 },
    );
    const declared = await authRoutes.request(
      new Request('http://clew.example.test/backchannel-logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': '16000001' },
        body: declaredBody,
        duplex: 'half',
      } as RequestInit),
    );
    expect(declared.status).toBe(400);
    expect(declaredPieces).toBe(0);
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pieces++;
        controller.enqueue(new TextEncoder().encode('logout_token=' + 'x'.repeat(8 * 1024)));
      },
    });
    const response = await authRoutes.request(
      new Request('http://clew.example.test/backchannel-logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: endless,
        duplex: 'half',
      } as RequestInit),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Ogiltig utloggning.' });
    // 16 000 characters are read as at most 48 000 bytes: a few pieces, never the whole of an endless body.
    expect(pieces).toBeLessThanOrEqual(8);
    expect(said.map(s => s.fields)).toContainEqual({ scope: 'auth', failure: { name: 'Error', message: 'Limit' } });
  });
});
describe('front-channel logout (D121) where it ends nothing', () => {
  test('another issuer is refused with 400 and said, whatever the sid', async () => {
    for (const query of [
      '?iss=https://other.example.test/realms/routes&sid=sid-anna',
      '?iss=&sid=sid-anna',
      '?iss=https://other.example.test/realms/routes',
    ]) {
      said.length = 0;
      const response = await frontchannel(query);
      expect(response.status).toBe(400);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await response.text()).toBe('');
      expect(said).toEqual([
        {
          level: 'warn',
          fields: { scope: 'auth', failure: { name: 'AuthError', code: 'invalid', status: 401, message: 'invalid' } },
          message: 'front-channel logout refused',
        },
      ]);
    }
  });
  test('without a sid it answers 200, empty and never cached, and nothing is said', async () => {
    for (const query of ['?iss=' + encodeURIComponent(issuer), '?iss=' + encodeURIComponent(issuer) + '&sid=', '']) {
      const response = await frontchannel(query);
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await response.text()).toBe('');
    }
    expect(said).toEqual([]);
  });
});
