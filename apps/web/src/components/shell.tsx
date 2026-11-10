import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { SessionUser } from '@clew/contracts';
import {
  AppShell,
  Button,
  SideNav,
  SideNavItem,
  SideNavSection,
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
import { SiteHeader, SiteHeaderPerson, selectedItem, type SiteMenu } from '@clew/site-header';
import { useBranding } from '../branding';
import { headerQuery, threadsQuery } from '../queries';
import { useSourceBanner } from './source-banner';
import { api } from '../api';
import { ReminderBell } from './reminders';

/** AppShell moves the SideNav into a drawer below its `md` breakpoint (768 px); every phone decision in the app follows the same line. */
export const mobileQuery = '(max-width: 767px)';
/** 1.4.10: with 480 px or less in height nothing is pinned; the page scrolls as one. */
export const shortQuery = '(max-height: 480px)';
/** Until the installation's header has arrived: the site's name and Start, so the bar keeps its height and heading. */
const PENDING_MENU: SiteMenu = {
  version: 1,
  site: { name: 'Startsidan', href: '/' },
  items: [{ id: 'start', label: 'Start', href: '/' }],
};

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

export type Surface = 'start' | 'calendar' | 'staff' | 'admin';
/** What a surface puts in the rail: a create button on top, its sections (the places, then the conversations, D50) and the rows that stay at the foot. */
export interface ShellNav {
  top?: ReactNode;
  sections: ReactNode;
  footer?: ReactNode;
}
type Props = {
  user: SessionUser;
  nav: ShellNav;
  banner?: ReactNode;
  height?: 'fill' | 'auto';
  children: ReactNode;
};
/**
 * One shell for every surface (D31, D39, D88); Astryx owns navigation, overlays and focus restoration. The shared header
 * (`@clew/site-header`) is the top bar: the installation's logo and name, the reminder bell and the person on the band,
 * the places the person's header connector lists under them (D88), and the current place's own pages under the band. The rail keeps
 * Clew's own places and conversations. On a phone the shell draws the band's heading row as its bar and the places go
 * into the drawer with the rail.
 */
export function Shell({ user, nav, banner, height = 'fill', children }: Props) {
  const { mode, setMode, isPersistent } = useAppearance();
  const mobile = useMediaQuery(mobileQuery);
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
  // The connector's logo when it gives one, else the installation's own (D98).
  const logo = headerQ.data?.logo ?? branding.logo;
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
      // `section`: with a top bar Astryx paints the rail and the page on one surface and parts them with a divider (D88).
      variant="section"
      contentPadding={0}
      mobileNav={{ breakpoint: 'md' }}
      banner={
        banner || silent ? (
          <VStack gap={0}>
            {banner}
            {silent}
          </VStack>
        ) : undefined
      }
      topNav={
        <SiteHeader
          menu={menu}
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
      }
      sideNav={
        <SideNav
          topContent={nav.top}
          footer={
            nav.footer ? (
              <SideNavSection title="Alltid" isHeaderHidden>
                {nav.footer}
              </SideNavSection>
            ) : undefined
          }
        >
          {/* On a phone the header's places are rows in the drawer, since the bar holds only the heading there. Every row is a link to its address. */}
          {mobile ? (
            <SideNavSection title="Huvudmeny">
              {menu.items.map(item => (
                <SideNavItem key={item.id} label={item.label} href={item.href} isSelected={item.id === selected} />
              ))}
            </SideNavSection>
          ) : null}
          {nav.sections}
        </SideNav>
      }
    >
      {children}
    </AppShell>
  );
}
