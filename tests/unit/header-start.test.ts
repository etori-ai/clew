import { describe, expect, test } from 'bun:test';
import { CLEWS_START, withClewsStart } from '../../apps/server/src/connectors/header-start';

/**
 * Start in the shared header is Clew's (D116): one place first among the header connector's places, with no row of
 * pages under it (amended 2026-11-13: Clew's pages stand once, in the rail), and the connector's own Start left out
 * with its pages.
 */
describe("Clew's Start in the shared header", () => {
  test('Start leads to Clew’s root and has no row of pages under it, for a manager as for anyone', () => {
    expect(CLEWS_START).toEqual({ id: 'start', label: 'Start', href: '/' });
    expect(CLEWS_START.children).toBeUndefined();
  });

  test("Clew's Start comes first, and the connector's own Start, by its id or Clew's root, is left out with its pages", () => {
    const places = [
      {
        id: 'start',
        label: 'Start',
        href: '/',
        children: [{ id: 'nytt', label: 'Nytt utvecklingsärende', href: '/intranat/flode/utvecklingsarende' }],
      },
      { id: 'hem', label: 'Hem', href: '/' },
      { id: 'organisation', label: 'Organisation', href: 'https://intranat.example.se/organisation' },
      { id: 'service', label: 'Service', href: '/intranat/service' },
    ];
    const items = withClewsStart(places);
    expect(items.map(i => i.id)).toEqual(['start', 'organisation', 'service']);
    expect(items[0]).toEqual(CLEWS_START);
    // A connector without a Start of its own gets Clew's first all the same.
    expect(withClewsStart(places.slice(2)).map(i => i.id)).toEqual(['start', 'organisation', 'service']);
  });
});
