import type { MenuIcon } from '@clew/contracts';
import { BellIcon, BookOpenIcon, ChartBarIcon, DocumentTextIcon, LinkIcon, PhoneIcon, UsersIcon } from '@clew/ui';

/**
 * Clew's icons (D40, D41): a connector names one for its row in the menu or for its area, Clew draws it. Astryx's
 * semantic names cover the search, the clock and the calendar; the rest are Heroicons outline components handed over as
 * SVG components, the documented way for an icon outside the semantic list (`astryx docs icons custom-icons`), as
 * `AtSymbolIcon` already is.
 */
export const clewIcon = { phone: PhoneIcon, people: UsersIcon, book: BookOpenIcon, document: DocumentTextIcon, chart: ChartBarIcon, link: LinkIcon, bell: BellIcon, search: 'search', clock: 'clock', calendar: 'calendar' } as const satisfies Record<MenuIcon, unknown>;
