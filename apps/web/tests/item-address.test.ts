import { describe, expect, test } from 'bun:test';
import { itemPageHref, openItemId } from '../src/work-items';

describe('a work item as a page (D112 item 4)', () => {
  test('the page is the item’s own address, with the page it was opened from as the way back', () => {
    expect(itemPageHref('fakturor')).toBe('/items/fakturor');
    expect(itemPageHref('fakturor', '/todo?item=fakturor')).toBe('/items/fakturor?from=%2Ftodo%3Fitem%3Dfakturor');
    expect(itemPageHref('retry:1', '/staff?card=retry%3A1')).toBe(
      '/items/retry%3A1?from=%2Fstaff%3Fcard%3Dretry%253A1',
    );
  });
  test('a way back never holds another way back, and never leads out of Clew', () => {
    expect(itemPageHref('a', '/people/anna?from=%2Fstaff&card=a')).toBe('/items/a?from=%2Fpeople%2Fanna%3Fcard%3Da');
    expect(itemPageHref('a', 'https://example.test/')).toBe('/items/a');
    expect(itemPageHref('a', '//example.test/')).toBe('/items/a');
  });
});

describe('the work item that stands open at an address', () => {
  test('its own page or Att göra with it picked; an answer beside it draws no row that leads to it', () => {
    expect(openItemId('/items/fakturor', '?from=%2F&ask=1')).toBe('fakturor');
    expect(openItemId('/items/a%20b', '')).toBe('a b');
    expect(openItemId('/todo', '?item=fakturor')).toBe('fakturor');
    expect(openItemId('/todo', '')).toBeNull();
    expect(openItemId('/people/anna', '?item=fakturor')).toBeNull();
  });
});
