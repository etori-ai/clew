import { describe, expect, test } from 'bun:test';
import {
  REVIEW_KEYS,
  documentHref,
  legacyReview,
  retriedReviewHref,
  reviewHref,
  reviewOf,
  reviewPageFrom,
  stepOf,
  withStep,
} from '../src/review-address';

describe('the review is a page of its own (D73, amended 2026-11-12)', () => {
  test('its address is the work item’s with `review` after it, the step 1-based with the first left out, and the page the item was shown on as `from`', () => {
    expect(reviewHref('fakturor')).toBe('/items/fakturor/review');
    expect(reviewHref('fakturor', { step: 2 })).toBe('/items/fakturor/review?step=3');
    expect(reviewHref('fakturor', { from: '/todo?item=fakturor' })).toBe(
      '/items/fakturor/review?from=%2Ftodo%3Fitem%3Dfakturor',
    );
    expect(reviewHref('a b', { step: 1, from: '/?card=a+b' })).toBe(
      '/items/a%20b/review?from=%2F%3Fcard%3Da%2Bb&step=2',
    );
    // The item's own page as the way back holds no way back of its own.
    expect(reviewHref('fakturor', { from: '/items/fakturor?from=%2Ftodo' })).toBe(
      '/items/fakturor/review?from=%2Fitems%2Ffakturor',
    );
    // Only a path inside Clew is a way back.
    expect(reviewHref('fakturor', { from: 'https://example.org/' })).toBe('/items/fakturor/review');
    expect(reviewHref('fakturor', { from: '//example.org/' })).toBe('/items/fakturor/review');
  });
  test('a row under Dokument names its step even for the first row, so the way back tells it apart from Granska N', () => {
    expect(documentHref('fakturor', 0, '/todo?item=fakturor')).toBe(
      '/items/fakturor/review?from=%2Ftodo%3Fitem%3Dfakturor&step=1',
    );
    expect(documentHref('fakturor', 2)).toBe('/items/fakturor/review?step=3');
    expect(documentHref('fakturor', 0, '/todo?item=fakturor')).not.toBe(
      reviewHref('fakturor', { from: '/todo?item=fakturor' }),
    );
  });
  test('a step is rewritten in place and the rest of the address is kept', () => {
    expect(withStep('/items/fakturor/review', '?from=%2Ftodo', 2)).toBe('/items/fakturor/review?from=%2Ftodo&step=3');
    expect(withStep('/items/fakturor/review', '?from=%2Ftodo&step=3', 0)).toBe('/items/fakturor/review?from=%2Ftodo');
    expect(withStep('/items/fakturor/review', '?step=3&from=%2Ftodo', 1)).toBe(
      '/items/fakturor/review?step=2&from=%2Ftodo',
    );
  });
  test('the address names a step among the steps, or none', () => {
    expect(stepOf(new URLSearchParams(''), 4)).toBe(0);
    expect(stepOf(new URLSearchParams('step=1'), 4)).toBe(0);
    expect(stepOf(new URLSearchParams('step=4'), 4)).toBe(3);
    expect(stepOf(new URLSearchParams('step=5'), 4)).toBeNull();
    expect(stepOf(new URLSearchParams('step=0'), 4)).toBeNull();
    expect(stepOf(new URLSearchParams('step=x'), 4)).toBeNull();
  });
});

describe('the addresses from before lead to the page', () => {
  test('a review that lay over a page is that review’s page at its step, the page under it as the way back', () => {
    expect(REVIEW_KEYS).toEqual(['review', 'step']);
    expect(reviewOf('?card=fakturor&review=fakturor')).toBe('fakturor');
    expect(reviewOf(new URLSearchParams('review='))).toBeNull();
    expect(reviewPageFrom('/todo', '?item=fakturor&review=fakturor&step=2')).toBe(
      '/items/fakturor/review?from=%2Ftodo%3Fitem%3Dfakturor&step=2',
    );
    expect(reviewPageFrom('/', '?card=fakturor&review=fakturor')).toBe(
      '/items/fakturor/review?from=%2F%3Fcard%3Dfakturor',
    );
    expect(reviewPageFrom('/conversations/c1', '?review=fakturor')).toBe(
      '/items/fakturor/review?from=%2Fconversations%2Fc1',
    );
    expect(reviewPageFrom('/staff', '?show=clew.talkPeople&card=x&review=x&step=3')).toBe(
      '/items/x/review?from=%2Fstaff%3Fshow%3Dclew.talkPeople%26card%3Dx&step=3',
    );
    // A step that is not one stays as it was, so the page says so.
    expect(reviewPageFrom('/todo', '?review=fakturor&step=9')).toBe('/items/fakturor/review?from=%2Ftodo&step=9');
    // Every other address is its page's own.
    expect(reviewPageFrom('/todo', '?item=fakturor')).toBeNull();
    expect(reviewPageFrom('/', '?review=')).toBeNull();
  });
  test('the review’s first address is its page at the step it named, nothing else of its query kept', () => {
    expect(legacyReview('fakturor', '')).toBe('/items/fakturor/review');
    expect(legacyReview('fakturor', '?step=2')).toBe('/items/fakturor/review?step=2');
    expect(legacyReview('a b', '?step=2&other=x')).toBe('/items/a%20b/review?step=2');
  });
});

describe('Granska avvisade igen (D80) puts the new item’s review in the old one’s place', () => {
  test('from its first step, the way back now showing the new item where the old one was shown', () => {
    expect(retriedReviewHref('/todo?tab=done&item=fakturor', 'fakturor', 'retry:1')).toBe(
      '/items/retry%3A1/review?from=%2Ftodo%3Ftab%3Ddone%26item%3Dretry%253A1',
    );
    expect(retriedReviewHref('/?card=fakturor', 'fakturor', 'retry:1')).toBe(
      '/items/retry%3A1/review?from=%2F%3Fcard%3Dretry%253A1',
    );
    expect(retriedReviewHref('/items/fakturor', 'fakturor', 'retry:1')).toBe(
      '/items/retry%3A1/review?from=%2Fitems%2Fretry%253A1',
    );
    expect(retriedReviewHref('/conversations/c1', 'fakturor', 'retry:1')).toBe(
      '/items/retry%3A1/review?from=%2Fconversations%2Fc1',
    );
    expect(retriedReviewHref(null, 'fakturor', 'retry:1')).toBe('/items/retry%3A1/review');
  });
});
