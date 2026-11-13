import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Area, SessionUser, Thread, ViewRef } from '@clew/contracts';
import {
  Banner,
  Button,
  Card,
  ChatLayout,
  Grid,
  Heading,
  HStack,
  Icon,
  IconButton,
  Layout,
  LayoutContent,
  LayoutHeader,
  Link,
  MoreMenu,
  Text,
  VStack,
  useAnnounce,
  useEntryAnimation,
  useMediaQuery,
  useToast,
} from '@clew/ui';
import { addDays, displayDate, shortDayLabel, timeLabel, today } from '@clew/calendar/dates';
import { errorMessage, noCalendar } from '../query-policy';
import { areasQuery, assistantQuery, threadsQuery, todayQuery } from '../queries';
import { applyThread } from '../thread-cache';
import { keys } from '../query-keys';
import { groupThreads } from '../stream';
import { useReceiptArrivals } from '../linger';
import { withCard } from '../panel-address';
import { viewOpenHref, type ViewTarget } from '../view-address';
import { needsYouOf, rowFacts, sourcesNotice, todoHref } from '../work-items';
import { Composer } from '../components/composer';
import { PageHeader } from '../components/page-header';
import { titled, useConversation, type ConversationState } from '../components/conversation-context';
import { Transcript } from '../components/conversation';
import { drawn } from '../components/thing-panel';

type EntryStyle = NonNullable<ReturnType<typeof useEntryAnimation>> | undefined;
/**
 * The column fades in when it changes hands (D92): the conversation taking Hem's place when a question is sent, and Hem
 * coming back when the conversation closes. Keyed by whose turn it is, so each hand-over mounts anew and gets Astryx's
 * entry motion; what is on the page from the first paint does not animate, and reduced motion shows it at once.
 */
function Entering({ children }: { children: (entry: EntryStyle) => ReactNode }) {
  const entry = useEntryAnimation('fadeIn');
  return <>{children(entry ?? undefined)}</>;
}
import { toolHref, useRail, type RailCurrent } from '../components/nav';
import { Shell, mobileQuery, shortQuery } from '../components/shell';
import { ReceiptNotice, receiptMessage } from '../components/receipt-notice';
import { BriefSkeleton } from '../components/brief';
import { WorkList, WorkRow } from '../components/work-row';
import { MyErrands } from '../components/my-errands';
import { MyRequests, REQUESTS_CAPABILITY, REQUESTS_TITLE } from '../components/my-requests';
import { MyCommitments } from '../components/my-commitments';
import { AsideSkeleton, AsyncContent } from '../components/loading';
import { usePagePanel } from '../components/page-panel';
import { cardBody } from '../components/card-panel';
import { EventDialog } from '../components/calendar/event-dialog';
import type { AgendaItem } from '@clew/ui';
import { NoCalendar, Today } from '../components/today';
import { SilentNotice, silentLine, useSaySilent, useSilentSources } from '../components/silent-sources';
import { Lage } from '../components/lage';
import { NewsBlock } from '../components/news';
import { FocusNews, focusOf } from '../components/focus-news';
import { Toolbox } from '../components/toolbox';
import { usePageTitle } from '../page-title';
import { useMarks } from '../marks';

/** How many work items Hem shows under "Behöver dig" (D112 item 2): the most urgent; the rest are in Att göra. */
const ON_HEM = 3;
/** The question box's reading width (the `ai-chat-landing` template, board Main): the heading and the box, centred. */
const LANDING_WIDTH = 720;
/**
 * Everything under the box uses the page's width as Personal's does (the product owner, 2026-11-11: the 720 px column
 * was too narrow beside the other pages): the page's 1216 px less its padding, centred in what the panel leaves.
 */
const PAGE_COLUMN = 1216 - 2 * 32;
const EMPTY_THREADS: Thread[] = [];
const EMPTY_AREAS: Area[] = [];

/**
 * The start page (D34, D50, D112). At `/` the column is Hem, the `ai-chat-landing` template (D112 item 2, board Main,
 * amended 2026-11-11 by board Hem10): one heading, the box under it, the one item that asks for the person's read
 * receipt as a callout (Fokusnyhet), and three blocks side by side that stack when narrow: "Behöver dig", the three most
 * urgent work items, "I dag", the day as the calendar family draws it (D32), and "Nyheter", the newest news from the
 * person's news sources. The work list itself is Att göra's (`/todo`). Under the blocks Läget's figures stand for
 * Dialogstöd, then Verktygslådan, the person's tools, and then what D112 keeps as it was until it is decided: Mina
 * ärenden, Beställningar och felanmälningar (D123) and the person's own action points. "Sedan i går" and the suggestions under the box ("Menar du") were removed
 * on 2026-11-13: no digest sentences and no suggestion chips on a page. A work item opened from Hem (a row, "Läs", the
 * day's link to an item) and one thing opened from it (a piece of news, an errand, a budget) are in the panel beside
 * Hem, so the person stays on Hem (D112, amended 2026-11-12); opening it is not asking about it (D111 rule 6). A list or
 * a table opened from Hem (a tile of Läget, an answer's "Visa allt", "Visa allt" under Beställningar och felanmälningar) is its own page, with Hem as the way back (D116).
 * A conversation takes the column at `/conversations/:id` (D31), with what it is about in the panel: the view an answer
 * names, the card or view that was open when it was asked, or the page it was asked on. The address is the state
 * throughout (`panel-address.ts`).
 */
export function StartPage({ user, admin = false }: { user: SessionUser; admin?: boolean }) {
  const mobile = useMediaQuery(mobileQuery);
  // 1.4.10: with 480 px or less in height nothing is docked; the row joins the page and the whole page scrolls (D31 item 7).
  const short = useMediaQuery(shortQuery);
  // Every read is a query (D33): one cache shared by the page, the cards, the rail and the conversation. A mutation writes the thread it returns into it (thread-cache.ts).
  const client = useQueryClient();
  const threadsQ = useQuery(threadsQuery);
  const areasQ = useQuery(areasQuery);
  const dayQ = useQuery(todayQuery);
  const assistantQ = useQuery(assistantQuery);
  const threads = threadsQ.data?.threads ?? EMPTY_THREADS;
  // The first read of the cards (D36): until it is here the page draws their shape, never "nothing needs you".
  const loadingThreads = threadsQ.isPending && !threadsQ.isFetched;
  const loadingAreas = areasQ.isPending && !areasQ.isFetched;
  const areas = areasQ.data?.areas ?? EMPTY_AREAS;
  const day = dayQ.data ?? null;
  const assistant = assistantQ.data ?? null;
  const talk = useConversation();
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams<{ conversationId?: string }>();
  // A card's review lies over the page in its own part of the address (`?review=`, D111 rule 5), which Hem reads past.
  const [search] = useSearchParams();
  const here = location.pathname;
  const conversationId = params.conversationId && params.conversationId !== 'new' ? params.conversationId : null;
  // A view opened from this page (D116): a table or a list is its own page with this one as the way back, anything else
  // is beside the page in the panel.
  const viewHref = (v: ViewTarget & { title: string }) => viewOpenHref(areasQ.data?.views, here, search, v);
  // A work item opened from Hem is beside Hem, in the panel every page has (D112, amended 2026-11-12): `?card=`.
  const cardHref = (threadId: string) => withCard(here, search, threadId);
  // An entry opened from the panel's day view (D32): the same dialog as on the calendar page, over the panel.
  const [openItem, setOpenItem] = useState<{ item: AgendaItem; dayItems: AgendaItem[] } | null>(null);
  const toast = useToast();
  const announce = useAnnounce();
  // A card's own button changed it (in the panel beside Hem or a conversation, in an answer, in the callout): when that
  // took the focused button away, the focus goes to the item's title where the item is beside the page, else back to
  // the box, rather than to nothing (2.4.3). Told before the cache is written.
  const changed = useRef<{ at: number; id: string } | null>(null);
  const replace = useCallback((t: Thread) => {
    changed.current = { at: Date.now(), id: t.id };
  }, []);
  // The conversation changes cards too (a draft, a dismissal): it tells this page first, the same way a card's own button does.
  const { setThreadListener } = talk;
  useEffect(() => {
    setThreadListener(replace);
    return () => setThreadListener(null);
  }, [setThreadListener, replace]);
  useEffect(() => {
    const was = changed.current;
    changed.current = null;
    if (!was || Date.now() - was.at > 2_000 || document.activeElement !== document.body) return;
    // The item in the panel beside the page (`card-<id>`): its title, which the receipt now stands under.
    const beside = document.getElementById(`card-${was.id}-title`);
    if (beside) beside.focus();
    else talk.focus();
  }, [threads]);
  // A receipt that has just arrived (D70): the row keeps its place for a moment, and a toast says where the item went,
  // with the way there and the way back. The toast stays until closed (2.2.1), as the Avfärda toast does.
  const lingering = useReceiptArrivals(threads, thread => {
    const dismiss = toast({
      body: (
        <QueryClientProvider client={client}>
          <ReceiptNotice threadId={thread.id} onChange={replace} dismiss={() => dismiss()} />
        </QueryClientProvider>
      ),
      isAutoHide: false,
      uniqueID: 'receipt:' + thread.id,
    });
    // Astryx says a toast from the text it can read in its body's elements, and the notice draws its words itself from
    // the item as it changes: they are said here, once, as the toast appears (4.1.3).
    if (thread.receipt) announce(receiptMessage({ ...thread, receipt: thread.receipt }));
  });
  const openView = (v: ViewRef) => navigate(viewHref(v));
  const marks = useMarks();
  const now = new Date().toISOString();
  const todayDate = today();
  const all = useMemo(
    () => groupThreads(threads, now, todayDate, undefined, lingering),
    [threads, now.slice(0, 16), todayDate, lingering],
  );
  // What needs the person, in Att göra's order (D34): Hem shows the first three.
  const needsYou = useMemo(() => needsYouOf(all), [all]);
  // Fokusnyhet (D112, amended 2026-11-11): the most urgent item that asks for a read receipt stands above the blocks,
  // and is not a row under them too; any other such item stays an ordinary row.
  const focus = useMemo(() => focusOf(needsYou), [needsYou]);
  const first = useMemo(() => needsYou.filter(t => t.id !== focus?.id).slice(0, ON_HEM), [needsYou, focus]);

  /**
   * The panel (D50): the work item or the view the address names, or in a conversation the card that was open when the
   * question was asked. A work item opened from Hem is beside Hem (D112, amended 2026-11-12), the same `?card=` every
   * page has; only Hem's old tabs lead to Att göra (`todoFromHem`). With nothing open there is no panel. Closed after
   * the item left Hem's rows (its receipt given beside Hem), nothing leads back to it: the focus goes to "Behöver dig".
   */
  const slot = usePagePanel({
    overlayOnly: short,
    failures: 'page',
    onChange: replace,
    onClosed: () => {
      const active = document.activeElement;
      if (active instanceof HTMLElement && active !== document.body && active.isConnected) return;
      const needs = document.getElementById('behover-dig');
      if (needs) needs.focus();
      else talk.focus();
    },
    onOpenItem: (item, dayItems) => setOpenItem({ item, dayItems }),
    // On a conversation's own page the panel is the transcript's artifact (D112 item 7): the conversation's box is the
    // one to ask in, so the thing beside it has none of its own. On Hem a view opened beside it gets its box.
    asks: !talk.open,
  });
  // The page's one alert: a read that failed before it had anything to show. A failed refetch keeps the old data and says nothing; the day and the model's status are extras.
  const failed = [threadsQ, areasQ].find(q => q.isError && q.data === undefined);
  const error = failed ? errorMessage(failed.error, 'Sidan kunde inte läsas.') : (slot.failure?.message ?? null);
  const railCurrent: RailCurrent = { surface: 'start', conversationId };
  const pageTitle = slot.view ? slot.view.title : conversationId ? 'Samtal' : 'Hem';
  // While a card's review lies over Hem it names the document itself (`useOverlayTitle`), and Hem's comes back after it.
  usePageTitle(pageTitle, slot.view || conversationId ? false : pageTitle);
  const nav = useRail({ current: railCurrent, admin, manager: user.role === 'manager' });

  /** A work item an answer is about, drawn in the turn at its narrow width (D112 item 4). */
  const card = (t: Thread) => cardBody(t, { place: 'answer', level: 2, compact: mobile, onChange: replace });
  const assistantDown = !!assistant && assistant.configured && !assistant.available;
  const sources = threadsQ.data?.sources;
  // A source not read yet is said where the work is, and the page never says that nothing needs the person then; one
  // that does not answer is said on its own rows, and here only when nothing is left to draw (D116, amended 2026-11-12).
  const sourcesLine = sourcesNotice(sources);
  const silent = useSilentSources();
  const say = useSaySilent();
  /**
   * The day's calendar (D116, amended 2026-11-12). The person has none when the registry does not show it to them (D23)
   * or their account has none bound; then "I dag" says so, without a warning. A day that cannot be read otherwise is the
   * calendar not answering: said in the block, since when it last answered (its status with the cards, else this page's
   * last read of the day), with "Försök igen", and once in the session aloud.
   */
  const systems = areasQ.data?.systems;
  const calendarHidden =
    (!!systems && !systems.some(s => s.connector === 'calendar')) || noCalendar(dayQ.error) === 'hidden';
  const withoutCalendar = calendarHidden || noCalendar(dayQ.error) === 'unbound';
  const calendarSilent = dayQ.isError && !withoutCalendar;
  const calendarName = marks.system('calendar')?.source ?? 'Kalendern';
  const calendarSince = silent.of('calendar')?.since ?? (dayQ.data ? new Date(dayQ.dataUpdatedAt).toISOString() : null);
  useEffect(() => {
    if (calendarSilent && silent.named) say([{ connector: 'calendar', source: calendarName }]);
  }, [calendarSilent, silent.named, calendarName, say]);

  // The box's context for `@`: the work items Hem shows.
  const near = [...(focus ? [focus] : []), ...first].map(t => 'thread:' + t.id);
  // On a phone the box is docked at the foot (G on the phone): the heading sits right above it.
  const docked = mobile && !short;
  /**
   * "Behöver dig" (D112 item 2, board Main): the three most urgent work items as rows, each opening the item in the
   * panel beside Hem (amended 2026-11-12), marked while it is open there, and the way to all of them in Att göra. While
   * the cards load the block keeps its shape.
   */
  const needsBlock = (
    <Card padding={4}>
      <VStack gap={1} as="section" aria-labelledby="behover-dig">
        <HStack justify="between" vAlign="center" gap={2} wrap="wrap">
          <Heading id="behover-dig" tabIndex={-1} level={3} accessibilityLevel={2}>
            Behöver dig
          </Heading>
          {!loadingThreads && (
            <Text type="supporting" weight="medium">
              <Link href={todoHref({})} color="primary" hasUnderline>
                {`Alla ${needsYou.length} i Att göra`}
              </Link>
            </Text>
          )}
        </HStack>
        <AsyncContent pending={loadingThreads} fallback={<BriefSkeleton compact />}>
          {sourcesLine && (
            <Text as="p" role="status">
              {sourcesLine}
            </Text>
          )}
          {first.length === 0 ? (
            <VStack gap={1}>
              <Text as="p" color="secondary">
                {sourcesLine || silent.list.length
                  ? 'Inväntar källornas besked.'
                  : focus
                    ? 'Inget mer behöver dig just nu.'
                    : 'Inget behöver dig just nu.'}
              </Text>
              {/* With nothing to draw, the system that does not answer is named where its work items would be. */}
              {silent.list.length > 0 && (
                <Text as="p" type="supporting">
                  {`${silent.list.map(silentLine).join('. ')}.`}
                </Text>
              )}
            </VStack>
          ) : (
            <WorkList label="Behöver dig">
              {first.map(t => (
                <WorkRow
                  key={t.id}
                  thread={t}
                  facts={rowFacts(t, now, todayDate)}
                  source={marks.ofThread(t).source}
                  href={cardHref(t.id)}
                  isSelected={slot.card?.id === t.id}
                />
              ))}
            </WorkList>
          )}
        </AsyncContent>
      </VStack>
    </Card>
  );
  /**
   * "I dag" (board Main): the day as the calendar family draws it (D32), with the way to Kalender. It is always drawn: a
   * day that cannot be read says why in the block (D116, amended 2026-11-12) instead of leaving its place to the others.
   */
  const dayBlock = (
    <AsyncContent pending={loadingThreads || (dayQ.isPending && !calendarHidden)} fallback={<AsideSkeleton />}>
      <Today
        view={withoutCalendar ? null : day}
        threads={threads}
        cardHref={cardHref}
        calendar={!withoutCalendar}
        notice={
          withoutCalendar ? (
            <NoCalendar hidden={calendarHidden} />
          ) : calendarSilent ? (
            <SilentNotice
              silent={{ source: calendarName, since: calendarSince }}
              retrying={dayQ.isFetching}
              onRetry={() => void dayQ.refetch()}
            />
          ) : undefined
        }
      />
    </AsyncContent>
  );
  // The landing (D112 item 2, amended 2026-11-11, board Hem10): one heading, the box under it (docked at the foot on a
  // phone), the item that asks for a read receipt, the three blocks, Läget, Verktygslådan, and under them what D112 keeps
  // until it is decided. The box is anchored under the heading (D53).
  const landing = () => (
    <VStack gap={8}>
      {/* The heading and the box at their reading width, centred over the page's full width. */}
      <VStack hAlign="center">
        <VStack gap={mobile ? 3 : 6} as="section" aria-label="Vad vill du göra" width="100%" maxWidth={LANDING_WIDTH}>
          <Heading level={1} id="hem" tabIndex={-1} justify="center">
            Vad vill du få gjort?
          </Heading>
          {!docked && <Composer place="landing" near={near} roomy />}
        </VStack>
      </VStack>
      {error && (
        <Text as="p" role="alert" color="accent">
          {error}
        </Text>
      )}
      {/* Fokusnyhet (board Hem10): between the box and the blocks, while an item asks for the person's read receipt. */}
      {focus && <FocusNews thread={focus} href={cardHref(focus.id)} onChange={replace} />}
      {/* The three blocks side by side where they fit, one under the other where they do not; news without a source
          leaves its place to the others, while the day is always drawn and says why when it cannot be read. */}
      <Grid columns={{ minWidth: 280, max: 3, repeat: 'fit' }} gap={4} align="start">
        {needsBlock}
        {dayBlock}
        <NewsBlock hrefFor={viewHref} />
      </Grid>
      {/* Dialogstöd's figures are Läget (D54), its heading leading to the unit's page; then the person's tools. */}
      <Lage
        areas={areas}
        loading={loadingAreas}
        sources={sources}
        now={now}
        unitLabel={user.unitLabel}
        unitId={user.unitId || undefined}
        // A tile leads where every other way to a tool leads, the tool's page (D42), when the view is a tool in the
        // person's menu; any other view opens as a view opened from a page does (D116): a table or a list to its own
        // page with Hem as the way back, anything else beside Hem in the panel.
        viewHref={(capability, title) =>
          areasQ.data?.menu?.some(e => e.capability === capability)
            ? toolHref(capability)
            : viewHref({ capability, title })
        }
        twoAcross={mobile}
      />
      <Toolbox />
      {/* What D112 keeps as it was until decided, under the board's parts: Mina ärenden (D90), what the person ordered
          or reported and waits for, apart from the errands they handle (D123), and the person's own action points (D96
          item 7). */}
      <MyErrands areas={areas} hrefFor={viewHref} />
      <MyRequests
        areas={areas}
        hrefFor={viewHref}
        listHref={viewHref({ capability: REQUESTS_CAPABILITY, title: REQUESTS_TITLE })}
      />
      <MyCommitments />
    </VStack>
  );
  /**
   * The landing in the page's column, bounded and centred as Personal's is (a `VStack` with a `maxWidth` in one that
   * centres it), not with the Layout's `contentWidth`, which would frame the shared panel with it: the panel in the
   * page's end slot keeps the page's edge.
   */
  const column720 = (padding: 2 | 8) => (
    <VStack hAlign="center" padding={padding}>
      <VStack width="100%" maxWidth={PAGE_COLUMN} paddingBlockStart={mobile ? 0 : 6} paddingBlockEnd={6}>
        {landing()}
      </VStack>
    </VStack>
  );
  /** The card open beside a conversation: the one that was open when the question was asked. */
  const panelCard = slot.card;

  /** When the person asked the conversation's first question: H1's line beside the title. "Nytt samtal i stället" sits in the box's scope line. */
  const started = (state: ConversationState) => {
    const first = state.conversation?.messages.find(m => m.role === 'user');
    if (!first) return null;
    const at = displayDate(first.createdAt);
    return at === todayDate
      ? timeLabel(first.createdAt)
      : `${at === addDays(todayDate, -1) ? 'i går' : shortDayLabel(at)} ${timeLabel(first.createdAt)}`;
  };
  /**
   * The conversation's page header (D74): its title as the page's h1 and, at the end of the line, when it was started
   * and the way out; on a phone the close button and the more menu with Nytt samtal. Pinned in the `LayoutHeader`, and in
   * the flow on a short screen, where nothing is pinned.
   */
  const conversationHeader = (
    <PageHeader
      title={titled(talk.conversation?.title ?? talk.pending?.text.slice(0, 80) ?? '')}
      end={
        mobile ? (
          <HStack gap={1} vAlign="center">
            <IconButton
              size="sm"
              variant="ghost"
              label="Stäng samtalet"
              icon={<Icon icon="close" />}
              onClick={talk.close}
            />
            <MoreMenu
              label="Fler val"
              size="sm"
              variant="ghost"
              items={[{ id: 'new', label: 'Nytt samtal', onClick: talk.newConversation }]}
            />
          </HStack>
        ) : (
          <HStack gap={2} vAlign="center">
            {started(talk) && <Text type="supporting">Startat av dig {started(talk)}</Text>}
            <Button
              size="sm"
              variant="ghost"
              label="Stäng samtalet"
              endContent={<Icon icon="close" size="sm" />}
              onClick={talk.close}
            />
          </HStack>
        )
      }
    />
  );
  // The card beside the transcript is not drawn again in the turn that is about it: one card, one place.
  // An assistant's draft (D112 item 8) opens in its work item's dialog: the item is drawn beside the transcript first
  // when it is on the page nowhere (not beside it, not in a turn), and its dialog opens once it is.
  const transcript = (
    <Transcript
      onOpenView={openView}
      renderCard={t => (panelCard?.id === t.id ? null : card(t))}
      viewHref={viewHref}
      onDraft={draft => {
        if (!drawn(draft.threadId)) navigate(withCard(here, search, draft.threadId));
      }}
    />
  );

  /** What the column holds: the transcript when a conversation is open (D31), else Hem. The panel is the Layout's end. */
  const column = (entry: EntryStyle) => {
    if (talk.open)
      return short ? (
        <VStack gap={4} padding={3} xstyle={entry}>
          {conversationHeader}
          {transcript}
          <Composer place="conversation" />
        </VStack>
      ) : (
        // The same gutter as every page (D74 item 3): the Layout's padding reaches the header, so the title stands 32 px in
        // from the rail and 32 px down on a desktop, 12 on a phone.
        <Layout
          xstyle={entry}
          height="fill"
          padding={mobile ? 3 : 8}
          defaultHasDividers
          header={<LayoutHeader>{conversationHeader}</LayoutHeader>}
          end={slot.end}
          content={
            <LayoutContent isScrollable={false} padding={0}>
              {/* The ChatLayout spans the content area full bleed and owns the scroll, so its scrollbar sits at the column's edge like a page's. The transcript and the dock take the width Hem's content has, 32 px in from the rail like the title (the product owner, 2026-11-06: the same width as the start page; D74), not a centred column. */}
              <VStack height="100%" paddingInline={mobile ? 0 : 8}>
                <ChatLayout density="balanced" composer={<Composer place="conversation" />}>
                  {transcript}
                </ChatLayout>
              </VStack>
            </LayoutContent>
          }
        />
      );
    // Hem (D112 item 2): the landing in the template's column, the panel beside it only while a view is open; on a
    // phone the box is docked at the foot, and on a short screen nothing is docked.
    return short ? (
      <VStack gap={4} padding={3} xstyle={entry}>
        {landing()}
      </VStack>
    ) : (
      <Layout
        xstyle={entry}
        height="fill"
        padding={0}
        end={slot.end}
        content={
          docked ? (
            // On a phone the box floats over the content (the product owner, 2026-11-07): ChatLayout docks it in the
            // frosted-glass layer the page scrolls under, as the conversation already has it. ChatLayout owns the
            // scroll here, with no scroll-to-bottom button: Hem is read from the top.
            <LayoutContent isScrollable={false} padding={0}>
              {/* The bounded height is what makes ChatLayout the scroll container, as the conversation composes it. */}
              <VStack height="100%">
                <ChatLayout density="balanced" scrollButton={null} composer={<Composer place="landing" near={near} />}>
                  {column720(2)}
                </ChatLayout>
              </VStack>
            </LayoutContent>
          ) : (
            <LayoutContent isScrollable padding={0}>
              {column720(8)}
            </LayoutContent>
          )
        }
      />
    );
  };

  return (
    <>
      <KeepFocus open={talk.open} focus={talk.focus} />
      <Shell
        user={user}
        nav={nav}
        height={short ? 'auto' : 'fill'}
        /* Page level (D8): one Banner in the shell's banner slot when the model is configured but not answering. Everything that is not prose keeps working. */
        banner={
          assistantDown ? (
            <Banner
              status="warning"
              container="section"
              collapsible={false}
              title="Modellen svarar inte just nu."
              description="Knapparna, ärendena, pushen och kalendern fungerar som vanligt. Rutan hittar bara exakta saker, och frågor i fri text väntar tills modellen är tillbaka."
              endContent={
                <Button
                  size="sm"
                  variant="secondary"
                  label="Försök igen"
                  clickAction={() => client.invalidateQueries()}
                />
              }
            />
          ) : undefined
        }
      >
        <Entering key={talk.open ? 'conversation' : 'hem'}>{column}</Entering>
      </Shell>
      {slot.overlay}
      <EventDialog
        item={openItem?.item ?? null}
        dayItems={openItem?.dayItems ?? []}
        onClose={() => setOpenItem(null)}
        /* The day in the panel and every loaded week are read again; a moved proposal's thread goes into the cache like any other answer. */
        onChanged={t => {
          if (t) {
            replace(t);
            void applyThread(client, t);
          }
          void client.invalidateQueries({ queryKey: keys.viewAll });
          void client.invalidateQueries({ queryKey: keys.calendarAll });
        }}
      />
    </>
  );
}

/**
 * The box keeps focus across the transcript opening and closing (D31). The composer moves between the page flow on the
 * landing and the dock of a conversation, so it remounts on each change of `open`; the focus the old instance held is
 * given to the new one after the commit. A conversation asked on another page arrives with its transcript already
 * open: the box here takes the focus the page's own box had (D50).
 */
function KeepFocus({ open, focus }: { open: boolean; focus: () => void }) {
  // Only a change of `open` moves the focus. `focus` is a new function on every render of the conversation's context,
  // so following it as well took the focus into the box on Hem's second render, past the skip link and the header.
  const last = useRef<boolean | null>(null);
  const focusRef = useRef(focus);
  focusRef.current = focus;
  useEffect(() => {
    const before = last.current;
    last.current = open;
    if (before === null ? open : before !== open) focusRef.current();
  }, [open]);
  return null;
}
