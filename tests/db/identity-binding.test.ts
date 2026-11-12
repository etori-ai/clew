import { afterAll, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray, like } from 'drizzle-orm';
import { database, schema } from '../../packages/db/src/index';
import { bindFirstLogin, signIn } from '../../packages/db/src/auth';

/**
 * Binding at sign-in (D68 item 6) on PostgreSQL. A first login binds the verified subject to the one enabled person
 * whose userName equals the claim, without regard to case and folded under ICU, so Å and å are one letter on a C-locale
 * database too (L13). A later sign-in is the bound person unless the claim names another person (L2). A changed
 * subject, a subject another person holds and a claim that names someone else are refused with `identity-conflict` on
 * the claimed person, and its `identity.conflict` audit row carries the claim's value, the refused subject and whoever
 * holds that subject (L10). An unknown, disabled or e-mail claim is `identity-unmatched` with the claim value. A refused
 * sign-in returns the person it concerned, when one is known, for the `login-denied` row the server writes; a bound
 * person without a grant is refused that way, with no row here. Run with `bun run test:db` inside the devcontainer.
 */
if (!process.env.DATABASE_URL)
  throw new Error('DATABASE_URL is not set. Run `bun run test:db` inside the devcontainer.');
const prefix = 'test-bind-' + randomUUID().slice(0, 8),
  issuer = 'https://idp.test/' + prefix,
  claim = 'preferred_username',
  anna = prefix + '-anna',
  bo = prefix + '-bo',
  off = prefix + '-off',
  cecilia = prefix + '-cecilia',
  asa = prefix + '-asa',
  dan = prefix + '-dan',
  ids = [anna, bo, off, cecilia, asa, dan];
const db = database();
/** The authentication log's actions about this file's people, oldest first. */
const actions = async () =>
  (
    await db
      .select({ action: schema.authenticationAudit.action, actor: schema.authenticationAudit.actor })
      .from(schema.authenticationAudit)
      .where(like(schema.authenticationAudit.actor, 'person:' + prefix + '%'))
      .orderBy(schema.authenticationAudit.id)
  ).map(a => a.action + ' ' + a.actor!.slice(('person:' + prefix + '-').length));
const audited = async (person: string, action: string) =>
  (
    await db
      .select({ actor: schema.audit.actor, details: schema.audit.details })
      .from(schema.audit)
      .where(and(eq(schema.audit.subject, 'person:' + person), eq(schema.audit.action, action)))
      .orderBy(schema.audit.id)
  ).map((r): Record<string, unknown> => ({ actor: r.actor, ...r.details }));
const holderOf = async (subject: string) =>
  (
    await db
      .select({ personId: schema.identityBindings.personId })
      .from(schema.identityBindings)
      .where(and(eq(schema.identityBindings.issuer, issuer), eq(schema.identityBindings.subject, subject)))
  )[0]?.personId;
afterAll(async () => {
  await db.delete(schema.identityBindings).where(inArray(schema.identityBindings.personId, ids));
  await db.delete(schema.accessGrants).where(inArray(schema.accessGrants.personId, ids));
  await db.delete(schema.audit).where(
    inArray(
      schema.audit.subject,
      ids.map(id => 'person:' + id),
    ),
  );
  await db.delete(schema.authenticationAudit).where(like(schema.authenticationAudit.actor, 'person:' + prefix + '%'));
  await db.delete(schema.authenticationAudit).where(like(schema.authenticationAudit.actor, 'claim:' + prefix + '%'));
  await db.delete(schema.authenticationAudit).where(eq(schema.authenticationAudit.actor, 'claim:anna@example.test'));
  await db.delete(schema.people).where(inArray(schema.people.id, ids));
});
test('the first login binds exactly one enabled person by userName and audits it; later sign-ins reuse the binding', async () => {
  const person = (id: string, userName: string, enabled = true) => ({
    id,
    organisationId: 'test',
    name: userName,
    userName,
    externalId: id,
    enabled,
  });
  await db
    .insert(schema.people)
    .values([
      person(anna, prefix + ':anna'),
      person(bo, prefix + ':bo'),
      person(off, prefix + ':off', false),
      person(cecilia, prefix + ':cecilia'),
      person(asa, prefix + ':Åsa.Öberg'),
      person(dan, prefix + ':dan'),
    ]);
  await db.insert(schema.accessGrants).values(
    [anna, cecilia, asa, dan].map(personId => ({
      personId,
      unitId: 'u',
      unitLabel: 'U',
      role: 'employee' as const,
      capabilities: [],
    })),
  );
  const bound = await signIn(issuer, 'sub-anna', claim, prefix + ':anna');
  expect(bound.access?.person.id).toBe(anna);
  expect(bound.access?.grant.unitId).toBe('u');
  expect(bound.personId).toBe(anna);
  expect(await holderOf('sub-anna')).toBe(anna);
  expect(await actions()).toEqual(['identity-bound anna']);
  expect(await audited(anna, 'identity.bound')).toEqual([{ actor: 'person:' + anna, issuer, claim }]);
  // The same subject again: the binding stands, nothing new is written.
  expect((await signIn(issuer, 'sub-anna', claim, prefix + ':anna')).access?.person.id).toBe(anna);
  // The claim matches without regard to case (RFC 7643's default for userName): Keycloak lowercases, Entra does not.
  expect((await signIn(issuer, 'sub-anna', claim, (prefix + ':anna').toUpperCase())).access?.person.id).toBe(anna);
  expect(await actions()).toEqual(['identity-bound anna']);
  // A person without a grant binds, but has no access: the sign-in is refused and names them, at once and later.
  expect(await signIn(issuer, 'sub-bo', claim, prefix + ':bo')).toEqual({ personId: bo });
  expect(await signIn(issuer, 'sub-bo', claim, prefix + ':bo')).toEqual({ personId: bo });
  expect(await actions()).toEqual(['identity-bound anna', 'identity-bound bo']);
});
test('Å and å are one letter, and a decomposed claim is the same name, on a C-locale database too', async () => {
  expect((await signIn(issuer, 'sub-asa', claim, prefix + ':åsa.öberg')).access?.person.id).toBe(asa);
  expect(await holderOf('sub-asa')).toBe(asa);
  // A later sign-in whose claim is the same name in capitals and decomposed (NFD) is still the bound person.
  const decomposed = (prefix + ':ÅSA.ÖBERG').normalize('NFD');
  expect(decomposed).not.toBe((prefix + ':ÅSA.ÖBERG').normalize('NFC'));
  expect((await signIn(issuer, 'sub-asa', claim, decomposed)).access?.person.id).toBe(asa);
  expect((await actions()).filter(a => a.endsWith(' asa'))).toEqual(['identity-bound asa']);
});
test('a changed subject, an unknown, disabled or e-mail claim and a subject another person holds are refused', async () => {
  // Anna's subject changed: refused, and the audit row carries the claim's value and the refused subject.
  expect(await signIn(issuer, 'sub-anna-2', claim, prefix + ':anna')).toEqual({ personId: anna });
  expect((await actions()).at(-1)).toBe('identity-conflict anna');
  expect(await audited(anna, 'identity.conflict')).toEqual([
    { actor: 'person:' + anna, issuer, claim, value: prefix + ':anna', subject: 'sub-anna-2' },
  ]);
  expect(await holderOf('sub-anna-2')).toBeUndefined();
  // No person with that name, a disabled one, or an e-mail address: the claim value is what the log keeps.
  expect(await signIn(issuer, 'sub-x', claim, prefix + ':nobody')).toEqual({});
  expect(await signIn(issuer, 'sub-x', claim, prefix + ':off')).toEqual({ personId: off });
  expect(await signIn(issuer, 'sub-x', claim, 'anna@example.test')).toEqual({});
  const unmatched = await db
    .select({ actor: schema.authenticationAudit.actor })
    .from(schema.authenticationAudit)
    .where(eq(schema.authenticationAudit.action, 'identity-unmatched'));
  expect(unmatched.map(u => u.actor)).toEqual(
    expect.arrayContaining(['claim:' + prefix + ':nobody', 'claim:' + prefix + ':off', 'claim:anna@example.test']),
  );
  expect(await holderOf('sub-x')).toBeUndefined();
  // sub-anna belongs to Anna; Bo cannot take it. The first login that finds the subject held (here called directly, as
  // a sign-in that read no binding a moment earlier would) refuses with a conflict naming the holder.
  await db.delete(schema.identityBindings).where(eq(schema.identityBindings.personId, bo));
  expect(await bindFirstLogin(issuer, 'sub-anna', claim, prefix + ':bo')).toEqual({ personId: anna });
  expect(await holderOf('sub-anna')).toBe(anna);
  expect((await actions()).at(-1)).toBe('identity-conflict bo');
  expect(await audited(bo, 'identity.conflict')).toEqual([
    { actor: 'person:' + bo, issuer, claim, value: prefix + ':bo', subject: 'sub-anna', holder: 'person:' + anna },
  ]);
});
test('a bound subject whose claim names another person is refused, and nothing is rebound', async () => {
  const before = (await actions()).length;
  // The identity provider gave Anna's account the name Cecilia holds in Clew: refused, naming both and the subject.
  expect(await signIn(issuer, 'sub-anna', claim, prefix + ':cecilia')).toEqual({ personId: anna });
  expect(await signIn(issuer, 'sub-anna', claim, (prefix + ':CECILIA').toUpperCase())).toEqual({ personId: anna });
  expect((await actions()).slice(before)).toEqual(['identity-conflict cecilia', 'identity-conflict cecilia']);
  expect((await audited(cecilia, 'identity.conflict'))[0]).toEqual({
    actor: 'person:' + cecilia,
    issuer,
    claim,
    value: prefix + ':cecilia',
    subject: 'sub-anna',
    holder: 'person:' + anna,
  });
  expect(await holderOf('sub-anna')).toBe(anna);
  expect(await db.select().from(schema.identityBindings).where(eq(schema.identityBindings.personId, cecilia))).toEqual(
    [],
  );
  // A disabled person's name is still another person's name.
  expect(await signIn(issuer, 'sub-anna', claim, prefix + ':off')).toEqual({ personId: anna });
  expect((await actions()).at(-1)).toBe('identity-conflict off');
  // A claim that names nobody, or no claim at all, does not refuse: the subject is the identity, and the provider may
  // rename before Clew does.
  const quiet = (await actions()).length;
  expect((await signIn(issuer, 'sub-anna', claim, prefix + ':anna.renamed')).access?.person.id).toBe(anna);
  expect((await signIn(issuer, 'sub-anna', claim, undefined)).access?.person.id).toBe(anna);
  expect(await actions()).toHaveLength(quiet);
});
test('two first sign-ins of one account at the same moment bind it once, and both go on', async () => {
  const [first, second] = await Promise.all([
    bindFirstLogin(issuer, 'sub-dan', claim, prefix + ':dan'),
    bindFirstLogin(issuer, 'sub-dan', claim, prefix + ':dan'),
  ]);
  expect(first.access?.person.id).toBe(dan);
  expect(second.access?.person.id).toBe(dan);
  expect(await holderOf('sub-dan')).toBe(dan);
  expect((await actions()).filter(a => a.endsWith(' dan'))).toEqual(['identity-bound dan']);
});
