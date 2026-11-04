import type { ViewRef } from '@clew/contracts';

/** Swedish names for what read capabilities return. `tests/unit/panel-labels.test.ts` holds every module output to this list. */
export const fieldLabels: Record<string, string> = {
  absent: 'Frånvarande', account: 'Konto', acknowledged: 'Läst', amount: 'Belopp', at: 'Tid', budget: 'Budget', clash: 'Krock', colleagues: 'Kollegor',
  date: 'Datum', days: 'Dagar', detail: 'Detalj', deviationPct: 'Avvikelse i procent', driver: 'Orsak', due: 'Förfaller', dueBy: 'Senast', end: 'Slutar',
  forecast: 'Prognos', from: 'Från', headline: 'Rubrik', kind: 'Typ', label: 'Namn', long: 'Långtidsfrånvaro, dagar', mustUseBy: 'Ska tas ut senast',
  name: 'Namn', onDuty: 'I tjänst', order: 'Beställning', outcome: 'Utfall', periods: 'Perioder', requiresReceipt: 'Kräver läskvitto', rows: 'Rader',
  rule: 'Regel', short: 'Korttidsfrånvaro, dagar', start: 'Börjar', state: 'Status', supplier: 'Leverantör', title: 'Titel', to: 'Till', today: 'I dag',
  type: 'Typ', undoUntil: 'Kan ångras till', vab: 'Vab, dagar', vacationDaysLeft: 'Semesterdagar kvar', waitingOn: 'Väntar på', ward: 'Avdelning',
  body: 'Meddelande', capability: 'Funktion', category: 'Kategori', channel: 'Kanal', deadlines: 'Tidsgränser', description: 'Beskrivning',
  direction: 'Riktning', dueAt: 'Senast', errandNumber: 'Ärendenummer', lastCommunication: 'Senaste meddelande', nextDeadline: 'Nästa tidsgräns',
  phase: 'Fas', relationship: 'Din koppling', source: 'Källa', status: 'Status', suspendedUntil: 'Parkerat till', unreadCount: 'Olästa händelser',
};
/** Addresses and references: useful to the code, never to the person reading the panel. */
export const hiddenFields = new Set(['ref', 'url', 'undoCapability', 'view', 'input']);
const values: Record<string, string> = {
  closed: 'stängd', done: 'klart', failed: 'misslyckades', long: 'sjukskriven', open: 'öppen', short: 'sjuk', skipped: 'inte skickad', unknown: 'okänt',
  vab: 'vab', 'waiting-safety-rep': 'väntar på skyddsombud',
  inbound: 'Inkommande', outbound: 'Utgående',
};
const instant = /^\d{4}-\d{2}-\d{2}T/;
const time = new Intl.DateTimeFormat('sv-SE', { dateStyle: 'short', timeStyle: 'short' });

export const fieldLabel = (key: string) => fieldLabels[key] ?? key;
/** Optional drill-down metadata uses the existing view contract; malformed rows remain ordinary text. */
export function rowView(row: Record<string, unknown>): ViewRef | undefined {
  const v = row.view;
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  if (!('capability' in v) || typeof v.capability !== 'string' || !('title' in v) || typeof v.title !== 'string' || !('source' in v) || typeof v.source !== 'string') return undefined;
  if (!('input' in v) || !v.input || typeof v.input !== 'object' || Array.isArray(v.input)) return undefined;
  return { capability: v.capability, title: v.title, source: v.source, input: Object.fromEntries(Object.entries(v.input)) };
}
/** One readable line for any value a capability returns. Nothing reaches the person as raw JSON. */
export function fieldValue(value: unknown): string {
  if (value === null || value === undefined) return '–';
  if (typeof value === 'boolean') return value ? 'Ja' : 'Nej';
  if (typeof value === 'number') return value.toLocaleString('sv-SE');
  if (typeof value === 'string') return instant.test(value) ? time.format(new Date(value)) : values[value] ?? value;
  if (Array.isArray(value)) return value.map(fieldValue).join(', ');
  return Object.entries(value).filter(([key]) => !hiddenFields.has(key)).map(([, v]) => fieldValue(v)).join(' · ');
}
