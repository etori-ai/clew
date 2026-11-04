import { describe, expect, test } from 'bun:test';
import type { AuthenticatedContext, Thread } from '../../packages/contracts/src/index';
import { actorOf, Registry } from '../../packages/connectors/src/index';
import { memoryState } from '../../packages/connectors/src/memory-state';
import { heromaConnector } from '../../packages/connectors/src/mock/heroma';
import { raindanceConnector } from '../../packages/connectors/src/mock/raindance';
import { memoryCalendar, occurrence } from '../../packages/calendar/src/memory';
import { localInstant } from '../../packages/calendar/src/dates';
import { memoryThreadStore, memoryTimers } from '../../apps/server/src/threads/adapters/memory';
import { threadUsecases } from '../../apps/server/src/threads/usecases/cards';
import { reminderUsecases } from '../../apps/server/src/threads/usecases/reminders';
import { memoryProposalStore } from '../../apps/server/src/modules/calendar/adapters/memory';
import { calendarUsecases } from '../../apps/server/src/modules/calendar/usecases/samtal';
import { assistantUsecases } from '../../apps/server/src/assistant';
import { memoryModelProvider } from '../../apps/server/src/assistant/adapters/memory';
import type { ModelGenerate } from '../../apps/server/src/assistant/model';

/**
 * The conversation end to end (D8, D12, D25): the real router, verbs and prompt over the registry with mock
 * connectors, the stream and the calendar over memory stores, and a model the test plays. Every turn ends in a
 * question thread with its audit row.
 */
const persona = (id: string, role: 'manager' | 'employee'): AuthenticatedContext => ({ id, name: id === 'hillevi' ? 'Hillevi Berg' : 'Hassan Ali', unitId: 'unit-skola', unitLabel: 'Skönsmons skola', role,
  organisationId: 'sundsvall', principal: { id: 'person:' + id, kind: 'person' }, capabilities: [], authorizationVersion: 'v1', sessionBinding: 'test', expiresAt: '2099-01-01T00:00:00.000Z', async authorize() { return { version: 'v1' }; } });
const hillevi = persona('hillevi', 'manager');
const T0 = '2026-11-04T07:00:00.000Z';
const account = { ref: 'memory:account:hillevi', email: 'hillevi@clew.test', name: 'Hillevi Berg' };
const members = ['Anna Lindqvist', 'Erik Sandström'].map(name => { const first = name.split(' ')[0]!.toLowerCase(); return { personId: first, ref: 'memory:account:' + first, email: first + '@clew.test', name }; });
function world(options: { generate?: ModelGenerate } = {}) {
  const state = memoryState(), registry = new Registry();
  for (const m of [heromaConnector(state), raindanceConnector(state)]) registry.register(m);
  const store = memoryThreadStore(), proposals = memoryProposalStore(), cal = memoryCalendar(account);
  cal.events.push(occurrence({ uid: 'apt', title: 'APT', start: localInstant('2026-11-04T10:00'), end: localInstant('2026-11-04T11:00') }, account));
  let time = Date.parse(T0), n = 0;
  const clock = () => new Date(time), ids = () => `id-${++n}`;
  const run = <O,>(p: AuthenticatedContext, name: string, input: unknown) => registry.run<O>(actorOf(p), name, input);
  const calendar = calendarUsecases({ store: proposals, bind: p => ({ provider: cal, members: p.role === 'manager' ? members : [] }), clock, ids });
  const threads = threadUsecases({ store, registry, run, calendar, clock, ids });
  const reminders = reminderUsecases({ store, timers: memoryTimers(), clock });
  const model = memoryModelProvider({ generate: options.generate });
  const logged: unknown[] = [];
  const deps = { store, registry, run, calendar, model, clock, ids, log: (...args: unknown[]) => { logged.push(args); } };
  const assistant = assistantUsecases(deps);
  return { store, proposals, cal, registry, threads, reminders, calendar, assistant, model, logged, deps, advance: (ms: number) => { time += ms; } };
}
const audit = (store: ReturnType<typeof memoryThreadStore>, id: string) => store.audit.filter(e => e.subject === 'thread:' + id).map(e => e.action);

describe('a question without the model', () => {
  test('is answered by the router, kept as a question thread and audited; a reply continues the same thread', async () => {
    const w = world();
    const first = await w.assistant.converse(hillevi, { text: 'visa fakturor' });
    expect(first).toMatchObject({ assistant: 'router', shape: 'vy', answer: { at: T0, source: 'Raindance' }, view: { capability: 'raindance.invoices' }, thread: { kind: 'question', topic: 'question', connector: 'startsidan', area: 'fragor', title: 'visa fakturor', state: 'open' } });
    expect(first.thread.messages.map(m => [m.role, m.body])).toEqual([['user', 'visa fakturor'], ['assistant', first.answer.body]]);
    expect(first.thread.messages[1]!.meta).toMatchObject({ shape: 'vy', assistant: 'router', source: 'Raindance', toolCalls: [{ capability: 'raindance.invoices' }] });
    expect(w.store.audit.at(-1)).toMatchObject({ actor: 'person:hillevi', action: 'conversation.asked', subject: 'thread:' + first.conversationId, at: T0, details: { assistant: 'router', tools: ['raindance.invoices'], view: 'raindance.invoices' } });
    w.advance(60_000);
    const second = await w.assistant.converse(hillevi, { text: 'xyzzy plugh', conversationId: first.conversationId });
    expect(second.conversationId).toBe(first.conversationId);
    expect(second.answer.body).toMatch(/^Det där kan jag inte svara på ännu/);
    expect(second.thread.messages).toHaveLength(4);
    expect(audit(w.store, first.conversationId)).toEqual(['conversation.asked', 'conversation.replied']);
    await expect(w.assistant.converse(hillevi, { text: 'x', conversationId: 'nope' })).rejects.toThrow('Samtalet finns inte.');
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
    expect(completions.ask.map(a => a.capability)).toContain('heroma.whoIsOn');
    expect(completions.completions.slice(0, 2)).toEqual(['Vad har jag i dag?', 'Hur ligger vi till med utvecklingssamtalen?']);
    expect(completions.do).toEqual([]); // the mock areas list only reads under Gör själv
    expect(completions.recent).toEqual([]);
    await w.assistant.ask(hillevi, 'Vad har jag i dag?');
    expect((await w.assistant.completionsFor(hillevi)).recent.map(r => r.title)).toEqual(['Vad har jag i dag?']);
    const objects = await w.assistant.listObjects(hillevi, '');
    expect(objects.filter(o => o.kind === 'thread').map(o => o.label)).toContain((await w.threads.listThreadsFor(hillevi)).find(t => t.topic === 'raindance:invoices')!.title);
    expect(objects.some(o => o.kind === 'event' && o.label === 'APT')).toBe(true);
    expect((await w.assistant.listObjects(hillevi, 'lekolar')).every(o => /lekolar/i.test(o.label + o.detail))).toBe(true);
    expect(w.assistant.status()).toEqual({ configured: false, available: false, model: null, checkedAt: null });
  });
});

describe('a chipped card', () => {
  async function invoices(w: ReturnType<typeof world>) {
    await w.threads.ensureThreads(hillevi);
    return (await w.threads.listThreadsFor(hillevi)).find(t => t.topic === 'raindance:invoices')!;
  }
  const chip = (t: Thread) => [{ ref: 'thread:' + t.id, kind: 'thread' as const, label: t.title }];
  test('proposes Clew actions instead of acting, and answers why', async () => {
    const w = world();
    const card = await invoices(w);
    const dismiss = await w.assistant.converse(hillevi, { text: 'avfärda det', chips: chip(card) });
    expect(dismiss.clewActions).toEqual([{ n: 1, kind: 'dismiss', threadId: card.id, label: `Avfärda "${card.title}"` }]);
    expect(dismiss.verbs?.map(v => v.kind)).toContain('snooze');
    expect((await w.threads.threadFor(hillevi, card.id))!.state).toBe('open');
    const why = await w.assistant.converse(hillevi, { text: 'varför ser jag detta?', chips: chip(card) });
    expect(why.answer).toMatchObject({ source: 'Raindance', body: expect.stringContaining('Varför nu? ' + card.trigger.reason) });
    expect(why.thread.messages[0]!.meta).toEqual({ chips: chip(card), refs: ['thread:' + card.id] });
    await expect(w.assistant.converse(hillevi, { text: 'x', chips: [{ ref: 'thread:gone', kind: 'thread', label: 'x' }] })).rejects.toThrow('Något du pekade på finns inte längre.');
  });
  test('"bara …" drafts the selection on the card with its own audit row; the button on the card still sends', async () => {
    const w = world();
    const card = await invoices(w);
    const draft = await w.assistant.converse(hillevi, { text: 'attestera bara Lekolar', chips: chip(card) });
    expect(draft.shape).toBe('forslag');
    expect(draft.draft).toMatchObject({ kind: 'select', threadId: card.id });
    const after = (await w.threads.threadFor(hillevi, card.id))!;
    expect(after.items.map(i => [i.label.split(' · ')[0], i.selected])).toEqual(card.items.map(i => [i.label.split(' · ')[0], i.label.startsWith('Lekolar')]));
    expect(after.messages.at(-1)).toMatchObject({ role: 'assistant', body: expect.stringMatching(/^Utkast: 2 av 3 valda/), meta: { draft: { kind: 'select', threadId: card.id } } });
    expect(audit(w.store, card.id)).toEqual(['thread.pushed', 'thread.drafted']);
    expect(after.state).toBe('open');
  });
  test('a reply in a card is one chipped turn copied into the card', async () => {
    const w = world();
    const card = await invoices(w);
    const replied = await w.assistant.reply(hillevi, card.id, 'varför ser jag detta?');
    expect(replied.messages.slice(-2).map(m => [m.role, m.body.startsWith('Varför nu?')])).toEqual([['user', false], ['assistant', true]]);
    expect(audit(w.store, card.id)).toEqual(['thread.pushed', 'thread.replied']);
    expect(w.store.audit.filter(e => e.action === 'conversation.asked')).toHaveLength(1);
  });
  test('"nästa vecka i stället" on the proposal card redraws it through the calendar', async () => {
    const w = world();
    const samtal = (await w.calendar.ensureProposalThread(hillevi))!;
    // In production the stream and the calendar share one database; here the assistant's store also sees the calendar's threads.
    const assistant = assistantUsecases({ ...w.deps, store: { ...w.store, readThread: async (p, id) => (await w.proposals.readThread(p, id))?.thread ?? w.store.readThread(p, id) } });
    const turn = await assistant.converse(hillevi, { text: 'nästa vecka i stället', chips: [{ ref: 'thread:' + samtal.id, kind: 'thread', label: samtal.title }] });
    expect(turn.draft).toMatchObject({ kind: 'replan', threadId: samtal.id, week: '2026-11-16', thread: { week: '2026-11-16' } });
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
      const output = await (tools['heroma__whoIsOn'] as { execute: (input: unknown, options: unknown) => Promise<unknown> }).execute({}, {});
      return { text: 'Tre på plats. Heroma 08:00.', toolCalls: [{ capability: 'heroma.whoIsOn', input: {}, output }] };
    };
    const w = world({ generate });
    const turn = await w.assistant.converse(hillevi, { text: 'vem är här?' });
    expect(turn).toMatchObject({ assistant: 'model', answer: { body: 'Tre på plats. Heroma 08:00.', source: 'Heroma' } });
    expect(generated[0]).toContain('onsdag 4 november 2026, klockan 08:00, vecka 45');
    expect(generated).toContain('heroma__whoIsOn');
    expect(generated.some(g => g.includes('approve'))).toBe(false);
    expect(w.store.audit.at(-1)).toMatchObject({ action: 'conversation.asked', details: { assistant: 'model', tools: ['heroma.whoIsOn'] } });
    fail = true;
    const fallback = await w.assistant.converse(hillevi, { text: 'vem är på plats i dag?' });
    expect(fallback.assistant).toBe('unavailable');
    expect(w.assistant.status()).toMatchObject({ configured: true, available: false, model: 'test-model' });
    expect(w.logged).toHaveLength(1);
    w.model.markAvailable();
    fail = false;
    expect((await w.assistant.converse(hillevi, { text: 'vem är här?' })).assistant).toBe('model');
  });
});
