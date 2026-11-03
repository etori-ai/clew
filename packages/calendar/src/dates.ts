import { Temporal } from 'temporal-polyfill';

export const timeZone = 'Europe/Stockholm';
const isoDate = /^\d{4}-\d{2}-\d{2}$/;

export const today = () => Temporal.Now.plainDateISO(timeZone).toString();
export const addDays = (date: string, days: number) => Temporal.PlainDate.from(date).add({ days }).toString();
export const dates = (from: string, count: number) => Array.from({ length: count }, (_, index) => addDays(from, index));
export const weekStart = (date: string) => Temporal.PlainDate.from(date).subtract({ days: Temporal.PlainDate.from(date).dayOfWeek - 1 }).toString();
/** A named day means its next occurrence including today, in the supplied local calendar. */
export function nearestWeekday(date: string, weekday: string) {
  const index = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].indexOf(weekday);
  return index < 0 ? undefined : addDays(date, (index + 1 - Temporal.PlainDate.from(date).dayOfWeek + 7) % 7);
}
export const dayStart = (date: string) => Temporal.PlainDate.from(date).toZonedDateTime(timeZone).toInstant().toString();
/** Explicit local clock time and UTC offset for consumers that cannot infer display time. */
export const stockholmTimestamp = (instant: string) => Temporal.Instant.from(instant).toZonedDateTimeISO(timeZone).toString({ timeZoneName: 'never', calendarName: 'never' });

/** The Stockholm calendar date of an all-day date string or an instant. */
export const displayDate = (value: string) => isoDate.test(value) ? value : Temporal.Instant.from(value).toZonedDateTimeISO(timeZone).toPlainDate().toString();

export function localInstant(value: string) {
  // Reject both missing spring times and ambiguous autumn times; never silently shift a meeting.
  return Temporal.PlainDateTime.from(value).toZonedDateTime(timeZone, { disambiguation: 'reject' }).toInstant().toString();
}

/** Move a local end time so the meeting keeps its length when the start changes. */
export function shiftEnd(previousStart: string, previousEnd: string, nextStart: string) {
  try {
    const duration = Temporal.PlainDateTime.from(previousStart).until(Temporal.PlainDateTime.from(previousEnd));
    if (duration.sign <= 0) return previousEnd;
    return Temporal.PlainDateTime.from(nextStart).add(duration).toString({ smallestUnit: 'minute' });
  } catch { return previousEnd; }
}

export const stamp = (value: string) => Temporal.Instant.from(value).toString({ smallestUnit: 'second' }).replace(/[-:]/g, '');

export function validWindow(start: string, end: string) {
  const a = Temporal.Instant.from(start), b = Temporal.Instant.from(end);
  return b.epochMilliseconds > a.epochMilliseconds && b.epochMilliseconds - a.epochMilliseconds <= 32 * 86400000;
}

/** Whether an occurrence belongs under a given Stockholm day in the agenda. */
export function occursOn(event: { start: string; end: string; allDay: boolean }, day: string) {
  if (event.allDay) return event.start <= day && day < event.end;
  return displayDate(event.start) === day;
}
export const isPast = (end: string) => !isoDate.test(end) && Date.parse(end) < Date.now();
/** Minutes since Stockholm midnight for an instant. */
export function minutesOfDay(value: string) {
  const local = Temporal.Instant.from(value).toZonedDateTimeISO(timeZone);
  return local.hour * 60 + local.minute;
}
export const weekNumber = (date: string) => Temporal.PlainDate.from(date).weekOfYear ?? 0;
export const monthLabel = (date: string) => format({ month: 'long', year: 'numeric' }).format(new Date(dayStart(date)));

const format = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('sv-SE', { ...options, timeZone });
const time = format({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

export const dateLabel = (date: string) => format({ dateStyle: 'full' }).format(new Date(dayStart(date)));
export const dayLabel = (date: string) => format({ weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(dayStart(date)));
export const shortDayLabel = (date: string) => format({ weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(dayStart(date)));
export const rangeLabel = (from: string, days: number) => format({ day: 'numeric', month: 'long', year: 'numeric' }).formatRange(new Date(dayStart(from)), new Date(dayStart(addDays(from, days - 1))));
export const timeLabel = (value: string) => time.format(new Date(value));
export const timeRange = (start: string, end: string) => time.formatRange(new Date(start), new Date(end));

/** ISO week number and the Monday of a given week number in the same ISO year as `date`. */
export const weekLabel = (date: string) => `vecka ${weekNumber(date)}`;
export function mondayOfWeek(year: number, week: number) {
  // ISO 8601: week 1 contains 4 January.
  const jan4 = Temporal.PlainDate.from({ year, month: 1, day: 4 });
  return jan4.subtract({ days: jan4.dayOfWeek - 1 }).add({ weeks: week - 1 }).toString();
}
export const nextWeekStart = (date: string) => addDays(weekStart(date), 7);
/** Local wall-clock string (YYYY-MM-DDTHH:MM) in Stockholm for an instant. */
export const localClock = (instant: string) => Temporal.Instant.from(instant).toZonedDateTimeISO(timeZone).toPlainDateTime().toString({ smallestUnit: 'minute' });
