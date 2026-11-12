import {
  dayRhythm,
  foldEntityKey,
  sameSubject,
  stockholmClock,
  stockholmDate,
  stockholmInstant,
  type ItemEvent,
  type RhythmPoint,
  type Subject,
  type Thread,
} from '@clew/contracts';
import type { AuditEntry, SubjectErasure, TimerIntent, WorkflowStart } from './model';

/** The audit subjects a work item's own history is written under: the item, and the person's two timers on it. */
export const historySubjects = (threadId: string) => [
  'thread:' + threadId,
  `timer:reminder:${threadId}`,
  `timer:snooze:${threadId}`,
];
/** At most this many of an item's newest audit rows make its "Händelser". */
export const HISTORY_LIMIT = 100;
const isInstant = (v: unknown): v is string => typeof v === 'string' && !Number.isNaN(Date.parse(v));
const outcomes = ['succeeded', 'partial', 'failed', 'unknown'] as const;
type Outcome = (typeof outcomes)[number];
/**
 * A work item's "Händelser" (D111 item 4) from its audit rows: what the person did (`principal`, their own id as the
 * audit writes it) and what Clew did on its own (a `system:` or `assistant:` actor), newest first. A row anyone else
 * wrote is left out, so no other person is named, and so is a row that is not about the item's course (an index write,
 * a lease, a check). A decision is named by the item's action for its capability, as the item names it now; the audit
 * keeps no titles or names of its own (schema: metadata only), so nothing else is read from it.
 */
export function itemEvents(
  rows: readonly AuditEntry[],
  thread: Pick<Thread, 'actions'>,
  principal: string,
): ItemEvent[] {
  const events: ItemEvent[] = [];
  for (const row of rows) {
    const by = row.actor === principal ? 'you' : /^(system|assistant):/.test(row.actor) ? 'clew' : null;
    if (!by) continue;
    const d = row.details ?? {};
    const at = row.at;
    const execution = typeof d.executionId === 'string' && d.executionId ? { execution: d.executionId } : {};
    switch (row.action) {
      case 'thread.pushed':
      case 'thread.started':
      case 'thread.fromAnswer':
      case 'thread.retry_created':
        events.push({ at, by, kind: 'created' });
        break;
      case 'thread.refreshed':
        events.push({ at, by, kind: 'updated' });
        break;
      case 'thread.snoozed':
        events.push({ at, by, kind: 'snoozed', ...(isInstant(d.until) ? { until: d.until } : {}) });
        break;
      case 'thread.woken':
        events.push({
          at,
          by,
          kind: 'woken',
          ...(d.reason === 'time' || d.reason === 'changed' ? { reason: d.reason } : {}),
        });
        break;
      case 'reminder.set':
        events.push({ at, by, kind: 'reminder-set', ...(isInstant(d.fireAt) ? { until: d.fireAt } : {}) });
        break;
      case 'reminder.cancelled':
        events.push({ at, by, kind: 'reminder-cancelled' });
        break;
      case 'thread.reminded':
        events.push({ at, by, kind: 'reminded' });
        break;
      case 'timer.blocked':
        events.push({ at, by, kind: 'reminder-stopped' });
        break;
      case 'thread.dismissed':
        events.push({ at, by, kind: 'dismissed' });
        break;
      case 'thread.reopened':
        events.push({ at, by, kind: 'reopened' });
        break;
      case 'thread.decision_approved': {
        if (d.compensates) {
          events.push({ at, by, kind: 'undo-decided', ...execution });
          break;
        }
        const label = thread.actions.find(a => a.capability === d.operation)?.label;
        events.push({ at, by, kind: 'decided', ...(label ? { action: label } : {}), ...execution });
        break;
      }
      case 'thread.receipt_final':
        events.push({ at, by, kind: 'undo-closed' });
        break;
      case 'thread.source_resolved':
        events.push({ at, by, kind: 'resolved' });
        break;
      default: {
        const state = /^thread\.execution_(.+)$/.exec(row.action)?.[1];
        if (state && (outcomes as readonly string[]).includes(state))
          events.push({ at, by, kind: 'answered', outcome: state as Outcome, ...execution });
      }
    }
  }
  return events.reverse();
}

/**
 * What a thread is indexed under (D97 item 6): every entity its rows or the thread itself name, once each, with the key as
 * Clew compares it (`foldEntityKey`). The thread store writes these rows with the thread's items.
 */
export function namedSubjects(thread: Pick<Thread, 'items' | 'subjects'>): Subject[] {
  const out = new Map<string, Subject>();
  for (const s of [...thread.items.flatMap(i => (i.subject ? [i.subject] : [])), ...(thread.subjects ?? [])]) {
    const key = foldEntityKey(s.entity, s.key);
    out.set(`${s.entity}\u0000${key}`, { entity: s.entity, key });
  }
  return [...out.values()];
}
/** The entities among `asked` that a thread's index rows name, each in the asked spelling and once. */
export function namedAmong(named: readonly Subject[], asked: readonly Subject[]): Subject[] {
  const out: Subject[] = [];
  for (const a of asked) if (named.some(n => sameSubject(n, a)) && !out.some(o => sameSubject(o, a))) out.push(a);
  return out;
}
/**
 * A thread's items and own subjects without one entity (D97: erasure): each row that names it loses its `subject`, the
 * row's text left as it is; undefined when the thread does not name it.
 */
export function withoutSubject(
  thread: Pick<Thread, 'items' | 'subjects'>,
  subject: Subject,
): (Pick<Thread, 'items'> & { subjects: Subject[]; erased: Omit<SubjectErasure, 'cards'> }) | undefined {
  let rows = 0;
  const items = thread.items.map(item => {
    if (!item.subject || !sameSubject(item.subject, subject)) return item;
    rows++;
    const { subject: _, ...rest } = item;
    return rest;
  });
  const subjects = (thread.subjects ?? []).filter(s => !sameSubject(s, subject));
  const cardSubjects = (thread.subjects ?? []).length - subjects.length;
  return rows || cardSubjects ? { items, subjects, erased: { rows, cardSubjects } } : undefined;
}

/** The `durableReminder` workflow of a timer generation (D47, D86): the id every start and cancel of it uses. */
export const reminderWorkflowId = (timer: Pick<TimerIntent, 'id' | 'generation'>) =>
  `${timer.id}:v2:${timer.generation}`;
/** The workflow start a reminder, snooze, obligation or action point (`due`, D96) timer commits with its row: wait until the absolute due time, then let the ledger decide by generation. */
export const reminderStart = (timer: Pick<TimerIntent, 'id' | 'generation' | 'dueAt'>): WorkflowStart => ({
  workflow: 'durableReminder',
  id: reminderWorkflowId(timer),
  input: { id: timer.id, generation: timer.generation, dueAt: timer.dueAt },
});

/**
 * The day as one track (D28): pure functions over instants, no clock in here. The review at 06:00, the bundles and the
 * quiet hours, each marked done, next or later against `now`, with every card pushed today folded onto the track. A scan
 * pushes its cards in one go, so cards are folded into moments: a card pushed within `dayRhythm.graceMinutes` after the
 * review or a bundle belongs to that point, and the rest form interruptions, one per run of cards closer together than
 * the grace. The Stepper that draws the track holds seven steps, which is the four fixed points and the budget of three.
 */
export function rhythmFor(now: string, interruptions: Array<{ at: string; title: string }>): RhythmPoint[] {
  const today = stockholmDate(now);
  const grace = dayRhythm.graceMinutes * 60_000;
  const fixed = [
    { kind: 'review' as const, at: dayRhythm.review },
    ...dayRhythm.bundles.map(at => ({ kind: 'bundle' as const, at })),
    { kind: 'quiet' as const, at: dayRhythm.quiet },
  ].map(p => ({
    ...p,
    instant: Date.parse(stockholmInstant(today, p.at)),
    count: 0,
    title: undefined as string | undefined,
  }));
  const pushed = [...interruptions]
    .map(i => ({ ...i, instant: Date.parse(i.at) }))
    .sort((a, b) => a.instant - b.instant);
  const moments: Array<{
    kind: 'interruption';
    at: string;
    instant: number;
    count: number;
    title: string | undefined;
    last: number;
  }> = [];
  for (const card of pushed) {
    const scheduled = fixed.find(
      p => p.kind !== 'quiet' && card.instant >= p.instant && card.instant < p.instant + grace,
    );
    if (scheduled) {
      scheduled.count += 1;
      continue;
    }
    const open = moments.at(-1);
    if (open && card.instant - open.last < grace) {
      open.count += 1;
      open.last = card.instant;
      continue;
    }
    moments.push({
      kind: 'interruption',
      at: stockholmClock(card.at),
      instant: card.instant,
      count: 1,
      title: card.title,
      last: card.instant,
    });
  }
  const points = [...fixed, ...moments.map(({ last: _, ...m }) => m)].sort((a, b) => a.instant - b.instant);
  let nextSeen = false;
  return points.map(({ instant, count, title, ...p }) => {
    const done = instant <= Date.parse(now);
    const state = done ? 'done' : nextSeen ? 'later' : 'next';
    if (!done) nextSeen = true;
    return { ...p, state, ...(title ? { title } : {}), ...(count ? { count } : {}) };
  });
}
