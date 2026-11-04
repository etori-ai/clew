import type { ReactNode } from 'react';
import { Theme } from '@astryxdesign/core/theme';
import { LayerProvider } from '@astryxdesign/core/Layer';
import { InternationalizationProvider } from '@astryxdesign/core/i18n';
import { neutralTheme } from '@astryxdesign/theme-neutral/built';
import sv from '@astryxdesign/core/locales/sv-SE.json';

// Strictly Astryx: this package re-exports the components the app composes with and adds no components of its own.
export { Button } from '@astryxdesign/core/Button';
export { IconButton } from '@astryxdesign/core/IconButton';
export { Card } from '@astryxdesign/core/Card';
export { ClickableCard } from '@astryxdesign/core/ClickableCard';
export { Heading } from '@astryxdesign/core/Heading';
export { Text } from '@astryxdesign/core/Text';
export { Badge } from '@astryxdesign/core/Badge';
export { StatusDot } from '@astryxdesign/core/StatusDot';
export { ProgressBar } from '@astryxdesign/core/ProgressBar';
export { Token } from '@astryxdesign/core/Token';
export { ToggleButton, ToggleButtonGroup } from '@astryxdesign/core/ToggleButton';
export { List, ListItem } from '@astryxdesign/core/List';
export { CheckboxList, CheckboxListItem } from '@astryxdesign/core/CheckboxList';
export { Collapsible } from '@astryxdesign/core/Collapsible';
export { Grid } from '@astryxdesign/core/Grid';
export { Divider } from '@astryxdesign/core/Divider';
export { Avatar } from '@astryxdesign/core/Avatar';
export { AvatarGroup, AvatarGroupOverflow } from '@astryxdesign/core/AvatarGroup';
export { Icon } from '@astryxdesign/core/Icon';
export { Link, LinkProvider } from '@astryxdesign/core/Link';
export { Timestamp } from '@astryxdesign/core/Timestamp';
export { BottomSheet } from '@astryxdesign/core/BottomSheet';
export { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
export { EmptyState } from '@astryxdesign/core/EmptyState';
export { Layout, LayoutHeader, LayoutContent, LayoutFooter, LayoutPanel, VStack, HStack, StackItem } from '@astryxdesign/core/Layout';
export { SideNav, SideNavItem, SideNavSection, SideNavHeading } from '@astryxdesign/core/SideNav';
export { DropdownMenu } from '@astryxdesign/core/DropdownMenu';
export { MoreMenu } from '@astryxdesign/core/MoreMenu';
export { Banner } from '@astryxdesign/core/Banner';
export { Drawer, DrawerHeader } from '@astryxdesign/core/Drawer';
export { Skeleton } from '@astryxdesign/core/Skeleton';
export { ChatComposer, ChatComposerInput, ChatComposerDrawer, ChatDictationButton, useChatDictation, ChatMessageList, ChatMessage, ChatMessageBubble, ChatMessageMetadata, ChatSystemMessage, type ChatComposerInputHandle, type ChatComposerTrigger, type ChatComposerToken } from '@astryxdesign/core/Chat';
export type { SearchSource, SearchableItem } from '@astryxdesign/core/Typeahead';
export { Overlay } from '@astryxdesign/core/Overlay';
export { VisuallyHidden } from '@astryxdesign/core/VisuallyHidden';
export { Kbd } from '@astryxdesign/core/Kbd';
export { ScrollableArea } from '@astryxdesign/core/ScrollableArea';
export { useToast } from '@astryxdesign/core/Toast';
// Administration (D23): tables, switches, dialogs, forms and tabs. Still only re-exports.
export { Table, TableHeader, TableBody, TableFooter, TableRow, TableCell, TableHeaderCell, pixel, proportional } from '@astryxdesign/core/Table';
export { Switch } from '@astryxdesign/core/Switch';
export { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
export { AlertDialog } from '@astryxdesign/core/AlertDialog';
export { Stepper, Step } from '@astryxdesign/core/Stepper';
export { TabList, Tab } from '@astryxdesign/core/TabList';
export { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
export { RadioList, RadioListItem } from '@astryxdesign/core/RadioList';
export { Breadcrumbs, BreadcrumbItem } from '@astryxdesign/core/Breadcrumbs';
export { Toolbar } from '@astryxdesign/core/Toolbar';
export { FormLayout } from '@astryxdesign/core/FormLayout';
export { TextInput } from '@astryxdesign/core/TextInput';
export { InfoTip } from '@astryxdesign/core/InfoTip';
export { Code } from '@astryxdesign/core/Code';
export { Spinner } from '@astryxdesign/core/Spinner';
export { MultiSelector } from '@astryxdesign/core/MultiSelector';
export { AppShell } from '@astryxdesign/core/AppShell';
export { TopNav, TopNavHeading, TopNavItem } from '@astryxdesign/core/TopNav';
export { Section } from '@astryxdesign/core/Section';
export { useAnnounce, useMediaQuery } from '@astryxdesign/core/hooks';
export { SessionBoundary, sessionFetch, signOut, type BrowserSession } from './session';
export { WeekAgenda, type AgendaItem } from './week-agenda';
export { EventCalendar, type CalendarView } from './calendar';

// The shipped sv-SE catalog is incomplete. Keys reachable by this POC are covered here.
export const swedish = { ...sv,
  '@astryx.input.readOnly': { defaultMessage: 'Skrivskyddad' },
  '@astryx.chatComposer.placeholder': { defaultMessage: 'Skriv ett meddelande …' },
  '@astryx.chatComposer.send': { defaultMessage: 'Skicka' },
  '@astryx.chatComposer.stop': { defaultMessage: 'Stoppa' },
  '@astryx.chatDictation.start': { defaultMessage: 'Tala' },
  '@astryx.chatDictation.stop': { defaultMessage: 'Sluta tala' },
  '@astryx.chatTriggerMenu.searching': { defaultMessage: 'Söker …' },
  '@astryx.dropdownMenu.backTo': { defaultMessage: 'Tillbaka till {parent}' },
  '@astryx.kbd.key.alt': { defaultMessage: 'Alt' },
  '@astryx.kbd.key.backspace': { defaultMessage: 'Backsteg' },
  '@astryx.kbd.key.command': { defaultMessage: 'Kommando' },
  '@astryx.kbd.key.control': { defaultMessage: 'Kontroll' },
  '@astryx.kbd.key.controlShort': { defaultMessage: 'Ctrl' },
  '@astryx.kbd.key.down': { defaultMessage: 'Nedåtpil' },
  '@astryx.kbd.key.enter': { defaultMessage: 'Retur' },
  '@astryx.kbd.key.escape': { defaultMessage: 'Escape' },
  '@astryx.kbd.key.escapeShort': { defaultMessage: 'Esc' },
  '@astryx.kbd.key.left': { defaultMessage: 'Vänsterpil' },
  '@astryx.kbd.key.plus': { defaultMessage: 'Plus' },
  '@astryx.kbd.key.right': { defaultMessage: 'Högerpil' },
  '@astryx.kbd.key.shift': { defaultMessage: 'Skift' },
  '@astryx.kbd.key.tab': { defaultMessage: 'Tabb' },
  '@astryx.kbd.key.up': { defaultMessage: 'Uppåtpil' },
  '@astryx.kbd.shortcut': { defaultMessage: '{shortcut} + {key}' },
};
/**
 * The plain Astryx look: Neutral theme, Swedish strings. No project theme in the POC. LayerProvider keeps the toast stack
 * inside these providers: without it Astryx mounts a fallback root that gets neither the Swedish catalog nor the theme.
 */
export function Providers({ children }: { children: ReactNode }) {
  return <InternationalizationProvider locale="sv-SE" messages={{ 'sv-SE': swedish }}>
    <Theme theme={neutralTheme} mode="light"><LayerProvider>{children}</LayerProvider></Theme>
  </InternationalizationProvider>;
}
