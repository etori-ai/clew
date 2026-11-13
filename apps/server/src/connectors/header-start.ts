import type { SiteHeaderView } from '@clew/contracts';

type Place = SiteHeaderView['menu']['items'][number];

/**
 * Start and the row under it are Clew's (D116): the places at the top of the rail (D112 item 1), in its order and with
 * its words, Personal for a manager only (D94), and for a manager Dialogstöd, their own unit's page, which Läget on Hem
 * already calls the dialogue support ("Öppna dialogstödet"). Pure, so the header read and its tests share it.
 */
export function clewsStart(role: 'manager' | 'employee', unitId?: string): Place {
  return {
    id: 'start',
    label: 'Start',
    href: '/',
    children: [
      { id: 'hem', label: 'Hem', href: '/' },
      { id: 'att-gora', label: 'Att göra', href: '/todo' },
      { id: 'kalender', label: 'Kalender', href: '/calendar' },
      ...(role === 'manager' ? [{ id: 'personal', label: 'Personal', href: '/staff' }] : []),
      ...(role === 'manager' && unitId
        ? [{ id: 'dialogstod', label: 'Dialogstöd', href: `/units/${encodeURIComponent(unitId)}` }]
        : []),
    ],
  };
}

/**
 * The header connector's places with Clew's Start first (D116 item 3): a place the connector calls `start`, or one
 * that leads to Clew's root, is left out with the pages under it, since what stands under Start is not the connector's.
 */
export function withClewsStart(places: readonly Place[], start: Place): Place[] {
  return [start, ...places.filter(p => p.id !== 'start' && p.href !== '/')];
}
