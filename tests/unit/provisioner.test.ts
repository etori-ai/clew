import { fileURLToPath } from 'node:url';
import { SCIM_EMPLOYMENT_SCHEMA } from '@clew/contracts';
import { describe, expect, setDefaultTimeout, test } from 'bun:test';
import { memoryProvisionStore } from '../../apps/server/src/modules/people/adapters/memory';
import { scimUsecases, staffUsecases } from '../../apps/server/src/modules/people/usecases';
import { scimRoutes } from '../../apps/server/src/routes/scim';
import { checkProvisioning } from '../../scripts/provisioner/check';
import { scimClient, ScimClientError, type ScimClient } from '../../scripts/provisioner/client';
import {
  developmentDirectory,
  developmentScope,
  fullName,
  type Directory,
  type DirectoryPerson,
} from '../../scripts/provisioner/directory';
import { plan, push as reconcile, type PushOptions } from '../../scripts/provisioner/push';

/**
 * Most tests here push the whole development directory, two hundred and fifty people in over a hundred groups, two or
 * three times through the routes. That is a second and a half on a developer's machine and four to six on CI's
 * runner, which is on both sides of the five seconds a test gets by default: the suite failed there on a slow day
 * without anything being wrong. So the tests of this file get the time a slow runner needs.
 */
setDefaultTimeout(30_000);

// This isolated organisation belongs to the test writer.
const scope = { userPrefix: 'dev:', groupPrefixes: ['unit:', 'unit-manager:', 'ad:', 'capability:'], groupKeys: [] };
const push = (client: ScimClient, directory: Directory, options?: PushOptions) =>
  reconcile(client, directory, scope, options);
/** A person of the development directory moved to another unit, employments and all: an employment names a unit that is sent (D114). */
const employedOn = (p: DirectoryPerson, unitId: string) => (p.employments ?? []).map(job => ({ ...job, unitId }));

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
  test('pushes Mikael with two titles and three phone numbers, and withdraws just one work number', async () => {
    const { store, client } = stack();
    const person = developmentDirectory.people.find(p => p.userName === 'mikael')!;
    const directory = { ...developmentDirectory, people: [person] };
    await push(client, directory);
    const id = ekonomiId(store, person.externalId);
    const work = { type: 'work', value: '010-000 00 04' };
    const secondWork = { type: 'work', value: '010-000 00 05' };
    const onCall = { type: 'Jour', value: '070-000 00 06' };
    const employments = [
      {
        unitId: 'unit-it',
        title: 'Systemförvaltare',
        employmentType: 'Tillsvidare',
        startDate: '2019-02-01',
        employmentPercentage: 60,
      },
      {
        unitId: 'unit-it',
        title: 'Projektsamordnare',
        employmentType: 'Vikariat',
        startDate: '2026-09-01',
        employmentPercentage: 40,
      },
    ];
    expect(store.state.users.get(id)).toMatchObject({ employments, phoneNumbers: [work, secondWork, onCall] });
    await push(client, { ...directory, people: [{ ...person, phoneNumbers: [secondWork, onCall] }] });
    expect(store.state.users.get(id)).toMatchObject({ employments, phoneNumbers: [secondWork, onCall] });
  });
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
      'capability:admin.competence',
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
    expect(() => plan({ complete: true, units: [unit('a', 'missing')], groups: [], people: [] })).toThrow(
      "The unit 'a' has parent 'missing', which the directory does not list.",
    );
    expect(() => plan({ complete: true, units: [unit('a', 'b'), unit('b', 'a')], groups: [], people: [] })).toThrow(
      "The units a → b → a are each other's parents.",
    );
  });
  test('a first push creates everything, grants follow, and a second push is silent', async () => {
    const { store, client, grantOf } = stack();
    const first = await reconcile(client, developmentDirectory, developmentScope);
    expect(first).toEqual({
      created: 250,
      replaced: 0,
      deactivated: 0,
      groupsCreated: 113,
      groupsReplaced: 0,
      groupsRemoved: 0,
      refused: [],
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
      capabilities: ['admin.appearance', 'admin.competence', 'admin.connectors', 'admin.users'],
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
    expect(store.state.users.get(ekonomiId(store, twoUnits.externalId))?.employments).toEqual([
      { unitId: 'unit-bibliotek', title: 'Bibliotekarie' },
      { unitId: 'unit-kommunikation', title: 'Webbredaktör' },
    ]);
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
      groupsReplaced: 113,
      groupsRemoved: 0,
      refused: [],
    });
    expect(store.state.audit.length).toBe(audited);
  });
  test("the directory's titles reach Clew as the standard attribute, a new title is one audited change and a lost one is cleared (D110)", async () => {
    const { store, client, grantOf } = stack();
    await push(client, developmentDirectory);
    const held = (userName: string) => [...store.state.users.values()].find(u => u.userName === userName)!;
    const titles = developmentDirectory.people.flatMap(
      p => p.employments?.flatMap(e => (e.title ? [e.title] : [])) ?? [],
    );
    expect(developmentDirectory.people.filter(p => !p.employments?.some(e => e.title)).map(p => p.userName)).toEqual([
      'bo.ek',
    ]);
    for (const person of developmentDirectory.people)
      expect(held(person.userName).employments).toEqual(person.employments ?? []);
    expect(held('bo.ek').title).toBeNull();
    expect(held('mikael').title).toBeNull();
    // What a person is called and what they are to Clew are two facts: a rektor and a byggchef are both managers,
    // and so is a biträdande rektor beside the rektor of the same school.
    const leads = (unit: string) =>
      plan(developmentDirectory)
        .groups.find(g => g.externalId === 'unit-manager:' + unit)!
        .members.map(externalId => held(externalId.slice('dev:'.length)).title);
    expect(held('hillevi').title).toBe('Rektor');
    expect(leads('unit-bygglov')).toEqual(['Byggchef']);
    expect(leads('unit-gymnasium')).toEqual(['Rektor', 'Biträdande rektor']);
    expect(new Set(titles).size).toBeGreaterThan(60);
    const grant = structuredClone(grantOf('hillevi')),
      audited = store.state.audit.length;
    const changed: Directory = {
      ...developmentDirectory,
      people: developmentDirectory.people.map(p => {
        if (p.userName === 'hillevi') return { ...p, employments: [{ unitId: p.department, title: 'Skolchef' }] };
        if (p.userName === 'hassan') return { ...p, employments: [{ unitId: p.department }] };
        return p;
      }),
    };
    await push(client, changed);
    expect(held('hillevi').title).toBe('Skolchef');
    expect(held('hassan').title).toBeNull();
    expect(store.state.audit.slice(audited).map(a => [a.action, a.subject, a.details.changed])).toEqual([
      ['scim.user.replaced', 'person:' + held('hillevi').id, ['employments', 'title']],
      ['scim.user.replaced', 'person:' + held('hassan').id, ['employments', 'title']],
    ]);
    expect(grantOf('hillevi')).toEqual(grant);
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
    // The users, appearance and competence key groups lose their only holder; Hillevi's manager group its only manager.
    expect(summary).toMatchObject({ created: 0, replaced: 249, deactivated: 1, groupsRemoved: 4 });
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
      complete: true,
      units: [unit('a'), unit('b', 'a'), unit('c', 'b'), unit('d', 'c')],
      groups: [],
      people: [],
    });
    expect(branch.store.state.groups.size).toBe(4);
    expect(
      await push(branch.client, { complete: true, units: [unit('a')], groups: [], people: [] }, { force: true }),
    ).toMatchObject({
      groupsRemoved: 3,
    });
    expect([...branch.store.state.groups.values()].map(g => g.externalId)).toEqual(['unit:a']);
  });
  test('a reorganisation is one push: a unit with units below it under a new id, two units that change places, and a level that is taken away (D99)', async () => {
    const { client, store } = stack(),
      unit = (id: string, parent?: string) => ({ id, label: id, ...(parent ? { parent } : {}) }),
      reorganise = (units: Directory['units']) =>
        push(client, { complete: true, units, groups: [], people: [] }, { force: true }),
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
    await expect(push(client, { complete: true, units: [], groups: [], people: [] })).rejects.toThrow(
      'The source lists 0 people and Clew holds 250 active ones from it, so this push would deactivate 250. Nothing was written.',
    );
    // Truncated: more than a fifth of the people are missing from the export.
    const truncated: Directory = { ...developmentDirectory, people: developmentDirectory.people.slice(0, 190) };
    await expect(push(client, truncated)).rejects.toThrow('would deactivate 60. Nothing was written.');
    expect(store.state.audit.length).toBe(audited);
    expect([...store.state.users.values()].every(u => u.enabled)).toBe(true);
    expect(store.state.grants.size).toBe(250);
    // A person may decide that the source is right.
    expect(await push(client, truncated, { force: true })).toMatchObject({ deactivated: 60 });
    expect([...store.state.users.values()].filter(u => !u.enabled)).toHaveLength(60);
  });
  test('a group with a foreign key is left alone, and a person Clew refuses is reported while everybody else is sent', async () => {
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
    // The source has lost one person's address, somebody has left and somebody has begun. One bad row is that
    // person's alone: the leaver is deactivated, the newcomer created, and the run says who was refused and why.
    const [first, , , leaver] = developmentDirectory.people,
      newcomer = { ...first!, externalId: 'dev:ny', userName: 'ny.person', email: 'ny@clew.test', login: false };
    const held = (userName: string) => [...store.state.users.values()].find(u => u.userName === userName);
    const summary = await push(client, {
      ...broken,
      people: [...broken.people.filter(p => p !== leaver), newcomer],
    });
    expect(summary).toMatchObject({
      created: 1,
      deactivated: 1,
      refused: [
        {
          externalId: first!.externalId,
          userName: first!.userName,
          detail: "Attribute 'emails.value' needs a non-empty string of at most 512 characters.",
        },
      ],
    });
    expect(held(leaver!.userName)?.enabled).toBe(false);
    expect(held('ny.person')?.enabled).toBe(true);
    expect(held(first!.userName)).toMatchObject({ enabled: true, email: first!.email });
    // The same row for a person the source says has left is no obstacle: a deactivation is never refused (D113).
    const gone = await push(client, {
      ...broken,
      people: [...broken.people.map((p, i) => (i === 0 ? { ...p, active: false } : p)), newcomer],
    });
    expect(gone.refused).toEqual([]);
    expect(held(first!.userName)).toMatchObject({ enabled: false, email: first!.email });
  });
  describe('what an outside review of the merged server found (2026-11-12)', () => {
    const scope = { userPrefix: 'e-', groupPrefixes: ['unit:', 'unit-manager:'], groupKeys: [] };
    const someone = (externalId: string, userName: string, department = 'a', extra: Partial<DirectoryPerson> = {}) => ({
      active: true,
      externalId,
      userName,
      givenName: userName,
      familyName: 'X',
      email: userName + '@clew.test',
      department,
      manager: false,
      capabilities: [],
      ...extra,
    });
    const source = (units: Array<{ id: string; label: string }>, ...people: DirectoryPerson[]): Directory => ({
      complete: true,
      units,
      groups: [],
      people,
    });
    const [a, b] = [
      { id: 'a', label: 'Enhet A' },
      { id: 'b', label: 'Enhet B' },
    ];
    test('an id that names two rows refuses the whole export before the first write: a person, a unit, a group, an active account name', async () => {
      const { store, client } = stack();
      await reconcile(client, source([a, b], someone('e-1', 'anna'), someone('e-2', 'bo')), scope);
      const before = { audit: store.state.audit.length, users: store.state.users.size };
      // A person with two employments, exported as two rows with one id: written, it was one person with the later
      // row's name and both rows' placements, and nothing said so.
      const twice: Array<[Directory, string]> = [
        [source([a, b], someone('e-1', 'anna'), someone('e-1', 'bo', 'b')), "the person 'e-1' more than once"],
        [source([a, b, { ...a }], someone('e-1', 'anna')), "the unit 'a' more than once"],
        [source([a, b], someone('e-1', 'anna'), someone('e-3', 'ANNA', 'b')), "the account name 'anna' more than once"],
        [
          {
            ...source([a], someone('e-1', 'anna')),
            groups: [
              { id: 'ad:x', label: 'X' },
              { id: 'ad:x', label: 'Y' },
            ],
          },
          "the group 'ad:x' more than once",
        ],
      ];
      for (const [directory, message] of twice) {
        expect(() => plan(directory)).toThrow(message);
        await expect(
          reconcile(client, directory, { ...scope, groupPrefixes: [...scope.groupPrefixes, 'ad:'] }),
        ).rejects.toThrow('Nothing was written.');
      }
      expect({ audit: store.state.audit.length, users: store.state.users.size }).toEqual(before);
      // A person who has left may keep the name somebody active now has: that is the reuse the example handles.
      expect(() =>
        plan(source([a], someone('e-1', 'anna', 'a', { active: false }), someone('e-2', 'anna'))),
      ).not.toThrow();
    });
    test('plain directory groups cannot use reserved SCIM keys, even without a generated group of the same name', async () => {
      const { client, store } = stack();
      const allowed = {
        ...scope,
        groupPrefixes: [...scope.groupPrefixes, 'capability:', 'ad:'],
        groupKeys: ['protected'],
      };
      const empty = source([a, b], someone('e-1', 'anna'));
      for (const id of ['unit:b', 'unit-manager:b', 'capability:admin.users', 'protected', ' Unit :b']) {
        const directory = {
          ...empty,
          groups: [{ id, label: 'Newsletter' }],
          people: [someone('e-1', 'anna', 'a', { groups: [id] })],
        };
        await expect(reconcile(client, directory, allowed, { force: true })).rejects.toThrow('reserved');
        expect(store.state.groups.size).toBe(0);
        expect(store.state.users.size).toBe(0);
        expect(store.state.audit).toHaveLength(0);
      }
      const plain = { id: 'ad:unit:b', label: 'Newsletter' };
      const result = await reconcile(client, { ...empty, groups: [plain] }, allowed);
      expect(result.groupsCreated).toBe(3);
    });
    for (const interrupted of ['before commit', 'after commit'] as const) {
      test(`a deactivation interrupted ${interrupted} is counted once across a 503 retry`, async () => {
        const { client, store } = stack();
        const anna = someone('e-1', 'anna'),
          bo = someone('e-2', 'bo'),
          cia = someone('e-3', 'cia');
        await reconcile(client, source([a], anna, bo, cia), scope);
        const leavers = source([a], anna, { ...cia, active: false });
        let patches = 0;
        const flaky: ScimClient = {
          async request(method, path, body) {
            if (method === 'PATCH' && path.startsWith('/Users/') && ++patches === 2) {
              if (interrupted === 'after commit') await client.request(method, path, body);
              throw new ScimClientError(503, undefined, 'Unavailable', '0');
            }
            return client.request(method, path, body);
          },
        };
        expect((await reconcile(flaky, leavers, scope, { force: true })).deactivated).toBe(2);
        expect(store.state.audit.filter(row => row.action === 'scim.user.deactivated')).toHaveLength(2);
        expect((await reconcile(client, leavers, scope)).deactivated).toBe(0);
      });
    }
    test('a lost response to a user create or group deletion preserves the completed run summary', async () => {
      const anna = someone('e-1', 'anna'),
        bo = someone('e-2', 'bo');
      for (const lost of ['POST', 'DELETE'] as const) {
        const { client } = stack();
        await reconcile(client, source([a, b], anna), scope);
        let interrupted = false;
        const flaky: ScimClient = {
          async request(method, path, body) {
            const result = await client.request(method, path, body);
            if (!interrupted && method === lost && (path === '/Users' || path.startsWith('/Groups/'))) {
              interrupted = true;
              throw new ScimClientError(503, undefined, 'Unavailable', '0');
            }
            return result;
          },
        };
        const result = await reconcile(flaky, source([a], anna, bo), scope);
        expect(interrupted).toBe(true);
        expect(result).toEqual({
          created: 1,
          replaced: 1,
          deactivated: 0,
          groupsCreated: 0,
          groupsReplaced: 1,
          groupsRemoved: 1,
          refused: [],
        });
      }
    });
    test('who has left is deactivated although a unit is refused or a name is taken further down', async () => {
      const { store, client } = stack();
      const enabled = (userName: string) => [...store.state.users.values()].find(u => u.userName === userName)?.enabled;
      // Twelve people, so that two who leave are an ordinary day and not what an emptied export looks like.
      const staying = Array.from({ length: 10 }, (_, n) => someone('e-' + (n + 1), 'person' + (n + 1))),
        [cia, dan] = [someone('e-11', 'cia'), someone('e-12', 'dan')];
      await reconcile(client, source([a], ...staying, cia, dan), scope);
      // Cia is gone from the source, Dan is still listed and marked inactive, and a new unit has a name Clew refuses.
      await expect(
        reconcile(client, source([a, { id: 'b', label: '   ' }], ...staying, { ...dan, active: false }), scope),
      ).rejects.toThrow("Attribute 'displayName'");
      expect([enabled('cia'), enabled('dan'), enabled('person1')]).toEqual([false, false, true]);
      // The run failed and says so; the next one, with the unit put right, finds nothing left to deactivate.
      const next = await reconcile(client, source([a, b], ...staying, { ...dan, active: false }), scope);
      expect(next).toMatchObject({ deactivated: 0, refused: [] });
    });
    test('a person who returns is activated only with a row Clew takes, and a wrong one is reported and left inactive', async () => {
      const { store, client } = stack();
      const held = (userName: string) => [...store.state.users.values()].find(u => u.userName === userName)!;
      const [anna, bo, cia] = [someone('e-1', 'anna'), someone('e-2', 'bo'), someone('e-3', 'cia')];
      await reconcile(client, source([a], anna, bo, cia), scope);
      await reconcile(client, source([a], anna, bo, { ...cia, active: false }), scope);
      expect(held('cia').enabled).toBe(false);
      // D114: what a person is called travels with the employment; with one employment the example sends `title` too.
      const returning = {
        ...cia,
        userName: 'cia.ny',
        employments: [{ unitId: 'a', title: 'Rektor' }],
        givenName: 'Ny',
      };
      const before = { ...held('cia') };
      const wrong = await reconcile(client, source([a], anna, bo, { ...returning, email: '' }), scope);
      expect(wrong.refused).toEqual([
        {
          externalId: 'e-3',
          userName: 'cia.ny',
          detail: "Attribute 'emails.value' needs a non-empty string of at most 512 characters.",
        },
      ]);
      expect(wrong.replaced).toBe(2);
      expect(store.state.users.get(before.id)).toEqual(before);
      const right = await reconcile(client, source([a], anna, bo, { ...returning, email: 'cia.ny@clew.test' }), scope);
      expect(right).toMatchObject({ refused: [], replaced: 3 });
      expect(held('cia.ny')).toMatchObject({
        id: before.id,
        enabled: true,
        email: 'cia.ny@clew.test',
        title: 'Rektor',
        employments: [{ unitId: 'a', title: 'Rektor' }],
      });
      expect(store.state.grants.get(held('cia.ny').id)).toMatchObject({ unitId: 'a' });
    });
  });
  test("an account name given to somebody new is moved off the leaver's row first, whether the source keeps that row or not, and two people may swap", async () => {
    const { client, store } = stack();
    const scope = { userPrefix: 'e-', groupPrefixes: ['unit:s'], groupKeys: [] };
    const someone = (externalId: string, userName: string, active = true) => ({
      active,
      externalId,
      userName,
      givenName: 'P',
      familyName: externalId,
      email: externalId + '@clew.test',
      department: 's',
      manager: false,
      capabilities: [],
    });
    const directory = (...people: ReturnType<typeof someone>[]): Directory => ({
      complete: true,
      units: [{ id: 's', label: 'Skolan' }],
      groups: [],
      people,
    });
    const names = () =>
      Object.fromEntries([...store.state.users.values()].map(u => [u.externalId, [u.userName, u.enabled]]));
    await reconcile(
      client,
      directory(someone('e-1', 'anna.berg'), someone('e-2', 'bo.ek'), someone('e-3', 'cia.dal')),
      scope,
    );
    // Anna leaves and is gone from the source; her name goes to a new person in the same run.
    const second = await reconcile(
      client,
      directory(someone('e-2', 'bo.ek'), someone('e-3', 'cia.dal'), someone('e-4', 'anna.berg')),
      scope,
    );
    expect(second).toMatchObject({ created: 1, deactivated: 1, refused: [] });
    expect(names()).toEqual({
      'e-1': ['e-1', false],
      'e-2': ['bo.ek', true],
      'e-3': ['cia.dal', true],
      'e-4': ['anna.berg', true],
    });
    // Bo leaves, the source keeps his row with the name it has given to a newcomer, and Cia and the new Anna swap.
    const third = await reconcile(
      client,
      directory(
        someone('e-2', 'bo.ek', false),
        someone('e-3', 'anna.berg'),
        someone('e-4', 'cia.dal'),
        someone('e-5', 'bo.ek'),
      ),
      scope,
    );
    expect(third.refused).toEqual([]);
    expect(names()).toEqual({
      'e-1': ['e-1', false],
      'e-2': ['e-2', false],
      'e-3': ['anna.berg', true],
      'e-4': ['cia.dal', true],
      'e-5': ['bo.ek', true],
    });
    // An unchanged source is silent: the parked rows are left as they are.
    const audited = store.state.audit.length;
    await reconcile(
      client,
      directory(
        someone('e-2', 'bo.ek', false),
        someone('e-3', 'anna.berg'),
        someone('e-4', 'cia.dal'),
        someone('e-5', 'bo.ek'),
      ),
      scope,
    );
    expect(store.state.audit.length).toBe(audited);
  });
  test('retained and absent leavers stay disabled with installation IDs across reconciliations', async () => {
    const { client, store } = stack();
    const source = {
      userPrefix: 'e-',
      groupPrefixes: ['unit:school', 'unit-manager:school'],
      groupKeys: ['capability:admin.users'],
    };
    const people = developmentDirectory.people.slice(0, 10).map((p, i) => ({
      ...p,
      externalId: 'e-' + i,
      department: 'school',
      employments: employedOn(p, 'school'),
      manager: i === 0,
      groups: [],
      alsoIn: [],
      alsoManages: [],
      capabilities: i === 0 ? ['admin.users' as const] : [],
    }));
    const directory: Directory = { complete: true, units: [{ id: 'school', label: 'School' }], groups: [], people };
    await reconcile(client, directory, source);
    const retired = { ...directory, people: people.slice(0, -1).map((p, i) => ({ ...p, active: i !== 0 })) };
    // Removing the two role groups is intentional.
    expect((await reconcile(client, retired, source, { force: true })).deactivated).toBe(2);
    expect((await reconcile(client, retired, source, { force: true })).deactivated).toBe(0);
    for (const key of ['e-0', 'e-9']) {
      const id = ekonomiId(store, key);
      expect(store.state.users.get(id)?.enabled).toBe(false);
      expect(store.state.grants.get(id)).toBeUndefined();
    }
    const returning = {
      ...retired,
      people: retired.people.map(p => ({ ...p, active: true, manager: false, capabilities: [] })),
    };
    await reconcile(client, returning, source);
    expect(store.state.grants.get(ekonomiId(store, 'e-0'))).toMatchObject({ role: 'employee', capabilities: [] });
    expect(store.state.users.get(ekonomiId(store, 'e-9'))?.enabled).toBe(false);
  });
  test('a rehire stays disabled through an interrupted removal of old duties', async () => {
    const { client, store } = stack();
    const manager = {
      ...developmentDirectory.people[0]!,
      department: 'school',
      employments: employedOn(developmentDirectory.people[0]!, 'school'),
      manager: true,
      groups: [],
      alsoIn: [],
      alsoManages: [],
      capabilities: ['admin.users' as const],
    };
    const directory: Directory = {
      complete: true,
      units: [{ id: 'school', label: 'School' }],
      groups: [],
      people: [manager],
    };
    await push(client, directory);
    const id = ekonomiId(store, manager.externalId);
    await client.request('PATCH', '/Users/' + id, {
      schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
      Operations: [{ op: 'replace', path: 'active', value: false }],
    });
    const returning: Directory = { ...directory, people: [{ ...manager, manager: false, capabilities: [] }] };
    const interrupted: ScimClient = {
      request(method, path, body) {
        if (method === 'DELETE') throw new Error('Group cleanup interrupted');
        return client.request(method, path, body);
      },
    };
    await expect(push(interrupted, returning, { force: true })).rejects.toThrow('Group cleanup interrupted');
    expect(store.state.users.get(id)?.enabled).toBe(false);
    await push(client, returning, { force: true });
    expect(store.state.users.get(id)?.enabled).toBe(true);
    expect(store.state.grants.get(id)).toMatchObject({ role: 'employee', capabilities: [] });
  });
  test('a 503 after a committed create resumes reconciliation by external ID', async () => {
    const { client, store } = stack();
    const snapshot: Directory = { complete: true, units: [{ id: 'test', label: 'Test' }], groups: [], people: [] };
    let creates = 0;
    const interrupted: ScimClient = {
      async request(method, path, body) {
        const result = await client.request(method, path, body);
        if (method === 'POST' && ++creates === 1) throw new ScimClientError(503, undefined, 'Unavailable', '0');
        return result;
      },
    };
    expect(await push(interrupted, snapshot)).toMatchObject({ groupsCreated: 1, groupsReplaced: 0 });
    expect(creates).toBe(1);
    expect([...store.state.groups.values()].map(g => g.externalId)).toEqual(['unit:test']);
    const proxy = scimClient(
      'http://clew.local',
      'token',
      () => new Response('Service unavailable', { status: 503, headers: { 'Retry-After': '120' } }),
    );
    await expect(proxy.request('GET', '/Users')).rejects.toMatchObject({ status: 503, retryAfter: '120' });
  });
  test('the summary of a push that a 503 interrupted counts what both attempts did, once', async () => {
    const { client } = stack();
    const unit = (id: string, parent?: string) => ({ id, label: id, ...(parent ? { parent } : {}) });
    const snapshot: Directory = { complete: true, units: [unit('a'), unit('b', 'a')], groups: [], people: [] };
    let creates = 0;
    const interrupted: ScimClient = {
      async request(method, path, body) {
        // The second create never reaches the service; the first one was counted before it.
        if (method === 'POST' && ++creates === 2) throw new ScimClientError(503, undefined, 'Unavailable', '0');
        return client.request(method, path, body);
      },
    };
    expect(await push(interrupted, snapshot)).toMatchObject({ groupsCreated: 2, groupsReplaced: 0 });
  });
  test('a small source loses one person without force, and a leaver Clew never held is not created', async () => {
    const { client, store } = stack();
    // The school of the operations guide: three people, two manager groups and one capability group.
    const source = {
      userPrefix: 'e-',
      groupPrefixes: ['unit:1', 'unit-manager:1'],
      groupKeys: ['capability:admin.users'],
    };
    const people = developmentDirectory.people.slice(0, 3).map((p, i) => ({
      ...p,
      externalId: 'e-' + i,
      department: i === 0 ? '110' : '111',
      employments: employedOn(p, i === 0 ? '110' : '111'),
      manager: i < 2,
      groups: [],
      alsoIn: [],
      alsoManages: [],
      capabilities: i === 0 ? ['admin.users' as const] : [],
    }));
    const directory: Directory = {
      complete: true,
      units: [
        { id: '110', label: 'Utbildning' },
        { id: '111', label: 'Centralskolan', parent: '110' },
      ],
      groups: [],
      people,
    };
    await reconcile(client, directory, source);
    // The manager of the school leaves: one person of three, and one role group of three with them.
    const without = { ...directory, people: [people[0]!, people[2]!] };
    expect(await reconcile(client, without, source)).toMatchObject({ deactivated: 1, groupsRemoved: 1 });
    expect(store.state.users.get(ekonomiId(store, 'e-1'))?.enabled).toBe(false);
    // Everybody at once is what an empty export looks like, in a source of any size.
    await expect(reconcile(client, { ...directory, people: [] }, source)).rejects.toThrow('deactivate 2');
    // HR keeps a row for somebody who left before Clew held them, and their account name has a new owner.
    const name = { userName: 'vikarie', email: 'vikarie@example.org' };
    const kept = { ...people[2]!, ...name, externalId: 'e-8', active: false },
      hired = { ...people[2]!, ...name, externalId: 'e-9' };
    expect(await reconcile(client, { ...without, people: [...without.people, kept, hired] }, source)).toMatchObject({
      created: 1,
      deactivated: 0,
    });
    const held = [...store.state.users.values()];
    expect(held.some(u => u.externalId === 'e-8')).toBe(false);
    expect(held.find(u => u.externalId === 'e-9')).toMatchObject({ userName: 'vikarie', enabled: true });
  });
  test('incomplete snapshots, unowned writes and disproportionate withdrawals stop before mutation', async () => {
    const { client, store } = stack();
    const source = { userPrefix: 'dev:', groupPrefixes: ['unit:mine-', 'ad:mine-'], groupKeys: [] };
    const directory: Directory = {
      complete: true,
      units: [{ id: 'mine-u', label: 'School' }],
      groups: ['a', 'b', 'c'].map(id => ({ id: 'ad:mine-' + id, label: id })),
      people: developmentDirectory.people.slice(0, 3).map(p => ({
        ...p,
        department: 'mine-u',
        employments: employedOn(p, 'mine-u'),
        manager: false,
        groups: [],
        capabilities: [],
        alsoIn: [],
        alsoManages: [],
      })),
    };
    await reconcile(client, directory, source);
    const foreign = (
      await client.request('POST', '/Groups', {
        externalId: 'unit:other-u',
        displayName: 'Other',
        members: [{ value: ekonomiId(store, directory.people[0]!.externalId) }],
      })
    ).body;
    const audited = store.state.audit.length;
    await expect(
      reconcile(client, { ...directory, complete: false, groups: [] }, source, { force: true }),
    ).rejects.toThrow('Incomplete source');
    await expect(reconcile(client, { ...directory, people: directory.people.slice(0, 1) }, source)).rejects.toThrow(
      'deactivate 2',
    );
    await expect(reconcile(client, { ...directory, groups: directory.groups.slice(0, 1) }, source)).rejects.toThrow(
      'remove 2 of 3',
    );
    await expect(
      reconcile(client, { ...directory, units: [...directory.units, { id: 'other-u', label: 'Changed' }] }, source),
    ).rejects.toThrow('outside the source namespace');
    expect(store.state.audit.length).toBe(audited);
    await reconcile(client, { ...directory, groups: [] }, source, { force: true });
    expect((await client.request('GET', '/Groups/' + foreign.id)).body).toEqual(foreign);
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
      // D110: a title Clew cannot read is left out and never refused, so the check is where a broken mapping shows.
      '249 of 250 active users have a title.',
      // D114: what Clew cannot read of a number or an employment is left out, so the counts are where that shows.
      'Phone numbers on 3 of 250 active users, employments on 250.',
      // The area nobody is placed on has units below it, so it is a heading and not an emptied unit (D99).
      'The units form a tree: 1 root, 6 levels deep.',
    ]);
    expect(
      (await checkProvisioning('http://clew.local', client, anonymous, { roots: 1 })).filter(f => f.level !== 'ok'),
    ).toEqual([]);
    expect(await checkProvisioning('http://clew.local', client, anonymous, { roots: 2 })).toContainEqual({
      level: 'warn',
      text: 'The tree has 1 root where 2 were expected. Check the parent links. Roots: unit:unit-kommun.',
    });
    // A person the mapping forgot, a managed unit nobody named, an emptied unit and a key stored before D96.
    const lost = await client.request('POST', '/Users', {
      externalId: 'dev:lost',
      userName: 'lost',
      displayName: 'Lost Person',
      emails: [{ value: 'lost@clew.test', type: 'work' }],
    });
    // An employment on a unit that is removed afterwards (D114): written while the unit was held, left when it went.
    const employments = 'urn:clew:params:scim:schemas:extension:employment:2.0:User:employments';
    const closed = await client.request('POST', '/Groups', { externalId: 'unit:unit-closed', displayName: 'Nedlagd' });
    await client.request('PATCH', '/Users/' + lost.body.id, {
      schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
      Operations: [{ op: 'replace', path: employments, value: [{ unitId: 'unit-closed', title: 'Vaktmästare' }] }],
    });
    await client.request('DELETE', '/Groups/' + closed.body.id);
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
      externalId: ' Unit :old',
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
      '1 employment names a unit that is no longer held. Reconcile lost (unit-closed) with the directory.',
      '1 unit has a unit-manager: group and no unit: group, so the unit is shown by its id instead of a name: unit-nameless.',
      '1 unit or unit-manager group has no members: unit:unit-empty.',
      '1 unit has people and no manager, on the unit or on any unit above it, so its people report to nobody: unit:unit-adrift-below.',
      "1 group carries a key that is written wrong and gives nobody anything: ' Unit :old'.",
    ]);
    // More roots than the source has: a unit written without its parent became one (D99).
    expect(
      (await checkProvisioning('http://clew.local', client, anonymous, { roots: 1 }))
        .filter(f => f.level === 'warn')
        .map(f => f.text),
    ).toContain(
      'The tree has 3 roots where 1 was expected. Check the parent links. Roots: unit:unit-kommun, unit:unit-empty, unit:unit-adrift.',
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
    active: true,
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
    complete: true,
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
    complete: true,
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
      await push({ request: (...args) => (requests++, whole.client.request(...args)) }, to, { force: true });
      const expected = held(whole.store);
      expect(requests).toBeGreaterThan(30);
      for (const lost of ['request', 'response'] as const)
        for (let at = 1; at <= requests; at++) {
          const s = await begin();
          await expect(push(cut(s.client, at, lost), to, { force: true })).rejects.toThrow('connection lost');
          await push(s.client, to, { force: true });
          expect([`the ${lost} of call ${at} lost`, held(s.store)]).toEqual([
            `the ${lost} of call ${at} lost`,
            expected,
          ]);
          // And the run after that has nothing left to do.
          const audited = s.store.state.audit.length;
          await push(s.client, to, { force: true });
          expect(s.store.state.audit.length).toBe(audited);
        }
    });
});

test('the profile guide changes one of two work numbers and one of two employment percentages', async () => {
  const { client } = stack();
  const guide = await Bun.file(new URL('../../docs/guides/writing-a-provisioner.md', import.meta.url)).text();
  const examples = guide.slice(guide.indexOf('### Phone numbers'), guide.indexOf('### How a request is read'));
  const blocks = [...examples.matchAll(/^```json\n([\s\S]*?)\n```/gm)].map(match => JSON.parse(match[1]!) as unknown);
  expect(blocks).toHaveLength(4);
  const [phones, changePhone, createPerson, changeEmployment] = blocks;
  await client.request('POST', '/Groups', { externalId: 'unit:9540', displayName: 'Utveckling' });
  const created = await client.request('POST', '/Users', createPerson);
  const path = '/Users/' + created.body.id;
  expect(created.body[SCIM_EMPLOYMENT_SCHEMA].employments).toMatchObject([
    { employmentPercentage: 60 },
    { employmentPercentage: 40 },
  ]);
  await client.request('PATCH', path, {
    schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
    Operations: [{ op: 'replace', value: phones }],
  });
  await client.request('PATCH', path, changePhone);
  await client.request('PATCH', path, changeEmployment);
  const { body } = await client.request('GET', path);
  expect(body.phoneNumbers).toEqual([
    { type: 'work', value: '070-174 06 05' },
    { type: 'work', value: '070-174 06 08' },
    { type: 'Jour', value: '070-174 06 07' },
  ]);
  expect(body[SCIM_EMPLOYMENT_SCHEMA].employments).toEqual([
    {
      unitId: '9540',
      title: 'Systemförvaltare',
      employmentType: 'Tillsvidare',
      startDate: '2019-02-01',
      employmentPercentage: 62.5,
    },
    {
      unitId: '9540',
      title: 'Projektsamordnare',
      employmentType: 'Vikariat',
      startDate: '2026-09-01',
      employmentPercentage: 40,
    },
  ]);
});

test('the published school walkthrough produces the printed output and the promised organisation', async () => {
  const { store, app, grantOf } = stack();
  const guide = await Bun.file(new URL('../../docs/guides/provisioning-for-operations.md', import.meta.url)).text();
  const excerpt = guide.slice(
    guide.indexOf('### Try it by hand first'),
    guide.indexOf('### What the daily comparison does'),
  );
  const blocks = (lang: string) =>
    [...excerpt.matchAll(new RegExp('```' + lang + '\\n([\\s\\S]*?)\\n```', 'g'))].map(match => match[1]!);
  const commands = blocks('bash'),
    output = blocks('text');
  expect(commands).toHaveLength(4);
  expect(output).toHaveLength(2);
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      url.pathname = url.pathname.slice('/scim/v2'.length);
      return app.fetch(new Request(url, req));
    },
  });
  const run = async (shell: string) => {
    const child = Bun.spawn(['bash', '-c', shell], {
      cwd: fileURLToPath(new URL('../../', import.meta.url)),
      // What the guide asks for and nothing else of this process: its commands are text from a document.
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        CLEW: new URL('/scim/v2', server.url).href,
        CLEW_PROVISIONER_TOKEN: 'dev-token',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [status, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    if (status !== 0) throw new Error('Guide command failed: ' + stderr + stdout);
    return stdout;
  };
  try {
    expect(await run(commands.slice(0, 3).join('\n'))).toBe(output[0] + '\n');
    const units = [...store.state.groups.values()].filter(g => g.externalId?.startsWith('unit:'));
    expect(Object.fromEntries(units.map(g => [g.externalId, g.parentUnitId]))).toEqual({
      'unit:100': null,
      'unit:110': '100',
      'unit:111': '110',
      'unit:112': '110',
    });
    expect(grantOf('anna.berg')).toMatchObject({ role: 'manager', capabilities: ['admin.users'] });
    // D114: the example sends each person's employment and a number, as the table above it says.
    const sent = (sourceId: string) => store.state.users.get(ekonomiId(store, sourceId))!;
    expect(['e-1001', 'e-1002', 'e-1003'].map(id => [sent(id).employments, sent(id).phoneNumbers])).toEqual([
      [[{ unitId: '110', title: 'Skolchef' }], [{ type: 'work', value: '070-174 06 01' }]],
      [[{ unitId: '111', title: 'Rektor' }], [{ type: 'work', value: '070-174 06 02' }]],
      [[{ unitId: '111', title: 'Lärare' }], [{ type: 'work', value: '070-174 06 03' }]],
    ]);
    const staff = staffUsecases({ store });
    for (const [sourceId, expected] of [
      ['e-1001', 'Omar Ali'],
      ['e-1002', 'Lena Holm'],
    ] as const) {
      const id = ekonomiId(store, sourceId);
      const grant = store.state.grants.get(id)!;
      const overview = await staff.overview({
        ...grant,
        id,
        name: sourceId,
        organisationId: 'poc',
        principal: { id: 'person:' + id, kind: 'person' },
        capabilities: [],
        authorizationVersion: 'v1',
        sessionBinding: 'test',
        expiresAt: '2099-01-01T00:00:00Z',
        authorize: async () => ({ version: 'v1' }),
      });
      expect(overview.units.flatMap(u => u.people.map(p => p.name))).toEqual([expected]);
    }
    expect(await run([commands[0], commands[3]].join('\n'))).toBe(output[1] + '\n');
    expect(grantOf('lena.holm')?.unitId).toBe('112');
    expect(sent('e-1003').employments).toEqual([{ unitId: '112', title: 'Bibliotekarie' }]);
    expect(store.state.users.get(ekonomiId(store, 'e-1002'))?.enabled).toBe(false);
  } finally {
    await server.stop(true);
  }
}, 15000);
