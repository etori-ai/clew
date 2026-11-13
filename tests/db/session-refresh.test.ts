import { afterAll, beforeAll, expect, test } from 'bun:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { database, databaseAnswers, schema } from '../../packages/db/src/index';
import {
  claimSessionRefresh,
  readSession,
  releaseSessionRefresh,
  revokeSession,
  storeRefreshedTokens,
} from '../../packages/db/src/auth';
import { REFRESH_CLAIM_MS, sessionRefresher } from '../../apps/server/src/auth-refresh';
import { decryptTokens, encryptTokens, randomToken, tokenDigest } from '../../apps/server/src/auth-crypto';

/**
 * Refreshing a session's IdP tokens on PostgreSQL (L1 and L4 of the 2026-11-12 users review), through the server's own
 * `authenticate`. No connection is held while the provider answers, so new tokens are stored only over the ones they
 * were refreshed from, and more sessions than the pool has connections can wait for the provider at once. A provider
 * that cannot be reached keeps the session and its tokens: the person's own requests go on, and delegation answers
 * 503. The provider is a name that does not resolve, so every refresh fails to connect, except where a test answers
 * for it in place of the network; the failure classes of an answering provider are in
 * `tests/unit/auth-refresh.test.ts`. Run with `bun run test:db` inside the devcontainer.
 */
if (!process.env.DATABASE_URL)
  throw new Error('DATABASE_URL is not set. Run `bun run test:db` inside the devcontainer.');
const settings: Record<string, string> = {
  OIDC_ISSUER: 'https://idp.example.test/realms/clew',
  OIDC_CLIENT_ID: 'clew-refresh-test',
  OIDC_CLIENT_SECRET: 'synthetic-secret',
  PUBLIC_URL: 'https://clew.example.test',
};
const previous: Record<string, string | undefined> = {};
const person = 'refresh-test-' + randomUUID(),
  subject = 'subject-' + person,
  digests: string[] = [];
beforeAll(async () => {
  process.env.MASTER_KEY ??= randomBytes(32).toString('base64');
  for (const [k, v] of Object.entries(settings)) {
    previous[k] = process.env[k];
    process.env[k] = v;
  }
  await database().insert(schema.people).values({ id: person, organisationId: 'test', name: 'Synthetic refresh test' });
  await database()
    .insert(schema.accessGrants)
    .values({ personId: person, unitId: 'test', unitLabel: 'Test', role: 'employee', capabilities: [] });
  await database().insert(schema.identityBindings).values({ issuer: settings.OIDC_ISSUER!, subject, personId: person });
});
afterAll(async () => {
  for (const [k, v] of Object.entries(previous))
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  if (digests.length) await database().delete(schema.sessions).where(inArray(schema.sessions.digest, digests));
  await database()
    .delete(schema.authenticationAudit)
    .where(eq(schema.authenticationAudit.actor, 'person:' + person));
  await database().delete(schema.identityBindings).where(eq(schema.identityBindings.personId, person));
  await database().delete(schema.accessGrants).where(eq(schema.accessGrants.personId, person));
  await database().delete(schema.people).where(eq(schema.people.id, person));
});
/** A session whose access token has expired, with real sealed tokens; returns its cookie value and digest. */
async function session(tokens = 'sealed-before') {
  const raw = randomToken(),
    digest = tokenDigest(raw),
    later = new Date(Date.now() + 3600_000);
  digests.push(digest);
  await database()
    .insert(schema.sessions)
    .values({
      digest,
      personId: person,
      issuer: settings.OIDC_ISSUER!,
      subject,
      clientId: settings.OIDC_CLIENT_ID!,
      csrf: 'csrf',
      tokens:
        tokens === 'real'
          ? encryptTokens({ access_token: 'access-1', refresh_token: 'refresh-1', id_token: 'id-1' }, digest)
          : tokens,
      tokenExpiresAt: new Date(Date.now() - 60_000),
      idleExpiresAt: later,
      expiresAt: later,
    });
  return { raw, digest };
}
const row = async (digest: string) =>
  (await database().select().from(schema.sessions).where(eq(schema.sessions.digest, digest)))[0]!;
test('refreshed tokens are stored only over the ones they were refreshed from, and only on an active session', async () => {
  const { digest } = await session();
  const soon = new Date(Date.now() + 300_000);
  await claimSessionRefresh(digest, 'sealed-before', { id: 'owner', until: soon });
  expect(
    await storeRefreshedTokens(digest, 'sealed-before', 'somebody-else', { tokens: 'wrong', tokenExpiresAt: soon }),
  ).toBe(undefined);
  const stored = await storeRefreshedTokens(digest, 'sealed-before', 'owner', {
    tokens: 'sealed-after',
    tokenExpiresAt: soon,
  });
  expect(stored?.tokens).toBe('sealed-after');
  expect(stored?.tokenExpiresAt.getTime()).toBe(soon.getTime());
  // Another refresh from the old tokens lost the race: nothing is stored, and the winner's tokens stand.
  expect(stored?.refreshClaim).toBeNull();
  expect(stored?.refreshClaimUntil).toBeNull();
  expect(
    await storeRefreshedTokens(digest, 'sealed-before', 'owner', { tokens: 'sealed-late', tokenExpiresAt: soon }),
  ).toBe(undefined);
  expect((await row(digest)).tokens).toBe('sealed-after');
  await revokeSession(digest);
  expect(await storeRefreshedTokens(digest, '', 'owner', { tokens: 'sealed-revoked', tokenExpiresAt: soon })).toBe(
    undefined,
  );
  expect((await row(digest)).tokens).toBe('');
});
test('a token generation has one owner across concurrent connections, and only that owner can release or end it', async () => {
  const { digest } = await session();
  const until = new Date(Date.now() + REFRESH_CLAIM_MS);
  const claims = await Promise.all(
    ['first', 'second'].map(id => claimSessionRefresh(digest, 'sealed-before', { id, until })),
  );
  expect(claims.filter(Boolean)).toHaveLength(1);
  const owner = claims.find(Boolean)!.refreshClaim!;
  await releaseSessionRefresh(digest, 'sealed-before', 'not-the-owner');
  expect((await row(digest)).refreshClaim).toBe(owner);
  expect(await revokeSession(digest, 'refresh-failed', { tokens: 'sealed-before', claim: 'not-the-owner' })).toBe(
    false,
  );
  expect((await row(digest)).revokedAt).toBeNull();
  await releaseSessionRefresh(digest, 'sealed-before', owner);
  expect((await row(digest)).refreshClaim).toBeNull();
  expect(await claimSessionRefresh(digest, 'sealed-before', { id: 'next', until })).toBeDefined();
  await storeRefreshedTokens(digest, 'sealed-before', 'next', { tokens: 'new-generation', tokenExpiresAt: until });
  expect(await revokeSession(digest, 'refresh-failed', { tokens: 'sealed-before', claim: 'next' })).toBe(false);
  expect((await row(digest)).tokens).toBe('new-generation');
  await revokeSession(digest);
  expect(await claimSessionRefresh(digest, '', { id: 'after-logout', until })).toBeUndefined();
});
test('an abandoned claim is not stolen and its fenced termination cannot revoke a newer generation', async () => {
  const { digest } = await session();
  await claimSessionRefresh(digest, 'sealed-before', { id: 'abandoned', until: new Date(Date.now() - 1) });
  expect(
    await claimSessionRefresh(digest, 'sealed-before', { id: 'retry', until: new Date(Date.now() + REFRESH_CLAIM_MS) }),
  ).toBeUndefined();
  expect(await revokeSession(digest, 'refresh-failed', { tokens: 'sealed-before', claim: 'abandoned' })).toBe(true);
  expect((await row(digest)).tokens).toBe('');
  expect((await row(digest)).refreshClaim).toBeNull();
});
test('two BFF instances use one real database claim and can renew again without reusing a rotating token', async () => {
  const { digest } = await session('real');
  let now = Date.now();
  const entered = Promise.withResolvers<void>(),
    answer = Promise.withResolvers<void>();
  const used: string[] = [];
  let first: Promise<unknown>;
  const replica = () =>
    sessionRefresher({
      clock: () => now,
      ids: randomToken,
      read: readSession,
      claim: claimSessionRefresh,
      release: releaseSessionRefresh,
      store: storeRefreshedTokens,
      end: revokeSession,
      open: decryptTokens,
      seal: encryptTokens,
      async grant(token) {
        if (used.includes(token)) throw new Error('token family revoked by reuse');
        used.push(token);
        if (used.length === 1) {
          entered.resolve();
          await answer.promise;
        }
        return {
          access_token: 'access-' + (used.length + 1),
          refresh_token: 'refresh-' + (used.length + 1),
          expires_in: 300,
        };
      },
      ended: () => true,
      failed: () => {
        throw new Error('unexpected provider failure');
      },
      async sleep() {
        answer.resolve();
        await first;
      },
    });
  const a = replica(),
    b = replica(),
    original = await row(digest);
  first = a.refresh(original);
  await entered.promise;
  const results = await Promise.all([first, b.refresh(original)]);
  expect(results).toMatchObject([{ state: 'fresh' }, { state: 'fresh' }]);
  expect(used).toEqual(['refresh-1']);
  expect((await row(digest)).refreshClaim).toBeNull();
  now += 300_000;
  expect((await b.refresh(await row(digest))).state).toBe('fresh');
  expect(used).toEqual(['refresh-1', 'refresh-2']);
}, 10_000);
test('a provider that cannot be reached keeps the session and its tokens, and delegation answers 503', async () => {
  const { authenticate } = await import('../../apps/server/src/auth');
  const { raw, digest } = await session('real');
  const before = await row(digest);
  const logged = async () =>
    (
      await database()
        .select({ action: schema.authenticationAudit.action })
        .from(schema.authenticationAudit)
        .where(eq(schema.authenticationAudit.actor, 'person:' + person))
    ).length;
  const rows = await logged();
  const signedIn = await authenticate(raw);
  expect(signedIn.context.id).toBe(person);
  await expect(signedIn.context.delegate!('nextcloud')).rejects.toMatchObject({ status: 503, code: 'unavailable' });
  // And again, inside the wait after the failure: still signed in, still no token.
  expect((await authenticate(raw)).context.id).toBe(person);
  const after = await row(digest);
  expect(after.revokedAt).toBeNull();
  expect(after.tokens).toBe(before.tokens);
  expect(after.tokenExpiresAt.getTime()).toBe(before.tokenExpiresAt.getTime());
  // Nothing ended the session, so the authentication log has no row of it.
  expect(await logged()).toBe(rows);
}, 20_000);
test('refreshes waiting for the provider hold no connection, more of them at once than the pool has', async () => {
  const { authenticate } = await import('../../apps/server/src/auth');
  const issuer = settings.OIDC_ISSUER!;
  // Eight sessions refresh at once against the pool's five connections.
  const waiting = await Promise.all(Array.from({ length: 8 }, () => session('real')));
  const answer = Promise.withResolvers<void>();
  let asked = 0;
  const network = globalThis.fetch;
  // The identity provider, in place of the network: discovery answers at once, the token endpoint when the test says.
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url === issuer + '/.well-known/openid-configuration')
      return Response.json({
        issuer,
        authorization_endpoint: issuer + '/auth',
        token_endpoint: issuer + '/token',
        jwks_uri: issuer + '/certs',
      });
    if (url !== issuer + '/token') return network(input, init);
    asked++;
    await Promise.race([
      answer.promise,
      new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal!.reason))),
    ]);
    return Response.json({
      access_token: 'access-2',
      token_type: 'Bearer',
      expires_in: 300,
      refresh_token: 'refresh-2',
    });
  }) as typeof fetch;
  const signedIn = Promise.allSettled(waiting.map(s => authenticate(s.raw)));
  try {
    for (const until = Date.now() + 4000; asked < waiting.length && Date.now() < until;)
      await new Promise(resolve => setTimeout(resolve, 10));
    // Every refresh is at the provider, none holds a connection, and the database answers the next query.
    expect(asked).toBe(waiting.length);
    expect(await databaseAnswers(1000)).toBe(true);
    answer.resolve();
    expect((await signedIn).map(s => s.status === 'fulfilled' && s.value.context.id)).toEqual(
      waiting.map(() => person),
    );
    for (const { digest } of waiting)
      expect(decryptTokens((await row(digest)).tokens, digest)).toEqual({
        access_token: 'access-2',
        refresh_token: 'refresh-2',
        id_token: 'id-1',
      });
  } finally {
    // Whatever was asserted, every request ends before the provider is the network's again.
    answer.resolve();
    await signedIn;
    globalThis.fetch = network;
  }
}, 20_000);
