import { isSnoozed, type Thread } from '@clew/contracts';

/**
 * A person's own work items as one list the assistant can read (the product owner, 2026-11-16): the piles of Att göra,
 * each item in the words a row of the queue says it with. Pure: no clock, no store.
 */
export type Pile = 'needs-you' | 'waiting';
export const PILES: Pile[] = ['needs-you', 'waiting'];
export const PILE_WORDS: Record<Pile, string> = { 'needs-you': 'Behöver dig', waiting: 'Väntar på andra' };
/** The most items one read answers: a pile longer than this says how many it holds and lists the most urgent. */
export const WORK_MAX = 50;

export interface WorkRow {
  /** The item's own reference (`thread:<id>`), which the web links to its page. */
  ref: string;
  label: string;
  system: string;
  state: string;
  /** The last day, when the item has one. */
  deadline?: string;
  /** "försenad" on an item whose last day has passed. */
  late?: string;
  /** What the item is about, in the source's own sentence. Never for an item about a person. */
  fact?: string;
}
export interface WorkResult {
  pile: string;
  total: number;
  rows: WorkRow[];
}

const byDeadline = (a: Thread, b: Thread) =>
  (a.deadline ?? '9999').localeCompare(b.deadline ?? '9999') || a.createdAt.localeCompare(b.createdAt);
/** The items of one pile, the most urgent first: the queue's own rule for what needs the person and what waits. */
export function pileOf(threads: Thread[], pile: Pile, now: string): Thread[] {
  const open = threads.filter(t => t.kind === 'pushed' && t.state === 'open' && !isSnoozed(t, now));
  return open.filter(t => (pile === 'waiting' ? !!t.waitingOn : !t.waitingOn)).sort(byDeadline);
}
/**
 * Whether an item is about a person or a unit: the source said so for the item or for one of its rows (D97). What a
 * source writes about a person never reaches the model (D97 item 7, D115), so such an item is listed by its title, its
 * system, its state and its last day alone.
 */
export const aboutSomeone = (t: Thread): boolean => !!t.subjects?.length || t.items.some(i => !!i.subject);
/** One item as a row: `today` is the Stockholm date an overdue last day is told against. */
export function workRow(t: Thread, pile: Pile, today: string): WorkRow {
  const day = t.deadline && /^\d{4}-\d{2}-\d{2}/.test(t.deadline) ? t.deadline.slice(0, 10) : undefined;
  return {
    ref: 'thread:' + t.id,
    label: t.title,
    system: t.trigger.source,
    state: pile === 'waiting' && t.waitingOn ? `Väntar på ${t.waitingOn}` : PILE_WORDS[pile],
    ...(day ? { deadline: day } : {}),
    ...(day && day < today ? { late: 'försenad' } : {}),
    ...(!aboutSomeone(t) && t.summary ? { fact: t.summary } : {}),
  };
}
/** The pile as the read answers it. */
export function workList(threads: Thread[], pile: Pile, now: string, today: string): WorkResult {
  const items = pileOf(threads, pile, now);
  return {
    pile: PILE_WORDS[pile],
    total: items.length,
    rows: items.slice(0, WORK_MAX).map(t => workRow(t, pile, today)),
  };
}
