import { use, useState, type AnchorHTMLAttributes, type ReactNode, type Ref } from 'react';
import { TopNav, TopNavHeading, TopNavItem } from '@astryxdesign/core/TopNav';
import { MobileNav } from '@astryxdesign/core/MobileNav';
import { SideNavItem, SideNavSection } from '@astryxdesign/core/SideNav';
import { useAppShellMobile } from '@astryxdesign/core/AppShell';
import { Button } from '@astryxdesign/core/Button';
import { HStack } from '@astryxdesign/core/Layout';
import { Icon } from '@astryxdesign/core/Icon';
import { useMediaQuery } from '@astryxdesign/core/hooks';
import { DEFAULT_WIDTH_BREAKPOINTS, ThemeContext } from '@astryxdesign/core/theme';
import type { SiteMenu } from './menu';

/**
 * Every link in the header is a whole-page load, whatever router the host has put behind Astryx's `LinkProvider`: the
 * header crosses sites (the portal's Start, the intranet's sections), so no host's client-side routing may catch it.
 */
function PageLink({
  ref,
  to: _to,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & { ref?: Ref<HTMLAnchorElement>; to?: string }) {
  // Astryx hands a custom link both `href` and a router's `to`; an anchor needs only the first.
  return <a ref={ref} {...props} />;
}

/**
 * Below this Astryx width breakpoint the bar is compact and the places go into a drawer. `xl` (1280 px), not the
 * shell's default `md`: the logo, five places with the intranet's long section names and the person need about
 * 1 100 px on one line (measured 2026-11-09), and at 1 024 px two items wrap onto two lines. A host that wraps the
 * header in an `AppShell` gives the shell the same breakpoint so both sites switch together. Section names come from
 * the intranet and vary; an overflow menu would fit them better than a fixed width (D87, open).
 */
export const SITE_HEADER_BREAKPOINT = 'xl' as const;

/** True below the header's breakpoint, for a host that draws its end controls more compactly there (the person as an avatar alone). */
export function useCompactSiteHeader(): boolean {
  return useMediaQuery(`(width < ${DEFAULT_WIDTH_BREAKPOINTS[SITE_HEADER_BREAKPOINT]}px)`);
}

/** The installation's logo (D38); `darkSrc` is the variant drawn on a dark bar (Sundsvall's white dragon). */
/**
 * Whether the header is drawn dark: the mode of the nearest Astryx `Theme` (the portal's appearance choice, the embed's
 * own), and for `system` the system's setting, followed live. Astryx's `useTheme` resolves `system` once and does not
 * follow a change while the page is open, so the media query is read here.
 */
export function useDarkSiteHeader(): boolean {
  const mode = use(ThemeContext)?.mode ?? 'system';
  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)');
  return mode === 'dark' || (mode === 'system' && prefersDark);
}

export type SiteHeaderLogo = Readonly<{ src: string; alt: string; darkSrc?: string }>;
export type SiteHeaderProps = Readonly<{
  menu: SiteMenu;
  /** The id of the top-level item the page belongs to; `aria-current="page"` and the selected style. */
  selected?: string | null;
  logo?: SiteHeaderLogo | null;
  /** Under the site's name, as the portal shows the person's unit. */
  subheading?: string;
  /** The host's own controls at the end of the bar: the person, the bell, or "Logga in". */
  end?: ReactNode;
  /** The navigation landmark's name. */
  label?: string;
}>;

/**
 * The header Clew's portal and the intranet share (D87): Astryx's `TopNav` with the logo and the site's name as its
 * heading, the menu's top level as items and the host's controls at the end. Inside an `AppShell` with mobile
 * navigation, the shell turns the bar into its compact phone bar and moves the items into its drawer. Standing alone
 * (the intranet's page, where there is no shell), the header does the same with Astryx's `MobileNav` below the same
 * breakpoint (`SITE_HEADER_BREAKPOINT`), as the `MobileNavBasicMobileNav` block composes it.
 */
export function SiteHeader({ menu, selected = null, logo, subheading, end, label = 'Huvudmeny' }: SiteHeaderProps) {
  const shell = useAppShellMobile();
  const narrow = useCompactSiteHeader();
  const [isOpen, setIsOpen] = useState(false);
  const dark = useDarkSiteHeader();
  const heading = (
    <TopNavHeading
      heading={menu.site.name}
      headingHref={menu.site.href}
      as={PageLink}
      subheading={subheading}
      logo={
        logo ? (
          // The installation's logo as a native image, as D37/D38 allow in a navigation heading: an asset, not an icon.
          <img
            src={dark && logo.darkSrc ? logo.darkSrc : logo.src}
            alt={logo.alt}
            width={28}
            height={28}
            style={{
              width: 28,
              height: 28,
              objectFit: 'contain',
              // A logo with no dark variant keeps its own light ground on a dark bar, as the web app's rail does (D39).
              backgroundColor: dark && !logo.darkSrc ? 'var(--color-on-dark)' : undefined,
            }}
          />
        ) : undefined
      }
    />
  );

  if (narrow && !shell.isMobileNavEnabled) {
    return (
      <>
        <TopNav
          label={label}
          heading={heading}
          endContent={
            <HStack gap={2} vAlign="center">
              {end}
              <Button
                label="Meny"
                icon={<Icon icon="menu" color="inherit" />}
                variant="ghost"
                aria-expanded={isOpen}
                onClick={() => setIsOpen(true)}
              />
            </HStack>
          }
        />
        <MobileNav isOpen={isOpen} onOpenChange={setIsOpen} header={menu.site.name}>
          <SideNavSection title={label} isHeaderHidden>
            {menu.items.map(item => (
              <SideNavItem
                key={item.id}
                label={item.label}
                href={item.href}
                as={PageLink}
                isSelected={item.id === selected}
              />
            ))}
          </SideNavSection>
        </MobileNav>
      </>
    );
  }

  return (
    <TopNav
      label={label}
      heading={heading}
      startContent={menu.items.map(item => (
        <TopNavItem key={item.id} label={item.label} href={item.href} as={PageLink} isSelected={item.id === selected} />
      ))}
      endContent={end}
    />
  );
}
