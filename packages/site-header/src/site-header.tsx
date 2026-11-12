import { use, useState, type AnchorHTMLAttributes, type ReactNode, type Ref } from 'react';
import { TopNav, TopNavHeading, TopNavItem } from '@astryxdesign/core/TopNav';
import { MobileNav } from '@astryxdesign/core/MobileNav';
import { SideNavItem, SideNavSection } from '@astryxdesign/core/SideNav';
import { Section } from '@astryxdesign/core/Section';
import { useAppShellMobile } from '@astryxdesign/core/AppShell';
import { Button } from '@astryxdesign/core/Button';
import { HStack } from '@astryxdesign/core/Layout';
import { Icon } from '@astryxdesign/core/Icon';
import { useMediaQuery } from '@astryxdesign/core/hooks';
import { DEFAULT_WIDTH_BREAKPOINTS, Theme, ThemeContext, type DefinedTheme } from '@astryxdesign/core/theme';
import { selectedItem, type SiteMenu, type SiteMenuItem } from './menu';

/**
 * Every link in the header is a whole-page load, whatever router the host has put behind Astryx's `LinkProvider`: the
 * header crosses sites (Clew's Start, the intranet's sections), so no host's client-side routing may catch it.
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
 * Below this Astryx width breakpoint the bar is compact and the places go into a drawer. `md` (768 px), the line every
 * phone decision in the web app follows (D88): the places have a row of their own under the heading, so the heading
 * row no longer has to hold them, and the row wraps when the installation has more places than fit.
 */
export const SITE_HEADER_BREAKPOINT = 'md' as const;

/** True below the header's breakpoint, for a host that draws its end controls more compactly there (the person as an avatar alone). */
export function useCompactSiteHeader(): boolean {
  return useMediaQuery(`(width < ${DEFAULT_WIDTH_BREAKPOINTS[SITE_HEADER_BREAKPOINT]}px)`);
}

/**
 * Whether the header is drawn dark: the mode of the nearest Astryx `Theme` (the web app's appearance choice, the
 * embed's own), and for `system` the system's setting, followed live. Astryx's `useTheme` resolves `system` once and
 * does not follow a change while the page is open, so the media query is read here.
 */
export function useDarkSiteHeader(): boolean {
  const mode = use(ThemeContext)?.mode ?? 'system';
  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)');
  return mode === 'dark' || (mode === 'system' && prefersDark);
}

/** The installation's logo (D38); `darkSrc` is the variant drawn on a dark ground (Sundsvall's white dragon). */
export type SiteHeaderLogo = Readonly<{ src: string; alt: string; darkSrc?: string }>;
export type SiteHeaderProps = Readonly<{
  menu: SiteMenu;
  /** The id of the top-level item the page belongs to; `aria-current="page"` and the selected style. */
  selected?: string | null;
  /** The page's address, so the row under the band marks the link that is the page. */
  location?: string | URL;
  logo?: SiteHeaderLogo | null;
  /** Under the site's name, as the web app shows the person's unit. */
  subheading?: string;
  /** The host's own controls at the end of the bar: the person, the bell, or "Logga in". */
  end?: ReactNode;
  /** The navigation landmark's name for the places. */
  label?: string;
  /**
   * The band (D88): the theme the heading row and the places are drawn in, `createHeaderBandTheme` from `@clew/ui/theme`.
   * Without it the bar keeps the page's surface, as the first build drew it.
   */
  band?: DefinedTheme;
}>;

/** The band around the heading row and the places: a nested Astryx `Theme` over a `Section`, which paints the theme's ground. */
function Band({ theme, children }: { theme: DefinedTheme | undefined; children: ReactNode }) {
  const mode = use(ThemeContext)?.mode ?? 'system';
  if (!theme) return <>{children}</>;
  return (
    <Theme theme={theme} mode={mode}>
      <Section variant="section" padding={0}>
        {children}
      </Section>
    </Theme>
  );
}

/** The links under the band: the current place's own pages, the one that is the page marked. */
function linksOf(menu: SiteMenu, selected: string | null, location: string | URL | undefined) {
  const place = menu.items.find(item => item.id === selected);
  const links = place?.children ?? [];
  const current = place && location && links.length ? selectedItem({ ...menu, items: links }, location) : null;
  return { place, links, current };
}

/**
 * The header Clew's web app and the intranet share (D87, D88), as the reference draws it: a band with the logo and the
 * site's name at the start and the host's controls at the end, the places as a row under them, and under the band a
 * row with the current place's own pages. Every row is Astryx's `TopNav`; the band is a nested `Theme`. Inside an
 * `AppShell` with mobile navigation the shell turns the bar into its compact phone bar below the breakpoint, so only
 * the heading row is drawn there and the host puts the places in the shell's drawer. Standing alone (the intranet's
 * page, where there is no shell), the header does the same with Astryx's `MobileNav` below the same breakpoint, as the
 * `MobileNavBasicMobileNav` block composes it, with the places and their pages in the drawer.
 */
export function SiteHeader({
  menu,
  selected = null,
  location,
  logo,
  subheading,
  end,
  label = 'Huvudmeny',
  band,
}: SiteHeaderProps) {
  const shell = useAppShellMobile();
  const narrow = useCompactSiteHeader();
  const [isOpen, setIsOpen] = useState(false);
  const [failedLogo, setFailedLogo] = useState<string | null>(null);
  const dark = useDarkSiteHeader();
  // On the band the ground is dark in both appearances, so the dark variant is the one to draw when there is one.
  const logoSrc = logo ? (band || dark ? (logo.darkSrc ?? logo.src) : logo.src) : undefined;
  const heading = (
    <TopNavHeading
      heading={menu.site.name}
      headingHref={menu.site.href}
      as={PageLink}
      subheading={subheading}
      logo={
        logo && logoSrc && logoSrc !== failedLogo ? (
          // The installation's logo as a native image, as D37/D38 allow in a navigation heading: an asset, not an icon.
          // Its height is the row's measure; its width follows the mark, a square dragon or a wide logotype alike.
          <img
            src={logoSrc}
            alt={logo.alt}
            height={28}
            style={{
              height: 28,
              width: 'auto',
              maxWidth: 160,
              objectFit: 'contain',
              // A logo with no dark variant keeps its own light ground on a dark bar, as the web app's rail did (D39).
              backgroundColor: (band || dark) && !logo.darkSrc ? 'var(--color-on-dark)' : undefined,
            }}
            onError={() => setFailedLogo(logoSrc)}
          />
        ) : undefined
      }
    />
  );
  const { place, links, current } = linksOf(menu, selected, location);
  const headingRow = <TopNav label={menu.site.name} heading={heading} endContent={end} />;

  // The shell's phone bar: the heading row alone, in the band; the host lists the places in the shell's drawer.
  if (shell.isMobileNavEnabled && shell.isMobile) return <Band theme={band}>{headingRow}</Band>;

  if (narrow && !shell.isMobileNavEnabled) {
    return (
      <>
        <Band theme={band}>
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
        </Band>
        <MobileNav isOpen={isOpen} onOpenChange={setIsOpen} header={menu.site.name}>
          <SideNavSection title={label} isHeaderHidden>
            {menu.items.map(item => (
              <PlaceRow key={item.id} item={item} selected={selected} current={current} />
            ))}
          </SideNavSection>
        </MobileNav>
      </>
    );
  }

  return (
    <>
      <Band theme={band}>
        {headingRow}
        <TopNav
          label={label}
          startContent={
            // A row of places wraps when the installation has more than fit on one line (1.4.10), as the reference does.
            <HStack gap={0} wrap="wrap" vAlign="center">
              {menu.items.map(item => (
                <TopNavItem
                  key={item.id}
                  label={item.label}
                  href={item.href}
                  as={PageLink}
                  isSelected={item.id === selected}
                />
              ))}
            </HStack>
          }
        />
      </Band>
      {place && links.length ? (
        <TopNav
          label={place.label}
          startContent={
            <HStack gap={0} wrap="wrap" vAlign="center">
              {links.map(link => (
                <TopNavItem
                  key={link.id}
                  label={link.label}
                  href={link.href}
                  as={PageLink}
                  isSelected={link.id === current}
                />
              ))}
            </HStack>
          }
        />
      ) : null}
    </>
  );
}

/** A place in a drawer: a row, and under it its own pages, open when the place is the current one. */
function PlaceRow({
  item,
  selected,
  current,
}: {
  item: SiteMenuItem;
  selected: string | null;
  current: string | null;
}) {
  if (!item.children?.length)
    return <SideNavItem label={item.label} href={item.href} as={PageLink} isSelected={item.id === selected} />;
  return (
    <SideNavItem
      label={item.label}
      href={item.href}
      as={PageLink}
      isSelected={item.id === selected}
      collapsible={{ defaultIsCollapsed: item.id !== selected }}
    >
      {item.children.map(link => (
        <SideNavItem key={link.id} label={link.label} href={link.href} as={PageLink} isSelected={link.id === current} />
      ))}
    </SideNavItem>
  );
}
