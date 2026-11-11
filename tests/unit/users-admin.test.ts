import { describe, expect, test } from 'bun:test';
import type { AuthenticatedContext } from '@clew/contracts';
import { memoryProvisionStore, memberKey } from '../../apps/server/src/modules/people/adapters/memory';
import { usersAdminUsecases } from '../../apps/server/src/modules/people/usecases';

/** Administration › Användare (D85): the overview, and the mapping from a group to a capability with its audit and derivation. */
const T = '2026-11-09T06:00:00.000Z';
function stack() {
  const store = memoryProvisionStore(),
    s = store.state;
  const person = (id: string, name: string) =>
    s.users.set(id, {
      id,
      organisationId: 'poc',
      externalId: 'dev:' + id,
      userName: id,
      name,
      email: id + '@x.test',
      enabled: true,
      createdAt: T,
      updatedAt: T,
    });
  person('hillevi', 'Hillevi Berg');
  person('mikael', 'Mikael Lund');
  person('zara', 'Zara Avstängd');
  s.users.get('zara')!.enabled = false;
  s.groups.set('g-skola', {
    id: 'g-skola',
    organisationId: 'poc',
    parentUnitId: null,
    externalId: 'unit:unit-skola',
    label: 'Bergsåkers skola',
    createdAt: T,
    updatedAt: T,
  });
  s.groups.set('g-it', {
    id: 'g-it',
    organisationId: 'poc',
    parentUnitId: null,
    externalId: 'unit:unit-it',
    label: 'IT',
    createdAt: T,
    updatedAt: T,
  });
  s.groups.set('g-ad', {
    id: 'g-ad',
    organisationId: 'poc',
    parentUnitId: null,
    externalId: 'S-1-5-21-it-staff',
    label: 'IT-personal',
    createdAt: T,
    updatedAt: T,
  });
  s.groups.set('g-plain', {
    id: 'g-plain',
    organisationId: 'poc',
    parentUnitId: null,
    externalId: null,
    label: 'No external id',
    createdAt: T,
    updatedAt: T,
  });
  for (const [g, p] of [
    ['g-skola', 'hillevi'],
    ['g-it', 'mikael'],
    ['g-ad', 'mikael'],
    ['g-plain', 'mikael'],
  ])
    s.members.add(memberKey(g!, p!));
  s.units.set('unit-skola', { organisationId: 'poc', label: 'Bergsåkers skola' });
  s.units.set('unit-it', { organisationId: 'poc', label: 'IT' });
  s.assignments.set('hillevi', [{ unitId: 'unit-skola', role: 'manager' }]);
  s.assignments.set('mikael', [{ unitId: 'unit-it', role: 'employee' }]);
  s.grants.set('hillevi', { unitId: 'unit-skola', unitLabel: 'Bergsåkers skola', role: 'manager', capabilities: [] });
  s.grants.set('mikael', { unitId: 'unit-it', unitLabel: 'IT', role: 'employee', capabilities: [] });
  s.bindings.add('hillevi');
  const persona = (capabilities: string[]): AuthenticatedContext => ({
    id: 'mikael',
    name: 'Mikael Lund',
    unitId: 'unit-it',
    unitLabel: 'IT',
    role: 'employee',
    organisationId: 'poc',
    principal: { id: 'person:mikael', kind: 'person' },
    capabilities,
    authorizationVersion: 'v',
    sessionBinding: 'test',
    expiresAt: T,
    authorize: async () => ({ version: 'v' }),
  });
  return {
    store,
    usecases: usersAdminUsecases({ store, clock: () => new Date('2026-11-10T06:00:00.000Z') }),
    admin: persona(['admin.users']),
    other: persona(['admin.connectors']),
  };
}
describe('Användare', () => {
  test("the overview names the organisation's provisioners with when each was last seen, and says which have gone silent", async () => {
    const { usecases, admin, store } = stack();
    const p = (id: string, lastSeenAt: string | null, organisationId = 'poc') => ({
      id,
      organisationId,
      label: 'Label ' + id,
      lastSeenAt,
    });
    store.state.provisioners.set('d:1', p('a-fresh', '2026-11-10T05:00:00.000Z'));
    store.state.provisioners.set('d:2', p('b-two-days', '2026-11-08T06:00:00.000Z'));
    store.state.provisioners.set('d:3', p('c-late', '2026-11-08T05:59:59.000Z'));
    store.state.provisioners.set('d:4', p('d-never', null));
    store.state.provisioners.set('d:5', { ...p('e-revoked', null), revoked: true });
    store.state.provisioners.set('d:6', p('f-elsewhere', null, 'other-organisation'));
    expect((await usecases.overview(admin)).provisioners).toEqual([
      { id: 'a-fresh', label: 'Label a-fresh', lastSeenAt: '2026-11-10T05:00:00.000Z', silent: false },
      { id: 'b-two-days', label: 'Label b-two-days', lastSeenAt: '2026-11-08T06:00:00.000Z', silent: false },
      { id: 'c-late', label: 'Label c-late', lastSeenAt: '2026-11-08T05:59:59.000Z', silent: true },
      { id: 'd-never', label: 'Label d-never', lastSeenAt: null, silent: true },
    ]);
  });
  test('the overview lists people by name with unit, role, groups, capabilities and whether they signed in; the mapping offers the groups with an external id', async () => {
    const { usecases, admin } = stack();
    const o = await usecases.overview(admin);
    expect(o.users.map(u => u.name)).toEqual(['Hillevi Berg', 'Mikael Lund', 'Zara Avstängd']);
    expect(o.users[0]).toMatchObject({
      userName: 'hillevi',
      bound: true,
      active: { unitId: 'unit-skola', unitLabel: 'Bergsåkers skola', role: 'manager' },
      assignments: [{ unitId: 'unit-skola', unitLabel: 'Bergsåkers skola', role: 'manager' }],
      groups: [{ externalId: 'unit:unit-skola', label: 'Bergsåkers skola' }],
    });
    expect(o.users[1]).toMatchObject({ bound: false, capabilities: [] });
    expect(o.users[1]!.groups.map(g => g.label)).toEqual(['IT-personal', 'IT', 'No external id']);
    expect(o.users[2]).toMatchObject({ enabled: false, active: null, assignments: [] });
    expect(o.groups).toEqual([
      { id: 'unit:unit-skola', label: 'Bergsåkers skola' },
      { id: 'unit:unit-it', label: 'IT' },
      { id: 'S-1-5-21-it-staff', label: 'IT-personal' },
    ]);
    expect(o.groupCapabilities).toEqual([]);
    expect(o.capabilities).toEqual(['admin.connectors', 'admin.users', 'admin.appearance', 'admin.competence']);
  });
  test('only admin.users may look or change', async () => {
    const { usecases, other } = stack();
    await expect(usecases.overview(other)).rejects.toThrow('behörighet');
    await expect(
      usecases.addGroupCapability(other, { groupExternalId: 'S-1-5-21-it-staff', capability: 'admin.users' }),
    ).rejects.toThrow('behörighet');
  });
  test('mapping a group gives its members the capability at once, audited; unmapping takes it back; nothing happens twice', async () => {
    const { usecases, admin, store } = stack();
    const mapped = await usecases.addGroupCapability(admin, {
      groupExternalId: 'S-1-5-21-it-staff',
      capability: 'admin.connectors',
    });
    expect(mapped.groupCapabilities).toEqual([
      { groupExternalId: 'S-1-5-21-it-staff', groupLabel: 'IT-personal', capability: 'admin.connectors' },
    ]);
    expect(mapped.users.find(u => u.id === 'mikael')?.capabilities).toEqual(['admin.connectors']);
    expect(store.state.grants.get('mikael')?.capabilities).toEqual(['admin.connectors']);
    expect(store.state.audit.map(a => a.action)).toEqual(['group-capability.added', 'grant.derived']);
    expect(store.state.audit[0]).toMatchObject({
      actor: 'person:mikael',
      subject: 'group:S-1-5-21-it-staff',
      details: { capability: 'admin.connectors', groupLabel: 'IT-personal' },
    });
    await usecases.addGroupCapability(admin, { groupExternalId: 'S-1-5-21-it-staff', capability: 'admin.connectors' });
    expect(store.state.audit).toHaveLength(2);
    const unmapped = await usecases.removeGroupCapability(admin, {
      groupExternalId: 'S-1-5-21-it-staff',
      capability: 'admin.connectors',
    });
    expect(unmapped.groupCapabilities).toEqual([]);
    expect(store.state.grants.get('mikael')?.capabilities).toEqual([]);
    expect(store.state.audit.map(a => a.action)).toEqual([
      'group-capability.added',
      'grant.derived',
      'group-capability.removed',
      'grant.derived',
    ]);
  });
  test('a group that is not provisioned cannot be mapped, but a stale mapping can be removed; an unknown capability is refused', async () => {
    const { usecases, admin, store } = stack();
    await expect(
      usecases.addGroupCapability(admin, { groupExternalId: 'S-1-5-21-gone', capability: 'admin.users' }),
    ).rejects.toThrow('Gruppen finns inte');
    store.state.groupCapabilities.push({ groupExternalId: 'S-1-5-21-gone', capability: 'admin.users' });
    expect((await usecases.overview(admin)).groupCapabilities).toEqual([
      { groupExternalId: 'S-1-5-21-gone', groupLabel: null, capability: 'admin.users' },
    ]);
    expect(
      (await usecases.removeGroupCapability(admin, { groupExternalId: 'S-1-5-21-gone', capability: 'admin.users' }))
        .groupCapabilities,
    ).toEqual([]);
    await expect(
      usecases.addGroupCapability(admin, { groupExternalId: 'S-1-5-21-it-staff', capability: 'nonsense' as never }),
    ).rejects.toThrow('Okänd behörighet');
  });
});
