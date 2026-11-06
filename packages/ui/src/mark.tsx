import type { ReactNode } from 'react';
import type { MenuIcon } from '@clew/contracts';
import { Badge } from '@astryxdesign/core/Badge';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';
import {
  BellIcon,
  BookOpenIcon,
  ChartBarIcon,
  DocumentTextIcon,
  LinkIcon,
  PhoneIcon,
  UsersIcon,
} from '@heroicons/react/24/outline';
import { hueOf, hueWord, ordinalWord } from './system-hues';

// The two variants the theme adds to Astryx's Badge (theme.ts, Astryx's documented `variant:value` extension): gray, the
// sixth hue Astryx has as a token but not as a Badge variant, and the house, the outlined mark of Clew's own systems.
declare module '@astryxdesign/core/Badge' {
  interface BadgeVariantMap {
    gray: true;
    house: true;
  }
}

/**
 * Clew's icons (D40, D41): a connector names one for its row in the menu or for its area, Clew draws it. Astryx's
 * semantic names cover the search, the clock and the calendar; the rest are Heroicons outline components handed over as
 * SVG components, the documented way for an icon outside the semantic list (`astryx docs icons custom-icons`), as
 * `AtSymbolIcon` already is.
 */
export const clewIcon = {
  phone: PhoneIcon,
  people: UsersIcon,
  book: BookOpenIcon,
  document: DocumentTextIcon,
  chart: ChartBarIcon,
  link: LinkIcon,
  bell: BellIcon,
  search: 'search',
  clock: 'clock',
  calendar: 'calendar',
} as const satisfies Record<MenuIcon, unknown>;

/**
 * The area mark's chip (D71): the colour says the system, the icon the area, and the word is always there, so the
 * colour never stands alone (1.4.1). Above a card's title, in a view's header, in a figure's corner. A system with no
 * ordinal is Clew's own and gets the outlined house mark.
 */
export function AreaChip({ ordinal, icon, label }: { ordinal: number | null; icon?: MenuIcon; label: string }) {
  return (
    <Badge
      variant={hueOf(ordinal) ?? 'house'}
      icon={icon ? <Icon icon={clewIcon[icon]} size="sm" /> : undefined}
      label={label}
    />
  );
}
/** The area mark in a row (D71): the area's icon in secondary at the start of the meta line, always followed by the word. No hue in a row, so a list stays calm. */
export function AreaGlyph({ icon }: { icon?: MenuIcon }) {
  return icon ? <Icon icon={clewIcon[icon]} color="secondary" size="sm" /> : null;
}
/**
 * A row's meta line with its glyph first (D71): the icon, then the words in supporting. The two never part: the words
 * wrap under themselves beside the icon, and a status badge goes after this line, never inside it.
 */
export function AreaLine({ icon, children }: { icon?: MenuIcon; children: ReactNode }) {
  return (
    <HStack gap={1.5} vAlign="start">
      <AreaGlyph icon={icon} />
      <Text type="supporting">{children}</Text>
    </HStack>
  );
}
/** Where a system stands in the order and what colour that gives it, in words: "2:a anslutna systemet · färg lila", or "Clews egen". */
export const swatchWords = (ordinal: number | null) => {
  const hue = hueOf(ordinal);
  return hue && ordinal ? `${ordinalWord(ordinal)} anslutna systemet · färg ${hueWord[hue]}` : 'Clews egen';
};
/**
 * The system's colour on its own (artboard 9): Astryx's colour-only Badge (a Badge with no label keeps its geometry),
 * the house's white with its outline. Its accessible name says the colour and the ordinal, since the administration is
 * where a person learns which colour is which system.
 */
export function SystemSwatch({ ordinal }: { ordinal: number | null }) {
  const hue = hueOf(ordinal);
  const name = hue && ordinal ? `Färg ${hueWord[hue]}, ${ordinalWord(ordinal)} anslutna systemet` : 'Vit, Clews egen';
  return <Badge variant={hue ?? 'house'} label="" role="img" aria-label={name} />;
}
