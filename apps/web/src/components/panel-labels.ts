import type { ViewNoun } from '@clew/contracts';
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
const values: Record<string, string> = {
  // A person in the round of development talks (D96 item 2).
  booked: 'bokat',
  held: 'hållet',
  missing: 'saknas',
  closed: 'stängd',
  done: 'klart',
  failed: 'misslyckades',
  long: 'sjukskriven',
  open: 'öppen',
  short: 'sjuk',
  skipped: 'inte skickad',
  unknown: 'okänt',
  vab: 'vab',
  'waiting-safety-rep': 'väntar på skyddsombud',
};
const instant = /^\d{4}-\d{2}-\d{2}T/;
const day = /^\d{4}-\d{2}-\d{2}$/;
const time = new Intl.DateTimeFormat('sv-SE', { dateStyle: 'short', timeStyle: 'short' });

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
        : (values[value] ?? value);
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
 * "Inte kvitterad"), so two fields never read "Ja · Ja"; any other value is the source's word in Swedish.
 */
export function statusWord(label: string, value: unknown): string {
  if (typeof value !== 'boolean') return fieldValue(value);
  return value ? label : `Inte ${label.charAt(0).toLowerCase()}${label.slice(1)}`;
}
