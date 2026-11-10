import { afterAll, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { eq, inArray, like } from 'drizzle-orm';
import { database, schema } from '../../packages/db/src/index';
import { postgresProvisionStore } from '../../apps/server/src/modules/people/adapters/postgres';
import type { ProvisionStore } from '../../apps/server/src/modules/people/ports';
import { scimUsecases } from '../../apps/server/src/modules/people/usecases';

/**
 * Two SCIM requests at once on Postgres (D68): what the memory adapter cannot show. A derivation locks the person, so
 * the second of two membership changes for one person waits and then reads what the first committed; a write of a
 * group locks the group, so two patches of one group do not interleave. Run with `bun run test:db` in the devcontainer.
 */
if (!process.env.DATABASE_URL)
  throw new Error('DATABASE_URL is not set. Run `bun run test:db` inside the devcontainer.');
const BASE = 'https://clew.test/scim/v2';
const prefixes: string[] = [];
afterAll(async () => {
  const db = database();
  for (const p of prefixes) {
    const people = (
      await db
        .select({ id: schema.people.id })
        .from(schema.people)
        .where(like(schema.people.id, p + '%'))
    ).map(r => r.id);
    const groups = (
      await db
        .select({ id: schema.groups.id })
        .from(schema.groups)
        .where(like(schema.groups.id, p + '%'))
    ).map(r => r.id);
    await db.delete(schema.groupCapabilities).where(like(schema.groupCapabilities.groupExternalId, p + '%'));
    await db
      .delete(schema.audit)
      .where(inArray(schema.audit.subject, [...people.map(id => 'person:' + id), ...groups.map(id => 'group:' + id)]));
    if (people.length) {
      await db.delete(schema.groupMembers).where(inArray(schema.groupMembers.personId, people));
      await db.delete(schema.assignments).where(inArray(schema.assignments.personId, people));
      await db.delete(schema.accessGrants).where(inArray(schema.accessGrants.personId, people));
    }
    if (groups.length) await db.delete(schema.groups).where(inArray(schema.groups.id, groups));
    await db.delete(schema.units).where(like(schema.units.id, p + '%'));
    if (people.length) await db.delete(schema.people).where(inArray(schema.people.id, people));
  }
});
function stack() {
  const prefix = 'test-race-' + randomUUID().slice(0, 8);
  prefixes.push(prefix);
  let seq = 0;
  const deps = { clock: () => new Date(), ids: () => `${prefix}-${++seq}`, digest: (t: string) => t };
  const p = { id: prefix, organisationId: prefix + '-org', label: 'Race' };
  const store = postgresProvisionStore();
  const user = (n: number) => ({
    externalId: `${prefix}:${n}`,
    userName: `${prefix}.${n}`,
    displayName: 'Person ' + n,
    emails: [{ value: `${prefix}.${n}@example.test`, type: 'work' }],
  });
  const grant = async (personId: string) => {
    const [row] = await database()
      .select({ role: schema.accessGrants.role, capabilities: schema.accessGrants.capabilities })
      .from(schema.accessGrants)
      .where(eq(schema.accessGrants.personId, personId));
    return row;
  };
  return { prefix, deps, p, store, user, grant, scim: scimUsecases({ store, ...deps }) };
}
/**
 * A store whose transactions stop after reading a person's memberships until `release` is called: the moment a
 * derivation has read its view and not yet written the grant, which is where another request used to slip in.
 */
function paused(inner: ProvisionStore) {
  let reached!: () => void, release!: () => void;
  const atRead = new Promise<void>(resolve => (reached = resolve)),
    gate = new Promise<void>(resolve => (release = resolve));
  const store: ProvisionStore = {
    transaction: fn =>
      inner.transaction(tx =>
        fn({
          ...tx,
          memberships: async personId => {
            const rows = await tx.memberships(personId);
            reached();
            await gate;
            return rows;
          },
        }),
      ),
  };
  return { store, atRead, release };
}
const PATCH = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';
const settled = (promise: Promise<unknown>) => {
  let done = false;
  void promise.then(
    () => (done = true),
    () => (done = true),
  );
  return () => done;
};
test('two membership changes for one person at once: the second derivation waits and reads what the first committed', async () => {
  const { prefix, deps, p, store, user, grant, scim } = stack();
  const person = (await scim.createUser(p, user(1), BASE)).id;
  await scim.createGroup(
    p,
    { externalId: `unit:${prefix}-u`, displayName: 'Enhet', members: [{ value: person }] },
    BASE,
  );
  const managers = await scim.createGroup(
    p,
    { externalId: `unit-manager:${prefix}-u`, displayName: 'Chefer', members: [{ value: person }] },
    BASE,
  );
  const plain = await scim.createGroup(p, { externalId: `${prefix}:admins`, displayName: 'Admins' }, BASE);
  await database()
    .insert(schema.groupCapabilities)
    .values({ groupExternalId: `${prefix}:admins`, capability: 'admin.users' });
  expect(await grant(person)).toEqual({ role: 'manager', capabilities: [] });
  // The first request takes the manager role away and stops between reading the memberships and writing the grant.
  const slow = paused(store);
  const first = scimUsecases({ store: slow.store, ...deps }).patchGroup(
    p,
    managers.id,
    { schemas: [PATCH], Operations: [{ op: 'remove', path: `members[value eq "${person}"]` }] },
    BASE,
  );
  await slow.atRead;
  // The second gives a capability through another group. It must wait for the first, not derive beside it.
  const second = scim.patchGroup(
    p,
    plain.id,
    { schemas: [PATCH], Operations: [{ op: 'add', path: 'members', value: [{ value: person }] }] },
    BASE,
  );
  const secondDone = settled(second);
  await new Promise(resolve => setTimeout(resolve, 400));
  expect(secondDone()).toBe(false);
  slow.release();
  await Promise.all([first, second]);
  // Both changes are in the grant. Without the lock the last writer's view missed the other's change.
  expect(await grant(person)).toEqual({ role: 'employee', capabilities: ['admin.users'] });
});
test('two patches of one group at once: both members are in the group afterwards, and neither request fails', async () => {
  const { prefix, p, user, grant, scim } = stack();
  const [a, b] = [(await scim.createUser(p, user(1), BASE)).id, (await scim.createUser(p, user(2), BASE)).id];
  const unit = await scim.createGroup(p, { externalId: `unit:${prefix}-u`, displayName: 'Enhet' }, BASE);
  const add = (id: string) =>
    scim.patchGroup(
      p,
      unit.id,
      { schemas: [PATCH], Operations: [{ op: 'add', path: 'members', value: [{ value: id }] }] },
      BASE,
    );
  for (let round = 0; round < 5; round++) {
    await scim.patchGroup(p, unit.id, { schemas: [PATCH], Operations: [{ op: 'remove', path: 'members' }] }, BASE);
    await Promise.all([add(a), add(b)]);
    const members = (await scim.getGroup(p, unit.id, BASE)).members.map(m => m.value).sort();
    expect(members).toEqual([a, b].sort());
    expect(await grant(a)).toMatchObject({ role: 'employee' });
    expect(await grant(b)).toMatchObject({ role: 'employee' });
  }
});
test('two groups that share their members, written at once in opposite orders, both finish', async () => {
  const { prefix, p, user, scim } = stack();
  const ids: string[] = [];
  for (let n = 1; n <= 6; n++) ids.push((await scim.createUser(p, user(n), BASE)).id);
  const members = (list: string[]) => list.map(value => ({ value }));
  const one = await scim.createGroup(p, { externalId: `unit:${prefix}-a`, displayName: 'A' }, BASE),
    two = await scim.createGroup(p, { externalId: `unit:${prefix}-b`, displayName: 'B' }, BASE);
  for (let round = 0; round < 5; round++) {
    await Promise.all([
      scim.replaceGroup(
        p,
        one.id,
        { externalId: `unit:${prefix}-a`, displayName: 'A', members: round % 2 ? [] : members(ids) },
        BASE,
      ),
      scim.replaceGroup(
        p,
        two.id,
        { externalId: `unit:${prefix}-b`, displayName: 'B', members: round % 2 ? [] : members([...ids].reverse()) },
        BASE,
      ),
    ]);
  }
  expect((await scim.getGroup(p, one.id, BASE)).members).toHaveLength(6);
  expect((await scim.getGroup(p, two.id, BASE)).members).toHaveLength(6);
});
