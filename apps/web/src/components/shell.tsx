import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
  HStack,
} from '@clew/ui';
import { createHeaderBandTheme } from '@clew/ui/theme';
import { SiteHeader, SiteHeaderPerson, selectedItem } from '@clew/site-header';
import { useBranding } from '../branding';
import { headerQuery, threadsQuery } from '../queries';
import { useAnnounceSilentSources } from './silent-sources';
import { api } from '../api';
import { KeepNavigation, ReminderBell } from './reminders';
import { mobileQuery } from '../media';
import { cardOverPage, panelRedirect } from '../panel-address';
import { personPageHref } from '../person-address';
import { pageLocation, usePublishPageLocation } from '../page-location';
import { useFocusOnTheWayBack } from '../way-back';

export { mobileQuery, shortQuery } from '../media';
/** The installation's name in the rail's heading until the default header has said it. */
export const SITE_NAME = 'Startsidan';
/** The person's settings (D39) as part of the address, so a link can open them and Back never opens them again. */
const SETTINGS_PARAM = 'settings';
/** The page the person is on with their settings over it: the way to them from the person's own page (D126). */
export function settingsHref(pathname: string, search: string): string {
  const q = new URLSearchParams(search);
  q.set(SETTINGS_PARAM, '1');
  return `${pathname}?${q.toString()}`;
}

type Logo = Readonly<{ src: string; alt: string; darkSrc?: string }>;
/**
 * The logo the shared header draws: the connector's when it gives one, else the installation's own (D98). The
 * connector's is its own band's logo (D88, Sundsvall's white dragon), so on the band it is drawn as given, never on the
 * light plate a logo without a dark variant gets; off the band (the phone's bar) the installation's own, which has a
 * variant for each ground.
 */
export function headerLogo(shared: Logo | null | undefined, own: Logo | null, mobile: boolean): Logo | null {
  if (!shared) return own;
  return mobile ? (own ?? shared) : { ...shared, darkSrc: shared.src };
}

/**
 * The installation's logo in the rail's heading, as D37 to D39 allow a native image there: an asset, not an icon. Ny
 * fråga draws the same mark over its greeting (D126 item 14), larger and with no name of its own, since the rail
 * already names the installation (`height`, `decorative`).
 */
export function InstallationLogo({
  logo,
  height = 28,
  decorative = false,
}: {
  logo: Logo | null;
  height?: number;
  decorative?: boolean;
}) {
  const { mode } = useAppearance();
  const [failed, setFailed] = useState<string | null>(null);
  const src = logo ? (mode === 'dark' && logo.darkSrc ? logo.darkSrc : logo.src) : undefined;
  if (!logo || !src || src === failed) return undefined;
  return (
    // Its height is the row's measure and its width follows the mark, as the shared header draws it.
    <img
      src={src}
      alt={decorative ? '' : logo.alt}
      height={height}
      style={{
        height,
        width: 'auto',
        maxWidth: (160 / 28) * height,
        objectFit: 'contain',
        // A logo with no dark variant keeps its own light ground in the dark appearance (D39).
        backgroundColor: mode === 'dark' && !logo.darkSrc ? 'var(--color-on-dark)' : undefined,
      }}
      onError={() => setFailed(src)}
    />
  );
}

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
 * One shell for every surface (D31, D39, D88, D112 item 1, D126 rule 7), the `shell-side-nav` template: Astryx owns
 * navigation, overlays and focus restoration. The rail is collapsible. Without a header connector the rail carries
 * the installation's identity: its heading is the installation's logo and name (D98) with the reminder bell, and the
 * foot holds the one Administration row (`useRail`) and the person, the last row, opening the settings (D39). An installation whose header connector answers (D88)
 * gets the shared header as Astryx's TopNav above the rail instead: the logo, the name, the bell and the person on the
 * band, the places the connector lists under them; the rail then has no heading of its own, so the identity is said
 * once. On a phone the shell draws the rail's heading, or the band's heading row, as its bar, and the places go into
 * the drawer with the rail.
 *
 * The person at the rail's foot is the link to their own page (D126 rule 1); their settings (D39: the appearance and
 * the way out) open over any page from the address (`?settings=1`, `settingsHref`), which their own page links to.
 * Nothing opens over a page otherwise (D126 rule 3): an address from before that opened a work item or a view over it
 * (a saved link, a toast in an older tab) is replaced by that thing's own page, with the page it lay over as the way
 * back (`panelRedirect`), before anything is painted.
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
  const logo = headerLogo(shared?.logo, branding.logo, mobile);
  // A system that does not answer is said where its content is missing, never at the top of the page (D116, amended
  // 2026-11-12); the first time it is seen silent in the session it is said once (4.1.3).
  useAnnounceSilentSources();
  // The phone's drawer closes when a row in it is chosen, unless the row opens something over it (`KeepNavigation`).
  const [navigationOpen, setNavigationOpen] = useState(false);
  const keepNavigation = useRef(false);
  const keep = useRef(() => {
    keepNavigation.current = true;
  }).current;
  const changeNavigation = (open: boolean) => {
    if (open || !keepNavigation.current) setNavigationOpen(open);
    keepNavigation.current = false;
  };
  useEffect(() => {
    setNavigationOpen(false);
  }, [location.key]);
  // An address from before D126 that opened a thing over the page leads to that thing's page (rule 3).
  const oldPanel = panelRedirect(location.pathname, location.search);
  useLayoutEffect(() => {
    if (oldPanel) navigate(oldPanel, { replace: true });
  }, [oldPanel]);
  const settingsOpen = new URLSearchParams(location.search).get(SETTINGS_PARAM) === '1';
  // Closed by replacing the address, so Back never opens the settings again.
  const closeSettings = () => {
    const q = new URLSearchParams(location.search);
    q.delete(SETTINGS_PARAM);
    const rest = q.toString();
    navigate({ search: rest ? `?${rest}` : '' }, { replace: true });
  };
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
    <SideNavHeading heading={siteName} headingHref="/" icon={<InstallationLogo logo={branding.logo} />} />
  );
  /** The person (board Shell): the last row at the rail's foot, the link to their own page; on the band where there is one. */
  const ownPage = personPageHref(user.id);
  const person = shared ? null : (
    <SideNavItem label={user.name} icon={UserCircleIcon} href={ownPage} isSelected={location.pathname === ownPage} />
  );
  const footer = nav.footer || person;
  return (
    <>
      <AppShell
        height={height}
        // `wash` (D126, amended 2026-11-16): the rail and the page stand on one ground, and the page is a sheet on it,
        // drawn by `PageFrame`. D88 had chosen `section`, one surface parted by a divider.
        variant="wash"
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
          <KeepNavigation.Provider value={keep}>
            <SideNav
              collapsible
              header={heading}
              topContent={nav.top}
              footer={
                footer ? (
                  <SideNavSection title="Konto" isHeaderHidden>
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
          </KeepNavigation.Provider>
        }
      >
        {children}
      </AppShell>
      {nav.overlay}
      {/* The settings (D39), the same composition as the band's person: the colour choice and the way out. */}
      <Dialog
        isOpen={settingsOpen}
        onOpenChange={open => {
          if (!open) closeSettings();
        }}
      >
        <DialogHeader
          title={user.name}
          onOpenChange={open => {
            if (!open) closeSettings();
          }}
        />
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
                closeSettings();
                void logout();
              }}
            />
            <Button label="Stäng" variant="primary" onClick={closeSettings} />
          </HStack>
        </VStack>
      </Dialog>
    </>
  );
}
