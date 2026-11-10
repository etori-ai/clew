import { describe, expect, test } from 'bun:test';
import { memoryProvisionStore } from '../../apps/server/src/modules/people/adapters/memory';
import { scimUsecases } from '../../apps/server/src/modules/people/usecases';
import { scimRoutes } from '../../apps/server/src/routes/scim';
import { checkProvisioning } from '../../scripts/provisioner/check';
import { scimClient } from '../../scripts/provisioner/client';
import { developmentDirectory, type Directory } from '../../scripts/provisioner/directory';
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
  test('plans D68 groups from units, manager flags, plain groups and capabilities, fifty people in eleven units', () => {
    const p = plan(developmentDirectory),
      by = (externalId: string) => p.groups.find(g => g.externalId === externalId)!,
      keyed = (key: string) => p.groups.filter(g => g.externalId.startsWith(key));
    expect(p.users).toHaveLength(50);
    expect(p.users.slice(0, 3).map(u => u.body.userName)).toEqual(['hillevi', 'hassan', 'mikael']);
    expect(new Set(p.users.map(u => u.body.userName)).size).toBe(50);
    expect(keyed('unit:')).toHaveLength(11);
    expect(keyed('unit-manager:')).toHaveLength(11);
    expect(keyed('capability:').map(g => g.externalId)).toEqual([
      'capability:admin.connectors',
      'capability:admin.users',
    ]);
    expect(keyed('ad:').map(g => g.externalId)).toEqual(['ad:alla-chefer', 'ad:intranat-redaktorer', 'ad:skyddsombud']);
    expect(by('unit:unit-skola')).toMatchObject({ displayName: 'Bergsåkers skola' });
    expect(by('unit:unit-skola').members).toHaveLength(6);
    expect(by('unit:unit-skola').members[0]).toBe('dev:hillevi');
    expect(by('unit-manager:unit-skola').members).toEqual(['dev:hillevi']);
    // One person manages two units, one works in two, and a group lists each member once.
    expect(by('unit-manager:unit-hr').members).toEqual(by('unit-manager:unit-ekonomi').members);
    expect(by('unit:unit-kommunikation').members).toHaveLength(4);
    expect(by('ad:alla-chefer').members).toHaveLength(10);
    expect(by('capability:admin.users').members).toEqual(['dev:mikael']);
    for (const g of p.groups) expect(new Set(g.members).size).toBe(g.members.length);
    expect(() => plan({ ...developmentDirectory, units: [] })).toThrow("department 'unit-skola'");
  });
  test('a first push creates everything, grants follow, and a second push is silent', async () => {
    const { store, client, grantOf } = stack();
    const first = await push(client, developmentDirectory);
    expect(first).toEqual({
      created: 50,
      replaced: 0,
      deactivated: 0,
      groupsCreated: 27,
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
      capabilities: ['admin.connectors', 'admin.users'],
    });
    // The manager of two units acts as the lowest unit id; the person in two units as the lowest too.
    const ekonomi = plan(developmentDirectory).groups.find(g => g.externalId === 'unit-manager:unit-ekonomi')!,
      twoUnits = developmentDirectory.people.find(p => p.alsoIn?.length)!;
    expect(grantOf(ekonomi.members[0]!.slice('dev:'.length))).toMatchObject({
      unitId: 'unit-ekonomi',
      unitLabel: 'Ekonomiavdelningen',
      role: 'manager',
    });
    expect(store.state.assignments.get(ekonomiId(store, ekonomi.members[0]!))).toHaveLength(2);
    expect(grantOf(twoUnits.userName)).toMatchObject({ unitId: 'unit-bibliotek', role: 'employee' });
    expect(store.state.units.size).toBe(11);
    expect(store.state.units.get('unit-hr')).toEqual({ organisationId: 'poc', label: 'HR-avdelningen' });
    const audited = store.state.audit.length;
    const second = await push(client, developmentDirectory);
    expect(second).toEqual({
      created: 0,
      replaced: 50,
      deactivated: 0,
      groupsCreated: 0,
      groupsReplaced: 27,
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
    expect(summary).toMatchObject({ created: 0, replaced: 49, deactivated: 1, groupsRemoved: 2 });
    expect(grantOf('hillevi')?.role).toBe('employee');
    expect(grantOf('mikael')?.capabilities).toEqual(['admin.connectors']);
    const hassan = [...store.state.users.values()].find(u => u.userName === 'hassan')!;
    expect(hassan.enabled).toBe(false);
    // The leaver is deactivated, never erased (D68 item 1); his unit group no longer lists him, so his grant is gone.
    expect(grantOf('hassan')).toBeUndefined();
    // The two groups that emptied are gone (hillevi was the only rektor, mikael the only admin.users holder); the
    // unit hassan left still has its other members.
    const remaining = [...store.state.groups.values()].map(g => g.externalId);
    expect(remaining).not.toContain('unit-manager:unit-skola');
    expect(remaining).not.toContain('capability:admin.users');
    expect(remaining).toContain('unit:unit-omsorg');
    expect(remaining).toHaveLength(25);
  });
  test('a group with a foreign key is left alone, and a refused push surfaces the SCIM detail', async () => {
    const { store, client } = stack();
    store.state.groups.set('foreign', {
      id: 'foreign',
      organisationId: 'poc',
      externalId: 'S-1-5-21-ad',
      label: 'AD',
      createdAt: 'x',
      updatedAt: 'x',
    });
    await push(client, developmentDirectory);
    expect(store.state.groups.has('foreign')).toBe(true);
    const broken: Directory = { ...developmentDirectory, people: [{ ...developmentDirectory.people[0]!, email: '' }] };
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
      '50 users: 50 active, 0 deactivated.',
      expect.stringMatching(
        /^\d+ groups: 11 unit, \d+ unit-manager, \d+ capability, \d+ plain \(0 without an externalId\)\.$/,
      ),
      'Every active user is in a unit.',
    ]);
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
    store.state.groups.set('legacy', {
      id: 'legacy',
      organisationId: 'poc',
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
      "1 group carries a key that is written wrong and gives nobody anything: 'Unit:old'.",
    ]);
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
