import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { SessionUser } from '@clew/contracts';
import { Banner, Button, EmptyState, VStack, useMediaQuery } from '@clew/ui';
import { areasQuery } from '../queries';
import { errorMessage, refused } from '../query-policy';
import { usePageTitle } from '../page-title';
import { Shell, shortQuery } from '../components/shell/shell';
import { useNav } from '../components/shell/nav';
import { viewOpenHref, withViewInput } from '../view-address';
import { useShownForTheWayBack } from '../way-back';
import { DeclaredView } from '../components/views/view';
import { useView } from '../components/views/view-read';
import { pageSubject } from '../components/conversation/page-conversation';
import { PageHeader } from '../components/shell/page-header';
import { ContentArrival, ContentSkeleton } from '../components/shell/loading';
import { PageFrame } from '../components/shell/page-frame';
import { NEWS_CAPABILITY } from '../components/hem/news';

/** As on a tool's page: the table from 1280 px beside the rail, the same rows as a list below it. */
const tableQuery = '(min-width: 1280px)';
/** The page's name when no administrator has put the list in the rail under another one. */
const TITLE = 'Nyheter';

/**
 * "Alla nyheter" (D112, amended 2026-11-11, board Hem10): the combined news list `clew.news` as a tool's page, at the
 * address a tool has (`/tools/clew.news`, D42), whether or not an administrator placed it in the rail under Verktyg
 * (D40): Hem's "Alla nyheter" leads here for everyone with a news source, and a placed row marks itself current here.
 * Drawn as the tool's page draws a view (`tool.tsx`, D112 item 6): the one page header, the view by the one renderer
 * (D38), a piece of news as its own page (D126 rule 1: its name is the link, nothing opens beside the list), and the
 * assistant's pane beside the list, opened by the corner's "Fråga AI" (D141, D138), about the list's read. A person with no
 * news source is told there is none, as a tool that is not theirs is.
 */
export function NewsPage({ user, admin = false }: { user: SessionUser; admin?: boolean }) {
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
  const nav = useNav({
    current: { surface: 'verktyg', view: NEWS_CAPABILITY },
    admin,
    manager: user.role === 'manager',
  });
  const inputJson = search.get('input');
  const main = useView(NEWS_CAPABILITY, inputJson, { title, address });
  const list = main.shown?.capability === NEWS_CAPABILITY ? main.shown : null;
  const missing = !!main.failed && refused(main.failed);
  // The news is a list, a page of its own (D116): the pane beside it is about its read (D141 rule 4), under the key a
  // tool's list has, so a conversation asked about it before is found again.
  const subject = missing
    ? null
    : pageSubject({
        key: `view:${NEWS_CAPABILITY}`,
        title,
        reads: [{ capability: NEWS_CAPABILITY, own: true, label: title }],
        views: areas?.views,
      });
  const heading = missing ? 'Inga nyheter för dig' : title;
  usePageTitle(heading, heading);
  const failed =
    main.failed && !missing ? { message: errorMessage(main.failed, 'Kunde inte hämta.'), retry: main.retry } : null;
  return (
    <Shell user={user} nav={nav} height={short ? 'auto' : 'fill'}>
      {/* A register (D126 rule 8) in the one page frame: the view draws its own title line (D74) in the column. */}
      <PageFrame ask={{ subject }} label={title}>
        <VStack gap={4}>
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
              {!list?.spec && <PageHeader title={title} />}
              {failed && (
                <Banner
                  status="error"
                  container="section"
                  collapsible={false}
                  title={failed.message}
                  endContent={<Button label="Försök igen" size="sm" variant="secondary" onClick={failed.retry} />}
                />
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
                      tableQuery={tableQuery}
                      title={title}
                      onInput={next =>
                        navigate(withViewInput(location.pathname, location.search, next), { replace: true })
                      }
                      /* A piece of news is one thing: its own page, with the list as the way back (D126). */
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
      </PageFrame>
    </Shell>
  );
}
