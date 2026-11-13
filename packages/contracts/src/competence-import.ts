/**
 * A file of competence types an administrator uploads to the catalogue (D120 item 7, D108 item 2). Two formats are
 * read, recognised by the file's first row:
 *
 * - Clew's own CSV, with the columns `name`, `area`, `kind`, `validityMonths` and `uri` (the last two may be left out
 *   or empty). A kind is written as Clew's id (`certificate`) or as the page words it (`Certifikat`).
 * - The skills CSV of ESCO, the European Commission's classification of skills, read by its published column names
 *   (`conceptType`, `conceptUri`, `skillType`, `reuseLevel`, `preferredLabel`, `altLabels`, `hiddenLabels`, `status`,
 *   `modifiedDate`, `scopeNote`, `definition`, `inScheme`, `description`). A row is a skill named by its
 *   `preferredLabel` and kept by its `conceptUri`; one whose `status` is not `released` is left out. Its area is the
 *   one the administrator chooses. No ESCO file is part of Clew: the administrator downloads it from its publisher.
 *
 * Pure functions with no I/O and nothing of ours imported: the page reads the file with them, and the server checks
 * every row it is sent again with `competenceImportRowProblem`, so the two can never disagree. Nothing here throws on
 * what a file holds; what is wrong is a problem with its row, in the words the page shows. The CSV is RFC 4180: a field
 * in double quotes may hold the delimiter, a line break and `""` for a quote; a byte order mark is skipped; a row ends
 * with CRLF, LF or CR. A file written by a spreadsheet in Swedish separates with `;`, which is recognised from the
 * first row.
 */

/** The longest file read, in characters: ESCO's skills file in one language is well under it. */
export const COMPETENCE_IMPORT_MAX_CHARS = 40_000_000;
/** The most rows a file may have below its first: ESCO's skills file has about 14 000. */
export const COMPETENCE_IMPORT_ROWS_MAX = 30_000;
/** The most problems listed; the rest are counted. */
export const COMPETENCE_IMPORT_PROBLEMS_MAX = 200;
/** The most rows one request to the server carries; the page sends a larger choice in parts. */
export const COMPETENCE_IMPORT_REQUEST_MAX = 1000;
/** The most types an organisation's catalogue may hold, archived ones included, as far as an import is concerned. */
export const COMPETENCE_CATALOGUE_MAX = 20_000;
/** The longest address a type may keep. */
export const COMPETENCE_URI_MAX = 300;
/** As the catalogue's own limits: a name and an area, counted in characters as a person sees them. */
export const COMPETENCE_IMPORT_NAME_MAX = 120;
export const COMPETENCE_IMPORT_AREA_MAX = 80;
export const COMPETENCE_IMPORT_VALIDITY_MAX = 600;

/**
 * The catalogue's kinds as this file knows them: the same closed list as `COMPETENCE_KINDS` in `@clew/contracts`,
 * repeated here so the file imports nothing, and held to that list by the compiler there.
 */
export const COMPETENCE_IMPORT_KINDS = ['certificate', 'degree', 'course', 'authorisation', 'skill'] as const;
export type CompetenceImportKind = (typeof COMPETENCE_IMPORT_KINDS)[number];
/** Swedish. Each kind as the catalogue's page words it; a file may name a kind so. */
export const COMPETENCE_IMPORT_KIND_WORDS: Record<CompetenceImportKind, string> = {
  certificate: 'Certifikat',
  degree: 'Examen',
  course: 'Kurs',
  authorisation: 'Behörighet',
  skill: 'Färdighet',
};
export const COMPETENCE_IMPORT_FORMATS = ['clew', 'esco'] as const;
export type CompetenceImportFormat = (typeof COMPETENCE_IMPORT_FORMATS)[number];
/** Clew's own columns, in the order a file of Clew's is written. */
export const COMPETENCE_IMPORT_COLUMNS = ['name', 'area', 'kind', 'validityMonths', 'uri'] as const;
/** ESCO's skills file's columns, as published. Only `conceptUri`, `preferredLabel` and `status` are read. */
export const ESCO_SKILL_COLUMNS = [
  'conceptType',
  'conceptUri',
  'skillType',
  'reuseLevel',
  'preferredLabel',
  'altLabels',
  'hiddenLabels',
  'status',
  'modifiedDate',
  'scopeNote',
  'definition',
  'inScheme',
  'description',
] as const;
/** The status of an ESCO concept that is published; any other row is left out. */
export const ESCO_RELEASED = 'released';

/** One type a file offers, as read and checked. `area` is null on an ESCO row: the administrator chooses it. */
export interface CompetenceImportRow {
  /** The row's number in the file as a spreadsheet counts it: the first row is 1, the first type 2. */
  row: number;
  name: string;
  area: string | null;
  kind: CompetenceImportKind;
  validityMonths: number | null;
  uri: string | null;
}
/** What is wrong, in the words the page shows. `row` 0 is the file as a whole. */
export interface CompetenceImportProblem {
  row: number;
  message: string;
}
export interface CompetenceImportResult {
  /** Which format the first row says the file is in; null when it is neither. */
  format: CompetenceImportFormat | null;
  /** Every row that holds, in the file's order. */
  rows: CompetenceImportRow[];
  /** The first problems, at most `COMPETENCE_IMPORT_PROBLEMS_MAX`, in the file's order. */
  problems: CompetenceImportProblem[];
  /** How many problems there are, the ones not listed included. */
  problemCount: number;
  /** ESCO rows left out because their status is not `released`. */
  notReleased: number;
}
/** A row as the server is sent it, after the page chose it: every column filled, an ESCO row's area included. */
export interface CompetenceImportCandidate {
  name: string;
  area: string;
  kind: string;
  validityMonths: number | null;
  uri: string | null;
}

/** A control character or half a surrogate pair: a database column cannot hold one reliably, and no name needs one. */
const UNSAFE = /[\u0000-\u001f\u007f-\u009f]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
/** A name, an area: one line, trimmed, every run of white space one space. */
export const importText = (value: string) => value.replace(/\s+/g, ' ').trim();
const length = (value: string) => [...value].length;
/** An absolute address: a scheme, a colon, and no white space or control character after it. */
const URI = /^[A-Za-z][A-Za-z0-9+.-]*:[^\s\u0000-\u001f\u007f]+$/;
/** The kind a file names, by Clew's id or by the page's word, without regard to case. */
export function importKind(value: string): CompetenceImportKind | undefined {
  const wanted = value.trim().toLowerCase();
  return COMPETENCE_IMPORT_KINDS.find(k => k === wanted || COMPETENCE_IMPORT_KIND_WORDS[k].toLowerCase() === wanted);
}
const KIND_HELP = `Använd ${COMPETENCE_IMPORT_KINDS.join(', ')} eller ${Object.values(COMPETENCE_IMPORT_KIND_WORDS).join(', ')}.`;

function nameProblem(name: string): string | null {
  if (!name) return 'Namn saknas.';
  if (UNSAFE.test(name)) return 'Namnet innehåller tecken som inte kan sparas.';
  if (length(name) > COMPETENCE_IMPORT_NAME_MAX) return `Namnet är längre än ${COMPETENCE_IMPORT_NAME_MAX} tecken.`;
  return null;
}
function areaProblem(area: string): string | null {
  if (!area) return 'Område saknas.';
  if (UNSAFE.test(area)) return 'Området innehåller tecken som inte kan sparas.';
  if (length(area) > COMPETENCE_IMPORT_AREA_MAX) return `Området är längre än ${COMPETENCE_IMPORT_AREA_MAX} tecken.`;
  return null;
}
function uriProblem(uri: string): string | null {
  if (uri.length > COMPETENCE_URI_MAX) return `Adressen är längre än ${COMPETENCE_URI_MAX} tecken.`;
  if (!URI.test(uri) || UNSAFE.test(uri))
    return 'Adressen ska vara en fullständig adress, till exempel http://data.europa.eu/esco/skill/….';
  return null;
}
const validityProblem = `Giltighetstiden ska vara ett heltal från 1 till ${COMPETENCE_IMPORT_VALIDITY_MAX} månader.`;

/**
 * What is wrong with one row the server is sent, in the words the page shows, or null when it holds: the same rules
 * the page read the file with. The name and the area are taken as `importText` leaves them.
 */
export function competenceImportRowProblem(row: CompetenceImportCandidate): string | null {
  const name = importText(row.name),
    area = importText(row.area);
  const kind = importKind(row.kind);
  return (
    nameProblem(name) ??
    areaProblem(area) ??
    (!kind || kind !== row.kind ? `Typen finns inte. ${KIND_HELP}` : null) ??
    (row.validityMonths !== null &&
    (!Number.isInteger(row.validityMonths) ||
      row.validityMonths < 1 ||
      row.validityMonths > COMPETENCE_IMPORT_VALIDITY_MAX)
      ? validityProblem
      : null) ??
    (kind === 'skill' && row.validityMonths !== null ? 'En färdighet har ingen giltighetstid.' : null) ??
    (row.uri !== null ? uriProblem(row.uri) : null)
  );
}

/** The fields of one row and whether a quote went wrong in it. */
interface CsvRecord {
  row: number;
  fields: string[];
  malformed: boolean;
}
/**
 * The rows of a CSV text (RFC 4180), each with its number as a spreadsheet shows it: an empty line is no row but is
 * counted. Stops at `max` rows, and at a quoted field that never ends, which it reports.
 */
function readCsv(
  text: string,
  delimiter: string,
  max: number,
): { records: CsvRecord[]; unterminated: number | null; tooMany: boolean } {
  const records: CsvRecord[] = [];
  let fields: string[] = [];
  let field = '';
  let row = 1;
  let quoted = false;
  let malformed = false;
  let started = false;
  let quotedAt = 0;
  const end = (atEnd: boolean) => {
    fields.push(field);
    // A line with nothing on it is no row.
    if (!(fields.length === 1 && fields[0] === '' && !started)) records.push({ row, fields, malformed });
    fields = [];
    field = '';
    malformed = false;
    started = false;
    if (!atEnd) row++;
  };
  let i = 0;
  const n = text.length;
  while (i < n) {
    if (records.length > max) return { records: [], unterminated: null, tooMany: true };
    const c = text[i]!;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        // After the closing quote comes the delimiter or the end of the row; anything else is a quote out of place.
        const next = text[i];
        if (next !== undefined && next !== delimiter && next !== '\n' && next !== '\r') malformed = true;
        continue;
      }
      if (c === '\n' || c === '\r') {
        // A line break inside a quoted field belongs to the field, and the row keeps its number, as a spreadsheet shows it.
        field += c === '\r' && text[i + 1] === '\n' ? '\r\n' : c;
        i += c === '\r' && text[i + 1] === '\n' ? 2 : 1;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"' && field === '') {
      quoted = true;
      started = true;
      quotedAt = row;
      i++;
      continue;
    }
    if (c === delimiter) {
      fields.push(field);
      field = '';
      started = true;
      i++;
      continue;
    }
    if (c === '\r' || c === '\n') {
      end(false);
      i += c === '\r' && text[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    // A quote inside a field that does not begin with one is kept as written.
    field += c;
    started = true;
    i++;
  }
  if (quoted) return { records, unterminated: quotedAt, tooMany: false };
  if (field !== '' || fields.length > 0 || started) end(true);
  if (records.length > max) return { records: [], unterminated: null, tooMany: true };
  return { records, unterminated: null, tooMany: false };
}
/** The first row up to its end, outside quotes, to tell `,` from `;`. */
function delimiterOf(text: string): string {
  let commas = 0,
    semicolons = 0,
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') quoted = !quoted;
    else if (!quoted && (c === '\n' || c === '\r')) break;
    else if (!quoted && c === ',') commas++;
    else if (!quoted && c === ';') semicolons++;
  }
  return semicolons > commas ? ';' : ',';
}
const lower = (value: string) => value.trim().toLowerCase();
/** A count as a Swedish text writes it: `30 000`, the same in every runtime. */
const thousands = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

/**
 * Read a file of competence types: which format it is in, every row that holds and every problem, never throwing on
 * what the file holds. A row with a problem is not among the rows. Two rows with the same address, or the same name
 * without regard to case, are one type: the later is a problem that names the earlier.
 */
export function parseCompetenceImport(input: string): CompetenceImportResult {
  const problems: CompetenceImportProblem[] = [];
  let problemCount = 0;
  const problem = (row: number, message: string) => {
    problemCount++;
    if (problems.length < COMPETENCE_IMPORT_PROBLEMS_MAX) problems.push({ row, message });
  };
  const nothing = (format: CompetenceImportFormat | null): CompetenceImportResult => ({
    format,
    rows: [],
    problems,
    problemCount,
    notReleased: 0,
  });
  if (input.length > COMPETENCE_IMPORT_MAX_CHARS) {
    problem(0, `Filen är för stor. Den får vara högst ${COMPETENCE_IMPORT_MAX_CHARS / 1_000_000} miljoner tecken.`);
    return nothing(null);
  }
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  if (!text.trim()) {
    problem(0, 'Filen är tom.');
    return nothing(null);
  }
  // What a browser reads in place of bytes that are not UTF-8: a spreadsheet saved in another encoding.
  if (text.includes('\ufffd')) {
    problem(0, 'Filen innehåller tecken som inte kunde läsas. Spara den som CSV i UTF-8 och välj den igen.');
    return nothing(null);
  }
  const { records, unterminated, tooMany } = readCsv(text, delimiterOf(text), COMPETENCE_IMPORT_ROWS_MAX + 1);
  if (tooMany) {
    problem(0, `Filen har fler än ${thousands(COMPETENCE_IMPORT_ROWS_MAX)} rader. Dela upp den.`);
    return nothing(null);
  }
  const [header, ...body] = records;
  const columns = (header?.fields ?? []).map(lower);
  const at = (name: string) => columns.indexOf(name.toLowerCase());
  const format: CompetenceImportFormat | null =
    at('conceptUri') >= 0 && at('preferredLabel') >= 0 && at('status') >= 0
      ? 'esco'
      : at('name') >= 0 && at('area') >= 0 && at('kind') >= 0
        ? 'clew'
        : null;
  if (!format || !header) {
    problem(
      1,
      'Filen känns inte igen. Den första raden ska vara name, area, kind, validityMonths, uri (Clews format) eller rubrikerna i ESCO:s fil med färdigheter (conceptUri, preferredLabel, status …).',
    );
    return nothing(null);
  }
  const rows: CompetenceImportRow[] = [];
  let notReleased = 0;
  const byUri = new Map<string, number>(),
    byName = new Map<string, number>();
  const cell = (fields: string[], name: string) => {
    const index = at(name);
    return index < 0 ? '' : (fields[index] ?? '');
  };
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
    let candidate: Omit<CompetenceImportRow, 'row'>;
    if (format === 'esco') {
      if (lower(cell(fields, 'status')) !== ESCO_RELEASED) {
        notReleased++;
        continue;
      }
      const name = importText(cell(fields, 'preferredLabel'));
      const uri = cell(fields, 'conceptUri').trim();
      const wrong = nameProblem(name) ?? (uri ? uriProblem(uri) : 'Adress (conceptUri) saknas.');
      if (wrong) {
        problem(row, wrong);
        continue;
      }
      candidate = { name, area: null, kind: 'skill', validityMonths: null, uri };
    } else {
      const name = importText(cell(fields, 'name')),
        area = importText(cell(fields, 'area'));
      const kindText = cell(fields, 'kind'),
        kind = importKind(kindText);
      const monthsText = cell(fields, 'validityMonths').trim(),
        uriText = cell(fields, 'uri').trim();
      const months = monthsText === '' ? null : /^\d{1,3}$/.test(monthsText) ? Number(monthsText) : NaN;
      const wrong =
        nameProblem(name) ??
        areaProblem(area) ??
        (!kind
          ? kindText.trim()
            ? `Typen ”${[...kindText.trim()].slice(0, 40).join('')}” finns inte. ${KIND_HELP}`
            : `Typ saknas. ${KIND_HELP}`
          : null) ??
        (months !== null && !(months >= 1 && months <= COMPETENCE_IMPORT_VALIDITY_MAX) ? validityProblem : null) ??
        (kind === 'skill' && months !== null ? 'En färdighet har ingen giltighetstid.' : null) ??
        (uriText ? uriProblem(uriText) : null);
      if (wrong || !kind) {
        problem(row, wrong ?? KIND_HELP);
        continue;
      }
      candidate = { name, area, kind, validityMonths: months, uri: uriText || null };
    }
    const sameUri = candidate.uri !== null ? byUri.get(candidate.uri) : undefined;
    if (sameUri !== undefined) {
      problem(row, `Samma adress som rad ${sameUri}.`);
      continue;
    }
    const nameKey = candidate.name.toLowerCase();
    const sameName = byName.get(nameKey);
    if (sameName !== undefined) {
      problem(row, `Samma namn som rad ${sameName}.`);
      continue;
    }
    if (candidate.uri !== null) byUri.set(candidate.uri, row);
    byName.set(nameKey, row);
    rows.push({ row, ...candidate });
  }
  if (unterminated !== null) problem(unterminated, 'Ett citattecken avslutas aldrig. Resten av filen kan inte läsas.');
  return { format, rows, problems, problemCount, notReleased };
}

/**
 * Which of a file's rows the catalogue holds already (D120 item 7): one whose address a type keeps, whatever that
 * type's state, and one whose name, without regard to case, a type has that is in use or was merged into another,
 * since a name is one per organisation and a merged one lives on in the type it went into. An archived type's name is
 * free again, as it is to "Lägg till kompetens". The page marks such a row and the server counts it as skipped, with
 * this one rule.
 */
export function catalogueMatcher(
  types: ReadonlyArray<{ name: string; uri?: string | null; archived: boolean; merged: boolean }>,
): (row: { name: string; uri: string | null }) => boolean {
  const uris = new Set<string>(),
    names = new Set<string>();
  for (const t of types) {
    if (t.uri) uris.add(t.uri);
    if (!t.archived || t.merged) names.add(importText(t.name).toLowerCase());
  }
  return row => (row.uri !== null && uris.has(row.uri)) || names.has(importText(row.name).toLowerCase());
}
