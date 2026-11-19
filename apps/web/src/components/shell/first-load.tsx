import { useMemo } from 'react';
import { useLocation } from 'react-router';
import type { SiteHeaderView } from '@clew/contracts';
import { AppShell, HStack, Skeleton, VStack, VisuallyHidden } from '@clew/ui';
import { createHeaderBandTheme } from '@clew/ui/theme';
import { SiteHeader, selectedItem } from '@clew/site-header';
import { useBranding } from '../../branding';
import { PENDING_MENU, SHELL_WIDTH, START_PAGE, SiteName, headerLogo } from './shell';
import { ContentSkeleton, HemSkeleton, TitleSkeleton, UnitsSkeleton } from './loading';
import { PageFrame } from './page-frame';

/** Att göra as the pages' row lists it (`useNav`), before how much waits there is known. */
const TODO_PAGE = { id: 'todo', label: 'Att göra', href: '/todo' } as const;

/**
 * The app before the session is known: the shell in the shape it is about to have, not a spinner on an empty page
 * (app critique, 2026-11-13). The shared header is public, so the band is drawn as it will stand, with its logo, name and
 * places; only the search, the bell and the person, which need the session, are placeholders. Clew's own pages under the
 * band depend on who is signed in, so the row holds the first of them that every person has (Start where no connector
 * lists it, and Att göra): the row stands at its height, and the rest take their places after them when the session is
 * known, so nothing under the header moves (D130). The page depends on what it holds, so it
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
  const pages = [...(shared ? [] : [START_PAGE]), TODO_PAGE];
  const currentPage =
    location.pathname === '/' ? START_PAGE.id : location.pathname.startsWith('/todo') ? TODO_PAGE.id : null;
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
          pages={pages}
          currentPage={currentPage}
          pagesLabel="Mina sidor"
          // The search, the bell and the person, each the size it stands at once the session is known, so the band
          // keeps its height when they come.
          end={
            <HStack gap={2} vAlign="center">
              <Skeleton height={32} width={32} radius="rounded" />
              <Skeleton height={28} width={28} radius="rounded" index={1} />
              <Skeleton height={24} width={24} radius="rounded" index={2} />
              <Skeleton height={36} width={132} index={3} />
            </HStack>
          }
        />
      }
    >
      <VisuallyHidden role="status">Hämtar sidan …</VisuallyHidden>
      <SiteName.Provider value={menu.site.name}>{page}</SiteName.Provider>
    </AppShell>
  );
}
