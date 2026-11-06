import { describe, expect, test } from 'bun:test';
import type { AuthenticatedContext } from '../../packages/contracts/src/index';
import type { ExecuteResult } from '../../packages/connectors/src/index';
import { executionUsecases } from '../../apps/server/src/modules/executions/usecases';
import { executionDispatcher } from '../../apps/server/src/modules/executions/dispatch';
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
function world(safety: WriteSafety = { strategy: 'deduplicated', retentionSeconds: 86400, lookup: 'test.lookup' }) {
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
  const uc = executionUsecases({ store, source, clock, ids: () => 'e' + ++id, digest: input => JSON.stringify(input) });
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
  };
}

describe('approved source execution', () => {
  test('concurrent approvals save one intent, approval audit and outbox; changed content cannot reuse it', async () => {
    const w = world();
    const [a, b] = await Promise.all([w.approve(), w.approve()]);
    expect(a.id).toBe(b.id);
    expect(w.store.dump()).toHaveLength(1);
    expect(w.store.outbox()).toHaveLength(1);
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
  test('outbox retries outages and lost acknowledgements using the same workflow identity', async () => {
    const w = world();
    await w.approve();
    const calls: string[] = [];
    let unavailable = true;
    const tick = executionDispatcher({
      store: w.store,
      clock: w.clock,
      start: async id => {
        calls.push(id);
        if (unavailable) throw new Error('Temporal away');
      },
    });
    await tick();
    expect(w.store.outbox()[0]?.deliveredAt).toBeNull();
    unavailable = false;
    w.advance(3000);
    await tick();
    expect(new Set(calls).size).toBe(1);
    expect(w.store.outbox()[0]?.deliveredAt).not.toBeNull();
  });
  test('transaction failure rolls back approval, audit and outbox together', async () => {
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
    expect(w.store.outbox()).toEqual([]);
  });
});
