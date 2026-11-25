import { describe, expect, test } from 'bun:test';
import type { Thread } from '@clew/contracts';
import { atRest, dismissed, reopened, snoozed } from '../../apps/web/src/optimistic';
import { heldBy, holdSettling, settlingUntil } from '../../apps/web/src/mutations';

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
  waitingOn: 'chefen',
  deadline: null,
  receipt: null,
  remindedAt: null,
  snoozedUntil: null,
  ...values,
});
const execution = (state: NonNullable<Thread['execution']>['state']): Thread['execution'] => ({
  id: 'e1',
  decisionId: 'd1',
  operation: 'finance.approve',
  state,
  reason: null,
  compensates: null,
});

describe("the person's action as the card shows it before the answer (D64)", () => {
  test('Avfärda handles the card as of now and changes nothing else', () => {
    const t = dismissed(thread(), NOW);
    expect(t.state).toBe('dismissed');
    expect(t.handledAt).toBe(NOW);
    expect(t.updatedAt).toBe(NOW);
    expect(t.waitingOn).toBe('chefen');
  });
  test('Inte nu sets the landing time only', () => {
    expect(snoozed(thread(), '2026-11-07T05:00:00.000Z')).toEqual(thread({ snoozedUntil: '2026-11-07T05:00:00.000Z' }));
  });
  test('Ta upp nu brings a snoozed card back open; Ångra on a dismissed card also stops it waiting on anyone', () => {
    expect(reopened(thread({ snoozedUntil: '2026-11-07T05:00:00.000Z' }))).toEqual(thread());
    expect(reopened(thread({ state: 'dismissed', handledAt: NOW }))).toEqual(thread({ waitingOn: null }));
  });
  test('a card is at rest unless a decision or a timer is still on its way', () => {
    expect(atRest(thread())).toBe(true);
    expect(atRest(thread({ execution: execution('pending') }))).toBe(false);
    expect(atRest(thread({ execution: execution('running') }))).toBe(false);
    // What needs the person is shown at once.
    expect(atRest(thread({ execution: execution('unknown') }))).toBe(true);
    expect(atRest(thread({ execution: execution('failed') }))).toBe(true);
    expect(atRest(thread({ execution: execution('succeeded') }))).toBe(true);
    expect(atRest(thread({ timers: [{ kind: 'reminder', dueAt: NOW, state: 'queued' }] }))).toBe(false);
    expect(atRest(thread({ timers: [{ kind: 'reminder', dueAt: NOW, state: 'scheduled' }] }))).toBe(true);
  });
  test('a hold keeps a card on its way until it is at rest, and the card drawn before the answer reached the cache too', () => {
    const LATER = '2026-11-06T08:00:01.000Z';
    const hold = { until: Date.now() + 4_000, version: LATER };
    // The answer is not yet in the cache: the card drawn is the one before the action, at rest, and still held.
    expect(heldBy(thread(), hold)).toBe(true);
    // The answer is: pending, so held; then the source's outcome, newer and at rest, which ends it.
    expect(heldBy(thread({ updatedAt: LATER, execution: execution('pending') }), hold)).toBe(true);
    expect(heldBy(thread({ updatedAt: '2026-11-06T08:00:02.000Z', execution: execution('succeeded') }), hold)).toBe(
      false,
    );
    // Without a hold nothing is held, and a hold without a version waits on rest alone.
    expect(heldBy(thread({ execution: execution('pending') }), undefined)).toBe(false);
    expect(heldBy(thread(), { until: hold.until })).toBe(false);
  });
  test('a hold ends on its own, and a later hold on the same card is not cut short by the earlier one', async () => {
    const start = Date.now();
    holdSettling('a', start + 20);
    expect(settlingUntil('a')).toBe(start + 20);
    holdSettling('a', start + 60);
    await new Promise(resolve => setTimeout(resolve, 35));
    expect(settlingUntil('a')).toBe(start + 60);
    await new Promise(resolve => setTimeout(resolve, 40));
    expect(settlingUntil('a')).toBe(0);
  });
});
