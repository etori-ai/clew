import { describe, expect, test } from 'bun:test';
import { returnedReview, reviewReturn, selectionAfterReview } from '../src/review-address';

describe("the review hands its decisions back to the card, laid over the card's selection (D73, amended 2026-11-11)", () => {
  const marked = ['inv:1', 'inv:2'];
  test('a review closed with nothing judged leaves the selection as it was', () => {
    expect(selectionAfterReview(marked, { approved: [], left: [] })).toEqual(marked);
  });
  test('an approved row is ticked, a row left behind is not, and a row not judged keeps its tick', () => {
    expect(selectionAfterReview(marked, { approved: ['inv:3'], left: ['inv:1'] }).sort()).toEqual(['inv:2', 'inv:3']);
    expect(selectionAfterReview(marked, { approved: ['inv:2'], left: [] }).sort()).toEqual(['inv:1', 'inv:2']);
    expect(selectionAfterReview([], { approved: [], left: ['inv:1'] })).toEqual([]);
  });
  test('the state names its card, and anything else hands nothing back', () => {
    const state = reviewReturn('fakturor', ['inv:1'], ['inv:2']);
    expect(returnedReview(state, 'fakturor')).toBe(state.review);
    expect(returnedReview(state, 'other')).toBeNull();
    expect(returnedReview(null, 'fakturor')).toBeNull();
    expect(returnedReview({ review: { threadId: 'fakturor', selected: ['inv:1'] } }, 'fakturor')).toBeNull();
  });
});
