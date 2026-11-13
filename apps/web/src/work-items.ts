import {
  cardKind,
  daysUntil,
  isSnoozed,
  snoozeWhen,
  stockholmDate,
  streamGroup,
  unresolvedExecution,
  type Thread,
} from '@clew/contracts';
import { weekNumber } from '@clew/calendar/dates';
import type { Groups } from './stream';
import { DOT } from './dot';
import { settlingUntil } from './mutations';
import { wayBack } from './person-address';

/**
 * Att göra (D112 item 3): the queue's piles, named as the address names them (D43). Behöver dig is the first and is
 * left out of the address. What the person set aside (Inte nu, D28) waits like what waits on others and comes back by
 * itself, so it is listed under Väntar på andra with its own state; the canvas draws no fourth pile.
 */
export type TodoTab = 'needs-you' | 'waiting' | 'done';
export const todoTabs: readonly TodoTab[] = ['needs-you', 'waiting', 'done'];
export const tabTitle: Record<TodoTab, string> = {
  'needs-you': 'Behöver dig',
  waiting: 'Väntar på andra',
  done: 'Klart',
};
/** The shorter word a phone's strip uses (board PhoneInbox: "Väntar"), so the three fit at 320 px. */
export const tabWord: Record<TodoTab, string> = { 'needs-you': 'Behöver dig', waiting: 'Väntar', done: 'Klart' };
/** An address's tab; `snoozed`, Hem's old Inte nu tab, is now part of Väntar på andra. */
export const tabOf = (value: string | null): TodoTab =>
  value === 'snoozed' ? 'waiting' : todoTabs.includes(value as TodoTab) ? (value as TodoTab) : 'needs-you';

/** Where Att göra keeps its state (D43): the pile, the system, the filter's words and the chosen work item. */
export interface TodoState {
  tab?: TodoTab;
  area?: string | null;
  filter?: string | null;
  item?: string | null;
}
const TODO_KEYS: Record<keyof TodoState, string> = { tab: 'tab', area: 'area', filter: 'filter', item: 'item' };
/** `/todo` with `next` applied over `search`; whatever else the address holds (a review over the page) is kept. */
export function todoHref(next: TodoState, search: URLSearchParams | string = ''): string {
  const q = new URLSearchParams(search);
  for (const key of Object.keys(next) as (keyof TodoState)[]) {
    const value = next[key];
    if (value === undefined) continue;
    if (value === null || value === '' || (key === 'tab' && value === 'needs-you')) q.delete(TODO_KEYS[key]);
    else q.set(TODO_KEYS[key], value);
  }
  const s = q.toString();
  return s ? `/todo?${s}` : '/todo';
}
/** The work item's own address in the queue: the reading pane beside the list, or the item alone where it does not fit. */
export const itemHref = (threadId: string) => todoHref({ item: threadId });
/**
 * The work item as a page (D112 item 4): `/items/<threadId>`, with `from` the address it was opened from, for the way
 * back, as a person's page keeps it (`person-address.ts`): a path inside Clew with its own search, never a `from` of its own.
 */
export function itemPageHref(threadId: string, from?: string | null): string {
  const back = wayBack(from);
  return `/items/${encodeURIComponent(threadId)}${back ? `?from=${encodeURIComponent(back)}` : ''}`;
}

/**
 * Where an address of Hem from before D112 leads, or null when it is Hem's own: a card opened on Hem (`card`) is the
 * work item in Att göra, and Hem's tabs (`tab`) and area (`area`) are Att göra's. What lies over the card (its review,
 * a read unfolded in it, a view opened from one of its rows) goes along.
 */
export function todoFromHem(search: URLSearchParams | string): string | null {
  const from = new URLSearchParams(search);
  const card = from.get('card'),
    tab = from.get('tab'),
    area = from.get('area');
  if (!card && !tab && !area) return null;
  const q = new URLSearchParams();
  const tabbed = tab ? tabOf(tab) : 'needs-you';
  if (tabbed !== 'needs-you') q.set('tab', tabbed);
  if (area) q.set('area', area);
  if (card) q.set('item', card);
  for (const key of ['review', 'step', 'open-card', 'open-action', 'open', 'open-title', 'open-input', 'via']) {
    const value = from.get(key);
    if (value !== null) q.set(key, value);
  }
  const s = q.toString();
  return s ? `/todo?${s}` : '/todo';
}

/** The queue in the order Hem's groups had it (D34): what is due, what comes later, the proposals, the notices. */
export const needsYouOf = (g: Groups): Thread[] => [...g.nu, ...g.senare, ...g.foreslar, ...g.kannedom];
/** What waits: on someone else first, then what the person set aside, each in the stream's order. */
export const waitingOf = (g: Groups): Thread[] => [...g.waiting, ...g.snoozed];
/** What is done or set aside for good, the newest first: the person's cards, not their conversations. */
export const doneOf = (threads: readonly Thread[]): Thread[] =>
  threads
    .filter(t => t.kind === 'pushed' && t.state !== 'open' && !unresolvedExecution(t))
    .sort((a, b) => (b.handledAt ?? b.updatedAt).localeCompare(a.handledAt ?? a.updatedAt));

export type DotVariant = 'success' | 'warning' | 'error' | 'accent' | 'neutral';
/** What a row says about the work item, each from the thread itself: nothing here is guessed. */
export interface RowFacts {
  /** Where the item stands, as a dot and its word. */
  state: { variant: DotVariant; label: string };
  /** When it is due, where it has a day: today, a weekday this week, the week number after that. */
  due: { variant: 'error' | 'warning' | 'neutral'; label: string } | null;
  /** Why it is here: the source's reason, what it waits on, when it comes back, or what was done. */
  why: string;
}
const capital = (s: string) => (s ? s[0]!.toLocaleUpperCase('sv-SE') + s.slice(1) : s);
const weekday = (date: string) =>
  new Intl.DateTimeFormat('sv-SE', { weekday: 'long', timeZone: 'UTC' }).format(new Date(date + 'T12:00:00Z'));

/** The due badge (boards Inbox and Main): "I dag" in red, a day this week in yellow, a later week in grey. */
export function dueOf(thread: Thread, today: string): RowFacts['due'] {
  if (thread.state !== 'open') return null;
  const reminded = !!thread.remindedAt && stockholmDate(thread.remindedAt) === today;
  if (!thread.deadline) return reminded ? { variant: 'warning', label: 'Påminnelse' } : null;
  const date = thread.deadline.slice(0, 10);
  const days = daysUntil(date, today);
  if (days < 0) return { variant: 'error', label: 'Försenad' };
  if (days === 0) return { variant: 'error', label: 'I dag' };
  if (days === 1) return { variant: 'warning', label: 'I morgon' };
  if (days < 7) return { variant: 'warning', label: capital(weekday(date)) };
  return { variant: 'neutral', label: `Vecka ${weekNumber(date)}` };
}

/** The words of an item that waits on someone: its state's, and the start of its reason, which names whom. */
const WAITS_ON = 'Väntar på';
const WAITING_ON_OTHERS = `${WAITS_ON} andra`;

/** Where the item stands: an action on its way or in doubt first, then the pile, then what kind of thing it is (D34). */
export function stateOf(thread: Thread, now: string, today: string): RowFacts['state'] {
  const execution = thread.execution;
  if (execution && unresolvedExecution(thread))
    return ['pending', 'running'].includes(execution.state)
      ? { variant: 'accent', label: 'Väntar på källan' }
      : { variant: 'error', label: 'Behöver kontrolleras' };
  if (thread.state === 'handled') return { variant: 'success', label: 'Klart' };
  if (thread.state === 'dismissed') return { variant: 'neutral', label: 'Avfärdat' };
  // A reminder that was stopped needs a hand (reliability roadmap, phase 5A): said on the row, as the card says it.
  if (thread.timers?.some(t => t.state === 'blocked')) return { variant: 'error', label: 'Påminnelsen stoppad' };
  if (isSnoozed(thread, now)) return { variant: 'neutral', label: 'Inte nu' };
  if (thread.waitingOn) return { variant: 'neutral', label: WAITING_ON_OTHERS };
  if (thread.remindedAt && stockholmDate(thread.remindedAt) === today)
    return { variant: 'warning', label: 'Påminnelse' };
  const kind = cardKind(thread);
  if (kind === 'forslag') return { variant: 'accent', label: 'Förslag' };
  if (kind === 'handelse') return { variant: 'neutral', label: 'Till kännedom' };
  return streamGroup(thread, today) === 'nu'
    ? { variant: 'error', label: 'Ska göras i dag' }
    : { variant: 'warning', label: 'Ska göras' };
}

/**
 * The why line: the receipt's headline once done, else what the item waits on or when it comes back, else the reason.
 * A reminder that waits to be scheduled says so after it, never that it will remind, and not inside the settle window
 * of the person's own action, where a queued timer is not drawn (D64 item 2). A reason of nothing but spaces is no
 * reason: the line then holds only what there is, never a separator with nothing beside it.
 */
export function whyOf(thread: Thread, now: string): string {
  const base = (
    thread.receipt
      ? thread.receipt.headline.trim().replace(/\.$/, '')
      : thread.state === 'open' && thread.snoozedUntil && isSnoozed(thread, now)
        ? `Tillbaka ${snoozeWhen(thread.snoozedUntil, now)}`
        : thread.waitingOn
          ? `${WAITS_ON} ${thread.waitingOn}`
          : thread.trigger.reason.trim().replace(/\.$/, '')
  ).trim();
  const queued =
    !thread.timers?.some(t => t.state === 'blocked') &&
    !!thread.timers?.some(t => t.state === 'queued') &&
    settlingUntil(thread.id) <= Date.parse(now);
  return [base, queued ? 'påminnelsen väntar på schemaläggning' : ''].filter(Boolean).join(DOT);
}

/**
 * A source the cards come from that has not answered (D8): said where the work is drawn, in the words Hem has used, so
 * an empty pile is never taken for nothing to do. Null when every source answered.
 */
export function sourcesNotice(sources: readonly { lastSuccess: string | null; error: string | null }[] | undefined) {
  if (!sources?.some(s => !s.lastSuccess || s.error)) return null;
  return sources.some(s => s.error)
    ? 'Någon källa kunde inte kontrolleras. Sparade uppgifter visas och kontrolleras igen.'
    : 'Källorna kontrolleras. Sparade uppgifter visas under tiden.';
}

/** A row's facts. A due badge that only repeats the state's word ("Påminnelse" beside "Påminnelse") is left out. */
export const rowFacts = (thread: Thread, now: string, today: string): RowFacts => {
  const state = stateOf(thread, now, today);
  const due = dueOf(thread, today);
  return { state, due: due?.label === state.label ? null : due, why: whyOf(thread, now) };
};
/**
 * A row's supporting line: the state in words, then why the item is here ("Ska göras i dag · Ansökan kom 10 november kl.
 * 16:40"), so two states never differ by the dot's colour alone (WCAG 1.4.1). The no-break space keeps the separator
 * with the state when the line wraps; without a reason the state stands alone. An item that waits, on someone or on
 * its source, already says its state in its reason, with what it waits on ("Väntar på skyddsombudet", "Väntar på
 * källans besked"), so that line stands as it is.
 */
export const rowLine = (facts: RowFacts): string =>
  !facts.why
    ? facts.state.label
    : facts.state.label.startsWith(WAITS_ON) && facts.why.startsWith(`${WAITS_ON} `)
      ? facts.why
      : `${facts.state.label}${DOT}${facts.why}`;

/**
 * What the rail's dot says about a conversation (D112 item 1), only where the data holds it: the answer being written
 * now, or a card the assistant drafted in it that still waits for the person's decision. Anything else draws no dot.
 */
export function conversationState(
  conversation: Thread,
  threads: readonly Thread[],
  answering: string | null,
): { variant: DotVariant; label: string } | null {
  if (answering === conversation.id) return { variant: 'accent', label: 'Svarar' };
  const draft = [...conversation.messages].reverse().find(m => m.role === 'assistant')?.meta?.draft;
  const card = draft ? threads.find(t => t.id === draft.threadId) : undefined;
  if (card && card.state === 'open' && !card.waitingOn) return { variant: 'warning', label: 'Väntar på dig' };
  return null;
}
