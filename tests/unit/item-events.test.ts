import { describe, expect, test } from 'bun:test';
import { Registry } from '../registry';
import type { AuthenticatedContext } from '../../packages/contracts/src/index';
import { actorOf } from '../../packages/connectors/src/index';
import { fixtureConnectors } from '../fixture-connectors';
import { memoryThreadStore } from '../../apps/server/src/threads/adapters/memory';
import { threadUsecases } from '../../apps/server/src/threads/usecases/cards';
import { reminderUsecases } from '../../apps/server/src/threads/usecases/reminders';
import { itemEvents } from '../../apps/server/src/threads/domain';

/**
 * A work item's "Händelser" (D112 item 4): what the person and Clew did to it, read back from the audit rows its own
 * mutations wrote, on the memory adapters. Only for an item the person may see; never a row anyone else wrote; and the
 * read itself writes nothing.
 */
const persona = (id: string): AuthenticatedContext => ({
  id,
  name: id,
  unitId: 'unit-skola',
  unitLabel: 'Skönsmons skola',
  role: 'manager',
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
const hillevi = persona('hillevi'),
  hassan = persona('hassan');
const T0 = '2026-11-04T07:00:00.000Z';
const MINUTE = 60_000;

function world() {
  const registry = new Registry();
  registry.register({ id: 'calendar', kind: 'core', source: 'Kalendern', areas: [], capabilities: [] });
  let now = Date.parse(T0);
  const clock = Object.assign(() => new Date(now), {
    advance(ms: number) {
      now += ms;
    },
  });
  for (const m of fixtureConnectors({ only: ['finance'], clock }).connectors) registry.register(m);
  const store = memoryThreadStore();
  let n = 0;
  const threads = threadUsecases({
    store,
    registry,
    run: (p, name, input) => registry.run(actorOf(p), name, input),
    calendar: {
      ensureProposalThread: async () => undefined,
      replan: async (_p, id) => (await store.readThreadById(id))!,
      dismiss: async (_p, id) => (await store.readThreadById(id))!,
      todayEvents: async () => [],
    },
    clock,
    ids: () => `thread-${++n}`,
  });
  const reminders = reminderUsecases({ store, clock, authorized: async () => true });
  return { store, clock, threads, reminders };
}

describe("a work item's Händelser (D112 item 4)", () => {
  test('the person and Clew, newest first, from the rows the item’s own mutations wrote; a read writes nothing', async () => {
    const w = world();
    await w.threads.ensureThreads(hillevi);
    const card = (await w.threads.listThreadsFor(hillevi)).find(t => t.connector === 'finance')!;
    const approve = card.actions.find(a => a.kind === 'execute')!;
    w.clock.advance(MINUTE);
    await w.threads.snoozeThread(hillevi, card.id, { until: '2026-11-04T12:00:00.000Z' });
    w.clock.advance(MINUTE);
    await w.threads.reopenThread(hillevi, card.id);
    w.clock.advance(MINUTE);
    const reminder = await w.reminders.remind(hillevi, card.id, 3600);
    w.clock.advance(MINUTE);
    await w.reminders.cancelReminder(hillevi, card.id, reminder.id);
    // The decision and the source's answer as the execution ledger projects them onto the item (D45), and a row some
    // other principal wrote about the same item, which is never shown.
    const at = (m: number) => new Date(Date.parse(T0) + m * MINUTE).toISOString();
    await w.store.transaction(async tx => {
      await tx.writeAudit({
        actor: 'person:hillevi',
        action: 'thread.decision_approved',
        subject: 'thread:' + card.id,
        at: at(5),
        details: { executionId: 'execution-1', operation: approve.capability, compensates: null },
      });
      await tx.writeAudit({
        actor: 'system:execution',
        action: 'thread.execution_succeeded',
        subject: 'thread:' + card.id,
        at: at(6),
        details: { executionId: 'execution-1', operation: approve.capability, compensates: null },
      });
      await tx.writeAudit({
        actor: 'person:hassan',
        action: 'thread.dismissed',
        subject: 'thread:' + card.id,
        at: at(7),
      });
    });
    const written = w.store.audit.length;
    const { events } = await w.threads.itemHistory(hillevi, card.id);
    expect(events).toEqual([
      { at: at(6), by: 'clew', kind: 'answered', outcome: 'succeeded', execution: 'execution-1' },
      { at: at(5), by: 'you', kind: 'decided', action: approve.label, execution: 'execution-1' },
      { at: at(4), by: 'you', kind: 'reminder-cancelled' },
      { at: at(3), by: 'you', kind: 'reminder-set', until: '2026-11-04T08:03:00.000Z' },
      { at: at(2), by: 'you', kind: 'reopened' },
      { at: at(1), by: 'you', kind: 'snoozed', until: '2026-11-04T12:00:00.000Z' },
      { at: T0, by: 'clew', kind: 'created' },
    ]);
    // A read: no row is written for it.
    expect(w.store.audit.length).toBe(written);
  });

  test('only for an item the person may see: another person is refused as if it did not exist', async () => {
    const w = world();
    await w.threads.ensureThreads(hillevi);
    const card = (await w.threads.listThreadsFor(hillevi)).find(t => t.connector === 'finance')!;
    await expect(w.threads.itemHistory(hassan, card.id)).rejects.toThrow('Ärendet finns inte.');
    await expect(w.threads.itemHistory(hillevi, 'no-such-item')).rejects.toThrow('Ärendet finns inte.');
  });

  test('an undo and the window closing are said; rows that are not about the item’s course are left out', () => {
    const rows = [
      {
        actor: 'person:hillevi',
        action: 'thread.decision_approved',
        subject: 'thread:x',
        at: T0,
        details: { executionId: 'u', compensates: 'e' },
      },
      { actor: 'system:scheduler', action: 'thread.receipt_final', subject: 'thread:x', at: T0 },
      { actor: 'assistant:reminder', action: 'timer.blocked', subject: 'timer:reminder:x', at: T0 },
      { actor: 'assistant:reminder', action: 'timer.fired', subject: 'timer:reminder:x', at: T0 },
      { actor: 'system:execution', action: 'obligation.policy_approved', subject: 'thread:x', at: T0 },
      { actor: 'assistant:scan', action: 'thread.woken', subject: 'thread:x', at: T0, details: { reason: 'changed' } },
      { actor: 'person:anna', action: 'thread.reopened', subject: 'thread:x', at: T0 },
    ];
    expect(itemEvents(rows, { actions: [] }, 'person:hillevi').map(e => [e.by, e.kind])).toEqual([
      ['clew', 'woken'],
      ['clew', 'reminder-stopped'],
      ['clew', 'undo-closed'],
      ['you', 'undo-decided'],
    ]);
  });
});
