import { describe, expect, test } from 'bun:test';
import { memoryProvisionStore } from '../../apps/server/src/modules/people/adapters/memory';
import { scimUsecases } from '../../apps/server/src/modules/people/usecases';
import { scimRoutes } from '../../apps/server/src/routes/scim';
import { checkProvisioning } from '../../scripts/provisioner/check';
import { scimClient, type ScimClient } from '../../scripts/provisioner/client';
import {
  developmentDirectory,
  fullName,
  type Directory,
  type DirectoryPerson,
} from '../../scripts/provisioner/directory';
import { plan, push } from '../../scripts/provisioner/push';

/**
 * The synthetic provisioner against the SCIM routes (D68 item 7): the development directory becomes users, units,
 * roles and capabilities through the standard alone, and a second push changes nothing.
 */
function stack() {
  const store = memoryProvisionStore();
  let seq = 0;
  const scim = scimUsecases({
    store,
    clock: () => new Date('2026-11-09T06:00:00.000Z'),
    ids: () => 'id-' + ++seq,
    digest: token => 'digest:' + token,
  });
  store.state.provisioners.set('digest:dev-token', { id: 'dev', organisationId: 'poc', label: 'Development' });
  const app = scimRoutes(scim, console.error);
  const client = scimClient('http://clew.local', 'dev-token', (input, init) => app.request(input, init));
  const grantOf = (userName: string) => {
    const user = [...store.state.users.values()].find(u => u.userName === userName);
    return user && store.state.grants.get(user.id);
  };
  return { store, client, grantOf, app };
}
/** Clew's id for the person the directory knows by `externalId`. */
const ekonomiId = (store: ReturnType<typeof stack>['store'], externalId: string) =>
  [...store.state.users.values()].find(u => u.externalId === externalId)!.id;
describe('the synthetic provisioner', () => {
  test('plans D68 groups from units, manager flags, plain groups and capabilities, two hundred and fifty people in forty-eight units', () => {
    const p = plan(developmentDirectory),
      by = (externalId: string) => p.groups.find(g => g.externalId === externalId)!,
      keyed = (key: string) => p.groups.filter(g => g.externalId.startsWith(key));
    expect(p.users).toHaveLength(250);
    expect(p.users.slice(0, 3).map(u => u.body.userName)).toEqual(['hillevi', 'hassan', 'mikael']);
    expect(new Set(p.users.map(u => u.body.userName)).size).toBe(250);
    expect(keyed('unit:')).toHaveLength(48);
    // Two units have no manager group: the department nobody leads, and the fritidshem that is led from the school above it.
    expect(keyed('unit-manager:')).toHaveLength(46);
    expect(keyed('capability:').map(g => g.externalId)).toEqual([
      'capability:admin.appearance',
      'capability:admin.connectors',
      'capability:admin.users',
    ]);
    // Plain groups of every size: everyone in an administration, a handful in a team, and one nobody is in yet.
    expect(Object.fromEntries(keyed('ad:').map(g => [g.externalId, g.members.length]))).toEqual({
      'ad:alla-chefer': 46,
      'ad:elevhalsa': 6,
      'ad:fackliga-fortroendevalda': 10,
      'ad:forvaltning-kultur': 17,
      'ad:forvaltning-ledning': 27,
      'ad:forvaltning-omsorg': 84,
      'ad:forvaltning-stadsbyggnad': 34,
      'ad:forvaltning-utbildning': 87,
      'ad:intranat-redaktorer': 13,
      'ad:krisledning': 5,
      'ad:nattpersonal': 12,
      'ad:projekt-e-arkiv': 0,
      'ad:rektorer': 7,
      'ad:skyddsombud': 22,
      'ad:systemforvaltare': 9,
    });
    expect(by('unit:unit-skola')).toMatchObject({ displayName: 'Bergsåkers skola' });
    expect(by('unit:unit-skola').members).toHaveLength(12);
    expect(by('unit:unit-skola').members[0]).toBe('dev:hillevi');
    expect(by('unit-manager:unit-skola').members).toEqual(['dev:hillevi']);
    // Hillevi's school starts with the calendar fixture's people with their calendar addresses (D96 item 3); the rest
    // of the school is generated, as every other unit is.
    const users = (externalIds: readonly string[]) =>
      externalIds.map(id => developmentDirectory.people.find(u => u.externalId === id)!);
    expect(users(by('unit:unit-skola').members.slice(1, 6)).map(u => [u.userName, fullName(u), u.email])).toEqual([
      ['anna', 'Anna Lindqvist', 'anna@clew.test'],
      ['erik', 'Erik Sandström', 'erik@clew.test'],
      ['maria', 'Maria Källström', 'maria@clew.test'],
      ['johan', 'Johan Byström', 'johan@clew.test'],
      ['karin', 'Karin Lindqvist', 'karin@clew.test'],
    ]);
    for (const u of users(by('unit:unit-skola').members.slice(6))) expect(u.userName).toContain('.');
    // A manager of two units, a unit with two managers, a person who works in two, and each member listed once.
    expect(by('unit-manager:unit-hr').members).toEqual(by('unit-manager:unit-ekonomi').members);
    expect(by('unit-manager:unit-gymnasium').members).toHaveLength(2);
    expect(by('unit:unit-kommunikation').members).toHaveLength(5);
    expect(by('capability:admin.users').members).toHaveLength(2);
    expect(by('capability:admin.users').members[0]).toBe('dev:mikael');
    // The names a real directory holds are pushed as they are, and two people may share one.
    const names = p.users.map(u => u.body.displayName);
    expect(names).toContain("Zoë O'Connor");
    expect(names).toContain('Åsa Öberg-Ångström');
    expect(names.filter(name => name === 'Anna Lindqvist')).toHaveLength(2);
    for (const g of p.groups) expect(new Set(g.members).size).toBe(g.members.length);
    expect(() => plan({ ...developmentDirectory, units: [] })).toThrow("department 'unit-skola'");
  });
  test("the units are a tree: every unit names the one above it, the units are planned from the root down, and a broken tree is the source's mistake (D99)", () => {
    const p = plan(developmentDirectory),
      units = p.groups.filter(g => g.externalId.startsWith('unit:')),
      by = (unitId: string) => units.find(g => g.externalId === 'unit:' + unitId)!;
    // The units come first, and no unit before the one above it.
    expect(p.groups.slice(0, units.length)).toEqual(units);
    const planned = new Set<string>();
    for (const g of units) {
      if (g.parent) expect(planned.has(g.parent)).toBe(true);
      planned.add(g.externalId);
    }
    expect(units.filter(g => !g.parent).map(g => g.externalId)).toEqual(['unit:unit-kommun']);
    // Six levels at the deepest: the municipality, an administration, a department, an area, a unit and a group under
    // it. Each has a manager of its own, so the line runs through five managers above the group's.
    const path = (unitId: string): string[] => {
      const parent = by(unitId).parent?.slice('unit:'.length);
      return [...(parent ? path(parent) : []), by(unitId).displayName];
    };
    expect(path('unit-skola-fritids')).toEqual([
      'Kommunen',
      'Barn och utbildning',
      'Grundskola',
      'Bergsåkers skola',
      'Bergsåkers fritidshem',
    ]);
    expect(path('unit-aldreboende-natt')).toEqual([
      'Kommunen',
      'Vård och omsorg',
      'Särskilt boende',
      'Äldreboenden norr',
      'Lindgårdens äldreboende',
      'Lindgården natt',
    ]);
    for (const unitId of path('unit-aldreboende-natt').map(label => units.find(g => g.displayName === label)!))
      expect(
        p.groups.find(g => g.externalId === unitId.externalId.replace('unit:', 'unit-manager:'))?.members,
      ).toHaveLength(1);
    // A department stands between an administration and its units, and its head is nobody's manager but theirs.
    expect(path('unit-gymnasium')).toEqual([
      'Kommunen',
      'Barn och utbildning',
      'Gymnasie- och vuxenutbildning',
      'Selångers gymnasium',
    ]);
    expect(by('unit-gymnasie').members).toEqual(
      p.groups.find(g => g.externalId === 'unit-manager:unit-gymnasie')!.members,
    );
    // The depth differs between branches: this administration has its units directly under it.
    expect(path('unit-it')).toEqual(['Kommunen', 'Kommunstyrelsekontoret', 'IT och digitalisering']);
    // An area nobody is placed on and nobody leads is still a node; a unit led from the one above has no manager group.
    expect(by('unit-hemtjanst')).toEqual({
      externalId: 'unit:unit-hemtjanst',
      displayName: 'Hemtjänst',
      parent: 'unit:unit-forvaltning-omsorg',
      members: [],
    });
    expect(by('unit-fritidshem').parent).toBe('unit:unit-skola-nacksta');
    expect(p.groups.some(g => g.externalId === 'unit-manager:unit-fritidshem')).toBe(false);
    expect(p.groups.some(g => g.externalId === 'unit-manager:unit-hemtjanst')).toBe(false);
    // The flat way is still pushed for one unit: its manager is in both units' manager groups.
    expect(p.groups.find(g => g.externalId === 'unit-manager:unit-hr')!.members).toEqual(
      p.groups.find(g => g.externalId === 'unit-manager:unit-ekonomi')!.members,
    );
    const unit = (id: string, parent?: string) => ({ id, label: id, ...(parent ? { parent } : {}) });
    expect(() => plan({ units: [unit('a', 'missing')], groups: [], people: [] })).toThrow(
      "The unit 'a' has parent 'missing', which the directory does not list.",
    );
    expect(() => plan({ units: [unit('a', 'b'), unit('b', 'a')], groups: [], people: [] })).toThrow(
      "The units a → b → a are each other's parents.",
    );
  });
  test('a first push creates everything, grants follow, and a second push is silent', async () => {
    const { store, client, grantOf } = stack();
    const first = await push(client, developmentDirectory);
    expect(first).toEqual({
      created: 250,
      replaced: 0,
      deactivated: 0,
      groupsCreated: 112,
      groupsReplaced: 0,
      groupsRemoved: 0,
    });
    expect(grantOf('hillevi')).toEqual({
      unitId: 'unit-skola',
      unitLabel: 'Bergsåkers skola',
      role: 'manager',
      capabilities: [],
    });
    expect(grantOf('hassan')).toMatchObject({ unitId: 'unit-omsorg', role: 'employee' });
    expect(grantOf('mikael')).toMatchObject({
      unitId: 'unit-it',
      role: 'employee',
      capabilities: ['admin.appearance', 'admin.connectors', 'admin.users'],
    });
    // The manager of two units acts as the lowest unit id; the person in two units as the lowest too.
    const ekonomi = plan(developmentDirectory).groups.find(g => g.externalId === 'unit-manager:unit-ekonomi')!,
      twoUnits = developmentDirectory.people.find(p => p.department === 'unit-bibliotek' && p.alsoIn?.length)!;
    expect(grantOf(ekonomi.members[0]!.slice('dev:'.length))).toMatchObject({
      unitId: 'unit-ekonomi',
      unitLabel: 'Ekonomiavdelningen',
      role: 'manager',
    });
    expect(store.state.assignments.get(ekonomiId(store, ekonomi.members[0]!))).toHaveLength(2);
    expect(grantOf(twoUnits.userName)).toMatchObject({ unitId: 'unit-bibliotek', role: 'employee' });
    // A unit row is for a unit somebody is assigned to: every node but the department nobody is placed on.
    expect(store.state.units.size).toBe(47);
    expect([...store.state.groups.values()].find(g => g.externalId === 'unit:unit-skola')?.parentUnitId).toBe(
      'unit-grundskola',
    );
    expect(store.state.units.get('unit-hr')).toEqual({ organisationId: 'poc', label: 'HR-avdelningen' });
    const audited = store.state.audit.length;
    const second = await push(client, developmentDirectory);
    expect(second).toEqual({
      created: 0,
      replaced: 250,
      deactivated: 0,
      groupsCreated: 0,
      groupsReplaced: 112,
      groupsRemoved: 0,
    });
    expect(store.state.audit.length).toBe(audited);
  });
  test('a changed directory moves roles, takes capabilities back, deactivates a leaver and removes an empty key group', async () => {
    const { store, client, grantOf } = stack();
    await push(client, developmentDirectory);
    const changed: Directory = {
      ...developmentDirectory,
      people: developmentDirectory.people
        .filter(p => p.userName !== 'hassan')
        .map(p => (p.userName === 'hillevi' ? { ...p, manager: false } : { ...p, capabilities: ['admin.connectors'] })),
    };
    const summary = await push(client, changed);
    // The users key group and the appearance key group lose their only holder; Hillevi's manager group its only manager.
    expect(summary).toMatchObject({ created: 0, replaced: 249, deactivated: 1, groupsRemoved: 3 });
    expect(grantOf('hillevi')?.role).toBe('employee');
    expect(grantOf('mikael')?.capabilities).toEqual(['admin.connectors']);
    const hassan = [...store.state.users.values()].find(u => u.userName === 'hassan')!;
    expect(hassan.enabled).toBe(false);
    // The leaver is deactivated, never erased (D68 item 1); his unit group no longer lists him, so his grant is gone.
    expect(grantOf('hassan')).toBeUndefined();
    // The two groups that emptied are gone (hillevi was her school's only manager, and nobody holds admin.users any more); the
    // unit hassan left still has its other members.
    const remaining = [...store.state.groups.values()].map(g => g.externalId);
    expect(remaining).not.toContain('unit-manager:unit-skola');
    expect(remaining).not.toContain('capability:admin.users');
    expect(remaining).toContain('unit:unit-omsorg');
    expect(remaining).toHaveLength(109);
  });
  test('a unit that moves in the directory moves in Clew, and units that leave it are removed from the leaves up (D99)', async () => {
    const { store, client } = stack();
    const parentOf = (unitId: string) =>
      [...store.state.groups.values()].find(g => g.externalId === 'unit:' + unitId)?.parentUnitId;
    await push(client, developmentDirectory);
    expect(parentOf('unit-omsorg')).toBe('unit-hemtjanst');
    // The area between the administration and its two units is dissolved, and a fritidshem moves to another school.
    const reorganised: Directory = {
      ...developmentDirectory,
      units: developmentDirectory.units
        .filter(u => u.id !== 'unit-hemtjanst')
        .map(u =>
          u.parent === 'unit-hemtjanst'
            ? { ...u, parent: 'unit-forvaltning-omsorg' }
            : u.id === 'unit-skola-fritids'
              ? { ...u, parent: 'unit-skola-haga' }
              : u,
        ),
    };
    const audited = store.state.audit.length;
    expect(await push(client, reorganised)).toMatchObject({ groupsCreated: 0, groupsRemoved: 1 });
    expect(parentOf('unit-omsorg')).toBe('unit-forvaltning-omsorg');
    expect(parentOf('unit-omsorg-norr')).toBe('unit-forvaltning-omsorg');
    expect(parentOf('unit-skola-fritids')).toBe('unit-skola-haga');
    expect(parentOf('unit-hemtjanst')).toBeUndefined();
    // Three moves and a removal, and nobody's grant follows from any of them.
    expect(store.state.audit.slice(audited).map(a => [a.action, a.details.externalId, a.details.parent])).toEqual([
      ['scim.group.patched', 'unit:unit-omsorg', { before: 'unit-hemtjanst', after: 'unit-forvaltning-omsorg' }],
      ['scim.group.patched', 'unit:unit-omsorg-norr', { before: 'unit-hemtjanst', after: 'unit-forvaltning-omsorg' }],
      ['scim.group.patched', 'unit:unit-skola-fritids', { before: 'unit-skola', after: 'unit-skola-haga' }],
      ['scim.group.removed', 'unit:unit-hemtjanst', undefined],
    ]);
    // A whole branch that leaves the directory goes child first, whatever order the server lists it in.
    const branch = stack(),
      unit = (id: string, parent?: string) => ({ id, label: id, ...(parent ? { parent } : {}) });
    await push(branch.client, {
      units: [unit('a'), unit('b', 'a'), unit('c', 'b'), unit('d', 'c')],
      groups: [],
      people: [],
    });
    expect(branch.store.state.groups.size).toBe(4);
    expect(await push(branch.client, { units: [unit('a')], groups: [], people: [] })).toMatchObject({
      groupsRemoved: 3,
    });
    expect([...branch.store.state.groups.values()].map(g => g.externalId)).toEqual(['unit:a']);
  });
  test('a reorganisation is one push: a unit with units below it under a new id, two units that change places, and a level that is taken away (D99)', async () => {
    const { client, store } = stack(),
      unit = (id: string, parent?: string) => ({ id, label: id, ...(parent ? { parent } : {}) }),
      reorganise = (units: Directory['units']) => push(client, { units, groups: [], people: [] }),
      tree = () =>
        Object.fromEntries(
          [...store.state.groups.values()].map(g => [g.externalId!.slice('unit:'.length), g.parentUnitId]),
        );
    await reorganise([unit('kommun'), unit('skola', 'kommun'), unit('fritids', 'skola'), unit('kok', 'fritids')]);
    // The source gives the school a new id: the new unit is created, the unit below moves to it, and the old one goes.
    await reorganise([unit('kommun'), unit('skola-2', 'kommun'), unit('fritids', 'skola-2'), unit('kok', 'fritids')]);
    expect(tree()).toEqual({ kommun: null, 'skola-2': 'kommun', fritids: 'skola-2', kok: 'fritids' });
    // Two units change places, which neither move could do alone without the other being written first.
    await reorganise([unit('kommun'), unit('skola-2', 'kommun'), unit('kok', 'skola-2'), unit('fritids', 'kok')]);
    expect(tree()).toEqual({ kommun: null, 'skola-2': 'kommun', kok: 'skola-2', fritids: 'kok' });
    // A level is taken away: what stood under it moves up, and it goes last.
    await reorganise([unit('kommun'), unit('kok', 'kommun'), unit('fritids', 'kok')]);
    expect(tree()).toEqual({ kommun: null, kok: 'kommun', fritids: 'kok' });
  });
  test('a person who moves between two units is never on neither, so the grant is not taken away on the way (D101)', async () => {
    const { store, client, grantOf } = stack();
    await push(client, developmentDirectory);
    // From a unit that is written before the one he moves to: with a group's removals sent along with its additions
    // he would have had no unit, and so no grant, from the one write to the other.
    const moved: Directory = {
      ...developmentDirectory,
      people: developmentDirectory.people.map(p =>
        p.userName === 'hassan' ? { ...p, department: 'unit-aldreboende-natt' } : p,
      ),
    };
    const audited = store.state.audit.length;
    await push(client, moved);
    expect(grantOf('hassan')).toMatchObject({ unitId: 'unit-aldreboende-natt', role: 'employee' });
    const hassan = [...store.state.users.values()].find(u => u.userName === 'hassan')!.id,
      derived = store.state.audit
        .slice(audited)
        .filter(a => a.subject === 'person:' + hassan && a.action === 'grant.derived');
    expect(derived.map(a => a.details)).toEqual([
      { unitId: 'unit-aldreboende-natt', role: 'employee', capabilities: [], assignments: 2 },
    ]);
    expect(store.state.assignments.get(hassan)).toEqual([{ unitId: 'unit-aldreboende-natt', role: 'employee' }]);
    // The groups are patched, the one he joins before the one he leaves.
    expect(
      store.state.audit
        .slice(audited)
        .filter(a => a.action.startsWith('scim.group'))
        .map(a => [a.action, a.details.externalId, a.details.added, a.details.removed]),
    ).toEqual([
      ['scim.group.patched', 'unit:unit-aldreboende-natt', 1, 0],
      ['scim.group.patched', 'unit:unit-omsorg', 0, 1],
    ]);
  });
  test('a push from an empty or truncated source is refused before anything is written, unless a person has decided it (D101)', async () => {
    const { store, client } = stack();
    await push(client, developmentDirectory);
    const audited = store.state.audit.length;
    await expect(push(client, { units: [], groups: [], people: [] })).rejects.toThrow(
      'The source lists 0 people and Clew holds 250 active ones from it, so this push would deactivate 250. Nothing was written.',
    );
    // Truncated: more than a fifth of the people are missing from the export.
    const truncated: Directory = { ...developmentDirectory, people: developmentDirectory.people.slice(0, 190) };
    await expect(push(client, truncated)).rejects.toThrow('would deactivate 60. Nothing was written.');
    expect(store.state.audit.length).toBe(audited);
    expect([...store.state.users.values()].every(u => u.enabled)).toBe(true);
    expect(store.state.grants.size).toBe(250);
    // A person may decide that the source is right.
    expect(await push(client, truncated, 'dev:', () => {}, { force: true })).toMatchObject({ deactivated: 60 });
    expect([...store.state.users.values()].filter(u => !u.enabled)).toHaveLength(60);
  });
  test('a group with a foreign key is left alone, and a refused push surfaces the SCIM detail', async () => {
    const { store, client } = stack();
    store.state.groups.set('foreign', {
      id: 'foreign',
      organisationId: 'poc',
      parentUnitId: null,
      externalId: 'S-1-5-21-ad',
      label: 'AD',
      createdAt: 'x',
      updatedAt: 'x',
    });
    await push(client, developmentDirectory);
    expect(store.state.groups.has('foreign')).toBe(true);
    const broken: Directory = {
      ...developmentDirectory,
      people: developmentDirectory.people.map((p, i) => (i === 0 ? { ...p, email: '' } : p)),
    };
    await expect(push(client, broken)).rejects.toMatchObject({ status: 400, scimType: 'invalidSyntax' });
  });
  test('the check reads what the installation holds: counts when the push did what it meant, and names who is left without a unit', async () => {
    const { client, app, store } = stack();
    const anonymous = (input: string, init?: RequestInit) => app.request(input, init);
    await push(client, developmentDirectory);
    const clean = await checkProvisioning('http://clew.local', client, anonymous);
    expect(clean.filter(f => f.level !== 'ok')).toEqual([]);
    expect(clean.map(f => f.text)).toEqual([
      'Without a token the endpoint answers 401 with the SCIM error resource.',
      'The token is accepted. PATCH yes, filter yes (at most 200 rows a page), bulk no, sort no, ETags no.',
      // More than the two hundred a page carries, so the check reads a full page of users and one more.
      '250 users: 250 active, 0 deactivated.',
      expect.stringMatching(
        /^\d+ groups: 48 unit, \d+ unit-manager, \d+ capability, \d+ plain \(0 without an externalId\)\.$/,
      ),
      'Every active user is in a unit.',
      // The area nobody is placed on has units below it, so it is a heading and not an emptied unit (D99).
      'The units form a tree: 1 root, 6 levels deep.',
    ]);
    expect(
      (await checkProvisioning('http://clew.local', client, anonymous, { roots: 1 })).filter(f => f.level !== 'ok'),
    ).toEqual([]);
    // A person the mapping forgot, a managed unit nobody named, an emptied unit and a key stored before D96.
    await client.request('POST', '/Users', {
      externalId: 'dev:lost',
      userName: 'lost',
      displayName: 'Lost Person',
      emails: [{ value: 'lost@clew.test', type: 'work' }],
    });
    const hillevi = [...store.state.users.values()].find(u => u.userName === 'hillevi')!.id;
    await client.request('POST', '/Groups', {
      externalId: 'unit-manager:unit-nameless',
      displayName: 'Chefer',
      members: [{ value: hillevi }],
    });
    await client.request('POST', '/Groups', { externalId: 'unit:unit-empty', displayName: 'Tom enhet' });
    // People on a unit with no manager on it or above it: they report to nobody (D99).
    const adrift = await client.request('POST', '/Users', {
      externalId: 'dev:adrift',
      userName: 'adrift',
      displayName: 'Adrift Person',
      emails: [{ value: 'adrift@clew.test', type: 'work' }],
    });
    await client.request('POST', '/Groups', { externalId: 'unit:unit-adrift', displayName: 'Utan chef' });
    await client.request('POST', '/Groups', {
      externalId: 'unit:unit-adrift-below',
      displayName: 'Under den',
      members: [{ value: adrift.body.id }],
      'urn:clew:params:scim:schemas:extension:unit:2.0:Group': { parent: 'unit:unit-adrift' },
    });
    store.state.groups.set('legacy', {
      id: 'legacy',
      organisationId: 'poc',
      parentUnitId: null,
      externalId: 'Unit:old',
      label: 'Stored before D96',
      createdAt: '2026-11-09T06:00:00.000Z',
      updatedAt: '2026-11-09T06:00:00.000Z',
    });
    // It only reads: nothing it does is a change, so the audit is as long afterwards as before.
    const audited = store.state.audit.length;
    const warned = await checkProvisioning('http://clew.local', client, anonymous);
    expect(store.state.audit.length).toBe(audited);
    expect(warned.filter(f => f.level === 'fail')).toEqual([]);
    expect(warned.filter(f => f.level === 'warn').map(f => f.text)).toEqual([
      '1 active user has no unit: or unit-manager: group and can do nothing in Clew: lost.',
      '1 unit has a unit-manager: group and no unit: group, so the unit is shown by its id instead of a name: unit-nameless.',
      '1 unit or unit-manager group has no members: unit:unit-empty.',
      '1 unit has people and no manager, on the unit or on any unit above it, so its people report to nobody: unit:unit-adrift-below.',
      "1 group carries a key that is written wrong and gives nobody anything: 'Unit:old'.",
    ]);
    // More roots than the source has: a unit written without its parent became one (D99).
    expect(
      (await checkProvisioning('http://clew.local', client, anonymous, { roots: 1 }))
        .filter(f => f.level === 'warn')
        .map(f => f.text),
    ).toContain(
      'The tree has 3 roots where 1 was expected; a unit written without its parent becomes a root: unit:unit-kommun, unit:unit-empty, unit:unit-adrift.',
    );
    // A manager who is deactivated leads nobody, as Administration › Organisation reads the same tree.
    const person = (userName: string) =>
      client.request('POST', '/Users', {
        externalId: 'dev:' + userName,
        userName,
        displayName: userName,
        emails: [{ value: userName + '@clew.test', type: 'work' }],
      });
    const former = await person('former'),
      stranded = await person('stranded');
    await client.request('DELETE', '/Users/' + former.body.id);
    await client.request('POST', '/Groups', {
      externalId: 'unit:unit-vacant',
      displayName: 'Vakant',
      members: [{ value: stranded.body.id }],
    });
    await client.request('POST', '/Groups', {
      externalId: 'unit-manager:unit-vacant',
      displayName: 'Chefer',
      members: [{ value: former.body.id }],
    });
    const vacant = await checkProvisioning('http://clew.local', client, anonymous);
    expect(vacant.find(f => f.text.includes('report to nobody'))?.text).toContain('unit:unit-vacant');
  });
  test('the check fails on a refused token and on an address that is not a SCIM server, and reads nothing further', async () => {
    const { app } = stack();
    const anonymous = (input: string, init?: RequestInit) => app.request(input, init);
    const refused = await checkProvisioning(
      'http://clew.local',
      scimClient('http://clew.local', 'wrong', anonymous),
      anonymous,
    );
    expect(refused).toEqual([
      { level: 'ok', text: 'Without a token the endpoint answers 401 with the SCIM error resource.' },
      {
        level: 'fail',
        text: 'The token was refused: it is mistyped, revoked, or rotated out and past its grace period.',
      },
    ]);
    const elsewhere = async () =>
      new Response('<html></html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
    const wrong = await checkProvisioning(
      'http://clew.local',
      scimClient('http://clew.local', 'x', anonymous),
      elsewhere,
    );
    expect(wrong[0]).toMatchObject({ level: 'fail', text: expect.stringContaining('answered 200 (text/html)') });
  });
});

/**
 * A run that dies on the way (D101). The next run has to end where one whole run would have, whichever request was
 * the last: the organisation is small here so that every request of a run can be the one that is lost, once before it
 * reaches the server and once after the server did what it asked.
 */
describe('a run that is interrupted', () => {
  const unit = (id: string, label: string, parent?: string) => ({ id, label, ...(parent ? { parent } : {}) });
  const person = (name: string, department: string, extra: Partial<DirectoryPerson> = {}): DirectoryPerson => ({
    externalId: 'dev:' + name,
    userName: name,
    givenName: name,
    familyName: 'Test',
    email: name + '@clew.test',
    department,
    manager: false,
    capabilities: [],
    ...extra,
  });
  const before: Directory = {
    units: [
      unit('kommun', 'Kommunen'),
      unit('skola', 'Skolan', 'kommun'),
      unit('fritids', 'Fritids', 'skola'),
      unit('omsorg', 'Omsorgen', 'kommun'),
      unit('natt', 'Natt', 'omsorg'),
    ],
    groups: [{ id: 'ad:alla', label: 'Alla' }],
    people: [
      person('dir', 'kommun', { manager: true, capabilities: ['admin.users'] }),
      person('rektor', 'skola', { manager: true }),
      person('anna', 'skola', { groups: ['ad:alla'] }),
      person('bo', 'fritids'),
      person('chef', 'omsorg', { manager: true }),
      person('dag', 'natt'),
      person('eva', 'natt', { alsoIn: ['omsorg'] }),
    ],
  };
  // A day with every kind of change: a unit removed, one moved, one renamed and one new; a leaver and a newcomer; a
  // person who moves each way between two units; a manager who is one no longer and one who gains a unit; a
  // capability taken back; a plain group renamed.
  const after: Directory = {
    units: [
      unit('kommun', 'Kommunen'),
      unit('skola', 'Skolan', 'kommun'),
      unit('omsorg', 'Vård och omsorg', 'kommun'),
      unit('natt', 'Natt', 'kommun'),
      unit('kost', 'Kost', 'skola'),
    ],
    groups: [{ id: 'ad:alla', label: 'Alla anställda' }],
    people: [
      person('dir', 'kommun', { manager: true }),
      person('rektor', 'skola', { manager: true, alsoManages: ['kost'] }),
      person('anna', 'omsorg', { groups: ['ad:alla'] }),
      person('bo', 'skola'),
      person('chef', 'skola'),
      person('eva', 'natt'),
      person('fia', 'kost'),
    ],
  };
  /** What Clew holds, by the source's ids: Clew's own ids differ from one stack to the next. */
  const held = (store: ReturnType<typeof stack>['store']) => {
    const s = store.state,
      source = (id: string) => s.users.get(id)!.externalId!,
      rows = <T>(list: T[]) => list.map(row => JSON.stringify(row)).sort();
    return {
      users: rows([...s.users.values()].map(u => [u.externalId, u.userName, u.name, u.email, u.enabled])),
      groups: rows(
        [...s.groups.values()].map(g => [
          g.externalId,
          g.label,
          g.parentUnitId,
          [...s.members]
            .map(key => key.split('\u0000'))
            .filter(([group]) => group === g.id)
            .map(([, member]) => source(member!))
            .sort(),
        ]),
      ),
      assignments: rows([...s.assignments].filter(([, list]) => list.length).map(([id, list]) => [source(id), list])),
      grants: rows([...s.grants].map(([id, grant]) => [source(id), grant])),
      units: rows([...s.units]),
    };
  };
  /** The client with its `at`th request lost: before it is sent, or after the server answered it. */
  const cut = (client: ScimClient, at: number, lost: 'request' | 'response'): ScimClient => {
    let sent = 0;
    return {
      request: async (...args) => {
        if (++sent !== at) return client.request(...args);
        if (lost === 'response') await client.request(...args);
        throw new Error('connection lost');
      },
    };
  };
  for (const [name, from, to] of [
    ['a first run', undefined, before],
    ['a run with a day of changes', before, after],
  ] as const)
    test(`${name}, lost at any request, is finished by the next run exactly as one whole run would have`, async () => {
      const begin = async () => {
        const s = stack();
        if (from) await push(s.client, from);
        return s;
      };
      const whole = await begin();
      let requests = 0;
      await push({ request: (...args) => (requests++, whole.client.request(...args)) }, to);
      const expected = held(whole.store);
      expect(requests).toBeGreaterThan(30);
      for (const lost of ['request', 'response'] as const)
        for (let at = 1; at <= requests; at++) {
          const s = await begin();
          await expect(push(cut(s.client, at, lost), to)).rejects.toThrow('connection lost');
          await push(s.client, to);
          expect([`the ${lost} of call ${at} lost`, held(s.store)]).toEqual([
            `the ${lost} of call ${at} lost`,
            expected,
          ]);
          // And the run after that has nothing left to do.
          const audited = s.store.state.audit.length;
          await push(s.client, to);
          expect(s.store.state.audit.length).toBe(audited);
        }
    });
});
