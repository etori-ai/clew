import {
  dayRhythm,
  foldEntityKey,
  sameSubject,
  stockholmClock,
  stockholmDate,
  stockholmInstant,
  type RhythmPoint,
  type Subject,
  type Thread,
} from '@clew/contracts';
import type { SubjectErasure, TimerIntent, WorkflowStart } from './model';

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
