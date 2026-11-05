import { Registry } from '../registry';
import { describe, expect, test } from 'bun:test';
import type { AuthenticatedContext, Thread } from '../../packages/contracts/src/index';
import { actorOf, type Connector } from '../../packages/connectors/src/index';
import { memoryState } from '../../packages/connectors/src/memory-state';
import { heromaConnector } from '../../packages/connectors/src/mock/heroma';
import { raindanceConnector } from '../../packages/connectors/src/mock/raindance';
import { treservaConnector } from '../../packages/connectors/src/mock/treserva';
import { memoryThreadStore, memoryTimers } from '../../apps/server/src/threads/adapters/memory';
import { ATTENTION_BUDGET, threadUsecases, type ThreadDeps } from '../../apps/server/src/threads/usecases/cards';
import { reminderUsecases } from '../../apps/server/src/threads/usecases/reminders';
import { searchConnector } from '../../apps/server/src/modules/search/connector';
import { searchUsecases } from '../../apps/server/src/modules/search/usecases';

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
  registry.register({ id: 'calendar', kind: 'core', source: 'Kalendern', areas: [], capabilities: [] });
  const store = memoryThreadStore(), clock = fakeClock();
  for (const m of [heromaConnector(state), raindanceConnector(state), treservaConnector(state), searchConnector(searchUsecases({ sources: a => registry.searchSources(a), clock }))]) registry.register(m);
  let n = 0;
  const calendar = { calls: [] as string[], today: [] as Array<{ title: string; end: string }>,
    async ensureProposalThread() { calendar.calls.push('ensure'); return undefined; },
    async replan(_p: AuthenticatedContext, threadId: string) { calendar.calls.push('replan'); return (await store.readThreadById(threadId))!; },
    async dismiss(_p: AuthenticatedContext, threadId: string) { calendar.calls.push('dismiss'); return (await store.readThreadById(threadId))!; },
    async todayEvents() { return calendar.today; } };
  const timers = memoryTimers();
  const deps: ThreadDeps = { store, registry, run: (p, name, input) => registry.run(actorOf(p), name, input), calendar, timers, clock, ids: () => `thread-${++n}` };
  const threads = threadUsecases(deps);
  const reminders = reminderUsecases({ store, timers, clock });
  return { state, registry, store, clock, calendar, deps, threads, reminders, timers };
}
const actions = (store: ReturnType<typeof memoryThreadStore>, id: string) => store.audit.filter(e => e.subject === 'thread:' + id).map(e => e.action);
async function invoices(w: ReturnType<typeof world>) {
  await w.threads.ensureThreads(hillevi);
  return (await w.threads.listThreadsFor(hillevi)).find(t => t.topic === 'raindance:invoices')!;
}

describe('the scan', () => {
  test('a disabled calendar cannot be scanned through the legacy proposal path', async () => {
    const w = world();
    w.registry.govern('calendar', { ...w.registry.governance('calendar'), state: 'disabled' });
    await w.threads.ensureThreads(hillevi);
    expect(w.calendar.calls).toEqual([]);
  });
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

describe('a card is one system\'s (D35)', () => {
  /** A connector that breaks the rule twice: one draft carries Raindance's execute, and its own execute names Raindance's undo. */
  const rogue = (): Connector => ({
    id: 'rogue', kind: 'passthrough', source: 'Rogue', areas: [{ id: 'rogue', title: 'Rogue', roles: ['manager'], standing: [], schedules: [] }],
    capabilities: [{ name: 'rogue.close', kind: 'execute', title: 'Stäng', description: 'Stänger ärenden.', input: {} as never, output: {} as never, model: false, scope: () => true,
      run: async (_actor, input: { refs: string[] }) => ({ headline: 'Stängt.', rows: input.refs.map(ref => ({ ref, label: ref, outcome: 'done', detail: 'stängt' })), undoCapability: 'raindance.unapprove', undoMinutes: 10 }) }],
    scan: async () => ['own', 'foreign'].map(topic => ({ topic: 'rogue:' + topic, area: 'rogue', title: 'Ärende 1', summary: 'Ett ärende väntar.', reason: 'test',
      items: [{ ref: 'rogue:1', label: 'Ärende 1', detail: '', selectable: true, selected: true }],
      actions: [{ id: 'go', label: 'Stäng', capability: topic === 'own' ? 'rogue.close' : 'raindance.approve', kind: 'execute', role: 'primary', usesItems: true }] })),
  });
  const withRogue = () => { const w = world(); w.registry.register(rogue()); return w; };
  test('the scan pushes only drafts whose buttons are the connector\'s own; a refused draft leaves no card and no audit row', async () => {
    const w = withRogue();
    await w.threads.ensureThreads(hillevi);
    const topics = (await w.threads.listThreadsFor(hillevi)).map(t => t.topic);
    expect(topics).toContain('rogue:own');
    expect(topics).not.toContain('rogue:foreign');
    expect(w.store.audit.filter(e => e.action === 'thread.pushed').map(e => e.details?.topic)).not.toContain('rogue:foreign');
  });
  test('an undo naming another connector is dropped: the receipt stands without Ångra, and the audit row names what was refused', async () => {
    const w = withRogue();
    await w.threads.ensureThreads(hillevi);
    const card = (await w.threads.listThreadsFor(hillevi)).find(t => t.topic === 'rogue:own')!;
    const thread = (await w.threads.act(hillevi, card.id, 'go') as { thread: Thread }).thread;
    expect(thread).toMatchObject({ state: 'handled', receipt: { headline: 'Stängt.', undoCapability: null, undoUntil: null } });
    expect(w.store.audit.at(-1)).toMatchObject({ actor: 'person:hillevi', action: 'thread.acted', subject: 'thread:' + card.id, details: { capability: 'rogue.close', undoUntil: null, undoRefused: 'raindance.unapprove' } });
    expect(w.store.jobs).toEqual([]);
    await expect(w.threads.undoReceipt(hillevi, card.id)).rejects.toThrow('Ångerfönstret har gått ut.');
  });
  test('a stored card whose button names another connector is refused and runs nothing', async () => {
    const w = world();
    const card = await invoices(w);
    await w.store.transaction(tx => tx.updateThread(card.id, { actions: [...card.actions, { id: 'foreign', label: 'Godkänn', capability: 'heroma.decideLeave', kind: 'execute', role: 'overflow', usesItems: true, input: { decision: 'approve' } }] }));
    const audit = w.store.audit.length, heroma = await w.state.get('heroma', 'leave-decisions', {});
    await expect(w.threads.act(hillevi, card.id, 'foreign')).rejects.toThrow('Knappen hör inte till kortets källa och kan inte användas.');
    expect(w.store.audit.length).toBe(audit);
    expect(await w.state.get('heroma', 'leave-decisions', {})).toEqual(heroma);
    expect((await w.threads.threadFor(hillevi, card.id))!.state).toBe('open');
  });
  test('a stored card that calls an execute a read still gets its receipt, its audit row and its undo window', async () => {
    const w = world();
    const card = await invoices(w);
    await w.store.transaction(tx => tx.updateThread(card.id, { actions: card.actions.map(a => a.id === 'approve' ? { ...a, kind: 'read' as const } : a) }));
    const result = await w.threads.act(hillevi, card.id, 'approve');
    expect(result.kind).toBe('execute');
    expect((result as { thread: Thread }).thread).toMatchObject({ state: 'handled', receipt: { undoCapability: 'raindance.unapprove' } });
    expect(actions(w.store, card.id)).toEqual(['thread.pushed', 'thread.acted']);
    expect(w.store.jobs.map(j => j.kind)).toEqual(['receipt-final']);
  });
});

describe('avfärda, inte nu and ångra', () => {
  test('a dismissed card comes back within ten minutes, a snoozed one any time', async () => {
    const w = world();
    const card = await invoices(w);
    expect(await w.threads.dismissAny(hillevi, card.id)).toMatchObject({ state: 'dismissed', handledAt: T0 });
    w.clock.advance(10 * MINUTE);
    expect(await w.threads.reopenThread(hillevi, card.id)).toMatchObject({ state: 'open', handledAt: null });
    expect(await w.threads.snoozeThread(hillevi, card.id)).toMatchObject({ state: 'open', waitingOn: null, snoozedUntil: '2026-11-05T05:00:00.000Z' });
    w.clock.advance(5 * 24 * 60 * MINUTE);
    expect(await w.threads.reopenThread(hillevi, card.id)).toMatchObject({ state: 'open', snoozedUntil: null });
    expect(actions(w.store, card.id)).toEqual(['thread.pushed', 'thread.dismissed', 'thread.reopened', 'thread.snoozed', 'thread.reopened']);
    expect(w.store.audit.filter(e => e.action === 'thread.reopened').map(e => e.details)).toEqual([{ from: 'dismissed' }, { from: 'snoozed' }]);
    expect(w.calendar.calls).toEqual(['ensure']);
  });
  test('a snoozed card wakes when its time passes, with an audit row saying so', async () => {
    const w = world();
    const card = await invoices(w);
    const snoozed = await w.threads.snoozeThread(hillevi, card.id);
    expect(snoozed.snoozedUntil).toBe('2026-11-05T05:00:00.000Z');
    expect(snoozed.messages.at(-1)!.body).toBe('Inte nu · i morgon 06:00');
    // A silent timer for the open page; the sweep is the guarantee.
    expect(w.timers.started).toEqual([{ workflowId: `snooze:${card.id}:${Date.parse('2026-11-05T05:00:00.000Z')}`, personId: 'hillevi', threadId: card.id, title: card.title, area: 'budget', seconds: 22 * 3600, requestedAt: T0, silent: true }]);
    w.clock.advance(60 * MINUTE);
    expect((await w.threads.listThreadsFor(hillevi)).find(t => t.id === card.id)?.snoozedUntil).toBe('2026-11-05T05:00:00.000Z');
    w.clock.set('2026-11-05T05:00:00.000Z');
    expect((await w.threads.listThreadsFor(hillevi)).find(t => t.id === card.id)?.snoozedUntil).toBeNull();
    expect(actions(w.store, card.id)).toEqual(['thread.pushed', 'thread.snoozed', 'thread.woken']);
    expect(w.store.audit.at(-1)?.details).toEqual({ reason: 'time', snoozedUntil: '2026-11-05T05:00:00.000Z' });
  });
  test('a snoozed card wakes early when its source changes (the snooze breaks on activity)', async () => {
    const w = world();
    const card = await invoices(w);
    await w.threads.snoozeThread(hillevi, card.id);
    await w.registry.run(hillevi, 'raindance.approve', { refs: [card.items[1]!.ref] });
    await w.threads.ensureThreads(hillevi);
    const after = (await w.threads.threadFor(hillevi, card.id))!;
    expect(after.snoozedUntil).toBeNull();
    expect(actions(w.store, card.id)).toEqual(['thread.pushed', 'thread.snoozed', 'thread.refreshed', 'thread.woken']);
    expect(w.store.audit.at(-1)?.details).toMatchObject({ reason: 'changed' });
    expect(w.timers.cancelled).toEqual([`snooze:${card.id}:${Date.parse('2026-11-05T05:00:00.000Z')}`]);
  });
  test('the picker (D29): a preset, free text or an instant sets the time; the rows carry their resolved times', async () => {
    const w = world();
    w.calendar.today = [{ title: 'Ledningsgrupp', end: '2026-11-04T10:30:00.000Z' }, { title: 'Lunch', end: '2026-11-04T11:30:00.000Z' }];
    const card = await invoices(w);
    const presets = await w.threads.snoozeOptions(hillevi);
    expect(presets.map(p => [p.id, p.at, p.detail])).toEqual([
      ['hour', '2026-11-04T08:00:00.000Z', '09:00'],
      ['lunch', '2026-11-04T12:00:00.000Z', '13:00'],
      ['tomorrow', '2026-11-05T05:00:00.000Z', '06:00 · i genomgången'],
      ['week', '2026-11-09T05:00:00.000Z', 'mån 9 nov 06:00'],
      ['meeting', '2026-11-04T10:30:00.000Z', '11:30 · från kalendern'],
    ]);
    expect(presets[4]!.label).toBe('När jag är tillbaka från Ledningsgrupp');
    expect((await w.threads.snoozeThread(hillevi, card.id, { preset: 'lunch' })).snoozedUntil).toBe('2026-11-04T12:00:00.000Z');
    expect((await w.threads.snoozeThread(hillevi, card.id, { text: 'fredag kl 9' })).snoozedUntil).toBe('2026-11-06T08:00:00.000Z');
    expect((await w.threads.snoozeThread(hillevi, card.id, { until: '2026-11-04T15:00:00.000Z' })).messages.at(-1)!.body).toBe('Inte nu · kl 16:00');
    await expect(w.threads.snoozeThread(hillevi, card.id, { text: 'när grisarna flyger' })).rejects.toThrow('Jag förstod inte tiden.');
    await expect(w.threads.snoozeThread(hillevi, card.id, { preset: 'aldrig' })).rejects.toThrow('Okänt förval.');
    await expect(w.threads.snoozeThread(hillevi, card.id, { until: '2026-11-04T06:00:00.000Z' })).rejects.toThrow('Tiden har redan passerat.');
    await expect(w.threads.snoozeThread(hillevi, card.id, { until: '2026-12-20T06:00:00.000Z' })).rejects.toThrow('Högst 30 dagar framåt.');
    expect(w.store.audit.filter(e => e.action === 'thread.snoozed').map(e => e.details)).toEqual([
      expect.objectContaining({ preset: 'lunch', timer: 'started' }), expect.objectContaining({ text: 'fredag kl 9' }), expect.objectContaining({ until: '2026-11-04T15:00:00.000Z' })]);
  });
  test('a silent timer wakes the card without a badge; one that was woken earlier or re-snoozed does nothing', async () => {
    const w = world();
    const card = await invoices(w);
    await w.threads.snoozeThread(hillevi, card.id, { until: '2026-11-04T09:00:00.000Z' });
    const fired = { personId: 'hillevi', threadId: card.id, title: card.title, area: card.area, seconds: 2 * 3600, requestedAt: T0, silent: true };
    w.clock.set('2026-11-04T09:00:00.000Z');
    expect(await w.reminders.surface(fired)).toBe('surfaced');
    const back = (await w.threads.threadFor(hillevi, card.id))!;
    expect(back).toMatchObject({ state: 'open', snoozedUntil: null, remindedAt: null });
    expect(back.trigger.reason).toBe(card.trigger.reason);
    expect(w.store.audit.at(-1)).toMatchObject({ actor: 'assistant:reminder', action: 'thread.woken', details: { reason: 'time' } });
    expect(await w.reminders.surface(fired)).toBe('skipped');
    await w.threads.snoozeThread(hillevi, card.id, { until: '2026-11-04T12:00:00.000Z' });
    expect(await w.reminders.surface(fired)).toBe('skipped');
    expect((await w.threads.threadFor(hillevi, card.id))!.snoozedUntil).toBe('2026-11-04T12:00:00.000Z');
  });
  test('a snooze still lands when the timer service is away', async () => {
    const w = world();
    const card = await invoices(w);
    const threads = threadUsecases({ ...w.deps, timers: memoryTimers({ available: false }) });
    expect((await threads.snoozeThread(hillevi, card.id)).snoozedUntil).toBe('2026-11-05T05:00:00.000Z');
    expect(w.store.audit.at(-1)?.details).toMatchObject({ timer: 'unavailable' });
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
      ['reminder.cancelled', () => w.reminders.cancelReminder(hillevi, card.id, w.timers.started.at(-1)!.workflowId)],
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
  test('a scan outside the review counts as one interruption against the budget, however many cards it brings', async () => {
    const w = world();
    expect(await w.threads.attentionFor(hillevi)).toMatchObject({ used: 0, budget: ATTENTION_BUDGET, bundledUntil: null });
    await w.threads.ensureThreads(hillevi);
    expect((await w.threads.listThreadsFor(hillevi)).filter(t => t.kind === 'pushed').length).toBeGreaterThan(1);
    expect(await w.threads.attentionFor(hillevi)).toMatchObject({ used: 1, budget: ATTENTION_BUDGET, bundledUntil: null });
    w.clock.advance(24 * 60 * MINUTE);
    expect((await w.threads.attentionFor(hillevi)).used).toBe(0);
  });
  test('draws the day as one track with the cards a scan pushed folded into one moment', async () => {
    const w = world();
    await w.threads.ensureThreads(hillevi);
    const pushed = (await w.threads.listThreadsFor(hillevi)).filter(t => t.kind === 'pushed');
    const { rhythm } = await w.threads.attentionFor(hillevi);
    expect(rhythm.map(p => p.kind)).toEqual<string[]>(['review', 'interruption', 'bundle', 'bundle', 'quiet']);
    expect(rhythm.map(p => p.state)).toEqual<string[]>(['done', 'done', 'next', 'later', 'later']);
    expect(rhythm[1]).toMatchObject({ at: '08:00', count: pushed.length });
    expect(pushed.map(t => t.title)).toContain(rhythm[1]!.title ?? '');
  });
  test('carries live counts and the worst attention level per area', async () => {
    const w = world();
    const card = await invoices(w);
    const budget = (await w.threads.listAreas(hillevi)).find(a => a.id === 'budget')!;
    expect(budget).toMatchObject({ needsYou: 1, waiting: 0, urgency: 'urgent' });
    await w.threads.snoozeThread(hillevi, card.id);
    expect((await w.threads.listAreas(hillevi)).find(a => a.id === 'budget')).toMatchObject({ needsYou: 0, waiting: 0, urgency: null });
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
  test('when the timer fires the card comes back once, reopened and marked, with the reason on its trigger', async () => {
    const w = world();
    const card = await invoices(w);
    const set = await w.reminders.remind(hillevi, card.id, 600);
    await w.threads.dismissThread(hillevi, card.id);
    w.clock.advance(10 * MINUTE);
    const fired = { personId: 'hillevi', threadId: card.id, title: card.title, area: card.area, seconds: 600, requestedAt: T0 };
    expect(await w.reminders.surface(fired)).toBe('surfaced');
    const back = (await w.threads.threadFor(hillevi, card.id))!;
    const at = new Date(Date.parse(T0) + 10 * MINUTE).toISOString();
    expect(back).toMatchObject({ state: 'open', handledAt: null, waitingOn: null, remindedAt: at, trigger: { reason: `Du bad 08:00 om en påminnelse · ${card.trigger.reason}`, source: card.trigger.source, at } });
    expect(back.messages.at(-1)!.body).toBe('Påminnelse: du bad 08:00 om att få det här kortet igen.');
    expect(w.store.audit.at(-1)).toMatchObject({ actor: 'assistant:reminder', action: 'thread.reminded', subject: 'thread:' + card.id, at, details: { requestedAt: T0, seconds: 600, wasState: 'dismissed', owner: 'hillevi' } });
    // A retried activity finds remindedAt at the fire time already and does nothing; a stranger's id never matches.
    expect(await w.reminders.surface(fired)).toBe('skipped');
    expect(await w.reminders.surface({ ...fired, personId: 'hassan' })).toBe('skipped');
    expect(w.store.audit.filter(e => e.action === 'thread.reminded')).toHaveLength(1);
    // A card handled with a receipt is left alone: the work is done.
    await w.threads.act(hillevi, card.id, 'approve');
    expect(await w.reminders.surface({ ...fired, requestedAt: at })).toBe('skipped');
    expect((await w.threads.threadFor(hillevi, card.id))!.state).toBe('handled');
    void set;
  });
  test('leaves the card untouched when the timer service is away, and refuses bad input', async () => {
    const w = world();
    const card = await invoices(w);
    const reminders = reminderUsecases({ store: w.store, timers: memoryTimers({ available: false }), clock: w.clock });
    await expect(reminders.remind(hillevi, card.id, 600)).rejects.toThrow('Påminnelser är inte tillgängliga just nu.');
    expect((await w.threads.threadFor(hillevi, card.id))!.waitingOn).toBeNull();
    expect(actions(w.store, card.id)).toEqual(['thread.pushed']);
    await expect(w.reminders.remind(hillevi, card.id, 0)).rejects.toThrow('Ogiltig tid för påminnelsen.');
    await expect(w.reminders.remind(hillevi, card.id, 30 * 24 * 3600 + 1)).rejects.toThrow('Ogiltig tid för påminnelsen.');
    await expect(w.reminders.cancelReminder(hillevi, card.id, 'reminder:other:1')).rejects.toThrow('Okänd påminnelse.');
  });
});

describe('a cited answer becomes a card (D26)', () => {
  const sources = [
    { n: 1, ref: 'document:docs:fall-2', label: 'Rutin vid fall i ordinärt boende', source: 'Intranätet', stale: false, link: 'https://intra/fall', section: 'Vid fall', owner: 'MAS', reviewedAt: '2026-03-12T00:00:00.000Z' },
    { n: 2, ref: 'document:eneo:lathund', label: 'Lathund: avvikelser', source: 'Eneo', stale: true, reviewedAt: '2024-11-02T00:00:00.000Z' },
  ];
  async function conversation(w: ReturnType<typeof world>, withSources = true) {
    const at = w.clock().toISOString();
    await w.store.transaction(async tx => {
      await tx.insertThread({ id: 'q1', personId: 'hassan', kind: 'question', topic: 'question', title: 'Brukaren har ramlat, vad gör jag?', state: 'open', week: null, connector: 'clew', area: 'fragor', summary: 'svar', items: [], actions: [], waitingOn: null, deadline: null, trigger: { reason: 'Du ställde en fråga', source: 'Startsidan', at }, createdAt: at, updatedAt: at });
      await tx.addMessage('q1', { role: 'user', body: 'Brukaren har ramlat, vad gör jag?', at });
      await tx.addMessage('q1', { role: 'assistant', body: '1. Lyft inte själv [1].\n2. Skriv avvikelse [2].', at, meta: { shape: 'steg', access: { connectors: [], capabilities: [], authorizationVersion: hassan.authorizationVersion }, ...(withSources ? { sources } : {}) } });
      await tx.writeAudit({ actor: 'person:hassan', action: 'conversation.asked', subject: 'thread:q1', at });
    });
    return (await w.store.readThread('hassan', 'q1'))!;
  }
  test('the card carries the sources as rows and the first link as its button; a second click returns the same card', async () => {
    const w = world();
    const q = await conversation(w);
    const answerId = q.messages[1]!.id;
    const { threadId } = await w.threads.cardFromAnswer(hassan, { conversationId: 'q1', messageId: answerId });
    const card = (await w.threads.threadFor(hassan, threadId))!;
    expect(card).toMatchObject({ kind: 'pushed', state: 'open', connector: 'clew', area: 'fragor', topic: 'answer:' + answerId, title: 'Följ upp: Brukaren har ramlat, vad gör jag?', summary: '1. Lyft inte själv [1].\n2. Skriv avvikelse [2].',
      trigger: { source: 'Startsidan', reason: 'Du frågade 08:00 och gjorde svaret till ett kort' } });
    expect(card.items).toEqual([
      { ref: 'document:docs:fall-2', label: '[1] Rutin vid fall i ordinärt boende · Vid fall', detail: 'MAS · granskad 2026-03-12 · Intranätet', selectable: false, selected: false },
      { ref: 'document:eneo:lathund', label: '[2] Lathund: avvikelser', detail: 'granskad 2024-11-02 · Eneo', selectable: false, selected: false },
    ]);
    expect(card.actions).toEqual([{ id: 'open', label: 'Öppna källan', capability: 'clew.openSource', kind: 'read', role: 'primary', target: 'link', input: { ref: 'docs:fall-2' } }]);
    expect(actions(w.store, threadId)).toEqual(['thread.fromAnswer']);
    expect(w.store.audit.at(-1)).toMatchObject({ actor: 'person:hassan', action: 'thread.fromAnswer', details: { conversation: 'q1', message: answerId, sources: ['document:docs:fall-2', 'document:eneo:lathund'] } });
    expect(JSON.stringify(w.store.audit)).not.toContain('Lyft inte själv');
    expect(await w.threads.cardFromAnswer(hassan, { conversationId: 'q1', messageId: answerId })).toEqual({ threadId });
    expect((await w.threads.listThreadsFor(hassan)).filter(t => t.topic === 'answer:' + answerId)).toHaveLength(1);
  });
  test('refuses a conversation that is not the person\'s, a message without sources, and a card for a pushed thread', async () => {
    const w = world();
    const q = await conversation(w, false);
    await expect(w.threads.cardFromAnswer(hassan, { conversationId: 'q1', messageId: q.messages[1]!.id })).rejects.toThrow('Svaret har inga källor att göra ett kort av.');
    await expect(w.threads.cardFromAnswer(hillevi, { conversationId: 'q1', messageId: q.messages[1]!.id })).rejects.toThrow('Samtalet finns inte.');
    await expect(w.threads.cardFromAnswer(hassan, { conversationId: 'q1', messageId: 'nope' })).rejects.toThrow('Svaret har inga källor att göra ett kort av.');
  });
});
