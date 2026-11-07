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
 * What the review hands back to the card beside Hem when it is closed with ✕, Esc or the scrim (D73): the approved rows
 * as the card's selection. There is no selection on the server, so it rides in the router's navigation state of the one
 * entry it leads to, where the card reads it, whether it is drawn then or stood under the drawer all along, and puts the
 * focus back on its "Granska N".
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
