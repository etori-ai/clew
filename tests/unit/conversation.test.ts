import { Registry } from '../registry';
import { describe, expect, test } from 'bun:test';
import type { AuthenticatedContext, Thread, TurnEvent } from '../../packages/contracts/src/index';
import { actorOf, type Connector } from '../../packages/connectors/src/index';
import { searchConnector } from '../../apps/server/src/modules/search/connector';
import { searchUsecases } from '../../apps/server/src/modules/search/usecases';
import { memoryState } from '../../packages/connectors/src/memory-state';
import { hrConnector } from '../../packages/connectors/src/mock/hr';
import { financeConnector } from '../../packages/connectors/src/mock/finance';
import { memoryCalendar, occurrence } from '../../packages/calendar/src/memory';
import { localInstant } from '../../packages/calendar/src/dates';
import { memoryThreadStore, memoryTimers } from '../../apps/server/src/threads/adapters/memory';
import { threadUsecases } from '../../apps/server/src/threads/usecases/cards';
import { reminderUsecases } from '../../apps/server/src/threads/usecases/reminders';
import { memoryObligations, memoryProposalStore } from '../../apps/server/src/modules/calendar/adapters/memory';
import { calendarUsecases } from '../../apps/server/src/modules/calendar/usecases/samtal';
import { assistantUsecases, TurnStopped } from '../../apps/server/src/assistant';
import { memoryModelHealth, memoryModelStore, memoryModelWire } from '../../apps/server/src/assistant/adapters/memory';
import { modelUsecases } from '../../apps/server/src/assistant/usecases/models';
import type { ModelGenerate } from '../../apps/server/src/assistant/model';
import { parseManifest, remoteConnector } from '../../packages/connectors/src/remote';
import { assertionFor, testJwks, testAuthority } from '../connector-authority';
import {
  createConnector as createTelefonbok,
  manifest as telefonbokManifest,
} from '../../connectors/telefonbok/connector.mjs';

/**
 * The conversation end to end (D8, D12, D25): the real router, verbs and prompt over the registry with mock
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
function world(options: { generate?: ModelGenerate; extra?: Connector[] } = {}) {
  const state = memoryState(),
    registry = new Registry();
  registry.register({ id: 'calendar', kind: 'core', source: 'Kalendern', areas: [], capabilities: [] });
  for (const m of [hrConnector(state), financeConnector(state), ...(options.extra ?? [])]) registry.register(m);
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
    bind: p => ({ provider: cal, members: p.role === 'manager' ? members : [] }),
    clock,
    ids,
    people: { personaFor: async () => undefined },
    notify: async () => undefined,
    obligations: memoryObligations(),
  });
  const timers = memoryTimers();
  const threads = threadUsecases({
    store,
    registry,
    run,
    calendar: { ...calendar, todayEvents: async () => [] },
    timers,
    clock,
    ids,
  });
  const reminders = reminderUsecases({ store, timers, clock });
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
    log: (...args: unknown[]) => {
      logged.push(args);
    },
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
    expect(budget.answer.body).toMatch(/^Budgetavvikelse: /);
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
    fail = true;
    const fallback = await w.assistant.converse(hillevi, { text: 'vem är på plats i dag?' });
    expect(fallback.assistant).toBe('unavailable');
    expect(fallback.model).toBeUndefined();
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
function telefonbok(): Connector {
  const secret = 'test-secret-test-secret',
    service = createTelefonbok({ jwks: testJwks, secret });
  return remoteConnector(parseManifest(telefonbokManifest, 'telefonbok'), {
    url: 'http://telefonbok',
    key: secret,
    assert: assertionFor('telefonbok', secret),
    fetch: (input, init) => service.handle(new Request(input, init)),
  });
}
describe('a declared view is the answer, with and without the model (D38)', () => {
  test("without the model: what was typed after the capability's name is the view's question; the turn stores a count, the view and its audit row, never a row", async () => {
    const w = world({ extra: [telefonbok()] });
    const r = await w.assistant.converse(hassan, { text: 'telefonboken lindqvist' });
    expect(r).toMatchObject({
      assistant: 'router',
      shape: 'vy',
      view: {
        capability: 'telefonbok.directory',
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
      details: { assistant: 'router', tools: ['telefonbok.directory'], view: 'telefonbok.directory' },
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
      view: { capability: 'telefonbok.team', input: {}, declared: true },
      answer: { body: 'Mitt teams kontaktlista: 5 rader.' },
    });
  });
  test("with the model: the tool runs for the person's view, the model is handed a count, and its answer carries the view", async () => {
    const handed: unknown[] = [];
    const generate: ModelGenerate = async ({ system, tools }) => {
      expect(system).toContain('resultatet visas i en vy');
      expect(Object.keys(tools)).toEqual(expect.arrayContaining(['telefonbok__directory', 'telefonbok__team']));
      const output = await (
        tools['telefonbok__directory'] as { execute: (input: unknown, options: unknown) => Promise<unknown> }
      ).execute({ query: 'lärare', scope: 'unit' }, {});
      handed.push(output);
      return {
        text: 'Två träffar på din enhet finns i vyn. Telefonboken 08:00.',
        toolCalls: [{ capability: 'telefonbok.directory', input: { query: 'lärare', scope: 'unit' }, output }],
      };
    };
    const w = world({ generate, extra: [telefonbok()] });
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
      view: { capability: 'telefonbok.directory', input: { query: 'lärare', scope: 'unit' }, declared: true },
    });
    expect(r.thread.messages[1]!.meta).toMatchObject({
      toolCalls: [{ capability: 'telefonbok.directory', input: { query: 'lärare', scope: 'unit' } }],
    });
    expect(w.store.audit.at(-1)).toMatchObject({
      action: 'conversation.asked',
      details: { assistant: 'model', tools: ['telefonbok.directory'], view: 'telefonbok.directory' },
    });
    expect(JSON.stringify([await w.store.readThread('hassan', r.conversationId), w.store.audit])).not.toMatch(
      /Anna|Hassan Ali|0980|070-/,
    );
  });
});
