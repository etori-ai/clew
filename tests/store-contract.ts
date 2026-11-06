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
  return {
    id,
    personId,
    kind: 'pushed',
    topic: `topic-${unique()}`,
    title: 'Attestera 3 fakturor',
    state: 'open',
    week: null,
    connector: 'finance',
    area: 'budget',
    summary: 'Tre fakturor väntar.',
    items: [{ ref: 'finance:inv:1', label: 'Skolgrossisten', detail: '6451', selectable: true, selected: true }],
    actions: [
      {
        id: 'approve',
        label: 'Attestera valda',
        capability: 'finance.approve',
        kind: 'execute',
        role: 'primary',
        usesItems: true,
      },
    ],
    waitingOn: null,
    deadline: '2026-11-05',
    trigger: { reason: 'Den första förfaller 5 nov', source: 'Ekonomisystemet', at: T0 },
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
};

export function storeContract(name: string, make: () => Promise<StoreHarness>) {
  describe(`${name} store`, () => {
    test('timer generations, cancellation and audit share the thread transaction', async () => {
      const {
        store,
        people: [a],
        auditFor,
      } = await make();
      const t = draft(a),
        id = `reminder:${t.id}`;
      await store.transaction(tx => tx.insertThread(t));
      const input = {
        id,
        personId: a,
        threadId: t.id,
        kind: 'reminder' as const,
        unitId: 'unit',
        authorizationVersion: 'v1',
        dueAt: plus(T0, 60_000),
        requestedAt: T0,
      };
      await expect(
        store.transaction(async tx => {
          await tx.lockThread(a, t.id);
          await tx.scheduleTimer(input);
          await tx.writeAudit({ actor: a, action: 'timer.set', subject: `thread:${t.id}`, at: T0 });
          throw new Error('rollback');
        }),
      ).rejects.toThrow('rollback');
      expect(await store.readTimer(id)).toBeUndefined();
      expect(await auditFor(`thread:${t.id}`)).toEqual([]);
      await store.transaction(async tx => {
        await tx.lockThread(a, t.id);
        expect((await tx.scheduleTimer(input)).generation).toBe(1);
        expect((await tx.scheduleTimer({ ...input, dueAt: plus(T0, 120_000) })).generation).toBe(2);
        expect(await tx.cancelTimer(id, T0, 1)).toBe(false);
      });
      expect(await store.readTimer(id)).toMatchObject({ state: 'active', generation: 2, dueAt: plus(T0, 120_000) });
      await store.transaction(async tx => {
        await tx.lockThread(a, t.id);
        expect(await tx.cancelTimer(id, T0, 2)).toBe(true);
      });
      expect(await store.readTimer(id)).toMatchObject({ state: 'cancelled', generation: 2 });
    });
    test('a thread is read back as the contract describes it, only by its owner', async () => {
      const {
        store,
        people: [a, b],
      } = await make();
      const t = draft(a);
      expect(await store.transaction(tx => tx.insertThread(t))).toBe(true);
      const read = await store.readThread(a, t.id);
      const { personId: _owner, ...expected } = t;
      expect(read).toEqual({
        ...expected,
        receipt: null,
        handledAt: null,
        remindedAt: null,
        snoozedUntil: null,
        messages: [],
        proposals: [],
      } satisfies Thread);
      expect(await store.readThread(b, t.id)).toBeUndefined();
      expect(await store.readThreadById(t.id)).toEqual(read);
    });
    test('one open pushed thread per person and topic: a second insert is a no-op, a closed one frees the topic', async () => {
      const {
        store,
        people: [a, b],
      } = await make();
      const first = draft(a);
      expect(await store.transaction(tx => tx.insertThread(first))).toBe(true);
      expect(await store.transaction(tx => tx.insertThread(draft(a, { topic: first.topic })))).toBe(false);
      expect(await store.transaction(tx => tx.insertThread(draft(b, { topic: first.topic })))).toBe(true);
      expect((await store.openThread(a, first.topic))?.id).toBe(first.id);
      await store.transaction(tx =>
        tx.updateThread(first.id, { state: 'dismissed', handledAt: plus(T0, 1000), updatedAt: plus(T0, 1000) }),
      );
      expect(await store.openThread(a, first.topic)).toBeUndefined();
      expect(await store.transaction(tx => tx.insertThread(draft(a, { topic: first.topic })))).toBe(true);
    });
    test('messages keep their order and move updatedAt; a patch changes only what it names', async () => {
      const {
        store,
        people: [a],
      } = await make();
      const t = draft(a);
      await store.transaction(async tx => {
        await tx.insertThread(t);
        await tx.addMessage(t.id, { role: 'assistant', body: 'Tre fakturor väntar.', at: plus(T0, 1000) });
        await tx.addMessage(t.id, {
          role: 'user',
          body: 'Attestera valda',
          at: plus(T0, 2000),
          meta: { refs: ['finance:inv:1'] },
        });
      });
      const read = (await store.readThread(a, t.id))!;
      expect(read.messages.map(m => [m.role, m.body, m.createdAt, m.meta])).toEqual([
        ['assistant', 'Tre fakturor väntar.', plus(T0, 1000), undefined],
        ['user', 'Attestera valda', plus(T0, 2000), { refs: ['finance:inv:1'] }],
      ]);
      expect(read.updatedAt).toBe(plus(T0, 2000));
      const receipt = {
        at: plus(T0, 3000),
        headline: 'Klart.',
        rows: [],
        undoUntil: plus(T0, 600_000),
        undoCapability: 'finance.unapprove',
      };
      await store.transaction(tx => tx.updateThread(t.id, { state: 'handled', handledAt: plus(T0, 3000), receipt }));
      const handled = (await store.readThread(a, t.id))!;
      expect(handled).toMatchObject({
        state: 'handled',
        handledAt: plus(T0, 3000),
        receipt,
        title: t.title,
        updatedAt: plus(T0, 2000),
      });
      await store.transaction(tx =>
        tx.updateThread(t.id, {
          handledAt: null,
          receipt: null,
          waitingOn: 'skyddsombudet',
          snoozedUntil: plus(T0, 3600_000),
        }),
      );
      expect(await store.readThread(a, t.id)).toMatchObject({
        handledAt: null,
        receipt: null,
        waitingOn: 'skyddsombudet',
        snoozedUntil: plus(T0, 3600_000),
        state: 'handled',
      });
      await store.transaction(tx => tx.updateThread(t.id, { snoozedUntil: null }));
      expect(await store.readThread(a, t.id)).toMatchObject({ waitingOn: 'skyddsombudet', snoozedUntil: null });
    });
    test('the stream lists open threads and what was handled within seven days, newest first', async () => {
      const {
        store,
        people: [a],
      } = await make();
      const now = plus(T0, 30 * 86400_000);
      const open = draft(a, { createdAt: T0, updatedAt: T0 });
      const recent = draft(a, { createdAt: plus(T0, 1000), updatedAt: plus(now, -6 * 86400_000) });
      const stale = draft(a, { createdAt: plus(T0, 2000), updatedAt: plus(now, -8 * 86400_000) });
      await store.transaction(async tx => {
        for (const t of [open, recent, stale]) await tx.insertThread(t);
      });
      await store.transaction(async tx => {
        for (const t of [recent, stale]) await tx.updateThread(t.id, { state: 'handled', handledAt: t.updatedAt });
      });
      expect((await store.listThreads(a, now)).map(t => t.id)).toEqual([recent.id, open.id]);
    });
    test('new conversations never displace older unresolved work from the stream or counts', async () => {
      const {
        store,
        people: [a],
      } = await make();
      const work = Array.from({ length: 55 }, () => draft(a));
      await store.transaction(async tx => {
        for (const t of work) await tx.insertThread(t);
        for (let i = 0; i < 60; i++)
          await tx.insertThread(draft(a, { kind: 'question', createdAt: plus(T0, i + 1), updatedAt: plus(T0, i + 1) }));
      });
      const listed = await store.listThreads(a, plus(T0, 60));
      expect(
        listed
          .filter(t => t.kind === 'pushed')
          .map(t => t.id)
          .sort(),
      ).toEqual(work.map(t => t.id).sort());
      expect(listed.filter(t => t.kind === 'question')).toHaveLength(50);
    });
    test('a thread can be locked inside a transaction by its owner only, and reads the same as outside', async () => {
      const {
        store,
        people: [a, b],
      } = await make();
      const t = draft(a);
      await store.transaction(async tx => {
        await tx.insertThread(t);
        await tx.addMessage(t.id, { role: 'assistant', body: 'Hej', at: plus(T0, 1000) });
      });
      const outside = await store.readThread(a, t.id);
      const inside = await store.transaction(async tx => ({
        mine: await tx.lockThread(a, t.id),
        theirs: await tx.lockThread(b, t.id),
      }));
      expect(inside.mine).toEqual(outside);
      expect(inside.theirs).toBeUndefined();
      await store.transaction(async tx => {
        const locked = (await tx.lockThread(a, t.id))!;
        await tx.updateThread(locked.id, {
          remindedAt: plus(T0, 2000),
          trigger: { ...locked.trigger, reason: 'igen' },
        });
      });
      expect(await store.readThread(a, t.id)).toMatchObject({
        remindedAt: plus(T0, 2000),
        trigger: { reason: 'igen', source: t.trigger.source },
      });
    });
    test('an old uncertain compensation keeps its original receipt beyond history limits', async () => {
      const {
          store,
          people: [a],
        } = await make(),
        now = plus(T0, 30 * 86400_000);
      const t = draft(a),
        receipt = {
          at: T0,
          headline: 'Bekräftat i källan.',
          rows: [{ ref: 'source:1', label: 'Original', outcome: 'done' as const, detail: 'Kontrollerat.' }],
          undoUntil: null,
          undoCapability: null,
        };
      await store.transaction(async tx => {
        await tx.insertThread({
          ...t,
          execution: {
            id: 'undo',
            decisionId: 'undo',
            operation: 'finance.unapprove',
            state: 'unknown',
            reason: 'source-unavailable',
            compensates: 'original',
          },
        });
        await tx.updateThread(t.id, { state: 'handled', handledAt: T0, receipt });
        for (let i = 0; i < 60; i++)
          await tx.insertThread(draft(a, { kind: 'question', createdAt: plus(now, -i), updatedAt: plus(now, -i) }));
      });
      const listed = await store.listThreads(a, now);
      expect(listed.find(row => row.id === t.id)).toMatchObject({
        receipt,
        execution: { state: 'unknown', compensates: 'original' },
      });
      expect(listed.filter(row => row.kind === 'question')).toHaveLength(50);
    });
    test('an audit row and a job commit with the writes they belong to, and roll back with them', async () => {
      const {
        store,
        people: [a],
        auditFor,
        hasJob,
      } = await make();
      const t = draft(a);
      const entry = {
        actor: 'person:' + a,
        action: 'thread.acted',
        subject: 'thread:' + t.id,
        at: plus(T0, 1000),
        details: { refs: ['finance:inv:1'] },
      };
      await store.transaction(async tx => {
        await tx.insertThread(t);
        await tx.writeAudit(entry);
        await tx.scheduleJob({
          id: 'job:' + t.id,
          kind: 'receipt-final',
          runAt: plus(T0, 600_000),
          payload: { threadId: t.id },
        });
      });
      expect(
        (await auditFor('thread:' + t.id)).map(({ actor, action, subject, at, details }) => ({
          actor,
          action,
          subject,
          at,
          details,
        })),
      ).toEqual([entry]);
      expect(await hasJob('job:' + t.id)).toBe(true);
      await expect(
        store.transaction(async tx => {
          await tx.updateThread(t.id, { state: 'dismissed' });
          await tx.addMessage(t.id, { role: 'user', body: 'Avfärdad', at: plus(T0, 2000) });
          await tx.writeAudit({ ...entry, action: 'thread.dismissed', at: plus(T0, 2000) });
          await tx.scheduleJob({ id: 'job:lost:' + t.id, kind: 'receipt-final', runAt: plus(T0, 600_000) });
          throw new Error('after the audit row');
        }),
      ).rejects.toThrow('after the audit row');
      expect(await store.readThread(a, t.id)).toMatchObject({ state: 'open', messages: [] });
      expect((await auditFor('thread:' + t.id)).map(e => e.action)).toEqual(['thread.acted']);
      expect(await hasJob('job:lost:' + t.id)).toBe(false);
      await store.transaction(tx => tx.scheduleJob({ id: 'job:' + t.id, kind: 'receipt-final', runAt: plus(T0, 1) }));
      expect(await hasJob('job:' + t.id)).toBe(true);
    });
  });
}
