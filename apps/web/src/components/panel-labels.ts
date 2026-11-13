import { VALUE_WORDS, statusLabel, valueWord, type ViewNoun } from '@clew/contracts';
/** Swedish names for what read capabilities return. `tests/unit/panel-labels.test.ts` holds every connector output to this list. */
export const fieldLabels: Record<string, string> = {
  document: 'Underlag',
  lines: 'Specifikation',
  text: 'Text',
  activity: 'Händelser',
  metrics: 'Mätvärden',
  series: 'Utveckling',
  absent: 'Frånvarande',
  account: 'Konto',
  acknowledged: 'Läst',
  amount: 'Belopp',
  at: 'Tid',
  budget: 'Budget',
  clash: 'Krock',
  colleagues: 'Kollegor',
  date: 'Datum',
  days: 'Dagar',
  detail: 'Detalj',
  deviationPct: 'Avvikelse i procent',
  driver: 'Orsak',
  due: 'Förfaller',
  dueBy: 'Senast',
  end: 'Slutar',
  forecast: 'Prognos',
  from: 'Från',
  headline: 'Rubrik',
  kind: 'Typ',
  label: 'Namn',
  long: 'Långtidsfrånvaro, dagar',
  mustUseBy: 'Ska tas ut senast',
  name: 'Namn',
  onDuty: 'I tjänst',
  order: 'Beställning',
  outcome: 'Utfall',
  periods: 'Perioder',
  requiresReceipt: 'Kräver läskvitto',
  rows: 'Rader',
  rule: 'Regel',
  short: 'Korttidsfrånvaro, dagar',
  start: 'Börjar',
  state: 'Status',
  supplier: 'Leverantör',
  title: 'Titel',
  to: 'Till',
  today: 'I dag',
  // What a source says about a person (D97): the HR system's presence and what is coming.
  presence: 'Närvaro',
  upcoming: 'Kommande',
  type: 'Typ',
  undoUntil: 'Kan ångras till',
  vab: 'Vab, dagar',
  vacationDaysLeft: 'Semesterdagar kvar',
  waitingOn: 'Väntar på',
  ward: 'Avdelning',
  // Found text (D26)
  owner: 'Ägare',
  query: 'Fråga',
  reviewedAt: 'Granskad',
  reviewIntervalDays: 'Granskas var, dagar',
  section: 'Avsnitt',
  snippet: 'Utdrag',
  source: 'Källa',
  sources: 'Källor',
  stale: 'Inaktuell',
  status: 'Status',
  updatedAt: 'Ändrad',
  // Jobs across systems (D55): the HR, time-reporting and payroll mocks
  checkedAt: 'Kontrollerad',
  extent: 'Omfattning, procent',
  found: 'Finns',
  importedAt: 'Inläst',
  person: 'Medarbetare',
  result: 'Resultat',
  // The calendar's reads (D11, D32): today, a week, a day and the rooms
  allDay: 'Heldag',
  capacity: 'Platser',
  equipment: 'Utrustning',
  events: 'Möten',
  gaps: 'Luckor',
  mine: 'Mitt möte',
  organizer: 'Organisatör',
  participant: 'Deltagare',
  participants: 'Deltagare',
  proposals: 'Förslag',
  recurring: 'Återkommande',
  remindedAt: 'Senast påmind',
  reminders: 'Påminnelser',
  room: 'Rum',
  email: 'E-post',
  // The news profile (D112): a news row and one item's read.
  sender: 'Avsändare',
  publishedAt: 'Publicerad',
  body: 'Text',
  // Fields the requests profile (D123) and the service-desk fixture's reads return, named for any read that returns
  // them without a view of its own: neutral words, since an errand's `since` is when it last changed and a request's when
  // it was made. A source's own word (the desk's "Handläggs av") belongs in the view it declares.
  since: 'Sedan',
  expectedAt: 'Beräknas klar',
  group: 'Grupp',
  description: 'Beskrivning',
  latest: 'Senaste meddelande',
  devices: 'Enheter',
  ordered: 'Beställt',
  model: 'Modell',
  inventoryNumber: 'Inventarienummer',
};
/** Addresses and references: useful to the code, never to the person reading the panel. */
/** A follower's step drafts (D55) are Clew's input, drawn as a job, never as panel fields. */
export const hiddenFields = new Set([
  'recovery',
  'ref',
  // The key a row about an entity was asked with (D97): the person's user name, never shown as a value.
  'key',
  'url',
  // A calendar event's handles (D11): the source's id and revision, the thread a proposal belongs to, and what a write may do.
  'id',
  'revision',
  'eventRef',
  'threadId',
  'canCancel',
  'undoCapability',
  'undoMinutes',
  'undoInput',
  // A preview's document (D70) is drawn by the review flow, never listed as fields.
  'mediaType',
  'data',
  'link',
  'connector',
  'score',
  'kinds',
  'steps',
  'operation',
  'payload',
  'input',
  'expect',
  'path',
  'equals',
  'within',
  // A propose's card draft (D97) is Clew's input, drawn as a card, never as panel fields.
  'topic',
  'area',
  'summary',
  'reason',
  'items',
  'selectable',
  'selected',
  'subject',
  'entity',
  'actions',
  'capability',
  'role',
  'target',
]);
const dateOnly = new Intl.DateTimeFormat('sv-SE', { dateStyle: 'long' });
/** "granskad 12 mars 2026", or nothing when the source gives no date. */
export const reviewLabel = (iso: string | undefined) => (iso ? `granskad ${dateOnly.format(new Date(iso))}` : '');
/**
 * The badge beside a hit (artboard 7): how long since the review when it is stale ("14 månader sedan", "2 år sedan"),
 * a note when the source gives no date, nothing when it is current. The meta line beside it already says the date.
 */
export function staleLabel(stale: boolean | null | undefined, iso: string | undefined, now = Date.now()): string {
  if (stale === null || stale === undefined) return iso ? '' : 'Granskningsdatum saknas';
  if (!stale) return '';
  const months = iso ? Math.floor((now - Date.parse(iso)) / (30.44 * 86_400_000)) : 0;
  if (months >= 24) return `${Math.floor(months / 12)} år sedan`;
  return months >= 1 ? `${months} ${months === 1 ? 'månad' : 'månader'} sedan` : 'Kan vara inaktuell';
}
const instant = /^\d{4}-\d{2}-\d{2}T/;
const day = /^\d{4}-\d{2}-\d{2}$/;
const time = new Intl.DateTimeFormat('sv-SE', { dateStyle: 'short', timeStyle: 'short' });
/**
 * A day has two lengths and one rule for which (the review of 2026-11-13, after "13 okt. 2026" and "13 oktober 2026"
 * stood on one page). Short, "13 okt. 2026", where days stand under one another to be scanned: a table's cell, a list's
 * line, a matrix's cell. Long, "13 oktober 2026", where a day is read rather than scanned: in a sentence, a toast, or
 * among one record's facts (a detail, a dialog's facts, a section's facts on a person's page). Every page writes a day
 * with one of these two; a calendar day (`2026-10-13`) is the day it names wherever the reader is.
 */
const shortFormat = new Intl.DateTimeFormat('sv-SE', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
const longFormat = new Intl.DateTimeFormat('sv-SE', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});
/** A calendar day, or the day of an instant where the reader is, as the moment it is formatted in UTC. */
const dayAt = (value: string) => {
  if (day.test(value)) return Date.parse(value + 'T12:00:00Z');
  const at = Date.parse(value);
  if (Number.isNaN(at)) return at;
  const local = new Date(at);
  return Date.UTC(local.getFullYear(), local.getMonth(), local.getDate(), 12);
};
/** How long a day is written where it stands (`shortDay`, `longDay`). */
export type DayLength = 'short' | 'long';
/** A day in a row: "13 okt. 2026". What cannot be read as a day is given back as it is. */
export const shortDay = (value: string) => {
  const at = dayAt(value);
  return Number.isNaN(at) ? value : shortFormat.format(at);
};
/** A day in a sentence or among a record's facts: "13 oktober 2026". What cannot be read as a day is given back as it is. */
export const longDay = (value: string) => {
  const at = dayAt(value);
  return Number.isNaN(at) ? value : longFormat.format(at);
};
/** A day at the length its place asks for. */
export const dayText = (value: string, length: DayLength) => (length === 'short' ? shortDay : longDay)(value);

export const fieldLabel = (key: string) => fieldLabels[key] ?? key;
/** One readable line for any value a capability returns. Nothing reaches the person as raw JSON. */
export function fieldValue(value: unknown): string {
  if (value === null || value === undefined) return '–';
  if (typeof value === 'boolean') return value ? 'Ja' : 'Nej';
  if (typeof value === 'number') return value.toLocaleString('sv-SE');
  if (typeof value === 'string')
    return instant.test(value)
      ? time.format(new Date(value))
      : day.test(value)
        ? dateOnly.format(new Date(`${value}T12:00:00`))
        : valueWord(value);
  if (Array.isArray(value)) return value.map(fieldValue).join(', ');
  return Object.entries(value)
    .filter(([key]) => !hiddenFields.has(key))
    .map(([, v]) => fieldValue(v))
    .join(' · ');
}
/** A number and its word (D71): "3 fakturor", "1 rum", "12 platser"; without a declared word a row is a "rad". */
export function counted(n: number, noun: ViewNoun = { one: 'rad', other: 'rader' }): string {
  return `${n.toLocaleString('sv-SE')} ${n === 1 ? noun.one : noun.other}`;
}
/**
 * A status field's one word (D71, artboard 4): a bare yes or no takes the field's label as its word ("Kvitterad",
 * "Inte kvitterad"), so two fields never read "Ja · Ja"; any other value is the source's word in Swedish. A code Clew
 * gives a word (`VALUE_WORDS`, which the model reads) stands alone as a status, so it is written as one, its first
 * letter capitalised ("Utgånget", as the matrix and the search write it too: one casing on every face, the review of
 * 2026-11-13). Words a source wrote itself ("tors 12 nov", "3 öppna") are drawn exactly as it wrote them.
 */
export function statusWord(label: string, value: unknown): string {
  if (typeof value === 'string' && Object.prototype.hasOwnProperty.call(VALUE_WORDS, value)) return statusLabel(value);
  if (typeof value !== 'boolean') return fieldValue(value);
  return value ? label : `Inte ${label.charAt(0).toLowerCase()}${label.slice(1)}`;
}
