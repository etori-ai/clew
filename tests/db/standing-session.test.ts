import { afterAll, beforeAll, expect, test } from 'bun:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { database, schema } from '../../packages/db/src/index';
import { IDLE_MS, revokeSession, touchSession } from '../../packages/db/src/auth';
import { randomToken, tokenDigest } from '../../apps/server/src/auth-crypto';
import { ForbiddenError } from '../../apps/server/src/context';

/**
 * `standingSession` (D26): what a kept binding names when background work asks, read from the real session table. The
 * sessions here hold no IdP tokens, so no identity provider is needed: a live one yields a delegate whose token is
 * undefined, and every refusal happens before any exchange would.
 */
const settings: Record<string, string> = {
  OIDC_ISSUER: 'https://idp.example.test/realms/clew',
  OIDC_CLIENT_ID: 'clew-standing-test',
  OIDC_CLIENT_SECRET: 'synthetic-secret',
  PUBLIC_URL: 'https://clew.example.test',
};
const previous: Record<string, string | undefined> = {};
const people: string[] = [],
  digests: string[] = [];
beforeAll(() => {
  process.env.MASTER_KEY ??= randomBytes(32).toString('base64');
  for (const [k, v] of Object.entries(settings)) {
    previous[k] = process.env[k];
    process.env[k] ??= v;
  }
});
afterAll(async () => {
  for (const [k, v] of Object.entries(previous))
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  if (digests.length) await database().delete(schema.sessions).where(inArray(schema.sessions.digest, digests));
  if (people.length) {
    await database()
      .delete(schema.authenticationAudit)
      .where(
        inArray(
          schema.authenticationAudit.actor,
          people.map(p => 'person:' + p),
        ),
      );
    await database().delete(schema.identityBindings).where(inArray(schema.identityBindings.personId, people));
    await database().delete(schema.accessGrants).where(inArray(schema.accessGrants.personId, people));
    await database().delete(schema.people).where(inArray(schema.people.id, people));
  }
});
async function person() {
  const id = 'standing-test-' + randomUUID(),
    subject = 'subject-' + id;
  people.push(id);
  await database()
    .insert(schema.people)
    .values({ id, organisationId: 'test', name: 'Synthetic standing session test' });
  await database()
    .insert(schema.accessGrants)
    .values({ personId: id, unitId: 'test', unitLabel: 'Test', role: 'manager', capabilities: [] });
  await database().insert(schema.identityBindings).values({ issuer: process.env.OIDC_ISSUER!, subject, personId: id });
  return { id, subject };
}
async function session(
  owner: { id: string; subject: string },
  overrides: Partial<typeof schema.sessions.$inferInsert> = {},
) {
  const digest = overrides.digest ?? 'synthetic-digest-' + randomUUID(),
    later = new Date(Date.now() + 3600_000);
  digests.push(digest);
  await database()
    .insert(schema.sessions)
    .values({
      digest,
      personId: owner.id,
      issuer: process.env.OIDC_ISSUER!,
      subject: owner.subject,
      clientId: process.env.OIDC_CLIENT_ID!,
      csrf: 'csrf',
      tokens: '',
      tokenExpiresAt: later,
      idleExpiresAt: later,
      expiresAt: later,
      ...overrides,
    });
  return digest;
}
test('removing a plain audience group invalidates an in-flight request and background context with the same grant', async () => {
  const { authenticate } = await import('../../apps/server/src/auth');
  const { systemContext } = await import('../../apps/server/src/system-context');
  const owner = await person(),
    raw = randomToken(),
    group = 'audience-' + randomUUID();
  await session(owner, { digest: tokenDigest(raw) });
  await database().insert(schema.groups).values({ id: group, organisationId: 'test', externalId: group, label: group });
  try {
    await database().insert(schema.groupMembers).values({ groupId: group, personId: owner.id });
    const request = (await authenticate(raw)).context,
      background = (await systemContext(owner.id))!;
    for (const ctx of [request, background]) {
      expect(ctx.groups).toEqual([group]);
      expect(await ctx.authorize()).toEqual({ version: request.authorizationVersion });
    }
    await database().delete(schema.groupMembers).where(eq(schema.groupMembers.groupId, group));
    await expect(request.authorize()).rejects.toMatchObject({ status: 403, code: 'denied' });
    await expect(background.authorize()).rejects.toBeInstanceOf(ForbiddenError);
    for (const fresh of [(await authenticate(raw)).context, (await systemContext(owner.id))!]) {
      expect(fresh.groups).toEqual([]);
      expect(await fresh.authorize()).toEqual({ version: request.authorizationVersion });
    }
  } finally {
    await database().delete(schema.groups).where(eq(schema.groups.id, group));
  }
});
test('an active session stands for its own person; revoked, expired or foreign sessions stand for nobody', async () => {
  const { standingSession } = await import('../../apps/server/src/auth');
  const hillevi = await person(),
    mikael = await person();
  const live = await session(hillevi);
  const standing = await standingSession(live);
  expect(standing?.personId).toBe(hillevi.id);
  // The last activity is what the idle expiry was set from: sign-in or the page's last activity report.
  const [row] = await database().select().from(schema.sessions).where(eq(schema.sessions.digest, live));
  expect(standing?.lastActiveAt).toBe(new Date(row!.idleExpiresAt.getTime() - IDLE_MS).toISOString());
  const touched = await touchSession(live);
  expect((await standingSession(live))?.lastActiveAt).toBe(
    new Date(touched!.idleExpiresAt.getTime() - IDLE_MS).toISOString(),
  );
  // No IdP token behind this session: the delegate answers nothing rather than exchanging.
  expect(await standing!.delegate('nextcloud')).toBeUndefined();
  expect(await standingSession('system:execution')).toBeUndefined();
  expect(await standingSession(await session(hillevi, { idleExpiresAt: new Date(Date.now() - 1000) }))).toBeUndefined();
  expect(await standingSession(await session(hillevi, { issuer: 'https://another.example.test' }))).toBeUndefined();
  expect(await standingSession(await session(hillevi, { clientId: 'another-client' }))).toBeUndefined();
  // A session row whose subject resolves to someone else does not stand for the person it names.
  expect(await standingSession(await session({ id: hillevi.id, subject: mikael.subject }))).toBeUndefined();
  // Revoked after the answer: the delegate it gave reads the session again and refuses.
  await revokeSession(live);
  expect(await standingSession(live)).toBeUndefined();
  await expect(standing!.delegate('nextcloud')).rejects.toThrow('expired');
});
