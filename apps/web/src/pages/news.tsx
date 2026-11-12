import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { SessionUser } from '@clew/contracts';
import { Banner, Button, EmptyState, Layout, LayoutContent, VStack, useMediaQuery } from '@clew/ui';
import { areasQuery } from '../queries';
import { errorMessage, refused } from '../query-policy';
import { usePageTitle } from '../page-title';
import { Shell, mobileQuery, shortQuery } from '../components/shell';
import { useRail } from '../components/nav';
import { viewOpenHref, withViewInput } from '../view-address';
import { useShownForTheWayBack } from '../way-back';
import { DeclaredView } from '../components/view';
import { RAIL, panelBesideQuery } from '../components/panel';
import { usePagePanel, useView, viewSubject, type OwnThing } from '../components/page-panel';
import { AskClew } from '../components/thing-panel';
import { PageHeader } from '../components/page-header';
import { ContentArrival, ContentSkeleton } from '../components/loading';
import { NEWS_CAPABILITY } from '../components/news';

/** As on a tool's page: the table from 1280 px beside the rail, the same rows as a list below it. */
const tableQuery = '(min-width: 1280px)';
const tableBesideQuery = panelBesideQuery(1280 - RAIL);
/** The page's name when no administrator has put the list in the rail under another one. */
const TITLE = 'Nyheter';

/**
 * "Alla nyheter" (D112, amended 2026-11-11, board Hem10): the combined news list `clew.news` as a tool's page, at the
 * address a tool has (`/tools/clew.news`, D42), whether or not an administrator placed it in the rail under Verktyg
 * (D40): Hem's "Alla nyheter" leads here for everyone with a news source, and a placed row marks itself current here.
 * Drawn as the tool's page draws a view (`tool.tsx`, D112 item 6): the one page header, the view by the one renderer
 * (D38), a row's own read beside the page in the panel, "Fråga Clew" making the list the panel's thing. A person with
 * no news source is told there is none, as a tool that is not theirs is.
 */
export function NewsPage({ user, admin = false }: { user: SessionUser; admin?: boolean }) {
  const mobile = useMediaQuery(mobileQuery);
  const short = useMediaQuery(shortQuery);
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const address = location.pathname + location.search;
  useShownForTheWayBack(address);
  const areas = useQuery(areasQuery).data;
  // Placed in the rail, the list carries the administrator's row's name; otherwise its own.
  const entry = areas?.menu?.find(e => e.capability === NEWS_CAPABILITY);
  const title = entry?.label ?? TITLE;
  const nav = useRail({
    current: { surface: 'verktyg', view: NEWS_CAPABILITY },
    admin,
    manager: user.role === 'manager',
  });
  const inputJson = search.get('input');
  const main = useView(NEWS_CAPABILITY, inputJson, { title, address });
  const list = main.shown?.capability === NEWS_CAPABILITY ? main.shown : null;
  const missing = !!main.failed && refused(main.failed);
  const pageThing: OwnThing | null = missing
    ? null
    : {
        id: `page:tool:${NEWS_CAPABILITY}`,
        title,
        subtitle: 'Verktyget på sidan',
        // The news is a list, a page of its own (D116): the conversation about it continues without it beside.
        subject: viewSubject({ capability: NEWS_CAPABILITY, title, input: main.shown?.input ?? {} }, true),
      };
  const slot = usePagePanel({ overlayOnly: short, failures: 'page', pageThing });
  const heading = slot.view?.title ?? (missing ? 'Inga nyheter för dig' : title);
  usePageTitle(heading, slot.view ? false : heading);
  const failed =
    main.failed && !missing
      ? { message: errorMessage(main.failed, 'Kunde inte hämta.'), retry: main.retry }
      : slot.failure;
  return (
    <Shell user={user} nav={nav} height={short ? 'auto' : 'fill'}>
      <Layout
        height={short ? 'auto' : 'fill'}
        padding={mobile ? 3 : 8}
        end={slot.end}
        content={
          <LayoutContent padding={0}>
            <VStack
              paddingInline={mobile ? 3 : 8}
              paddingBlockStart={mobile ? 3 : 8}
              paddingBlockEnd={mobile ? 3 : 5}
              gap={4}
            >
              {missing ? (
                <EmptyState
                  headingLevel={1}
                  title="Inga nyheter för dig"
                  description="Ingen nyhetskälla är ansluten för dig."
                  actions={<Button label="Till startsidan" href="/" />}
                />
              ) : (
                <>
                  {/* The one page header (D74): the view draws it once it has arrived; until then the title stands alone. */}
                  {!list?.spec && <PageHeader title={title} end={<AskClew />} />}
                  {failed && (
                    <Banner status="error" title={failed.message}>
                      <Button label="Försök igen" size="sm" variant="secondary" onClick={failed.retry} />
                    </Banner>
                  )}
                  {list ? (
                    <ContentArrival>
                      {list.spec ? (
                        <DeclaredView
                          view={list.spec}
                          output={list.output}
                          input={list.input}
                          isLoading={main.isLoading}
                          headingLevel={2}
                          tableQuery={slot.occupied ? tableBesideQuery : tableQuery}
                          title={title}
                          pageAction={<AskClew />}
                          onInput={next =>
                            navigate(withViewInput(location.pathname, location.search, next), { replace: true })
                          }
                          /* A piece of news is one thing: beside the list, in the panel (D116). */
                          hrefFor={v => viewOpenHref(areas?.views, location.pathname, location.search, v)}
                        />
                      ) : (
                        <EmptyState headingLevel={2} title="Inget att visa" />
                      )}
                    </ContentArrival>
                  ) : (
                    !failed && <ContentSkeleton heading={false} />
                  )}
                </>
              )}
            </VStack>
          </LayoutContent>
        }
      />
      {slot.overlay}
    </Shell>
  );
}
