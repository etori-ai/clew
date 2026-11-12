import { describe, expect, test } from 'bun:test';
import type { Subject, Thread } from '../packages/contracts/src/index';
import type { AuditEntry, NewThread, ThreadStore, WorkflowStart } from '../apps/server/src/threads/model';
import { reminderStart, reminderWorkflowId } from '../apps/server/src/threads/domain';

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
  /** The workflow starts committed under ids with this prefix (D86): the memory adapter's list, the engine's queue rows in Postgres. */
  enqueued(prefix: string): Promise<WorkflowStart[]>;
  /** The workflow ids whose wait a committed transaction ended, in order. */
  cancelled(): Promise<string[]>;
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
    sourceAuthorization: 'v1',
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
    test('a workflow start commits with its timer and rolls back with it; an ended wait is cancelled after the commit', async () => {
      const {
        store,
        people: [a],
        enqueued,
        cancelled,
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
          const timer = await tx.scheduleTimer(input);
          await tx.enqueue(reminderStart(timer));
          throw new Error('rollback');
        }),
      ).rejects.toThrow('rollback');
      expect(await enqueued(id)).toEqual([]);
      expect(await cancelled()).toEqual([]);
      const first = await store.transaction(async tx => {
        await tx.lockThread(a, t.id);
        const timer = await tx.scheduleTimer(input);
        await tx.enqueue(reminderStart(timer));
        await tx.enqueue(reminderStart(timer));
        return timer;
      });
      expect(await enqueued(id)).toEqual([
        { workflow: 'durableReminder', id: `${id}:v2:1`, input: { id, generation: 1, dueAt: input.dueAt } },
      ]);
      // The start commits with the row, so the timer is scheduled as soon as it exists.
      expect((await store.readThread(a, t.id))?.timers).toEqual([
        { kind: 'reminder', dueAt: input.dueAt, state: 'scheduled' },
      ]);
      // Replacing cancels the previous generation after the commit; cancelling ends the current one; a rolled-back cancel ends nothing.
      const second = await store.transaction(async tx => {
        await tx.lockThread(a, t.id);
        const timer = await tx.scheduleTimer({ ...input, dueAt: plus(T0, 120_000) });
        await tx.enqueue(reminderStart(timer));
        return timer;
      });
      expect(await cancelled()).toEqual([reminderWorkflowId(first)]);
      await expect(
        store.transaction(async tx => {
          await tx.lockThread(a, t.id);
          await tx.cancelTimer(id, plus(T0, 1000));
          throw new Error('rollback');
        }),
      ).rejects.toThrow('rollback');
      expect(await cancelled()).toEqual([reminderWorkflowId(first)]);
      await store.transaction(async tx => {
        await tx.lockThread(a, t.id);
        expect(await tx.cancelTimer(id, plus(T0, 1000))).toBe(true);
      });
      expect(await cancelled()).toEqual([reminderWorkflowId(first), reminderWorkflowId(second)]);
      expect((await enqueued(id)).map(s => s.id)).toEqual([`${id}:v2:1`, `${id}:v2:2`]);
    });
    test("a system timer (`obligation`, `due`) is stored and fenced like any timer, but only the person's own are listed on the thread (D96)", async () => {
      const {
        store,
        people: [a],
        enqueued,
        cancelled,
      } = await make();
      const t = draft(a);
      await store.transaction(tx => tx.insertThread(t));
      const timer = (kind: 'reminder' | 'obligation' | 'due', dueAt: string) => ({
        id: `${kind}:${t.id}`,
        personId: a,
        threadId: t.id,
        kind,
        unitId: 'unit',
        authorizationVersion: 'v1',
        dueAt,
        requestedAt: T0,
      });
      const due = await store.transaction(async tx => {
        await tx.lockThread(a, t.id);
        const scheduled = await tx.scheduleTimer(timer('due', plus(T0, 86400_000)));
        await tx.enqueue(reminderStart(scheduled));
        await tx.scheduleTimer(timer('obligation', plus(T0, 3600_000)));
        return scheduled;
      });
      expect(await store.readTimer(`due:${t.id}`)).toMatchObject({ kind: 'due', state: 'active', generation: 1 });
      expect(await enqueued(`due:${t.id}`)).toEqual([reminderStart(due)]);
      expect((await store.readThread(a, t.id))?.timers).toBeUndefined();
      expect((await store.listThreads(a, T0)).find(row => row.id === t.id)?.timers).toBeUndefined();
      await store.transaction(async tx => {
        await tx.lockThread(a, t.id);
        await tx.scheduleTimer(timer('reminder', plus(T0, 60_000)));
        // A new generation of the same slot replaces the old one's wait.
        expect((await tx.scheduleTimer(timer('due', plus(T0, 2 * 86400_000)))).generation).toBe(2);
      });
      expect((await store.readThread(a, t.id))?.timers).toEqual([
        { kind: 'reminder', dueAt: plus(T0, 60_000), state: 'scheduled' },
      ]);
      expect(await cancelled()).toEqual([reminderWorkflowId(due)]);
    });
    test('a thread and its source authority are read back as stored, only by its owner', async () => {
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
    test("an action's read-receipt mark is kept with the action and read back as stored (D111)", async () => {
      const {
        store,
        people: [a],
      } = await make();
      const receipt = {
        id: 'ack',
        label: 'Jag har läst',
        capability: 'communication.acknowledge',
        kind: 'execute' as const,
        role: 'primary' as const,
        acknowledgement: { publishedAt: '2026-11-10T06:30:00+01:00' },
      };
      const t = draft(a, { connector: 'communication', area: 'communication', actions: [receipt] });
      await store.transaction(tx => tx.insertThread(t));
      expect((await store.readThread(a, t.id))!.actions).toEqual([receipt]);
      expect((await store.readThreadById(t.id))!.actions).toEqual([receipt]);
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
      // A conversation turn writes the question and the answer at the same instant (assistant/index.ts); they come back
      // in the order they were written, never the answer first.
      await store.transaction(async tx => {
        await tx.addMessage(t.id, { role: 'user', body: 'Vad är detta?', at: plus(T0, 2000) });
        await tx.addMessage(t.id, { role: 'assistant', body: 'Ett meddelande om en ny rutin.', at: plus(T0, 2000) });
      });
      expect((await store.readThread(a, t.id))!.messages.slice(1).map(m => [m.role, m.body])).toEqual([
        ['user', 'Attestera valda'],
        ['user', 'Vad är detta?'],
        ['assistant', 'Ett meddelande om en ny rutin.'],
      ]);
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
    test('the index from entity to cards follows the rows it is written with: owner only, case, open work only (D97)', async () => {
      const {
        store,
        people: [a, b],
      } = await make();
      const run = unique();
      const anna = { entity: 'person' as const, key: `Anna.L-${run}` },
        erik = { entity: 'person' as const, key: `erik-${run}` },
        maria = { entity: 'person' as const, key: `maria-${run}` },
        skola = { entity: 'unit' as const, key: `unit-Skola-${run}` };
      const row = (ref: string, subject?: Subject) => ({
        ref,
        label: 'En rad',
        detail: 'som källan skrev den',
        selectable: false,
        selected: false,
        ...(subject ? { subject } : {}),
      });
      const rows = draft(a, { items: [row('r:1', anna), row('r:2', skola), row('r:3')], createdAt: plus(T0, 1000) });
      const own = draft(a, { items: [], subjects: [erik], createdAt: plus(T0, 2000) });
      const handled = draft(a, { items: [row('r:4', anna)], createdAt: plus(T0, 3000) });
      const theirs = draft(b, { items: [row('r:5', anna)] });
      await store.transaction(async tx => {
        for (const t of [rows, own, handled, theirs]) await tx.insertThread(t);
        await tx.updateThread(handled.id, { state: 'handled', handledAt: plus(T0, 3000) });
      });
      const ids = async (person: string, subjects: Subject[]) =>
        (await store.threadsNaming(person, subjects)).map(n => [n.thread.id, n.subjects]);
      // A person's key without regard to case, in the spelling asked; a unit's id exactly; the thread's own subject too.
      expect(await ids(a, [{ ...anna, key: anna.key.toLowerCase() }])).toEqual([
        [rows.id, [{ ...anna, key: anna.key.toLowerCase() }]],
      ]);
      expect(await ids(a, [anna, erik, { ...skola, key: skola.key.toLowerCase() }])).toEqual([
        [own.id, [erik]],
        [rows.id, [anna]],
      ]);
      expect(await ids(a, [skola, anna])).toEqual([[rows.id, [skola, anna]]]);
      expect(await ids(b, [anna])).toEqual([[theirs.id, [anna]]]);
      expect(await ids(a, [maria])).toEqual([]);
      expect(await store.threadsNaming(a, [])).toEqual([]);
      // Read back as written: the row's subject and the thread's own.
      expect((await store.readThread(a, rows.id))!.items.map(i => i.subject)).toEqual([anna, skola, undefined]);
      expect((await store.readThread(a, own.id))!.subjects).toEqual([erik]);
      // New rows, new index; a card open again is work again.
      await store.transaction(async tx => {
        await tx.updateThread(rows.id, { items: [row('r:1', maria)] });
        await tx.updateThread(handled.id, { state: 'open', handledAt: null });
      });
      expect(await ids(a, [anna])).toEqual([[handled.id, [anna]]]);
      expect(await ids(a, [maria, skola])).toEqual([[rows.id, [maria]]]);
      // A rolled-back write leaves the index as it was.
      await expect(
        store.transaction(async tx => {
          await tx.updateThread(rows.id, { items: [row('r:1', anna)] });
          throw new Error('rollback');
        }),
      ).rejects.toThrow('rollback');
      expect(await ids(a, [maria])).toEqual([[rows.id, [maria]]]);
    });
    test('erasing an entity takes it off every row and thread of every person, leaves the text and rolls back with the transaction (D97)', async () => {
      const {
        store,
        people: [a, b],
        auditFor,
      } = await make();
      const run = unique();
      const gone = { entity: 'person' as const, key: `Erik.S-${run}` },
        kept = { entity: 'person' as const, key: `maria-${run}` };
      const row = (ref: string, subject: typeof gone) => ({
        ref,
        label: 'Erik Sund sjuk 10–11 nov',
        detail: '2 pass berörs',
        selectable: true,
        selected: true,
        subject,
      });
      const mine = draft(a, { items: [row('r:1', gone), row('r:2', kept)], subjects: [gone, kept] });
      const theirs = draft(b, { items: [row('r:3', { ...gone, key: gone.key.toLowerCase() })] });
      await store.transaction(async tx => {
        await tx.insertThread(mine);
        await tx.insertThread(theirs);
      });
      const entry = { actor: 'operator:cli', action: 'thread.subject_erased', subject: 'thread:' + mine.id, at: T0 };
      await expect(
        store.transaction(async tx => {
          await tx.eraseSubject(gone);
          await tx.writeAudit(entry);
          throw new Error('after the audit row');
        }),
      ).rejects.toThrow('after the audit row');
      expect((await store.threadsNaming(a, [gone])).map(n => n.thread.id)).toEqual([mine.id]);
      expect((await store.readThread(b, theirs.id))!.items[0]!.subject).toEqual({
        ...gone,
        key: gone.key.toLowerCase(),
      });
      expect(await auditFor('thread:' + mine.id)).toEqual([]);
      expect(await store.transaction(tx => tx.eraseSubject({ ...gone, key: gone.key.toUpperCase() }))).toEqual({
        cards: 2,
        rows: 2,
        cardSubjects: 1,
      });
      expect(await store.threadsNaming(a, [gone])).toEqual([]);
      expect(await store.threadsNaming(b, [gone])).toEqual([]);
      expect((await store.threadsNaming(a, [kept])).map(n => n.thread.id)).toEqual([mine.id]);
      const read = (await store.readThread(a, mine.id))!;
      expect(read.items).toEqual([
        { ref: 'r:1', label: 'Erik Sund sjuk 10–11 nov', detail: '2 pass berörs', selectable: true, selected: true },
        row('r:2', kept),
      ]);
      expect(read.subjects).toEqual([kept]);
      // Nothing the person decided on moves.
      expect(read.updatedAt).toBe(mine.updatedAt);
      expect((await store.readThread(b, theirs.id))!.items[0]!.subject).toBeUndefined();
      expect(await store.transaction(tx => tx.eraseSubject(gone))).toEqual({ cards: 0, rows: 0, cardSubjects: 0 });
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
    test("an item's history is its subjects' committed audit rows, oldest first, the newest within the limit (D111)", async () => {
      const {
        store,
        people: [a],
      } = await make();
      const t = draft(a);
      const subject = 'thread:' + t.id,
        timer = `timer:reminder:${t.id}`;
      const row = (action: string, ms: number, on = subject) => ({
        actor: 'person:' + a,
        action,
        subject: on,
        at: plus(T0, ms),
        details: { n: ms },
      });
      await store.transaction(async tx => {
        await tx.insertThread(t);
        // Written out of order: the history is ordered by when, not by when it was written.
        await tx.writeAudit(row('thread.snoozed', 2000));
        await tx.writeAudit(row('thread.pushed', 1000));
        await tx.writeAudit(row('timer.blocked', 3000, timer));
        await tx.writeAudit(row('thread.dismissed', 4000, 'thread:another'));
      });
      await expect(
        store.transaction(async tx => {
          await tx.writeAudit(row('thread.reopened', 5000));
          throw new Error('rolled back');
        }),
      ).rejects.toThrow('rolled back');
      const shape = (rows: Awaited<ReturnType<typeof store.history>>) =>
        rows.map(r => ({ action: r.action, subject: r.subject, at: r.at, details: r.details ?? {} }));
      expect(shape(await store.history([subject, timer], 10))).toEqual([
        { action: 'thread.pushed', subject, at: plus(T0, 1000), details: { n: 1000 } },
        { action: 'thread.snoozed', subject, at: plus(T0, 2000), details: { n: 2000 } },
        { action: 'timer.blocked', subject: timer, at: plus(T0, 3000), details: { n: 3000 } },
      ]);
      expect((await store.history([subject, timer], 2)).map(r => r.action)).toEqual([
        'thread.snoozed',
        'timer.blocked',
      ]);
      expect(await store.history(['thread:nothing'], 10)).toEqual([]);
    });
  });
}
