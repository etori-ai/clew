import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { attentionLevel, attentionLevels, type Area, type AssistantStatus, type Attention, type AttentionLevel, type CalendarEvent, type SessionUser, type Thread, type TodayView, type ViewRef } from '@clew/contracts';
import { Avatar, Badge, Banner, Button, Collapsible, EmptyState, Heading, HStack, Icon, Layout, LayoutContent, LayoutHeader, LayoutPanel, Overlay, StatusDot, Text, VisuallyHidden, VStack, signOut, useMediaQuery } from '@clew/ui';
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

/**
 * Mission control: areas in the sidebar, "Behöver dig" first, "Pågår utan dig" as one collapsed line, the conversation
 * row docked at the bottom. The conversation unfolds from the row over the dimmed stream (D12); the side panel stays
 * live for views. Every card comes from a module through the registry; the calendar's proposal card keeps its
 * specialised rendering, everything else is the generic card.
 */
export function StartPage({ user }: { user: SessionUser }) {
  const mobile = useMediaQuery('(max-width: 720px)');
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
  const load = useCallback(async () => {
    try {
      const [t, a, d, at, st] = await Promise.all([api.threads(), api.areas(), api.today().catch(() => null), api.attention(), api.assistantStatus().catch(() => null)]);
      setThreads(t.threads); setAreas(a.areas); setDay(d); setAttention(at); setAssistant(st); setError(null);
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Sidan kunde inte läsas.'); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const loadWeek = useCallback((week: string) => {
    setWeeks(current => { if (current[week]) return current; void api.calendar(week).then(data => setWeeks(w => ({ ...w, [week]: data.events }))).catch(() => undefined); return current; });
  }, []);
  const replace = useCallback((thread: Thread) => {
    setThreads(list => list.some(t => t.id === thread.id) ? list.map(t => t.id === thread.id ? thread : t) : [thread, ...list]);
    void api.areas().then(a => setAreas(a.areas)).catch(() => undefined);
  }, []);
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
  const groups = attentionLevels.map(level => ({ level, threads: needsYou.filter(t => attentionLevel(t, todayDate) === level) })).filter(g => g.threads.length);
  const waiting = open.filter(t => t.kind === 'pushed' && !!t.waitingOn && inArea(t));
  const handledToday = threads.filter(t => t.state !== 'open' && t.handledAt && t.handledAt.slice(0, 10) === new Date().toISOString().slice(0, 10)).length;
  const older = [...open.filter(t => t.kind === 'question'), ...threads.filter(t => t.state !== 'open')];
  const remaining = attention ? Math.max(0, attention.budget - attention.used) : null;
  const current = useMemo(() => areas.find(a => a.id === area) ?? null, [areas, area]);
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
  const groupHeading = (level: AttentionLevel, list: Thread[]) => {
    const overdueOrToday = list.every(t => t.deadline && t.deadline.slice(0, 10) <= todayDate);
    const title = level === 'urgent' ? (overdueOrToday ? 'Måste i dag' : 'Inom tre dagar') : level === 'soon' ? 'Snart' : level === 'later' ? 'Senare' : 'Till kännedom';
    return <HStack gap={1} vAlign="center">
      {level === 'notice' ? <Icon icon="info" color="info" size="sm" /> : <StatusDot variant={level === 'urgent' ? 'error' : level === 'soon' ? 'warning' : 'neutral'} label={title} />}
      <Heading level={3} color="secondary">{title} · {list.length}</Heading>
    </HStack>;
  };
  const group = ({ level, threads: list }: { level: AttentionLevel; threads: Thread[] }) => <VStack key={level} gap={1} as="section" aria-label={`${level === 'notice' ? 'Till kännedom' : 'Deadline'}: ${list.length}`}>
    {groupHeading(level, list)}
    {level === 'notice' && !mobile && list.every(t => !t.proposals.length)
      ? <NoticeList threads={list} onChange={replace} onOpenCardView={openCardView} />
      : <VStack gap={2}>{list.map(card)}</VStack>}
  </VStack>;
  // The assistant's own cap on interruptions, worded as its promise: it never counts anything the person does.
  const attentionLabel = attention && (remaining === 0
    ? `Jag stör inte mer i dag · resten samlas till ${attention.bundledUntil ?? 'i morgon 06:00'}`
    : `Jag stör högst ${attention.budget} gånger i dag`);

  const stream = <VStack gap={4}>
    {mobile && sidebar}
    {error && <Text as="p" role="alert" color="accent">{error}</Text>}
    {area === 'hanterat' ? <Handled threads={older} onChange={replace} conversationHref={conversationHref} /> : <>
      {current && <VStack gap={2} as="section" aria-label={`Området ${current.title}`}>
        <HStack justify="between" vAlign="end" gap={2} wrap="wrap">
          <Heading level={2}>{current.title}</Heading>
          <Text type="supporting">{current.source}{current.figure ? ` · ${current.figure.label}` : ''}</Text>
        </HStack>
        {current.standing.length > 0 && <HStack gap={1} wrap="wrap" aria-label="Gör själv">
          {current.standing.map(s => <Button key={s.capability} size="sm" variant="secondary" label={s.label} clickAction={() => void openStanding(s.capability, s.label)} />)}
        </HStack>}
      </VStack>}
      {current?.id === 'kalender' && day && <Today view={day} compact={mobile} />}
      <VStack gap={2} as="section" aria-label="Behöver dig">
        <HStack justify="between" vAlign="end" gap={2} wrap="wrap">
          <Heading level={2}>{needsYou.length === 0 ? 'Inget behöver dig just nu' : `Behöver dig · ${needsYou.length}`}</Heading>
          <Text type="supporting">{needsYou.length ? 'Resten väntar till i morgon 06:00.' : 'Nästa genomgång i morgon 06:00'}</Text>
        </HStack>
        {needsYou.length === 0 && waiting.length === 0 && <EmptyState title="Lugnt läge" description="Assistenten hör av sig när något behöver dig." isCompact />}
        {groups.map(group)}
      </VStack>
      {waiting.length > 0 && <Collapsible defaultIsOpen={false} chevronPosition="start" trigger={<HStack gap={1} vAlign="center" wrap="wrap"><StatusDot variant="neutral" label="Väntar på någon annan" /><Text type="supporting"><Text as="span" weight="semibold">Pågår utan dig · {waiting.length}</Text> · {waiting.map(t => t.title.split(',')[0]).join(' · ')}</Text></HStack>}>
        <VStack gap={2}>{waiting.map(t => <GenericCard key={t.id} thread={t} areaTitle={areaTitle(t.area)} compact={mobile} onChange={replace} onOpenCardView={(threadId, actionId) => navigate(cardViewHref(threadId, actionId))} />)}</VStack>
      </Collapsible>}
      {current && current.schedules.length > 0 && <VStack gap={1} as="section" aria-label="Så här bevakar jag området">
        <Heading level={3}>Så här bevakar jag området</Heading>
        {current.schedules.map((s, i) => <Text key={i} type="supporting"><Text as="span" weight="semibold">{s.when}</Text> · {s.label}</Text>)}
      </VStack>}
    </>}
  </VStack>;

  return <ConversationContext.Provider value={conversationApi}>
    <Layout height="fill" padding={0}
      header={<LayoutHeader hasDivider padding={mobile ? 3 : 4}>
        <HStack justify="between" vAlign="center" gap={3} wrap="wrap">
          <HStack gap={2} vAlign="center">
            {!mobile && <Avatar name={user.name} size="md" />}
            <VStack gap={0}>
              <Text weight="semibold">{mobile ? `Hej ${user.name.split(' ')[0]}` : user.name}</Text>
              <Text type="supporting">{dayLabel(today())} · {timeLabel(new Date().toISOString())}{mobile ? '' : ` · ${user.unitLabel}`}</Text>
            </VStack>
          </HStack>
          <HStack gap={2} vAlign="center" wrap="wrap">
            {attentionLabel && <Badge variant="neutral" icon={<Icon icon="clock" size="sm" />} label={attentionLabel} />}
            {(areas.find(a => a.id === 'viktigt-nu')?.needsYou ?? 0) > 0 && <Button variant="secondary" size="sm" label={`Viktigt nu · ${areas.find(a => a.id === 'viktigt-nu')!.needsYou}`} href={pathFor('viktigt-nu')} />}
            <Button variant="ghost" size="sm" label="Kalender" href="/kalender" icon={<Icon icon="calendar" size="sm" />} isIconOnly={mobile} />
            <Button variant="ghost" size="sm" label="Logga ut" clickAction={() => signOut()} />
          </HStack>
        </HStack>
      </LayoutHeader>}
      start={mobile ? undefined : <LayoutPanel hasDivider width={284} role="navigation" padding={2}>{sidebar}</LayoutPanel>}
      content={<LayoutContent padding={0}>
        {/* The dim covers the stream only (D12): the row below and the side panel stay live. A click on the dim closes the conversation. */}
        {/* The column fills the scrollport so the row stays docked at the bottom even when the stream is short. */}
        <div className="stream-column">
          {/* Page level (D8): one Banner under the header when the model is configured but not answering. The router answers meanwhile. */}
          {assistant && assistant.configured && !assistant.available && <Banner status="warning" container="section" collapsible={false} title="Modellen svarar inte just nu."
            description={`Frågor besvaras av den inbyggda routern tills ${assistant.model ?? 'modellen'} svarar igen. Korten påverkas inte.`}
            endContent={<Button size="sm" variant="secondary" label="Försök igen" clickAction={() => void load()} />} />}
          <Overlay className="stream-fill" isOpen={conversation.open} scrim="light" position="fill" align="end" content={<VisuallyHidden>Samtalet är öppet. Tryck Esc eller klicka här för att stänga.</VisuallyHidden>} onClick={() => { if (conversation.open) composer.current?.close(); }}>
            <div className="stream">{stream}</div>
          </Overlay>
          <div className="composer-dock">{row}</div>
        </div>
      </LayoutContent>} />
    <PanelView title={view?.title ?? null} output={view?.output} onClose={() => navigate(pathFor(area))} />
  </ConversationContext.Provider>;
}
