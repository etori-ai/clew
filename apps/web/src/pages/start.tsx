import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Area, Figure, SessionUser, Thread, ViewRef, PanelViewSpec } from '@clew/contracts';
import { Banner, Button, ChatLayout, ClickableCard, Divider, EmptyState, Grid, GridSpan, Heading, HStack, Icon, IconButton, Layout, LayoutContent, LayoutFooter, Link, List, ListItem, MoreMenu, ProgressBar, Skeleton, SparklesIcon, Text, ToggleButton, Toolbar, VisuallyHidden, VStack, useMediaQuery, useToast } from '@clew/ui';
import { addDays, displayDate, shortDayLabel, timeLabel, timeRange, today } from '@clew/calendar/dates';
import { errorMessage } from '../query-policy';
import { areasQuery, assistantQuery, attentionQuery, cardViewQuery, figuresQuery, threadsQuery, todayQuery, viewQuery } from '../queries';
import { applyThread } from '../thread-cache';
import { keys } from '../query-keys';
import { digestSentence, groupThreads } from '../stream';
import { clewIcon } from '../icons';
import { Composer, Suggestions } from '../components/composer';
import { ConversationContext, ConversationProvider, type ConversationState } from '../components/conversation-context';
import { Transcript } from '../components/conversation';
import { useRail, type RailCurrent } from '../components/nav';
import { Shell, mobileQuery, narrowQuery, shortQuery } from '../components/shell';
import { GenericCard, ThreadRow } from '../components/card';
import { Brief, BriefSkeleton } from '../components/brief';
import { Lage } from '../components/lage';
import { PanelView } from '../components/panel';
import { EventDialog } from '../components/calendar/event-dialog';
import type { AgendaItem } from '@clew/ui';
import { Today } from '../components/today';
import { ThreadCard } from '../components/thread';
import { Handled } from '../components/handled';
import { usePageTitle } from '../page-title';

/** The three piles (D28), named as their addresses are (D43). */
type Pile = 'waiting' | 'snoozed' | 'handled';
type Mode = 'fraga' | 'oversikt';
const pileHref = (p: Pile) => `/${p}`;
const pileOf = (pathname: string): Pile | null => pathname === '/handled' ? 'handled' : pathname === '/waiting' ? 'waiting' : pathname === '/snoozed' ? 'snoozed' : null;
const pileTitle: Record<Pile, string> = { waiting: 'Pågår utan dig', snoozed: 'Inte nu', handled: 'Redan hanterat' };
const greeting = (hour: number) => hour < 10 ? 'God morgon' : hour < 18 ? 'God dag' : 'God kväll';
/** A figure's tile asks the question the router answers without the model (D8): the figures are read, never a thread. */
const figureQuestion: Record<Figure['id'], string> = { korttidsfranvaro: 'Hur ser korttidsfrånvaron ut?', budgetavvikelse: 'Hur ligger budgeten?', hme: 'Vad säger HME?', utvecklingssamtal: 'Hur ligger vi till med utvecklingssamtalen?' };
const EMPTY_THREADS: Thread[] = [];
const EMPTY_AREAS: Area[] = [];
const EMPTY_FIGURES: Figure[] = [];

/**
 * The start page (D34): "Vad vill du göra?" first. At `/` the box is the page, drawn as Astryx's `ai-chat-landing`
 * template (D41): the greeting and the question over the box, the person's areas as a row of toggles under it, and the
 * chosen area's standing actions as cards; the push is a brief of at most three rows above. A pull and a push produce the same card. The
 * whole picture is `/overview`: the greeting, Läget, the groups (Nu, Senare, Jag föreslår, Till kännedom) beside the day
 * and the piles. A conversation takes the column at `/conversations/:id` (D31). The route is the state throughout: `/areas/:area`
 * filters the overview, `/waiting`, `/snoozed` and `/handled` open a pile, `/views/…` the side panel. Every card comes from a
 * connector through the registry; the calendar's proposal card keeps its specialised rendering, everything else is the generic card.
 */
export function StartPage({ user, admin = false, mode }: { user: SessionUser; admin?: boolean; mode: Mode }) {
  const mobile = useMediaQuery(mobileQuery);
  // 1.4.10: with 480 px or less in height nothing is docked; the row joins the page and the whole page scrolls (D31 item 7).
  const short = useMediaQuery(shortQuery);
  // The overview's rail folds under the groups below 1024 px, as the alert-rail template folds its rail.
  const narrow = useMediaQuery(narrowQuery);
  // Every read is a query (D33): one cache shared by the page, the cards, the rail and the conversation. A mutation writes the thread it returns into it (thread-cache.ts).
  const client = useQueryClient();
  const threadsQ = useQuery(threadsQuery);
  const areasQ = useQuery(areasQuery);
  const dayQ = useQuery(todayQuery);
  const attentionQ = useQuery(attentionQuery);
  const assistantQ = useQuery(assistantQuery);
  const figuresQ = useQuery({ ...figuresQuery, enabled: mode === 'oversikt' });
  const threads = threadsQ.data?.threads ?? EMPTY_THREADS;
  // The first read of the cards (D36): until it is here the page draws their shape, never "nothing needs you".
  const loadingThreads = threadsQ.isPending;
  const areas = areasQ.data?.areas ?? EMPTY_AREAS;
  const figures = figuresQ.data?.figures ?? EMPTY_FIGURES;
  const day = dayQ.data ?? null;
  const attention = attentionQ.data ?? null;
  const assistant = assistantQ.data ?? null;
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams<{ area?: string; capability?: string; threadId?: string; actionId?: string; conversationId?: string }>();
  const [search] = useSearchParams();
  const pile = mode === 'oversikt' ? pileOf(location.pathname) : null;
  const area = mode === 'oversikt' ? params.area ?? (search.get('area') || null) : null;
  const conversationId = params.conversationId ?? null;
  const pathFor = (a: string | null) => a === null ? '/overview' : `/areas/${a}`;
  const home = mode === 'fraga' ? '/' : pathFor(area);
  const back = pile ? pileHref(pile) : home;
  const withArea = (path: string) => area ? `${path}${path.includes('?') ? '&' : '?'}area=${encodeURIComponent(area)}` : path;
  // `via` marks a view opened from another view (a row's contact card): the panel then offers the way back to it.
  const viewHref = (capability: string, title: string, input?: Record<string, unknown>, via = false) => withArea(`/views/${capability}?title=${encodeURIComponent(title)}` + (input && Object.keys(input).length ? `&input=${encodeURIComponent(JSON.stringify(input))}` : '') + (via ? '&via=1' : ''));
  const cardViewHref = (threadId: string, actionId: string) => withArea(`/views/card/${threadId}/${actionId}`);
  const conversationHref = (id: string) => `/conversations/${id}`;
  /** The overview with one card open: where a brief row's title leads. */
  const cardHref = (threadId: string) => `/overview?card=${encodeURIComponent(threadId)}`;
  // An entry opened from the panel's day view (D32): the same dialog as on the calendar page, over the panel.
  const [openItem, setOpenItem] = useState<{ item: AgendaItem; dayItems: AgendaItem[] } | null>(null);
  const toast = useToast();
  // A reminder that fired while the page was open (D17): the card is back in its place with a badge, and a toast says so.
  // The toast is the announcement: it animates in beside the composer and stays until dismissed; the stream never shifts.
  const remindedSeen = useRef<Map<string, string | null> | null>(null);
  const announceReminded = useCallback((list: Thread[]) => {
    const seen = remindedSeen.current;
    if (seen) for (const t of list) {
      if (t.state !== 'open' || !t.remindedAt || seen.get(t.id) === t.remindedAt) continue;
      const dismiss = toast({ body: `Påminnelse: ${t.title}`, isAutoHide: false, uniqueID: 'reminded:' + t.id,
        endContent: <Button size="sm" variant="ghost" label="Visa" onClick={() => { const shown = document.getElementById('thread-' + t.id); shown?.scrollIntoView({ behavior: 'smooth', block: 'center' }); shown?.focus({ preventScroll: true }); dismiss(); }} /> });
    }
    remindedSeen.current = new Map(list.map(t => [t.id, t.remindedAt]));
  }, [toast]);
  // Every list the cache hands over is looked at once: a reminder that fired shows up as a changed `remindedAt`, whether a refetch or a mutation brought it.
  useEffect(() => { if (threadsQ.data) announceReminded(threadsQ.data.threads); }, [threadsQ.data, announceReminded]);
  // A card that leaves the stream takes the focused button with it. Focus goes on to the next card, or the first heading when none is left (2.4.3).
  // `replace` is what every card gets as `onChange`: it runs before the cache is written (mutations.ts), so the DOM read here is still the old one.
  const focusAfter = useRef<{ card: string; next: string; at: number } | null>(null);
  const replace = useCallback((thread: Thread) => {
    const cards = [...document.querySelectorAll('[id^="thread-"]')].map(el => el.id);
    const at = cards.indexOf('thread-' + thread.id);
    if (at >= 0) focusAfter.current = { card: cards[at]!, next: cards[at + 1] ?? cards[at - 1] ?? 'behover-dig', at: Date.now() };
  }, []);
  useEffect(() => {
    const target = focusAfter.current;
    focusAfter.current = null;
    // A thread that came back unchanged renders nothing (structural sharing), so a stale note is dropped rather than moving focus later.
    if (!target || Date.now() - target.at > 2_000 || document.activeElement !== document.body) return;
    // A card that moved to a pile is no longer in the stream; a card that only changed state is still here.
    const card = document.getElementById(target.card);
    const next = card?.checkVisibility() ? card : document.getElementById(target.next) ?? document.getElementById('behover-dig') ?? document.getElementById('senare') ?? document.getElementById('vad-vill-du-gora');
    // A row's focus goes to its title button, the control with the ring; a card is focused as a whole, as before.
    (next?.matches('li') ? next.querySelector<HTMLElement>('button, a') ?? next : next)?.focus();
  }, [threads]);
  // A view is addressable (integrations.md, "Answers and views"): the panel follows /views/:capability or /views/card/:thread/:action.
  const viewInput = search.get('input'), viewTitle = search.get('title');
  // A declared view with a search field (D38) asks again as the person types: the rows on screen stay until the next ones arrive, so the panel and the field's focus stay put.
  const capabilityView = useQuery({ ...viewQuery(params.capability ?? '', viewInput), enabled: !!params.capability, placeholderData: keepPreviousData });
  // The view on screen. Another capability's view takes its place when it has arrived, not before: the panel stays open
  // between a row and its contact card, and focus can follow. Typing in a view's own field keeps that view's rows meanwhile.
  const shownView = useRef<{ capability: string; title: string; output: unknown; spec: PanelViewSpec | undefined; input: Record<string, unknown>; via: boolean; address: string } | null>(null);
  const viewInputValue = useMemo(() => { try { const v: unknown = viewInput ? JSON.parse(viewInput) : {}; return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {}; } catch { return {}; } }, [viewInput]);
  const cardView = useQuery({ ...cardViewQuery(params.threadId ?? '', params.actionId ?? ''), enabled: !!params.threadId && !!params.actionId });
  // What a card action answered is acted on once per answer (StrictMode replays effects): an executed thread goes into the cache, a link opens a tab.
  const acted = useRef<unknown>(null);
  useEffect(() => {
    const result = cardView.data;
    if (!result || acted.current === result) return;
    acted.current = result;
    if (result.kind === 'execute') { replace(result.thread); void applyThread(client, result.thread); }
    else if (typeof (result.output as { url?: string }).url === 'string') window.open((result.output as { url: string }).url, '_blank', 'noopener');
  }, [cardView.data, client, replace]);
  const arrived = capabilityView.data && (!capabilityView.isPlaceholderData || capabilityView.data.view?.capability === params.capability) ? capabilityView.data : undefined;
  if (!params.capability || capabilityView.isError) shownView.current = null;
  else if (arrived) shownView.current = { capability: params.capability, title: viewTitle ?? params.capability, output: arrived.output, spec: arrived.view, input: viewInputValue, via: search.get('via') === '1', address: location.pathname + location.search };
  const capabilityShown = params.capability ? shownView.current : null;
  const view = useMemo(() => {
    if (params.capability) return capabilityShown ? { title: capabilityShown.title, output: capabilityShown.output, spec: capabilityShown.spec } : null;
    const result = params.threadId && params.actionId ? cardView.data : undefined;
    if (!result) return null;
    const label = threads.find(t => t.id === params.threadId)?.actions.find(a => a.id === params.actionId)?.label ?? 'Vy';
    if (result.kind === 'execute') return { title: label, output: result.thread.receipt, spec: undefined };
    if (typeof (result.output as { url?: string }).url === 'string') return null;
    return { title: label, output: result.output, spec: result.view };
  }, [params.capability, params.threadId, params.actionId, capabilityShown, cardView.data, threads]);
  // The page's one alert: a read that failed before it had anything to show. A failed refetch keeps the old data and says nothing; the day, the figures and the model's status are extras.
  const failed = [threadsQ, areasQ, attentionQ].find(q => q.isError && q.data === undefined);
  const error = failed ? errorMessage(failed.error, 'Sidan kunde inte läsas.')
    : capabilityView.isError ? errorMessage(capabilityView.error, 'Kunde inte hämta.')
    : cardView.isError ? errorMessage(cardView.error, 'Kunde inte hämta.') : null;
  const openStanding = (capability: string, label: string) => navigate(viewHref(capability, label));
  const openView = (v: ViewRef) => navigate(viewHref(v.capability, v.title, v.input));
  const areaTitle = (id: string) => areas.find(a => a.id === id)?.title ?? (id === 'fragor' ? 'Fråga' : id);
  const inArea = (t: Thread) => area === null || t.area === area;
  const now = new Date().toISOString();
  const todayDate = today();
  // The groups (D34): requirements by their day, proposals, events; the piles at the edge.
  const g = useMemo(() => groupThreads(threads, now, todayDate, inArea), [threads, now.slice(0, 16), todayDate, area]);
  const older = [...threads.filter(t => t.state === 'open' && t.kind === 'question'), ...threads.filter(t => t.state !== 'open')];
  const remaining = attention ? Math.max(0, attention.budget - attention.used) : null;
  const current = useMemo(() => areas.find(a => a.id === area) ?? null, [areas, area]);
  const hashGroup = location.hash === '#proposals' ? 'foreslar' : location.hash === '#notices' ? 'kannedom' : 'behover-dig';
  const railCurrent: RailCurrent = { surface: mode === 'fraga' ? 'start' : 'oversikt', group: mode === 'oversikt' && !pile && !area ? hashGroup : null, pile, area, conversationId };
  const pageTitle = view ? view.title : conversationId ? 'Samtal' : pile ? pileTitle[pile] : current?.title ?? (area ? null : mode === 'fraga' ? 'Vad vill du göra' : 'Hela bilden');
  usePageTitle(pageTitle, view || conversationId ? false : pageTitle ?? false);
  const onConversation = useCallback((id: string | null) => { if (id) navigate(conversationHref(id)); else if (conversationId) navigate(back); }, [navigate, conversationId, back]);
  const nav = useRail({ current: railCurrent, admin });

  const openCardView = (threadId: string, actionId: string) => navigate(cardViewHref(threadId, actionId));
  // Records are rows and a card is the exception (D31, Astryx structure guide): the first thread in Nu, a proposal thread, a
  // thread in a pile, the card a brief row pointed at (`?card=`) and every thread on a phone is a card; the rest are rows the person opens.
  const kort = search.get('card');
  const [opened, setOpened] = useState<Set<string>>(() => new Set(kort ? [kort] : []));
  const focusedReminder = useRef<string | null>(null);
  // A reminder navigates to the unfiltered stream. Focus after the drawer closes, including its exit
  // animation: an open modal rejects focus outside it. A later cache refresh never takes focus again.
  useEffect(() => {
    if (!kort || !threadsQ.data || location.pathname !== '/overview' || focusedReminder.current === location.key) return;
    const focus = () => {
      if (focusedReminder.current === location.key || document.querySelector('dialog[open]')) return;
      const target = document.getElementById('thread-' + kort);
      if (!target) return;
      focusedReminder.current = location.key;
      target.scrollIntoView({ block: 'center' });
      target.focus({ preventScroll: true });
    };
    const frame = requestAnimationFrame(focus);
    document.addEventListener('close', focus, true);
    return () => { cancelAnimationFrame(frame); document.removeEventListener('close', focus, true); };
  }, [kort, location.key, location.pathname, threadsQ.data]);
  const expandFocus = useRef<string | null>(kort);
  const expand = (id: string) => { expandFocus.current = id; setOpened(s => new Set(s).add(id)); };
  // A group named in the hash (the rail's Jag föreslår, Till kännedom) takes the focus to its heading once the threads are here.
  useEffect(() => {
    if (!location.hash || !threads.length) return;
    const el = document.getElementById(location.hash.slice(1));
    el?.scrollIntoView({ block: 'start' });
    el?.focus();
  }, [location.hash, threads.length > 0]);
  // Cards sit under an h2 (Nu, Senare, Jag föreslår, Till kännedom) or under a pile's h1, so their headings are one level down (1.3.1).
  const card = (t: Thread, position?: string, headingLevel: 2 | 3 = 3) => {
    const focusTitle = expandFocus.current === t.id;
    if (focusTitle) expandFocus.current = null;
    return t.proposals.length
      ? <ThreadCard key={t.id} thread={t} compact={mobile} headingLevel={headingLevel} onChange={replace} />
      : <GenericCard key={t.id} thread={t} areaTitle={areaTitle(t.area)} position={position} compact={mobile} headingLevel={headingLevel} autoFocusTitle={focusTitle} onChange={replace} onOpenCardView={openCardView} />;
  };
  /** A group's threads: runs of rows in one list, a card where a thread is open. */
  const records = (list: Thread[], options: { lead?: boolean; notice?: boolean; headingLevel?: 2 | 3 } = {}) => {
    const out: React.ReactNode[] = []; let rows: React.ReactNode[] = [];
    // A run of rows is one list fenced by dividers (the structure guide: rows with dividers, no card), its text on the column's content line (edge flush).
    const flush = () => { if (rows.length) { out.push(<VStack key={`rows-${out.length}`} gap={0}><Divider /><List hasDividers density="balanced" edge="flush">{rows}</List><Divider /></VStack>); rows = []; } };
    list.forEach((t, i) => {
      const asCard = mobile || t.proposals.length > 0 || opened.has(t.id) || kort === t.id || (options.lead && i === 0);
      if (asCard) { flush(); out.push(card(t, options.lead ? `${i + 1} av ${list.length}` : undefined, options.headingLevel)); }
      else rows.push(<ThreadRow key={t.id} thread={t} areaTitle={areaTitle(t.area)} compact={mobile} notice={options.notice} onChange={replace} onOpenCardView={openCardView} onExpand={expand} />);
    });
    flush();
    return out;
  };
  const nextBundle = attention?.rhythm.find(p => p.kind === 'bundle' && p.state !== 'done');
  const hello = greeting(Number(timeLabel(now).slice(0, 2)));
  const sentence = digestSentence(g);
  const reviewLine = attention && `Genomgången ${attention.rhythm[0]?.at ?? '06:00'} · ${g.nu.length + g.senare.length + g.foreslar.length + g.kannedom.length + g.waiting.length} trådar lästa · ${nextBundle ? `Nästa samling ${nextBundle.at}` : 'Nästa genomgång i morgon 06:00'}`;
  // The digest is the overview's lead, not a discrete item: a section with the greeting as the h1, never a card (D31).
  const digest = attention && <VStack gap={2} as="section" aria-label="Genomgången">
      <Text type="supporting">{reviewLine}</Text>
      <Heading level={1}>{hello}. {sentence}</Heading>
      <Text type="supporting">Jag stör högst {attention.budget} gånger mellan samlingarna, bara för deadline samma dag eller något du själv bad om. Allt annat samlas.</Text>
    </VStack>;
  const assistantDown = !!assistant && assistant.configured && !assistant.available;

  const pileContent = pile === 'handled'
    ? <Handled threads={older} compact={mobile} onChange={replace} conversationHref={conversationHref} />
    : pile && <VStack gap={2} as="section" aria-label={pileTitle[pile]}>
      <HStack justify="between" vAlign="end" gap={2} wrap="wrap">
        <Heading level={2} accessibilityLevel={1}>{pileTitle[pile]} · {(pile === 'waiting' ? g.waiting : g.snoozed).length}</Heading>
        <Text type="supporting">{pile === 'waiting' ? 'Kommer tillbaka av sig själva när någon svarar.' : 'Tillbaka 06:00, eller tidigare om något händer.'}</Text>
      </HStack>
      {(pile === 'waiting' ? g.waiting : g.snoozed).length === 0 && <EmptyState title="Tomt här" description={pile === 'waiting' ? 'Inget väntar på någon annan.' : 'Inget är lagt åt sidan.'} isCompact headingLevel={2} />}
      <VStack gap={2}>{(pile === 'waiting' ? g.waiting : g.snoozed).map(t => card(t, undefined, 2))}</VStack>
    </VStack>;

  /** The groups (D34): one lead per region (the h1 above), then the groups ranked by weight at one size: Heading level 3 on the page, level 2 in the outline. */
  const groups = <VStack gap={5}>
    <VStack gap={2} as="section" aria-label="Nu">
      <HStack justify="between" vAlign="end" gap={2} wrap="wrap">
        <Heading id="behover-dig" tabIndex={-1} level={3} accessibilityLevel={2}>{loadingThreads ? 'Nu' : g.nu.length === 0 ? 'Inget behöver dig just nu' : `Nu · ${g.nu.length}`}</Heading>
        <Text type="supporting">{g.nu.length ? 'Deadline i dag, eller något du bad om' : g.senare.length ? 'Resten har tid på sig' : 'Nästa genomgång i morgon 06:00'}</Text>
      </HStack>
      {loadingThreads && <BriefSkeleton compact={mobile} />}
      {!loadingThreads && g.nu.length + g.senare.length + g.foreslar.length + g.kannedom.length === 0 && <EmptyState title="Lugnt läge" description="Assistenten hör av sig när något behöver dig." isCompact headingLevel={3} />}
      {g.nu.length > 0 && <VStack gap={2}>{records(g.nu, { lead: true })}</VStack>}
    </VStack>
    {g.senare.length > 0 && <VStack gap={2} as="section" aria-label="Senare">
      <HStack justify="between" vAlign="end" gap={2} wrap="wrap">
        <Heading id="senare" tabIndex={-1} level={3} accessibilityLevel={2}>Senare · {g.senare.length}</Heading>
        <Text type="supporting">Bara det som har en dag får en dag</Text>
      </HStack>
      <VStack gap={2}>{records(g.senare)}</VStack>
    </VStack>}
    {g.foreslar.length > 0 && <VStack gap={2} as="section" aria-label="Jag föreslår">
      <HStack justify="between" vAlign="end" gap={2} wrap="wrap">
        <Heading id="proposals" tabIndex={-1} level={3} accessibilityLevel={2}>Jag föreslår · {g.foreslar.length}</Heading>
        <Text type="supporting">Ingen deadline, nej tack är ett svar</Text>
      </HStack>
      <VStack gap={2}>{records(g.foreslar)}</VStack>
    </VStack>}
    {g.kannedom.length > 0 && <VStack gap={2} as="section" aria-label="Till kännedom">
      <HStack justify="between" vAlign="end" gap={2} wrap="wrap">
        <Heading id="notices" tabIndex={-1} level={3} accessibilityLevel={2}>Till kännedom · {g.kannedom.length}</Heading>
        <Text type="supporting">Ingen knapp, försvinner när du läst</Text>
      </HStack>
      <VStack gap={2}>{records(g.kannedom, { notice: true })}</VStack>
    </VStack>}
    {current && current.schedules.length > 0 && <VStack gap={1} as="section" aria-label="Så här bevakar jag området">
      <Heading level={3} accessibilityLevel={2}>Så här bevakar jag området</Heading>
      {current.schedules.map((s, i) => <Text key={i} type="supporting"><Text as="span" weight="semibold">{s.when}</Text> · {s.label}</Text>)}
    </VStack>}
  </VStack>;
  /** The overview's rail: the day, the piles with their counts, and the assistant's own schedule. Folds under the groups when narrow. */
  const done = g.handledToday.length, total = done + g.nu.length + g.senare.length + g.foreslar.length + g.kannedom.length + g.waiting.length + g.snoozed.length;
  const schedules = areas.flatMap(a => a.schedules.map(s => ({ ...s, area: a.title }))).slice(0, 5);
  const aside = <VStack gap={5} as="aside" aria-label="Dagen och vid sidan av">
    {day && <Today view={day} compact />}
    <VStack gap={2} as="section" aria-label="Vid sidan av">
      <Heading level={3} accessibilityLevel={2}>Vid sidan av</Heading>
      <List hasDividers density="compact" edge="flush">
        <ListItem href="/waiting" align="start" label={<Text weight="semibold">Pågår utan dig</Text>} endContent={<Text type="supporting">{g.waiting.length}</Text>}
          description={<Text type="supporting">{g.waiting[0] ? `${g.waiting[0].title} · väntar på ${g.waiting[0].waitingOn}` : 'Inget väntar på någon annan'}</Text>} />
        <ListItem href="/snoozed" align="start" label={<Text weight="semibold">Inte nu</Text>} endContent={<Text type="supporting">{g.snoozed.length}</Text>}
          description={<Text type="supporting">Tillbaka 06:00, eller tidigare om något händer</Text>} />
        <ListItem href="/handled" align="start" label={<Text weight="semibold">Klart i dag</Text>} endContent={<Text type="supporting">{done}</Text>}
          description={<VStack gap={1}><ProgressBar label={`Klart i dag: ${done} av ${total}`} isLabelHidden value={done} max={Math.max(total, 1)} variant="success" /><Text type="supporting">{done} av {total} sedan 06:00</Text></VStack>} />
      </List>
    </VStack>
    {!current && schedules.length > 0 && <VStack gap={1} as="section" aria-label="Så här bevakar jag">
      <Heading level={3} accessibilityLevel={2}>Så här bevakar jag</Heading>
      {schedules.map((s, i) => <Text key={i} type="supporting"><Text as="span" weight="semibold">{s.when}</Text> · {s.label} · {s.area}</Text>)}
    </VStack>}
  </VStack>;
  const overview = <VStack gap={5}>
    {error && <Text as="p" role="alert" color="accent">{error}</Text>}
    {kort && location.pathname === '/overview' && threadsQ.isSuccess && ![...g.nu, ...g.senare, ...g.foreslar, ...g.kannedom].some(t => t.id === kort) &&
      <Banner status="info" title="Kortet är inte längre aktuellt på startsidan." description="Det kan ha hanterats eller lagts åt sidan." />}
    {pile ? pileContent : <>
      {current && <VStack gap={2} as="section" aria-label={`Området ${current.title}`}>
        <HStack justify="between" vAlign="end" gap={2} wrap="wrap">
          <Heading level={2} accessibilityLevel={1}>{current.title}</Heading>
          <Text type="supporting">{current.source}{current.figure ? ` · ${current.figure.label}` : ''}</Text>
        </HStack>
        {current.standing.length > 0 && <HStack gap={1} wrap="wrap" role="group" aria-label="Gör själv">
          {current.standing.map(s => <Button key={s.capability} size="sm" variant="secondary" label={s.label} clickAction={() => void openStanding(s.capability, s.label)} />)}
        </HStack>}
      </VStack>}
      {!current && digest}
      {!current && !digest && <VisuallyHidden as="div"><Heading level={1}>Hela bilden</Heading></VisuallyHidden>}
      {current?.id === 'kalender' && day && <Today view={day} compact={mobile} />}
      {!current && figures.length > 0 && <FigureTiles figures={figures} unitLabel={user.unitLabel} compact={mobile} />}
      {narrow ? <VStack gap={5}>{groups}{!current && aside}</VStack> : <Grid columns={3} gap={6}><GridSpan columns={current ? 3 : 2}>{groups}</GridSpan>{!current && aside}</Grid>}
    </>}
  </VStack>;

  /**
   * What the box offers under it (D41, the template's categories): the person's own areas that have something to start,
   * each a toggle; the chosen one shows its connector's standing actions for the role as cards. Nothing is chosen at
   * first, as in the template, and choosing never moves the box: the cards come under it. Where they open under the
   * fold (a phone, a low window) they are brought into view, without animation.
   */
  const offers = useMemo(() => areas.filter(a => a.standing.length > 0), [areas]);
  const [chosen, setChosen] = useState<string | null>(null);
  const offer = offers.find(a => a.id === chosen) ?? null;
  useEffect(() => { if (chosen) document.getElementById('omradets-kort')?.scrollIntoView({ block: 'nearest' }); }, [chosen]);
  const brief = [...g.nu, ...g.foreslar, ...g.senare].slice(0, 3);
  // The overview's context for `@`: the cards in view, in the area or the pile the address names.
  const overviewNear = (pile === 'waiting' ? g.waiting : pile === 'snoozed' ? g.snoozed : [...g.nu, ...g.senare, ...g.foreslar, ...g.kannedom]).map(t => 'thread:' + t.id);
  // What the brief leaves out, in one line under it (G): the rest with their weight, what moves without the person, what is done.
  const rest = [...g.nu, ...g.senare, ...g.foreslar, ...g.kannedom].filter(t => !brief.includes(t));
  const restNu = rest.filter(t => g.nu.includes(t)).length;
  const restLine = [rest.length > 0 && (restNu > 0 ? `${rest.length} till, ${restNu} av dem i dag` : `${rest.length} till har tid på sig`),
    g.waiting.length > 0 && `${g.waiting.length} pågår utan dig`, `${g.handledToday.length} klara i dag`].filter(Boolean).join(' · ');
  // The day as one line at the foot of the landing (G): the meetings in order and the longest gap; the week is one link away.
  const longest = day ? [...day.gaps].sort((a, b) => (Date.parse(b.end) - Date.parse(b.start)) - (Date.parse(a.end) - Date.parse(a.start)))[0] : undefined;
  const dayLine = day && [...day.events.filter(e => !e.allDay).map(e => `${timeLabel(e.start)} ${e.title}`), longest && `längsta luckan ${timeRange(longest.start, longest.end)}`].filter(Boolean).join(' · ');
  // On a phone the box is docked at the foot (G on the phone): the heading and the areas sit right above it.
  const docked = mobile && !short;
  // The day line (G): the foot of the landing. With the box in the page it is the Layout's footer; on a short screen it ends the flow.
  const dayFoot = !docked && dayLine !== null && dayLine !== undefined ? <VStack gap={3} as="section" aria-label="I dag">
      <Divider />
      <HStack justify="between" vAlign="center" gap={2} wrap="wrap">
        <Text type="supporting" hasTabularNumbers><Text as="span" weight="semibold" color="primary">I dag</Text> · {dayLine || 'inga möten'}</Text>
        <Link href="/calendar">Hela veckan</Link>
      </HStack>
    </VStack> : null;
  // The box sits on the column's centre line whenever what is above it fits in the upper half (D39): the brief and the box
  // are one block that is at least half the column high, with the box at its lower edge. What grows under the box while
  // the person types ("Menar du", then the areas and their cards) comes after that block, so it never moves the field they are typing in
  // (D36), and a brief too long for the half pushes the box down as before. Centring the box between the brief and the
  // foot made it jump by half of every change in the suggestions.
  const landing = (talk: ConversationState) => {
    const need = <VStack gap={2} as="section" aria-label="Det som behöver dig">
      {error && <Text as="p" role="alert" color="accent">{error}</Text>}
      <HStack justify="between" vAlign="center" gap={2} wrap="wrap">
        {loadingThreads ? <Skeleton height={16} width={260} /> : <Text type="supporting">{sentence}</Text>}
        <Link href="/overview">Visa hela bilden</Link>
      </HStack>
      {loadingThreads ? <BriefSkeleton compact={mobile} /> : <Brief threads={brief} areaTitle={areaTitle} cardHref={cardHref} onChange={replace} onOpenCardView={openCardView} compact={mobile} />}
      {!loadingThreads && restLine && <Text type="supporting">{restLine}</Text>}
    </VStack>;
    // The lead (the template's greeting): the person by first name on a line of its own, then the question as the page's h1.
    const lead = <VStack gap={1}>
      <HStack gap={2} vAlign="center">
        <Icon icon={SparklesIcon} size="md" color="accent" />
        <Text type="large" as="p">Hej, {user.name.split(' ')[0]}</Text>
      </HStack>
      <Heading id="vad-vill-du-gora" tabIndex={-1} level={1} type={mobile ? undefined : 'display-2'}>Vad vill du göra?</Heading>
    </VStack>;
    const box = <Composer place="landing" roomy near={brief.map(t => 'thread:' + t.id)} />;
    const menarDu = <Suggestions viewHref={viewHref} cardHref={cardHref} />;
    // A card is one standing action: a read is a link to its view, anything else is asked in the box, as "Menar du" does it.
    const offered = offers.length > 0 && <VStack gap={6} paddingInline={mobile ? 0 : 3} as="section" aria-label="Det du kan göra">
      {/* The template's row is a ToggleButtonGroup, which keeps its buttons on one line whatever the width. A person's areas
          are as many as their connectors give them, so the same toggles stand in a wrapping HStack (D41, the gap noted there). */}
      <HStack gap={1} wrap="wrap" role="group" aria-label="Områden">
        {offers.map(a => <ToggleButton key={a.id} size="lg" label={a.title} isPressed={a.id === offer?.id} onPressedChange={pressed => setChosen(pressed ? a.id : null)}
          icon={a.icon ? <Icon icon={clewIcon[a.icon]} size="sm" /> : undefined} />)}
      </HStack>
      {offer && <Grid id="omradets-kort" columns={{ minWidth: 280 }} gap={3} role="group" aria-label={offer.title}>
        {offer.standing.map(s => <ClickableCard key={s.capability} label={s.label} variant="muted" padding={3}
          {...(s.kind === 'read' ? { href: viewHref(s.capability, s.label) } : { onClick: () => talk.ask(s.label) })}>
          <VStack gap={0.5}>
            <Text weight="semibold">{s.label}</Text>
            <Text type="supporting">{offer.source} · {s.kind === 'read' ? 'öppnar vyn' : 'öppnar kortet'}</Text>
          </VStack>
        </ClickableCard>)}
      </Grid>}
    </VStack>;
    // A short screen and a phone are one flow from the top: nothing is docked on the first, the box is docked on the second.
    if (short || docked) return <VStack gap={8}>
      <VStack gap={10}>
        {need}
        <VStack gap={mobile ? 4 : 8} as="section" aria-label="Vad vill du göra">
          {lead}
          {!docked && <VStack gap={2}>{box}{menarDu}</VStack>}
        </VStack>
      </VStack>
      {offered}
      {dayFoot}
    </VStack>;
    return <>
      <VStack gap={10} vAlign="between" minHeight="50%">
        {need}
        <VStack gap={8} as="section" aria-label="Vad vill du göra">{lead}{box}</VStack>
      </VStack>
      {/* "Menar du" a step under the box; the areas the template's distance under whichever ends above them. */}
      <VStack gap={2} paddingBlockStart={2}>
        {menarDu}
        <VStack paddingBlockStart={6}>{offered}</VStack>
      </VStack>
    </>;
  };

  /** The transcript's lead on a short screen, where there is no pinned toolbar: the title and the way out, in the flow. */
  const conversationHeader = (talk: { conversation: { title: string } | null; pending: { text: string } | null; newConversation: () => void; close: () => void }) => <HStack justify="between" vAlign="center" gap={2} wrap="wrap">
    <Heading level={1}>{talk.conversation?.title ?? talk.pending?.text}</Heading>
    <HStack gap={1}><Button size="sm" variant="ghost" label="Ny fråga" onClick={talk.newConversation} /><Button size="sm" variant="ghost" label="Stäng samtalet" onClick={talk.close} /></HStack>
  </HStack>;
  const conversationToolbar = (talk: ConversationState) => <Toolbar label="Samtalet" size="sm" startContent={<Heading level={mobile ? 3 : 1} accessibilityLevel={1}>{talk.conversation?.title ?? talk.pending?.text.slice(0, 80)}</Heading>}
    endContent={mobile
      ? <HStack gap={1} vAlign="center"><IconButton size="sm" variant="ghost" label="Stäng samtalet" icon={<Icon icon="close" />} onClick={talk.close} /><MoreMenu label="Fler val" size="sm" variant="ghost" items={[{ id: 'new', label: 'Ny fråga', onClick: talk.newConversation }]} /></HStack>
      : <HStack gap={2} vAlign="center">{started(talk) && <Text type="supporting">Startat av dig {started(talk)}</Text>}<Button size="sm" variant="ghost" label="Stäng samtalet" icon={<Icon icon="close" size="sm" />} onClick={talk.close} /></HStack>} />;
  /** When the person asked the conversation's first question: H1's line beside the title. "Ny fråga i stället" sits in the box's scope line. */
  const started = (talk: ConversationState) => { const first = talk.conversation?.messages.find(m => m.role === 'user'); if (!first) return null; const day = displayDate(first.createdAt); return day === todayDate ? timeLabel(first.createdAt) : `${day === addDays(todayDate, -1) ? 'i går' : shortDayLabel(day)} ${timeLabel(first.createdAt)}`; };

  /** What the column holds: the transcript when a conversation is open (D31), else the landing or the overview. */
  const column = (talk: ConversationState) => {
    if (talk.open) return short
      ? <VStack gap={4} padding={3}>{conversationHeader(talk)}<Transcript onOpenView={openView} renderCard={t => card(t, undefined, 2)} viewHref={v => viewHref(v.capability, v.title, v.input, true)} /><Composer place="conversation" /></VStack>
      : <Layout height="fill" contentWidth={800} padding={mobile ? 3 : 4} defaultHasDividers header={conversationToolbar(talk)}
        content={<LayoutContent isScrollable={false} padding={0}>
          {/* The ChatLayout spans the content area full bleed and owns the scroll, so its scrollbar sits at the window's edge like a page's; the spacious density centres its stream and dock to one 800 px column. */}
          <VStack height="100%"><ChatLayout density="spacious" composer={<Composer place="conversation" />}><Transcript onOpenView={openView} renderCard={t => card(t, undefined, 2)} viewHref={v => viewHref(v.capability, v.title, v.input, true)} /></ChatLayout></VStack>
        </LayoutContent>} />;
    // The landing (G, the `ai-chat-landing` template, D41): the template's 720 px column, the box in the page flow and the day line in the
    // footer (D39); on a phone the box is docked at the foot.
    if (mode === 'fraga') return short
      ? <VStack gap={4} padding={3}>{landing(talk)}</VStack>
      : <Layout height="fill" contentWidth={720} padding={mobile ? 3 : 6} content={<LayoutContent isScrollable>{landing(talk)}</LayoutContent>}
        footer={docked ? <LayoutFooter><VStack gap={2}><Suggestions viewHref={viewHref} cardHref={cardHref} /><Composer place="landing" near={brief.map(t => 'thread:' + t.id)} /></VStack></LayoutFooter>
          : dayFoot ? <LayoutFooter>{dayFoot}</LayoutFooter> : undefined} />;
    // The overview keeps the box at the foot of its column; the whole picture is wider than the chat's one column.
    return short
      ? <VStack gap={4} padding={3}>{overview}<Composer place="footer" near={overviewNear} /></VStack>
      : <Layout height="fill" contentWidth={1180} padding={mobile ? 3 : 4} content={<LayoutContent isScrollable>{overview}</LayoutContent>} footer={<LayoutFooter><Composer place="footer" near={overviewNear} /></LayoutFooter>} />;
  };

  return <ConversationProvider conversationId={conversationId} onConversation={onConversation} onThreadChange={replace}>
    <ConversationContext.Consumer>{talk => <KeepFocus open={talk.open} focus={talk.focus} />}</ConversationContext.Consumer>
    <ConversationContext.Consumer>{talk => <Shell user={user} nav={nav} height={short ? 'auto' : 'fill'}
      /* Page level (D8): one Banner in the shell's banner slot when the model is configured but not answering. Everything that is not prose keeps working. */
      banner={assistantDown ? <Banner status="warning" container="section" collapsible={false} title="Modellen svarar inte just nu."
        description="Knapparna, korten, pushen och kalendern fungerar som vanligt. Rutan hittar bara exakta saker, och frågor i fri text väntar tills modellen är tillbaka."
        endContent={<Button size="sm" variant="secondary" label="Försök igen" clickAction={() => client.invalidateQueries()} />} /> : undefined}>
      {column(talk)}
    </Shell>}</ConversationContext.Consumer>
    <PanelView title={view?.title ?? null} output={view?.output} onClose={() => navigate(back)} onOpenItem={(item, dayItems) => setOpenItem({ item, dayItems })}
      /* A declared view (D38): its controls rewrite the address, so the view stays addressable and the back button undoes a search; a row's own view is a link. A card's view has no controls: its input is the card's. */
      view={view?.spec} input={capabilityShown?.input ?? {}} isLoading={capabilityView.isFetching && capabilityView.isPlaceholderData} address={capabilityShown?.address}
      onInput={capabilityShown && capabilityShown.capability === params.capability ? next => navigate(viewHref(capabilityShown.capability, capabilityShown.title, next, capabilityShown.via), { replace: true }) : undefined}
      hrefFor={v => viewHref(v.capability, v.title, v.input, true)} onBack={capabilityShown?.via ? () => navigate(-1) : undefined} />
    <EventDialog item={openItem?.item ?? null} dayItems={openItem?.dayItems ?? []} onClose={() => setOpenItem(null)}
      /* The day in the panel and every loaded week are read again; a moved proposal's thread goes into the cache like any other answer. */
      onChanged={t => { if (t) { replace(t); void applyThread(client, t); } void client.invalidateQueries({ queryKey: keys.viewAll }); void client.invalidateQueries({ queryKey: keys.calendarAll }); }} />
  </ConversationProvider>;
}

/**
 * The row keeps focus across the transcript opening and closing (D31). The composer moves between the page flow on the
 * landing and the dock of a conversation, so it remounts on each change of `open`; the focus the old instance held is
 * given to the new one after the commit.
 */
function KeepFocus({ open, focus }: { open: boolean; focus: () => void }) {
  const first = useRef(true);
  useEffect(() => { if (first.current) { first.current = false; return; } focus(); }, [open, focus]);
  return null;
}
/** Läget on the overview: the four figures as tiles; a tile asks the figure's question in the box, which the router answers without the model. */
function FigureTiles({ figures, unitLabel, compact }: { figures: Figure[]; unitLabel: string; compact: boolean }) {
  return <ConversationContext.Consumer>{talk => <Lage figures={figures} unitLabel={unitLabel} compact={compact} onOpen={f => talk.ask(figureQuestion[f.id])} />}</ConversationContext.Consumer>;
}
