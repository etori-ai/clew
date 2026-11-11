/**
 * The review of a card's rows one at a time has an address of its own (D73): `/cards/:threadId/review`, the step as
 * `step`, 1-based, the rows in the card's order and the last step Skicka; the first step leaves it out. Since the
 * amendment of 2026-11-07 the address draws Hem with the card beside the column and the review as a drawer over it.
 */
export const reviewHref = (threadId: string, step = 0): string =>
  `/cards/${encodeURIComponent(threadId)}/review${step > 0 ? `?step=${step + 1}` : ''}`;

/** The card whose review the start route names (`/cards/:threadId/review`), or null on Hem's other routes (D73 amended). */
export const reviewOf = (params: { threadId?: string | undefined }): string | null => params.threadId || null;

/** The step the address names, 0-based, among `steps`; null when it names none of them. */
export function stepOf(search: URLSearchParams, steps: number): number | null {
  const raw = search.get('step');
  if (raw === null) return 0;
  if (!/^[1-9]\d*$/.test(raw)) return null;
  const step = Number(raw) - 1;
  return step < steps ? step : null;
}

/**
 * What the review hands back to the card beside Hem when it is closed with ✕, Esc or the scrim (D73): its decisions,
 * the rows chosen for approval and the rows left behind. There is no selection on the server, so they ride in the
 * router's navigation state of the one entry it leads to, where the card reads them, whether it is drawn then or stood
 * under the drawer all along, and puts the focus back on its "Granska N".
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
