import { expect, test } from 'bun:test';
import type { AuthenticatedContext, Thread } from '../../packages/contracts/src';
import { cardDecisions } from '../../apps/server/src/threads/usecases/decisions';
import { memoryThreadStore } from '../../apps/server/src/threads/adapters/memory';
import { draft } from '../store-contract';

const persona = { id: 'person' } as AuthenticatedContext;
async function world(answer: (name: string) => unknown = () => ({ url: 'https://example.invalid' })) {
  const store = memoryThreadStore(),
    t = draft(persona.id),
    approvals: Array<unknown> = [],
    calls: string[] = [];
  await store.transaction(tx => tx.insertThread(t));
  const reads = ['finance.open', 'finance.preview'];
  const registry = {
    allowed: (_p: unknown, name: string) =>
      name.startsWith('finance.')
        ? { connector: { id: 'finance' }, capability: { kind: reads.includes(name) ? 'read' : 'execute' } }
        : undefined,
    viewFor: () => undefined,
  };
  const uc = cardDecisions({
    read: (p, id) => store.readThread(p.id, id),
    registry: registry as never,
    run: async (_p, name) => {
      calls.push(name);
      return answer(name);
    },
    approve: async (_p, input) => {
      approvals.push(input);
    },
    clock: () => new Date('2026-11-04T06:00:00.000Z'),
  });
  return { store, t, uc, approvals, calls };
}
test('a stored execute action always becomes an approval, even if the card labels it a read', async () => {
  const w = await world();
  await w.store.transaction(tx => tx.updateThread(w.t.id, { actions: w.t.actions.map(a => ({ ...a, kind: 'read' })) }));
  expect(await w.uc.act(persona, w.t.id, 'approve')).toMatchObject({ kind: 'execute' });
  expect(w.calls).toEqual([]);
  expect(w.approvals).toHaveLength(1);
  expect(w.approvals[0]).toMatchObject({
    operation: 'finance.approve',
    payload: { refs: ['finance:inv:1'] },
    presentation: { threadId: w.t.id },
  });
});
test('foreign actions, stale selections and another owner cannot approve effects', async () => {
  const w = await world();
  await expect(w.uc.act({ id: 'other' } as AuthenticatedContext, w.t.id, 'approve')).rejects.toThrow(
    'Kortet finns inte.',
  );
  await expect(w.uc.act(persona, w.t.id, 'approve', ['gone'])).rejects.toThrow('aktuellt');
  await w.store.transaction(tx =>
    tx.updateThread(w.t.id, { actions: [{ ...w.t.actions[0]!, capability: 'other.execute' }] }),
  );
  await expect(w.uc.act(persona, w.t.id, 'approve')).rejects.toThrow('Okänd förmåga.');
  expect(w.approvals).toEqual([]);
  expect(w.calls).toEqual([]);
});
test("a preview is a read of the card's own rows through the action's preview capability, checked against the contract (D70)", async () => {
  const good = {
    title: 'Faktura 1',
    mediaType: 'image/svg+xml' as const,
    data: Buffer.from('<svg/>').toString('base64'),
  };
  const w = await world(name => (name === 'finance.preview' ? good : { nonsense: true }));
  // Without a reviewed action there is nothing to show.
  await expect(w.uc.preview(persona, w.t.id, 'finance:inv:1')).rejects.toThrow('inget underlag');
  await w.store.transaction(tx =>
    tx.updateThread(w.t.id, {
      actions: w.t.actions.map(a => (a.id === 'approve' ? { ...a, review: 'each', preview: 'finance.preview' } : a)),
    }),
  );
  expect(await w.uc.preview(persona, w.t.id, 'finance:inv:1')).toEqual(good);
  expect(w.calls).toEqual(['finance.preview']);
  await expect(w.uc.preview(persona, w.t.id, 'finance:inv:other')).rejects.toThrow('Raden finns inte');
  await expect(w.uc.preview({ id: 'other' } as AuthenticatedContext, w.t.id, 'finance:inv:1')).rejects.toThrow(
    'Kortet finns inte.',
  );
  // An answer outside the contract never reaches the browser.
  const bad = await world(() => ({ title: 'x', mediaType: 'text/html', data: '<b>' }));
  await bad.store.transaction(tx =>
    tx.updateThread(bad.t.id, {
      actions: bad.t.actions.map(a => (a.id === 'approve' ? { ...a, review: 'each', preview: 'finance.preview' } : a)),
    }),
  );
  await expect(bad.uc.preview(persona, bad.t.id, 'finance:inv:1')).rejects.toThrow('kunde inte läsas');
  expect(w.approvals).toEqual([]);
});
test('a read action runs directly and an undo preserves the original receipt while approval is pending', async () => {
  const w = await world();
  await w.store.transaction(tx =>
    tx.updateThread(w.t.id, { actions: [{ ...w.t.actions[0]!, capability: 'finance.open', kind: 'read' }] }),
  );
  expect(await w.uc.act(persona, w.t.id, 'approve')).toMatchObject({ kind: 'read' });
  expect(w.approvals).toEqual([]);
  const receipt: Thread['receipt'] = {
    at: w.t.createdAt,
    headline: 'Klart',
    rows: [{ ref: 'finance:inv:1', label: 'Faktura', detail: 'klar', outcome: 'done' }],
    undoCapability: 'finance.undo',
    undoUntil: '2026-11-04T06:10:00.000Z',
  };
  await w.store.transaction(tx => tx.updateThread(w.t.id, { state: 'handled', receipt }));
  // Legacy evidence cannot authorize a blind compensation.
  await expect(w.uc.undoReceipt(persona, w.t.id)).rejects.toThrow('äldre kvittot');
  expect((await w.store.readThread(persona.id, w.t.id))?.receipt).toEqual(receipt);
});
