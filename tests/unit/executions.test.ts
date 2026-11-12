import { describe, expect, test } from 'bun:test';
import { SUBJECT_CHANGED, type AuthenticatedContext } from '../../packages/contracts/src/index';
import type { ExecuteResult } from '../../packages/connectors/src/index';
import { executionUsecases } from '../../apps/server/src/modules/executions/usecases';
import { memoryExecutionStore } from '../../apps/server/src/modules/executions/adapters/memory';
import type { ExecutionSource, WriteSafety } from '../../apps/server/src/modules/executions/model';

const result: ExecuteResult = {
  headline: 'Klar',
  rows: [{ ref: 'item:1', label: 'Sak', outcome: 'done', detail: 'Bekräftad' }],
};
const persona: AuthenticatedContext = {
  id: 'person',
  name: 'Person',
  unitId: 'unit',
  unitLabel: 'Unit',
  role: 'manager',
  organisationId: 'test',
  principal: { id: 'person:person', kind: 'person' },
  capabilities: [],
  authorizationVersion: 'v1',
  sessionBinding: 'test',
  expiresAt: '2099-01-01',
  authorize: async () => ({ version: 'v1' }),
};
function world(
  safety: WriteSafety = { strategy: 'deduplicated', retentionSeconds: 86400, lookup: 'test.lookup' },
  /** Each person's user name now (D116); absent, the world has no people port. */
  userNames?: Map<string, string | null>,
) {
  const store = memoryExecutionStore(),
    committed = new Map<string, ExecuteResult>();
  let now = Date.parse('2026-11-05T10:00:00Z'),
    id = 0,
    writes = 0,
    revoked = false,
    failAfterWrite = false,
    unavailable = false;
  const clock = () => new Date(now);
  const source: ExecutionSource = {
    authorize: async () => ({ connector: 'test', safety, needsSession: false }),
    current: async () => (revoked ? undefined : persona),
    execute: async (_, e) => {
      if (unavailable) throw new Error('down');
      if (!committed.has(e.id)) {
        writes++;
        committed.set(e.id, result);
      }
      if (failAfterWrite) throw new Error('reply lost');
      return committed.get(e.id)!;
    },
    lookup: async (_, e) => {
      if (unavailable) throw new Error('down');
      return committed.get(e.id);
    },
  };
  const uc = executionUsecases({
    store,
    source,
    clock,
    ids: () => 'e' + ++id,
    digest: input => JSON.stringify(input),
    ...(userNames ? { people: { userName: async (personId: string) => userNames.get(personId) ?? null } } : {}),
  });
  return {
    store,
    source,
    uc,
    clock,
    writes: () => writes,
    advance: (ms: number) => {
      now += ms;
    },
    revoke: () => {
      revoked = true;
    },
    loseReply: () => {
      failAfterWrite = true;
    },
    outage: (value: boolean) => {
      unavailable = value;
    },
    approve: () => uc.approve(persona, { decisionId: 'decision', operation: 'test.do', payload: { revision: 'r1' } }),
    /** A started action about a person (D116): the payload names them by the user name they had as it was decided. */
    approveAbout: (personId: string, userName: string, decisionId = 'decision') =>
      uc.approve(persona, {
        decisionId,
        operation: 'test.do',
        payload: { person: userName, revision: 'r1' },
        subject: { param: 'person', personId },
      }),
  };
}

describe('approved source execution', () => {
  test('concurrent approvals save one intent, approval audit and workflow start; changed content cannot reuse it', async () => {
    const w = world();
    const [a, b] = await Promise.all([w.approve(), w.approve()]);
    expect(a.id).toBe(b.id);
    expect(w.store.dump()).toHaveLength(1);
    expect(w.store.enqueued()).toEqual([{ workflow: 'approvedExecution', id: 'execution:' + a.id, input: a.id }]);
    expect(w.store.audit().map(e => e.action)).toEqual(['execution.approved']);
    expect(w.writes()).toBe(0);
    await expect(
      w.uc.approve(persona, { decisionId: 'decision', operation: 'test.do', payload: { revision: 'r2' } }),
    ).rejects.toThrow('annat innehåll');
    expect(w.store.audit()).toHaveLength(1);
  });
  test('concurrent workers produce one effect and one confirmed outcome', async () => {
    const w = world(),
      e = await w.approve();
    await Promise.all([w.uc.progress(e.id), w.uc.progress(e.id)]);
    expect(w.writes()).toBe(1);
    expect(await w.uc.read(persona, e.id)).toMatchObject({ state: 'succeeded', result });
    expect(w.store.audit().filter(e => e.action === 'execution.succeeded')).toHaveLength(1);
  });
  test('a lost reply is unknown, then read back without repeating the effect', async () => {
    const w = world(),
      e = await w.approve();
    w.loseReply();
    expect(await w.uc.progress(e.id)).toBe('reconcile');
    expect((await w.uc.read(persona, e.id))?.state).toBe('unknown');
    await w.uc.progress(e.id);
    expect((await w.uc.read(persona, e.id))?.state).toBe('succeeded');
    expect(w.writes()).toBe(1);
  });
  test('an expired worker lease with a persisted dispatch never blindly replays an unsafe write', async () => {
    const w = world({ strategy: 'manual' }),
      e = await w.approve();
    await w.store.transaction(async tx => {
      const row = (await tx.lock(e.id))!;
      await tx.update({ ...row, state: 'running', dispatchedAt: row.createdAt, leaseUntil: row.createdAt, attempt: 1 });
    });
    await w.uc.progress(e.id);
    expect(await w.uc.read(persona, e.id)).toMatchObject({ state: 'unknown', reason: 'manual-reconciliation' });
    expect(w.writes()).toBe(0);
  });
  test('after source commit and before receipt commit, a new worker recovers through lookup', async () => {
    const w = world(),
      approved = await w.approve();
    await w.store.transaction(async tx => {
      const e = (await tx.lock(approved.id))!;
      await tx.update({ ...e, state: 'running', dispatchedAt: e.createdAt, leaseUntil: e.createdAt, attempt: 1 });
    });
    await w.source.execute(persona, (await w.store.read(approved.id))!);
    await w.uc.progress(approved.id);
    expect((await w.uc.read(persona, approved.id))?.state).toBe('succeeded');
    expect(w.writes()).toBe(1);
  });
  test('stale authority blocks before dispatch and never causes an effect', async () => {
    const w = world(),
      e = await w.approve();
    w.revoke();
    await w.uc.progress(e.id);
    expect(await w.store.read(e.id)).toMatchObject({
      state: 'pending',
      reason: 'authority-revoked',
      dispatchedAt: null,
    });
    expect(w.writes()).toBe(0);
  });
  test('expired source deduplication and conditional absence cannot authorize a replay', async () => {
    for (const safety of [
      { strategy: 'deduplicated', retentionSeconds: 1, lookup: 'test.lookup' },
      { strategy: 'conditional', lookup: 'test.lookup' },
    ] as WriteSafety[]) {
      const w = world(safety),
        e = await w.approve();
      w.outage(true);
      await w.uc.progress(e.id);
      w.outage(false);
      w.advance(2000);
      await w.uc.progress(e.id);
      expect(await w.uc.read(persona, e.id)).toMatchObject({ state: 'unknown', reason: 'replay-not-safe' });
      expect(w.writes()).toBe(0);
    }
  });
  test('partial and unknown outcomes retain per-item evidence', async () => {
    const w = world();
    w.source.execute = async () => ({
      headline: 'Delvis klar',
      rows: [...result.rows, { ref: 'item:2', label: 'Sak 2', outcome: 'unknown', detail: 'Inget svar' }],
    });
    const e = await w.approve();
    await w.uc.progress(e.id);
    expect(await w.uc.read(persona, e.id)).toMatchObject({
      state: 'unknown',
      result: { rows: [{ outcome: 'done' }, { outcome: 'unknown' }] },
    });
  });
  test('a requested reconciliation starts a second workflow under its own stable id; the approval keeps its own (D86)', async () => {
    const w = world();
    const e = await w.approve();
    w.loseReply();
    await w.uc.progress(e.id);
    await w.uc.reconcile(persona, e.id);
    await w.uc.reconcile(persona, e.id);
    expect(w.store.enqueued().map(s => [s.id, s.input])).toEqual([
      ['execution:' + e.id, e.id],
      ['reconcile:' + e.id + ':1', e.id],
    ]);
  });

  test('source retirement retains an unknown outcome but fences queued progress and reconciliation', async () => {
    const w = world();
    const e = await w.approve();
    w.loseReply();
    await w.uc.progress(e.id);
    await w.store.transaction(async tx => {
      const row = (await tx.lock(e.id))!;
      await tx.update({ ...row, reason: 'source-reset', expiresAt: w.clock().toISOString(), attempt: row.attempt + 1 });
    });
    const starts = w.store.enqueued().length;
    expect(await w.uc.progress(e.id)).toBe('done');
    await w.uc.reconcile(persona, e.id);
    expect(w.store.enqueued()).toHaveLength(starts);
    expect(w.writes()).toBe(1);
    expect(await w.uc.read(persona, e.id)).toMatchObject({ state: 'unknown', reason: 'source-reset' });
  });
  test('source retirement preserves a receipt while making its old compensation unavailable', async () => {
    const w = world(),
      e = await w.approve();
    await w.uc.progress(e.id);
    const original = (await w.store.read(e.id))!;
    const { undoable } = await import('../../apps/server/src/modules/executions/domain');
    const withUndo = { ...original, result: { ...result, undoCapability: 'test.undo', undoMinutes: 10 } };
    expect(undoable(withUndo, persona.id, 'test.undo', 'test', w.clock().toISOString())).toBe(true);
    expect(
      undoable({ ...withUndo, reason: 'source-reset' }, persona.id, 'test.undo', 'test', w.clock().toISOString()),
    ).toBe(false);
  });

  test('transaction failure rolls back approval, audit and workflow start together', async () => {
    const w = world();
    const original = w.store.transaction;
    w.store.transaction = fn =>
      original(async tx => {
        const result = await fn(tx);
        throw new Error('crash before commit');
        return result;
      });
    await expect(w.approve()).rejects.toThrow('crash');
    expect(w.store.dump()).toEqual([]);
    expect(w.store.audit()).toEqual([]);
    expect(w.store.enqueued()).toEqual([]);
  });
});

test('execution evidence cannot be read, replayed, reconciled or undone under a new authority', async () => {
  const w = world();
  const approved = await w.approve();
  await w.uc.progress(approved.id);
  await w.store.transaction(async tx => {
    const e = (await tx.lock(approved.id))!;
    await tx.update({ ...e, result: { ...result, undoCapability: 'test.undo', undoMinutes: 10 } });
  });
  const before = w.store.audit();
  for (const changed of [
    { ...persona, unitId: 'other' },
    { ...persona, authorizationVersion: 'v2' },
  ]) {
    expect(await w.uc.read(changed, approved.id)).toBeUndefined();
    await expect(
      w.uc.approve(changed, { decisionId: 'decision', operation: 'test.do', payload: { revision: 'r1' } }),
    ).rejects.toThrow('finns inte');
    await expect(w.uc.reconcile(changed, approved.id)).rejects.toThrow('finns inte');
    await expect(
      w.uc.approve(changed, {
        decisionId: 'undo:' + approved.id,
        operation: 'test.undo',
        payload: { revision: 'r1' },
        compensates: approved.id,
      }),
    ).rejects.toThrow('kan inte ångras');
  }
  expect(w.store.dump()).toHaveLength(1);
  expect(w.store.audit()).toEqual(before);
  expect((await w.uc.read(persona, approved.id))?.result).toMatchObject(result);
});

describe('an approved action about a person (D116)', () => {
  const failed = (attempt = 1) => ({
    action: 'execution.failed',
    details: { attempt, reason: SUBJECT_CHANGED, outcomes: [] },
  });
  test("is sent while the user name it was decided with is still the person's, compared without case", async () => {
    const w = world(undefined, new Map([['p-anna', 'Anna.L']]));
    const e = await w.approveAbout('p-anna', 'anna.l');
    expect(await w.store.read(e.id)).toMatchObject({ subject: { param: 'person', personId: 'p-anna' } });
    await w.uc.progress(e.id);
    expect(await w.uc.read(persona, e.id)).toMatchObject({ state: 'succeeded', reason: null });
    expect(w.writes()).toBe(1);
  });
  test('a rename, a reused user name or a person gone before dispatch fails it unsent, with the reason audited', async () => {
    for (const [now, holder] of [
      ['anna.lindqvist', undefined],
      ['anna.lindqvist', 'p-annika'],
      [null, undefined],
    ] as const) {
      const names = new Map<string, string | null>([['p-anna', 'anna.l']]);
      const w = world(undefined, names);
      const e = await w.approveAbout('p-anna', 'anna.l');
      // Renamed, or gone; and in the second case someone else now holds the name the decision was made with.
      names.set('p-anna', now);
      if (holder) names.set(holder, 'anna.l');
      expect(await w.uc.progress(e.id)).toBe('done');
      expect(await w.store.read(e.id)).toMatchObject({ state: 'failed', reason: SUBJECT_CHANGED, dispatchedAt: null });
      expect(w.writes()).toBe(0);
      expect(w.store.audit().map(a => a.action)).toEqual([
        'execution.approved',
        'execution.claimed',
        'execution.failed',
      ]);
      expect(w.store.audit().at(-1)).toMatchObject(failed());
      // Settled: a later worker finds nothing to do and still sends nothing.
      expect(await w.uc.progress(e.id)).toBe('done');
      expect(w.writes()).toBe(0);
    }
  });
  test('a write already dispatched is read back, never replayed, once the name has moved', async () => {
    const names = new Map<string, string | null>([['p-anna', 'anna.l']]);
    const w = world(undefined, names);
    const e = await w.approveAbout('p-anna', 'anna.l');
    // A worker persisted the dispatch and died before the source answered; nothing reached the source.
    await w.store.transaction(async tx => {
      const row = (await tx.lock(e.id))!;
      await tx.update({ ...row, state: 'running', dispatchedAt: row.createdAt, leaseUntil: row.createdAt, attempt: 1 });
    });
    names.set('p-anna', 'anna.lindqvist');
    await w.uc.progress(e.id);
    // The source has no record of it and replay would be safe, but the name would reach someone else: unknown, unsent.
    expect(await w.store.read(e.id)).toMatchObject({ state: 'unknown', reason: SUBJECT_CHANGED });
    expect(w.writes()).toBe(0);
    expect(w.store.audit().at(-1)).toMatchObject({ action: 'execution.unknown', details: { reason: SUBJECT_CHANGED } });
    // A write the source did take is read back as it was, though Bo's name moved after it reached the source: the lookup
    // is no write, and it comes before the check of the name.
    const boNames = new Map<string, string | null>([['p-bo', 'bo.e']]);
    const sent = world(undefined, boNames);
    const done = await sent.approveAbout('p-bo', 'bo.e');
    await sent.store.transaction(async tx => {
      const row = (await tx.lock(done.id))!;
      await tx.update({ ...row, state: 'running', dispatchedAt: row.createdAt, leaseUntil: row.createdAt, attempt: 1 });
    });
    await sent.source.execute(persona, (await sent.store.read(done.id))!);
    boNames.set('p-bo', 'bo.ek');
    await sent.uc.progress(done.id);
    expect(await sent.uc.read(persona, done.id)).toMatchObject({ state: 'succeeded', reason: null });
    expect(sent.writes()).toBe(1);
  });
  test('without a people port nothing about a person is ever sent', async () => {
    const w = world();
    const e = await w.approveAbout('p-anna', 'anna.l');
    await w.uc.progress(e.id);
    expect(await w.store.read(e.id)).toMatchObject({ state: 'failed', reason: SUBJECT_CHANGED });
    expect(w.writes()).toBe(0);
  });
  test('the person decided for is part of the approved content, and an execution about nobody keeps none', async () => {
    const w = world(undefined, new Map([['p-anna', 'anna.l']]));
    await w.approveAbout('p-anna', 'anna.l');
    await expect(w.approveAbout('p-other', 'anna.l')).rejects.toThrow('annat innehåll');
    const other = world();
    expect(await other.store.read((await other.approve()).id)).toMatchObject({ subject: null });
  });
});
