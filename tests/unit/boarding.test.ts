import { beforeEach, describe, expect, test } from 'bun:test';
import {
  BOARDING_IMPORT_COLUMNS,
  checkContract,
  BoardingPlanOutputSchema,
  parseBoardingImport,
  type AuthenticatedContext,
  type BoardingImportRow,
} from '../../packages/contracts/src/index';
import { ForbiddenError } from '../../apps/server/src/context';
import { reportsByUnit } from '../../apps/server/src/modules/entities/domain';
import type { Reach, ReachPerson } from '../../apps/server/src/modules/entities/model';
import {
  memoryBoardingDirectory,
  memoryBoardingStore,
  type MemoryBoardingDirectory,
  type MemoryBoardingStore,
} from '../../apps/server/src/modules/boarding/adapters/memory';
import {
  applyingLayers,
  assemble,
  phaseOf,
  suggestionsOf,
  unitsUpward,
} from '../../apps/server/src/modules/boarding/domain';
import type { Report, Staff, UnitNode } from '../../apps/server/src/modules/boarding/model';
import {
  BOARDING_EXPORT_FORMAT,
  BoardingError,
  boardingLeavers,
  boardingUsecases,
  type BoardingUsecases,
} from '../../apps/server/src/modules/boarding/usecases';

/**
 * The boarding module's use cases (D124) on the memory adapter, with a clock, ids and a staff port the test owns, built
 * the way composition builds it (`reportsByUnit` over a reach): which layers apply, how a plan is assembled, who may
 * start, read and tick what, every owner's card opened and closed in the transaction, the timer, the suggestions,
 * the import, erasure and export, and every audit row, none of which carries a name or a title a manager typed.
 */
const ORG = 'org-1';
/** Another organisation, with a manager and a plan of its own: nothing of either is reachable from the first. */
const ORG2 = 'org-2';
/** The tree: the municipality, the care administration, home care, and the team; and a school elsewhere. */
const TREE: UnitNode[] = [
  { id: 'u-kommun', parentId: null },
  { id: 'u-omsorg', parentId: 'u-kommun' },
  { id: 'u-hemtjanst', parentId: 'u-omsorg' },
  { id: 'u-team', parentId: 'u-hemtjanst' },
  { id: 'u-skola', parentId: 'u-kommun' },
];
const reach = (id: string, name: string, userName: string | null, enabled = true): ReachPerson => ({
  id,
  name,
  userName,
  enabled,
  role: 'employee',
});
/** What the layers match on, as the directory has it. Anna is new, starting in three weeks. */
const FACTS: Record<string, Pick<Report, 'unitIds' | 'positionCodes' | 'employments'>> = {
  anna: {
    unitIds: ['u-team'],
    positionCodes: ['underskoterska'],
    employments: [{ employmentType: 'Tillsvidare', startDate: '2026-12-04' }],
  },
  bo: { unitIds: ['u-team'], positionCodes: [], employments: [{ employmentType: 'Tillsvidare' }] },
  cia: {
    unitIds: ['u-team'],
    positionCodes: [],
    employments: [{ employmentType: 'Vikariat', startDate: '2027-01-20' }],
  },
  dan: { unitIds: ['u-team'], positionCodes: [], employments: [{ startDate: 'not a day' }] },
  eve: { unitIds: ['u-skola'], positionCodes: [], employments: [{ startDate: '2026-11-20' }] },
};
const NAMES = [
  'Anna Andersson',
  'Bo Berg',
  'Cia Carlsson',
  'Dan Dahl',
  'Eve Ek',
  'Karin Chef',
  'Olle Chef',
  'Gun Chef',
];
let reaches: Map<string, Reach>;
/** Composition's `Staff`: the reports `reportsByUnit` names, each with their facts, and the tree. */
const staff: Staff = async persona => {
  const r = reaches.get(persona.id);
  if (!r) return { manages: false, reports: [], tree: TREE };
  const units = reportsByUnit(r);
  const people = new Map<string, Report>();
  for (const u of units)
    for (const p of u.people)
      people.set(p.id, {
        id: p.id,
        name: p.name,
        userName: p.userName,
        enabled: p.enabled,
        ...(FACTS[p.id] ?? { unitIds: [], positionCodes: [], employments: [] }),
      });
  return { manages: units.length > 0, reports: [...people.values()], tree: TREE };
};
function personaOf(id: string, name: string, capabilities: AuthenticatedContext['capabilities'] = []) {
  const p: AuthenticatedContext = {
    id,
    name,
    unitId: 'u-team',
    unitLabel: 'Teamet',
    role: 'manager',
    organisationId: ORG,
    principal: { id: 'person:' + id, kind: 'person' },
    capabilities,
    authorizationVersion: 'v1',
    sessionBinding: 'test',
    expiresAt: '2026-12-31T00:00:00.000Z',
    authorize: async () => ({ version: 'v1' }),
  };
  return p;
}
const karin = personaOf('karin', 'Karin Chef');
const olle = personaOf('olle', 'Olle Chef');
const gun = personaOf('gun', 'Gun Chef');
const asAnna = personaOf('anna', 'Anna Andersson');
const asBo = personaOf('bo', 'Bo Berg');
const ada = personaOf('ada', 'Ada Admin', ['admin.boarding']);
const zed = { ...personaOf('zed', 'Zed Chef'), organisationId: ORG2 };
/** The units' names, as the directory has them. */
const LABELS: Record<string, string> = {
  'u-kommun': 'Kommunen',
  'u-omsorg': 'Vård och omsorg',
  'u-hemtjanst': 'Hemtjänst',
  'u-team': 'Teamet',
  'u-skola': 'Skolan',
};

const LAYERS = [
  'layer;event;condition;value;title;kind;owner;offsetDays;tiedTo',
  'Alla nyanställda;introduction;all;;Beställ dator;order;manager;-14;',
  'Alla nyanställda;introduction;all;;Välkomstsamtal;meeting;manager;0;',
  'Alla nyanställda;introduction;all;;Läs värdegrunden;acknowledge;person;3;',
  'Alla nyanställda;introduction;all;;Lunch med faddern;meeting;buddy;1;',
  'Omsorgen;introduction;unit;u-omsorg;Basala hygienrutiner;acknowledge;person;7;',
  'Undersköterskor;introduction;position;underskoterska;HLR;course;person;30;HLR',
  'Vikarier;introduction;employment_type;Vikariat;Vikariepärmen;todo;person;2;',
  'Skolan;introduction;unit;u-skola;Skolans rutiner;todo;person;1;',
  'Alla som slutar;leaving;all;;Avslutningssamtal;meeting;manager;-7;',
  'Alla som slutar;leaving;all;;Återlämna nycklar;todo;person;0;',
].join('\n');
const layerRows = (text = LAYERS): BoardingImportRow[] => {
  const parsed = parseBoardingImport(text);
  expect(parsed.problems).toEqual([]);
  return parsed.rows;
};

let now: Date;
let n: number;
let store: MemoryBoardingStore;
let boarding: BoardingUsecases;
let logged: unknown[][];
let directory: MemoryBoardingDirectory;
let switchedOn: boolean;
beforeEach(async () => {
  switchedOn = true;
  now = new Date('2026-11-13T09:00:00.000Z');
  n = 0;
  logged = [];
  // Karin leads the team: Anna, Bo, Cia and Dan report to her; Gun, her own manager, is placed on the team too and
  // leads the unit above it, so Personal would list her and `reportsByUnit` does not. Olle leads the school with Eve.
  reaches = new Map([
    [
      'karin',
      {
        units: [{ unitId: 'u-team', unitLabel: 'Teamet', role: 'manager' }],
        managed: [
          {
            unitId: 'u-team',
            unitLabel: 'Teamet',
            people: [
              reach('anna', 'Anna Andersson', 'anna.a'),
              reach('bo', 'Bo Berg', 'bo.b'),
              reach('cia', 'Cia Carlsson', 'cia.c'),
              reach('dan', 'Dan Dahl', null),
              { ...reach('gun', 'Gun Chef', 'gun.c'), role: 'manager' },
            ],
          },
        ],
        above: ['gun'],
        lineReports: [],
      },
    ],
    [
      'olle',
      {
        units: [{ unitId: 'u-skola', unitLabel: 'Skolan', role: 'manager' }],
        managed: [{ unitId: 'u-skola', unitLabel: 'Skolan', people: [reach('eve', 'Eve Ek', 'eve.e')] }],
        above: [],
        lineReports: [],
      },
    ],
    [
      'zed',
      {
        units: [{ unitId: 'u-far', unitLabel: 'Långt bort', role: 'manager' }],
        managed: [{ unitId: 'u-far', unitLabel: 'Långt bort', people: [reach('xavier', 'Xavier Ytter', 'xavier.y')] }],
        above: [],
        lineReports: [],
      },
    ],
  ]);
  // The directory: Karin leads the team, Olle the school, Gun home care above the team; the rest are placed.
  directory = memoryBoardingDirectory({
    units: [
      ...TREE.map(u => ({ ...u, organisationId: ORG, label: LABELS[u.id]! })),
      { id: 'u-far', parentId: null, organisationId: ORG2, label: 'Långt bort' },
    ],
    people: [
      member('karin', 'u-team', 'manager'),
      member('olle', 'u-skola', 'manager'),
      member('gun', 'u-hemtjanst', 'manager'),
      ...['anna', 'bo', 'cia', 'dan'].map(id => member(id, 'u-team')),
      member('eve', 'u-skola'),
      member('zed', 'u-far', 'manager', ORG2),
      member('xavier', 'u-far', 'employee', ORG2),
    ],
  });
  const people: Array<[string, string, string | null]> = [
    ['anna', 'Anna Andersson', 'anna.a'],
    ['bo', 'Bo Berg', 'bo.b'],
    ['cia', 'Cia Carlsson', 'cia.c'],
    ['dan', 'Dan Dahl', null],
    ['eve', 'Eve Ek', 'eve.e'],
    ['karin', 'Karin Chef', 'karin.c'],
    ['olle', 'Olle Chef', 'olle.c'],
    ['gun', 'Gun Chef', 'gun.c'],
  ];
  store = memoryBoardingStore({
    persons: [
      ...people.map(([id, name, userName]) => ({ id, organisationId: ORG, name, userName, enabled: true })),
      { id: 'zed', organisationId: ORG2, name: 'Zed Chef', userName: 'zed.c', enabled: true },
      { id: 'xavier', organisationId: ORG2, name: 'Xavier Ytter', userName: 'xavier.y', enabled: true },
    ],
  });
  boarding = boardingUsecases({
    store,
    staff,
    clock: () => now,
    ids: () => 'id-' + ++n,
    log: (...line) => logged.push(line),
    directory,
    switchedOn: async () => switchedOn,
  });
  await boarding.seedLayers('operator:test', ORG, layerRows());
  await boarding.seedLayers('operator:test', ORG2, layerRows());
});
const at = () => now.toISOString();
/** A person as the directory places them: on one unit, with a role there. */
const member = (id: string, unitId: string, role: 'manager' | 'employee' = 'employee', organisationId = ORG) => ({
  id,
  organisationId,
  enabled: true,
  assignments: [{ unitId, role }],
  positionCodes: [],
  employments: [],
});
/** The people module's leavers port telling boarding, as composition binds it, in a transaction of the store's. */
const leave = (personId: string, kind: 'deactivated' | 'reactivated' = 'deactivated') =>
  store.transaction(tx =>
    boardingLeavers(tx, directory)[kind]({ actor: 'provisioner:test', personId, organisationId: ORG, at: at() }),
  );
/** Every audit row's text, so a test can say no name and no typed title is in any of them. */
const auditText = () => JSON.stringify(store.audit());
/** Karin starts Anna's introduction on her first day with Bo as her buddy, unless told otherwise; `buddyId: null` names none. */
const start = (
  persona = karin,
  extra: { personId?: string; anchorOn?: string; buddyId?: string | null; event?: 'introduction' | 'leaving' } = {},
) =>
  boarding.startPlan(persona, {
    personId: extra.personId ?? 'anna',
    event: extra.event ?? 'introduction',
    anchorOn: extra.anchorOn ?? '2026-12-04',
    ...(extra.buddyId === null ? {} : { buddyId: extra.buddyId ?? 'bo' }),
  });
const itemsOf = (planId: string) =>
  [...store.state.items.values()].filter(i => i.planId === planId).sort((a, b) => a.position - b.position);
const forbidden = async (p: Promise<unknown>, message?: string) => {
  const error = await p.then(() => undefined).catch(e => e);
  expect(error).toBeInstanceOf(ForbiddenError);
  if (message) expect((error as Error).message).toBe(message);
};
const refused = async (p: Promise<unknown>, message: string) => {
  const error = await p.then(() => undefined).catch(e => e);
  expect(error).toBeInstanceOf(BoardingError);
  expect((error as Error).message).toBe(message);
};

describe('the rules', () => {
  test('a unit layer matches the person’s unit and every unit above it, a position by code, an employment type exactly', () => {
    expect([...unitsUpward(['u-team'], TREE)].sort()).toEqual(['u-hemtjanst', 'u-kommun', 'u-omsorg', 'u-team']);
    // A cycle in the tree ends the walk.
    expect(
      [
        ...unitsUpward(
          ['a'],
          [
            { id: 'a', parentId: 'b' },
            { id: 'b', parentId: 'a' },
          ],
        ),
      ].sort(),
    ).toEqual(['a', 'b']);
    const layer = (id: string, condition: 'all' | 'unit' | 'position' | 'employment_type', value: string | null) => ({
      id,
      name: id,
      condition,
      value,
    });
    const layers = [
      layer('position', 'position', 'underskoterska'),
      layer('omsorg', 'unit', 'u-omsorg'),
      layer('alla', 'all', null),
      layer('skola', 'unit', 'u-skola'),
      layer('tillsvidare', 'employment_type', 'Tillsvidare'),
      layer('tillsvidare-lower', 'employment_type', 'tillsvidare'),
      layer('sjukskoterska', 'position', 'sjukskoterska'),
    ];
    expect(applyingLayers(layers, FACTS.anna!, TREE).map(l => l.id)).toEqual([
      'alla',
      'omsorg',
      'position',
      'tillsvidare',
    ]);
  });

  test('items are assembled flat from the day and the offsets, owned by role, the manager standing in for no buddy', () => {
    const items = [
      {
        id: 'i1',
        layerId: 'b',
        position: 0,
        title: 'B0',
        kind: 'todo' as const,
        ownerRole: 'person' as const,
        offsetDays: 3,
        tiedTo: null,
      },
      {
        id: 'i2',
        layerId: 'a',
        position: 1,
        title: 'A1',
        kind: 'todo' as const,
        ownerRole: 'buddy' as const,
        offsetDays: 3,
        tiedTo: null,
      },
      {
        id: 'i3',
        layerId: 'a',
        position: 0,
        title: 'A0',
        kind: 'order' as const,
        ownerRole: 'manager' as const,
        offsetDays: -14,
        tiedTo: null,
      },
      {
        id: 'i4',
        layerId: 'x',
        position: 0,
        title: 'X',
        kind: 'todo' as const,
        ownerRole: 'person' as const,
        offsetDays: 0,
        tiedTo: null,
      },
    ];
    const owners = { managerId: 'karin', personId: 'anna', buddyId: null };
    expect(
      assemble([{ id: 'a' }, { id: 'b' }], items, '2026-12-04', owners).map(i => [i.title, i.dueOn, i.ownerId]),
    ).toEqual([
      ['A0', '2026-11-20', 'karin'],
      ['A1', '2026-12-07', 'karin'],
      ['B0', '2026-12-07', 'anna'],
    ]);
  });

  test('the phase of an item is its distance from the day, mirrored for a leaving', () => {
    expect([-1, 0, 1, 6, 7, 89, 90].map(d => phaseOf('introduction', d))).toEqual([
      'beforeStart',
      'firstDay',
      'firstWeek',
      'firstWeek',
      'first90Days',
      'first90Days',
      'later',
    ]);
    expect([-90, -89, -7, -6, -1, 0, 1].map(d => phaseOf('leaving', d))).toEqual([
      'earlier',
      'last90Days',
      'last90Days',
      'lastWeek',
      'lastWeek',
      'lastDay',
      'afterLeaving',
    ]);
  });
});

describe('starting a plan', () => {
  test('the preview shows the layers that apply and every item with its owner, day and phase, and writes nothing', async () => {
    const audited = store.audit().length;
    const preview = await boarding.preview(karin, {
      personId: 'anna',
      event: 'introduction',
      anchorOn: '2026-12-04',
      buddyId: 'bo',
    });
    expect(preview.layers.map(l => l.name)).toEqual(['Alla nyanställda', 'Omsorgen', 'Undersköterskor']);
    expect(preview.items.map(i => [i.title, i.dueOn, i.owner.name, i.phase])).toEqual([
      ['Beställ dator', '2026-11-20', 'Karin Chef', 'beforeStart'],
      ['Välkomstsamtal', '2026-12-04', 'Karin Chef', 'firstDay'],
      ['Lunch med faddern', '2026-12-05', 'Bo Berg', 'firstWeek'],
      ['Läs värdegrunden', '2026-12-07', 'Anna Andersson', 'firstWeek'],
      ['Basala hygienrutiner', '2026-12-11', 'Anna Andersson', 'first90Days'],
      ['HLR', '2027-01-03', 'Anna Andersson', 'first90Days'],
    ]);
    expect(store.audit().length).toBe(audited);
    expect(store.state.plans.size).toBe(0);
  });

  test('the manager starts it: the plan, its items in due order and one card per item in its owner’s stream, with one audit row', async () => {
    const { id } = await start();
    expect(store.state.plans.get(id)).toEqual({
      id,
      organisationId: ORG,
      personId: 'anna',
      event: 'introduction',
      anchorOn: '2026-12-04',
      buddyId: 'bo',
      startedBy: 'karin',
      startedAt: at(),
      closedAt: null,
      heldAt: null,
      heldBy: [],
    });
    const items = itemsOf(id);
    expect(items.map(i => [i.position, i.title, i.ownerId, i.dueOn, i.added, i.sourceLayerId !== null])).toEqual([
      [0, 'Beställ dator', 'karin', '2026-11-20', false, true],
      [1, 'Välkomstsamtal', 'karin', '2026-12-04', false, true],
      [2, 'Lunch med faddern', 'bo', '2026-12-05', false, true],
      [3, 'Läs värdegrunden', 'anna', '2026-12-07', false, true],
      [4, 'Basala hygienrutiner', 'anna', '2026-12-11', false, true],
      [5, 'HLR', 'anna', '2027-01-03', false, true],
    ]);
    expect(items[5]).toMatchObject({ kind: 'course', tiedTo: 'HLR' });
    // Each card was opened in its owner's stream, before its item, about Anna by her key; even Anna's, who cannot
    // sign in yet: the card waits for her.
    for (const item of items)
      expect(store.state.cards.get(item.threadId!)).toEqual({
        personId: item.ownerId!,
        itemId: item.id,
        planId: id,
        title: item.title,
        dueOn: item.dueOn,
        subject: { entity: 'person', key: 'anna.a' },
        state: 'open',
        timer: true,
      });
    const last = store.audit().at(-1)!;
    expect(last).toEqual({
      actor: 'person:karin',
      action: 'boarding.plan_started',
      subject: 'plan:' + id,
      at: at(),
      details: { personId: 'anna', event: 'introduction', anchorOn: '2026-12-04', layers: 3, items: 6, buddy: true },
    });
    for (const name of NAMES) expect(auditText()).not.toContain(name);
  });

  test('without a buddy the buddy’s items are the manager’s; a leaving is assembled from its own layers', async () => {
    const { id } = await start(karin, { buddyId: null });
    expect(itemsOf(id).find(i => i.title === 'Lunch med faddern')?.ownerId).toBe('karin');
    const leaving = await boarding.startPlan(karin, { personId: 'bo', event: 'leaving', anchorOn: '2027-01-31' });
    expect(itemsOf(leaving.id).map(i => [i.title, i.ownerId, i.dueOn])).toEqual([
      ['Avslutningssamtal', 'karin', '2027-01-24'],
      ['Återlämna nycklar', 'bo', '2027-01-31'],
    ]);
    const plain = await boarding.startPlan(karin, { personId: 'cia', event: 'introduction', anchorOn: '2027-01-20' });
    // Cia is a substitute: her employment type's layer applies, by the text exactly as the directory wrote it.
    expect(itemsOf(plain.id).map(i => i.title)).toContain('Vikariepärmen');
  });

  test('refused for someone the manager does not manage, for a second open plan, for their own manager, and for anyone who manages no one', async () => {
    await forbidden(start(olle), 'Personen finns inte bland dem du är chef för.');
    // Gun is placed on Karin's team but leads the unit above it: she is Karin's manager, never her report (D99, D117).
    await forbidden(start(karin, { personId: 'gun' }), 'Personen finns inte bland dem du är chef för.');
    await forbidden(
      start(asAnna, { personId: 'bo' }),
      'Introduktion och avslut startas av den som är chef för personen.',
    );
    await start();
    const audited = store.audit().length;
    await refused(start(), 'Personen har redan en pågående introduktion.');
    expect(store.audit().length).toBe(audited);
    expect(store.state.plans.size).toBe(1);
  });

  test('refused for a day that is no calendar day or more than a year away, and for a buddy who is not another report', async () => {
    await refused(start(karin, { anchorOn: '2026-02-30' }), 'Ange ett giltigt datum.');
    await refused(start(karin, { anchorOn: '2027-11-20' }), 'Dagen ska ligga högst ett år före eller efter i dag.');
    await refused(start(karin, { buddyId: 'anna' }), 'Faddern ska vara någon annan som du är chef för.');
    await refused(start(karin, { buddyId: 'eve' }), 'Faddern ska vara någon annan som du är chef för.');
    expect(store.state.plans.size).toBe(0);
  });

  test('a card that cannot be opened rolls the whole plan back', async () => {
    store.sink.throwOn = 'open';
    await expect(start()).rejects.toThrow('card sink failed on open');
    expect(store.state.plans.size).toBe(0);
    expect(store.state.items.size).toBe(0);
    expect(store.audit().some(a => a.action === 'boarding.plan_started')).toBe(false);
  });
});

describe('working the plan', () => {
  test('the owner ticks their item off and its card closes; un-ticking reopens it; each with its audit row', async () => {
    const { id } = await start();
    const lunch = itemsOf(id).find(i => i.title === 'Lunch med faddern')!;
    await boarding.setDone(asBo, lunch.id);
    expect(store.state.items.get(lunch.id)).toMatchObject({ doneAt: at(), doneBy: 'bo' });
    expect(store.state.cards.get(lunch.threadId!)?.state).toBe('handled');
    expect(store.calls().at(-1)).toEqual({ op: 'close', threadId: lunch.threadId!, at: at(), why: 'done' });
    expect(store.audit().at(-1)).toEqual({
      actor: 'person:bo',
      action: 'boarding.item_done',
      subject: 'item:' + lunch.id,
      at: at(),
      details: { planId: id, ownerRole: 'buddy', by: 'owner' },
    });
    // Ticking again changes nothing.
    const audited = store.audit().length;
    await boarding.setDone(asBo, lunch.id);
    expect(store.audit().length).toBe(audited);
    await boarding.setNotDone(asBo, lunch.id);
    expect(store.state.items.get(lunch.id)).toMatchObject({ doneAt: null, doneBy: null });
    expect(store.state.cards.get(lunch.threadId!)?.state).toBe('open');
    expect(store.calls().at(-1)).toEqual({ op: 'reopen', threadId: lunch.threadId!, dueOn: '2026-12-05', at: at() });
    expect(store.audit().at(-1)).toMatchObject({ action: 'boarding.item_reopened', details: { by: 'owner' } });
  });

  test('the plan’s manager ticks anyone’s item; a buddy cannot tick another’s, nor can another manager', async () => {
    const { id } = await start();
    const hlr = itemsOf(id).find(i => i.title === 'HLR')!;
    await forbidden(boarding.setDone(asBo, hlr.id), 'Du kan inte ändra den här uppgiften.');
    await forbidden(boarding.setDone(olle, hlr.id), 'Du kan inte ändra den här uppgiften.');
    await forbidden(boarding.setDone(karin, 'no-such-item'), 'Du kan inte ändra den här uppgiften.');
    await boarding.setDone(karin, hlr.id);
    expect(store.audit().at(-1)).toMatchObject({ action: 'boarding.item_done', details: { by: 'manager' } });
    // The person ticks their own.
    const read = itemsOf(id).find(i => i.title === 'Läs värdegrunden')!;
    await boarding.setDone(asAnna, read.id);
    expect(store.state.items.get(read.id)?.doneBy).toBe('anna');
  });

  test('the manager adds an item: its title is sealed free text, never on its card or in the audit row', async () => {
    const { id } = await start();
    const typed = 'Visa Anna hur vi dokumenterar i journalen';
    const added = await boarding.addItem(karin, id, {
      title: `  ${typed}\n`,
      kind: 'meeting',
      ownerRole: 'buddy',
      dueOn: '2026-12-08',
    });
    const item = store.state.items.get(added.id)!;
    expect(item).toMatchObject({
      title: typed,
      added: true,
      ownerId: 'bo',
      position: 6,
      sourceLayerId: null,
      tiedTo: null,
    });
    expect(store.state.cards.get(item.threadId!)).toMatchObject({ personId: 'bo', title: null, dueOn: '2026-12-08' });
    expect(store.audit().at(-1)).toEqual({
      actor: 'person:karin',
      action: 'boarding.item_added',
      subject: 'item:' + added.id,
      at: at(),
      details: { planId: id, kind: 'meeting', ownerRole: 'buddy', dueOn: '2026-12-08' },
    });
    expect(auditText()).not.toContain('journalen');
    expect(JSON.stringify(store.calls())).not.toContain('journalen');
    await refused(
      boarding.addItem(karin, id, { title: ' \n ', kind: 'todo', ownerRole: 'manager', dueOn: '2026-12-08' }),
      'Skriv uppgiften på en rad, högst 200 tecken.',
    );
    await refused(
      boarding.addItem(karin, id, { title: 'x', kind: 'todo', ownerRole: 'manager', dueOn: '2028-01-01' }),
      'Uppgiften ska vara klar högst ett år före eller efter planens dag.',
    );
    await forbidden(
      boarding.addItem(asBo, id, { title: 'x', kind: 'todo', ownerRole: 'manager', dueOn: '2026-12-08' }),
      'Det är bara chefen för personen som kan ändra planen.',
    );
    await forbidden(
      boarding.addItem(olle, id, { title: 'x', kind: 'todo', ownerRole: 'manager', dueOn: '2026-12-08' }),
      'Planen finns inte, eller så kan du inte se den.',
    );
  });

  test('closing the plan closes every open card in the same transaction; it is read-only after, and closing again writes nothing', async () => {
    const { id } = await start();
    const items = itemsOf(id);
    await boarding.setDone(karin, items[0]!.id);
    await forbidden(boarding.closePlan(asAnna, id), 'Det är bara chefen för personen som kan ändra planen.');
    await boarding.closePlan(karin, id);
    expect(store.state.plans.get(id)?.closedAt).toBe(at());
    for (const item of items) expect(store.state.cards.get(item.threadId!)?.state).toBe('handled');
    expect(store.calls().filter(c => c.op === 'close' && c.why === 'closed')).toHaveLength(5);
    expect(store.audit().at(-1)).toEqual({
      actor: 'person:karin',
      action: 'boarding.plan_closed',
      subject: 'plan:' + id,
      at: at(),
      details: { personId: 'anna', event: 'introduction', done: 1, total: 6, cards: 5 },
    });
    const audited = store.audit().length;
    await boarding.closePlan(karin, id);
    expect(store.audit().length).toBe(audited);
    await refused(boarding.setDone(asAnna, items[3]!.id), 'Planen är avslutad och kan inte ändras.');
    // A new introduction may start once the last is closed.
    await start();
  });

  test('the timer brings an open item’s card back with its audit row; a stale generation, a done item and a closed plan change nothing', async () => {
    const { id } = await start();
    const [order, welcome] = itemsOf(id);
    now = new Date('2026-11-21T05:00:00.000Z');
    expect(await boarding.itemDue(order!.threadId!, 1)).toBe(true);
    expect(store.audit().at(-1)).toEqual({
      actor: 'system:scheduler',
      action: 'boarding.item_due',
      subject: 'item:' + order!.id,
      at: at(),
      details: { planId: id, dueOn: '2026-11-20', generation: 1 },
    });
    // The card port says the generation is stale: nothing is written.
    store.sink.fires = (_, generation) => generation === 2;
    let audited = store.audit().length;
    expect(await boarding.itemDue(order!.threadId!, 1)).toBe(false);
    expect(store.audit().length).toBe(audited);
    store.sink.fires = true;
    await boarding.setDone(karin, order!.id);
    audited = store.audit().length;
    expect(await boarding.itemDue(order!.threadId!, 2)).toBe(false);
    expect(await boarding.itemDue('no-such-card', 1)).toBe(false);
    await boarding.closePlan(karin, id);
    audited = store.audit().length;
    expect(await boarding.itemDue(welcome!.threadId!, 1)).toBe(false);
    expect(store.audit().length).toBe(audited);
  });
});

describe('reading plans', () => {
  test('the manager and the person read every item grouped by phase; a buddy reads only their own; anyone else nothing', async () => {
    const { id } = await start();
    const asManager = await boarding.plan(karin, id);
    expect(checkContract(BoardingPlanOutputSchema, asManager)).toBe(true);
    expect(asManager.plan).toMatchObject({
      personId: 'anna',
      name: 'Anna Andersson',
      event: 'introduction',
      access: 'manager',
      done: 0,
      total: 6,
      buddy: { id: 'bo', name: 'Bo Berg' },
      startedBy: { id: 'karin', name: 'Karin Chef' },
    });
    expect(asManager.heading).toBe('Introduktion');
    expect(asManager.note).toBe('Första dagen 4 december · 0 av 6 klara');
    expect(asManager.phases.map(p => [p.label, p.items.map(i => i.title)])).toEqual([
      ['Före första dagen', ['Beställ dator']],
      ['Första dagen', ['Välkomstsamtal']],
      ['Första veckan', ['Lunch med faddern', 'Läs värdegrunden']],
      ['De första 90 dagarna', ['Basala hygienrutiner', 'HLR']],
    ]);
    expect(asManager.rows.every(r => r.canTick)).toBe(true);
    expect(asManager.rows[0]).toMatchObject({
      owner: 'Karin Chef',
      ownerLabel: 'Chef',
      mine: true,
      status: 'Att göra',
    });
    const asPerson = await boarding.plan(asAnna, id);
    expect(asPerson.plan.access).toBe('person');
    expect(asPerson.rows.filter(r => r.canTick).map(r => r.title)).toEqual([
      'Läs värdegrunden',
      'Basala hygienrutiner',
      'HLR',
    ]);
    const asBuddy = await boarding.plan(asBo, id);
    expect(asBuddy.plan.access).toBe('owner');
    expect(asBuddy.rows.map(r => r.title)).toEqual(['Lunch med faddern']);
    await forbidden(boarding.plan(olle, id), 'Planen finns inte, eller så kan du inte se den.');
    await forbidden(boarding.plan(gun, id), 'Planen finns inte, eller så kan du inte se den.');
    // An item past its due day is overdue.
    now = new Date('2026-11-25T09:00:00.000Z');
    expect((await boarding.plan(karin, id)).rows[0]!.status).toBe('Försenad');
  });

  test('after the person is deactivated the plan is held by the manager they had then, not by the one who started it', async () => {
    const { id } = await start(karin, { personId: 'bo', event: 'leaving', anchorOn: '2026-12-31', buddyId: null });
    const [talk, keys] = itemsOf(id);
    // Karin hands the team over to Olle while Bo is still active: Olle manages the plan, and Karin keeps only the
    // item she owns, as its owner.
    const karins = reaches.get('karin')!;
    reaches.set('olle', karins);
    reaches.delete('karin');
    directory.setPerson(member('olle', 'u-team', 'manager'));
    directory.setPerson(member('karin', 'u-skola', 'employee'));
    expect((await boarding.plan(olle, id)).plan.access).toBe('manager');
    const asOwner = await boarding.plan(karin, id);
    expect(asOwner.plan.access).toBe('owner');
    expect(asOwner.rows.map(r => r.title)).toEqual([talk!.title]);
    await forbidden(boarding.setDone(karin, keys!.id), 'Du kan inte ändra den här uppgiften.');
    await forbidden(boarding.closePlan(karin, id), 'Det är bara chefen för personen som kan ändra planen.');
    // Bo leaves: the directory deactivates him, and the leavers port tells boarding in that transaction.
    store.deactivate('bo');
    reaches.get('olle')!.managed[0]!.people.find(p => p.id === 'bo')!.enabled = false;
    await leave('bo');
    expect(store.state.plans.get(id)).toMatchObject({ heldAt: at(), heldBy: ['olle'] });
    expect(store.audit().at(-1)).toEqual({
      actor: 'provisioner:test',
      action: 'boarding.plan_held',
      subject: 'plan:' + id,
      at: at(),
      details: { personId: 'bo', holders: ['olle'] },
    });
    // Olle holds it: he reads it, ticks, adds, lists it, opens Bo's page on it; Karin, who started it, does not.
    expect((await boarding.plan(olle, id)).plan.access).toBe('manager');
    await boarding.setDone(olle, keys!.id);
    await boarding.addItem(olle, id, {
      title: 'Samla in nyckelkortet',
      kind: 'todo',
      ownerRole: 'manager',
      dueOn: '2026-12-31',
    });
    expect((await boarding.plans(olle)).rows.map(r => [r.personId, r.event])).toEqual([['bo', 'leaving']]);
    expect((await boarding.personPlans(olle, 'bo')).plans.map(p => p.id)).toEqual([id]);
    expect((await boarding.personPlans(olle, 'bo')).canStart).toBe(false);
    expect((await boarding.plan(karin, id)).plan.access).toBe('owner');
    await forbidden(
      boarding.addItem(karin, id, { title: 'x', kind: 'todo', ownerRole: 'manager', dueOn: '2026-12-31' }),
      'Det är bara chefen för personen som kan ändra planen.',
    );
    expect((await boarding.plans(karin)).rows).toEqual([]);
    await forbidden(boarding.personPlans(karin, 'bo'), 'Personen finns inte bland dem du är chef för.');
    // Bo is activated again: nobody holds the plan, and the line decides as before.
    store.state.persons.get('bo')!.enabled = true;
    reaches.get('olle')!.managed[0]!.people.find(p => p.id === 'bo')!.enabled = true;
    await leave('bo', 'reactivated');
    expect(store.state.plans.get(id)).toMatchObject({ heldAt: null, heldBy: [] });
    expect(store.audit().at(-1)).toMatchObject({ action: 'boarding.plan_released', subject: 'plan:' + id });
    expect((await boarding.plan(olle, id)).plan.access).toBe('manager');
  });

  test('with nothing recorded at the deactivation (the hook is best effort), the manager who started the plan holds it', async () => {
    const { id } = await start(karin, { personId: 'bo', event: 'leaving', anchorOn: '2026-12-31', buddyId: null });
    reaches.get('karin')!.managed[0]!.people.find(p => p.id === 'bo')!.enabled = false;
    store.deactivate('bo');
    expect(store.state.plans.get(id)).toMatchObject({ heldAt: null, heldBy: [] });
    expect((await boarding.plan(karin, id)).plan.access).toBe('manager');
    expect((await boarding.plans(karin)).rows.map(r => r.id)).toEqual([id]);
    // Recorded with nobody to hold it (he reported to nobody then): nobody holds it, not even the one who started it.
    await store.transaction(tx => tx.holdPlan(id, [], at()));
    expect((await boarding.plan(karin, id)).plan.access).toBe('owner');
    expect((await boarding.plans(karin)).rows).toEqual([]);
  });

  test('the manager’s list holds their reports’ open plans with what waits for them; a person’s page says who may start', async () => {
    const first = await start();
    await boarding.startPlan(karin, { personId: 'cia', event: 'introduction', anchorOn: '2027-01-20' });
    const list = await boarding.plans(karin);
    expect(list.rows.map(r => [r.name, r.anchorOn, r.done, r.total, r.waiting, r.overdue, r.state])).toEqual([
      ['Anna Andersson', '2026-12-04', 0, 6, 2, 0, 'open'],
      ['Cia Carlsson', '2027-01-20', 0, 6, 3, 0, 'open'],
    ]);
    expect((await boarding.plans(olle)).rows).toEqual([]);
    const page = await boarding.personPlans(karin, 'anna');
    expect(page).toMatchObject({
      person: { id: 'anna', name: 'Anna Andersson', userName: 'anna.a', enabled: true },
      canStart: true,
    });
    expect(page.plans.map(p => p.id)).toEqual([first.id]);
    expect(page.buddies.map(b => b.name)).toEqual(['Bo Berg', 'Cia Carlsson', 'Dan Dahl']);
    // Her introduction covers her start, so no first day is suggested any more.
    expect(page.suggestedFirstDay).toBeUndefined();
    const own = await boarding.personPlans(asAnna, 'anna');
    expect(own.canStart).toBe(false);
    expect(own.plans.map(p => p.id)).toEqual([first.id]);
    await forbidden(boarding.personPlans(olle, 'anna'), 'Personen finns inte bland dem du är chef för.');
  });
});

describe('suggestions', () => {
  test('a report whose employment starts within six weeks with no introduction is suggested; the date only prefills', async () => {
    expect(await boarding.suggestions(karin)).toEqual([
      { personId: 'anna', name: 'Anna Andersson', userName: 'anna.a', startOn: '2026-12-04' },
    ]);
    // Cia starts 2027-01-20, more than six weeks ahead; Dan's date is no day, which is logged without a name.
    expect(logged).toEqual([['boarding: start dates that are no calendar day were left out', { reports: 1 }]]);
    expect((await boarding.personPlans(karin, 'anna')).suggestedFirstDay).toBe('2026-12-04');
    // Six weeks before Cia's start, she is suggested too.
    now = new Date('2026-12-09T09:00:00.000Z');
    expect((await boarding.suggestions(karin)).map(s => s.personId)).toEqual(['cia']);
    now = new Date('2026-11-13T09:00:00.000Z');
    // Started, the suggestion is gone; closed early, it does not come back for the same start.
    const { id } = await start();
    expect(await boarding.suggestions(karin)).toEqual([]);
    await boarding.closePlan(karin, id);
    expect(await boarding.suggestions(karin)).toEqual([]);
    // Another manager is suggested their own reports; someone who manages no one, nothing.
    expect((await boarding.suggestions(olle)).map(s => [s.personId, s.startOn])).toEqual([['eve', '2026-11-20']]);
    expect(await boarding.suggestions(asAnna)).toEqual([]);
  });

  test('a start that has passed, or an introduction closed long before it, is judged by the rule', () => {
    const report = (startDate: string): Report => ({
      id: 'x',
      name: 'X',
      userName: 'x',
      enabled: true,
      unitIds: [],
      positionCodes: [],
      employments: [{ startDate }],
    });
    expect(suggestionsOf([report('2026-11-13')], [], '2026-11-13')).toEqual([]);
    expect(suggestionsOf([report('2026-12-25')], [], '2026-11-13').map(s => s.startOn)).toEqual(['2026-12-25']);
    expect(suggestionsOf([report('2026-12-26')], [], '2026-11-13')).toEqual([]);
    const closedLongAgo = {
      personId: 'x',
      event: 'introduction' as const,
      closedAt: '2025-01-01T00:00:00.000Z',
      anchorOn: '2025-01-01',
    };
    expect(suggestionsOf([report('2026-12-01')], [closedLongAgo], '2026-11-13')).toHaveLength(1);
    expect(suggestionsOf([{ ...report('2026-12-01'), enabled: false }], [], '2026-11-13')).toEqual([]);
  });

  test('a report’s place in boarding, as a section on their page and a lens on Personal, answers only for reports', async () => {
    await start();
    const rows = await boarding.aboutPeople(karin, ['ANNA.A', 'bo.b', 'eve.e', 'gun.c', 'anna.a']);
    expect(rows).toEqual([
      {
        key: 'ANNA.A',
        personId: 'anna',
        plan: {
          id: expect.any(String),
          event: 'introduction',
          anchorOn: '2026-12-04',
          done: 0,
          total: 6,
          waiting: 2,
          state: 'open',
        },
      },
    ]);
    now = new Date('2026-12-09T09:00:00.000Z');
    expect(await boarding.aboutPeople(karin, ['cia.c'])).toEqual([
      { key: 'cia.c', personId: 'cia', missingFrom: '2027-01-20' },
    ]);
    expect(await boarding.aboutPeople(olle, ['anna.a'])).toEqual([]);
  });
});

describe('layers', () => {
  test('an administrator imports a file: the same file again changes nothing, a changed layer is replaced, each import audited once', async () => {
    const ada1 = await boarding.importLayers(ada, { rows: layerRows() });
    expect(ada1).toEqual({ layers: 6, added: 0, replaced: 0, unchanged: 6 });
    expect(store.audit().at(-1)).toEqual({
      actor: 'person:ada',
      action: 'boarding.layers_imported',
      subject: 'organisation:' + ORG,
      at: at(),
      details: { organisationId: ORG, rows: 10, layers: 6, added: 0, replaced: 0, unchanged: 6 },
    });
    const changed = [
      BOARDING_IMPORT_COLUMNS.join(';'),
      'OMSORGEN;introduction;unit;u-omsorg;Basala hygienrutiner;acknowledge;person;5;',
      'Nattpersonal;introduction;unit;u-team;Nattrutiner;todo;person;2;',
    ].join('\n');
    expect(await boarding.importLayers(ada, { rows: layerRows(changed) })).toEqual({
      layers: 2,
      added: 1,
      replaced: 1,
      unchanged: 0,
    });
    const read = await boarding.layers(ada);
    expect(read.layers.map(l => l.name)).toEqual([
      'Alla nyanställda',
      'Nattpersonal',
      'OMSORGEN',
      'Skolan',
      'Undersköterskor',
      'Vikarier',
      'Alla som slutar',
    ]);
    expect(read.layers.find(l => l.name === 'OMSORGEN')?.items).toEqual([
      expect.objectContaining({ title: 'Basala hygienrutiner', offsetDays: 5, phase: 'firstWeek' }),
    ]);
    expect(
      store.audit().filter(a => a.action === 'boarding.layers_imported' && a.subject === 'organisation:' + ORG),
    ).toHaveLength(3);
  });

  test('a bad row refuses the whole import with its number, and only an administrator may import or read', async () => {
    const rows = layerRows();
    const bad = rows.map(r => (r.row === 3 ? { ...r, kind: 'Möte' as never } : r));
    const audited = store.audit().length;
    await refused(
      boarding.importLayers(ada, { rows: bad }),
      'Rad 3: Typen finns inte. Använd todo, order, meeting, course, acknowledge eller Att göra, Beställning, Möte, Kurs, Bekräftelse.',
    );
    const split = rows.map(r => (r.row === 4 ? { ...r, condition: 'unit' as const, value: 'u-team' } : r));
    await refused(
      boarding.importLayers(ada, { rows: split }),
      'Rad 4: Samma lager som rad 2, men med ett annat villkor.',
    );
    expect(store.audit().length).toBe(audited);
    await forbidden(boarding.importLayers(karin, { rows }));
    await forbidden(boarding.layers(karin));
  });
});

describe('erasure and export', () => {
  test('erasing a person removes their plans, items and cards and their id on the rest, with one audit row of counts', async () => {
    const hers = await start();
    const his = await boarding.startPlan(karin, {
      personId: 'bo',
      event: 'leaving',
      anchorOn: '2026-12-31',
      buddyId: 'anna',
    });
    const cardsOfHers = itemsOf(hers.id).map(i => i.threadId);
    const erased = await boarding.erasePerson('operator:cli', 'anna');
    expect(erased).toEqual({ plans: 1, items: 6, cleared: 1, cards: 6 });
    expect(store.state.plans.has(hers.id)).toBe(false);
    expect(itemsOf(hers.id)).toEqual([]);
    for (const t of cardsOfHers) expect(store.state.cards.has(t!)).toBe(false);
    expect(store.state.plans.get(his.id)?.buddyId).toBeNull();
    expect(store.calls().find(c => c.op === 'remove')).toEqual({
      op: 'remove',
      threadIds: [...cardsOfHers].sort() as string[],
    });
    expect(store.audit().at(-1)).toEqual({
      actor: 'operator:cli',
      action: 'boarding.person_erased',
      subject: 'person:anna',
      at: at(),
      details: { plans: 1, items: 6, cleared: 1, cards: 6 },
    });
  });

  test('the export is one versioned document of the organisation, typed titles opened, audited with counts', async () => {
    const { id } = await start();
    await boarding.addItem(karin, id, {
      title: 'Ring Anna före start',
      kind: 'todo',
      ownerRole: 'manager',
      dueOn: '2026-12-01',
    });
    const doc = await boarding.exportDomain('operator:cli', ORG);
    expect(doc.format).toBe(BOARDING_EXPORT_FORMAT);
    expect(doc).toMatchObject({ format: 'clew.boarding/1', exportedAt: at(), organisationId: ORG });
    expect(doc.layers).toHaveLength(6);
    expect(doc.plans.map(p => p.id)).toEqual([id]);
    expect(doc.items.map(i => i.title)).toContain('Ring Anna före start');
    expect(store.audit().at(-1)).toEqual({
      actor: 'operator:cli',
      action: 'boarding.exported',
      subject: 'organisation:' + ORG,
      at: at(),
      details: { layers: 6, plans: 1, items: 7 },
    });
    expect(auditText()).not.toContain('Ring Anna');
  });
});

describe('what the review asked for (D124, 2026-11-13)', () => {
  test('an item’s owner who is neither the manager nor the person is told the counts of their own items only', async () => {
    const { id } = await start();
    const lunch = itemsOf(id).find(i => i.title === 'Lunch med faddern')!;
    await boarding.setDone(karin, itemsOf(id)[0]!.id);
    const asBuddy = await boarding.plan(asBo, id);
    expect(asBuddy.plan).toMatchObject({ access: 'owner', done: 0, total: 1 });
    expect(asBuddy.note).toBe('Första dagen 4 december · 0 av 1 klara');
    await boarding.setDone(asBo, lunch.id);
    expect((await boarding.plan(asBo, id)).plan).toMatchObject({ done: 1, total: 1 });
    // The manager and the person see the whole plan.
    expect((await boarding.plan(karin, id)).plan).toMatchObject({ done: 2, total: 6 });
    expect((await boarding.plan(asAnna, id)).plan).toMatchObject({ done: 2, total: 6 });
  });

  test('a plan started late opens its past items’ cards without a timer, and so does opening an overdue item again', async () => {
    // Anna started a week ago; the plan is started today.
    const { id } = await start(karin, { anchorOn: '2026-11-06' });
    const items = itemsOf(id);
    const timers = items.map(i => [i.title, i.dueOn, store.state.cards.get(i.threadId!)!.timer]);
    expect(timers).toEqual([
      ['Beställ dator', '2026-10-23', false],
      ['Välkomstsamtal', '2026-11-06', false],
      ['Lunch med faddern', '2026-11-07', false],
      ['Läs värdegrunden', '2026-11-09', false],
      ['Basala hygienrutiner', '2026-11-13', true],
      ['HLR', '2026-12-06', true],
    ]);
    const order = items[0]!;
    await boarding.setDone(karin, order.id);
    await boarding.setNotDone(karin, order.id);
    expect(store.state.cards.get(order.threadId!)).toMatchObject({ state: 'open', timer: false });
    const hlr = items[5]!;
    await boarding.setDone(asAnna, hlr.id);
    await boarding.setNotDone(asAnna, hlr.id);
    expect(store.state.cards.get(hlr.threadId!)).toMatchObject({ state: 'open', timer: true });
  });

  test('a timer that fires while the module is switched off changes nothing: no card back, no delivery, no audit row', async () => {
    const { id } = await start();
    const order = itemsOf(id)[0]!;
    now = new Date('2026-11-21T05:00:00.000Z');
    switchedOn = false;
    const audited = store.audit().length,
      calls = store.calls().length;
    expect(await boarding.itemDue(order.threadId!, 1)).toBe(false);
    expect(store.audit().length).toBe(audited);
    expect(store.calls().length).toBe(calls);
    // On again, the next timer of the card works as before.
    switchedOn = true;
    expect(await boarding.itemDue(order.threadId!, 1)).toBe(true);
    expect(store.audit().at(-1)).toMatchObject({ action: 'boarding.item_due' });
  });

  test('an item whose owner was erased is the manager’s: shown as theirs, ticked by them, and waits for them', async () => {
    const { id } = await start();
    const lunch = itemsOf(id).find(i => i.title === 'Lunch med faddern')!;
    await boarding.erasePerson('operator:cli', 'bo');
    expect(store.state.items.get(lunch.id)).toMatchObject({ ownerId: null, threadId: null });
    // The erasure opened no card for anyone.
    expect(store.calls().filter(c => c.op === 'open')).toHaveLength(6);
    const read = await boarding.plan(karin, id);
    const row = read.rows.find(r => r.id === lunch.id)!;
    expect(row).toMatchObject({ ownerRole: 'manager', ownerLabel: 'Chef', mine: true, canTick: true });
    expect(row.owner).toBeUndefined();
    expect((await boarding.plan(asAnna, id)).rows.find(r => r.id === lunch.id)).toMatchObject({
      ownerLabel: 'Chef',
      mine: false,
      canTick: false,
    });
    expect((await boarding.plans(karin)).rows[0]!.waiting).toBe(3);
    expect((await boarding.aboutPeople(karin, ['anna.a']))[0]!.plan!.waiting).toBe(3);
    await forbidden(boarding.setDone(asAnna, lunch.id), 'Du kan inte ändra den här uppgiften.');
    await boarding.setDone(karin, lunch.id);
    expect(store.state.items.get(lunch.id)?.doneBy).toBe('karin');
  });

  test('a layer on a unit names the unit in the preview and the administrator’s list; another layer names none', async () => {
    const preview = await boarding.preview(karin, { personId: 'anna', event: 'introduction', anchorOn: '2026-12-04' });
    expect(preview.layers.map(l => [l.name, l.unitLabel])).toEqual([
      ['Alla nyanställda', undefined],
      ['Omsorgen', 'Vård och omsorg'],
      ['Undersköterskor', undefined],
    ]);
    const layers = await boarding.layers(ada);
    expect(layers.layers.find(l => l.name === 'Skolan')?.unitLabel).toBe('Skolan');
    expect(layers.layers.filter(l => 'unitLabel' in l).map(l => l.name)).toEqual(['Omsorgen', 'Skolan']);
    // A unit the directory does not hold has no name to give.
    const bare = boardingUsecases({ store, staff, clock: () => now, ids: () => 'id-' + ++n });
    expect((await bare.layers(ada)).layers.some(l => 'unitLabel' in l)).toBe(false);
  });

  test('adding an item and closing the plan are refused for the plan’s person; a colleague is refused their page', async () => {
    const { id } = await start();
    await forbidden(
      boarding.addItem(asAnna, id, { title: 'x', kind: 'todo', ownerRole: 'person', dueOn: '2026-12-08' }),
      'Det är bara chefen för personen som kan ändra planen.',
    );
    await forbidden(boarding.closePlan(asAnna, id), 'Det är bara chefen för personen som kan ändra planen.');
    // Cia is Anna's colleague: neither her page nor her plan is Cia's to read; Bo, her buddy, reads only his items.
    const asCia = personaOf('cia', 'Cia Carlsson');
    await forbidden(boarding.personPlans(asCia, 'anna'), 'Personen finns inte bland dem du är chef för.');
    await forbidden(boarding.plan(asCia, id), 'Planen finns inte, eller så kan du inte se den.');
    await forbidden(boarding.personPlans(asBo, 'anna'), 'Personen finns inte bland dem du är chef för.');
  });

  test('a plan and a person of another organisation are nobody’s to read, start or change', async () => {
    const { id } = await start();
    const theirs = await boarding.startPlan(zed, { personId: 'xavier', event: 'introduction', anchorOn: '2026-12-04' });
    await forbidden(boarding.plan(zed, id), 'Planen finns inte, eller så kan du inte se den.');
    await forbidden(boarding.plan(karin, theirs.id), 'Planen finns inte, eller så kan du inte se den.');
    await forbidden(boarding.personPlans(zed, 'anna'), 'Personen finns inte bland dem du är chef för.');
    await forbidden(boarding.personPlans(karin, 'xavier'), 'Personen finns inte bland dem du är chef för.');
    await forbidden(
      boarding.startPlan(karin, { personId: 'xavier', event: 'leaving', anchorOn: '2026-12-04' }),
      'Personen finns inte bland dem du är chef för.',
    );
    await forbidden(boarding.setDone(zed, itemsOf(id)[0]!.id), 'Du kan inte ändra den här uppgiften.');
    await forbidden(boarding.closePlan(zed, id), 'Planen finns inte, eller så kan du inte se den.');
    expect((await boarding.plans(zed)).rows.map(r => r.id)).toEqual([theirs.id]);
    expect((await boarding.plans(karin)).rows.map(r => r.id)).toEqual([id]);
    // The export of one organisation holds its own alone.
    expect((await boarding.exportDomain('operator:cli', ORG2)).plans.map(p => p.id)).toEqual([theirs.id]);
  });
});
