import { describe, expect, test } from 'bun:test';
import { ledUnits, type AuthenticatedContext } from '@clew/contracts';
import { memoryProvisionStore } from '../../apps/server/src/modules/people/adapters/memory';
import { SCIM, ScimError } from '../../apps/server/src/modules/people/contracts';
import { deriveAuthority, type Membership } from '../../apps/server/src/modules/people/domain';
import type { ProvisionStore } from '../../apps/server/src/modules/people/ports';
import { organisationUsecases, scimUsecases, staffUsecases } from '../../apps/server/src/modules/people/usecases';
import { unitsHeld } from '../held-units';

/**
 * Who is a manager, where a person belongs and which units they lead (D149), on the memory adapter. Three facts
 * are kept apart: an employment says which unit the person belongs to and whom they report to, and the `unit-manager:`
 * group says which unit they lead. Somebody is a manager when they lead a unit or people report to them, and the unit
 * they act as is the one they are employed on.
 */
const BASE = 'https://clew.test/scim/v2';
const ORG = 'sundsvall';
const member = (externalId: string, label = externalId): Membership => ({ externalId, label });

describe('the derivation keeps belonging, leading and being reported to apart (D149)', () => {
  const labels = { kansli: 'Kansliet', skola: 'Skolan', kok: 'Köket' };
  const derive = (memberships: Membership[], employed: string[], reports = false) =>
    deriveAuthority(memberships, [], labels, [], { employed, reports });
  test('somebody people report to is a manager on the unit they are employed on, which they do not lead', () => {
    const derived = derive([], ['kansli'], true);
    expect(derived).toMatchObject({ role: 'manager', belongs: ['kansli'], leads: [] });
    // The grant says both: a manager, and an employee on their one unit. `ledUnits` reads that they lead none.
    expect(derived.grant).toEqual({
      unitId: 'kansli',
      unitLabel: 'Kansliet',
      role: 'manager',
      capabilities: [],
      assignments: [{ unitId: 'kansli', unitLabel: 'Kansliet', role: 'employee' }],
    });
    expect(ledUnits(derived.grant!)).toEqual([]);
  });
  test('somebody who leads a unit and is employed on another acts as the one they are employed on, and leads the other', () => {
    const derived = derive([member('unit-manager:skola')], ['kansli']);
    expect(derived).toMatchObject({ role: 'manager', belongs: ['kansli'], leads: ['skola'] });
    expect(derived.grant).toMatchObject({
      unitId: 'kansli',
      role: 'manager',
      assignments: [
        { unitId: 'kansli', unitLabel: 'Kansliet', role: 'employee' },
        { unitId: 'skola', unitLabel: 'Skolan', role: 'manager' },
      ],
    });
    expect(ledUnits(derived.grant!)).toEqual([{ unitId: 'skola', unitLabel: 'Skolan' }]);
  });
  test('an employment is enough to belong to a unit, and one unit with the role it gives needs no list', () => {
    expect(derive([], ['kansli']).grant).toEqual({
      unitId: 'kansli',
      unitLabel: 'Kansliet',
      role: 'employee',
      capabilities: [],
    });
    // Leading the unit they are employed on is as plain: one unit, which a manager leads.
    const leader = derive([member('unit-manager:kansli')], ['kansli']);
    expect(leader.grant).toEqual({ unitId: 'kansli', unitLabel: 'Kansliet', role: 'manager', capabilities: [] });
    expect(ledUnits(leader.grant!)).toEqual([{ unitId: 'kansli', unitLabel: 'Kansliet' }]);
    expect(leader).toMatchObject({ belongs: ['kansli'], leads: ['kansli'] });
  });
  test('with several employments the person acts as the unit of the first, and belongs to each', () => {
    const derived = derive([], ['skola', 'kansli', 'skola']);
    expect(derived.grant).toMatchObject({ unitId: 'skola', role: 'employee' });
    expect(derived.assignments).toEqual([
      { unitId: 'kansli', role: 'employee' },
      { unitId: 'skola', role: 'employee' },
    ]);
  });
  test("a unit's own group places a person too, beside an employment or without one", () => {
    // Beside: the employment decides the unit they act as, and they are of both.
    expect(derive([member('unit:kok', 'Köket')], ['kansli'])).toMatchObject({
      belongs: ['kansli', 'kok'],
      grant: { unitId: 'kansli' },
    });
    // Without an employment the groups decide, as before employments placed anybody: a unit they lead first.
    const grouped = derive([member('unit:kok', 'Köket'), member('unit-manager:skola')], []);
    expect(grouped).toMatchObject({ belongs: ['kok'], leads: ['skola'], grant: { unitId: 'skola', role: 'manager' } });
  });
  test('nobody is a manager who leads no unit and is reported to by nobody, and without a unit there is no grant', () => {
    expect(derive([member('unit:kok', 'Köket')], [])).toMatchObject({ role: 'employee', grant: { role: 'employee' } });
    // People report to them, and the directory says of no unit that they belong to it or lead it: fail closed.
    expect(derive([], [], true)).toMatchObject({ role: 'manager', grant: undefined });
  });
});

function harness(inner: ReturnType<typeof memoryProvisionStore> = memoryProvisionStore(), over?: ProvisionStore) {
  const store = inner;
  let tick = 0,
    seq = 0;
  const scim = scimUsecases({
    store: over ?? store,
    clock: () => new Date(Date.UTC(2026, 10, 27, 6, 0, tick++)),
    ids: () => 'id-' + ++seq,
    digest: token => 'digest:' + token,
  });
  const p = { id: 'metakatalogen', organisationId: ORG, label: 'Metakatalogen' };
  const ids = new Map<string, string>();
  const id = (name: string) => ids.get(name)!;
  const jobsOf = (jobs: ReadonlyArray<readonly [unitId: string, manager?: string]>) => ({
    [SCIM.employment]: {
      employments: jobs.map(([unitId, manager]) => ({ unitId, ...(manager ? { managerId: id(manager) } : {}) })),
    },
  });
  /** A person with their employments, each on a unit and naming a manager or none. */
  const person = async (name: string, ...jobs: Array<readonly [unitId: string, manager?: string]>) => {
    const user = await scim.createUser(
      p,
      {
        schemas: [SCIM.user, SCIM.employment],
        externalId: 'mk-' + name,
        userName: name,
        displayName: name[0]!.toUpperCase() + name.slice(1),
        emails: [{ value: name + '@sundsvall.test', type: 'work' }],
        ...jobsOf(jobs),
      },
      BASE,
    );
    ids.set(name, user.id);
    return user.id;
  };
  const employ = (name: string, ...jobs: Array<readonly [unitId: string, manager?: string]>) =>
    scim.patchUser(
      p,
      id(name),
      {
        schemas: [SCIM.patch],
        Operations: [
          { op: 'replace', path: SCIM.employment + ':employments', value: jobsOf(jobs)[SCIM.employment].employments },
        ],
      },
      BASE,
    );
  const active = (name: string, value: boolean) =>
    scim.patchUser(
      p,
      id(name),
      { schemas: [SCIM.patch], Operations: [{ op: 'replace', path: 'active', value }] },
      BASE,
    );
  const unit = (unitId: string, label: string, members: string[] = []) =>
    scim.createGroup(
      p,
      { externalId: 'unit:' + unitId, displayName: label, members: members.map(m => ({ value: id(m) })) },
      BASE,
    );
  const leaders = (unitId: string, members: string[]) =>
    scim.createGroup(
      p,
      {
        externalId: 'unit-manager:' + unitId,
        displayName: 'Chefer · ' + unitId,
        members: members.map(m => ({ value: id(m) })),
      },
      BASE,
    );
  const grant = (name: string) => store.state.grants.get(id(name));
  /** The audit rows written since `from`, as action, subject by name and details. */
  const audited = (from: number) => {
    const names = new Map([...ids].map(([name, personId]) => ['person:' + personId, name]));
    return store.state.audit.slice(from).map(row => [row.action, names.get(row.subject) ?? row.subject, row.details]);
  };
  const persona = (name: string): AuthenticatedContext => {
    const held = grant(name)!;
    return {
      id: id(name),
      name,
      unitId: held.unitId,
      unitLabel: held.unitLabel,
      role: held.role,
      ...(held.assignments ? { assignments: held.assignments } : {}),
      organisationId: ORG,
      principal: { id: 'person:' + id(name), kind: 'person' },
      capabilities: ['admin.users'],
      authorizationVersion: 'v1',
      sessionBinding: 'test',
      expiresAt: '2026-11-27T18:00:00.000Z',
      authorize: async () => ({ version: 'v1' }),
      delegate: async () => undefined,
    };
  };
  return { store, scim, p, id, person, employ, active, unit, leaders, grant, audited, persona };
}

describe('a manager is who leads a unit or is reported to (D149)', () => {
  test('whoever an employment names becomes a manager in the write that names them, and stops being one when nobody active names them', async () => {
    const h = harness();
    await h.unit('kansli', 'Kansliet');
    await h.unit('skola', 'Skolan');
    await h.person('karin', ['kansli']);
    expect(h.grant('karin')).toEqual({ unitId: 'kansli', unitLabel: 'Kansliet', role: 'employee', capabilities: [] });
    // Anna is created with an employment that names Karin: Karin is a manager from that write on, audited on her.
    let from = h.store.state.audit.length;
    await h.person('anna', ['skola', 'karin']);
    expect(h.audited(from)).toEqual([
      ['scim.user.created', 'anna', { userName: 'anna', externalId: 'mk-anna' }],
      ['grant.derived', 'anna', { unitId: 'skola', role: 'employee', capabilities: [], assignments: 1 }],
      [
        'grant.derived',
        'karin',
        {
          unitId: 'kansli',
          role: 'manager',
          capabilities: [],
          assignments: 1,
          // She leads no unit: a manager, and an employee on the unit she is employed on.
          placements: [{ unitId: 'kansli', role: 'employee' }],
        },
      ],
    ]);
    expect(ledUnits(h.grant('karin')!)).toEqual([]);
    // Personal lists Anna under the unit Anna is employed on, which Karin does not lead.
    expect((await staffUsecases({ store: h.store }).overview(h.persona('karin'))).units).toEqual([
      {
        unitId: 'skola',
        unitLabel: 'Skolan',
        people: [
          {
            id: h.id('anna'),
            name: 'Anna',
            userName: 'anna',
            email: 'anna@sundsvall.test',
            enabled: true,
            role: 'employee',
          },
        ],
      },
    ]);
    // A second person who names her changes nothing of hers, so nothing is written on her.
    from = h.store.state.audit.length;
    await h.person('bo', ['skola', 'karin']);
    expect(h.audited(from).map(row => [row[0], row[1]])).toEqual([
      ['scim.user.created', 'bo'],
      ['grant.derived', 'bo'],
    ]);
    // Anna leaves: Karin still has Bo. Bo leaves too: nobody active names her, and she is no manager.
    await h.active('anna', false);
    expect(h.grant('karin')?.role).toBe('manager');
    from = h.store.state.audit.length;
    await h.scim.deleteUser(h.p, h.id('bo'));
    expect(h.audited(from)).toEqual([
      ['scim.user.deactivated', 'bo', { userName: 'bo', externalId: 'mk-bo' }],
      // A deactivated person's employment places nobody, so Bo has no unit left.
      ['grant.derived', 'bo', { removed: true }],
      ['grant.derived', 'karin', { unitId: 'kansli', role: 'employee', capabilities: [], assignments: 1 }],
    ]);
    expect(h.grant('karin')).toEqual({ unitId: 'kansli', unitLabel: 'Kansliet', role: 'employee', capabilities: [] });
    // Back again, she is a manager again.
    await h.active('bo', true);
    expect(h.grant('karin')?.role).toBe('manager');
  });
  test('an employment that names another manager moves the role from the one to the other in one write', async () => {
    const h = harness();
    await h.unit('kansli', 'Kansliet');
    await h.person('karin', ['kansli']);
    await h.person('david', ['kansli']);
    await h.person('anna', ['kansli', 'karin']);
    expect([h.grant('karin')?.role, h.grant('david')?.role]).toEqual(['manager', 'employee']);
    const from = h.store.state.audit.length;
    await h.employ('anna', ['kansli', 'david']);
    expect(h.audited(from).map(row => [row[0], row[1], (row[2] as { role?: string }).role])).toEqual([
      ['scim.user.patched', 'anna', undefined],
      ['grant.derived', 'karin', 'employee'],
      ['grant.derived', 'david', 'manager'],
    ]);
    // A write that changes nothing of the employments derives nobody else.
    const quiet = h.store.state.audit.length;
    await h.employ('anna', ['kansli', 'david']);
    expect(h.audited(quiet)).toEqual([]);
  });
  test('two who name each other are neither the other’s report, so neither is a manager for it', async () => {
    const h = harness();
    await h.unit('kansli', 'Kansliet');
    await h.person('dan', ['kansli']);
    await h.person('eva', ['kansli', 'dan']);
    expect([h.grant('dan')?.role, h.grant('eva')?.role]).toEqual(['manager', 'employee']);
    await h.employ('dan', ['kansli', 'eva']);
    expect([h.grant('dan')?.role, h.grant('eva')?.role]).toEqual(['employee', 'employee']);
    // The circle is broken where the directory breaks it.
    await h.employ('dan', ['kansli']);
    expect([h.grant('dan')?.role, h.grant('eva')?.role]).toEqual(['manager', 'employee']);
  });
  test('somebody who leads a unit and is employed on another leads it without belonging to it, and is counted where they belong', async () => {
    const h = harness();
    await h.unit('ledning', 'Förvaltningsledning');
    await h.person('rut', ['ledning']);
    await h.person('anna', ['skola-saknas']).catch(error => expect(error).toBeInstanceOf(ScimError));
    await h.unit('skola', 'Skolan');
    await h.person('bo', ['skola', 'rut']);
    const from = h.store.state.audit.length;
    await h.leaders('skola', ['rut']);
    expect(h.audited(from).filter(row => row[0] === 'grant.derived')).toEqual([
      [
        'grant.derived',
        'rut',
        {
          unitId: 'ledning',
          role: 'manager',
          capabilities: [],
          assignments: 2,
          placements: [
            { unitId: 'ledning', role: 'employee' },
            { unitId: 'skola', role: 'manager' },
          ],
        },
      ],
    ]);
    expect(ledUnits(h.grant('rut')!)).toEqual([{ unitId: 'skola', unitLabel: 'Skolan' }]);
    expect(unitsHeld(h.store.state, h.id('rut'))).toEqual([
      { unitId: 'ledning', role: 'employee' },
      { unitId: 'skola', role: 'manager' },
    ]);
    expect([h.store.state.assignments.get(h.id('rut')), h.store.state.leads.get(h.id('rut'))]).toEqual([
      ['ledning'],
      ['skola'],
    ]);
    // Administration › Organisation: the school has one person, Bo, and Rut as its manager from elsewhere.
    const organisation = organisationUsecases({ store: h.store }),
      view = await organisation.overview(h.persona('rut'));
    expect(view.units.map(u => [u.unitId, u.placed, u.managers.map(m => m.name)])).toEqual([
      ['ledning', 1, []],
      ['skola', 1, ['Rut']],
    ]);
    expect((await organisation.unit(h.persona('rut'), 'skola')).people.map(q => [q.name, q.role, q.elsewhere])).toEqual(
      [
        ['Bo', 'employee', undefined],
        ['Rut', 'manager', true],
      ],
    );
    // Personal: the school's card is hers because she leads it, and Bo is on it because he reports to her.
    expect(
      (await staffUsecases({ store: h.store }).overview(h.persona('rut'))).units.map(u => [
        u.unitLabel,
        u.people.map(q => q.name),
      ]),
    ).toEqual([['Skolan', ['Bo']]]);
  });
  test('a write of a person holds the managers it names, starts over when another write named somebody else meanwhile, and gives up with 409', async () => {
    const inner = memoryProvisionStore();
    // Between the read that says whom to hold and the hold itself, another request's write commits.
    let between: undefined | (() => void),
      turns = 0;
    const racing: ProvisionStore = {
      transaction: (fn, mode) =>
        inner.transaction(
          tx =>
            fn({
              ...tx,
              lockPeople: async ids => {
                turns++;
                between?.();
                return tx.lockPeople(ids);
              },
            }),
          mode,
        ),
    };
    const h = harness(inner, racing);
    await h.unit('kansli', 'Kansliet');
    for (const name of ['karin', 'david', 'eva']) await h.person(name, ['kansli']);
    await h.person('anna', ['kansli', 'karin']);
    const names = (name: string) => {
      const anna = inner.state.users.get(h.id('anna'))!;
      inner.state.users.set(anna.id, { ...anna, employments: [{ unitId: 'kansli', managerId: h.id(name) }] });
    };
    // Once: the other write made Eva her manager. This write, which makes it David, starts over and holds Eva too, so
    // Eva is derived when it has written: nobody is left a manager whom nobody names.
    turns = 0;
    between = () => {
      between = undefined;
      names('eva');
      // As that write left them: Karin has no report any more, and Eva has one.
      for (const [name, role] of [
        ['karin', 'employee'],
        ['eva', 'manager'],
      ] as const)
        inner.state.grants.set(h.id(name), { ...inner.state.grants.get(h.id(name))!, role });
    };
    await h.employ('anna', ['kansli', 'david']);
    expect(turns).toBe(2);
    expect(['karin', 'david', 'eva'].map(name => h.grant(name)?.role)).toEqual(['employee', 'manager', 'employee']);
    // Every time: the write never holds the people it would have to derive, writes nothing and says so.
    let flip = 0;
    turns = 0;
    between = () => names(flip++ % 2 ? 'karin' : 'eva');
    const before = inner.state.audit.length;
    const refused = await h.employ('anna', ['kansli', 'david']).catch(error => error);
    expect(refused).toBeInstanceOf(ScimError);
    expect([(refused as ScimError).status, turns, inner.state.audit.length - before]).toEqual([409, 3, 0]);
  });
  test('a unit group that is renamed, removed or made again reaches the people employed on the unit, who are in no group', async () => {
    const h = harness();
    const unit = await h.unit('kansli', 'Kansliet');
    await h.person('anna', ['kansli']);
    expect(h.grant('anna')).toMatchObject({ unitId: 'kansli', unitLabel: 'Kansliet' });
    // The unit's new name is on her grant in the write that renames it.
    await h.scim.patchGroup(
      h.p,
      unit.id,
      { schemas: [SCIM.patch], Operations: [{ op: 'replace', path: 'displayName', value: 'Kommunkansliet' }] },
      BASE,
    );
    expect(h.grant('anna')).toMatchObject({ unitId: 'kansli', unitLabel: 'Kommunkansliet' });
    // The unit is removed: her employment still names it, and places her nowhere, so she has no grant (fail closed).
    let from = h.store.state.audit.length;
    await h.scim.deleteGroup(h.p, unit.id);
    expect(h.audited(from).filter(row => row[0] === 'grant.derived')).toEqual([
      ['grant.derived', 'anna', { removed: true }],
    ]);
    expect([h.grant('anna'), unitsHeld(h.store.state, h.id('anna'))]).toEqual([undefined, []]);
    // The directory sends the unit again: she is of it again, with nothing sent about her.
    from = h.store.state.audit.length;
    await h.unit('kansli', 'Kansliet');
    expect(h.audited(from).filter(row => row[0] === 'grant.derived')).toEqual([
      ['grant.derived', 'anna', { unitId: 'kansli', role: 'employee', capabilities: [], assignments: 1 }],
    ]);
  });
  test('a deactivated person’s employment places nobody, and a person who comes back is of their unit again', async () => {
    const h = harness();
    await h.unit('kansli', 'Kansliet');
    await h.person('anna', ['kansli']);
    expect(unitsHeld(h.store.state, h.id('anna'))).toEqual([{ unitId: 'kansli', role: 'employee' }]);
    await h.active('anna', false);
    expect([h.grant('anna'), unitsHeld(h.store.state, h.id('anna'))]).toEqual([undefined, []]);
    await h.active('anna', true);
    expect(h.grant('anna')).toEqual({ unitId: 'kansli', unitLabel: 'Kansliet', role: 'employee', capabilities: [] });
  });
});
