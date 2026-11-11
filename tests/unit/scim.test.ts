import { describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { memoryProvisionStore } from '../../apps/server/src/modules/people/adapters/memory';
import { ScimError } from '../../apps/server/src/modules/people/contracts';
import {
  applyGroupPatch,
  applyUserPatch,
  leavesOut,
  pageOf,
  parseFilter,
  project,
} from '../../apps/server/src/modules/people/domain';
import type { ProvisionStore } from '../../apps/server/src/modules/people/ports';
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
  test('being seen is recorded at most once a minute, and a run that begins after half an hour of silence is audited', async () => {
    const store = memoryProvisionStore();
    let at = Date.UTC(2026, 10, 9, 6, 0, 0);
    const scim = scimUsecases({ store, clock: () => new Date(at), ids: () => 'x', digest: t => 'digest:' + t });
    store.state.provisioners.set('digest:secret', { id: 'mk', organisationId: 'sundsvall', label: 'Metakatalogen' });
    const seen = () => store.state.provisioners.get('digest:secret')?.lastSeenAt,
      runs = () => store.state.audit.filter(a => a.action === 'provisioner.seen');
    await scim.authenticate('wrong');
    expect(seen()).toBeUndefined();
    await scim.authenticate('secret');
    expect(seen()).toBe('2026-11-09T06:00:00.000Z');
    expect(runs()).toEqual([
      { actor: 'provisioner:mk', action: 'provisioner.seen', subject: 'provisioner:mk', details: { previous: null } },
    ]);
    // The thousands of requests of one push: the mark moves once a minute and the audit says nothing more.
    at += 59_000;
    await scim.authenticate('secret');
    expect(seen()).toBe('2026-11-09T06:00:00.000Z');
    at += 1_000;
    await scim.authenticate('secret');
    expect(seen()).toBe('2026-11-09T06:01:00.000Z');
    at += 29 * 60_000;
    await scim.authenticate('secret');
    expect(seen()).toBe('2026-11-09T06:30:00.000Z');
    expect(runs()).toHaveLength(1);
    // The next day's push changes nothing, and still leaves its trace.
    at += 24 * 60 * 60_000;
    await scim.authenticate('secret');
    expect(runs().map(a => a.details)).toEqual([{ previous: null }, { previous: '2026-11-09T06:30:00.000Z' }]);
  });
  test('a rotated-out token authenticates the same provisioner until its grace period ends', async () => {
    const store = memoryProvisionStore();
    let at = Date.UTC(2026, 10, 9, 6, 0, 0);
    const scim = scimUsecases({ store, clock: () => new Date(at), ids: () => 'x', digest: t => 'digest:' + t });
    store.state.provisioners.set('digest:new', {
      id: 'mk',
      organisationId: 'sundsvall',
      label: 'Metakatalogen',
      previous: { digest: 'digest:old', until: '2026-11-10T06:00:00.000Z' },
    });
    expect((await scim.authenticate('old'))?.id).toBe('mk');
    expect((await scim.authenticate('new'))?.id).toBe('mk');
    at += 24 * 60 * 60_000;
    expect(await scim.authenticate('old')).toBeUndefined();
    expect((await scim.authenticate('new'))?.id).toBe('mk');
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
  test('userName and externalId are unique across the installation, userName without regard to case', async () => {
    const { scim, p } = harness();
    await scim.createUser(p, anna, BASE);
    await expect(scim.createUser(p, { ...anna, externalId: 'mk-2' }, BASE)).rejects.toMatchObject({
      status: 409,
      scimType: 'uniqueness',
      detail: 'A user with this userName already exists.',
    });
    await expect(scim.createUser(p, { ...anna, userName: 'other' }, BASE)).rejects.toMatchObject({
      status: 409,
      detail: 'A user with this externalId already exists.',
    });
    // RFC 7643 declares userName not case exact, and Keycloak lowercases what Entra may send in mixed case.
    await expect(scim.createUser(p, { ...anna, externalId: 'mk-3', userName: 'AnnBer' }, BASE)).rejects.toMatchObject({
      status: 409,
      scimType: 'uniqueness',
    });
    expect((await scim.listUsers(p, { filter: 'userName eq "ANNBER"' }, BASE)).totalResults).toBe(1);
    // A login carries no organisation, so neither does uniqueness.
    const elsewhere = { id: 'other', organisationId: 'timra', label: 'Other' };
    await expect(scim.createUser(elsewhere, anna, BASE)).rejects.toMatchObject({ status: 409 });
    await expect(
      scim.createUser(elsewhere, { ...anna, externalId: 'mk-9', userName: 'bo' }, BASE),
    ).resolves.toMatchObject({ id: 'id-2' });
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
    // A flip of `active` is audited as deactivated or reactivated whatever verb carried it, with the verb in the details.
    expect(audit('person:' + id)).toEqual(['scim.user.created', 'scim.user.replaced', 'scim.user.deactivated']);
    expect(store.state.audit.find(a => a.action === 'scim.user.deactivated')?.details).toMatchObject({
      via: 'scim.user.patched',
      changed: ['userName', 'enabled'],
    });
    await scim.patchUser(p, id, { schemas: [], Operations: [{ op: 'replace', path: 'active', value: true }] }, BASE);
    expect(audit('person:' + id).at(-1)).toBe('scim.user.reactivated');
    await scim.deleteUser(p, id);
    expect(audit('person:' + id).at(-1)).toBe('scim.user.deactivated');
    await expect(scim.getUser(p, 'missing', BASE)).rejects.toMatchObject({ status: 404 });
    await expect(
      scim.patchUser(p, id, { schemas: [], Operations: [{ op: 'remove', path: 'userName' }] }, BASE),
    ).rejects.toMatchObject({ status: 400, scimType: 'mutability' });
  });
  test('a patch that removes what Clew does not hold changes the rest and is not refused (Entra), and one that repeats the id is taken (Okta)', async () => {
    const { scim, p, audit } = harness();
    const { id } = await scim.createUser(p, anna, BASE);
    const patched = await scim.patchUser(
      p,
      id,
      {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [
          { op: 'Replace', path: 'displayName', value: 'Anna B' },
          { op: 'Remove', path: 'title' },
          { op: 'Remove', path: 'phoneNumbers[type eq "mobile"].value' },
          { op: 'Remove', path: 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:manager' },
        ],
      },
      BASE,
    );
    expect(patched).toMatchObject({ displayName: 'Anna B', userName: 'annber', active: true });
    const off = await scim.patchUser(
      p,
      id,
      { schemas: [], Operations: [{ op: 'replace', value: { id, active: false } }] },
      BASE,
    );
    expect(off.active).toBe(false);
    await expect(
      scim.patchUser(
        p,
        id,
        { schemas: [], Operations: [{ op: 'replace', value: { id: 'another', active: true } }] },
        BASE,
      ),
    ).rejects.toMatchObject({ status: 400, scimType: 'mutability' });
    expect(audit('person:' + id)).toEqual(['scim.user.created', 'scim.user.patched', 'scim.user.deactivated']);
  });
  test('attributes and excludedAttributes narrow what a read answers; id and schemas always come', async () => {
    const { scim, p } = harness();
    const { id } = await scim.createUser(p, anna, BASE);
    const g = await scim.createGroup(
      p,
      { externalId: 'unit:skola', displayName: 'Skola', members: [{ value: id }] },
      BASE,
    );
    expect(Object.keys(await scim.getUser(p, id, BASE, { attributes: 'userName,emails.value' }))).toEqual([
      'schemas',
      'id',
      'userName',
      'emails',
    ]);
    expect((await scim.getUser(p, id, BASE, { attributes: 'emails.value' })).emails).toEqual([
      { value: 'anna.berg@sundsvall.se' },
    ] as never);
    const listed = await scim.listUsers(p, { excludedAttributes: 'groups,meta,id' }, BASE);
    expect(Object.keys(listed.Resources[0]!)).toEqual([
      'schemas',
      'id',
      'externalId',
      'userName',
      'displayName',
      'name',
      'emails',
      'active',
    ]);
    // Entra reads a large group without its members.
    const bare = await scim.getGroup(p, g.id, BASE, { excludedAttributes: 'members' });
    expect(bare).toMatchObject({ id: g.id, displayName: 'Skola' });
    expect('members' in bare).toBe(false);
    expect((await scim.listGroups(p, { attributes: 'displayName' }, BASE)).Resources).toEqual([
      { schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'], id: g.id, displayName: 'Skola' },
    ] as never);
    expect((await scim.getGroup(p, g.id, BASE, { attributes: 'members.value' })).members).toEqual([
      { value: id },
    ] as never);
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
  test('a client that removes before it adds leaves the person with no grant in between, and the audit says so; one that adds first never does (D101)', async () => {
    const { scim, p, store } = harness();
    const a = (await scim.createUser(p, anna, BASE)).id;
    const skola = await scim.createGroup(p, group('unit:skola', 'Skolan', [a]), BASE),
      omsorg = await scim.createGroup(p, group('unit:omsorg', 'Omsorgen', []), BASE);
    await scim.createGroup(p, group('capability:admin.users', 'Administratörer', [a]), BASE);
    const members = (target: { id: string }, op: 'add' | 'remove') =>
      scim.patchGroup(
        p,
        target.id,
        {
          schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
          Operations: [{ op, path: 'members', value: [{ value: a }] }],
        },
        BASE,
      );
    const derived = () =>
      store.state.audit.filter(x => x.subject === 'person:' + a && x.action === 'grant.derived').map(x => x.details);
    // The wrong order: out of the one unit, then into the other. Between the two the person has no unit, so no grant
    // and no capability, and a request of theirs would end their session.
    let before = derived().length;
    await members(skola, 'remove');
    expect(store.state.grants.get(a)).toBeUndefined();
    expect(store.state.assignments.get(a) ?? []).toEqual([]);
    await members(omsorg, 'add');
    expect(store.state.grants.get(a)).toEqual({
      unitId: 'omsorg',
      unitLabel: 'Omsorgen',
      role: 'employee',
      capabilities: ['admin.users'],
    });
    expect(derived().slice(before)).toEqual([
      { removed: true },
      { unitId: 'omsorg', role: 'employee', capabilities: ['admin.users'], assignments: 1 },
    ]);
    // The right order, back again: into the one, then out of the other. A grant the whole way, and one row.
    before = derived().length;
    await members(skola, 'add');
    expect(store.state.grants.get(a)).toMatchObject({ unitId: 'omsorg', capabilities: ['admin.users'] });
    expect(store.state.assignments.get(a)).toHaveLength(2);
    await members(omsorg, 'remove');
    expect(store.state.grants.get(a)).toMatchObject({ unitId: 'skola', capabilities: ['admin.users'] });
    expect(derived().slice(before)).toEqual([
      { unitId: 'skola', role: 'employee', capabilities: ['admin.users'], assignments: 1 },
    ]);
  });
  test('a manager group may arrive before its unit group: the unit row exists at once and the manager takes the label when the unit group comes', async () => {
    const { scim, p, store } = harness();
    const a = (await scim.createUser(p, anna, BASE)).id;
    await scim.createGroup(p, group('unit-manager:ny', 'Chefer', [a]), BASE);
    expect(store.state.units.get('ny')).toEqual({ organisationId: 'sundsvall', label: 'ny' });
    expect(store.state.grants.get(a)).toMatchObject({ unitId: 'ny', unitLabel: 'ny', role: 'manager' });
    const b = (await scim.createUser(p, { ...anna, externalId: 'mk-2', userName: 'bo' }, BASE)).id;
    const unit = await scim.createGroup(p, group('unit:ny', 'Nya enheten', [b]), BASE);
    expect(store.state.units.get('ny')?.label).toBe('Nya enheten');
    expect(store.state.grants.get(a)?.unitLabel).toBe('Nya enheten');
    await scim.replaceGroup(p, unit.id, group('unit:ny', 'Nyare enheten', [b]), BASE);
    expect(store.state.grants.get(a)?.unitLabel).toBe('Nyare enheten');
  });
  test('a group that becomes a unit group as its members leave writes no unit: a unit row is for a unit somebody is assigned to', async () => {
    const { scim, p, store } = harness();
    const a = (await scim.createUser(p, anna, BASE)).id;
    const plain = await scim.createGroup(p, group('ad:projekt', 'Projekt', [a]), BASE);
    await scim.replaceGroup(p, plain.id, group('unit:tom', 'Tom enhet', []), BASE);
    expect(store.state.units.has('tom')).toBe(false);
    expect(store.state.grants.has(a)).toBe(false);
  });
  test('capabilities follow the capability key and the mapping; a renamed unit group relabels every member', async () => {
    const { scim, p, store } = harness();
    const a = (await scim.createUser(p, anna, BASE)).id;
    const unit = await scim.createGroup(p, group('unit:it', 'IT', [a]), BASE);
    await scim.createGroup(p, group('capability:admin.connectors', 'Clew-admin', [a]), BASE);
    const ad = await scim.createGroup(p, { displayName: 'Any AD group', members: [{ value: a }] }, BASE);
    expect(ad.externalId).toBeUndefined();
    expect(store.state.grants.get(a)?.capabilities).toEqual(['admin.connectors']);
    store.state.groupCapabilities.push({ groupExternalId: 'S-1-5-21-ad', capability: 'admin.users' });
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
  test('the protected key is refused on create and on patch, and nothing of it is stored (D93)', async () => {
    const { scim, p, store } = harness();
    const a = (await scim.createUser(p, anna, BASE)).id;
    await expect(scim.createGroup(p, group('protected', 'Skyddade', [a]), BASE)).rejects.toMatchObject({
      status: 400,
      scimType: 'invalidValue',
      detail: expect.stringContaining("The key 'protected' is not accepted"),
    });
    const plain = await scim.createGroup(p, { displayName: 'Plain', members: [{ value: a }] }, BASE);
    await expect(
      scim.patchGroup(
        p,
        plain.id,
        { schemas: [], Operations: [{ op: 'replace', path: 'externalId', value: 'protected' }] },
        BASE,
      ),
    ).rejects.toMatchObject({ status: 400, scimType: 'invalidValue' });
    await expect(scim.replaceGroup(p, plain.id, group('protected', 'Plain', [a]), BASE)).rejects.toMatchObject({
      status: 400,
    });
    expect([...store.state.groups.values()].some(g => g.externalId === 'protected')).toBe(false);
    expect(store.state.groups.get(plain.id)?.externalId).toBeNull();
  });
  test('a key that is written wrong is refused where it is made, on create, replace and patch (D96)', async () => {
    const { scim, p, store } = harness();
    const a = (await scim.createUser(p, anna, BASE)).id;
    for (const [key, says] of [
      ['unit:', "needs a unit id directly after 'unit:'"],
      ['unit: skola', "needs a unit id directly after 'unit:'"],
      ['unit-manager:', "needs a unit id directly after 'unit-manager:'"],
      ['capability:', "needs a capability name directly after 'capability:'"],
      [
        'capability:admin.nope',
        'names no capability of this installation; the capabilities are admin.connectors, admin.users',
      ],
      ['Unit:skola', "must begin with 'unit:' in lower case"],
      ['UNIT-MANAGER:skola', "must begin with 'unit-manager:' in lower case"],
      ['Capability:admin.users', "must begin with 'capability:' in lower case"],
      ['Protected', "The key 'protected' is not accepted"],
    ] as const)
      await expect(scim.createGroup(p, group(key, 'X', [a]), BASE)).rejects.toMatchObject({
        status: 400,
        scimType: 'invalidValue',
        detail: expect.stringContaining(says),
      });
    expect(store.state.groups.size).toBe(0);
    const plain = await scim.createGroup(p, group('S-1-5-21-unit:7', 'A directory group', [a]), BASE);
    await expect(scim.replaceGroup(p, plain.id, group('capability:admin', 'X', [a]), BASE)).rejects.toMatchObject({
      status: 400,
    });
    await expect(
      scim.patchGroup(
        p,
        plain.id,
        { schemas: [], Operations: [{ op: 'replace', path: 'externalId', value: 'unit-manager:' }] },
        BASE,
      ),
    ).rejects.toMatchObject({ status: 400, scimType: 'invalidValue' });
    expect(store.state.groups.get(plain.id)?.externalId).toBe('S-1-5-21-unit:7');
    expect(store.state.audit.filter(e => e.subject === 'group:' + plain.id).map(e => e.action)).toEqual([
      'scim.group.created',
    ]);
    expect(store.state.grants.get(a)).toBeUndefined();
  });
  test('a group as a member is refused with the reason: nested groups are not supported', async () => {
    const { scim, p } = harness();
    const inner = await scim.createGroup(p, { displayName: 'Inner' }, BASE);
    await expect(
      scim.createGroup(p, { displayName: 'Outer', members: [{ value: inner.id, type: 'Group' }] }, BASE),
    ).rejects.toMatchObject({
      status: 400,
      scimType: 'invalidValue',
      detail: expect.stringContaining('Nested groups'),
    });
  });
  test('members are derived in id order whatever order they were sent in, so two requests lock the same people the same way', async () => {
    const inner = memoryProvisionStore(),
      locked: string[] = [];
    const store: ProvisionStore = {
      transaction: fn => inner.transaction(tx => fn({ ...tx, lockPerson: id => (locked.push(id), tx.lockPerson(id)) })),
    };
    let seq = 0;
    const scim = scimUsecases({ store, clock: () => new Date(), ids: () => 'id-' + ++seq, digest: t => t });
    const p = { id: 'mk', organisationId: 'sundsvall', label: 'Metakatalogen' };
    const ids: string[] = [];
    for (let i = 1; i <= 3; i++)
      ids.push((await scim.createUser(p, { ...anna, externalId: 'mk-' + i, userName: 'user' + i }, BASE)).id);
    locked.length = 0;
    const unit = await scim.createGroup(p, group('unit:skola', 'Skola', [ids[2]!, ids[0]!, ids[1]!]), BASE);
    expect(locked).toEqual(ids);
    locked.length = 0;
    await scim.replaceGroup(p, unit.id, group('unit:skola', 'Skolan', [ids[1]!, ids[2]!, ids[0]!]), BASE);
    expect(locked).toEqual(ids);
    locked.length = 0;
    await scim.deleteGroup(p, unit.id);
    expect(locked).toEqual(ids);
  });
  test('a push that changes nothing writes no unit and no assignment', async () => {
    const inner = memoryProvisionStore();
    let unitWrites = 0,
      assignmentWrites = 0;
    const store: ProvisionStore = {
      transaction: fn =>
        inner.transaction(tx =>
          fn({
            ...tx,
            writeUnits: (organisationId, units) => (unitWrites++, tx.writeUnits(organisationId, units)),
            replaceAssignments: (personId, assignments) => (
              assignmentWrites++,
              tx.replaceAssignments(personId, assignments)
            ),
          }),
        ),
    };
    let seq = 0;
    const scim = scimUsecases({ store, clock: () => new Date(), ids: () => 'id-' + ++seq, digest: t => t });
    const p = { id: 'mk', organisationId: 'sundsvall', label: 'Metakatalogen' };
    const a = (await scim.createUser(p, anna, BASE)).id;
    const unit = await scim.createGroup(p, group('unit:skola', 'Bergsåkers skola', [a]), BASE);
    await scim.createGroup(p, group('unit-manager:skola', 'Rektorer', [a]), BASE);
    expect(unitWrites).toBeGreaterThan(0);
    expect(assignmentWrites).toBeGreaterThan(0);
    const [units, assignments] = [unitWrites, assignmentWrites];
    await scim.replaceUser(p, a, anna, BASE);
    await scim.replaceGroup(p, unit.id, group('unit:skola', 'Bergsåkers skola', [a]), BASE);
    expect(unitWrites).toBe(units);
    expect(assignmentWrites).toBe(assignments);
    await scim.replaceGroup(p, unit.id, group('unit:skola', 'Bergsåkers nya skola', [a]), BASE);
    expect(unitWrites).toBe(units + 1);
    expect(inner.state.grants.get(a)).toMatchObject({ unitLabel: 'Bergsåkers nya skola', role: 'manager' });
  });
  test('a group belongs to the organisation that pushed it: another provisioner neither sees nor changes it, and its externalId stays unique across the installation', async () => {
    const { scim, p, store } = harness();
    const elsewhere = { id: 'other', organisationId: 'timra', label: 'Other' };
    const a = (await scim.createUser(p, anna, BASE)).id;
    const unit = await scim.createGroup(p, group('unit:skola', 'Bergsåkers skola', [a]), BASE);
    expect(store.state.groups.get(unit.id)?.organisationId).toBe('sundsvall');
    await expect(scim.getGroup(elsewhere, unit.id, BASE)).rejects.toMatchObject({ status: 404 });
    await expect(scim.deleteGroup(elsewhere, unit.id)).rejects.toMatchObject({ status: 404 });
    await expect(scim.replaceGroup(elsewhere, unit.id, group('unit:skola', 'Taken', []), BASE)).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      scim.patchGroup(elsewhere, unit.id, { schemas: [], Operations: [{ op: 'remove', path: 'members' }] }, BASE),
    ).rejects.toMatchObject({ status: 404 });
    expect((await scim.listGroups(elsewhere, {}, BASE)).totalResults).toBe(0);
    await expect(scim.createGroup(elsewhere, group('unit:skola', 'Same key', []), BASE)).rejects.toMatchObject({
      status: 409,
      scimType: 'uniqueness',
    });
    expect(store.state.grants.get(a)).toMatchObject({ unitId: 'skola', unitLabel: 'Bergsåkers skola' });
    expect((await scim.getGroup(p, unit.id, BASE)).members.map(m => m.value)).toEqual([a]);
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
    expect(() => applyUserPatch(fields, [{ op: 'replace', path: 'meta.created', value: 'x' }])).toThrow('read-only');
    // Clew holds the work address: a path that picks out another type names nothing Clew holds.
    expect(
      applyUserPatch(fields, [{ op: 'replace', path: 'emails[type eq "home"].value', value: 'private@x.test' }]),
    ).toEqual(fields);
    // A path-less value is the resource as the client holds it: what it repeats of the read-only attributes is ignored.
    expect(
      applyUserPatch(
        fields,
        [{ op: 'replace', value: { id: 'me', schemas: ['x'], meta: {}, groups: [], active: false } }],
        'me',
      ),
    ).toEqual({ ...fields, enabled: false });
    expect(() => applyUserPatch(fields, [{ op: 'replace', value: { id: 'other' } }], 'me')).toThrow('another resource');
    // Given and family names are not held: a name object without `formatted` changes nothing, with one it sets the name.
    expect(applyUserPatch(fields, [{ op: 'replace', value: { name: { givenName: 'A', familyName: 'B' } } }])).toEqual(
      fields,
    );
    expect(applyUserPatch(fields, [{ op: 'replace', path: 'name', value: { formatted: 'A B' } }]).name).toBe('A B');
  });
  test('remove is refused for what Clew requires and ignored for what it does not hold', () => {
    for (const path of [
      'title',
      'name.familyName',
      'nickName',
      'phoneNumbers[type eq "mobile"].value',
      'emails[type eq "home"].value',
      'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:manager',
      'urn:ietf:params:scim:schemas:core:2.0:User:title',
    ])
      expect(applyUserPatch(fields, [{ op: 'Remove', path }])).toEqual(fields);
    for (const path of [
      'userName',
      'externalId',
      'displayName',
      'active',
      'emails',
      'emails[type eq "work"].value',
      'emails[primary eq true]',
      'urn:ietf:params:scim:schemas:core:2.0:User:userName',
    ]) {
      const refused = (() => {
        try {
          applyUserPatch(fields, [{ op: 'remove', path }]);
        } catch (error) {
          return error as ScimError;
        }
      })();
      expect(refused).toMatchObject({ status: 400, scimType: 'mutability' });
      expect(refused?.detail).toContain('Clew requires it');
    }
    expect(() => applyUserPatch(fields, [{ op: 'remove', path: 'id' }])).toThrow('read-only');
    expect(() => applyUserPatch(fields, [{ op: 'remove' }])).toThrow('needs a path');
    expect(() => applyUserPatch(fields, [{ op: 'move', path: 'userName', value: 'x' }])).toThrow(
      'Unknown patch operation',
    );
    expect(() => applyUserPatch(fields, [{ op: 'replace', path: 'active', value: 'maybe' }])).toThrow('boolean');
  });
  test('group patches add, remove and replace members in every form the clients use', () => {
    const g = { externalId: 'unit:a', label: 'A', parent: null, members: ['1', '2'] };
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
      label: 'B',
      parent: null,
      members: ['5'],
    });
    expect(applyGroupPatch(g, [{ op: 'remove', path: 'externalId' }]).externalId).toBeNull();
    // Okta renames with the id in the value; a schema-qualified path is the same attribute; an id keeps its case.
    expect(applyGroupPatch(g, [{ op: 'replace', value: { id: 'gid', displayName: 'B' } }], 'gid').label).toBe('B');
    expect(() => applyGroupPatch(g, [{ op: 'replace', value: { id: 'other', displayName: 'B' } }], 'gid')).toThrow(
      'another resource',
    );
    expect(
      applyGroupPatch({ ...g, members: ['Ab', 'ab'] }, [
        { op: 'remove', path: 'urn:ietf:params:scim:schemas:core:2.0:Group:members[value eq "Ab"]' },
      ]).members,
    ).toEqual(['ab']);
    expect(applyGroupPatch(g, [{ op: 'remove', path: 'description' }])).toEqual(g);
    expect(() => applyGroupPatch(g, [{ op: 'remove', path: 'displayName' }])).toThrow('Clew requires it');
    expect(() => applyGroupPatch(g, [{ op: 'remove', path: 'id' }])).toThrow('read-only');
    expect(() => applyGroupPatch(g, [{ op: 'remove' }])).toThrow('needs a path');
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
  test('a count that is no number takes the default, a negative one reads as zero, and the maximum caps it', () => {
    expect(pageOf({})).toEqual({ startIndex: 1, count: 200 });
    expect(pageOf({ count: 'abc', startIndex: 'x' })).toEqual({ startIndex: 1, count: 200 });
    expect(pageOf({ count: '0' })).toEqual({ startIndex: 1, count: 0 });
    expect(pageOf({ count: '-5', startIndex: '-2' })).toEqual({ startIndex: 1, count: 0 });
    expect(pageOf({ count: '1000', startIndex: '7' })).toEqual({ startIndex: 7, count: 200 });
  });
  test('a projection keeps or drops by name without regard to case, with or without the schema URN', () => {
    const r: Record<string, unknown> = {
      schemas: ['s'],
      id: '1',
      userName: 'u',
      name: { formatted: 'F', x: 1 },
      emails: [{ value: 'v', type: 't' }],
    };
    expect(project(r, {})).toBe(r);
    expect(project(r, { attributes: 'USERNAME' })).toEqual({ schemas: ['s'], id: '1', userName: 'u' });
    expect(project(r, { attributes: 'urn:ietf:params:scim:schemas:core:2.0:User:name.formatted' })).toEqual({
      schemas: ['s'],
      id: '1',
      name: { formatted: 'F' },
    });
    expect(project(r, { excludedAttributes: 'emails.type, name, id, schemas' })).toEqual({
      schemas: ['s'],
      id: '1',
      userName: 'u',
      emails: [{ value: 'v' }],
    });
    expect(leavesOut({ excludedAttributes: 'Members' }, 'members')).toBe(true);
    expect(leavesOut({ excludedAttributes: 'members.display' }, 'members')).toBe(false);
    expect(leavesOut({ attributes: 'displayName' }, 'members')).toBe(true);
    expect(leavesOut({ attributes: 'members.value' }, 'members')).toBe(false);
    expect(leavesOut(undefined, 'members')).toBe(false);
  });
});
scimStoreContract('memory', async () => {
  const store = memoryProvisionStore();
  return {
    store,
    prefix: 'm-' + randomUUID().slice(0, 8),
    async seedProvisioner(p, digest, revoked, previous) {
      store.state.provisioners.set(digest, { ...p, revoked, previous });
    },
    async bind(personId) {
      store.state.bindings.add(personId);
    },
  };
});
