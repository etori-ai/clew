import { describe, expect, test } from 'bun:test';
import type { Thread } from '../packages/contracts/src/index';
import type { AuditEntry, NewThread, ThreadStore } from '../apps/server/src/threads/model';

/**
 * The store contract (D25): one suite, two adapters. `tests/unit/memory-store.test.ts` runs it against the memory
 * adapter, `tests/db/postgres-store.test.ts` against Postgres. Whatever the unit tests learn from the memory store
 * must therefore hold in production, and this file is the only slow test the stream has.
 */
export interface StoreHarness {
  store: ThreadStore;
  /** Two people who both exist for the adapter (the Postgres one needs rows for them). */
  people: [string, string];
  auditFor(subject: string): Promise<AuditEntry[]>;
  hasJob(id: string): Promise<boolean>;
}
const T0 = '2026-11-04T06:00:00.000Z';
const plus = (iso: string, ms: number) => new Date(Date.parse(iso) + ms).toISOString();
const unique = () => Math.random().toString(36).slice(2, 10);
export const draft = (personId: string, overrides: Partial<NewThread> = {}): NewThread => {
  const id = overrides.id ?? `t-${unique()}`;
  return { id, personId, kind: 'pushed', topic: `topic-${unique()}`, title: 'Attestera 3 fakturor', state: 'open', week: null, connector: 'raindance', area: 'budget',
    summary: 'Tre fakturor väntar.', items: [{ ref: 'raindance:inv:1', label: 'Lekolar', detail: '6451', selectable: true, selected: true }],
    actions: [{ id: 'approve', label: 'Attestera valda', capability: 'raindance.approve', kind: 'execute', role: 'primary', usesItems: true }],
    waitingOn: null, deadline: '2026-11-05', trigger: { reason: 'Den första förfaller 5 nov', source: 'Raindance', at: T0 }, createdAt: T0, updatedAt: T0, ...overrides };
};

export function storeContract(name: string, make: () => Promise<StoreHarness>) {
  describe(`${name} store`, () => {
    test('a thread is read back as the contract describes it, only by its owner', async () => {
      const { store, people: [a, b] } = await make();
      const t = draft(a);
      expect(await store.transaction(tx => tx.insertThread(t))).toBe(true);
      const read = await store.readThread(a, t.id);
      const { personId: _owner, ...expected } = t;
      expect(read).toEqual({ ...expected, receipt: null, handledAt: null, remindedAt: null, messages: [], proposals: [] } satisfies Thread);
      expect(await store.readThread(b, t.id)).toBeUndefined();
      expect(await store.readThreadById(t.id)).toEqual(read);
    });
    test('one open pushed thread per person and topic: a second insert is a no-op, a closed one frees the topic', async () => {
      const { store, people: [a, b] } = await make();
      const first = draft(a);
      expect(await store.transaction(tx => tx.insertThread(first))).toBe(true);
      expect(await store.transaction(tx => tx.insertThread(draft(a, { topic: first.topic })))).toBe(false);
      expect(await store.transaction(tx => tx.insertThread(draft(b, { topic: first.topic })))).toBe(true);
      expect((await store.openThread(a, first.topic))?.id).toBe(first.id);
      await store.transaction(tx => tx.updateThread(first.id, { state: 'dismissed', handledAt: plus(T0, 1000), updatedAt: plus(T0, 1000) }));
      expect(await store.openThread(a, first.topic)).toBeUndefined();
      expect(await store.transaction(tx => tx.insertThread(draft(a, { topic: first.topic })))).toBe(true);
    });
    test('messages keep their order and move updatedAt; a patch changes only what it names', async () => {
      const { store, people: [a] } = await make();
      const t = draft(a);
      await store.transaction(async tx => {
        await tx.insertThread(t);
        await tx.addMessage(t.id, { role: 'assistant', body: 'Tre fakturor väntar.', at: plus(T0, 1000) });
        await tx.addMessage(t.id, { role: 'user', body: 'Attestera valda', at: plus(T0, 2000), meta: { refs: ['raindance:inv:1'] } });
      });
      const read = (await store.readThread(a, t.id))!;
      expect(read.messages.map(m => [m.role, m.body, m.createdAt, m.meta])).toEqual([['assistant', 'Tre fakturor väntar.', plus(T0, 1000), undefined], ['user', 'Attestera valda', plus(T0, 2000), { refs: ['raindance:inv:1'] }]]);
      expect(read.updatedAt).toBe(plus(T0, 2000));
      const receipt = { at: plus(T0, 3000), headline: 'Klart.', rows: [], undoUntil: plus(T0, 600_000), undoCapability: 'raindance.unapprove' };
      await store.transaction(tx => tx.updateThread(t.id, { state: 'handled', handledAt: plus(T0, 3000), receipt }));
      const handled = (await store.readThread(a, t.id))!;
      expect(handled).toMatchObject({ state: 'handled', handledAt: plus(T0, 3000), receipt, title: t.title, updatedAt: plus(T0, 2000) });
      await store.transaction(tx => tx.updateThread(t.id, { handledAt: null, receipt: null, waitingOn: 'i morgon 06:00' }));
      expect(await store.readThread(a, t.id)).toMatchObject({ handledAt: null, receipt: null, waitingOn: 'i morgon 06:00', state: 'handled' });
    });
    test('the stream lists open threads and what was handled within seven days, newest first', async () => {
      const { store, people: [a] } = await make();
      const now = plus(T0, 30 * 86400_000);
      const open = draft(a, { createdAt: T0, updatedAt: T0 });
      const recent = draft(a, { createdAt: plus(T0, 1000), updatedAt: plus(now, -6 * 86400_000) });
      const stale = draft(a, { createdAt: plus(T0, 2000), updatedAt: plus(now, -8 * 86400_000) });
      await store.transaction(async tx => { for (const t of [open, recent, stale]) await tx.insertThread(t); });
      await store.transaction(async tx => { for (const t of [recent, stale]) await tx.updateThread(t.id, { state: 'handled', handledAt: t.updatedAt }); });
      expect((await store.listThreads(a, now)).map(t => t.id)).toEqual([recent.id, open.id]);
    });
    test('counts pushed threads from an instant, inclusive', async () => {
      const { store, people: [a] } = await make();
      await store.transaction(async tx => {
        await tx.insertThread(draft(a, { createdAt: plus(T0, -1) }));
        await tx.insertThread(draft(a, { createdAt: T0 }));
        await tx.insertThread(draft(a, { createdAt: plus(T0, 1) }));
        await tx.insertThread(draft(a, { kind: 'question', createdAt: plus(T0, 2) }));
      });
      expect(await store.countPushedSince(a, T0)).toBe(2);
    });
    test('an audit row and a job commit with the writes they belong to, and roll back with them', async () => {
      const { store, people: [a], auditFor, hasJob } = await make();
      const t = draft(a);
      const entry = { actor: 'person:' + a, action: 'thread.acted', subject: 'thread:' + t.id, at: plus(T0, 1000), details: { refs: ['raindance:inv:1'] } };
      await store.transaction(async tx => { await tx.insertThread(t); await tx.writeAudit(entry); await tx.scheduleJob({ id: 'job:' + t.id, kind: 'receipt-final', runAt: plus(T0, 600_000), payload: { threadId: t.id } }); });
      expect((await auditFor('thread:' + t.id)).map(({ actor, action, subject, at, details }) => ({ actor, action, subject, at, details }))).toEqual([entry]);
      expect(await hasJob('job:' + t.id)).toBe(true);
      await expect(store.transaction(async tx => {
        await tx.updateThread(t.id, { state: 'dismissed' });
        await tx.addMessage(t.id, { role: 'user', body: 'Avfärdad', at: plus(T0, 2000) });
        await tx.writeAudit({ ...entry, action: 'thread.dismissed', at: plus(T0, 2000) });
        await tx.scheduleJob({ id: 'job:lost:' + t.id, kind: 'receipt-final', runAt: plus(T0, 600_000) });
        throw new Error('after the audit row');
      })).rejects.toThrow('after the audit row');
      expect(await store.readThread(a, t.id)).toMatchObject({ state: 'open', messages: [] });
      expect((await auditFor('thread:' + t.id)).map(e => e.action)).toEqual(['thread.acted']);
      expect(await hasJob('job:lost:' + t.id)).toBe(false);
      await store.transaction(tx => tx.scheduleJob({ id: 'job:' + t.id, kind: 'receipt-final', runAt: plus(T0, 1) }));
      expect(await hasJob('job:' + t.id)).toBe(true);
    });
  });
}
