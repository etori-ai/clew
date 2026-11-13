import { Registry } from '../registry';
import { describe, expect, test } from 'bun:test';
import type { AuthenticatedContext, Thread, TurnEvent } from '../../packages/contracts/src/index';
import { actorOf, type Connector } from '../../packages/connectors/src/index';
import { searchConnector } from '../../apps/server/src/modules/search/connector';
import { searchUsecases } from '../../apps/server/src/modules/search/usecases';
import { fixtureConnectors } from '../fixture-connectors';
import { memoryCalendar, occurrence } from '../../packages/calendar/src/memory';
import { localInstant } from '../../packages/calendar/src/dates';
import { memoryThreadStore } from '../../apps/server/src/threads/adapters/memory';
import { threadUsecases } from '../../apps/server/src/threads/usecases/cards';
import { reminderUsecases } from '../../apps/server/src/threads/usecases/reminders';
import { memoryObligations, memoryProposalStore } from '../../apps/server/src/modules/calendar/adapters/memory';
import { calendarUsecases } from '../../apps/server/src/modules/calendar/usecases/samtal';
import { assistantUsecases, TurnStopped } from '../../apps/server/src/assistant';
import { memoryModelHealth, memoryModelStore, memoryModelWire } from '../../apps/server/src/assistant/adapters/memory';
import { modelUsecases } from '../../apps/server/src/assistant/usecases/models';
import type { ModelGenerate } from '../../apps/server/src/assistant/model';
import type { ManagedPerson } from '../../apps/server/src/assistant/ports';
import { DRAFT_TOOL, draftableActions, draftTool } from '../../apps/server/src/assistant/drafts';
import { parseManifest, remoteConnector } from '../../packages/connectors/src/remote';
import { assertionFor, testJwks, testAuthority } from '../connector-authority';
import {
  createConnector as createTelefonbok,
  manifest as phonebookManifest,
} from '../../connectors/phonebook/connector.mjs';

/**
 * The conversation end to end (D8, D12, D25): the real router, verbs and prompt over the registry with the fixture
 * connectors, the stream and the calendar over memory stores, and a model the test plays. Every turn ends in a
 * question thread with its audit row.
 */
const persona = (id: string, role: 'manager' | 'employee'): AuthenticatedContext => ({
  id,
  name: id === 'hillevi' ? 'Hillevi Berg' : 'Hassan Ali',
  unitId: 'unit-skola',
  unitLabel: 'Skönsmons skola',
  role,
  organisationId: 'sundsvall',
  principal: { id: 'person:' + id, kind: 'person' },
  capabilities: [],
  authorizationVersion: 'v1',
  sessionBinding: 'test',
  expiresAt: '2099-01-01T00:00:00.000Z',
  async authorize() {
    return { version: 'v1' };
  },
});
const hillevi = persona('hillevi', 'manager');
const hassan = persona('hassan', 'employee');
const T0 = '2026-11-04T07:00:00.000Z';
const account = { ref: 'memory:account:hillevi', email: 'hillevi@clew.test', name: 'Hillevi Berg' };
const members = ['Anna Lindqvist', 'Erik Sandström'].map(name => {
  const first = name.split(' ')[0]!.toLowerCase();
  return { personId: first, ref: 'memory:account:' + first, email: first + '@clew.test', name };
});
/** The people Hillevi manages (D115), by the user names the HR fixture knows them by; an employee manages nobody. */
const directory: ManagedPerson[] = [
  ['anna', 'Anna Lindqvist'],
  ['erik', 'Erik Sandström'],
  ['maria', 'Maria Källström'],
  ['maria.eriksson', 'Maria Eriksson'],
  ['per', 'Per Lindahl'],
  ['karin', 'Karin Lindqvist'],
  ['lena', 'Lena Öhman'],
].map(([key, name]) => ({ key: key!, name: name!, unit: 'Skönsmons skola' }));
function world(options: { generate?: ModelGenerate; extra?: Connector[] } = {}) {
  const registry = new Registry();
  registry.register({ id: 'calendar', kind: 'core', source: 'Kalendern', areas: [], capabilities: [] });
  const fixtures = fixtureConnectors({ only: ['hr', 'finance'], clock: () => new Date(T0) }).connectors;
  for (const m of [...fixtures, ...(options.extra ?? [])]) registry.register(m);
  const store = memoryThreadStore(),
    proposals = memoryProposalStore(),
    cal = memoryCalendar(account);
  cal.events.push(
    occurrence(
      { uid: 'apt', title: 'APT', start: localInstant('2026-11-04T10:00'), end: localInstant('2026-11-04T11:00') },
      account,
    ),
  );
  let time = Date.parse(T0),
    n = 0;
  const clock = () => new Date(time),
    ids = () => `id-${++n}`;
  const run = <O>(p: AuthenticatedContext, name: string, input: unknown) => registry.run<O>(actorOf(p), name, input);
  const calendar = calendarUsecases({
    store: proposals,
    bind: () => ({ provider: cal }),
    team: async p => (p.role === 'manager' ? members : []),
    round: async () => ({ label: 'Utvecklingssamtal 2026', opensOn: '2026-09-01', dueOn: '2026-11-28', held: [] }),
    clock,
    ids,
    people: { personaFor: async () => undefined },
    notify: async () => undefined,
    obligations: memoryObligations(),
  });
  const threads = threadUsecases({
    store,
    registry,
    run,
    calendar: { ...calendar, todayEvents: async () => [] },
    clock,
    ids,
  });
  const reminders = reminderUsecases({ store, clock });
  // The administered model (D24): with a `generate`, one provider and one switched-on default model the test plays.
  const modelStore = memoryModelStore(),
    health = memoryModelHealth();
  const wire = memoryModelWire({
    endpoints: { 'http://llm.test/v1': { models: ['open-model'] } },
    generate: options.generate,
  });
  const models = modelUsecases({ store: modelStore, wire, health, clock, sealer: { seal: v => v, open: v => v } });
  const seeded = options.generate
    ? modelStore.transaction(async tx => {
        await tx.insertProvider({
          id: 'llm',
          title: 'Kommunens modeller',
          baseUrl: 'http://llm.test/v1',
          apiKey: null,
          health: { status: 'ok', at: T0 },
          createdBy: 'test',
          at: T0,
        });
        await tx.insertModel({
          id: 'open-model',
          providerId: 'llm',
          model: 'open-model',
          title: 'Öppen modell',
          description: '',
          tools: true,
          createdBy: 'test',
          at: T0,
        });
        await tx.updateModel('open-model', { state: 'enabled', isDefault: true }, 'test', T0);
      })
    : Promise.resolve();
  const logged: unknown[] = [];
  const deps = {
    store,
    registry,
    run,
    calendar,
    models: {
      resolve: async (p: AuthenticatedContext) => {
        await seeded;
        return models.resolve(p);
      },
      health,
    },
    clock,
    ids,
    trace: () => '0af7651916cd43dd8448eb211c80319c',
    log: (...args: unknown[]) => {
      logged.push(args);
    },
    people: async (p: AuthenticatedContext) => (p.role === 'manager' ? directory : []),
  };
  const assistant = assistantUsecases(deps);
  const status = async (p: AuthenticatedContext) => {
    await seeded;
    return models.statusFor(p);
  };
  return {
    store,
    proposals,
    cal,
    registry,
    threads,
    reminders,
    calendar,
    assistant,
    health,
    status,
    logged,
    deps,
    advance: (ms: number) => {
      time += ms;
    },
  };
}
const audit = (store: ReturnType<typeof memoryThreadStore>, id: string) =>
  store.audit.filter(e => e.subject === 'thread:' + id).map(e => e.action);

describe('a question without the model', () => {
  test('is answered by the router, kept as a question thread and audited; a reply continues the same thread', async () => {
    const w = world();
    const first = await w.assistant.converse(hillevi, { text: 'visa fakturor' });
    expect(first).toMatchObject({
      assistant: 'router',
      shape: 'vy',
      answer: { at: T0, source: 'Ekonomisystemet' },
      view: { capability: 'finance.invoices' },
      thread: {
        kind: 'question',
        topic: 'question',
        connector: 'clew',
        area: 'fragor',
        title: 'visa fakturor',
        state: 'open',
      },
    });
    expect(first.thread.messages.map(m => [m.role, m.body])).toEqual([
      ['user', 'visa fakturor'],
      ['assistant', first.answer.body],
    ]);
    expect(first.thread.messages[1]!.meta).toMatchObject({
      shape: 'vy',
      assistant: 'router',
      source: 'Ekonomisystemet',
      toolCalls: [{ capability: 'finance.invoices' }],
    });
    expect(w.store.audit.at(-1)).toMatchObject({
      actor: 'person:hillevi',
      action: 'conversation.asked',
      subject: 'thread:' + first.conversationId,
      at: T0,
      details: { assistant: 'router', tools: ['finance.invoices'], view: 'finance.invoices' },
    });
    w.advance(60_000);
    const second = await w.assistant.converse(hillevi, { text: 'xyzzy plugh', conversationId: first.conversationId });
    expect(second.conversationId).toBe(first.conversationId);
    expect(second.answer.body).toMatch(/^Det där kan jag inte svara på ännu/);
    expect(second.thread.messages).toHaveLength(4);
    expect(audit(w.store, first.conversationId)).toEqual(['conversation.asked', 'conversation.replied']);
    await expect(w.assistant.converse(hillevi, { text: 'x', conversationId: 'nope' })).rejects.toThrow(
      'Samtalet finns inte.',
    );
  });
  test('a question no capability answers goes to the composite search as typed, and the hits become a view (D26, D8)', async () => {
    const w = world();
    const docs: Connector = {
      id: 'docs',
      kind: 'passthrough',
      source: 'Intranätet',
      areas: [],
      capabilities: [
        {
          name: 'docs.search',
          kind: 'read',
          title: 'Sök på intranätet',
          description: 'x',
          input: {} as never,
          output: {} as never,
          model: true,
          scope: {},
          run: async (_a, input: { query: string }) => ({
            rows: [
              {
                ref: 'fall-2',
                kind: 'document',
                label: 'Rutin vid fall i ordinärt boende',
                snippet: 'Innan den enskilde hjälps upp …',
                source: 'Intranätet',
                section: 'Vid fall',
                owner: 'MAS',
                reviewedAt: '2026-03-12T00:00:00Z',
                link: 'https://intra/fall#' + encodeURIComponent(input.query),
              },
            ],
          }),
        },
      ],
    };
    w.registry.register(docs);
    w.registry.register(
      searchConnector(searchUsecases({ sources: a => w.registry.searchSources(a), clock: w.deps.clock })),
    );
    const r = await w.assistant.converse(hassan, { text: 'brukaren har ramlat men verkar oskadd, vad gör jag?' });
    expect(r).toMatchObject({
      assistant: 'router',
      shape: 'vy',
      answer: { source: 'Startsidan' },
      view: {
        capability: 'clew.search',
        input: { query: 'brukaren har ramlat men verkar oskadd, vad gör jag?' },
        title: 'Källor',
      },
      followUps: ['Vid fall'],
    });
    expect(r.answer.body).toMatch(
      /^1 träff i rutiner och dokument: Rutin vid fall i ordinärt boende\. Läs själv i panelen/,
    );
    expect(w.store.audit.at(-1)).toMatchObject({
      action: 'conversation.asked',
      details: { assistant: 'router', tools: ['clew.search'], view: 'clew.search' },
    });
    expect(w.registry.tools(actorOf(hassan)).map(t => t.name)).not.toContain('docs.search');
  });
  test('the fixed questions answer from the calendar and the figures, and the samtal question points at the proposal card', async () => {
    const w = world();
    const day = await w.assistant.converse(hillevi, { text: 'Vad har jag i dag?' });
    expect(day.answer.body).toMatch(/^onsdag 4 november: 10:00–11:00 APT\./);
    expect(day.answer.source).toBe('Kalendern');
    const samtal = await w.assistant.converse(hillevi, { text: 'Hur ligger vi till med utvecklingssamtalen?' });
    expect(samtal.shape).toBe('forslag');
    expect(samtal.forslag?.threadId).toBeDefined();
    expect((await w.proposals.readThreadById(samtal.forslag!.threadId))!.thread.proposals).toHaveLength(2);
    const why = await w.assistant.converse(hillevi, { text: 'varför ser jag detta?' });
    expect(why.answer.source).toBe('Startsidan');
    const budget = await w.assistant.converse(hillevi, { text: 'hur ligger budgeten?' });
    // The router reads the areas' figures (D54): the one the question names.
    expect(budget.answer.body).toBe('Förbrukat av ramen: 98 %, av periodens ram.');
    expect(budget.answer.source).toBe('Ekonomisystemet');
  });
  test('completions and the @ objects come from the registry and the open cards in scope', async () => {
    const w = world();
    await w.threads.ensureThreads(hillevi);
    const completions = await w.assistant.completionsFor(hillevi);
    expect(completions.ask.map(a => a.capability)).toContain('hr.whoIsOn');
    expect(completions.completions.slice(0, 2)).toEqual([
      'Vad har jag i dag?',
      'Hur ligger vi till med utvecklingssamtalen?',
    ]);
    expect(completions.do).toEqual([]); // the mock areas list only reads under Gör själv
    expect(completions.recent).toEqual([]);
    await w.assistant.ask(hillevi, 'Vad har jag i dag?');
    expect((await w.assistant.completionsFor(hillevi)).recent.map(r => r.title)).toEqual(['Vad har jag i dag?']);
    const invoices = (await w.threads.listThreadsFor(hillevi)).find(t => t.topic === 'finance:invoices')!;
    // With nothing typed, `@` offers the context alone, never everything open.
    expect(await w.assistant.listObjects(hillevi, '')).toEqual([]);
    const near = await w.assistant.listObjects(hillevi, '', ['thread:' + invoices.id]);
    expect(near.map(o => o.ref)).toEqual(['thread:' + invoices.id, ...invoices.items.map(i => i.ref)]);
    expect(near.every(o => o.visible && o.threadId === invoices.id)).toBe(true);
    // A row in the context brings its whole card along.
    expect((await w.assistant.listObjects(hillevi, '', [invoices.items[0]!.ref])).map(o => o.ref)).toContain(
      'thread:' + invoices.id,
    );
    // Typing searches everything in scope, the context first: meetings and capabilities too.
    expect((await w.assistant.listObjects(hillevi, 'APT')).some(o => o.kind === 'event' && o.label === 'APT')).toBe(
      true,
    );
    expect(
      (await w.assistant.listObjects(hillevi, 'skolgrossisten')).every(o => /skolgrossisten/i.test(o.label + o.detail)),
    ).toBe(true);
    const ranked = await w.assistant.listObjects(hillevi, 'a', ['thread:' + invoices.id]);
    expect(ranked.map(o => o.visible)).toEqual([...ranked.map(o => o.visible)].sort((a, b) => Number(b) - Number(a)));
    expect(ranked[0]!.visible).toBe(true);
    expect(ranked.length).toBeLessThanOrEqual(12);
    expect(await w.status(hillevi)).toEqual({
      configured: false,
      available: false,
      model: null,
      checkedAt: null,
      current: null,
      choices: [],
    });
  });
});

describe('the answer is the card (D34, H1)', () => {
  test('a question that names an open card is answered with that card without the model, audited, and the card is drawn once', async () => {
    const w = world();
    await w.threads.ensureThreads(hillevi);
    const card = (await w.threads.listThreadsFor(hillevi)).find(t => t.topic === 'finance:invoices')!;
    const first = await w.assistant.converse(hillevi, { text: 'attestera en faktura' });
    expect(first).toMatchObject({ assistant: 'router', shape: 'svar', answer: { source: 'Ekonomisystemet' } });
    expect(first.answer.body).toContain(card.summary.replace(/\.$/, ''));
    expect(first.thread.messages[1]!.meta).toMatchObject({ cards: [card.id] });
    expect(w.store.audit.at(-1)).toMatchObject({
      action: 'conversation.asked',
      subject: 'thread:' + first.conversationId,
      details: { assistant: 'router', cards: [card.id] },
    });
    // Nothing is attested by asking: the card is only drawn.
    expect((await w.threads.threadFor(hillevi, card.id))!.state).toBe('open');
    // The same card again in the same conversation is not drawn twice; the one above is live.
    const again = await w.assistant.converse(hillevi, {
      text: 'attestera fakturan',
      conversationId: first.conversationId,
    });
    expect(again.thread.messages[3]!.meta?.cards).toBeUndefined();
    // A question about something else names no card.
    const other = await w.assistant.converse(hillevi, { text: 'vem är på plats i dag?' });
    expect(other.thread.messages[1]!.meta?.cards).toBeUndefined();
  });
  test('a chipped card is drawn in the turn that asks about it', async () => {
    const w = world();
    await w.threads.ensureThreads(hillevi);
    const card = (await w.threads.listThreadsFor(hillevi)).find(t => t.topic === 'finance:invoices')!;
    const why = await w.assistant.converse(hillevi, {
      text: 'varför ser jag detta?',
      chips: [{ ref: 'thread:' + card.id, kind: 'thread', label: card.title }],
    });
    expect(why.thread.messages[1]!.meta).toMatchObject({ cards: [card.id] });
    expect(w.store.audit.at(-1)).toMatchObject({ details: { cards: [card.id] } });
  });
});

describe('a chipped card', () => {
  async function invoices(w: ReturnType<typeof world>) {
    await w.threads.ensureThreads(hillevi);
    return (await w.threads.listThreadsFor(hillevi)).find(t => t.topic === 'finance:invoices')!;
  }
  const chip = (t: Thread) => [{ ref: 'thread:' + t.id, kind: 'thread' as const, label: t.title }];
  test('proposes Clew actions instead of acting, and answers why', async () => {
    const w = world();
    const card = await invoices(w);
    const dismiss = await w.assistant.converse(hillevi, { text: 'avfärda det', chips: chip(card) });
    expect(dismiss.clewActions).toEqual([
      { n: 1, kind: 'dismiss', threadId: card.id, label: `Avfärda "${card.title}"` },
    ]);
    expect(dismiss.verbs?.map(v => v.kind)).toContain('snooze');
    expect((await w.threads.threadFor(hillevi, card.id))!.state).toBe('open');
    const why = await w.assistant.converse(hillevi, { text: 'varför ser jag detta?', chips: chip(card) });
    expect(why.answer).toMatchObject({
      source: 'Ekonomisystemet',
      body: expect.stringContaining('Varför nu? ' + card.trigger.reason),
    });
    expect(why.thread.messages[0]!.meta).toEqual({ chips: chip(card), refs: ['thread:' + card.id] });
    await expect(
      w.assistant.converse(hillevi, { text: 'x', chips: [{ ref: 'thread:gone', kind: 'thread', label: 'x' }] }),
    ).rejects.toThrow('Något du pekade på finns inte längre.');
  });
  test('"bara …" drafts the selection on the card with its own audit row; the button on the card still sends', async () => {
    const w = world();
    const card = await invoices(w);
    const draft = await w.assistant.converse(hillevi, { text: 'attestera bara Skolgrossisten', chips: chip(card) });
    expect(draft.shape).toBe('forslag');
    expect(draft.draft).toMatchObject({ kind: 'select', threadId: card.id });
    const after = (await w.threads.threadFor(hillevi, card.id))!;
    expect(after.items.map(i => [i.label.split(' · ')[0], i.selected])).toEqual(
      card.items.map(i => [i.label.split(' · ')[0], i.label.startsWith('Skolgrossisten')]),
    );
    expect(after.messages.at(-1)).toMatchObject({
      role: 'assistant',
      body: expect.stringMatching(/^Utkast: 2 av 3 valda/),
      meta: { draft: { kind: 'select', threadId: card.id } },
    });
    expect(audit(w.store, card.id)).toEqual(['thread.pushed', 'thread.drafted']);
    expect(after.state).toBe('open');
  });
  test('a reply in a card is one chipped turn copied into the card', async () => {
    const w = world();
    const card = await invoices(w);
    const replied = await w.assistant.reply(hillevi, card.id, 'varför ser jag detta?');
    expect(replied.messages.slice(-2).map(m => [m.role, m.body.startsWith('Varför nu?')])).toEqual([
      ['user', false],
      ['assistant', true],
    ]);
    expect(audit(w.store, card.id)).toEqual(['thread.pushed', 'thread.replied']);
    expect(w.store.audit.filter(e => e.action === 'conversation.asked')).toHaveLength(1);
  });
  test('"nästa vecka i stället" on the proposal card redraws it through the calendar', async () => {
    const w = world();
    const samtal = (await w.calendar.ensureProposalThread(hillevi))!;
    // In production the stream and the calendar share one database; here the assistant's store also sees the calendar's threads.
    const assistant = assistantUsecases({
      ...w.deps,
      store: {
        ...w.store,
        readThread: async (p, id) => (await w.proposals.readThread(p, id))?.thread ?? w.store.readThread(p, id),
      },
    });
    const turn = await assistant.converse(hillevi, {
      text: 'nästa vecka i stället',
      chips: [{ ref: 'thread:' + samtal.id, kind: 'thread', label: samtal.title }],
    });
    expect(turn.draft).toMatchObject({
      kind: 'replan',
      threadId: samtal.id,
      week: '2026-11-16',
      thread: { week: '2026-11-16' },
    });
    expect(w.proposals.audit.at(-1)).toMatchObject({ action: 'proposals.replanned', details: { week: '2026-11-16' } });
  });
});

describe('with a model', () => {
  test('the model answers with read tools through the registry, and a failure falls back to the router and flips the status', async () => {
    const generated: string[] = [];
    let fail = false;
    const generate: ModelGenerate = async ({ system, messages, tools }) => {
      if (fail) throw new Error('timeout');
      generated.push(system, String(messages.at(-1)!.content), ...Object.keys(tools));
      const output = await (
        tools['hr__whoIsOn'] as { execute: (input: unknown, options: unknown) => Promise<unknown> }
      ).execute({}, {});
      return {
        text: 'Tre på plats. Personalsystemet 08:00.',
        toolCalls: [{ capability: 'hr.whoIsOn', input: {}, output }],
        usage: { inputTokens: 120, outputTokens: 18, finishReason: 'stop', steps: 2 },
      };
    };
    const w = world({ generate });
    const turn = await w.assistant.converse(hillevi, { text: 'vem är här?' });
    expect(turn).toMatchObject({
      assistant: 'model',
      answer: { body: 'Tre på plats. Personalsystemet 08:00.', source: 'Personalsystemet' },
    });
    expect(generated[0]).toContain('onsdag 4 november 2026, klockan 08:00, vecka 45');
    expect(generated).toContain('hr__whoIsOn');
    expect(generated.some(g => g.includes('approve'))).toBe(false);
    // The answer says which administered model wrote it (D24): in the response, in the message and in the audit row.
    expect(turn.model).toEqual({ id: 'open-model', title: 'Öppen modell' });
    expect(turn.thread.messages.at(-1)!.meta?.model).toEqual({ id: 'open-model', title: 'Öppen modell' });
    expect(w.store.audit.at(-1)).toMatchObject({
      action: 'conversation.asked',
      details: { assistant: 'model', tools: ['hr.whoIsOn'], model: 'open-model' },
    });
    // The turn's cost and trace (D91) are on the message and in the audit row: the provider, the wall time by the
    // deps' clock, steps, tokens, the finish reason and the trace id the deps hand out. Never the text.
    const modelCall = {
      providerId: 'llm',
      durationMs: 0,
      steps: 2,
      inputTokens: 120,
      outputTokens: 18,
      finishReason: 'stop',
      traceId: '0af7651916cd43dd8448eb211c80319c',
    };
    expect(turn.thread.messages.at(-1)!.meta?.modelCall).toEqual(modelCall);
    expect(w.store.audit.at(-1)).toMatchObject({ details: { modelCall } });
    expect(JSON.stringify(w.store.audit.at(-1))).not.toContain('Tre på plats');
    fail = true;
    const fallback = await w.assistant.converse(hillevi, { text: 'vem är på plats i dag?' });
    expect(fallback.assistant).toBe('unavailable');
    expect(fallback.model).toBeUndefined();
    // Why the router answered is kept with the turn (D91): the wire's words, on the message and in the audit row.
    expect(fallback.thread.messages.at(-1)!.meta).toMatchObject({
      assistant: 'unavailable',
      fallbackReason: 'timeout',
    });
    expect(fallback.thread.messages.at(-1)!.meta?.modelCall).toBeUndefined();
    expect(w.store.audit.at(-1)).toMatchObject({ details: { assistant: 'unavailable', fallbackReason: 'timeout' } });
    expect(await w.status(hillevi)).toMatchObject({ configured: true, available: false, model: 'Öppen modell' });
    expect(w.logged).toHaveLength(1);
    w.health.mark('llm', true, T0);
    fail = false;
    expect((await w.assistant.converse(hillevi, { text: 'vem är här?' })).assistant).toBe('model');
  });
});

describe('a turn heard while it runs (D36)', () => {
  const textOf = (events: TurnEvent[]) =>
    events.reduce((text, e) => (e.type === 'text' ? (e.reset ? e.delta : text + e.delta) : text), '');
  test("the listener hears each read as a step and the model's text as it is written, without the trailer; the turn and its audit row are written once, at the end", async () => {
    const generate: ModelGenerate = async ({ tools, onText }) => {
      const output = await (
        tools['hr__whoIsOn'] as { execute: (input: unknown, options: unknown) => Promise<unknown> }
      ).execute({}, {});
      for (const text of ['Tre', 'Tre på plats.', 'Tre på plats.\nF', 'Tre på plats.\nFöljdfrågor: Vem saknas?'])
        onText?.(text);
      return {
        text: 'Tre på plats.\nFöljdfrågor: Vem saknas?',
        toolCalls: [{ capability: 'hr.whoIsOn', input: {}, output }],
      };
    };
    const w = world({ generate });
    const events: TurnEvent[] = [];
    const turn = await w.assistant.converse(
      hillevi,
      { text: 'vem är här?' },
      {
        emit: e => {
          events.push(e);
          expect(w.store.audit).toHaveLength(0);
        },
      },
    );
    expect(events.filter(e => e.type === 'step')).toEqual([
      {
        type: 'step',
        step: {
          id: 'steg-1',
          capability: 'hr.whoIsOn',
          title: expect.any(String),
          source: 'Personalsystemet',
          status: 'running',
        },
      },
      {
        type: 'step',
        step: {
          id: 'steg-1',
          capability: 'hr.whoIsOn',
          title: expect.any(String),
          source: 'Personalsystemet',
          status: 'complete',
          ms: 0,
        },
      },
    ]);
    expect(events.filter(e => e.type === 'text').map(e => e.type === 'text' && e.delta)).toEqual([
      'Tre',
      ' på plats.',
      '\n',
    ]);
    expect(textOf(events).trim()).toBe(turn.answer.body);
    expect(turn.followUps).toEqual(['Vem saknas?']);
    expect(audit(w.store, turn.conversationId)).toEqual(['conversation.asked']);
  });
  test('a stopped turn writes nothing and does not mark the model down', async () => {
    const stop = new AbortController();
    const generate: ModelGenerate = async ({ onText, signal }) => {
      onText?.('Tre');
      stop.abort();
      if (signal?.aborted) throw new Error('aborted');
      return { text: 'Tre på plats.', toolCalls: [] };
    };
    const w = world({ generate });
    await expect(
      w.assistant.converse(hillevi, { text: 'vem är här?' }, { signal: stop.signal }),
    ).rejects.toBeInstanceOf(TurnStopped);
    expect(w.store.audit).toHaveLength(0);
    expect((await w.store.listThreads('hillevi', T0)).filter(t => t.kind === 'question')).toHaveLength(0);
    expect(await w.status(hillevi)).toMatchObject({ configured: true, available: true });
    expect(w.logged).toHaveLength(0);
  });
  test('a stop after the answer is known still writes nothing', async () => {
    const stop = new AbortController();
    const w = world();
    await expect(
      w.assistant.converse(
        hillevi,
        { text: 'visa fakturor' },
        {
          signal: stop.signal,
          emit: e => {
            if (e.type === 'step' && e.step.status === 'complete') stop.abort();
          },
        },
      ),
    ).rejects.toBeInstanceOf(TurnStopped);
    expect(w.store.audit).toHaveLength(0);
  });
  test("when the model fails halfway the listener is told to start over, and the router's read is a step", async () => {
    const generate: ModelGenerate = async ({ onText }) => {
      onText?.('Fakturorna');
      throw new Error('timeout');
    };
    const w = world({ generate });
    const events: TurnEvent[] = [];
    const turn = await w.assistant.converse(hillevi, { text: 'visa fakturor' }, { emit: e => events.push(e) });
    expect(turn.assistant).toBe('unavailable');
    expect(
      events.map(e =>
        e.type === 'text' ? `text:${e.reset ? 'reset:' : ''}${e.delta}` : `step:${e.step.capability}:${e.step.status}`,
      ),
    ).toEqual(['text:Fakturorna', 'text:reset:', 'step:finance.invoices:running', 'step:finance.invoices:complete']);
    expect(w.store.audit.at(-1)).toMatchObject({
      action: 'conversation.asked',
      details: { assistant: 'unavailable', tools: ['finance.invoices'] },
    });
  });
});

describe('a question answered from documents, with the model (D26)', () => {
  const docs: Connector = {
    id: 'docs',
    kind: 'passthrough',
    source: 'Intranätet',
    areas: [],
    capabilities: [
      {
        name: 'docs.search',
        kind: 'read',
        title: 'Sök på intranätet',
        description: 'x',
        input: {} as never,
        output: {} as never,
        model: true,
        scope: {},
        run: async () => ({
          rows: [
            {
              ref: 'fall-2',
              kind: 'document',
              label: 'Rutin vid fall i ordinärt boende',
              snippet: 'Innan den enskilde hjälps upp …',
              source: 'Intranätet',
              section: 'Vid fall',
              owner: 'MAS',
              reviewedAt: '2026-03-12T00:00:00Z',
              link: 'https://intra/fall',
            },
            {
              ref: 'fall-4',
              kind: 'document',
              label: 'Rutin vid fall i ordinärt boende',
              snippet: 'Varje fall registreras som avvikelse …',
              source: 'Intranätet',
              section: 'Avvikelse',
              owner: 'MAS',
              reviewedAt: '2026-03-12T00:00:00Z',
            },
          ],
        }),
      },
      {
        name: 'docs.fetch',
        kind: 'read',
        title: 'Hämta',
        description: 'x',
        input: {} as never,
        output: {} as never,
        model: false,
        scope: {},
        run: async (_a, input: { ref: string }) => {
          if (input.ref !== 'fall-2') throw new Error('nope');
          return {
            ref: input.ref,
            kind: 'document',
            label: 'Rutin vid fall i ordinärt boende',
            snippet: 'Innan den enskilde hjälps upp …',
            source: 'Intranätet',
            section: 'Vid fall',
            owner: 'MAS',
            reviewedAt: '2026-03-12T00:00:00Z',
          };
        },
      },
    ],
  };
  test('the model searches once, the answer is cited and read as steps, the follow-ups come from the trailer, and a passage can be chipped for the next turn', async () => {
    const seen: string[] = [];
    const generate: ModelGenerate = async ({ system, messages, tools }) => {
      seen.push(system, String(messages.at(-1)!.content));
      expect(Object.keys(tools)).toContain('clew__search');
      expect(Object.keys(tools)).not.toContain('docs__search');
      const output = await (
        tools['clew__search'] as { execute: (input: unknown, options: unknown) => Promise<unknown> }
      ).execute({ query: 'brukaren har ramlat' }, {});
      return {
        text: '1. Lyft inte själv [1].\n2. Ring sjuksköterskan [1].\n3. Skriv avvikelse i avvikelsesystemet [2].\nFöljdfrågor: Och om hen slagit i huvudet? | Vem ringer jag på natten?',
        toolCalls: [{ capability: 'clew.search', input: { query: 'brukaren har ramlat' }, output }],
      };
    };
    const w = world({ generate });
    w.registry.register(docs);
    w.registry.register(
      searchConnector(searchUsecases({ sources: a => w.registry.searchSources(a), clock: w.deps.clock })),
    );
    const r = await w.assistant.converse(hassan, { text: 'Brukaren har ramlat men verkar oskadd, vad gör jag?' });
    expect(r).toMatchObject({
      assistant: 'model',
      shape: 'steg',
      answer: { source: 'Startsidan' },
      followUps: ['Och om hen slagit i huvudet?', 'Vem ringer jag på natten?'],
      view: { capability: 'clew.search', title: 'Källor' },
    });
    expect(r.answer.body).toBe(
      '1. Lyft inte själv [1].\n2. Ring sjuksköterskan [1].\n3. Skriv avvikelse i avvikelsesystemet [2].',
    );
    expect(r.sources).toEqual([
      {
        n: 1,
        ref: 'document:docs:fall-2',
        label: 'Rutin vid fall i ordinärt boende',
        source: 'Intranätet',
        stale: false,
        link: 'https://intra/fall',
        section: 'Vid fall',
        owner: 'MAS',
        reviewedAt: '2026-03-12T00:00:00Z',
      },
      {
        n: 2,
        ref: 'document:docs:fall-4',
        label: 'Rutin vid fall i ordinärt boende',
        source: 'Intranätet',
        stale: false,
        section: 'Avvikelse',
        owner: 'MAS',
        reviewedAt: '2026-03-12T00:00:00Z',
      },
    ]);
    expect(r.thread.messages[1]!.meta).toMatchObject({
      shape: 'steg',
      sources: [{ n: 1 }, { n: 2 }],
      followUps: ['Och om hen slagit i huvudet?', 'Vem ringer jag på natten?'],
    });
    expect(w.store.audit.at(-1)).toMatchObject({
      action: 'conversation.asked',
      details: {
        assistant: 'model',
        tools: ['clew.search'],
        sources: ['document:docs:fall-2', 'document:docs:fall-4'],
      },
    });
    expect(JSON.stringify(w.store.audit.at(-1))).not.toContain('Innan den enskilde');
    const second = await w.assistant.converse(hassan, {
      text: 'Och om hon slagit i huvudet?',
      conversationId: r.conversationId,
      chips: [{ ref: 'document:docs:fall-2', kind: 'document', label: 'ignored' }],
    });
    expect(second.conversationId).toBe(r.conversationId);
    expect(seen.at(-2)).toContain(
      'Avsnitt "Rutin vid fall i ordinärt boende, Vid fall" ur Intranätet (MAS, granskad 2026-03-12)',
    );
    await expect(
      w.assistant.converse(hassan, { text: 'x', chips: [{ ref: 'document:docs:nope', kind: 'document', label: 'x' }] }),
    ).rejects.toThrow('Något du pekade på finns inte längre.');
  });
});

/** The phone book as the registry runs it: the real connector over the protocol, in process, on its made-up organisation. */
function phonebook(): Connector {
  const secret = 'test-secret-test-secret',
    service = createTelefonbok({ jwks: testJwks, secret });
  return remoteConnector(parseManifest(phonebookManifest, 'phonebook'), {
    url: 'http://phonebook',
    key: secret,
    assert: assertionFor('phonebook', secret),
    fetch: (input, init) => service.handle(new Request(input, init)),
  });
}
describe('a declared view is the answer, with and without the model (D38)', () => {
  test("without the model: what was typed after the capability's name is the view's question; the turn stores a count, the view and its audit row, never a row", async () => {
    const w = world({ extra: [phonebook()] });
    const r = await w.assistant.converse(hassan, { text: 'telefonboken lindqvist' });
    expect(r).toMatchObject({
      assistant: 'router',
      shape: 'vy',
      view: {
        capability: 'phonebook.directory',
        input: { query: 'lindqvist' },
        title: 'Sök i telefonboken',
        source: 'Telefonboken',
        declared: true,
      },
    });
    expect(r.answer.body).toBe('Sök i telefonboken: 1 rad.');
    expect(w.store.audit.at(-1)).toMatchObject({
      actor: 'person:hassan',
      action: 'conversation.asked',
      subject: 'thread:' + r.conversationId,
      details: { assistant: 'router', tools: ['phonebook.directory'], view: 'phonebook.directory' },
    });
    // What Clew keeps of the turn: the question, the sentence and where the view is. No name it did not get from the person, no number.
    const kept = JSON.stringify([await w.store.readThread('hassan', r.conversationId), w.store.audit]);
    expect(kept).not.toMatch(/Anna|0980|070-|kommun\.example/);
    // The view itself is read from the source when it is opened, as the person.
    expect(await w.deps.run<{ rows: unknown[] }>(hassan, r.view!.capability, r.view!.input)).toMatchObject({
      rows: [{ name: 'Anna Lindqvist', phone: '0980-319 203' }],
    });
    const team = await w.assistant.converse(hassan, { text: 'mitt team' });
    expect(team).toMatchObject({
      view: { capability: 'phonebook.team', input: {}, declared: true },
      answer: { body: 'Mitt teams kontaktlista: 5 rader.' },
    });
  });
  test("with the model: the tool runs for the person's view, the model is handed a count, and its answer carries the view", async () => {
    const handed: unknown[] = [];
    const generate: ModelGenerate = async ({ system, tools }) => {
      expect(system).toContain('resultatet visas i en vy');
      expect(Object.keys(tools)).toEqual(expect.arrayContaining(['phonebook__directory', 'phonebook__team']));
      const output = await (
        tools['phonebook__directory'] as { execute: (input: unknown, options: unknown) => Promise<unknown> }
      ).execute({ query: 'lärare', scope: 'unit' }, {});
      handed.push(output);
      return {
        text: 'Två träffar på din enhet finns i vyn. Telefonboken 08:00.',
        toolCalls: [{ capability: 'phonebook.directory', input: { query: 'lärare', scope: 'unit' }, output }],
      };
    };
    const w = world({ generate, extra: [phonebook()] });
    const r = await w.assistant.converse(hassan, { text: 'vilka lärare finns på min enhet?' });
    expect(handed).toEqual([
      {
        shown: true,
        view: 'Sök i telefonboken',
        rows: 2,
        note: expect.stringContaining('Innehållet lämnas inte till dig'),
      },
    ]);
    expect(r).toMatchObject({
      assistant: 'model',
      shape: 'vy',
      view: { capability: 'phonebook.directory', input: { query: 'lärare', scope: 'unit' }, declared: true },
    });
    expect(r.thread.messages[1]!.meta).toMatchObject({
      toolCalls: [{ capability: 'phonebook.directory', input: { query: 'lärare', scope: 'unit' } }],
    });
    expect(w.store.audit.at(-1)).toMatchObject({
      action: 'conversation.asked',
      details: { assistant: 'model', tools: ['phonebook.directory'], view: 'phonebook.directory' },
    });
    expect(JSON.stringify([await w.store.readThread('hassan', r.conversationId), w.store.audit])).not.toMatch(
      /Anna|Hassan Ali|0980|070-/,
    );
  });
});

test('a transferred person cannot use old source cards through chips, object suggestions or model context', async () => {
  let prompt = '';
  const w = world({
    generate: async req => {
      prompt = JSON.stringify(req);
      return { text: 'Här är svaret.', toolCalls: [] };
    },
  });
  await w.threads.ensureThreads(hillevi);
  const card = (await w.threads.listThreadsFor(hillevi)).find(t => t.connector === 'finance')!;
  const transferred = {
    ...hillevi,
    unitId: 'other-unit',
    authorizationVersion: 'v2',
    authorize: async () => ({ version: 'v2' }),
  };
  expect(await w.assistant.listObjects(transferred, '', ['thread:' + card.id])).toEqual([]);
  await expect(
    w.assistant.converse(transferred, {
      text: 'varför ser jag detta?',
      chips: [{ ref: 'thread:' + card.id, kind: 'thread', label: 'Old card' }],
    }),
  ).rejects.toThrow('Något du pekade på finns inte längre.');
  await expect(
    w.assistant.converse(transferred, {
      text: 'varför ser jag detta?',
      chips: [{ ref: card.items[0]!.ref, kind: 'item', label: 'Old item' }],
    }),
  ).rejects.toThrow('Något du pekade på finns inte längre.');
  await w.assistant.converse(transferred, { text: 'Berätta något om hösten' });
  expect(prompt).not.toBe('');
  expect(prompt).not.toContain(card.summary);
  expect(prompt).not.toContain(card.items[0]!.ref);
});

/**
 * The assistant drafts, the person decides (D112 item 8). With one work item as the subject the model may fill in one
 * of its actions that asks: the values are checked as the decision checks them, the draft is kept in the conversation
 * and its audit row names the action and the asks it answered, never the values or the text. Nothing is executed and
 * the work item itself is left as it was. An execute is never a tool; the draft tool lists only what the person may do.
 */
describe('the assistant drafts, the person decides (D112 item 8)', () => {
  const LATER = '2026-11-12T13:15:00.000Z';
  type Callable = { execute: (input: unknown, options: unknown) => Promise<unknown> };
  async function rehab(w: ReturnType<typeof world>) {
    await w.threads.ensureThreads(hillevi);
    return (await w.threads.listThreadsFor(hillevi)).find(t => t.topic === 'hr:rehab:hr:emp:1001')!;
  }
  test('a draft of the item’s action is checked, kept in the conversation with its audit row, and nothing is sent', async () => {
    const offered: string[][] = [];
    const answers: unknown[] = [];
    const generate: ModelGenerate = async ({ tools, system }) => {
      offered.push(Object.keys(tools));
      if (!tools['clew__draftAction']) return { text: 'Inget att fylla i.', toolCalls: [] };
      expect(system).toContain('clew__draftAction');
      const draft = tools['clew__draftAction'] as Callable;
      // A time that is not one is refused in the decision's own words, and the model may try again.
      answers.push(await draft.execute({ action: 'book', values: { when: 'torsdag' } }, {}));
      answers.push(await draft.execute({ action: 'unbook', values: {} }, {}));
      const input = { action: 'book', values: { when: LATER, place: ' Rum 12 ', message: 'Hej! Ses vi?' } };
      const output = await draft.execute(input, {});
      answers.push(output);
      return {
        text: 'Ni är båda lediga torsdag 14.15. Jag har fyllt i bokningen; inget är skickat.',
        toolCalls: [{ capability: 'clew.draftAction', input, output }],
      };
    };
    const w = world({ generate });
    const card = await rehab(w);
    const turn = await w.assistant.converse(hillevi, {
      text: 'Boka samtalet på torsdag eftermiddag',
      chips: [{ ref: 'thread:' + card.id, kind: 'thread', label: card.title }],
    });
    expect(answers).toEqual([
      { error: 'När: välj en tid.' },
      { error: 'Ärendet har ingen sådan åtgärd.' },
      { drafted: true, note: 'Utkastet visas för personen. Inget är skickat.' },
    ]);
    // The execute itself is never a tool: only reads and Clew's draft are offered.
    expect(offered[0]).toContain('clew__draftAction');
    expect(offered[0]).not.toContain('hr__bookTalk');
    const values = { when: LATER, place: 'Rum 12', message: 'Hej! Ses vi?' };
    expect(turn).toMatchObject({
      shape: 'forslag',
      assistant: 'model',
      draft: { kind: 'action', threadId: card.id, actionId: 'book', values, thread: { id: card.id } },
    });
    // The draft is kept in the conversation's answer, without the thread; its reads stay the answer's tool calls.
    expect(turn.thread.messages.at(-1)!.meta?.draft).toEqual({
      kind: 'action',
      threadId: card.id,
      actionId: 'book',
      values,
    });
    expect(turn.thread.messages.at(-1)!.meta?.toolCalls).toBeUndefined();
    // One audit row for the turn, naming the action and the asks it answered; never the values or the text.
    const row = w.store.audit.at(-1)!;
    expect(row).toMatchObject({
      action: 'conversation.asked',
      subject: 'thread:' + turn.conversationId,
      details: { tools: [], drafted: { thread: card.id, action: 'book', asks: ['when', 'place', 'message'] } },
    });
    expect(JSON.stringify(row)).not.toContain('Rum 12');
    expect(JSON.stringify(row)).not.toContain('Hej! Ses vi?');
    expect(JSON.stringify(row)).not.toContain('fyllt i bokningen');
    // Nothing was sent: the item is as it was, with no decision on its way and no row of its own.
    const after = (await w.threads.threadFor(hillevi, card.id))!;
    expect(after.state).toBe('open');
    expect(after.receipt ?? null).toBeNull();
    expect(after.execution ?? null).toBeNull();
    expect(audit(w.store, card.id)).toEqual(['thread.pushed']);
    // Without the item as the subject there is nothing to draft, and no draft tool.
    await w.assistant.converse(hillevi, { text: 'Vad händer i dag?' });
    expect(offered.at(-1)).not.toContain('clew__draftAction');
  });
  test('only what the person may do is offered, and only on an open item', async () => {
    const w = world();
    const card = await rehab(w);
    expect(draftableActions(w.registry, hillevi, card)).toEqual([
      {
        id: 'book',
        label: 'Boka samtalet',
        capability: 'hr.bookTalk',
        asks: card.actions.find(a => a.id === 'book')!.path!.asks,
        input: expect.anything(),
      },
    ]);
    // Out of the person's scope the action is not offered at all; a handled item offers nothing.
    expect(draftableActions({ allowed: () => undefined }, hillevi, card)).toEqual([]);
    expect(draftableActions(w.registry, hillevi, { ...card, state: 'handled' })).toEqual([]);
    // The tool checks as the decision does: a time that has passed is refused and nothing is heard.
    const heard: unknown[] = [];
    const tool = draftTool(draftableActions(w.registry, hillevi, card), T0, d => heard.push(d));
    expect(tool.name).toBe(DRAFT_TOOL);
    expect(await tool.execute({ action: 'book', values: { when: '2026-11-01T09:00:00.000Z' } })).toEqual({
      error: 'När: tiden har redan passerat.',
    });
    expect(await tool.execute({ action: 'book', values: { when: 42 } })).toEqual({
      error: 'Varje värde ska vara text.',
    });
    expect(heard).toEqual([]);
  });
});

describe('a question about a person the asker manages (D115)', () => {
  const QUESTION = 'Anna har varit sjuk i två veckor, vad gör jag?';
  type Callable = { execute: (input: unknown, options: unknown) => Promise<unknown> };
  /** What a source holds about Anna's health, as the rehab card's summary and row say it: never handed to the model. */
  const HEALTH = ['Namnet visas i personalsystemet', 'korta perioder sedan', 'Sjuk ·', '"periods"', 'hr:emp:1001'];
  async function rehab(w: ReturnType<typeof world>) {
    await w.threads.ensureThreads(hillevi);
    return (await w.threads.listThreadsFor(hillevi)).find(t => t.topic === 'hr:rehab:hr:emp:1001')!;
  }
  /** A tool-using model the test plays: it calls the tools named in `script` in order, and everything it is handed is kept. */
  function scripted(script: Array<[tool: string, input: Record<string, unknown>]>, text: string) {
    const handed: string[] = [];
    const offered: string[][] = [];
    const generate: ModelGenerate = async ({ system, messages, tools }) => {
      handed.push(system, JSON.stringify(messages));
      offered.push(Object.keys(tools));
      const toolCalls = [];
      for (const [name, input] of script) {
        const output = await (tools[name] as Callable).execute(input, {});
        handed.push(JSON.stringify(output));
        toolCalls.push({ capability: name.replace('__', '.'), input, output });
      }
      return { text, toolCalls };
    };
    return { generate, handed, offered };
  }

  test('with a model: Anna is resolved, the routine is read, the work item about her is drawn, and no health row reaches the model', async () => {
    const answer =
      'Två veckor är gränsen till lång sjukfrånvaro: från dag 15 anmäler du sjukfallet till Försäkringskassan och håller kontakten. Under Behöver dig väntar också ärendet om att boka ett omtankesamtal med Anna senast 16 november; knappen Boka samtalet gör det.';
    const model = scripted(
      [
        ['clew__findPerson', { name: 'Anna' }],
        ['hr__rehabRoutine', {}],
      ],
      answer,
    );
    const w = world({ generate: model.generate });
    const card = await rehab(w);
    const turn = await w.assistant.converse(hillevi, { text: QUESTION });
    const [system] = model.handed;
    // The prompt names who "Anna" is and the work about her by title, last day and buttons; nothing a source holds.
    expect(system).toContain('Medarbetare som personen nämnde (bland dem personen är chef för):');
    expect(system).toContain(
      '- "Anna" är Anna Lindqvist på Skönsmons skola, användarnamn anna. Öppna ärenden om medarbetaren under Behöver dig: Ärende "Boka ett omtankesamtal med en medarbetare" (Personalsystemet, senast måndag 16 november). Knappar i ärendet nu: Boka samtalet, Se mönstret i personalsystemet, Inte nu, Fler val (Lägg till i samtalet, Avfärda).',
    );
    expect(system).toContain('Uppgifter om medarbetarnas hälsa och frånvaro lämnas inte till dig.');
    // The lookup is Clew's own and answers the same, with the user name a read about one person takes (D122); the
    // routine is policy text, handed whole.
    expect(JSON.parse(model.handed[2]!)).toEqual({
      found: 'one',
      name: 'Anna Lindqvist',
      unit: 'Skönsmons skola',
      userName: 'anna',
      workItems: [
        'Ärende "Boka ett omtankesamtal med en medarbetare" (Personalsystemet, senast måndag 16 november). Knappar i ärendet nu: Boka samtalet, Se mönstret i personalsystemet, Inte nu, Fler val (Lägg till i samtalet, Avfärda).',
      ],
      note: 'Ärendena visas för personen i samtalet. Uppgifter om medarbetarens hälsa och frånvaro lämnas inte till dig.',
    });
    expect(model.handed[3]).toContain('Gör en plan för återgång i arbete');
    // Never a source's rows about anyone's health: not the card's summary or row, not an absence read.
    for (const marker of HEALTH) expect(model.handed.join('\n')).not.toContain(marker);
    expect(model.offered[0]).toEqual(
      expect.arrayContaining(['clew__findPerson', 'hr__rehabRoutine', 'clew__draftAction']),
    );
    expect(model.offered[0]).not.toContain('hr__person');
    expect(model.offered[0]).not.toContain('hr__absencePattern');
    // The answer is the model's, read from the routine; the work item is drawn in the turn, the routine is its view.
    expect(turn).toMatchObject({
      assistant: 'model',
      shape: 'vy',
      answer: { body: answer, source: 'Personalsystemet' },
      view: { capability: 'hr.rehabRoutine', title: 'Rehabiliteringsrutinen', declared: true },
    });
    expect(turn.thread.messages.at(-1)!.meta).toMatchObject({
      cards: [card.id],
      toolCalls: [
        { capability: 'clew.findPerson', input: { name: 'Anna' } },
        { capability: 'hr.rehabRoutine', input: {} },
      ],
    });
    // One audit row for the turn with the tools it used and the card it drew; no name, no text.
    const row = w.store.audit.at(-1)!;
    expect(row).toMatchObject({
      action: 'conversation.asked',
      subject: 'thread:' + turn.conversationId,
      details: {
        assistant: 'model',
        tools: ['clew.findPerson', 'hr.rehabRoutine'],
        view: 'hr.rehabRoutine',
        cards: [card.id],
        model: 'open-model',
      },
    });
    expect(JSON.stringify(row)).not.toContain('Anna');
    // Nothing was done to the work item by asking.
    expect(audit(w.store, card.id)).toEqual(['thread.pushed']);
  });

  test('with a model: the one work item about the one person named is the item the model may draft on, and nothing is sent', async () => {
    const LATER = '2026-11-12T13:15:00.000Z';
    const model = scripted(
      [['clew__draftAction', { action: 'book', values: { when: LATER, place: 'Rum 12' } }]],
      'Jag har fyllt i bokningen av omtankesamtalet; inget är skickat.',
    );
    const w = world({ generate: model.generate });
    const card = await rehab(w);
    const turn = await w.assistant.converse(hillevi, { text: 'Boka omtankesamtalet med Anna på torsdag' });
    expect(model.handed[2]).toBe(
      JSON.stringify({ drafted: true, note: 'Utkastet visas för personen. Inget är skickat.' }),
    );
    expect(turn).toMatchObject({
      shape: 'forslag',
      draft: { kind: 'action', threadId: card.id, actionId: 'book', values: { when: LATER, place: 'Rum 12' } },
    });
    expect(w.store.audit.at(-1)).toMatchObject({
      details: { drafted: { thread: card.id, action: 'book', asks: ['when', 'place'] }, cards: [card.id] },
    });
    expect((await w.threads.threadFor(hillevi, card.id))!.execution ?? null).toBeNull();
  });

  test('several people by the name: the model and the router name them and ask which; nobody by the name: the lookup says so', async () => {
    const model = scripted(
      [
        ['clew__findPerson', { name: 'Maria' }],
        ['clew__findPerson', { name: 'Olle' }],
      ],
      'Två av dina medarbetare heter Maria: Maria Eriksson och Maria Källström. Vem menar du?',
    );
    const w = world({ generate: model.generate });
    await rehab(w);
    const turn = await w.assistant.converse(hillevi, { text: 'Maria har varit sjuk i två veckor, vad gör jag?' });
    expect(model.handed[0]).toContain(
      '- "Maria" kan vara flera medarbetare: Maria Eriksson och Maria Källström. Fråga vem personen menar.',
    );
    expect(JSON.parse(model.handed[2]!)).toEqual({
      found: 'several',
      names: ['Maria Eriksson', 'Maria Källström'],
      note: 'Flera medarbetare heter så. Räkna upp namnen och fråga vem personen menar.',
    });
    // A name the asker never wrote is not looked up: "Olle" names nobody they mentioned.
    expect(JSON.parse(model.handed[3]!)).toMatchObject({ found: 'none' });
    expect(turn.thread.messages.at(-1)!.meta?.cards).toBeUndefined();
    // Without a model the router asks the same question back.
    const router = world();
    await rehab(router);
    const asked = await router.assistant.converse(hillevi, { text: 'Maria har varit sjuk i två veckor, vad gör jag?' });
    expect(asked).toMatchObject({ assistant: 'router', shape: 'svar' });
    expect(asked.answer.body).toBe(
      'Flera av dina medarbetare heter Maria: Maria Eriksson och Maria Källström. Vem menar du?',
    );
    // A name that is nobody's falls through to the router's reads, here the routine, never the figures.
    const nobody = await router.assistant.converse(hillevi, { text: 'Olle har varit sjuk i två veckor, vad gör jag?' });
    expect(nobody.view?.capability).toBe('hr.rehabRoutine');
    expect(nobody.answer.body).not.toContain('Sjukfrånvaro:');
  });

  test('without a model: the router answers with the open work item about the person, draws it, and never the figures', async () => {
    const w = world();
    const card = await rehab(w);
    const turn = await w.assistant.converse(hillevi, { text: QUESTION });
    expect(turn).toMatchObject({ assistant: 'router', shape: 'svar', answer: { source: 'Personalsystemet' } });
    expect(turn.answer.body).toBe(
      'Under Behöver dig finns ett öppet ärende om Anna Lindqvist: "Boka ett omtankesamtal med en medarbetare", senast måndag 16 november.',
    );
    expect(turn.thread.messages.at(-1)!.meta).toMatchObject({ cards: [card.id] });
    expect(w.store.audit.at(-1)).toMatchObject({
      action: 'conversation.asked',
      details: { assistant: 'router', tools: [], cards: [card.id] },
    });
    // A person with no open work: not the figures either; the router goes on to the reads.
    const erik = await w.assistant.converse(hillevi, { text: 'Erik har varit sjuk i två veckor, vad gör jag?' });
    expect(erik.answer.body).not.toMatch(/Sjukfrånvaro:|Läget/);
    expect(erik.thread.messages.at(-1)!.meta?.cards).toBeUndefined();
    // A question about the figures still gets the figure.
    const figure = await w.assistant.converse(hillevi, { text: 'hur ser sjukfrånvaron ut?' });
    expect(figure.answer.body).toBe('Sjukfrånvaro: 4,2 %, mål ≤ 4,0 % · +0,3 sedan oktober.');
    // An employee manages nobody: no name is resolved and no work is drawn.
    const employee = await w.assistant.converse(hassan, { text: QUESTION });
    expect(employee.thread.messages.at(-1)!.meta?.cards).toBeUndefined();
  });

  test('a work item about a person the conversation names is handed by title, last day and buttons alone, chipped or not, in this turn and the next', async () => {
    const model = scripted([], 'Svar.');
    const w = world({ generate: model.generate });
    const card = await rehab(w);
    const chip = { ref: 'thread:' + card.id, kind: 'thread' as const, label: card.title };
    // Without a name the chipped card is read as before: its summary and rows.
    await w.assistant.converse(hillevi, { text: 'Vad står det här?', chips: [chip] });
    expect(model.handed[0]).toContain('Namnet visas i personalsystemet');
    // With the person named, even in lower case, the same card is its title, last day and buttons.
    const first = await w.assistant.converse(hillevi, { text: 'anna har varit sjuk, vad gör jag?', chips: [chip] });
    const guarded = model.handed.at(-2)!;
    expect(guarded).toContain(
      '- Ärende "Boka ett omtankesamtal med en medarbetare" (Personalsystemet, senast måndag 16 november). Knappar i ärendet nu:',
    );
    for (const marker of HEALTH) expect(guarded).not.toContain(marker);
    // The next turn of the same conversation names nobody, and the card stays guarded: the asker named her before.
    await w.assistant.converse(hillevi, {
      text: 'Vad står det här?',
      chips: [chip],
      conversationId: first.conversationId,
    });
    for (const marker of HEALTH) expect(model.handed.at(-2)!).not.toContain(marker);
  });

  test('a card that names the person on the thread alone, as an action point does (D96 item 6), is guarded and never listed', async () => {
    const model = scripted([['clew__findPerson', { name: 'Anna' }]], 'Svar.');
    const w = world({ generate: model.generate });
    const card = await rehab(w);
    await w.store.transaction(tx =>
      tx.insertThread({
        id: 'point-1',
        personId: 'hillevi',
        kind: 'pushed',
        topic: 'talks:commitment:c1',
        title: 'Åtgärdspunkt från utvecklingssamtal',
        state: 'open',
        week: null,
        connector: 'calendar',
        area: 'talks',
        summary: 'Det ni kom överens om på samtalet.',
        items: [],
        subjects: [{ entity: 'person', key: 'anna' }],
        actions: [],
        waitingOn: null,
        deadline: '2026-11-20',
        trigger: { reason: 'Lades till efter ditt utvecklingssamtal', source: 'Utvecklingssamtal', at: T0 },
        createdAt: T0,
        updatedAt: T0,
      }),
    );
    const turn = await w.assistant.converse(hillevi, { text: QUESTION });
    expect(model.handed.join('\n')).not.toContain('Åtgärdspunkt');
    expect(JSON.parse(model.handed[2]!).workItems).toHaveLength(1);
    expect(turn.thread.messages.at(-1)!.meta?.cards).toEqual([card.id]);
    // Pointed at, it is read in full while nobody is named, and by its title alone once Anna is.
    const chip = { ref: 'thread:point-1', kind: 'thread' as const, label: 'Åtgärdspunkt från utvecklingssamtal' };
    await w.assistant.converse(hillevi, { text: 'Vad står det här?', chips: [chip] });
    expect(model.handed.at(-3)).toContain('Det ni kom överens om på samtalet.');
    await w.assistant.converse(hillevi, { text: QUESTION, chips: [chip] });
    expect(model.handed.at(-3)).toContain('- Ärende "Åtgärdspunkt från utvecklingssamtal" (Utvecklingssamtal');
    expect(model.handed.at(-3)).not.toContain('Det ni kom överens om på samtalet.');
  });
});
