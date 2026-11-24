import { useLocation } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { SessionUser } from '@clew/contracts';
import { Banner, Button, EmptyState, VStack, useMediaQuery } from '@clew/ui';
import { areasQuery } from '../queries';
import { errorMessage, refused } from '../query-policy';
import { usePageTitle } from '../page-title';
import { Shell, shortQuery } from '../components/shell/shell';
import { useNav } from '../components/shell/nav';
import { viewOpenHref } from '../view-address';
import { useShownForTheWayBack } from '../way-back';
import { DeclaredView } from '../components/views/view';
import { useView, useViewInput, viewSubject } from '../components/views/view-read';
import { AskClew } from '../components/conversation/thing-panel';
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
 * (D38), a piece of news as its own page (D126 rule 1: its name is the link, nothing opens beside the list), "Fråga
 * Clew" starting a conversation about the list (rule 5). A person with no news source is told there is none, as a tool
 * that is not theirs is.
 */
export function NewsPage({ user, admin = false }: { user: SessionUser; admin?: boolean }) {
  const short = useMediaQuery(shortQuery);
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
  // The address's input, and what is typed into the list's search field, which no address holds (`useViewInput`).
  const viewInput = useViewInput(NEWS_CAPABILITY);
  const main = useView(NEWS_CAPABILITY, viewInput.inputJson, { title, address });
  const list = main.shown?.capability === NEWS_CAPABILITY ? main.shown : null;
  const missing = !!main.failed && refused(main.failed);
  // The news is a list, a page of its own (D116): the conversation about it goes on without it beside.
  const subject = missing
    ? null
    : viewSubject({ capability: NEWS_CAPABILITY, title, input: main.shown?.input ?? {} }, true);
  const ask = <AskClew subject={subject} />;
  const heading = missing ? 'Inga nyheter för dig' : title;
  usePageTitle(heading, heading);
  const failed =
    main.failed && !missing ? { message: errorMessage(main.failed, 'Kunde inte hämta.'), retry: main.retry } : null;
  return (
    <Shell user={user} nav={nav} height={short ? 'auto' : 'fill'}>
      {/* A register (D126 rule 8) in the one page frame: the view draws its own title line (D74) in the column. */}
      <PageFrame label={title}>
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
              {!list?.spec && <PageHeader title={title} end={ask} />}
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
                      pageAction={ask}
                      onInput={next => viewInput.onInput(next, list.spec)}
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
