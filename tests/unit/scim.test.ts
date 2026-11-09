import { describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { memoryProvisionStore } from '../../apps/server/src/modules/people/adapters/memory';
import { ScimError } from '../../apps/server/src/modules/people/contracts';
import { applyGroupPatch, applyUserPatch, parseFilter } from '../../apps/server/src/modules/people/domain';
import { scimUsecases } from '../../apps/server/src/modules/people/usecases';
import { scimStoreContract } from '../scim-store-contract';

/** The SCIM server's use cases (RFC 7644, D68) on the memory adapter, and the pure patch and filter rules. */
const BASE = 'https://clew.test/scim/v2';
function harness() {
  const store = memoryProvisionStore();
  let tick = 0,
    seq = 0;
  const scim = scimUsecases({
    store,
    clock: () => new Date(Date.UTC(2026, 10, 9, 6, 0, tick++)),
    ids: () => 'id-' + ++seq,
    digest: token => 'digest:' + token,
  });
  const p = { id: 'metakatalogen', organisationId: 'sundsvall', label: 'Metakatalogen' };
  store.state.provisioners.set('digest:secret', p);
  const audit = (subject?: string) =>
    store.state.audit.filter(a => !subject || a.subject === subject).map(a => a.action);
  return { store, scim, p, audit };
}
const anna = {
  schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
  externalId: 'mk-1',
  userName: 'annber',
  displayName: 'Anna Berg',
  emails: [{ value: 'anna.berg@sundsvall.se', type: 'work', primary: true }],
  active: true,
  'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User': { department: 'Skola' },
};
describe('SCIM users', () => {
  test('authenticates a provisioner by token digest and nobody else', async () => {
    const { scim, p } = harness();
    expect(await scim.authenticate('secret')).toEqual(p);
    expect(await scim.authenticate('wrong')).toBeUndefined();
  });
  test('creates a user with the required attributes, answers the resource, audits and ignores extensions', async () => {
    const { scim, p, audit, store } = harness();
    const user = await scim.createUser(p, anna, BASE);
    expect(user).toEqual({
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
      id: 'id-1',
      externalId: 'mk-1',
      userName: 'annber',
      displayName: 'Anna Berg',
      name: { formatted: 'Anna Berg' },
      emails: [{ value: 'anna.berg@sundsvall.se', type: 'work', primary: true }],
      active: true,
      groups: [],
      meta: {
        resourceType: 'User',
        created: '2026-11-09T06:00:00.000Z',
        lastModified: '2026-11-09T06:00:00.000Z',
        location: BASE + '/Users/id-1',
      },
    });
    expect(store.state.users.get('id-1')).toMatchObject({
      organisationId: 'sundsvall',
      email: 'anna.berg@sundsvall.se',
    });
    expect(audit('person:id-1')).toEqual(['scim.user.created']);
    expect(store.state.grants.get('id-1')).toBeUndefined();
  });
  test('refuses a user without externalId, display name or work address, naming the attribute', async () => {
    const { scim, p } = harness();
    const { externalId, ...noExternal } = anna;
    void externalId;
    await expect(scim.createUser(p, noExternal, BASE)).rejects.toMatchObject({
      status: 400,
      scimType: 'invalidValue',
      detail: "Attribute 'externalId' is required.",
    });
    await expect(scim.createUser(p, { ...anna, displayName: undefined }, BASE)).rejects.toMatchObject({
      detail: "Attribute 'displayName' is required.",
    });
    await expect(scim.createUser(p, { ...anna, emails: [] }, BASE)).rejects.toMatchObject({
      detail: "Attribute 'emails' is required.",
    });
    await expect(scim.createUser(p, { userName: 7 }, BASE)).rejects.toMatchObject({
      status: 400,
      scimType: 'invalidSyntax',
    });
    await expect(
      scim.createUser(p, { ...anna, name: { givenName: 'Anna', familyName: 'Berg' }, displayName: undefined }, BASE),
    ).resolves.toMatchObject({ displayName: 'Anna Berg' });
  });
  test('userName and externalId are unique within the organisation', async () => {
    const { scim, p } = harness();
    await scim.createUser(p, anna, BASE);
    await expect(scim.createUser(p, { ...anna, externalId: 'mk-2' }, BASE)).rejects.toMatchObject({
      status: 409,
      scimType: 'uniqueness',
    });
    await expect(scim.createUser(p, { ...anna, userName: 'other' }, BASE)).rejects.toMatchObject({ status: 409 });
    const elsewhere = { id: 'other', organisationId: 'timra', label: 'Other' };
    await expect(scim.createUser(elsewhere, anna, BASE)).resolves.toMatchObject({ id: 'id-2' });
  });
  test('lists with the two filters and pages, and never sees another organisation', async () => {
    const { scim, p } = harness();
    for (let i = 1; i <= 3; i++)
      await scim.createUser(p, { ...anna, externalId: 'mk-' + i, userName: 'user' + i }, BASE);
    await scim.createUser(
      { id: 'o', organisationId: 'timra', label: 'O' },
      { ...anna, externalId: 'mk-9', userName: 'user9' },
      BASE,
    );
    const all = await scim.listUsers(p, {}, BASE);
    expect(all).toMatchObject({ totalResults: 3, startIndex: 1, itemsPerPage: 3 });
    const page = await scim.listUsers(p, { startIndex: '2', count: '1' }, BASE);
    expect(page.Resources.map(u => u.userName)).toEqual(['user2']);
    expect(page.itemsPerPage).toBe(1);
    const byName = await scim.listUsers(p, { filter: 'userName eq "user3"' }, BASE);
    expect(byName.Resources.map(u => u.id)).toEqual(['id-3']);
    const byExternal = await scim.listUsers(p, { filter: 'externalId eq "mk-1"' }, BASE);
    expect(byExternal.totalResults).toBe(1);
    const empty = await scim.listUsers(p, { filter: 'userName eq "user9"' }, BASE);
    expect(empty).toMatchObject({ totalResults: 0, Resources: [] });
    await expect(scim.listUsers(p, { filter: 'emails.value co "x"' }, BASE)).rejects.toMatchObject({
      status: 400,
      scimType: 'invalidFilter',
    });
  });
  test('PUT replaces, PATCH changes what it names (Entra form included), DELETE deactivates and stays idempotent', async () => {
    const { scim, p, audit, store } = harness();
    const { id } = await scim.createUser(p, anna, BASE);
    const replaced = await scim.replaceUser(
      p,
      id,
      { ...anna, displayName: 'Anna Bergström', emails: [{ value: 'anna.bergstrom@sundsvall.se' }] },
      BASE,
    );
    expect(replaced).toMatchObject({
      displayName: 'Anna Bergström',
      emails: [{ value: 'anna.bergstrom@sundsvall.se' }],
    });
    expect(replaced.meta.lastModified > replaced.meta.created).toBe(true);
    const patched = await scim.patchUser(
      p,
      id,
      {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [
          { op: 'Replace', value: { active: 'False' } },
          { op: 'replace', path: 'userName', value: 'annber2' },
        ],
      },
      BASE,
    );
    expect(patched).toMatchObject({ active: false, userName: 'annber2' });
    expect(store.state.users.get(id)).toMatchObject({ enabled: false, userName: 'annber2' });
    const same = await scim.patchUser(
      p,
      id,
      { schemas: [], Operations: [{ op: 'replace', path: 'userName', value: 'annber2' }] },
      BASE,
    );
    expect(same.meta.lastModified).toBe(patched.meta.lastModified);
    await scim.deleteUser(p, id);
    await scim.deleteUser(p, id);
    expect(audit('person:' + id)).toEqual(['scim.user.created', 'scim.user.replaced', 'scim.user.patched']);
    await scim.patchUser(p, id, { schemas: [], Operations: [{ op: 'replace', path: 'active', value: true }] }, BASE);
    await scim.deleteUser(p, id);
    expect(audit('person:' + id).at(-1)).toBe('scim.user.deactivated');
    await expect(scim.getUser(p, 'missing', BASE)).rejects.toMatchObject({ status: 404 });
    await expect(
      scim.patchUser(p, id, { schemas: [], Operations: [{ op: 'remove', path: 'userName' }] }, BASE),
    ).rejects.toMatchObject({ status: 400 });
  });
});
describe('SCIM groups and derivation', () => {
  const group = (externalId: string, displayName: string, members: string[]) => ({
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
    externalId,
    displayName,
    members: members.map(value => ({ value })),
  });
  test('a unit group gives its members a grant, the manager group makes one a manager, and removing them takes it back', async () => {
    const { scim, p, store, audit } = harness();
    const a = (await scim.createUser(p, anna, BASE)).id,
      b = (await scim.createUser(p, { ...anna, externalId: 'mk-2', userName: 'bo' }, BASE)).id;
    const unit = await scim.createGroup(p, group('unit:skola', 'Bergsåkers skola', [a, b]), BASE);
    expect(unit).toMatchObject({ id: 'id-3', externalId: 'unit:skola', displayName: 'Bergsåkers skola' });
    expect(unit.members.map(m => m.value)).toEqual([a, b]);
    expect(store.state.grants.get(a)).toEqual({
      unitId: 'skola',
      unitLabel: 'Bergsåkers skola',
      role: 'employee',
      capabilities: [],
    });
    expect(store.state.units.get('skola')).toEqual({ organisationId: 'sundsvall', label: 'Bergsåkers skola' });
    const managers = await scim.createGroup(p, group('unit-manager:skola', 'Rektorer', [a]), BASE);
    expect(store.state.grants.get(a)?.role).toBe('manager');
    expect((await scim.getUser(p, a, BASE)).groups.map(g => g.display)).toEqual(['Bergsåkers skola', 'Rektorer']);
    // Entra removes one member by a filtered path and adds by value list.
    await scim.patchGroup(
      p,
      managers.id,
      {
        schemas: [],
        Operations: [
          { op: 'Remove', path: `members[value eq "${a}"]` },
          { op: 'Add', path: 'members', value: [{ value: b }] },
        ],
      },
      BASE,
    );
    expect(store.state.grants.get(a)?.role).toBe('employee');
    expect(store.state.grants.get(b)?.role).toBe('manager');
    await scim.deleteGroup(p, unit.id);
    expect(store.state.grants.get(a)).toBeUndefined();
    // The unit row outlives its group, so the manager keeps the label it carried.
    expect(store.state.grants.get(b)).toMatchObject({ role: 'manager', unitLabel: 'Bergsåkers skola' });
    expect(audit('group:' + managers.id)).toEqual(['scim.group.created', 'scim.group.patched']);
    expect(audit('group:' + unit.id)).toEqual(['scim.group.created', 'scim.group.removed']);
    expect(audit('person:' + a)).toEqual([
      'scim.user.created',
      'grant.derived',
      'grant.derived',
      'grant.derived',
      'grant.derived',
    ]);
  });
  test('capabilities follow the capability key and the mapping; a renamed unit group relabels every member', async () => {
    const { scim, p, store } = harness();
    const a = (await scim.createUser(p, anna, BASE)).id;
    const unit = await scim.createGroup(p, group('unit:it', 'IT', [a]), BASE);
    await scim.createGroup(p, group('capability:admin.connectors', 'Clew-admin', [a]), BASE);
    const ad = await scim.createGroup(p, { displayName: 'Any AD group', members: [{ value: a }] }, BASE);
    expect(ad.externalId).toBeUndefined();
    expect(store.state.grants.get(a)?.capabilities).toEqual(['admin.connectors']);
    store.state.mapping.push({ groupExternalId: 'S-1-5-21-ad', capability: 'admin.users' });
    await scim.patchGroup(
      p,
      ad.id,
      { schemas: [], Operations: [{ op: 'add', value: { externalId: 'S-1-5-21-ad' } }] },
      BASE,
    );
    expect(store.state.grants.get(a)?.capabilities).toEqual(['admin.connectors', 'admin.users']);
    await scim.replaceGroup(p, unit.id, group('unit:it', 'IT och digitalisering', [a]), BASE);
    expect(store.state.grants.get(a)?.unitLabel).toBe('IT och digitalisering');
    expect(store.state.units.get('it')?.label).toBe('IT och digitalisering');
  });
  test('refuses an unknown member, a duplicate externalId and an unknown group; lists by externalId and displayName', async () => {
    const { scim, p } = harness();
    const a = (await scim.createUser(p, anna, BASE)).id;
    await expect(scim.createGroup(p, group('unit:x', 'X', ['nobody']), BASE)).rejects.toMatchObject({
      status: 400,
      scimType: 'invalidValue',
    });
    await scim.createGroup(p, group('unit:x', 'X', [a]), BASE);
    await expect(scim.createGroup(p, group('unit:x', 'Other', []), BASE)).rejects.toMatchObject({
      status: 409,
      scimType: 'uniqueness',
    });
    await expect(scim.getGroup(p, 'missing', BASE)).rejects.toMatchObject({ status: 404 });
    await expect(scim.deleteGroup(p, 'missing')).rejects.toBeInstanceOf(ScimError);
    expect((await scim.listGroups(p, { filter: 'externalId eq "unit:x"' }, BASE)).totalResults).toBe(1);
    expect((await scim.listGroups(p, { filter: 'displayName eq "X"' }, BASE)).Resources[0]?.members[0]?.value).toBe(a);
    expect((await scim.listGroups(p, { filter: 'displayName eq "Y"' }, BASE)).totalResults).toBe(0);
  });
});
describe('SCIM patch and filter rules', () => {
  const fields = { externalId: 'e', userName: 'u', name: 'N', email: 'n@x.test', enabled: true };
  test('user patches take paths, schema-qualified paths and the path-less object form; unknown attributes are ignored', () => {
    expect(
      applyUserPatch(fields, [
        { op: 'replace', path: 'urn:ietf:params:scim:schemas:core:2.0:User:displayName', value: 'New' },
        { op: 'add', path: 'emails[type eq "work"].value', value: 'new@x.test' },
        {
          op: 'replace',
          value: { active: false, 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:department': 'HR' },
        },
      ]),
    ).toEqual({ ...fields, name: 'New', email: 'new@x.test', enabled: false });
    expect(() => applyUserPatch(fields, [{ op: 'replace', path: 'id', value: 'x' }])).toThrow('read-only');
    expect(() => applyUserPatch(fields, [{ op: 'move', path: 'userName', value: 'x' }])).toThrow(
      'Unknown patch operation',
    );
    expect(() => applyUserPatch(fields, [{ op: 'replace', path: 'active', value: 'maybe' }])).toThrow('boolean');
  });
  test('group patches add, remove and replace members in every form the clients use', () => {
    const g = { externalId: 'unit:a', displayName: 'A', members: ['1', '2'] };
    expect(applyGroupPatch(g, [{ op: 'add', path: 'members', value: [{ value: '3' }] }]).members).toEqual([
      '1',
      '2',
      '3',
    ]);
    expect(applyGroupPatch(g, [{ op: 'remove', path: 'members', value: [{ value: '1' }] }]).members).toEqual(['2']);
    expect(applyGroupPatch(g, [{ op: 'remove', path: 'members[value eq "2"]' }]).members).toEqual(['1']);
    expect(applyGroupPatch(g, [{ op: 'replace', path: 'members', value: [{ value: '9' }] }]).members).toEqual(['9']);
    expect(applyGroupPatch(g, [{ op: 'remove', path: 'members' }]).members).toEqual([]);
    expect(applyGroupPatch(g, [{ op: 'replace', value: { displayName: 'B', members: [{ value: '5' }] } }])).toEqual({
      externalId: 'unit:a',
      displayName: 'B',
      members: ['5'],
    });
    expect(applyGroupPatch(g, [{ op: 'remove', path: 'externalId' }]).externalId).toBeNull();
    expect(() => applyGroupPatch(g, [{ op: 'add', path: 'members[value eq "2"]', value: 'x' }])).toThrow('remove only');
  });
  test('the filter is one equality on a named attribute', () => {
    expect(parseFilter('userName eq "a\\"b"', ['userName'])).toEqual({ attribute: 'userName', value: 'a"b' });
    expect(parseFilter('USERNAME EQ "x"', ['userName'])).toEqual({ attribute: 'userName', value: 'x' });
    expect(parseFilter(undefined, ['userName'])).toBeUndefined();
    expect(() => parseFilter('externalId eq "x"', ['userName'])).toThrow(
      'invalidFilter' === 'invalidFilter' ? /supported/ : '',
    );
    expect(() => parseFilter('userName sw "x"', ['userName'])).toThrow(/supported/);
  });
});
scimStoreContract('memory', async () => {
  const store = memoryProvisionStore();
  return {
    store,
    prefix: 'm-' + randomUUID().slice(0, 8),
    async seedProvisioner(p, digest, revoked) {
      store.state.provisioners.set(digest, { ...p, revoked });
    },
    async bind(personId) {
      store.state.bindings.add(personId);
    },
  };
});
