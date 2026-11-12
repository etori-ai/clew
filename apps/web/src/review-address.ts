/**
 * The review of a card's rows one at a time (D70 item 2) lies over the page it was opened on (D73, amended 2026-11-11
 * under D110 rule 5): its address is that page's own with the card as `review` and the step as `step`, 1-based, the
 * rows in the card's order and the last step Skicka; the first step leaves `step` out. Closing it is the same address
 * without the two, so what was under it is there again as it was: Hem's tab, Personal's lens, a person's section and
 * way back, a conversation, and the card open in the page's panel. Everything else in the address is the
 * page's own and is kept. `/cards/:threadId/review`, the address before that amendment, is a cold link that leads to
 * Hem with the card beside it and the review over both (`legacyReview`).
 */
export const REVIEW_PARAM = 'review';
export const STEP_PARAM = 'step';
/** Every name the review's part of an address uses: what closing it takes away. */
export const REVIEW_KEYS: readonly string[] = [REVIEW_PARAM, STEP_PARAM];
/** The panel's card (`panel-address.ts`), which the review keeps, names again or lets go of. */
const CARD = 'card';
/** Att göra's chosen work item (`work-items.ts`, D111), which the review treats as the panel's card. */
const ITEM = 'item';

const address = (pathname: string, query: URLSearchParams) => {
  const q = query.toString();
  return q ? `${pathname}?${q}` : pathname;
};
const stepIn = (q: URLSearchParams, step: number) => {
  if (step > 0) q.set(STEP_PARAM, String(step + 1));
  else q.delete(STEP_PARAM);
};

/** The card whose review the address names, or null when it names none. */
export function reviewOf(search: URLSearchParams | string): string | null {
  return new URLSearchParams(search).get(REVIEW_PARAM) || null;
}
/**
 * The page with this card's review over it, at a step (0-based; the first step is left out of the address). The card
 * stays where it is drawn: beside the page or in its sheet, or in a conversation's answer.
 */
export function withReview(pathname: string, search: URLSearchParams | string, threadId: string, step = 0): string {
  const q = new URLSearchParams(search);
  q.set(REVIEW_PARAM, threadId);
  stepIn(q, step);
  return address(pathname, q);
}
/**
 * The page with the review closed: the same address without `review` and `step`. When the card is gone (`cardGone`,
 * deleted in its source or never there), the panel lets go of it too, so the page is not left saying so beside it.
 */
export function withoutReview(pathname: string, search: URLSearchParams | string, cardGone?: string): string {
  const q = new URLSearchParams(search);
  REVIEW_KEYS.forEach(k => q.delete(k));
  if (cardGone && q.get(CARD) === cardGone) q.delete(CARD);
  if (cardGone && q.get(ITEM) === cardGone) q.delete(ITEM);
  return address(pathname, q);
}
/**
 * "Granska avvisade igen" (D80): the new card's review in the old one's place on the same page, from its first step,
 * and the new card in the panel where the panel held the old one.
 */
export function withRetriedReview(
  pathname: string,
  search: URLSearchParams | string,
  from: string,
  to: string,
): string {
  const q = new URLSearchParams(search);
  q.set(REVIEW_PARAM, to);
  q.delete(STEP_PARAM);
  if (q.get(CARD) === from) q.set(CARD, to);
  if (q.get(ITEM) === from) q.set(ITEM, to);
  return address(pathname, q);
}
/**
 * Where `/cards/:threadId/review?step=n`, a link from before the review lay over its page, leads: the work item in Att
 * göra (D111) with the review over it, at the step it named. Nothing else of its query is kept.
 */
export function legacyReview(threadId: string, search: URLSearchParams | string): string {
  const q = new URLSearchParams({ item: threadId, [REVIEW_PARAM]: threadId });
  const step = new URLSearchParams(search).get(STEP_PARAM);
  if (step !== null) q.set(STEP_PARAM, step);
  return address('/todo', q);
}

/** The step the address names, 0-based, among `steps`; null when it names none of them. */
export function stepOf(search: URLSearchParams, steps: number): number | null {
  const raw = search.get(STEP_PARAM);
  if (raw === null) return 0;
  if (!/^[1-9]\d*$/.test(raw)) return null;
  const step = Number(raw) - 1;
  return step < steps ? step : null;
}

/**
 * What the review hands back to the card under it when it is closed with ✕, Esc or the scrim (D73): its decisions, the
 * rows chosen for approval and the rows left behind. There is no selection on the server, so they ride in the router's
 * navigation state of the one entry it leads to, where the card reads them, wherever it is drawn (beside the page, in
 * its sheet, in the shell's drawer, in a conversation's answer), and puts the focus back on its "Granska N".
 */
export type ReviewReturn = { review: { threadId: string; approved: string[]; left: string[] } };

export const reviewReturn = (threadId: string, approved: string[], left: string[]): ReviewReturn => ({
  review: { threadId, approved, left },
});

/** What the review handed back to this card, or null when the address was reached some other way. The state's own object, so it is the same one on every render of the entry. */
export function returnedReview(state: unknown, threadId: string): ReviewReturn['review'] | null {
  const review = (state as Partial<ReviewReturn> | null)?.review;
  return review && review.threadId === threadId && Array.isArray(review.approved) && Array.isArray(review.left)
    ? review
    : null;
}

/**
 * The card's selection after a review (D73, amended 2026-11-11): a row chosen for approval is ticked, a row left behind
 * is not, and a row the review never judged keeps the tick it had. So a review that is opened and closed again leaves
 * the card as it was, with the rows the source marked still ticked, where it used to clear every tick.
 */
export const selectionAfterReview = (selected: string[], review: Pick<ReviewReturn['review'], 'approved' | 'left'>) => [
  ...selected.filter(ref => !review.approved.includes(ref) && !review.left.includes(ref)),
  ...review.approved,
];
