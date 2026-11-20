import { TALKS_CONNECTOR } from '@clew/connectors';
import { stockholmDate, TALK_STATES, type CommitmentRow, type TalkRow, type TalkState } from '@clew/contracts';
import type { CalendarDifference, CommitmentRecord, PersonRef, TalkBooking, TalkRecord } from './model';

/**
 * The rules of the talks domain (D96) as pure functions: where a person stands in a round, which action points are
 * carried over and in what order they are listed, what an action point's text may be, the calendar day of an instant in
 * Swedish time, and the refs and keys the profile reads carry. No I/O, no clock: the use case hands in every instant.
 */

/** The most an action point's text may be once normalised; the contract's `commitmentText`. */
export const COMMITMENT_TEXT_MAX = 280;
/** The most a round's label may be; the contract's `TalkRoundSchema.label`. */
export const ROUND_LABEL_MAX = 120;

/** What another system knows a person by (D96 item 8): the provisioned user name, or Clew's id when there is none. */
export const personKey = (person: Pick<PersonRef, 'id' | 'userName'>) => person.userName ?? person.id;
/** `talk:talks:<employee id>`: one person's talk in the round, stable across rounds as the profile's row is. */
export const talkRef = (employeeId: string) => `talk:${TALKS_CONNECTOR}:${employeeId}`;
/** `commitment:talks:<commitment id>`. */
export const commitmentRef = (commitmentId: string) => `commitment:${TALKS_CONNECTOR}:${commitmentId}`;

/** The calendar day of an instant in Swedish time, `YYYY-MM-DD`. */
export const swedishDay = (at: Date) => stockholmDate(at.toISOString());
/** A real calendar day written `YYYY-MM-DD` (not 2026-02-30). */
export function isCalendarDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}
const dayAndMonth = new Intl.DateTimeFormat('sv-SE', { day: 'numeric', month: 'long', timeZone: 'UTC' });
/** A calendar day as a person reads it in a sentence: `2026-11-28` is "28 november". */
export const swedishDayAndMonth = (day: string) => dayAndMonth.format(new Date(day + 'T12:00:00Z'));
const shortDay = new Intl.DateTimeFormat('sv-SE', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});
/**
 * A calendar day as a list line reads it: `2026-11-28` is "lör 28 nov", or "28 nov" without the weekday. Built from the
 * parts so the abbreviated month carries no full stop.
 */
export function swedishShortDay(day: string, weekday = true): string {
  const parts = shortDay.formatToParts(new Date(day + 'T12:00:00Z'));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === type)?.value.replace(/\.$/, '') ?? '';
  return [weekday ? part('weekday') : '', part('day'), part('month')].filter(Boolean).join(' ');
}

/**
 * A key of a person as another system holds it (D97): the provisioned user name, compared without regard to case. A
 * person provisioned without one cannot be asked about.
 */
export const sameUserName = (userName: string | null | undefined, key: string) =>
  !!userName && userName.toLowerCase() === key.toLowerCase();

/** How a list about people (D97) says where a person stands in the round: the words Personal uses. */
export const TALK_STATE_WORDS: Record<TalkState, string> = { missing: 'Saknas', booked: 'Bokat', held: 'Hållet' };
/**
 * The next talk in a column (D97, artboard A2): the day it is booked ("mån 16 nov"), "Bokat" for a talk a source says is
 * booked without saying when, the day it was held ("Hållet 4 nov"), or "Inte bokat". `at` is the booked instant or the
 * held calendar day.
 */
export function nextTalk(state: TalkState, at: string | undefined): string {
  if (state === 'booked') return at ? swedishShortDay(stockholmDate(at)) : TALK_STATE_WORDS.booked;
  if (state === 'held' && at) return 'Hållet ' + swedishShortDay(at.slice(0, 10), false);
  return 'Inte bokat';
}
/** Open action points as words: "Inga", "1 öppen", "3 öppna". */
export const openWords = (n: number) => (n === 0 ? 'Inga' : n === 1 ? '1 öppen' : `${n} öppna`);
/** Overdue action points as words, only when there are any: "1 försenad", "2 försenade". */
export const overdueWords = (n: number) => (n <= 0 ? undefined : n === 1 ? '1 försenad' : `${n} försenade`);
/** An open action point whose due day is before `today` (both `YYYY-MM-DD`) is overdue. */
export const isOverdue = (c: Pick<CommitmentRecord, 'doneAt' | 'dueOn'>, today: string) =>
  c.doneAt === null && c.dueOn < today;
/** How many overdue action points each employee has. */
export function overdueCounts(
  commitments: readonly Pick<CommitmentRecord, 'doneAt' | 'dueOn' | 'employeeId'>[],
  today: string,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const c of commitments) if (isOverdue(c, today)) counts.set(c.employeeId, (counts.get(c.employeeId) ?? 0) + 1);
  return counts;
}
/** Held of everyone due on a unit, as words: "1 av 5 hållna". */
export const heldWords = (held: number, due: number) => `${held} av ${due} hållna`;
/** A count of talks in one state as words, only when there are any: "1 saknas", "3 bokade". */
export const missingWords = (n: number) => (n > 0 ? `${n} saknas` : undefined);
export const bookedWords = (n: number) => (n <= 0 ? undefined : n === 1 ? '1 bokat' : `${n} bokade`);

/**
 * An action point's text as stored: trimmed, every run of white space (a line break included) one space, since it is
 * one short line. Undefined when nothing is left or it is longer than `COMMITMENT_TEXT_MAX` characters.
 */
export function normaliseText(text: string): string | undefined {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length >= 1 && [...line].length <= COMMITMENT_TEXT_MAX ? line : undefined;
}
/** A round's label, trimmed; undefined when blank or too long. */
export function normaliseLabel(label: string): string | undefined {
  const line = label.replace(/\s+/g, ' ').trim();
  return line.length >= 1 && [...line].length <= ROUND_LABEL_MAX ? line : undefined;
}

/**
 * The booking of a talk that counts now (D132): the one on the record, while the manager whose booking it is still
 * manages the employee. `manages` answers that for `bookedBy`; a booking whose manager was erased, or has left the
 * person, counts for nobody, so the person's managers now see a talk that lacks a time and book it again. One talk a
 * person a round (Q12): whichever of their current managers booked it, it is booked for every one of them, with its time.
 */
export function standingBooking(
  talk: Pick<TalkRecord, 'booking'> | undefined,
  manages: (managerId: string) => boolean,
): TalkBooking | undefined {
  const booking = talk?.booking;
  return booking && booking.bookedBy !== null && manages(booking.bookedBy) ? booking : undefined;
}
/**
 * Where one person stands in the round (D96 item 2, D132): held when a manager marked the talk held, else booked when
 * its booking stands, else missing. `at` is the day it was held or the instant it is booked.
 */
export function talkState(
  talk: Pick<TalkRecord, 'heldOn'> | undefined,
  booking: Pick<TalkBooking, 'start'> | undefined,
): { state: TalkState; at?: string } {
  if (talk?.heldOn) return { state: 'held', at: talk.heldOn };
  if (booking) return { state: 'booked', at: booking.start };
  return { state: 'missing' };
}
/**
 * What the calendar holds against a booking (D133): null when the event is at the booking's time, the event's span when
 * it is at another, `gone` when there is no event. Undefined when the event's span cannot be read as one, which says
 * nothing either way.
 */
export function differenceOf(
  booking: Pick<TalkBooking, 'start' | 'end'>,
  event: { start: string; end: string } | null,
): CalendarDifference | null | undefined {
  if (event === null) return 'gone';
  const span = normaliseSpan(event.start, event.end);
  if (!span) return undefined;
  return span.start === booking.start && span.end === booking.end ? null : span;
}
/** Whether two readings of what the calendar holds say the same. */
export const sameDifference = (a: CalendarDifference | null, b: CalendarDifference | null) =>
  a === b || (!!a && !!b && a !== 'gone' && b !== 'gone' && a.start === b.start && a.end === b.end);
/** The difference as an audit row carries it: instants or that the event is gone, never a name. */
export const differenceDetails = (d: CalendarDifference) => (d === 'gone' ? { gone: true } : d);
const clockTime = new Intl.DateTimeFormat('sv-SE', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Stockholm',
});
/** A span as a sentence reads it, in Swedish time: "tors 20 nov kl. 13:00–14:00". */
export const swedishSpan = (span: { start: string; end: string }) =>
  `${swedishShortDay(stockholmDate(span.start))} kl. ${clockTime.format(new Date(span.start))}–${clockTime.format(new Date(span.end))}`;
/**
 * A card the scan asks for about one person's talk (D133): what it is about, and its identity (D47). One card per
 * person and round for each kind; `revision` is what the card says, so a card the manager handled comes back when that
 * changes, and a cause that is gone resolves the card at the next scan.
 */
export type TalkNoticeKind = 'calendar';
export const noticeCard = (kind: TalkNoticeKind, personId: string, roundId: string, revision: string) => ({
  topic: `talks:${kind}:${personId}:${roundId}`,
  key: `talks:${kind}:${personId}`,
  revision,
  period: roundId,
});
/** The longest a talk may be booked for: a day, as a meeting in the calendar. */
const BOOKING_MAX_MS = 86_400_000;
/**
 * A time a manager registers for a talk, as stored: two instants, the end after the start and at most a day later, each
 * written back in its canonical form. Undefined when either is no instant or the span does not hold.
 */
export function normaliseSpan(start: string, end: string): { start: string; end: string } | undefined {
  const a = Date.parse(start),
    b = Date.parse(end);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a || b - a > BOOKING_MAX_MS) return undefined;
  return { start: new Date(a).toISOString(), end: new Date(b).toISOString() };
}
/** An action point is carried over when it is open and was added in another round than the current one (D96 item 4). */
export const isCarried = (c: Pick<CommitmentRecord, 'doneAt' | 'roundId'>, currentRoundId: string | null) =>
  c.doneAt === null && c.roundId !== currentRoundId;

const sv = (a: string, b: string) => a.localeCompare(b, 'sv');
/** The round's rows in the order a list is drawn (`TALK_STATES`), then by name in Swedish order. */
export function orderTalkRows<T extends Pick<TalkRow, 'state' | 'name' | 'ref'>>(rows: T[]): T[] {
  return [...rows].sort(
    (a, b) =>
      TALK_STATES.indexOf(a.state) - TALK_STATES.indexOf(b.state) || sv(a.name, b.name) || a.ref.localeCompare(b.ref),
  );
}
/**
 * Action points as listed (D96 item 4): carried over first, then the open ones by due date, then the done ones. With
 * `mineFirst` (the reader's own list) the open ones the reader owns come before the open ones about them that someone
 * else owns, each group carried first; the done ones stay last.
 */
export function orderCommitmentRows<T extends Pick<CommitmentRow, 'carried' | 'done' | 'dueOn' | 'ref' | 'mine'>>(
  rows: T[],
  options: { mineFirst?: boolean } = {},
): T[] {
  const rank = (r: T) => (r.done ? 4 : (options.mineFirst && !r.mine ? 2 : 0) + (r.carried ? 0 : 1));
  return [...rows].sort((a, b) => rank(a) - rank(b) || a.dueOn.localeCompare(b.dueOn) || a.ref.localeCompare(b.ref));
}

/** One person in the round as the profile read lists them (D96 item 8). */
export function talkRow(
  person: Pick<PersonRef, 'id' | 'name' | 'userName'>,
  talk: Pick<TalkRecord, 'heldOn'> | undefined,
  booking: Pick<TalkBooking, 'start' | 'end' | 'invitationId' | 'bookedBy' | 'calendar'> | undefined,
  openCommitments: number,
  readerId: string,
): TalkRow {
  const { state, at } = talkState(talk, booking);
  const differs = state === 'booked' ? (booking?.calendar ?? null) : null;
  return {
    ref: talkRef(person.id),
    userName: personKey(person),
    name: person.name,
    state,
    ...(at ? { at } : {}),
    ...(state === 'booked' && booking
      ? { until: booking.end, invited: booking.invitationId !== null, own: booking.bookedBy === readerId }
      : {}),
    ...(differs ? { calendar: differs === 'gone' ? { gone: true as const } : differs } : {}),
    openCommitments,
  };
}
/** One action point as the profile read lists it to `readerId`. */
export function commitmentRow(
  c: CommitmentRecord,
  employee: Pick<PersonRef, 'id' | 'name' | 'userName'>,
  readerId: string,
  currentRoundId: string | null,
): CommitmentRow {
  return {
    ref: commitmentRef(c.id),
    userName: personKey(employee),
    name: employee.name,
    owner: c.ownerRole,
    mine: c.ownerId !== null && c.ownerId === readerId,
    text: c.text,
    dueOn: c.dueOn,
    done: c.doneAt !== null,
    ...(c.doneAt ? { doneAt: c.doneAt } : {}),
    carried: isCarried(c, currentRoundId),
  };
}
