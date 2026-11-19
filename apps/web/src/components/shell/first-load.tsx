import { useMemo } from 'react';
import { useLocation } from 'react-router';
import type { SiteHeaderView } from '@clew/contracts';
import { AppShell, HStack, Skeleton, VStack, VisuallyHidden } from '@clew/ui';
import { createHeaderBandTheme } from '@clew/ui/theme';
import { SiteHeader, selectedItem } from '@clew/site-header';
import { useBranding } from '../../branding';
import { PENDING_MENU, SHELL_WIDTH, START_PAGE, headerLogo } from './shell';
import { ContentSkeleton, HemSkeleton, TitleSkeleton, UnitsSkeleton } from './loading';
import { PageFrame } from './page-frame';

/**
 * The app before the session is known: the shell in the shape it is about to have, not a spinner on an empty page
 * (app critique, 2026-11-13). The shared header is public, so the band is drawn as it will stand, with its logo, name and
 * places; only the search, the bell and the person, which need the session, are placeholders. Clew's own pages under the
 * band depend on who is signed in, so their row comes with the session (D130). The page depends on what it holds, so it
 * is placeholders in its own shape: Hem's greeting, box and blocks
 * on Hem, Dialogstöd's "Att ta upp" and tables on Dialogstöd, a title and rows on any other page. Each page then draws
 * its own placeholders until its answers come, in the same places.
 */
export function FirstLoad({ header }: { header: SiteHeaderView | null }) {
  const location = useLocation();
  const branding = useBranding();
  const bandTheme = useMemo(() => createHeaderBandTheme(branding), [branding]);
  const shared = header?.source ? header : null;
  // As the shell draws it (D130): a connector's places on the band, else the heading row alone with Start under it.
  const menu = shared ? shared.menu : { ...(header?.menu ?? PENDING_MENU), items: [] };
  const here = window.location.origin + location.pathname + location.search;
  // In the one page frame every page has (D126), so nothing moves when the page takes the placeholders' place.
  const page =
    location.pathname === '/' ? (
      <PageFrame plain pinned={false}>
        <HemSkeleton />
      </PageFrame>
    ) : (
      <PageFrame>
        <VStack gap={6}>
          <TitleSkeleton />
          {location.pathname === '/units' ? <UnitsSkeleton /> : <ContentSkeleton heading={false} />}
        </VStack>
      </PageFrame>
    );
  return (
    <AppShell
      height="fill"
      variant="wash"
      contentPadding={0}
      mobileNav={false}
      topNav={
        <SiteHeader
          menu={menu}
          selected={selectedItem(menu, here)}
          location={here}
          logo={headerLogo(shared?.logo, branding.logo, false)}
          band={bandTheme}
          contentWidth={SHELL_WIDTH}
          {...(shared ? {} : { pages: [START_PAGE], currentPage: location.pathname === '/' ? START_PAGE.id : null })}
          pagesLabel="Mina sidor"
          // The search, the bell and the person, as wide as they stand once the session is known.
          end={
            <HStack gap={3} vAlign="center">
              <Skeleton height={24} width={24} radius="rounded" />
              <Skeleton height={24} width={24} radius="rounded" index={1} />
              <Skeleton height={28} width={28} radius="rounded" index={2} />
              <Skeleton height={16} width={88} index={3} />
            </HStack>
          }
        />
      }
    >
      <VisuallyHidden role="status">Hämtar sidan …</VisuallyHidden>
      {page}
    </AppShell>
  );
}
