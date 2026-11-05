import { describe, expect, test } from 'bun:test';
import type { Execution, ExecutionStore } from '../apps/server/src/modules/executions/model';
export const executionRecord = (personId: string, id: string): Execution => ({ id, personId, decisionId: 'decision:' + personId, principal: 'person:' + personId, unitId: 'test', authorizationVersion: 'v1', connector: 'reference', operation: 'reference.complete', digest: 'input-digest', payload: { ref: 'reference:item:1', revision: 1 }, safety: { strategy: 'deduplicated', retentionSeconds: 86400, lookup: 'reference.lookup' }, state: 'pending', reason: null, result: null, compensates: null, createdAt: '2099-11-05T10:00:00.000Z', updatedAt: '2099-11-05T10:00:00.000Z', expiresAt: '2099-11-06T10:00:00.000Z', dispatchedAt: null, attempt: 0, leaseUntil: null });
export function executionStoreContract(name: string, create: () => Promise<{ store: ExecutionStore; personId: string; auditCount: () => Promise<number> }>) {
  describe(name + ' execution store', () => {
    test('concurrent approval identity has one owner, one approval audit and one delivery intent', async () => {
      const w = await create(), a = executionRecord(w.personId, w.personId + '-a'), b = { ...a, id: w.personId + '-b' };
      const reserve = (record: Execution) => w.store.transaction(async tx => {
        const saved = await tx.insert(record);
        if (saved.inserted) {
          await tx.audit({ actor: record.principal, action: 'execution.approved', subject: 'execution:' + record.id, at: record.createdAt });
          await tx.enqueue({ id: record.id, executionId: record.id, attempt: 0, leaseUntil: null, nextAt: record.createdAt, deliveredAt: null, lastError: null });
        }
        return saved.execution.id;
      });
      const [x, y] = await Promise.all([reserve(a), reserve(b)]);
      expect(x).toBe(y); expect(await w.auditCount()).toBe(1);
      const claimed = await w.store.claimDispatch(a.createdAt, a.expiresAt);
      expect(claimed?.executionId).toBe(x);
      expect(await w.store.claimDispatch(a.createdAt, a.expiresAt)).toBeUndefined();
    });
    test('rollback leaves no approved action, audit or dispatch intent', async () => {
      const w = await create(), e = executionRecord(w.personId, w.personId + '-rollback');
      await expect(w.store.transaction(async tx => {
        await tx.insert(e); await tx.audit({ actor: e.principal, action: 'execution.approved', subject: 'execution:' + e.id, at: e.createdAt });
        await tx.enqueue({ id: e.id, executionId: e.id, attempt: 0, leaseUntil: null, nextAt: e.createdAt, deliveredAt: null, lastError: null });
        throw new Error('crash');
      })).rejects.toThrow('crash');
      expect(await w.store.read(e.id)).toBeUndefined(); expect(await w.auditCount()).toBe(0);
      expect(await w.store.claimDispatch(e.createdAt, e.expiresAt)).toBeUndefined();
    });
    test('an expired delivery lease is reclaimed and an older acknowledgement cannot release it', async () => {
      const w = await create(), e = executionRecord(w.personId, w.personId + '-lease');
      await w.store.transaction(async tx => { await tx.insert(e); await tx.enqueue({ id: e.id, executionId: e.id, attempt: 0, leaseUntil: null, nextAt: e.createdAt, deliveredAt: null, lastError: null }); });
      const first = await w.store.claimDispatch(e.createdAt, e.createdAt);
      const second = await w.store.claimDispatch(e.createdAt, e.expiresAt);
      expect(second?.attempt).toBe(first!.attempt + 1);
      await w.store.finishDispatch(e.id, first!.attempt, e.createdAt, e.createdAt);
      expect(await w.store.claimDispatch(e.createdAt, e.expiresAt)).toBeUndefined();
      await w.store.finishDispatch(e.id, second!.attempt, e.createdAt, e.createdAt, 'retry');
      expect((await w.store.claimDispatch(e.createdAt, e.expiresAt))?.attempt).toBe(second!.attempt + 1);
    });
  });
}
