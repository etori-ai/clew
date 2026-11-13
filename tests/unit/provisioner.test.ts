import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  SCIM_EMPLOYMENT_SCHEMA,
  type AuthenticatedContext,
  type Capability as ClewCapability,
  type DirectoryPhone as ClewPhone,
  type Employment as ClewEmployment,
} from '@clew/contracts';
import { describe, expect, setDefaultTimeout, test } from 'bun:test';
import { memberKey, memoryProvisionStore } from '../../apps/server/src/modules/people/adapters/memory';
import { scimUsecases, staffUsecases, usersAdminUsecases } from '../../apps/server/src/modules/people/usecases';
import { scimRoutes } from '../../apps/server/src/routes/scim';
import { checkProvisioning } from '../../scripts/provisioner/check';
import { scimClient, ScimClientError, type ScimClient } from '../../scripts/provisioner/client';
import {
  DEVELOPMENT_NEW_HIRE,
  developmentDirectory,
  developmentScope,
  fullName,
  type Capability,
  type Directory,
  type DirectoryPerson,
  type DirectoryPhone,
  type Employment,
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
const scope = {
  userPrefix: 'dev:',
  groupPrefixes: ['unit:', 'unit-manager:', 'ad:', 'capability:', 'position:'],
  groupKeys: [],
};
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
  test('plans D68 groups from units, manager flags, plain groups, capabilities and positions, two hundred and fifty-one people in forty-eight units', () => {
    const p = plan(developmentDirectory),
      by = (externalId: string) => p.groups.find(g => g.externalId === externalId)!,
      keyed = (key: string) => p.groups.filter(g => g.externalId.startsWith(key));
    expect(p.users).toHaveLength(251);
    expect(p.users.slice(0, 3).map(u => u.body.userName)).toEqual(['hillevi', 'hassan', 'mikael']);
    expect(new Set(p.users.map(u => u.body.userName)).size).toBe(251);
    expect(keyed('unit:')).toHaveLength(48);
    // Two units have no manager group: the department nobody leads, and the fritidshem that is led from the school above it.
    expect(keyed('unit-manager:')).toHaveLength(46);
    expect(keyed('capability:').map(g => g.externalId)).toEqual([
      'capability:admin.appearance',
      'capability:admin.boarding',
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
      'ad:forvaltning-utbildning': 88,
      'ad:intranat-redaktorer': 13,
      // D121: the development stack's registrar group, Hillevi alone; the seed maps it to Kompetenssökning.
      'ad:kompetenssamordnare': 1,
      'ad:krisledning': 5,
      'ad:nattpersonal': 12,
      'ad:projekt-e-arkiv': 0,
      'ad:rektorer': 7,
      'ad:skyddsombud': 22,
      'ad:systemforvaltare': 9,
    });
    expect(by('unit:unit-skola')).toMatchObject({ displayName: 'Bergsåkers skola' });
    // Eleven at the school and the new teacher whose employment starts in three weeks (D124), added last.
    expect(by('unit:unit-skola').members).toHaveLength(13);
    expect(by('unit:unit-skola').members.at(-1)).toBe('dev:' + DEVELOPMENT_NEW_HIRE);
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
    expect(p.groups.filter(g => g.refused)).toEqual([]);
    // A unit the people name and the directory does not list is that unit's fault, planned with them and refused.
    const unlisted = plan({ ...developmentDirectory, units: [] }).groups.find(g => g.externalId === 'unit:unit-skola')!;
    expect(unlisted.refused).toBe(
      "The directory does not list the unit 'unit-skola', which 13 active people name: hillevi, anna, erik, maria, johan (and 8 more).",
    );
    expect(unlisted.members).toEqual(by('unit:unit-skola').members);
    // D108 item 5: every position the source lists is a group under its own code and name, one nobody holds too.
    expect(Object.fromEntries(keyed('position:').map(g => [g.externalId, g.members.length]))).toEqual({
      'position:enhetschef': 10,
      'position:handlaggare': 5,
      'position:larare': 36,
      'position:maskinforare': 2,
      'position:sjukskoterska': 9,
      'position:stodassistent': 7,
      'position:tolk': 0,
      'position:underskoterska': 27,
      'position:vardbitrade': 7,
    });
    expect(by('position:underskoterska')).toMatchObject({ displayName: 'Undersköterska' });
    expect(by('position:underskoterska').members).toContain('dev:hassan');
    // A position is the person's: two people hold two each, on the one unit they work in.
    expect(
      developmentDirectory.people.filter(u => (u.positions ?? []).length > 1).map(u => [u.department, u.positions]),
    ).toEqual([
      ['unit-lss', ['stodassistent', 'underskoterska']],
      ['unit-gata', ['maskinforare', 'handlaggare']],
    ]);
    // A position the directory does not list is the fault of the rows that name it: planned with them and refused.
    expect(
      plan({ ...developmentDirectory, positions: [] }).groups.find(g => g.externalId === 'position:underskoterska')!
        .refused,
    ).toMatch(/^The directory does not list the group 'position:underskoterska', which \d+ active people name: /);
    expect(() =>
      plan({ ...developmentDirectory, positions: [...developmentDirectory.positions!, { code: ' usk', label: 'X' }] }),
    ).toThrow("The position code ' usk' is empty or has space around it");
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
    // A broken tree refuses the units it breaks and nothing else: what stands below them is planned as below a root.
    const unit = (id: string, parent?: string) => ({ id, label: id, ...(parent ? { parent } : {}) });
    const broken = (...units: Directory['units']) =>
      plan({ complete: true, units, groups: [], people: [] }).groups.map(g => [g.externalId, g.refused]);
    expect(broken(unit('a', 'missing'), unit('b', 'a'), unit('r'))).toEqual([
      ['unit:a', "The unit 'a' has parent 'missing', which the directory does not list."],
      ['unit:r', undefined],
      ['unit:b', undefined],
    ]);
    expect(broken(unit('c', 'a'), unit('a', 'b'), unit('b', 'a'), unit('s', 's'))).toEqual([
      ['unit:a', "The units a → b → a are each other's parents."],
      ['unit:b', "The units a → b → a are each other's parents."],
      ['unit:s', "The units s → s are each other's parents."],
      ['unit:c', undefined],
    ]);
  });
  test('a first push creates everything, grants follow, and a second push is silent', async () => {
    const { store, client, grantOf } = stack();
    const first = await reconcile(client, developmentDirectory, developmentScope);
    expect(first).toEqual({
      created: 251,
      replaced: 0,
      deactivated: 0,
      groupsCreated: 124,
      groupsReplaced: 0,
      groupsRemoved: 0,
      refused: [],
      groupsRefused: [],
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
      capabilities: ['admin.appearance', 'admin.boarding', 'admin.competence', 'admin.connectors', 'admin.users'],
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
    // D108 item 5: the source's positions are the organisation's, one nobody holds included, and a hundred and one
    // people hold theirs; a position moves no grant.
    expect([...store.state.positions.values()].filter(row => row.organisationId === 'poc')).toHaveLength(9);
    expect([...store.state.personPositions.values()].filter(ids => ids.length)).toHaveLength(101);
    const hassan = [...store.state.users.values()].find(u => u.userName === 'hassan')!.id;
    expect(await store.transaction(tx => tx.positionsOf(hassan))).toEqual([
      { code: 'underskoterska', label: 'Undersköterska' },
    ]);
    expect(
      store.state.audit
        .filter(row => row.subject === 'person:' + hassan && row.action === 'positions.derived')
        .map(row => row.details),
    ).toEqual([{ positions: ['underskoterska'] }]);
    const audited = store.state.audit.length;
    const second = await push(client, developmentDirectory);
    expect(second).toEqual({
      created: 0,
      replaced: 251,
      deactivated: 0,
      groupsCreated: 0,
      groupsReplaced: 124,
      groupsRemoved: 0,
      refused: [],
      groupsRefused: [],
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
    // The users, appearance, competence and boarding key groups lose their only holder; Hillevi's manager group its
    // only manager.
    expect(summary).toMatchObject({ created: 0, replaced: 250, deactivated: 1, groupsRemoved: 5 });
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
    expect(remaining).toHaveLength(119);
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
      'The source lists 0 people and Clew holds 251 active ones from it, so this push would deactivate 251. Nothing was written.',
    );
    // Truncated: more than a fifth of the people are missing from the export.
    const truncated: Directory = { ...developmentDirectory, people: developmentDirectory.people.slice(0, 190) };
    await expect(push(client, truncated)).rejects.toThrow('would deactivate 61. Nothing was written.');
    expect(store.state.audit.length).toBe(audited);
    expect([...store.state.users.values()].every(u => u.enabled)).toBe(true);
    expect(store.state.grants.size).toBe(251);
    // A person may decide that the source is right.
    expect(await push(client, truncated, { force: true })).toMatchObject({ deactivated: 61 });
    expect([...store.state.users.values()].filter(u => !u.enabled)).toHaveLength(61);
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
          detail: "Attribute 'emails' is required.",
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
    test('an id that names two rows refuses the whole export: a person or an account name before the first write, a unit or a group once who has left is deactivated', async () => {
      const { store, client } = stack();
      await reconcile(client, source([a, b], someone('e-1', 'anna'), someone('e-2', 'bo')), scope);
      const before = { audit: store.state.audit.length, users: store.state.users.size };
      // A person with two employments, exported as two rows with one id: written, it was one person with the later
      // row's name and both rows' placements, and nothing said so.
      const bo = someone('e-2', 'bo');
      const twice: Array<[Directory, string]> = [
        [source([a, b], someone('e-1', 'anna'), someone('e-1', 'bo', 'b')), "the person 'e-1' more than once"],
        [source([a, b, { ...a }], someone('e-1', 'anna'), bo), "the unit 'a' more than once"],
        [source([a, b], someone('e-1', 'anna'), someone('e-3', 'ANNA', 'b')), "the account name 'anna' more than once"],
        [
          {
            ...source([a, b], someone('e-1', 'anna'), bo),
            groups: [
              { id: 'ad:x', label: 'X' },
              { id: 'ad:x', label: 'Y' },
            ],
          },
          "the group 'ad:x' more than once",
        ],
      ];
      const owner = { ...scope, groupPrefixes: [...scope.groupPrefixes, 'ad:'] };
      for (const [directory, message] of twice) {
        expect(() => plan(directory)).toThrow(message);
        await expect(reconcile(client, directory, owner)).rejects.toThrow(`${message}; `);
        await expect(reconcile(client, directory, owner)).rejects.toThrow('Nothing was written.');
      }
      expect({ audit: store.state.audit.length, users: store.state.users.size }).toEqual(before);
      // The people rows say who has left whatever the organisation's rows say: Bo is deactivated, and nothing else is
      // written, neither the unit nor anything about anybody else.
      await expect(reconcile(client, source([a, b, { ...a }], someone('e-1', 'anna')), owner)).rejects.toThrow(
        "The source lists the unit 'a' more than once; a unit id is one unit. The person who has left was deactivated; nothing else was written.",
      );
      expect(store.state.audit.slice(before.audit).map(row => [row.action, row.subject])).toEqual([
        ['scim.user.deactivated', 'person:' + ekonomiId(store, 'e-2')],
      ]);
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
      for (const id of ['unit:b', 'unit-manager:b', 'capability:admin.users', 'protected', ' Unit :b', 'position:b']) {
        const directory = {
          ...empty,
          groups: [{ id, label: 'Newsletter' }],
          people: [someone('e-1', 'anna', 'a', { groups: [id] })],
        };
        await expect(reconcile(client, directory, allowed, { force: true })).rejects.toThrow('reserved');
        expect(store.state.groups.size).toBe(0);
        expect(store.state.users.size).toBe(0);
        // The people were read, so the run was seen (D107), and nothing was written.
        expect(store.state.audit.map(row => row.action)).toEqual(['provisioner.seen']);
      }
      // A person's row that names a reserved key as a plain group is the same mistake, though the directory lists none.
      await expect(
        reconcile(client, { ...empty, people: [someone('e-1', 'anna', 'a', { groups: ['unit:b'] })] }, allowed),
      ).rejects.toThrow("anna has group 'unit:b', which uses a reserved SCIM key.");
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
          groupsRefused: [],
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
      const refused = await reconcile(
        client,
        source([a, { id: 'b', label: '   ' }], ...staying, { ...dan, active: false }),
        scope,
      );
      expect(refused).toMatchObject({
        deactivated: 2,
        refused: [],
        groupsRefused: [
          {
            externalId: 'unit:b',
            detail: "Attribute 'displayName' needs a non-empty string of at most 512 characters.",
          },
        ],
      });
      expect([enabled('cia'), enabled('dan'), enabled('person1')]).toEqual([false, false, true]);
      // The run reports the unit; the next one, with the unit put right, creates it and has nothing left to deactivate.
      const next = await reconcile(client, source([a, b], ...staying, { ...dan, active: false }), scope);
      expect(next).toMatchObject({ deactivated: 0, refused: [], groupsRefused: [], groupsCreated: 1 });
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
          detail: "Attribute 'emails' is required.",
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
  describe('one row the source has wrong, and a second writer (the review of users and the organisation, 2026-11-12)', () => {
    type Store = ReturnType<typeof stack>['store'];
    const scope = { userPrefix: 'e-', groupPrefixes: ['unit:', 'unit-manager:', 'capability:', 'ad:'], groupKeys: [] };
    const someone = (
      externalId: string,
      userName: string,
      department: string,
      extra: Partial<DirectoryPerson> = {},
    ): DirectoryPerson => ({
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
    const unit = (id: string, label: string, parent?: string) => ({ id, label, ...(parent ? { parent } : {}) });
    const source = (
      units: Directory['units'],
      people: DirectoryPerson[],
      groups: Directory['groups'] = [],
    ): Directory => ({ complete: true, units, groups, people });
    /** Who Clew holds in the group with this key, by account name; undefined when Clew holds no such group. */
    const holders = (store: Store, key: string) => {
      const group = [...store.state.groups.values()].find(g => g.externalId === key);
      return (
        group &&
        [...store.state.users.values()]
          .filter(u => store.state.members.has(memberKey(group.id, u.id)))
          .map(u => u.userName)
          .sort()
      );
    };
    const held = (store: Store, userName: string) =>
      [...store.state.users.values()].find(u => u.userName === userName)!;
    const parentOf = (store: Store, key: string) =>
      [...store.state.groups.values()].find(g => g.externalId === key)?.parentUnitId;
    test("a unit the source has wrong is that row's alone: it is reported, who the source places on it keeps their unit, and every other change and removal is made", async () => {
      const { store, client, grantOf } = stack();
      const units = [
        unit('kommun', 'Kommunen'),
        unit('skola', 'Skolan', 'kommun'),
        unit('forskola', 'Förskolan', 'kommun'),
        unit('kansli', 'Kansliet', 'kommun'),
        unit('kok', 'Köket', 'kommun'),
        unit('vard', 'Vården', 'kommun'),
      ];
      const staff = [7, 8, 9, 10].map(n => someone('e-' + n, 'p' + n, 'vard'));
      const chef = someone('e-1', 'chef', 'skola', { manager: true }),
        admin = someone('e-2', 'admin', 'kansli', { capabilities: ['admin.users'] }),
        flytt = someone('e-3', 'flytt', 'skola'),
        vilse = someone('e-4', 'vilse', 'forskola'),
        admin2 = someone('e-5', 'admin2', 'kansli', { capabilities: ['admin.users'] }),
        slutar = someone('e-6', 'slutar', 'kok');
      await reconcile(client, source(units, [chef, admin, flytt, vilse, admin2, slutar, ...staff]), scope);
      // A bad day's export: the office names a parent the export does not list, a new unit has no name and a unit
      // below it, and a person is placed on a unit the export does not list. Beside them a manager steps down, an
      // administrator gives the role back, and somebody leaves with the unit they were the last one on.
      const people = [
        { ...chef, manager: false },
        { ...admin, capabilities: [] },
        { ...flytt, department: 'ny-under' },
        { ...vilse, department: 'okand' },
        admin2,
        ...staff,
      ];
      const kept = units.filter(u => u.id !== 'kok' && u.id !== 'kansli'),
        log: string[] = [];
      const bad = await reconcile(
        client,
        source(
          [
            ...kept,
            unit('kansli', 'Kansliet', 'saknas'),
            unit('ny', '   ', 'kommun'),
            unit('ny-under', 'Under den nya', 'ny'),
          ],
          people,
        ),
        scope,
        { log: line => log.push(line) },
      );
      expect(bad).toEqual({
        created: 0,
        replaced: 9,
        deactivated: 1,
        groupsCreated: 0,
        groupsReplaced: 6,
        groupsRemoved: 2,
        refused: [],
        groupsRefused: [
          {
            externalId: 'unit:kansli',
            detail: "The unit 'kansli' has parent 'saknas', which the directory does not list.",
          },
          {
            externalId: 'unit:okand',
            detail: "The directory does not list the unit 'okand', which an active person names: vilse.",
          },
          {
            externalId: 'unit:ny',
            detail: "Attribute 'displayName' needs a non-empty string of at most 512 characters.",
          },
          { externalId: 'unit:ny-under', detail: "The unit above it, 'unit:ny', was not written." },
        ],
      });
      expect(log).toContain(
        "refused group unit:ny: Attribute 'displayName' needs a non-empty string of at most 512 characters.",
      );
      // The office stands where Clew holds it, with the people the source gives it.
      expect([parentOf(store, 'unit:kansli'), holders(store, 'unit:kansli')]).toEqual(['kommun', ['admin', 'admin2']]);
      // Who the source places on a unit that was not written keeps the unit Clew holds for them.
      expect([holders(store, 'unit:skola'), holders(store, 'unit:forskola')]).toEqual([['chef', 'flytt'], ['vilse']]);
      expect(grantOf('vilse')).toMatchObject({ unitId: 'forskola', role: 'employee' });
      // Everything else is done: the leaver is deactivated, the manager's role and the capability are taken back, and
      // the unit the leaver was the last one on is removed.
      expect(held(store, 'slutar').enabled).toBe(false);
      expect(grantOf('chef')).toMatchObject({ unitId: 'skola', role: 'employee' });
      expect(grantOf('admin')?.capabilities).toEqual([]);
      expect(holders(store, 'capability:admin.users')).toEqual(['admin2']);
      for (const key of ['unit:kok', 'unit-manager:skola', 'unit:ny', 'unit:ny-under', 'unit:okand'])
        expect(holders(store, key)).toBeUndefined();
      // The export put right: the units are written, the people placed on them, and their old placements go.
      const right = await reconcile(
        client,
        source(
          [
            ...kept,
            unit('kansli', 'Kansliet', 'kommun'),
            unit('ny', 'Nya enheten', 'kommun'),
            unit('ny-under', 'Under den nya', 'ny'),
            unit('okand', 'Okänd', 'kommun'),
          ],
          people,
        ),
        scope,
      );
      expect(right).toMatchObject({ groupsCreated: 3, groupsRemoved: 0, refused: [], groupsRefused: [] });
      expect(['unit:skola', 'unit:forskola', 'unit:ny-under', 'unit:okand'].map(key => holders(store, key))).toEqual([
        ['chef'],
        [],
        ['flytt'],
        ['vilse'],
      ]);
      expect(grantOf('vilse')).toMatchObject({ unitId: 'okand' });
    });
    test('a unit Clew will not remove, and one above a unit the source has wrong, stay without the people the source withdrew from them', async () => {
      const { store, client, grantOf } = stack();
      const mine = { userPrefix: 'e-', groupPrefixes: ['unit:mine-', 'unit-manager:mine-'], groupKeys: [] };
      const units = [
        unit('mine-kommun', 'Kommunen'),
        unit('mine-gammal', 'Gamla enheten', 'mine-kommun'),
        unit('mine-a', 'A', 'mine-kommun'),
        unit('mine-b', 'B', 'mine-a'),
        unit('mine-skola', 'Skolan', 'mine-kommun'),
        ...[1, 2, 3, 4, 5].map(n => unit('mine-' + n, 'Enhet ' + n, 'mine-kommun')),
      ];
      const [anna, bo, cia, dan] = [
        someone('e-1', 'anna', 'mine-gammal'),
        someone('e-2', 'bo', 'mine-skola'),
        someone('e-3', 'cia', 'mine-b'),
        someone('e-4', 'dan', 'mine-a'),
      ];
      await reconcile(client, source(units, [anna, bo, cia, dan]), mine);
      // Another writer of the organisation, with keys of its own, has a unit below the old one.
      await client.request('POST', '/Groups', {
        externalId: 'unit:theirs',
        displayName: 'Deras enhet',
        'urn:clew:params:scim:schemas:extension:unit:2.0:Group': { parent: 'unit:mine-gammal' },
      });
      // The source closes the old unit and A and moves Anna and Dan to the school, and B still names A as its parent.
      const moved = [{ ...anna, department: 'mine-skola' }, bo, cia, { ...dan, department: 'mine-skola' }],
        kept = units.filter(u => u.id !== 'mine-gammal' && u.id !== 'mine-a'),
        log: string[] = [];
      const summary = await reconcile(client, source(kept, moved), mine, { log: line => log.push(line) });
      expect(summary).toMatchObject({
        groupsRemoved: 0,
        refused: [],
        groupsRefused: [
          {
            externalId: 'unit:mine-b',
            detail: "The unit 'mine-b' has parent 'mine-a', which the directory does not list.",
          },
          {
            externalId: 'unit:mine-gammal',
            detail:
              "The unit 'mine-gammal' still has a unit below it ('unit:theirs'); move or remove them first, a tree is removed from the leaves up (D99). The group was not removed.",
          },
        ],
      });
      expect(log).toEqual(
        expect.arrayContaining([
          'kept group unit:mine-a: a unit below it stays',
          'kept group unit:mine-gammal: Clew did not remove it',
        ]),
      );
      expect(
        ['unit:mine-gammal', 'unit:mine-a', 'unit:mine-b', 'unit:mine-skola'].map(key => holders(store, key)),
      ).toEqual([[], [], ['cia'], ['anna', 'bo', 'dan']]);
      expect([parentOf(store, 'unit:mine-b'), grantOf('anna')?.unitId, grantOf('dan')?.unitId]).toEqual([
        'mine-a',
        'mine-skola',
        'mine-skola',
      ]);
      // B is given a parent the source lists, and A goes; the old unit stays while the other writer's unit is below it.
      const right = await reconcile(
        client,
        source(
          kept.map(u => (u.id === 'mine-b' ? { ...u, parent: 'mine-kommun' } : u)),
          moved,
        ),
        mine,
      );
      expect(right).toMatchObject({ groupsRemoved: 1, groupsRefused: [{ externalId: 'unit:mine-gammal' }] });
      expect([holders(store, 'unit:mine-a'), parentOf(store, 'unit:mine-b')]).toEqual([undefined, 'mine-kommun']);
    });
    test('a group Clew refuses to create is reported by its key and the run carries on: a capability outside the list, a plain group without a name', async () => {
      const { client, grantOf } = stack();
      const summary = await reconcile(
        client,
        source(
          [unit('a', 'Enheten')],
          [
            someone('e-1', 'anna', 'a', { capabilities: ['admin.everything' as Capability], groups: ['ad:tom'] }),
            someone('e-2', 'bo', 'a', { manager: true }),
          ],
          [{ id: 'ad:tom', label: ' ' }],
        ),
        scope,
      );
      expect(summary).toEqual({
        created: 2,
        replaced: 0,
        deactivated: 0,
        groupsCreated: 2,
        groupsReplaced: 0,
        groupsRemoved: 0,
        refused: [],
        groupsRefused: [
          {
            externalId: 'ad:tom',
            detail: "Attribute 'displayName' needs a non-empty string of at most 512 characters.",
          },
          {
            externalId: 'capability:admin.everything',
            detail:
              "The key 'capability:admin.everything' names no capability of this installation; the capabilities are admin.connectors, admin.users, admin.appearance, admin.competence, admin.boarding (D96). The group was not stored.",
          },
        ],
      });
      expect([grantOf('anna'), grantOf('bo')]).toMatchObject([
        { unitId: 'a', role: 'employee', capabilities: [] },
        { unitId: 'a', role: 'manager' },
      ]);
    });
    test('a unit that does not take the people the source adds to it leaves them on the units Clew holds them on, and only them, and is reported once', async () => {
      const { store, client } = stack();
      const units = ['a', 'b', 'c', 'd', 'e'].map(id => unit(id, 'Enhet ' + id));
      const anna = someone('e-1', 'anna', 'a'),
        bo = someone('e-2', 'bo', 'b', { alsoIn: ['c'] }),
        eva = someone('e-6', 'eva', 'b'),
        rest = [someone('e-3', 'cia', 'd'), someone('e-4', 'dan', 'e')];
      await reconcile(client, source(units, [anna, bo, eva, ...rest]), scope);
      const b = [...store.state.groups.values()].find(g => g.externalId === 'unit:b')!.id;
      // Clew refuses every change to B's people, for whatever reason it has.
      const refusing: ScimClient = {
        async request(method, path, body) {
          if (method === 'PATCH' && path === '/Groups/' + b)
            throw new ScimClientError(400, 'invalidValue', 'Refused for the test.', null);
          return client.request(method, path, body);
        },
      };
      // Anna moves to B, Bo, who is on B already, is no longer on C as well, Eva moves from B to E, and somebody new
      // begins on B.
      const summary = await reconcile(
        refusing,
        source(units, [
          { ...anna, department: 'b' },
          { ...bo, alsoIn: [] },
          { ...eva, department: 'e' },
          ...rest,
          someone('e-5', 'ny', 'b'),
        ]),
        scope,
      );
      expect(summary).toMatchObject({
        created: 1,
        refused: [
          {
            externalId: 'e-5',
            userName: 'ny',
            detail: 'Created, but not placed: no unit the source places this person on took them.',
          },
        ],
        groupsRefused: [{ externalId: 'unit:b', detail: 'Refused for the test.' }],
      });
      // Eva is on E as well now, and stays on B only because Clew would not take her off it.
      expect(['unit:a', 'unit:b', 'unit:c', 'unit:e'].map(key => holders(store, key))).toEqual([
        ['anna'],
        ['bo', 'eva'],
        [],
        ['dan', 'eva'],
      ]);
    });
    test('somebody the source places on a unit that was not written stays on the units Clew holds them on, without the role the source withdrew, and one who returns to it stays inactive until it is written', async () => {
      const { store, client, grantOf } = stack();
      const units = ['gammal', 'a', 'b', 'c', 'd', 'e'].map(id => unit(id, 'Enhet ' + id));
      const anna = someone('e-1', 'anna', 'gammal', { manager: true }),
        bo = someone('e-2', 'bo', 'a'),
        rest = [someone('e-3', 'cia', 'b', { manager: true }), someone('e-4', 'dan', 'c'), someone('e-5', 'eva', 'd')];
      await reconcile(client, source(units, [anna, bo, ...rest]), scope);
      // The source moves Anna, a manager, to a unit it does not list and closes her old one, and Bo leaves.
      const lost = { ...anna, department: 'okand' },
        log: string[] = [];
      const first = await reconcile(client, source(units.slice(1), [lost, { ...bo, active: false }, ...rest]), scope, {
        log: line => log.push(line),
      });
      expect(first).toMatchObject({
        deactivated: 1,
        groupsRemoved: 1,
        refused: [],
        groupsRefused: [
          {
            externalId: 'unit:okand',
            detail: "The directory does not list the unit 'okand', which an active person names: anna.",
          },
          {
            externalId: 'unit-manager:okand',
            detail: "The directory does not list the unit 'okand', which an active person manages: anna.",
          },
        ],
      });
      expect(log).toContain('kept group unit:gammal: somebody on it is on no unit the source gives them yet');
      // She stays on her old unit, so she is never without one, and her role on it goes as the source says.
      expect([holders(store, 'unit:gammal'), holders(store, 'unit-manager:gammal'), holders(store, 'unit:a')]).toEqual([
        ['anna'],
        undefined,
        [],
      ]);
      expect(grantOf('anna')).toMatchObject({ unitId: 'gammal', role: 'employee' });
      // Bo comes back to a new unit Clew refuses, while Anna's unit is still missing: he stays inactive.
      const back = await reconcile(
        client,
        source([...units.slice(1), unit('ny', '  ')], [lost, { ...bo, department: 'ny' }, ...rest]),
        scope,
      );
      expect(back.refused).toEqual([
        {
          externalId: 'e-2',
          userName: 'bo',
          detail: 'Left inactive: no unit the source places this person on took them, so they are not placed yet.',
        },
      ]);
      expect(back.groupsRefused.map(g => g.externalId)).toEqual(['unit:okand', 'unit-manager:okand', 'unit:ny']);
      expect(held(store, 'bo').enabled).toBe(false);
      // Put right, both are placed, Bo is active again, and Anna's old unit goes.
      const right = await reconcile(
        client,
        source(
          [...units.slice(1), unit('ny', 'Ny enhet'), unit('okand', 'Okänd')],
          [lost, { ...bo, department: 'ny' }, ...rest],
        ),
        scope,
      );
      expect(right).toMatchObject({ groupsRemoved: 1, refused: [], groupsRefused: [] });
      expect([grantOf('anna'), grantOf('bo')]).toMatchObject([
        { unitId: 'okand', role: 'manager' },
        { unitId: 'ny', role: 'employee' },
      ]);
      expect(held(store, 'bo').enabled).toBe(true);
      expect(holders(store, 'unit:gammal')).toBeUndefined();
    });
    test("a group only people's rows give that cannot be written is that group's alone under exact capability keys: a capability written wrong, and the managers of a unit the directory does not list", async () => {
      const { client, grantOf } = stack();
      // The development writer's keys: units and their managers under `unit-`, and each capability by its exact key.
      const units = ['a', 'b', 'c', 'd', 'e'].map(id => unit('unit-' + id, 'Enhet ' + id));
      const anna = someone('dev:1', 'anna', 'unit-a', { manager: true, capabilities: ['admin.users'] }),
        ada = someone('dev:2', 'ada', 'unit-a', { manager: true, capabilities: ['admin.users'] }),
        bo = someone('dev:3', 'bo', 'unit-b'),
        chef = someone('dev:4', 'chef', 'unit-c', { manager: true }),
        rest = ['b', 'd', 'e'].map((id, n) => someone('dev:' + (n + 5), 'chef-' + id, 'unit-' + id, { manager: true }));
      await reconcile(client, source(units, [anna, ada, bo, chef, ...rest]), developmentScope);
      // Anna steps down and gives the capability back. Beside her, Bo's capability is written wrong (twice on his row,
      // and he is named once), and the unit Chef manages is written without its prefix, so the export names a unit it
      // does not list.
      const typo = 'admin.user' as Capability,
        log: string[] = [];
      const bad = await reconcile(
        client,
        source(units, [
          { ...anna, manager: false, capabilities: [] },
          ada,
          { ...bo, capabilities: [typo, typo] },
          { ...chef, department: 'c' },
          ...rest,
        ]),
        developmentScope,
        { log: line => log.push(line) },
      );
      expect(bad).toEqual({
        created: 0,
        replaced: 7,
        deactivated: 0,
        groupsCreated: 0,
        groupsReplaced: 10,
        groupsRemoved: 1,
        refused: [],
        groupsRefused: [
          {
            externalId: 'unit:c',
            detail: "The directory does not list the unit 'c', which an active person names: chef.",
          },
          {
            externalId: 'capability:admin.user',
            detail: "Group 'capability:admin.user' is outside the source namespace, and an active person is in it: bo.",
          },
          {
            externalId: 'unit-manager:c',
            detail: "The directory does not list the unit 'c', which an active person manages: chef.",
          },
        ],
      });
      // The role and the capability Anna gave back are gone, and nobody gains what was written wrong.
      expect([grantOf('anna'), grantOf('ada'), grantOf('bo')]).toMatchObject([
        { unitId: 'unit-a', role: 'employee', capabilities: [] },
        { unitId: 'unit-a', role: 'manager', capabilities: ['admin.users'] },
        { unitId: 'unit-b', role: 'employee', capabilities: [] },
      ]);
      // Chef stays on the unit Clew holds him on until the one the source names is written; his role there goes, as
      // the source says.
      expect(grantOf('chef')).toMatchObject({ unitId: 'unit-c', role: 'employee' });
      expect(log).toContain('removed group unit-manager:unit-c');
      // The export put right: Bo has the capability and Chef the unit and its managers' group again.
      const right = await reconcile(
        client,
        source(units, [
          { ...anna, manager: false, capabilities: [] },
          ada,
          { ...bo, capabilities: ['admin.users'] },
          chef,
          ...rest,
        ]),
        developmentScope,
      );
      expect(right).toMatchObject({ groupsCreated: 1, refused: [], groupsRefused: [] });
      expect([grantOf('bo')?.capabilities, grantOf('chef')]).toMatchObject([
        ['admin.users'],
        { unitId: 'unit-c', role: 'manager' },
      ]);
    });
    test('somebody placed on a unit that was written loses the units the source withdrew, though another unit the source gives them was not written', async () => {
      const { store, client, grantOf } = stack();
      const units = ['a', 'b', 'c', 'd', 'e'].map(id => unit(id, 'Enhet ' + id));
      const anna = someone('e-1', 'anna', 'a'),
        bo = someone('e-2', 'bo', 'a'),
        rest = [someone('e-3', 'cia', 'c', { manager: true }), someone('e-4', 'dan', 'd'), someone('e-5', 'eva', 'e')];
      await reconcile(client, source(units, [anna, bo, ...rest]), scope);
      // Anna moves to B and also works on a unit the export does not list. Bo moves to a unit it does not list and
      // manages C beside Cia, which is a place as well: he is a manager of a unit Clew holds.
      const summary = await reconcile(
        client,
        source(units, [
          { ...anna, department: 'b', alsoIn: ['okand'] },
          { ...bo, department: 'saknas', alsoManages: ['c'] },
          ...rest,
        ]),
        scope,
      );
      expect(summary).toMatchObject({
        refused: [],
        groupsRefused: [
          {
            externalId: 'unit:okand',
            detail: "The directory does not list the unit 'okand', which an active person names: anna.",
          },
          {
            externalId: 'unit:saknas',
            detail: "The directory does not list the unit 'saknas', which an active person names: bo.",
          },
        ],
      });
      // Neither of them is held on the unit the source took them off: they are on a unit Clew holds.
      expect(['unit:a', 'unit:b', 'unit-manager:c'].map(key => holders(store, key))).toEqual([
        [],
        ['anna'],
        ['bo', 'cia'],
      ]);
      expect([grantOf('anna'), grantOf('bo')]).toMatchObject([
        { unitId: 'b', role: 'employee' },
        { unitId: 'c', role: 'manager' },
      ]);
    });
    test('a newcomer the source places only on units that were not written is not created until one is, and is reported', async () => {
      const { store, client, grantOf } = stack();
      const units = [unit('a', 'A')],
        anna = someone('e-1', 'anna', 'a'),
        bo = someone('e-2', 'bo', 'okand');
      await reconcile(client, source(units, [anna]), scope);
      const first = await reconcile(client, source(units, [anna, bo]), scope);
      expect(first).toMatchObject({
        created: 0,
        replaced: 1,
        refused: [
          {
            externalId: 'e-2',
            userName: 'bo',
            detail: 'Not created: no unit the source places this person on was written, so they are not placed yet.',
          },
        ],
        groupsRefused: [{ externalId: 'unit:okand' }],
      });
      expect([...store.state.users.values()].some(u => u.userName === 'bo')).toBe(false);
      // Put right, Bo is created on his unit.
      const right = await reconcile(client, source([...units, unit('okand', 'Okänd')], [anna, bo]), scope);
      expect(right).toMatchObject({ created: 1, refused: [], groupsRefused: [] });
      expect(grantOf('bo')).toMatchObject({ unitId: 'okand', role: 'employee' });
    });
    test("a unit whose new name Clew refuses, or that stands below a unit that was not written, keeps its name and its place, and so does its managers' group, and each is reported once", async () => {
      const { store, client } = stack();
      const label = (key: string) => [...store.state.groups.values()].find(g => g.externalId === key)?.label;
      const people = [
        someone('e-1', 'anna', 'a', { manager: true }),
        someone('e-2', 'bo', 'b', { manager: true }),
        someone('e-3', 'cia', 'c'),
      ];
      await reconcile(
        client,
        source(
          [unit('kommun', 'Kommunen'), unit('a', 'A', 'kommun'), unit('b', 'B', 'kommun'), unit('c', 'C', 'b')],
          people,
        ),
        scope,
      );
      // A loses its name, and B is renamed and moved below a new unit without a name, which Cia is to manage as well.
      const summary = await reconcile(
        client,
        source(
          [
            unit('kommun', 'Kommunen'),
            unit('a', '   ', 'kommun'),
            unit('x', '  ', 'kommun'),
            unit('b', 'B, nytt namn', 'x'),
            unit('c', 'C', 'b'),
          ],
          people.map(p => (p.userName === 'cia' ? { ...p, alsoManages: ['x'] } : p)),
        ),
        scope,
      );
      const blank = "Attribute 'displayName' needs a non-empty string of at most 512 characters.";
      expect(summary.groupsRefused).toEqual([
        { externalId: 'unit:a', detail: blank },
        { externalId: 'unit:x', detail: blank },
        { externalId: 'unit:b', detail: "The unit above it, 'unit:x', was not written." },
        { externalId: 'unit-manager:x', detail: "The unit 'unit:x' was not written." },
      ]);
      expect(['unit:a', 'unit-manager:a', 'unit:b', 'unit-manager:b'].map(label)).toEqual([
        'A',
        'Chefer · A',
        'B',
        'Chefer · B',
      ]);
      expect(parentOf(store, 'unit:b')).toBe('kommun');
    });
    test('two people who held one account name in turn have both left: the first keeps the name Clew holds it under, and nothing is refused', async () => {
      for (const second of ['kept', 'dropped'] as const) {
        const { store, client } = stack();
        const names = () =>
          Object.fromEntries([...store.state.users.values()].map(u => [u.externalId, [u.userName, u.enabled]]));
        const bo = someone('e-9', 'bo', 'a'),
          units = [unit('a', 'A')];
        await reconcile(client, source(units, [someone('e-1', 'anna', 'a'), bo]), scope);
        // Anna leaves and her name goes to a newcomer, so her row is parked under its own id.
        await reconcile(
          client,
          source(units, [someone('e-1', 'anna', 'a', { active: false }), someone('e-2', 'anna', 'a'), bo]),
          scope,
        );
        // The newcomer leaves as well. The source keeps the first row, and the second one too or not at all.
        const both = source(units, [
          someone('e-1', 'anna', 'a', { active: false }),
          ...(second === 'kept' ? [someone('e-2', 'anna', 'a', { active: false })] : []),
          bo,
        ]);
        expect(await reconcile(client, both, scope)).toMatchObject({ deactivated: 1, refused: [] });
        expect(names()).toEqual({ 'e-1': ['e-1', false], 'e-2': ['anna', false], 'e-9': ['bo', true] });
        // And every run after it is silent.
        const audited = store.state.audit.length;
        expect((await reconcile(client, both, scope)).refused).toEqual([]);
        expect(store.state.audit.length).toBe(audited);
      }
    });
    test('a reused account name reaches its new holder even when another person signs in under the leaver’s source id', async () => {
      for (const keepLeaver of [false, true]) {
        const { store, client } = stack();
        const units = [unit('a', 'A')],
          leaver = someone('e-1', 'anna', 'a'),
          remaining = someone('e-2', 'E-1', 'a');
        await reconcile(client, source(units, [leaver, remaining]), scope);
        const oldId = held(store, 'anna').id;
        const next = source(units, [
          ...(keepLeaver ? [{ ...leaver, active: false }] : []),
          remaining,
          someone('e-3', 'anna', 'a'),
          someone('e-4', 'CLEW-PARKED-1', 'a'),
        ]);
        expect(await reconcile(client, next, scope)).toMatchObject({ created: 2, deactivated: 1, refused: [] });
        expect(held(store, 'anna')).toMatchObject({ externalId: 'e-3', enabled: true });
        expect(held(store, 'E-1')).toMatchObject({ externalId: 'e-2', enabled: true });
        expect(held(store, 'CLEW-PARKED-1')).toMatchObject({ externalId: 'e-4', enabled: true });
        const parked = store.state.users.get(oldId)!;
        expect(parked).toMatchObject({ externalId: 'e-1', enabled: false });
        const auditCount = store.state.audit.length;
        expect(await reconcile(client, next, scope)).toMatchObject({ created: 0, deactivated: 0, refused: [] });
        expect(store.state.users.get(oldId)?.userName).toBe(parked.userName);
        expect(store.state.audit.length).toBe(auditCount);
      }
    });
    test('a temporary name held in another organisation is retried, and only the confirmed name is kept', async () => {
      for (const keepLeaver of [false, true]) {
        const { store, client, app } = stack();
        store.state.provisioners.set('digest:other-token', { id: 'other', organisationId: 'other', label: 'Other' });
        const other = scimClient('http://clew.local', 'other-token', (url, init) => app.request(url, init));
        const heldNames = ['e-2', 'CLEW-PARKED-1', 'claimed-account'];
        await reconcile(
          other,
          source(
            [unit('z', 'Z')],
            heldNames.map((name, i) => someone('o-' + i, name, 'z')),
          ),
          {
            ...scope,
            userPrefix: 'o-',
          },
        );
        expect((await client.request('GET', '/Users')).body.totalResults).toBe(0);
        const units = [unit('a', 'A')],
          first = someone('e-1', 'anna', 'a'),
          second = someone('e-2', 'bo', 'a'),
          stays = someone('e-3', 'cia', 'a');
        await reconcile(client, source(units, [first, second, stays]), scope);
        const next = source(units, [
          ...(keepLeaver
            ? [
                { ...first, active: false },
                { ...second, active: false },
              ]
            : []),
          stays,
          someone('e-4', 'anna', 'a'),
          someone('e-5', 'bo', 'a'),
          // e-1 is taken in the visible plan. The fallback numbered name is taken in the invisible organisation.
          someone('e-6', 'E-1', 'a'),
        ]);
        expect(await reconcile(client, next, scope, { force: true })).toMatchObject({
          created: 3,
          deactivated: 2,
          refused: [],
        });
        for (const [i, name] of heldNames.entries())
          expect(held(store, name)).toMatchObject({ organisationId: 'other', externalId: 'o-' + i, enabled: true });
        expect(held(store, 'anna')).toMatchObject({ externalId: 'e-4', enabled: true });
        expect(held(store, 'bo')).toMatchObject({ externalId: 'e-5', enabled: true });
        const users = [...store.state.users.values()];
        for (const old of [first, second])
          expect(users.find(u => u.externalId === old.externalId)).toMatchObject({ enabled: false });
        const audited = store.state.audit.length;
        expect(await reconcile(client, next, scope)).toMatchObject({ created: 0, deactivated: 0, refused: [] });
        expect(store.state.audit.length).toBe(audited);
        // The missing person really was given a name already held elsewhere. Their requested name cannot be changed.
        const conflict = await reconcile(
          client,
          { ...next, people: [...next.people, someone('e-7', 'claimed-account', 'a')] },
          scope,
        );
        expect(conflict.refused).toEqual([
          { externalId: 'e-7', userName: 'claimed-account', detail: 'A user with this userName already exists.' },
        ]);
        expect([...store.state.users.values()].some(u => u.externalId === 'e-7')).toBe(false);
      }
    });
    test('parking reports a persistent uniqueness conflict after four attempts and a different refusal immediately', async () => {
      for (const [scimType, attempts] of [
        ['uniqueness', 4],
        ['mutability', 1],
      ] as const) {
        const { store, client } = stack();
        const units = [unit('a', 'A')],
          stays = someone('e-2', 'bo', 'a');
        await reconcile(client, source(units, [someone('e-1', 'anna', 'a'), stays]), scope);
        const path = '/Users/' + held(store, 'anna').id;
        // This SCIM endpoint rejects each temporary rename. Deactivation and the rest of the run reach Clew.
        const names: string[] = [];
        const refuses: ScimClient = {
          async request(method, url, body) {
            if (
              method === 'PATCH' &&
              url === path &&
              body &&
              typeof body === 'object' &&
              'Operations' in body &&
              Array.isArray(body.Operations) &&
              body.Operations[0]?.path === 'userName'
            ) {
              names.push(body.Operations[0].value);
              throw new ScimClientError(409, scimType, 'Parking refused.', null);
            }
            return client.request(method, url, body);
          },
        };
        const result = await reconcile(refuses, source(units, [stays, someone('e-3', 'anna', 'a')]), scope);
        expect(names).toHaveLength(attempts);
        expect(new Set(names).size).toBe(attempts);
        expect(result.refused).toContainEqual({ externalId: 'e-1', userName: 'anna', detail: 'Parking refused.' });
        expect(held(store, 'anna')).toMatchObject({ externalId: 'e-1', enabled: false });
        expect([...store.state.users.values()].some(u => u.externalId === 'e-3')).toBe(false);
      }
    });
    test('two leavers the source renames to one name, while somebody new is given the name they held in turn: nothing is refused, and the newcomer has it', async () => {
      // The first leaver is renamed the run she leaves, or kept with the old name until both are.
      for (const first of ['renamed at once', 'renamed later'] as const) {
        const { store, client } = stack();
        const names = () =>
          Object.fromEntries([...store.state.users.values()].map(u => [u.externalId, [u.userName, u.enabled]]));
        const units = [unit('a', 'A')],
          bo = someone('e-9', 'bo', 'a'),
          gone = (externalId: string, userName: string) => someone(externalId, userName, 'a', { active: false });
        const runs: Directory[] = [
          source(units, [someone('e-1', 'asve', 'a'), bo]),
          source(units, [
            gone('e-1', first === 'renamed at once' ? 'asve-old' : 'asve'),
            someone('e-2', 'asve', 'a'),
            bo,
          ]),
          source(units, [gone('e-1', 'asve-old'), gone('e-2', 'asve-old'), someone('e-3', 'asve', 'a'), bo]),
        ];
        for (const run of runs) expect([first, (await reconcile(client, run, scope)).refused]).toEqual([first, []]);
        expect([first, names()['e-3']]).toEqual([first, ['asve', true]]);
        expect([first, names()['e-1']![1], names()['e-2']![1]]).toEqual([first, false, false]);
        // And every run after it is silent.
        const audited = store.state.audit.length;
        expect((await reconcile(client, runs[2]!, scope)).refused).toEqual([]);
        expect([first, store.state.audit.length]).toEqual([first, audited]);
      }
    });
    test('a row another writer shifts between two pages of a read is counted once, and one it hides is found by its key', async () => {
      const { store, client, app } = stack();
      const units = ['a', 'b', 'c', 'd', 'e'].map(id => unit(id, 'Enhet ' + id));
      const people = ['anna', 'bo', 'cia', 'dan', 'eva', 'fia'].map((name, n) =>
        someone('e-' + (n + 1), name, units[n % units.length]!.id),
      );
      await reconcile(client, source(units, people), scope);
      const sent: string[] = [];
      /** A list as the server could page it while another writer works: `shown` decides what each page shows. */
      const paging = (shown: (rows: Array<{ externalId?: string }>) => unknown[]): ScimClient => ({
        async request(method, path, body) {
          sent.push(`${method} ${path.split('?')[0]}`);
          const response = await client.request(method, path, body);
          if (method !== 'GET' || !path.includes('startIndex=')) return response;
          return { ...response, body: { ...response.body, Resources: shown(response.body.Resources) } };
        },
      });
      // Every row comes round twice, as a writer that adds rows ahead of them while they are read shifts them.
      const twice = paging(rows => [...rows, ...rows]);
      // Eva leaves, and the unit she was the only one on with her.
      const staying = people.filter(p => p.userName !== 'eva');
      expect(await reconcile(twice, source(units.slice(0, 4), staying), scope)).toMatchObject({
        deactivated: 1,
        groupsRemoved: 1,
        refused: [],
        groupsRefused: [],
      });
      expect([
        sent.filter(request => request.startsWith('PATCH /Users/')).length,
        sent.filter(request => request.startsWith('DELETE ')).length,
      ]).toEqual([1, 1]);
      // The check reads the same way, and counts every row once.
      const findings = (
        await checkProvisioning('http://clew.local', twice, (input, init) => app.request(input, init))
      ).map(f => f.text);
      expect(findings).toContain('6 users: 5 active, 1 deactivated.');
      expect(findings).toContain(
        '4 groups: 4 unit, 0 unit-manager, 0 capability, 0 position, 0 plain (0 without an externalId).',
      );
      // A unit and a person Clew holds are missing from the read, as a writer that removes rows ahead of them would
      // have them slip past. Each is found by its key, and nothing is created twice or refused.
      const hidden = paging(rows => rows.filter(r => r.externalId !== 'unit:b' && r.externalId !== 'e-2'));
      sent.length = 0;
      const renamed = await reconcile(
        hidden,
        source(
          units.slice(0, 4).map(u => (u.id === 'b' ? { ...u, label: 'Enhet b, ny' } : u)),
          staying.map(p => (p.userName === 'bo' ? { ...p, email: 'bosse@clew.test' } : p)),
        ),
        scope,
      );
      expect(renamed).toMatchObject({
        created: 0,
        replaced: 5,
        groupsCreated: 0,
        groupsReplaced: 4,
        refused: [],
        groupsRefused: [],
      });
      expect(sent).not.toContain('POST /Groups');
      expect([...store.state.groups.values()].find(g => g.externalId === 'unit:b')?.label).toBe('Enhet b, ny');
      expect(held(store, 'bo').email).toBe('bosse@clew.test');
    });
    test('a create that meets a row another writer has just written patches that row, and a removal another writer made first is done', async () => {
      const { store, client, grantOf } = stack();
      const units = ['a', 'b', 'c', 'd', 'e'].map(id => unit(id, 'Enhet ' + id));
      const anna = someone('e-1', 'anna', 'a'),
        bo = someone('e-2', 'bo', 'e');
      await reconcile(client, source(units, [anna, bo]), scope);
      const log: string[] = [];
      const racing: ScimClient = {
        async request(method, path, body) {
          const key = (body as { externalId?: string } | undefined)?.externalId;
          // Another writer creates the new unit and the capability group the moment before this run does,
          if (method === 'POST' && path === '/Groups' && (key === 'unit:f' || key === 'capability:admin.users'))
            await client.request('POST', '/Groups', { externalId: key, displayName: 'Another writer' });
          // and removes the unit this run removes the moment before it does.
          if (method === 'DELETE') await client.request('DELETE', path);
          return client.request(method, path, body);
        },
      };
      const summary = await reconcile(
        racing,
        source(
          [...units.slice(0, 4), unit('f', 'Enhet f', 'a')],
          [
            { ...anna, capabilities: ['admin.users'] },
            { ...bo, department: 'f' },
          ],
        ),
        scope,
        { log: line => log.push(line) },
      );
      expect(summary).toMatchObject({
        groupsCreated: 0,
        groupsReplaced: 6,
        groupsRemoved: 1,
        refused: [],
        groupsRefused: [],
      });
      expect([...store.state.groups.values()].find(g => g.externalId === 'unit:f')).toMatchObject({
        label: 'Enhet f',
        parentUnitId: 'a',
      });
      expect([grantOf('anna'), grantOf('bo')]).toMatchObject([
        { unitId: 'a', capabilities: ['admin.users'] },
        { unitId: 'f' },
      ]);
      expect(log).toContain('group unit:e was removed already');
      expect(holders(store, 'unit:e')).toBeUndefined();
    });
    for (const cleanup of [
      'refused removal',
      'group missed between pages',
      'refused verification',
      'successful fallback',
    ] as const)
      test(`a returner's current memberships decide reactivation after ${cleanup}`, async () => {
        const { store, client } = stack();
        const units = [unit('a', 'A')];
        const anna = someone('e-1', 'anna', 'a', { groups: ['ad:old'] });
        const bo = someone('e-2', 'bo', 'a');
        const oldGroup = { id: 'ad:old', label: 'Former duty' };
        await reconcile(client, source(units, [anna, bo], [oldGroup]), scope);
        const annaId = ekonomiId(store, anna.externalId),
          boId = ekonomiId(store, bo.externalId);
        const oldId = [...store.state.groups.values()].find(g => g.externalId === oldGroup.id)!.id;
        await client.request('DELETE', '/Users/' + annaId);
        await client.request('DELETE', '/Users/' + boId);
        // Bo also belongs to a group managed by another writer. His return is independent of Anna's cleanup.
        await client.request('POST', '/Groups', {
          displayName: 'Other directory',
          externalId: 'other:team',
          members: [{ value: boId }],
        });
        const returning = source(units, [{ ...anna, groups: [] }, bo], cleanup === 'refused removal' ? [oldGroup] : []);
        const partial: ScimClient = {
          async request(method, path, body) {
            if (cleanup === 'refused removal' && method === 'PATCH' && path === '/Groups/' + oldId)
              throw new ScimClientError(400, 'invalidValue', 'Membership removal refused.', null);
            if (cleanup === 'successful fallback' && method === 'DELETE' && path === '/Groups/' + oldId)
              throw new ScimClientError(409, undefined, 'Group retained.', null);
            if (
              cleanup === 'refused verification' &&
              method === 'GET' &&
              path === `/Users/${annaId}?attributes=groups.value`
            )
              throw new ScimClientError(400, 'invalidValue', 'Memberships unavailable.', null);
            const result = await client.request(method, path, body);
            if (
              cleanup === 'group missed between pages' &&
              method === 'GET' &&
              path.startsWith('/Groups?') &&
              path.includes('startIndex=')
            )
              return {
                ...result,
                body: {
                  ...result.body,
                  Resources: result.body.Resources.filter((g: { id: string }) => g.id !== oldId),
                },
              };
            return result;
          },
        };
        const summary = await reconcile(partial, returning, scope, { force: true });
        const verified = cleanup === 'successful fallback';
        expect(store.state.members.has(memberKey(oldId, annaId))).toBe(
          cleanup === 'refused removal' || cleanup === 'group missed between pages',
        );
        expect(summary.refused.map(person => person.externalId)).toEqual(verified ? [] : [anna.externalId]);
        expect(store.state.users.get(annaId)?.enabled).toBe(verified);
        expect(store.state.users.get(boId)?.enabled).toBe(true);
        expect(
          store.state.audit
            .filter(row => row.action === 'scim.user.reactivated')
            .map(row => row.subject)
            .sort(),
        ).toEqual((verified ? ['person:' + annaId, 'person:' + boId] : ['person:' + boId]).sort());
        await reconcile(client, returning, scope, { force: true });
        expect(store.state.users.get(annaId)?.enabled).toBe(true);
        expect(store.state.members.has(memberKey(oldId, annaId))).toBe(false);
      });
    test('somebody the read misses who returns is made active only once the duties the source withdrew are gone', async () => {
      const { store, client } = stack();
      const units = ['a', 'b', 'c', 'd', 'e'].map(id => unit(id, 'Enhet ' + id));
      const anna = someone('e-1', 'anna', 'a', { capabilities: ['admin.users'] }),
        rest = [
          someone('e-2', 'bo', 'b', { capabilities: ['admin.users'] }),
          ...['cia', 'dan', 'eva'].map((name, n) => someone('e-' + (n + 3), name, units[n + 2]!.id)),
        ];
      await reconcile(client, source(units, [anna, ...rest]), scope);
      // A provisioner that only deactivates: Anna leaves and stays in every group she was in.
      const id = ekonomiId(store, 'e-1'),
        capability = [...store.state.groups.values()].find(g => g.externalId === 'capability:admin.users')!.id,
        holds = () => store.state.members.has(memberKey(capability, id));
      await client.request('PATCH', '/Users/' + id, {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [{ op: 'replace', path: 'active', value: false }],
      });
      // She returns without the capability, and the read of the users misses her, as a second writer can have it.
      const events: string[] = [];
      const hiding: ScimClient = {
        async request(method, path, body) {
          if (method === 'PUT' && path === '/Users/' + id && (body as { active?: boolean }).active)
            events.push(holds() ? 'activated with the capability' : 'activated');
          const response = await client.request(method, path, body);
          if (method === 'PATCH' && path === '/Groups/' + capability && !holds()) events.push('capability taken back');
          if (method !== 'GET' || !path.startsWith('/Users?') || !path.includes('startIndex=')) return response;
          const Resources = response.body.Resources.filter((r: { id: string }) => r.id !== id);
          return { ...response, body: { ...response.body, Resources } };
        },
      };
      const summary = await reconcile(hiding, source(units, [{ ...anna, capabilities: [] }, ...rest]), scope);
      expect(summary).toMatchObject({ created: 0, replaced: 5, deactivated: 0, refused: [], groupsRefused: [] });
      expect(events).toEqual(['capability taken back', 'activated']);
      expect([store.state.users.get(id)?.enabled, store.state.grants.get(id)]).toMatchObject([
        true,
        { unitId: 'a', capabilities: [] },
      ]);
    });
    test('a name Clew will not move off a leaver is reported, with the newcomer who was to have it, and everything else is done', async () => {
      const { store, client } = stack();
      const units = [unit('a', 'A')],
        people = ['anna', 'bo', 'cia', 'dan', 'eva'].map((name, n) => someone('e-' + (n + 1), name, 'a'));
      await reconcile(client, source(units, people), scope);
      const anna = ekonomiId(store, 'e-1');
      const refusing: ScimClient = {
        async request(method, path, body) {
          const operations = (body as { Operations?: Array<{ path?: string }> } | undefined)?.Operations;
          if (method === 'PATCH' && path === '/Users/' + anna && operations?.some(o => o.path === 'userName'))
            throw new ScimClientError(400, 'invalidValue', 'Refused for the test.', null);
          return client.request(method, path, body);
        },
      };
      // Anna leaves and her name goes to somebody new, and Bo has a new address.
      const summary = await reconcile(
        refusing,
        source(units, [
          ...people.slice(1).map(p => (p.userName === 'bo' ? { ...p, email: 'bosse@clew.test' } : p)),
          someone('e-6', 'anna', 'a'),
        ]),
        scope,
      );
      expect(summary).toMatchObject({
        created: 0,
        replaced: 4,
        deactivated: 1,
        refused: [
          { externalId: 'e-1', userName: 'anna', detail: 'Refused for the test.' },
          { externalId: 'e-6', userName: 'anna', detail: 'A user with this userName already exists.' },
        ],
        groupsRefused: [],
      });
      expect([held(store, 'anna').enabled, held(store, 'bo').email]).toEqual([false, 'bosse@clew.test']);
    });
    test('the check counts the active people in a group, and warns of who has left still holding a duty or a plain group, and of a capability outside the list (D85, D96)', async () => {
      const { store, client, app } = stack();
      // A provisioner that only deactivates: who leaves stays in every group they were in.
      const person = async (userName: string) =>
        (
          await client.request('POST', '/Users', {
            externalId: 'e-' + userName,
            userName,
            displayName: userName,
            emails: [{ value: userName + '@clew.test', type: 'work' }],
          })
        ).body.id as string;
      const chef = await person('chef'),
        former = await person('former'),
        gone = await person('gone');
      const group = (externalId: string, ...members: string[]) =>
        client.request('POST', '/Groups', {
          externalId,
          displayName: externalId,
          members: members.map(value => ({ value })),
        });
      await group('unit:skola', chef);
      await group('unit-manager:skola', chef, former);
      await group('unit:kansli', former);
      await group('capability:admin.users', former);
      await group('ad:nyhetsbrev', gone, chef);
      for (const id of [former, gone]) await client.request('DELETE', '/Users/' + id);
      // Stored before the server began refusing them (D96): a reserved word in another case, and a capability name the
      // check's copy of the closed list does not hold (D85), which the installation may know if it is newer.
      for (const [id, externalId] of [
        ['legacy', 'Capability:admin.users'],
        ['unknown', 'capability:admin.everything'],
      ])
        store.state.groups.set(id!, {
          id: id!,
          organisationId: 'poc',
          parentUnitId: null,
          externalId: externalId!,
          label: 'Stored before D96',
          createdAt: '2026-11-09T06:00:00.000Z',
          updatedAt: '2026-11-09T06:00:00.000Z',
        });
      const findings = await checkProvisioning('http://clew.local', client, (input, init) => app.request(input, init));
      expect(findings.filter(f => f.level === 'ok').map(f => f.text)).toContain(
        '7 groups: 2 unit, 1 unit-manager, 1 capability, 0 position, 1 plain (0 without an externalId), 1 with a key written wrong and 1 with a capability the check does not know.',
      );
      expect(findings.filter(f => f.level === 'warn').map(f => f.text)).toEqual([
        '1 unit or unit-manager group has no active members: unit:kansli.',
        '1 deactivated user is still in unit-manager: or capability: groups, and making the user active again gives those duties back at once: former (unit-manager:skola, capability:admin.users).',
        '1 deactivated user is still in plain groups, and a group an administrator maps to a capability gives it back when the user is made active again: gone.',
        "1 group carries a key that is written wrong, so Clew reads it as a plain group, which gives nobody anything unless an administrator maps it to a capability: 'Capability:admin.users'.",
        "1 group names a capability the check does not know, so it gives nobody anything unless the installation is newer than the check's copy of packages/contracts/src/scim-group-key.ts, or an administrator maps it to a capability: 'capability:admin.everything'.",
      ]);
      // With only one of the two, the counts end as they did.
      store.state.groups.delete('legacy');
      expect(
        (await checkProvisioning('http://clew.local', client, (input, init) => app.request(input, init))).map(
          f => f.text,
        ),
      ).toContain(
        '6 groups: 2 unit, 1 unit-manager, 1 capability, 0 position, 1 plain (0 without an externalId) and 1 with a capability the check does not know.',
      );
    });
    test('a unit key with space after the prefix or at the end, stored before D96, places and leads nobody, and the check says what Clew does with it (D96)', async () => {
      const { store, client, app, grantOf } = stack();
      const person = async (userName: string) =>
        (
          await client.request('POST', '/Users', {
            externalId: 'e-' + userName,
            userName,
            displayName: userName,
            emails: [{ value: userName + '@clew.test', type: 'work' }],
          })
        ).body.id as string;
      const chef = await person('chef'),
        anna = await person('anna');
      await client.request('POST', '/Groups', {
        externalId: 'unit:skola',
        displayName: 'Skolan',
        members: [{ value: chef }],
      });
      // Stored before the server began refusing them (D96), each with a member: the managers' group of the same unit
      // with a space after the prefix, and a unit group with a space at the end that Anna is in and nothing else.
      for (const [id, externalId, member] of [
        ['spaced', 'unit-manager: skola', chef],
        ['trailing', 'unit:skola ', anna],
      ] as const) {
        store.state.groups.set(id, {
          id,
          organisationId: 'poc',
          parentUnitId: null,
          externalId,
          label: 'Stored before D96',
          createdAt: '2026-11-09T06:00:00.000Z',
          updatedAt: '2026-11-09T06:00:00.000Z',
        });
        store.state.members.add(memberKey(id, member));
      }
      // A write of each person derives them: Chef is an employee of the unit the key written right names, and leads
      // nothing, and Anna is on no unit, so she can do nothing.
      const titled = (id: string) =>
        client.request('PATCH', '/Users/' + id, {
          schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
          Operations: [{ op: 'replace', path: 'title', value: 'Lärare' }],
        });
      for (const id of [chef, anna]) await titled(id);
      const employee = { unitId: 'skola', unitLabel: 'Skolan', role: 'employee' as const, capabilities: [] };
      expect([grantOf('chef'), store.state.assignments.get(chef)]).toEqual([
        employee,
        [{ unitId: 'skola', role: 'employee' }],
      ]);
      expect([grantOf('anna'), store.state.assignments.get(anna) ?? []]).toEqual([undefined, []]);
      const check = async () =>
        (await checkProvisioning('http://clew.local', client, (input, init) => app.request(input, init))).filter(
          f => f.level !== 'ok' || f.text.includes('groups:'),
        );
      const counted =
          '3 groups: 1 unit, 0 unit-manager, 0 capability, 0 position, 0 plain (0 without an externalId) and 2 with a key written wrong.',
        unplaced = '1 active user has no unit: or unit-manager: group and can do nothing in Clew: anna.',
        harmless =
          "2 groups carry a key that is written wrong, so Clew reads them as plain groups, which give nobody anything unless an administrator maps them to a capability: 'unit-manager: skola', 'unit:skola '.";
      // Nobody leads the unit either, so the people on it report to nobody.
      expect((await check()).map(f => f.text)).toEqual([
        counted,
        unplaced,
        '1 unit has people and no manager, on the unit or on any unit above it, so its people report to nobody: unit:skola.',
        harmless,
      ]);
      // Chef leaves and returns: what the key written wrong never gave is no duty a leaver holds, and the return gives
      // back the unit and nothing more. The group is a plain group to Clew, so Chef is named among the leavers still in
      // one, which an administrator may map to a capability.
      await client.request('DELETE', '/Users/' + chef);
      expect((await check()).map(f => f.text)).toEqual([
        counted,
        unplaced,
        '1 unit or unit-manager group has no active members: unit:skola.',
        '1 deactivated user is still in plain groups, and a group an administrator maps to a capability gives it back when the user is made active again: chef.',
        harmless,
      ]);
      await client.request('PATCH', '/Users/' + chef, {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [{ op: 'replace', path: 'active', value: true }],
      });
      expect([grantOf('chef'), store.state.assignments.get(chef)]).toEqual([
        employee,
        [{ unitId: 'skola', role: 'employee' }],
      ]);
    });
    test('a group whose key is written wrong, or names a capability the check does not know, gives what an administrator maps to it, and the check names a leaver still in one (D85, D96)', async () => {
      const { store, client, app, grantOf } = stack();
      const person = async (userName: string) =>
        (
          await client.request('POST', '/Users', {
            externalId: 'e-' + userName,
            userName,
            displayName: userName,
            emails: [{ value: userName + '@clew.test', type: 'work' }],
          })
        ).body.id as string;
      const chef = await person('chef'),
        kim = await person('kim');
      await client.request('POST', '/Groups', {
        externalId: 'unit:skola',
        displayName: 'Skolan',
        members: [{ value: chef }, { value: kim }],
      });
      // Stored before the server began refusing them (D96), each with a member: a managers' key with a space after the
      // prefix, which Clew reads as no key, and a capability name the closed list does not hold.
      for (const [id, externalId, member] of [
        ['spaced', 'unit-manager: skola', chef],
        ['unknown', 'capability:admin.everything', kim],
      ] as const) {
        store.state.groups.set(id, {
          id,
          organisationId: 'poc',
          parentUnitId: null,
          externalId,
          label: 'Stored before D96',
          createdAt: '2026-11-09T06:00:00.000Z',
          updatedAt: '2026-11-09T06:00:00.000Z',
        });
        store.state.members.add(memberKey(id, member));
      }
      // The group picker offers each, and an administrator maps each to a capability, as any plain group (D85).
      const admin = usersAdminUsecases({
          store,
          clock: () => new Date('2026-11-09T06:00:00.000Z'),
          token: () => 'token',
          digest: token => 'digest:' + token,
        }),
        administrator = {
          id: 'admin-poc',
          name: 'Admin',
          organisationId: 'poc',
          unitId: 'u',
          unitLabel: 'U',
          role: 'employee',
          capabilities: ['admin.users'],
          principal: { id: 'person:admin-poc', kind: 'person' },
          authorizationVersion: 'v1',
          sessionBinding: 'test',
          expiresAt: '2099-01-01T00:00:00Z',
          authorize: async () => ({ version: 'v1' }),
        } as AuthenticatedContext;
      expect((await admin.searchGroups(administrator, 'stored')).groups.map(g => g.id)).toEqual([
        'capability:admin.everything',
        'unit-manager: skola',
      ]);
      await admin.addGroupCapability(administrator, {
        groupExternalId: 'unit-manager: skola',
        capability: 'admin.connectors',
      });
      await admin.addGroupCapability(administrator, {
        groupExternalId: 'capability:admin.everything',
        capability: 'admin.appearance',
      });
      const mapped = () => [grantOf('chef')?.capabilities, grantOf('kim')?.capabilities];
      expect(mapped()).toEqual([['admin.connectors'], ['admin.appearance']]);
      // Both leave, under a provisioner that only deactivates: the check names them as it names a leaver still in a
      // plain group, since it cannot see what an administrator has mapped.
      for (const id of [chef, kim]) await client.request('DELETE', '/Users/' + id);
      const findings = await checkProvisioning('http://clew.local', client, (input, init) => app.request(input, init));
      expect(findings.filter(f => f.level === 'warn').map(f => f.text)).toEqual([
        '1 unit or unit-manager group has no active members: unit:skola.',
        '2 deactivated users are still in plain groups, and a group an administrator maps to a capability gives it back when they are made active again: chef, kim.',
        "1 group carries a key that is written wrong, so Clew reads it as a plain group, which gives nobody anything unless an administrator maps it to a capability: 'unit-manager: skola'.",
        "1 group names a capability the check does not know, so it gives nobody anything unless the installation is newer than the check's copy of packages/contracts/src/scim-group-key.ts, or an administrator maps it to a capability: 'capability:admin.everything'.",
      ]);
      // Made active again, each has the mapped capability back at once, which is what the warning is about.
      for (const id of [chef, kim])
        await client.request('PATCH', '/Users/' + id, {
          schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
          Operations: [{ op: 'replace', path: 'active', value: true }],
        });
      expect(mapped()).toEqual([['admin.connectors'], ['admin.appearance']]);
    });
    test("the example declares the shapes Clew reads, and takes nothing of Clew's but the group keys, the one way Clew reads a key, and the capability names", () => {
      // Held by the type checker: a shape that parts from Clew's contracts fails `bun run typecheck`.
      type Same<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
      const same: [
        Same<DirectoryPhone, ClewPhone>,
        Same<Employment, ClewEmployment>,
        Same<Capability, ClewCapability>,
      ] = [true, true, true];
      expect(same).toEqual([true, true, true]);
      // A copy of the folder runs with one file of Clew's beside it, and that file imports nothing. Every way of naming
      // a module counts, a type's too, since a copy has to type-check as well as run.
      const imports = (file: URL) => {
        const code = readFileSync(file, 'utf8');
        const named = [
          ...code.matchAll(
            /\b(?:from|import)\s*(['"])([^'"]+)\1|\b(?:import|require)\s*\(\s*(['"`])([^'"`]+)\3|<reference\s+(?:path|types)\s*=\s*(['"])([^'"]+)\5/g,
          ),
        ].map(match => match[2] ?? match[4] ?? match[6]);
        // What the runtime loads, as Bun's own parser reads it, is among what the pattern found.
        for (const { path } of new Bun.Transpiler({ loader: 'ts' }).scanImports(code)) expect(named).toContain(path);
        return named;
      };
      const folder = new URL('../../scripts/provisioner/', import.meta.url);
      for (const file of readdirSync(folder))
        expect([
          file,
          imports(new URL(file, folder)).filter(
            specifier => !specifier!.startsWith('./') && specifier !== '../../packages/contracts/src/scim-group-key',
          ),
        ]).toEqual([file, []]);
      expect(imports(new URL('../../packages/contracts/src/scim-group-key.ts', import.meta.url))).toEqual([]);
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
      positions: [],
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
      positions: [],
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
      positions: [],
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
        positions: [],
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
    await expect(reconcile(client, directory, { ...source, groupPrefixes: ['unit:mine-', ''] })).rejects.toThrow(
      'Source ownership requires nonempty prefixes. Nothing was written.',
    );
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
      '251 users: 251 active, 0 deactivated.',
      expect.stringMatching(
        /^\d+ groups: 48 unit, \d+ unit-manager, \d+ capability, 9 position, \d+ plain \(0 without an externalId\)\.$/,
      ),
      'Every active user is in a unit.',
      // D110: a title Clew cannot read is left out and never refused, so the check is where a broken mapping shows.
      '250 of 251 active users have a title.',
      // D114: what Clew cannot read of a number or an employment is left out, so the counts are where that shows.
      'Phone numbers on 3 of 251 active users, employments on 251.',
      // D108 item 5: a position gives no access, so a mapping that sends none shows here.
      'Positions on 101 of 251 active users, from 9 positions.',
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
      '1 employment names a unit that is no longer held. Send current employments for the affected users: lost (unit-closed).',
      '1 unit has a unit-manager: group and no unit: group, so the unit is shown by its id instead of a name: unit-nameless.',
      '1 unit or unit-manager group has no members: unit:unit-empty.',
      '1 unit has people and no manager, on the unit or on any unit above it, so its people report to nobody: unit:unit-adrift-below.',
      "1 group carries a key that is written wrong, so Clew reads it as a plain group, which gives nobody anything unless an administrator maps it to a capability: ' Unit :old'.",
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
  expect((await client.request('GET', path)).body.phoneNumbers).toEqual([
    { type: 'work', value: '070-174 06 05' },
    { type: 'work', value: '070-174 06 06' },
    { type: 'Jour', value: '070-174 06 07' },
  ]);
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

test('the published SCIM object examples place an employee and assign their manager', async () => {
  const { client, grantOf } = stack();
  const guide = await Bun.file(new URL('../../docs/guides/provisioning-for-operations.md', import.meta.url)).text();
  const examples = [...guide.matchAll(/```json\n([\s\S]*?)\n```/g)].map(match => match[1]!);
  expect(examples).toHaveLength(5);
  const [root, child, person, placement, managerGroup] = examples;
  await client.request('POST', '/Groups', JSON.parse(root!));
  const unit = await client.request('POST', '/Groups', JSON.parse(child!));
  const anna = await client.request('POST', '/Users', JSON.parse(person!));
  const employee = await client.request('POST', '/Users', {
    ...JSON.parse(person!),
    externalId: 'e-1003',
    userName: 'lena.holm',
    displayName: 'Lena Holm',
    emails: [{ type: 'work', value: 'lena.holm@example.org' }],
  });
  const membership = placement!.replace("<Lena's Clew user ID>", employee.body.id);
  await client.request('PATCH', '/Groups/' + unit.body.id, JSON.parse(membership));
  const managers = managerGroup!.replace("<Anna's Clew user ID>", anna.body.id);
  await client.request('POST', '/Groups', JSON.parse(managers));
  expect(grantOf('lena.holm')).toMatchObject({ unitId: '110', role: 'employee' });
  expect(grantOf('anna.berg')).toMatchObject({ unitId: '110', role: 'manager' });
});

test('the published school walkthrough produces the printed output and the promised organisation', async () => {
  const { store, app, grantOf } = stack();
  const guide = await Bun.file(new URL('../../docs/guides/scim-school-walkthrough.md', import.meta.url)).text();
  const blocks = (lang: string) =>
    [...guide.matchAll(new RegExp('```' + lang + '\\n([\\s\\S]*?)\\n```', 'g'))].map(match => match[1]!);
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
