import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { SessionUser } from '@clew/contracts';
import {
  AppShell,
  Button,
  Dialog,
  DialogHeader,
  RadioList,
  RadioListItem,
  SideNav,
  SideNavHeading,
  SideNavItem,
  SideNavSection,
  Text,
  UserCircleIcon,
  VStack,
  signOut,
  useAppearance,
  useMediaQuery,
  useToast,
  Divider,
  HStack,
  StackItem,
} from '@clew/ui';
import { createHeaderBandTheme } from '@clew/ui/theme';
import { SiteHeader, SiteHeaderPerson, selectedItem } from '@clew/site-header';
import { useBranding } from '../branding';
import { headerQuery, threadsQuery } from '../queries';
import { useAnnounceSilentSources } from './silent-sources';
import { api } from '../api';
import { ReminderBell } from './reminders';
import { PanelOverPage } from './page-panel';
import { mobileQuery } from '../media';
import { cardOverPage } from '../panel-address';
import { pageLocation, usePublishPageLocation } from '../page-location';
import { useFocusOnTheWayBack } from '../way-back';

export { mobileQuery, shortQuery } from '../media';
/** The installation's name in the rail's heading until the default header has said it. */
const SITE_NAME = 'Startsidan';

/**
 * The rows under a rail row that opens (D56). Astryx indents them only as far as the parent's label, so they read as its
 * equals; here they sit further in, with a line down from the parent's icon. The line is drawn only: the rows are already
 * a group. A vertical Divider takes its height from a parent of known height, which the StackItem gets by stretching.
 */
export const SubRows = ({ children }: { children: ReactNode }) => (
  <HStack gap={1} paddingInlineStart={4}>
    <StackItem aria-hidden>
      <Divider orientation="vertical" variant="strong" />
    </StackItem>
    <StackItem size="fill">{children}</StackItem>
  </HStack>
);

export type Surface = 'start' | 'todo' | 'calendar' | 'staff' | 'admin';
/** What a surface puts in the rail: a create button on top, its sections (the places, then the conversations, D50) and the rows that stay at the foot. */
export interface ShellNav {
  top?: ReactNode;
  sections: ReactNode;
  footer?: ReactNode;
  /** What a rail row opens over the page (the search's command palette), drawn beside the shell rather than in the rail. */
  overlay?: ReactNode;
}
type Props = {
  user: SessionUser;
  nav: ShellNav;
  banner?: ReactNode;
  height?: 'fill' | 'auto';
  children: ReactNode;
};
/**
 * One shell for every surface (D31, D39, D88, D112 item 1), the `shell-side-nav` template: Astryx owns navigation,
 * overlays and focus restoration. The rail is collapsible and resizable. Without a header connector the rail carries
 * the installation's identity: its heading is the installation's logo and name (D98) with the reminder bell, and the
 * person is the last row at its foot, opening the settings (D39). An installation whose header connector answers (D88)
 * gets the shared header as Astryx's TopNav above the rail instead: the logo, the name, the bell and the person on the
 * band, the places the connector lists under them; the rail then has no heading of its own, so the identity is said
 * once. On a phone the shell draws the rail's heading, or the band's heading row, as its bar, and the places go into
 * the drawer with the rail.
 *
 * Every page has the panel (the product owner, 2026-11-11: what is opened from a page opens beside that page). A page
 * that holds it beside its own column claims it (`usePagePanel`); on any other page the shell draws what the address
 * opens, a card or a view, in the drawer over the page, and closing it leaves the page as it was.
 */
export function Shell({ user, nav, banner, height = 'fill', children }: Props) {
  const { mode, setMode, isPersistent } = useAppearance();
  const mobile = useMediaQuery(mobileQuery);
  const toast = useToast();
  const location = useLocation(),
    navigate = useNavigate();
  // A toast is drawn outside the router and outlives the page that raised it: it reads where the person is from here.
  usePublishPageLocation();
  // Back from a view's page (D116): the link that opened it takes the focus again once this page has drawn it.
  useFocusOnTheWayBack();
  const deliveryAttempts = useRef(new Set<string>());
  // The same session-scoped cache as the start page carries reminder cards and pending delivery claims.
  const threadsQ = useQuery(threadsQuery);
  // The header is public and the same for everyone; a save on Sidhuvud invalidates it for the administrator at once.
  const headerQ = useQuery(headerQuery);
  // A header connector's answer is the band (D88); Clew's default (no source) is no band at all (D112 item 1).
  const shared = headerQ.data?.source ? headerQ.data : null;
  const here = window.location.origin + location.pathname + location.search;
  const selected = shared ? selectedItem(shared.menu, here) : null;
  // The band's theme (D88) is the installation's (D98), built once per saved theme.
  const branding = useBranding();
  const bandTheme = useMemo(() => createHeaderBandTheme(branding), [branding]);
  // The connector's logo when it gives one, else the installation's own (D98). The connector's is its own band's logo
  // (D88, Sundsvall's white dragon), so on the band it is drawn as given, never on the light plate a logo without a
  // dark variant gets; off the band (the phone's bar) the installation's own, which has a variant for each ground.
  const logo = shared?.logo
    ? mobile
      ? (branding.logo ?? shared.logo)
      : { ...shared.logo, darkSrc: shared.logo.src }
    : branding.logo;
  const ownLogo = branding.logo;
  const logoSrc = ownLogo ? (mode === 'dark' && ownLogo.darkSrc ? ownLogo.darkSrc : ownLogo.src) : undefined;
  const [failedLogo, setFailedLogo] = useState<string | null>(null);
  // A system that does not answer is said where its content is missing, never at the top of the page (D116, amended
  // 2026-11-12); the first time it is seen silent in the session it is said once (4.1.3).
  useAnnounceSilentSources();
  // The phone's drawer closes when a row in it is chosen. The person's row opens the settings over the drawer instead,
  // so the row is still there for Escape to give the focus back to (2.4.3).
  const [navigationOpen, setNavigationOpen] = useState(false);
  const keepNavigation = useRef(false);
  const changeNavigation = (open: boolean) => {
    if (open || !keepNavigation.current) setNavigationOpen(open);
    keepNavigation.current = false;
  };
  useEffect(() => {
    setNavigationOpen(false);
  }, [location.key]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const deliveryContext = useRef(threadsQ.data),
    deliveryMounted = useRef(false);
  deliveryContext.current = threadsQ.data;
  useEffect(() => {
    deliveryMounted.current = true;
    return () => {
      deliveryMounted.current = false;
    };
  }, []);
  useEffect(() => {
    for (const delivery of threadsQ.data?.deliveries ?? []) {
      if (deliveryAttempts.current.has(delivery.id)) continue;
      const thread = threadsQ.data?.threads.find(t => t.id === delivery.threadId);
      if (!thread) continue;
      deliveryAttempts.current.add(delivery.id);
      void api
        .claimDelivery(delivery.id)
        .then(({ claimed }) => {
          if (!claimed || !deliveryMounted.current || !deliveryContext.current?.threads.some(t => t.id === thread.id))
            return;
          const dismiss = toast({
            body: delivery.kind === 'reminder' ? 'Påminnelse: ' + thread.title : 'Nya uppgifter finns i Att göra.',
            isAutoHide: false,
            uniqueID: delivery.id,
            endContent: (
              <Button
                size="sm"
                variant="ghost"
                label="Visa"
                onClick={() => {
                  // Over the page the person is on when they press it, which need not be the one that raised the toast.
                  const { pathname, search } = pageLocation();
                  navigate(cardOverPage(pathname, search, thread.id));
                  dismiss();
                }}
              />
            ),
          });
        })
        .catch(() => {
          deliveryAttempts.current.delete(delivery.id);
        });
    }
  }, [threadsQ.data, toast, navigate]);
  const logout = async () => {
    try {
      await signOut();
    } catch (error) {
      toast({ type: 'error', body: error instanceof Error ? error.message : 'Kunde inte logga ut. Försök igen.' });
    }
  };
  const siteName = headerQ.data?.menu.site.name ?? SITE_NAME;
  /** The rail's heading without a band: the installation's logo, as D37 to D39 allow a native image there, and its name. */
  const heading = shared ? undefined : (
    <SideNavHeading
      heading={siteName}
      headingHref="/"
      headerEndContent={<ReminderBell />}
      icon={
        ownLogo && logoSrc && logoSrc !== failedLogo ? (
          // The installation's logo as a native image, as D37 to D39 allow in a navigation heading: an asset, not an
          // icon. Its height is the row's measure and its width follows the mark, as the shared header draws it.
          <img
            src={logoSrc}
            alt={ownLogo.alt}
            height={28}
            style={{
              height: 28,
              width: 'auto',
              maxWidth: 160,
              objectFit: 'contain',
              // A logo with no dark variant keeps its own light ground in the dark appearance (D39).
              backgroundColor: mode === 'dark' && !ownLogo.darkSrc ? 'var(--color-on-dark)' : undefined,
            }}
            onError={() => setFailedLogo(logoSrc)}
          />
        ) : undefined
      }
    />
  );
  /** The person (board Sidebar): the last row at the rail's foot, opening the settings (D39); on the band where there is one. */
  const person = shared ? null : (
    <SideNavItem
      label={user.name}
      icon={UserCircleIcon}
      onClick={() => {
        keepNavigation.current = true;
        setSettingsOpen(true);
      }}
    />
  );
  const footer = nav.footer || person;
  return (
    <>
      <AppShell
        height={height}
        // `section`: Astryx paints the rail and the page on one surface and parts them with a divider (D88).
        variant="section"
        contentPadding={0}
        mobileNav={{ breakpoint: 'md', isOpen: navigationOpen, onOpenChange: changeNavigation }}
        banner={banner}
        topNav={
          shared ? (
            <SiteHeader
              menu={shared.menu}
              selected={selected}
              location={here}
              logo={logo}
              // No band on a phone: the shell's bar carries the drawer, which would inherit the band's colours (D88).
              band={mobile ? undefined : bandTheme}
              end={
                <HStack gap={2} vAlign="center">
                  <ReminderBell />
                  <SiteHeaderPerson
                    name={user.name}
                    description={user.unitLabel}
                    onSignOut={() => void logout()}
                    appearance={{ mode, onChange: setMode, isPersistent }}
                  />
                </HStack>
              }
            />
          ) : undefined
        }
        sideNav={
          // Collapsible as the template has it. Not resizable: Astryx draws the rail's resize handle beside the navigation
          // landmark, outside every landmark (axe: region), so the rail keeps its own width (D112's gaps).
          <SideNav
            collapsible
            header={heading}
            topContent={nav.top}
            footer={
              footer ? (
                <SideNavSection title="Alltid" isHeaderHidden>
                  {nav.footer}
                  {person}
                </SideNavSection>
              ) : undefined
            }
          >
            {/* On a phone the header's places are rows in the drawer, since the bar holds only the heading there. Every row is a link to its address. */}
            {shared && mobile ? (
              <SideNavSection title="Huvudmeny">
                {shared.menu.items.map(item => (
                  <SideNavItem key={item.id} label={item.label} href={item.href} isSelected={item.id === selected} />
                ))}
              </SideNavSection>
            ) : null}
            {nav.sections}
          </SideNav>
        }
      >
        {children}
        <PanelOverPage />
      </AppShell>
      {nav.overlay}
      {/* The settings (D39), the same composition as the band's person: the colour choice and the way out. */}
      <Dialog isOpen={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogHeader title={user.name} onOpenChange={setSettingsOpen} />
        <VStack gap={4} padding={3}>
          {user.unitLabel ? <Text type="supporting">{user.unitLabel}</Text> : null}
          <RadioList
            label="Utseende"
            value={mode}
            onChange={value => {
              if (value === 'system' || value === 'light' || value === 'dark') setMode(value);
            }}
            description={
              isPersistent === false
                ? 'Webbläsaren tillåter inte att valet sparas. Det gäller tills du laddar om sidan.'
                : 'Valet gäller startsidan och intranätet i den här webbläsaren.'
            }
          >
            <RadioListItem value="system" label="Samma som datorn" />
            <RadioListItem value="light" label="Ljust" />
            <RadioListItem value="dark" label="Mörkt" />
          </RadioList>
          <HStack gap={2} hAlign="end" wrap="wrap">
            <Button
              label="Logga ut"
              variant="secondary"
              onClick={() => {
                setSettingsOpen(false);
                void logout();
              }}
            />
            <Button label="Stäng" variant="primary" onClick={() => setSettingsOpen(false)} />
          </HStack>
        </VStack>
      </Dialog>
    </>
  );
}
