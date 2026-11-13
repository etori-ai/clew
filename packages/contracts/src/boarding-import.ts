/**
 * A file of boarding layers an administrator uploads (D124): the flat lists of template items that introduction and
 * leaving plans are assembled from. One row per item, the layer it belongs to named on every row, in Clew's own CSV:
 *
 *   layer;event;condition;value;title;kind;owner;offsetDays;tiedTo
 *   Alla nyanställda;introduction;all;;Beställ dator och telefon;order;manager;-14;
 *   Alla nyanställda;introduction;all;;Välkomstsamtal;meeting;manager;0;
 *   Vård och omsorg;introduction;unit;unit-omsorg;Läs rutinen för basala hygienrutiner;acknowledge;person;3;
 *   Undersköterskor;introduction;position;underskoterska;HLR;course;person;30;HLR
 *
 * - `layer`: the layer's name, at most 80 characters. A layer is known by its name and its event together, without
 *   regard to case: every row of one layer names the same condition and value, and its rows are its items in the
 *   file's order.
 * - `event`: `introduction` or `leaving` (or the page's words, `Introduktion`, `Avslut`).
 * - `condition`: whom the layer applies to: `all`, `unit` (that unit and every unit below it), `position` (by the
 *   position's code) or `employment_type` (the employment type exactly as the directory writes it); or the page's words,
 *   `Alla`, `Enhet`, `Befattning`, `Anställningsform`.
 * - `value`: the unit's id, the position's code or the employment type; empty for `all`.
 * - `title`: the item as the person who owns it reads it, at most 120 characters. Template text: it is the card's
 *   title, so it names nobody.
 * - `kind`: `todo`, `order`, `meeting`, `course` or `acknowledge` (or `Att göra`, `Beställning`, `Möte`, `Kurs`,
 *   `Bekräftelse`). In the first build every kind is a plain to-do.
 * - `owner`: who does it: `manager`, `person` (the one the plan is about) or `buddy` (or `Chef`, `Medarbetaren`,
 *   `Fadder`).
 * - `offsetDays`: whole days from the plan's day (the first day, or the last day of a leaving plan): negative before
 *   it, 0 on it; from -365 to 365.
 * - `tiedTo`: optional, a capability's name or a link that later phases use; at most 300 characters.
 *
 * Pure functions with no I/O and nothing of ours imported: the page reads the file with them, and the server checks
 * every row it is sent again with `boardingImportRowProblem` and groups them with `boardingLayersOf`, so the two can
 * never disagree. Nothing here throws on what a file holds; what is wrong is a problem with its row, in Swedish, as the
 * page shows it. The CSV is RFC 4180 (a quoted field may hold the delimiter, a line break and `""`), a byte order mark is
 * skipped, `,` or `;` is recognised from the first row, and rows are numbered by record: the header is row 1, an empty
 * line has no number.
 */

/** The longest file read, in characters. */
export const BOARDING_IMPORT_MAX_CHARS = 2_000_000;
/** The most rows a file may have below its first, and the most one request to the server carries: a file is sent whole. */
export const BOARDING_IMPORT_ROWS_MAX = 2000;
/** The most items one layer may hold. */
export const BOARDING_LAYER_ITEMS_MAX = 100;
/** The most problems listed; the rest are counted. */
export const BOARDING_IMPORT_PROBLEMS_MAX = 200;
export const BOARDING_LAYER_NAME_MAX = 80;
export const BOARDING_VALUE_MAX = 120;
/** A template item's title, which is a card's title. */
export const BOARDING_TITLE_MAX = 120;
export const BOARDING_TIED_TO_MAX = 300;
export const BOARDING_OFFSET_MAX = 365;

/** The two events a plan is about (D124). */
export const BOARDING_EVENTS = ['introduction', 'leaving'] as const;
export type BoardingEvent = (typeof BOARDING_EVENTS)[number];
/** Whom a layer applies to (D124): everyone, a unit and the units below it, a position, an employment type. */
export const BOARDING_CONDITIONS = ['all', 'unit', 'position', 'employment_type'] as const;
export type BoardingCondition = (typeof BOARDING_CONDITIONS)[number];
/** The closed set of item kinds (D124). Every kind behaves as a plain to-do in the first build. */
export const BOARDING_ITEM_KINDS = ['todo', 'order', 'meeting', 'course', 'acknowledge'] as const;
export type BoardingItemKind = (typeof BOARDING_ITEM_KINDS)[number];
/** Who owns an item of a template (D124): the manager who starts the plan, the person it is about, or their buddy. */
export const BOARDING_OWNER_ROLES = ['manager', 'person', 'buddy'] as const;
export type BoardingOwnerRole = (typeof BOARDING_OWNER_ROLES)[number];

/** Swedish. The page's words for each value; a file may name a value so. */
export const BOARDING_EVENT_WORDS: Record<BoardingEvent, string> = { introduction: 'Introduktion', leaving: 'Avslut' };
export const BOARDING_CONDITION_WORDS: Record<BoardingCondition, string> = {
  all: 'Alla',
  unit: 'Enhet',
  position: 'Befattning',
  employment_type: 'Anställningsform',
};
export const BOARDING_KIND_WORDS: Record<BoardingItemKind, string> = {
  todo: 'Att göra',
  order: 'Beställning',
  meeting: 'Möte',
  course: 'Kurs',
  acknowledge: 'Bekräftelse',
};
export const BOARDING_OWNER_WORDS: Record<BoardingOwnerRole, string> = {
  manager: 'Chef',
  person: 'Medarbetaren',
  buddy: 'Fadder',
};
/** Clew's columns, in the order a file of Clew's is written. */
export const BOARDING_IMPORT_COLUMNS = [
  'layer',
  'event',
  'condition',
  'value',
  'title',
  'kind',
  'owner',
  'offsetDays',
  'tiedTo',
] as const;

/** One item a file offers, as read and checked, with the layer it belongs to. Every value is Clew's id. */
export interface BoardingImportRow {
  /** The row's number in the file, by record: the header is 1, the first item 2. */
  row: number;
  layer: string;
  event: BoardingEvent;
  condition: BoardingCondition;
  /** Null for `all`. */
  value: string | null;
  title: string;
  kind: BoardingItemKind;
  owner: BoardingOwnerRole;
  offsetDays: number;
  tiedTo: string | null;
}
/** A row as the server is sent it: the same fields, each re-checked there with `boardingImportRowProblem`. */
export type BoardingImportCandidate = BoardingImportRow;
/** What is wrong, in the words the page shows. `row` 0 is the file as a whole. */
export interface BoardingImportProblem {
  row: number;
  message: string;
}
export interface BoardingImportResult {
  /** Every row that holds, in the file's order. */
  rows: BoardingImportRow[];
  /** The first problems, at most `BOARDING_IMPORT_PROBLEMS_MAX`, in the file's order. */
  problems: BoardingImportProblem[];
  /** How many problems there are, the ones not listed included. */
  problemCount: number;
}
/** One layer of a file, its items in the file's order. */
export interface BoardingImportLayer {
  name: string;
  event: BoardingEvent;
  condition: BoardingCondition;
  value: string | null;
  items: Array<Pick<BoardingImportRow, 'row' | 'title' | 'kind' | 'owner' | 'offsetDays' | 'tiedTo'>>;
}

/** A control character or half a surrogate pair: a column cannot hold one reliably, and no name needs one. */
const UNSAFE = /[\u0000-\u001f\u007f-\u009f]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
/** What no name shows and no name needs: zero-width characters, the soft hyphen and the controls of the direction of text. */
const INVISIBLE = /[­؜᠎​-‏‪-‮⁠-⁤⁦-⁯﻿]/g;
/** A name or a title as it is kept: composed (NFC), without invisible characters, one line, trimmed. */
export const boardingText = (value: string) =>
  value.normalize('NFC').replace(INVISIBLE, '').replace(/\s+/g, ' ').trim();
/** A layer's name as it is compared: `boardingText`, then lower case. */
export const layerKey = (event: string, name: string) => event + '\n' + boardingText(name).toLowerCase();
const length = (value: string) => [...value].length;
/** One of a closed list, by Clew's id or by the page's word, without regard to case. */
function oneOf<T extends string>(values: readonly T[], words: Record<T, string>, text: string): T | undefined {
  const wanted = text.trim().toLowerCase();
  return values.find(v => v === wanted || words[v].toLowerCase() === wanted);
}
export const boardingEventOf = (text: string) => oneOf(BOARDING_EVENTS, BOARDING_EVENT_WORDS, text);
export const boardingConditionOf = (text: string) => oneOf(BOARDING_CONDITIONS, BOARDING_CONDITION_WORDS, text);
export const boardingKindOf = (text: string) => oneOf(BOARDING_ITEM_KINDS, BOARDING_KIND_WORDS, text);
export const boardingOwnerOf = (text: string) => oneOf(BOARDING_OWNER_ROLES, BOARDING_OWNER_WORDS, text);
const help = <T extends string>(values: readonly T[], words: Record<T, string>) =>
  `Använd ${values.join(', ')} eller ${values.map(v => words[v]).join(', ')}.`;

function textProblem(value: string, what: string, max: number, required = true): string | null {
  if (!value) return required ? `${what} saknas.` : null;
  if (UNSAFE.test(value)) return `${what} innehåller tecken som inte kan sparas.`;
  if (length(value) > max) return `${what} är längre än ${max} tecken.`;
  return null;
}
const OFFSET_PROBLEM = `Antal dagar ska vara ett heltal från -${BOARDING_OFFSET_MAX} till ${BOARDING_OFFSET_MAX}.`;
const VALUE_FOR_ALL = 'Ett lager för alla har inget värde.';

/**
 * What is wrong with one row the server is sent, in the words the page shows, or null when it holds: the same rules the
 * page read the file with. Every value must be Clew's id, and every text as `boardingText` leaves it.
 */
export function boardingImportRowProblem(row: BoardingImportCandidate): string | null {
  const same = (value: string | null) => value === null || boardingText(value) === value;
  if (!same(row.layer) || !same(row.title) || !same(row.value) || !same(row.tiedTo))
    return 'Raden innehåller text som inte är rensad.';
  return (
    textProblem(row.layer, 'Lagrets namn', BOARDING_LAYER_NAME_MAX) ??
    (boardingEventOf(row.event) !== row.event
      ? `Händelsen finns inte. ${help(BOARDING_EVENTS, BOARDING_EVENT_WORDS)}`
      : null) ??
    (boardingConditionOf(row.condition) !== row.condition
      ? `Villkoret finns inte. ${help(BOARDING_CONDITIONS, BOARDING_CONDITION_WORDS)}`
      : null) ??
    (row.condition === 'all'
      ? row.value !== null
        ? VALUE_FOR_ALL
        : null
      : textProblem(row.value ?? '', 'Värdet', BOARDING_VALUE_MAX)) ??
    textProblem(row.title, 'Uppgiften', BOARDING_TITLE_MAX) ??
    (boardingKindOf(row.kind) !== row.kind
      ? `Typen finns inte. ${help(BOARDING_ITEM_KINDS, BOARDING_KIND_WORDS)}`
      : null) ??
    (boardingOwnerOf(row.owner) !== row.owner
      ? `Ansvarig finns inte. ${help(BOARDING_OWNER_ROLES, BOARDING_OWNER_WORDS)}`
      : null) ??
    (!Number.isInteger(row.offsetDays) || Math.abs(row.offsetDays) > BOARDING_OFFSET_MAX ? OFFSET_PROBLEM : null) ??
    (row.tiedTo !== null ? textProblem(row.tiedTo, 'Kopplingen', BOARDING_TIED_TO_MAX) : null)
  );
}

/**
 * The rows grouped into layers, in the order each layer first appears, its items in the file's order: a layer is its
 * event and its name without regard to case. A row that names another condition or value than its layer's first row,
 * or one past `BOARDING_LAYER_ITEMS_MAX` items, is a problem that names the first row.
 */
export function boardingLayersOf(rows: readonly BoardingImportRow[]): {
  layers: BoardingImportLayer[];
  problems: BoardingImportProblem[];
} {
  const layers = new Map<string, BoardingImportLayer & { first: number }>();
  const problems: BoardingImportProblem[] = [];
  for (const r of rows) {
    const key = layerKey(r.event, r.layer);
    const layer = layers.get(key);
    if (!layer) {
      layers.set(key, {
        name: r.layer,
        event: r.event,
        condition: r.condition,
        value: r.value,
        first: r.row,
        items: [itemOf(r)],
      });
      continue;
    }
    if (layer.condition !== r.condition || layer.value !== r.value)
      problems.push({ row: r.row, message: `Samma lager som rad ${layer.first}, men med ett annat villkor.` });
    else if (layer.items.length >= BOARDING_LAYER_ITEMS_MAX)
      problems.push({
        row: r.row,
        message: `Lagret från rad ${layer.first} har fler än ${BOARDING_LAYER_ITEMS_MAX} uppgifter.`,
      });
    else layer.items.push(itemOf(r));
  }
  return { layers: [...layers.values()].map(({ first: _first, ...layer }) => layer), problems };
}
const itemOf = (r: BoardingImportRow) => ({
  row: r.row,
  title: r.title,
  kind: r.kind,
  owner: r.owner,
  offsetDays: r.offsetDays,
  tiedTo: r.tiedTo,
});

/** The fields of one CSV record and whether a quote went wrong in it. */
interface CsvRecord {
  row: number;
  fields: string[];
  malformed: boolean;
}
/** RFC 4180 records numbered by record, an empty line given none; stops past `max` rows and at a quote that never ends. */
function readCsv(text: string, delimiter: string, max: number) {
  const records: CsvRecord[] = [];
  let fields: string[] = [],
    field = '',
    quoted = false,
    malformed = false,
    started = false,
    quotedAt = 0;
  const end = () => {
    fields.push(field);
    if (!(fields.length === 1 && fields[0] === '' && !started))
      records.push({ row: records.length + 1, fields, malformed });
    fields = [];
    field = '';
    malformed = false;
    started = false;
  };
  for (let i = 0; i < text.length;) {
    if (records.length > max) return { records: [], unterminated: null, tooMany: true };
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i += 2;
      } else if (c === '"') {
        quoted = false;
        i++;
        const next = text[i];
        if (next !== undefined && next !== delimiter && next !== '\n' && next !== '\r') malformed = true;
      } else {
        field += c;
        i++;
      }
      continue;
    }
    if (c === '"' && field === '') {
      quoted = true;
      started = true;
      quotedAt = records.length + 1;
      i++;
    } else if (c === delimiter) {
      fields.push(field);
      field = '';
      started = true;
      i++;
    } else if (c === '\r' || c === '\n') {
      end();
      i += c === '\r' && text[i + 1] === '\n' ? 2 : 1;
    } else {
      field += c;
      started = true;
      i++;
    }
  }
  if (quoted) return { records, unterminated: quotedAt, tooMany: false };
  if (field !== '' || fields.length > 0 || started) end();
  if (records.length > max) return { records: [], unterminated: null, tooMany: true };
  return { records, unterminated: null as number | null, tooMany: false };
}
/** `;` when the first row has more of them than of `,`, outside quotes. */
function delimiterOf(text: string): string {
  let commas = 0,
    semicolons = 0,
    quoted = false;
  for (const c of text) {
    if (c === '"') quoted = !quoted;
    else if (!quoted && (c === '\n' || c === '\r')) break;
    else if (!quoted && c === ',') commas++;
    else if (!quoted && c === ';') semicolons++;
  }
  return semicolons > commas ? ';' : ',';
}

/**
 * Read a file of layers: every row that holds and every problem, never throwing on what the file holds. A row with a
 * problem is not among the rows; a row that disagrees with its layer's first row is a problem (`boardingLayersOf`).
 */
export function parseBoardingImport(input: string): BoardingImportResult {
  const problems: BoardingImportProblem[] = [];
  let problemCount = 0;
  const problem = (row: number, message: string) => {
    problemCount++;
    if (problems.length < BOARDING_IMPORT_PROBLEMS_MAX) problems.push({ row, message });
  };
  const nothing = (): BoardingImportResult => ({ rows: [], problems, problemCount });
  if (input.length > BOARDING_IMPORT_MAX_CHARS) {
    problem(0, `Filen är för stor. Den får vara högst ${BOARDING_IMPORT_MAX_CHARS / 1_000_000} miljoner tecken.`);
    return nothing();
  }
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  if (!text.trim()) {
    problem(0, 'Filen är tom.');
    return nothing();
  }
  if (text.includes('�')) {
    problem(0, 'Filen innehåller tecken som inte kunde läsas. Spara den som CSV i UTF-8 och välj den igen.');
    return nothing();
  }
  const { records, unterminated, tooMany } = readCsv(text, delimiterOf(text), BOARDING_IMPORT_ROWS_MAX + 1);
  if (tooMany) {
    problem(0, `Filen har fler än ${BOARDING_IMPORT_ROWS_MAX} rader. Dela upp den per lager.`);
    return nothing();
  }
  const [header, ...body] = records;
  const columns = (header?.fields ?? []).map(f => f.trim().toLowerCase());
  const at = (name: string) => columns.indexOf(name.toLowerCase());
  const missing = BOARDING_IMPORT_COLUMNS.filter(c => c !== 'tiedTo' && at(c) < 0);
  if (!header || missing.length) {
    problem(1, `Filen känns inte igen. Den första raden ska vara ${BOARDING_IMPORT_COLUMNS.join(', ')}.`);
    return nothing();
  }
  const cell = (fields: string[], name: string) => {
    const index = at(name);
    return index < 0 ? '' : (fields[index] ?? '');
  };
  const read: BoardingImportRow[] = [];
  for (const record of body) {
    const { row, fields } = record;
    if (record.malformed) {
      problem(row, 'Raden har ett citattecken på fel ställe.');
      continue;
    }
    if (fields.length > columns.length) {
      problem(row, `Raden har ${fields.length} fält, men den första raden har ${columns.length}.`);
      continue;
    }
    const eventText = cell(fields, 'event'),
      conditionText = cell(fields, 'condition'),
      kindText = cell(fields, 'kind'),
      ownerText = cell(fields, 'owner'),
      offsetText = cell(fields, 'offsetDays').trim(),
      valueText = boardingText(cell(fields, 'value')),
      tiedText = boardingText(cell(fields, 'tiedTo'));
    const event = boardingEventOf(eventText),
      condition = boardingConditionOf(conditionText),
      kind = boardingKindOf(kindText),
      owner = boardingOwnerOf(ownerText);
    const named = (text: string, what: string, words: string) =>
      text.trim()
        ? `${what} ”${[...text.trim()].slice(0, 40).join('')}” finns inte. ${words}`
        : `${what} saknas. ${words}`;
    const wrong =
      (!event ? named(eventText, 'Händelsen', help(BOARDING_EVENTS, BOARDING_EVENT_WORDS)) : null) ??
      (!condition ? named(conditionText, 'Villkoret', help(BOARDING_CONDITIONS, BOARDING_CONDITION_WORDS)) : null) ??
      (!kind ? named(kindText, 'Typen', help(BOARDING_ITEM_KINDS, BOARDING_KIND_WORDS)) : null) ??
      (!owner ? named(ownerText, 'Ansvarig', help(BOARDING_OWNER_ROLES, BOARDING_OWNER_WORDS)) : null) ??
      (/^[+-]?\d{1,3}$/.test(offsetText) ? null : OFFSET_PROBLEM);
    if (wrong || !event || !condition || !kind || !owner) {
      problem(row, wrong ?? OFFSET_PROBLEM);
      continue;
    }
    if (condition === 'all' && valueText) {
      problem(row, VALUE_FOR_ALL);
      continue;
    }
    const candidate: BoardingImportRow = {
      row,
      layer: boardingText(cell(fields, 'layer')),
      event,
      condition,
      value: condition === 'all' ? null : valueText,
      title: boardingText(cell(fields, 'title')),
      kind,
      owner,
      offsetDays: Number(offsetText),
      tiedTo: tiedText || null,
    };
    const rowProblem = boardingImportRowProblem(candidate);
    if (rowProblem) {
      problem(row, rowProblem);
      continue;
    }
    read.push(candidate);
  }
  const grouping = boardingLayersOf(read).problems;
  const refused = new Set(grouping.map(p => p.row));
  for (const p of grouping) problem(p.row, p.message);
  if (unterminated !== null) problem(unterminated, 'Ett citattecken avslutas aldrig. Resten av filen kan inte läsas.');
  return {
    rows: read.filter(r => !refused.has(r.row)),
    problems: problems.sort((a, b) => a.row - b.row),
    problemCount,
  };
}
