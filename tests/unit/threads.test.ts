import { describe, expect, test } from 'bun:test';
import type { AuthenticatedContext, Thread } from '../../packages/contracts/src/index';
import { actorOf, Registry } from '../../packages/connectors/src/index';
import { memoryState } from '../../packages/connectors/src/memory-state';
import { heromaConnector } from '../../packages/connectors/src/mock/heroma';
import { raindanceConnector } from '../../packages/connectors/src/mock/raindance';
import { treservaConnector } from '../../packages/connectors/src/mock/treserva';
import { memoryThreadStore, memoryTimers } from '../../apps/server/src/threads/adapters/memory';
import { ATTENTION_BUDGET, threadUsecases, type ThreadDeps } from '../../apps/server/src/threads/usecases/cards';
import { reminderUsecases } from '../../apps/server/src/threads/usecases/reminders';

/**
 * The stream end to end without a server, a database or a timer service (D25): real mock connectors behind the real
 * registry, the memory store, a clock the test owns. What a person does on a card, what the store ends up holding,
 * and what the audit log says about it.
 */
const persona = (id: string, role: 'manager' | 'employee'): AuthenticatedContext => ({ id, name: id, unitId: 'unit-skola', unitLabel: 'Skönsmons skola', role,
  organisationId: 'sundsvall', principal: { id: 'person:' + id, kind: 'person' }, capabilities: [], authorizationVersion: 'v1', sessionBinding: 'test', expiresAt: '2099-01-01T00:00:00.000Z', async authorize() { return { version: 'v1' }; } });
const hillevi = persona('hillevi', 'manager'), hassan = persona('hassan', 'employee');
const T0 = '2026-11-04T07:00:00.000Z';
const MINUTE = 60_000;
function fakeClock(start = T0) {
  let now = Date.parse(start);
  const clock = () => new Date(now);
  return Object.assign(clock, { advance(ms: number) { now += ms; }, set(iso: string) { now = Date.parse(iso); } });
}
function world() {
  const state = memoryState(), registry = new Registry();
  for (const m of [heromaConnector(state), raindanceConnector(state), treservaConnector(state)]) registry.register(m);
  const store = memoryThreadStore(), clock = fakeClock();
  let n = 0;
  const calendar = { calls: [] as string[],
    async ensureProposalThread() { calendar.calls.push('ensure'); return undefined; },
    async replan(_p: AuthenticatedContext, threadId: string) { calendar.calls.push('replan'); return (await store.readThreadById(threadId))!; },
    async dismiss(_p: AuthenticatedContext, threadId: string) { calendar.calls.push('dismiss'); return (await store.readThreadById(threadId))!; } };
  const deps: ThreadDeps = { store, registry, run: (p, name, input) => registry.run(actorOf(p), name, input), calendar, clock, ids: () => `thread-${++n}` };
  const threads = threadUsecases(deps);
  const timers = memoryTimers();
  const reminders = reminderUsecases({ store, timers, clock });
  return { state, registry, store, clock, calendar, deps, threads, reminders, timers };
}
const actions = (store: ReturnType<typeof memoryThreadStore>, id: string) => store.audit.filter(e => e.subject === 'thread:' + id).map(e => e.action);
async function invoices(w: ReturnType<typeof world>) {
  await w.threads.ensureThreads(hillevi);
  return (await w.threads.listThreadsFor(hillevi)).find(t => t.topic === 'raindance:invoices')!;
}

describe('the scan', () => {
  test('pushes one card per draft in scope, with the source on the trigger and an audit row each', async () => {
    const w = world();
    await w.threads.ensureThreads(hillevi, 'Första besöket i dag');
    const mine = await w.threads.listThreadsFor(hillevi);
    expect(mine.length).toBeGreaterThan(1);
    const card = mine.find(t => t.topic === 'raindance:invoices')!;
    expect(card).toMatchObject({ kind: 'pushed', state: 'open', connector: 'raindance', area: 'budget', createdAt: T0, trigger: { source: 'Raindance', at: T0 } });
    expect(card.messages.map(m => m.body)).toEqual([card.summary]);
    expect(w.store.audit.filter(e => e.action === 'thread.pushed').map(e => e.details)).toContainEqual({ connector: 'raindance', topic: 'raindance:invoices', owner: 'hillevi' });
    expect(w.calendar.calls).toEqual(['ensure']);
    await w.threads.ensureThreads(hassan);
    expect((await w.threads.listThreadsFor(hassan)).some(t => t.connector === 'raindance')).toBe(false);
  });
  test('is idempotent: a second scan writes nothing when the source is unchanged', async () => {
    const w = world();
    await w.threads.ensureThreads(hillevi);
    const before = { threads: w.store.dump().length, audit: w.store.audit.length };
    w.clock.advance(60 * MINUTE);
    await w.threads.ensureThreads(hillevi);
    expect({ threads: w.store.dump().length, audit: w.store.audit.length }).toEqual(before);
  });
  test('refreshes an untouched card from its source and keeps the person\'s selection', async () => {
    const w = world();
    const card = await invoices(w);
    const [first, second] = card.items;
    expect(first!.selected).toBe(true);
    await w.store.transaction(tx => tx.updateThread(card.id, { items: card.items.map(i => i.ref === first!.ref ? { ...i, selected: false } : i) }));
    // One invoice is approved outside Clew: the next scan drops it from the card.
    await w.registry.run(hillevi, 'raindance.approve', { refs: [second!.ref] });
    await w.threads.ensureThreads(hillevi);
    const after = (await w.threads.threadFor(hillevi, card.id))!;
    expect(after.items.map(i => i.ref)).not.toContain(second!.ref);
    expect(after.items.find(i => i.ref === first!.ref)?.selected).toBe(false);
    expect(after.title).not.toBe(card.title);
    expect(actions(w.store, card.id)).toEqual(['thread.pushed', 'thread.refreshed']);
  });
  test('runs once per person at a time: two concurrent first visits push one set of cards', async () => {
    const w = world();
    await Promise.all([w.threads.ensureThreads(hillevi), w.threads.ensureThreads(hillevi)]);
    expect(w.calendar.calls).toEqual(['ensure']);
    const topics = (await w.threads.listThreadsFor(hillevi)).map(t => t.topic);
    expect(new Set(topics).size).toBe(topics.length);
  });
});

describe('a card action', () => {
  test('executes the capability with the selected refs, closes the card with a receipt and schedules the undo expiry', async () => {
    const w = world();
    const card = await invoices(w);
    const selected = card.items.filter(i => i.selected).map(i => i.ref);
    const result = await w.threads.act(hillevi, card.id, 'approve');
    expect(result.kind).toBe('execute');
    const thread = (result as { thread: Thread }).thread;
    expect(thread).toMatchObject({ state: 'handled', handledAt: T0, receipt: { at: T0, undoCapability: 'raindance.unapprove', undoUntil: new Date(Date.parse(T0) + 10 * MINUTE).toISOString() } });
    expect(thread.receipt!.rows.map(r => r.ref)).toEqual(selected);
    expect(thread.messages.slice(-2).map(m => [m.role, m.body])).toEqual([['user', 'Attestera valda'], ['assistant', thread.receipt!.headline]]);
    expect(w.store.audit.at(-1)).toMatchObject({ actor: 'person:hillevi', action: 'thread.acted', subject: 'thread:' + card.id, at: T0, details: { capability: 'raindance.approve', refs: selected } });
    expect(w.store.jobs).toEqual([{ id: `receipt-final:${card.id}:${Date.parse(T0)}`, kind: 'receipt-final', runAt: thread.receipt!.undoUntil!, payload: { threadId: card.id } }]);
    expect(await w.state.get('raindance', 'approved', {})).toMatchObject(Object.fromEntries(selected.map(ref => [ref, expect.any(String)])));
  });
  test('a read action returns its output and changes nothing', async () => {
    const w = world();
    const card = await invoices(w);
    const audit = w.store.audit.length;
    const result = await w.threads.act(hillevi, card.id, 'open');
    expect(result).toMatchObject({ kind: 'read', output: { url: expect.stringContaining('raindance.example.invalid') } });
    expect(w.store.audit.length).toBe(audit);
    expect((await w.threads.threadFor(hillevi, card.id))!.state).toBe('open');
  });
  test('refuses an unknown action, a stale ref, a handled card and another person\'s card', async () => {
    const w = world();
    const card = await invoices(w);
    await expect(w.threads.act(hillevi, card.id, 'nope')).rejects.toThrow('Okänd handling.');
    await expect(w.threads.act(hillevi, card.id, 'approve', ['raindance:inv:gone'])).rejects.toThrow('Något val är inte längre aktuellt. Läs om sidan.');
    await expect(w.threads.act(hassan, card.id, 'approve')).rejects.toThrow('Tråden finns inte.');
    await w.threads.act(hillevi, card.id, 'approve');
    await expect(w.threads.act(hillevi, card.id, 'approve')).rejects.toThrow('Tråden är redan hanterad.');
  });
  test('can be undone within the window and not after it', async () => {
    const w = world();
    const card = await invoices(w);
    await w.threads.act(hillevi, card.id, 'approve');
    w.clock.advance(9 * MINUTE);
    const reopened = await w.threads.undoReceipt(hillevi, card.id);
    expect(reopened).toMatchObject({ state: 'open', handledAt: null, receipt: null });
    expect(reopened.messages.slice(-2).map(m => m.body)).toEqual(['Ångra', 'Attesten är återtagen.']);
    expect(await w.state.get('raindance', 'approved', {})).toEqual({});
    expect(actions(w.store, card.id)).toEqual(['thread.pushed', 'thread.acted', 'thread.undone']);
    await w.threads.act(hillevi, card.id, 'approve');
    w.clock.advance(11 * MINUTE);
    await expect(w.threads.undoReceipt(hillevi, card.id)).rejects.toThrow('Ångerfönstret har gått ut.');
  });
  test('the scheduler closes the undo window: the receipt stays, Ångra goes', async () => {
    const w = world();
    const card = await invoices(w);
    await w.threads.closeReceiptWindow(card.id);
    expect(actions(w.store, card.id)).toEqual(['thread.pushed']);
    await w.threads.act(hillevi, card.id, 'approve');
    w.clock.advance(10 * MINUTE);
    await w.threads.closeReceiptWindow(card.id);
    const closed = (await w.threads.threadFor(hillevi, card.id))!;
    expect(closed.receipt).toMatchObject({ undoUntil: null, undoCapability: null, rows: expect.any(Array) });
    expect(w.store.audit.at(-1)).toMatchObject({ actor: 'system:scheduler', action: 'thread.receipt_final' });
    await expect(w.threads.undoReceipt(hillevi, card.id)).rejects.toThrow('Ångerfönstret har gått ut.');
  });
});

describe('avfärda, inte nu and ångra', () => {
  test('a dismissed card comes back within ten minutes, a snoozed one any time', async () => {
    const w = world();
    const card = await invoices(w);
    expect(await w.threads.dismissAny(hillevi, card.id)).toMatchObject({ state: 'dismissed', handledAt: T0 });
    w.clock.advance(10 * MINUTE);
    expect(await w.threads.reopenThread(hillevi, card.id)).toMatchObject({ state: 'open', handledAt: null });
    expect(await w.threads.snoozeThread(hillevi, card.id)).toMatchObject({ state: 'open', waitingOn: 'i morgon 06:00' });
    w.clock.advance(5 * 24 * 60 * MINUTE);
    expect(await w.threads.reopenThread(hillevi, card.id)).toMatchObject({ state: 'open', waitingOn: null });
    expect(actions(w.store, card.id)).toEqual(['thread.pushed', 'thread.dismissed', 'thread.reopened', 'thread.snoozed', 'thread.reopened']);
    expect(w.store.audit.filter(e => e.action === 'thread.reopened').map(e => e.details)).toEqual([{ from: 'dismissed' }, { from: 'snoozed' }]);
    expect(w.calendar.calls).toEqual(['ensure']);
  });
  test('a card dismissed more than ten minutes ago stays dismissed, an open card cannot be reopened', async () => {
    const w = world();
    const card = await invoices(w);
    await expect(w.threads.reopenThread(hillevi, card.id)).rejects.toThrow('Tråden går inte att återöppna.');
    await w.threads.dismissThread(hillevi, card.id, 'fel kostnadsställe');
    expect((await w.threads.threadFor(hillevi, card.id))!.messages.at(-1)!.body).toBe('Avfärdad · fel kostnadsställe');
    w.clock.advance(10 * MINUTE + 1);
    await expect(w.threads.reopenThread(hillevi, card.id)).rejects.toThrow('Ångerfönstret har gått ut.');
    await expect(w.threads.snoozeThread(hillevi, card.id)).rejects.toThrow('Tråden är redan hanterad.');
  });
});

describe('every mutation and its audit row', () => {
  test('are one transaction: when a write after the audit row fails, nothing of the mutation remains', async () => {
    const w = world();
    const card = await invoices(w);
    const audit = w.store.audit.length;
    const faulty = { ...w.store, transaction: <T,>(fn: (tx: Parameters<Parameters<typeof w.store.transaction>[0]>[0]) => Promise<T>) =>
      w.store.transaction(tx => fn({ ...tx, async scheduleJob() { throw new Error('job table away'); } })) };
    const threads = threadUsecases({ ...w.deps, store: faulty });
    await expect(threads.act(hillevi, card.id, 'approve')).rejects.toThrow('job table away');
    expect(await w.threads.threadFor(hillevi, card.id)).toMatchObject({ state: 'open', receipt: null, messages: card.messages });
    expect(w.store.audit.length).toBe(audit);
    expect(w.store.jobs).toEqual([]);
  });
  test('name the person as actor and the thread as subject, once per mutation', async () => {
    const w = world();
    const card = await invoices(w);
    const steps: Array<[string, () => Promise<unknown>]> = [
      ['thread.snoozed', () => w.threads.snoozeThread(hillevi, card.id)],
      ['thread.reopened', () => w.threads.reopenThread(hillevi, card.id)],
      ['thread.acted', () => w.threads.act(hillevi, card.id, 'approve')],
      ['thread.undone', () => w.threads.undoReceipt(hillevi, card.id)],
      ['thread.dismissed', () => w.threads.dismissThread(hillevi, card.id)],
      ['reminder.set', async () => { await w.threads.reopenThread(hillevi, card.id); return w.reminders.remind(hillevi, card.id, 600); }],
      ['reminder.cancelled', () => w.reminders.cancelReminder(hillevi, card.id, w.timers.started[0]!.workflowId)],
    ];
    for (const [action, step] of steps) {
      const before = w.store.audit.length;
      await step();
      const added = w.store.audit.slice(before).filter(e => e.action !== 'thread.reopened' || action === 'thread.reopened');
      expect(added.map(e => [e.action, e.actor, e.subject, e.at])).toEqual([[action, 'person:hillevi', 'thread:' + card.id, T0]]);
    }
  });
});

describe('attention and areas', () => {
  test('counts today\'s pushed cards against the budget', async () => {
    const w = world();
    expect(await w.threads.attentionFor(hillevi)).toEqual({ used: 0, budget: ATTENTION_BUDGET, bundledUntil: null });
    await w.threads.ensureThreads(hillevi);
    const used = (await w.threads.listThreadsFor(hillevi)).length;
    expect(await w.threads.attentionFor(hillevi)).toEqual({ used, budget: ATTENTION_BUDGET, bundledUntil: used >= ATTENTION_BUDGET ? 'i morgon 06:00' : null });
    w.clock.advance(24 * 60 * MINUTE);
    expect((await w.threads.attentionFor(hillevi)).used).toBe(0);
  });
  test('carries live counts and the worst attention level per area', async () => {
    const w = world();
    const card = await invoices(w);
    const budget = (await w.threads.listAreas(hillevi)).find(a => a.id === 'budget')!;
    expect(budget).toMatchObject({ needsYou: 1, waiting: 0, urgency: 'urgent' });
    await w.threads.snoozeThread(hillevi, card.id);
    expect((await w.threads.listAreas(hillevi)).find(a => a.id === 'budget')).toMatchObject({ needsYou: 0, waiting: 1, urgency: null });
  });
});

describe('påminn mig', () => {
  test('starts a timer, parks the card and audits; the timer id is the thread plus the request time', async () => {
    const w = world();
    const card = await invoices(w);
    const set = await w.reminders.remind(hillevi, card.id, 600);
    expect(set).toMatchObject({ id: `reminder:${card.id}:${Date.parse(T0)}`, fireAt: new Date(Date.parse(T0) + 10 * MINUTE).toISOString(), thread: { waitingOn: 'påminnelsen 08:10' } });
    expect(w.timers.started).toEqual([{ workflowId: set.id, personId: 'hillevi', threadId: card.id, title: card.title, area: 'budget', seconds: 600, requestedAt: T0 }]);
    expect(set.thread.messages.at(-1)!.body).toBe('Påminn mig 08:10');
    const cancelled = await w.reminders.cancelReminder(hillevi, card.id, set.id);
    expect(cancelled.waitingOn).toBeNull();
    expect(w.timers.cancelled).toEqual([set.id]);
    expect(actions(w.store, card.id)).toEqual(['thread.pushed', 'reminder.set', 'reminder.cancelled']);
  });
  test('leaves the card untouched when the timer service is away, and refuses bad input', async () => {
    const w = world();
    const card = await invoices(w);
    const reminders = reminderUsecases({ store: w.store, timers: memoryTimers({ available: false }), clock: w.clock });
    await expect(reminders.remind(hillevi, card.id, 600)).rejects.toThrow('Påminnelser är inte tillgängliga just nu.');
    expect((await w.threads.threadFor(hillevi, card.id))!.waitingOn).toBeNull();
    expect(actions(w.store, card.id)).toEqual(['thread.pushed']);
    await expect(w.reminders.remind(hillevi, card.id, 0)).rejects.toThrow('Ogiltig tid för påminnelsen.');
    await expect(w.reminders.remind(hillevi, card.id, 24 * 3600 + 1)).rejects.toThrow('Ogiltig tid för påminnelsen.');
    await expect(w.reminders.cancelReminder(hillevi, card.id, 'reminder:other:1')).rejects.toThrow('Okänd påminnelse.');
  });
});
