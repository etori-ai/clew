import { afterAll, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { eq, inArray, like } from 'drizzle-orm';
import { database, schema } from '../../packages/db/src/index';
import { postgresProvisionStore } from '../../apps/server/src/modules/people/adapters/postgres';
import type { ProvisionStore, ProvisionTx } from '../../apps/server/src/modules/people/ports';
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
    // A mapping change's audit row names the group by its key.
    await db.delete(schema.audit).where(like(schema.audit.subject, 'group:' + p + '%'));
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
/**
 * A store whose transactions stop before the first call of any of the named methods until `release` is called. Before
 * `lockPeople`, a group write has read the capability rows and holds nobody yet; before `lockPerson`, a mapping change
 * has written its row; before `unitTree`, a mapping change has derived its group's members and not yet committed.
 */
function pausedBefore(inner: ProvisionStore, ...names: Array<keyof ProvisionTx>) {
  let reached!: () => void, release!: () => void;
  const atCall = new Promise<void>(resolve => (reached = resolve)),
    gate = new Promise<void>(resolve => (release = resolve));
  let paused = false;
  const store: ProvisionStore = {
    transaction: fn =>
      inner.transaction(tx =>
        fn(
          new Proxy(tx, {
            get(target, name) {
              const value: unknown = Reflect.get(target, name);
              if (typeof value !== 'function') return value;
              const call = (...args: unknown[]) => (value as (...a: unknown[]) => unknown).apply(target, args);
              if (!names.includes(name as keyof ProvisionTx)) return call;
              return async (...args: unknown[]) => {
                if (!paused) {
                  paused = true;
                  reached();
                  await gate;
                }
                return call(...args);
              };
            },
          }),
        ),
      ),
  };
  return { store, atCall, release };
}
/**
 * A store that calls `hook` before and after every call of a transaction's ports, with the port's name: a test runs
 * another request there, which commits between two statements of the transaction or waits for what it holds. A
 * transaction's options are handed on, a read's snapshot among them.
 */
function watched(inner: ProvisionStore, hook: (name: string, when: 'before' | 'after') => Promise<void>) {
  const store: ProvisionStore = {
    transaction: (fn, options) =>
      inner.transaction(
        tx =>
          fn(
            new Proxy(tx, {
              get(target, name) {
                const value: unknown = Reflect.get(target, name);
                if (typeof value !== 'function' || typeof name !== 'string') return value;
                return async (...args: unknown[]) => {
                  await hook(name, 'before');
                  const answer = await (value as (...a: unknown[]) => Promise<unknown>).apply(target, args);
                  await hook(name, 'after');
                  return answer;
                };
              },
            }),
          ),
        options,
      ),
  };
  return store;
}
/** An administrator of the stack's organisation on Administration › Användare (D85), and the use cases they call. */
function administration(prefix: string, store: ProvisionStore) {
  const persona: AuthenticatedContext = {
    id: prefix + '-admin',
    name: 'Admin',
    unitId: 'u',
    unitLabel: 'U',
    role: 'employee',
    organisationId: prefix + '-org',
    principal: { id: 'person:' + prefix + '-admin', kind: 'person' },
    capabilities: ['admin.users'],
    authorizationVersion: 'v',
    sessionBinding: 'test',
    expiresAt: '2099-01-01T00:00:00.000Z',
    authorize: async () => ({ version: 'v' }),
  };
  const admin = (use: ProvisionStore = store) =>
    usersAdminUsecases({ store: use, clock: () => new Date(), token: () => prefix + '-token', digest: t => t });
  return { persona, admin };
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
/**
 * Whether a request was still waiting 400 ms after it began. The one it waits for is released after the look either
 * way, so a request that did not wait still lets the test say what it left in the grant before it says it did not wait.
 */
const stillWaiting = async (done: () => boolean, release: () => void) => {
  await new Promise(resolve => setTimeout(resolve, 400));
  const waiting = !done();
  release();
  return waiting;
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
test('a parent PostgreSQL cannot hold is refused by name before the store is asked: a 400, where it once answered 500 (S10)', async () => {
  const { prefix, p, scim } = stack();
  const UNIT = 'urn:clew:params:scim:schemas:extension:unit:2.0:Group';
  await scim.createGroup(p, { externalId: `unit:${prefix}-root`, displayName: 'Rot' }, BASE);
  const leaf = await scim.createGroup(
    p,
    { externalId: `unit:${prefix}-leaf`, displayName: 'Löv', [UNIT]: { parent: `unit:${prefix}-root` } },
    BASE,
  );
  const parent = `unit:${prefix}-root\u0000`,
    patched = (operation: object) => scim.patchGroup(p, leaf.id, { schemas: [PATCH], Operations: [operation] }, BASE);
  for (const attempt of [
    () => scim.createGroup(p, { externalId: `unit:${prefix}-ny`, displayName: 'Ny', [UNIT]: { parent } }, BASE),
    () =>
      scim.replaceGroup(
        p,
        leaf.id,
        { externalId: `unit:${prefix}-leaf`, displayName: 'Löv', [UNIT]: { parent } },
        BASE,
      ),
    () => patched({ op: 'replace', path: UNIT + ':parent', value: parent }),
    () => patched({ op: 'replace', path: UNIT, value: { parent } }),
    () => patched({ op: 'replace', value: { [UNIT]: { parent } } }),
  ])
    await expect(attempt()).rejects.toMatchObject({
      status: 400,
      scimType: 'invalidValue',
      detail: `Attribute '${UNIT}:parent' holds a NUL character, which cannot be stored.`,
    });
  // The tree is as it was: the leaf under the root, and no unit was added.
  const rows = await database()
    .select({ externalId: schema.groups.externalId, parent: schema.groups.parentUnitId })
    .from(schema.groups)
    .where(like(schema.groups.id, prefix + '%'));
  expect(Object.fromEntries(rows.map(r => [r.externalId, r.parent]))).toEqual({
    [`unit:${prefix}-root`]: null,
    [`unit:${prefix}-leaf`]: `${prefix}-root`,
  });
});
test("a member who comes or goes moves the group's time of change in the store, so the next read answers it too", async () => {
  const { p, user, scim } = stack();
  const { id: person } = await scim.createUser(p, user(1), BASE);
  const group = await scim.createGroup(p, { externalId: `${p.id}:plain`, displayName: 'Plain' }, BASE);
  await new Promise(resolve => setTimeout(resolve, 5));
  const changed = await scim.patchGroup(
    p,
    group.id,
    { schemas: [PATCH], Operations: [{ op: 'add', path: 'members', value: [{ value: person }] }] },
    BASE,
  );
  expect(changed.meta.lastModified > group.meta.lastModified).toBe(true);
  const read = await scim.getGroup(p, group.id, BASE);
  expect([read.meta.lastModified, read.members.length]).toEqual([changed.meta.lastModified, 1]);
});
test("a member's time of change moves in the store with the group write that lists the group on the member's resource, renames it there or takes it away (S13)", async () => {
  const { p, user, scim } = stack();
  const [a, b] = [(await scim.createUser(p, user(1), BASE)).id, (await scim.createUser(p, user(2), BASE)).id];
  const group = await scim.createGroup(
    p,
    { externalId: `${p.id}:plain`, displayName: 'Plain', members: [{ value: a }] },
    BASE,
  );
  expect((await scim.getUser(p, a, BASE)).meta.lastModified).toBe(group.meta.lastModified);
  await new Promise(resolve => setTimeout(resolve, 5));
  const changed = await scim.patchGroup(
    p,
    group.id,
    {
      schemas: [PATCH],
      Operations: [
        { op: 'add', path: 'members', value: [{ value: b }] },
        { op: 'replace', path: 'displayName', value: 'Renamed' },
      ],
    },
    BASE,
  );
  for (const id of [a, b]) {
    const read = await scim.getUser(p, id, BASE);
    expect([read.meta.lastModified, read.groups.map(g => g.display)]).toEqual([changed.meta.lastModified, ['Renamed']]);
  }
  await new Promise(resolve => setTimeout(resolve, 5));
  await scim.deleteGroup(p, group.id);
  for (const id of [a, b]) {
    const read = await scim.getUser(p, id, BASE);
    expect([read.meta.lastModified > changed.meta.lastModified, read.groups]).toEqual([true, []]);
  }
});
test("a member's new name moves the time of change of the group that lists them, read with or without its members, and a new address does not (the mirror of S13)", async () => {
  const { p, user, scim } = stack();
  const [a, b] = [(await scim.createUser(p, user(1), BASE)).id, (await scim.createUser(p, user(2), BASE)).id];
  const externalId = `${p.id}:plain`,
    group = await scim.createGroup(
      p,
      { externalId, displayName: 'Plain', members: [{ value: a }, { value: b }] },
      BASE,
    );
  await new Promise(resolve => setTimeout(resolve, 5));
  const renamed = await scim.patchUser(
    p,
    a,
    { schemas: [PATCH], Operations: [{ op: 'replace', path: 'displayName', value: 'Anna Omdöpt' }] },
    BASE,
  );
  const at = renamed.meta.lastModified;
  expect(at > group.meta.lastModified).toBe(true);
  const read = await scim.getGroup(p, group.id, BASE);
  expect([read.meta.lastModified, read.members.map(m => m.display)]).toEqual([at, ['Anna Omdöpt', 'Person 2']]);
  expect((await scim.getGroup(p, group.id, BASE, { excludedAttributes: 'members' })).meta.lastModified).toBe(at);
  const listed = await scim.listGroups(
    p,
    { filter: `externalId eq "${externalId}"`, excludedAttributes: 'members' },
    BASE,
  );
  expect(listed.Resources.map(g => g.meta.lastModified)).toEqual([at]);
  await new Promise(resolve => setTimeout(resolve, 5));
  await scim.patchUser(
    p,
    b,
    {
      schemas: [PATCH],
      Operations: [{ op: 'replace', path: 'emails[type eq "work"].value', value: `${p.id}.new@example.test` }],
    },
    BASE,
  );
  expect((await scim.getGroup(p, group.id, BASE)).meta.lastModified).toBe(at);
});
test("members renamed while the groups that list them are written, at once, all finish, and a group's time is never earlier than its members' last new name (the mirror of S13)", async () => {
  const { prefix, p, user, scim } = stack();
  const ids: string[] = [];
  for (let n = 1; n <= 6; n++) ids.push((await scim.createUser(p, user(n), BASE)).id);
  // A user write that took the groups after its person would wait on a group write that waits on the person: neither
  // does, the name's time being read with the group.
  const keys = [`${prefix}:first`, `${prefix}:second`],
    groups: string[] = [];
  for (const externalId of keys)
    groups.push(
      (await scim.createGroup(p, { externalId, displayName: externalId, members: ids.map(value => ({ value })) }, BASE))
        .id,
    );
  const rename = (id: string, name: string) =>
    scim.patchUser(
      p,
      id,
      { schemas: [PATCH], Operations: [{ op: 'replace', path: 'displayName', value: name }] },
      BASE,
    );
  const renamedAt = new Map<string, string>();
  for (let round = 0; round < 4; round++) {
    const [, renames] = await Promise.all([
      Promise.all(
        keys.map((externalId, k) =>
          scim.replaceGroup(
            p,
            groups[k]!,
            {
              externalId,
              displayName: `${externalId} ${round}`,
              members: (k ? [...ids].reverse() : ids)
                .filter(id => id !== ids[(round + k) % ids.length])
                .map(value => ({ value })),
            },
            BASE,
          ),
        ),
      ),
      Promise.all(ids.map(id => rename(id, `Person ${id} ${round}`))),
    ]);
    renames.forEach((renamed, n) => renamedAt.set(ids[n]!, renamed.meta.lastModified));
  }
  for (const id of groups) {
    const read = await scim.getGroup(p, id, BASE);
    expect(read.members.length).toBe(ids.length - 1);
    for (const member of read.members) {
      expect(member.display).toBe(`Person ${member.value} 3`);
      expect(read.meta.lastModified >= renamedAt.get(member.value)!).toBe(true);
    }
  }
  // A name given after all of it is the time of both groups, which list the person.
  await new Promise(resolve => setTimeout(resolve, 5));
  const last = await rename(ids[0]!, 'Last');
  const times: string[] = [];
  for (const id of groups) times.push((await scim.getGroup(p, id, BASE)).meta.lastModified);
  expect(times).toEqual([last.meta.lastModified, last.meta.lastModified]);
});
test('a GET and a list of groups read the group, its members and their names from one snapshot: a member renamed in the middle of the read is in none of it, and the next read answers the new name under its own time (the mirror of S13)', async () => {
  const { deps, p, store, user, scim } = stack();
  const [a, b] = [(await scim.createUser(p, user(1), BASE)).id, (await scim.createUser(p, user(2), BASE)).id];
  const externalId = `${p.id}:plain`,
    group = await scim.createGroup(
      p,
      { externalId, displayName: 'Plain', members: [{ value: a }, { value: b }] },
      BASE,
    );
  type Read = (use: typeof scim) => ReturnType<typeof scim.getGroup>;
  const get: Read = use => use.getGroup(p, group.id, BASE),
    list: Read = async use =>
      (await use.listGroups(p, { filter: `externalId eq "${externalId}"` }, BASE)).Resources[0]!;
  // The rename commits right after the read took the group, or right before it reads the members: the time of the
  // members' names was once read in a statement of its own before them, so the new name came under the old time.
  const cases: Array<[Read, string, 'before' | 'after']> = [
    [get, 'readGroup', 'after'],
    [get, 'groupMembers', 'before'],
    [list, 'listGroups', 'after'],
    [list, 'groupMembers', 'before'],
  ];
  for (const [n, [read, port, when]] of cases.entries()) {
    const before = await get(scim);
    await new Promise(resolve => setTimeout(resolve, 5));
    let renamedAt = '';
    const racing = await read(
      scimUsecases({
        store: watched(store, async (name, moment) => {
          if (name !== port || moment !== when || renamedAt) return;
          renamedAt = (
            await scim.patchUser(
              p,
              a,
              { schemas: [PATCH], Operations: [{ op: 'replace', path: 'displayName', value: `Renamed ${n}` }] },
              BASE,
            )
          ).meta.lastModified;
        }),
        ...deps,
      }),
    );
    const next = await get(scim);
    expect(renamedAt > before.meta.lastModified).toBe(true);
    // All of it as it was at one moment: the names, and the time with them.
    expect([racing.members.map(m => m.display), racing.meta.lastModified]).toEqual([
      before.members.map(m => m.display),
      before.meta.lastModified,
    ]);
    expect([next.members.map(m => m.display), next.meta.lastModified]).toEqual([
      [`Renamed ${n}`, 'Person 2'],
      renamedAt,
    ]);
  }
});
test('a GET and a list of users read the person and the groups their resource lists from one snapshot: a group renamed in the middle of the read is in none of it (S13)', async () => {
  const { deps, p, store, user, scim } = stack();
  const a = (await scim.createUser(p, user(1), BASE)).id,
    group = await scim.createGroup(
      p,
      { externalId: `${p.id}:plain`, displayName: 'Plain', members: [{ value: a }] },
      BASE,
    );
  type Read = (use: typeof scim) => ReturnType<typeof scim.getUser>;
  const get: Read = use => use.getUser(p, a, BASE),
    list: Read = async use => (await use.listUsers(p, { filter: `externalId eq "${p.id}:1"` }, BASE)).Resources[0]!;
  // The group write renames the group and moves the person's time (S13) between the read of the person and the read
  // of their groups: the new name once came under the person's old time.
  for (const [n, [read, port]] of (
    [
      [get, 'readUser'],
      [list, 'listUsers'],
    ] as const
  ).entries()) {
    const before = await get(scim);
    await new Promise(resolve => setTimeout(resolve, 5));
    let renamedAt = '';
    const racing = await read(
      scimUsecases({
        store: watched(store, async (name, moment) => {
          if (name !== port || moment !== 'after' || renamedAt) return;
          renamedAt = (
            await scim.patchGroup(
              p,
              group.id,
              { schemas: [PATCH], Operations: [{ op: 'replace', path: 'displayName', value: `Renamed ${n}` }] },
              BASE,
            )
          ).meta.lastModified;
        }),
        ...deps,
      }),
    );
    const next = await get(scim);
    expect(renamedAt > before.meta.lastModified).toBe(true);
    expect([racing.groups.map(g => g.display), racing.meta.lastModified]).toEqual([
      before.groups.map(g => g.display),
      before.meta.lastModified,
    ]);
    expect([next.groups.map(g => g.display), next.meta.lastModified]).toEqual([[`Renamed ${n}`], renamedAt]);
  }
});
test("a group write answers each member's name under a time no earlier than the name, when a member it does not hold is renamed while it writes (the mirror of S13)", async () => {
  const { deps, p, store, user, scim } = stack();
  const ids: string[] = [];
  for (let n = 1; n <= 3; n++) ids.push((await scim.createUser(p, user(n), BASE)).id);
  const [a, b, c] = ids as [string, string, string],
    group = await scim.createGroup(
      p,
      { externalId: `${p.id}:plain`, displayName: 'Plain', members: [{ value: a }, { value: b }] },
      BASE,
    );
  await new Promise(resolve => setTimeout(resolve, 5));
  // The write adds c and holds nobody else; b is renamed, and committed, once the group is written and before the
  // answer reads the members. Their time was once read in a statement of its own before them.
  let written = false,
    renamedAt = '';
  const answered = await scimUsecases({
    store: watched(store, async (name, moment) => {
      if (name === 'updateGroup' && moment === 'after') written = true;
      if (!written || name !== 'groupMembers' || moment !== 'before' || renamedAt) return;
      await new Promise(resolve => setTimeout(resolve, 5));
      renamedAt = (
        await scim.patchUser(
          p,
          b,
          { schemas: [PATCH], Operations: [{ op: 'replace', path: 'displayName', value: 'Renamed' }] },
          BASE,
        )
      ).meta.lastModified;
    }),
    ...deps,
  }).patchGroup(
    p,
    group.id,
    { schemas: [PATCH], Operations: [{ op: 'add', path: 'members', value: [{ value: c }] }] },
    BASE,
  );
  expect(renamedAt > group.meta.lastModified).toBe(true);
  expect([answered.members.map(m => m.display), answered.meta.lastModified]).toEqual([
    ['Person 1', 'Renamed', 'Person 3'],
    renamedAt,
  ]);
  expect((await scim.getGroup(p, group.id, BASE)).meta.lastModified).toBe(renamedAt);
});
test("a member renamed while a group write takes them out, puts them in a new group or removes their group waits for the write: neither the group's time nor the member's goes back (the mirror of S13)", async () => {
  const { prefix, deps, p, store, user, scim } = stack();
  let n = 0;
  const pair = async () =>
    [(await scim.createUser(p, user(++n), BASE)).id, (await scim.createUser(p, user(++n), BASE)).id] as const;
  /**
   * `write`, held at `port` once it has written the group and holds whom it holds, while `a` is renamed, and what
   * `meanwhile` reads then. The write once took its time before it held `a`: a rename with a later time committed
   * first, and the write then gave the group it took `a` out of, and `a`, its earlier time.
   */
  const renamedDuring = async <T>(
    a: string,
    port: string,
    write: (use: typeof scim) => Promise<T>,
    meanwhile?: () => Promise<string>,
  ) => {
    let renaming: ReturnType<typeof scim.patchUser> | undefined,
      waited = false,
      seen: string | undefined;
    const written = await write(
      scimUsecases({
        store: watched(store, async (name, moment) => {
          if (name !== port || moment !== 'after' || renaming) return;
          await new Promise(resolve => setTimeout(resolve, 5));
          renaming = scim.patchUser(
            p,
            a,
            { schemas: [PATCH], Operations: [{ op: 'replace', path: 'displayName', value: `Renamed ${port}` }] },
            BASE,
          );
          waited = await stillWaiting(settled(renaming), () => undefined);
          seen = await meanwhile?.();
        }),
        ...deps,
      }),
    );
    const renamed = (await renaming!).meta.lastModified;
    // The rename came last, so a's time is its own.
    expect((await scim.getUser(p, a, BASE)).meta.lastModified).toBe(renamed);
    return { written, waited, renamed, seen };
  };
  // Taken out of a group: the group's time, as a client reads it before, during and after the write.
  const [a, b] = await pair();
  const group = await scim.createGroup(
    p,
    { externalId: `${prefix}:out`, displayName: 'Ut', members: [{ value: a }, { value: b }] },
    BASE,
  );
  await new Promise(resolve => setTimeout(resolve, 5));
  const read = async () => (await scim.getGroup(p, group.id, BASE)).meta.lastModified;
  const out = await renamedDuring(
    a,
    'setGroupMembers',
    use =>
      use.patchGroup(
        p,
        group.id,
        { schemas: [PATCH], Operations: [{ op: 'remove', path: `members[value eq "${a}"]` }] },
        BASE,
      ),
    read,
  );
  const times = [group.meta.lastModified, out.seen!, out.written.meta.lastModified, await read()];
  expect([out.waited, times, out.renamed > out.written.meta.lastModified]).toEqual([true, [...times].sort(), true]);
  // Put in a new group, and the group removed: the member's time.
  const [c, d] = await pair();
  const made = await renamedDuring(c, 'insertGroup', use =>
    use.createGroup(p, { externalId: `${prefix}:in`, displayName: 'In', members: [{ value: c }, { value: d }] }, BASE),
  );
  expect([made.waited, made.renamed > made.written.meta.lastModified]).toEqual([true, true]);
  const removed = await renamedDuring(c, 'deleteGroup', use => use.deleteGroup(p, made.written.id));
  expect(removed.waited).toBe(true);
});
test('groups that share their members, renamed while members come and go, written at once in different orders, all finish (S13)', async () => {
  const { prefix, p, user, grant, scim } = stack();
  const ids: string[] = [];
  for (let n = 1; n <= 6; n++) ids.push((await scim.createUser(p, user(n), BASE)).id);
  await database()
    .insert(schema.groupCapabilities)
    .values({ organisationId: p.organisationId, groupExternalId: `${prefix}:admins`, capability: 'admin.users' });
  // A group that gives a capability (who comes or goes is derived, and every member touched), one that gives nothing
  // (every member touched, nobody derived) and a unit (its new name derives every member): each holds the people in
  // id order, in one pass, whichever of the two takes them.
  const keys = [`${prefix}:admins`, `${prefix}:plain`, `unit:${prefix}-u`],
    groups: string[] = [];
  for (const externalId of keys)
    groups.push((await scim.createGroup(p, { externalId, displayName: externalId }, BASE)).id);
  const outOf = (round: number, k: number) => ids[(round + 2 * k) % ids.length]!;
  let times: string[] = [];
  for (let round = 0; round < 6; round++) {
    const written = await Promise.all(
      keys.map((externalId, k) =>
        scim.replaceGroup(
          p,
          groups[k]!,
          {
            externalId,
            displayName: `${externalId} ${round}`,
            members: (k === 1 ? [...ids].reverse() : ids)
              .filter(id => id !== outOf(round, k))
              .map(value => ({ value })),
          },
          BASE,
        ),
      ),
    );
    times = written.map(g => g.meta.lastModified);
  }
  // Every write of the last round renamed its group, so each person's time is one of theirs.
  for (const id of ids) expect(times).toContain((await scim.getUser(p, id, BASE)).meta.lastModified);
  // And the grants are what the last round left: the unit's members act on it, with the capability if they have it.
  for (const id of ids)
    expect(await grant(id)).toEqual(
      id === outOf(5, 2) ? undefined : { role: 'employee', capabilities: id === outOf(5, 0) ? [] : ['admin.users'] },
    );
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
test("a person's externalId changed while a group write adds them, by PATCH and by PUT: the group write waits, and both are written (S4)", async () => {
  const { prefix, deps, p, store, user, scim } = stack();
  for (const [round, verb] of (['patch', 'put'] as const).entries()) {
    const n = round + 1,
      person = (await scim.createUser(p, user(n), BASE)).id,
      group = await scim.createGroup(p, { externalId: `${prefix}:plain${n}`, displayName: 'Plain' }, BASE),
      key = `${prefix}:${n}:moved`;
    // The user write holds the person and stops before it writes the new key.
    const holding = pausedBefore(store, 'updateUser'),
      users = scimUsecases({ store: holding.store, ...deps }),
      rekeyed =
        verb === 'patch'
          ? users.patchUser(
              p,
              person,
              { schemas: [PATCH], Operations: [{ op: 'replace', path: 'externalId', value: key }] },
              BASE,
            )
          : users.replaceUser(p, person, { ...user(n), externalId: key }, BASE);
    await holding.atCall;
    // The group write inserts the membership, whose foreign key holds a key-share lock on the person, and then waits
    // for the person behind the user write. Writing the new key once needed `FOR UPDATE`, which waits for that
    // key-share lock: PostgreSQL ended one of the two as a deadlock, and the route answered 500.
    const added = scim.patchGroup(
        p,
        group.id,
        { schemas: [PATCH], Operations: [{ op: 'add', path: 'members', value: [{ value: person }] }] },
        BASE,
      ),
      addedWaited = await stillWaiting(settled(added), holding.release);
    const [written, members] = await Promise.all([rekeyed, added]);
    expect(addedWaited).toBe(true);
    expect(written.externalId).toBe(key);
    expect(members.members.map(m => m.value)).toEqual([person]);
    expect(await scim.getUser(p, person, BASE)).toMatchObject({ externalId: key, groups: [{ value: group.id }] });
  }
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
test("an organisation's capability rows held for a read let other reads through and keep a change out until they commit, and held for a change keep reads out (B1)", async () => {
  const { prefix, store } = stack();
  const org = prefix + '-org';
  const hold = (mode: 'read' | 'change') => {
    let held!: () => void, release!: () => void;
    const taken = new Promise<void>(resolve => (held = resolve)),
      gate = new Promise<void>(resolve => (release = resolve));
    const done = store.transaction(async tx => {
      await tx.lockGroupCapabilities(org, mode);
      held();
      await gate;
    });
    return { taken, release, done };
  };
  const take = (mode: 'read' | 'change', organisationId = org) =>
    store.transaction(tx => tx.lockGroupCapabilities(organisationId, mode));
  // Held for a read: another read is taken beside it, and so is a change of another organisation's rows; a change of
  // these waits until the read commits.
  const reading = hold('read');
  await reading.taken;
  await take('read');
  await take('change', prefix + '-elsewhere');
  const change = take('change'),
    changeWaited = await stillWaiting(settled(change), reading.release);
  await Promise.all([reading.done, change]);
  expect(changeWaited).toBe(true);
  // Held for a change: a read waits until it commits.
  const changing = hold('change');
  await changing.taken;
  const read = take('read'),
    readWaited = await stillWaiting(settled(read), changing.release);
  await Promise.all([changing.done, read]);
  expect(readWaited).toBe(true);
});
test('a mapping taken away while a group write derives a member of its group, in either order: the capability does not come back (B1)', async () => {
  const { prefix, deps, p, store, user, grant, scim } = stack();
  const { persona, admin } = administration(prefix, store),
    mapping = { groupExternalId: `${prefix}:admins`, capability: 'admin.users' as const };
  const person = (await scim.createUser(p, user(1), BASE)).id,
    member = [{ value: person }];
  await scim.createGroup(p, { externalId: `unit:${prefix}-u`, displayName: 'U', members: member }, BASE);
  await scim.createGroup(p, { externalId: mapping.groupExternalId, displayName: 'Admins', members: member }, BASE);
  const second = await scim.createGroup(p, { externalId: `unit:${prefix}-v`, displayName: 'V' }, BASE);
  const placed = (use: typeof scim, op: 'add' | 'remove') =>
    use.patchGroup(
      p,
      second.id,
      {
        schemas: [PATCH],
        Operations: [
          op === 'add' ? { op, path: 'members', value: member } : { op, path: `members[value eq "${person}"]` },
        ],
      },
      BASE,
    );
  // The write first: it has read the rows and holds nobody yet. The removal waits for it, then derives the person
  // from the rows it leaves. Without the wait the write derived from the rows it had read, the row back in them.
  await admin().addGroupCapability(persona, mapping);
  expect(await grant(person)).toEqual({ role: 'employee', capabilities: ['admin.users'] });
  const writing = pausedBefore(store, 'lockPeople'),
    write = placed(scimUsecases({ store: writing.store, ...deps }), 'add');
  await writing.atCall;
  const removal = admin().removeGroupCapability(persona, mapping),
    removalWaited = await stillWaiting(settled(removal), writing.release);
  await Promise.all([write, removal]);
  expect(await grant(person)).toEqual({ role: 'employee', capabilities: [] });
  expect(removalWaited).toBe(true);
  // The removal first: it has derived the person and not committed. The write waits for it and reads what it left.
  await admin().addGroupCapability(persona, mapping);
  expect(await grant(person)).toEqual({ role: 'employee', capabilities: ['admin.users'] });
  const removing = pausedBefore(store, 'unitTree'),
    removed = admin(removing.store).removeGroupCapability(persona, mapping);
  await removing.atCall;
  const late = placed(scim, 'remove'),
    lateWaited = await stillWaiting(settled(late), removing.release);
  await Promise.all([removed, late]);
  expect(await grant(person)).toEqual({ role: 'employee', capabilities: [] });
  expect(lateWaited).toBe(true);
  expect(
    await database()
      .select()
      .from(schema.groupCapabilities)
      .where(eq(schema.groupCapabilities.organisationId, p.organisationId)),
  ).toEqual([]);
});
test('two mapping changes on groups that share a person, at once: the person holds what the rows give when both are done (B1)', async () => {
  const { prefix, p, store, user, grant, scim } = stack();
  const { persona, admin } = administration(prefix, store);
  const person = (await scim.createUser(p, user(1), BASE)).id,
    member = [{ value: person }];
  await scim.createGroup(p, { externalId: `unit:${prefix}-u`, displayName: 'U', members: member }, BASE);
  for (const key of ['a', 'b'])
    await scim.createGroup(p, { externalId: `${prefix}:${key}`, displayName: key, members: member }, BASE);
  await admin().addGroupCapability(persona, { groupExternalId: `${prefix}:b`, capability: 'admin.users' });
  expect(await grant(person)).toEqual({ role: 'employee', capabilities: ['admin.users'] });
  // The first change has written its row and read the rows, and holds nobody yet; the second waits for it, and then
  // derives from the first one's row and without its own.
  const first = pausedBefore(store, 'lockPerson'),
    adding = admin(first.store).addGroupCapability(persona, {
      groupExternalId: `${prefix}:a`,
      capability: 'admin.connectors',
    });
  await first.atCall;
  const removing = admin().removeGroupCapability(persona, {
      groupExternalId: `${prefix}:b`,
      capability: 'admin.users',
    }),
    removingWaited = await stillWaiting(settled(removing), first.release);
  await Promise.all([adding, removing]);
  expect(await grant(person)).toEqual({ role: 'employee', capabilities: ['admin.connectors'] });
  expect(removingWaited).toBe(true);
});
test('a row whose group is gone is taken away while the group is pushed again, in either order: nobody keeps what no row gives (B1)', async () => {
  const { prefix, deps, p, store, user, grant, scim } = stack();
  const { persona, admin } = administration(prefix, store),
    mapping = { groupExternalId: `${prefix}:k`, capability: 'admin.users' as const };
  const person = (await scim.createUser(p, user(1), BASE)).id,
    member = [{ value: person }];
  await scim.createGroup(p, { externalId: `unit:${prefix}-u`, displayName: 'U', members: member }, BASE);
  const push = (use: typeof scim) =>
    use.createGroup(p, { externalId: mapping.groupExternalId, displayName: 'K', members: member }, BASE);
  // Mapped and then removed: the row stays (D85) and gives nobody anything until the group returns. No group lock
  // covers such a row, so only the hold on the rows keeps the push and the removal apart.
  const orphan = async () => {
    const group = await push(scim);
    await admin().addGroupCapability(persona, mapping);
    expect(await grant(person)).toEqual({ role: 'employee', capabilities: ['admin.users'] });
    await scim.deleteGroup(p, group.id);
    expect(await grant(person)).toEqual({ role: 'employee', capabilities: [] });
  };
  // The push first: it has read the row and holds nobody yet. The removal waits, then finds the group's member.
  await orphan();
  const pushing = pausedBefore(store, 'lockPeople'),
    pushed = push(scimUsecases({ store: pushing.store, ...deps }));
  await pushing.atCall;
  const removal = admin().removeGroupCapability(persona, mapping),
    removalWaited = await stillWaiting(settled(removal), pushing.release);
  const [group] = await Promise.all([pushed, removal]);
  expect(await grant(person)).toEqual({ role: 'employee', capabilities: [] });
  expect(removalWaited).toBe(true);
  // The removal first: it found no group and nobody to derive, and has not committed. The push waits for it and reads
  // the rows it left; it once read the row still there and gave the capability that nothing gives any more.
  await scim.deleteGroup(p, group.id);
  await orphan();
  const removing = pausedBefore(store, 'unitTree'),
    removed = admin(removing.store).removeGroupCapability(persona, mapping);
  await removing.atCall;
  const late = push(scim),
    lateWaited = await stillWaiting(settled(late), removing.release);
  await Promise.all([removed, late]);
  expect(await grant(person)).toEqual({ role: 'employee', capabilities: [] });
  expect(lateWaited).toBe(true);
});
/**
 * A store whose transactions, their work done, hold everything they locked until `release` is called, and only then
 * commit: a SCIM write that another request meets while it waits for the write's locks.
 */
function heldOpen(inner: ProvisionStore) {
  let done!: () => void, release!: () => void;
  const atCommit = new Promise<void>(resolve => (done = resolve)),
    gate = new Promise<void>(resolve => (release = resolve));
  const store: ProvisionStore = {
    transaction: fn =>
      inner.transaction(async tx => {
        const result = await fn(tx);
        done();
        await gate;
        return result;
      }),
  };
  return { store, atCommit, release };
}
test('a group re-keyed or removed while a mapping to it is added waits for that write, and is then no group to map: refused, and nothing is written (K4)', async () => {
  const { prefix, deps, p, store, user, grant, scim } = stack();
  const { persona, admin } = administration(prefix, store);
  const person = (await scim.createUser(p, user(1), BASE)).id,
    member = [{ value: person }];
  await scim.createGroup(p, { externalId: `unit:${prefix}-u`, displayName: 'U', members: member }, BASE);
  for (const write of ['re-key', 'delete'] as const) {
    const key = `${prefix}:${write}`,
      group = await scim.createGroup(p, { externalId: key, displayName: 'IT-personal', members: member }, BASE);
    // The SCIM write has done its work and holds the group's row; the addition waits for it, then finds the key held
    // by no group, as it would one after the other.
    const writing = heldOpen(store),
      writer = scimUsecases({ store: writing.store, ...deps }),
      written =
        write === 're-key'
          ? writer.patchGroup(
              p,
              group.id,
              { schemas: [PATCH], Operations: [{ op: 'replace', path: 'externalId', value: key + '-v2' }] },
              BASE,
            )
          : writer.deleteGroup(p, group.id);
    await writing.atCommit;
    const adding = admin().addGroupCapability(persona, { groupExternalId: key, capability: 'admin.users' }),
      addingWaited = await stillWaiting(settled(adding), writing.release);
    await written;
    await expect(adding).rejects.toThrow('Gruppen finns inte bland de provisionerade grupperna.');
    expect(addingWaited).toBe(true);
    expect(
      await database()
        .select()
        .from(schema.groupCapabilities)
        .where(eq(schema.groupCapabilities.organisationId, p.organisationId)),
    ).toEqual([]);
    expect(
      await database()
        .select()
        .from(schema.audit)
        .where(eq(schema.audit.subject, 'group:' + key)),
    ).toEqual([]);
    expect(await grant(person)).toEqual({ role: 'employee', capabilities: [] });
  }
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
