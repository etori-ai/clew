import { Registry } from '../registry';
import { invoiceInput } from '../document-fixtures';
import { describe, expect, test } from 'bun:test';
import type { AuthenticatedContext, Thread } from '../../packages/contracts/src/index';
import { actorOf, type Connector } from '../../packages/connectors/src/index';
import { fixtureConnectors } from '../fixture-connectors';
import { memoryThreadStore, memoryTimers } from '../../apps/server/src/threads/adapters/memory';
import { ATTENTION_BUDGET, threadUsecases, type ThreadDeps } from '../../apps/server/src/threads/usecases/cards';
import { reminderUsecases } from '../../apps/server/src/threads/usecases/reminders';
import { searchConnector } from '../../apps/server/src/modules/search/connector';
import { searchUsecases } from '../../apps/server/src/modules/search/usecases';

/**
 * The stream end to end without a server, a database or a timer service (D25): the fixture connectors over the
 * protocol behind the real registry, the memory store, a clock the test owns. What a person does on a card, what the store ends up holding,
 * and what the audit log says about it.
 */
const persona = (id: string, role: 'manager' | 'employee'): AuthenticatedContext => ({
  id,
  name: id,
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
const hillevi = persona('hillevi', 'manager'),
  hassan = persona('hassan', 'employee');
const T0 = '2026-11-04T07:00:00.000Z';
const MINUTE = 60_000;
function fakeClock(start = T0) {
  let now = Date.parse(start);
  const clock = () => new Date(now);
  return Object.assign(clock, {
    advance(ms: number) {
      now += ms;
    },
    set(iso: string) {
      now = Date.parse(iso);
    },
  });
}
function world() {
  const registry = new Registry();
  registry.register({ id: 'calendar', kind: 'core', source: 'Kalendern', areas: [], capabilities: [] });
  const store = memoryThreadStore(),
    clock = fakeClock();
  for (const m of [
    ...fixtureConnectors({ only: ['hr', 'finance', 'incidents'], clock }).connectors,
    searchConnector(searchUsecases({ sources: a => registry.searchSources(a), clock })),
  ])
    registry.register(m);
  let n = 0;
  const calendar = {
    calls: [] as string[],
    today: [] as Array<{ title: string; end: string }>,
    async ensureProposalThread() {
      calendar.calls.push('ensure');
      return undefined;
    },
    async replan(_p: AuthenticatedContext, threadId: string) {
      calendar.calls.push('replan');
      return (await store.readThreadById(threadId))!;
    },
    async dismiss(_p: AuthenticatedContext, threadId: string) {
      calendar.calls.push('dismiss');
      return (await store.readThreadById(threadId))!;
    },
    async todayEvents() {
      return calendar.today;
    },
  };
  const timers = memoryTimers();
  const deps: ThreadDeps = {
    store,
    registry,
    run: (p, name, input) => registry.run(actorOf(p), name, input),
    calendar,
    timers,
    clock,
    ids: () => `thread-${++n}`,
  };
  const threads = threadUsecases(deps);
  const reminders = reminderUsecases({ store, clock, authorized: async () => true });
  return { registry, store, clock, calendar, deps, threads, reminders, timers };
}
const actions = (store: ReturnType<typeof memoryThreadStore>, id: string) =>
  store.audit.filter(e => e.subject === 'thread:' + id).map(e => e.action);

test('rejected-row recovery is scoped, audited once, and never repeats a completed retry or an uncertain write', async () => {
  const w = world();
  await w.threads.ensureThreads(hillevi);
  const card = (await w.threads.listThreadsFor(hillevi)).find(t => t.connector === 'finance')!;
  const original = {
    ...card,
    id: 'rejected-card',
    topic: 'rejected-card',
    execution: {
      id: 'rejected-execution',
      decisionId: 'decision',
      operation: 'finance.approve',
      state: 'partial' as const,
      reason: null,
      compensates: null,
    },
  };
  const receipt = {
    at: T0,
    headline: 'Två klara, en avvisad.',
    undoUntil: null,
    undoCapability: null,
    rows: card.items.map((i, n) => ({
      ref: i.ref,
      label: i.label,
      outcome: n === 2 ? ('failed' as const) : ('done' as const),
      detail: n === 2 ? 'Beställning saknas' : 'Klart',
    })),
  };
  await w.store.transaction(async tx => {
    await tx.insertThread({ ...original, personId: hillevi.id });
    await tx.updateThread(original.id, { receipt });
  });
  const [first, same] = await Promise.all([
    w.threads.retryRejected(hillevi, original.id),
    w.threads.retryRejected(hillevi, original.id),
  ]);
  expect(first.id).toBe(same.id);
  expect(first.items.map(i => i.ref)).toEqual([card.items[2]!.ref]);
  expect(first.items[0]!.revision).toBeUndefined();
  expect(first.receipt).toBeNull();
  expect((await w.threads.threadFor(hillevi, original.id))!.receipt).toEqual(receipt);
  expect(w.store.audit.filter(e => e.action === 'thread.retry_created')).toHaveLength(1);
  expect(w.store.audit.at(-1)).toMatchObject({
    actor: hillevi.principal.id,
    details: { originalExecutionId: original.execution.id, refs: [card.items[2]!.ref] },
  });
  await w.store.transaction(tx => tx.updateThread(first.id, { state: 'handled', handledAt: T0 }));
  expect((await w.threads.retryRejected(hillevi, original.id)).id).toBe(first.id);
  await expect(w.threads.retryRejected(hassan, original.id)).rejects.toThrow(/finns inte/);
  const uncertain = {
    ...original,
    id: 'uncertain',
    topic: 'uncertain',
    execution: { ...original.execution, state: 'unknown' as const },
  };
  await w.store.transaction(async tx => {
    await tx.insertThread({ ...uncertain, personId: hillevi.id });
    await tx.updateThread(uncertain.id, { receipt });
  });
  await expect(w.threads.retryRejected(hillevi, uncertain.id)).rejects.toThrow(/Kontrollera/);
});
async function invoices(w: ReturnType<typeof world>) {
  await w.threads.ensureThreads(hillevi);
  return (await w.threads.listThreadsFor(hillevi)).find(t => t.topic === 'finance:invoices')!;
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
    const card = mine.find(t => t.topic === 'finance:invoices')!;
    expect(card).toMatchObject({
      kind: 'pushed',
      state: 'open',
      connector: 'finance',
      area: 'budget',
      createdAt: T0,
      trigger: { source: 'Ekonomisystemet', at: T0 },
    });
    expect(card.messages.map(m => m.body)).toEqual([card.summary]);
    expect(w.store.audit.filter(e => e.action === 'thread.pushed').map(e => e.details)).toContainEqual({
      connector: 'finance',
      topic: 'finance:invoices',
      owner: 'hillevi',
    });
    expect(w.calendar.calls).toEqual(['ensure']);
    await w.threads.ensureThreads(hassan);
    expect((await w.threads.listThreadsFor(hassan)).some(t => t.connector === 'finance')).toBe(false);
  });
  test('is idempotent: a second scan writes nothing when the source is unchanged', async () => {
    const w = world();
    await w.threads.ensureThreads(hillevi);
    const before = { threads: w.store.dump().length, audit: w.store.audit.length };
    w.clock.advance(60 * MINUTE);
    await w.threads.ensureThreads(hillevi);
    expect({ threads: w.store.dump().length, audit: w.store.audit.length }).toEqual(before);
  });
  test("refreshes an untouched card from its source and keeps the person's selection", async () => {
    const w = world();
    const card = await invoices(w);
    const [first, second] = card.items;
    expect(first!.selected).toBe(true);
    await w.store.transaction(tx =>
      tx.updateThread(card.id, { items: card.items.map(i => (i.ref === first!.ref ? { ...i, selected: false } : i)) }),
    );
    // One invoice is approved outside Clew: the next scan drops it from the card.
    await w.registry.run(hillevi, 'finance.approve', await invoiceInput(w.registry, hillevi, [second!.ref]));
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

describe('avfärda, inte nu and ångra', () => {
  test('a dismissed card comes back within ten minutes, a snoozed one any time', async () => {
    const w = world();
    const card = await invoices(w);
    expect(await w.threads.dismissAny(hillevi, card.id)).toMatchObject({ state: 'dismissed', handledAt: T0 });
    w.clock.advance(10 * MINUTE);
    expect(await w.threads.reopenThread(hillevi, card.id)).toMatchObject({ state: 'open', handledAt: null });
    expect(await w.threads.snoozeThread(hillevi, card.id)).toMatchObject({
      state: 'open',
      waitingOn: null,
      snoozedUntil: '2026-11-05T05:00:00.000Z',
    });
    w.clock.advance(5 * 24 * 60 * MINUTE);
    expect(await w.threads.reopenThread(hillevi, card.id)).toMatchObject({ state: 'open', snoozedUntil: null });
    expect(actions(w.store, card.id)).toEqual([
      'thread.pushed',
      'thread.dismissed',
      'thread.reopened',
      'thread.snoozed',
      'thread.reopened',
    ]);
    expect(w.store.audit.filter(e => e.action === 'thread.reopened').map(e => e.details)).toEqual([
      { from: 'dismissed' },
      { from: 'snoozed' },
    ]);
    expect(w.calendar.calls).toEqual(['ensure']);
  });
  test('a snoozed card wakes when its time passes, with an audit row saying so', async () => {
    const w = world();
    const card = await invoices(w);
    const snoozed = await w.threads.snoozeThread(hillevi, card.id);
    expect(snoozed.snoozedUntil).toBe('2026-11-05T05:00:00.000Z');
    expect(snoozed.messages.at(-1)!.body).toBe('Inte nu · i morgon 06:00');
    expect(await w.store.readTimer(`snooze:${card.id}`)).toMatchObject({
      generation: 1,
      state: 'active',
      dueAt: '2026-11-05T05:00:00.000Z',
      requestedAt: T0,
      deliveredGeneration: null,
    });
    w.clock.advance(60 * MINUTE);
    expect((await w.threads.listThreadsFor(hillevi)).find(t => t.id === card.id)?.snoozedUntil).toBe(
      '2026-11-05T05:00:00.000Z',
    );
    w.clock.set('2026-11-05T05:00:00.000Z');
    await w.reminders.fire(`snooze:${card.id}`, 1);
    expect((await w.threads.listThreadsFor(hillevi)).find(t => t.id === card.id)?.snoozedUntil).toBeNull();
    expect(actions(w.store, card.id)).toEqual(['thread.pushed', 'thread.snoozed', 'thread.woken']);
    expect(w.store.audit.at(-1)?.details).toMatchObject({ reason: 'time', snoozedUntil: '2026-11-05T05:00:00.000Z' });
  });
  test('a snoozed card wakes early when its source changes (the snooze breaks on activity)', async () => {
    const w = world();
    const card = await invoices(w);
    await w.threads.snoozeThread(hillevi, card.id);
    await w.registry.run(hillevi, 'finance.approve', await invoiceInput(w.registry, hillevi, [card.items[1]!.ref]));
    await w.threads.ensureThreads(hillevi);
    const after = (await w.threads.threadFor(hillevi, card.id))!;
    expect(after.snoozedUntil).toBeNull();
    expect(actions(w.store, card.id)).toEqual(['thread.pushed', 'thread.snoozed', 'thread.refreshed', 'thread.woken']);
    expect(w.store.audit.at(-1)?.details).toMatchObject({ reason: 'changed' });
    expect(await w.store.readTimer(`snooze:${card.id}`)).toMatchObject({ state: 'cancelled' });
    // The timer is gone, so the word the person was promised goes out now (D49).
    expect(w.store.deliveries).toEqual([expect.stringMatching(new RegExp(`^woken:${card.id}:`))]);
  });
  test('the picker (D29): a preset, free text or an instant sets the time; the rows carry their resolved times', async () => {
    const w = world();
    w.calendar.today = [
      { title: 'Ledningsgrupp', end: '2026-11-04T10:30:00.000Z' },
      { title: 'Lunch', end: '2026-11-04T11:30:00.000Z' },
    ];
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
    expect((await w.threads.snoozeThread(hillevi, card.id, { preset: 'lunch' })).snoozedUntil).toBe(
      '2026-11-04T12:00:00.000Z',
    );
    expect((await w.threads.snoozeThread(hillevi, card.id, { text: 'fredag kl 9' })).snoozedUntil).toBe(
      '2026-11-06T08:00:00.000Z',
    );
    expect(
      (await w.threads.snoozeThread(hillevi, card.id, { until: '2026-11-04T15:00:00.000Z' })).messages.at(-1)!.body,
    ).toBe('Inte nu · kl 16:00');
    await expect(w.threads.snoozeThread(hillevi, card.id, { text: 'när grisarna flyger' })).rejects.toThrow(
      'Jag förstod inte tiden.',
    );
    await expect(w.threads.snoozeThread(hillevi, card.id, { preset: 'aldrig' })).rejects.toThrow('Okänt förval.');
    await expect(w.threads.snoozeThread(hillevi, card.id, { until: '2026-11-04T06:00:00.000Z' })).rejects.toThrow(
      'Tiden har redan passerat.',
    );
    await expect(w.threads.snoozeThread(hillevi, card.id, { until: '2026-12-20T06:00:00.000Z' })).rejects.toThrow(
      'Högst 30 dagar framåt.',
    );
    expect(w.store.audit.filter(e => e.action === 'thread.snoozed').map(e => e.details)).toEqual([
      expect.objectContaining({ preset: 'lunch', delivery: 'queued', generation: 1 }),
      expect.objectContaining({ text: 'fredag kl 9' }),
      expect.objectContaining({ until: '2026-11-04T15:00:00.000Z' }),
    ]);
  });
  test('a snooze comes back the way a reminder does (D49); one that was woken earlier or re-snoozed does nothing', async () => {
    const w = world();
    const card = await invoices(w);
    await w.threads.snoozeThread(hillevi, card.id, { until: '2026-11-04T09:00:00.000Z' });
    const fired = {
      personId: 'hillevi',
      threadId: card.id,
      title: card.title,
      area: card.area,
      seconds: 2 * 3600,
      requestedAt: T0,
      silent: true,
    };
    w.clock.set('2026-11-04T09:00:00.000Z');
    expect(await w.reminders.fire(`snooze:${card.id}`, 1)).toBe('surfaced');
    const back = (await w.threads.threadFor(hillevi, card.id))!;
    expect(back).toMatchObject({ state: 'open', snoozedUntil: null, remindedAt: '2026-11-04T09:00:00.000Z' });
    expect(back.trigger.reason).toBe(`Du bad 08:00 om en påminnelse · ${card.trigger.reason}`);
    expect(back.messages.at(-1)!.body).toBe('Påminnelse: du bad 08:00 om att få det här kortet igen.');
    expect(w.store.deliveries).toEqual([`reminded:${card.id}:1`]);
    expect(w.store.audit.at(-1)).toMatchObject({
      actor: 'assistant:reminder',
      action: 'thread.woken',
      subject: 'thread:' + card.id,
      details: { reason: 'time', snoozedUntil: '2026-11-04T09:00:00.000Z', owner: 'hillevi' },
    });
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
    expect(w.store.audit.at(-1)?.details).toMatchObject({ delivery: 'queued' });
  });
  test('a card dismissed more than ten minutes ago stays dismissed, an open card cannot be reopened', async () => {
    const w = world();
    const card = await invoices(w);
    await expect(w.threads.reopenThread(hillevi, card.id)).rejects.toThrow('Kortet går inte att återöppna.');
    await w.threads.dismissThread(hillevi, card.id, 'fel kostnadsställe');
    expect((await w.threads.threadFor(hillevi, card.id))!.messages.at(-1)!.body).toBe('Avfärdad · fel kostnadsställe');
    w.clock.advance(10 * MINUTE + 1);
    await expect(w.threads.reopenThread(hillevi, card.id)).rejects.toThrow('Ångerfönstret har gått ut.');
    await expect(w.threads.snoozeThread(hillevi, card.id)).rejects.toThrow('Kortet är redan hanterat.');
  });
});

describe('every mutation and its audit row', () => {
  test('name the person as actor and the thread as subject, once per mutation', async () => {
    const w = world();
    const card = await invoices(w);
    const steps: Array<[string, () => Promise<unknown>]> = [
      ['thread.snoozed', () => w.threads.snoozeThread(hillevi, card.id)],
      ['thread.reopened', () => w.threads.reopenThread(hillevi, card.id)],
      ['thread.dismissed', () => w.threads.dismissThread(hillevi, card.id)],
      [
        'reminder.set',
        async () => {
          await w.threads.reopenThread(hillevi, card.id);
          return w.reminders.remind(hillevi, card.id, 600);
        },
      ],
      ['reminder.cancelled', () => w.reminders.cancelReminder(hillevi, card.id, `reminder:${card.id}:v2:1`)],
    ];
    for (const [action, step] of steps) {
      const before = w.store.audit.length;
      await step();
      const added = w.store.audit
        .slice(before)
        .filter(e => e.action !== 'thread.reopened' || action === 'thread.reopened');
      expect(added.map(e => [e.action, e.actor, e.subject, e.at])).toEqual([
        [action, 'person:hillevi', 'thread:' + card.id, T0],
      ]);
    }
  });
});

describe('attention and areas', () => {
  test('a scan outside the review counts as one interruption against the budget, however many cards it brings', async () => {
    const w = world();
    expect(await w.threads.attentionFor(hillevi)).toMatchObject({
      used: 0,
      budget: ATTENTION_BUDGET,
      bundledUntil: null,
    });
    await w.threads.ensureThreads(hillevi);
    expect((await w.threads.listThreadsFor(hillevi)).filter(t => t.kind === 'pushed').length).toBeGreaterThan(1);
    expect(await w.threads.attentionFor(hillevi)).toMatchObject({
      used: 1,
      budget: ATTENTION_BUDGET,
      bundledUntil: null,
    });
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
    // The figure comes with the time Clew read it, for the line's "Ekonomisystemet 06:00" (D54).
    expect(budget.figure).toMatchObject({
      label: 'Förbrukat av ramen',
      value: '98 %',
      observedAt: expect.stringMatching(/T/),
    });
    await w.threads.snoozeThread(hillevi, card.id);
    expect((await w.threads.listAreas(hillevi)).find(a => a.id === 'budget')).toMatchObject({
      needsYou: 0,
      waiting: 0,
      urgency: null,
    });
  });
});

describe('påminn mig', () => {
  test('saves a timer intent, parks the card and audits; the public id identifies the generation', async () => {
    const w = world();
    const card = await invoices(w);
    const set = await w.reminders.remind(hillevi, card.id, 600);
    expect(set).toMatchObject({
      id: `reminder:${card.id}:v2:1`,
      fireAt: new Date(Date.parse(T0) + 10 * MINUTE).toISOString(),
      thread: { waitingOn: 'påminnelsen 08:10' },
    });
    expect(await w.store.readTimer(`reminder:${card.id}`)).toMatchObject({
      state: 'active',
      generation: 1,
      dueAt: set.fireAt,
      deliveredGeneration: null,
    });
    expect(set.thread.messages.at(-1)!.body).toBe('Påminn mig 08:10');
    const cancelled = await w.reminders.cancelReminder(hillevi, card.id, set.id);
    expect(cancelled.waitingOn).toBeNull();
    expect(await w.store.readTimer(`reminder:${card.id}`)).toMatchObject({ state: 'cancelled', generation: 1 });
    expect(actions(w.store, card.id)).toEqual(['thread.pushed', 'reminder.set', 'reminder.cancelled']);
  });
  test('on a card that waits on someone, the reminder never replaces who it waits on (D49)', async () => {
    const w = world();
    const card = await invoices(w);
    await w.store.transaction(tx => tx.updateThread(card.id, { waitingOn: 'skyddsombudet' }));
    const set = await w.reminders.remind(hillevi, card.id, 600);
    expect(set.thread.waitingOn).toBe('skyddsombudet');
    expect((await w.reminders.cancelReminder(hillevi, card.id, set.id)).waitingOn).toBe('skyddsombudet');
    expect(actions(w.store, card.id)).toEqual(['thread.pushed', 'reminder.set', 'reminder.cancelled']);
    await w.reminders.remind(hillevi, card.id, 600);
    w.clock.advance(10 * MINUTE);
    expect(await w.reminders.fire(`reminder:${card.id}`, 2)).toBe('surfaced');
    const back = (await w.threads.threadFor(hillevi, card.id))!;
    expect(back).toMatchObject({
      waitingOn: null,
      trigger: { reason: `Du bad 08:00 om en påminnelse · Väntade på skyddsombudet · ${card.trigger.reason}` },
    });
    expect(actions(w.store, card.id).at(-1)).toBe('thread.reminded');
    expect(w.store.deliveries).toEqual([`reminded:${card.id}:2`]);
  });
  test('when the timer fires the card comes back once, reopened and marked, with the reason on its trigger', async () => {
    const w = world();
    const card = await invoices(w);
    const set = await w.reminders.remind(hillevi, card.id, 600);
    await w.threads.dismissThread(hillevi, card.id);
    w.clock.advance(10 * MINUTE);
    const fired = {
      personId: 'hillevi',
      threadId: card.id,
      title: card.title,
      area: card.area,
      seconds: 600,
      requestedAt: T0,
    };
    expect(await w.reminders.fire(`reminder:${card.id}`, 1)).toBe('surfaced');
    const back = (await w.threads.threadFor(hillevi, card.id))!;
    const at = new Date(Date.parse(T0) + 10 * MINUTE).toISOString();
    expect(back).toMatchObject({
      state: 'open',
      handledAt: null,
      waitingOn: null,
      remindedAt: at,
      trigger: { reason: `Du bad 08:00 om en påminnelse · ${card.trigger.reason}`, source: card.trigger.source, at },
    });
    expect(back.messages.at(-1)!.body).toBe('Påminnelse: du bad 08:00 om att få det här kortet igen.');
    expect(w.store.audit.at(-1)).toMatchObject({
      actor: 'assistant:reminder',
      action: 'thread.reminded',
      subject: 'thread:' + card.id,
      at,
      details: { requestedAt: T0, seconds: 600, wasState: 'dismissed', owner: 'hillevi' },
    });
    // A retried activity finds remindedAt at the fire time already and does nothing; a stranger's id never matches.
    expect(await w.reminders.surface(fired)).toBe('skipped');
    expect(await w.reminders.surface({ ...fired, personId: 'hassan' })).toBe('skipped');
    expect(w.store.audit.filter(e => e.action === 'thread.reminded')).toHaveLength(1);
    // A card handled with a receipt is left alone: the work is done.
    await w.store.transaction(tx =>
      tx.updateThread(card.id, {
        state: 'handled',
        receipt: { at, headline: 'Klart', rows: [], undoUntil: null, undoCapability: null },
      }),
    );
    expect(await w.reminders.surface({ ...fired, requestedAt: at })).toBe('skipped');
    expect((await w.threads.threadFor(hillevi, card.id))!.state).toBe('handled');
    void set;
  });
  test('queues the reminder when the timer service is away, and refuses bad input', async () => {
    const w = world();
    const card = await invoices(w);
    const reminders = reminderUsecases({ store: w.store, timers: memoryTimers({ available: false }), clock: w.clock });
    await expect(reminders.remind(hillevi, card.id, 600)).resolves.toMatchObject({ id: `reminder:${card.id}:v2:1` });
    expect((await w.threads.threadFor(hillevi, card.id))!.waitingOn).toBe('påminnelsen 08:10');
    expect(actions(w.store, card.id)).toEqual(['thread.pushed', 'reminder.set']);
    await expect(w.reminders.remind(hillevi, card.id, 0)).rejects.toThrow('Ogiltig tid för påminnelsen.');
    await expect(w.reminders.remind(hillevi, card.id, 30 * 24 * 3600 + 1)).rejects.toThrow(
      'Ogiltig tid för påminnelsen.',
    );
    await expect(w.reminders.cancelReminder(hillevi, card.id, 'reminder:other:1')).rejects.toThrow('Okänd påminnelse.');
  });
});

describe('a cited answer becomes a card (D26)', () => {
  const sources = [
    {
      n: 1,
      ref: 'document:docs:fall-2',
      label: 'Rutin vid fall i ordinärt boende',
      source: 'Intranätet',
      stale: false,
      link: 'https://intra/fall',
      section: 'Vid fall',
      owner: 'MAS',
      reviewedAt: '2026-03-12T00:00:00.000Z',
    },
    {
      n: 2,
      ref: 'document:eneo:lathund',
      label: 'Lathund: avvikelser',
      source: 'Eneo',
      stale: true,
      reviewedAt: '2024-11-02T00:00:00.000Z',
    },
  ];
  async function conversation(w: ReturnType<typeof world>, withSources = true) {
    const at = w.clock().toISOString();
    await w.store.transaction(async tx => {
      await tx.insertThread({
        id: 'q1',
        personId: 'hassan',
        kind: 'question',
        topic: 'question',
        title: 'Brukaren har ramlat, vad gör jag?',
        state: 'open',
        week: null,
        connector: 'clew',
        area: 'fragor',
        summary: 'svar',
        items: [],
        actions: [],
        waitingOn: null,
        deadline: null,
        trigger: { reason: 'Du ställde en fråga', source: 'Startsidan', at },
        createdAt: at,
        updatedAt: at,
      });
      await tx.addMessage('q1', { role: 'user', body: 'Brukaren har ramlat, vad gör jag?', at });
      await tx.addMessage('q1', {
        role: 'assistant',
        body: '1. Lyft inte själv [1].\n2. Skriv avvikelse [2].',
        at,
        meta: {
          shape: 'steg',
          access: { connectors: [], capabilities: [], authorizationVersion: hassan.authorizationVersion },
          ...(withSources ? { sources } : {}),
        },
      });
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
    expect(card).toMatchObject({
      kind: 'pushed',
      state: 'open',
      connector: 'clew',
      area: 'fragor',
      topic: 'answer:' + answerId,
      title: 'Följ upp: Brukaren har ramlat, vad gör jag?',
      summary: '1. Lyft inte själv [1].\n2. Skriv avvikelse [2].',
      trigger: { source: 'Startsidan', reason: 'Du frågade 08:00 och gjorde svaret till ett kort' },
    });
    expect(card.items).toEqual([
      {
        ref: 'document:docs:fall-2',
        label: '[1] Rutin vid fall i ordinärt boende · Vid fall',
        detail: 'MAS · granskad 2026-03-12 · Intranätet',
        selectable: false,
        selected: false,
      },
      {
        ref: 'document:eneo:lathund',
        label: '[2] Lathund: avvikelser',
        detail: 'granskad 2024-11-02 · Eneo',
        selectable: false,
        selected: false,
      },
    ]);
    expect(card.actions).toEqual([
      {
        id: 'open',
        label: 'Öppna källan',
        capability: 'clew.openSource',
        kind: 'read',
        role: 'primary',
        target: 'link',
        input: { ref: 'docs:fall-2' },
      },
    ]);
    expect(actions(w.store, threadId)).toEqual(['thread.fromAnswer']);
    expect(w.store.audit.at(-1)).toMatchObject({
      actor: 'person:hassan',
      action: 'thread.fromAnswer',
      details: { conversation: 'q1', message: answerId, sources: ['document:docs:fall-2', 'document:eneo:lathund'] },
    });
    expect(JSON.stringify(w.store.audit)).not.toContain('Lyft inte själv');
    expect(await w.threads.cardFromAnswer(hassan, { conversationId: 'q1', messageId: answerId })).toEqual({ threadId });
    expect((await w.threads.listThreadsFor(hassan)).filter(t => t.topic === 'answer:' + answerId)).toHaveLength(1);
  });
  test("refuses a conversation that is not the person's, a message without sources, and a card for a pushed thread", async () => {
    const w = world();
    const q = await conversation(w, false);
    await expect(
      w.threads.cardFromAnswer(hassan, { conversationId: 'q1', messageId: q.messages[1]!.id }),
    ).rejects.toThrow('Svaret har inga källor att göra ett kort av.');
    await expect(
      w.threads.cardFromAnswer(hillevi, { conversationId: 'q1', messageId: q.messages[1]!.id }),
    ).rejects.toThrow('Samtalet finns inte.');
    await expect(w.threads.cardFromAnswer(hassan, { conversationId: 'q1', messageId: 'nope' })).rejects.toThrow(
      'Svaret har inga källor att göra ett kort av.',
    );
  });
});

test('area reads check the person again after figures complete', async () => {
  const w = world();
  let checks = 0;
  const p = {
    ...hillevi,
    authorize: async () => {
      if (++checks === 2) throw new Error('person revoked');
      return { version: 'v1' };
    },
  };
  await expect(w.threads.listAreas(p)).rejects.toThrow('person revoked');
  expect(checks).toBe(2);
});
