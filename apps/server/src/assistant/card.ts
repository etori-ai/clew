import { readsSummary } from '@clew/connectors';
import {
  ITEM_REF,
  VIEW_ITEMS_MAX,
  rowMark,
  viewRows,
  type MessageMeta,
  type View,
  type ViewField,
} from '@clew/contracts';

/**
 * The card under an answer (D38): the read the answer rests on, drawn with the input the model gave it, and of its rows
 * the ones the answer is about. Worked out from the read's declaration and the answer's own words, the same for every
 * connector, so a card never shows rows the sentence above it is not about:
 *
 * - The rows the answer names, every one of them: a row is named when the answer writes the values the view draws as
 *   text (its title, and any other field of plain text), the rows with the most such values winning ("Anna Lindqvist
 *   saknar brandskydd" names Anna's Brandskydd row, not her HLR row). A view whose rows name a person (`subject`) also
 *   counts the first name its title starts with. The answer writes names because the person reads them; the model is
 *   never given a row handle to cite, so none can leak into the prose. A card never shows an excerpt that leaves out a
 *   row the sentence names: an answer that names more rows than a card keeps is drawn as its button alone.
 * - None named, and the model narrowed the read with its input (a person, a query), or the answer speaks of the read as
 *   a whole (it says how many rows there are, or points at "vyn"): the read is what the answer is about, and its first
 *   rows are the excerpt (the sentence names none of them, so none is left out).
 * - None named and nothing narrowed: no rows; the answer keeps its button to the whole read. An unrelated card is worse
 *   than none.
 * - A view the model only gets a summary of (`modelReads: 'summary'`), and an empty read: the read as it is.
 */
export type CardRows = NonNullable<MessageMeta['viewRows']>;
/** The most rows a card keeps the marks of: an answer that names more is about the read as a whole. */
export const CARD_MARKS_MAX = 50;
type Row = Record<string, unknown>;
type RowsView = Extract<View, { kind: 'table' | 'list' }>;

/** Lower case, and every kind of space as one plain space: a source writes "37\u00a0050 kr", an answer "37 050 kr". */
const fold = (text: string) => text.normalize('NFC').replace(/\s+/gu, ' ').toLocaleLowerCase('sv');
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Whether a text writes a phrase as words of its own: "Anna" in "Annas HLR", not in "Annika"; "HLR" in "HLR-intyget". */
function writes(text: string, phrase: string, number = false): boolean {
  const wanted = fold(phrase.trim());
  if (!number && ([...wanted].length < 2 || /^[\d\s.,:-]+$/.test(wanted))) return false;
  return new RegExp(`(?<![\\p{L}\\p{N}])${escape(wanted)}s?(?![\\p{L}\\p{N}])`, 'u').test(text);
}
/** Fields whose values a sentence would write as words: the title, and any field drawn as plain text. */
const wordy = (view: RowsView) =>
  view.fields.filter((f: ViewField) => f.key === view.title || !f.format || f.format === 'text');

/** The rows of a table or list an answer names, by the values the view draws; none when it names none. */
export function namedRows(view: RowsView, rows: readonly Row[], answer: string): Row[] {
  const text = fold(answer);
  const fields = wordy(view);
  const personTitle = view.subject?.entity === 'person';
  const scored = rows.map(row => {
    let score = 0;
    let titled = false;
    for (const f of fields) {
      const value = row[f.key];
      if (typeof value !== 'string') continue;
      const first = value.trim().split(/\s+/)[0] ?? '';
      const named =
        writes(text, value) ||
        (personTitle &&
          f.key === view.title &&
          value.trim().includes(' ') &&
          [...first].length >= 3 &&
          writes(text, first));
      if (named) score++;
      if (named && f.key === view.title && rows.filter(r => r[f.key] === value).length === 1) titled = true;
    }
    return { row, score, titled };
  });
  const best = Math.max(0, ...scored.map(s => s.score));
  // A row the answer writes the title of, when no other row has that title, is named, however many of another row's other values it also wrote (the
  // product owner, 2026-11-16: two late items named by title, and only the one whose detail was repeated was drawn).
  return best ? scored.filter(s => s.score === best || s.titled).map(s => s.row) : [];
}
/** Swedish numbers as an answer writes them in words, two to twelve ("en" and "ett" are articles as often as numbers). */
const NUMBER_WORDS = ['två', 'tre', 'fyra', 'fem', 'sex', 'sju', 'åtta', 'nio', 'tio', 'elva', 'tolv'];
/** Whether an answer speaks of a read as a whole: it says how many rows the read answered, or points at the view. */
function aboutTheWhole(answer: string, count: number): boolean {
  const text = fold(answer);
  const said = [String(count), ...(count >= 2 && count <= 12 ? [NUMBER_WORDS[count - 2]!] : [])];
  return said.some(n => writes(text, n, true)) || writes(text, 'vyn');
}
/**
 * The work items among the rows an answer names (`MessageMeta.viewItems`): the rows the answer writes the values of
 * (`namedRows`) whose ref is a work item's (`thread:<id>`), each once and in the read's order, a menu's worth at most.
 * Whatever the card draws of the read, the answer is about the items it names, so the pane beside the conversation can
 * lead to each of them. None for a view that is not a table or a list or declares no ref, and for an id a message could
 * not hold.
 */
export function namedItems(view: View, output: unknown, answer: string): string[] {
  if ((view.kind !== 'table' && view.kind !== 'list') || !view.ref) return [];
  const rows = viewRows(view, output);
  if (!rows?.length) return [];
  const ids = namedRows(view, rows, answer).flatMap(row => {
    const ref = row[view.ref!];
    if (typeof ref !== 'string' || !ref.startsWith(ITEM_REF)) return [];
    const id = ref.slice(ITEM_REF.length);
    return id.length >= 1 && id.length <= 80 ? [id] : [];
  });
  return [...new Set(ids)].slice(0, VIEW_ITEMS_MAX);
}
const narrowed = (input: Record<string, unknown>) =>
  Object.values(input).some(v => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0));

/** Which rows of a read the card under an answer draws; undefined for a view that is not a table or a list. */
export function cardRows(
  view: View,
  input: Record<string, unknown>,
  output: unknown,
  answer: string,
): CardRows | undefined {
  if (view.kind !== 'table' && view.kind !== 'list') return undefined;
  const rows = viewRows(view, output);
  if (!rows) return undefined;
  const count = rows.length;
  if (readsSummary(view) || count === 0) return { count, show: 'all' };
  // An answer that says how many rows the read answered speaks of the read as a whole: the rows it also names are
  // examples, and the card draws the read's first few with their count, not the one or two it happened to name (the
  // product owner, 2026-11-16: nine items, and one in the card).
  if (count > 1 && aboutTheWhole(answer, count)) return { count, show: 'all' };
  const named = namedRows(view, rows, answer);
  if (named.length)
    return named.length <= CARD_MARKS_MAX
      ? { count, show: 'named', marks: [...new Set(named.map(r => rowMark(view, r)))] }
      : { count, show: 'none' };
  return { count, show: narrowed(input) || aboutTheWhole(answer, count) ? 'all' : 'none' };
}
