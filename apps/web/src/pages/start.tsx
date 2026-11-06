import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Area, MenuEntry, SessionUser, Thread, ViewRef, PanelViewSpec } from '@clew/contracts';
import { isSnoozed } from '@clew/contracts';
import {
  Badge,
  Banner,
  BottomSheet,
  Button,
  Card,
  ChatLayout,
  Divider,
  DropdownMenu,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  EmptyState,
  Grid,
  GridSpan,
  Heading,
  HStack,
  Icon,
  IconButton,
  Layout,
  LayoutContent,
  LayoutFooter,
  LayoutHeader,
  Link,
  List,
  MoreMenu,
  SparklesIcon,
  StatusDot,
  Tab,
  TabList,
  Text,
  Toolbar,
  VStack,
  useAnnounce,
  useMediaQuery,
  useToast,
} from '@clew/ui';
import { addDays, dayLabel, displayDate, shortDayLabel, timeLabel, today, weekNumber } from '@clew/calendar/dates';
import { api } from '../api';
import { errorMessage } from '../query-policy';
import { areasQuery, assistantQuery, cardViewQuery, threadsQuery, todayQuery, viewQuery } from '../queries';
import { applyThread } from '../thread-cache';
import { keys } from '../query-keys';
import { groupThreads } from '../stream';
import { useReceiptArrivals } from '../linger';
import { useThreadAction } from '../mutations';
import { panelOf, withAction, withCard, withView, withoutPanel } from '../panel-address';
import { Composer, Suggestions, type ComposerAbout } from '../components/composer';
import { titled, useConversation, type ConversationState } from '../components/conversation-context';
import { Transcript } from '../components/conversation';
import { toolHref, useRail, type RailCurrent } from '../components/nav';
import { Shell, mobileQuery, shortQuery } from '../components/shell';
import { GenericCard, ThreadRow } from '../components/card';
import { BriefSkeleton } from '../components/brief';
import { CONVERSATION_MIN, PanelBody, panelBesideQuery, usePanel, type PanelFrame } from '../components/panel';
import { EventDialog } from '../components/calendar/event-dialog';
import type { AgendaItem } from '@clew/ui';
import { ThreadCard } from '../components/thread';
import { Handled } from '../components/handled';
import { Today } from '../components/today';
import { Since } from '../components/since';
import { usePageTitle } from '../page-title';
import { useMarks } from '../marks';

/** Hem's tabs (D53): a card's state, named as the address names it (D43). */
type TodoTab = 'needs-you' | 'waiting' | 'snoozed' | 'done';
const todoTabs: TodoTab[] = ['needs-you', 'waiting', 'snoozed', 'done'];
const tabOf = (value: string | null): TodoTab =>
  todoTabs.includes(value as TodoTab) ? (value as TodoTab) : 'needs-you';
const tabTitle: Record<TodoTab, string> = {
  'needs-you': 'Behöver dig',
  waiting: 'Väntar på andra',
  snoozed: 'Inte nu',
  done: 'Klart',
};
/** The least width Hem's column needs beside the panel: the rows with their day, their line and their one button. */
const HOME_MIN = 640;
/** Under this the day and what happened since yesterday fold under the day's work (artboard A's note: the side column folds at 1024). */
const twoColumnQuery = '(min-width: 1024px)';
/** The counts in words, as "Alla fyra källor svarade" has them. */
const capital = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
const ALL_AREAS = 'all';
const EMPTY_THREADS: Thread[] = [];
const EMPTY_AREAS: Area[] = [];
const EMPTY_MENU: MenuEntry[] = [];

/**
 * The start page (D34, D50, D53). The column is where the person is and the panel is what they hold beside it. At `/`
 * the column is Hem: the greeting with the day, the box, and under it everything the assistant has pushed, with a
 * card's state as the tabs (Behöver dig, Väntar på andra, Inte nu, Klart), the areas as a filter, and on a quiet day
 * the person's areas with what they can start. The day and what happened since yesterday stand beside the column, and
 * give way to the panel when a card, a view or a card's read is opened there; the box then asks about the open card.
 * A conversation takes the column at `/conversations/:id` (D31), with what it is about in the panel: the view an answer
 * names, the card or the page it was asked on. The address is the state throughout (`panel-address.ts`). Every card
 * comes from a connector through the registry; the calendar's proposal card keeps its specialised rendering.
 */
export function StartPage({ user, admin = false }: { user: SessionUser; admin?: boolean }) {
  const mobile = useMediaQuery(mobileQuery);
  // 1.4.10: with 480 px or less in height nothing is docked; the row joins the page and the whole page scrolls (D31 item 7).
  const short = useMediaQuery(shortQuery);
  const twoColumns = useMediaQuery(twoColumnQuery);
  // Where a transcript and the panel fit side by side, a conversation asked on a page brings what the page showed along (D50).
  const besideTranscript = useMediaQuery(panelBesideQuery(CONVERSATION_MIN));
  // Every read is a query (D33): one cache shared by the page, the cards, the rail and the conversation. A mutation writes the thread it returns into it (thread-cache.ts).
  const client = useQueryClient();
  const threadsQ = useQuery(threadsQuery);
  const areasQ = useQuery(areasQuery);
  const dayQ = useQuery(todayQuery);
  const assistantQ = useQuery(assistantQuery);
  const threads = threadsQ.data?.threads ?? EMPTY_THREADS;
  // The first read of the cards (D36): until it is here the page draws their shape, never "nothing needs you".
  const loadingThreads = threadsQ.isPending;
  const areas = areasQ.data?.areas ?? EMPTY_AREAS;
  const menu = areasQ.data?.menu ?? EMPTY_MENU;
  const day = dayQ.data ?? null;
  const assistant = assistantQ.data ?? null;
  const talk = useConversation();
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams<{ conversationId?: string }>();
  const [search] = useSearchParams();
  const here = location.pathname;
  const conversationId = params.conversationId && params.conversationId !== 'new' ? params.conversationId : null;
  const tab = tabOf(search.get('tab'));
  const area = search.get('area');
  // What the panel holds, from the address: a view, a card's own read, or a card (D50).
  const panel = panelOf(search);
  const viewPanel = panel?.kind === 'view' ? panel : null;
  const actionPanel = panel?.kind === 'action' ? panel : null;
  /** The card the address names: the row marked on Hem, and the card in the panel unless a view lies over it. */
  const openId = search.get('card');
  // `via` marks a view opened from another view (a row's contact card): the panel then offers the way back to it.
  const viewHref = (capability: string, title: string, input?: Record<string, unknown>, via = false) =>
    withView(here, search, { capability, title, input }, via);
  /** Where a row's title and a matching "Menar du" row lead: the card in the panel beside Hem (D50, amended 2026-11-05). */
  const cardHref = (threadId: string) => withCard(here, search, threadId);
  /** Hem with a tab or an area: the first tab is the default and is left out of the address (D50 item 2). */
  const homeHref = (next: { tab?: TodoTab; area?: string | null }) => {
    const q = new URLSearchParams(search);
    if (next.tab) {
      if (next.tab === 'needs-you') q.delete('tab');
      else q.set('tab', next.tab);
    }
    if (next.area !== undefined) {
      if (next.area) q.set('area', next.area);
      else q.delete('area');
    }
    const s = q.toString();
    return s ? `/?${s}` : '/';
  };
  const closePanel = () => navigate(withoutPanel(here, search));
  // An entry opened from the panel's day view (D32): the same dialog as on the calendar page, over the panel.
  const [openItem, setOpenItem] = useState<{ item: AgendaItem; dayItems: AgendaItem[] } | null>(null);
  const toast = useToast();
  // A card that leaves the list takes the focused button with it. Focus goes on to the next card, or the first heading when none is left (2.4.3).
  // `replace` is what every card gets as `onChange`: it runs before the cache is written (mutations.ts), so the DOM read here is still the old one.
  const focusAfter = useRef<{ card: string; next: string; at: number } | null>(null);
  const replace = useCallback((thread: Thread) => {
    const cards = [...document.querySelectorAll('[id^="thread-"]')].map(el => el.id);
    const at = cards.indexOf('thread-' + thread.id);
    const after = cards[at + 1] ?? cards[at - 1] ?? 'behover-dig';
    // A card in the panel keeps the focus when its own button changed it: the card is still there, in its new state.
    // When the button took the card out of the stream (Inte nu, Avfärda, done) its row is gone, and the focus goes on
    // to the row after it as from the list, even though the panel still shows the card (D66: Inte nu is among the
    // card's own buttons, and a snoozed card left in the panel is not where the person's work continues).
    const beside = document.activeElement?.closest<HTMLElement>('[id^="card-"]');
    if (beside) {
      const stays = thread.state === 'open' && !isSnoozed(thread, new Date().toISOString());
      focusAfter.current = { card: stays || at < 0 ? beside.id : cards[at]!, next: after, at: Date.now() };
      return;
    }
    if (at >= 0) focusAfter.current = { card: cards[at]!, next: after, at: Date.now() };
  }, []);
  // The conversation changes cards too (a draft, a dismissal): it tells this page first, the same way a card's own button does.
  const { setThreadListener } = talk;
  useEffect(() => {
    setThreadListener(replace);
    return () => setThreadListener(null);
  }, [setThreadListener, replace]);
  useEffect(() => {
    const target = focusAfter.current;
    focusAfter.current = null;
    // A thread that came back unchanged renders nothing (structural sharing), so a stale note is dropped rather than moving focus later.
    if (!target || Date.now() - target.at > 2_000 || document.activeElement !== document.body) return;
    // A card that moved to another tab is no longer in the list; a card that only changed state is still here.
    const card = document.getElementById(target.card);
    const next = card?.checkVisibility()
      ? card
      : (document.getElementById(target.next) ??
        document.getElementById('behover-dig') ??
        document.getElementById('senare') ??
        document.getElementById('hem'));
    // A row's focus goes to its title button, the control with the ring; a card is focused as a whole, as before.
    (next?.matches('li') ? (next.querySelector<HTMLElement>('button, a') ?? next) : next)?.focus();
  }, [threads]);
  // A receipt that has just arrived (D70): the row keeps its place for a moment, and a toast says where the card went,
  // with the way there and the way back. The toast stays until closed (2.2.1), as the Avfärda toast does.
  const { run: runUndo } = useThreadAction({ onChange: replace });
  const lingering = useReceiptArrivals(threads, thread => {
    const receipt = thread.receipt!;
    // Where the card lies now: under Klart when the decision closed it, under Väntar på andra when it left the card
    // waiting on someone else's answer (a confirmed proposal), else where it was.
    const where =
      thread.state === 'handled'
        ? { tab: 'done' as const, label: 'Klart' }
        : thread.waitingOn
          ? { tab: 'waiting' as const, label: 'Väntar på andra' }
          : { tab: 'needs-you' as const, label: 'Behöver dig' };
    const dismiss = toast({
      body: `${receipt.headline.replace(/\.$/, '')}. Kortet ligger under ${where.label}.`,
      isAutoHide: false,
      uniqueID: 'receipt:' + thread.id,
      endContent: (
        <HStack gap={1}>
          <Button size="sm" variant="ghost" label="Visa" href={homeHref({ tab: where.tab })} />
          {receipt.undoCapability && (
            <Button
              size="sm"
              variant="ghost"
              label="Ångra"
              clickAction={async () => {
                await runUndo(() => api.undoReceipt(thread.id));
                dismiss();
              }}
            />
          )}
        </HStack>
      ),
    });
  });
  // A view is addressable (integrations.md, "Answers and views"): the panel follows `open` or `open-card` in the address.
  const viewInput = search.get('open-input');
  // A declared view with a search field (D38) asks again as the person types: the rows on screen stay until the next ones arrive, so the panel and the field's focus stay put.
  const capabilityView = useQuery({
    ...viewQuery(viewPanel?.capability ?? '', viewInput),
    enabled: !!viewPanel,
    placeholderData: keepPreviousData,
  });
  // The view on screen. Another capability's view takes its place when it has arrived, not before: the panel stays open
  // between a row and its contact card, and focus can follow. Typing in a view's own field keeps that view's rows meanwhile.
  const shownView = useRef<{
    capability: string;
    title: string;
    output: unknown;
    spec: PanelViewSpec | undefined;
    source: string | undefined;
    input: Record<string, unknown>;
    via: boolean;
    address: string;
  } | null>(null);
  const cardView = useQuery({
    ...cardViewQuery(actionPanel?.threadId ?? '', actionPanel?.actionId ?? ''),
    enabled: !!actionPanel,
  });
  // What a card action answered is acted on once per answer (StrictMode replays effects): an executed thread goes into the cache, a link opens a tab.
  const acted = useRef<unknown>(null);
  useEffect(() => {
    const result = cardView.data;
    if (!result || acted.current === result) return;
    acted.current = result;
    if (result.kind === 'execute') {
      replace(result.thread);
      void applyThread(client, result.thread);
    } else if (typeof (result.output as { url?: string }).url === 'string')
      window.open((result.output as { url: string }).url, '_blank', 'noopener');
  }, [cardView.data, client, replace]);
  const arrived =
    capabilityView.data &&
    (!capabilityView.isPlaceholderData || capabilityView.data.view?.capability === viewPanel?.capability)
      ? capabilityView.data
      : undefined;
  if (!viewPanel || capabilityView.isError) shownView.current = null;
  else if (arrived)
    shownView.current = {
      capability: viewPanel.capability,
      title: viewPanel.title,
      output: arrived.output,
      spec: arrived.view,
      source: arrived.source,
      input: viewPanel.input,
      via: viewPanel.via,
      address: here + location.search,
    };
  const capabilityShown = viewPanel ? shownView.current : null;
  const view = useMemo(() => {
    if (viewPanel)
      return capabilityShown
        ? {
            title: capabilityShown.title,
            output: capabilityShown.output,
            spec: capabilityShown.spec,
            source: capabilityShown.source,
          }
        : null;
    const result = actionPanel ? cardView.data : undefined;
    if (!result || !actionPanel) return null;
    const label =
      threads.find(t => t.id === actionPanel.threadId)?.actions.find(a => a.id === actionPanel.actionId)?.label ?? 'Vy';
    if (result.kind === 'execute')
      return { title: label, output: result.thread.receipt, spec: undefined, source: undefined };
    if (typeof (result.output as { url?: string }).url === 'string') return null;
    return { title: label, output: result.output, spec: result.view, source: undefined };
  }, [viewPanel?.capability, actionPanel?.threadId, actionPanel?.actionId, capabilityShown, cardView.data, threads]);
  // The page's one alert: a read that failed before it had anything to show. A failed refetch keeps the old data and says nothing; the day and the model's status are extras.
  const failed = [threadsQ, areasQ].find(q => q.isError && q.data === undefined);
  const error = failed
    ? errorMessage(failed.error, 'Sidan kunde inte läsas.')
    : capabilityView.isError
      ? errorMessage(capabilityView.error, 'Kunde inte hämta.')
      : cardView.isError
        ? errorMessage(cardView.error, 'Kunde inte hämta.')
        : null;
  const openView = (v: ViewRef) => navigate(viewHref(v.capability, v.title, v.input));
  const { areaTitle } = useMarks();
  // The filter changes the rows under it without a change of page: what is shown now is said aloud (4.1.3).
  const announce = useAnnounce();
  const shownArea = useRef(area);
  useEffect(() => {
    if (shownArea.current === area) return;
    shownArea.current = area;
    announce(area ? `Visar området ${areaTitle(area)}` : 'Visar alla områden');
  }, [area, announce]);
  const inArea = (t: Thread) => area === null || t.area === area;
  const now = new Date().toISOString();
  const todayDate = today();
  // The groups (D34): requirements by their day, proposals, events; then what waits on someone else and what is set aside.
  const g = useMemo(
    () => groupThreads(threads, now, todayDate, inArea, lingering),
    [threads, now.slice(0, 16), todayDate, area, lingering],
  );
  const all = useMemo(
    () => groupThreads(threads, now, todayDate, undefined, lingering),
    [threads, now.slice(0, 16), todayDate, lingering],
  );
  // What closed today (artboard A's "1 klar", the Klart tab's count): cards, not the person's own conversations.
  const closedToday = useMemo(() => all.handledToday.filter(t => t.kind !== 'question'), [all.handledToday]);
  // Whether what the address names stands beside the column (artboard E) rather than over it: then the column is the narrow one.
  const panelFits = useMediaQuery(panelBesideQuery(HOME_MIN));
  const older = [
    ...threads.filter(t => t.state === 'open' && t.kind === 'question'),
    ...threads.filter(t => t.state !== 'open'),
  ];
  const railCurrent: RailCurrent = { surface: 'start', conversationId };
  const pageTitle = view ? view.title : conversationId ? 'Samtal' : 'Hem';
  usePageTitle(pageTitle, view || conversationId ? false : pageTitle);
  const nav = useRail({ current: railCurrent, admin });

  const openCardView = (threadId: string, actionId: string) => navigate(withAction(here, search, threadId, actionId));
  // On a phone Hem has no panel for a card (artboards 11 and 12): the threads are rows, and the card the address names
  // rises in Astryx's bottom sheet over them; closing the sheet leaves the address as the ✕ beside the column does.
  const cardsInSheet = mobile && !talk.open;
  const besideOpen = !!panel && !(panel.kind === 'card' && cardsInSheet) && panelFits && !short && !talk.open;
  /** The way on from a done card (D70): the first other card under Nu, else under Senare. */
  const nextFor = (t: Thread) => {
    const next = [...g.nu, ...g.senare].find(x => x.id !== t.id);
    return next ? { title: next.title, href: cardHref(next.id) } : undefined;
  };
  const card = (
    t: Thread,
    options: {
      level?: 2 | 3;
      beside?: boolean;
      compact?: boolean;
      sheet?: boolean;
      next?: { title: string; href: string };
    } = {},
  ) =>
    t.proposals.length ? (
      <ThreadCard
        key={t.id}
        thread={t}
        compact={options.compact ?? mobile}
        headingLevel={options.level ?? 3}
        beside={!!options.beside}
        onChange={replace}
      />
    ) : (
      <GenericCard
        key={t.id}
        thread={t}
        headingLevel={options.level ?? 3}
        beside={!!options.beside}
        sheet={!!options.sheet}
        next={options.next}
        onChange={replace}
        onOpenCardView={openCardView}
      />
    );
  /**
   * A group's threads (D31, D50, artboard A): rows in one list, the title of each the link to its card beside the column,
   * or in the sheet on a phone, where the next step goes under the line (artboard 11). What is due today stands in a
   * red-tinted card; the other groups are rows fenced by dividers, their text on the column's content line (edge flush).
   */
  const records = (list: Thread[], options: { notice?: boolean; due?: boolean } = {}) => {
    const rows = (
      <List hasDividers density="balanced" edge="flush">
        {list.map(t => (
          <ThreadRow
            key={t.id}
            thread={t}
            notice={options.notice}
            href={cardHref(t.id)}
            isOpen={!cardsInSheet && openId === t.id}
            onClose={closePanel}
            compact={besideOpen}
            phone={mobile}
            onChange={replace}
            onOpenCardView={openCardView}
          />
        ))}
      </List>
    );
    return options.due ? (
      <Card variant="red" padding={3}>
        {rows}
      </Card>
    ) : (
      <VStack gap={0}>
        <Divider />
        {rows}
        <Divider />
      </VStack>
    );
  };
  const assistantDown = !!assistant && assistant.configured && !assistant.available;
  const needsYou = g.nu.length + g.senare.length + g.foreslar.length + g.kannedom.length;
  const sources = threadsQ.data?.sources;
  const sourcesWaiting = !!sources?.some(s => !s.lastSuccess || s.error);
  /** Nothing needs the person (artboard B): the quiet page, with what the person can start as its main content. */
  const quiet = !loadingThreads && needsYou === 0;
  /** A group's heading row (artboard A): the heading with its count, and the artboard's caption at the end of the line. */
  const groupHeading = (id: string, title: string, caption: string) => (
    <HStack justify="between" vAlign="center" gap={3} wrap="wrap">
      <Heading id={id} tabIndex={-1} level={3} accessibilityLevel={2}>
        {title}
      </Heading>
      {!besideOpen && !mobile && <Text type="supporting">{caption}</Text>}
    </HStack>
  );
  /** Lugnt läge (artboard B): a card with the sources, what waits and when the assistant next goes through everything, with the way to each. */
  const calm = (
    <Card variant="green" padding={5}>
      <HStack gap={4} vAlign="start">
        <Icon icon="check" size="lg" color="success" />
        <VStack gap={1.5}>
          <Heading id="behover-dig" tabIndex={-1} level={3} accessibilityLevel={2}>
            {sourcesWaiting ? 'Inväntar källornas besked' : 'Lugnt läge'}
          </Heading>
          <Text as="p" color="secondary">
            {sources?.length
              ? sourcesWaiting
                ? 'Någon källa kunde inte kontrolleras. Sparade uppgifter visas och kontrolleras igen. '
                : `Alla ${sources.length <= 12 ? ['', 'en', 'två', 'tre', 'fyra', 'fem', 'sex', 'sju', 'åtta', 'nio', 'tio', 'elva', 'tolv'][sources.length] : sources.length} källor svarade i natt 06:00. `
              : ''}
            {all.waiting.length > 0
              ? `${capital(all.waiting.length === 1 ? 'en sak' : `${all.waiting.length} saker`)} väntar på andra och kommer tillbaka när de svarar. `
              : 'Inget väntar på andra. '}
            Nästa genomgång i morgon 06:00, eller tidigare om något händer.
          </Text>
          <HStack gap={4} wrap="wrap">
            <Text type="supporting" weight="medium">
              <Link href={homeHref({ tab: 'waiting' })} color="primary" hasUnderline>
                {all.waiting.length} väntar på andra
              </Link>
            </Text>
            <Text type="supporting" weight="medium">
              <Link href={homeHref({ tab: 'done' })} color="primary" hasUnderline>
                {closedToday.length} {closedToday.length === 1 ? 'klar' : 'klara'} i dag
              </Link>
            </Text>
          </HStack>
        </VStack>
      </HStack>
    </Card>
  );

  /** Behöver dig (D34, artboard A): the groups in the artboard's order, each an h2 with the artboard's caption. */
  const needs = (
    <VStack gap={5}>
      {(loadingThreads || g.nu.length > 0 || quiet) && (
        <VStack gap={1.5} as="section" aria-label="Nu">
          {quiet
            ? calm
            : groupHeading(
                'behover-dig',
                loadingThreads ? 'Nu' : `Nu · ${g.nu.length}`,
                'Deadline i dag, eller något du bad om',
              )}
          {loadingThreads && <BriefSkeleton compact={mobile} />}
          {!quiet && sourcesWaiting && (
            <Text as="p" role="status">
              {sources?.some(s => s.error)
                ? 'Någon källa kunde inte kontrolleras. Sparade uppgifter visas och kontrolleras igen.'
                : 'Källorna kontrolleras. Sparade uppgifter visas under tiden.'}
            </Text>
          )}
          {g.nu.length > 0 && records(g.nu, { due: true })}
        </VStack>
      )}
      {g.foreslar.length > 0 && (
        <VStack gap={1.5} as="section" aria-label="Jag föreslår">
          {groupHeading('proposals', `Jag föreslår · ${g.foreslar.length}`, 'Ingen deadline, nej tack är ett svar')}
          {records(g.foreslar)}
        </VStack>
      )}
      {g.senare.length > 0 && (
        <VStack gap={1.5} as="section" aria-label="Senare">
          {groupHeading('senare', `Senare · ${g.senare.length}`, 'Bara det som har en dag får en dag')}
          {records(g.senare)}
        </VStack>
      )}
      {g.kannedom.length > 0 && (
        <VStack gap={1.5} as="section" aria-label="Till kännedom">
          {groupHeading('notices', `Till kännedom · ${g.kannedom.length}`, 'Inget att göra, bara att veta')}
          {records(g.kannedom, { notice: true })}
        </VStack>
      )}
    </VStack>
  );
  /** Väntar på andra and Inte nu (D28; the name is D53's): what waits on someone else, and what the person set aside. The tab's panel is the named region. */
  const pile = (list: Thread[], title: string, empty: string) => (
    <VStack gap={1.5}>
      <Heading level={3} accessibilityLevel={2}>
        {title} · {list.length}
      </Heading>
      {list.length === 0 ? (
        <EmptyState title="Tomt här" description={empty} isCompact headingLevel={3} />
      ) : (
        records(list)
      )}
    </VStack>
  );
  const tabContent =
    tab === 'done' ? (
      <Handled
        threads={older.filter(inArea)}
        compact={mobile}
        onChange={replace}
        conversationHref={id => `/conversations/${id}`}
      />
    ) : tab === 'waiting' ? (
      pile(
        g.waiting,
        'Väntar på andra',
        'Inget väntar på andra. Det som gör det kommer tillbaka av sig självt när någon svarar.',
      )
    ) : tab === 'snoozed' ? (
      pile(
        g.snoozed,
        'Inte nu',
        'Inget är lagt åt sidan. Det som är det kommer tillbaka 06:00, eller tidigare om något händer.',
      )
    ) : (
      needs
    );
  /** A tab's count (artboard A): a neutral badge after the name; Behöver dig always, the others when they hold something. */
  const tabCount = (t: TodoTab) =>
    t === 'needs-you'
      ? needsYou
      : t === 'waiting'
        ? g.waiting.length
        : t === 'snoozed'
          ? g.snoozed.length
          : closedToday.length;
  const tabLabel = (t: TodoTab) => {
    const n = tabCount(t);
    return n || t === 'needs-you' ? `${tabTitle[t]} · ${n}` : tabTitle[t];
  };
  /**
   * The day's work (D50 and D53, after the `table-inbox` template: a status control over a queue of rows, and the chosen
   * row's detail beside it): the tabs with the area filter on their line, then the tab's rows. The tabs switch the rows
   * in place, so they speak the tabs pattern and point at the panel they fill. There is no heading of its own: Hem's
   * greeting is the page's h1, and the groups are its h2s.
   */
  // Drawn when the page is composed, after the panel's slot is known.
  const work = () => (
    <VStack gap={4}>
      {error && (
        <Text as="p" role="alert" color="accent">
          {error}
        </Text>
      )}
      <VStack gap={0}>
        <HStack justify="between" vAlign="center" gap={2} wrap="wrap">
          {/* Four tabs do not fit 320 px, and a strip that scrolls sideways hides the last ones (1.4.10): a phone gets the same choice as one menu, as the log's filter and the calendar's views do. */}
          {mobile ? (
            <HStack>
              <DropdownMenu
                presentation="adaptive"
                button={{ label: `Visa: ${tabLabel(tab)}`, size: 'sm', variant: 'secondary' }}
                items={todoTabs.map(t => ({
                  id: t,
                  label: tabLabel(t),
                  onClick: () => navigate(homeHref({ tab: t })),
                }))}
              />
            </HStack>
          ) : (
            <TabList value={tab} onChange={next => navigate(homeHref({ tab: tabOf(next) }))} role="tablist">
              {todoTabs.map(t => (
                <Tab
                  key={t}
                  value={t}
                  label={tabTitle[t]}
                  panelId="att-gora-lista"
                  endContent={
                    tabCount(t) || t === 'needs-you' ? (
                      <Badge variant="neutral" label={String(tabCount(t))} />
                    ) : undefined
                  }
                />
              ))}
            </TabList>
          )}
          <HStack gap={1} vAlign="center" wrap="wrap">
            {/* The area filter (artboard A): one menu that says which area is chosen; under a finger it opens as a sheet. */}
            {areas.length > 0 && mobile && (
              <DropdownMenu
                presentation="adaptive"
                button={{ label: `Område: ${area ? areaTitle(area) : 'Alla'}`, size: 'sm', variant: 'secondary' }}
                items={[
                  { id: ALL_AREAS, label: 'Alla områden', onClick: () => navigate(homeHref({ area: null })) },
                  ...areas.map(a => ({ id: a.id, label: a.title, onClick: () => navigate(homeHref({ area: a.id })) })),
                ]}
              />
            )}
            {areas.length > 0 && !mobile && (
              <DropdownMenu button={{ label: area ? areaTitle(area) : 'Alla områden', size: 'md', variant: 'ghost' }}>
                <DropdownMenuRadioGroup
                  label="Område"
                  value={area ?? ALL_AREAS}
                  onChange={value => navigate(homeHref({ area: value && value !== ALL_AREAS ? value : null }))}
                >
                  <DropdownMenuRadioItem value={ALL_AREAS} label="Alla områden" />
                  {areas.map(a => (
                    <DropdownMenuRadioItem key={a.id} value={a.id} label={a.title} />
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenu>
            )}
          </HStack>
        </HStack>
        <Divider />
      </VStack>
      {openId && threadsQ.isSuccess && !threads.some(t => t.id === openId) && (
        <Banner status="info" title="Kortet finns inte längre." description="Det kan ha tagits bort i källsystemet." />
      )}
      <VStack id="att-gora-lista" role={mobile ? 'region' : 'tabpanel'} aria-label={tabTitle[tab]} gap={5}>
        {tabContent}
      </VStack>
    </VStack>
  );

  // The box's context for `@`: the cards in view, in the tab and the area the address names.
  const near = (
    tab === 'waiting'
      ? g.waiting
      : tab === 'snoozed'
        ? g.snoozed
        : tab === 'done'
          ? []
          : [...g.nu, ...g.senare, ...g.foreslar, ...g.kannedom]
  ).map(t => 'thread:' + t.id);
  // On a phone the box is docked at the foot (G on the phone): the greeting sits right above it.
  const docked = mobile && !short;
  /**
   * Beside the column (D53, artboard A): the day with its free gaps, and what happened since yesterday. Where the panel
   * fits beside the column this is the panel at rest, and a card, a view or a card's read takes its place; where the
   * panel does not fit, and on a phone, it ends the page, after the day's work (D48).
   */
  const asideContent = (
    <VStack gap={4}>
      {day && <Today view={day} threads={threads} cardHref={cardHref} />}
      {!loadingThreads && (
        <Since
          handled={closedToday}
          waiting={all.waiting}
          sources={sources}
          now={now}
          doneHref={homeHref({ tab: 'done' })}
        />
      )}
    </VStack>
  );
  const aside = (
    <VStack as="aside" aria-label="Bredvid">
      {asideContent}
    </VStack>
  );
  // The box is anchored under the greeting (D53): nothing above it changes, and what grows under it while the person
  // types ("Menar du") pushes the day's work down, never the field they are typing in (D36).
  const landing = () => {
    // The lead (artboard A): the person by first name as the page's h1 at level 1 (D71's page title), the sparkle beside it, and the day, the week and the unit at the end of the line.
    const greeting = (
      <HStack gap={2} vAlign="center">
        <Icon icon={SparklesIcon} size="md" color="accent" />
        <Heading id="hem" tabIndex={-1} level={1}>
          Hej {user.name.split(' ')[0]}
        </Heading>
      </HStack>
    );
    const date = `${capital(dayLabel(todayDate))} · vecka ${weekNumber(todayDate)} · ${user.unitLabel}`;
    // On a phone the day stands under the greeting in supporting, where it can wrap (artboard 11).
    const lead = mobile ? (
      <VStack gap={0.5}>
        {greeting}
        <Text type="supporting" as="p">
          {date}
        </Text>
      </VStack>
    ) : (
      <HStack justify="between" vAlign="center" gap={4} wrap="wrap">
        {greeting}
        <Text color="secondary" as="p">
          {date}
        </Text>
      </HStack>
    );
    const box = <Composer place="landing" near={near} about={about} />;
    const menarDu = <Suggestions viewHref={viewHref} cardHref={cardHref} />;
    const column = work();
    // One flow from the top on every screen: the greeting and the box (docked at the foot on a phone), then the day's work
    // with the day and what happened since yesterday beside it (artboard A's two columns), under it where they do not fit,
    // and gone while a card, a view or a card's read stands in the panel (artboard E).
    return (
      <VStack gap={6}>
        <VStack gap={mobile ? 3 : 6} as="section" aria-label="Vad vill du göra">
          {lead}
          {!docked && (
            <VStack gap={2}>
              {box}
              {menarDu}
            </VStack>
          )}
        </VStack>
        {slot.end ? (
          column
        ) : twoColumns && !mobile ? (
          <Grid columns={3} gap={8} align="start">
            <GridSpan columns={2}>{column}</GridSpan>
            {aside}
          </Grid>
        ) : (
          <VStack gap={6}>
            {column}
            {aside}
          </VStack>
        )}
      </VStack>
    );
  };

  /**
   * The panel (D50): the view the address names, a card's own read, or a card. A view that is also a tool in the
   * person's menu (D40) offers its page. In a conversation the card beside the transcript is the one the question was
   * asked about; on a phone Hem draws its cards in the list, so a card has no panel there. With nothing open, the
   * panel beside Hem rests on the day and what happened since yesterday (D53).
   */
  // A card stays a tab while it is in the stream (D66): snoozed or dismissed, it leaves the row with the pile. A done
  // card stays while its receipt can still be undone (D70): the receipt is the person's own result, and Ångra is on it.
  const inStream = (threadId: string) =>
    threads.some(
      t =>
        t.id === threadId &&
        ((t.state === 'open' && !isSnoozed(t, now)) ||
          (t.state === 'handled' && !!t.receipt?.undoCapability && !!t.receipt.undoUntil && t.receipt.undoUntil > now)),
    );
  const panelCard =
    panel?.kind === 'card' && !cardsInSheet ? (threads.find(t => t.id === panel.threadId) ?? null) : null;
  const tool = viewPanel ? menu.find(e => e.capability === viewPanel.capability) : undefined;
  const frame: PanelFrame | null = view
    ? {
        // Named by the view on screen, not by the one on its way: focus follows a view when its rows are there to land on.
        id: capabilityShown
          ? `view:${capabilityShown.capability}`
          : `action:${actionPanel?.threadId}:${actionPanel?.actionId}`,
        title: view.title,
        address: capabilityShown?.address ?? here + location.search,
        wide: view.spec?.kind === 'table',
        onClose: closePanel,
        actions: tool ? (
          <Button
            size="sm"
            variant="ghost"
            label="Öppna som sida"
            href={toolHref(tool.capability, capabilityShown?.input)}
          />
        ) : undefined,
        body: inline => (
          <PanelBody
            output={view.output}
            view={view.spec}
            source={view.source}
            input={capabilityShown?.input ?? {}}
            inline={inline}
            isLoading={capabilityView.isFetching && capabilityView.isPlaceholderData}
            onOpenItem={(item, dayItems) => setOpenItem({ item, dayItems })}
            /* A declared view (D38): its controls rewrite the address, so the view stays addressable and the back button undoes a search; a row's own view is a link. A card's view has no controls: its input is the card's. */
            onInput={
              capabilityShown && capabilityShown.capability === viewPanel?.capability
                ? next =>
                    navigate(viewHref(capabilityShown.capability, capabilityShown.title, next, capabilityShown.via), {
                      replace: true,
                    })
                : undefined
            }
            hrefFor={v => viewHref(v.capability, v.title, v.input, true)}
            onBack={capabilityShown?.via ? () => navigate(-1) : undefined}
          />
        ),
      }
    : panelCard
      ? {
          id: `card:${panelCard.id}`,
          kind: 'card',
          title: 'Kort',
          tab: panelCard.title,
          address: here + location.search,
          onClose: closePanel,
          // The card's buttons, Inte nu among them, are the card's own: the header holds what is open and ✕ (D66).
          body: () => card(panelCard, { beside: true, compact: true, level: 3, next: nextFor(panelCard) }),
        }
      : null;
  const slot = usePanel(frame, {
    minMain: talk.open ? CONVERSATION_MIN : HOME_MIN,
    overlayOnly: short,
    // Where the panel fits beside Hem it rests on the day and Sedan i går and can be folded away like an open card.
    rest: talk.open ? undefined : asideContent,
    isOpen: id => !id.startsWith('card:') || inStream(id.slice(5)),
  });
  /**
   * The card on a phone (artboard 12): Astryx's BottomSheet over the rows, with the way back to Hem and ✕ on its first
   * line, the card under them as beside the column. The last card shown stays drawn while the sheet slides away.
   */
  const sheetThread =
    cardsInSheet && panel?.kind === 'card' && inStream(panel.threadId)
      ? (threads.find(t => t.id === panel.threadId) ?? null)
      : null;
  const sheetShown = useRef<Thread | null>(null);
  if (sheetThread) sheetShown.current = sheetThread;
  const sheetCard = sheetShown.current;
  const sheet = (
    <BottomSheet
      isOpen={!!sheetThread}
      onOpenChange={isOpen => !isOpen && closePanel()}
      label={sheetCard ? `Kort: ${sheetCard.title}` : 'Kort'}
      height="tall"
    >
      {sheetCard && (
        <VStack gap={3}>
          <HStack justify="between" vAlign="center" gap={2}>
            <Button variant="ghost" label="Hem" icon={<Icon icon="chevronLeft" />} onClick={closePanel} />
            <IconButton variant="ghost" label="Stäng kortet" icon={<Icon icon="close" />} onClick={closePanel} />
          </HStack>
          {card(sheetCard, { beside: true, compact: true, sheet: true, level: 2, next: nextFor(sheetCard) })}
        </VStack>
      )}
    </BottomSheet>
  );
  /** What Hem's box asks about: the open card, which the conversation then keeps beside the transcript; "Ny fråga i stället" lets go of it. */
  const about: ComposerAbout | undefined = panelCard
    ? {
        label: `kortet ${panelCard.title}`,
        search: besideTranscript ? `?card=${encodeURIComponent(panelCard.id)}` : '',
        chips: [{ ref: 'thread:' + panelCard.id, kind: 'thread', label: panelCard.title, threadId: panelCard.id }],
        clearHref: withoutPanel(here, search),
      }
    : undefined;

  /** The transcript's lead on a short screen, where there is no pinned toolbar: the title and the way out, in the flow. */
  const conversationHeader = (
    <HStack justify="between" vAlign="center" gap={2} wrap="wrap">
      <Heading level={1}>{titled(talk.conversation?.title ?? talk.pending?.text ?? '')}</Heading>
      <HStack gap={1}>
        <Button size="sm" variant="ghost" label="Nytt samtal" onClick={talk.newConversation} />
        <Button size="sm" variant="ghost" label="Stäng samtalet" onClick={talk.close} />
      </HStack>
    </HStack>
  );
  /** When the person asked the conversation's first question: H1's line beside the title. "Nytt samtal i stället" sits in the box's scope line. */
  const started = (state: ConversationState) => {
    const first = state.conversation?.messages.find(m => m.role === 'user');
    if (!first) return null;
    const at = displayDate(first.createdAt);
    return at === todayDate
      ? timeLabel(first.createdAt)
      : `${at === addDays(todayDate, -1) ? 'i går' : shortDayLabel(at)} ${timeLabel(first.createdAt)}`;
  };
  const conversationToolbar = (
    <Toolbar
      label="Samtalet"
      size="sm"
      startContent={
        <Heading level={1}>{titled(talk.conversation?.title ?? talk.pending?.text.slice(0, 80) ?? '')}</Heading>
      }
      endContent={
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
  const transcript = (
    <Transcript
      onOpenView={openView}
      renderCard={t => (panelCard?.id === t.id ? null : card(t, { level: 2 }))}
      viewHref={v => viewHref(v.capability, v.title, v.input, true)}
    />
  );

  /** What the column holds: the transcript when a conversation is open (D31), else Hem. The panel is the Layout's end. */
  const column = () => {
    if (talk.open)
      return short ? (
        <VStack gap={4} padding={3}>
          {conversationHeader}
          {transcript}
          <Composer place="conversation" />
        </VStack>
      ) : (
        <Layout
          height="fill"
          padding={mobile ? 3 : 4}
          defaultHasDividers
          header={
            <LayoutHeader>
              <VStack paddingInline={mobile ? 0 : 6}>{conversationToolbar}</VStack>
            </LayoutHeader>
          }
          end={slot.end}
          content={
            <LayoutContent isScrollable={false} padding={0}>
              {/* The ChatLayout spans the content area full bleed and owns the scroll, so its scrollbar sits at the column's edge like a page's. The transcript and the dock take the width Hem's content has, 40 px in from the rail (the product owner, 2026-11-06: the same width as the start page), not a centred column. */}
              <VStack height="100%" paddingInline={mobile ? 0 : 6}>
                <ChatLayout density="balanced" composer={<Composer place="conversation" />}>
                  {transcript}
                </ChatLayout>
              </VStack>
            </LayoutContent>
          }
        />
      );
    // Hem (D53, artboard A): the content takes the width the rail leaves, the panel beside it when something is open,
    // the box in the page flow under the greeting; on a phone the box is docked at the foot, and on a short screen nothing is docked.
    return short ? (
      <VStack gap={4} padding={3}>
        {landing()}
      </VStack>
    ) : (
      <Layout
        height="fill"
        padding={0}
        end={slot.end}
        content={
          <LayoutContent isScrollable padding={0}>
            <VStack
              paddingInline={mobile ? 3 : 10}
              paddingBlockStart={mobile ? 3 : 6}
              paddingBlockEnd={mobile ? 3 : 10}
            >
              {landing()}
            </VStack>
          </LayoutContent>
        }
        footer={
          docked ? (
            <LayoutFooter>
              <VStack gap={2}>
                <Suggestions viewHref={viewHref} cardHref={cardHref} />
                <Composer place="landing" near={near} about={about} />
              </VStack>
            </LayoutFooter>
          ) : undefined
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
              description="Knapparna, korten, pushen och kalendern fungerar som vanligt. Rutan hittar bara exakta saker, och frågor i fri text väntar tills modellen är tillbaka."
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
        {column()}
      </Shell>
      {slot.overlay}
      {sheet}
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
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      if (open) focus();
      return;
    }
    focus();
  }, [open, focus]);
  return null;
}
