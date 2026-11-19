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
  Text,
  VStack,
  signOut,
  useAppearance,
  useToast,
  HStack,
} from '@clew/ui';
import { createHeaderBandTheme } from '@clew/ui/theme';
import { SiteHeader, SiteHeaderPerson, selectedItem, type SiteMenu } from '@clew/site-header';
import { useBranding } from '../../branding';
import { headerQuery, threadsQuery } from '../../queries';
import { useAnnounceSilentSources } from './silent-sources';
import { api } from '../../api';
import { ReminderBell } from './reminders';
import { cardOverPage, panelRedirect } from '../../panel-address';
import { DELIVERY_TOAST, deliveryToast, withArrivals, type Arrival } from '../../delivery-toast';
import type { ShellNav } from './nav';
import { AssistantCorner } from './assistant-corner';
import { pageLocation, usePublishPageLocation } from '../../page-location';
import { useFocusOnTheWayBack } from '../../way-back';

export { mobileQuery, shortQuery } from '../../media';
/** The installation's name in the header until the header's own answer has said it. */
export const SITE_NAME = 'Startsidan';
/** Until the installation's header has arrived: the site's name, so the bar keeps its heading. */
export const PENDING_MENU: SiteMenu = {
  version: 1,
  site: { name: SITE_NAME, href: '/' },
  items: [],
};
/** Hem among Clew's own pages, where no header connector lists a Start of its own (D130). */
export const START_PAGE = { id: 'start', label: 'Start', href: '/' } as const;
/** The width the header's rows and every page's column are bounded to (D130: the reference bounds both to 1280 px). */
export const SHELL_WIDTH = 1280;
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

type Props = {
  user: SessionUser;
  nav: ShellNav;
  banner?: ReactNode;
  height?: 'fill' | 'auto';
  children: ReactNode;
};
/**
 * One shell for every surface (D31, D39, D88, D130): Astryx owns navigation, overlays and focus restoration. There is
 * no rail, as the startsidan prototype has none. The shared header (`@clew/site-header`) is the top bar on every page:
 * the installation's logo and name with the search, the reminder bell and the person on the band, the places the
 * header connector lists under them (D88), and under the band Clew's own pages, which `nav` carries. Where no
 * connector answers the band is the heading row alone, and Start stands first among Clew's pages. On a phone the header folds the places and those pages into its own "Meny".
 *
 * The person on the band opens their settings (D39: the appearance and the way out); the same settings open over any
 * page from the address (`?settings=1`, `settingsHref`), which the person's own page links to. Nothing opens over a
 * page otherwise (D126 rule 3): an address from before that opened a work item or a view over it (a saved link, a toast
 * in an older tab) is replaced by that thing's own page, with the page it lay over as the way back (`panelRedirect`),
 * before anything is painted.
 */
export function Shell({ user, nav, banner, height = 'fill', children }: Props) {
  const { mode, setMode, isPersistent } = useAppearance();
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
  // A header connector's answer is the band's places (D88); without one the band holds Start alone (D130).
  const shared = headerQ.data?.source ? headerQ.data : null;
  // Without a header connector the band has no places of its own to list, so it is the heading row alone and Start
  // stands first among Clew's pages in the row under it (D130, Oliver Borgström 2026-11-18). With a connector the band
  // lists the connector's places, Start among them, as the intranet draws its header.
  const menu = shared ? shared.menu : { ...(headerQ.data?.menu ?? PENDING_MENU), items: [] };
  const pages = shared ? nav.pages : [START_PAGE, ...nav.pages];
  const currentPage = nav.current ?? (!shared && location.pathname === '/' ? START_PAGE.id : null);
  const here = window.location.origin + location.pathname + location.search;
  const selected = selectedItem(menu, here);
  // The band's theme (D88) is the installation's (D98), built once per saved theme.
  const branding = useBranding();
  const bandTheme = useMemo(() => createHeaderBandTheme(branding), [branding]);
  const logo = headerLogo(shared?.logo, branding.logo, false);
  // A system that does not answer is said where its content is missing, never at the top of the page (D116, amended
  // 2026-11-12); the first time it is seen silent in the session it is said once (4.1.3).
  useAnnounceSilentSources();
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
  // What the one delivery toast is saying while it is drawn; empty again once it has left.
  const arrivals = useRef<Arrival[]>([]);
  useEffect(() => {
    const fresh = (threadsQ.data?.deliveries ?? []).flatMap(delivery => {
      if (deliveryAttempts.current.has(delivery.id)) return [];
      const thread = threadsQ.data?.threads.find(t => t.id === delivery.threadId);
      if (!thread) return [];
      deliveryAttempts.current.add(delivery.id);
      return [{ delivery, thread }];
    });
    if (!fresh.length) return;
    // Everything one read brought is claimed first and said once: one toast and one announcement, however many came.
    void Promise.all(
      fresh.map(({ delivery, thread }) =>
        api.claimDelivery(delivery.id).then(
          ({ claimed }): Arrival | null =>
            claimed ? { threadId: thread.id, title: thread.title, kind: delivery.kind } : null,
          () => {
            deliveryAttempts.current.delete(delivery.id);
            return null;
          },
        ),
      ),
    ).then(claimed => {
      if (!deliveryMounted.current) return;
      const arrived = claimed.filter(
        (a): a is Arrival => a !== null && !!deliveryContext.current?.threads.some(t => t.id === a.threadId),
      );
      if (!arrived.length) return;
      arrivals.current = withArrivals(arrivals.current, arrived);
      const { body, threadId } = deliveryToast(arrivals.current);
      // It leaves by itself (Astryx holds it while it is pointed at, focused or the window is away): what it says
      // stays in Att göra and under Påminnelser in the bell. A later delivery replaces it in place (`uniqueID`).
      const dismiss = toast({
        body,
        uniqueID: DELIVERY_TOAST,
        onHide: () => {
          arrivals.current = [];
        },
        endContent: (
          <Button
            size="sm"
            variant="ghost"
            label="Visa"
            onClick={() => {
              // Over the page the person is on when they press it, which need not be the one that raised the toast.
              const { pathname, search } = pageLocation();
              navigate(threadId ? cardOverPage(pathname, search, threadId) : '/todo');
              dismiss();
            }}
          />
        ),
      });
    });
  }, [threadsQ.data, toast, navigate]);
  const logout = async () => {
    try {
      await signOut();
    } catch (error) {
      toast({ type: 'error', body: error instanceof Error ? error.message : 'Kunde inte logga ut. Försök igen.' });
    }
  };
  return (
    <>
      <AppShell
        height={height}
        // `wash`: the page stands on the body colour, so a card on its own colour reads as a card (D130).
        variant="wash"
        contentPadding={0}
        // No drawer of the shell's: without a rail the header's own "Meny" lists the places and Clew's pages on a phone.
        mobileNav={false}
        banner={banner}
        topNav={
          <SiteHeader
            menu={menu}
            selected={selected}
            location={here}
            logo={logo}
            band={bandTheme}
            contentWidth={SHELL_WIDTH}
            pages={pages}
            currentPage={currentPage}
            pagesEnd={nav.end}
            pagesLabel="Mina sidor"
            end={
              <HStack gap={2} vAlign="center">
                {nav.search}
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
        }
      >
        {children}
        {/* The floating way to the assistant (D130 item 14), on every page but a conversation's, which has its box. */}
        {location.pathname.startsWith('/conversations') ? null : <AssistantCorner />}
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
