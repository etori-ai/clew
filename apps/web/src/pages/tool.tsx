import { useEffect } from 'react';
import { useLocation, useParams, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { SessionUser, ViewRef } from '@clew/contracts';
import type { PanelViewSpec } from '@clew/contracts';
import { Button, EmptyState, Heading, HStack, Skeleton, StatusNotice, Text, VStack, useMediaQuery } from '@clew/ui';
import { areasQuery, entityDetailQuery } from '../queries';
import { errorMessage, refused } from '../query-policy';
import { usePageTitle } from '../page-title';
import { insideClew, originOf, toolOf } from '../person-address';
import { opensAsPage, viewOpenHref } from '../view-address';
import { calendarEntryHref } from '../panel-address';
import { useShownForTheWayBack } from '../way-back';
import { Shell, shortQuery } from '../components/shell/shell';
import { placeOfRead, useNav, type NavCurrent } from '../components/shell/nav';
import { DeclaredView } from '../components/views/view';
import { PanelBody, answersWithRowsOf } from '../components/views/panel';
import { useView, useViewInput, viewSubject } from '../components/views/view-read';
import { AskClew } from '../components/conversation/thing-panel';
import { PageFrame, WayBack } from '../components/shell/page-frame';
import { PageHeader } from '../components/shell/page-header';
import { ContentArrival, ContentSkeleton } from '../components/shell/loading';

/** The table needs 970 px beside the rail, so a 1280 px laptop gets it, with a scrollbar too; a narrower window draws the same rows as a list. */
const tableQuery = '(min-width: 1280px)';
/** The kinds of read that are one thing (D126 rule 1): drawn as a thing's page, not as a register. */
const ONE_THING: ReadonlySet<PanelViewSpec['kind']> = new Set(['record', 'detail', 'document', 'text']);
/** A record whose read has more than its facts: the column holds the read and the end panel the facts. */
const hasBody = (spec: PanelViewSpec) =>
  spec.kind === 'record' && !!(spec.document || spec.items || spec.metrics || spec.series || spec.activity);
/** The heading the page sends the focus to when the person arrives from a link on another page. */
const TITLE_ID = 'vy-rubrik';
/** The page's heading when it fails before it is named: the areas that name it could not be read. */
const FAILED_TITLE = 'Sidan kunde inte läsas';
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
 * Where the rail stands on a view's page that is neither a tool of its own nor a read of a connector with a place in
 * the rail (`placeOfRead`): on the place the view was opened from, as a work item's page does (`item.tsx`); with no
 * such place, on nothing.
 */
function placeOf(from: string | null): NavCurrent {
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
 * A view as a page (D42, D116, D126), at `/tools/:capability`, inside the one shell, as Kalender is. Every read the
 * person may open has this page, whether or not an administrator placed it in the rail (D40). The address says what is
 * shown: `input` what the read is asked, `title` the name it was opened under, `from` the page it was opened from, whose
 * name is the way back at the top of the page (a person's page names its way back the same way) and where the rail
 * stands when the view is no tool of its own. A read the person may not open, and one that does not exist, both say
 * "Verktyget finns inte" and nothing else, and are not asked for.
 * A list or a table is a register (D126 rule 8, board Personal, the `table-page` template): the name as the heading
 * with the system's badge and "Fråga assistenten" on its line, the view's own search field and choice and the count under it,
 * then the rows. The name in a row is the link to the row's own read, its page (rule 4); a row never opens a panel.
 * One thing (a record, a contact card, a text, a document) is a thing's page (rule 1, the `work-item-detail`
 * template): the way back and the title, "Fråga assistenten" under it, the read in the column and a record's facts in the end
 * panel, above the read where the window is narrow. The view is drawn by the one renderer (D38).
 */
export function ToolPage({ user, admin = false }: { user: SessionUser; admin?: boolean }) {
  // 1.4.10: with 480 px or less in height nothing is pinned beside the page.
  const short = useMediaQuery(shortQuery);
  const { capability = '' } = useParams<{ capability: string }>();
  const [search] = useSearchParams();
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
  // What the view is read with: the address's input, and what is typed into its search field, which no address holds.
  const viewInput = useViewInput(capability);
  const inputJson = viewInput.inputJson;
  const named = entry?.label ?? search.get('title') ?? known?.title ?? '';
  // Read only once the person's reads are known, so a read that is not theirs is never asked for.
  const main = useView(areasQ.data !== undefined && !unlisted ? capability : null, inputJson, {
    title: named,
    address,
  });
  // A view of one person's (its input names `person`) opened without a name of its own is named for them from the
  // directory, as their page names them (D121, the review of 2026-11-13): a person's name never rides in the address.
  // The directory is asked by Clew's key, the person's id (D122): the address's `of` where the opener knew it, else the
  // input's own key, which is the id of a person without a user name. Until both have answered the heading waits; a
  // person the directory does not answer for keeps the read's own name. A read that fails is still named for the person
  // once the directory has answered, by the read's own name, so the tab and the heading say whose view could not be read.
  const whose = !entry && search.get('title') === null ? (search.get('of') ?? personOf(inputJson)) : null;
  const person = useQuery({ ...entityDetailQuery('person', whose ?? ''), enabled: whose !== null });
  const noun = main.shown?.capability === capability ? nounOf(main.shown.spec) : undefined;
  const title =
    whose === null
      ? named
      : person.data && noun
        ? `${noun} för ${person.data.entity.name}`
        : person.data && main.failed && named
          ? `${named} för ${person.data.entity.name}`
          : person.isError || (person.data && main.shown)
            ? named
            : '';
  const missing = unlisted || (!!main.failed && refused(main.failed));
  const ready = areasQ.data !== undefined && !missing;
  const from = insideClew(search.get('from'));
  const back = from
    ? (originOf(from, menu) ?? {
        // A read's page that is no tool in the menu is named by the read's own title; nothing Clew can name, "Tillbaka".
        label: views?.find(v => v.capability === toolOf(from))?.title ?? 'Tillbaka',
        href: from,
      })
    : null;
  // A tool in the rail marks its row; a read of a connector with a place of its own in the rail (Kompetens, Kalender)
  // marks that place wherever it was opened from; any other view the place it was opened from.
  const nav = useNav({
    current: entry ? { surface: 'verktyg', view: capability } : (placeOfRead(capability) ?? placeOf(from)),
    admin,
    manager: user.role === 'manager',
  });
  const tool = main.shown?.capability === capability ? main.shown : null;
  // "Fråga assistenten" (D126 rule 5): a new conversation about the view as it stands; a list goes as its chip alone, one
  // thing stands beside the conversation.
  const subject =
    ready && title
      ? viewSubject(
          { capability, title, input: main.shown?.input ?? {} },
          opensAsPage(views, capability) || answersWithRowsOf(tool?.spec, tool?.output),
        )
      : null;
  const ask = <AskClew subject={subject} />;
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
        : null;
  // A page whose read failed before it could be named keeps a level-1 heading, and the browser's tab says the same.
  const heading = missing ? 'Verktyget finns inte' : title || (failed ? FAILED_TITLE : null);
  usePageTitle(heading, heading ?? false);
  /** Where a row's own read leads (D116, D126): its own page, with this one as the way back. */
  const hrefFor = (v: ViewRef) => viewOpenHref(views, location.pathname, location.search, v);
  // The way back (a person's page names it the same way): the page the view was opened from, by its name.
  const trail = back && (
    <HStack>
      <WayBack back={back} />
    </HStack>
  );
  // The status vocabulary's notice (D126 item 13): the read failed, and its one move, "Försök igen", stands in it,
  // never behind an "Expandera" (errands.spec, requests.spec).
  const banner = failed && (
    <StatusNotice kind="failed" title={failed.message} action={{ label: 'Försök igen', clickAction: failed.retry }} />
  );
  // One thing (D126 rule 1): the thing's page, as a work item's is drawn.
  const thing = tool?.spec && ONE_THING.has(tool.spec.kind) ? tool : null;
  if (thing?.spec && !missing) {
    const spec = thing.spec;
    const split = hasBody(spec);
    // A record's name is its own title (the supplier, the person); the read it was opened under says what it is.
    const own =
      (spec.kind === 'record' || spec.kind === 'detail') && thing.output && typeof thing.output === 'object'
        ? (thing.output as Record<string, unknown>)[spec.title]
        : undefined;
    const name = typeof own === 'string' && own.trim() ? own : title;
    const part = (which: 'facts' | 'body') => (
      <DeclaredView
        view={spec}
        output={thing.output}
        input={thing.input}
        isLoading={main.isLoading}
        headingLevel={2}
        tableQuery={tableQuery}
        hrefFor={hrefFor}
        part={which}
      />
    );
    // A record with more than its facts reads in the column with the facts beside it (above it where the window is
    // narrow); anything else is its read alone.
    const column = split
      ? part('body')
      : spec.kind === 'record' || spec.kind === 'detail'
        ? part('facts')
        : part('body');
    return (
      // Keyed by the read, so one read's page giving way to another's (a row's contact card, Back to the rows) is a new
      // page that finds the link it was left by on the way back (`useFocusOnTheWayBack`, 2.4.3).
      <Shell key={capability} user={user} nav={nav} height={short ? 'auto' : 'fill'}>
        <PageFrame
          back={back}
          trail={
            <Text type="supporting" color="secondary">
              {[spec.source, name !== title ? title : ''].filter(Boolean).join('\u00a0· ')}
            </Text>
          }
          title={name}
          titleId={TITLE_ID}
          // The thing's actions under its title: a read has none of its own here but the question about it.
          below={
            <VStack gap={4}>
              <HStack gap={2}>{ask}</HStack>
              {banner}
            </VStack>
          }
          label={title || 'Vyn'}
          scrollTabStop
          facts={
            split ? (
              <VStack gap={4}>
                <Heading level={3} accessibilityLevel={2}>
                  Uppgifter
                </Heading>
                {part('facts')}
              </VStack>
            ) : undefined
          }
        >
          <ContentArrival>{column}</ContentArrival>
        </PageFrame>
      </Shell>
    );
  }
  // A register (D126 rule 8): the view draws its own title line with its controls and its count (D74), so the way back
  // and the title stand in the frame's column, on the lines every page's title stands on.
  return (
    <Shell key={capability} user={user} nav={nav} height={short ? 'auto' : 'fill'}>
      <PageFrame label={title || 'Vyn'}>
        <VStack gap={4}>
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
              {title ? (
                !tool?.spec && <PageHeader title={title} titleId={TITLE_ID} end={ask} />
              ) : failed ? (
                <Heading level={1}>{FAILED_TITLE}</Heading>
              ) : (
                <Skeleton height={32} width={200} />
              )}
              {banner}
              {tool ? (
                <ContentArrival>
                  {tool.spec ? (
                    <DeclaredView
                      view={tool.spec}
                      output={tool.output}
                      input={tool.input}
                      isLoading={main.isLoading}
                      headingLevel={2}
                      tableQuery={tableQuery}
                      title={title}
                      titleId={TITLE_ID}
                      pageAction={ask}
                      /* A choice rewrites the address in place, so one step back leaves the page; typed words stay off it (`useViewInput`). */
                      onInput={next => viewInput.onInput(next, tool.spec)}
                      hrefFor={hrefFor}
                    />
                  ) : (
                    /* A read that declares no view (D38) is drawn as the panel draws one: its hits, its rows or its facts. A
                       calendar read's entries lead to their own place in Kalender (D126 rule 1, WA-M2). */
                    <PanelBody
                      output={tool.output}
                      source={tool.source}
                      input={tool.input}
                      hrefFor={hrefFor}
                      {...(placeOfRead(capability)?.surface === 'calendar' ? { entryHref: calendarEntryHref } : {})}
                    />
                  )}
                </ContentArrival>
              ) : (
                // While the view of one person waits for their name, the page is named by the read's own name.
                !failed && <ContentSkeleton heading={false} name={title ? undefined : named || 'Vy'} />
              )}
            </>
          )}
        </VStack>
      </PageFrame>
    </Shell>
  );
}
