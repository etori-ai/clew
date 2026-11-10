import type { CommitmentsResult, StaffPerson, StaffUnit, TalkState, TalksResult } from '@clew/contracts';
import { displayDate, shortDayLabel, timeLabel } from '@clew/calendar/dates';

/**
 * Utvecklingssamtal on Clew's own pages (D96 item 7): the join of the round with Personal, the words and tones of the
 * three states, and the groupings of action points the drawer and Hem draw. Pure: no React, no request. Rows and counts
 * only; no sentence sums them up.
 */

/** One person in the round as `clew.talks` lists them, with their id on the reader's units. */
export type TalkEntry = TalksResult['rows'][number];
/** One action point as `clew.commitments` lists it; `id` only when Clew can write. */
export type CommitmentEntry = CommitmentsResult['rows'][number];

/** What `clew.commitments` takes as `person` for someone on Personal: their user name, else their id. */
export const personKey = (person: Pick<StaffPerson, 'id' | 'userName'>): string => person.userName ?? person.id;

/** The round's rows by person id; empty for no talks system (`null`) or before the read has answered. */
export function talksByPerson(result: TalksResult | null | undefined): Map<string, TalkEntry> {
  return new Map((result?.rows ?? []).map(row => [row.personId, row]));
}
/** One person's row in the round, or null when the round does not list them. */
export const talkFor = (personId: string, result: TalksResult | null | undefined): TalkEntry | null =>
  result?.rows.find(row => row.personId === personId) ?? null;
/** A unit's people in the unit's own order, each with their row in the round or null. */
export function unitTalks(
  unit: StaffUnit,
  result: TalksResult | null | undefined,
): Array<{ person: StaffPerson; talk: TalkEntry | null }> {
  const byPerson = talksByPerson(result);
  return unit.people.map(person => ({ person, talk: byPerson.get(person.id) ?? null }));
}

/** An Astryx Badge's variant for a state. */
export type TalkTone = 'warning' | 'neutral' | 'success';
/** The word a person reads for each state (D96 item 2). */
export const talkStateWord: Record<TalkState, string> = { missing: 'Saknas', booked: 'Bokat', held: 'Hållet' };
/** The tone each state is drawn in: a talk not yet booked is what needs the manager. */
export const talkStateTone: Record<TalkState, TalkTone> = { missing: 'warning', booked: 'neutral', held: 'success' };
/** A state as a Badge takes it. */
export const talkStatus = (state: TalkState): { label: string; variant: TalkTone } => ({
  label: talkStateWord[state],
  variant: talkStateTone[state],
});

const calendarDay = /^\d{4}-\d{2}-\d{2}$/;
/** A day as the lists show it ("ons 11 nov."), in Swedish time. */
export const dayText = (day: string): string => shortDayLabel(displayDate(day));
/**
 * When, for a row: the booked time ("ons 11 nov. kl. 09:00") or the day it was held ("tis 3 nov."), in Swedish time;
 * null when the row has no `at` (missing).
 */
export function talkAtText(talk: Pick<TalkEntry, 'at'>): string | null {
  if (!talk.at) return null;
  return calendarDay.test(talk.at) ? dayText(talk.at) : `${dayText(talk.at)} kl. ${timeLabel(talk.at)}`;
}
/** An action point's due day ("fre 20 nov."). */
export const dueText = (row: Pick<CommitmentEntry, 'dueOn'>): string => dayText(row.dueOn);
/** An open action point whose due day has passed; `today` is the Swedish calendar day, `YYYY-MM-DD`. */
export const isOverdue = (row: Pick<CommitmentEntry, 'done' | 'dueOn'>, today: string): boolean =>
  !row.done && row.dueOn < today;

/**
 * A person's action points as the talk lists them (D96 item 4): open ones from earlier rounds first, then this round's
 * open ones, then the done ones, each group in the order the server gave.
 */
export function groupCommitments<R extends Pick<CommitmentEntry, 'done' | 'carried'>>(
  rows: readonly R[],
): { carried: R[]; open: R[]; done: R[] } {
  return {
    carried: rows.filter(row => !row.done && row.carried),
    open: rows.filter(row => !row.done && !row.carried),
    done: rows.filter(row => row.done),
  };
}
/** The reader's own list split: what the reader owns (`mine`) and what the other party in the talk owns, in the server's order. */
export function splitMine<R extends Pick<CommitmentEntry, 'mine'>>(rows: readonly R[]): { mine: R[]; theirs: R[] } {
  return { mine: rows.filter(row => row.mine), theirs: rows.filter(row => !row.mine) };
}

/** How many people stand in each state, how many the round lists, and how many action points are open across them. */
export type TalkCounts = Record<TalkState, number> & { total: number; openCommitments: number };
export function talkCounts(result: TalksResult | null | undefined): TalkCounts {
  const counts: TalkCounts = { missing: 0, booked: 0, held: 0, total: 0, openCommitments: 0 };
  for (const row of result?.rows ?? []) {
    counts[row.state] += 1;
    counts.total += 1;
    counts.openCommitments += row.openCommitments;
  }
  return counts;
}
/** How many action points are open (carried over or this round's), carried over, overdue on `today`, and done. */
export type CommitmentCounts = { open: number; carried: number; overdue: number; done: number };
export function commitmentCounts(
  rows: readonly Pick<CommitmentEntry, 'done' | 'carried' | 'dueOn'>[],
  today: string,
): CommitmentCounts {
  return {
    open: rows.filter(row => !row.done).length,
    carried: rows.filter(row => !row.done && row.carried).length,
    overdue: rows.filter(row => isOverdue(row, today)).length,
    done: rows.filter(row => row.done).length,
  };
}
