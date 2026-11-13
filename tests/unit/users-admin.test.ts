import { describe, expect, test } from 'bun:test';
import type { AuthenticatedContext, UsersAdminOverview } from '@clew/contracts';
import { memoryProvisionStore, memberKey } from '../../apps/server/src/modules/people/adapters/memory';
import {
  provisionerKeyUsecases,
  scimUsecases,
  usersAdminUsecases,
} from '../../apps/server/src/modules/people/usecases';
import type { ProvisionStore } from '../../apps/server/src/modules/people/ports';
import { refusingNul } from '../refusing-nul';

/**
 * Administration › Användare (D85, D100): the overview, the people a page at a time with what narrows them, and the
 * mapping from a group to a capability with its audit and derivation. The use cases run over a store that refuses a
 * NUL as PostgreSQL does, so none of them hands one on.
 */
const T = '2026-11-09T06:00:00.000Z';
/**
 * The store with `meanwhile` run whenever a transaction takes a group's row lock, before the row is answered: what a
 * SCIM write of the group committed while a mapping change waited for that row (K4).
 */
function lockedAfter(store: ProvisionStore, meanwhile: () => void): ProvisionStore {
  return {
    transaction: fn =>
      store.transaction(tx =>
        fn(
          new Proxy(tx, {
            get(target, key) {
              const member: unknown = Reflect.get(target, key);
              if (typeof member !== 'function') return member;
              return (...args: unknown[]) => {
                if (key === 'readGroup' && args[2] === true) meanwhile();
                return (member as (...values: unknown[]) => unknown).apply(target, args);
              };
            },
          }),
        ),
      ),
  };
}
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
      phoneNumbers: [],
      employments: [],
      title: null,
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
  let tokens = 0;
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
  const keys = {
    store: refusingNul(store),
    clock: () => new Date('2026-11-10T06:00:00.000Z'),
    token: () => 'token-' + ++tokens,
    digest: (token: string) => 'digest:' + token,
  };
  return {
    store,
    usecases: usersAdminUsecases(keys),
    /** The page's use cases over the same store, where `meanwhile` commits while a change waits for a group's row. */
    waiting: (meanwhile: () => void) => usersAdminUsecases({ ...keys, store: lockedAfter(keys.store, meanwhile) }),
    /** The operator's script's use cases over the same store and keys (D107 item 6). */
    operator: provisionerKeyUsecases(keys),
    /** The SCIM server over the same store, at the instant given: what a provisioner's key meets. */
    scimAt: (at: string) =>
      scimUsecases({ store, clock: () => new Date(at), ids: () => 'x', digest: token => 'digest:' + token }),
    admin: persona(['admin.users']),
    other: persona(['admin.connectors']),
  };
}
/** The row of the provisioner a key was made for, as the page finds it in the answer. */
const rowOf = (issued: { id: string; overview: UsersAdminOverview }) =>
  issued.overview.provisioners.find(p => p.id === issued.id);
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
    const row = (id: string, lastSeenAt: string | null, silent: boolean) => ({
      id,
      label: 'Label ' + id,
      lastSeenAt,
      silent,
      previousValidUntil: null,
    });
    expect((await usecases.overview(admin)).provisioners).toEqual([
      row('a-fresh', '2026-11-10T05:00:00.000Z', false),
      row('b-two-days', '2026-11-08T06:00:00.000Z', false),
      row('c-late', '2026-11-08T05:59:59.000Z', true),
      row('d-never', null, true),
    ]);
    // A key that was rotated out is named while it still answers, and not after.
    store.state.provisioners.set('d:1', {
      ...p('a-fresh', '2026-11-10T05:00:00.000Z'),
      previous: { digest: 'd:old', until: '2026-11-10T09:00:00.000Z' },
    });
    store.state.provisioners.set('d:2', {
      ...p('b-two-days', '2026-11-08T06:00:00.000Z'),
      previous: { digest: 'd:older', until: '2026-11-10T06:00:00.000Z' },
    });
    expect((await usecases.overview(admin)).provisioners.map(o => o.previousValidUntil)).toEqual([
      '2026-11-10T09:00:00.000Z',
      null,
      null,
      null,
    ]);
  });
  test('a page lists people by name with unit, role, capabilities and whether they signed in', async () => {
    const { usecases, admin, store } = stack();
    const o = await usecases.people(admin);
    expect(o).toMatchObject({ total: 3, all: 3, page: 1, pageSize: 25 });
    expect(o.rows.map(u => u.name)).toEqual(['Hillevi Berg', 'Mikael Lund', 'Zara Avstängd']);
    expect(o.rows[0]).toMatchObject({
      userName: 'hillevi',
      bound: true,
      active: { unitId: 'unit-skola', unitLabel: 'Bergsåkers skola', role: 'manager' },
      assignments: [{ unitId: 'unit-skola', unitLabel: 'Bergsåkers skola', role: 'manager' }],
    });
    expect(o.rows[1]).toMatchObject({ bound: false, capabilities: [] });
    // A row carries what the list shows and nothing else: a person's groups are not read for it.
    expect(o.rows[1]).not.toHaveProperty('groups');
    expect(o.rows[2]).toMatchObject({ enabled: false, active: null, assignments: [] });
    // Reading writes nothing, so nothing is audited.
    expect(store.state.audit).toEqual([]);
  });
  test("a person's title is on the row and is one of the things the words are looked for in (D110)", async () => {
    const { usecases, admin, store } = stack();
    store.state.users.get('hillevi')!.title = 'Rektor';
    expect((await usecases.people(admin)).rows.map(u => u.title)).toEqual(['Rektor', null, null]);
    expect((await usecases.people(admin, { text: 'REKTOR' })).rows.map(u => [u.name, u.title])).toEqual([
      ['Hillevi Berg', 'Rektor'],
    ]);
    expect(store.state.audit).toEqual([]);
  });
  test('the row shows every title of a person’s employments, each once, and a word is looked for in each of them (D114)', async () => {
    const { usecases, admin, store } = stack();
    const hillevi = store.state.users.get('hillevi')!;
    hillevi.title = 'Katalogtitel';
    hillevi.employments = [
      { unitId: 'unit-skola', title: 'Rektor' },
      { unitId: 'unit-skola' },
      { unitId: 'unit-it', title: 'Projektledare' },
      { unitId: 'unit-ekonomi', title: 'Rektor' },
    ];
    // Employments without a title leave the core one to stand.
    store.state.users.get('mikael')!.title = 'Systemförvaltare';
    store.state.users.get('mikael')!.employments = [{ unitId: 'unit-it' }];
    const titles = async (text?: string) =>
      (await usecases.people(admin, text === undefined ? undefined : { text })).rows.flatMap(u =>
        u.title ? [[u.name, u.title]] : [],
      );
    expect(await titles()).toEqual([
      ['Hillevi Berg', 'Rektor, Projektledare'],
      ['Mikael Lund', 'Systemförvaltare'],
    ]);
    expect(await titles('projektLEDARE')).toEqual([['Hillevi Berg', 'Rektor, Projektledare']]);
    expect(await titles('systemförvaltare')).toEqual([['Mikael Lund', 'Systemförvaltare']]);
  });
  test('the list is narrowed by words, role, status and capability, and says how many match of how many there are', async () => {
    const { usecases, admin, store } = stack();
    const names = async (query: Parameters<typeof usecases.people>[1]) => {
      const page = await usecases.people(admin, query);
      expect(page.all).toBe(3);
      expect(page.total).toBe(page.rows.length);
      return page.rows.map(u => u.name);
    };
    expect(await names({ text: '  LUND ' })).toEqual(['Mikael Lund']);
    expect(await names({ text: 'zara avstängd' })).toEqual(['Zara Avstängd']);
    expect(await names({ text: 'hillevi@x.test' })).toEqual(['Hillevi Berg']);
    expect(await names({ text: 'hillevi lund' })).toEqual([]);
    expect(await names({ role: 'manager' })).toEqual(['Hillevi Berg']);
    expect(await names({ role: 'employee' })).toEqual(['Mikael Lund']);
    expect(await names({ status: 'signed-in' })).toEqual(['Hillevi Berg']);
    expect(await names({ status: 'not-signed-in' })).toEqual(['Mikael Lund']);
    expect(await names({ status: 'disabled' })).toEqual(['Zara Avstängd']);
    expect(await names({ status: 'no-access' })).toEqual([]);
    store.state.grants.get('mikael')!.capabilities = ['admin.users'];
    expect(await names({ capability: 'admin.users' })).toEqual(['Mikael Lund']);
    expect(await names({ capability: 'admin.users', role: 'manager' })).toEqual([]);
    // Another organisation's people are nobody here, whatever is asked.
    store.state.users.set('ulla', { ...store.state.users.get('mikael')!, id: 'ulla', organisationId: 'elsewhere' });
    expect(await names({})).toEqual(['Hillevi Berg', 'Mikael Lund', 'Zara Avstängd']);
  });
  test('a unit is asked for with everything below it in the tree, and with a role as one assignment', async () => {
    const { usecases, admin, store } = stack(),
      s = store.state;
    // Skolan lies under Förvaltningen, which Mikael also leads; IT stands beside them.
    s.groups.set('g-forv', {
      ...s.groups.get('g-skola')!,
      id: 'g-forv',
      externalId: 'unit:unit-forv',
      label: 'Förvaltningen',
    });
    s.groups.set('g-skola', { ...s.groups.get('g-skola')!, parentUnitId: 'unit-forv' });
    s.units.set('unit-forv', { organisationId: 'poc', label: 'Förvaltningen' });
    s.assignments.set('mikael', [
      { unitId: 'unit-forv', role: 'manager' },
      { unitId: 'unit-it', role: 'employee' },
    ]);
    const names = async (query: Parameters<typeof usecases.people>[1]) =>
      (await usecases.people(admin, query)).rows.map(u => u.name);
    expect(await names({ unitId: 'unit-forv' })).toEqual(['Hillevi Berg', 'Mikael Lund']);
    expect(await names({ unitId: 'unit-skola' })).toEqual(['Hillevi Berg']);
    expect(await names({ unitId: 'unit-it' })).toEqual(['Mikael Lund']);
    // The role is the role on a unit of the branch: Mikael leads Förvaltningen and is an employee on IT.
    expect(await names({ unitId: 'unit-forv', role: 'manager' })).toEqual(['Hillevi Berg', 'Mikael Lund']);
    expect(await names({ unitId: 'unit-it', role: 'manager' })).toEqual([]);
    expect(await names({ unitId: 'unit-forv', role: 'employee' })).toEqual([]);
    // A unit nobody pushed and nobody is on has nobody.
    expect(await names({ unitId: 'unit-okand' })).toEqual([]);
    expect((await usecases.overview(admin)).units).toEqual([
      { id: 'unit-skola', label: 'Bergsåkers skola', parentLabel: 'Förvaltningen' },
      { id: 'unit-forv', label: 'Förvaltningen', parentLabel: null },
      { id: 'unit-it', label: 'IT', parentLabel: null },
    ]);
  });
  test('people come a page at a time in one order, and a page past the end answers with the last one', async () => {
    const { usecases, admin, store } = stack();
    const first = store.state.users.get('mikael')!;
    for (let i = 0; i < 60; i++) {
      const id = 'p' + String(i).padStart(2, '0');
      store.state.users.set(id, { ...first, id, externalId: 'dev:' + id, userName: id, name: 'Person ' + id });
    }
    const one = await usecases.people(admin);
    expect(one).toMatchObject({ total: 63, all: 63, page: 1, pageSize: 25 });
    expect(one.rows).toHaveLength(25);
    expect(one.rows.slice(0, 3).map(u => u.name)).toEqual(['Hillevi Berg', 'Mikael Lund', 'Person p00']);
    const three = await usecases.people(admin, { page: 3 });
    expect(three.rows.map(u => u.name)).toEqual([
      ...Array.from({ length: 12 }, (_, i) => 'Person p' + (48 + i)),
      'Zara Avstängd',
    ]);
    // Nobody is on two pages and nobody is missing.
    const two = await usecases.people(admin, { page: 2 });
    expect(new Set([...one.rows, ...two.rows, ...three.rows].map(u => u.id)).size).toBe(63);
    expect(await usecases.people(admin, { page: 9 })).toMatchObject({ page: 3, total: 63 });
    expect(await usecases.people(admin, { page: 9, text: 'ingen sådan' })).toEqual({
      rows: [],
      total: 0,
      all: 63,
      page: 1,
      pageSize: 25,
    });
    const wide = await usecases.people(admin, { pageSize: 50, page: 2, text: 'person' });
    expect(wide).toMatchObject({ total: 60, all: 63, page: 2, pageSize: 50 });
    expect(wide.rows).toHaveLength(10);
  });
  test('the overview offers the groups with an external id to the mapping', async () => {
    const { usecases, admin } = stack();
    const o = await usecases.overview(admin);
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
    await expect(usecases.people(other, { text: 'hillevi' })).rejects.toThrow('behörighet');
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
    expect((await usecases.people(admin, { capability: 'admin.connectors' })).rows.map(u => u.id)).toEqual(['mikael']);
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
  test("another organisation's group is not there to map or unmap, and its rows are not shown (D101)", async () => {
    const { usecases, admin, store } = stack();
    const elsewhere: AuthenticatedContext = { ...admin, organisationId: 'timra' },
      row = { groupExternalId: 'S-1-5-21-it-staff', capability: 'admin.connectors' as const };
    await expect(usecases.addGroupCapability(elsewhere, row)).rejects.toThrow('Gruppen finns inte');
    expect(store.state.audit).toEqual([]);
    await usecases.addGroupCapability(admin, row);
    // A removal from there finds no row of its own to remove, answers the page as it is and writes nothing.
    expect((await usecases.removeGroupCapability(elsewhere, row)).groupCapabilities).toEqual([]);
    expect((await usecases.overview(elsewhere)).groupCapabilities).toEqual([]);
    expect((await usecases.overview(admin)).groupCapabilities).toEqual([
      { groupExternalId: 'S-1-5-21-it-staff', groupLabel: 'IT-personal', capability: 'admin.connectors' },
    ]);
    expect(store.state.grants.get('mikael')?.capabilities).toEqual(['admin.connectors']);
    expect(store.state.audit.map(a => a.action)).toEqual(['group-capability.added', 'grant.derived']);
  });
  test('an administrator issues a provisioner its key: answered once, kept as a digest, audited without it, and it opens the SCIM server (D107)', async () => {
    const { usecases, admin, other, store, scimAt } = stack();
    await expect(usecases.issueProvisioner(other, { id: 'metakatalogen', label: 'Metakatalogen' })).rejects.toThrow(
      'behörighet',
    );
    const issued = await usecases.issueProvisioner(admin, { id: 'metakatalogen', label: ' Metakatalogen ' });
    expect(issued.token).toBe('token-1');
    expect(issued.id).toBe('metakatalogen');
    expect(rowOf(issued)).toEqual({
      id: 'metakatalogen',
      label: 'Metakatalogen',
      lastSeenAt: null,
      silent: true,
      previousValidUntil: null,
    });
    expect(issued.overview.provisioners).toHaveLength(1);
    // The key is nowhere but in the answer: the store holds its digest, and the audit names the provisioner.
    expect([...store.state.provisioners.keys()]).toEqual(['digest:token-1']);
    expect(JSON.stringify([...store.state.provisioners.values()])).not.toContain('token-1');
    expect(store.state.audit).toEqual([
      {
        actor: 'person:mikael',
        action: 'provisioner.added',
        subject: 'provisioner:metakatalogen',
        details: { organisationId: 'poc', label: 'Metakatalogen' },
      },
    ]);
    expect(JSON.stringify(await usecases.overview(admin))).not.toContain('token-1');
    // An id that is in use is refused with the same words, from this organisation and from another.
    await expect(usecases.issueProvisioner(admin, { id: 'metakatalogen', label: 'Igen' })).rejects.toThrow(
      'Det finns redan en katalog med det id:t.',
    );
    await expect(
      usecases.issueProvisioner({ ...admin, organisationId: 'timra' }, { id: 'metakatalogen', label: 'Timrå' }),
    ).rejects.toThrow('Det finns redan en katalog med det id:t.');
    await expect(usecases.issueProvisioner(admin, { id: 'tom', label: '   ' })).rejects.toThrow('behöver ett namn');
    expect(store.state.audit).toHaveLength(1);
    expect(await scimAt('2026-11-10T07:00:00.000Z').authenticate('token-1')).toEqual({
      id: 'metakatalogen',
      organisationId: 'poc',
      label: 'Metakatalogen',
    });
    expect(await scimAt('2026-11-10T07:00:00.000Z').authenticate('token-2')).toBeUndefined();
  });
  test('a key is rotated with a grace period in which the old one still answers, or at once; a second rotation ends the first old key, and the audit says so (D107)', async () => {
    const { usecases, admin, other, store, scimAt } = stack();
    await usecases.issueProvisioner(admin, { id: 'metakatalogen', label: 'Metakatalogen' });
    await expect(usecases.rotateProvisioner(other, 'metakatalogen', { graceHours: 24 })).rejects.toThrow('behörighet');
    const rotated = await usecases.rotateProvisioner(admin, 'metakatalogen', { graceHours: 24 });
    expect(rotated.token).toBe('token-2');
    expect(rowOf(rotated)?.previousValidUntil).toBe('2026-11-11T06:00:00.000Z');
    // No key replaced earlier was ended, so the answer says nothing of one.
    expect(rotated).not.toHaveProperty('endedEarlier');
    expect(store.state.audit.at(-1)).toEqual({
      actor: 'person:mikael',
      action: 'provisioner.rotated',
      subject: 'provisioner:metakatalogen',
      details: { graceHours: 24, previousValidUntil: '2026-11-11T06:00:00.000Z' },
    });
    // Both answer inside the grace period, the new one alone after it.
    const during = scimAt('2026-11-10T12:00:00.000Z'),
      after = scimAt('2026-11-11T06:00:01.000Z');
    expect((await during.authenticate('token-1'))?.id).toBe('metakatalogen');
    expect((await during.authenticate('token-2'))?.id).toBe('metakatalogen');
    expect(await after.authenticate('token-1')).toBeUndefined();
    expect((await after.authenticate('token-2'))?.id).toBe('metakatalogen');
    // At once, inside the first grace period: the key before the one replaced now stops answering too.
    const audited = store.state.audit.length;
    const again = await usecases.rotateProvisioner(admin, 'metakatalogen', { graceHours: 0 });
    expect(again.token).toBe('token-3');
    expect(rowOf(again)?.previousValidUntil).toBeNull();
    // The answer says until when the key it ended would have answered, so the page can say so (K1).
    expect(again.endedEarlier).toBe('2026-11-11T06:00:00.000Z');
    expect(store.state.audit.slice(audited)).toEqual([
      {
        actor: 'person:mikael',
        action: 'provisioner.rotated',
        subject: 'provisioner:metakatalogen',
        details: { graceHours: 0, previousValidUntil: null, endedEarlier: '2026-11-11T06:00:00.000Z' },
      },
    ]);
    expect(await during.authenticate('token-1')).toBeUndefined();
    expect(await during.authenticate('token-2')).toBeUndefined();
    expect((await during.authenticate('token-3'))?.id).toBe('metakatalogen');
    expect(JSON.stringify(store.state.audit)).not.toContain('token-');
    // Another organisation's provisioner, and one that is not there, are the same refusal.
    const elsewhere = { ...admin, organisationId: 'timra' };
    await expect(usecases.rotateProvisioner(elsewhere, 'metakatalogen', { graceHours: 0 })).rejects.toThrow(
      'Katalogen finns inte.',
    );
    await expect(usecases.rotateProvisioner(admin, 'okand', { graceHours: 0 })).rejects.toThrow(
      'Katalogen finns inte.',
    );
  });
  test('a revoked provisioner opens nothing and is gone from the page, and its id may be issued again (D107)', async () => {
    const { usecases, admin, other, store, scimAt } = stack(),
      scim = scimAt('2026-11-10T07:00:00.000Z'),
      elsewhere = { ...admin, organisationId: 'timra' };
    await usecases.issueProvisioner(admin, { id: 'metakatalogen', label: 'Metakatalogen' });
    await usecases.rotateProvisioner(admin, 'metakatalogen', { graceHours: 24 });
    await expect(usecases.revokeProvisioner(other, 'metakatalogen')).rejects.toThrow('behörighet');
    await expect(usecases.revokeProvisioner(elsewhere, 'metakatalogen')).rejects.toThrow('Katalogen finns inte.');
    expect((await scim.authenticate('token-2'))?.id).toBe('metakatalogen');
    const audited = store.state.audit.length;
    expect((await usecases.revokeProvisioner(admin, 'metakatalogen')).provisioners).toEqual([]);
    expect(store.state.audit.slice(audited)).toEqual([
      { actor: 'person:mikael', action: 'provisioner.revoked', subject: 'provisioner:metakatalogen', details: {} },
    ]);
    // Neither the key nor the one in its grace period.
    expect(await scim.authenticate('token-2')).toBeUndefined();
    expect(await scim.authenticate('token-1')).toBeUndefined();
    await expect(usecases.revokeProvisioner(admin, 'metakatalogen')).rejects.toThrow('Katalogen finns inte.');
    await expect(usecases.rotateProvisioner(admin, 'metakatalogen', { graceHours: 0 })).rejects.toThrow(
      'Katalogen finns inte.',
    );
    expect(store.state.audit).toHaveLength(audited + 1);
    // Another organisation cannot take the id, the one that held it can: a new key, and the old ones stay dead.
    await expect(usecases.issueProvisioner(elsewhere, { id: 'metakatalogen', label: 'Timrå' })).rejects.toThrow(
      'Det finns redan',
    );
    const reissued = await usecases.issueProvisioner(admin, { id: 'metakatalogen', label: 'Metakatalogen 2' });
    expect(rowOf(reissued)).toMatchObject({ label: 'Metakatalogen 2', lastSeenAt: null, silent: true });
    expect((await scim.authenticate(reissued.token))?.label).toBe('Metakatalogen 2');
    expect(await scim.authenticate('token-2')).toBeUndefined();
  });
  test('a second replacement inside the grace period answers until when the key it ended would have answered, whatever period is chosen (K1)', async () => {
    const { usecases, admin } = stack();
    await usecases.issueProvisioner(admin, { id: 'metakatalogen', label: 'Metakatalogen' });
    await usecases.rotateProvisioner(admin, 'metakatalogen', { graceHours: 168 });
    // A week is chosen again: the key replaced first still ends now, and the answer says so beside the new period.
    const again = await usecases.rotateProvisioner(admin, 'metakatalogen', { graceHours: 168 });
    expect(again.endedEarlier).toBe('2026-11-17T06:00:00.000Z');
    expect(rowOf(again)?.previousValidUntil).toBe('2026-11-17T06:00:00.000Z');
  });
  test('the operator replaces and takes back a key through the use cases the page runs, with its audit rows and the operator as the actor (D107 item 6, K5)', async () => {
    const { usecases, operator, admin, store, scimAt } = stack();
    await usecases.issueProvisioner(admin, { id: 'metakatalogen', label: 'Metakatalogen' });
    await usecases.issueProvisioner({ ...admin, organisationId: 'timra' }, { id: 'timra-katalog', label: 'Timrå' });
    const audited = store.state.audit.length;
    expect(await operator.rotate('bootstrap:cli', 'metakatalogen', 24)).toEqual({
      token: 'token-3',
      previousValidUntil: '2026-11-11T06:00:00.000Z',
      endedEarlier: null,
    });
    expect(await operator.rotate('bootstrap:cli', 'metakatalogen', 0)).toEqual({
      token: 'token-4',
      previousValidUntil: null,
      endedEarlier: '2026-11-11T06:00:00.000Z',
    });
    // The cut-off the second rotation really used is in its audit row, as the page writes it.
    expect(store.state.audit.slice(audited)).toEqual([
      {
        actor: 'bootstrap:cli',
        action: 'provisioner.rotated',
        subject: 'provisioner:metakatalogen',
        details: { graceHours: 24, previousValidUntil: '2026-11-11T06:00:00.000Z' },
      },
      {
        actor: 'bootstrap:cli',
        action: 'provisioner.rotated',
        subject: 'provisioner:metakatalogen',
        details: { graceHours: 0, previousValidUntil: null, endedEarlier: '2026-11-11T06:00:00.000Z' },
      },
    ]);
    const during = scimAt('2026-11-10T12:00:00.000Z');
    expect(await during.authenticate('token-1')).toBeUndefined();
    expect(await during.authenticate('token-3')).toBeUndefined();
    expect((await during.authenticate('token-4'))?.id).toBe('metakatalogen');
    // The installation is the operator's, so a provisioner of any organisation is theirs to take back.
    expect(await operator.revoke('bootstrap:cli', 'timra-katalog')).toEqual({ id: 'timra-katalog' });
    expect(store.state.audit.at(-1)).toEqual({
      actor: 'bootstrap:cli',
      action: 'provisioner.revoked',
      subject: 'provisioner:timra-katalog',
      details: {},
    });
    expect(await scimAt('2026-11-10T12:00:00.000Z').authenticate('token-2')).toBeUndefined();
    // A provisioner whose keys were taken back, or that is not there, answers nothing and writes nothing.
    const after = store.state.audit.length;
    expect(await operator.revoke('bootstrap:cli', 'timra-katalog')).toBeUndefined();
    expect(await operator.rotate('bootstrap:cli', 'timra-katalog', 24)).toBeUndefined();
    expect(await operator.rotate('bootstrap:cli', 'okand', 24)).toBeUndefined();
    expect(store.state.audit).toHaveLength(after);
    expect(JSON.stringify(store.state.audit)).not.toContain('token-');
  });
  test("the group picker searches the organisation's groups on the server, the first ten by name, with admin.users only (K2)", async () => {
    const { usecases, admin, other, store } = stack(),
      s = store.state;
    for (let i = 0; i < 12; i++) {
      const n = String(i).padStart(2, '0');
      s.groups.set('g-x' + n, {
        ...s.groups.get('g-ad')!,
        id: 'g-x' + n,
        externalId: 'S-1-5-21-extra-' + n,
        label: 'Extra ' + n,
      });
    }
    s.groups.set('g-timra', {
      ...s.groups.get('g-ad')!,
      id: 'g-timra',
      organisationId: 'timra',
      externalId: 'S-1-5-21-timra',
      label: 'IT-personal Timrå',
    });
    expect(await usecases.searchGroups(admin, '  it-PERSONAL ')).toEqual({
      groups: [{ id: 'S-1-5-21-it-staff', label: 'IT-personal' }],
    });
    // Each word in the name or in the external id.
    expect(await usecases.searchGroups(admin, 'unit:')).toEqual({
      groups: [
        { id: 'unit:unit-skola', label: 'Bergsåkers skola' },
        { id: 'unit:unit-it', label: 'IT' },
      ],
    });
    expect(await usecases.searchGroups(admin, 'extra 11')).toEqual({
      groups: [{ id: 'S-1-5-21-extra-11', label: 'Extra 11' }],
    });
    expect((await usecases.searchGroups(admin, 'extra')).groups.map(g => g.label)).toEqual(
      Array.from({ length: 10 }, (_, i) => 'Extra 0' + i),
    );
    // No words is every group, the first ten by name. A group without an external id and another organisation's
    // group are never found.
    expect((await usecases.searchGroups(admin, '')).groups.map(g => g.label)).toEqual([
      'Bergsåkers skola',
      ...Array.from({ length: 9 }, (_, i) => 'Extra 0' + i),
    ]);
    expect(await usecases.searchGroups(admin, 'timrå')).toEqual({ groups: [] });
    expect(await usecases.searchGroups(admin, 'no external')).toEqual({ groups: [] });
    await expect(usecases.searchGroups(other, 'it')).rejects.toThrow('behörighet');
    expect(s.audit).toEqual([]);
  });
  test('every mapping row is named by its own group, beyond the groups the overview offers too, and the picker reaches that group (K2)', async () => {
    const { usecases, admin, store } = stack(),
      s = store.state;
    for (let i = 0; i < 10_000; i++)
      s.groups.set('g-many-' + i, {
        ...s.groups.get('g-ad')!,
        id: 'g-many-' + i,
        externalId: 'S-1-5-21-many-' + i,
        label: 'Grupp ' + String(i).padStart(5, '0'),
      });
    s.groups.set('g-last', {
      ...s.groups.get('g-ad')!,
      id: 'g-last',
      externalId: 'S-1-5-21-last',
      label: 'Östra lärare',
    });
    s.groupCapabilities.push({ organisationId: 'poc', groupExternalId: 'S-1-5-21-last', capability: 'admin.users' });
    const o = await usecases.overview(admin);
    // The first ten thousand by name are offered; the row is named all the same, and not as a group that is gone.
    expect(o.groups).toHaveLength(10_000);
    expect(o.groups.slice(0, 2)).toEqual([
      { id: 'unit:unit-skola', label: 'Bergsåkers skola' },
      { id: 'S-1-5-21-many-0', label: 'Grupp 00000' },
    ]);
    expect(o.groups.some(g => g.id === 'S-1-5-21-last')).toBe(false);
    expect(o.groupCapabilities).toEqual([
      { groupExternalId: 'S-1-5-21-last', groupLabel: 'Östra lärare', capability: 'admin.users' },
    ]);
    expect(await usecases.searchGroups(admin, 'ÖSTRA')).toEqual({
      groups: [{ id: 'S-1-5-21-last', label: 'Östra lärare' }],
    });
    const mapped = await usecases.addGroupCapability(admin, {
      groupExternalId: 'S-1-5-21-last',
      capability: 'admin.connectors',
    });
    expect(mapped.groupCapabilities.map(r => [r.groupLabel, r.capability])).toEqual([
      ['Östra lärare', 'admin.connectors'],
      ['Östra lärare', 'admin.users'],
    ]);
  });
  test('a word pasted decomposed is the same letters as one typed composed, in the list and in the group picker (L12)', async () => {
    const { usecases, admin } = stack();
    // As text copied from a file name or a PDF may arrive: an a and a ring above, an a and two dots.
    expect((await usecases.people(admin, { text: 'AVSTÄNGD'.normalize('NFD') })).rows.map(u => u.id)).toEqual(['zara']);
    expect(await usecases.searchGroups(admin, 'bergsåkers'.normalize('NFD'))).toEqual({
      groups: [{ id: 'unit:unit-skola', label: 'Bergsåkers skola' }],
    });
  });
  test("a row whose group is gone is removed after another organisation has taken the group's external id, and that group is never mapped from here (K4)", async () => {
    const { usecases, admin, store } = stack(),
      s = store.state;
    s.groupCapabilities.push({ organisationId: 'poc', groupExternalId: 'S-1-5-21-moved', capability: 'admin.users' });
    // Timrå's group now holds the id, with a person of Timrå's in it whose grant is not what a derivation would give.
    s.groups.set('g-timra', {
      ...s.groups.get('g-ad')!,
      id: 'g-timra',
      organisationId: 'timra',
      externalId: 'S-1-5-21-moved',
      label: 'Timrås grupp',
    });
    s.users.set('ulla', { ...s.users.get('mikael')!, id: 'ulla', organisationId: 'timra', name: 'Ulla Timrå' });
    s.members.add(memberKey('g-timra', 'ulla'));
    s.grants.set('ulla', { unitId: 'unit-t', unitLabel: 'Timrå', role: 'employee', capabilities: [] });
    // Timrå's group does not name the row, and is not offered.
    expect((await usecases.overview(admin)).groupCapabilities).toEqual([
      { groupExternalId: 'S-1-5-21-moved', groupLabel: null, capability: 'admin.users' },
    ]);
    expect(await usecases.searchGroups(admin, 'moved')).toEqual({ groups: [] });
    await expect(
      usecases.addGroupCapability(admin, { groupExternalId: 'S-1-5-21-moved', capability: 'admin.connectors' }),
    ).rejects.toThrow('Gruppen finns inte bland de provisionerade grupperna.');
    expect(s.audit).toEqual([]);
    const removed = await usecases.removeGroupCapability(admin, {
      groupExternalId: 'S-1-5-21-moved',
      capability: 'admin.users',
    });
    expect(removed.groupCapabilities).toEqual([]);
    // Audited without a name, as a row whose group is gone, and nobody of Timrå's is derived from here.
    expect(s.audit).toEqual([
      {
        actor: 'person:mikael',
        action: 'group-capability.removed',
        subject: 'group:S-1-5-21-moved',
        details: { capability: 'admin.users', groupLabel: null },
      },
    ]);
    expect(s.grants.get('ulla')).toEqual({ unitId: 'unit-t', unitLabel: 'Timrå', role: 'employee', capabilities: [] });
  });
  test('a group re-keyed or removed while a mapping to it waits for its row is no group to map, and nothing is written (K4)', async () => {
    for (const meanwhile of ['re-keyed', 'removed'] as const) {
      const { store, waiting, admin } = stack(),
        s = store.state;
      const changing = waiting(() => {
        if (meanwhile === 're-keyed') s.groups.get('g-ad')!.externalId = 'S-1-5-21-it-staff-v2';
        else {
          s.groups.delete('g-ad');
          s.members.delete(memberKey('g-ad', 'mikael'));
        }
      });
      // In the order the writes committed, the group no longer holds the key when the mapping is added: refused, as
      // an addition after that write is, with no row left to give whatever group takes the key later.
      await expect(
        changing.addGroupCapability(admin, { groupExternalId: 'S-1-5-21-it-staff', capability: 'admin.connectors' }),
      ).rejects.toThrow('Gruppen finns inte bland de provisionerade grupperna.');
      expect(s.groupCapabilities).toEqual([]);
      expect(s.audit).toEqual([]);
      expect(s.grants.get('mikael')?.capabilities).toEqual([]);
    }
  });
  test('a change is audited with the name its group has once the change holds the row, and a row whose group was re-keyed meanwhile goes as one whose group is gone (K4)', async () => {
    const { store, waiting, admin } = stack(),
      s = store.state,
      row = { groupExternalId: 'S-1-5-21-it-staff', capability: 'admin.connectors' as const };
    // Renamed while the addition waited: the row is named, and audited, by the name the group has now.
    const added = await waiting(() => (s.groups.get('g-ad')!.label = 'IT-avdelningen')).addGroupCapability(admin, row);
    expect(added.groupCapabilities).toEqual([{ ...row, groupLabel: 'IT-avdelningen' }]);
    expect(s.audit[0]).toEqual({
      actor: 'person:mikael',
      action: 'group-capability.added',
      subject: 'group:S-1-5-21-it-staff',
      details: { capability: 'admin.connectors', groupLabel: 'IT-avdelningen' },
    });
    expect(s.grants.get('mikael')?.capabilities).toEqual(['admin.connectors']);
    // Re-keyed while the removal waited: the row is removed and audited without a name, and nobody is derived from
    // here, since the write that took the key away derived the group's members itself.
    const removed = await waiting(
      () => (s.groups.get('g-ad')!.externalId = 'S-1-5-21-it-staff-v2'),
    ).removeGroupCapability(admin, row);
    expect(removed.groupCapabilities).toEqual([]);
    expect(s.audit.slice(2)).toEqual([
      {
        actor: 'person:mikael',
        action: 'group-capability.removed',
        subject: 'group:S-1-5-21-it-staff',
        details: { capability: 'admin.connectors', groupLabel: null },
      },
    ]);
  });
  test('a NUL names no unit and no group and is in no name: the answer is nobody and nothing, and the store is never handed it (K3)', async () => {
    const { usecases, admin, store } = stack();
    const nobody = { rows: [], total: 0, all: 3, page: 1, pageSize: 25 };
    expect(await usecases.people(admin, { unitId: 'unit-it\u0000' })).toEqual(nobody);
    expect(await usecases.people(admin, { text: 'mikael\u0000' })).toEqual(nobody);
    expect(await usecases.people(admin, { text: 'mikael \u0000', page: 3, role: 'employee' })).toEqual(nobody);
    expect(await usecases.searchGroups(admin, 'it\u0000')).toEqual({ groups: [] });
    await expect(
      usecases.addGroupCapability(admin, { groupExternalId: 'S-1-5-21-it-staff\u0000', capability: 'admin.users' }),
    ).rejects.toThrow('Gruppen finns inte bland de provisionerade grupperna.');
    expect(
      (
        await usecases.removeGroupCapability(admin, {
          groupExternalId: 'S-1-5-21-it-staff\u0000',
          capability: 'admin.users',
        })
      ).groupCapabilities,
    ).toEqual([]);
    expect(store.state.audit).toEqual([]);
  });
  test('a group that is not provisioned cannot be mapped, but a stale mapping can be removed; an unknown capability is refused', async () => {
    const { usecases, admin, store } = stack();
    await expect(
      usecases.addGroupCapability(admin, { groupExternalId: 'S-1-5-21-gone', capability: 'admin.users' }),
    ).rejects.toThrow('Gruppen finns inte');
    store.state.groupCapabilities.push({
      organisationId: 'poc',
      groupExternalId: 'S-1-5-21-gone',
      capability: 'admin.users',
    });
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
