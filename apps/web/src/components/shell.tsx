import type { ReactNode } from 'react';
import type { SessionUser } from '@clew/contracts';
import { AppShell, Button, HStack, Icon, Text, TopNav, TopNavHeading, TopNavItem, signOut, useMediaQuery } from '@clew/ui';

/** AppShell moves the SideNav into a drawer below its `md` breakpoint (768 px); every phone decision in the app follows the same line. */
export const mobileQuery = '(max-width: 767px)';
/** 1.4.10: with 480 px or less in height nothing is pinned; the page scrolls as one. */
export const shortQuery = '(max-height: 480px)';

export type Surface = 'start' | 'kalender' | 'admin';
type Props = {
  user: SessionUser;
  admin?: boolean;
  current: Surface;
  /** The assistant's own cap on interruptions, as one sentence; shown on a desktop, the digest carries it on a phone. */
  attention?: string;
  sideNav?: ReactNode;
  banner?: ReactNode;
  height?: 'fill' | 'auto';
  children: ReactNode;
};
/**
 * The one shell (D31): Astryx AppShell with a TopNav for identity, the surfaces and the way out, and whatever SideNav the
 * surface brings (the areas on the start page, the sections in Administration, none on the calendar). AppShell owns the
 * skip link, the main landmark and the phone drawer; the page heading starts inside `children`.
 */
export function Shell({ user, admin = false, current, attention, sideNav, banner, height = 'fill', children }: Props) {
  const mobile = useMediaQuery(mobileQuery);
  return <AppShell height={height} variant="section" contentPadding={0} mobileNav={{ breakpoint: 'md' }} banner={banner}
    topNav={<TopNav
      heading={<TopNavHeading heading="Startsidan" headingHref="/" subheading={mobile ? user.name : `${user.name} · ${user.unitLabel}`} />}
      startContent={<>
        <TopNavItem label="Kalender" href="/kalender" isSelected={current === 'kalender'} icon={<Icon icon="calendar" size="sm" />} />
        {admin && <TopNavItem label="Administration" href="/admin/anslutningar" isSelected={current === 'admin'} icon={<Icon icon="wrench" size="sm" />} />}
      </>}
      endContent={<HStack gap={2} vAlign="center">
        {!mobile && attention && <Text type="supporting">{attention}</Text>}
        <Button variant="ghost" size="sm" label="Logga ut" clickAction={() => signOut()} />
      </HStack>} />}
    sideNav={sideNav}>
    {children}
  </AppShell>;
}
