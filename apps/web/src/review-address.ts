/**
 * The review of a card's rows one at a time is a page with an address of its own (D73): `/cards/:threadId/review`, the
 * step as `step`, 1-based, the rows in the card's order and the last step Skicka; the first step leaves it out.
 */
export const reviewHref = (threadId: string, step = 0): string =>
  `/cards/${encodeURIComponent(threadId)}/review${step > 0 ? `?step=${step + 1}` : ''}`;

/** The step the address names, 0-based, among `steps`; null when it names none of them. */
export function stepOf(search: URLSearchParams, steps: number): number | null {
  const raw = search.get('step');
  if (raw === null) return 0;
  if (!/^[1-9]\d*$/.test(raw)) return null;
  const step = Number(raw) - 1;
  return step < steps ? step : null;
}

/**
 * What the review hands back to the card beside Hem on Spara och stäng and Esc (D73): the approved rows as the card's
 * selection. There is no selection on the server, so it rides in the router's navigation state of the one entry it
 * leads to, where the card reads it when it is drawn and puts the focus back on its "Granska N".
 */
export type ReviewReturn = { review: { threadId: string; selected: string[] } };

export const reviewReturn = (threadId: string, selected: string[]): ReviewReturn => ({
  review: { threadId, selected },
});

/** The rows the review handed back to this card, or null when the address was reached some other way. */
export function returnedSelection(state: unknown, threadId: string): string[] | null {
  const review = (state as Partial<ReviewReturn> | null)?.review;
  return review && review.threadId === threadId && Array.isArray(review.selected) ? review.selected : null;
}
