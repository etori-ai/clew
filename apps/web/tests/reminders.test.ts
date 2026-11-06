import { describe, expect, test } from 'bun:test';
import type { Thread } from '@clew/contracts';
import { activeReminders } from '../src/stream';

const now = '2026-11-05T10:00:00Z';
const reminder = (id: string, change: Partial<Thread> = {}): Thread => ({
  id,
  title: 'Påminnelse',
  kind: 'pushed',
  topic: id,
  state: 'open',
  connector: 'clew',
  area: 'personal',
  trigger: { reason: 'Bevakas', source: 'Clew', at: now },
  createdAt: now,
  updatedAt: now,
  handledAt: null,
  messages: [],
  proposals: [],
  week: null,
  summary: '',
  items: [],
  actions: [],
  waitingOn: null,
  deadline: null,
  receipt: null,
  remindedAt: now,
  snoozedUntil: null,
  ...change,
});

describe('the reminder bell', () => {
  test('includes only active pushed reminders that need the person', () => {
    const active = reminder('active');
    const expiredSnooze = reminder('returned', { snoozedUntil: now });
    const input = [
      active,
      expiredSnooze,
      reminder('unreminded', { remindedAt: null }),
      reminder('handled', { state: 'handled' }),
      reminder('dismissed', { state: 'dismissed' }),
      reminder('question', { kind: 'question' }),
      reminder('waiting', { waitingOn: 'någon annan' }),
      reminder('snoozed', { snoozedUntil: '2026-11-06T10:00:00Z' }),
    ];
    expect(activeReminders(input, now)).toEqual([active, expiredSnooze]);
  });

  test('newest reminders come first without reordering the shared cache', () => {
    const oldest = reminder('old', { remindedAt: '2026-11-04T09:00:00Z' });
    const newest = reminder('new');
    const input = [oldest, newest];
    expect(activeReminders(input, now)).toEqual([newest, oldest]);
    expect(input).toEqual([oldest, newest]);
    expect(activeReminders([], now)).toEqual([]);
  });
});
