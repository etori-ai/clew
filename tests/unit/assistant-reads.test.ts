import { describe, expect, test } from 'bun:test';
import type { AuthenticatedContext } from '../../packages/contracts/src/index';
import { Registry, actorOf, openGovernance, type Connector } from '../../packages/connectors/src/index';
import { memoryProvisionStore } from '../../apps/server/src/modules/people/adapters/memory';
import { staffUsecases } from '../../apps/server/src/modules/people/usecases';
import { relationUsecases } from '../../apps/server/src/modules/entities/relations';
import { personKey, reportsByUnit } from '../../apps/server/src/modules/entities/domain';
import { memoryCompetenceStore } from '../../apps/server/src/modules/competence/adapters/memory';
import { competenceConnector, MODEL_ROWS } from '../../apps/server/src/modules/competence/capabilities';
import { competenceUsecases } from '../../apps/server/src/modules/competence/usecases';
import { calendarConnector } from '../../apps/server/src/modules/calendar/connector';
import { memoryThreadStore } from '../../apps/server/src/threads/adapters/memory';
import { assistantUsecases, type AssistantDeps } from '../../apps/server/src/assistant';
import type { ModelGenerate } from '../../apps/server/src/assistant/model';

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

type Callable = { execute: (input: unknown, options: unknown) => Promise<unknown> };
/** A tool-using model the test plays: it calls the tools named in `script` in order and keeps what it is offered and handed. */
function scripted(script: Array<[tool: string, input: Record<string, unknown>]>) {
  const offered: string[][] = [];
  const handed: unknown[] = [];
  const systems: string[] = [];
  const generate: ModelGenerate = async ({ system, tools }) => {
    systems.push(system);
    offered.push(Object.keys(tools));
    const toolCalls = [];
    for (const [name, input] of script) {
      const tool = tools[name] as Callable | undefined;
      // The model is offered only what it may call; a tool it is not offered it cannot call at all.
      const output = tool ? await tool.execute(input, {}) : { notOffered: name };
      handed.push(output);
      toolCalls.push({ capability: name.replace('__', '.'), input, output });
    }
    return { text: 'Svar.', toolCalls };
  };
  return { generate, offered, handed, systems };
}

const never = () => Promise.reject(new Error('not called'));
/** Two free half hours next Monday, as the calendar's use case answers them: instants in UTC. */
const FREE = [
  { start: '2026-11-16T08:00:00.000Z', end: '2026-11-16T08:30:00.000Z' },
  { start: '2026-11-17T12:30:00.000Z', end: '2026-11-17T13:00:00.000Z' },
];

async function world(script: Array<[tool: string, input: Record<string, unknown>]> = []) {
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
  for (const c of connectors) registry.register({ ...c, uses: [] }).govern(c.id, openGovernance());
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
  /** One question as this person; the turn's audit row and what the model was offered and handed. */
  const ask = async (who: string, text: string) => {
    const turn = await assistant.converse(d.persona(who), { text });
    return { turn, audit: threads.audit.at(-1)!, offered: model.offered.at(-1)!, handed: model.handed };
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
    // Her reports only (D99): not Sven (Olle's), Karin (another unit) or the co-head; each with the key holdings takes.
    expect(handed[0]).toEqual({
      rows: [
        {
          name: 'Anna Lindqvist',
          person: 'anna',
          competence: 'HLR',
          kind: 'Kurs',
          area: 'Akut',
          status: 'Utgånget',
          issuedOn: '2024-01-10',
          expiresOn: '2026-01-10',
        },
        {
          name: 'Erik Sandström',
          person: 'Erik.S',
          competence: 'HLR',
          kind: 'Kurs',
          area: 'Akut',
          status: 'Går ut snart',
          issuedOn: '2025-12-01',
          expiresOn: '2026-12-20',
        },
      ],
    });
    expect(handed[1]).toEqual({
      person: 'Anna Lindqvist',
      rows: [
        {
          competence: 'HLR',
          kind: 'Kurs',
          area: 'Akut',
          status: 'Utgånget',
          issuedOn: '2024-01-10',
          expiresOn: '2026-01-10',
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
    expect(handed[2]).toMatchObject({ person: 'Anna Lindqvist', rows: [{ competence: 'HLR', status: 'Utgånget' }] });
    expect(handed[3]).toMatchObject({ person: 'Anna Lindqvist', rows: [{ competence: 'HLR' }] });
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
    expect(handed[3]).toEqual({ rows: [] });
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
    expect(handed[2]).toEqual({ rows: [] });
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
  test('the person’s own free times, in Stockholm time with the offset a draft takes and in words; nothing booked', async () => {
    const w = await world([['calendar__freeTimes', { durationMinutes: 30, before: '2026-11-20' }]]);
    const { handed, audit } = await w.ask('hillevi', 'När kan jag ha ett möte på en halvtimme med Anna nästa vecka?');
    expect(w.freeAsked).toEqual([{ durationMinutes: 30, before: '2026-11-20' }]);
    expect(handed[0]).toEqual({
      times: [
        {
          start: '2026-11-16T09:00:00+01:00',
          end: '2026-11-16T09:30:00+01:00',
          text: 'måndag 16 november 09:00–09:30',
        },
        {
          start: '2026-11-17T13:30:00+01:00',
          end: '2026-11-17T14:00:00+01:00',
          text: 'tisdag 17 november 13:30–14:00',
        },
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
  test('more rows than the model takes are cut at the bound and counted', async () => {
    const w = await world();
    const holdings = w.registry.connector('competence')!.capabilities.find(c => c.name === 'competence.holdings')!;
    const rows = Array.from({ length: MODEL_ROWS + 7 }, () => ({
      ref: 'holding:competence:x',
      userName: 'anna',
      name: 'Anna Lindqvist',
      competence: 'HLR',
      status: 'valid',
    }));
    const read = holdings.forModel!({ rows }) as { rows: unknown[]; more?: number };
    expect(read.rows).toHaveLength(MODEL_ROWS);
    expect(read.more).toBe(7);
  });
});
