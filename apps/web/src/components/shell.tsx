import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { SessionUser } from '@clew/contracts';
import { AppShell, BellIcon, Banner, Button, Dialog, DialogHeader, Divider, Drawer, DrawerHeader, Heading, HStack, Icon, IconButton, Layout, LayoutContent, List, ListItem, RadioList, RadioListItem, SideNav, SideNavHeading, SideNavItem, SideNavSection, Spinner, Text, UserCircleIcon, VStack, signOut, useAppearance, useToast } from '@clew/ui';
import { branding } from '../branding';
import { threadsQuery } from '../queries';
import { errorMessage } from '../query-policy';
import { activeReminders } from '../stream';

const headerLogo = branding.logo;

/** AppShell moves the SideNav into a drawer below its `md` breakpoint (768 px); every phone decision in the app follows the same line. */
export const mobileQuery = '(max-width: 767px)';
/** 1.4.10: with 480 px or less in height nothing is pinned; the page scrolls as one. */
export const shortQuery = '(max-height: 480px)';

/** The overview rail folds under its groups below this breakpoint. */
export const narrowQuery = '(max-width: 1023px)';

export type Surface = 'start' | 'kalender' | 'admin';
/** What a surface puts in the rail: a create button on top, its own sections, the tools (D40) and the rows that stay at the foot. */
export interface ShellNav {
  top?: ReactNode;
  sections: ReactNode;
  /** Rows under the heading Verktyg: the calendar and the views that connectors offer as tools. */
  tools?: ReactNode;
  footer?: ReactNode;
}
type Props = {
  user: SessionUser;
  nav: ShellNav;
  banner?: ReactNode;
  height?: 'fill' | 'auto';
  children: ReactNode;
};
/** One shell for every surface (D31, D39); Astryx owns navigation, overlays and focus restoration. */
export function Shell({ user, nav, banner, height = 'fill', children }: Props) {
  const { mode, setMode, isPersistent } = useAppearance();
  const logoSrc = mode === 'dark' && headerLogo?.darkSrc ? headerLogo.darkSrc : headerLogo?.src;
  const [failedLogo, setFailedLogo] = useState<string | null>(null);
  const [navigationOpen, setNavigationOpen] = useState(false);
  // Every row in the phone drawer asks to close it. Settings opens over the drawer instead, so its row is still there for Escape to return focus to (2.4.3).
  const keepNavigation = useRef(false);
  const changeNavigation = (open: boolean) => {
    if (open || !keepNavigation.current) setNavigationOpen(open);
    keepNavigation.current = false;
  };
  const [remindersOpen, setRemindersOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const toast = useToast();
  const location = useLocation();
  // The same session-scoped cache as the start page; no notification endpoint or read/unread state.
  const threadsQ = useQuery(threadsQuery);
  const reminders = activeReminders(threadsQ.data?.threads ?? [], new Date().toISOString());
  useEffect(() => { setRemindersOpen(false); setNavigationOpen(false); }, [location.key]);
  const logout = async () => {
    setSigningOut(true);
    try { await signOut(); }
    catch (error) { toast({ type: 'error', body: error instanceof Error ? error.message : 'Kunde inte logga ut. Försök igen.' }); }
    finally { setSigningOut(false); }
  };
  return <>
    <AppShell height={height} variant="elevated" contentPadding={0} mobileNav={{ breakpoint: 'md', isOpen: navigationOpen, onOpenChange: changeNavigation }} banner={banner}
      sideNav={<SideNav
        header={<SideNavHeading heading="Startsidan" headingHref="/"
          headerEndContent={<HStack gap={1} vAlign="center">
            <IconButton label={threadsQ.isError ? 'Påminnelser – kunde inte uppdateras' : `Påminnelser (${reminders.length})`}
              icon={<Icon icon={BellIcon} size="sm" />} variant="ghost" size="sm" onClick={() => setRemindersOpen(true)} />
            {reminders.length > 0 && <Text type="supporting" aria-hidden="true">{reminders.length}</Text>}
          </HStack>}
          icon={headerLogo && logoSrc !== failedLogo ? <img src={logoSrc} alt={headerLogo.alt} width={20} height={20}
            style={{ width: 20, height: 20, objectFit: 'contain', padding: 'var(--spacing-3)', boxSizing: 'content-box',
              backgroundColor: mode === 'dark' && !headerLogo.darkSrc ? 'var(--color-on-dark)' : undefined }}
            onError={() => setFailedLogo(logoSrc ?? null)} /> : undefined} />}
        topContent={nav.top}
        footer={<>
          {nav.tools && <SideNavSection title="Verktyg">{nav.tools}</SideNavSection>}
          <SideNavSection title="Alltid" isHeaderHidden>
            {nav.footer}
            {/* The last row of the rail, built like Områden above it. Not in `footerIcons`: Astryx draws those in the phone top bar too (D39). */}
            <SideNavItem label={user.name} icon={UserCircleIcon} collapsible={{ defaultIsCollapsed: true }}>
              <SideNavItem label="Inställningar" onClick={() => { keepNavigation.current = true; setSettingsOpen(true); }} />
              <SideNavItem label={signingOut ? 'Loggar ut …' : 'Logga ut'} isDisabled={signingOut} onClick={() => { void logout(); }} />
            </SideNavItem>
          </SideNavSection>
        </>}>
        {nav.sections}
      </SideNav>}>
      {children}
    </AppShell>
    <Drawer isOpen={remindersOpen} onOpenChange={setRemindersOpen} label="Påminnelser">
      <Layout header={<DrawerHeader title="Påminnelser" onOpenChange={setRemindersOpen} />} content={<LayoutContent>
        <VStack gap={4}>
          {threadsQ.isPending && <HStack gap={2}><Spinner /><Text role="status">Hämtar påminnelser …</Text></HStack>}
          {threadsQ.isError && <Banner status="error" title={errorMessage(threadsQ.error, 'Påminnelserna kunde inte uppdateras.')}
            endContent={<Button label="Försök igen" size="sm" variant="secondary" onClick={() => { void threadsQ.refetch(); }} />} />}
          {threadsQ.data && <>
            <Text type="supporting">{reminders.length ? 'Aktuella påminnelser om sådant som behöver dig.' : 'Du har inga aktuella påminnelser.'}</Text>
            {reminders.length > 0 && <List hasDividers aria-label="Aktuella påminnelser">{reminders.map(thread => <ListItem key={thread.id}
              label={<Text weight="semibold">{thread.title}</Text>} description="Visa kortet på startsidan"
              href={`/overview?card=${encodeURIComponent(thread.id)}`} />)}</List>}
          </>}
          <Divider />
          <Heading level={3}>Genvägar</Heading>
          <List aria-label="Genvägar">
            <ListItem label="Startsidan" href="/" startContent={<Icon icon="menu" size="sm" />} />
            <ListItem label="Kalender" href="/calendar" startContent={<Icon icon="calendar" size="sm" />} />
          </List>
        </VStack>
      </LayoutContent>} />
    </Drawer>
    <Dialog isOpen={settingsOpen} onOpenChange={setSettingsOpen}>
      <DialogHeader title="Inställningar" onOpenChange={setSettingsOpen} />
      <VStack gap={4}>
        <VStack gap={1}><Text weight="semibold">{user.name}</Text><Text type="supporting">{user.unitLabel}</Text></VStack>
        <RadioList label="Utseende" value={mode} onChange={value => { if (value === 'light' || value === 'dark') setMode(value); }}
          description={isPersistent ? 'Valet sparas i den här webbläsaren.' : 'Webbläsaren tillåter inte att valet sparas. Det gäller tills du laddar om sidan.'}>
          <RadioListItem value="light" label="Ljust" />
          <RadioListItem value="dark" label="Mörkt" />
        </RadioList>
        <Button label="Stäng" variant="secondary" onClick={() => setSettingsOpen(false)} />
      </VStack>
    </Dialog>
  </>;
}
