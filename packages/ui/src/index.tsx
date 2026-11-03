import type { ReactNode } from 'react';
import { Theme } from '@astryxdesign/core/theme';
import { InternationalizationProvider } from '@astryxdesign/core/i18n';
import { neutralTheme } from '@astryxdesign/theme-neutral/built';
import sv from '@astryxdesign/core/locales/sv-SE.json';

export { Button } from '@astryxdesign/core/Button';
export { IconButton } from '@astryxdesign/core/IconButton';
export { Card } from '@astryxdesign/core/Card';
export { Heading } from '@astryxdesign/core/Heading';
export { Text } from '@astryxdesign/core/Text';
export { Badge } from '@astryxdesign/core/Badge';
export { Banner } from '@astryxdesign/core/Banner';
export { TextInput } from '@astryxdesign/core/TextInput';
export { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
export { Typeahead, createStaticSource, type SearchableItem } from '@astryxdesign/core/Typeahead';
export { BottomSheet } from '@astryxdesign/core/BottomSheet';
export { HStack } from '@astryxdesign/core/HStack';
export { VStack } from '@astryxdesign/core/VStack';
export { Divider } from '@astryxdesign/core/Divider';
export { Spinner } from '@astryxdesign/core/Spinner';
export { Icon } from '@astryxdesign/core/Icon';
export { Link, LinkProvider } from '@astryxdesign/core/Link';
export { useMediaQuery } from '@astryxdesign/core/hooks';
export { SessionBoundary, sessionFetch, signOut, type BrowserSession } from './session';
export { WeekView, EventChip, type WeekItem } from './week-view';

// The shipped sv-SE catalog is incomplete. Keys reachable by this POC are covered here.
export const swedish = { ...sv,
  '@astryx.input.readOnly': { defaultMessage: 'Skrivskyddad' },
  '@astryx.typeahead.noResults': { defaultMessage: 'Inga förslag' },
};
/** The plain Astryx look: Neutral theme, Swedish strings. No project theme in the POC. */
export function Providers({ children }: { children: ReactNode }) {
  return <InternationalizationProvider locale="sv-SE" messages={{ 'sv-SE': swedish }}>
    <Theme theme={neutralTheme} mode="light">{children}</Theme>
  </InternationalizationProvider>;
}
