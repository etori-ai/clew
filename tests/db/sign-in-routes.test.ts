import { afterAll, beforeAll, describe, expect, mock, spyOn, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { and, eq, gt, inArray, isNull, like, or, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as oidc from 'openid-client';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { database, schema } from '../../packages/db/src/index';
import { randomToken, tokenDigest } from '../../apps/server/src/auth-crypto';
import { failureDetails } from '../../apps/server/src/auth-refresh';
import { logger } from '../../apps/server/src/logging';
import { authRoutes } from '../../apps/server/src/routes/auth';

/**
 * The sign-in and logout routes on PostgreSQL, through the server's own routes and database, with the identity provider
 * served in place of the network (L5, L10 and L11 of the 2026-11-12 users review). A callback whose code the provider
 * refuses, or whose ID token fails a claim check, sends the person back to the sign-in page as before and is said in
 * one line with scope `auth`: the OAuth error, or the claim that failed, and never the token's claims; a statement that
 * fails says PostgreSQL's SQLSTATE and never the values it was given, the subject among them. A sign-in Clew refuses,
 * for want of a grant or by the binding (D68 item 6), sends the person back with `denied`, opens no session and writes
 * `login-denied` after the binding's own row, if it wrote one, naming the person when one is known: the bound person
 * without a grant, the person a changed subject's claim names, the person who holds a subject whose claim names someone
 * else, and a person who has left; nobody when the claim names nobody or the ID token carries none. A sign-out at the
 * provider ends the sessions of its `sid` by either channel (D121): front-channel logout from a cross-site frame
 * without a cookie, back-channel logout as before, with its receipt against a replayed token. The session's cookie is
 * read under its `__Host-` name only (D145): a bare one that a sibling host set opens no protected route and is not what
 * a sign-out ends. A sign-in that succeeds (ID-9 of the 2026-11-23 identity review), from `/login` through `/callback`
 * or by the development sign-in, opens one session under HttpOnly, SameSite=Lax cookies (Secure and `__Host-` outside
 * the local stack), writes `login` or `login-dev`, returns to the local address it started from with its query, and
 * replaces the session of the browser's earlier cookie (`replaced`); a write needs the public origin and the session's
 * CSRF token; a person deactivated or without a grant loses the session at the next request (`access-revoked`); a
 * sign-out needs the token too and writes `logout`. The server's logger is watched while the file runs. Run with
 * `bun run test:db` inside the devcontainer.
 */
if (!process.env.DATABASE_URL)
  throw new Error('DATABASE_URL is not set. Run `bun run test:db` inside the devcontainer.');
const suffix = randomUUID();
const settings: Record<string, string> = {
  OIDC_ISSUER: 'https://idp.example.test/realms/routes-' + suffix,
  OIDC_CLIENT_ID: 'clew-routes-test',
  OIDC_CLIENT_SECRET: 'synthetic-secret',
  PUBLIC_URL: 'https://clew.example.test',
  // The claim a sign-in is matched on, whatever the environment says.
  OIDC_BINDING_CLAIM: 'preferred_username',
};
const issuer = settings.OIDC_ISSUER!,
  clientId = settings.OIDC_CLIENT_ID!,
  person = 'routes-test-' + suffix;
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
beforeAll(async () => {
  await database().insert(schema.people).values({ id: person, organisationId: 'test', name: 'Synthetic logout test' });
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
  await database().delete(schema.sessions).where(eq(schema.sessions.personId, person));
  await database()
    .delete(schema.authenticationAudit)
    .where(eq(schema.authenticationAudit.actor, 'person:' + person));
  await database().delete(schema.logoutReceipts).where(eq(schema.logoutReceipts.issuer, issuer));
  await database().delete(schema.people).where(eq(schema.people.id, person));
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
  authRoutes.request('/callback?code=code-1&state=state-' + suffix, {
    headers: { Cookie: '__Host-clew-login=' + cookie },
  });

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
  test("a statement that fails after the provider answered says PostgreSQL's SQLSTATE, never the statement's values", async () => {
    said.length = 0;
    // A subject PostgreSQL cannot hold, with a NUL byte, fails the sign-in's first statement, the lookup of its binding,
    // whose values are the issuer and the subject; drizzle's error quotes them both.
    tokenAnswer = async () =>
      Response.json({
        access_token: 'access-1',
        token_type: 'Bearer',
        expires_in: 300,
        refresh_token: 'refresh-1',
        id_token: await new SignJWT({ nonce: 'nonce-' + suffix, sid: 'sid-anna', ...claims })
          .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
          .setIssuer(issuer)
          .setAudience(clientId)
          .setSubject('sub-anna\u0000')
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
        fields: { scope: 'auth', failure: { name: 'DrizzleQueryError', code: '22021' } },
        message: 'sign-in failed at the callback',
      },
    ]);
    expect(JSON.stringify(said)).not.toContain('anna');
    expect(JSON.stringify(said)).not.toContain(suffix);
  });
  test("the database's errors as drizzle and postgres.js throw them say a code, and a connection's message, never a value", async () => {
    // Nothing listens on this port: a database that cannot be reached.
    const unreachable = drizzle({
      connection: { url: 'postgres://clew:unused@127.0.0.1:9/clew', max: 1, connect_timeout: 2 },
    });
    try {
      const lookup = await thrown(() =>
        unreachable
          .select({ personId: schema.identityBindings.personId })
          .from(schema.identityBindings)
          .where(and(eq(schema.identityBindings.issuer, issuer), eq(schema.identityBindings.subject, 'sub-anna'))),
      );
      expect(lookup.message).toContain('sub-anna');
      expect(failureDetails(lookup)).toEqual({
        name: 'DrizzleQueryError',
        code: 'ECONNREFUSED',
        cause: 'connect ECONNREFUSED 127.0.0.1:9',
      });
    } finally {
      await unreachable.$client.end();
    }
    // PostgreSQL's own message can quote the value it refused.
    const refused = await thrown(() => database().execute(sql`select ${'anna.berg@example.test'}::uuid`));
    expect((refused.cause as Error).message).toBe('invalid input syntax for type uuid: "anna.berg@example.test"');
    expect(failureDetails(refused)).toEqual({ name: 'DrizzleQueryError', code: '22P02' });
  });
});
async function thrown(run: () => Promise<unknown>) {
  try {
    await run();
  } catch (error) {
    return error as Error;
  }
  throw new Error('The statement was expected to fail');
}

describe('a sign-in Clew refuses sends the person back and writes login-denied, naming the person when one is known', () => {
  // Provisioned people the binding claim can name: Anna has a grant, Bo and Cecilia have none, and Olle has left.
  const refused = 'routes-refused-' + suffix.slice(0, 8),
    anna = refused + '-anna',
    bo = refused + '-bo',
    cecilia = refused + '-cecilia',
    olle = refused + '-olle',
    seeded = [anna, bo, cecilia, olle];
  /** The user name a short name stands for, which is what the binding claim carries. */
  const userName = (name: string) => refused + ':' + name;
  /** An actor in the authentication log as the tests below write it: the short name of a person or of a claim. */
  const short = (actor: string) =>
    actor.replace('person:' + refused + '-', 'person:').replace('claim:' + refused + ':', 'claim:');
  /** The callback's answer to a sign-in it refuses: a 303 back to the sign-in page, which says `denied`. */
  const denied = { status: 303, location: '/login?reason=denied' };
  /** The ids of the authentication log's rows the sign-ins below wrote. */
  const written: number[] = [];
  const log = schema.authenticationAudit;
  beforeAll(async () => {
    await database()
      .insert(schema.people)
      .values(
        seeded.map(id => ({
          id,
          organisationId: 'test',
          name: id,
          userName: userName(id.slice(refused.length + 1)),
          externalId: id,
          enabled: id !== olle,
        })),
      );
    await database()
      .insert(schema.accessGrants)
      .values({ personId: anna, unitId: 'u', unitLabel: 'U', role: 'employee', capabilities: [] });
  });
  afterAll(async () => {
    const db = database();
    await db.delete(schema.sessions).where(inArray(schema.sessions.personId, seeded));
    await db.delete(schema.identityBindings).where(inArray(schema.identityBindings.personId, seeded));
    await db.delete(schema.accessGrants).where(inArray(schema.accessGrants.personId, seeded));
    await db.delete(schema.audit).where(
      inArray(
        schema.audit.subject,
        seeded.map(id => 'person:' + id),
      ),
    );
    await db
      .delete(log)
      .where(
        or(
          inArray(log.id, written),
          like(log.actor, 'person:' + refused + '-%'),
          like(log.actor, 'claim:' + refused + ':%'),
        ),
      );
    await db.delete(schema.people).where(inArray(schema.people.id, seeded));
  });
  /**
   * A sign-in through the callback as the provider's account `subject`, whose ID token carries the user name `name`
   * stands for in the binding claim, or no claim at all: the callback's status, where it sent the person, and the rows
   * the sign-in wrote in the authentication log about these people, their claims or nobody, oldest first, each with its
   * actor shortened. A row without an actor is its action alone.
   */
  async function signInAs(subject: string, name: string | undefined) {
    tokenAnswer = async () =>
      Response.json({
        access_token: 'access-1',
        token_type: 'Bearer',
        expires_in: 300,
        refresh_token: 'refresh-1',
        id_token: await new SignJWT({
          nonce: 'nonce-' + suffix,
          ...(name === undefined ? {} : { preferred_username: userName(name) }),
        })
          .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
          .setIssuer(issuer)
          .setAudience(clientId)
          .setSubject(subject)
          .setIssuedAt()
          .setExpirationTime('5m')
          .sign(keys.privateKey),
      });
    const cookie = await signInStarted();
    const [before] = await database()
      .select({ id: sql<number>`coalesce(max(${log.id}), 0)`.mapWith(Number) })
      .from(log);
    const response = await callback(cookie);
    const rows = await database()
      .select({ id: log.id, action: log.action, actor: log.actor })
      .from(log)
      .where(
        and(
          gt(log.id, before!.id),
          or(
            like(log.actor, 'person:' + refused + '-%'),
            like(log.actor, 'claim:' + refused + ':%'),
            isNull(log.actor),
          ),
        ),
      )
      .orderBy(log.id);
    written.push(...rows.map(row => row.id));
    return {
      status: response.status,
      location: response.headers.get('location'),
      rows: rows.map(({ action, actor }) => (actor ? action + ' ' + short(actor) : action)),
    };
  }
  test('a bound person without a grant is refused at every sign-in, the first login-denied right after identity-bound', async () => {
    expect(await signInAs('sub-bo', 'bo')).toEqual({
      ...denied,
      rows: ['identity-bound person:bo', 'login-denied person:bo'],
    });
    expect(await signInAs('sub-bo', 'bo')).toEqual({ ...denied, rows: ['login-denied person:bo'] });
  });
  test('a changed subject and a claim that names someone else are refused: identity-conflict, then login-denied naming the person', async () => {
    expect(await signInAs('sub-anna', 'anna')).toEqual({
      status: 303,
      location: '/',
      rows: ['identity-bound person:anna', 'login person:anna'],
    });
    // Anna's account was made again at the provider: a new subject with her name, refused on her and naming her.
    expect(await signInAs('sub-anna-2', 'anna')).toEqual({
      ...denied,
      rows: ['identity-conflict person:anna', 'login-denied person:anna'],
    });
    // The provider gave Anna's account the name Cecilia holds in Clew: the conflict is on Cecilia, whom the claim names,
    // and the refusal names Anna, who holds the subject.
    expect(await signInAs('sub-anna', 'cecilia')).toEqual({
      ...denied,
      rows: ['identity-conflict person:cecilia', 'login-denied person:anna'],
    });
    // Only Anna's own sign-in opened a session.
    const opened = await database()
      .select({ personId: schema.sessions.personId })
      .from(schema.sessions)
      .where(inArray(schema.sessions.personId, seeded));
    expect(opened).toEqual([{ personId: anna }]);
  });
  test('a first sign-in whose claim names nobody or a person who has left, or that carries no claim, is refused, and login-denied names the person who has left', async () => {
    expect(await signInAs('sub-x', 'nobody')).toEqual({
      ...denied,
      rows: ['identity-unmatched claim:nobody', 'login-denied'],
    });
    expect(await signInAs('sub-x', 'olle')).toEqual({
      ...denied,
      rows: ['identity-unmatched claim:olle', 'login-denied person:olle'],
    });
    expect(await signInAs('sub-x', undefined)).toEqual({ ...denied, rows: ['login-denied'] });
  });
});

/** One of Anna's sessions, open for an hour, under the provider session `sid-anna` unless the test says otherwise. */
async function session(name: string, values: Partial<typeof schema.sessions.$inferInsert> = {}) {
  const later = new Date(Date.now() + 3600_000);
  const digest = person + ':' + name;
  await database()
    .insert(schema.sessions)
    .values({
      digest,
      personId: person,
      issuer,
      subject: 'sub-anna',
      sid: 'sid-anna',
      clientId,
      csrf: 'csrf',
      tokens: 'sealed-' + name,
      tokenExpiresAt: later,
      idleExpiresAt: later,
      expiresAt: later,
      ...values,
    });
  return digest;
}
const state = async (digest: string) => {
  const [row] = await database()
    .select({ tokens: schema.sessions.tokens, revokedAt: schema.sessions.revokedAt })
    .from(schema.sessions)
    .where(eq(schema.sessions.digest, digest));
  return row && { open: row.revokedAt === null, tokens: row.tokens };
};
const logged = async (action: string) =>
  (
    await database()
      .select({ action: schema.authenticationAudit.action })
      .from(schema.authenticationAudit)
      .where(eq(schema.authenticationAudit.actor, 'person:' + person))
  ).filter(row => row.action === action).length;

describe('a sign-out at the identity provider ends the sessions of its sid', () => {
  test('front-channel: from a cross-site frame without a cookie, every open session of the sid ends, each with its row, with or without the issuer', async () => {
    said.length = 0;
    const laptop = await session('laptop'),
      tablet = await session('tablet'),
      phone = await session('phone', { sid: 'sid-phone' }),
      elsewhere = await session('another-client', { clientId: 'another-client' }),
      earlier = await session('signed-out', { revokedAt: new Date(Date.now() - 60_000), tokens: '' });
    const frame = () =>
      authRoutes.request('/frontchannel-logout?iss=' + encodeURIComponent(issuer) + '&sid=sid-anna', {
        headers: { 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'iframe' },
      });
    const response = await frame();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).toBe('');
    expect(await state(laptop)).toEqual({ open: false, tokens: '' });
    expect(await state(tablet)).toEqual({ open: false, tokens: '' });
    // Another provider session, and another client's sessions under the same sid, are not this logout's.
    expect(await state(phone)).toEqual({ open: true, tokens: 'sealed-phone' });
    expect(await state(elsewhere)).toEqual({ open: true, tokens: 'sealed-another-client' });
    expect(await state(earlier)).toEqual({ open: false, tokens: '' });
    expect(await logged('frontchannel-logout')).toBe(2);
    // The provider may load the frame again: nothing more ends and nothing more is written.
    expect((await frame()).status).toBe(200);
    expect(await logged('frontchannel-logout')).toBe(2);
    // Another issuer ends nothing.
    const refused = await authRoutes.request('/frontchannel-logout?iss=https://other.example.test&sid=sid-phone');
    expect(refused.status).toBe(400);
    expect(await state(phone)).toEqual({ open: true, tokens: 'sealed-phone' });
    // Only the sid, as Microsoft Entra ID has been reported to send it: the configured issuer's sessions of that sid end.
    const sidOnly = await authRoutes.request('/frontchannel-logout?sid=sid-phone');
    expect(sidOnly.status).toBe(200);
    expect(await state(phone)).toEqual({ open: false, tokens: '' });
    expect(await logged('frontchannel-logout')).toBe(3);
    expect(said.map(line => line.message)).toEqual(['front-channel logout refused']);
  });
  test('back-channel: a logout token ends the sessions of its sid as before, and a replayed token ends nothing', async () => {
    said.length = 0;
    const desktop = await session('desktop', { sid: 'sid-desktop' });
    const token = await new SignJWT({
      sid: 'sid-desktop',
      events: { 'http://schemas.openid.net/event/backchannel-logout': {} },
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuer(issuer)
      .setAudience(clientId)
      .setJti('jti-' + suffix)
      .setIssuedAt()
      .sign(keys.privateKey);
    const post = () =>
      authRoutes.request('/backchannel-logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ logout_token: token }).toString(),
      });
    const response = await post();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await state(desktop)).toEqual({ open: false, tokens: '' });
    expect(await logged('backchannel-logout')).toBe(1);
    // A session opened since is not ended by the same token again: its receipt says it was received.
    const again = await session('desktop-again', { sid: 'sid-desktop' });
    expect((await post()).status).toBe(200);
    expect(await state(again)).toEqual({ open: true, tokens: 'sealed-desktop-again' });
    expect(await logged('backchannel-logout')).toBe(1);
    expect(said).toEqual([]);
  });
});

describe('the session cookie is read under its __Host- name only (D145)', () => {
  const asSent = (cookie: string, extra: Record<string, string> = {}) => ({ headers: { Cookie: cookie, ...extra } });
  test('a bare clew-session from a sibling host reaches no session; the __Host- one does', async () => {
    const raw = randomToken();
    const digest = tokenDigest(raw);
    await session('cookie-read', { digest });
    const bare = await authRoutes.request('/session', asSent('clew-session=' + raw));
    expect(bare.status).toBe(401);
    expect(await state(digest)).toEqual({ open: true, tokens: 'sealed-cookie-read' });
    // The prefixed one reaches the session: here it names a person nobody signs in as, so it is refused and ended.
    const own = await authRoutes.request('/session', asSent('__Host-clew-session=' + raw));
    expect(own.status).toBe(403);
    expect(await state(digest)).toEqual({ open: false, tokens: '' });
  });
  test('a sign-out ends the session of the __Host- cookie, never one a bare cookie names', async () => {
    const raw = randomToken();
    const digest = tokenDigest(raw);
    await session('cookie-logout', { digest });
    const signOut = (cookie: string) =>
      authRoutes.request('/logout', {
        method: 'POST',
        ...asSent(cookie, { Origin: settings.PUBLIC_URL!, 'X-CSRF-Token': 'csrf' }),
      });
    const bare = await signOut('clew-session=' + raw);
    expect(bare.status).toBe(200);
    expect(await state(digest)).toEqual({ open: true, tokens: 'sealed-cookie-logout' });
    const own = await signOut('__Host-clew-session=' + raw);
    expect(own.status).toBe(200);
    expect(await state(digest)).toEqual({ open: false, tokens: '' });
    expect(own.headers.get('set-cookie')).toStartWith('__Host-clew-session=;');
  });
});

/** The Set-Cookie line a response sets for the cookie `name`: the line, the cookie's value and its attributes in order. */
function cookieSet(response: Response, name: string) {
  const line = response.headers.getSetCookie().find(candidate => candidate.startsWith(name + '='));
  if (line === undefined) return undefined;
  const [pair, ...attributes] = line.split('; ');
  return { line, value: pair!.slice(name.length + 1), attributes };
}
const authLog = schema.authenticationAudit;
/** The newest row of the authentication log, so that a step's own rows can be read after it. */
const mark = async () =>
  (
    await database()
      .select({ id: sql<number>`coalesce(max(${authLog.id}), 0)`.mapWith(Number) })
      .from(authLog)
  )[0]!.id;
/** The actions the authentication log holds about `personId` after the row `after`, oldest first. */
const loggedSince = async (personId: string, after: number) =>
  (
    await database()
      .select({ action: authLog.action })
      .from(authLog)
      .where(and(gt(authLog.id, after), eq(authLog.actor, 'person:' + personId)))
      .orderBy(authLog.id)
  ).map(row => row.action);
/** Provisioned people for a describe, enabled and with a grant each, whom a sign-in binds by their user name. */
async function seed(people: Array<{ id: string; userName: string; name: string }>) {
  await database()
    .insert(schema.people)
    .values(people.map(p => ({ ...p, organisationId: 'test', externalId: p.id, enabled: true })));
  await database()
    .insert(schema.accessGrants)
    .values(people.map(p => grantOf(p.id)));
}
const grantOf = (personId: string) => ({
  personId,
  unitId: 'u',
  unitLabel: 'U',
  role: 'employee' as const,
  capabilities: [] as string[],
});
/** Removes people a describe seeded, with everything their sign-ins wrote. */
async function removePeople(ids: string[]) {
  const db = database(),
    actors = ids.map(id => 'person:' + id);
  await db.delete(schema.sessions).where(inArray(schema.sessions.personId, ids));
  await db.delete(schema.identityBindings).where(inArray(schema.identityBindings.personId, ids));
  await db.delete(schema.accessGrants).where(inArray(schema.accessGrants.personId, ids));
  await db.delete(schema.audit).where(inArray(schema.audit.subject, actors));
  await db.delete(authLog).where(inArray(authLog.actor, actors));
  await db.delete(schema.people).where(inArray(schema.people.id, ids));
}

describe('a sign-in that succeeds, and the session it opens until it ends (ID-9)', () => {
  const prefix = 'routes-signin-' + suffix.slice(0, 8),
    eva = prefix + '-eva',
    evaName = prefix + '.eva',
    subject = 'sub-' + prefix;
  const sessionCookie = (raw: string) => ({ Cookie: '__Host-clew-session=' + raw });
  beforeAll(() => seed([{ id: eva, userName: evaName, name: 'Eva Ek' }]));
  afterAll(() => removePeople([eva]));
  /**
   * A sign-in as Eva from `/login` through the provider to `/callback`, in a browser that also holds the session cookie
   * `earlier` when one is given: the answers of both routes and the session cookie the callback set.
   */
  async function signInAsEva(returnTo: string, earlier?: string) {
    const started = await authRoutes.request('/login?returnTo=' + encodeURIComponent(returnTo));
    const at = new URL(started.headers.get('location')!);
    const login = cookieSet(started, '__Host-clew-login')!;
    digests.push(tokenDigest(login.value));
    tokenAnswer = async () =>
      Response.json({
        access_token: 'access-1',
        token_type: 'Bearer',
        expires_in: 300,
        refresh_token: 'refresh-1',
        id_token: await new SignJWT({
          nonce: at.searchParams.get('nonce')!,
          sid: 'sid-' + prefix,
          preferred_username: evaName,
        })
          .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
          .setIssuer(issuer)
          .setAudience(clientId)
          .setSubject(subject)
          .setIssuedAt()
          .setExpirationTime('5m')
          .sign(keys.privateKey),
      });
    const cookies = ['__Host-clew-login=' + login.value, ...(earlier ? ['__Host-clew-session=' + earlier] : [])];
    const response = await authRoutes.request('/callback?code=code-1&state=' + at.searchParams.get('state'), {
      headers: { Cookie: cookies.join('; ') },
    });
    return { started, login: login.value, response, session: cookieSet(response, '__Host-clew-session')?.value };
  }
  const csrfOf = async (raw: string) =>
    ((await (await authRoutes.request('/session', { headers: sessionCookie(raw) })).json()) as { csrfToken: string })
      .csrfToken;

  test('a sign-in from /login through /callback opens one session, writes identity-bound and login, and returns with the query', async () => {
    const before = await mark();
    const { started, login, response, session } = await signInAsEva('/calendar?week=48');
    // Both cookies are HttpOnly, Secure and SameSite=Lax under the __Host- prefix: the sign-in's for its five minutes,
    // the session's for eight hours.
    expect(started.status).toBe(303);
    expect(cookieSet(started, '__Host-clew-login')!.attributes).toEqual([
      'Max-Age=300',
      'Path=/',
      'HttpOnly',
      'Secure',
      'SameSite=Lax',
    ]);
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/calendar?week=48');
    expect(cookieSet(response, '__Host-clew-session')!.attributes).toEqual([
      'Max-Age=28800',
      'Path=/',
      'HttpOnly',
      'Secure',
      'SameSite=Lax',
    ]);
    // The callback clears the sign-in's cookie and has used up its row.
    expect(cookieSet(response, '__Host-clew-login')!.line).toBe('__Host-clew-login=; Max-Age=0; Path=/; Secure');
    const left = await database()
      .select()
      .from(schema.loginTransactions)
      .where(eq(schema.loginTransactions.digest, tokenDigest(login)));
    expect(left).toEqual([]);
    const [row] = await database()
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.digest, tokenDigest(session!)));
    expect(row).toMatchObject({ personId: eva, issuer, subject, sid: 'sid-' + prefix, clientId, revokedAt: null });
    // The provider's tokens are kept sealed, and the session has a CSRF token of its own.
    expect(row!.tokens).not.toContain('refresh-1');
    expect(row!.tokens).not.toContain('access-1');
    expect(row!.csrf).toHaveLength(43);
    expect(Math.abs(row!.expiresAt.getTime() - (Date.now() + 8 * 3600_000))).toBeLessThan(60_000);
    expect(await loggedSince(eva, before)).toEqual(['identity-bound', 'login']);
    const answer = await authRoutes.request('/session', { headers: sessionCookie(session!) });
    expect(answer.status).toBe(200);
    expect(await answer.json()).toMatchObject({ csrfToken: row!.csrf });
  });
  test('the return address a sign-in starts with keeps its query, and is the home page when it would leave the installation', async () => {
    const kept = async (returnTo: string) => {
      const started = await authRoutes.request('/login?returnTo=' + encodeURIComponent(returnTo));
      const digest = tokenDigest(cookieSet(started, '__Host-clew-login')!.value);
      digests.push(digest);
      const [row] = await database()
        .select({ returnTo: schema.loginTransactions.returnTo })
        .from(schema.loginTransactions)
        .where(eq(schema.loginTransactions.digest, digest));
      return row?.returnTo;
    };
    expect(await kept('/items/abc?step=2')).toBe('/items/abc?step=2');
    for (const away of [
      '//evil.example/x',
      'https://evil.example/x',
      '/\\evil.example',
      '/api/session',
      '/login?reason=expired',
    ])
      expect(await kept(away)).toBe('/');
  });
  test('a second sign-in in the same browser replaces the first: login, then replaced, and only the new session is open', async () => {
    const first = (await signInAsEva('/')).session!;
    // A sign-in in another browser sends no session cookie and replaces nothing.
    const elsewhere = (await signInAsEva('/')).session!;
    const before = await mark();
    const second = await signInAsEva('//evil.example/x', first);
    expect(second.response.headers.get('location')).toBe('/');
    expect(await loggedSince(eva, before)).toEqual(['login', 'replaced']);
    expect(await state(tokenDigest(first))).toEqual({ open: false, tokens: '' });
    expect((await state(tokenDigest(second.session!)))?.open).toBe(true);
    expect((await state(tokenDigest(elsewhere)))?.open).toBe(true);
  });
  test('a write through the session needs the public origin and the session’s CSRF token; anything else is 403 invalid and changes nothing', async () => {
    const raw = (await signInAsEva('/')).session!,
      digest = tokenDigest(raw),
      csrf = await csrfOf(raw);
    const idle = async () =>
      (
        await database()
          .select({ at: schema.sessions.idleExpiresAt })
          .from(schema.sessions)
          .where(eq(schema.sessions.digest, digest))
      )[0]!.at.getTime();
    const signedIn = await idle();
    const activity = (headers: Record<string, string>) =>
      authRoutes.request('/activity', { method: 'POST', headers: { ...sessionCookie(raw), ...headers } });
    const refusedHeaders: Array<Record<string, string>> = [
      { 'X-CSRF-Token': csrf },
      { Origin: 'https://evil.example', 'X-CSRF-Token': csrf },
      { Origin: settings.PUBLIC_URL! },
      { Origin: settings.PUBLIC_URL!, 'X-CSRF-Token': csrf.slice(1) },
      { Origin: settings.PUBLIC_URL!, 'X-CSRF-Token': randomToken() },
    ];
    for (const headers of refusedHeaders) {
      const refused = await activity(headers);
      expect(refused.status).toBe(403);
      expect(await refused.json()).toEqual({ error: 'Du saknar behörighet för åtgärden.', code: 'invalid' });
    }
    expect(await idle()).toBe(signedIn);
    expect((await state(digest))?.open).toBe(true);
    const passed = await activity({ Origin: settings.PUBLIC_URL!, 'X-CSRF-Token': csrf });
    expect(passed.status).toBe(200);
    expect(await passed.json()).toEqual({ expiresAt: expect.any(String) });
  });
  test('a person who is deactivated, or loses the grant, is signed out at the next request with access-revoked', async () => {
    const ask = (raw: string) => authRoutes.request('/session', { headers: sessionCookie(raw) });
    const deniedAnswer = { error: 'Du saknar behörighet för åtgärden.', code: 'denied' };
    try {
      const deactivated = (await signInAsEva('/')).session!;
      await database().update(schema.people).set({ enabled: false }).where(eq(schema.people.id, eva));
      let before = await mark();
      const refused = await ask(deactivated);
      expect(refused.status).toBe(403);
      expect(await refused.json()).toEqual(deniedAnswer);
      expect(await loggedSince(eva, before)).toEqual(['access-revoked']);
      expect(await state(tokenDigest(deactivated))).toEqual({ open: false, tokens: '' });
      // Taken back, the person signs in again: the ended session stays ended.
      await database().update(schema.people).set({ enabled: true }).where(eq(schema.people.id, eva));
      expect((await ask(deactivated)).status).toBe(401);
      const ungranted = (await signInAsEva('/')).session!;
      await database().delete(schema.accessGrants).where(eq(schema.accessGrants.personId, eva));
      before = await mark();
      const withoutGrant = await ask(ungranted);
      expect(withoutGrant.status).toBe(403);
      expect(await withoutGrant.json()).toEqual(deniedAnswer);
      expect(await loggedSince(eva, before)).toEqual(['access-revoked']);
      expect(await state(tokenDigest(ungranted))).toEqual({ open: false, tokens: '' });
    } finally {
      await database().update(schema.people).set({ enabled: true }).where(eq(schema.people.id, eva));
      await database().insert(schema.accessGrants).values(grantOf(eva)).onConflictDoNothing();
    }
  });
  test('a sign-out needs the session’s CSRF token; it ends the session with logout and sends the person to the sign-in page', async () => {
    const raw = (await signInAsEva('/')).session!,
      digest = tokenDigest(raw),
      csrf = await csrfOf(raw);
    const signOut = (headers: Record<string, string>) =>
      authRoutes.request('/logout', { method: 'POST', headers: { ...sessionCookie(raw), ...headers } });
    const before = await mark();
    const refusedHeaders: Array<Record<string, string>> = [
      { Origin: settings.PUBLIC_URL!, 'X-CSRF-Token': 'not-the-token' },
      { Origin: settings.PUBLIC_URL! },
      { Origin: 'https://evil.example', 'X-CSRF-Token': csrf },
      { 'X-CSRF-Token': csrf },
    ];
    for (const headers of refusedHeaders) {
      const refused = await signOut(headers);
      expect(refused.status).toBe(403);
      expect(await refused.json()).toEqual({ error: 'Utloggningen kunde inte bekräftas. Försök igen.' });
    }
    expect((await state(digest))?.open).toBe(true);
    const done = await signOut({ Origin: settings.PUBLIC_URL!, 'X-CSRF-Token': csrf });
    expect(done.status).toBe(200);
    // This provider names no end-session endpoint, so the person goes to Clew's own sign-in page.
    expect(await done.json()).toEqual({ url: settings.PUBLIC_URL + '/login' });
    expect(done.headers.get('set-cookie')).toStartWith('__Host-clew-session=;');
    expect(await state(digest)).toEqual({ open: false, tokens: '' });
    expect(await loggedSince(eva, before)).toEqual(['logout']);
    expect((await authRoutes.request('/session', { headers: sessionCookie(raw) })).status).toBe(401);
  });
});

describe('a development sign-in opens its session as login-dev, under bare cookie names on the local stack (ID-9, D6)', () => {
  const prefix = 'routes-dev-' + suffix.slice(0, 8),
    olof = prefix + '-olof',
    olofName = prefix + '.olof';
  // The local stack: Keycloak on keycloak.orb.local and Clew on localhost, both on plain http.
  const devIssuer = 'http://keycloak.orb.local/realms/dev-' + suffix,
    devOrigin = 'http://localhost:3020';
  const local: Record<string, string> = {
    OIDC_ISSUER: devIssuer,
    PUBLIC_URL: devOrigin,
    AUTH_LOCAL_HTTP: 'true',
    AUTH_DEV_LOGIN: 'true',
    AUTH_DEV_ACCOUNTS: olofName + ':synthetic-password',
    FRONTEND_ORIGINS: '',
  };
  const outside: Record<string, string | undefined> = {};
  /** The grants the provider's token endpoint was asked for: the grant type and the account. */
  const grants: string[] = [];
  let served: typeof fetch;
  beforeAll(async () => {
    await seed([{ id: olof, userName: olofName, name: 'Olof Dev' }]);
    for (const [k, v] of Object.entries(local)) {
      outside[k] = process.env[k];
      process.env[k] = v;
    }
    served = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url === devIssuer + '/.well-known/openid-configuration')
        return Response.json({
          issuer: devIssuer,
          authorization_endpoint: devIssuer + '/auth',
          token_endpoint: devIssuer + '/token',
          jwks_uri: devIssuer + '/certs',
        });
      if (url === devIssuer + '/certs') return Response.json(jwks);
      if (url === devIssuer + '/token') {
        const body = new URLSearchParams(input instanceof Request ? await input.text() : String(init?.body ?? ''));
        grants.push(body.get('grant_type') + ' ' + body.get('username'));
        return Response.json({
          access_token: 'access-dev',
          token_type: 'Bearer',
          expires_in: 300,
          refresh_token: 'refresh-dev',
          id_token: await new SignJWT({ preferred_username: body.get('username') })
            .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
            .setIssuer(devIssuer)
            .setAudience(clientId)
            .setSubject('sub-' + prefix)
            .setIssuedAt()
            .setExpirationTime('5m')
            .sign(keys.privateKey),
        });
      }
      return served(input, init);
    }) as typeof fetch;
  });
  afterAll(async () => {
    globalThis.fetch = served;
    for (const [k, v] of Object.entries(outside))
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    await removePeople([olof]);
  });
  const devSignIn = (query: string, cookie?: string) =>
    authRoutes.request('/dev/login?' + query, cookie ? { headers: { Cookie: 'clew-session=' + cookie } } : {});

  test('the sign-in page lists the persona; one click signs in by the password grant, writes login-dev and sets clew-session without Secure', async () => {
    expect(await (await authRoutes.request('/dev')).json()).toEqual({
      accounts: [{ userName: olofName, name: 'Olof Dev' }],
    });
    const before = await mark();
    const response = await devSignIn(
      'as=' + encodeURIComponent(olofName) + '&returnTo=' + encodeURIComponent('/calendar?week=48'),
    );
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/calendar?week=48');
    expect(grants).toEqual(['password ' + olofName]);
    // Plain http keeps no __Host- cookie and no Secure one; the rest is as anywhere.
    const session = cookieSet(response, 'clew-session')!;
    expect(session.attributes).toEqual(['Max-Age=28800', 'Path=/', 'HttpOnly', 'SameSite=Lax']);
    expect(await loggedSince(olof, before)).toEqual(['identity-bound', 'login-dev']);
    const [row] = await database()
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.digest, tokenDigest(session.value)));
    expect(row).toMatchObject({ personId: olof, issuer: devIssuer, subject: 'sub-' + prefix, revokedAt: null });
  });
  test('a second development sign-in in the same browser replaces the first; an unknown persona is refused before the provider is asked', async () => {
    const first = cookieSet(await devSignIn('as=' + olofName), 'clew-session')!.value;
    const before = await mark();
    const second = await devSignIn('as=' + olofName, first);
    expect(second.headers.get('location')).toBe('/');
    expect(await loggedSince(olof, before)).toEqual(['login-dev', 'replaced']);
    expect(await state(tokenDigest(first))).toEqual({ open: false, tokens: '' });
    grants.length = 0;
    const unknown = await devSignIn('as=nobody.' + prefix);
    expect(unknown.status).toBe(303);
    expect(unknown.headers.get('location')).toBe('/login?reason=invalid');
    expect(grants).toEqual([]);
  });
  test('a development session signs out as any other: logout, and the sign-in page on the local origin', async () => {
    const raw = cookieSet(await devSignIn('as=' + olofName), 'clew-session')!.value;
    const session = await authRoutes.request('/session', { headers: { Cookie: 'clew-session=' + raw } });
    const { csrfToken } = (await session.json()) as { csrfToken: string };
    const before = await mark();
    const out = await authRoutes.request('/logout', {
      method: 'POST',
      headers: { Cookie: 'clew-session=' + raw, Origin: devOrigin, 'X-CSRF-Token': csrfToken },
    });
    expect(out.status).toBe(200);
    expect(await out.json()).toEqual({ url: devOrigin + '/login' });
    expect(out.headers.get('set-cookie')).toStartWith('clew-session=;');
    expect(await loggedSince(olof, before)).toEqual(['logout']);
    expect(await state(tokenDigest(raw))).toEqual({ open: false, tokens: '' });
  });
});
