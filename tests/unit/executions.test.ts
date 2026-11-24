import { describe, expect, test } from 'bun:test';
import { SUBJECT_CHANGED, type AuthenticatedContext } from '../../packages/contracts/src/index';
import type { ExecuteResult } from '../../packages/connectors/src/index';
import { executionUsecases, RECORDING_ATTEMPTS } from '../../apps/server/src/modules/executions/usecases';
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
  /** Each person's user name now (D122); absent, the world has no people port. */
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
    /** A started action about a person (D122): the payload names them by the user name they had as it was decided. */
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
  test("the approval row names the work item's unit when it is one of the person's, and only then (D135)", async () => {
    const w = world();
    const several: AuthenticatedContext = {
      ...persona,
      assignments: [
        { unitId: 'unit', unitLabel: 'Unit', role: 'manager' },
        { unitId: 'other', unitLabel: 'Other', role: 'manager' },
      ],
    };
    await w.uc.approve(several, {
      decisionId: 'd-held',
      operation: 'test.do',
      payload: { revision: 'r1' },
      unit: 'other',
    });
    await w.uc.approve(several, {
      decisionId: 'd-stray',
      operation: 'test.do',
      payload: { revision: 'r2' },
      unit: 'x',
    });
    await w.uc.approve(persona, {
      decisionId: 'd-one',
      operation: 'test.do',
      payload: { revision: 'r3' },
      unit: 'unit',
    });
    expect(w.store.audit().map(e => e.details?.unit)).toEqual(['other', undefined, undefined]);
    // The execution itself acts as the primary unit, whatever the card was about.
    expect(w.store.dump().map(e => e.unitId)).toEqual(['unit', 'unit', 'unit']);
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
  test('a requested reconciliation starts a workflow of its own per request; the approval keeps its own (D86, DE-L1)', async () => {
    const w = world();
    const e = await w.approve();
    w.loseReply();
    await w.uc.progress(e.id);
    // The same request twice at one instant is one workflow; a later one is another, so a request whose workflow ended
    // in error before it claimed anything never swallows the next.
    await w.uc.reconcile(persona, e.id);
    await w.uc.reconcile(persona, e.id);
    w.advance(1_000);
    await w.uc.reconcile(persona, e.id);
    const at = Date.parse(w.clock().toISOString());
    expect(w.store.enqueued().map(s => [s.id, s.input])).toEqual([
      ['execution:' + e.id, e.id],
      [`reconcile:${e.id}:1:${at - 1_000}`, e.id],
      [`reconcile:${e.id}:1:${at}`, e.id],
    ]);
  });
  test('a decision still waiting to be sent is started again by a check, and a settled one is left as it is (DE-L1)', async () => {
    const w = world();
    const e = await w.approve();
    const before = w.store.audit().length;
    await w.uc.reconcile(persona, e.id);
    expect(w.store.enqueued().filter(s => s.id.startsWith('reconcile:'))).toHaveLength(1);
    expect(w.store.audit().slice(before)).toEqual([
      expect.objectContaining({ action: 'execution.reconciliation_requested', subject: 'execution:' + e.id }),
    ]);
    expect(await w.uc.progress(e.id)).toBe('done');
    expect(w.writes()).toBe(1);
    const settled = w.store.audit().length;
    w.advance(1_000);
    await w.uc.reconcile(persona, e.id);
    expect(w.store.enqueued().filter(s => s.id.startsWith('reconcile:'))).toHaveLength(1);
    expect(w.store.audit()).toHaveLength(settled);
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

test('a decision in doubt is let go by its own person only: it fails in their name with its audit row, nothing is sent, and nothing after it runs it (DE-M2)', async () => {
  const w = world();
  const e = await w.approve();
  // Still to be sent: there is no doubt to end.
  await expect(w.uc.release(persona, e.id)).rejects.toThrow('Beslutet väntar inte längre på besked.');
  w.loseReply();
  expect(await w.uc.progress(e.id)).toBe('reconcile');
  expect((await w.uc.read(persona, e.id))?.state).toBe('unknown');
  const lease = (state: 'running' | 'unknown', leaseUntil: string | null) =>
    w.store.transaction(async tx => {
      const row = (await tx.lock(e.id))!;
      await tx.update({ ...row, state, leaseUntil });
    });
  // Being read back right now: left to that check. A check whose lease has passed holds nothing.
  await lease('running', '2099-01-01T00:00:00.000Z');
  await expect(w.uc.release(persona, e.id)).rejects.toThrow('Beslutet kontrolleras just nu.');
  await lease('unknown', null);
  // Nobody under another authority can.
  await expect(w.uc.release({ ...persona, unitId: 'other' }, e.id)).rejects.toThrow('finns inte');
  const before = w.store.audit().length;
  w.advance(60_000);
  expect(await w.uc.release(persona, e.id)).toMatchObject({
    state: 'failed',
    reason: 'released-by-person',
    updatedAt: '2026-11-05T10:01:00.000Z',
  });
  expect(w.store.audit().slice(before)).toEqual([
    expect.objectContaining({
      actor: 'person:person',
      action: 'execution.released',
      subject: 'execution:' + e.id,
      at: '2026-11-05T10:01:00.000Z',
      details: expect.objectContaining({ attempt: 1 }),
    }),
  ]);
  // A check asked for after it, or one already queued, finds it settled: nothing more is sent.
  await w.uc.reconcile(persona, e.id);
  expect(await w.uc.progress(e.id)).toBe('done');
  expect(await w.uc.read(persona, e.id)).toMatchObject({ state: 'failed', reason: 'released-by-person' });
  expect(w.writes()).toBe(1);
  expect(w.store.audit().slice(before)).toHaveLength(1);
  // Let go once.
  await expect(w.uc.release(persona, e.id)).rejects.toThrow('Beslutet väntar inte längre på besked.');
});
test('a decision in doubt whose source confirmed some rows is let go as partial: those rows went through (DE-M2)', async () => {
  const w = world();
  const e = await w.approve();
  w.loseReply();
  await w.uc.progress(e.id);
  await w.store.transaction(async tx => {
    const row = (await tx.lock(e.id))!;
    await tx.update({
      ...row,
      result: {
        ...result,
        rows: [
          { ...result.rows[0]!, outcome: 'done' },
          { ...result.rows[0]!, ref: 'second', outcome: 'unknown' },
        ],
      } as never,
    });
  });
  expect(await w.uc.release(persona, e.id)).toMatchObject({ state: 'partial', reason: 'released-by-person' });
  expect(w.store.audit().at(-1)).toMatchObject({
    action: 'execution.released',
    details: { outcomes: ['done', 'unknown'] },
  });
  expect(w.writes()).toBe(1);
});
test('an undo in doubt is not let go: the original receipt stands whatever became of it (DE-M2)', async () => {
  const w = world();
  const original = await w.approve();
  await w.uc.progress(original.id);
  await w.store.transaction(async tx => {
    const e = (await tx.lock(original.id))!;
    await tx.update({ ...e, result: { ...result, undoCapability: 'test.undo', undoMinutes: 10 } });
  });
  const { undoInputOf } = await import('../../apps/server/src/modules/executions/domain');
  const undo = await w.uc.approve(persona, {
    decisionId: 'undo:' + original.id,
    operation: 'test.undo',
    payload: undoInputOf((await w.store.read(original.id))!),
    compensates: original.id,
  });
  w.loseReply();
  await w.uc.progress(undo.id);
  expect((await w.uc.read(persona, undo.id))?.state).toBe('unknown');
  await expect(w.uc.release(persona, undo.id)).rejects.toThrow('Beslutet väntar inte längre på besked.');
  expect((await w.uc.read(persona, undo.id))?.state).toBe('unknown');
});
test('one confirmed effect is undone once: an undo is the decision undo:<original>, so a second is the first replayed (DE-L5)', async () => {
  const w = world();
  const approved = await w.approve();
  await w.uc.progress(approved.id);
  await w.store.transaction(async tx => {
    const e = (await tx.lock(approved.id))!;
    await tx.update({ ...e, result: { ...result, undoCapability: 'test.undo', undoMinutes: 10 } });
  });
  const { undoInputOf } = await import('../../apps/server/src/modules/executions/domain');
  const payload = undoInputOf((await w.store.read(approved.id))!);
  const undo = (decisionId: string) =>
    w.uc.approve(persona, { decisionId, operation: 'test.undo', payload, compensates: approved.id });
  // Any other name for an undo is refused before anything is read or written, so the approval endpoint cannot make a
  // second compensation of the same effect under a new decision.
  for (const other of ['undo-again', 'undo:' + approved.id + '-2', 'undo:other'])
    await expect(undo(other)).rejects.toThrow('Ogiltigt beslut.');
  // Nor may a decision that undoes nothing take an undo's name ahead of it.
  await expect(
    w.uc.approve(persona, { decisionId: 'undo:' + approved.id, operation: 'test.do', payload: { revision: 'r1' } }),
  ).rejects.toThrow('Ogiltigt beslut.');
  const first = await undo('undo:' + approved.id);
  const again = await undo('undo:' + approved.id);
  expect(again.id).toBe(first.id);
  expect(w.store.dump().filter(e => e.compensates === approved.id)).toHaveLength(1);
  expect(w.store.audit().filter(row => row.action === 'execution.approved')).toHaveLength(2);
});

test("a failure of Clew's own while the source's answer is recorded is logged and thrown, never stored as the source not answering (DE-M3)", async () => {
  const w = world();
  let failing = true;
  const logged: unknown[][] = [];
  // Where the PostgreSQL adapter writes the card's projection with the execution: a constraint, another module's port.
  const store: typeof w.store = {
    ...w.store,
    transaction: fn =>
      w.store.transaction(tx =>
        fn({
          ...tx,
          update: async e => {
            if (failing && e.state === 'succeeded') throw new Error('duplicate key value');
            await tx.update(e);
          },
        }),
      ),
  };
  const uc = executionUsecases({
    store,
    source: w.source,
    clock: w.clock,
    ids: () => 'e1',
    digest: input => JSON.stringify(input),
    log: (...line) => void logged.push(line),
  });
  const e = await uc.approve(persona, { decisionId: 'decision', operation: 'test.do', payload: { revision: 'r1' } });
  await expect(uc.progress(e.id)).rejects.toThrow('duplicate key value');
  // The source answered and wrote once; nothing says it did not answer, and the error is logged by its name alone.
  expect(w.writes()).toBe(1);
  expect(await w.store.read(e.id)).toMatchObject({ state: 'running', reason: null });
  expect(logged).toEqual([
    [
      'execution: the answer could not be recorded',
      { execution: e.id, operation: 'test.do', attempt: 1, error: 'Error' },
    ],
  ]);
  // The workflow tries again: inside the lease the step is busy; after it, the source is read back and recorded.
  expect(await uc.progress(e.id)).toBe('busy');
  // While the lease runs a check starts nothing; once it has passed, the step's workflow may have given up (DE-L1), and
  // "Kontrollera status" starts the execution again.
  const started = () => w.store.enqueued().filter(s => s.id.startsWith('reconcile:'));
  await uc.reconcile(persona, e.id);
  expect(started()).toEqual([]);
  w.advance(121_000);
  await uc.reconcile(persona, e.id);
  expect(started()).toEqual([
    { workflow: 'approvedExecution', id: `reconcile:${e.id}:1:${Date.parse(w.clock().toISOString())}`, input: e.id },
  ]);
  failing = false;
  expect(await uc.progress(e.id)).toBe('done');
  expect(await w.store.read(e.id)).toMatchObject({ state: 'succeeded', reason: null });
  expect(w.writes()).toBe(1);
});

test('a recording that fails at every claim stops at the bound, and its person may then let it go (DE-M3)', async () => {
  const w = world();
  const logged: unknown[][] = [];
  const store: typeof w.store = {
    ...w.store,
    transaction: fn =>
      w.store.transaction(tx =>
        fn({
          ...tx,
          update: async e => {
            if (e.state === 'succeeded') throw new Error('duplicate key value');
            await tx.update(e);
          },
        }),
      ),
  };
  const uc = executionUsecases({
    store,
    source: w.source,
    clock: w.clock,
    ids: () => 'e1',
    digest: input => JSON.stringify(input),
    log: (...line) => void logged.push(line),
  });
  const e = await uc.approve(persona, { decisionId: 'decision', operation: 'test.do', payload: { revision: 'r1' } });
  // Each claim after a lease reads the source back and fails to record it again, until the bound: then the step ends.
  let thrown = 0,
    ended = false;
  for (let claim = 0; claim < 3 * RECORDING_ATTEMPTS && !ended; claim++) {
    try {
      ended = (await uc.progress(e.id)) === 'done';
    } catch {
      thrown++;
    }
    w.advance(121_000);
  }
  expect(ended).toBe(true);
  expect(thrown).toBe(RECORDING_ATTEMPTS - 1);
  expect(await w.store.read(e.id)).toMatchObject({ state: 'running', attempt: RECORDING_ATTEMPTS });
  expect(logged.at(-1)?.[0]).toBe(
    'execution: the answer could not be recorded, and is not tried again until it is checked',
  );
  expect(w.writes()).toBe(1);
  // Its lease has passed and nobody holds it: the person who has seen the source may let it go.
  expect(await uc.release(persona, e.id)).toMatchObject({ state: 'failed', reason: 'released-by-person' });
  expect(w.writes()).toBe(1);
});

test('the rows a work item’s decisions carried out are what no undo took back, across every decision on it (DE-M1)', async () => {
  const { doneOnCard } = await import('../../apps/server/src/modules/executions/domain');
  const row = (ref: string, outcome: 'done' | 'failed' | 'unknown') => ({ ref, label: ref, outcome, detail: '' });
  const e = (id: string, state: string, rows: ReturnType<typeof row>[], compensates: string | null = null) =>
    ({ id, state, compensates, result: { headline: '', rows } }) as never;
  expect(
    doneOnCard([
      // A part, then a refusal of the rest: the first row stays done.
      e('a', 'partial', [row('inv:1', 'done'), row('inv:2', 'failed')]),
      e('b', 'failed', [row('inv:2', 'failed')]),
      // Released in doubt with one row confirmed: that row is done.
      e('c', 'partial', [row('inv:3', 'done'), row('inv:4', 'unknown')]),
      // Done, then undone in part, then that undo's rest refused: only what the undo confirmed is taken back.
      e('d', 'succeeded', [row('inv:5', 'done'), row('inv:6', 'done')]),
      e('u1', 'partial', [row('inv:5', 'done'), row('inv:6', 'failed')], 'd'),
      // Done and undone as a whole; an undo that was refused takes nothing back.
      e('f', 'succeeded', [row('inv:7', 'done')]),
      e('u2', 'succeeded', [row('inv:7', 'done')], 'f'),
      e('g', 'succeeded', [row('inv:8', 'done')]),
      e('u3', 'failed', [row('inv:8', 'failed')], 'g'),
    ]),
  ).toEqual(['inv:1', 'inv:3', 'inv:6', 'inv:8']);
});

describe('an approved action about a person (D122)', () => {
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
  test('an action its source wrote keeps no person and is sent as written, whoever holds a user name in it now (item 5)', async () => {
    const names = new Map<string, string | null>([['p-anna', 'anna.l']]);
    const w = world(undefined, names);
    // A pushed card's action, or a started propose's: the source wrote its input, so the decision keeps no person.
    const e = await w.uc.approve(persona, {
      decisionId: 'decision',
      operation: 'test.do',
      payload: { person: 'anna.l', revision: 'r1' },
    });
    expect(await w.store.read(e.id)).toMatchObject({ subject: null });
    // The name moves to someone else before dispatch. Nothing compares it: the source answers for whoever holds it.
    names.set('p-anna', 'anna.lindqvist');
    names.set('p-annika', 'anna.l');
    await w.uc.progress(e.id);
    expect(await w.uc.read(persona, e.id)).toMatchObject({ state: 'succeeded', reason: null });
    expect(w.writes()).toBe(1);
  });
});
