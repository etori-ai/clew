import {
  dayRhythm,
  sameSubject,
  stockholmClock,
  stockholmDate,
  stockholmInstant,
  type ItemEvent,
  type RhythmPoint,
  type Subject,
  type Thread,
  type ThreadAction,
  type ThreadItem,
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
 * A work item's "Händelser" (D112 item 4) from its audit rows: what the person did (`principal`, their own id as the
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
 * What a thread is indexed under (D97 item 6): every entity its rows or the thread itself name, once each, by Clew's key
 * (D116: a person's id, a unit's id). The thread store writes these rows with the thread's items.
 */
export function namedSubjects(thread: Pick<Thread, 'items' | 'subjects'>): Subject[] {
  const out = new Map<string, Subject>();
  for (const s of [...thread.items.flatMap(i => (i.subject ? [i.subject] : [])), ...(thread.subjects ?? [])])
    out.set(`${s.entity}\u0000${s.key}`, { entity: s.entity, key: s.key });
  return [...out.values()];
}
/**
 * The user names a source's rows name people by (D116), each once: what is resolved to Clew's key when the rows arrive.
 */
export const personNames = (items: readonly ThreadItem[]): string[] => [
  ...new Set(items.flatMap(i => (i.subject?.entity === 'person' ? [i.subject.key] : []))),
];
/**
 * A source's rows as Clew keeps them (D116): a row that names a person by the source's key, their user name, names them by
 * Clew's key, their id, from `held` (the name as asked, to the id of whoever holds it now). A row whose name nobody holds
 * names nobody, the rest of it kept as the source wrote it. A unit's id is both keys.
 */
export function keyedItems(items: readonly ThreadItem[], held: ReadonlyMap<string, string>): ThreadItem[] {
  return items.map(item => {
    if (item.subject?.entity !== 'person') return item;
    const id = held.get(item.subject.key);
    if (id) return { ...item, subject: { entity: 'person', key: id } };
    const { subject: _, ...rest } = item;
    return rest;
  });
}
/** The one action of a card started from an execute (D97): the human decision itself. */
export const STARTED_ACTION = 'decide';
/**
 * The topic of a card the person started with this capability (D97, D8): `started:<capability>:<digest>`. A started
 * execute about a person ends in `:person:<param>` (D116): the input property that names the person by Clew's key, so the
 * card itself says where its person is, whatever the capability declares by the time the person decides.
 */
export const startedTopic = (capability: string, digest: string, personParam?: string) =>
  `started:${capability}:${digest}${personParam ? `:person:${personParam}` : ''}`;
/** A started execute's person, as its topic ends (`startedTopic`); an input property is a letter and letters or digits. */
const STARTED_PERSON = /:person:([A-Za-z][A-Za-z0-9]*)$/;
/**
 * The decision on a card the person started from an entity's menu with an execute (D97, D116): undefined for every other
 * card and action, a started propose's included, whose actions are the source's own. Otherwise `person`, when the card is
 * about a person: the input property its topic names and the id the card keeps there, which is resolved to the user name
 * when the person decides. A card about a unit keeps the unit's id, which is both keys.
 */
export function startedDecision(
  topic: string,
  action: Pick<ThreadAction, 'id' | 'kind' | 'capability' | 'input'>,
): { person?: { param: string; personId: string } } | undefined {
  if (action.id !== STARTED_ACTION || action.kind !== 'execute') return undefined;
  if (!topic.startsWith(startedTopic(action.capability, ''))) return undefined;
  const param = STARTED_PERSON.exec(topic)?.[1];
  if (!param) return {};
  const id = action.input?.[param];
  return { person: { param, personId: typeof id === 'string' ? id : '' } };
}
/**
 * Whether the capability, as declared when the person decides, still takes a started card's person where the card keeps
 * them (D116). One that no longer names a person, or names them in another property, would send the card's id as if it
 * were a user name; one that names a person where the card keeps a unit would send the unit's id as one.
 */
export const takesStarted = (
  started: { person?: { param: string } },
  about: { entity: string; param?: string | undefined } | undefined,
) => (about?.entity === 'person' ? about.param : undefined) === started.person?.param;
/** The entities among `asked` that a thread's index rows name, each once. */
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
