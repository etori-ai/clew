import type { ReactNode } from 'react';
import type { SessionUser } from '@clew/contracts';
import { AppShell, SideNav, SideNavHeading, SideNavItem, SideNavSection, signOut } from '@clew/ui';

/** AppShell moves the SideNav into a drawer below its `md` breakpoint (768 px); every phone decision in the app follows the same line. */
export const mobileQuery = '(max-width: 767px)';
/** 1.4.10: with 480 px or less in height nothing is pinned; the page scrolls as one. */
export const shortQuery = '(max-height: 480px)';
/** The overview's rail folds under the groups below this width, as the `dashboard-alert-rail` template folds its rail. */
export const narrowQuery = '(max-width: 1023px)';

export type Surface = 'start' | 'kalender' | 'admin';
/** What a surface puts in the rail: a create button on top, its own sections, and the rows that stay at the foot. */
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
 * The one shell (D31, D34), after the Astryx `shell-side-nav` template and the canvas's rows five and six: no TopNav.
 * The rail carries everything that frames the page: the product and the person at the top (SideNavHeading), what the
 * surface brings in the middle, and at the foot the surfaces that are always there and the way out. Below the `md`
 * breakpoint AppShell turns the rail into its own top bar (the heading and a menu button) and the rest into the drawer,
 * which is the phone header on the canvas. AppShell owns the skip link, the main landmark and the drawer's focus; the
 * page heading starts inside `children`.
 */
export function Shell({ user, nav, banner, height = 'fill', children }: Props) {
  return <AppShell height={height} variant="elevated" contentPadding={0} mobileNav={{ breakpoint: 'md' }} banner={banner}
    sideNav={<SideNav
      header={<SideNavHeading heading="Startsidan" headingHref="/" subheading={`${user.name} · ${user.unitLabel}`} />}
      topContent={nav.top}
      footer={<SideNavSection title="Alltid" isHeaderHidden>
        {nav.footer}
        <SideNavItem label="Logga ut" onClick={() => void signOut()} />
      </SideNavSection>}>
      {nav.sections}
    </SideNav>}>
    {children}
  </AppShell>;
}
