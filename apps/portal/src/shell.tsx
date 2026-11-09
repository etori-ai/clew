import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { SessionUser } from '@clew/contracts';
import { AppShell, HStack, SideNav, SideNavItem, SideNavSection, signOut, useAppearance, useToast } from '@clew/ui';
import { SITE_HEADER_BREAKPOINT, SiteHeader, SiteHeaderPerson } from '@clew/site-header';
import { areasQuery } from '../../web/src/queries';
import { ReminderBell } from '../../web/src/components/reminders';
import { branding } from './branding';
import { viewHref } from './hrefs';
import { useSiteMenu } from './site-menu';

export type Current =
  { page: 'start' } | { page: 'activities' } | { page: 'tool'; capability: string } | { page: 'other' };
type Props = { user: SessionUser; current: Current; height?: 'fill' | 'auto'; children: ReactNode };

/**
 * The portal's shell (D67, D87). The top bar is the header the portal shares with the intranet (`@clew/site-header`):
 * the site's name, Start (the portal, always the current place here) and the intranet's sections, with the reminder
 * bell (D39) and the person at the end. It is drawn the same on the intranet's pages, so nothing of Clew's own goes in
 * it. Clew's own places (the start page, Mina aktiviteter, every view an administrator put in the menu, D40) are the
 * `SideNav`, Astryx's navigation for more than five places; below the header's breakpoint the shell moves both into its
 * drawer.
 */
export function PortalShell({ user, current, height = 'auto', children }: Props) {
  const menu = useQuery(areasQuery).data?.menu ?? [];
  const siteMenu = useSiteMenu();
  const toast = useToast();
  const appearance = useAppearance();
  const logout = async () => {
    try {
      await signOut();
    } catch (error) {
      toast({ type: 'error', body: error instanceof Error ? error.message : 'Kunde inte logga ut. Försök igen.' });
    }
  };
  return (
    <AppShell
      variant="section"
      height={height}
      contentPadding={6}
      mobileNav={{ breakpoint: SITE_HEADER_BREAKPOINT }}
      topNav={
        <SiteHeader
          menu={siteMenu}
          selected="start"
          logo={branding.logo}
          end={
            <HStack gap={2} vAlign="center">
              <ReminderBell />
              <SiteHeaderPerson
                name={user.name}
                onSignOut={() => void logout()}
                appearance={{ mode: appearance.mode, onChange: appearance.setMode }}
              />
            </HStack>
          }
        />
      }
      sideNav={
        <SideNav>
          <SideNavSection title={user.unitLabel || 'Startsidan'}>
            <SideNavItem label="Översikt" href="/" isSelected={current.page === 'start'} />
            <SideNavItem label="Mina aktiviteter" href="/activities" isSelected={current.page === 'activities'} />
            {menu.map(entry => (
              <SideNavItem
                key={entry.capability}
                label={entry.label}
                href={viewHref({ capability: entry.capability, title: entry.label })}
                isSelected={current.page === 'tool' && current.capability === entry.capability}
              />
            ))}
          </SideNavSection>
        </SideNav>
      }
    >
      {children}
    </AppShell>
  );
}
