import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useParams } from 'react-router';
import { QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { unresolvedExecution, type Area, type SessionUser, type Thread } from '@clew/contracts';
import {
  Badge,
  Banner,
  Button,
  Card,
  Grid,
  Heading,
  HStack,
  Layout,
  LayoutContent,
  LayoutHeader,
  Link,
  List,
  StackItem,
  Text,
  VStack,
  useAnnounce,
  useEntryAnimation,
  useMediaQuery,
  useToast,
} from '@clew/ui';
import { dayLabel, today } from '@clew/calendar/dates';
import { errorMessage, noCalendar } from '../query-policy';
import { areasQuery, assistantQuery, threadsQuery, todayQuery } from '../queries';
import { groupThreads } from '../stream';
import { useReceiptArrivals } from '../linger';
import { declaredPage, viewPageHref, type ViewTarget } from '../view-address';
import { itemPageHref, needsYouOf, rowFacts, sourcesNotice, todoHref } from '../work-items';
import { DOT } from '../dot';
import { Composer } from '../components/composer';
import { useConversation } from '../components/conversation-context';
import { ConversationPage, conversationTitle } from './conversation';

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
import { LinkRow } from '../components/work-row';
import { MyCommitments } from '../components/my-commitments';
import { NoCalendar, TodayCard, TodayCardSkeleton, TodayHeading } from '../components/today';
import { SilentNotice, silentLine, staleWhy, useSaySilent, useSilentSources } from '../components/silent-sources';
import { Lage } from '../components/lage';
import { NewsBlock } from '../components/news';
import { FocusNews, focusOf } from '../components/focus-news';
import { usePageTitle } from '../page-title';
import { useMarks } from '../marks';

/** How many work items Hem shows under "Behöver dig" (board Hem): the most urgent; every one is in Att göra. */
const ON_HEM = 4;
/** Hem's column (board Hem): the greeting, the box and the blocks share one width, centred in the page. */
export const HEM_WIDTH = 1120;
/** Hem's address, the way back from every page Hem leads to (D116). */
const HEM = '/';
const EMPTY_THREADS: Thread[] = [];
const EMPTY_AREAS: Area[] = [];

const hourIn = new Intl.DateTimeFormat('sv-SE', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Europe/Stockholm' });
/** The greeting at the top of Hem (board Hem): the time of day in Stockholm and the person's first name. */
export function greetingOf(name: string, at: Date): string {
  const hour = Number(hourIn.format(at));
  const words = hour < 10 ? 'God morgon' : hour < 12 ? 'God förmiddag' : hour < 18 ? 'God eftermiddag' : 'God kväll';
  const first = name.trim().split(/\s+/)[0];
  return first ? `${words}, ${first}` : words;
}
/** The line under the greeting: the day ("Fredag 14 november") and the person's unit. */
const dayLine = (date: string, unit: string) => {
  const day = dayLabel(date);
  return [day.charAt(0).toLocaleUpperCase('sv-SE') + day.slice(1), unit].filter(Boolean).join(DOT);
};

/**
 * The start page (D34, D50, D112, D126). At `/` the column is Hem (D126, board Hem): the greeting and the day, the box
 * once under them, and then the blocks, each a heading over its card that leads to its place: "Behöver dig", the most
 * urgent work items, beside "I dag", the day as the calendar family draws it (D32); for a manager "Läget på <enhet>",
 * the unit's figures as tiles; then "Nyheter". The item that asks for the person's read receipt stands above the blocks
 * as one callout (Fokusnyhet). Under them the person's own action points (D96 item 7), drawn as a block, until they are
 * rows in Att göra. No digest sentences, no suggestion chips and no tool tiles (D126 rule 8): the tools are in the rail
 * and on Alla verktyg, and Mina ärenden (D90) and what the person ordered or reported (D123) are two of them. Every row
 * and tile leads to the page of what it names (D126 rule 1), with Hem as the way back; nothing opens over Hem, and an
 * address that opened something beside it before leads to that thing's page (the shell's `PanelOverPage`, rule 3).
 *
 * A conversation takes the column at `/conversations/:id` (D31), with what it is about in the panel beside it (rule 2):
 * the view an answer names, the card or view that was open when it was asked, or the page it was asked on. The address
 * is the state throughout (`panel-address.ts`).
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
  const views = areasQ.data?.views;
  const day = dayQ.data ?? null;
  const assistant = assistantQ.data ?? null;
  const talk = useConversation();
  const params = useParams<{ conversationId?: string }>();
  const conversationId = params.conversationId && params.conversationId !== 'new' ? params.conversationId : null;
  /**
   * Where a view named on Hem leads (D126 rule 1): the page Clew's own read declares for its rows, else the view's own
   * page, with Hem as the way back.
   */
  const pageHref = (v: ViewTarget) => declaredPage(views, v.capability, v.input) ?? viewPageHref(v, HEM);
  /** A work item named on Hem: its own page (D112 item 4, D126 rule 1), with Hem as the way back. */
  const itemHref = (threadId: string) => itemPageHref(threadId, HEM);
  const toast = useToast();
  const announce = useAnnounce();
  // A card's own button changed it (in the pane beside a conversation, in an answer, in the callout): when that took
  // the focused button away, the focus goes to the item's title where the item is beside the transcript, else back to
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
    // The item in the pane beside the transcript (`card-<id>`): its title, which the receipt now stands under.
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
  const marks = useMarks();
  const now = new Date().toISOString();
  const todayDate = today();
  const all = useMemo(
    () => groupThreads(threads, now, todayDate, undefined, lingering),
    [threads, now.slice(0, 16), todayDate, lingering],
  );
  // What needs the person, in Att göra's order (D34): Hem shows the first few.
  const needsYou = useMemo(() => needsYouOf(all), [all]);
  // Fokusnyhet (D112, amended 2026-11-11): the most urgent item that asks for a read receipt stands above the blocks,
  // and is not a row under them too; any other such item stays an ordinary row.
  const focus = useMemo(() => focusOf(needsYou), [needsYou]);
  const first = useMemo(() => needsYou.filter(t => t.id !== focus?.id).slice(0, ON_HEM), [needsYou, focus]);

  // The page's one alert: a read that failed before it had anything to show. A failed refetch keeps the old data and says nothing; the day and the model's status are extras.
  const failed = [threadsQ, areasQ].find(q => q.isError && q.data === undefined);
  const error = failed ? errorMessage(failed.error, 'Sidan kunde inte läsas.') : null;
  const railCurrent: RailCurrent = { surface: 'start', conversationId };
  // A conversation is named by its question; the log speaks its answers and the box keeps the focus, so the change of
  // title is not spoken as Hem's is.
  const pageTitle = talk.open ? conversationTitle(talk) : 'Hem';
  usePageTitle(pageTitle, talk.open ? false : pageTitle);
  const manager = user.role === 'manager';
  const nav = useRail({ current: railCurrent, admin, manager });

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
  /**
   * A work item's supporting line on Hem (board Hem): the system it comes from and why it is here. A system of Clew's
   * own (an owned domain such as introductions, the house mark of D71: a known system without an ordinal) is not named,
   * since the whole page is Clew's: the reason alone. Its state in words where the pile and the due badge do not already
   * say it: "Ska göras" is what every row under Behöver dig is, so only another state is named (a proposal, a notice, a
   * reminder, an action that waits on its source or needs a check). An open item whose system does not answer says at
   * the end that it may be old (D116, amended 2026-11-12).
   */
  const lineOf = (t: Thread) => {
    const facts = rowFacts(t, now, todayDate);
    const mark = marks.ofThread(t);
    const own = !!marks.system(mark.connector) && mark.ordinal === null;
    const stale = t.state === 'open' && !!silent.of(t.connector);
    const state = facts.state.label.startsWith('Ska göras') && !unresolvedExecution(t) ? null : facts.state.label;
    return [own ? null : mark.source, state, stale ? staleWhy(facts.why) : facts.why].filter(Boolean).join(DOT);
  };
  /**
   * "Behöver dig" (D112 item 2; D126, board Hem): the most urgent work items as rows in a card, the count beside the
   * heading and the way to all of them in Att göra. A row's title is the link to the item's page and its due day the
   * badge at its end. While the cards load the block keeps its shape; with nothing to draw it says so in the card, which
   * ends level with I dag's beside it.
   */
  const needsBlock = (
    <VStack gap={3} as="section" aria-labelledby="behover-dig">
      <HStack justify="between" vAlign="center" gap={2} wrap="wrap">
        <HStack gap={2} vAlign="center">
          <Heading id="behover-dig" tabIndex={-1} level={2}>
            Behöver dig
          </Heading>
          {!loadingThreads && needsYou.length > 0 && <Badge variant="error" label={String(needsYou.length)} />}
        </HStack>
        {!loadingThreads && <Link href={todoHref({})}>Visa alla</Link>}
      </HStack>
      <RowCard pending={loadingThreads} fallback={<BriefSkeleton compact />}>
        <Card padding={0} height="100%">
          {(sourcesLine || first.length === 0) && (
            <VStack gap={1} padding={4}>
              {sourcesLine && (
                <Text as="p" role="status">
                  {sourcesLine}
                </Text>
              )}
              {first.length === 0 && (
                <Text as="p" color="secondary">
                  {sourcesLine || silent.list.length
                    ? 'Inväntar källornas besked.'
                    : focus
                      ? 'Inget mer behöver dig just nu.'
                      : 'Inget behöver dig just nu.'}
                </Text>
              )}
              {/* With nothing to draw, the system that does not answer is named where its work items would be. */}
              {first.length === 0 && silent.list.length > 0 && (
                <Text as="p" type="supporting">
                  {`${silent.list.map(silentLine).join('. ')}.`}
                </Text>
              )}
            </VStack>
          )}
          {first.length > 0 && (
            <List hasDividers aria-label="Behöver dig">
              {first.map(t => {
                const due = rowFacts(t, now, todayDate).due;
                return (
                  <LinkRow
                    key={t.id}
                    id={`work-${t.id}`}
                    itemKey={t.id}
                    href={itemHref(t.id)}
                    title={t.title}
                    description={lineOf(t)}
                    descriptionLines={0}
                    endContent={due ? <Badge variant={due.variant} label={due.label} /> : undefined}
                  />
                );
              })}
            </List>
          )}
        </Card>
      </RowCard>
    </VStack>
  );
  /**
   * "I dag" (board Hem): the day as the calendar family draws it (D32), with the way to Kalender. It is always drawn: a
   * day that cannot be read says why in the block (D116, amended 2026-11-12) instead of leaving its place to the others.
   * Its card ends level with Behöver dig's beside it.
   */
  const dayBlock = (
    <VStack gap={3} as="section" aria-labelledby="i-dag">
      <TodayHeading calendar={!withoutCalendar} />
      <RowCard pending={loadingThreads || (dayQ.isPending && !calendarHidden)} fallback={<TodayCardSkeleton />}>
        <TodayCard
          view={withoutCalendar ? null : day}
          threads={threads}
          itemHref={itemHref}
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
      </RowCard>
    </VStack>
  );
  /** The greeting, the day and the unit, and the box once under them (board Hem); the box is anchored under the heading (D53). */
  const greeting = (
    <VStack gap={4}>
      <VStack gap={1}>
        <Heading level={1} id="hem" tabIndex={-1}>
          {greetingOf(user.name, new Date())}
        </Heading>
        <Text type="supporting" color="secondary">
          {dayLine(todayDate, user.unitLabel)}
        </Text>
      </VStack>
      <Composer place="landing" near={near} />
    </VStack>
  );
  /** Hem's blocks (board Hem), in its order: the callout, the two blocks side by side, Läget, Nyheter, the action points. */
  const blocks = (
    <VStack gap={8}>
      {error && (
        <Text as="p" role="alert" color="accent">
          {error}
        </Text>
      )}
      {/* Fokusnyhet (board Hem10): one callout above the blocks, while an item asks for the person's read receipt. */}
      {focus && <FocusNews thread={focus} href={itemHref(focus.id)} onChange={replace} />}
      {/* The two blocks side by side where they fit, one under the other where they do not. */}
      <Grid columns={{ minWidth: 380, max: 2 }} gap={6}>
        {needsBlock}
        {dayBlock}
      </Grid>
      {/* Läget (D54, D117): a manager's unit, each tile leading to the page of what it counts. */}
      {manager && (
        <Lage
          areas={areas}
          loading={loadingAreas}
          unitLabel={user.unitLabel}
          unitId={user.unitId || undefined}
          // A tile leads where every other way to a tool leads, the tool's page (D42), when the view is a tool in the
          // person's menu; any other view to its own page with Hem as the way back (D126 rule 1).
          tileHref={(capability, title) =>
            areasQ.data?.menu?.some(e => e.capability === capability)
              ? toolHref(capability)
              : pageHref({ capability, title })
          }
        />
      )}
      <NewsBlock hrefFor={pageHref} />
      {/* The person's own action points (D96 item 7), under the board's parts and drawn as its blocks are, until they
          are rows in Att göra; Mina ärenden (D90) is a tool in the rail (D126 rule 8). */}
      <MyCommitments />
    </VStack>
  );
  /** What the column holds: the conversation's page when a conversation is open (D31, D126 rule 5), else Hem. */
  const column = (entry: EntryStyle) => {
    if (talk.open) return <ConversationPage entry={entry} onChange={replace} width={HEM_WIDTH} />;
    // Hem (D126, board Hem): the greeting and the box in the Layout's header, pinned while the blocks scroll under them,
    // in one column of the board's width. On a phone and on a short screen nothing is pinned (1.4.10): the Layout grows
    // with its content and the shell's main region scrolls the whole page.
    const pinned = !mobile && !short;
    return (
      <Layout
        xstyle={entry}
        height={pinned ? 'fill' : 'auto'}
        contentWidth={HEM_WIDTH}
        header={
          <LayoutHeader padding={mobile ? 4 : 6} paddingBlockEnd={0}>
            {greeting}
          </LayoutHeader>
        }
        content={
          <LayoutContent padding={mobile ? 4 : 6} isScrollable={pinned}>
            {blocks}
          </LayoutContent>
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
    </>
  );
}

/** A block's card once its first answer is here, with Astryx's entry motion, as `ContentArrival` draws a region. */
function Arrived({ children }: { children: ReactNode }) {
  const entry = useEntryAnimation('fadeIn');
  return (
    <VStack height="100%" xstyle={entry ?? undefined}>
      {children}
    </VStack>
  );
}
/**
 * The card under a block's heading in the row Behöver dig and I dag share (board Hem): its placeholder until the first
 * answer, as `AsyncContent` has it, and then the card, which takes the height the row gives it, so the two cards end
 * level whichever has fewer rows. On a phone, one block under the other, each is as tall as its rows.
 */
function RowCard({ pending, fallback, children }: { pending: boolean; fallback: ReactNode; children: ReactNode }) {
  return (
    <StackItem size="fill">
      <VStack height="100%" aria-busy={pending}>
        {pending ? fallback : <Arrived>{children}</Arrived>}
      </VStack>
    </StackItem>
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
