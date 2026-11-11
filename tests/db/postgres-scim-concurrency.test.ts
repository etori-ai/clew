import { afterAll, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { eq, inArray, like } from 'drizzle-orm';
import { database, schema } from '../../packages/db/src/index';
import { postgresProvisionStore } from '../../apps/server/src/modules/people/adapters/postgres';
import type { ProvisionStore } from '../../apps/server/src/modules/people/ports';
import { scimUsecases, usersAdminUsecases } from '../../apps/server/src/modules/people/usecases';
import type { AuthenticatedContext } from '@clew/contracts';

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
    await db.delete(schema.provisioners).where(like(schema.provisioners.id, p + '%'));
    await db.delete(schema.audit).where(like(schema.audit.subject, 'provisioner:' + p + '%'));
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
test('a title PostgreSQL cannot hold does not stop the deactivation beside it, and a name it cannot hold is refused by name (D110)', async () => {
  const { p, user, scim } = stack();
  const { id } = await scim.createUser(p, { ...user(1), title: 'Fritids\u0000ledare' }, BASE);
  const row = async () =>
    (
      await database()
        .select({ title: schema.people.title, enabled: schema.people.enabled, name: schema.people.name })
        .from(schema.people)
        .where(eq(schema.people.id, id))
    )[0];
  expect(await row()).toEqual({ title: 'Fritids ledare', enabled: true, name: 'Person 1' });
  // The directory sends the leaver's last title with the deactivation, as Entra does: the row is written.
  await scim.patchUser(
    p,
    id,
    {
      schemas: [PATCH],
      Operations: [
        { op: 'replace', path: 'title', value: '\u0000Rektor\u0000\n(vik.)\u0000' },
        { op: 'replace', path: 'active', value: false },
      ],
    },
    BASE,
  );
  expect(await row()).toEqual({ title: 'Rektor (vik.)', enabled: false, name: 'Person 1' });
  // A name is required, so one the store cannot hold is the client's to correct: a 400 that names it, not a 500.
  await expect(
    scim.patchUser(
      p,
      id,
      { schemas: [PATCH], Operations: [{ op: 'replace', path: 'displayName', value: 'Bo\u0000 Ek' }] },
      BASE,
    ),
  ).rejects.toMatchObject({
    status: 400,
    scimType: 'invalidValue',
    detail: "Attribute 'displayName' holds a NUL character, which cannot be stored.",
  });
  expect((await row())?.name).toBe('Person 1');
});
test('concurrent user patches preserve the name and the deactivation', async () => {
  const { deps, p, store, user, scim } = stack();
  const { id } = await scim.createUser(p, user(1), BASE);
  const slow = paused(store);
  const patch = (path: string, value: string | boolean) => ({
    schemas: [PATCH],
    Operations: [{ op: 'replace', path, value }],
  });
  const first = scimUsecases({ store: slow.store, ...deps }).patchUser(p, id, patch('active', false), BASE);
  await slow.atRead;
  // The first write is uncommitted. A second writer must read the committed inactive state.
  let reading!: () => void;
  const started = new Promise<void>(resolve => {
    reading = resolve;
  });
  const observed: ProvisionStore = {
    transaction: fn =>
      store.transaction(tx =>
        fn({
          ...tx,
          readUser: (...args) => {
            reading();
            return tx.readUser(...args);
          },
        }),
      ),
  };
  const second = scimUsecases({ store: observed, ...deps }).patchUser(p, id, patch('displayName', 'New name'), BASE);
  try {
    await started;
    await new Promise(resolve => setTimeout(resolve, 100));
  } finally {
    slow.release();
  }
  await Promise.all([first, second]);
  expect(await scim.getUser(p, id, BASE)).toMatchObject({ active: false, displayName: 'New name' });
  const rows = await database()
    .select({ action: schema.audit.action })
    .from(schema.audit)
    .where(eq(schema.audit.subject, 'person:' + id));
  expect(rows.map(row => row.action).sort()).toEqual([
    'scim.user.created',
    'scim.user.deactivated',
    'scim.user.patched',
  ]);
});
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
    .values({ organisationId: prefix + '-org', groupExternalId: `${prefix}:admins`, capability: 'admin.users' });
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
test("a new unit's two groups written at once: the unit takes the group's name and the manager's grant carries it", async () => {
  const { prefix, p, user, scim } = stack();
  const unitGrant = async (personId: string) => {
    const [row] = await database()
      .select({ role: schema.accessGrants.role, unitLabel: schema.accessGrants.unitLabel })
      .from(schema.accessGrants)
      .where(eq(schema.accessGrants.personId, personId));
    return row;
  };
  const both = (await scim.createUser(p, user(1), BASE)).id,
    member = (await scim.createUser(p, user(2), BASE)).id,
    manager = (await scim.createUser(p, user(3), BASE)).id;
  for (let round = 0; round < 8; round++) {
    // Even rounds: the manager is also a member of the unit's group. Odd rounds: the manager is in neither.
    const unit = `${prefix}-n${round}`,
      leads = round % 2 ? manager : both;
    const writes = [
      () =>
        scim.createGroup(
          p,
          { externalId: `unit:${unit}`, displayName: 'Skolan', members: [{ value: both }, { value: member }] },
          BASE,
        ),
      () =>
        scim.createGroup(
          p,
          { externalId: `unit-manager:${unit}`, displayName: 'Chefer', members: [{ value: leads }] },
          BASE,
        ),
    ];
    // Either may reach the unit first.
    if (round % 4 >= 2) writes.reverse();
    const created = await Promise.all(writes.map(write => write()));
    const [row] = await database().select().from(schema.units).where(eq(schema.units.id, unit));
    expect(row?.label).toBe('Skolan');
    expect(await unitGrant(leads)).toEqual({ role: 'manager', unitLabel: 'Skolan' });
    // The next round starts from people who manage nothing.
    for (const group of created) await scim.deleteGroup(p, group.id);
  }
});
test('requests that begin a run together leave one provisioner.seen row, not one each', async () => {
  const { prefix, scim } = stack();
  await database()
    .insert(schema.provisioners)
    .values({
      id: prefix,
      organisationId: prefix + '-org',
      label: 'Race',
      tokenDigest: prefix + '-token',
      createdBy: 'test',
    });
  const seen = await Promise.all(Array.from({ length: 8 }, () => scim.authenticate(prefix + '-token')));
  expect(seen.every(p => p?.id === prefix)).toBe(true);
  const runs = await database()
    .select({ id: schema.audit.id })
    .from(schema.audit)
    .where(eq(schema.audit.subject, 'provisioner:' + prefix));
  expect(runs).toHaveLength(1);
});
test('a unit placed under a parent while the parent is removed, and two moves that would close a cycle between them: the tree stays whole (D99)', async () => {
  const { prefix, p, scim } = stack();
  const UNIT = 'urn:clew:params:scim:schemas:extension:unit:2.0:Group';
  const unit = (id: string, parent?: string) =>
    scim.createGroup(
      p,
      {
        externalId: `unit:${prefix}-${id}`,
        displayName: id,
        ...(parent ? { [UNIT]: { parent: `unit:${prefix}-${parent}` } } : {}),
      },
      BASE,
    );
  const outcome = (attempt: Promise<unknown>) =>
    attempt.then(
      () => 'done' as const,
      () => 'refused' as const,
    );
  const nodes = async () =>
    Object.fromEntries(
      (
        await database()
          .select({ externalId: schema.groups.externalId, parent: schema.groups.parentUnitId })
          .from(schema.groups)
          .where(like(schema.groups.id, prefix + '%'))
      ).map(r => [r.externalId!.slice(`unit:${prefix}-`.length), r.parent?.slice(prefix.length + 1) ?? null]),
    );
  for (let round = 0; round < 6; round++) {
    const parent = await unit('top' + round);
    const writes = [() => unit('leaf' + round, 'top' + round), () => scim.deleteGroup(p, parent.id)];
    if (round % 2) writes.reverse();
    const [first, second] = await Promise.all(writes.map(write => outcome(write())));
    // Whichever came first, the other was refused: no unit names a parent that is gone.
    expect([first, second].sort()).toEqual(['done', 'refused']);
    const left = await nodes();
    if ('leaf' + round in left) expect(left['top' + round]).toBeNull();
    else expect('top' + round in left).toBe(false);
  }
  // a → b and c → d stand; b under c and d under a at once would make a ring of the four.
  const a = await unit('a'),
    c = await unit('c'),
    b = await unit('b', 'a'),
    d = await unit('d', 'c');
  const move = (group: { id: string }, parent: string) =>
    scim.patchGroup(
      p,
      group.id,
      {
        schemas: [],
        Operations: [{ op: 'replace', path: UNIT + ':parent', value: `unit:${prefix}-${parent}` }],
      },
      BASE,
    );
  const moves = await Promise.all([outcome(move(a, 'd')), outcome(move(c, 'b'))]);
  expect(moves.sort()).toEqual(['done', 'refused']);
  const tree = await nodes();
  for (const start of ['a', 'b', 'c', 'd']) {
    let at: string | null = start,
      hops = 0;
    while (at !== null && hops++ < 10) at = tree[at] ?? null;
    expect(at).toBeNull();
  }
  expect(b.id).not.toBe(d.id);
});
/**
 * A store whose transactions stop after reading a group until `release` is called: the request holds the group, if it
 * locks it, and has not yet written anything.
 */
function pausedAtGroup(inner: ProvisionStore) {
  let reached!: () => void, release!: () => void;
  const atRead = new Promise<void>(resolve => (reached = resolve)),
    gate = new Promise<void>(resolve => (release = resolve));
  const store: ProvisionStore = {
    transaction: fn =>
      inner.transaction(tx =>
        fn({
          ...tx,
          readGroup: async (organisationId, id, lock) => {
            const row = await tx.readGroup(organisationId, id, lock);
            reached();
            await gate;
            return row;
          },
        }),
      ),
  };
  return { store, atRead, release };
}
test('a member is added to a unit while the unit is removed, in either order: the second request waits for the first, and nobody is left on a unit that is gone', async () => {
  const { prefix, deps, p, store, user, grant, scim } = stack();
  const add = (use: typeof scim, groupId: string, personId: string) =>
    use.patchGroup(
      p,
      groupId,
      { schemas: [PATCH], Operations: [{ op: 'add', path: 'members', value: [{ value: personId }] }] },
      BASE,
    );
  const nothingLeft = async (groupId: string, personId: string) => {
    const db = database();
    expect(await grant(personId)).toBeUndefined();
    expect(await db.select().from(schema.groups).where(eq(schema.groups.id, groupId))).toEqual([]);
    expect(await db.select().from(schema.groupMembers).where(eq(schema.groupMembers.personId, personId))).toEqual([]);
    expect(await db.select().from(schema.assignments).where(eq(schema.assignments.personId, personId))).toEqual([]);
  };
  const begin = async (n: number) => ({
    person: (await scim.createUser(p, user(n), BASE)).id,
    unit: (await scim.createGroup(p, { externalId: `unit:${prefix}-gone${n}`, displayName: 'Gone ' + n }, BASE)).id,
  });
  // The addition holds the unit first: the removal waits, then removes the unit with its new member.
  const one = await begin(1),
    adding = pausedAtGroup(store),
    added = add(scimUsecases({ store: adding.store, ...deps }), one.unit, one.person);
  await adding.atRead;
  const removed = scim.deleteGroup(p, one.unit),
    removedDone = settled(removed);
  await new Promise(resolve => setTimeout(resolve, 400));
  expect(removedDone()).toBe(false);
  adding.release();
  await Promise.all([added, removed]);
  await nothingLeft(one.unit, one.person);
  // The removal holds the unit first: the addition waits, then finds no unit to add to.
  const two = await begin(2),
    removing = pausedAtGroup(store),
    gone = scimUsecases({ store: removing.store, ...deps }).deleteGroup(p, two.unit);
  await removing.atRead;
  const late = add(scim, two.unit, two.person),
    lateDone = settled(late);
  await new Promise(resolve => setTimeout(resolve, 400));
  expect(lateDone()).toBe(false);
  removing.release();
  await gone;
  await expect(late).rejects.toMatchObject({ status: 404 });
  await nothingLeft(two.unit, two.person);
});
test('two organisations take one unit at once, one by its unit key and one by its manager key: one holds it and the other is refused (D101)', async () => {
  const ours = stack(),
    theirs = stack();
  for (let round = 0; round < 8; round++) {
    const unit = `${ours.prefix}-shared${round}`,
      keys = ['unit:' + unit, 'unit-manager:' + unit];
    const writes = [
      () => ours.scim.createGroup(ours.p, { externalId: keys[0]!, displayName: 'Ours' }, BASE),
      () => theirs.scim.createGroup(theirs.p, { externalId: keys[1]!, displayName: 'Theirs' }, BASE),
    ];
    if (round % 2) writes.reverse();
    const results = await Promise.all(
      writes.map(write =>
        write().then(
          () => 'done',
          (error: { detail?: string }) => error.detail ?? String(error),
        ),
      ),
    );
    expect(results.filter(r => r === 'done')).toHaveLength(1);
    expect(results.find(r => r !== 'done')).toContain(`The unit '${unit}' is not a unit of this organisation (D101)`);
    const holders = await database()
      .select({ organisationId: schema.groups.organisationId })
      .from(schema.groups)
      .where(inArray(schema.groups.externalId, keys));
    expect(holders).toHaveLength(1);
  }
});
test('one id issued twice at once: the second waits for the first, is told the id is taken, and the first key is the one that opens (D107)', async () => {
  const { prefix, store } = stack();
  const persona = (id: string): AuthenticatedContext => ({
    id,
    name: id,
    unitId: 'u',
    unitLabel: 'U',
    role: 'employee',
    organisationId: prefix + '-org',
    principal: { id: 'person:' + id, kind: 'person' },
    capabilities: ['admin.users'],
    authorizationVersion: 'v',
    sessionBinding: 'test',
    expiresAt: '2099-01-01T00:00:00.000Z',
    authorize: async () => ({ version: 'v' }),
  });
  let n = 0;
  const deps = { clock: () => new Date(), token: () => `${prefix}-token-${++n}`, digest: (t: string) => 'digest:' + t };
  // The first issue stops when its row is written and not yet committed: the moment a second one used to slip past.
  let reached!: () => void, release!: () => void;
  const written = new Promise<void>(resolve => (reached = resolve)),
    gate = new Promise<void>(resolve => (release = resolve));
  const slow: ProvisionStore = {
    transaction: fn =>
      store.transaction(tx =>
        fn({
          ...tx,
          issueProvisioner: async record => {
            const taken = await tx.issueProvisioner(record);
            reached();
            await gate;
            return taken;
          },
        }),
      ),
  };
  const id = prefix + '-cat';
  const first = usersAdminUsecases({ store: slow, ...deps }).issueProvisioner(persona('anna'), { id, label: 'Annas' });
  await written;
  const second = usersAdminUsecases({ store, ...deps }).issueProvisioner(persona('bo'), { id, label: 'Bos' });
  const secondDone = settled(second);
  await new Promise(resolve => setTimeout(resolve, 400));
  expect(secondDone()).toBe(false);
  release();
  const issued = await first;
  await expect(second).rejects.toThrow('Det finns redan en katalog med det id:t.');
  const db = database();
  expect(
    await db
      .select({ label: schema.provisioners.label, tokenDigest: schema.provisioners.tokenDigest })
      .from(schema.provisioners)
      .where(eq(schema.provisioners.id, id)),
  ).toEqual([{ label: 'Annas', tokenDigest: 'digest:' + issued.token }]);
  expect(
    await db
      .select({ actor: schema.audit.actor, action: schema.audit.action })
      .from(schema.audit)
      .where(eq(schema.audit.subject, 'provisioner:' + id)),
  ).toEqual([{ actor: 'person:anna', action: 'provisioner.added' }]);
});
