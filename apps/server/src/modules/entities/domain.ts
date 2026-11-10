import type { AboutAction, AboutRead } from '@clew/connectors';
import {
  ENTITY_COLUMNS_MAX,
  ENTITY_KEYS_MAX,
  viewRows,
  type EntityAction,
  type EntityAttention,
  type EntityColumn,
  type EntityKind,
  type EntityList,
  type EntityRef,
  type EntitySource,
  type View,
} from '@clew/contracts';
import type { DirectoryPerson, DirectoryUnit, NamedCard, Reach } from './model';

/**
 * The pure part of the entities module (D97): who may be asked about, which keys a source is sent, and what of its
 * answer is kept. No I/O and no clock: everything depends on the directory and the answer handed in.
 */

/** The longest key on the wire (`SubjectSchema` in `@clew/contracts`). */
const KEY_MAX = 256;
export const isKey = (value: string) => value.length >= 1 && value.length <= KEY_MAX;
/** A person's key is their user name, compared without regard to case (RFC 7643's default); a unit's is its id, exactly. */
export const foldKey = (kind: EntityKind, key: string) => (kind === 'person' ? key.toLowerCase() : key);

/** The key a person is asked about by, or undefined: a person without a user name, or a deactivated one, is never asked about. */
export const personKey = (person: Pick<DirectoryPerson, 'userName' | 'enabled'>) =>
  person.enabled && person.userName !== null && isKey(person.userName) ? person.userName : undefined;
export const personRef = (person: DirectoryPerson & { userName: string }, unit: DirectoryUnit | null): EntityRef => ({
  kind: 'person',
  key: person.userName,
  name: person.name,
  ...(unit ? { detail: unit.unitLabel } : {}),
  id: person.id,
});
export const unitRef = (unit: DirectoryUnit): EntityRef => ({
  kind: 'unit',
  key: unit.unitId,
  name: unit.unitLabel,
  ...(unit.unitId.length <= 80 ? { id: unit.unitId } : {}),
});
/** A person who can be asked about: active, with a user name that fits a key. */
export const askable = (person: DirectoryPerson): person is DirectoryPerson & { userName: string } =>
  !!personKey(person);

/** The units the reader manages or belongs to, each once, by label in Swedish order. */
export function readerUnits(reach: Reach): DirectoryUnit[] {
  const units = new Map<string, DirectoryUnit>();
  for (const u of [...reach.units, ...reach.managed])
    if (isKey(u.unitId) && !units.has(u.unitId)) units.set(u.unitId, { unitId: u.unitId, unitLabel: u.unitLabel });
  return [...units.values()].sort(
    (a, b) => a.unitLabel.localeCompare(b.unitLabel, 'sv') || a.unitId.localeCompare(b.unitId),
  );
}
/** The groups of `GET /api/entities/:kind`: for a person one per unit the reader manages (none for an employee), for a unit one. */
export function groupsOf(kind: EntityKind, reach: Reach): EntityList['groups'] {
  if (kind === 'unit') {
    const units = readerUnits(reach);
    return units.length ? [{ id: 'units', label: 'Mina enheter', entities: units.map(unitRef) }] : [];
  }
  return reach.managed.map(unit => ({
    id: unit.unitId,
    label: unit.unitLabel,
    entities: unit.people.filter(askable).map(p => personRef(p, unit)),
  }));
}
/** Every key the reader may ask a source about over the whole list, each once in the directory's spelling. */
export function listedKeys(kind: EntityKind, reach: Reach): string[] {
  const keys = new Map<string, string>();
  const add = (key: string) => {
    if (!keys.has(foldKey(kind, key))) keys.set(foldKey(kind, key), key);
  };
  if (kind === 'unit') readerUnits(reach).forEach(u => add(u.unitId));
  else for (const unit of reach.managed) for (const p of unit.people) if (askable(p)) add(p.userName);
  return [...keys.values()];
}
/** A person on a unit the reader manages, by key without regard to case, with the first such unit in the list's order. */
export function managedPerson(
  reach: Reach,
  key: string,
): { person: DirectoryPerson & { userName: string }; unit: DirectoryUnit } | undefined {
  const folded = foldKey('person', key);
  for (const unit of reach.managed)
    for (const person of unit.people)
      if (askable(person) && foldKey('person', person.userName) === folded)
        return { person, unit: { unitId: unit.unitId, unitLabel: unit.unitLabel } };
  return undefined;
}
/** A unit the reader manages or belongs to, by its id. */
export const memberUnit = (reach: Reach, key: string) => readerUnits(reach).find(u => u.unitId === key);

/** Keys in calls of at most `size` (never more than `ENTITY_KEYS_MAX`), in order. */
export function chunk(keys: string[], size: number): string[][] {
  const step = Math.max(1, Math.min(ENTITY_KEYS_MAX, Math.floor(size)));
  const out: string[][] = [];
  for (let i = 0; i < keys.length; i += step) out.push(keys.slice(i, i + step));
  return out;
}

/** A source's answer as Clew keeps it: rows about asked keys only, each once, and the two optional lines. */
export interface Checked {
  rows: Record<string, unknown>[];
  heading?: string;
  note?: string;
}
/** The row properties a table or list draws or opens with: nothing else reaches the browser. */
function drawn(view: View): Set<string> {
  const keys = new Set(['key']);
  if (view.kind !== 'table' && view.kind !== 'list') return keys;
  keys.add(view.title);
  for (const f of view.fields) keys.add(f.key);
  if (view.ref) keys.add(view.ref);
  // The entity a row names (D97 item 6): the web links the row's title with it.
  if (view.subject) keys.add(view.subject.key);
  for (const from of Object.values(view.open?.params ?? {})) keys.add(from);
  return keys;
}
/**
 * What is kept of one answer to `{ keys: asked }` (D97 item 7): a row whose `key` was not asked is dropped (a person's
 * key compared without regard to case, and the row answers with the spelling Clew asked with), a second row for a key
 * is dropped, a row keeps only what its view draws, and `heading` and `note` pass when they are strings. Undefined when
 * the answer does not hold rows where the view says: a broken source, never an empty one.
 */
export function checkRows(
  kind: EntityKind,
  asked: readonly string[],
  view: View,
  output: unknown,
): Checked | undefined {
  const rows = viewRows(view, output);
  if (!rows) return undefined;
  const spelling = new Map(asked.map(k => [foldKey(kind, k), k]));
  const keep = drawn(view);
  const seen = new Set<string>();
  const kept: Record<string, unknown>[] = [];
  for (const row of rows) {
    if (typeof row.key !== 'string') continue;
    const folded = foldKey(kind, row.key);
    const key = spelling.get(folded);
    if (key === undefined || seen.has(folded)) continue;
    seen.add(folded);
    kept.push({ ...Object.fromEntries(Object.entries(row).filter(([k]) => keep.has(k))), key });
  }
  const out = output as Record<string, unknown>;
  return {
    rows: kept,
    ...(typeof out.heading === 'string' ? { heading: out.heading } : {}),
    ...(typeof out.note === 'string' ? { note: out.note } : {}),
  };
}
/** The answers of one source's calls as one: rows in call order, the first heading and note any call gave. */
export function combine(answers: Checked[]): Checked {
  const heading = answers.find(a => a.heading !== undefined)?.heading;
  const note = answers.find(a => a.note !== undefined)?.note;
  return {
    rows: answers.flatMap(a => a.rows),
    ...(heading !== undefined ? { heading } : {}),
    ...(note !== undefined ? { note } : {}),
  };
}

/** Clew's own domain (D97): a source of a core connector is captioned "Clew" where a section or a lens names it. */
const ownOf = (from: { core?: true }) => (from.core ? { own: true as const } : {});
export const sourceOf = (read: AboutRead): EntitySource => ({
  capability: read.name,
  connector: read.connectorId,
  source: read.source,
  title: read.title,
  view: read.view,
  ...(read.page ? { page: read.page } : {}),
  ...ownOf(read),
});
export const actionOf = (action: AboutAction): EntityAction => ({
  capability: action.name,
  connector: action.connectorId,
  source: action.source,
  title: action.title,
  kind: action.kind,
  param: action.param,
  ...ownOf(action),
});
const plain = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const ordered = (reads: AboutRead[]) =>
  [...reads].sort((a, b) => plain(a.connectorId, b.connectorId) || plain(a.name, b.name));
/**
 * Sources as a person meets them (D97, artboards A2 and C): Clew's own domain first, then the others by the name of
 * their source in Swedish order, and by title and name within one source.
 */
export const bySource = (reads: AboutRead[]): AboutRead[] =>
  [...reads].sort(
    (a, b) =>
      (a.core ? 0 : 1) - (b.core ? 0 : 1) ||
      a.source.localeCompare(b.source, 'sv') ||
      a.title.localeCompare(b.title, 'sv') ||
      plain(a.name, b.name),
  );
/** The lenses an administrator offers (D97 item 3), in the order of `bySource`, as the Visa menu lists them. */
export const lensesOf = (reads: AboutRead[]): EntitySource[] => bySource(reads.filter(r => r.lens)).map(sourceOf);
/** The sections of an opened entity (D97 item 5), in the order of `bySource`. */
export const sectionsOf = (reads: AboutRead[]): EntitySource[] => bySource(reads).map(sourceOf);
/** The columns on "Alla" (D97 item 4), connector by connector and by name within one, at most `ENTITY_COLUMNS_MAX`. */
export function columnsOf(reads: AboutRead[]): EntityColumn[] {
  return ordered(reads)
    .flatMap(r => {
      const field =
        r.column !== undefined && (r.view.kind === 'table' || r.view.kind === 'list')
          ? r.view.fields.find(f => f.key === r.column)
          : undefined;
      return field ? [{ capability: r.name, source: r.source, title: r.title, field, ...ownOf(r) }] : [];
    })
    .slice(0, ENTITY_COLUMNS_MAX);
}
/**
 * "Just nu" (D97 item 5): per entity of the list, in its order, how many of the reader's cards name it that wait for the
 * reader's decision and how many are Clew's proposals, with the card when there is exactly one of those. A card only for
 * information counts for neither, and an entity that no such card names is absent.
 */
export function attentionOf(keys: readonly string[], cards: readonly NamedCard[]): EntityAttention[] {
  const counted = new Map<string, { act: number; proposals: number; threads: string[] }>();
  for (const card of cards) {
    if (card.kind === 'fyi') continue;
    for (const { key } of card.subjects) {
      const c = counted.get(key) ?? { act: 0, proposals: 0, threads: [] };
      if (card.kind === 'act') c.act++;
      else c.proposals++;
      if (!c.threads.includes(card.threadId)) c.threads.push(card.threadId);
      counted.set(key, c);
    }
  }
  return keys.flatMap(key => {
    const c = counted.get(key);
    if (!c) return [];
    return [{ key, act: c.act, proposals: c.proposals, ...(c.threads.length === 1 ? { threadId: c.threads[0] } : {}) }];
  });
}
/** A read the list may call over every entity: one an administrator placed as a lens or a column. Nobody's choice, no call. */
export const placed = (reads: AboutRead[], capability: string) =>
  reads.find(r => r.name === capability && (r.lens || columnsOf(reads).some(c => c.capability === capability)));
