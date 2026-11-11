import {
  fieldTone,
  markFields,
  needsPerson,
  type EntityColumn,
  type EntityList,
  type EntityPage,
  type EntityRef,
  type EntityRows,
  type EntitySource,
  type View,
  type ViewField,
  type ViewTone,
} from '@clew/contracts';
import { statusWord } from '../components/panel-labels';
import { wholeRow } from '../view-fields';

/**
 * Personal as D97 places it (artboards A2, B, A3): what the page reads from the sources an administrator chose, as pure
 * functions over the API's answers. No React, no request. The page draws; this file decides what a row needs, which
 * marks it carries, how a lens is sorted and counted, and what a source's page way in points to.
 */

export type Row = Record<string, unknown>;
/** How one source answered for the page: its rows by key, or why there are none. `pending` is still on its way. */
export type Answer =
  | { status: 'ok'; rows: Map<string, Row>; heading?: string; note?: string; all: Row[] }
  | { status: 'unavailable' | 'timeout' | 'failed' | 'pending' };
/** A source that did not answer, by the name the person knows it by. */
export interface Silent {
  source: string;
  status: 'unavailable' | 'timeout' | 'failed';
}
/** One mark on a row on "Alla" (D97 item 2): a field of a chosen source whose value needs the reader. */
export interface Mark {
  id: string;
  tone: 'warn' | 'alert';
  text: string;
}

/** A person's key is their user name, compared without regard to case (D97). */
const keyOf = (key: unknown) => (typeof key === 'string' ? key.toLowerCase() : '');
/** One source's answer as the page uses it; a request that failed is a source that did not answer. */
export function answerOf(rows: EntityRows | undefined, failed: boolean): Answer {
  if (failed) return { status: 'failed' };
  if (!rows) return { status: 'pending' };
  if (rows.status !== 'ok') return { status: rows.status };
  return {
    status: 'ok',
    rows: new Map(rows.rows.map(row => [keyOf(row.key), row])),
    all: rows.rows,
    ...(rows.heading ? { heading: rows.heading } : {}),
    ...(rows.note ? { note: rows.note } : {}),
  };
}
/** The person's row in a source's answer, if the source answered and knows them. */
export const rowOf = (answer: Answer | undefined, key: string): Row | undefined =>
  answer?.status === 'ok' ? answer.rows.get(keyOf(key)) : undefined;

/** The fields a table or list view draws, in its order; none for any other kind. */
export const viewFields = (view: View): ViewField[] =>
  view.kind === 'table' || view.kind === 'list' ? view.fields : [];
/** The field that names a row of the view: on a source about a person it is the row's state ("Samtal"). */
export const titleField = (view: View): ViewField | undefined =>
  view.kind === 'table' || view.kind === 'list' ? view.fields.find(f => f.key === view.title) : undefined;

/** Every capability the page reads: the lenses, then the columns of sources that are not lenses, each once. */
export function sourcesRead(list: EntityList): string[] {
  return [...new Set([...list.lenses.map(l => l.capability), ...list.columns.map(c => c.capability)])];
}
/** The name a source is known by on the page, from its lens or its column. */
export const sourceName = (list: EntityList, capability: string): string =>
  list.lenses.find(l => l.capability === capability)?.source ??
  list.columns.find(c => c.capability === capability)?.source ??
  capability;

/** The most a row needs the reader: `alert` over `warn`; null when nothing in it does. */
export function needOf(fields: ViewField[], row: Row | undefined): 'alert' | 'warn' | null {
  if (!row) return null;
  let need: 'alert' | 'warn' | null = null;
  for (const f of fields) {
    const tone = fieldTone(f, row[f.key]);
    if (!needsPerson(tone)) continue;
    if (tone === 'alert') return 'alert';
    need = 'warn';
  }
  return need;
}
/** The fields a lens draws that can need the reader: the marking fields of its whole row, the compact one left out (D97). */
const lensMarks = (view: View): ViewField[] => wholeRow(markFields(view));
/**
 * The people under a lens, sorted by need (artboard B): first a row whose title value needs the reader (`alert`, then
 * `warn`: "Saknas"), then a row where another field the lens draws does ("2 försenade"), then the rest, and last the
 * people the source has no row for. Inside each the directory's order stands.
 */
export function byNeed(entities: EntityRef[], lens: EntitySource, answer: Answer | undefined): EntityRef[] {
  const title = titleField(lens.view);
  const others = lensMarks(lens.view).filter(f => f.key !== title?.key);
  const rank = (e: EntityRef) => {
    const row = rowOf(answer, e.key);
    if (!row) return 4;
    const own = title ? fieldTone(title, row[title.key]) : 'none';
    if (own === 'alert') return 0;
    if (own === 'warn') return 1;
    return needOf(others, row) ? 2 : 3;
  };
  return entities
    .map((e, i) => ({ e, i, r: rank(e) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map(x => x.e);
}

/**
 * What a lens holds that needs the reader, for its row in the Visa menu: how many rows have a field the lens draws toned
 * `warn` or `alert`, and the strongest tone among them. Null when none does or the lens has not answered.
 */
export function lensNeed(
  lens: EntitySource,
  answer: Answer | undefined,
): { count: number; tone: 'warn' | 'alert' } | null {
  if (answer?.status !== 'ok') return null;
  const fields = lensMarks(lens.view);
  let count = 0,
    alert = false;
  for (const row of answer.all) {
    const need = needOf(fields, row);
    if (need) count++;
    if (need === 'alert') alert = true;
  }
  return count ? { count, tone: alert ? 'alert' : 'warn' } : null;
}

/** A status word as it reads inside a sentence: "Hållet" becomes "hållet". */
const lowered = (word: string) => word.charAt(0).toLocaleLowerCase('sv-SE') + word.slice(1);
/** Where a value's count stands on the lens's fact line: what is done first, then the plain, then what needs the reader. */
const countOrder: Record<ViewTone, number> = { ok: 0, none: 1, warn: 2, alert: 3 };
/**
 * The lens's counts per value of its title field (artboard B: "1 hållet, 3 bokat, 1 saknas"): the values toned `ok`
 * first, then those without a tone or toned `none`, then `warn` and `alert`; within each in the order the view names the
 * values in its tones and then as they first appear. Empty when the title field is not a status. The words are the
 * source's, lower-cased; Clew does not inflect them.
 */
export function valueCounts(view: View, rows: Row[]): string {
  const field = titleField(view);
  if (!field || field.format !== 'status') return '';
  const counts = new Map<string, number>();
  for (const name of Object.keys(field.tones ?? {})) if (name !== '*') counts.set(name, 0);
  for (const row of rows) {
    const value = row[field.key];
    if (value === undefined || value === null || value === '') continue;
    const name = String(value);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const typed = (name: string): unknown => (name === 'true' ? true : name === 'false' ? false : name);
  return [...counts]
    .map(([name, n], i) => ({ name, n, i, rank: countOrder[fieldTone(field, typed(name))] }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map(({ name, n }) => [name, n] as const)
    .filter(([, n]) => n > 0)
    .map(
      ([value, n]) =>
        `${n} ${lowered(statusWord(field.label, value === 'true' ? true : value === 'false' ? false : value))}`,
    )
    .join(', ');
}

/**
 * A mark's words (D97 item 2). The view's title field is the row's state, a word that does not say what it is about
 * ("Saknas"), so it carries the field's label: "Samtal saknas". Any other field is drawn as the source phrases its value
 * ("2 försenade"); a source that wants a mark to read alone says it in the value.
 */
export function markText(view: View, field: ViewField, value: unknown): string {
  const word = statusWord(field.label, value);
  if (typeof value === 'boolean' || field.key !== titleField(view)?.key) return word;
  return `${field.label} ${lowered(word)}`;
}
/**
 * The marks on one person's row on "Alla" (D97 item 2): for every chosen source, a lens or a column, each field of the
 * person's row toned `warn` or `alert`, unless the field is already a column. A source whose column already shows this
 * person a value that needs the reader says it there and marks nothing more ("Inte bokat" in the column, no "Samtal
 * saknas" beside it). A source known only by its column has no view here, so only its column is drawn.
 */
export function marksFor(list: EntityList, answers: ReadonlyMap<string, Answer>, key: string): Mark[] {
  const shown = (c: string, f: string) => list.columns.some(col => col.capability === c && col.field.key === f);
  const marks: Mark[] = [];
  for (const source of list.lenses) {
    const row = rowOf(answers.get(source.capability), key);
    if (!row) continue;
    const said = list.columns.some(
      col => col.capability === source.capability && needsPerson(fieldTone(col.field, row[col.field.key])),
    );
    if (said) continue;
    for (const f of markFields(source.view)) {
      if (shown(source.capability, f.key)) continue;
      const tone = fieldTone(f, row[f.key]);
      if (tone === 'warn' || tone === 'alert')
        marks.push({ id: `${source.capability}:${f.key}`, tone, text: markText(source.view, f, row[f.key]) });
    }
  }
  return marks;
}
/** The column's value for a person: the field of their row in the column's source, if it answered and knows them. */
export const columnValue = (column: EntityColumn, answers: ReadonlyMap<string, Answer>, key: string): unknown =>
  rowOf(answers.get(column.capability), key)?.[column.field.key];

/** One link in "Just nu" (artboard A2): the words, and the card it opens when there is exactly one. */
export interface CardLink {
  id: 'act' | 'proposals';
  text: string;
  threadId?: string;
}
/**
 * "Just nu"'s links for one person (D97 item 5): "1 att agera på" or "N att agera på" for the cards that wait for the
 * reader's decision, "1 förslag" or "N förslag" for Clew's proposals. Each opens the card when the server named the one
 * card there is, and otherwise the person beside the list, where Behöver dig lists them.
 */
export function cardLinkTexts(list: EntityList, key: string): CardLink[] {
  const a = list.attention.find(x => keyOf(x.key) === keyOf(key));
  if (!a) return [];
  const thread = a.threadId ? { threadId: a.threadId } : {};
  return [
    ...(a.act > 0 ? [{ id: 'act' as const, text: `${a.act} att agera på`, ...thread }] : []),
    ...(a.proposals > 0 ? [{ id: 'proposals' as const, text: `${a.proposals} förslag`, ...thread }] : []),
  ];
}

/**
 * A source's page way in for one entity (D97, D95): `{key}` and `{id}` filled in. On the page the person is on, the
 * page's own address (a lens, an opened person) is kept under the way in's own parameters, as every overlay address
 * keeps the page's (D83). Null when the page needs Clew's id and the entity has none.
 */
export function pageHref(
  page: EntityPage,
  entity: EntityRef,
  here: { pathname: string; search: string },
): string | null {
  if (page.href.includes('{id}') && !entity.id) return null;
  const filled = page.href
    .replaceAll('{key}', encodeURIComponent(entity.key))
    .replaceAll('{id}', encodeURIComponent(entity.id ?? ''));
  const target = new URL(filled, 'http://clew.invalid');
  if (target.pathname !== here.pathname) return filled;
  const query = new URLSearchParams(here.search);
  target.searchParams.forEach((value, name) => query.set(name, value));
  const q = query.toString();
  return target.pathname + (q ? `?${q}` : '') + target.hash;
}

/** The count line under the title: "5 medarbetare på Bergsåkers skola", or the number of units when there are several. */
export function peopleLine(groups: EntityList['groups']): string {
  const people = groups.reduce((sum, g) => sum + g.entities.length, 0);
  return groups.length === 1
    ? `${people} medarbetare på ${groups[0]!.label}`
    : `${people} medarbetare på ${groups.length} enheter`;
}
/** "Personalsystemet", "Personalsystemet och Utvecklingssamtal", "A, B och C". */
const joined = (words: string[]) =>
  words.length < 2 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} och ${words.at(-1)}`;
/** The one sentence that says which systems did not answer: "Personalsystemet svarade inte." */
export function silentText(silent: Silent[]): string {
  if (!silent.length) return '';
  const late = silent.filter(s => s.status === 'timeout').map(s => s.source);
  const down = silent.filter(s => s.status !== 'timeout').map(s => s.source);
  return [down.length ? `${joined(down)} svarade inte.` : '', late.length ? `${joined(late)} svarade inte i tid.` : '']
    .filter(Boolean)
    .join(' ');
}
/** The sources among `capabilities` that did not answer, each named once, in the page's order. */
export function silentOf(list: EntityList, answers: ReadonlyMap<string, Answer>, capabilities: string[]): Silent[] {
  const out: Silent[] = [];
  for (const c of capabilities) {
    const a = answers.get(c);
    if (!a || a.status === 'ok' || a.status === 'pending') continue;
    const source = sourceName(list, c);
    if (!out.some(s => s.source === source)) out.push({ source, status: a.status });
  }
  return out;
}
