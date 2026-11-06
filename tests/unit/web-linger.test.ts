import { describe, expect, test } from 'bun:test';
import type { Thread } from '@clew/contracts';
import { LINGER_MS, receiptArrivals } from '../../apps/web/src/linger';
import { groupThreads } from '../../apps/web/src/stream';

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
  test('the moment is short', () => {
    expect(LINGER_MS).toBeLessThanOrEqual(3_000);
  });
});
