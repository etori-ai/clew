import { describe, expect, test } from 'bun:test';
import type { AuthenticatedContext, Capability } from '@clew/contracts';
import { ForbiddenError, InputError } from '../../apps/server/src/context';
import { memoryProvisionStore } from '../../apps/server/src/modules/people/adapters/memory';
import { SCIM, ScimError } from '../../apps/server/src/modules/people/contracts';
import {
  applyGroupPatch,
  organisationOf,
  resourceTypes,
  schemaDocuments,
} from '../../apps/server/src/modules/people/domain';
import { organisationUsecases, scimUsecases, staffUsecases } from '../../apps/server/src/modules/people/usecases';

/**
 * The organisation tree (D99) on the memory adapter: a `unit:` group carries the unit above it, the server refuses
 * what would break the tree, a manager's reports follow the line and not the branch, and an administrator reads what
 * a push left.
 */
const BASE = 'https://clew.test/scim/v2';
const ORG = 'sundsvall';
function harness() {
  const store = memoryProvisionStore();
  let tick = 0,
    seq = 0;
  const scim = scimUsecases({
    store,
    clock: () => new Date(Date.UTC(2026, 10, 10, 6, 0, tick++)),
    ids: () => 'id-' + ++seq,
    digest: token => 'digest:' + token,
  });
  const p = { id: 'metakatalogen', organisationId: ORG, label: 'Metakatalogen' };
  const ids = new Map<string, string>();
  /** A person by a short name; the SCIM id is remembered under it. */
  const person = async (name: string, active = true) => {
    const user = await scim.createUser(
      p,
      {
        externalId: 'mk-' + name,
        userName: name,
        displayName: name[0]!.toUpperCase() + name.slice(1),
        emails: [{ value: name + '@sundsvall.test', type: 'work' }],
        active,
      },
      BASE,
    );
    ids.set(name, user.id);
    return user.id;
  };
  const id = (name: string) => ids.get(name)!;
  const groups = new Map<string, string>();
  /** A unit group, placed under `parent` when one is given, with the people named as members. */
  const unit = async (unitId: string, label: string, parent: string | null, members: string[] = []) => {
    const made = await scim.createGroup(
      p,
      {
        externalId: 'unit:' + unitId,
        displayName: label,
        members: members.map(m => ({ value: id(m) })),
        ...(parent ? { [SCIM.unit]: { parent: 'unit:' + parent } } : {}),
      },
      BASE,
    );
    groups.set(unitId, made.id);
    return made;
  };
  const managers = (unitId: string, members: string[]) =>
    scim.createGroup(
      p,
      {
        externalId: 'unit-manager:' + unitId,
        displayName: 'Chefer · ' + unitId,
        members: members.map(m => ({ value: id(m) })),
      },
      BASE,
    );
  const persona = (name: string, capabilities: Capability[] = [], organisationId = ORG): AuthenticatedContext => ({
    id: id(name) ?? name,
    name,
    unitId: 'unit',
    unitLabel: 'Unit',
    role: 'manager',
    organisationId,
    principal: { id: 'person:' + name, kind: 'person' },
    capabilities,
    authorizationVersion: 'v1',
    sessionBinding: 'test',
    expiresAt: '2026-11-10T18:00:00.000Z',
    authorize: async () => ({ version: 'v1' }),
  });
  const refusal = async (attempt: Promise<unknown>) => {
    const error = await attempt.then(
      () => undefined,
      e => e,
    );
    expect(error).toBeInstanceOf(ScimError);
    return error as ScimError;
  };
  return { store, scim, p, person, id, unit, managers, groups, persona, refusal };
}

/** A manager of `ORG` signed in, by person id. */
const harnessPersona = (personId: string): AuthenticatedContext => ({
  id: personId,
  name: personId,
  unitId: 'unit',
  unitLabel: 'Unit',
  role: 'manager',
  organisationId: ORG,
  principal: { id: 'person:' + personId, kind: 'person' },
  capabilities: [],
  authorizationVersion: 'v1',
  sessionBinding: 'test',
  expiresAt: '2026-11-10T18:00:00.000Z',
  authorize: async () => ({ version: 'v1' }),
});
describe('the organisation tree over SCIM (D99)', () => {
  test('a tree is pushed from the root down, a node nobody is placed on included, and a unit answers the unit above it', async () => {
    const { scim, p, unit, person, store } = harness();
    await person('anna');
    const root = await unit('ksk', 'Kommunstyrelsekontoret', null);
    expect(root.schemas).toEqual([SCIM.group]);
    expect(SCIM.unit in root).toBe(false);
    const mid = await unit('ksk-avd', 'KSK Avdelningar', 'ksk'),
      leaf = await unit('ksk-it', 'Digitalisering och IT', 'ksk-avd', ['anna']);
    expect(leaf.schemas).toEqual([SCIM.group, SCIM.unit]);
    expect(leaf[SCIM.unit]).toEqual({ parent: 'unit:ksk-avd' });
    expect((await scim.getGroup(p, mid.id, BASE))[SCIM.unit]).toEqual({ parent: 'unit:ksk' });
    // The empty nodes are nodes: the tree is the groups, not the people.
    await store.transaction(async tx =>
      expect(await tx.unitTree(ORG)).toEqual([
        { id: 'ksk', label: 'Kommunstyrelsekontoret', parentId: null },
        { id: 'ksk-avd', label: 'KSK Avdelningar', parentId: 'ksk' },
        { id: 'ksk-it', label: 'Digitalisering och IT', parentId: 'ksk-avd' },
      ]),
    );
    expect(store.state.audit.find(a => a.subject === 'group:' + leaf.id)).toMatchObject({
      actor: 'provisioner:metakatalogen',
      action: 'scim.group.created',
      details: { externalId: 'unit:ksk-it', parent: 'ksk-avd', members: 1 },
    });
    expect(store.state.audit.find(a => a.subject === 'group:' + root.id)?.details).not.toHaveProperty('parent');
  });
  test("a manager of a unit nobody is placed on carries the unit group's name, and its new name when it is renamed (D101)", async () => {
    const { scim, p, unit, managers, person, id, store } = harness();
    await person('chef');
    await person('anna');
    // The unit first and empty, then its manager group: no unit row names it yet, and the head is no member of it.
    const forv = await unit('forv', 'Vård- och omsorgsförvaltningen', null);
    await unit('hemtjanst', 'Hemtjänst', 'forv', ['anna']);
    await managers('forv', ['chef']);
    expect(store.state.grants.get(id('chef'))).toEqual({
      unitId: 'forv',
      unitLabel: 'Vård- och omsorgsförvaltningen',
      role: 'manager',
      capabilities: [],
    });
    expect(store.state.units.get('forv')).toEqual({ organisationId: ORG, label: 'Vård- och omsorgsförvaltningen' });
    expect(store.state.audit.filter(a => a.subject === 'person:' + id('chef')).at(-1)).toMatchObject({
      actor: 'provisioner:metakatalogen',
      action: 'grant.derived',
      details: { unitId: 'forv', role: 'manager', assignments: 1 },
    });
    const staff = staffUsecases({ store });
    expect((await staff.overview(harnessPersona(id('chef')))).units.map(u => u.unitLabel)).toEqual([
      'Vård- och omsorgsförvaltningen',
    ]);
    await scim.patchGroup(
      p,
      forv.id,
      { schemas: [SCIM.patch], Operations: [{ op: 'replace', path: 'displayName', value: 'Omsorgsförvaltningen' }] },
      BASE,
    );
    expect(store.state.grants.get(id('chef'))?.unitLabel).toBe('Omsorgsförvaltningen');
    expect(store.state.audit.at(-1)).toMatchObject({ action: 'grant.derived', subject: 'person:' + id('chef') });
  });
  test('a unit belongs to the organisation that pushed it: another organisation names no manager of it and no unit for its managers, and Personal reads its own organisation (D101)', async () => {
    const { scim, unit, managers, person, id, refusal, store } = harness();
    await person('anna');
    await person('karin');
    await unit('it', 'IT', null, ['anna']);
    await managers('it', ['karin']);
    await unit('hr', 'HR', null, ['anna']);
    await managers('ekonomi', ['karin']);
    const other = { id: 'other', organisationId: 'timra', label: 'Timrå' };
    const olle = await scim.createUser(
      other,
      { externalId: 'tm-olle', userName: 'olle', displayName: 'Olle', emails: [{ value: 'olle@timra.test' }] },
      BASE,
    );
    const audited = store.state.audit.length,
      stored = store.state.groups.size;
    // The unit's other key is free, and it is the same unit: neither is theirs to take.
    for (const externalId of ['unit-manager:hr', 'unit:ekonomi']) {
      const taken = await refusal(
        scim.createGroup(other, { externalId, displayName: 'Tagen', members: [{ value: olle.id }] }, BASE),
      );
      expect(taken).toMatchObject({ status: 400, scimType: 'invalidValue' });
      expect(taken.detail).toContain('is not a unit of this organisation (D101). The group was not stored.');
    }
    // Nor by giving a group of their own the key afterwards.
    const plain = await scim.createGroup(other, { externalId: 'ad:timra', displayName: 'Timrå', members: [] }, BASE);
    const rekeyed = await refusal(
      scim.patchGroup(
        other,
        plain.id,
        { schemas: [SCIM.patch], Operations: [{ op: 'replace', path: 'externalId', value: 'unit-manager:hr' }] },
        BASE,
      ),
    );
    expect(rekeyed.detail).toContain("The unit 'hr' is not a unit of this organisation (D101)");
    expect(store.state.groups.size).toBe(stored + 1);
    expect(store.state.audit.slice(audited).map(a => a.action)).toEqual(['scim.group.created']);
    expect(store.state.grants.get(olle.id)).toBeUndefined();
    // An assignment stored before the rule held: the unit's manager is still shown their own organisation's people only.
    store.state.assignments.set(olle.id, [{ unitId: 'it', role: 'employee' }]);
    const staff = staffUsecases({ store });
    expect(
      (await staff.overview(harnessPersona(id('karin')))).units.find(u => u.unitId === 'it')?.people.map(q => q.name),
    ).toEqual(['Anna']);
  });
  test('a parent that does not exist, is written wrong, belongs to another organisation or stands on another kind of group is refused, and nothing is stored', async () => {
    const { scim, p, unit, refusal, store } = harness();
    const before = () => store.state.groups.size;
    const unknown = await refusal(unit('ksk-it', 'IT', 'ksk'));
    expect(unknown).toMatchObject({ status: 400, scimType: 'invalidValue' });
    expect(unknown.detail).toContain("'unit:ksk' is not a unit of this organisation");
    expect(unknown.detail).toContain('from the root down (D99)');
    for (const parent of ['ksk', 'Unit:ksk', 'unit:', 'unit: ksk', 'unit-manager:ksk', 7, {}]) {
      const wrong = await refusal(
        scim.createGroup(p, { externalId: 'unit:ksk-it', displayName: 'IT', [SCIM.unit]: { parent } }, BASE),
      );
      expect(wrong).toMatchObject({ status: 400, scimType: 'invalidValue' });
      expect(wrong.detail).toContain("'unit:<unitId>' (D99)");
    }
    await unit('ksk', 'Kommunstyrelsekontoret', null);
    for (const externalId of ['unit-manager:ksk-it', 'capability:admin.users', 'ad:plain', undefined]) {
      const misplaced = await refusal(
        scim.createGroup(p, { externalId, displayName: 'Other', [SCIM.unit]: { parent: 'unit:ksk' } }, BASE),
      );
      expect(misplaced).toMatchObject({ status: 400, scimType: 'invalidValue' });
      expect(misplaced.detail).toContain("carried by a 'unit:' group only");
    }
    expect((await refusal(unit('ksk-it', 'IT', 'ksk-it'))).detail).toContain('cannot be its own parent');
    // Another organisation's unit is no parent here, and the refusal does not say that it exists.
    const other = { id: 'other', organisationId: 'timra', label: 'Timrå' };
    const foreign = await refusal(
      scim.createGroup(
        other,
        { externalId: 'unit:timra-it', displayName: 'IT', [SCIM.unit]: { parent: 'unit:ksk' } },
        BASE,
      ),
    );
    expect(foreign.detail).toContain("'unit:ksk' is not a unit of this organisation");
    expect(before()).toBe(1);
    expect(store.state.audit.filter(a => a.action.startsWith('scim.group'))).toHaveLength(1);
  });
  test('a move is a change of parent: audited with the unit above before and after, and nobody is derived again', async () => {
    const { scim, p, unit, person, managers, groups, store } = harness();
    await person('anna');
    await person('bo');
    await unit('ksk', 'Kommunstyrelsekontoret', null);
    await unit('bou', 'Barn och utbildning', null);
    await unit('skola', 'Bergsåkers skola', 'ksk', ['anna']);
    await managers('skola', ['bo']);
    const derived = () => store.state.audit.filter(a => a.action === 'grant.derived').length,
      was = derived(),
      rows = () => store.state.audit.filter(a => a.subject === 'group:' + groups.get('skola'));
    const put = (parent: string | null) =>
      scim.replaceGroup(
        p,
        groups.get('skola')!,
        {
          externalId: 'unit:skola',
          displayName: 'Bergsåkers skola',
          members: [{ value: store.state.users.keys().next().value! }],
          ...(parent ? { [SCIM.unit]: { parent } } : {}),
        },
        BASE,
      );
    const moved = await put('unit:bou');
    expect(moved[SCIM.unit]).toEqual({ parent: 'unit:bou' });
    expect(rows().at(-1)).toMatchObject({
      action: 'scim.group.replaced',
      details: { externalId: 'unit:skola', parent: { before: 'ksk', after: 'bou' }, added: 0, removed: 0 },
    });
    // The same push again writes nothing; a PUT without the extension makes the unit a root.
    await put('unit:bou');
    expect(rows()).toHaveLength(2);
    const root = await put(null);
    expect(root.schemas).toEqual([SCIM.group]);
    expect(rows().at(-1)?.details).toMatchObject({ parent: { before: 'bou', after: null } });
    expect(derived()).toBe(was);
    expect(store.state.grants.get(store.state.users.keys().next().value!)).toMatchObject({ unitId: 'skola' });
  });
  test('PATCH sets, replaces and removes the parent by its schema-qualified path and as the extension object', async () => {
    const { scim, p, unit, groups } = harness();
    await unit('ksk', 'Kommunstyrelsekontoret', null);
    await unit('bou', 'Barn och utbildning', null);
    await unit('skola', 'Bergsåkers skola', null);
    const patch = async (Operations: Array<{ op: string; path?: string; value?: unknown }>) =>
      (await scim.patchGroup(p, groups.get('skola')!, { schemas: [SCIM.patch], Operations }, BASE))[SCIM.unit];
    expect(await patch([{ op: 'add', path: SCIM.unit + ':parent', value: 'unit:ksk' }])).toEqual({
      parent: 'unit:ksk',
    });
    expect(await patch([{ op: 'replace', value: { [SCIM.unit]: { parent: 'unit:bou' } } }])).toEqual({
      parent: 'unit:bou',
    });
    expect(await patch([{ op: 'replace', path: SCIM.unit, value: { parent: 'unit:ksk' } }])).toEqual({
      parent: 'unit:ksk',
    });
    await expect(patch([{ op: 'replace', path: 'parent', value: 'unit:ksk' }])).rejects.toMatchObject({
      status: 400,
      scimType: 'invalidPath',
    });
    // A patch of something else leaves the place alone; the URN is matched without regard to case.
    expect(await patch([{ op: 'replace', path: 'displayName', value: 'Skolan' }])).toEqual({ parent: 'unit:ksk' });
    expect(await patch([{ op: 'remove', path: SCIM.unit.toUpperCase() + ':parent' }])).toBeUndefined();
    const fields = { externalId: 'unit:skola', label: 'Skolan', parent: 'ksk', members: [] };
    expect(applyGroupPatch(fields, [{ op: 'remove', path: SCIM.unit }]).parent).toBeNull();
    expect(applyGroupPatch(fields, [{ op: 'replace', value: { [SCIM.unit]: {} } }]).parent).toBeNull();
    expect(() => applyGroupPatch(fields, [{ op: 'replace', path: SCIM.unit + ':parent', value: 'ksk' }])).toThrow(
      "'unit:<unitId>' (D99)",
    );
  });
  test('a move that would close a cycle is refused, directly and through the units between', async () => {
    const { scim, p, unit, groups, refusal } = harness();
    await unit('a', 'A', null);
    await unit('b', 'B', 'a');
    await unit('c', 'C', 'b');
    const move = (unitId: string, parent: string) =>
      scim.patchGroup(
        p,
        groups.get(unitId)!,
        {
          schemas: [SCIM.patch],
          Operations: [{ op: 'replace', path: SCIM.unit + ':parent', value: 'unit:' + parent }],
        },
        BASE,
      );
    for (const below of ['b', 'c']) {
      const cycle = await refusal(move('a', below));
      expect(cycle).toMatchObject({ status: 400, scimType: 'invalidValue' });
      expect(cycle.detail).toContain(`'unit:${below}' stands below the unit 'a' and would close a cycle (D99)`);
    }
    expect((await scim.getGroup(p, groups.get('a')!, BASE))[SCIM.unit]).toBeUndefined();
    // Sideways is no cycle.
    await unit('d', 'D', 'a');
    expect((await move('c', 'd'))[SCIM.unit]).toEqual({ parent: 'unit:d' });
  });
  test('a unit with units below it is neither removed nor re-keyed: the tree is removed from the leaves up', async () => {
    const { scim, p, unit, groups, refusal, store } = harness();
    await unit('ksk', 'Kommunstyrelsekontoret', null);
    await unit('it', 'IT', 'ksk');
    await unit('hr', 'HR', 'ksk');
    const kept = await refusal(scim.deleteGroup(p, groups.get('ksk')!));
    expect(kept.status).toBe(409);
    expect(kept.detail).toContain("still has 2 units below it ('unit:hr', 'unit:it')");
    expect(kept.detail).toContain('from the leaves up (D99). The group was not removed.');
    for (const externalId of ['unit:kommunstyrelsen', 'ad:ksk']) {
      const rekeyed = await refusal(
        scim.replaceGroup(p, groups.get('ksk')!, { externalId, displayName: 'Kommunstyrelsekontoret' }, BASE),
      );
      expect(rekeyed).toMatchObject({ status: 400, scimType: 'invalidValue' });
      expect(rekeyed.detail).toContain("The unit 'ksk' still has 2 units below it");
    }
    expect(store.state.groups.get(groups.get('ksk')!)?.externalId).toBe('unit:ksk');
    await scim.deleteGroup(p, groups.get('it')!);
    expect((await refusal(scim.deleteGroup(p, groups.get('ksk')!))).detail).toContain(
      "still has a unit below it ('unit:hr')",
    );
    await scim.deleteGroup(p, groups.get('hr')!);
    await scim.deleteGroup(p, groups.get('ksk')!);
    expect(store.state.groups.size).toBe(0);
    // A unit that leaves the tree for a plain key gives up its place with it: the client named no parent, so none is
    // refused. A patch that names one for the plain key is refused where it stands.
    await unit('ksk', 'Kommunstyrelsekontoret', null);
    await unit('it', 'IT', 'ksk');
    const rekey = (Operations: Array<{ op: string; path?: string; value?: unknown }>) =>
      scim.patchGroup(p, groups.get('it')!, { schemas: [SCIM.patch], Operations }, BASE);
    const named = await refusal(
      rekey([
        { op: 'replace', path: 'externalId', value: 'ad:it' },
        { op: 'replace', path: SCIM.unit + ':parent', value: 'unit:ksk' },
      ]),
    );
    expect(named.detail).toContain("carried by a 'unit:' group only");
    expect(store.state.groups.get(groups.get('it')!)?.parentUnitId).toBe('ksk');
    const plain = await rekey([{ op: 'replace', path: 'externalId', value: 'ad:it' }]);
    expect(plain.externalId).toBe('ad:it');
    expect(plain[SCIM.unit]).toBeUndefined();
    expect(store.state.groups.get(groups.get('it')!)?.parentUnitId).toBeNull();
    expect(store.state.audit.at(-1)).toMatchObject({
      action: 'scim.group.patched',
      details: { externalId: 'ad:it', parent: { before: 'ksk', after: null } },
    });
    // Another unit key is still a node, and keeps its place.
    await unit('hr', 'HR', 'ksk');
    const moved = await scim.patchGroup(
      p,
      groups.get('hr')!,
      { schemas: [SCIM.patch], Operations: [{ op: 'replace', path: 'externalId', value: 'unit:personal' }] },
      BASE,
    );
    expect(moved[SCIM.unit]).toEqual({ parent: 'unit:ksk' });
    const removed = await scim.patchGroup(
      p,
      groups.get('hr')!,
      { schemas: [SCIM.patch], Operations: [{ op: 'remove', path: 'externalId' }] },
      BASE,
    );
    expect(removed[SCIM.unit]).toBeUndefined();
  });
  test('attributes and excludedAttributes name the extension by its URN, whole or by its parent', async () => {
    const { scim, p, unit, groups } = harness();
    await unit('ksk', 'Kommunstyrelsekontoret', null);
    await unit('it', 'IT', 'ksk');
    const read = (projection: { attributes?: string; excludedAttributes?: string }) =>
      scim.getGroup(p, groups.get('it')!, BASE, projection);
    for (const attributes of [SCIM.unit, `externalId,${SCIM.unit}:parent`, SCIM.unit.toUpperCase() + ':parent']) {
      const got = await read({ attributes });
      expect(got[SCIM.unit]).toEqual({ parent: 'unit:ksk' });
      expect('displayName' in got).toBe(false);
    }
    const without = await read({ excludedAttributes: SCIM.unit });
    expect(SCIM.unit in without).toBe(false);
    expect(without.displayName).toBe('IT');
  });
  test('discovery names the extension on Group and describes its one attribute', () => {
    expect(resourceTypes(BASE).find(r => r.id === 'Group')?.schemaExtensions).toEqual([
      { schema: SCIM.unit, required: false },
    ]);
    const schema = schemaDocuments(BASE).find(s => s.id === SCIM.unit);
    expect(schema?.attributes.map(a => a.name)).toEqual(['parent']);
    expect(schema?.meta.location).toBe(`${BASE}/Schemas/${SCIM.unit}`);
  });
});

describe('a manager works with their direct reports (D99)', () => {
  /**
   * Kommunstyrelsekontoret (karin leads; stina is placed there)
   *   └ KSK Avdelningar (nobody leads; olle is placed there)
   *       ├ Digitalisering och IT (david leads; ida is placed there)
   *       │   └ Utveckling (ulla and uno lead; max and mia are placed there)
   *       └ HR (nobody leads; hanna is placed there)
   *           └ Lön (lars leads; lisa is placed there)
   */
  async function organisation() {
    const h = harness();
    for (const name of ['karin', 'stina', 'olle', 'david', 'ida', 'ulla', 'uno', 'max', 'mia', 'hanna', 'lars', 'lisa'])
      await h.person(name);
    await h.unit('ksk', 'Kommunstyrelsekontoret', null, ['stina']);
    await h.unit('avd', 'KSK Avdelningar', 'ksk', ['olle']);
    await h.unit('it', 'Digitalisering och IT', 'avd', ['ida']);
    await h.unit('utv', 'Utveckling', 'it', ['max', 'mia']);
    await h.unit('hr', 'HR', 'avd', ['hanna']);
    await h.unit('lon', 'Lön', 'hr', ['lisa']);
    await h.managers('ksk', ['karin']);
    await h.managers('it', ['david']);
    await h.managers('utv', ['ulla', 'uno']);
    await h.managers('lon', ['lars']);
    const staff = staffUsecases({ store: h.store });
    const reports = async (name: string) =>
      (await staff.overview(h.persona(name))).units.map(u => ({
        unit: u.unitLabel,
        people: u.people.map(q => [q.name, q.role, ...(q.below ?? []).map(b => b.unitLabel + ':' + b.role)].join(' ')),
      }));
    return { ...h, staff, reports };
  }
  test('a manager high up sees the people placed with them and the managers directly below, never the people those managers lead', async () => {
    const { reports } = await organisation();
    expect(await reports('karin')).toEqual([
      {
        unit: 'Kommunstyrelsekontoret',
        people: [
          'David manager Digitalisering och IT:manager',
          // HR has no manager, so the line passes through it: hanna reports up, and so does the manager below her.
          'Hanna employee HR:employee',
          'Lars manager Lön:manager',
          'Olle employee KSK Avdelningar:employee',
          'Stina employee',
        ],
      },
    ]);
  });
  test('a deactivated manager leads nobody: the line passes through their unit, and the tree says the same', async () => {
    const h = await organisation();
    // The directory deactivates David; his memberships, and so his assignment as manager of IT, stay.
    await h.scim.deleteUser(h.p, h.id('david'));
    const [ksk] = await h.reports('karin');
    expect(ksk!.people).toEqual([
      'David manager Digitalisering och IT:manager',
      'Hanna employee HR:employee',
      'Ida employee Digitalisering och IT:employee',
      'Lars manager Lön:manager',
      'Olle employee KSK Avdelningar:employee',
      'Stina employee',
      'Ulla manager Utveckling:manager',
      'Uno manager Utveckling:manager',
    ]);
    const tree = await organisationUsecases({ store: h.store }).overview(h.persona('karin', ['admin.users']));
    expect(tree.units.find(u => u.unitId === 'it')).toMatchObject({ managers: [], placed: 1, line: 'above' });
  });
  test('a manager in the middle sees their own people and the managers of the unit below, and a manager at the edge sees what they saw before', async () => {
    const { reports } = await organisation();
    expect(await reports('david')).toEqual([
      {
        unit: 'Digitalisering och IT',
        people: ['Ida employee', 'Ulla manager Utveckling:manager', 'Uno manager Utveckling:manager'],
      },
    ]);
    // D94 as it was: everyone assigned to the unit, a co-manager with their role, never the reader.
    expect(await reports('ulla')).toEqual([
      { unit: 'Utveckling', people: ['Max employee', 'Mia employee', 'Uno manager'] },
    ]);
  });
  test('a manager who is still listed on the units below, as a flat push did it, gets a card per unit and nobody twice', async () => {
    const h = await organisation();
    // karin is also pushed as a manager of IT, beside david.
    await h.scim.replaceGroup(
      h.p,
      [...h.store.state.groups.values()].find(g => g.externalId === 'unit-manager:it')!.id,
      {
        externalId: 'unit-manager:it',
        displayName: 'Chefer · it',
        members: [{ value: h.id('david') }, { value: h.id('karin') }],
      },
      BASE,
    );
    expect(await h.reports('karin')).toEqual([
      {
        unit: 'Digitalisering och IT',
        people: ['David manager', 'Ida employee', 'Ulla manager Utveckling:manager', 'Uno manager Utveckling:manager'],
      },
      {
        unit: 'Kommunstyrelsekontoret',
        people: [
          'Hanna employee HR:employee',
          'Lars manager Lön:manager',
          'Olle employee KSK Avdelningar:employee',
          'Stina employee',
        ],
      },
    ]);
  });
  test('without a tree nothing changes, and someone who manages no unit is still refused', async () => {
    const h = harness();
    for (const name of ['hillevi', 'anna', 'petra']) await h.person(name);
    await h.unit('skola', 'Bergsåkers skola', null, ['anna']);
    await h.unit('ekonomi', 'Ekonomi', null, []);
    await h.managers('skola', ['hillevi']);
    await h.managers('ekonomi', ['petra']);
    const staff = staffUsecases({ store: h.store });
    expect((await staff.overview(h.persona('hillevi'))).units).toEqual([
      {
        unitId: 'skola',
        unitLabel: 'Bergsåkers skola',
        people: [
          {
            id: h.id('anna'),
            name: 'Anna',
            userName: 'anna',
            email: 'anna@sundsvall.test',
            role: 'employee',
            enabled: true,
          },
        ],
      },
    ]);
    await expect(staff.overview(h.persona('anna'))).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('Administration › Organisation (D99)', () => {
  async function organisation() {
    const h = harness();
    for (const name of ['karin', 'stina', 'david', 'ida', 'hanna', 'nils']) await h.person(name);
    await h.person('gone', false);
    await h.unit('ksk', 'Kommunstyrelsekontoret', null, ['stina']);
    await h.unit('avd', 'KSK Avdelningar', 'ksk');
    await h.unit('it', 'Digitalisering och IT', 'avd', ['ida', 'gone']);
    await h.unit('fritid', 'Kultur och fritid', null, ['hanna']);
    await h.unit('arkiv', 'Arkivet', 'fritid');
    await h.managers('ksk', ['karin']);
    await h.managers('it', ['david']);
    // A manager of a unit nobody pushed a unit group for.
    await h.managers('okand', ['nils']);
    return { ...h, organisation: organisationUsecases({ store: h.store }) };
  }
  test('the tree with who leads each unit, how many are placed on it and below it, and what a push left wrong', async () => {
    const h = await organisation();
    const view = await h.organisation.overview(h.persona('karin', ['admin.users']));
    expect(view.unplaced).toBe(0);
    expect(view.units.map(u => u.unitLabel)).toEqual([
      'Arkivet',
      'Digitalisering och IT',
      'Kommunstyrelsekontoret',
      'KSK Avdelningar',
      'Kultur och fritid',
      'okand',
    ]);
    const by = Object.fromEntries(view.units.map(u => [u.unitId, u]));
    expect(by.ksk).toEqual({
      unitId: 'ksk',
      unitLabel: 'Kommunstyrelsekontoret',
      parentId: null,
      managers: [{ id: h.id('karin'), name: 'Karin' }],
      placed: 2,
      branch: 4,
      line: 'own',
      pushed: true,
    });
    // Nobody leads it and nobody is placed on it, yet it is a node; a deactivated person is counted nowhere.
    expect(by.avd).toMatchObject({ parentId: 'ksk', managers: [], placed: 0, branch: 2, line: 'above' });
    expect(by.it).toMatchObject({ parentId: 'avd', placed: 2, branch: 2, line: 'own' });
    expect(by.fritid).toMatchObject({ parentId: null, managers: [], placed: 1, branch: 1, line: 'none' });
    expect(by.arkiv).toMatchObject({ parentId: 'fritid', placed: 0, branch: 0, line: 'none' });
    expect(by.okand).toMatchObject({ unitLabel: 'okand', parentId: null, placed: 1, line: 'own', pushed: false });
  });
  test('a person who is active and placed nowhere is counted, and the people of a unit are read on their own', async () => {
    const h = await organisation();
    await h.person('ny');
    const admin = h.persona('karin', ['admin.users']);
    expect((await h.organisation.overview(admin)).unplaced).toBe(1);
    expect(await h.organisation.unit(admin, 'it')).toEqual({
      unitId: 'it',
      unitLabel: 'Digitalisering och IT',
      people: [
        {
          id: h.id('david'),
          name: 'David',
          userName: 'david',
          email: 'david@sundsvall.test',
          role: 'manager',
          enabled: true,
        },
        {
          id: h.id('gone'),
          name: 'Gone',
          userName: 'gone',
          email: 'gone@sundsvall.test',
          role: 'employee',
          enabled: false,
        },
        { id: h.id('ida'), name: 'Ida', userName: 'ida', email: 'ida@sundsvall.test', role: 'employee', enabled: true },
      ],
      reports: [],
    });
    // Who reports to the unit's manager from below: the manager of the nearest led unit, through the unit nobody
    // leads, and never the people that manager leads. A unit nobody leads has no reports of its own.
    const ksk = await h.organisation.unit(admin, 'ksk');
    expect(ksk.people.map(q => [q.name, q.role])).toEqual([
      ['Karin', 'manager'],
      ['Stina', 'employee'],
    ]);
    expect(ksk.reports).toEqual([
      {
        id: h.id('david'),
        name: 'David',
        userName: 'david',
        email: 'david@sundsvall.test',
        role: 'manager',
        enabled: true,
        below: [{ unitId: 'it', unitLabel: 'Digitalisering och IT', role: 'manager' }],
      },
    ]);
    expect((await h.organisation.unit(admin, 'avd')).reports).toEqual([]);
    expect((await h.organisation.unit(admin, 'avd')).people).toEqual([]);
    expect((await h.organisation.unit(admin, 'okand')).people.map(q => q.name)).toEqual(['Nils']);
  });
  test('only an administrator of users reads it, and a unit of another organisation does not exist', async () => {
    const h = await organisation();
    await expect(h.organisation.overview(h.persona('karin'))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(h.organisation.overview(h.persona('karin', ['admin.connectors']))).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(h.organisation.unit(h.persona('karin'), 'it')).rejects.toBeInstanceOf(ForbiddenError);
    const elsewhere = h.persona('karin', ['admin.users'], 'timra');
    expect((await h.organisation.overview(elsewhere)).units).toEqual([]);
    await expect(h.organisation.unit(elsewhere, 'it')).rejects.toBeInstanceOf(InputError);
    await expect(h.organisation.unit(h.persona('karin', ['admin.users']), 'finns-inte')).rejects.toBeInstanceOf(
      InputError,
    );
  });
  test('a parent that names no node is read as no parent, and a chain that is a cycle still ends', () => {
    const view = organisationOf(
      [
        { id: 'a', label: 'A', parentId: 'b' },
        { id: 'b', label: 'B', parentId: 'a' },
        { id: 'c', label: 'C', parentId: 'missing' },
      ],
      [{ personId: 'p', name: 'P', enabled: true, unitId: 'a', role: 'employee' }],
    );
    expect(view.units.map(u => [u.unitId, u.parentId, u.branch, u.line])).toEqual([
      ['a', 'b', 1, 'none'],
      ['b', 'a', 1, 'none'],
      ['c', null, 0, 'none'],
    ]);
  });
  test('a person on two units of a branch is counted once in it, and on each unit they are on', () => {
    const view = organisationOf(
      [
        { id: 'top', label: 'Top', parentId: null },
        { id: 'a', label: 'A', parentId: 'top' },
        { id: 'b', label: 'B', parentId: 'top' },
      ],
      [
        { personId: 'p', name: 'P', enabled: true, unitId: 'a', role: 'manager' },
        { personId: 'p', name: 'P', enabled: true, unitId: 'b', role: 'employee' },
        { personId: 'q', name: 'Q', enabled: true, unitId: 'b', role: 'employee' },
      ],
    );
    expect(view.units.map(u => [u.unitId, u.placed, u.branch])).toEqual([
      ['a', 1, 1],
      ['b', 2, 2],
      ['top', 0, 2],
    ]);
    expect(view.unplaced).toBe(0);
  });
});

/**
 * The tree in any order (D99). The cases above are orders somebody thought of; these are orders nobody did. A seeded
 * generator, so a failure names the seed and the step that reproduce it.
 */
const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
describe('the tree in any order (D99)', () => {
  const unitBody = (unit: string, parent: string | null) => ({
    externalId: 'unit:' + unit,
    displayName: unit.toUpperCase(),
    ...(parent ? { [SCIM.unit]: { parent: 'unit:' + parent } } : {}),
  });
  const stored = async (store: ReturnType<typeof harness>['store']) =>
    store.transaction(async tx => Object.fromEntries((await tx.unitTree(ORG)).map(u => [u.id, u.parentId])));
  test('units created, moved and removed in a random order: the server takes exactly what keeps the tree whole, refuses the rest, and writes one audit row per change', async () => {
    const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    let taken = 0,
      refused = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const { scim, p, store } = harness(),
        random = seeded(seed),
        pick = <T>(list: readonly T[]) => list[Math.floor(random() * list.length)]!;
      // What the tree should be, kept beside the server: a unit and the unit above it.
      const model = new Map<string, string | null>(),
        ids = new Map<string, string>();
      /** Whether `unit` stands below `above`, however far. */
      const standsBelow = (unit: string, above: string) => {
        for (let at = model.get(unit) ?? null; at !== null; at = model.get(at) ?? null) if (at === above) return true;
        return false;
      };
      for (let step = 0; step < 400; step++) {
        const unit = pick(names),
          parent = random() < 0.25 ? null : pick(names),
          operation = pick(['create', 'create', 'move', 'move', 'move', 'remove'] as const),
          audited = store.state.audit.length;
        if (operation !== 'create' && !model.has(unit)) continue;
        const parentStands = parent === null || (model.has(parent) && parent !== unit);
        const allowed =
            operation === 'create'
              ? !model.has(unit) && parentStands
              : operation === 'move'
                ? parentStands && (parent === null || !standsBelow(parent, unit))
                : ![...model.values()].includes(unit),
          changes = allowed && (operation !== 'move' || model.get(unit) !== parent);
        const attempt: Promise<unknown> =
          operation === 'create'
            ? scim.createGroup(p, unitBody(unit, parent), BASE).then(made => ids.set(unit, made.id))
            : operation === 'move'
              ? scim.replaceGroup(p, ids.get(unit)!, unitBody(unit, parent), BASE)
              : scim.deleteGroup(p, ids.get(unit)!);
        const outcome = await attempt.then(
          () => true,
          error => {
            expect(error).toBeInstanceOf(ScimError);
            return false;
          },
        );
        const where = `seed ${seed}, step ${step}: ${operation} ${unit} under ${parent}`;
        expect([where, outcome]).toEqual([where, allowed]);
        if (allowed && operation === 'remove') model.delete(unit);
        else if (allowed) model.set(unit, parent);
        expect([where, store.state.audit.length - audited]).toEqual([where, changes ? 1 : 0]);
        expect([where, await stored(store)]).toEqual([where, Object.fromEntries(model)]);
        if (allowed) taken++;
        else refused++;
      }
    }
    // The orders were not all easy ones: a good share of each.
    expect(taken).toBeGreaterThan(500);
    expect(refused).toBeGreaterThan(500);
  });
  test('a client that sends a tree in the wrong order and sends again what was refused ends with the same tree, and removes it the same way', async () => {
    for (const seed of [11, 12, 13, 14, 15, 16]) {
      const { scim, p, store } = harness(),
        random = seeded(seed),
        shuffled = <T>(list: readonly T[]) =>
          list
            .map(value => [random(), value] as const)
            .sort((a, b) => a[0] - b[0])
            .map(([, value]) => value);
      // Twelve units, each under one of those before it or a root, so the tree is whole and its depth is the seed's.
      const target = new Map<string, string | null>();
      for (let i = 0; i < 12; i++)
        target.set('u' + i, i === 0 || random() < 0.15 ? null : 'u' + Math.floor(random() * i));
      const ids = new Map<string, string>();
      let refusals = 0;
      /** Every unit in `order`, again and again, until none is refused; each round has to get somewhere. */
      const untilTaken = async (order: string[], send: (unit: string) => Promise<unknown>) => {
        for (let pending = order; pending.length;) {
          const left: string[] = [];
          for (const unit of pending)
            await send(unit).catch(error => {
              expect(error).toBeInstanceOf(ScimError);
              refusals++;
              left.push(unit);
            });
          expect([`seed ${seed}`, left.length < pending.length]).toEqual([`seed ${seed}`, true]);
          pending = left;
        }
      };
      await untilTaken(shuffled([...target.keys()]), async unit => {
        ids.set(unit, (await scim.createGroup(p, unitBody(unit, target.get(unit)!), BASE)).id);
      });
      expect(await stored(store)).toEqual(Object.fromEntries(target));
      const created = refusals;
      await untilTaken(shuffled([...target.keys()]), unit => scim.deleteGroup(p, ids.get(unit)!));
      expect(await stored(store)).toEqual({});
      // Nothing that was refused left a trace: one row for each unit made and one for each removed.
      expect(store.state.audit.map(a => a.action).sort()).toEqual([
        ...Array<string>(12).fill('scim.group.created'),
        ...Array<string>(12).fill('scim.group.removed'),
      ]);
      // The order was wrong somewhere, or the test showed nothing.
      expect(created).toBeGreaterThan(0);
      expect(refusals).toBeGreaterThan(created);
    }
  });
});
