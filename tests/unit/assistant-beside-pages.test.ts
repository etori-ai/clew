import { describe, expect, test } from 'bun:test';
import { checkContract, type AuthenticatedContext, type Thread } from '../../packages/contracts/src/index';
import {
  Registry,
  SEARCH_CONNECTOR,
  actorOf,
  modelReading,
  openGovernance,
  type Actor,
  type Capability,
  type Connector,
} from '../../packages/connectors/src/index';
import { memoryProvisionStore } from '../../apps/server/src/modules/people/adapters/memory';
import { nameManagers } from '../named-managers';
import { staffUsecases } from '../../apps/server/src/modules/people/usecases';
import { groupsOf } from '../../apps/server/src/modules/entities/domain';
import { reportUsecases } from '../../apps/server/src/modules/entities/usecases';
import {
  REPORTS_CAPABILITY,
  ReportsOutputSchema,
  reportCapabilities,
  reportsView,
} from '../../apps/server/src/modules/entities/capabilities';
import {
  TOOLS_CAPABILITY,
  ToolsOutputSchema,
  toolCatalogueCapabilities,
} from '../../apps/server/src/modules/tool-catalogue/capabilities';
import {
  CONVERSATIONS_CAPABILITY,
  ConversationsOutputSchema,
  conversationCapabilities,
} from '../../apps/server/src/modules/conversations/capabilities';
import { conversationList } from '../../apps/server/src/modules/conversations/domain';
import { memoryThreadStore } from '../../apps/server/src/threads/adapters/memory';
import { threadAccess } from '../../apps/server/src/threads/access';

/**
 * The reads D141 rule 4 opens or adds for the pages the assistant is asked beside, that are not a domain's own module
 * test: Personal's list (`people.reports`), Alla verktyg (`clew.tools`) and Alla samtal (`clew.conversations`). Each is
 * read as the person through the registry on the memory adapters: answered for the person who may, refused or empty for
 * one who may not, offered to the model for them, and marked for the browser (`ViewEntry.assistant`). The domains'
 * reads are in their own suites: `dialogue.test.ts` (`dialogue.units`, `dialogue.activities`),
 * `boarding-registry.test.ts` (`boarding.plans`, `boarding.plan`) and the talks suites (`talks.talks`).
 */
const T = '2026-11-18T08:00:00.000Z';
const ORG = 'poc';
type Placement = { unitId: string; role: 'manager' | 'employee' };

/**
 * Bergsåkers skola is led by Hillevi and by Cecilia, and neither's employment names the other. On the school: Anna (a
 * teacher by her employment), Erik (a caretaker by the core title) and Maria, and Nils, who has no user name; their
 * employments name both. Olle leads Fritids and reports to both as well; Sven, on Fritids, reports to Olle. Karin works
 * in Ekonomi and manages nobody. Who reports to whom is written on the employments (D147) by `nameManagers`.
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
  const person = (
    id: string,
    userName: string | null,
    name: string,
    placements: Placement[],
    over: { title?: string; job?: string } = {},
  ) => {
    s.users.set(id, {
      id,
      organisationId: ORG,
      externalId: 'dev:' + id,
      userName,
      name,
      email: null,
      phoneNumbers: [],
      employments: over.job
        ? [
            {
              unitId: placements[0]!.unitId,
              title: over.job,
              employmentType: 'Tillsvidare',
              startDate: '2020-01-01',
              employmentPercentage: 80,
            },
          ]
        : [],
      title: over.title ?? null,
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
    });
  };
  const m = (unitId: string): Placement => ({ unitId, role: 'manager' });
  const e = (unitId: string): Placement => ({ unitId, role: 'employee' });
  unit('unit-skola', 'Bergsåkers skola', null);
  unit('unit-fritids', 'Fritids', 'unit-skola');
  unit('unit-ekonomi', 'Ekonomi', null);
  person('hillevi', 'hillevi', 'Hillevi Berg', [m('unit-skola')]);
  person('cecilia', 'cecilia', 'Cecilia Holm', [m('unit-skola')]);
  person('anna', 'anna', 'Anna Lindqvist', [e('unit-skola')], { job: 'Lärare' });
  person('erik', 'Erik.S', 'Erik Sandström', [e('unit-skola')], { title: 'Vaktmästare' });
  person('maria', 'maria', 'Maria Källström', [e('unit-skola')]);
  person('nils', null, 'Nils Utan Namn', [e('unit-skola')]);
  person('olle', 'olle', 'Olle Ek', [m('unit-fritids')]);
  person('sven', 'sven', 'Sven Berg', [e('unit-fritids')]);
  person('karin', 'karin', 'Karin Lund', [e('unit-ekonomi')]);
  const persona = (id: string): AuthenticatedContext => {
    const user = s.users.get(id)!,
      grant = s.grants.get(id)!;
    return {
      id,
      name: user.name,
      unitId: grant.unitId,
      unitLabel: grant.unitLabel,
      role: grant.role,
      ...(user.userName ? { userName: user.userName } : {}),
      organisationId: ORG,
      principal: { id: 'person:' + id, kind: 'person' },
      capabilities: [],
      authorizationVersion: 'v1',
      sessionBinding: 'test',
      expiresAt: '2099-01-01T00:00:00.000Z',
      authorize: async () => ({ version: 'v1' }),
    };
  };
  // D147: who reports to whom is said on the employments, as a directory says it.
  nameManagers(store.state);
  return { persona, staff: staffUsecases({ store }), state: s };
}

/** Whether the read is offered to the model for this person and marked for the browser, the two always together. */
const offered = (registry: Registry, actor: Actor, name: string) => {
  const tool = registry.tools(actor).some(t => t.name === name);
  const marked = registry.views(actor).find(v => v.capability === name)?.assistant === true;
  expect(marked).toBe(tool);
  return tool;
};

describe('people.reports: Personal’s list as a read (D141 rule 4)', () => {
  function world() {
    const d = directory();
    const registry = new Registry();
    const people: Connector = {
      id: 'people',
      kind: 'core',
      source: 'Användare',
      areas: [],
      ...reportCapabilities(reportUsecases({ directory: d.staff }), async a => d.persona(a.id)),
    };
    registry.register(people).govern('people', openGovernance());
    const read = (id: string) =>
      registry.run<{ rows: Array<Record<string, unknown>> }>(actorOf(d.persona(id)), REPORTS_CAPABILITY, {});
    return { d, registry, read };
  }

  test('a manager reads the people Personal lists for her, each once with title and unit, and nothing of an employment but the title', async () => {
    const w = world();
    const answer = await w.read('hillevi');
    expect(checkContract(ReportsOutputSchema, answer)).toBe(true);
    // Her reports (D147): the people whose employments name her, each under the unit of that employment, so Olle is
    // on Fritids, which he leads, and not on the school. Cecilia leads the school beside her and is not her report.
    expect(answer.rows).toEqual([
      { name: 'Anna Lindqvist', userName: 'anna', title: 'Lärare', unit: 'Bergsåkers skola' },
      { name: 'Erik Sandström', userName: 'Erik.S', title: 'Vaktmästare', unit: 'Bergsåkers skola' },
      { name: 'Maria Källström', userName: 'maria', unit: 'Bergsåkers skola' },
      { name: 'Olle Ek', userName: 'olle', unit: 'Fritids' },
    ]);
    expect(JSON.stringify(answer)).not.toContain('Cecilia');
    // Exactly the people of the entity list (`GET /api/entities/person`): the rule is `groupsOf`'s, never derived again.
    const listed = groupsOf('person', await w.d.staff.reach(w.d.persona('hillevi'))).flatMap(g =>
      g.entities.map(p => p.name),
    );
    expect(answer.rows.map(r => r.name).sort()).toEqual([...new Set(listed)].sort());
    // Nobody without a user name (the list cannot name them either), and no employment type, date or share.
    expect(JSON.stringify(answer)).not.toContain('Nils');
    for (const marker of ['Tillsvidare', '2020-01-01', '80']) expect(JSON.stringify(answer)).not.toContain(marker);
    // The model reads each row under the view's labels, with the user name another read takes as `person`.
    expect(modelReading(reportsView, 'Mina medarbetare', answer)).toMatchObject({
      antal: 4,
      rader: expect.arrayContaining([
        { Namn: 'Anna Lindqvist', Titel: 'Lärare', Enhet: 'Bergsåkers skola', Användarnamn: 'anna' },
      ]),
    });
  });

  test('a manager of another unit reads only his own people; an employee is refused, and offered nothing of it', async () => {
    const w = world();
    expect((await w.read('olle')).rows).toEqual([{ name: 'Sven Berg', userName: 'sven', unit: 'Fritids' }]);
    for (const id of ['anna', 'karin']) {
      await expect(w.read(id)).rejects.toThrow('Du saknar behörighet för åtgärden.');
      expect(offered(w.registry, actorOf(w.d.persona(id)), REPORTS_CAPABILITY)).toBe(false);
    }
    expect(offered(w.registry, actorOf(w.d.persona('hillevi')), REPORTS_CAPABILITY)).toBe(true);
  });

  test('a manager who manages nobody any longer has an empty list, not a refusal', async () => {
    const w = world();
    // Leading no unit any longer is not it (D147): Sven's employment still names Olle, so Sven is still his report.
    w.d.state.assignments.set('olle', [{ unitId: 'unit-fritids', role: 'employee' }]);
    w.d.state.assignments.set('sven', []);
    expect((await w.read('olle')).rows).toEqual([{ name: 'Sven Berg', userName: 'sven', unit: 'Fritids' }]);
    // Once no employment names him he manages nobody; his session still has a manager's role, and the read answers.
    w.d.state.users.get('sven')!.employments = [];
    expect((await w.read('olle')).rows).toEqual([]);
  });

  test('an administrator can keep it from the model; the read itself still answers', async () => {
    const w = world();
    w.registry.govern('people', { ...openGovernance(), capabilities: { [REPORTS_CAPABILITY]: { model: false } } });
    expect(offered(w.registry, actorOf(w.d.persona('hillevi')), REPORTS_CAPABILITY)).toBe(false);
    expect((await w.read('hillevi')).rows).toHaveLength(4);
  });
});

/** A system with one tool a person may open and one an administrator did not place. */
const finance: Connector = {
  id: 'finance',
  kind: 'passthrough',
  source: 'Ekonomisystemet',
  areas: [],
  capabilities: [
    {
      name: 'finance.invoices',
      kind: 'read',
      title: 'Fakturor att attestera',
      model: true,
      description: 'x',
      input: {} as never,
      output: {} as never,
      scope: () => true,
      menu: { label: 'Fakturor', icon: 'document' },
      view: { kind: 'list', title: 'label', fields: [{ key: 'label', label: 'Faktura' }] },
      run: async () => ({ rows: [] }),
    },
    {
      name: 'finance.budget',
      kind: 'read',
      title: 'Budget',
      model: true,
      description: 'x',
      input: {} as never,
      output: {} as never,
      scope: { roles: ['manager'] },
      menu: { label: 'Budget', icon: 'chart' },
      view: { kind: 'list', title: 'label', fields: [{ key: 'label', label: 'Rad' }] },
      run: async () => ({ rows: [] }),
    },
  ],
};

describe('clew.tools: Alla verktyg as a read (D141 rule 4)', () => {
  function world(options: { errands?: boolean } = {}) {
    const registry = new Registry();
    const errands: Capability = {
      name: SEARCH_CONNECTOR + '.errands',
      kind: 'read',
      title: 'Mina ärenden',
      model: true,
      description: 'x',
      input: {} as never,
      output: {} as never,
      // Offered only to a person with a case system, as the errand list is.
      scope: () => !!options.errands,
      menu: { label: 'Mina ärenden', icon: 'document' },
      view: { kind: 'list', title: 'label', fields: [{ key: 'label', label: 'Ärende' }] },
      run: async () => ({ rows: [] }),
    };
    const own = [SEARCH_CONNECTOR + '.errands'];
    const clew: Connector = {
      id: SEARCH_CONNECTOR,
      kind: 'core',
      source: 'Startsidan',
      areas: [],
      capabilities: [
        errands,
        ...toolCatalogueCapabilities({
          menu: actor => registry.menu(actor),
          own: actor => own.flatMap(name => registry.allowed(actor, name) ?? []),
        }).capabilities,
      ],
    };
    registry.register(clew).govern(SEARCH_CONNECTOR, openGovernance());
    registry.register(finance).govern('finance', {
      ...openGovernance(),
      capabilities: { 'finance.invoices': { menu: true }, 'finance.budget': { menu: true } },
    });
    return registry;
  }
  const hillevi: Actor = { id: 'hillevi', name: 'Hillevi', unitId: 'u', unitLabel: 'Skolan', role: 'manager' };
  const anna: Actor = { id: 'anna', name: 'Anna', unitId: 'u', unitLabel: 'Skolan', role: 'employee' };
  const read = (registry: Registry, actor: Actor) =>
    registry.run<{ rows: Array<Record<string, unknown>> }>(actor, TOOLS_CAPABILITY, {});

  test('the person’s tools as the page lists them: name, what it is, its system and its address in Clew', async () => {
    const registry = world({ errands: true });
    const answer = await read(registry, hillevi);
    expect(checkContract(ToolsOutputSchema, answer)).toBe(true);
    expect(answer.rows).toEqual([
      { name: 'Budget', system: 'Ekonomisystemet', address: '/tools/finance.budget' },
      {
        name: 'Fakturor',
        what: 'Fakturor att attestera',
        system: 'Ekonomisystemet',
        address: '/tools/finance.invoices',
      },
      { name: 'Mina ärenden', system: 'Startsidan', address: '/tools/clew.errands' },
    ]);
    // The model reads the address as words, so it can write the link; a link field it would never read.
    expect(
      JSON.stringify(modelReading(registry.find(TOOLS_CAPABILITY)!.capability.view, 'Alla verktyg', answer)),
    ).toContain('/tools/finance.invoices');
  });

  test('only what the person may open: a tool out of their scope, one taken out of the menu and an own list they lack are missing', async () => {
    const registry = world();
    expect((await read(registry, anna)).rows.map(r => r.name)).toEqual(['Fakturor']);
    registry.govern('finance', { ...openGovernance(), capabilities: { 'finance.budget': { menu: true } } });
    expect((await read(registry, hillevi)).rows.map(r => r.name)).toEqual(['Budget']);
    expect((await read(registry, anna)).rows).toEqual([]);
  });

  test('offered to the model for everyone, and marked for the browser', () => {
    const registry = world();
    for (const actor of [hillevi, anna]) expect(offered(registry, actor, TOOLS_CAPABILITY)).toBe(true);
    expect(registry.views(hillevi).find(v => v.capability === TOOLS_CAPABILITY)).toMatchObject({
      page: '/tools',
      assistant: true,
    });
  });
});

describe('clew.conversations: Alla samtal as a read (D141 rule 4)', () => {
  const question = (id: string, personId: string, updatedAt: string, over: Partial<Thread> = {}) => ({
    id,
    personId,
    kind: 'question' as const,
    topic: 'question:' + id,
    title: 'Samtal ' + id,
    state: 'open' as const,
    week: null,
    connector: SEARCH_CONNECTOR,
    area: 'fragor',
    summary: '',
    items: [],
    actions: [],
    waitingOn: null,
    deadline: null,
    trigger: { reason: 'Du frågade', source: 'Startsidan', at: updatedAt },
    createdAt: updatedAt,
    updatedAt,
    ...over,
  });
  async function world() {
    const store = memoryThreadStore();
    const registry = new Registry();
    const clew: Connector = {
      id: SEARCH_CONNECTOR,
      kind: 'core',
      source: 'Startsidan',
      areas: [],
      ...conversationCapabilities({
        list: (actor, now) => threadAccess(store, registry).list(actor, now),
        clock: () => new Date(T),
      }),
    };
    registry.register(clew).govern(SEARCH_CONNECTOR, openGovernance());
    await store.transaction(async tx => {
      await tx.insertThread(question('q1', 'hillevi', '2026-11-17T09:00:00.000Z'));
      await tx.insertThread(
        question('q2', 'hillevi', '2026-11-18T07:30:00.000Z', {
          title: 'Vem har inte haft utvecklingssamtal?',
          askedBeside: { subject: 'capability:talks.talks', label: 'Utvecklingssamtal', openedAt: null },
        }),
      );
      // Anna's conversation, and a work item of Hillevi's: neither is among Hillevi's conversations.
      await tx.insertThread(question('q3', 'anna', '2026-11-18T07:45:00.000Z', { title: 'Annas fråga' }));
      await tx.insertThread({ ...question('w1', 'hillevi', '2026-11-18T07:50:00.000Z'), kind: 'pushed' });
      await tx.addMessage('q2', {
        role: 'user',
        body: 'Vilka saknar samtal i min grupp?',
        at: '2026-11-18T07:30:00.000Z',
      });
    });
    return { store, registry };
  }
  const hillevi: Actor = { id: 'hillevi', name: 'Hillevi', unitId: 'u', unitLabel: 'Skolan', role: 'manager' };
  const anna: Actor = { id: 'anna', name: 'Anna', unitId: 'u', unitLabel: 'Skolan', role: 'employee' };
  const read = (registry: Registry, actor: Actor) =>
    registry.run<{ total: number; rows: Array<Record<string, unknown>> }>(actor, CONVERSATIONS_CAPABILITY, {});

  test('the person’s own conversations, the latest continued first, with what each is about and its address, never what was said', async () => {
    const w = await world();
    const answer = await read(w.registry, hillevi);
    expect(checkContract(ConversationsOutputSchema, answer)).toBe(true);
    expect(answer).toEqual({
      total: 2,
      rows: [
        {
          title: 'Vem har inte haft utvecklingssamtal?',
          about: 'Utvecklingssamtal',
          lastAt: '2026-11-18T07:30:00.000Z',
          address: '/conversations/q2',
        },
        { title: 'Samtal q1', lastAt: '2026-11-17T09:00:00.000Z', address: '/conversations/q1' },
      ],
    });
    expect(JSON.stringify(answer)).not.toContain('Vilka saknar samtal');
  });

  test('another person’s conversation is never listed, whoever asks', async () => {
    const w = await world();
    expect(JSON.stringify(await read(w.registry, hillevi))).not.toContain('Annas fråga');
    const hers = await read(w.registry, anna);
    expect(hers.rows.map(r => r.address)).toEqual(['/conversations/q3']);
    expect(JSON.stringify(hers)).not.toContain('utvecklingssamtal');
  });

  test('at most a hundred, with how many are left out', () => {
    const many = Array.from({ length: 103 }, (_, i) => ({
      ...question('m' + String(i).padStart(3, '0'), 'hillevi', new Date(Date.parse(T) - i * 60_000).toISOString()),
      messages: [],
      proposals: [],
      receipt: null,
      handledAt: null,
      remindedAt: null,
    })) as unknown as Thread[];
    const list = conversationList(many);
    expect(list.total).toBe(103);
    expect(list.omitted).toBe(3);
    expect(list.rows).toHaveLength(100);
    expect(list.rows[0]!.address).toBe('/conversations/m000');
  });

  test('offered to the model for everyone, and marked for the browser', async () => {
    const w = await world();
    for (const actor of [hillevi, anna]) expect(offered(w.registry, actor, CONVERSATIONS_CAPABILITY)).toBe(true);
    expect(w.registry.views(anna).find(v => v.capability === CONVERSATIONS_CAPABILITY)).toMatchObject({
      page: '/conversations',
      assistant: true,
    });
  });
});
