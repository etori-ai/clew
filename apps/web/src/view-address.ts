import { answersWithRows, type Thread, type ThreadAction, type ViewEntry } from '@clew/contracts';
import { withView, withoutView } from './panel-address';
import { wayBack } from './person-address';

/**
 * Where a view is (D116; D42 gave a tool its page). Every read a person may open has a page of its own at
 * `/tools/<capability>`, whether or not an administrator placed it in the rail: `input` is what it is read with,
 * `title` the name it was opened under (the menu's row or the read's own title when absent) and `from` the page it was
 * opened from, the way back. A view that answers with rows, a table or a list, is a page: whatever opens one leads
 * there and Back returns. Anything else, one record, a contact card, a text, a day, is a peek beside the page it was
 * opened from (`?open=` in that page's address, `panel-address.ts`); a record or a document in the panel links to its
 * page. The kinds come from the reads the person may open (`/api/areas`, `views`); a read Clew does not know the kind
 * of opens beside the page, and the panel sends it on to its page if it answers with rows (`openedAsPage`).
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
const parse = (json: string | null): Record<string, unknown> => {
  try {
    const v: unknown = json ? JSON.parse(json) : {};
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

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
 * Where opening a view from a page leads: the page Clew's own read declares for its rows (`declaredPage`); else a table
 * or a list to its page, with this page as the way back (what this page holds in its panel kept, so the way back returns
 * to it as it was); anything else beside this page, in its panel.
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
