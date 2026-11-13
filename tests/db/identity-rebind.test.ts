import { afterAll, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray, like } from 'drizzle-orm';
import { database, schema } from '../../packages/db/src/index';
import { RebindRefused, rebindIdentity, resolveSubject, signIn } from '../../packages/db/src/auth';

/**
 * An operator's rebind (Q8 of the 2026-11-12 users review, amending D68 item 6), the transaction behind
 * `scripts/identity-rebind.ts`: the person's binding under the issuer moves to the new subject, or is released, with
 * one `identity.rebound` audit row; an unknown person and a subject another person holds are refused, writing nothing.
 * A subject is moved off another person only by releasing that person first, which is how the refusals of a changed
 * source id and of a name moved between two people are settled. Run with `bun run test:db` inside the devcontainer.
 */
if (!process.env.DATABASE_URL)
  throw new Error('DATABASE_URL is not set. Run `bun run test:db` inside the devcontainer.');
const prefix = 'test-rebind-' + randomUUID().slice(0, 8),
  issuer = 'https://idp.test/' + prefix,
  claim = 'preferred_username',
  anna = prefix + '-anna',
  bo = prefix + '-bo',
  cecilia = prefix + '-cecilia',
  // A source id that changed after Dan signed in: the old row, deactivated, and the new one with his account name.
  danOld = prefix + '-dan-old',
  danNew = prefix + '-dan-new',
  // An account name that moved from Hanna to Tove while Tove signed in for the first time.
  hanna = prefix + '-hanna',
  tove = prefix + '-tove',
  ids = [anna, bo, cecilia, danOld, danNew, hanna, tove],
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
const conflicts = async (person: string) =>
  (
    await db
      .select({ details: schema.audit.details })
      .from(schema.audit)
      .where(and(eq(schema.audit.action, 'identity.conflict'), eq(schema.audit.subject, 'person:' + person)))
      .orderBy(schema.audit.id)
  ).map(r => r.details);
afterAll(async () => {
  await db.delete(schema.identityBindings).where(eq(schema.identityBindings.issuer, issuer));
  await db.delete(schema.accessGrants).where(inArray(schema.accessGrants.personId, ids));
  await db.delete(schema.audit).where(
    inArray(
      schema.audit.subject,
      ids.map(id => 'person:' + id),
    ),
  );
  await db.delete(schema.authenticationAudit).where(like(schema.authenticationAudit.actor, 'person:' + prefix + '%'));
  await db.delete(schema.people).where(inArray(schema.people.id, ids));
});
test('a rebind moves the person to the new subject and audits who did it, from what and to what', async () => {
  const userNames: Record<string, string> = {
    [danOld]: prefix + ':dan.moved-off',
    [danNew]: prefix + ':dan',
    [hanna]: prefix + ':hanna',
    [tove]: prefix + ':shared',
  };
  await db.insert(schema.people).values(
    ids.map(id => ({
      id,
      organisationId: 'test',
      name: id,
      userName: userNames[id] ?? id,
      enabled: id !== danOld,
    })),
  );
  await db.insert(schema.accessGrants).values(
    [anna, danNew, hanna, tove].map(personId => ({
      personId,
      unitId: 'u',
      unitLabel: 'U',
      role: 'employee' as const,
      capabilities: [],
    })),
  );
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
  await expect(
    rebindIdentity('operator:cli', { issuer, personId: prefix + '-nobody', subject: null, operator }),
  ).rejects.toThrow(new RebindRefused(`no person has the id "${prefix}-nobody"`));
  // The refusal names the holder, whom the script tells the operator to release first.
  const held = rebindIdentity('operator:cli', { issuer, personId: anna, subject: 'sub-bo', operator });
  await expect(held).rejects.toThrow(new RebindRefused(`the subject is already bound to another person, "${bo}"`));
  await expect(held).rejects.toMatchObject({ name: 'RebindRefused', holder: bo });
  expect(await bindings()).toEqual(before);
  expect(await rebounds()).toHaveLength(2);
  expect(
    await db
      .select()
      .from(schema.audit)
      .where(eq(schema.audit.subject, 'person:' + prefix + '-nobody')),
  ).toEqual([]);
});
test('a release removes the binding with its audit row, and the next sign-in that names the person binds again', async () => {
  expect(await rebindIdentity('operator:cli', { issuer, personId: bo, subject: null, operator })).toEqual({
    changed: true,
    oldSubject: 'sub-bo',
  });
  expect(await bindings()).toEqual(['sub-anna-new anna', 'sub-cecilia cecilia']);
  expect(await rebounds(bo)).toEqual([
    { actor: 'operator:cli', about: 'person:' + bo, issuer, oldSubject: 'sub-bo', newSubject: null, operator },
  ]);
  // Nothing left to release: nothing changes and nothing is written.
  expect(await rebindIdentity('operator:cli', { issuer, personId: bo, subject: null, operator })).toEqual({
    changed: false,
    oldSubject: null,
  });
  expect(await rebounds(bo)).toHaveLength(1);
  // Bo's next sign-in is a first login again: his account binds by the claim.
  expect(await signIn(issuer, 'sub-bo', claim, bo)).toEqual({ personId: bo });
  expect(await bindings()).toEqual(['sub-anna-new anna', 'sub-bo bo', 'sub-cecilia cecilia']);
});
test('a changed source id is settled by releasing the old row, after which the new row binds by the claim', async () => {
  // Dan signed in under his old row; the source then deactivated it, moved his account name off it and created a new
  // row with it. His next sign-in is refused, naming the new row, the subject and the old row that holds it.
  await db.insert(schema.identityBindings).values({ issuer, subject: 'sub-dan', personId: danOld });
  expect(await signIn(issuer, 'sub-dan', claim, prefix + ':dan')).toEqual({ personId: danOld });
  expect(await conflicts(danNew)).toEqual([
    { issuer, claim, value: prefix + ':dan', subject: 'sub-dan', holder: 'person:' + danOld },
  ]);
  // Binding the new row to that subject is refused while the old row holds it; releasing the old row settles it.
  await expect(
    rebindIdentity('operator:cli', { issuer, personId: danNew, subject: 'sub-dan', operator }),
  ).rejects.toMatchObject({ holder: danOld });
  await rebindIdentity('operator:cli', { issuer, personId: danOld, subject: null, operator });
  expect((await signIn(issuer, 'sub-dan', claim, prefix + ':dan')).access?.person.id).toBe(danNew);
  expect((await resolveSubject(issuer, 'sub-dan'))?.person.id).toBe(danNew);
});
test('a name that moved while someone signed in for the first time is settled by releasing the wrong holder', async () => {
  // Tove's account was given the name `shared` in the identity provider before Clew moved it off Hanna's row, and her
  // first sign-in bound her account to Hanna. Clew now has the move: Hanna is `hanna`, Tove is `shared`.
  await db.insert(schema.identityBindings).values({ issuer, subject: 'sub-tove', personId: hanna });
  expect(await signIn(issuer, 'sub-tove', claim, prefix + ':shared')).toEqual({ personId: hanna });
  expect((await conflicts(tove)).at(-1)).toEqual({
    issuer,
    claim,
    value: prefix + ':shared',
    subject: 'sub-tove',
    holder: 'person:' + hanna,
  });
  // Hanna's own account is refused too: her row is bound to another subject.
  expect(await signIn(issuer, 'sub-hanna', claim, prefix + ':hanna')).toEqual({ personId: hanna });
  // Once the names agree in both systems, releasing Hanna lets each of them bind by the claim at the next sign-in.
  await rebindIdentity('operator:cli', { issuer, personId: hanna, subject: null, operator });
  expect((await signIn(issuer, 'sub-tove', claim, prefix + ':shared')).access?.person.id).toBe(tove);
  expect((await signIn(issuer, 'sub-hanna', claim, prefix + ':hanna')).access?.person.id).toBe(hanna);
  expect((await resolveSubject(issuer, 'sub-tove'))?.person.id).toBe(tove);
});
