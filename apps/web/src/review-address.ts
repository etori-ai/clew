/**
 * The review of a work item's rows one at a time (D70 item 2) is a page of its own since 2026-11-12 (D73, amended under
 * the product owner's rule that a task a person works through is a page with its own address): `/items/<threadId>/review`,
 * the work item's page with `review` after it. `step` is the step (1-based, the rows in the item's order and the last
 * step Skicka; the first step leaves it out), rewritten in place as the person moves, so Back leaves the review; `from`
 * is the page the work item was shown on, for the way back, as the item's own page keeps it (`itemPageHref`): a path
 * inside Clew with its own search, never a `from` of its own.
 *
 * Two addresses from before lead here, in their own place in the history: `?review=<threadId>&step=<n>` on any page
 * (the review as an overlay over that page, 2026-11-07 to 2026-11-12), with that page as `from`, and
 * `/cards/<threadId>/review?step=<n>` (the review's first page, 2026-11-07), with the item's own page as the way back.
 */
export const REVIEW_PARAM = 'review';
export const STEP_PARAM = 'step';
/** The names the review used in another page's address before it was a page; such an address leads here. */
export const REVIEW_KEYS: readonly string[] = [REVIEW_PARAM, STEP_PARAM];

const address = (pathname: string, query: URLSearchParams) => {
  const q = query.toString();
  return q ? `${pathname}?${q}` : pathname;
};
/**
 * `from` as the way back keeps it: a path inside Clew, never another site, without a `from` of its own (the rule of
 * `wayBack` in `person-address.ts`, kept here so this module imports nothing: the panel's addresses import it).
 */
const wayBack = (path: string | null | undefined): string | null => {
  if (!path || !path.startsWith('/') || path.startsWith('//') || path.startsWith('/\\')) return null;
  const at = path.indexOf('?');
  if (at < 0) return path;
  const q = new URLSearchParams(path.slice(at + 1));
  if (!q.has('from')) return path;
  q.delete('from');
  return address(path.slice(0, at), q);
};
const reviewPath = (threadId: string) => `/items/${encodeURIComponent(threadId)}/review`;
/** The review's address with `step` as given (1-based, as the address holds it), or none for the first step. */
const reviewAt = (threadId: string, from: string | null | undefined, step: string | null) => {
  const q = new URLSearchParams();
  const back = wayBack(from);
  if (back) q.set('from', back);
  if (step !== null && step !== '1') q.set(STEP_PARAM, step);
  return address(reviewPath(threadId), q);
};

/** The review of a work item at a step (0-based; the first is left out of the address), with the page it was shown on. */
export function reviewHref(threadId: string, { step = 0, from }: { step?: number; from?: string | null } = {}): string {
  return reviewAt(threadId, from, step > 0 ? String(step + 1) : null);
}
/**
 * A row's document under Dokument: the review at that row (0-based), its step named even for the first row, so the
 * way back tells it apart from "Granska N" and gives the focus to the row that was pressed.
 */
export function documentHref(threadId: string, step: number, from?: string | null): string {
  const q = new URLSearchParams();
  const back = wayBack(from);
  if (back) q.set('from', back);
  q.set(STEP_PARAM, String(step + 1));
  return address(reviewPath(threadId), q);
}
/** The same review at another step (0-based): the address of the page it is on, `step` rewritten, the rest kept. */
export function withStep(pathname: string, search: URLSearchParams | string, step: number): string {
  const q = new URLSearchParams(search);
  if (step > 0) q.set(STEP_PARAM, String(step + 1));
  else q.delete(STEP_PARAM);
  return address(pathname, q);
}
/** The step the address names, 0-based, among `steps`; null when it names none of them. */
export function stepOf(search: URLSearchParams, steps: number): number | null {
  const raw = search.get(STEP_PARAM);
  if (raw === null) return 0;
  if (!/^[1-9]\d*$/.test(raw)) return null;
  const step = Number(raw) - 1;
  return step < steps ? step : null;
}

/** The work item whose review the address of another page named (the overlay's address), or null. */
export function reviewOf(search: URLSearchParams | string): string | null {
  return new URLSearchParams(search).get(REVIEW_PARAM) || null;
}
/**
 * Where an address that laid the review over a page leads (`?review=<threadId>&step=<n>`): the review's page at that
 * step, the page under it as the way back. Null for every other address.
 */
export function reviewPageFrom(pathname: string, search: URLSearchParams | string): string | null {
  const q = new URLSearchParams(search);
  const threadId = reviewOf(q);
  if (!threadId) return null;
  const step = q.get(STEP_PARAM);
  REVIEW_KEYS.forEach(k => q.delete(k));
  return reviewAt(threadId, address(pathname, q), step);
}
/** Where `/cards/:threadId/review?step=n`, the review's first address, leads: its page at the step it named. */
export function legacyReview(threadId: string, search: URLSearchParams | string): string {
  return reviewAt(threadId, null, new URLSearchParams(search).get(STEP_PARAM));
}

/**
 * "Granska avvisade igen" (D80): the new item's review in the old one's place, from its first step, with the way back
 * to where the old item was shown, now showing the new one: its page, Att göra's pane, or the panel beside a page.
 */
export function retriedReviewHref(from: string | null, was: string, now: string): string {
  if (!from) return reviewHref(now);
  const at = from.indexOf('?');
  const path = at < 0 ? from : from.slice(0, at);
  const q = new URLSearchParams(at < 0 ? '' : from.slice(at));
  for (const key of ['item', 'card']) if (q.get(key) === was) q.set(key, now);
  const page = path === `/items/${encodeURIComponent(was)}` ? `/items/${encodeURIComponent(now)}` : path;
  return reviewHref(now, { from: address(page, q) });
}
