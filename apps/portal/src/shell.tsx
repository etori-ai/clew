import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { SessionUser } from '@clew/contracts';
import { AppShell, Avatar, DropdownMenu, HStack, TopNav, TopNavHeading, TopNavItem, signOut, useToast } from '@clew/ui';
import { areasQuery } from '../../web/src/queries';
import { ReminderBell } from '../../web/src/components/reminders';
import { branding } from './branding';
import { viewHref } from './hrefs';

export type Current =
  { page: 'start' } | { page: 'activities' } | { page: 'tool'; capability: string } | { page: 'other' };
type Props = { user: SessionUser; current: Current; height?: 'fill' | 'auto'; children: ReactNode };

/**
 * The portal's shell (D67, the proof of concept's top bar): Astryx's `AppShell` with a `TopNav`, the municipal logo
 * and "Startsidan" as its heading, the places as items (Start, Mina aktiviteter, then every view an administrator put
 * in the menu, D40) and at the end the reminder bell (D39) and the person. The intranet's own sections are not drawn:
 * they are the intranet's, not Clew's (vision: not an intranet), and the row is left for the host to fill.
 */
export function PortalShell({ user, current, height = 'auto', children }: Props) {
  const menu = useQuery(areasQuery).data?.menu ?? [];
  const toast = useToast();
  const logo = branding.logo;
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
      mobileNav={false}
      topNav={
        <TopNav
          label="Huvudnavigation"
          heading={
            <TopNavHeading
              heading="Startsidan"
              headingHref="/"
              subheading={user.unitLabel}
              logo={
                logo ? (
                  // The same native image as the web app's header (D37/D38): the logo is an asset, not an icon.
                  <img
                    src={logo.src}
                    alt={logo.alt}
                    width={28}
                    height={28}
                    style={{ width: 28, height: 28, objectFit: 'contain' }}
                  />
                ) : undefined
              }
            />
          }
          startContent={
            <>
              <TopNavItem label="Start" href="/" isSelected={current.page === 'start'} />
              <TopNavItem label="Mina aktiviteter" href="/activities" isSelected={current.page === 'activities'} />
              {menu.map(entry => (
                <TopNavItem
                  key={entry.capability}
                  label={entry.label}
                  href={viewHref({ capability: entry.capability, title: entry.label })}
                  isSelected={current.page === 'tool' && current.capability === entry.capability}
                />
              ))}
            </>
          }
          endContent={
            <HStack gap={2} vAlign="center">
              <ReminderBell />
              <Avatar name={user.name} size="sm" tooltip={false} />
              <DropdownMenu
                button={{ label: `${user.name}, användarmeny`, children: user.name, variant: 'ghost', size: 'sm' }}
                items={[{ label: 'Logga ut', onClick: () => void logout() }]}
              />
            </HStack>
          }
        />
      }
    >
      {children}
    </AppShell>
  );
}
