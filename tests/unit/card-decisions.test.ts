import { expect, test } from 'bun:test';
import type { AuthenticatedContext, Thread } from '../../packages/contracts/src';
import { cardDecisions } from '../../apps/server/src/threads/usecases/decisions';
import { memoryThreadStore } from '../../apps/server/src/threads/adapters/memory';
import { draft } from '../store-contract';

const persona = { id: 'person' } as AuthenticatedContext;
async function world() {
  const store = memoryThreadStore(), t = draft(persona.id), approvals: Array<unknown> = [], calls: string[] = [];
  await store.transaction(tx => tx.insertThread(t));
  const registry = { allowed: (_p: unknown, name: string) => name.startsWith('raindance.') ? { connector: { id: 'raindance' }, capability: { kind: name === 'raindance.open' ? 'read' : 'execute' } } : undefined, viewFor: () => undefined };
  const uc = cardDecisions({ read: (p, id) => store.readThread(p.id, id), registry: registry as never, run: async (_p, name) => { calls.push(name); return { url: 'https://example.invalid' }; },
    approve: async (_p, input) => { approvals.push(input); }, clock: () => new Date('2026-11-04T06:00:00.000Z') });
  return { store, t, uc, approvals, calls };
}
test('a stored execute action always becomes an approval, even if the card labels it a read', async () => {
  const w = await world();
  await w.store.transaction(tx => tx.updateThread(w.t.id, { actions: w.t.actions.map(a => ({ ...a, kind: 'read' })) }));
  expect(await w.uc.act(persona, w.t.id, 'approve')).toMatchObject({ kind: 'execute' });
  expect(w.calls).toEqual([]); expect(w.approvals).toHaveLength(1);
  expect(w.approvals[0]).toMatchObject({ operation: 'raindance.approve', payload: { refs: ['raindance:inv:1'] }, presentation: { threadId: w.t.id } });
});
test('foreign actions, stale selections and another owner cannot approve effects', async () => {
  const w = await world();
  await expect(w.uc.act({ id: 'other' } as AuthenticatedContext, w.t.id, 'approve')).rejects.toThrow('Kortet finns inte.');
  await expect(w.uc.act(persona, w.t.id, 'approve', ['gone'])).rejects.toThrow('aktuellt');
  await w.store.transaction(tx => tx.updateThread(w.t.id, { actions: [{ ...w.t.actions[0]!, capability: 'other.execute' }] }));
  await expect(w.uc.act(persona, w.t.id, 'approve')).rejects.toThrow('Okänd förmåga.');
  expect(w.approvals).toEqual([]); expect(w.calls).toEqual([]);
});
test('a read action runs directly and an undo preserves the original receipt while approval is pending', async () => {
  const w = await world();
  await w.store.transaction(tx => tx.updateThread(w.t.id, { actions: [{ ...w.t.actions[0]!, capability: 'raindance.open', kind: 'read' }] }));
  expect(await w.uc.act(persona, w.t.id, 'approve')).toMatchObject({ kind: 'read' }); expect(w.approvals).toEqual([]);
  const receipt: Thread['receipt'] = { at: w.t.createdAt, headline: 'Klart', rows: [{ ref: 'raindance:inv:1', label: 'Faktura', detail: 'klar', outcome: 'done' }], undoCapability: 'raindance.undo', undoUntil: '2026-11-04T06:10:00.000Z' };
  await w.store.transaction(tx => tx.updateThread(w.t.id, { state: 'handled', receipt }));
  // Legacy evidence cannot authorize a blind compensation.
  await expect(w.uc.undoReceipt(persona, w.t.id)).rejects.toThrow('äldre kvittot');
  expect((await w.store.readThread(persona.id, w.t.id))?.receipt).toEqual(receipt);
});
