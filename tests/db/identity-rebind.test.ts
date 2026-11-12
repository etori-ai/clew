import { afterAll, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray, like } from 'drizzle-orm';
import { database, schema } from '../../packages/db/src/index';
import { RebindRefused, rebindIdentity, resolveSubject } from '../../packages/db/src/auth';

/**
 * An operator's rebind (Q8 of the 2026-11-12 users review, amending D68 item 6), the transaction behind
 * `scripts/identity-rebind.ts`: the person's binding under the issuer moves to the new subject with one
 * `identity.rebound` audit row; an unknown person and a subject another person holds are refused, writing nothing.
 * Run with `bun run test:db` inside the devcontainer.
 */
if (!process.env.DATABASE_URL)
  throw new Error('DATABASE_URL is not set. Run `bun run test:db` inside the devcontainer.');
const prefix = 'test-rebind-' + randomUUID().slice(0, 8),
  issuer = 'https://idp.test/' + prefix,
  anna = prefix + '-anna',
  bo = prefix + '-bo',
  cecilia = prefix + '-cecilia',
  ids = [anna, bo, cecilia],
  operator = 'Synthetic Operator';
const db = database();
const rebounds = async (person?: string) =>
  (
    await db
      .select({ actor: schema.audit.actor, subject: schema.audit.subject, details: schema.audit.details })
      .from(schema.audit)
      .where(
        and(
          eq(schema.audit.action, 'identity.rebound'),
          person ? eq(schema.audit.subject, 'person:' + person) : like(schema.audit.subject, 'person:' + prefix + '%'),
        ),
      )
      .orderBy(schema.audit.id)
  ).map((r): Record<string, unknown> => ({ actor: r.actor, about: r.subject, ...r.details }));
const bindings = async () =>
  (
    await db
      .select({ subject: schema.identityBindings.subject, personId: schema.identityBindings.personId })
      .from(schema.identityBindings)
      .where(eq(schema.identityBindings.issuer, issuer))
      .orderBy(schema.identityBindings.subject)
  ).map(b => b.subject + ' ' + b.personId.slice(prefix.length + 1));
afterAll(async () => {
  await db.delete(schema.identityBindings).where(eq(schema.identityBindings.issuer, issuer));
  await db.delete(schema.accessGrants).where(inArray(schema.accessGrants.personId, ids));
  await db.delete(schema.audit).where(
    inArray(
      schema.audit.subject,
      ids.map(id => 'person:' + id),
    ),
  );
  await db.delete(schema.people).where(inArray(schema.people.id, ids));
});
test('a rebind moves the person to the new subject and audits who did it, from what and to what', async () => {
  await db.insert(schema.people).values(ids.map(id => ({ id, organisationId: 'test', name: id, userName: id })));
  await db
    .insert(schema.accessGrants)
    .values({ personId: anna, unitId: 'u', unitLabel: 'U', role: 'employee', capabilities: [] });
  await db.insert(schema.identityBindings).values([
    { issuer, subject: 'sub-anna-old', personId: anna },
    { issuer, subject: 'sub-bo', personId: bo },
  ]);
  expect(await rebindIdentity('operator:cli', { issuer, personId: anna, subject: 'sub-anna-new', operator })).toEqual({
    changed: true,
    oldSubject: 'sub-anna-old',
  });
  expect(await bindings()).toEqual(['sub-anna-new anna', 'sub-bo bo']);
  expect(await rebounds(anna)).toEqual([
    {
      actor: 'operator:cli',
      about: 'person:' + anna,
      issuer,
      oldSubject: 'sub-anna-old',
      newSubject: 'sub-anna-new',
      operator,
    },
  ]);
  // The old subject no longer resolves, so a session under it ends at its next request; the new one is Anna.
  expect(await resolveSubject(issuer, 'sub-anna-old')).toBeUndefined();
  expect((await resolveSubject(issuer, 'sub-anna-new'))?.person.id).toBe(anna);
  // A person who has never signed in under the issuer is bound without an old subject.
  expect(await rebindIdentity('operator:cli', { issuer, personId: cecilia, subject: 'sub-cecilia', operator })).toEqual(
    {
      changed: true,
      oldSubject: null,
    },
  );
  expect((await rebounds(cecilia))[0]).toMatchObject({ oldSubject: null, newSubject: 'sub-cecilia' });
  // The same subject again changes nothing and writes nothing.
  expect(await rebindIdentity('operator:cli', { issuer, personId: anna, subject: 'sub-anna-new', operator })).toEqual({
    changed: false,
    oldSubject: 'sub-anna-new',
  });
  expect(await rebounds()).toHaveLength(2);
});
test('an unknown person and a subject another person holds are refused, and nothing is written', async () => {
  const before = await bindings();
  await expect(
    rebindIdentity('operator:cli', { issuer, personId: prefix + '-nobody', subject: 'sub-new', operator }),
  ).rejects.toThrow(new RebindRefused(`no person has the id "${prefix}-nobody"`));
  await expect(rebindIdentity('operator:cli', { issuer, personId: anna, subject: 'sub-bo', operator })).rejects.toThrow(
    new RebindRefused(`the subject is already bound to another person, "${bo}"`),
  );
  expect(await bindings()).toEqual(before);
  expect(await rebounds()).toHaveLength(2);
  expect(
    await db
      .select()
      .from(schema.audit)
      .where(eq(schema.audit.subject, 'person:' + prefix + '-nobody')),
  ).toEqual([]);
});
