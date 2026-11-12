import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { SessionUser, ViewRef } from '@clew/contracts';
import { Banner, Button, EmptyState, Layout, LayoutContent, Skeleton, VStack, useMediaQuery } from '@clew/ui';
import { areasQuery } from '../queries';
import { errorMessage } from '../query-policy';
import { usePageTitle } from '../page-title';
import { Shell, mobileQuery, shortQuery } from '../components/shell';
import { toolHref, useRail } from '../components/nav';
import { DeclaredView } from '../components/view';
import { RAIL, panelBesideQuery } from '../components/panel';
import { usePagePanel, useView, viewSubject, type OwnThing } from '../components/page-panel';
import { AskClew } from '../components/thing-panel';
import { PageHeader } from '../components/page-header';
import { ContentArrival, ContentSkeleton } from '../components/loading';

/** The table needs 970 px beside the rail, so a 1280 px laptop gets it, with a scrollbar too; a narrower window draws the same rows as a list. */
const tableQuery = '(min-width: 1280px)';
/** With the panel open beside the page the table needs the same column, so a window wider by the panel: below it the page gives way and draws its list. */
const tableBesideQuery = panelBesideQuery(1280 - RAIL);

/**
 * A tool as a page (D42, D112 item 6, board Tool): a view an administrator has chosen for the menu (D40) is opened at
 * `/tools/:capability`, inside the one shell, as Kalender is. The page follows Astryx's `table-filter` template: the
 * name as the heading with the system's badge on its line, the filter bar under it (the view's own search field and
 * choice, and the count of its rows), then the rows, all in one scrolling column. The view is drawn by the one renderer
 * (D38). A row's own read (`view.open`, a contact card) is the inspector, and the inspector is the page's panel
 * (`usePagePanel`, D112 item 7, so the box under it asks about it): beside the page from the one width every page has
 * (`BESIDE_FROM`), over it in a narrower window (D50). The row whose read it is is the current one; ✕ or Esc closes it
 * and gives the focus back to the row's name. The page gives way, the panel does not: beside the panel the rows are the
 * list they are on a narrower window until the table fits too. The address names both, so a reload, a link and the
 * back button land where the person was.
 * "Fråga Clew" at the end of the title's line asks about the page (D112 item 7): the panel opens with the tool's view as
 * its thing, the conversation under it and the box at its foot. It replaces the box that stood at the foot of the page.
 */
export function ToolPage({ user, admin = false }: { user: SessionUser; admin?: boolean }) {
  const mobile = useMediaQuery(mobileQuery);
  // 1.4.10: with 480 px or less in height nothing is pinned beside the page.
  const short = useMediaQuery(shortQuery);
  const { capability = '' } = useParams<{ capability: string }>();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const address = location.pathname + location.search;
  const areasQ = useQuery(areasQuery);
  // A tool is a row the person has in the menu: a view that is not chosen, or not theirs, has no page.
  const entry = areasQ.data?.menu?.find(e => e.capability === capability) ?? null;
  const missing = areasQ.data !== undefined && !entry;
  const nav = useRail({ current: { surface: 'verktyg', view: capability }, admin, manager: user.role === 'manager' });
  const inputJson = search.get('input');
  const main = useView(entry ? capability : null, inputJson, { title: entry?.label ?? '', via: false, address });
  const tool = main.shown?.capability === capability ? main.shown : null;
  // "Fråga Clew" (D112 item 7): the tool's view as it stands is the thing the panel asks about; it is on the page, so
  // the panel holds only its name, the conversation and the box.
  const pageThing: OwnThing | null = entry
    ? {
        id: `page:tool:${capability}`,
        title: entry.label,
        subtitle: 'Verktyget på sidan',
        subject: viewSubject({ capability, title: entry.label, input: main.shown?.input ?? {} }),
      }
    : null;
  // The page says a failed read in its banner, as it says its own.
  const slot = usePagePanel({ overlayOnly: short, failures: 'page', pageThing });
  // The inspector (D112 item 6, board Tool): a row's own read in the page's panel. The row it is the read of is the
  // current one; a read opened from within the panel (`via`) is no row's.
  const opened = slot.ref?.kind === 'view' && !slot.ref.via ? slot.ref : null;
  const isOpen = opened
    ? (v: ViewRef) =>
        v.capability === opened.capability && JSON.stringify(v.input ?? {}) === JSON.stringify(opened.input)
    : undefined;
  const title = slot.view?.title ?? entry?.label ?? (missing ? 'Verktyget finns inte' : null);
  usePageTitle(title, slot.view ? false : (title ?? false));
  const failed =
    areasQ.isError && areasQ.data === undefined
      ? {
          message: errorMessage(areasQ.error, 'Sidan kunde inte läsas.'),
          retry: () => {
            void areasQ.refetch();
          },
        }
      : main.failed
        ? { message: errorMessage(main.failed, 'Kunde inte hämta.'), retry: main.retry }
        : slot.failure;
  return (
    <Shell user={user} nav={nav} height={short ? 'auto' : 'fill'}>
      {/* `padding={0}` on the content and the padding on the stack is the template's way to keep a table on the heading's line. The title stands 32 px in from the rail and 32 px down, as on every page (D74). */}
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
                  title="Verktyget finns inte"
                  description="Det är inte påslaget för dig, eller så har adressen ändrats."
                  actions={<Button label="Till startsidan" href="/" />}
                />
              ) : (
                <>
                  {/* The one page header (D74): with a declared view the view draws it, with its controls at the end of the title's line and its mark row under it; before the view has arrived the title stands alone in the same place. The skeleton is the heading's line, 32 px. */}
                  {entry
                    ? !tool?.spec && <PageHeader title={entry.label} end={<AskClew />} />
                    : !failed && <Skeleton height={32} width={200} />}
                  {failed && (
                    <Banner status="error" title={failed.message}>
                      <Button label="Försök igen" size="sm" variant="secondary" onClick={failed.retry} />
                    </Banner>
                  )}
                  {tool ? (
                    <ContentArrival>
                      {tool.spec ? (
                        <DeclaredView
                          view={tool.spec}
                          output={tool.output}
                          input={tool.input}
                          isLoading={main.isLoading}
                          headingLevel={2}
                          tableQuery={slot.occupied ? tableBesideQuery : tableQuery}
                          title={entry!.label}
                          pageAction={<AskClew />}
                          /* The view's controls rewrite the address in place, so a search is addressable and one step back leaves the tool. */
                          onInput={next => navigate(toolHref(capability, next), { replace: true })}
                          hrefFor={v => toolHref(capability, tool.input, v)}
                          isOpen={isOpen}
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
