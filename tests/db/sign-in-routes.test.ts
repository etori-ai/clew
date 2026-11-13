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
 * provider ends the sessions of its `sid` by either channel (D118): front-channel logout from a cross-site frame
 * without a cookie, back-channel logout as before, with its receipt against a replayed token. The server's logger is
 * watched while the file runs. Run with `bun run test:db` inside the devcontainer.
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
