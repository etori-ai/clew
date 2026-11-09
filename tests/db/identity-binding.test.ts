import { afterAll, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray, like } from 'drizzle-orm';
import { database, schema } from '../../packages/db/src/index';
import { bindFirstLogin } from '../../packages/db/src/auth';

/**
 * Binding at first login (D68 item 6): the verified subject binds to the one enabled person whose userName equals the
 * claim; a changed subject, no match, two matches, a disabled person or a subject already bound elsewhere are refused and
 * audited. Run with `bun run test:db` inside the devcontainer.
 */
if (!process.env.DATABASE_URL)
  throw new Error('DATABASE_URL is not set. Run `bun run test:db` inside the devcontainer.');
const prefix = 'test-bind-' + randomUUID().slice(0, 8),
  issuer = 'https://idp.test/' + prefix,
  anna = prefix + '-anna',
  bo = prefix + '-bo',
  off = prefix + '-off',
  ids = [anna, bo, off];
const db = database();
const actions = async () =>
  (
    await db
      .select({ action: schema.authenticationAudit.action, actor: schema.authenticationAudit.actor })
      .from(schema.authenticationAudit)
      .where(like(schema.authenticationAudit.actor, 'person:' + prefix + '%'))
      .orderBy(schema.authenticationAudit.id)
  ).map(a => a.action);
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
test('the first login binds exactly one enabled person by userName and audits it; later logins reuse the binding', async () => {
  await db.insert(schema.people).values([
    { id: anna, organisationId: 'test', name: 'Anna', userName: prefix + ':anna', externalId: prefix + ':1' },
    { id: bo, organisationId: 'test', name: 'Bo', userName: prefix + ':bo', externalId: prefix + ':2' },
    {
      id: off,
      organisationId: 'test',
      name: 'Off',
      userName: prefix + ':off',
      externalId: prefix + ':3',
      enabled: false,
    },
  ]);
  await db
    .insert(schema.accessGrants)
    .values({ personId: anna, unitId: 'u', unitLabel: 'U', role: 'employee', capabilities: [] });
  const bound = await bindFirstLogin(issuer, 'sub-anna', 'preferred_username', prefix + ':anna');
  expect(bound?.person.id).toBe(anna);
  expect(bound?.grant.unitId).toBe('u');
  const [row] = await db
    .select()
    .from(schema.identityBindings)
    .where(and(eq(schema.identityBindings.issuer, issuer), eq(schema.identityBindings.subject, 'sub-anna')));
  expect(row?.personId).toBe(anna);
  expect(await actions()).toEqual(['identity-bound']);
  const details = await db
    .select({ action: schema.audit.action, details: schema.audit.details })
    .from(schema.audit)
    .where(eq(schema.audit.subject, 'person:' + anna));
  expect(details).toEqual([{ action: 'identity.bound', details: { issuer, claim: 'preferred_username' } }]);
  // The same subject again: the binding stands, nothing new is written.
  expect((await bindFirstLogin(issuer, 'sub-anna', 'preferred_username', prefix + ':anna'))?.person.id).toBe(anna);
  expect(await actions()).toEqual(['identity-bound']);
  // A person without a grant binds but has no access to return.
  expect(await bindFirstLogin(issuer, 'sub-bo', 'preferred_username', prefix + ':bo')).toBeUndefined();
  expect(await actions()).toEqual(['identity-bound', 'identity-bound']);
});
test('a changed subject, an unknown or disabled userName and a subject already bound elsewhere are refused', async () => {
  expect(await bindFirstLogin(issuer, 'sub-anna-2', 'preferred_username', prefix + ':anna')).toBeUndefined();
  expect((await actions()).at(-1)).toBe('identity-conflict');
  expect(await bindFirstLogin(issuer, 'sub-x', 'preferred_username', prefix + ':nobody')).toBeUndefined();
  expect(
    await db
      .select({ actor: schema.authenticationAudit.actor })
      .from(schema.authenticationAudit)
      .where(eq(schema.authenticationAudit.actor, 'claim:' + prefix + ':nobody')),
  ).toHaveLength(1);
  expect(await bindFirstLogin(issuer, 'sub-x', 'preferred_username', prefix + ':off')).toBeUndefined();
  expect(await bindFirstLogin(issuer, 'sub-x', 'preferred_username', 'anna@example.test')).toBeUndefined();
  // sub-anna belongs to Anna; a person with another name cannot take it.
  await db.delete(schema.identityBindings).where(eq(schema.identityBindings.personId, bo));
  expect(await bindFirstLogin(issuer, 'sub-anna', 'preferred_username', prefix + ':bo')).toBeUndefined();
  const [still] = await db
    .select()
    .from(schema.identityBindings)
    .where(and(eq(schema.identityBindings.issuer, issuer), eq(schema.identityBindings.subject, 'sub-anna')));
  expect(still?.personId).toBe(anna);
});
