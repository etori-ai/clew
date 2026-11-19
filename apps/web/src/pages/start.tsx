import { useCallback, useEffect, useMemo, useRef, type ReactNode, type RefObject } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { unresolvedExecution, type Area, type SessionUser, type Thread } from '@clew/contracts';
import {
  ArrowRightIcon,
  Badge,
  Banner,
  BoardCard,
  Button,
  Card,
  CARD_GAP,
  HStack,
  Icon,
  Link,
  SparklesIcon,
  StackItem,
  StatusNotice,
  StatusRow,
  Text,
  TextInput,
  Theme,
  useAnnounce,
  useAppearance,
  useEntryAnimation,
  useMediaQuery,
  useToast,
  VStack,
} from '@clew/ui';
import { dayLabel, today } from '@clew/calendar/dates';
import { errorMessage, noCalendar } from '../query-policy';
import { areasQuery, assistantQuery, threadsQuery, todayQuery } from '../queries';
import { groupThreads } from '../stream';
import { useReceiptArrivals } from '../linger';
import { declaredPage, viewPageHref, type ViewTarget } from '../view-address';
import { itemPageHref, needsYouOf, rowFacts, sourcesNotice, todoHref } from '../work-items';
import { DOT } from '../dot';
import { useConversation, type AskFrom } from '../components/conversation/conversation-context';
import { ConversationPage } from './conversation';
import { NewQuestionPage } from './new-question';
import { ASSISTANT_PARAM, asksAbout } from '../conversation-about';

/**
 * The column fades in when it changes hands (D92): the conversation taking Hem's place when a question is sent, and Hem
 * coming back when the conversation closes. Keyed by whose turn it is, so each hand-over mounts anew and gets Astryx's
 * entry motion; what is on the page from the first paint does not animate, and reduced motion shows it at once.
 */
function Entering({ children }: { children: (entry: EntryStyle) => ReactNode }) {
  const entry = useEntryAnimation('fadeIn');
  return <>{children(entry ?? undefined)}</>;
}
import { toolHref, useNav, type NavCurrent } from '../components/shell/nav';
import { Shell, mobileQuery, shortQuery } from '../components/shell/shell';
import { ReceiptNotice, receiptMessage } from '../components/work/receipt-notice';
import { MyCommitments } from '../components/work/my-commitments';
import { NoCalendar, TodayCard } from '../components/hem/today';
import { hemLine } from '../components/shell/assistant-corner';
import { silentLine, staleWhy, useSaySilent, useSilentSources } from '../components/shell/silent-sources';
import { Lage } from '../components/hem/lage';
import { NewsBlock } from '../components/hem/news';
import { FocusNews, focusOf } from '../components/hem/focus-news';
import { usePageTitle } from '../page-title';
import { useMarks } from '../marks';
import { PageFrame, type EntryStyle } from '../components/shell/page-frame';
import { createAskFieldTheme } from '@clew/ui/theme';
import { useBranding } from '../branding';

/** How many work items Hem shows under "Behöver dig" (board Hem): the most urgent; every one is in Att göra. */
const ON_HEM = 4;
/** The board's narrow column (D130), as wide as the reference's, and the window width under which the board is one column. */
const SIDE_COLUMN = 360;
const stackedBoardQuery = '(max-width: 1180px)';
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
 * The start page (D34, D50, D112, D126). At `/` the column is Hem (D126, board Hem): the greeting and the day, one line
 * under them to ask Clew (`HemQuestion`, board HemFraga), and then the blocks, each a heading over its card that leads
 * to its place: "Behöver dig", the most urgent work items, beside "I dag", the day as the calendar family draws it
 * (D32); for a manager "Läget på <enhet>", the unit's figures as tiles; then "Nyheter". The item that asks for the
 * person's read receipt stands above the blocks as one callout (Fokusnyhet). Under them the person's own action points
 * (D96 item 7), drawn as a block, until they are rows in Att göra. No digest sentences, no suggestion chips and no tool
 * tiles (D126 rule 8): the tools are in the rail and on Alla verktyg, and Mina ärenden (D90) and what the person
 * ordered or reported (D123) are two of them. Every row and tile leads to the page of what it names (D126 rule 1), with
 * Hem as the way back; nothing opens over Hem, and an address that opened something beside it before leads to that
 * thing's page (the shell's `panelRedirect`, rule 3).
 *
 * A conversation takes the column at `/conversations/:id` (D31), with what it is about in the panel beside it (rule 2):
 * the view an answer names, the card or view that was open when it was asked, or the page it was asked on. The address
 * is the state throughout (`panel-address.ts`).
 */
export function StartPage({ user, admin = false }: { user: SessionUser; admin?: boolean }) {
  const mobile = useMediaQuery(mobileQuery);
  // 1.4.10: with 480 px or less in height nothing is docked; the row joins the page and the whole page scrolls (D31 item 7).
  const short = useMediaQuery(shortQuery);
  // The board's two columns need the room the reference gives them; under it the blocks stand one under the other.
  const stacked = useMediaQuery(stackedBoardQuery);
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
  // Ny fråga (D126 item 14): a new conversation whose address names nothing to ask about, before anything is asked, is
  // a page of its own. Once the first question is sent the transcript takes its place, and its address the page's.
  const { search } = useLocation();
  const fresh =
    params.conversationId === 'new' &&
    !asksAbout(search) &&
    // An assistant of another system beside a conversation not asked yet: the conversation's page, with its panel.
    !new URLSearchParams(search).get(ASSISTANT_PARAM) &&
    !talk.conversation &&
    !talk.pending &&
    !talk.error;
  /**
   * Where a view named on Hem leads (D126 rule 1): the page Clew's own read declares for its rows, else the view's own
   * page, with Hem as the way back.
   */
  const pageHref = (v: ViewTarget) => declaredPage(views, v.capability, v.input) ?? viewPageHref(v, HEM);
  /** A work item named on Hem: its own page (D112 item 4, D126 rule 1), with Hem as the way back. */
  const itemHref = (threadId: string) => itemPageHref(threadId, HEM);
  const toast = useToast();
  const announce = useAnnounce();
  // Hem's line (`HemQuestion`), and the box on the page: the conversation's own while its transcript has the column,
  // else the line.
  const line = hemLine;
  const focusBox = () => (talk.open ? talk.focus() : line.current?.focus());
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
    else focusBox();
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
  const railCurrent: NavCurrent = { surface: 'start', conversationId, conversation: talk.open, newQuestion: fresh };
  // A conversation names itself in the tab (`ConversationPage`: its question, or before one what it is about); Hem is
  // named and spoken here.
  usePageTitle(talk.open ? null : 'Hem');
  const manager = user.role === 'manager';
  const nav = useNav({ current: railCurrent, admin, manager });

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
   * "Behöver dig" (D112 item 2; D130 item 13): the most urgent work items as rows in a board card, the count after the
   * heading and the way to all of them in Att göra. A row has an edge in its due day's colour, the due day as its badge
   * and "Öppna", the link to the item's page. While the cards load the card keeps its shape; with nothing to draw it
   * says so in the card.
   */
  const needsBlock = (
    <BoardCard
      id="behover-dig"
      title="Behöver dig"
      count={loadingThreads ? undefined : needsYou.length}
      countLabel="behöver dig"
      action={loadingThreads ? undefined : <Link href={todoHref({})}>Visa alla</Link>}
      pending={loadingThreads}
      pendingLabel="Hämtar det som behöver dig …"
    >
      {(sourcesLine || first.length === 0) && (
        <VStack gap={1}>
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
        <VStack gap={2} role="list" aria-label="Behöver dig">
          {first.map(t => {
            const due = rowFacts(t, now, todayDate).due;
            return (
              <VStack key={t.id} role="listitem">
                <StatusRow
                  id={`work-${t.id}`}
                  status={due?.variant === 'error' ? 'error' : due?.variant === 'warning' ? 'warning' : 'neutral'}
                  title={t.title}
                  meta={lineOf(t)}
                  href={itemHref(t.id)}
                  end={due ? <Badge variant={due.variant} label={due.label} /> : undefined}
                />
              </VStack>
            );
          })}
        </VStack>
      )}
    </BoardCard>
  );
  /**
   * "I dag" (D130 item 13): the day as the calendar family draws it (D32) in a board card, with the way to Kalender. It
   * is always drawn: a day that cannot be read says why in the card (D116, amended 2026-11-12) instead of leaving its
   * place to the others.
   */
  const dayBlock = (
    <BoardCard
      id="i-dag"
      title="I dag"
      list
      action={withoutCalendar ? undefined : <Link href="/calendar">Kalender</Link>}
      pending={loadingThreads || (dayQ.isPending && !calendarHidden)}
      pendingLabel="Hämtar i dag …"
    >
      <TodayCard
        bare
        view={withoutCalendar ? null : day}
        threads={threads}
        itemHref={itemHref}
        notice={
          withoutCalendar ? (
            <NoCalendar hidden={calendarHidden} />
          ) : calendarSilent ? (
            // The status vocabulary's notice (D126 item 13): it failed, since when, and the one move, Försök igen.
            <StatusNotice
              kind="failed"
              title={silentLine({ source: calendarName, since: calendarSince })}
              description="Dagens bokningar kan inte visas."
              action={{
                label: 'Försök igen',
                isLoading: dayQ.isFetching,
                clickAction: () => void dayQ.refetch(),
              }}
            />
          ) : undefined
        }
      />
    </BoardCard>
  );
  /** Hem's blocks, in the reference's order (D130): the callout, Läget, and the board's two columns. */
  const blocks = (
    <VStack gap={CARD_GAP}>
      {error && (
        <Text as="p" role="alert" color="accent">
          {error}
        </Text>
      )}
      {/* Fokusnyhet (board Hem10): one callout above the blocks, while an item asks for the person's read receipt. */}
      {focus && <FocusNews thread={focus} href={itemHref(focus.id)} onChange={replace} />}
      {/* Läget (D54, D117) before the work, as the reference's board has its key figures (D130): a manager's unit, each
          tile leading to the page of what it counts. */}
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
      {/* The board (D130 item 13), as the reference lays it out: what needs the person in the wide column, and beside
          it a narrow one with the day and the news. Where the window is too narrow for both, one under the other. */}
      {stacked ? (
        <VStack gap={CARD_GAP}>
          {needsBlock}
          {dayBlock}
          <NewsBlock hrefFor={pageHref} />
          <MyCommitments />
        </VStack>
      ) : (
        <HStack gap={CARD_GAP} vAlign="start">
          <StackItem size="fill">
            <VStack gap={CARD_GAP}>
              {needsBlock}
              {/* The person's own action points (D96 item 7), drawn as a block, until they are rows in Att göra. */}
              <MyCommitments />
            </VStack>
          </StackItem>
          <VStack gap={CARD_GAP} width={SIDE_COLUMN}>
            {dayBlock}
            <NewsBlock hrefFor={pageHref} />
          </VStack>
        </HStack>
      )}
    </VStack>
  );
  // The box is a new one as Ny fråga gives way to the transcript, and as it comes back: the focus goes with it (D31).
  const wasFresh = useRef(fresh);
  useEffect(() => {
    if (wasFresh.current === fresh) return;
    wasFresh.current = fresh;
    // Not when Ny fråga gave way to a conversation with another system's assistant beside it: the person turned to
    // that assistant, and its panel's field takes the focus.
    if (new URLSearchParams(window.location.search).get(ASSISTANT_PARAM)) return;
    const frame = requestAnimationFrame(() => talk.focus());
    return () => cancelAnimationFrame(frame);
  }, [fresh]);
  /**
   * What the column holds: Ny fråga's own page (D126 item 14), the conversation's page when a conversation is open (D31,
   * D126 rule 5), else Hem.
   */
  const column = (entry: EntryStyle) => {
    if (fresh) return <NewQuestionPage greeting={greetingOf(user.name, new Date())} entry={entry} />;
    if (talk.open) return <ConversationPage entry={entry} onChange={replace} />;
    // Hem (D130): the greeting, the day line and the line to ask in the frame's header, and the board under them.
    // Nothing is pinned: the whole page scrolls under the shell's header, as the reference's start page does, and the
    // floating "Fråga AI" leads back to the line from anywhere on it.
    return (
      <PageFrame
        entry={entry}
        plain
        title={greetingOf(user.name, new Date())}
        titleId="hem"
        meta={dayLine(todayDate, user.unitLabel)}
        below={<HemQuestion field={line} stacked={mobile} />}
        label="Hem"
      >
        {blocks}
      </PageFrame>
    );
  };

  return (
    <>
      <KeepFocus open={talk.open} focus={focusBox} />
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
        <Entering key={fresh ? 'new' : talk.open ? 'conversation' : 'hem'}>{column}</Entering>
      </Shell>
    </>
  );
}

/** What Hem's line hands the conversation: nothing to ask about, and Hem as the place Esc leads back to. */
const FROM_HEM: AskFrom = { chips: [], search: '' };
/**
 * Hem's question (D126 items 4 and 9, board HemFraga variant a): one line under the greeting, the field and "Fråga
 * Clew". Nothing is answered on Hem: Enter or the button sends what is written as every first question is sent
 * (`submit`), and the conversation takes the column with the question asked; with nothing written the button opens Ny
 * fråga, as the rail's row does, and Enter does nothing. While the question leaves, the button shows it, and a second
 * Enter is refused by the turn's own guard. The field holds the conversation's draft, so a question half written is
 * still there after a visit elsewhere. Whom to ask, the model, `@` and dictation are the conversation page's box's. On a
 * phone (`stacked`) the button stands under the field at its full width, so its words are never cut (1.4.10).
 */
function HemQuestion({ field, stacked }: { field: RefObject<HTMLInputElement | null>; stacked: boolean }) {
  const talk = useConversation();
  const navigate = useNavigate();
  const { mode } = useAppearance();
  const branding = useBranding();
  const askTheme = useMemo(() => createAskFieldTheme(branding), [branding]);
  const written = talk.value.trim() !== '';
  const ask = () => {
    if (written && !talk.busy) void talk.submit(talk.value, FROM_HEM);
  };
  // ⌘K takes the focus to the box from anywhere (the conversation's own keys); on Hem the box is this line.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') field.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [field]);
  // The field, its mark and its button stand in one pill (D130 item 14), as the reference draws its ask field: a card
  // in the theme's `ask` variant, and inside it a nested theme in which the field has no edge of its own.
  return (
    <Theme theme={askTheme} mode={mode}>
      <Card variant="ask" padding={2}>
        <HStack gap={3} vAlign="center" paddingInlineStart={stacked ? 1 : 3}>
          <Card variant="ai-mark" padding={2}>
            <Icon icon={SparklesIcon} color="inherit" />
          </Card>
          <StackItem size="fill">
            <TextInput
              ref={field}
              label="Vad vill du göra?"
              isLabelHidden
              size="lg"
              placeholder="Vad vill du göra?"
              value={talk.value}
              onChange={talk.setValue}
              onEnter={ask}
              enterKeyHint="send"
              status={talk.error ? { type: 'error', message: talk.error } : undefined}
            />
          </StackItem>
          {/* On a phone the button is its arrow alone, named "Fråga AI": its words would be cut in the pill (1.4.10). */}
          <Button
            label="Fråga AI"
            variant="ai"
            size="lg"
            {...(stacked ? { isIconOnly: true, icon: <Icon icon={ArrowRightIcon} color="inherit" /> } : {})}
            isLoading={talk.busy}
            onClick={() => {
              if (written) return ask();
              talk.newConversation({ from: HEM, stay: true });
              navigate('/conversations/new');
            }}
          />
        </HStack>
      </Card>
    </Theme>
  );
}

/**
 * The box keeps focus across the transcript opening and closing (D31). Hem's line gives way to the box docked under the
 * conversation, and comes back when it closes, so each change of `open` gives the focus the one held to the other after
 * the commit. A conversation asked on another page arrives with its transcript already open: the box here takes the
 * focus the page's own box had (D50).
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
