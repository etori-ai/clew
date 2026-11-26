import { createContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { SITE_NAME_DEFAULT, type SessionUser, type SiteHeaderView } from '@clew/contracts';
import { AppShell, Button, signOut, useAppearance, useMediaQuery, useToast, HStack } from '@clew/ui';
import type { HeaderLogo } from '@clew/ui/branding';
import { createHeaderBandTheme, logoPlate } from '@clew/ui/theme';
import {
  SiteHeader,
  SiteHeaderPerson,
  selectedItem,
  useCompactSiteHeader,
  useDarkSiteHeader,
  type SiteHeaderLogo,
  type SiteMenu,
} from '@clew/site-header';
import { useBranding } from '../../branding';
import { errorMessage } from '../../query-policy';
import { headerQuery, threadsQuery } from '../../queries';
import { useAnnounceSilentSources } from './silent-sources';
import { useAccountReturn, useAccounts, useFollowAccounts } from '../accounts/account-lines';
import { ACCOUNTS_PATH, ACCOUNTS_TITLE } from '../../linked-accounts';
import { api } from '../../api';
import { ReminderBell } from './reminders';
import { cardOverPage, panelRedirect } from '../../panel-address';
import { personPageHref } from '../../person-address';
import { DELIVERY_TOAST, deliveryToast, withArrivals, type Arrival } from '../../delivery-toast';
import { START_PAGE_ID, type ShellNav } from './nav';
import { WithAssistantCorner } from './assistant-corner';
import { pageLocation, usePublishPageLocation } from '../../page-location';
import { useFocusOnTheWayBack } from '../../way-back';
import { unitsLine, unitsList } from '../../user-units';

export { mobileQuery, shortQuery } from '../../media';
/**
 * The band where no header connector gives it (D88, D130): the installation's name as it is saved (D98), read from the
 * appearance the browser holds, so a name an administrator saves is on the band at once, and no places of its own.
 */
export const ownMenu = (name: string): SiteMenu => ({ version: 1, site: { name, href: '/' }, items: [] });
/**
 * The site's name as the header says it, for what a page draws with it (its trail, its closing line): a header
 * connector's site, else the installation's name. A context and not a query: a page frame is also drawn before the
 * session is known (`FirstLoad`), outside the query client.
 */
export const SiteName = createContext<string>(SITE_NAME_DEFAULT);
/**
 * The page the row "Mina sidor" marks as the current one: its name there ("Att göra") and whether the address is that
 * page's own (`/calendar` for Kalender, whose title is the week). Null where the row marks none or a tool of the
 * "Verktyg" menu. The page frame reads it: a page that is the row's own page opens with no trail, since the row right
 * above already says where the person is (D130 item 17 as amended 2026-11-21).
 */
export const RowPage = createContext<{ label: string; own: boolean } | null>(null);
/** Hem among Clew's own pages, where no header connector lists a Start of its own (D130). */
export const START_PAGE = { id: START_PAGE_ID, label: 'Start', href: '/' } as const;
/** The width the header's rows and every page's column are bounded to (D130: the reference bounds both to 1280 px). */
export const SHELL_WIDTH = 1280;
/** A connector supplies the mark for its dark band (D88), while an installation can supply a variant for each ground (D98). */
export function headerLogo(shared: SiteHeaderView['logo'] | undefined, own: HeaderLogo | null): SiteHeaderLogo | null {
  return shared ? { ...shared, ground: 'dark' } : own;
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
  logo: HeaderLogo | null;
  height?: number;
  decorative?: boolean;
}) {
  const darkSurface = useDarkSiteHeader();
  const forcedColors = useMediaQuery('(forced-colors: active)');
  const [failed, setFailed] = useState<string | null>(null);
  const darkArtworkGround = darkSurface && !!logo?.darkSrc;
  const src = darkArtworkGround ? logo?.darkSrc : logo?.src;
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
        backgroundColor: logoPlate(darkArtworkGround, darkSurface, forcedColors),
        forcedColorAdjust: 'none',
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
 * The person on the band is the one way to their settings (D39, amended 2026-11-23: the appearance and the way out),
 * which open under the person, a low sheet on a touch phone, on every page alike. Nothing opens over a
 * page otherwise (D126 rule 3): an address from before that opened a work item or a view over it (a saved link, a toast
 * in an older tab) is replaced by that thing's own page, with the page it lay over as the way back (`panelRedirect`),
 * before anything is painted.
 */
export function Shell({ user, nav, banner, height = 'fill', children }: Props) {
  const { mode, setMode, isPersistent } = useAppearance();
  const compactHeader = useCompactSiteHeader();
  // D135: every unit of a person who holds more than one, the primary one first; their one unit otherwise.
  const units = unitsList(user);
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
  // The band's theme (D88) is the installation's (D98), built once per saved theme.
  const branding = useBranding();
  // Without a header connector the band has no places of its own to list, so it is the heading row alone and Start
  // stands first among Clew's pages in the row under it (D130, Oliver Borgström 2026-11-18). With a connector the band
  // lists the connector's places, Start among them, as the intranet draws its header.
  const menu = shared ? shared.menu : ownMenu(branding.name);
  const pages = shared ? nav.pages : [START_PAGE, ...nav.pages];
  // With a connector Start is a place of the band, not a page of the row, so nothing of the row is marked on Hem.
  const currentPage = nav.current;
  const marked = pages.find(p => p.id === currentPage && !('more' in p && p.more));
  const rowPage = useMemo(
    () => (marked ? { label: marked.label, own: marked.href.split('?')[0] === location.pathname } : null),
    [marked?.label, marked?.href, location.pathname],
  );
  const here = window.location.origin + location.pathname + location.search;
  const selected = selectedItem(menu, here);
  const bandTheme = useMemo(() => createHeaderBandTheme(branding), [branding]);
  const logo = headerLogo(shared?.logo, branding.logo);
  // A system that does not answer is said where its content is missing, never at the top of the page (D116, amended
  // 2026-11-12); the first time it is seen silent in the session it is said once (4.1.3).
  useAnnounceSilentSources();
  // Linked accounts (D147): what happened at a system the person comes back from is said once, and the list follows
  // the cards' read. The person's menu leads to the list only when there is a system to list.
  useAccountReturn();
  useFollowAccounts();
  const linkable = useAccounts().accounts.length > 0;
  // An address from before D126 that opened a thing over the page leads to that thing's page (rule 3).
  const oldPanel = panelRedirect(location.pathname, location.search);
  useLayoutEffect(() => {
    if (oldPanel) navigate(oldPanel, { replace: true });
  }, [oldPanel]);
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
      // A refused reply and a dropped connection alike: Clew's words, never the browser's (L12 of the web review).
      toast({ type: 'error', body: errorMessage(error, 'Utloggningen kunde inte bekräftas. Försök igen.') });
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
            hostNavigation={{ homeHref: START_PAGE.href, locationKey: location.key }}
            logo={logo}
            band={bandTheme}
            contentWidth={SHELL_WIDTH}
            pages={pages}
            currentPage={currentPage}
            pagesEnd={nav.end}
            pagesLabel="Mina sidor"
            end={
              // On a phone the band's marks stand edge to edge, each its own 44 px target (`SiteHeader`).
              <HStack gap={compactHeader ? 0 : 2} vAlign="center">
                {nav.search}
                <ReminderBell />
                <SiteHeaderPerson
                  name={user.name}
                  // D135: the band says the first unit and how many more; the settings under it name every one.
                  description={unitsLine(user)}
                  detail={units}
                  onSignOut={() => void logout()}
                  appearance={{ mode, onChange: setMode, isPersistent }}
                  // The person's own page (D126 rule 1): with no rail, the band's person is the shell's way to it.
                  pageHref={personPageHref(user.id)}
                  ways={linkable ? [{ label: ACCOUNTS_TITLE, href: ACCOUNTS_PATH }] : undefined}
                />
              </HStack>
            }
          />
        }
      >
        {/* The floating way to the assistant (D130 item 14) stands over the page, where the page leaves it room. */}
        <WithAssistantCorner>
          <SiteName.Provider value={menu.site.name}>
            <RowPage.Provider value={rowPage}>{children}</RowPage.Provider>
          </SiteName.Provider>
        </WithAssistantCorner>
      </AppShell>
      {nav.overlay}
    </>
  );
}
