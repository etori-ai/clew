import { expect, test } from 'bun:test';
import type { AuthenticatedContext } from '../../packages/contracts/src';
import { memoryThreadStore } from '../../apps/server/src/threads/adapters/memory';
import { reminderUsecases } from '../../apps/server/src/threads/usecases/reminders';
import { timerDispatcher } from '../../apps/server/src/threads/usecases/timer-dispatch';
import { draft } from '../store-contract';

const actor: AuthenticatedContext = { id: 'a', name: 'A', unitId: 'unit', unitLabel: 'Unit', role: 'manager', organisationId: 'org', principal: { id: 'person:a', kind: 'person' }, capabilities: [], authorizationVersion: 'v1', sessionBinding: 'test', expiresAt: '2099-01-01T00:00:00.000Z', async authorize() { return { version: 'v1' }; } };
async function world() {
  let now = Date.parse('2026-11-05T12:00:00.000Z'), allowed = true;
  const store = memoryThreadStore(), clock = () => new Date(now), thread = draft(actor.id);
  await store.transaction(tx => tx.insertThread(thread));
  return { store, clock, thread, advance: (ms: number) => { now += ms; }, revoke: () => { allowed = false; },
    reminders: reminderUsecases({ store, clock, authorized: async () => allowed }) };
}
test('an audit failure rolls back the card and timer intent before anything can be delivered', async () => {
  const w = await world();
  const faulty = { ...w.store, transaction: <T,>(fn: Parameters<typeof w.store.transaction<T>>[0]) => w.store.transaction(tx => fn({ ...tx, async writeAudit() { throw new Error('audit unavailable'); } })) };
  await expect(reminderUsecases({ store: faulty, clock: w.clock }).remind(actor, w.thread.id, 60)).rejects.toThrow('audit unavailable');
  expect(await w.store.readTimer(`reminder:${w.thread.id}`)).toBeUndefined();
  expect((await w.store.readThread(actor.id, w.thread.id))?.waitingOn).toBeNull();
  expect(await w.store.claimTimer(w.clock().toISOString(), w.clock().toISOString())).toBeUndefined();
});
test('outage recovery preserves the absolute due time and a retried fire changes the card once', async () => {
  const w = await world();
  const set = await w.reminders.remind(actor, w.thread.id, 60);
  await timerDispatcher({ store: w.store, clock: w.clock, deliver: async () => { throw new Error('offline'); } })();
  expect(await w.store.readTimer(`reminder:${w.thread.id}`)).toMatchObject({ dueAt: set.fireAt, reason: 'timer-service-unavailable', deliveredGeneration: null });
  w.advance(120_000);
  const delivered: string[] = [];
  await timerDispatcher({ store: w.store, clock: w.clock, deliver: async t => { delivered.push(t.dueAt); } })();
  expect(delivered).toEqual([set.fireAt]);
  expect(await Promise.all([w.reminders.fire(`reminder:${w.thread.id}`, 1), w.reminders.fire(`reminder:${w.thread.id}`, 1)])).toEqual(['surfaced', 'skipped']);
  expect(w.store.audit.filter(a => a.action === 'thread.reminded')).toHaveLength(1);
});
test('a superseded workflow and stale undo cannot cancel or fire the newer generation', async () => {
  const w = await world();
  const first = await w.reminders.remind(actor, w.thread.id, 60);
  const second = await w.reminders.remind(actor, w.thread.id, 120);
  await w.reminders.cancelReminder(actor, w.thread.id, first.id);
  w.advance(180_000);
  expect(await w.reminders.fire(`reminder:${w.thread.id}`, 1)).toBe('skipped');
  expect(await w.store.readTimer(`reminder:${w.thread.id}`)).toMatchObject({ generation: 2, state: 'active' });
  await w.reminders.cancelReminder(actor, w.thread.id, second.id);
  expect(await w.reminders.fire(`reminder:${w.thread.id}`, 2)).toBe('skipped');
  expect(w.store.audit.filter(a => a.action === 'reminder.cancelled')).toHaveLength(1);
});
test('cancellation wins over a delayed start acknowledgement, and is itself delivered', async () => {
  const w = await world(), id = `reminder:${w.thread.id}`;
  const set = await w.reminders.remind(actor, w.thread.id, 1);
  const claimed = (await w.store.claimTimer(w.clock().toISOString(), new Date(w.clock().getTime() + 30_000).toISOString()))!;
  await w.reminders.cancelReminder(actor, w.thread.id, set.id);
  await w.store.finishTimer(claimed, w.clock().toISOString());
  expect(await w.store.readTimer(id)).toMatchObject({ state: 'cancelled', deliveredGeneration: null });
  const sent: string[] = [];
  await timerDispatcher({ store: w.store, clock: w.clock, deliver: async t => { sent.push(t.state); } })();
  expect(sent).toEqual(['cancelled']);
  w.advance(2000);
  expect(await w.reminders.fire(id, 1)).toBe('skipped');
});
test('revoked authority blocks delivery visibly and auditably', async () => {
  const w = await world(), id = `reminder:${w.thread.id}`;
  await w.reminders.remind(actor, w.thread.id, 1);
  w.revoke(); w.advance(2000);
  expect(await w.reminders.fire(id, 1)).toBe('skipped');
  expect(await w.store.readTimer(id)).toMatchObject({ state: 'blocked', reason: 'authority-revoked' });
  expect(w.store.audit.at(-1)).toMatchObject({ action: 'timer.blocked', details: { generation: 1, reason: 'authority-revoked' } });
  expect((await w.store.readThread(actor.id, w.thread.id))?.remindedAt).toBeNull();
});
test('legacy histories still fire, but an accepted cancellation tombstone fences them', async () => {
  const w = await world();
  const input = { personId: actor.id, threadId: w.thread.id, requestedAt: w.clock().toISOString(), seconds: 1, title: '', area: '' };
  w.advance(2000);
  expect(await w.reminders.surface(input)).toBe('surfaced');
  await w.reminders.cancelReminder(actor, w.thread.id, `reminder:${w.thread.id}:1234`);
  expect(await w.reminders.surface({ ...input, requestedAt: w.clock().toISOString() })).toBe('skipped');
});
