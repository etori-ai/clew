import { afterAll, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray, like } from 'drizzle-orm';
import { database, schema } from '../../packages/db/src/index';
import { bindFirstLogin } from '../../packages/db/src/auth';
import { postgresProvisionStore } from '../../apps/server/src/modules/people/adapters/postgres';
import { scimUsecases } from '../../apps/server/src/modules/people/usecases';

/**
 * One user name in one Unicode form, NFC, from the source to the sign-in (L12), on PostgreSQL. The SCIM boundary
 * stores a name sent decomposed in its composed form, finds it by a filter in either form and holds the two spellings
 * as one name; the first sign-in compares the claim in the same form, so a person is bound whichever form the source
 * and the identity provider each send the name in. Neither half is enough alone: a name stored composed beside a
 * claim compared as sent, or a composed claim beside a name stored as sent, binds nobody where a source and an identity
 * provider that both send it decomposed once matched. Run with `bun run test:db` in the devcontainer.
 */
if (!process.env.DATABASE_URL)
  throw new Error('DATABASE_URL is not set. Run `bun run test:db` inside the devcontainer.');
const BASE = 'https://clew.test/scim/v2';
const prefix = 'test-nfc-' + randomUUID().slice(0, 8),
  issuer = 'https://idp.test/' + prefix,
  claim = 'preferred_username';
let seq = 0;
const p = { id: prefix, organisationId: prefix + '-org', label: 'NFC' };
const scim = scimUsecases({
  store: postgresProvisionStore(),
  clock: () => new Date(),
  ids: () => `${prefix}-${++seq}`,
  digest: (token: string) => token,
});
const db = database();
const user = (n: number, userName: string) => ({
  externalId: `${prefix}:${n}`,
  userName,
  displayName: 'Person ' + n,
  emails: [{ value: `${prefix}.${n}@example.test`, type: 'work' }],
});
afterAll(async () => {
  const people = (
    await db
      .select({ id: schema.people.id })
      .from(schema.people)
      .where(like(schema.people.id, prefix + '%'))
  ).map(r => r.id);
  if (people.length) {
    const actors = people.map(id => 'person:' + id);
    await db.delete(schema.identityBindings).where(inArray(schema.identityBindings.personId, people));
    await db.delete(schema.accessGrants).where(inArray(schema.accessGrants.personId, people));
    await db.delete(schema.assignments).where(inArray(schema.assignments.personId, people));
    await db.delete(schema.audit).where(inArray(schema.audit.subject, actors));
    await db.delete(schema.authenticationAudit).where(inArray(schema.authenticationAudit.actor, actors));
    await db.delete(schema.people).where(inArray(schema.people.id, people));
  }
  await db.delete(schema.authenticationAudit).where(like(schema.authenticationAudit.actor, 'claim:' + prefix + '%'));
});
test('a user name sent decomposed is stored composed, found by a filter in either form, and one name with its composed spelling', async () => {
  const composed = `${prefix}.\u00e5sa`,
    decomposed = composed.normalize('NFD');
  expect(decomposed).not.toBe(composed);
  const created = await scim.createUser(p, user(1, decomposed), BASE);
  expect(created.userName).toBe(composed);
  const [row] = await db
    .select({ userName: schema.people.userName })
    .from(schema.people)
    .where(eq(schema.people.id, created.id));
  expect(row?.userName).toBe(composed);
  for (const value of [decomposed, composed])
    expect((await scim.listUsers(p, { filter: `userName eq "${value}"` }, BASE)).Resources.map(u => u.id)).toEqual([
      created.id,
    ]);
  await expect(scim.createUser(p, user(2, composed), BASE)).rejects.toMatchObject({
    status: 409,
    scimType: 'uniqueness',
  });
});
test('the first sign-in binds the person whichever form the source and the identity provider each send the name in', async () => {
  const cases = [
    // Both send it decomposed: what matched before names were kept composed, and must still match.
    { name: `${prefix}.\u00f6la`, source: 'NFD', idp: 'NFD' },
    { name: `${prefix}.\u00e4rla`, source: 'NFC', idp: 'NFD' },
    { name: `${prefix}.\u00e5ke`, source: 'NFD', idp: 'NFC' },
  ] as const;
  const bound: Record<string, string | undefined> = {},
    expected: Record<string, string> = {};
  for (const [n, { name, source, idp }] of cases.entries()) {
    const { id } = await scim.createUser(p, user(10 + n, name.normalize(source)), BASE);
    const subject = `sub-${n}`;
    await bindFirstLogin(issuer, subject, claim, name.normalize(idp));
    const [binding] = await db
      .select({ personId: schema.identityBindings.personId })
      .from(schema.identityBindings)
      .where(and(eq(schema.identityBindings.issuer, issuer), eq(schema.identityBindings.subject, subject)));
    bound[`${source} from the source, ${idp} from the identity provider`] = binding?.personId;
    expected[`${source} from the source, ${idp} from the identity provider`] = id;
  }
  expect(bound).toEqual(expected);
});
