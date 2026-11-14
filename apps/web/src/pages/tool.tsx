import { useEffect } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { SessionUser, ViewRef } from '@clew/contracts';
import type { PanelViewSpec } from '@clew/contracts';
import {
  ArrowLeftIcon,
  Banner,
  Button,
  EmptyState,
  Heading,
  HStack,
  Icon,
  Layout,
  LayoutContent,
  LayoutHeader,
  LayoutPanel,
  Link,
  ScrollableArea,
  Skeleton,
  Text,
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
import { placeOfRead, useRail, type RailCurrent } from '../components/nav';
import { DeclaredView } from '../components/view';
import { PanelBody, answersWithRowsOf } from '../components/panel';
import { useView, viewSubject } from '../components/page-panel';
import { AskClew } from '../components/thing-panel';
import { narrowItemQuery } from '../components/work-item';
import { PageHeader } from '../components/page-header';
import { ContentArrival, ContentSkeleton } from '../components/loading';

/** The table needs 970 px beside the rail, so a 1280 px laptop gets it, with a scrollbar too; a narrower window draws the same rows as a list. */
const tableQuery = '(min-width: 1280px)';
/** The kinds of read that are one thing (D126 rule 1): drawn as a thing's page, not as a register. */
const ONE_THING: ReadonlySet<PanelViewSpec['kind']> = new Set(['record', 'detail', 'document', 'text']);
/** A record whose read has more than its facts: the column holds the read and the end panel the facts. */
const hasBody = (spec: PanelViewSpec) =>
  spec.kind === 'record' && !!(spec.document || spec.items || spec.metrics || spec.series || spec.activity);
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
 * Where the rail stands on a view's page that is neither a tool of its own nor a read of a connector with a place in
 * the rail (`placeOfRead`): on the place the view was opened from, as a work item's page does (`item.tsx`); with no
 * such place, on nothing.
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
 * A view as a page (D42, D116, D126), at `/tools/:capability`, inside the one shell, as Kalender is. Every read the
 * person may open has this page, whether or not an administrator placed it in the rail (D40). The address says what is
 * shown: `input` what the read is asked, `title` the name it was opened under, `from` the page it was opened from, whose
 * name is the way back at the top of the page (a person's page names its way back the same way) and where the rail
 * stands when the view is no tool of its own. A read the person may not open, and one that does not exist, both say
 * "Verktyget finns inte" and nothing else, and are not asked for.
 * A list or a table is a register (D126 rule 8, board Personal, the `table-page` template): the name as the heading
 * with the system's badge and "Fråga Clew" on its line, the view's own search field and choice and the count under it,
 * then the rows. The name in a row is the link to the row's own read, its page (rule 4); a row never opens a panel.
 * One thing (a record, a contact card, a text, a document) is a thing's page (rule 1, the `work-item-detail`
 * template): the way back and the title, "Fråga Clew" under it, the read in the column and a record's facts in the end
 * panel, above the read where the window is narrow. The view is drawn by the one renderer (D38).
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
  // The directory is asked by Clew's key, the person's id (D122): the address's `of` where the opener knew it, else the
  // input's own key, which is the id of a person without a user name. Until both have answered the heading waits; a
  // person the directory does not answer for keeps the read's own name.
  const whose = !entry && search.get('title') === null ? (search.get('of') ?? personOf(inputJson)) : null;
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
  // A tool in the rail marks its row; a read of a connector with a place of its own in the rail (Kompetens, Kalender)
  // marks that place wherever it was opened from; any other view the place it was opened from.
  const nav = useRail({
    current: entry ? { surface: 'verktyg', view: capability } : (placeOfRead(capability) ?? placeOf(from)),
    admin,
    manager: user.role === 'manager',
  });
  const tool = main.shown?.capability === capability ? main.shown : null;
  // "Fråga Clew" (D126 rule 5): a new conversation about the view as it stands; a list goes as its chip alone, one
  // thing stands beside the conversation.
  const subject =
    ready && title
      ? viewSubject(
          { capability, title, input: main.shown?.input ?? {} },
          opensAsPage(views, capability) || answersWithRowsOf(tool?.spec, tool?.output),
        )
      : null;
  const ask = <AskClew subject={subject} />;
  const heading = missing ? 'Verktyget finns inte' : title || null;
  usePageTitle(heading, heading ?? false);
  const narrow = useMediaQuery(narrowItemQuery);
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
  /** Where a row's own read leads (D116, D126): its own page, with this one as the way back. */
  const hrefFor = (v: ViewRef) => viewOpenHref(views, location.pathname, location.search, v);
  // The way back (a person's page names it the same way): the page the view was opened from, by its name.
  const trail = back && (
    <HStack>
      <Link href={back.href} type="supporting" color="secondary">
        <HStack as="span" gap={1} vAlign="center">
          <Icon icon={ArrowLeftIcon} size="sm" />
          {back.label}
        </HStack>
      </Link>
    </HStack>
  );
  const banner = failed && (
    <Banner status="error" title={failed.message}>
      <Button label="Försök igen" size="sm" variant="secondary" onClick={failed.retry} />
    </Banner>
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
    // A record with more than its facts reads in the column with the facts beside it; anything else is its read alone.
    const column = split ? (
      <VStack gap={6}>
        {narrow && part('facts')}
        {part('body')}
      </VStack>
    ) : spec.kind === 'record' || spec.kind === 'detail' ? (
      part('facts')
    ) : (
      part('body')
    );
    return (
      <Shell user={user} nav={nav} height={short ? 'auto' : 'fill'}>
        <Layout
          height={short ? 'auto' : 'fill'}
          header={
            <LayoutHeader padding={mobile ? 4 : 6} hasDivider>
              <VStack gap={4}>
                <VStack gap={2}>
                  <HStack gap={4} vAlign="center" wrap="wrap">
                    {trail}
                    <Text type="supporting" color="secondary">
                      {[spec.source, name !== title ? title : ''].filter(Boolean).join('\u00a0· ')}
                    </Text>
                  </HStack>
                  <Heading level={1} id={TITLE_ID} tabIndex={-1}>
                    {name}
                  </Heading>
                </VStack>
                {/* The thing's actions under its title: a read has none of its own here but the question about it. */}
                <HStack gap={2}>{ask}</HStack>
                {banner}
              </VStack>
            </LayoutHeader>
          }
          content={
            short ? (
              <LayoutContent padding={mobile ? 4 : 6}>
                <ContentArrival>{column}</ContentArrival>
              </LayoutContent>
            ) : (
              <LayoutContent padding={0} isScrollable={false}>
                <ScrollableArea label={title || 'Vyn'} height="100%" padding={mobile ? 4 : 6}>
                  <ContentArrival>{column}</ContentArrival>
                </ScrollableArea>
              </LayoutContent>
            )
          }
          end={
            split && !narrow ? (
              <LayoutPanel
                width={340}
                padding={6}
                role="complementary"
                label="Uppgifter"
                hasDivider
                isScrollable={!short}
              >
                <VStack gap={4}>
                  <Heading level={3} accessibilityLevel={2}>
                    Uppgifter
                  </Heading>
                  {part('facts')}
                </VStack>
              </LayoutPanel>
            ) : undefined
          }
        />
      </Shell>
    );
  }
  return (
    <Shell user={user} nav={nav} height={short ? 'auto' : 'fill'}>
      {/* `padding={0}` on the content and the padding on the stack is the template's way to keep a table on the heading's line. The title stands 32 px in from the rail and 32 px down, as on every page (D74). */}
      <Layout
        height={short ? 'auto' : 'fill'}
        padding={mobile ? 3 : 8}
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
                    ? !tool?.spec && <PageHeader title={title} titleId={TITLE_ID} end={ask} />
                    : !failed && <Skeleton height={32} width={200} />}
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
                          /* The view's controls rewrite the address in place, so a search is addressable and one step back leaves the page. */
                          onInput={next =>
                            navigate(withViewInput(location.pathname, location.search, next), { replace: true })
                          }
                          hrefFor={hrefFor}
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
    </Shell>
  );
}
