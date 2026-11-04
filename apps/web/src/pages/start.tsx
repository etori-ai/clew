import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { attentionLevel, attentionLevels, type Area, type AssistantStatus, type Attention, type AttentionLevel, type CalendarEvent, type SessionUser, type Thread, type TodayView, type ViewRef } from '@clew/contracts';
import { Avatar, Badge, Banner, Button, Collapsible, EmptyState, Heading, HStack, Icon, Layout, LayoutContent, LayoutHeader, LayoutPanel, Overlay, StatusDot, Text, VisuallyHidden, VStack, signOut, useMediaQuery, useToast } from '@clew/ui';
import { dayLabel, timeLabel, today } from '@clew/calendar/dates';
import { api, ApiError } from '../api';
import { Composer, type ComposerHandle } from '../components/composer';
import { ConversationContext, type ChipRef } from '../components/conversation-context';
import { Areas } from '../components/areas';
import { GenericCard, NoticeList } from '../components/card';
import { PanelView } from '../components/panel';
import { Today } from '../components/today';
import { ThreadCard } from '../components/thread';
import { Handled } from '../components/handled';
import { usePageTitle } from '../page-title';

/**
 * Mission control: areas in the sidebar, "Behöver dig" first, "Pågår utan dig" as one collapsed line, the conversation
 * row docked at the bottom. The conversation unfolds from the row over the dimmed stream (D12); the side panel stays
 * live for views. Every card comes from a connector through the registry; the calendar's proposal card keeps its
 * specialised rendering, everything else is the generic card.
 */
export function StartPage({ user, admin = false }: { user: SessionUser; admin?: boolean }) {
  const mobile = useMediaQuery('(max-width: 720px)');
  // 1.4.10: with 480 px or less in height the header and the row stay out of the way and the whole page scrolls.
  const short = useMediaQuery('(max-height: 480px)');
  const [threads, setThreads] = useState<Thread[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [day, setDay] = useState<TodayView | null>(null);
  const [attention, setAttention] = useState<Attention | null>(null);
  const [assistant, setAssistant] = useState<AssistantStatus | null>(null);
  const [weeks, setWeeks] = useState<Record<string, CalendarEvent[]>>({});
  const [error, setError] = useState<string | null>(null);
  // The route is the state: /omrade/:area and /hanterat filter the stream, /vy/… opens the panel, /samtal/:id the row.
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams<{ area?: string; capability?: string; threadId?: string; actionId?: string; conversationId?: string }>();
  const [search] = useSearchParams();
  const area = location.pathname === '/hanterat' ? 'hanterat' : params.area ?? (search.get('omrade') || null);
  const conversationId = params.conversationId ?? null;
  const pathFor = (a: string | null) => a === null ? '/' : a === 'hanterat' ? '/hanterat' : `/omrade/${a}`;
  const withArea = (path: string) => area ? `${path}${path.includes('?') ? '&' : '?'}omrade=${encodeURIComponent(area)}` : path;
  const viewHref = (capability: string, title: string, input?: Record<string, unknown>) => withArea(`/vy/${capability}?titel=${encodeURIComponent(title)}` + (input && Object.keys(input).length ? `&input=${encodeURIComponent(JSON.stringify(input))}` : ''));
  const cardViewHref = (threadId: string, actionId: string) => withArea(`/vy/kort/${threadId}/${actionId}`);
  const conversationHref = (id: string) => withArea(`/samtal/${id}`);
  const [view, setView] = useState<{ title: string; output: unknown } | null>(null);
  const [conversation, setConversation] = useState<{ open: boolean; chipped: string[] }>({ open: false, chipped: [] });
  const composer = useRef<ComposerHandle>(null);
  // The row's real height, for the margin that keeps a focused control above it (2.4.11). A conversation or a chip changes it.
  const dock = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const row = dock.current;
    if (!row) return;
    const observer = new ResizeObserver(() => row.parentElement?.style.setProperty('--composer-height', `${row.offsetHeight}px`));
    observer.observe(row);
    return () => observer.disconnect();
  }, []);
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
  const load = useCallback(async () => {
    try {
      const [t, a, d, at, st] = await Promise.all([api.threads(), api.areas(), api.today().catch(() => null), api.attention(), api.assistantStatus().catch(() => null)]);
      setThreads(t.threads); setAreas(a.areas); setDay(d); setAttention(at); setAssistant(st); setError(null);
      announceReminded(t.threads);
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Sidan kunde inte läsas.'); }
  }, [announceReminded]);
  useEffect(() => { void load(); }, [load]);
  // Something pushed a card while the page was open (a reminder fired): re-read the stream.
  useEffect(() => { const refresh = () => void load(); window.addEventListener('clew:refresh', refresh); return () => window.removeEventListener('clew:refresh', refresh); }, [load]);
  const loadWeek = useCallback((week: string) => {
    setWeeks(current => { if (current[week]) return current; void api.calendar(week).then(data => setWeeks(w => ({ ...w, [week]: data.events }))).catch(() => undefined); return current; });
  }, []);
  // A card that leaves the stream takes the focused button with it. Focus goes on to the next card, or the heading when none is left (2.4.3).
  const stream = useRef<HTMLDivElement>(null);
  const focusAfter = useRef<{ card: string; next: string } | null>(null);
  const replace = useCallback((thread: Thread) => {
    const cards = [...stream.current?.querySelectorAll('[id^="thread-"]') ?? []].map(el => el.id);
    const at = cards.indexOf('thread-' + thread.id);
    if (at >= 0) focusAfter.current = { card: cards[at]!, next: cards[at + 1] ?? cards[at - 1] ?? 'behover-dig' };
    setThreads(list => list.some(t => t.id === thread.id) ? list.map(t => t.id === thread.id ? thread : t) : [thread, ...list]);
    void api.areas().then(a => setAreas(a.areas)).catch(() => undefined);
  }, []);
  useEffect(() => {
    const target = focusAfter.current;
    focusAfter.current = null;
    if (!target || document.activeElement !== document.body) return;
    // A snoozed card is still in the document, inside the closed Pågår utan dig.
    const card = document.getElementById(target.card);
    (card?.checkVisibility() ? card : document.getElementById(target.next))?.focus();
  }, [threads]);
  // A view is addressable (integrations.md, "Answers and views"): the panel follows /vy/:capability or /vy/kort/:thread/:action.
  const viewInput = search.get('input'), viewTitle = search.get('titel');
  useEffect(() => {
    let alive = true;
    const fail = (e: unknown) => { if (alive) setError(e instanceof ApiError ? e.message : 'Kunde inte hämta.'); };
    if (params.capability) {
      let input: unknown; try { input = viewInput ? JSON.parse(viewInput) : undefined; } catch { input = undefined; }
      api.capability(params.capability, input).then(({ output }) => { if (alive) setView({ title: viewTitle ?? params.capability!, output }); }).catch(fail);
    } else if (params.threadId && params.actionId) {
      const threadId = params.threadId, actionId = params.actionId;
      api.act(threadId, actionId).then(result => {
        if (!alive) return;
        const label = threads.find(t => t.id === threadId)?.actions.find(a => a.id === actionId)?.label ?? 'Vy';
        if (result.kind === 'execute') setView({ title: label, output: result.thread.receipt });
        else if (typeof (result.output as { url?: string }).url === 'string') window.open((result.output as { url: string }).url, '_blank', 'noopener');
        else setView({ title: label, output: result.output });
      }).catch(fail);
    } else setView(null);
    return () => { alive = false; };
  }, [params.capability, params.threadId, params.actionId, viewInput, viewTitle]);
  const openStanding = (capability: string, label: string) => navigate(viewHref(capability, label));
  const openView = (v: ViewRef) => navigate(viewHref(v.capability, v.title, v.input));
  const areaTitle = (id: string) => areas.find(a => a.id === id)?.title ?? (id === 'fragor' ? 'Fråga' : id);
  const inArea = (t: Thread) => area === null || area === 'hanterat' || t.area === area;
  const open = threads.filter(t => t.state === 'open');
  const needsYou = open.filter(t => t.kind === 'pushed' && !t.waitingOn && inArea(t)).sort((a, b) => (a.deadline ?? '9999').localeCompare(b.deadline ?? '9999') || a.createdAt.localeCompare(b.createdAt));
  // Colour follows the deadline, never the category (canvas "Clew uppmärksamhet"): the stream is grouped by level, each group with a dot and a word.
  const todayDate = today();
  // A reminded card keeps its place by deadline (no group pushes the stream down); the badge and the toast do the noticing.
  const levelOf = (t: Thread): AttentionLevel => { const level = attentionLevel(t, todayDate); return level === 'now' ? attentionLevel({ deadline: t.deadline }, todayDate) : level; };
  const groups = attentionLevels.map(level => ({ level, threads: needsYou.filter(t => levelOf(t) === level) })).filter(g => g.threads.length);
  const waiting = open.filter(t => t.kind === 'pushed' && !!t.waitingOn && inArea(t));
  const handledToday = threads.filter(t => t.state !== 'open' && t.handledAt && t.handledAt.slice(0, 10) === new Date().toISOString().slice(0, 10)).length;
  const older = [...open.filter(t => t.kind === 'question'), ...threads.filter(t => t.state !== 'open')];
  const remaining = attention ? Math.max(0, attention.budget - attention.used) : null;
  const current = useMemo(() => areas.find(a => a.id === area) ?? null, [areas, area]);
  const pageTitle = view ? view.title : conversationId ? 'Samtal' : area === 'hanterat' ? 'Redan hanterat' : current?.title ?? (area ? null : 'Behöver dig');
  usePageTitle(pageTitle, view || conversationId ? false : pageTitle ?? false);
  const conversationApi = useMemo(() => ({
    chipped: conversation.chipped, open: conversation.open,
    addChip: (chip: ChipRef) => composer.current?.addChip(chip),
    openConversation: (id: string) => composer.current?.openConversation(id),
  }), [conversation]);
  const onConversation = useCallback((id: string | null) => { if (id) navigate(conversationHref(id)); else if (conversationId) navigate(pathFor(area)); }, [navigate, conversationId, area]);
  const onState = useCallback((s: { open: boolean; chipped: string[] }) => setConversation(c => c.open === s.open && c.chipped.join() === s.chipped.join() ? c : s), []);
  const row = <Composer ref={composer} mobile={mobile} conversationId={conversationId} onConversation={onConversation} onThreadChange={replace} onOpenView={openView} onState={onState} />;
  const sidebar = <Areas areas={areas} current={area} hrefFor={pathFor} compact={mobile} handled={handledToday} chipped={conversation.chipped} />;

  const openCardView = (threadId: string, actionId: string) => navigate(cardViewHref(threadId, actionId));
  const card = (t: Thread) => t.proposals.length
    ? <ThreadCard key={t.id} thread={t} events={t.week ? weeks[t.week] : undefined} compact onChange={replace} onLoadWeek={loadWeek} />
    : <GenericCard key={t.id} thread={t} areaTitle={areaTitle(t.area)} position={`${needsYou.indexOf(t) + 1} av ${needsYou.length}`} compact={mobile} expanded={needsYou.indexOf(t) === 0} onChange={replace} onOpenCardView={openCardView} />;
  // The group heading names the level in words beside the colour: a dot for deadlines, an info icon for notices.
  const groupTitle = (level: AttentionLevel, list: Thread[]) => {
    const overdueOrToday = list.every(t => t.deadline && t.deadline.slice(0, 10) <= todayDate);
    return level === 'now' ? 'Du bad om en påminnelse' : level === 'urgent' ? (overdueOrToday ? 'Måste i dag' : 'Inom tre dagar') : level === 'soon' ? 'Snart' : level === 'later' ? 'Senare' : 'Till kännedom';
  };
  const groupHeading = (level: AttentionLevel, list: Thread[]) => {
    const title = groupTitle(level, list);
    return <HStack gap={1} vAlign="center">
      {level === 'notice' ? <Icon icon="info" color="info" size="sm" /> : <StatusDot variant={level === 'now' || level === 'urgent' ? 'error' : level === 'soon' ? 'warning' : 'neutral'} label={title} />}
      <Heading level={3} color="secondary">{title} · {list.length}</Heading>
    </HStack>;
  };
  const group = ({ level, threads: list }: { level: AttentionLevel; threads: Thread[] }) => <VStack key={level} gap={1} as="section" aria-label={`${groupTitle(level, list)}: ${list.length}`}>
    {groupHeading(level, list)}
    {level === 'notice' && !mobile && list.every(t => !t.proposals.length)
      ? <NoticeList threads={list} onChange={replace} onOpenCardView={openCardView} />
      : <VStack gap={2}>{list.map(card)}</VStack>}
  </VStack>;
  // The assistant's own cap on interruptions, worded as its promise: it never counts anything the person does.
  const attentionLabel = attention && (remaining === 0
    ? `Jag stör inte mer i dag · resten samlas till ${attention.bundledUntil ?? 'i morgon 06:00'}`
    : `Jag stör högst ${attention.budget} gånger i dag`);

  const content = <VStack gap={4}>
    {mobile && sidebar}
    {!current && area !== 'hanterat' && <VisuallyHidden as="div"><Heading level={1}>Startsidan</Heading></VisuallyHidden>}
    {error && <Text as="p" role="alert" color="accent">{error}</Text>}
    {area === 'hanterat' ? <Handled threads={older} compact={mobile} onChange={replace} conversationHref={conversationHref} /> : <>
      {current && <VStack gap={2} as="section" aria-label={`Området ${current.title}`}>
        <HStack justify="between" vAlign="end" gap={2} wrap="wrap">
          <Heading level={2} accessibilityLevel={1}>{current.title}</Heading>
          <Text type="supporting">{current.source}{current.figure ? ` · ${current.figure.label}` : ''}</Text>
        </HStack>
        {current.standing.length > 0 && <HStack gap={1} wrap="wrap" role="group" aria-label="Gör själv">
          {current.standing.map(s => <Button key={s.capability} size="sm" variant="secondary" label={s.label} clickAction={() => void openStanding(s.capability, s.label)} />)}
        </HStack>}
      </VStack>}
      {current?.id === 'kalender' && day && <Today view={day} compact={mobile} />}
      <VStack gap={2} as="section" aria-label="Behöver dig">
        <HStack justify="between" vAlign="end" gap={2} wrap="wrap">
          <Heading id="behover-dig" tabIndex={-1} level={2}>{needsYou.length === 0 ? 'Inget behöver dig just nu' : `Behöver dig · ${needsYou.length}`}</Heading>
          <Text type="supporting">{needsYou.length ? 'Resten väntar till i morgon 06:00.' : 'Nästa genomgång i morgon 06:00'}</Text>
        </HStack>
        {needsYou.length === 0 && waiting.length === 0 && <EmptyState title="Lugnt läge" description="Assistenten hör av sig när något behöver dig." isCompact />}
        {groups.map(group)}
      </VStack>
      {waiting.length > 0 && <Collapsible defaultIsOpen={false} chevronPosition="start" trigger={<HStack gap={1} vAlign="center" wrap="wrap"><StatusDot variant="neutral" label="Väntar på någon annan" /><Text type="supporting"><Text as="span" weight="semibold">Pågår utan dig · {waiting.length}</Text> · {waiting.map(t => t.title.split(',')[0]).join(' · ')}</Text></HStack>}>
        <VStack gap={2}>{waiting.map(t => <GenericCard key={t.id} thread={t} areaTitle={areaTitle(t.area)} compact={mobile} headingLevel={3} onChange={replace} onOpenCardView={(threadId, actionId) => navigate(cardViewHref(threadId, actionId))} />)}</VStack>
      </Collapsible>}
      {current && current.schedules.length > 0 && <VStack gap={1} as="section" aria-label="Så här bevakar jag området">
        <Heading level={3}>Så här bevakar jag området</Heading>
        {current.schedules.map((s, i) => <Text key={i} type="supporting"><Text as="span" weight="semibold">{s.when}</Text> · {s.label}</Text>)}
      </VStack>}
    </>}
  </VStack>;

  return <ConversationContext.Provider value={conversationApi}>
    <Layout height={short ? 'auto' : 'fill'} padding={0}
      header={<LayoutHeader hasDivider role="banner" padding={mobile ? 3 : 4}>
        <HStack justify="between" vAlign="center" gap={3} wrap="wrap">
          <HStack gap={2} vAlign="center">
            {!mobile && <Avatar name={user.name} size="md" />}
            <VStack gap={0}>
              <Text weight="semibold">{mobile ? `Hej ${user.name.split(' ')[0]}` : user.name}</Text>
              <Text type="supporting">{dayLabel(today())} · {timeLabel(new Date().toISOString())}{mobile ? '' : ` · ${user.unitLabel}`}</Text>
            </VStack>
          </HStack>
          <HStack gap={2} vAlign="center" wrap="wrap">
            {/* A Badge stays on one line and this sentence does not fit a phone in one (1.4.10). */}
            {attentionLabel && (mobile
              ? <HStack gap={1} vAlign="center"><Icon icon="clock" size="sm" /><Text type="supporting">{attentionLabel}</Text></HStack>
              : <Badge variant="neutral" icon={<Icon icon="clock" size="sm" />} label={attentionLabel} />)}
            {(areas.find(a => a.id === 'viktigt-nu')?.needsYou ?? 0) > 0 && <Button variant="secondary" size="sm" label={`Viktigt nu · ${areas.find(a => a.id === 'viktigt-nu')!.needsYou}`} href={pathFor('viktigt-nu')} />}
            <Button variant="ghost" size="sm" label="Kalender" href="/kalender" icon={<Icon icon="calendar" size="sm" />} isIconOnly={mobile} />
            {admin && <Button variant="ghost" size="sm" label="Administration" href="/admin/anslutningar" icon={<Icon icon="wrench" size="sm" />} isIconOnly={mobile} />}
            <Button variant="ghost" size="sm" label="Logga ut" clickAction={() => signOut()} />
          </HStack>
        </HStack>
      </LayoutHeader>}
      start={mobile ? undefined : <LayoutPanel hasDivider width={284} padding={2}>{sidebar}</LayoutPanel>}
      content={<LayoutContent padding={0} role="main">
        {/* The dim covers the stream only (D12): the row below and the side panel stay live. A click on the dim closes the conversation. */}
        {/* The column fills the scrollport so the row stays docked at the bottom even when the stream is short. */}
        <div className="stream-column">
          {/* Page level (D8): one Banner under the header when the model is configured but not answering. The router answers meanwhile. */}
          {assistant && assistant.configured && !assistant.available && <Banner status="warning" container="section" collapsible={false} title="Modellen svarar inte just nu."
            description={`Frågor besvaras av den inbyggda routern tills ${assistant.model ?? 'modellen'} svarar igen. Korten påverkas inte.`}
            endContent={<Button size="sm" variant="secondary" label="Försök igen" clickAction={() => void load()} />} />}
          <Overlay className="stream-fill" isOpen={conversation.open} scrim="light" position="fill" align="end" content={<VisuallyHidden>Samtalet är öppet. Tryck Esc eller klicka här för att stänga.</VisuallyHidden>} onClick={() => { if (conversation.open) composer.current?.close(); }}>
            <div className="stream" ref={stream}>{content}</div>
          </Overlay>
          <div className="composer-dock" ref={dock}>{row}</div>
        </div>
      </LayoutContent>} />
    <PanelView title={view?.title ?? null} output={view?.output} onClose={() => navigate(pathFor(area))} />
  </ConversationContext.Provider>;
}
