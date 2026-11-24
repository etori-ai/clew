import { expect, test } from 'bun:test';
import { ActInput, checkContract } from '../../packages/contracts/src';
import type { AuthenticatedContext, PanelViewSpec, Thread } from '../../packages/contracts/src';
import { cardDecisions } from '../../apps/server/src/threads/usecases/decisions';
import type { PersonKeys } from '../../apps/server/src/threads/model';
import { memoryThreadStore } from '../../apps/server/src/threads/adapters/memory';
import { draft } from '../store-contract';

const persona = { id: 'person' } as AuthenticatedContext;
async function world(
  answer: (name: string) => unknown = () => ({ url: 'https://example.invalid' }),
  options: { view?: PanelViewSpec; people?: PersonKeys } = {},
) {
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
    viewFor: (_p: unknown, name: string) => (name === options.view?.capability ? options.view : undefined),
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
    ...(options.people ? { people: options.people } : {}),
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
test('a decision on a work item about one unit hands the approval that unit; none or two hand none (D135)', async () => {
  const w = await world();
  const unitOne = draft(persona.id, { id: 't-one', subjects: [{ entity: 'unit', key: 'u-a' }] });
  const unitTwo = draft(persona.id, {
    id: 't-two',
    subjects: [
      { entity: 'unit', key: 'u-a' },
      { entity: 'unit', key: 'u-b' },
    ],
  });
  await w.store.transaction(async tx => {
    await tx.insertThread(unitOne);
    await tx.insertThread(unitTwo);
  });
  await w.uc.act(persona, 't-one', 'approve');
  await w.uc.act(persona, 't-two', 'approve');
  await w.uc.act(persona, w.t.id, 'approve');
  expect(w.approvals.map(a => (a as { unit?: string }).unit)).toEqual(['u-a', undefined, undefined]);
});
test('a decision is on the item as the person was shown it: a changed item is refused, one already decided is replayed (AM-4)', async () => {
  // The endpoint takes no decision without the version it was made on.
  expect(checkContract(ActInput, { actionId: 'approve' })).toBe(false);
  expect(checkContract(ActInput, { actionId: 'approve', version: '2026-11-04T06:00:00.000Z' })).toBe(true);
  const w = await world();
  const read = async () => (await w.store.readThread(persona.id, w.t.id))!;
  const shown = (await read()).updatedAt;
  const decide = (version: string) => w.uc.act(persona, w.t.id, 'approve', undefined, undefined, undefined, version);
  // The source changed the item after it was drawn: the person decides on what it says now, not on what they saw.
  await w.store.transaction(tx =>
    tx.updateThread(w.t.id, {
      summary: 'Fakturan har ett nytt belopp.',
      updatedAt: '2026-11-04T06:05:00.000Z',
    }),
  );
  await expect(decide(shown)).rejects.toThrow('Ärendet har ändrats sedan du öppnade det.');
  expect(w.approvals).toEqual([]);
  const now = (await read()).updatedAt;
  expect(now).not.toBe(shown);
  await decide(now);
  expect(w.approvals).toHaveLength(1);
  const decisionId = `card:${w.t.id}:approve:${Date.parse(now)}`;
  expect(w.approvals[0]).toMatchObject({ decisionId, presentation: { threadId: w.t.id, version: now } });
  // A decision's own progress changes its item; the same decision sent again is replayed, whatever version it names.
  const decided = draft(persona.id, {
    id: 't-decided',
    updatedAt: '2026-11-04T06:06:00.000Z',
    execution: {
      id: 'e1',
      decisionId: 'card:t-decided:approve:1',
      operation: 'finance.approve',
      state: 'pending',
      reason: null,
      compensates: null,
    },
  });
  await w.store.transaction(tx => tx.insertThread(decided));
  await w.uc.act(persona, decided.id, 'approve', undefined, undefined, undefined, shown);
  expect(w.approvals).toHaveLength(2);
  expect(w.approvals[1]).toMatchObject({ decisionId: 'card:t-decided:approve:1' });
});
test('a decision that ended without its effect, or with part of it, is decided again as a new decision (DE-M1)', async () => {
  const w = await world();
  const items = [
    { ref: 'finance:inv:1', label: 'Skolgrossisten', detail: '6451', selectable: true, selected: true },
    { ref: 'finance:inv:2', label: 'Energibolaget', detail: '18650', selectable: true, selected: true },
  ];
  const settled = (
    state: 'failed' | 'partial' | 'unknown',
    updatedAt: string,
    rows: [string, 'done' | 'failed'][] = [],
  ) =>
    w.store.transaction(tx =>
      tx.updateThread(w.t.id, {
        items,
        updatedAt,
        execution: {
          id: 'e1',
          decisionId: `card:${w.t.id}:approve:1`,
          operation: 'finance.approve',
          state,
          reason: null,
          compensates: null,
        },
        receipt: {
          at: updatedAt,
          headline: 'Ekonomisystemet svarade.',
          rows: rows.map(([ref, outcome]) => ({ ref, label: ref, outcome, detail: '' })),
          undoUntil: null,
          undoCapability: null,
        },
        // What the execution's projection writes onto the item; the store's own patch type leaves it out.
      } as never),
    );
  // Refused: the ledger would answer the same id with the refusal it has, so the person's new decision gets its own,
  // bound to the item as it stands now.
  await settled('failed', '2026-11-04T06:10:00.000Z', [['finance:inv:1', 'failed']]);
  await w.uc.act(persona, w.t.id, 'approve', undefined, undefined, undefined, '2026-11-04T06:10:00.000Z');
  expect(w.approvals[0]).toMatchObject({
    decisionId: `card:${w.t.id}:approve:${Date.parse('2026-11-04T06:10:00.000Z')}:after:e1`,
    payload: { refs: ['finance:inv:1', 'finance:inv:2'] },
  });
  // The new decision is still bound to what the person was shown.
  await expect(
    w.uc.act(persona, w.t.id, 'approve', undefined, undefined, undefined, '2026-11-04T06:00:00.000Z'),
  ).rejects.toThrow('Ärendet har ändrats sedan du öppnade det.');
  // Part of it went through: what the source got done is not sent again, and the rest is a new decision.
  await settled('partial', '2026-11-04T06:20:00.000Z', [
    ['finance:inv:1', 'done'],
    ['finance:inv:2', 'failed'],
  ]);
  await expect(w.uc.act(persona, w.t.id, 'approve')).rejects.toThrow(
    'En del av raderna är redan genomförda. Välj bara de som återstår.',
  );
  await w.uc.act(persona, w.t.id, 'approve', ['finance:inv:2']);
  expect(w.approvals[1]).toMatchObject({
    decisionId: `card:${w.t.id}:approve:${Date.parse('2026-11-04T06:20:00.000Z')}:after:e1`,
    payload: { refs: ['finance:inv:2'] },
  });
  // A decision whose outcome is not known is still replayed under its own id, never decided over.
  await settled('unknown', '2026-11-04T06:30:00.000Z');
  await w.uc.act(persona, w.t.id, 'approve', ['finance:inv:2']);
  expect(w.approvals[2]).toMatchObject({ decisionId: `card:${w.t.id}:approve:1` });
  expect(w.approvals).toHaveLength(3);
});
test('foreign actions, stale selections and another owner cannot approve effects', async () => {
  const w = await world();
  await expect(w.uc.act({ id: 'other' } as AuthenticatedContext, w.t.id, 'approve')).rejects.toThrow(
    'Ärendet finns inte.',
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
    'Ärendet finns inte.',
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
test("a read action's view links the records whose user name someone of the reader's organisation holds, by id (D122)", async () => {
  const view: PanelViewSpec = {
    kind: 'table',
    title: 'name',
    fields: [{ key: 'name', label: 'Namn' }],
    subject: { entity: 'person', key: 'userName' },
    capability: 'finance.open',
    connector: 'finance',
    source: 'Ekonomisystemet',
    chip: false,
  };
  const rows = [
    { name: 'Anna', userName: 'Anna.L' },
    { name: 'Bo', userName: 'bo.ek' },
    { name: 'Anna igen', userName: 'Anna.L' },
  ];
  const asked: Array<[string, readonly string[]]> = [];
  const people: PersonKeys = {
    // The reader's organisation holds Anna's user name, in its own spelling; nobody there holds Bo's.
    holders: async (readerId, names) => {
      asked.push([readerId, names]);
      return new Map(names.filter(n => n.toLowerCase() === 'anna.l').map(n => [n, 'p-anna'] as const));
    },
    userName: async () => null,
  };
  const w = await world(() => ({ rows }), { view, people });
  await w.store.transaction(tx =>
    tx.updateThread(w.t.id, { actions: [{ ...w.t.actions[0]!, capability: 'finance.open', kind: 'read' }] }),
  );
  expect(await w.uc.act(persona, w.t.id, 'approve')).toEqual({
    kind: 'read',
    output: { rows },
    view: { ...view, people: { 'Anna.L': 'p-anna' } },
  });
  // One question for the answer, as the reader, each name once.
  expect(asked).toEqual([['person', ['Anna.L', 'bo.ek']]]);
  // Nobody held: the view as the registry gave it. Without the people wired, the same.
  const none = await world(() => ({ rows: [{ name: 'Bo', userName: 'bo.ek' }] }), { view, people });
  await none.store.transaction(tx =>
    tx.updateThread(none.t.id, { actions: [{ ...none.t.actions[0]!, capability: 'finance.open', kind: 'read' }] }),
  );
  expect(await none.uc.act(persona, none.t.id, 'approve')).toEqual({
    kind: 'read',
    output: { rows: [{ name: 'Bo', userName: 'bo.ek' }] },
    view,
  });
  const unwired = await world(() => ({ rows }), { view });
  await unwired.store.transaction(tx =>
    tx.updateThread(unwired.t.id, {
      actions: [{ ...unwired.t.actions[0]!, capability: 'finance.open', kind: 'read' }],
    }),
  );
  expect(await unwired.uc.act(persona, unwired.t.id, 'approve')).toEqual({ kind: 'read', output: { rows }, view });
  expect([w.approvals, none.approvals, unwired.approvals]).toEqual([[], [], []]);
});
