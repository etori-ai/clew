import { rowsKey, valueWord, viewRows, type View, type ViewField } from '@clew/contracts';
import { readsSummary, viewSummary } from './views';

/**
 * What the model reads of a read (D122): one projection for every read, Clew's own and a remote connector's alike,
 * derived from what the read declares and nothing else. A manifest carries no code, so nothing a capability could run
 * decides it, and a connector author gets it by declaring a view.
 *
 * - A view that says `modelReads: 'summary'` gives the model the count and that the result is shown (D38).
 * - A table or a list gives each row as the view draws it: its fields' Swedish labels as keys, a status as the word the
 *   page shows, a number with its unit, a date written out in Swedish with its year ("27 november 2027") and a moment
 *   with its weekday and time in Swedish time ("måndag 16 november 2026 kl. 09:00"). The row's ref, every property the
 *   view does not draw and links are left out; the key of the person or unit the row names (`subject`) is kept, as the
 *   key another read takes. The scalar facts the output gives about the list as a whole come with it.
 * - A detail or a record gives its labelled facts the same way, a record its item rows and its sections.
 * - Without a view the output keeps its own keys, without the handles code uses (refs, ids, links), with dates and
 *   codes in words.
 *
 * Bounded: at most `READING_ROWS` rows and about `READING_CHARS` characters, with the count of what was left out. The
 * server keeps the output as it is for the card under the answer (which rows the answer names); the model never gets
 * the handles that would let it write an id in its answer.
 */
export const READING_ROWS = 100;
export const READING_CHARS = 12_000;
/** The longest value the model reads in one place. */
const VALUE_MAX = 2_000;
/** Keys that are handles for code, never words for a person: a ref, an id, a link, a row's own view. */
const HANDLES = new Set([
  'ref',
  'id',
  'revision',
  'eventRef',
  'threadId',
  'url',
  'link',
  'connector',
  'score',
  'kinds',
  'view',
  'recovery',
  'canCancel',
  'undoCapability',
  'undoMinutes',
  'undoInput',
  'mediaType',
  'data',
  'operation',
  'payload',
]);
const ZONE = 'Europe/Stockholm';
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
/** A day sent as the midnight of UTC (a review date, a publication date): read as the day it names, not a time. */
const UTC_MIDNIGHT = /T00:00(:00(\.0+)?)?Z$/;
const dayWords = new Intl.DateTimeFormat('sv-SE', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const momentWords = new Intl.DateTimeFormat('sv-SE', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: ZONE,
});
type Row = Record<string, unknown>;
const isRecord = (v: unknown): v is Row => !!v && typeof v === 'object' && !Array.isArray(v);
const empty = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
const clip = (text: string, max = VALUE_MAX) =>
  [...text].length > max ? [...text].slice(0, max - 1).join('') + '…' : text;

/**
 * A day or a moment in Swedish words, never ambiguous: a calendar day with its year ("27 november 2027"), a moment with
 * its weekday, year and time in Swedish time ("måndag 16 november 2026 kl. 09:00"). Undefined for anything else.
 */
export function dateWords(value: string): string | undefined {
  if (DAY.test(value)) {
    const at = Date.parse(value + 'T12:00:00Z');
    return Number.isNaN(at) ? undefined : dayWords.format(at);
  }
  if (!INSTANT.test(value)) return undefined;
  const at = Date.parse(value);
  if (Number.isNaN(at)) return undefined;
  return UTC_MIDNIGHT.test(value) ? dayWords.format(at) : momentWords.format(at);
}
/** A string as a person reads it: a date or a moment in words, a code as its word, anything else as given. */
const textWords = (value: string) => clip(dateWords(value) ?? valueWord(value));
const numberWords = (n: number) => n.toLocaleString('sv-SE');
const lower = (label: string) => label.charAt(0).toLocaleLowerCase('sv') + label.slice(1);

/** One field's value as the model reads it, by the field's format; undefined when there is nothing to read. */
export function fieldWords(field: ViewField, value: unknown): string | undefined {
  if (empty(value) || field.format === 'link') return undefined;
  if (Array.isArray(value))
    return clip(
      value
        .map(v => fieldWords(field, v))
        .filter((v): v is string => !!v)
        .join(', '),
    );
  if (typeof value === 'boolean')
    return field.format === 'status' ? (value ? field.label : `Inte ${lower(field.label)}`) : value ? 'Ja' : 'Nej';
  if (typeof value === 'number')
    return field.unit ? `${numberWords(value)} ${value === 1 ? field.unit.one : field.unit.other}` : numberWords(value);
  if (typeof value !== 'string') return clip(JSON.stringify(generic(value, 5, 0)));
  switch (field.format) {
    case 'phone':
    case 'email':
      return clip(value);
    case 'number':
      return clip(field.unit ? `${value} ${field.unit.other}` : value);
    default:
      return textWords(value);
  }
}
/** The word the key of a person or unit a row names is read under: the key another read takes as `person` or `unit`. */
const subjectLabel = (entity: string) => (entity === 'person' ? 'Användarnamn' : 'Enhetens id');
/** One record as the view draws it: its title first, then each field under its label, then the entity it names. */
function recordWords(
  fields: readonly ViewField[],
  title: string | undefined,
  record: Row,
  subject?: { entity: string; key: string },
): Record<string, string> {
  const out: Record<string, string> = {};
  const put = (label: string, words: string | undefined) => {
    if (words === undefined || words === '') return;
    let key = label;
    for (let n = 2; key in out; n++) key = `${label} (${n})`;
    out[key] = words;
  };
  const titled = title ? fields.find(f => f.key === title) : undefined;
  if (title && !titled) put('Namn', fieldWords({ key: title, label: 'Namn' }, record[title]));
  for (const f of titled ? [titled, ...fields.filter(f => f !== titled)] : fields)
    put(f.label, fieldWords(f, record[f.key]));
  const key = subject ? record[subject.key] : undefined;
  if (subject && typeof key === 'string' && key && !fields.some(f => f.key === subject.key))
    put(subjectLabel(subject.entity), clip(key, 256));
  return out;
}
/** A value without a view: its own keys less the handles, strings in words, at most `items` of each list. */
function generic(value: unknown, items: number, depth: number): unknown {
  if (typeof value === 'string') return textWords(value);
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 'Ja' : 'Nej';
  if (value === null || value === undefined) return undefined;
  if (depth > 6) return '…';
  if (Array.isArray(value)) {
    const kept = value
      .slice(0, items)
      .map(v => generic(v, items, depth + 1))
      .filter(v => v !== undefined);
    return value.length > items ? [...kept, `… och ${value.length - items} till, som inte lämnas till dig`] : kept;
  }
  if (!isRecord(value)) return undefined;
  const out: Row = {};
  for (const [key, v] of Object.entries(value)) {
    if (HANDLES.has(key)) continue;
    const read = generic(v, items, depth + 1);
    if (read !== undefined) out[key] = read;
  }
  return out;
}
const fits = (value: unknown) => JSON.stringify(value).length <= READING_CHARS;
/** The most of a value that fits: lists cut shorter until it does, and as a last resort the text cut. */
function fitted(value: unknown): unknown {
  for (const items of [READING_ROWS, 50, 20, 10, 5, 2, 1]) {
    const read = generic(value, items, 0);
    if (fits(read)) return read;
  }
  return { utdrag: clip(JSON.stringify(generic(value, 1, 0)), READING_CHARS - 100), avkortat: true };
}
/** The scalar facts an output gives beside its rows (a routine's owner, when a list was updated), read as any value. */
function facts(output: Row, skip: ReadonlySet<string>): Row {
  const out: Row = {};
  for (const [key, v] of Object.entries(output))
    if (
      !skip.has(key) &&
      !HANDLES.has(key) &&
      (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')
    )
      out[key] = generic(v, 1, 0);
  return out;
}
/**
 * Rows read as the view draws them, as many as fit: `antal` how many the read answered, `rader` those given, and when
 * some are left out how many and that they are.
 */
function rowsReading(rows: Row[], read: (row: Row) => Record<string, string>, around: Row = {}): Row {
  const total = rows.length;
  const make = (n: number): Row => ({
    ...around,
    antal: total,
    rader: rows.slice(0, n).map(read),
    ...(n < total
      ? {
          utelämnade: total - n,
          notering: `Bara de ${n} första raderna lämnas till dig. Säg det om svaret gäller alla ${total}.`,
        }
      : {}),
  });
  let lo = 0,
    hi = Math.min(total, READING_ROWS);
  if (fits(make(hi))) return make(hi);
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (fits(make(mid))) lo = mid;
    else hi = mid - 1;
  }
  return make(lo);
}

/** What the model reads of one read's output, from the read's declared view (or its absence) and its title. */
export function modelReading(view: View | undefined, title: string, output: unknown): unknown {
  if (view && readsSummary(view)) return viewSummary(view, title, output);
  if (!view) return fitted(output);
  const record = isRecord(output) ? output : {};
  switch (view.kind) {
    case 'table':
    case 'list': {
      const rows = viewRows(view, output);
      if (!rows) return fitted(output);
      return rowsReading(
        rows,
        row => recordWords(view.fields, view.title, row, view.subject),
        facts(record, new Set([rowsKey(view)!])),
      );
    }
    case 'detail':
      return recordWords(view.fields, view.title, record, view.subject);
    case 'record': {
      const head = recordWords(view.fields, view.title, record);
      const items = view.items;
      const sections: Row = {};
      for (const [key, label] of [
        [view.document, 'dokument'],
        [view.metrics, 'mätvärden'],
        [view.series, 'serie'],
        [view.activity, 'händelser'],
      ] as const)
        if (key && record[key] !== undefined) sections[label] = generic(record[key], 20, 0);
      const itemRows =
        items && Array.isArray(record[items.rows]) ? (record[items.rows] as unknown[]).filter(isRecord) : [];
      const reading = items
        ? rowsReading(itemRows, row => recordWords(items.fields, items.title, row), { ...head, ...sections })
        : { ...head, ...sections };
      return fits(reading)
        ? reading
        : { ...head, ...(items ? rowsReading(itemRows, row => recordWords(items.fields, items.title, row)) : {}) };
    }
    case 'text': {
      const body = record[view.body];
      return { text: typeof body === 'string' ? clip(body, READING_CHARS - 200) : '' };
    }
    default:
      return fitted(output);
  }
}
