import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Area, Figure, MenuEntry, SessionUser, Thread, ViewRef, PanelViewSpec } from '@clew/contracts';
import {
  Banner,
  Button,
  ChatLayout,
  ClickableCard,
  Divider,
  DropdownMenu,
  EmptyState,
  Grid,
  Heading,
  HStack,
  Icon,
  IconButton,
  InfoTip,
  Layout,
  LayoutContent,
  LayoutFooter,
  LayoutHeader,
  List,
  MoreMenu,
  Selector,
  SparklesIcon,
  Tab,
  TabList,
  Text,
  ToggleButton,
  Toolbar,
  VStack,
  useAnnounce,
  useMediaQuery,
  useToast,
} from '@clew/ui';
import { addDays, dayLabel, displayDate, shortDayLabel, timeLabel, today } from '@clew/calendar/dates';
import { api } from '../api';
import { errorMessage } from '../query-policy';
import {
  areasQuery,
  assistantQuery,
  attentionQuery,
  cardViewQuery,
  figuresQuery,
  threadsQuery,
  todayQuery,
  viewQuery,
} from '../queries';
import { applyThread } from '../thread-cache';
import { keys } from '../query-keys';
import { groupThreads } from '../stream';
import { clewIcon } from '../icons';
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
import { Lage } from '../components/lage';
import { Today } from '../components/today';
import { Since } from '../components/since';
import { usePageTitle } from '../page-title';

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
const ALL_AREAS = 'all';
const EMPTY_THREADS: Thread[] = [];
const EMPTY_AREAS: Area[] = [];
const EMPTY_MENU: MenuEntry[] = [];
const EMPTY_FIGURES: Figure[] = [];
/** A figure's tile asks the question the router answers without the model (D8): the figures are read, never a thread. */
const figureQuestion: Record<Figure['id'], string> = {
  korttidsfranvaro: 'Hur ser korttidsfrånvaron ut?',
  budgetavvikelse: 'Hur ligger budgeten?',
  hme: 'Vad säger HME?',
  utvecklingssamtal: 'Hur ligger vi till med utvecklingssamtalen?',
};

/**
 * The start page (D34, D50, D53). The column is where the person is and the panel is what they hold beside it. At `/`
 * the column is Hem: the greeting with the day, the box, and under it everything the assistant has pushed, with a
 * card's state as the tabs (Behöver dig, Väntar på andra, Inte nu, Klart), the areas as a filter, Läget's figures and
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
  // Where a transcript and the panel fit side by side, a conversation asked on a page brings what the page showed along (D50).
  const besideTranscript = useMediaQuery(panelBesideQuery(CONVERSATION_MIN));
  // Every read is a query (D33): one cache shared by the page, the cards, the rail and the conversation. A mutation writes the thread it returns into it (thread-cache.ts).
  const client = useQueryClient();
  const threadsQ = useQuery(threadsQuery);
  const areasQ = useQuery(areasQuery);
  const dayQ = useQuery(todayQuery);
  const assistantQ = useQuery(assistantQuery);
  // Hem's extras: how often the assistant interrupts, behind a tip, and Läget's figures under the day's work.
  const attentionQ = useQuery(attentionQuery);
  const figuresQ = useQuery(figuresQuery);
  const attention = attentionQ.data ?? null;
  const figures = figuresQ.data?.figures ?? EMPTY_FIGURES;
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
    // A card in the panel keeps the focus when its own button changed it: the card is still there, in its new state.
    const beside = document.activeElement?.closest<HTMLElement>('[id^="card-"]');
    if (beside) {
      focusAfter.current = { card: beside.id, next: beside.id, at: Date.now() };
      return;
    }
    const cards = [...document.querySelectorAll('[id^="thread-"]')].map(el => el.id);
    const at = cards.indexOf('thread-' + thread.id);
    if (at >= 0)
      focusAfter.current = { card: cards[at]!, next: cards[at + 1] ?? cards[at - 1] ?? 'behover-dig', at: Date.now() };
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
  const areaTitle = (id: string) => areas.find(a => a.id === id)?.title ?? (id === 'fragor' ? 'Fråga' : id);
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
  const g = useMemo(() => groupThreads(threads, now, todayDate, inArea), [threads, now.slice(0, 16), todayDate, area]);
  const older = [
    ...threads.filter(t => t.state === 'open' && t.kind === 'question'),
    ...threads.filter(t => t.state !== 'open'),
  ];
  const railCurrent: RailCurrent = { surface: 'start', conversationId };
  const pageTitle = view ? view.title : conversationId ? 'Samtal' : 'Hem';
  usePageTitle(pageTitle, view || conversationId ? false : pageTitle);
  const nav = useRail({ current: railCurrent, admin });

  const openCard = (threadId: string) => navigate(withCard(here, search, threadId));
  const openCardView = (threadId: string, actionId: string) => navigate(withAction(here, search, threadId, actionId));
  // On a phone Hem has no panel for a card: every thread is a card in the list, and the one the address names is brought into view.
  const cardsInline = mobile && !talk.open;
  const focusedCard = useRef<string | null>(null);
  useEffect(() => {
    if (!cardsInline || !openId || !threadsQ.data || focusedCard.current === location.key) return;
    const focus = () => {
      if (focusedCard.current === location.key || document.querySelector('dialog[open]')) return;
      const target = document.getElementById('thread-' + openId);
      if (!target) return;
      focusedCard.current = location.key;
      target.scrollIntoView({ block: 'center' });
      target.focus({ preventScroll: true });
    };
    // After the navigation drawer has closed, including its exit animation: an open modal rejects focus outside it.
    const frame = requestAnimationFrame(focus);
    document.addEventListener('close', focus, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('close', focus, true);
    };
  }, [cardsInline, openId, location.key, threadsQ.data]);
  const card = (t: Thread, options: { level?: 2 | 3; beside?: boolean; compact?: boolean } = {}) =>
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
        areaTitle={areaTitle(t.area)}
        headingLevel={options.level ?? 3}
        beside={!!options.beside}
        onChange={replace}
        onOpenCardView={openCardView}
      />
    );
  /** A group's threads (D31, D50): rows in one list, the title of each opening its card in the panel; on a phone every thread is a card. */
  const records = (list: Thread[], options: { notice?: boolean } = {}) =>
    cardsInline ? (
      <VStack gap={2}>{list.map(t => card(t))}</VStack>
    ) : (
      // A run of rows is one list fenced by dividers (the structure guide: rows with dividers, no card), its text on the column's content line (edge flush).
      <VStack gap={0}>
        <Divider />
        <List hasDividers density="balanced" edge="flush">
          {list.map(t => (
            <ThreadRow
              key={t.id}
              thread={t}
              areaTitle={areaTitle(t.area)}
              notice={options.notice}
              isOpen={openId === t.id}
              onChange={replace}
              onOpenCardView={openCardView}
              onExpand={openCard}
            />
          ))}
        </List>
        <Divider />
      </VStack>
    );
  const assistantDown = !!assistant && assistant.configured && !assistant.available;
  const needsYou = g.nu.length + g.senare.length + g.foreslar.length + g.kannedom.length;

  /** Behöver dig (D34): the groups ranked by weight at one size, in the page's outline as level 2. The heading says what the group is; why it exists is ours to know, not the reader's. */
  const needs = (
    <VStack gap={5}>
      <VStack gap={2} as="section" aria-label="Nu">
        <Heading id="behover-dig" tabIndex={-1} level={2}>
          {loadingThreads ? 'Nu' : g.nu.length === 0 ? 'Inget brådskar just nu' : `Nu · ${g.nu.length}`}
        </Heading>
        {loadingThreads && <BriefSkeleton compact={mobile} />}
        {threadsQ.data?.sources?.some(s => !s.lastSuccess || s.error) && (
          <Text as="p" role="status">
            {threadsQ.data.sources.some(s => s.error)
              ? 'Någon källa kunde inte kontrolleras. Sparade uppgifter visas och kontrolleras igen.'
              : 'Källorna kontrolleras. Sparade uppgifter visas under tiden.'}
          </Text>
        )}
        {!loadingThreads && needsYou === 0 && (
          <EmptyState
            title={
              threadsQ.data?.sources?.some(s => !s.lastSuccess || s.error) ? 'Inväntar källornas besked' : 'Lugnt läge'
            }
            description="Assistenten hör av sig när något behöver dig."
            isCompact
            headingLevel={3}
          />
        )}
        {g.nu.length > 0 && records(g.nu)}
      </VStack>
      {g.senare.length > 0 && (
        <VStack gap={2} as="section" aria-label="Senare">
          <Heading id="senare" tabIndex={-1} level={2}>
            Senare · {g.senare.length}
          </Heading>
          {records(g.senare)}
        </VStack>
      )}
      {g.foreslar.length > 0 && (
        <VStack gap={2} as="section" aria-label="Jag föreslår">
          <Heading id="proposals" tabIndex={-1} level={2}>
            Jag föreslår · {g.foreslar.length}
          </Heading>
          {records(g.foreslar)}
        </VStack>
      )}
      {g.kannedom.length > 0 && (
        <VStack gap={2} as="section" aria-label="Till kännedom">
          <Heading id="notices" tabIndex={-1} level={2}>
            Till kännedom · {g.kannedom.length}
          </Heading>
          {records(g.kannedom, { notice: true })}
        </VStack>
      )}
      {/* The day's work comes first, on every screen (D48); the figures follow it, for every area at once. */}
      {!area && figures.length > 0 && (
        <Lage
          figures={figures}
          unitLabel={user.unitLabel}
          compact={mobile}
          onOpen={f => talk.ask(figureQuestion[f.id], { chips: [], search: '' })}
        />
      )}
    </VStack>
  );
  /** Väntar på andra and Inte nu (D28; the name is D53's): what waits on someone else, and what the person set aside. The tab's panel is the named region. */
  const pile = (list: Thread[], title: string, empty: string) => (
    <VStack gap={2}>
      <Heading level={2}>
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
  const tabLabel = (t: TodoTab) =>
    t === 'needs-you'
      ? `Behöver dig · ${needsYou}`
      : t === 'waiting'
        ? `Väntar på andra · ${g.waiting.length}`
        : t === 'snoozed'
          ? `Inte nu · ${g.snoozed.length}`
          : 'Klart';
  /**
   * The day's work (D50 and D53, after the `table-inbox` template: a status control over a queue of rows, and the chosen
   * row's detail beside it): the tabs with the area filter on their line, then the tab's rows. The tabs switch the rows
   * in place, so they speak the tabs pattern and point at the panel they fill. There is no heading of its own: Hem's
   * greeting is the page's h1, and the groups are its h2s.
   */
  const work = (
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
                <Tab key={t} value={t} label={tabLabel(t)} panelId="att-gora-lista" />
              ))}
            </TabList>
          )}
          <HStack gap={1} vAlign="center" wrap="wrap">
            {/* How often the assistant interrupts is help, not a thing to do, so it sits behind the tip (D48). */}
            {attention && (
              <InfoTip
                label="Så här hör jag av mig"
                content={`Jag stör högst ${attention.budget} gånger mellan sammanfattningarna, bara för deadline samma dag eller något du själv bad om. Allt annat samlas.`}
              />
            )}
            {/* Under a finger a choice is a button that opens a sheet, as the log's filter and the calendar's views are; with a mouse it is a selector. */}
            {areas.length > 0 &&
              (mobile ? (
                <DropdownMenu
                  presentation="adaptive"
                  button={{ label: `Område: ${area ? areaTitle(area) : 'Alla'}`, size: 'sm', variant: 'secondary' }}
                  items={[
                    { id: ALL_AREAS, label: 'Alla områden', onClick: () => navigate(homeHref({ area: null })) },
                    ...areas.map(a => ({
                      id: a.id,
                      label: a.title,
                      onClick: () => navigate(homeHref({ area: a.id })),
                    })),
                  ]}
                />
              ) : (
                <Selector
                  label="Område"
                  isLabelHidden
                  size="sm"
                  variant="secondary"
                  value={area ?? ALL_AREAS}
                  options={[
                    { value: ALL_AREAS, label: 'Alla områden' },
                    ...areas.map(a => ({ value: a.id, label: a.title })),
                  ]}
                  onChange={value => navigate(homeHref({ area: value && value !== ALL_AREAS ? value : null }))}
                />
              ))}
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

  /**
   * What the box offers under it (D41, the template's categories): the person's own areas that have something to start,
   * each a toggle; the chosen one shows its connector's standing actions for the role as cards. Nothing is chosen at
   * first, as in the template, and choosing never moves the box: the cards come under it. Where they open under the
   * fold (a phone, a low window) they are brought into view, without animation.
   */
  const offers = useMemo(() => areas.filter(a => a.standing.length > 0), [areas]);
  const [chosen, setChosen] = useState<string | null>(null);
  const offer = offers.find(a => a.id === chosen) ?? null;
  useEffect(() => {
    if (chosen) document.getElementById('omradets-kort')?.scrollIntoView({ block: 'nearest' });
  }, [chosen]);
  const all = useMemo(() => groupThreads(threads, now, todayDate), [threads, now.slice(0, 16), todayDate]);
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
  const aside = (
    <VStack gap={6}>
      {day && <Today view={day} compact />}
      {!loadingThreads && (
        <Since
          handled={all.handledToday}
          waiting={all.waiting}
          now={now}
          cardHref={cardHref}
          doneHref={homeHref({ tab: 'done' })}
        />
      )}
    </VStack>
  );
  // The box is anchored under the greeting (D53): nothing above it changes, and what grows under it while the person
  // types ("Menar du") pushes the day's work down, never the field they are typing in (D36).
  const landing = () => {
    // The lead: the person by first name as the page's h1, with the sparkle the `ai-chat-landing` template puts beside its greeting, and the day under it.
    const lead = (
      <VStack gap={1}>
        <HStack gap={2} vAlign="center">
          <Icon icon={SparklesIcon} size="md" color="accent" />
          <Heading id="hem" tabIndex={-1} level={1} type={mobile ? undefined : 'display-2'}>
            Hej, {user.name.split(' ')[0]}
          </Heading>
        </HStack>
        <Text type="supporting" as="p">
          {dayLabel(todayDate)}
        </Text>
      </VStack>
    );
    const box = <Composer place="landing" roomy near={near} about={about} />;
    const menarDu = <Suggestions viewHref={viewHref} cardHref={cardHref} />;
    // A card is one standing action: a read is a link to its view, anything else is asked in the box, as "Menar du" does it.
    const offered = offers.length > 0 && (
      <VStack gap={6} as="section" aria-label="Det du kan göra">
        {/* The template's row is a ToggleButtonGroup, which keeps its buttons on one line whatever the width. A person's areas
          are as many as their connectors give them, so the same toggles stand in a wrapping HStack (D41, the gap noted there). */}
        <HStack gap={1} wrap="wrap" role="group" aria-label="Områden">
          {offers.map(a => (
            <ToggleButton
              key={a.id}
              size="lg"
              label={a.title}
              isPressed={a.id === offer?.id}
              onPressedChange={pressed => setChosen(pressed ? a.id : null)}
              icon={a.icon ? <Icon icon={clewIcon[a.icon]} size="sm" /> : undefined}
            />
          ))}
        </HStack>
        {offer && (
          <Grid id="omradets-kort" columns={{ minWidth: 280 }} gap={3} role="group" aria-label={offer.title}>
            {offer.standing.map(s => (
              <ClickableCard
                key={s.capability}
                label={s.label}
                variant="muted"
                padding={3}
                {...(s.kind === 'read'
                  ? { href: viewHref(s.capability, s.label) }
                  : { onClick: () => talk.ask(s.label) })}
              >
                <VStack gap={0.5}>
                  <Text weight="semibold">{s.label}</Text>
                  <Text type="supporting">
                    {offer.source} · {s.kind === 'read' ? 'öppnar vyn' : 'öppnar kortet'}
                  </Text>
                </VStack>
              </ClickableCard>
            ))}
          </Grid>
        )}
      </VStack>
    );
    // One flow from the top on every screen: the greeting and the box (docked at the foot on a phone), the day's work, what
    // the person can start, and where the panel does not stand beside the column, the day and what happened since yesterday.
    return (
      <VStack gap={8}>
        <VStack gap={mobile ? 4 : 6} as="section" aria-label="Vad vill du göra">
          {lead}
          {!docked && (
            <VStack gap={2}>
              {box}
              {menarDu}
            </VStack>
          )}
        </VStack>
        {work}
        {offered}
        {!slot.end && aside}
      </VStack>
    );
  };

  /**
   * The panel (D50): the view the address names, a card's own read, or a card. A view that is also a tool in the
   * person's menu (D40) offers its page. In a conversation the card beside the transcript is the one the question was
   * asked about; on a phone Hem draws its cards in the list, so a card has no panel there. With nothing open, the
   * panel beside Hem rests on the day and what happened since yesterday (D53).
   */
  const panelCard =
    panel?.kind === 'card' && !cardsInline ? (threads.find(t => t.id === panel.threadId) ?? null) : null;
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
          title: 'Kort',
          address: here + location.search,
          onClose: closePanel,
          body: () => card(panelCard, { beside: true, compact: true, level: 3 }),
        }
      : null;
  const slot = usePanel(frame, {
    minMain: talk.open ? CONVERSATION_MIN : HOME_MIN,
    overlayOnly: short,
    rest: talk.open ? undefined : aside,
  });
  // A column alone is centred at its own width; with the panel beside it the column takes what the panel leaves (the `ai-chat` template's split).
  const width = (alone: number) => (slot.end ? {} : { contentWidth: alone });
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
      <Heading level={3} accessibilityLevel={1}>
        {titled(talk.conversation?.title ?? talk.pending?.text ?? '')}
      </Heading>
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
        <Heading level={3} accessibilityLevel={1}>
          {titled(talk.conversation?.title ?? talk.pending?.text.slice(0, 80) ?? '')}
        </Heading>
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
              icon={<Icon icon="close" size="sm" />}
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
          {...width(800)}
          padding={mobile ? 3 : 4}
          defaultHasDividers
          header={<LayoutHeader>{conversationToolbar}</LayoutHeader>}
          end={slot.end}
          content={
            <LayoutContent isScrollable={false} padding={0}>
              {/* The ChatLayout spans the content area full bleed and owns the scroll, so its scrollbar sits at the column's edge like a page's; the spacious density centres its stream and dock to one 800 px column. */}
              <VStack height="100%">
                <ChatLayout density="spacious" composer={<Composer place="conversation" />}>
                  {transcript}
                </ChatLayout>
              </VStack>
            </LayoutContent>
          }
        />
      );
    // Hem (D53): a 960 px column alone, the column and the panel side by side where both fit, the box in the page flow
    // under the greeting; on a phone the box is docked at the foot, and on a short screen nothing is docked.
    return short ? (
      <VStack gap={4} padding={3}>
        {landing()}
      </VStack>
    ) : (
      <Layout
        height="fill"
        {...width(960)}
        padding={mobile ? 3 : 4}
        end={slot.end}
        content={<LayoutContent isScrollable>{landing()}</LayoutContent>}
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
