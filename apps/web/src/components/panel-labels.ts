/** Swedish names for what read capabilities return. `tests/unit/panel-labels.test.ts` holds every connector output to this list. */
export const fieldLabels: Record<string, string> = {
  absent: 'Frånvarande', account: 'Konto', acknowledged: 'Läst', amount: 'Belopp', at: 'Tid', budget: 'Budget', clash: 'Krock', colleagues: 'Kollegor',
  date: 'Datum', days: 'Dagar', detail: 'Detalj', deviationPct: 'Avvikelse i procent', driver: 'Orsak', due: 'Förfaller', dueBy: 'Senast', end: 'Slutar',
  forecast: 'Prognos', from: 'Från', headline: 'Rubrik', kind: 'Typ', label: 'Namn', long: 'Långtidsfrånvaro, dagar', mustUseBy: 'Ska tas ut senast',
  name: 'Namn', onDuty: 'I tjänst', order: 'Beställning', outcome: 'Utfall', periods: 'Perioder', requiresReceipt: 'Kräver läskvitto', rows: 'Rader',
  rule: 'Regel', short: 'Korttidsfrånvaro, dagar', start: 'Börjar', state: 'Status', supplier: 'Leverantör', title: 'Titel', to: 'Till', today: 'I dag',
  type: 'Typ', undoUntil: 'Kan ångras till', vab: 'Vab, dagar', vacationDaysLeft: 'Semesterdagar kvar', waitingOn: 'Väntar på', ward: 'Avdelning',
  // Found text (D26)
  owner: 'Ägare', query: 'Fråga', reviewedAt: 'Granskad', reviewIntervalDays: 'Granskas var, dagar', section: 'Avsnitt', snippet: 'Utdrag', source: 'Källa', sources: 'Källor', stale: 'Inaktuell',
  status: 'Status', updatedAt: 'Ändrad',
};
/** Addresses and references: useful to the code, never to the person reading the panel. */
export const hiddenFields = new Set(['ref', 'url', 'undoCapability', 'link', 'connector', 'score', 'kinds']);
const dateOnly = new Intl.DateTimeFormat('sv-SE', { dateStyle: 'long' });
/** "granskad 12 mars 2026", or nothing when the source gives no date. */
export const reviewLabel = (iso: string | undefined) => iso ? `granskad ${dateOnly.format(new Date(iso))}` : '';
/** The badge beside a hit: how long since the review when it is stale, a note when the source gives no date, nothing when it is current. */
export function staleLabel(stale: boolean | null | undefined, iso: string | undefined, now = Date.now()): string {
  if (stale === null || stale === undefined) return iso ? '' : 'Granskningsdatum saknas';
  if (!stale) return '';
  const years = iso ? Math.floor((now - Date.parse(iso)) / (365.25 * 86_400_000)) : 0;
  return years >= 1 ? `Granskad för ${years} år sedan` : 'Kan vara inaktuell';
}
const values: Record<string, string> = {
  closed: 'stängd', done: 'klart', failed: 'misslyckades', long: 'sjukskriven', open: 'öppen', short: 'sjuk', skipped: 'inte skickad', unknown: 'okänt',
  vab: 'vab', 'waiting-safety-rep': 'väntar på skyddsombud',
};
const instant = /^\d{4}-\d{2}-\d{2}T/;
const time = new Intl.DateTimeFormat('sv-SE', { dateStyle: 'short', timeStyle: 'short' });

export const fieldLabel = (key: string) => fieldLabels[key] ?? key;
/** One readable line for any value a capability returns. Nothing reaches the person as raw JSON. */
export function fieldValue(value: unknown): string {
  if (value === null || value === undefined) return '–';
  if (typeof value === 'boolean') return value ? 'Ja' : 'Nej';
  if (typeof value === 'number') return value.toLocaleString('sv-SE');
  if (typeof value === 'string') return instant.test(value) ? time.format(new Date(value)) : values[value] ?? value;
  if (Array.isArray(value)) return value.map(fieldValue).join(', ');
  return Object.entries(value).filter(([key]) => !hiddenFields.has(key)).map(([, v]) => fieldValue(v)).join(' · ');
}
