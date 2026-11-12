import { afterAll, beforeAll, expect, test } from 'bun:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { database, schema } from '../../packages/db/src/index';
import { revokeSession, storeRefreshedTokens } from '../../packages/db/src/auth';
import { encryptTokens, randomToken, tokenDigest } from '../../apps/server/src/auth-crypto';

/**
 * Refreshing a session's IdP tokens on PostgreSQL (L1 and L4 of the 2026-11-12 users review). No connection is held while
 * the provider answers, so new tokens are stored only over the ones they were refreshed from. A provider that cannot be
 * reached keeps the session and its tokens: the person's own requests go on, and delegation answers 503. The provider
 * here is a name that does not resolve, so every refresh fails to connect; the failure classes of an answering provider
 * are in `tests/unit/auth-refresh.test.ts`. Run with `bun run test:db` inside the devcontainer.
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
  const stored = await storeRefreshedTokens(digest, 'sealed-before', { tokens: 'sealed-after', tokenExpiresAt: soon });
  expect(stored?.tokens).toBe('sealed-after');
  expect(stored?.tokenExpiresAt.getTime()).toBe(soon.getTime());
  // Another refresh from the old tokens lost the race: nothing is stored, and the winner's tokens stand.
  expect(await storeRefreshedTokens(digest, 'sealed-before', { tokens: 'sealed-late', tokenExpiresAt: soon })).toBe(
    undefined,
  );
  expect((await row(digest)).tokens).toBe('sealed-after');
  await revokeSession(digest);
  expect(await storeRefreshedTokens(digest, '', { tokens: 'sealed-revoked', tokenExpiresAt: soon })).toBe(undefined);
  expect((await row(digest)).tokens).toBe('');
});
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
