import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { SessionUser } from '@clew/contracts';
import {
  AppShell,
  Button,
  Divider,
  HStack,
  Icon,
  Section,
  StackItem,
  Text,
  Theme,
  TopNav,
  VStack,
  signOut,
  useAppearance,
  useToast,
} from '@clew/ui';
import { createHeaderBandTheme } from '@clew/ui/theme';
import { SiteHeader, SiteHeaderPerson, selectedItem, type SiteMenu } from '@clew/site-header';
import { useBranding } from '../branding';
import { headerQuery, threadsQuery } from '../queries';
import { useSourceBanner } from './source-banner';
import { api } from '../api';
import { ReminderBell } from './reminders';
import type { ShellNav } from './nav';
import { AssistantCorner } from './assistant-corner';
import type { ComposerAbout } from './composer';

/** The header folds its places into "Meny" below `md` (768 px); every phone decision in the app follows the same line. */
export const mobileQuery = '(max-width: 767px)';
/** 1.4.10: with 480 px or less in height nothing is pinned; the page scrolls as one. */
export const shortQuery = '(max-height: 480px)';
/** Until the installation's header has arrived: the site's name and Start, so the bar keeps its height and heading. */
const PENDING_MENU: SiteMenu = {
  version: 1,
  site: { name: 'Startsidan', href: '/' },
  items: [{ id: 'start', label: 'Start', href: '/' }],
};

type Props = {
  user: SessionUser;
  nav: ShellNav;
  banner?: ReactNode;
  height?: 'fill' | 'auto';
  /**
   * A full-window mode (D115 item 5: Min AI): the header is one narrow bar in the band's colours with the way back to
   * the start page, the mode's name and the person, instead of the places and Clew's pages.
   */
  focus?: { title: string } | undefined;
  /**
   * The floating "Fråga AI" and its panel (D115 item 5), on every page that has no box of its own: `false` where the
   * page has one (the start page, Min AI), or what the page shows, which a question asked here is then about.
   */
  assistant?: boolean | ComposerAbout;
  children: ReactNode;
};
/**
 * One shell for every surface (D31, D39, D88, D115); Astryx owns navigation, overlays and focus restoration. The
 * shared header (`@clew/site-header`) is the top bar: the installation's logo and name, the reminder bell and the
 * person on the band, the places the person's header connector lists under them (D88), and under the band Clew's own
 * pages, which `nav` carries (D115 item 3). There is no rail. On a phone the header folds the places and those pages
 * into its own "Meny".
 */
export function Shell({ user, nav, banner, height = 'fill', focus, assistant = true, children }: Props) {
  const { mode, setMode, isPersistent } = useAppearance();
  const toast = useToast();
  const location = useLocation(),
    navigate = useNavigate();
  const deliveryAttempts = useRef(new Set<string>());
  // The same session-scoped cache as the start page carries reminder cards and pending delivery claims.
  const threadsQ = useQuery(threadsQuery);
  // The header is public and the same for everyone; a save on Sidhuvud invalidates it for the administrator at once.
  const headerQ = useQuery(headerQuery);
  const menu = headerQ.data?.menu ?? PENDING_MENU;
  const here = window.location.origin + location.pathname + location.search;
  const selected = selectedItem(menu, here);
  // The band's theme (D88) is the installation's (D98), built once per saved theme.
  const branding = useBranding();
  const bandTheme = useMemo(() => createHeaderBandTheme(branding), [branding]);
  // The connector's logo when it gives one, else the installation's own (D98). A connector gives one image, and it is
  // the header's own: drawn on the band as it is. Naming it as its own dark variant keeps the header from laying a
  // light ground under it, which it does for an installation's logo that has no variant for a dark bar.
  const logo = headerQ.data?.logo ? { ...headerQ.data.logo, darkSrc: headerQ.data.logo.src } : branding.logo;
  // A system that does not answer is said at the top of every page (D8, D71 artboard 8), under the page's own banner.
  const silent = useSourceBanner();
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
            body: delivery.kind === 'reminder' ? 'Påminnelse: ' + thread.title : 'Nya uppgifter finns på Hem.',
            isAutoHide: false,
            uniqueID: delivery.id,
            endContent: (
              <Button
                size="sm"
                variant="ghost"
                label="Visa"
                onClick={() => {
                  navigate('/?card=' + encodeURIComponent(thread.id));
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
  return (
    <AppShell
      height={height}
      // `wash`: the page stands on the body colour, so a card on its own colour reads as a card (D115 item 2).
      variant="wash"
      contentPadding={0}
      // No drawer of the shell's: without a rail the header's own "Meny" lists the places and Clew's pages on a phone.
      mobileNav={false}
      banner={
        banner || silent ? (
          <VStack gap={0}>
            {banner}
            {silent}
          </VStack>
        ) : undefined
      }
      topNav={
        focus ? (
          // The band's theme around one row, as the shared header nests it (D88): the way back, a rule, the mode's
          // name, and the person at the end.
          <Theme theme={bandTheme} mode={mode}>
            <Section variant="section" padding={0}>
              <TopNav
                label={focus.title}
                startContent={
                  <HStack gap={3} vAlign="center">
                    <Button
                      variant="ghost"
                      size="sm"
                      label="Startsidan"
                      icon={<Icon icon="chevronLeft" color="inherit" />}
                      href="/"
                    />
                    <StackItem aria-hidden>
                      <Divider orientation="vertical" />
                    </StackItem>
                    {/* The mode's name, not a heading: the page's own title is the first heading under the bar. */}
                    <Text type="large" weight="bold">
                      {focus.title}
                    </Text>
                  </HStack>
                }
                endContent={
                  <SiteHeaderPerson
                    name={user.name}
                    description={user.unitLabel}
                    onSignOut={() => void logout()}
                    appearance={{ mode, onChange: setMode, isPersistent }}
                  />
                }
              />
            </Section>
          </Theme>
        ) : (
          <SiteHeader
            menu={menu}
            selected={selected}
            location={here}
            logo={logo}
            band={bandTheme}
            contentWidth={1280}
            // Clew's own pages stand under Start, the place every address of the web app belongs to.
            pages={selected === 'start' ? nav.pages : undefined}
            currentPage={nav.current}
            pagesEnd={nav.end}
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
        )
      }
    >
      {children}
      {assistant && !focus ? <AssistantCorner about={assistant === true ? undefined : assistant} /> : null}
    </AppShell>
  );
}
