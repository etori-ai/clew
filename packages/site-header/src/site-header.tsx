import { use, useEffect, useMemo, useState, type AnchorHTMLAttributes, type ReactNode, type Ref } from 'react';
import { TopNav, TopNavHeading, TopNavItem } from '@astryxdesign/core/TopNav';
import { MobileNav } from '@astryxdesign/core/MobileNav';
import { SideNavItem, SideNavSection } from '@astryxdesign/core/SideNav';
import { Section } from '@astryxdesign/core/Section';
import { useAppShellMobile } from '@astryxdesign/core/AppShell';
import { Button } from '@astryxdesign/core/Button';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Icon } from '@astryxdesign/core/Icon';
import { Badge } from '@astryxdesign/core/Badge';
import { VisuallyHidden } from '@astryxdesign/core/VisuallyHidden';
import { useMediaQuery } from '@astryxdesign/core/hooks';
import { DEFAULT_WIDTH_BREAKPOINTS, Theme, ThemeContext, type DefinedTheme } from '@astryxdesign/core/theme';
import { isDarkHeaderBand, logoPlate } from '@clew/ui/theme';
import { selectedItem, type SiteMenu, type SiteMenuItem } from './menu';

/**
 * A place owned by another site loads its document, even when the intranet shares the host's origin.
 */
function PageLink({
  ref,
  to: _to,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & { ref?: Ref<HTMLAnchorElement>; to?: string }) {
  // Astryx hands a custom link both `href` and a router's `to`; an anchor needs only the first.
  return <a ref={ref} {...props} />;
}

/** The host router owns its home address, which a connector may give as an absolute URL. */
function bandLink(href: string, home: URL | undefined) {
  if (home && URL.canParse(href, home) && new URL(href, home).href === home.href) {
    return { href: home.pathname + home.search + home.hash };
  }
  return { href, as: PageLink };
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

/**
 * A page of the host's own under the selected place (D130): the web app's tools under Start. `more` keeps a page out of
 * the row on a wide window, where the host offers it another way (`pagesEnd`); a drawer lists every page.
 */
export type SiteHeaderPage = Readonly<{
  id: string;
  label: string;
  href: string;
  more?: boolean;
  /** How much waits on the page (Att göra's count), drawn after the label; `countLabel` says what it counts to a screen reader. */
  count?: number;
  countLabel?: string;
}>;
/** An installation supplies a logo for light ground and optionally one for dark. A header connector supplies its dark-ground mark (D88). */
export type SiteHeaderLogo = Readonly<
  { src: string; alt: string } & ({ ground?: 'light'; darkSrc?: string } | { ground: 'dark'; darkSrc?: never })
>;
export type SiteHeaderProps = Readonly<{
  menu: SiteMenu;
  /** The id of the top-level item the page belongs to; `aria-current="page"` and the selected style. */
  selected?: string | null;
  /** The page's address, so the row under the band marks the link that is the page. */
  location?: string | URL;
  /** The host's routed home and the current history entry. A same-tab navigation closes the drawer. */
  hostNavigation?: Readonly<{ homeHref: string; locationKey: string }>;
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
  /**
   * The host's own pages under the selected place (D130), drawn in the row under the band in place of the pages the
   * menu lists for it. Like the host's home, they go through its router (Astryx's `LinkProvider`).
   */
  pages?: readonly SiteHeaderPage[];
  /** The id of the page among `pages` that is the current one. */
  currentPage?: string | null;
  /** What the host puts at the end of that row on a wide window: a menu with the pages marked `more`. */
  pagesEnd?: ReactNode;
  /** The navigation landmark's name for the host's own pages; the site's name when not given. */
  pagesLabel?: string;
  /**
   * The width the rows' content is bounded to and centred in, gutters included, so the header stands on the same lines
   * as the page under it (D130: the reference bounds both to 1280 px). The band and the row under it still
   * paint the whole width.
   */
  contentWidth?: number;
}>;

/** A row's content on the page's own lines: bounded and centred, with the page's gutter less the row's own inset. */
function Bounded({ width, children }: { width: number | undefined; children: ReactNode }) {
  if (!width) return <>{children}</>;
  return (
    <HStack justify="center">
      <VStack width="100%" maxWidth={width} paddingInline={5}>
        {children}
      </VStack>
    </HStack>
  );
}

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

/** A link under the band, and whether it is the host's own (drawn through the host's router). */
type RowLink = Readonly<{
  id: string;
  label: string;
  href: string;
  more?: boolean;
  count?: number;
  countLabel?: string;
}>;
/** A page's count after its label: a badge, and for a screen reader what the number counts ("Att göra 2 behöver dig"). */
const counted = (link: RowLink) =>
  link.count ? (
    <HStack as="span" gap={2} vAlign="center">
      {link.label}
      <Badge variant="error" label={String(link.count)} />
      {link.countLabel ? <VisuallyHidden>{link.countLabel}</VisuallyHidden> : null}
    </HStack>
  ) : undefined;
/** The links under the band: the host's own pages when it gives any, else the current place's pages, the one that is the page marked. */
function linksOf(
  menu: SiteMenu,
  selected: string | null,
  location: string | URL | undefined,
  pages: readonly SiteHeaderPage[] | undefined,
  currentPage: string | null,
): { place: SiteMenuItem | undefined; links: readonly RowLink[]; current: string | null; own: boolean } {
  const place = menu.items.find(item => item.id === selected);
  // The host's own pages stand under the band on every one of its addresses, whether or not the menu has a place for it.
  if (pages) return { place, links: pages, current: currentPage, own: true };
  const links = place?.children ?? [];
  const current = place && location && links.length ? selectedItem({ ...menu, items: links }, location) : null;
  return { place, links, current, own: false };
}

/**
 * The header Clew's web app and the intranet share (D87, D88), as the reference draws it: a band with the logo and the
 * site's name at the start and the host's controls at the end, the places as a row under them, and under the band a
 * row with the current place's own pages, or the host's own pages there when it gives any (D130: the web app's tools
 * under Start). Every row is Astryx's `TopNav`; the band is a nested `Theme`. Inside an
 * `AppShell` with mobile navigation the shell turns the bar into its compact phone bar below the breakpoint, so only
 * the heading row is drawn there and the host puts the places in the shell's drawer. Standing alone (the intranet's
 * page, where there is no shell), the header does the same with Astryx's `MobileNav` below the same breakpoint, as the
 * `MobileNavBasicMobileNav` block composes it, with the places and their pages in the drawer.
 */
export function SiteHeader({
  menu,
  selected = null,
  location,
  hostNavigation,
  logo,
  subheading,
  end,
  label = 'Huvudmeny',
  band,
  pages,
  currentPage = null,
  pagesEnd,
  pagesLabel,
  contentWidth,
}: SiteHeaderProps) {
  const ownLabel = pagesLabel ?? menu.site.name;
  const shell = useAppShellMobile();
  const narrow = useCompactSiteHeader();
  const [isOpen, setIsOpen] = useState(false);
  useEffect(() => setIsOpen(false), [hostNavigation?.locationKey]);
  const home = hostNavigation && location ? new URL(hostNavigation.homeHref, location) : undefined;
  const siteLink = bandLink(menu.site.href, home);
  const [failedLogo, setFailedLogo] = useState<string | null>(null);
  const dark = useDarkSiteHeader();
  const darkBand = useMemo(() => (band ? isDarkHeaderBand(band, dark ? 'dark' : 'light') : dark), [band, dark]);
  const forcedColors = useMediaQuery('(forced-colors: active)');
  const logoSrc = logo && darkBand ? (logo.darkSrc ?? logo.src) : logo?.src;
  const darkLogoGround = logo?.ground === 'dark' || (darkBand && !!logo?.darkSrc);
  const heading = (
    <TopNavHeading
      heading={menu.site.name}
      headingHref={siteLink.href}
      as={siteLink.as}
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
              // Keep the mark's own ground when the band differs or the system chooses the colours (D39, D88).
              backgroundColor: logoPlate(darkLogoGround, darkBand, forcedColors),
              forcedColorAdjust: 'none',
            }}
            onError={() => setFailedLogo(logoSrc)}
          />
        ) : undefined
      }
    />
  );
  const { place, links, current, own } = linksOf(menu, selected, location, pages, currentPage);
  const headingRow = (
    <Bounded width={contentWidth}>
      <TopNav label={menu.site.name} heading={heading} endContent={end} />
    </Bounded>
  );

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
              // One row down to 320 px (1.4.10): the host's controls and "Meny" are marks alone, each a 44 px target
              // on a touch screen, and stand edge to edge, so the name and four of them fit where a labelled "Meny"
              // and gaps pushed the controls to a second row under 375 px (review 2026-11-23).
              <HStack gap={0} vAlign="center">
                {end}
                <Button
                  label="Meny"
                  icon={<Icon icon="menu" color="inherit" />}
                  isIconOnly
                  variant="ghost"
                  aria-expanded={isOpen}
                  onClick={() => setIsOpen(true)}
                />
              </HStack>
            }
          />
        </Band>
        <MobileNav isOpen={isOpen} onOpenChange={setIsOpen} header={menu.site.name}>
          {/* The host's own pages first, every one of them (the wide row keeps some under a menu), then the places. */}
          {own && links.length ? (
            <SideNavSection title={ownLabel}>
              {links.map(link => (
                <SideNavItem
                  key={link.id}
                  label={link.label}
                  href={link.href}
                  isSelected={link.id === current}
                  endContent={
                    link.count ? (
                      <>
                        <Badge variant="error" label={String(link.count)} />
                        {link.countLabel ? <VisuallyHidden>{link.countLabel}</VisuallyHidden> : null}
                      </>
                    ) : undefined
                  }
                />
              ))}
            </SideNavSection>
          ) : null}
          {menu.items.length > 0 ? (
            <SideNavSection title={label} isHeaderHidden={!own}>
              {menu.items.map(item => (
                <PlaceRow key={item.id} item={item} selected={selected} current={own ? null : current} home={home} />
              ))}
            </SideNavSection>
          ) : null}
        </MobileNav>
      </>
    );
  }

  return (
    <>
      <Band theme={band}>
        {headingRow}
        {/* A menu with no places has no row for them: the band is the heading row alone, and the host's own pages
            stand under it (D130: a host with no header connector lists its Start among its own pages). */}
        {menu.items.length > 0 ? (
          <Bounded width={contentWidth}>
            <TopNav
              label={label}
              startContent={
                // A row of places wraps when the installation has more than fit on one line (1.4.10), as the reference does.
                <HStack gap={0} wrap="wrap" vAlign="center">
                  {menu.items.map(item => (
                    <TopNavItem
                      key={item.id}
                      label={item.label}
                      {...bandLink(item.href, home)}
                      isSelected={item.id === selected}
                    />
                  ))}
                </HStack>
              }
            />
          </Bounded>
        ) : null}
      </Band>
      {(place || own) && links.length ? (
        // The row stands on the surface colour with a line under it, as the reference draws its white strip under the band.
        <Section variant="section" padding={0} dividers={['bottom']}>
          <Bounded width={contentWidth}>
            <TopNav
              label={own ? ownLabel : place!.label}
              startContent={
                <HStack gap={0} wrap="wrap" vAlign="center">
                  {links
                    .filter(link => !link.more)
                    .map(link => (
                      <TopNavItem
                        key={link.id}
                        label={link.label}
                        {...(own ? { href: link.href } : bandLink(link.href, home))}
                        isSelected={link.id === current}
                      >
                        {counted(link)}
                      </TopNavItem>
                    ))}
                </HStack>
              }
              endContent={own ? pagesEnd : undefined}
            />
          </Bounded>
        </Section>
      ) : null}
    </>
  );
}

/** A place in a drawer: a row, and under it its own pages, open when the place is the current one. */
function PlaceRow({
  item,
  selected,
  current,
  home,
}: {
  item: SiteMenuItem;
  selected: string | null;
  current: string | null;
  home: URL | undefined;
}) {
  const children = item.children ?? [];
  if (!children.length)
    return <SideNavItem label={item.label} {...bandLink(item.href, home)} isSelected={item.id === selected} />;
  return (
    <SideNavItem
      label={item.label}
      {...bandLink(item.href, home)}
      isSelected={item.id === selected}
      collapsible={{ defaultIsCollapsed: item.id !== selected }}
    >
      {children.map(link => (
        <SideNavItem key={link.id} label={link.label} {...bandLink(link.href, home)} isSelected={link.id === current} />
      ))}
    </SideNavItem>
  );
}
