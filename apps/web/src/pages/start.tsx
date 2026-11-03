import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Area, Attention, CalendarEvent, SessionUser, Thread, TodayView, ViewRef } from '@clew/contracts';
import { Avatar, Badge, Button, Collapsible, EmptyState, Heading, HStack, Icon, Layout, LayoutContent, LayoutHeader, LayoutPanel, Overlay, Text, VisuallyHidden, VStack, signOut, useMediaQuery } from '@clew/ui';
import { dayLabel, timeLabel, today } from '@clew/calendar/dates';
import { api, ApiError } from '../api';
import { Composer, type ComposerHandle } from '../components/composer';
import { ConversationContext, type ChipRef } from '../components/conversation-context';
import { Areas } from '../components/areas';
import { GenericCard } from '../components/card';
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
  const [weeks, setWeeks] = useState<Record<string, CalendarEvent[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [area, setArea] = useState<string | null>(null);
  const [view, setView] = useState<{ title: string; output: unknown } | null>(null);
  const [conversation, setConversation] = useState<{ open: boolean; chipped: string[] }>({ open: false, chipped: [] });
  const composer = useRef<ComposerHandle>(null);
  const load = useCallback(async () => {
    try {
      const [t, a, d, at] = await Promise.all([api.threads(), api.areas(), api.today().catch(() => null), api.attention()]);
      setThreads(t.threads); setAreas(a.areas); setDay(d); setAttention(at); setError(null);
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
  const openStanding = async (capability: string, label: string) => {
    try { const { output } = await api.capability(capability); setView({ title: label, output }); } catch (e) { setError(e instanceof ApiError ? e.message : 'Kunde inte hämta.'); }
  };
  const openView = useCallback(async (v: ViewRef) => {
    try { const { output } = await api.capability(v.capability, Object.keys(v.input).length ? v.input : undefined); setView({ title: v.title, output }); } catch (e) { setError(e instanceof ApiError ? e.message : 'Kunde inte hämta.'); }
  }, []);
  const areaTitle = (id: string) => areas.find(a => a.id === id)?.title ?? (id === 'fragor' ? 'Fråga' : id);
  const inArea = (t: Thread) => area === null || area === 'hanterat' || t.area === area;
  const open = threads.filter(t => t.state === 'open');
  const needsYou = open.filter(t => t.kind === 'pushed' && !t.waitingOn && inArea(t)).sort((a, b) => (a.deadline ?? '9999').localeCompare(b.deadline ?? '9999') || a.createdAt.localeCompare(b.createdAt));
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
  const onDo = useCallback((capability: string) => { const target = areas.find(a => a.standing.some(s => s.capability === capability)); if (target) setArea(target.id); }, [areas]);
  const onState = useCallback((s: { open: boolean; chipped: string[] }) => setConversation(c => c.open === s.open && c.chipped.join() === s.chipped.join() ? c : s), []);
  const row = <Composer ref={composer} mobile={mobile} needsYou={needsYou.length} onThreadChange={replace} onOpenView={v => void openView(v)} onDo={onDo} onShowHandled={() => setArea('hanterat')} onState={onState} />;
  const sidebar = <Areas areas={areas} current={area} onSelect={setArea} compact={mobile} handled={handledToday} />;

  const card = (t: Thread, i: number) => t.proposals.length
    ? <ThreadCard key={t.id} thread={t} events={t.week ? weeks[t.week] : undefined} compact onChange={replace} onLoadWeek={loadWeek} />
    : <GenericCard key={t.id} thread={t} areaTitle={areaTitle(t.area)} position={`${i + 1} av ${needsYou.length}`} compact={mobile} expanded={i === 0} onChange={replace} onOpenView={(title, output) => setView({ title, output })} />;

  const stream = <VStack gap={4}>
    {mobile && sidebar}
    {error && <Text as="p" role="alert" color="accent">{error}</Text>}
    {area === 'hanterat' ? <Handled threads={older} onChange={replace} onOpenConversation={id => composer.current?.openConversation(id)} /> : <>
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
          <Text type="supporting">{needsYou.length ? 'Efter deadline. Resten väntar till i morgon 06:00.' : 'Nästa genomgång i morgon 06:00'}</Text>
        </HStack>
        {needsYou.length === 0 && waiting.length === 0 && <EmptyState title="Lugnt läge" description="Assistenten hör av sig när något behöver dig." isCompact />}
        {needsYou.map(card)}
      </VStack>
      {waiting.length > 0 && <Collapsible defaultIsOpen={false} chevronPosition="start" trigger={<Text type="supporting"><Text as="span" weight="semibold">Pågår utan dig · {waiting.length}</Text> · {waiting.map(t => t.title.split(',')[0]).join(' · ')}</Text>}>
        <VStack gap={2}>{waiting.map(t => <GenericCard key={t.id} thread={t} areaTitle={areaTitle(t.area)} compact={mobile} onChange={replace} onOpenView={(title, output) => setView({ title, output })} />)}</VStack>
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
            {remaining !== null && <Badge variant={remaining === 0 ? 'warning' : 'neutral'} icon={<Icon icon="clock" size="sm" />} label={remaining === 0 ? `Inga avbrott kvar · resten ${attention!.bundledUntil}` : `${remaining} avbrott kvar i dag`} />}
            {(areas.find(a => a.id === 'viktigt-nu')?.needsYou ?? 0) > 0 && <Button variant="secondary" size="sm" label={`Viktigt nu · ${areas.find(a => a.id === 'viktigt-nu')!.needsYou}`} clickAction={() => setArea('viktigt-nu')} />}
            <Button variant="ghost" size="sm" label="Kalender" href="/kalender" icon={<Icon icon="calendar" size="sm" />} isIconOnly={mobile} />
            <Button variant="ghost" size="sm" label="Logga ut" clickAction={() => signOut()} />
          </HStack>
        </HStack>
      </LayoutHeader>}
      start={mobile ? undefined : <LayoutPanel hasDivider width={284} role="navigation" padding={2}>{sidebar}</LayoutPanel>}
      content={<LayoutContent padding={0}>
        {/* The dim covers the stream only (D12): the row below and the side panel stay live. A click on the dim closes the conversation. */}
        <Overlay isOpen={conversation.open} scrim="light" position="fill" align="end" content={<VisuallyHidden>Samtalet är öppet. Tryck Esc eller klicka här för att stänga.</VisuallyHidden>} onClick={() => { if (conversation.open) composer.current?.close(); }}>
          <div className="stream">{stream}</div>
        </Overlay>
        <div className="composer-dock">{row}</div>
      </LayoutContent>} />
    <PanelView title={view?.title ?? null} output={view?.output} onClose={() => setView(null)} />
  </ConversationContext.Provider>;
}
