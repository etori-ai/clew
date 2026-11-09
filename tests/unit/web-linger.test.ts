import { describe, expect, test } from 'bun:test';
import type { Thread } from '@clew/contracts';
import { LINGER_MS, receiptArrivals } from '../../apps/web/src/linger';
import { groupThreads } from '../../apps/web/src/stream';
import { canUndoReceipt, receiptComplete } from '../../apps/web/src/receipt-state';

const NOW = '2026-11-06T08:00:00.000Z';
const thread = (values: Partial<Thread> = {}): Thread => ({
  id: 'a',
  title: 'a',
  kind: 'pushed',
  topic: 'a',
  state: 'open',
  trigger: { reason: 'Test', source: 'Test', at: NOW },
  createdAt: NOW,
  updatedAt: NOW,
  handledAt: null,
  messages: [],
  proposals: [],
  week: null,
  connector: 'finance',
  area: 'budget',
  summary: '',
  items: [],
  actions: [],
  waitingOn: null,
  deadline: '2026-11-06',
  receipt: null,
  remindedAt: null,
  snoozedUntil: null,
  ...values,
});
const receipt: Thread['receipt'] = {
  at: NOW,
  headline: '2 fakturor attesterade',
  rows: [],
  undoUntil: '2026-11-06T08:10:00.000Z',
  undoCapability: 'finance.unapprove',
};

describe('the moment a receipt arrives (D70)', () => {
  test('late source confirmation earns completion once; unresolved and expired receipts do not offer undo', () => {
    const row = { ref: 'invoice', label: 'Faktura', outcome: 'unknown' as const, detail: 'Väntar' };
    const pending = thread({
      receipt: { ...receipt, rows: [row] },
      execution: {
        id: 'e',
        decisionId: 'd',
        operation: 'finance.approve',
        state: 'unknown',
        reason: null,
        compensates: null,
      },
    });
    const done = {
      ...pending,
      receipt: { ...receipt, rows: [{ ...row, outcome: 'done' as const }] },
      execution: { ...pending.execution!, state: 'succeeded' as const },
    };
    expect(receiptComplete(pending.receipt)).toBe(false);
    expect(canUndoReceipt(pending, Date.parse(NOW))).toBe(false);
    expect(canUndoReceipt(done, Date.parse(NOW))).toBe(true);
    expect(canUndoReceipt(done, Date.parse(receipt.undoUntil!))).toBe(false);
    expect(receiptArrivals(new Map([['a', pending]]), [done])).toEqual([done]);
    expect(receiptArrivals(new Map([['a', done]]), [done])).toEqual([]);
    expect(receiptArrivals(new Map(), [done])).toEqual([]);
  });
  test('an arrival is a card that was open without a receipt and is handled with one now', () => {
    const before = new Map([
      ['a', thread()],
      ['b', thread({ id: 'b', state: 'handled', handledAt: NOW, receipt })],
      ['c', thread({ id: 'c' })],
    ]);
    const arrivals = receiptArrivals(before, [
      thread({ state: 'handled', handledAt: NOW, receipt }),
      thread({ id: 'b', state: 'handled', handledAt: NOW, receipt }),
      thread({ id: 'c', state: 'dismissed', handledAt: NOW }),
      thread({ id: 'd', state: 'handled', handledAt: NOW, receipt }),
    ]);
    expect(arrivals.map(t => t.id)).toEqual(['a']);
  });
  test('a lingering card keeps its group and is not yet counted under Klart; without the set it has left', () => {
    const done = thread({ state: 'handled', handledAt: NOW, receipt });
    const kept = groupThreads([done], NOW, '2026-11-06', () => true, new Set(['a']));
    expect(kept.nu.map(t => t.id)).toEqual(['a']);
    expect(kept.handledToday).toEqual([]);
    const gone = groupThreads([done], NOW, '2026-11-06');
    expect(gone.nu).toEqual([]);
    expect(gone.handledToday.map(t => t.id)).toEqual(['a']);
    // A handled card without a receipt, or a dismissed one, never lingers whatever the set says.
    const dismissed = thread({ state: 'dismissed', handledAt: NOW });
    expect(groupThreads([dismissed], NOW, '2026-11-06', () => true, new Set(['a'])).nu).toEqual([]);
  });
  test('a confirmed proposal is an arrival too: the card stays open, waits on the invitees and carries the receipt', () => {
    const sent: Thread['receipt'] = {
      ...receipt,
      headline: '2 av 2 kalenderändringar är bekräftade.',
      undoCapability: 'calendar.undoProposals',
    };
    const before = new Map([['a', thread({ connector: 'calendar', area: 'calendar' })]]);
    const after = thread({
      connector: 'calendar',
      area: 'calendar',
      waitingOn: 'svar från medarbetarna',
      receipt: sent,
    });
    expect(receiptArrivals(before, [after]).map(t => t.id)).toEqual(['a']);
    // A card already waiting with its receipt is not an arrival again, and a dismissed card never is.
    expect(receiptArrivals(new Map([['a', after]]), [after])).toEqual([]);
    expect(receiptArrivals(before, [thread({ state: 'dismissed', handledAt: NOW, receipt: sent })])).toEqual([]);
  });
  test('a lingering card that now waits on others keeps its group for the moment, then lies under Väntar på andra', () => {
    const waiting = thread({
      deadline: '2026-11-27',
      waitingOn: 'svar från medarbetarna',
      receipt: { ...receipt, undoCapability: 'calendar.undoProposals' },
    });
    const kept = groupThreads([waiting], NOW, '2026-11-06', () => true, new Set(['a']));
    expect(kept.senare.map(t => t.id)).toEqual(['a']);
    expect(kept.waiting).toEqual([]);
    const gone = groupThreads([waiting], NOW, '2026-11-06');
    expect(gone.senare).toEqual([]);
    expect(gone.waiting.map(t => t.id)).toEqual(['a']);
    expect(gone.handledToday).toEqual([]);
  });
  test('the moment is short', () => {
    expect(LINGER_MS).toBeLessThanOrEqual(3_000);
  });
});
