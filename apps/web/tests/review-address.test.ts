import { describe, expect, test } from 'bun:test';
import {
  REVIEW_KEYS,
  legacyReview,
  returnedReview,
  reviewOf,
  reviewReturn,
  selectionAfterReview,
  stepOf,
  withRetriedReview,
  withReview,
  withoutReview,
} from '../src/review-address';

describe('the review lies over the page it was opened on (D73 amended, D110 rule 5)', () => {
  test('its address is the page’s own with the card as `review` and the step, 1-based, the first left out', () => {
    expect(REVIEW_KEYS).toEqual(['review', 'step']);
    expect(withReview('/', '?card=fakturor', 'fakturor')).toBe('/?card=fakturor&review=fakturor');
    expect(withReview('/', '?card=fakturor&review=fakturor', 'fakturor', 2)).toBe(
      '/?card=fakturor&review=fakturor&step=3',
    );
    expect(withReview('/', '?card=fakturor&review=fakturor&step=3', 'fakturor', 0)).toBe(
      '/?card=fakturor&review=fakturor',
    );
    expect(withReview('/staff', '?show=clew.talkPeople&card=fakturor', 'fakturor')).toBe(
      '/staff?show=clew.talkPeople&card=fakturor&review=fakturor',
    );
    expect(withReview('/conversations/c1', '', 'fakturor')).toBe('/conversations/c1?review=fakturor');
    expect(withReview('/people/johan', '?section=needs-you&from=%2Fstaff&card=a%20b', 'a b')).toBe(
      '/people/johan?section=needs-you&from=%2Fstaff&card=a+b&review=a+b',
    );
  });
  test('the address names the card and the step, or none', () => {
    expect(reviewOf('?card=fakturor&review=fakturor')).toBe('fakturor');
    expect(reviewOf(new URLSearchParams('review='))).toBeNull();
    expect(reviewOf('')).toBeNull();
    expect(stepOf(new URLSearchParams('review=f'), 4)).toBe(0);
    expect(stepOf(new URLSearchParams('review=f&step=4'), 4)).toBe(3);
    expect(stepOf(new URLSearchParams('review=f&step=5'), 4)).toBeNull();
    expect(stepOf(new URLSearchParams('review=f&step=0'), 4)).toBeNull();
    expect(stepOf(new URLSearchParams('review=f&step=x'), 4)).toBeNull();
  });
  test('closing leaves the page as it was under it: its tab, its lens, its section and the card beside it', () => {
    expect(withoutReview('/', '?card=fakturor&review=fakturor&step=2')).toBe('/?card=fakturor');
    expect(withoutReview('/', '?tab=done&card=fakturor&review=fakturor')).toBe('/?tab=done&card=fakturor');
    expect(withoutReview('/staff', '?show=clew.talkPeople&cards=johan&card=x&review=x&step=3')).toBe(
      '/staff?show=clew.talkPeople&cards=johan&card=x',
    );
    expect(withoutReview('/conversations/c1', '?review=fakturor')).toBe('/conversations/c1');
  });
  test('a card that is gone leaves the panel too, and only that card', () => {
    expect(withoutReview('/', '?card=okand&review=okand', 'okand')).toBe('/');
    expect(withoutReview('/calendar', '?card=other&review=okand', 'okand')).toBe('/calendar?card=other');
  });
  test('Granska avvisade igen puts the new card’s review in the old one’s place, from its first step', () => {
    expect(withRetriedReview('/', '?tab=done&card=fakturor&review=fakturor&step=3', 'fakturor', 'retry:1')).toBe(
      '/?tab=done&card=retry%3A1&review=retry%3A1',
    );
    expect(withRetriedReview('/conversations/c1', '?review=fakturor', 'fakturor', 'retry:1')).toBe(
      '/conversations/c1?review=retry%3A1',
    );
  });
  test('the address from before is a cold link to the work item in Att göra with the review over it (D111)', () => {
    expect(legacyReview('fakturor', '')).toBe('/todo?item=fakturor&review=fakturor');
    expect(legacyReview('fakturor', '?step=2')).toBe('/todo?item=fakturor&review=fakturor&step=2');
    expect(legacyReview('a b', '?step=2&other=x')).toBe('/todo?item=a+b&review=a+b&step=2');
  });
  test('closing the review over Att göra keeps the item in the pane, and lets go of it when it is gone', () => {
    expect(withoutReview('/todo', '?item=fakturor&review=fakturor&step=2')).toBe('/todo?item=fakturor');
    expect(withoutReview('/todo', '?item=fakturor&review=fakturor', 'fakturor')).toBe('/todo');
    expect(withoutReview('/items/fakturor', '?from=%2Ftodo&review=fakturor&step=3')).toBe(
      '/items/fakturor?from=%2Ftodo',
    );
  });
});

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
