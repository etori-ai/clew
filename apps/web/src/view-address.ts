import { answersWithRows, type Thread, type ThreadAction, type View, type ViewEntry } from '@clew/contracts';
import { withView, withoutView } from './panel-address';
import { personPageHref, wayBack } from './person-address';

/**
 * Where a view is (D116; D42 gave a tool its page). Every read a person may open has a page of its own at
 * `/tools/<capability>`, whether or not an administrator placed it in the rail: `input` is what it is read with,
 * `title` the name it was opened under (the menu's row or the read's own title when absent) and `from` the page it was
 * opened from, the way back. A view that answers with rows, a table or a list, is a page: whatever opens one leads
 * there and Back returns. Since D126 (one page per thing) so is everything else, one record, a contact card, a text, a
 * day: it is the thing's own page, never a peek beside the page it was opened from, except beside a conversation, where
 * the thing an answer names stands beside the transcript (`?open=`, `panel-address.ts`). The kinds come from the reads
 * the person may open (`/api/areas`, `views`).
 */
export interface ViewTarget {
  capability: string;
  title?: string | undefined;
  input?: Record<string, unknown> | undefined;
}

const address = (pathname: string, query: URLSearchParams) => {
  const q = query.toString();
  return q ? `${pathname}?${q}` : pathname;
};
/** A read's input as an address holds it (`input`, `open-input`): its object, or none for anything else. */
export const addressInput = (json: string | null): Record<string, unknown> => {
  try {
    const v: unknown = json ? JSON.parse(json) : {};
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};
const parse = addressInput;

/** The view's own page: its input, the name it was opened under and the page it was opened from. */
export function viewPageHref(view: ViewTarget, from?: string | null): string {
  const q = new URLSearchParams();
  if (view.input && Object.keys(view.input).length) q.set('input', JSON.stringify(view.input));
  if (view.title) q.set('title', view.title);
  const back = wayBack(from);
  if (back) q.set('from', back);
  return address(`/tools/${encodeURIComponent(view.capability)}`, q);
}
/**
 * The view's page read with another input (its own search field or choice): the name and the way back stay, and what
 * the panel held beside it lets go, as a new search shows other rows.
 */
export function withViewInput(pathname: string, search: URLSearchParams | string, input: Record<string, unknown>) {
  const from = new URLSearchParams(search);
  const q = new URLSearchParams();
  if (Object.keys(input).length) q.set('input', JSON.stringify(input));
  for (const key of ['title', 'from']) {
    const value = from.get(key);
    if (value !== null) q.set(key, value);
  }
  return address(pathname, q);
}
/** The input property a view's own search field writes (`input.query.key` of a table or a list), or null. */
export function searchKeyOf(spec: { kind: string; input?: { query?: { key: string } } } | undefined): string | null {
  return spec && (spec.kind === 'table' || spec.kind === 'list') ? (spec.input?.query?.key ?? null) : null;
}
/**
 * A view's page read with another input from its own controls (D116, amended 2026-11-24 in the fixes of the web review's
 * M4): the address it leads to and the words typed, kept apart. What the person typed into the view's search field
 * (`key`) is never written into the address, which every access log on the way and the browser's history keep: a
 * search is a person's name as often as not (D100 item 5, D121 item 4). A choice is written, so it can be linked and
 * one step back undoes it; the address's own words for the search, from a link, go as soon as the person types.
 */
export function viewInputChange(
  pathname: string,
  search: URLSearchParams | string,
  input: Record<string, unknown>,
  key: string | null,
): { href: string; at: string | null; words: string } {
  const { [key ?? '']: typed, ...chosen } = input;
  const href = withViewInput(pathname, search, key ? chosen : input);
  const at = new URLSearchParams(href.split('?')[1] ?? '').get('input');
  return { href, at, words: key && typeof typed === 'string' ? typed : '' };
}
/** The input a view is read with: the address's (`input`), with the words typed into its search field as `key`. */
export function withSearchWords(inputJson: string | null, key: string, words: string): string | null {
  const { [key]: _addressed, ...rest } = parse(inputJson);
  const input = words ? { ...rest, [key]: words } : rest;
  return Object.keys(input).length ? JSON.stringify(input) : null;
}
/** Whether the reads the person may open say this one answers with rows: a page, not a peek. */
export const opensAsPage = (views: readonly ViewEntry[] | undefined, capability: string): boolean =>
  answersWithRows(views?.find(v => v.capability === capability)?.kind);
/**
 * Clew's own page a read of Clew's declares for its rows (`ViewEntry.page`, D116): the matrix narrowed to what needs the
 * manager for `competence.attention`, so the figure on Hem, the manager's card and an answer's "Visa allt" lead to the
 * one face of those rows. Only for the read as it is without input; with an input, and for every other read, none.
 */
export function declaredPage(
  views: readonly ViewEntry[] | undefined,
  capability: string,
  input?: Record<string, unknown>,
): string | undefined {
  if (input && Object.keys(input).length) return undefined;
  const page = views?.find(v => v.capability === capability)?.page;
  // A path inside Clew, as the server declares it; anything else is not followed.
  return page && /^\/[^/]/.test(page) ? page : undefined;
}
/**
 * Where opening a view from a page leads: the page Clew's own read declares for its rows (`declaredPage`); else the
 * view's own page with this page as the way back (D126 rule 1; `withView` keeps one thing beside the transcript on the
 * conversation's page, rule 2).
 */
export function viewOpenHref(
  views: readonly ViewEntry[] | undefined,
  pathname: string,
  search: URLSearchParams | string,
  view: ViewTarget & { title: string },
): string {
  return (
    declaredPage(views, view.capability, view.input) ??
    (opensAsPage(views, view.capability)
      ? viewPageHref(view, withoutView(pathname, search))
      : withView(pathname, search, view))
  );
}
/**
 * Where an address that opens a view beside the page leads once the view has answered with rows (D116): the view's own
 * page, with the page it was beside as the way back. An address from before, a saved link or a read whose kind was not
 * known, keeps working. Null when the address opens no view.
 */
export function openedAsPage(pathname: string, search: URLSearchParams | string): string | null {
  const q = new URLSearchParams(search);
  const capability = q.get('open');
  if (!capability) return null;
  return viewPageHref(
    { capability, title: q.get('open-title') ?? undefined, input: parse(q.get('open-input')) },
    withoutView(pathname, q),
  );
}
/** What a work item's read is read with (D112): the action's own input and, when it takes them, the chosen rows. */
export function readInput(
  thread: Pick<Thread, 'items'>,
  action: Pick<ThreadAction, 'input' | 'usesItems'>,
): Record<string, unknown> {
  return {
    ...(action.input ?? {}),
    ...(action.usesItems ? { refs: [...new Set(thread.items.filter(i => i.selected).map(i => i.ref))].sort() } : {}),
  };
}
/**
 * Where a work item's read that answers with rows leads (D116: "Se i personalsystemet", every leave request in a
 * table): the page Clew's own read declares for its rows (`declaredPage`, the manager's competence card to the matrix),
 * else the read's page, with the page the item is on as the way back. Under the read's own title, not the button's.
 */
export function readPageHref(
  thread: Pick<Thread, 'items'>,
  action: Pick<ThreadAction, 'capability' | 'input' | 'usesItems'>,
  from: string,
  views?: readonly ViewEntry[],
): string {
  const input = readInput(thread, action);
  return declaredPage(views, action.capability, input) ?? viewPageHref({ capability: action.capability, input }, from);
}

/**
 * What Clew knows of the reader's people (D97), for `peopleReadHref`: the lenses an administrator offers over them (each
 * a read about a person, with its declared view and the reads that answer its rows without keys, `overviews`, D127),
 * the people the reader may ask about by Clew's key and the key a source names them by, and each lens's rows once read
 * (undefined while on their way).
 */
export interface PeopleReads {
  lenses: ReadonlyArray<{ capability: string; view: View; overviews?: readonly string[] | undefined }>;
  people: ReadonlyArray<{ key: string; sourceKey: string }>;
  rows: (capability: string) => ReadonlyArray<Record<string, unknown>> | undefined;
}
/** A table's or a list's fuller read about one of its rows, as the view declares it (`open`). */
const openOf = (view: View) => (view.kind === 'table' || view.kind === 'list' ? view.open : undefined);
/** The lenses whose fuller read about one person (their view's `open`) is `capability`. */
export const lensesOpening = (reads: Pick<PeopleReads, 'lenses'>, capability: string) =>
  reads.lenses.filter(l => openOf(l.view)?.capability === capability);
/** The address of Personal at a lens's tab (D126 rule 8): a place in the rail, which names no way back. */
export const lensTabHref = (capability: string) => `/staff?show=${encodeURIComponent(capability)}`;
/**
 * Where a read about the reader's people is (D126 rules 1 and 8, one page per thing), from what the sources declare and
 * nothing else: a lens an administrator offers over the people is Personal's tab for it, and so is a read that answers
 * the lens's rows without keys (its view's `byKey`, D127: Hem's "Frånvaro per person"), opened without input; a lens's
 * fuller read about one person (its view's `open`, asked with that person's row's fields as its `params` say) is that
 * person's page at the lens's tab, which draws that read, with `from` as the way back. Null for any other read, which
 * keeps its own page (`viewPageHref`); undefined while the lens's rows that name the person are on their way.
 */
export function peopleReadHref(view: ViewTarget, reads: PeopleReads, from?: string | null): string | null | undefined {
  if (reads.lenses.some(l => l.capability === view.capability)) return lensTabHref(view.capability);
  const plain = !view.input || !Object.keys(view.input).length;
  const whole = plain ? reads.lenses.find(l => l.overviews?.includes(view.capability)) : undefined;
  if (whole) return lensTabHref(whole.capability);
  const opening = lensesOpening(reads, view.capability);
  let waiting = false;
  for (const lens of opening) {
    const params = Object.entries(openOf(lens.view)?.params ?? {});
    const rows = reads.rows(lens.capability);
    if (!rows) {
      waiting = true;
      continue;
    }
    if (!params.length) continue;
    const row = rows.find(r =>
      params.every(([input, field]) => r[field] !== undefined && String(r[field]) === String(view.input?.[input])),
    );
    const key = typeof row?.key === 'string' ? row.key.toLowerCase() : null;
    const person = key ? reads.people.find(p => p.sourceKey.toLowerCase() === key) : undefined;
    if (person) return personPageHref(person.key, { section: lens.capability, from: from ?? null });
  }
  return waiting ? undefined : null;
}
