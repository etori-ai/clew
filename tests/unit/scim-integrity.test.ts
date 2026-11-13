import { describe, expect, test } from 'bun:test';
import type { AuthenticatedContext } from '@clew/contracts';
import { memoryProvisionStore } from '../../apps/server/src/modules/people/adapters/memory';
import type { ProvisionStore, ProvisionTx } from '../../apps/server/src/modules/people/ports';
import { scimUsecases, usersAdminUsecases } from '../../apps/server/src/modules/people/usecases';

/**
 * What one organisation's push may do to another's, what a group write costs, and what the audit says afterwards: the
 * integrity half of the review of 2026-11-11 (`docs/reviews/2026-11-11-scim-full-review.md`). On the memory adapter;
 * the store's side of each is in `tests/scim-store-contract.ts`, which runs on PostgreSQL too.
 */
const BASE = 'https://clew.test/scim/v2',
  PATCH = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';
function stack(wrap: (store: ProvisionStore) => ProvisionStore = store => store) {
  const store = memoryProvisionStore();
  let seq = 0;
  const deps = {
    store: wrap(store),
    clock: () => new Date('2026-11-09T06:00:00.000Z'),
    ids: () => 'id-' + ++seq,
    digest: (token: string) => 'digest:' + token,
  };
  const scim = scimUsecases(deps),
    admin = usersAdminUsecases({ ...deps, token: () => 'token' });
  const a = { id: 'a', organisationId: 'org-a', label: 'A' },
    b = { id: 'b', organisationId: 'org-b', label: 'B' };
  let n = 0;
  const person = async (p: typeof a) => {
    const k = ++n;
    return (
      await scim.createUser(
        p,
        {
          externalId: `${p.id}-${k}`,
          userName: `${p.id}.user${k}`,
          displayName: 'P ' + k,
          emails: [{ value: `p${k}@x.se` }],
        },
        BASE,
      )
    ).id;
  };
  const administrator = (organisationId: string): AuthenticatedContext =>
    ({
      id: 'admin-' + organisationId,
      name: 'Admin',
      organisationId,
      unitId: 'u',
      unitLabel: 'U',
      role: 'employee',
      capabilities: ['admin.users'],
      principal: { id: 'person:admin-' + organisationId, kind: 'person' },
      authorizationVersion: 'v1',
      sessionBinding: 'test',
      expiresAt: '2099-01-01T00:00:00Z',
      authorize: async () => ({ version: 'v1' }),
    }) as unknown as AuthenticatedContext;
  const patch = (Operations: unknown[]) => ({ schemas: [PATCH], Operations });
  return { store, scim, admin, a, b, person, administrator, patch };
}
describe('between organisations (D101)', () => {
  test('a capability row left by a group that is gone is not picked up by another organisation, nor shown to it', async () => {
    const { store, scim, admin, a, b, person, administrator } = stack();
    const group = await scim.createGroup(a, { externalId: 'it-admins', displayName: 'IT' }, BASE);
    await admin.addGroupCapability(administrator('org-a'), { groupExternalId: 'it-admins', capability: 'admin.users' });
    await scim.deleteGroup(a, group.id);
    // The row outlives its group (D85) and is A's.
    expect((await admin.overview(administrator('org-a'))).groupCapabilities).toHaveLength(1);
    expect((await admin.overview(administrator('org-b'))).groupCapabilities).toEqual([]);
    const member = await person(b);
    await scim.createGroup(b, { externalId: 'unit:b1', displayName: 'B1', members: [{ value: member }] }, BASE);
    await scim.createGroup(b, { externalId: 'it-admins', displayName: 'IT hos B', members: [{ value: member }] }, BASE);
    expect(store.state.grants.get(member)).toMatchObject({ unitId: 'b1', capabilities: [] });
    // When A's group returns, the row applies again, to A's people.
    const back = await person(a);
    await scim.createGroup(a, { externalId: 'unit:a1', displayName: 'A1', members: [{ value: back }] }, BASE);
    await expect(
      scim.createGroup(a, { externalId: 'it-admins', displayName: 'IT', members: [{ value: back }] }, BASE),
    ).rejects.toMatchObject({ status: 409 });
    // B may map its own group of that id, and that is B's row alone.
    await admin.addGroupCapability(administrator('org-b'), {
      groupExternalId: 'it-admins',
      capability: 'admin.connectors',
    });
    expect(store.state.grants.get(member)?.capabilities).toEqual(['admin.connectors']);
    expect(store.state.groupCapabilities).toEqual([
      { organisationId: 'org-a', groupExternalId: 'it-admins', capability: 'admin.users' },
      { organisationId: 'org-b', groupExternalId: 'it-admins', capability: 'admin.connectors' },
    ]);
  });
  test('a unit one organisation has left gives the next one no name of it: the row is taken over whole', async () => {
    const { store, scim, a, b, person } = stack();
    const first = await person(a);
    const unit = await scim.createGroup(
      a,
      { externalId: 'unit:x', displayName: 'Socialtjänst utredning A', members: [{ value: first }] },
      BASE,
    );
    expect(store.state.units.get('x')).toEqual({ organisationId: 'org-a', label: 'Socialtjänst utredning A' });
    await scim.deleteGroup(a, unit.id);
    const manager = await person(b);
    await scim.createGroup(
      b,
      { externalId: 'unit-manager:x', displayName: 'Chefer', members: [{ value: manager }] },
      BASE,
    );
    expect(store.state.grants.get(manager)).toMatchObject({ unitId: 'x', unitLabel: 'x', role: 'manager' });
    expect(store.state.units.get('x')).toEqual({ organisationId: 'org-b', label: 'x' });
  });
  test('a key with space in or before it is a key written wrong, and is refused as one in another case is (D93, D96)', async () => {
    const { scim, a } = stack();
    for (const externalId of [
      ' unit:x',
      'unit :x',
      '\tunit:x',
      'unit-manager :x',
      ' capability:admin.users',
      ' protected',
      'protected ',
      'Unit:x',
    ])
      await expect(scim.createGroup(a, { externalId, displayName: 'G' }, BASE)).rejects.toMatchObject({
        status: 400,
        scimType: 'invalidValue',
      });
    // A plain group whose id merely begins with the same letters is a plain group.
    for (const externalId of ['unitary:x', 'units and more', 'protected-area'])
      expect((await scim.createGroup(a, { externalId, displayName: 'G' }, BASE)).externalId).toBe(externalId);
  });
});
describe('what a group write costs and what it leaves in the audit', () => {
  test('only the members a write adds are asked about, in one read, whatever the size of the group', async () => {
    const calls: Record<string, number> = {};
    const { scim, a, person, patch } = stack(store => ({
      transaction: fn =>
        store.transaction(tx =>
          fn(
            new Proxy(tx, {
              get(target, name: string) {
                const value = target[name as keyof ProvisionTx];
                if (typeof value !== 'function') return value;
                return (...args: unknown[]) => {
                  calls[name] = (calls[name] ?? 0) + 1;
                  return (value as (...a: unknown[]) => unknown).apply(target, args);
                };
              },
            }),
          ),
        ),
    }));
    const members: string[] = [];
    for (let i = 0; i < 40; i++) members.push(await person(a));
    const group = await scim.createGroup(
      a,
      { externalId: 'ad:many', displayName: 'Många', members: members.map(value => ({ value })) },
      BASE,
    );
    const one = await person(a);
    for (const key of Object.keys(calls)) delete calls[key];
    await scim.patchGroup(a, group.id, patch([{ op: 'add', path: 'members', value: [{ value: one }] }]), BASE);
    expect([calls.usersAmong, calls.readUser ?? 0]).toEqual([1, 0]);
    // An unchanged replacement asks about nobody.
    for (const key of Object.keys(calls)) delete calls[key];
    await scim.replaceGroup(
      a,
      group.id,
      { externalId: 'ad:many', displayName: 'Många', members: [...members, one].map(value => ({ value })) },
      BASE,
    );
    expect([calls.usersAmong ?? 0, calls.readUser ?? 0]).toEqual([0, 0]);
    // A member who is no user is still named, and a group as a member is still said to be one.
    await expect(
      scim.patchGroup(a, group.id, patch([{ op: 'add', path: 'members', value: [{ value: 'e-1' }] }]), BASE),
    ).rejects.toMatchObject({ detail: "Member 'e-1' is not a user of this organisation." });
    await expect(
      scim.patchGroup(a, group.id, patch([{ op: 'add', path: 'members', value: [{ value: group.id }] }]), BASE),
    ).rejects.toMatchObject({ detail: expect.stringContaining('is a group') });
  });
  test('a write of a group that gives nobody anything derives nobody, one that does derives whom it can move, and the rules are read once a write (B1)', async () => {
    const calls: Record<string, number> = {};
    const { store, scim, admin, administrator, a, person, patch } = stack(inner => ({
      transaction: fn =>
        inner.transaction(tx =>
          fn(
            new Proxy(tx, {
              get(target, name: string) {
                const value = target[name as keyof ProvisionTx];
                if (typeof value !== 'function') return value;
                return (...args: unknown[]) => {
                  calls[name] = (calls[name] ?? 0) + 1;
                  return (value as (...a: unknown[]) => unknown).apply(target, args);
                };
              },
            }),
          ),
        ),
    }));
    const staff: string[] = [];
    for (let i = 0; i < 30; i++) staff.push(await person(a));
    const [head, newcomer] = [await person(a), await person(a)];
    const everyone = (ids: string[]) => ids.map(value => ({ value }));
    // Each derivation begins by locking its person, so the locks count the people derived. A group write reads the rules
    // only while it holds them, so an administrator's change cannot slip in between the read and the people (`held`).
    const cost = async (write: () => Promise<unknown>) => {
      for (const key of Object.keys(calls)) delete calls[key];
      await write();
      return {
        derived: calls.lockPerson ?? 0,
        rules: calls.groupCapabilities ?? 0,
        held: calls.lockGroupCapabilities ?? 0,
        calls: Object.values(calls).reduce((sum, n) => sum + n, 0),
      };
    };
    const derivedRows = () => store.state.audit.filter(row => row.action === 'grant.derived').length;
    /** The `grant.derived` rows a write left, by person, in the order written. */
    const derivedBy = async (write: () => Promise<unknown>) => {
      const before = store.state.audit.length;
      await write();
      return store.state.audit
        .slice(before)
        .filter(row => row.action === 'grant.derived')
        .map(row => [row.subject.slice('person:'.length), row.details]);
    };
    // An all-staff group that grants nothing: created, joined, left, renamed, re-keyed and removed, nobody derived.
    // Created whole it was one derivation a member, six to nine store calls each.
    let plain!: { id: string };
    const rows = derivedRows();
    const created = await cost(async () => {
      plain = await scim.createGroup(a, { externalId: 'ad:all', displayName: 'Alla', members: everyone(staff) }, BASE);
    });
    expect(created).toMatchObject({ derived: 0, rules: 1, held: 1 });
    // A few store calls whatever the size of the group, where it was some two hundred for these thirty.
    expect(created.calls).toBeLessThan(12);
    expect(
      await cost(() =>
        scim.patchGroup(a, plain.id, patch([{ op: 'add', path: 'members', value: [{ value: newcomer }] }]), BASE),
      ),
    ).toMatchObject({ derived: 0, rules: 1 });
    expect(
      await cost(() =>
        scim.patchGroup(a, plain.id, patch([{ op: 'remove', path: `members[value eq "${newcomer}"]` }]), BASE),
      ),
    ).toMatchObject({ derived: 0, rules: 1 });
    // A new name of a group that is no unit moves no grant, so the rules are not even read.
    expect(
      await cost(() =>
        scim.patchGroup(a, plain.id, patch([{ op: 'replace', path: 'displayName', value: 'Samtliga' }]), BASE),
      ),
    ).toEqual(expect.objectContaining({ derived: 0, rules: 0, held: 0 }));
    expect(
      await cost(() =>
        scim.patchGroup(a, plain.id, patch([{ op: 'replace', path: 'externalId', value: 'ad:everyone' }]), BASE),
      ),
    ).toMatchObject({ derived: 0, rules: 1 });
    expect(await cost(() => scim.deleteGroup(a, plain.id))).toMatchObject({ derived: 0, rules: 1 });
    expect(derivedRows()).toBe(rows);
    // A unit group derives its members, once each, with one read of the rules for all of them.
    let unit!: { id: string };
    expect(
      await cost(async () => {
        unit = await scim.createGroup(a, { externalId: 'unit:a1', displayName: 'A1', members: everyone(staff) }, BASE);
      }),
    ).toMatchObject({ derived: staff.length, rules: 1 });
    expect(store.state.grants.get(staff[0]!)).toMatchObject({ unitId: 'a1', unitLabel: 'A1' });
    // Who comes or goes, and nobody else.
    expect(
      await cost(() =>
        scim.patchGroup(a, unit.id, patch([{ op: 'add', path: 'members', value: [{ value: newcomer }] }]), BASE),
      ),
    ).toMatchObject({ derived: 1, rules: 1 });
    expect(store.state.grants.get(newcomer)).toMatchObject({ unitId: 'a1' });
    // The unit's managers carry its name without being members: a manager group derives its own members only, its new
    // name nobody, and the unit's new name every member and the manager.
    let managers!: { id: string };
    expect(
      await cost(async () => {
        managers = await scim.createGroup(
          a,
          { externalId: 'unit-manager:a1', displayName: 'Chefer', members: everyone([head]) },
          BASE,
        );
      }),
    ).toMatchObject({ derived: 1, rules: 1 });
    expect(
      await cost(() =>
        scim.patchGroup(a, managers.id, patch([{ op: 'replace', path: 'displayName', value: 'Ledning' }]), BASE),
      ),
    ).toMatchObject({ derived: 0, rules: 0 });
    expect(
      await cost(() =>
        scim.patchGroup(a, unit.id, patch([{ op: 'replace', path: 'displayName', value: 'Enhet A1' }]), BASE),
      ),
    ).toMatchObject({ derived: staff.length + 2, rules: 1 });
    expect([store.state.grants.get(staff[0]!)?.unitLabel, store.state.grants.get(head)?.unitLabel]).toEqual([
      'Enhet A1',
      'Enhet A1',
    ]);
    // A capability group: its members, and its new name nobody.
    let admins!: { id: string };
    expect(
      await cost(async () => {
        admins = await scim.createGroup(
          a,
          { externalId: 'capability:admin.users', displayName: 'Admin', members: everyone([head]) },
          BASE,
        );
      }),
    ).toMatchObject({ derived: 1, rules: 1 });
    expect(
      await cost(() =>
        scim.patchGroup(a, admins.id, patch([{ op: 'replace', path: 'displayName', value: 'Administratörer' }]), BASE),
      ),
    ).toMatchObject({ derived: 0, rules: 0 });
    expect(store.state.grants.get(head)?.capabilities).toEqual(['admin.users']);
    // A plain group a D85 row names gives what the row says: its members are derived, and a key that comes to name it
    // or stops naming it derives every member.
    store.state.groupCapabilities.push({
      organisationId: 'org-a',
      groupExternalId: 'ad:connectors',
      capability: 'admin.connectors',
    });
    let mapped!: { id: string };
    expect(
      await cost(async () => {
        mapped = await scim.createGroup(
          a,
          { externalId: 'ad:connectors', displayName: 'Anslutningar', members: everyone(staff.slice(0, 3)) },
          BASE,
        );
      }),
    ).toMatchObject({ derived: 3, rules: 1 });
    expect(store.state.grants.get(staff[0]!)?.capabilities).toEqual(['admin.connectors']);
    expect(
      await cost(() =>
        scim.patchGroup(a, mapped.id, patch([{ op: 'replace', path: 'externalId', value: 'ad:connectors-old' }]), BASE),
      ),
    ).toMatchObject({ derived: 3, rules: 1 });
    expect(store.state.grants.get(staff[0]!)?.capabilities).toEqual([]);
    expect(
      await cost(() =>
        scim.replaceGroup(
          a,
          mapped.id,
          { externalId: 'ad:connectors', displayName: 'Anslutningar', members: everyone(staff.slice(0, 3)) },
          BASE,
        ),
      ),
    ).toMatchObject({ derived: 3, rules: 1 });
    expect(store.state.grants.get(staff[0]!)?.capabilities).toEqual(['admin.connectors']);
    // Who leaves a mapped group is derived and loses what the row gave, and so does every member when the group is
    // removed; so does the member of a removed capability group. Each with a row that says it.
    const employee = (capabilities: string[]) => ({
      unitId: 'a1',
      role: 'employee',
      capabilities,
      assignments: 1,
    });
    let left!: unknown[];
    expect(
      await cost(async () => {
        left = await derivedBy(() =>
          scim.patchGroup(a, mapped.id, patch([{ op: 'remove', path: `members[value eq "${staff[1]}"]` }]), BASE),
        );
      }),
    ).toMatchObject({ derived: 1, rules: 1, held: 1 });
    expect(left).toEqual([[staff[1], employee([])]]);
    let gone!: unknown[];
    expect(
      await cost(async () => {
        gone = await derivedBy(() => scim.deleteGroup(a, mapped.id));
      }),
    ).toMatchObject({ derived: 2, rules: 1, held: 1 });
    expect(gone).toEqual([
      [staff[0], employee([])],
      [staff[2], employee([])],
    ]);
    expect(staff.slice(0, 3).map(id => store.state.grants.get(id)?.capabilities)).toEqual([[], [], []]);
    expect(store.state.grants.get(head)?.capabilities).toEqual(['admin.users']);
    expect(
      await cost(async () => {
        gone = await derivedBy(() => scim.deleteGroup(a, admins.id));
      }),
    ).toMatchObject({ derived: 1, rules: 1, held: 1 });
    expect(gone).toEqual([[head, { unitId: 'a1', role: 'manager', capabilities: [], assignments: 1 }]]);
    expect(store.state.grants.get(head)?.capabilities).toEqual([]);
    // A unit group whose key is taken away, and one that is removed, derive every member: they lose the unit.
    expect(
      await cost(() => scim.patchGroup(a, unit.id, patch([{ op: 'remove', path: 'externalId' }]), BASE)),
    ).toMatchObject({ derived: staff.length + 1, rules: 1 });
    expect(store.state.grants.get(staff[5]!)).toBeUndefined();
    const second = await scim.createGroup(
      a,
      { externalId: 'unit:a2', displayName: 'A2', members: everyone(staff) },
      BASE,
    );
    expect(await cost(() => scim.deleteGroup(a, second.id))).toMatchObject({ derived: staff.length, rules: 1 });
    expect(store.state.grants.get(staff[5]!)).toBeUndefined();
    // A mapping on the users page derives every member of its group, with one read of the rules for all of them; the
    // other read is the overview the page gets back.
    await scim.createGroup(a, { externalId: 'ad:staff', displayName: 'Personal', members: everyone(staff) }, BASE);
    expect(
      await cost(() =>
        admin.addGroupCapability(administrator('org-a'), { groupExternalId: 'ad:staff', capability: 'admin.users' }),
      ),
    ).toMatchObject({ derived: staff.length, rules: 2, held: 1 });
  });
  test("a list that leaves out a person's groups does not read them: the daily comparison asks for three attributes", async () => {
    const calls: Record<string, number> = {};
    const { scim, a, person } = stack(store => ({
      transaction: fn =>
        store.transaction(tx =>
          fn(
            new Proxy(tx, {
              get(target, name: string) {
                const value = target[name as keyof ProvisionTx];
                if (typeof value !== 'function') return value;
                return (...args: unknown[]) => {
                  calls[name] = (calls[name] ?? 0) + 1;
                  return (value as (...a: unknown[]) => unknown).apply(target, args);
                };
              },
            }),
          ),
        ),
    }));
    const first = await person(a);
    for (let i = 0; i < 9; i++) await person(a);
    const reads = async (query: Parameters<typeof scim.listUsers>[1]) => {
      for (const key of Object.keys(calls)) delete calls[key];
      const list = await scim.listUsers(a, query, BASE);
      return [list.Resources.length, calls.userGroups ?? 0];
    };
    // As `push.ts` reads everybody before a run. It was one read of groups a person, to answer none of them.
    expect(await reads({ attributes: 'externalId,userName,active' })).toEqual([10, 0]);
    expect(await reads({ excludedAttributes: 'groups' })).toEqual([10, 0]);
    expect(await reads({})).toEqual([10, 10]);
    expect(await reads({ attributes: 'userName,groups.value' })).toEqual([10, 10]);
    for (const key of Object.keys(calls)) delete calls[key];
    expect(Object.keys(await scim.getUser(a, first, BASE, { attributes: 'userName' }))).toEqual([
      'schemas',
      'id',
      'userName',
    ]);
    expect(calls.userGroups ?? 0).toBe(0);
  });
  test('a second unit to lead, and who came into a plain group, are in the audit by person', async () => {
    const { store, scim, a, person, patch } = stack();
    const manager = await person(a);
    await scim.createGroup(
      a,
      { externalId: 'unit-manager:a1', displayName: 'Chefer A1', members: [{ value: manager }] },
      BASE,
    );
    const before = store.state.audit.length;
    // The grant does not move (a1 is still the unit they act as), and what they now see does.
    await scim.createGroup(
      a,
      { externalId: 'unit-manager:z9', displayName: 'Chefer Z9', members: [{ value: manager }] },
      BASE,
    );
    expect(store.state.audit.slice(before).map(row => [row.action, row.subject, row.details])).toEqual([
      ['scim.group.created', expect.stringMatching(/^group:/), expect.objectContaining({ members: 1 })],
      [
        'assignments.derived',
        'person:' + manager,
        {
          assignments: [
            { unitId: 'a1', role: 'manager' },
            { unitId: 'z9', role: 'manager' },
          ],
        },
      ],
    ]);
    const plain = await scim.createGroup(a, { externalId: 'ad:audience', displayName: 'Publik' }, BASE);
    const other = await person(a);
    await scim.patchGroup(
      a,
      plain.id,
      patch([{ op: 'add', path: 'members', value: [{ value: manager }, { value: other }] }]),
      BASE,
    );
    expect(store.state.audit.at(-1)).toMatchObject({
      action: 'scim.group.patched',
      details: { added: 2, removed: 0, addedPeople: [manager, other] },
    });
    await scim.patchGroup(a, plain.id, patch([{ op: 'remove', path: `members[value eq "${other}"]` }]), BASE);
    expect(store.state.audit.at(-1)?.details).toMatchObject({ removed: 1, removedPeople: [other] });
  });
  test('who a POST put in a group and who a DELETE took out are in the audit by person, up to fifty (S3)', async () => {
    const { store, scim, a, person } = stack();
    const people: string[] = [];
    for (let i = 0; i < 51; i++) people.push(await person(a));
    const row = (action: string, id: string) =>
      store.state.audit.find(entry => entry.action === action && entry.subject === 'group:' + id)?.details;
    // A connector audience: no grant follows from it, so these two rows are all that says who was in it.
    const [first, second] = [people[1]!, people[0]!];
    const audience = await scim.createGroup(
      a,
      { externalId: 'ad:audience', displayName: 'Publik', members: [{ value: first }, { value: second }] },
      BASE,
    );
    expect(row('scim.group.created', audience.id)).toEqual({
      externalId: 'ad:audience',
      displayName: 'Publik',
      members: 2,
      addedPeople: [first, second],
    });
    await scim.deleteGroup(a, audience.id);
    expect(row('scim.group.removed', audience.id)).toEqual({
      externalId: 'ad:audience',
      displayName: 'Publik',
      members: 2,
      removedPeople: [first, second].sort(),
    });
    // Nobody to name, fifty named, and past fifty the count stands alone.
    const empty = await scim.createGroup(a, { externalId: 'ad:empty', displayName: 'Tom' }, BASE);
    await scim.deleteGroup(a, empty.id);
    expect([row('scim.group.created', empty.id), row('scim.group.removed', empty.id)]).toEqual([
      { externalId: 'ad:empty', displayName: 'Tom', members: 0 },
      { externalId: 'ad:empty', displayName: 'Tom', members: 0 },
    ]);
    for (const [externalId, count] of [
      ['ad:fifty', 50],
      ['ad:many', 51],
    ] as const) {
      const group = await scim.createGroup(
        a,
        { externalId, displayName: externalId, members: people.slice(0, count).map(value => ({ value })) },
        BASE,
      );
      await scim.deleteGroup(a, group.id);
      const [created, removed] = [row('scim.group.created', group.id), row('scim.group.removed', group.id)];
      expect([created?.members, removed?.members]).toEqual([count, count]);
      expect([
        (created?.addedPeople as string[] | undefined)?.length,
        (removed?.removedPeople as string[] | undefined)?.length,
      ]).toEqual(count === 50 ? [50, 50] : [undefined, undefined]);
    }
  });
  test('a row from before provisioning is changed without being given an empty id, and a second such row is not refused for it', async () => {
    const { store, scim, a, patch } = stack();
    for (const id of ['L1', 'L2'])
      store.state.users.set(id, {
        id,
        organisationId: 'org-a',
        externalId: null,
        userName: null,
        name: 'Legacy ' + id,
        email: null,
        phoneNumbers: [],
        employments: [],
        title: null,
        enabled: true,
        createdAt: '2026-11-01T00:00:00.000Z',
        updatedAt: '2026-11-01T00:00:00.000Z',
      });
    for (const id of ['L1', 'L2']) {
      const left = await scim.patchUser(a, id, patch([{ op: 'replace', path: 'active', value: false }]), BASE);
      expect(left.active).toBe(false);
      expect(store.state.users.get(id)).toMatchObject({
        externalId: null,
        userName: null,
        email: null,
        enabled: false,
      });
    }
  });
});
