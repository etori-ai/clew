import { readsSummary } from '@clew/connectors';
import { rowMark, viewRows, type MessageMeta, type View, type ViewField } from '@clew/contracts';

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

const fold = (text: string) => text.normalize('NFC').toLocaleLowerCase('sv');
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
    }
    return { row, score };
  });
  const best = Math.max(0, ...scored.map(s => s.score));
  return best ? scored.filter(s => s.score === best).map(s => s.row) : [];
}
/** Swedish numbers as an answer writes them in words, two to twelve ("en" and "ett" are articles as often as numbers). */
const NUMBER_WORDS = ['två', 'tre', 'fyra', 'fem', 'sex', 'sju', 'åtta', 'nio', 'tio', 'elva', 'tolv'];
/** Whether an answer speaks of a read as a whole: it says how many rows the read answered, or points at the view. */
function aboutTheWhole(answer: string, count: number): boolean {
  const text = fold(answer);
  const said = [String(count), ...(count >= 2 && count <= 12 ? [NUMBER_WORDS[count - 2]!] : [])];
  return said.some(n => writes(text, n, true)) || writes(text, 'vyn');
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
  const named = namedRows(view, rows, answer);
  if (named.length)
    return named.length <= CARD_MARKS_MAX
      ? { count, show: 'named', marks: [...new Set(named.map(r => rowMark(view, r)))] }
      : { count, show: 'none' };
  return { count, show: narrowed(input) || aboutTheWhole(answer, count) ? 'all' : 'none' };
}
