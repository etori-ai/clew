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
