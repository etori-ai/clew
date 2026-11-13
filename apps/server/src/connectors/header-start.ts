import type { SiteHeaderView } from '@clew/contracts';

type Place = SiteHeaderView['menu']['items'][number];

/**
 * Start in the shared header is Clew's (D116): one place, first in the band, leading to Clew's root. It has no row of
 * pages under it (amended 2026-11-13): Clew's own pages, Hem, Att göra, Kalender, and for a manager Personal and
 * Dialogstöd, stand once, in the rail, so the header is the site's way between places and the rail Clew's way within
 * its own. Pure, so the header read and its tests share it.
 */
export const CLEWS_START: Place = { id: 'start', label: 'Start', href: '/' };

/**
 * The header connector's places with Clew's Start first (D116 item 3): a place the connector calls `start`, or one
 * that leads to Clew's root, is left out with the pages under it, since what Start is is not the connector's.
 */
export function withClewsStart(places: readonly Place[]): Place[] {
  return [CLEWS_START, ...places.filter(p => p.id !== 'start' && p.href !== '/')];
}
