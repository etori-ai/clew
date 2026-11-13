import { useMemo } from 'react';
import { useLocation } from 'react-router';
import type { SiteHeaderView } from '@clew/contracts';
import {
  AppShell,
  HStack,
  Layout,
  LayoutContent,
  SideNav,
  SideNavHeading,
  Skeleton,
  VStack,
  VisuallyHidden,
  useMediaQuery,
} from '@clew/ui';
import { createHeaderBandTheme } from '@clew/ui/theme';
import { SiteHeader, selectedItem } from '@clew/site-header';
import { useBranding } from '../branding';
import { mobileQuery } from '../media';
import { InstallationLogo, SITE_NAME, headerLogo } from './shell';
import { ContentSkeleton, HemSkeleton, TitleSkeleton, UnitsSkeleton } from './loading';

/** Hem's column and the box's reading width, as `start.tsx` draws them. */
const PAGE_COLUMN = 1216 - 2 * 32;
const LANDING_WIDTH = 720;

/**
 * The app before the session is known: the shell in the shape it is about to have, not a spinner on an empty page
 * (app critique, 2026-11-13). The shared header is public, so the band is drawn as it will stand, with its logo, name and
 * places; only the person and the bell, which need the session, are placeholders. The rail's rows depend on who is
 * signed in and the page on what it holds, so both are placeholders in their own shape: Hem's heading, box and blocks on
 * Hem, Dialogstöd's "Att ta upp" and tables on Dialogstöd, a title and rows on any other page. Each page then draws
 * its own placeholders until its answers come, in the same places.
 */
export function FirstLoad({ header }: { header: SiteHeaderView | null }) {
  const mobile = useMediaQuery(mobileQuery);
  const location = useLocation();
  const branding = useBranding();
  const bandTheme = useMemo(() => createHeaderBandTheme(branding), [branding]);
  const shared = header?.source ? header : null;
  const here = window.location.origin + location.pathname + location.search;
  const page =
    location.pathname === '/' && !mobile ? (
      <VStack hAlign="center" padding={8}>
        <VStack width="100%" maxWidth={PAGE_COLUMN} paddingBlockStart={6} paddingBlockEnd={6}>
          <HemSkeleton landingWidth={LANDING_WIDTH} />
        </VStack>
      </VStack>
    ) : (
      <Layout
        height="fill"
        padding={mobile ? 3 : 8}
        content={
          <LayoutContent padding={0}>
            <VStack
              paddingInline={mobile ? 3 : 8}
              paddingBlockStart={mobile ? 3 : 8}
              paddingBlockEnd={mobile ? 3 : 5}
              gap={6}
            >
              <TitleSkeleton />
              {location.pathname === '/units' ? <UnitsSkeleton /> : <ContentSkeleton heading={false} />}
            </VStack>
          </LayoutContent>
        }
      />
    );
  return (
    <AppShell
      height="fill"
      variant="section"
      contentPadding={0}
      mobileNav={{ breakpoint: 'md', isOpen: false, onOpenChange: () => undefined }}
      topNav={
        shared ? (
          <SiteHeader
            menu={shared.menu}
            selected={selectedItem(shared.menu, here)}
            location={here}
            logo={headerLogo(shared.logo, branding.logo, mobile)}
            band={mobile ? undefined : bandTheme}
            // The bell and the person, as wide as they stand once the session is known.
            end={
              <HStack gap={3} vAlign="center">
                <Skeleton height={24} width={24} radius="rounded" />
                <Skeleton height={28} width={28} radius="rounded" index={1} />
                <Skeleton height={16} width={88} index={2} />
              </HStack>
            }
          />
        ) : undefined
      }
      sideNav={
        <SideNav
          collapsible
          header={
            shared ? undefined : (
              <SideNavHeading
                heading={header?.menu.site.name ?? SITE_NAME}
                headingHref="/"
                icon={<InstallationLogo logo={branding.logo} />}
              />
            )
          }
        >
          {/* The rail's rows: the create button and the search, then the places, at a row's height each. */}
          <VStack gap={6} paddingInline={2} paddingBlock={2}>
            {[
              [70, 45],
              [60, 65, 55, 60, 70],
            ].map((rows, g) => (
              <VStack key={g} gap={4}>
                {rows.map((width, i) => (
                  <Skeleton key={i} height={18} width={`${width}%`} index={g * 2 + i} />
                ))}
              </VStack>
            ))}
          </VStack>
        </SideNav>
      }
    >
      <VisuallyHidden role="status">Hämtar sidan …</VisuallyHidden>
      {page}
    </AppShell>
  );
}
