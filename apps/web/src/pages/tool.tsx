import { useEffect } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { SessionUser, ViewRef } from '@clew/contracts';
import {
  Banner,
  Button,
  EmptyState,
  HStack,
  Icon,
  Layout,
  LayoutContent,
  Link,
  Skeleton,
  VStack,
  useMediaQuery,
} from '@clew/ui';
import { areasQuery, entityDetailQuery } from '../queries';
import { errorMessage, refused } from '../query-policy';
import { usePageTitle } from '../page-title';
import { insideClew, originOf, toolOf } from '../person-address';
import { opensAsPage, viewOpenHref, withViewInput } from '../view-address';
import { useShownForTheWayBack } from '../way-back';
import { Shell, mobileQuery, shortQuery } from '../components/shell';
import { useRail, type RailCurrent } from '../components/nav';
import { DeclaredView } from '../components/view';
import { PanelBody, RAIL, answersWithRowsOf, panelBesideQuery } from '../components/panel';
import { usePagePanel, useView, viewSubject, type OwnThing } from '../components/page-panel';
import { AskClew } from '../components/thing-panel';
import { PageHeader } from '../components/page-header';
import { ContentArrival, ContentSkeleton } from '../components/loading';

/** The table needs 970 px beside the rail, so a 1280 px laptop gets it, with a scrollbar too; a narrower window draws the same rows as a list. */
const tableQuery = '(min-width: 1280px)';
/** With the panel open beside the page the table needs the same column, so a window wider by the panel: below it the page gives way and draws its list. */
const tableBesideQuery = panelBesideQuery(1280 - RAIL);
/** The heading the page sends the focus to when the person arrives from a link on another page. */
const TITLE_ID = 'vy-rubrik';
/** The one person a view's input names by `person`, or null. */
function personOf(inputJson: string | null): string | null {
  try {
    const person = (JSON.parse(inputJson ?? 'null') as { person?: unknown } | null)?.person;
    return typeof person === 'string' && person ? person : null;
  } catch {
    return null;
  }
}
/** What a list or a table holds, as a heading's first word: "Kompetenser". */
function nounOf(spec: { kind: string; noun?: { other: string } } | undefined): string | undefined {
  const other = spec?.noun?.other;
  return other ? other.charAt(0).toLocaleUpperCase('sv') + other.slice(1) : undefined;
}

/**
 * Where the rail stands on a view's page that is not a tool of its own: on the place the view was opened from, as a
 * work item's page does (`item.tsx`); with no such place, on nothing.
 */
function placeOf(from: string | null): RailCurrent {
  const tool = toolOf(from);
  if (from?.startsWith('/staff')) return { surface: 'staff' };
  if (from?.startsWith('/calendar')) return { surface: 'calendar' };
  if (from?.startsWith('/competence')) return { surface: 'competence' };
  if (tool) return { surface: 'verktyg', view: tool };
  if (from?.startsWith('/todo') || from?.startsWith('/items/')) return { surface: 'todo' };
  if (from === '/' || from?.startsWith('/?')) return { surface: 'start' };
  const conversation = from ? /^\/conversations\/([^/?]+)/.exec(from)?.[1] : undefined;
  if (conversation) return { surface: 'start', conversationId: decodeURIComponent(conversation) };
  return { surface: 'verktyg', view: null };
}

/**
 * A view as a page (D42, D112 item 6, D116, board Tool), at `/tools/:capability`, inside the one shell, as Kalender is.
 * Every read the person may open has this page, whether or not an administrator placed it in the rail (D40): a list or
 * a table opened anywhere (a tile of Läget, a suggestion under the box, an answer's "Visa allt", a work item's "Se i
 * personalsystemet") is shown here, never in the panel, and a record or a document has it as its own page. The address
 * says what is shown: `input` what the read is asked, `title` the name it was opened under, `from` the page it was
 * opened from, whose name is the way back at the top of the page (a person's page names its way back the same way) and
 * where the rail stands when the view is no tool of its own. A read the person may not open, and one that does not
 * exist, both say "Verktyget finns inte" and nothing else, and are not asked for.
 * The page follows Astryx's `table-filter` template: the name as the heading with the system's badge on its line, the
 * filter bar under it (the view's own search field and choice, and the count of its rows), then the rows, all in one
 * scrolling column. The view is drawn by the one renderer (D38). A row's own read (`view.open`, a contact card) is the
 * inspector, and the inspector is the page's panel (`usePagePanel`, D112 item 7, so the box under it asks about it):
 * beside the page from the one width every page has (`BESIDE_FROM`), over it in a narrower window (D50). The row whose
 * read it is is the current one; ✕ or Esc closes it and gives the focus back to the row's name. A row whose read is
 * itself a list leads to that list's page. The page gives way, the panel does not: beside the panel the rows are the
 * list they are on a narrower window until the table fits too. The address names both, so a reload, a link and the
 * back button land where the person was.
 * "Fråga Clew" at the end of the title's line asks about the page (D112 item 7): the panel opens with the view as its
 * thing, the conversation under it and the box at its foot.
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
  useShownForTheWayBack(address);
  const areasQ = useQuery(areasQuery);
  const menu = areasQ.data?.menu;
  const views = areasQ.data?.views;
  // A tool is a row the person has in the menu; any other read they may open is a view with this page too (D116). One
  // that is neither is not theirs, or does not exist, and the two are the same page.
  const entry = menu?.find(e => e.capability === capability) ?? null;
  const known = views?.find(v => v.capability === capability) ?? null;
  const unlisted = areasQ.data !== undefined && !entry && !known && views !== undefined;
  const inputJson = search.get('input');
  const named = entry?.label ?? search.get('title') ?? known?.title ?? '';
  // Read only once the person's reads are known, so a read that is not theirs is never asked for.
  const main = useView(areasQ.data !== undefined && !unlisted ? capability : null, inputJson, {
    title: named,
    address,
  });
  // A view of one person's (its input names `person`) opened without a name of its own is named for them from the
  // directory, as their page names them (D121, the review of 2026-11-13): a person's name never rides in the address.
  // Until both have answered the heading waits; a person the directory does not answer for keeps the read's own name.
  const whose = !entry && search.get('title') === null ? personOf(inputJson) : null;
  const person = useQuery({ ...entityDetailQuery('person', whose ?? ''), enabled: whose !== null });
  const noun = main.shown?.capability === capability ? nounOf(main.shown.spec) : undefined;
  const title =
    whose === null
      ? named
      : person.data && noun
        ? `${noun} för ${person.data.entity.name}`
        : person.isError || (person.data && main.shown)
          ? named
          : '';
  const missing = unlisted || (!!main.failed && refused(main.failed));
  const ready = areasQ.data !== undefined && !missing;
  const from = insideClew(search.get('from'));
  const back = from
    ? (originOf(from, menu) ?? { label: from.startsWith('/conversations/') ? 'Samtalet' : 'Tillbaka', href: from })
    : null;
  const nav = useRail({
    current: entry ? { surface: 'verktyg', view: capability } : placeOf(from),
    admin,
    manager: user.role === 'manager',
  });
  const tool = main.shown?.capability === capability ? main.shown : null;
  // "Fråga Clew" (D112 item 7): the view as it stands is the thing the panel asks about; it is on the page, so the
  // panel holds only its name, the conversation and the box.
  const pageThing: OwnThing | null =
    ready && title
      ? {
          id: `page:tool:${capability}`,
          title,
          subtitle: entry ? 'Verktyget på sidan' : 'Vyn på sidan',
          subject: viewSubject(
            { capability, title, input: main.shown?.input ?? {} },
            opensAsPage(views, capability) || answersWithRowsOf(tool?.spec, tool?.output),
          ),
        }
      : null;
  // The page says a failed read in its banner, as it says its own.
  const slot = usePagePanel({ overlayOnly: short, failures: 'page', pageThing });
  // The inspector (D112 item 6, board Tool): a row's own read in the page's panel, and the row it is the read of the
  // current one.
  const opened = slot.ref?.kind === 'view' ? slot.ref : null;
  const isOpen = opened
    ? (v: ViewRef) =>
        v.capability === opened.capability && JSON.stringify(v.input ?? {}) === JSON.stringify(opened.input)
    : undefined;
  const heading = missing ? 'Verktyget finns inte' : title || null;
  usePageTitle(slot.view?.title ?? heading, slot.view ? false : (heading ?? false));
  // Arrived from a link on another page, the person starts at the heading (2.4.3): the page they left took the focus
  // with it. From the rail, or with the focus somewhere already, it stays where it is.
  useEffect(() => {
    if (!tool || !from) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body && active.isConnected) return;
    document.getElementById(TITLE_ID)?.focus();
  }, [!!tool, capability]);
  const failed =
    areasQ.isError && areasQ.data === undefined
      ? {
          message: errorMessage(areasQ.error, 'Sidan kunde inte läsas.'),
          retry: () => {
            void areasQ.refetch();
          },
        }
      : main.failed && !missing
        ? { message: errorMessage(main.failed, 'Kunde inte hämta.'), retry: main.retry }
        : slot.failure;
  /** Where a row's own read leads (D116): a list to its own page with this one as the way back, one thing beside it. */
  const hrefFor = (v: ViewRef) => viewOpenHref(views, location.pathname, location.search, v);
  // The way back (a person's page names it the same way): the page the view was opened from, by its name.
  const trail = back && (
    <HStack>
      <Link href={back.href} type="supporting" color="secondary">
        <HStack as="span" gap={1} vAlign="center">
          <Icon icon="chevronLeft" size="sm" />
          {back.label}
        </HStack>
      </Link>
    </HStack>
  );
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
                  {trail}
                  {/* The one page header (D74): with a declared view the view draws it, with its controls at the end of the title's line and its mark row under it; before the view has arrived the title stands alone in the same place. The skeleton is the heading's line, 32 px. */}
                  {title
                    ? !tool?.spec && <PageHeader title={title} titleId={TITLE_ID} end={<AskClew />} />
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
                          title={title}
                          titleId={TITLE_ID}
                          pageAction={<AskClew />}
                          /* The view's controls rewrite the address in place, so a search is addressable and one step back leaves the page. */
                          onInput={next =>
                            navigate(withViewInput(location.pathname, location.search, next), { replace: true })
                          }
                          hrefFor={hrefFor}
                          isOpen={isOpen}
                        />
                      ) : (
                        /* A read that declares no view (D38) is drawn as the panel draws one: its hits, its rows or its facts. */
                        <PanelBody output={tool.output} source={tool.source} input={tool.input} hrefFor={hrefFor} />
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
