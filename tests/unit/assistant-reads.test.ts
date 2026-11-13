import { describe, expect, test } from 'bun:test';
import { rowMark, type AuthenticatedContext, type View } from '../../packages/contracts/src/index';
import {
  READING_CHARS,
  READING_ROWS,
  Registry,
  actorOf,
  dateWords,
  modelReading,
  openGovernance,
  type Connector,
} from '../../packages/connectors/src/index';
import { memoryProvisionStore } from '../../apps/server/src/modules/people/adapters/memory';
import { staffUsecases } from '../../apps/server/src/modules/people/usecases';
import { relationUsecases } from '../../apps/server/src/modules/entities/relations';
import { personKey, reportsByUnit } from '../../apps/server/src/modules/entities/domain';
import { memoryCompetenceStore } from '../../apps/server/src/modules/competence/adapters/memory';
import {
  attentionView,
  competenceConnector,
  holdingsView,
} from '../../apps/server/src/modules/competence/capabilities';
import { competenceUsecases } from '../../apps/server/src/modules/competence/usecases';
import { calendarConnector } from '../../apps/server/src/modules/calendar/connector';
import { memoryThreadStore } from '../../apps/server/src/threads/adapters/memory';
import { assistantUsecases, type AssistantDeps } from '../../apps/server/src/assistant';
import type { ModelGenerate } from '../../apps/server/src/assistant/model';
import { CARD_MARKS_MAX, cardRows } from '../../apps/server/src/assistant/card';
import { fixtureConnectors } from '../fixture-connectors';

/**
 * The assistant reads Clew's own domains as the person who asks, never more (D122). Competence and the calendar are
 * offered to the model; every call the model makes goes through the registry as the asking person (D117), marked as the
 * assistant's (`caller`), and is never the person's own direct read, so the relation `registrar` (D121) is never
 * resolved for it. A manager's read of one report's holdings is logged with the fact that the assistant made it, and the
 * turn's audit row names each read and its count, never a row. On the memory adapters, with the directory of
 * `asked-about.test.ts` cut to what these questions need and a model the test plays: what is asserted is which calls
 * were offered, allowed and refused, and what was recorded; never the prose.
 */
const T = '2026-11-12T08:00:00.000Z';
const ORG = 'poc';
type Placement = { unitId: string; role: 'manager' | 'employee' };

/**
 * Bergsåkers skola is led by Hillevi and by Cohead, whose line runs elsewhere, so neither reports to the other. On the
 * school: Anna, Erik (`Erik.S`) and Maria. Olle leads Fritids below it, with Sven. Karin works in Ekonomi, and Regina
 * there holds Kompetenssökning by grant and manages nobody.
 */
function directory() {
  const store = memoryProvisionStore(),
    s = store.state;
  const unit = (id: string, label: string, parent: string | null) => {
    s.units.set(id, { organisationId: ORG, label });
    s.groups.set('g-' + id, {
      id: 'g-' + id,
      organisationId: ORG,
      externalId: 'unit:' + id,
      label,
      parentUnitId: parent,
      createdAt: T,
      updatedAt: T,
    });
  };
  const person = (id: string, userName: string, name: string, placements: Placement[], relations?: string[]) => {
    s.users.set(id, {
      id,
      organisationId: ORG,
      externalId: 'dev:' + id,
      userName,
      name,
      email: null,
      phoneNumbers: [],
      employments: [],
      title: null,
      enabled: true,
      createdAt: T,
      updatedAt: T,
    });
    s.assignments.set(id, placements);
    s.grants.set(id, {
      unitId: placements[0]!.unitId,
      unitLabel: s.units.get(placements[0]!.unitId)!.label,
      role: placements[0]!.role,
      capabilities: [],
      ...(relations ? { relations } : {}),
    });
  };
  const m = (unitId: string): Placement => ({ unitId, role: 'manager' });
  const e = (unitId: string): Placement => ({ unitId, role: 'employee' });
  unit('unit-skola', 'Bergsåkers skola', null);
  unit('unit-fritids', 'Fritids', 'unit-skola');
  unit('unit-ekonomi', 'Ekonomi', null);
  person('hillevi', 'hillevi', 'Hillevi Berg', [m('unit-skola')]);
  person('cohead', 'cohead', 'Cecilia Holm', [m('unit-skola')]);
  person('anna', 'anna', 'Anna Lindqvist', [e('unit-skola')]);
  person('erik', 'Erik.S', 'Erik Sandström', [e('unit-skola')]);
  person('maria', 'maria', 'Maria Källström', [e('unit-skola')]);
  person('olle', 'olle', 'Olle Ek', [m('unit-fritids')]);
  person('sven', 'sven', 'Sven Berg', [e('unit-fritids')]);
  person('karin', 'karin', 'Karin Lund', [e('unit-ekonomi')]);
  person('regina', 'regina', 'Regina Ström', [e('unit-ekonomi')], ['registrar']);
  const persona = (id: string): AuthenticatedContext => {
    const user = s.users.get(id)!,
      grant = s.grants.get(id)!;
    return {
      id,
      name: user.name,
      unitId: grant.unitId,
      unitLabel: grant.unitLabel,
      role: grant.role,
      userName: user.userName!,
      organisationId: ORG,
      principal: { id: 'person:' + id, kind: 'person' },
      capabilities: [],
      ...(grant.relations?.length ? { relationGrants: grant.relations as Array<'registrar'> } : {}),
      authorizationVersion: 'v1',
      sessionBinding: 'test',
      expiresAt: '2099-01-01T00:00:00.000Z',
      authorize: async () => ({ version: 'v1' }),
    };
  };
  const staff = staffUsecases({ store });
  const relations = relationUsecases({ directory: staff, reader: async actor => persona(actor.id) });
  return { persona, staff, relations, state: s };
}

type Callable = { execute: (input: unknown, options: unknown) => Promise<unknown>; description?: string };
type Script = Array<[tool: string, input: Record<string, unknown>]>;
/**
 * A tool-using model the test plays: each turn it calls the tools named in `turn.script` in order and answers
 * `turn.text`, and it keeps what it is offered, told (the system prompt and the messages) and handed.
 */
function scripted(script: Script) {
  const turn = { script, text: 'Svar.' };
  const offered: string[][] = [];
  const handed: unknown[] = [];
  const systems: string[] = [];
  const told: Array<Parameters<ModelGenerate>[0]['messages']> = [];
  const described: Record<string, string> = {};
  const generate: ModelGenerate = async ({ system, messages, tools }) => {
    systems.push(system);
    told.push(messages);
    offered.push(Object.keys(tools));
    for (const [name, tool] of Object.entries(tools)) described[name] = (tool as Callable).description ?? '';
    const toolCalls = [];
    for (const [name, input] of turn.script) {
      const tool = tools[name] as Callable | undefined;
      // The model is offered only what it may call; a tool it is not offered it cannot call at all.
      const output = tool ? await tool.execute(input, {}) : { notOffered: name };
      handed.push(output);
      toolCalls.push({ capability: name.replace('__', '.'), input, output });
    }
    return { text: turn.text, toolCalls };
  };
  return { generate, offered, handed, systems, told, described, turn };
}

const never = () => Promise.reject(new Error('not called'));
/** Two free half hours next Monday, as the calendar's use case answers them: instants in UTC. */
const FREE = [
  { start: '2026-11-16T08:00:00.000Z', end: '2026-11-16T08:30:00.000Z' },
  { start: '2026-11-17T12:30:00.000Z', end: '2026-11-17T13:00:00.000Z' },
];

/**
 * The directory, competence and the calendar of Clew's own, and two fixture connectors of other kinds over the
 * protocol (`tests/fixture-connectors.ts`): the HR system and the economy system, as a remote connector reaches Clew.
 * With `brandskydd`, Anna's Brandskydd has run out too, Erik's is valid and Maria's runs out in January, so what needs
 * doing has four rows, Anna twice and Maria last.
 */
async function world(script: Script = [], options: { brandskydd?: boolean } = {}) {
  const d = directory();
  const registry = new Registry({ relations: d.relations.relate });
  const store = memoryCompetenceStore({
    persons: [...d.state.users.values()].map(u => ({
      id: u.id,
      organisationId: u.organisationId,
      name: u.name,
      userName: u.userName,
    })),
  });
  let n = 0;
  const competence = competenceUsecases({
    store,
    staff: async persona => ({ units: reportsByUnit(await d.staff.reach(persona)) }),
    clock: () => new Date(T),
    ids: () => 'r-' + ++n,
  });
  const hlr = await competence.seedType('operator:test', ORG, { name: 'HLR', area: 'Akut', kind: 'course' });
  const held = (personId: string, issuedOn: string, expiresOn: string) =>
    competence.seedHolding('operator:test', ORG, personId, { typeId: hlr, issuedOn, expiresOn });
  await held('anna', '2024-01-10', '2026-01-10'); // run out
  await held('erik', '2025-12-01', '2026-12-20'); // runs out within 90 days
  await held('maria', '2026-01-10', '2028-01-10'); // valid
  for (const other of ['cohead', 'sven', 'karin']) await held(other, '2024-01-10', '2026-01-10');
  if (options.brandskydd) {
    const fire = await competence.seedType('operator:test', ORG, {
      name: 'Brandskydd',
      area: 'Säkerhet',
      kind: 'course',
    });
    await competence.seedHolding('operator:test', ORG, 'anna', {
      typeId: fire,
      issuedOn: '2023-05-02',
      expiresOn: '2025-05-02',
    });
    await competence.seedHolding('operator:test', ORG, 'erik', {
      typeId: fire,
      issuedOn: '2026-02-01',
      expiresOn: '2029-02-01',
    });
    await competence.seedHolding('operator:test', ORG, 'maria', {
      typeId: fire,
      issuedOn: '2024-01-20',
      expiresOn: '2027-01-20',
    });
  }
  const freeAsked: unknown[] = [];
  const connectors: Connector[] = [
    competenceConnector(competence, async a => d.persona(a.id)),
    calendarConnector(
      { readToday: never, weekView: never },
      {
        dayView: never,
        listRooms: never,
        freeTimes: async (_persona, input) => {
          freeAsked.push(input);
          return { slots: FREE };
        },
      },
      async id => d.persona(id),
    ),
  ];
  // The fixtures' records are seeded from the sources' clock: the invoices fall due from 13 November.
  const fixtures = fixtureConnectors({ only: ['hr', 'finance'], clock: () => new Date(T) }).connectors;
  for (const c of [...connectors, ...fixtures]) registry.register({ ...c, uses: [] }).govern(c.id, openGovernance());
  const model = scripted(script);
  const threads = memoryThreadStore();
  let ids = 0;
  const logged: unknown[][] = [];
  const deps: AssistantDeps = {
    store: threads,
    registry,
    // The server's `runCapability`: the registry as the person, with what the assistant says about the call.
    run: (persona, name, input, context) => registry.run(actorOf(persona), name, input, context),
    calendar: {} as AssistantDeps['calendar'],
    models: {
      resolve: async () => ({
        id: 'open-model',
        title: 'Öppen modell',
        providerId: 'llm',
        tools: true,
        generate: model.generate,
      }),
      health: { available: () => true, mark: () => undefined },
    },
    clock: () => new Date(T),
    ids: () => 'c-' + ++ids,
    log: (...args) => {
      logged.push(args);
    },
    // Composition's binding (D115): the people Personal lists for the asker, co-managers included.
    people: async persona =>
      (await d.staff.reach(persona)).managed.flatMap(unit =>
        unit.people.flatMap(p => {
          const key = personKey(p);
          return key ? [{ key, name: p.name, unit: unit.unitLabel }] : [];
        }),
      ),
  };
  const assistant = assistantUsecases(deps);
  /** One question as this person, in a conversation of its own or one going on; the turn, its audit row and its message. */
  const ask = async (who: string, text: string, conversationId?: string) => {
    const turn = await assistant.converse(d.persona(who), { text, ...(conversationId ? { conversationId } : {}) });
    return {
      turn,
      audit: threads.audit.at(-1)!,
      offered: model.offered.at(-1)!,
      handed: model.handed,
      meta: turn.thread.messages.at(-1)!.meta!,
      body: turn.thread.messages.at(-1)!.body,
    };
  };
  return { d, registry, competence, store, ask, model, logged, freeAsked };
}

const competenceTools = (offered: string[]) => offered.filter(t => t.startsWith('competence__')).sort();
const UNKNOWN = { error: 'Okänd förmåga.' };

describe('which of Clew’s own reads the model is offered (D122 item 3)', () => {
  test('a manager is offered their own and their reports’ holdings, what needs doing and a unit’s coverage, and free times', async () => {
    const w = await world();
    const { offered } = await w.ask('hillevi', 'Hur ser det ut?');
    expect(competenceTools(offered)).toEqual(['competence__attention', 'competence__coverage', 'competence__holdings']);
    expect(offered).toContain('calendar__freeTimes');
  });
  test('an employee is offered their own holdings and free times, nothing of a manager’s', async () => {
    const w = await world();
    const { offered } = await w.ask('anna', 'Hur ser det ut?');
    expect(competenceTools(offered)).toEqual(['competence__holdings']);
    expect(offered).toContain('calendar__freeTimes');
  });
  test('the reads about an entity and the read behind an approval stay closed, and no search across the organisation is a capability at all', async () => {
    const w = await world();
    const all = w.registry.connector('competence')!.capabilities;
    expect(all.filter(c => c.model).map(c => c.name)).toEqual([
      'competence.attention',
      'competence.holdings',
      'competence.coverage',
    ]);
    // Kompetenssökning is a page and its routes (D121), never a capability: nothing named so can be a tool for anybody,
    // and a registrar is offered what any employee is.
    expect(all.some(c => /search/i.test(c.name))).toBe(false);
    const { offered } = await w.ask('regina', 'Vem har HLR?');
    expect(competenceTools(offered)).toEqual(['competence__holdings']);
    expect(offered.some(t => /search/i.test(t))).toBe(false);
  });
  test('an administrator can keep one of Clew’s own reads from the model, as a connector’s (D122 item 4)', async () => {
    const w = await world();
    w.registry.govern('competence', {
      ...openGovernance(),
      capabilities: { 'competence.holdings': { model: false } },
    });
    w.registry.govern('calendar', { ...openGovernance(), toolsEnabled: false });
    const { offered } = await w.ask('hillevi', 'Hur ser det ut?');
    expect(competenceTools(offered)).toEqual(['competence__attention', 'competence__coverage']);
    expect(offered.some(t => t.startsWith('calendar__'))).toBe(false);
    // The read still answers the person's own pages: the switch is the model's alone.
    expect(
      await w.registry.run(actorOf(w.d.persona('hillevi')), 'competence.holdings', { person: 'anna' }),
    ).toMatchObject({ rows: [{ competence: 'HLR', status: 'expired' }] });
  });
});

describe('the assistant reads as the person who asks, never more (D122 item 5)', () => {
  test('a manager: which reports lack HLR is answered from what needs doing, then one report’s holdings, as words without ids', async () => {
    const w = await world([
      ['competence__attention', {}],
      ['competence__holdings', { person: 'anna' }],
    ]);
    const { handed, audit, turn } = await w.ask('hillevi', 'Vilka av mina medarbetare saknar giltig HLR?');
    // Her reports only (D99): not Sven (Olle's), Karin (another unit) or the co-head; each row as the view draws it, in
    // words, with the key holdings takes (the row's `subject`) and no ref (`modelReading`).
    expect(handed[0]).toEqual({
      antal: 2,
      rader: [
        {
          Namn: 'Anna Lindqvist',
          Kompetens: 'HLR',
          Status: 'utgånget',
          'Giltigt till': '10 januari 2026',
          Användarnamn: 'anna',
        },
        {
          Namn: 'Erik Sandström',
          Kompetens: 'HLR',
          Status: 'går ut snart',
          'Giltigt till': '20 december 2026',
          Användarnamn: 'Erik.S',
        },
      ],
    });
    expect(handed[1]).toEqual({
      antal: 1,
      rader: [
        {
          Kompetens: 'HLR',
          Status: 'utgånget',
          'Giltigt till': '10 januari 2026',
          Utfärdat: '10 januari 2024',
          Område: 'Akut',
        },
      ],
    });
    expect(JSON.stringify(handed)).not.toContain('holding:');
    // The turn's audit row names each read and how many rows it answered; never a row, a name or a key (D122 item 8).
    expect(audit).toMatchObject({
      action: 'conversation.asked',
      details: {
        assistant: 'model',
        tools: ['competence.attention', 'competence.holdings'],
        reads: [
          { capability: 'competence.attention', rows: 2 },
          { capability: 'competence.holdings', rows: 1 },
        ],
      },
    });
    for (const content of ['Anna', 'anna', 'Erik', 'HLR', 'Utgånget', '2026-01-10'])
      expect(JSON.stringify(audit)).not.toContain(content);
    // The read of one report's holdings is logged as a person's would be, with the fact that the assistant made it
    // (D122 item 6); what needs doing is not logged, as it is not when she opens it herself (D121, as built).
    expect(w.store.readLog().map(r => [r.readerId, r.relation, r.caller, r.kind, r.personId, r.rows])).toEqual([
      ['hillevi', 'managed', 'assistant', 'person', 'anna', 1],
    ]);
    expect(turn.assistant).toBe('model');
  });
  test('the person themself: their own holdings, unlogged whoever reads them; a colleague’s is refused and reaches nobody', async () => {
    const w = await world([
      ['competence__attention', {}],
      ['competence__holdings', { person: 'erik.s' }],
      ['competence__holdings', {}],
      ['competence__holdings', { person: 'ANNA' }],
    ]);
    const { handed, audit } = await w.ask('anna', 'Vilka av mina medarbetare saknar HLR?');
    expect(handed[0]).toEqual({ notOffered: 'competence__attention' });
    expect(handed[1]).toEqual(UNKNOWN);
    expect(handed[2]).toMatchObject({ antal: 1, rader: [{ Kompetens: 'HLR', Status: 'utgånget' }] });
    expect(handed[3]).toMatchObject({ antal: 1, rader: [{ Kompetens: 'HLR' }] });
    expect(audit.details).toMatchObject({
      reads: [
        { capability: 'competence.holdings', failed: true },
        { capability: 'competence.holdings', rows: 1 },
        { capability: 'competence.holdings', rows: 1 },
      ],
    });
    expect(w.store.readLog()).toEqual([]);
  });
  test('a manager is refused a co-manager, a report of a manager below and someone on another unit', async () => {
    const w = await world([
      ['competence__holdings', { person: 'cohead' }],
      ['competence__holdings', { person: 'sven' }],
      ['competence__holdings', { person: 'karin' }],
      ['competence__holdings', { person: 'olle' }],
    ]);
    const { handed, audit } = await w.ask('hillevi', 'Vad har Cecilia, Sven, Karin och Olle för kompetenser?');
    // The prompt gives the user name of the one she manages (D115) and of nobody else; a key the model has from
    // elsewhere, or guesses, is resolved by the registry all the same (D117).
    expect(w.model.systems.at(-1)).toContain('"Olle" är Olle Ek på Bergsåkers skola, användarnamn olle.');
    for (const other of ['cohead', 'sven', 'karin'])
      expect(w.model.systems.at(-1)).not.toContain('användarnamn ' + other);
    expect(handed.slice(0, 3)).toEqual([UNKNOWN, UNKNOWN, UNKNOWN]);
    // Olle leads the unit below hers and reports to her (D99): his holdings, which are none.
    expect(handed[3]).toEqual({ antal: 0, rader: [] });
    expect((audit.details as { reads: unknown[] }).reads).toEqual([
      { capability: 'competence.holdings', failed: true },
      { capability: 'competence.holdings', failed: true },
      { capability: 'competence.holdings', failed: true },
      { capability: 'competence.holdings', rows: 0 },
    ]);
    expect(w.store.readLog().map(r => [r.caller, r.personId])).toEqual([['assistant', 'olle']]);
  });
  test('a registrar asking through the assistant reads nobody but herself: the relation is resolved for her own direct read alone', async () => {
    const w = await world([
      ['competence__holdings', { person: 'anna' }],
      ['competence__holdings', { person: 'karin' }],
      ['competence__holdings', {}],
    ]);
    const { handed } = await w.ask('regina', 'Vilken kompetens har Anna och Karin?');
    expect(handed.slice(0, 2)).toEqual([UNKNOWN, UNKNOWN]);
    expect(handed[2]).toEqual({ antal: 0, rader: [] });
    expect(w.store.readLog()).toEqual([]);
    // Her own session's direct read on the search's page is a registrar's (D121), and logged as hers.
    const regina = actorOf(w.d.persona('regina'));
    expect(await w.registry.run(regina, 'competence.holdings', { person: 'anna' }, { direct: true })).toMatchObject({
      rows: [{ competence: 'HLR' }],
    });
    expect(w.store.readLog().map(r => [r.relation, r.caller])).toEqual([['registrar', 'person']]);
    // A call that says it is the assistant's is never direct, whatever else its context says.
    await expect(
      w.registry.run(regina, 'competence.holdings', { person: 'anna' }, { direct: true, caller: 'assistant' }),
    ).rejects.toThrow('Okänd förmåga.');
    expect(w.store.readLog()).toHaveLength(1);
  });
  test('the caller is carried into a read that another of Clew’s reads makes for the same turn', async () => {
    const w = await world();
    const seen: Array<string | undefined> = [];
    w.registry
      .register({
        id: 'peek',
        kind: 'core',
        source: 'Clew',
        areas: [],
        uses: ['competence.holdings'],
        capabilities: [
          {
            name: 'peek.holdings',
            kind: 'read',
            title: 'Titta',
            description: 'x',
            model: false,
            scope: {},
            input: { type: 'object', properties: { who: { type: 'string' } }, required: ['who'] } as never,
            output: { type: 'object' } as never,
            run: (_actor, input, clew) => {
              seen.push(clew.caller);
              return clew.call('competence.holdings', { person: (input as { who: string }).who });
            },
          },
        ],
      })
      .govern('peek', openGovernance());
    const hillevi = actorOf(w.d.persona('hillevi'));
    await w.registry.run(hillevi, 'peek.holdings', { who: 'anna' }, { caller: 'assistant' });
    await w.registry.run(hillevi, 'peek.holdings', { who: 'anna' });
    expect(seen).toEqual(['assistant', undefined]);
    expect(w.store.readLog().map(r => r.caller)).toEqual(['assistant', 'person']);
  });
});

describe('planning from the calendar (D122 item 3)', () => {
  test('the person’s own free times, in Swedish time and in words, never an instant in UTC; nothing booked', async () => {
    const w = await world([['calendar__freeTimes', { durationMinutes: 30, before: '2026-11-20' }]]);
    const { handed, audit } = await w.ask('hillevi', 'När kan jag ha ett möte på en halvtimme med Anna nästa vecka?');
    expect(w.freeAsked).toEqual([{ durationMinutes: 30, before: '2026-11-20' }]);
    // A read without a view keeps its own keys; its moments are written out in Swedish time (`modelReading`).
    expect(handed[0]).toEqual({
      gaps: [
        { start: 'måndag 16 november 2026 kl. 09:00', end: 'måndag 16 november 2026 kl. 09:30' },
        { start: 'tisdag 17 november 2026 kl. 13:30', end: 'tisdag 17 november 2026 kl. 14:00' },
      ],
    });
    expect(audit.details).toMatchObject({
      tools: ['calendar.freeTimes'],
      reads: [{ capability: 'calendar.freeTimes' }],
    });
  });
});

describe('what a turn leaves behind (D91, D122 item 8)', () => {
  test('a turn that reads holdings logs nothing, and its message and audit row hold no row of what was read', async () => {
    const w = await world([['competence__holdings', { person: 'anna' }]]);
    const { turn, audit } = await w.ask('hillevi', 'Vad har Anna för kompetenser?');
    expect(w.logged).toEqual([]);
    // The answer's message keeps which read and with what input (so the view can be read again as the person); the
    // rows themselves are in neither the message's meta nor the audit row.
    const meta = turn.thread.messages.at(-1)!.meta!;
    expect(meta.toolCalls).toEqual([{ capability: 'competence.holdings', input: { person: 'anna' } }]);
    for (const content of ['HLR', 'Utgånget', '2026-01-10', 'Akut']) {
      expect(JSON.stringify(meta)).not.toContain(content);
      expect(JSON.stringify(audit)).not.toContain(content);
    }
  });
  test('more rows than the model takes are cut at the bound and counted', () => {
    const rows = Array.from({ length: READING_ROWS + 7 }, () => ({
      ref: 'holding:competence:x',
      userName: 'anna',
      name: 'Anna Lindqvist',
      competence: 'HLR',
      status: 'valid',
    }));
    const read = modelReading(holdingsView, 'Mina kompetenser', { rows }) as { rader: unknown[]; utelämnade?: number };
    expect(read.rader).toHaveLength(READING_ROWS);
    expect(read.utelämnade).toBe(7);
  });
});

/** The read as the person makes it, outside the turn: what the card reads again, and the marks of the rows wanted. */
async function readAs(w: Awaited<ReturnType<typeof world>>, who: string, name: string, input: unknown = {}) {
  const output = (await w.registry.run(actorOf(w.d.persona(who)), name, input)) as { rows: Record<string, unknown>[] };
  const view = w.registry.find(name)!.capability.view as View;
  const marks = (pick: (row: Record<string, unknown>) => boolean) =>
    output.rows.filter(pick).map(r => rowMark(view, r));
  return { rows: output.rows, marks };
}

/**
 * The card under an answer is the read the answer rests on, with the input the model gave it, and of its rows those the
 * answer is about (`cardRows`): the same rule for Clew's own reads and a fixture connector's over the protocol.
 */
describe('the card under an answer is the read it rests on, and the rows it is about', () => {
  test('competence: an answer about one report and one competence draws that row, not the other rows of what needs doing', async () => {
    const w = await world([['competence__attention', {}]], { brandskydd: true });
    w.model.turn.text = 'Anna Lindqvist saknar giltigt brandskydd: det gick ut 2 maj 2025.';
    const { meta } = await w.ask('hillevi', 'Vilka av mina medarbetare saknar brandskydd?');
    const read = await readAs(w, 'hillevi', 'competence.attention');
    expect(read.rows.map(r => [r.name, r.competence])).toEqual([
      ['Anna Lindqvist', 'Brandskydd'],
      ['Anna Lindqvist', 'HLR'],
      ['Erik Sandström', 'HLR'],
      ['Maria Källström', 'Brandskydd'],
    ]);
    // The card is the read the model made, with the input it made it with.
    expect(meta.view).toMatchObject({ capability: 'competence.attention', input: {}, declared: true });
    expect(meta.viewRows).toEqual({
      count: 4,
      show: 'named',
      marks: read.marks(r => r.name === 'Anna Lindqvist' && r.competence === 'Brandskydd'),
    });
  });
  test('competence: a card never shows an excerpt that leaves out whom the sentence names', async () => {
    const w = await world([['competence__attention', {}]], { brandskydd: true });
    const read = await readAs(w, 'hillevi', 'competence.attention');
    // Maria is the fourth row: the first three, the excerpt a whole read is drawn with, would leave her out.
    w.model.turn.text = 'Maria Källströms brandskydd går ut 20 januari 2027.';
    expect((await w.ask('hillevi', 'Vems brandskydd går ut snart?')).meta.viewRows).toEqual({
      count: 4,
      show: 'named',
      marks: read.marks(r => r.name === 'Maria Källström'),
    });
    // Two people named for the same competence are both there, and nothing else of theirs.
    w.model.turn.text = 'Anna Lindqvist och Erik Sandström saknar giltig HLR.';
    expect((await w.ask('hillevi', 'Vem saknar HLR?')).meta.viewRows).toEqual({
      count: 4,
      show: 'named',
      marks: read.marks(r => r.competence === 'HLR'),
    });
    // An answer that names more rows than a card keeps is its button alone, never a cut list of them.
    const many = Array.from({ length: CARD_MARKS_MAX + 1 }, (_, i) => ({ name: `Person ${i}`, competence: 'HLR' }));
    expect(cardRows(attentionView, {}, { rows: many }, 'Alla saknar HLR.')).toEqual({
      count: CARD_MARKS_MAX + 1,
      show: 'none',
    });
  });
  test('competence: an answer that names none of the rows of a read it did not narrow draws no rows, only the way to the whole read', async () => {
    const w = await world([['competence__attention', {}]], { brandskydd: true });
    w.model.turn.text = 'Ingen av dina medarbetare saknar truckkort.';
    const { meta } = await w.ask('hillevi', 'Vem saknar truckkort?');
    expect(meta.view).toMatchObject({ capability: 'competence.attention', input: {} });
    expect(meta.viewRows).toEqual({ count: 4, show: 'none' });
    // A later turn that points at the view, as a model told a read is shown says, carries the whole read as its card.
    w.model.turn.text = 'Uppgifterna finns i vyn.';
    expect((await w.ask('hillevi', 'Och vad behöver göras?')).meta.viewRows).toEqual({ count: 4, show: 'all' });
  });
  test('competence: a read the model narrowed with its input is the card, with that input', async () => {
    const w = await world([['competence__holdings', { person: 'anna' }]], { brandskydd: true });
    w.model.turn.text = 'Två av hennes kompetenser har gått ut.';
    const { meta } = await w.ask('hillevi', 'Hur ser Annas kompetenser ut?');
    expect(meta.view).toMatchObject({ capability: 'competence.holdings', input: { person: 'anna' }, declared: true });
    expect(meta.viewRows).toEqual({ count: 2, show: 'all' });
  });
  test('the economy system: an answer about one invoice draws that invoice, by the ref the view declares', async () => {
    const w = await world([['finance__invoices', {}]]);
    w.model.turn.text = 'Fakturan från Energibolaget på 18 650 kr har ingen beställning.';
    const { meta } = await w.ask('hillevi', 'Vilken faktura saknar beställning?');
    const read = await readAs(w, 'hillevi', 'finance.invoices');
    const marks = read.marks(r => r.supplier === 'Energibolaget');
    expect(marks).toHaveLength(1);
    expect(meta.view).toMatchObject({ capability: 'finance.invoices', input: {}, source: 'Ekonomisystemet' });
    expect(meta.viewRows).toEqual({ count: 3, show: 'named', marks });
    // Two invoices of one supplier are both named by it.
    w.model.turn.text = 'Skolgrossisten har två fakturor som förfaller i morgon.';
    const again = await w.ask('hillevi', 'Vilka förfaller i morgon?');
    expect(again.meta.viewRows).toMatchObject({
      show: 'named',
      marks: read.marks(r => r.supplier === 'Skolgrossisten'),
    });
    // A count of the whole read names no row but speaks of all of them: the card is the read.
    w.model.turn.text = 'Tre fakturor väntar på din attest.';
    expect((await w.ask('hillevi', 'Hur många fakturor?')).meta.viewRows).toEqual({ count: 3, show: 'all' });
    // A sentence about none of them and not about the whole read: no rows, only the way to the read.
    w.model.turn.text = 'Ingen faktura är från Städbolaget.';
    expect((await w.ask('hillevi', 'Har Städbolaget skickat något?')).meta.viewRows).toEqual({
      count: 3,
      show: 'none',
    });
  });
  test('the HR system: an answer about one step of the routine draws that step; a view the model reads only a summary of is the card as it is', async () => {
    const w = await world([['hr__rehabRoutine', {}]]);
    w.model.turn.text = 'Efter den tredje korta sjukfrånvaron: Boka ett omtankesamtal inom två veckor.';
    const { meta } = await w.ask('hillevi', 'Vad gör jag vid upprepad korttidsfrånvaro?');
    const read = await readAs(w, 'hillevi', 'hr.rehabRoutine');
    expect(meta.view).toMatchObject({ capability: 'hr.rehabRoutine', source: 'Personalsystemet' });
    expect(meta.viewRows).toEqual({
      count: read.rows.length,
      show: 'named',
      marks: read.marks(r => r.title === 'Boka ett omtankesamtal'),
    });
    // Absence per person is read as a summary (D38): the model names nobody, and the card is the whole view.
    w.model.turn.script = [['hr__absenceOverview', {}]];
    w.model.turn.text = 'Uppgifterna finns i vyn.';
    const summary = await w.ask('hillevi', 'Hur ser frånvaron ut per person?');
    expect(summary.meta.view).toMatchObject({ capability: 'hr.absenceOverview' });
    expect(summary.meta.viewRows).toMatchObject({ show: 'all' });
  });
});

/**
 * Where an answer comes from and when are facts the server knows: the turn's reads, by the registry's names for their
 * systems, and the message's time. The model is not asked to write them, and what it writes of them anyway is cut.
 */
describe('the source of an answer is the turn’s, never the model’s prose', () => {
  test('the prompt asks for no source or time, and each tool says its system by the registry’s name', async () => {
    const w = await world([['competence__attention', {}]]);
    await w.ask('hillevi', 'Vad behöver göras?');
    const system = w.model.systems.at(-1)!;
    expect(system).not.toContain('Nämn källan och tidpunkten');
    expect(system).not.toMatch(/Personalsystemet \d\d:\d\d/);
    expect(system).toContain('Skriv inte källan eller klockslaget i svaret');
    expect(w.model.described['competence__attention']).toEndWith('Källa: Kompetens.');
    expect(w.model.described['finance__invoices']).toEndWith('Källa: Ekonomisystemet.');
    expect(w.model.described['hr__rehabRoutine']).toEndWith('Källa: Personalsystemet.');
  });
  test('the turn names the systems it read and that answered, and a suffix the model wrote anyway is cut', async () => {
    const w = await world([
      ['competence__attention', {}],
      ['finance__invoices', {}],
    ]);
    w.model.turn.text = 'Anna Lindqvist saknar HLR och tre fakturor väntar. Personalsystemet 13:59.';
    const { meta, body, audit } = await w.ask('hillevi', 'Vad behöver jag göra i dag?');
    expect(body).toBe('Anna Lindqvist saknar HLR och tre fakturor väntar.');
    expect(meta.source).toBe('Kompetens, Ekonomisystemet');
    expect(meta.reads).toEqual([
      { capability: 'competence.attention', rows: 2 },
      { capability: 'finance.invoices', rows: 3 },
    ]);
    expect(audit.details).toMatchObject({ reads: meta.reads });
  });
  test('a turn that read nothing, or only what it was refused, names no system: the answer is the assistant’s', async () => {
    const w = await world([['competence__holdings', { person: 'erik.s' }]]);
    w.model.turn.text = 'Det kan jag inte se.';
    const refused = await w.ask('anna', 'Vad har Erik för kompetenser?');
    expect(refused.meta.source).toBe('Assistenten');
    expect(refused.meta.view).toBeUndefined();
    expect(refused.meta.reads).toEqual([{ capability: 'competence.holdings', failed: true }]);
    w.model.turn.script = [];
    w.model.turn.text = 'Hej! Vad kan jag hjälpa dig med?';
    const none = await w.ask('anna', 'Hej');
    expect(none.meta.source).toBe('Assistenten');
    expect(none.meta.reads).toBeUndefined();
  });
});

/**
 * Between turns the model keeps the conversation's text and which reads were made, never what they answered: a question
 * about facts reads again, and one that is not about facts is answered without a read.
 */
describe('what the model keeps between turns', () => {
  test('the next turn is told what was read and when, not what it held, and is asked to read again', async () => {
    const w = await world([['competence__holdings', {}]]);
    const first = await w.ask('anna', 'Hur ser mina kompetenser ut?');
    expect(w.model.handed[0]).toMatchObject({ rader: [{ Kompetens: 'HLR', 'Giltigt till': '10 januari 2026' }] });
    w.model.turn.script = [['competence__holdings', {}]];
    w.model.turn.text = 'Ditt HLR gick ut 10 januari 2026.';
    const second = await w.ask('anna', 'När gick det ut?', first.turn.conversationId);
    // The model is told the two questions and the first answer's text, nothing it read.
    const told = w.model.told.at(-1)!;
    expect(told).toEqual([
      { role: 'user', content: 'Hur ser mina kompetenser ut?' },
      { role: 'assistant', content: 'Svar.' },
      { role: 'user', content: 'När gick det ut?' },
    ]);
    // The prompt says what the earlier answer read and that a question about facts is read again.
    const system = w.model.systems.at(-1)!;
    expect(system).toContain('Lästes för tidigare svar i samtalet');
    expect(system).toContain('Svaret kl. 09:00: Mina kompetenser (1 rad).');
    expect(system).toContain('läser du med verktygen i den här frågan');
    for (const content of ['10 januari 2026', 'utgånget', 'Akut']) {
      expect(system).not.toContain(content);
      expect(JSON.stringify(told)).not.toContain(content);
    }
    // And this turn read again, so its card is today's read.
    expect(second.meta.reads).toEqual([{ capability: 'competence.holdings', rows: 1 }]);
    expect(second.meta.view).toMatchObject({ capability: 'competence.holdings' });
  });
  test('a follow-up that is not about facts is answered without a read', async () => {
    const w = await world([['competence__holdings', {}]]);
    const first = await w.ask('hillevi', 'Hur ser mina kompetenser ut?');
    w.model.turn.script = [];
    w.model.turn.text = 'Det betyder att ett av dina intyg snart behöver förnyas.';
    const second = await w.ask('hillevi', 'Förklara det enklare', first.turn.conversationId);
    expect(second.body).toBe('Det betyder att ett av dina intyg snart behöver förnyas.');
    expect(second.meta).toMatchObject({ assistant: 'model', source: 'Assistenten' });
    expect(second.meta.view).toBeUndefined();
    expect(second.meta.reads).toBeUndefined();
  });
});

/**
 * One projection for every read (`modelReading`), derived from its declaration: labels as keys, words for statuses,
 * dates written out, no refs, ids or links, bounded. A remote connector gets it by declaring a view.
 */
describe('what the model reads of a read, for every connector', () => {
  test('a fixture’s table: the labels, the amounts with their unit, the dates in words, no ref', async () => {
    const w = await world([['finance__invoices', {}]]);
    await w.ask('hillevi', 'Vilka fakturor väntar?');
    expect(w.model.handed[0]).toEqual({
      antal: 3,
      rader: [
        {
          Leverantör: 'Skolgrossisten',
          Belopp: '11\u00a0200 kr',
          Förfaller: '13 november 2026',
          Beställning: '2026-0412',
          Konto: 'Läromedel',
        },
        {
          Leverantör: 'Skolgrossisten',
          Belopp: '7\u00a0200 kr',
          Förfaller: '13 november 2026',
          Beställning: '2026-0412',
          Konto: 'Läromedel',
        },
        { Leverantör: 'Energibolaget', Belopp: '18\u00a0650 kr', Förfaller: '20 november 2026', Konto: 'Lokaler' },
      ],
    });
    expect(JSON.stringify(w.model.handed)).not.toContain('finance:inv');
  });
  test('a fixture’s list with facts about the list, and a detail: labels and words, and the list’s own facts', async () => {
    const w = await world([
      ['hr__rehabRoutine', {}],
      ['finance__budget', {}],
    ]);
    await w.ask('hillevi', 'Vad säger rehabrutinen, och hur går budgeten?');
    const [routine, budget] = w.model.handed as [Record<string, unknown>, Record<string, unknown>];
    expect(routine).toMatchObject({
      name: 'Rehabiliteringsrutinen',
      owner: 'HR-avdelningen',
      reviewedAt: '2 mars 2026',
      antal: 7,
    });
    expect((routine.rader as Record<string, string>[])[0]).toEqual({
      Steg: 'Kontakta medarbetaren',
      När: 'Dag 1',
      Del: 'Kort sjukfrånvaro',
      'Vad du gör': expect.stringContaining('Fråga aldrig om diagnos.'),
    });
    expect(JSON.stringify(routine)).not.toContain('hr:rehab-step');
    expect(Object.keys(budget)).toEqual(['Namn', 'Avvikelse i procent', 'Prognos', 'Budget', 'Orsak']);
  });
  test('dates are never ambiguous: a day with its year, a moment with its weekday and time in Swedish time', () => {
    expect(dateWords('2027-11-27')).toBe('27 november 2027');
    expect(dateWords('2026-11-16T08:00:00.000Z')).toBe('måndag 16 november 2026 kl. 09:00');
    expect(dateWords('2026-07-01T08:00:00+02:00')).toBe('onsdag 1 juli 2026 kl. 08:00');
    // A day sent as the midnight of UTC is the day.
    expect(dateWords('2026-03-12T00:00:00Z')).toBe('12 mars 2026');
    expect(dateWords('27 november')).toBeUndefined();
  });
  test('a holding that decides is told from one that does not by its status word, as the page shows it', () => {
    const read = modelReading(holdingsView, 'Mina kompetenser', {
      rows: [
        {
          ref: 'holding:competence:a',
          userName: 'hillevi',
          name: 'Hillevi Berg',
          competence: 'HLR',
          status: 'valid',
          issuedOn: '2025-11-27',
          expiresOn: '2027-11-27',
        },
        {
          ref: 'holding:competence:b',
          userName: 'hillevi',
          name: 'Hillevi Berg',
          competence: 'HLR',
          status: 'awaiting-approval',
          issuedOn: '2026-11-01',
          expiresOn: '2028-11-01',
        },
      ],
    }) as { rader: Record<string, string>[] };
    expect(read.rader.map(r => [r.Kompetens, r.Status, r['Giltigt till']])).toEqual([
      ['HLR', 'giltigt', '27 november 2027'],
      ['HLR', 'väntar på godkännande', '1 november 2028'],
    ]);
  });
  test('the reading is bounded in characters too, and says how many rows were left out', () => {
    const rows = Array.from({ length: 80 }, (_, i) => ({
      name: 'Anna Lindqvist',
      userName: 'anna',
      competence: `Kompetens ${i} ` + 'x'.repeat(300),
      status: 'expired',
    }));
    const read = modelReading(attentionView, 'Kompetenser att åtgärda', { rows }) as {
      antal: number;
      rader: unknown[];
      utelämnade: number;
    };
    expect(JSON.stringify(read).length).toBeLessThanOrEqual(READING_CHARS);
    expect(read.antal).toBe(80);
    expect(read.rader.length + read.utelämnade).toBe(80);
    expect(read.utelämnade).toBeGreaterThan(0);
  });
});
