import type { ActionPath, Ask, AskValues } from '@clew/contracts';
import { dayLabel, displayDate, localClock, localInstant, timeLabel, timeRange } from '@clew/calendar/dates';

/**
 * The one path a write passes (D112 item 10), the pure part the action dialog draws from: whether an action opens the
 * dialog at all, its steps and where it opens, the person's answers checked the way the server checks them, a refusal
 * placed on the field it concerns, and the words the dialog says the values and the person's day in. No React, no I/O;
 * the server's `answersOf` (`packages/connectors/src/asks.ts`) is the authority and speaks the same sentences.
 */
export type ActionStep = 'fill-in' | 'effect';
/** A span of time in the person's day, as the calendar answers it. */
export interface DayEntry {
  title: string;
  start: string;
  end: string;
  allDay: boolean;
}

/**
 * Whether pressing the action opens the dialog: it asks the person something or says beforehand what it will write. A
 * write with neither stays one press (D70), and an action reviewed one row at a time keeps its review (D73).
 */
export function opensDialog(action: { path?: ActionPath; review?: string }): boolean {
  return !action.review && !!action.path && (action.path.asks.length > 0 || action.path.effect);
}
/** The steps the dialog draws: "Uppgifter" only when there is something to fill in, "Det här händer" always, last. */
export const stepsOf = (path: ActionPath): ActionStep[] => (path.asks.length ? ['fill-in', 'effect'] : ['effect']);

const empty = (value: string | undefined) => !value || !value.trim();
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
/** An ISO 8601 instant with its offset, as a meeting's answer must be (the server's own pattern). */
export const isInstant = (value: string | undefined): value is string =>
  !!value && INSTANT.test(value) && !Number.isNaN(Date.parse(value));
/** Why one answer does not fit its ask, in the server's Swedish sentence; undefined when it fits. */
export function askProblem(ask: Ask, value: string | undefined, now: string): string | undefined {
  if (empty(value)) return ask.required ? `${ask.label} behöver fyllas i.` : undefined;
  const v = value!.trim();
  switch (ask.kind) {
    case 'meeting':
      if (!isInstant(v)) return `${ask.label}: välj en tid.`;
      return Date.parse(v) <= Date.parse(now) ? `${ask.label}: tiden har redan passerat.` : undefined;
    case 'date':
      return /^\d{4}-\d{2}-\d{2}$/.test(v) ? undefined : `${ask.label}: välj ett datum.`;
    case 'choice':
      return ask.options.some(o => o.value === v) ? undefined : `${ask.label}: välj ett av alternativen.`;
    default:
      return undefined;
  }
}
/** Every answer that does not fit, by property, in the order the asks are declared. */
export function askProblems(asks: readonly Ask[], values: AskValues, now: string): Array<[string, string]> {
  return asks.flatMap(a => {
    const problem = askProblem(a, values[a.property], now);
    return problem ? [[a.property, problem] as [string, string]] : [];
  });
}
/** What is sent: the asked properties only, a text trimmed, an optional answer left empty not sent (as the server takes it). */
export function sentValues(asks: readonly Ask[], values: AskValues): AskValues {
  const sent: AskValues = {};
  for (const a of asks) {
    const raw = values[a.property];
    const value = a.kind === 'text' || a.kind === 'long-text' ? raw?.trim() : raw;
    if (value) sent[a.property] = value;
  }
  return sent;
}

/**
 * Where the dialog opens. Without asks there is only "Det här händer". `startAt` is the caller's (an assistant's draft
 * opens at "Det här händer" with "Granska och …" and at the fill-in with "Ändra", D112 item 8); an `effect` start whose
 * values do not pass opens at the fill-in with the problems shown. Without `startAt` a path that requires nothing opens at
 * "Det här händer", so an approval with an optional comment is two presses; one that requires an answer opens at the fill-in.
 */
export function firstStep(
  path: ActionPath,
  values: AskValues,
  now: string,
  startAt?: ActionStep,
): { step: ActionStep; attempted: boolean } {
  if (!path.asks.length) return { step: 'effect', attempted: false };
  if (startAt === 'fill-in') return { step: 'fill-in', attempted: false };
  const passes = askProblems(path.asks, values, now).length === 0;
  if (startAt === 'effect') return passes ? { step: 'effect', attempted: false } : { step: 'fill-in', attempted: true };
  return passes && path.asks.every(a => !a.required)
    ? { step: 'effect', attempted: false }
    : { step: 'fill-in', attempted: false };
}

/**
 * The ask a server's refusal concerns: the one whose label the sentence starts with ("När: tiden har redan passerat.",
 * "Plats behöver fyllas i."), the longest label first so "När" never takes "När och var". Undefined for any other refusal.
 */
export function refusalProperty(asks: readonly Ask[], message: string): string | undefined {
  return [...asks]
    .sort((a, b) => b.label.length - a.label.length)
    .find(a => message.startsWith(`${a.label} `) || message.startsWith(`${a.label}:`))?.property;
}

const capital = (s: string) => (s ? s[0]!.toLocaleUpperCase('sv-SE') + s.slice(1) : s);
const lower = (s: string) => (s ? s[0]!.toLocaleLowerCase('sv-SE') + s.slice(1) : s);
/** A start instant as a person reads it: "Torsdag 5 november 13:15". */
export const instantText = (instant: string) => `${capital(dayLabel(displayDate(instant)))} ${timeLabel(instant)}`;
/** A filled-in value as "Det här händer" lists it: a time and a day in words, a choice by its label, a text as written. */
export function valueText(ask: Ask, value: string): string {
  switch (ask.kind) {
    case 'meeting':
      return isInstant(value) ? instantText(value) : value;
    case 'date':
      return /^\d{4}-\d{2}-\d{2}$/.test(value) ? capital(dayLabel(value)) : value;
    case 'choice':
      return ask.options.find(o => o.value === value)?.label ?? value;
    default:
      return value.trim();
  }
}
/** A suggested free time (board ActBook): its day and start, and that the person's own calendar has it free. */
export const slotText = (slot: { start: string; end: string }) => ({
  label: instantText(slot.start),
  description: `Du är ledig ${timeRange(slot.start, slot.end)} enligt din kalender`,
});
/** "Annan tid": the date and the clock as the fields hold them, made one instant in Swedish time; undefined until both make one. */
export function meetingStart(date: string | undefined, time: string | undefined): string | undefined {
  if (!date || !time || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return undefined;
  try {
    return localInstant(`${date}T${time}`);
  } catch {
    return undefined;
  }
}
/** An instant as the date and the clock fields hold it, in Swedish time. */
export function meetingParts(instant: string): { date: string; time: string } | undefined {
  if (!isInstant(instant)) return undefined;
  const local = localClock(instant);
  return { date: local.slice(0, 10), time: local.slice(11, 16) };
}
/** The end of a meeting of `minutes` that starts at `start`. */
export const meetingEnd = (start: string, minutes: number) =>
  new Date(Date.parse(start) + minutes * 60_000).toISOString();
/** The entries of the day that overlap the chosen time, by title. */
export const clashes = (entries: readonly DayEntry[], span: { start: string; end: string }) =>
  entries
    .filter(e => !e.allDay && Date.parse(e.start) < Date.parse(span.end) && Date.parse(e.end) > Date.parse(span.start))
    .map(e => e.title);
const listed = (words: string[]) =>
  words.length < 2 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} och ${words.at(-1)}`;
/**
 * The person's day in words, for a screen reader beside its drawing (board ActBook): what they have, and whether the
 * chosen time is free. "Du har Planeringstid 09:00–11:00 och APT 15:00–16:30. Den valda tiden 13:15–14:00 är ledig."
 */
export function dayWords(entries: readonly DayEntry[], chosen?: { start: string; end: string }): string {
  const own = entries.map(e => (e.allDay ? `${e.title} hela dagen` : `${e.title} ${timeRange(e.start, e.end)}`));
  const day = own.length ? `Du har ${listed(own)}.` : 'Du har inget inbokat.';
  if (!chosen) return day;
  const clash = clashes(entries, chosen);
  const range = timeRange(chosen.start, chosen.end);
  return `${day} ${clash.length ? `Den valda tiden ${range} krockar med ${listed(clash)}.` : `Den valda tiden ${range} är ledig.`}`;
}
/**
 * The button on "Det här händer" that leads back to the fill-in: "Ändra" once something is filled in; before that, what
 * it adds ("Lägg till kommentar till medarbetaren") when there is one ask, else "Fyll i uppgifterna".
 */
export function fillInLabel(asks: readonly Ask[], values: AskValues): string {
  if (asks.some(a => !empty(values[a.property]))) return 'Ändra';
  return asks.length === 1 ? `Lägg till ${lower(asks[0]!.label)}` : 'Fyll i uppgifterna';
}
/** The footer's line on the fill-in when answers are missing (the template's summary, so no sentence is said twice). */
export const blockedText = (count: number) =>
  count === 1 ? 'En uppgift ovan behöver rättas först.' : `${count} uppgifter ovan behöver rättas först.`;
