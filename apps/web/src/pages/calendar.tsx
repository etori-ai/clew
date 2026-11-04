import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import type { Area, Attention, CalendarEvent, Proposal, SessionUser, Thread } from '@clew/contracts';
import { Badge, Button, ChatComposer, CheckboxList, CheckboxListItem, DatePicker, Drawer, DrawerHeader, DropdownMenu, EventCalendar, Heading, HStack, Icon, IconButton, Layout, LayoutContent, LayoutFooter, LayoutHeader, LayoutPanel, SegmentedControl, SegmentedControlItem, StatusDot, Text, Toolbar, VStack, agendaItems, useMediaQuery, type AgendaItem, type CalendarView } from '@clew/ui';
import { addDays, dayLabel, displayDate, monthLabel, occursOn, rangeLabel, shortDayLabel, timeRange, today, weekNumber, weekStart } from '@clew/calendar/dates';
import { api, ApiError } from '../api';
import { usePageTitle } from '../page-title';
import { Shell, mobileQuery } from '../components/shell';
import { AreasNav } from '../components/areas';
import { EventDialog } from '../components/calendar/event-dialog';
import { BookingDialog } from '../components/calendar/booking-dialog';

/** The three views as the URL names them, so a view is addressable and the back button works. */
type View = 'dag' | 'vecka' | 'manad';
const views: View[] = ['dag', 'vecka', 'manad'];
const viewLabels: Record<View, string> = { dag: 'Dag', vecka: 'Vecka', manad: 'Månad' };
const isoDate = /^\d{4}-\d{2}-\d{2}$/;
/** The panel leaves the side below 1024 px (the responsive guide's three-two-one contract) and opens as a drawer from the toolbar. */
const panelQuery = '(max-width: 1023px)';
const monthStart = (date: string) => date.slice(0, 8) + '01';
const addMonths = (date: string, months: number) => { const d = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1 + months, 1)); return d.toISOString().slice(0, 10); };
/** The Mondays whose weeks the month grid shows, so the whole grid is read with the week endpoint the API already has. */
const weeksOfMonth = (date: string) => { const first = weekStart(monthStart(date)), last = weekStart(addDays(addMonths(date, 1), -1)); const weeks: string[] = []; for (let w = first; w <= last; w = addDays(w, 7)) weeks.push(w); return weeks; };
const nextWholeHour = (now: Date) => { const d = new Date(now); d.setMinutes(0, 0, 0); d.setHours(d.getHours() + 1); return { start: d.toISOString(), end: new Date(d.getTime() + 3600_000).toISOString() }; };

/**
 * The calendar as a page (D27, D32): one day, one week or one month on FullCalendar under Clew's theme, inside the one
 * shell, with the proposal thread beside it to confirm or redraw. A booking of one's own, an opened entry and a moved
 * proposal all go through dialogs, so every action has a keyboard path; drag is a convenience for proposals alone.
 */
export function CalendarPage({ user, admin = false }: { user: SessionUser; admin?: boolean }) {
  const mobile = useMediaQuery(mobileQuery);
  const narrow = useMediaQuery(panelQuery);
  const [params, setParams] = useSearchParams();
  const requested = params.get('datum') ?? params.get('vecka');
  const date = requested && isoDate.test(requested) ? requested : today();
  const view: View = views.includes(params.get('vy') as View) ? params.get('vy') as View : 'vecka';
  const anchor = view === 'vecka' ? weekStart(date) : view === 'manad' ? monthStart(date) : date;
  const go = (next: { date?: string; view?: View }) => setParams(p => { const q = new URLSearchParams(p); q.delete('vecka'); q.set('datum', next.date ?? date); q.set('vy', next.view ?? view); return q; });
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [thread, setThread] = useState<Thread | null>(null);
  // The same frame as the start page (D31): the areas in the shell's SideNav and the attention sentence in its TopNav.
  const [areas, setAreas] = useState<Area[]>([]);
  const [attention, setAttention] = useState<Attention | null>(null);
  useEffect(() => { let alive = true; void Promise.all([api.areas(), api.attention()]).then(([a, at]) => { if (alive) { setAreas(a.areas); setAttention(at); } }).catch(() => undefined); return () => { alive = false; }; }, []);
  const remaining = attention ? Math.max(0, attention.budget - attention.used) : null;
  const attentionLabel = attention ? (remaining === 0 ? `Inga avbrott kvar i dag · resten samlas till ${attention.bundledUntil ?? 'i morgon 06:00'}` : `${remaining} avbrott kvar i dag`) : undefined;
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [openItem, setOpenItem] = useState<AgendaItem | null>(null);
  const [booking, setBooking] = useState<{ start: string; end: string } | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const title = view === 'dag' ? dayLabel(anchor) : view === 'manad' ? monthLabel(anchor) : `Vecka ${weekNumber(anchor)} · ${rangeLabel(anchor, 5)}`;
  const short = view === 'vecka' ? `Vecka ${weekNumber(anchor)}` : title.charAt(0).toUpperCase() + title.slice(1);
  usePageTitle(`${short} · Kalender`, view === 'vecka' ? `Vecka ${weekNumber(anchor)}, ${rangeLabel(anchor, 5)}` : `${view === 'dag' ? 'Dagvy' : 'Månadsvy'}, ${title}`);
  /** The weeks the view needs: one for a day or a week, every week the month grid shows. */
  const weeks = useMemo(() => view === 'manad' ? weeksOfMonth(anchor) : [weekStart(anchor)], [view, anchor]);
  const loadCalendar = useCallback(async () => {
    const parts = await Promise.all(weeks.map(w => api.calendar(w)));
    // Weeks overlap at the month's edges; an occurrence is one id at one start.
    const seen = new Set<string>();
    setEvents(parts.flatMap(p => p.events).filter(e => { const key = `${e.id}@${e.start}`; if (seen.has(key)) return false; seen.add(key); return true; }));
    setProposals(parts[0]?.proposals ?? []);
  }, [weeks]);
  const load = useCallback(async () => {
    try {
      const [, t] = await Promise.all([loadCalendar(), api.threads()]);
      setError(null);
      const open = t.threads.find(x => x.state === 'open' && x.topic === 'utvecklingssamtal') ?? t.threads.find(x => x.topic === 'utvecklingssamtal') ?? null;
      setThread(open); setSelected(open ? open.proposals.filter(p => p.status === 'proposed').map(p => p.id) : []);
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Kalendern kunde inte läsas.'); }
  }, [loadCalendar]);
  useEffect(() => { void load(); }, [load]);
  const apply = (t: Thread) => { setThread(t); setSelected(t.proposals.filter(p => p.status === 'proposed').map(p => p.id)); void loadCalendar(); };
  const run = async (action: () => Promise<Thread>) => { if (busy) return; setBusy(true); setError(null); try { apply(await action()); } catch (e) { setError(e instanceof ApiError ? e.message : 'Något gick fel.'); } finally { setBusy(false); } };
  const items = useMemo(() => agendaItems(events, proposals), [events, proposals]);
  const dayItems = useMemo(() => openItem ? items.filter(i => occursOn(i, displayDate(openItem.start))) : [], [items, openItem]);
  const moveProposal = (item: AgendaItem, start: string, end: string) => { const p = item.proposal!; return api.moveProposal(p.threadId, p.id, { start, end }).then(apply).catch(e => { setError(e instanceof ApiError ? e.message : 'Något gick fel.'); throw e; }); };
  const step = (direction: 1 | -1) => go({ date: view === 'dag' ? addDays(anchor, direction) : view === 'manad' ? addMonths(anchor, direction) : addDays(anchor, 7 * direction) });
  const calendarView: CalendarView = view === 'dag' ? 'timeGridDay' : view === 'manad' ? 'dayGridMonth' : mobile ? 'listWeek' : 'timeGridWeek';
  const stepLabel = view === 'dag' ? 'dag' : view === 'manad' ? 'månad' : 'vecka';
  const open = thread?.state === 'open' && thread.proposals.some(p => p.status === 'proposed');
  const proposed = thread?.proposals.filter(p => p.status === 'proposed') ?? [];
  const undoUntil = thread?.proposals.map(p => p.undoUntil).filter((v): v is string => !!v).sort().at(-1);
  const undoOpen = !!undoUntil && Date.parse(undoUntil) > Date.now() && !!thread?.proposals.some(p => p.status === 'confirmed');
  const lead = thread?.messages.find(m => m.role === 'assistant')?.body.split(/(?<=[.!?])\s/)[0];
  const plural = selected.length === 1 ? 'inbjudan' : 'inbjudningar';
  // The panel is its own Layout (side-panels guide): the lead and the list scroll, the reply field is the pinned footer.
  const panelBody = thread && <VStack gap={3}>
    <HStack justify="between" vAlign="center" gap={2} wrap="wrap">
      {open ? <Badge variant="warning" icon={<Icon icon="warning" size="sm" />} label="Förslag att bekräfta" /> : <Text type="supporting" weight="semibold">Hanterad</Text>}
      {open && <Text type="supporting">{selected.length} av {proposed.length} valda</Text>}
    </HStack>
    {lead && <Text type="large" weight="medium" as="p">{lead}</Text>}
    <CheckboxList label="Förslag" isLabelHidden value={selected} onChange={setSelected} isReadOnly={!open} hasDividers>
      {thread.proposals.filter(p => p.status !== 'declined').map(p => <CheckboxListItem key={p.id} value={p.id} label={p.participant.name}
        description={`${shortDayLabel(p.start.slice(0, 10))} · ${timeRange(p.start, p.end)}`} isChecked={p.status !== 'proposed' || selected.includes(p.id)} isDisabled={p.status !== 'proposed'}
        endContent={p.status !== 'proposed' ? <StatusDot variant={p.status === 'confirmed' || p.status === 'final' ? 'success' : 'neutral'} label={p.status === 'confirmed' ? 'Skickad' : p.status === 'final' ? 'Bokad' : 'Återkallad'} /> : undefined} />)}
    </CheckboxList>
    {open && <Text type="supporting" as="p">Inbjudningarna skickas först när du bekräftar. Öppna ett förslag i kalendern för att flytta det, eller be mig rita om dem i en annan vecka.</Text>}
    {error && <Text as="p" role="alert" color="accent">{error}</Text>}
    <HStack gap={2} wrap="wrap">
      {open && <Button variant="primary" label={`Skicka ${selected.length} ${plural}`} isDisabled={!selected.length} clickAction={() => run(() => api.confirm(thread.id, selected))} />}
      {open && thread.week && <Button label="Föreslå andra tider" clickAction={() => run(() => api.replan(thread.id, addDays(thread.week!, 7)))} />}
      {undoOpen && <Button variant="destructive" label="Ångra" clickAction={() => run(() => api.undo(thread.id))} />}
      {thread.week && (view !== 'vecka' || thread.week !== anchor) && <Button variant="ghost" label={`Visa vecka ${weekNumber(thread.week)}`} onClick={() => { setPanelOpen(false); go({ date: thread.week!, view: 'vecka' }); }} />}
    </HStack>
  </VStack>;
  const reply = thread && <ChatComposer density="compact" elevation="none" isDisabled={busy} placeholder="Svara här" onSubmit={text => { const body = text.trim(); if (body) void run(() => api.reply(thread.id, body)); }} />;
  const panel = thread && <Layout height="fill" padding={0} content={<LayoutContent>{panelBody}</LayoutContent>} footer={<LayoutFooter hasDivider>{reply}</LayoutFooter>} />;
  const toolbar = <Toolbar label="Kalender" size="sm"
    startContent={<HStack gap={3} vAlign="center" wrap="wrap">
      <Heading level={1}>{title.charAt(0).toUpperCase() + title.slice(1)}</Heading>
      <HStack gap={1} vAlign="center" role="group" aria-label={`Byt ${stepLabel}`}>
        <IconButton label={`Förra ${stepLabel}en`} icon={<Icon icon="chevronLeft" />} variant="ghost" size="sm" onClick={() => step(-1)} />
        <Button variant="ghost" size="sm" label="I dag" onClick={() => go({ date: today() })} />
        <IconButton label={`Nästa ${stepLabel}`} icon={<Icon icon="chevronRight" />} variant="ghost" size="sm" onClick={() => step(1)} />
        <DatePicker value={anchor} onChange={d => go({ date: d })} />
      </HStack>
    </HStack>}
    endContent={<HStack gap={2} vAlign="center" wrap="wrap">
      {/* Three labels do not fit 320 px with text spacing (1.4.12), so a phone gets an adaptive menu, as the piles do (D31 §5). */}
      {mobile
        ? <DropdownMenu presentation="adaptive" button={{ label: `Vy: ${viewLabels[view]}`, size: 'sm', variant: 'secondary' }} items={views.map(v => ({ id: v, label: viewLabels[v], onClick: () => go({ view: v }) }))} />
        : <SegmentedControl label="Vy" size="sm" value={view} onChange={v => go({ view: v as View })}>
          <SegmentedControlItem value="dag" label="Dag" />
          <SegmentedControlItem value="vecka" label="Vecka" />
          <SegmentedControlItem value="manad" label="Månad" />
        </SegmentedControl>}
      {narrow && thread && <Button variant="secondary" size="sm" label={open ? `Förslag · ${proposed.length}` : 'Förslag'} onClick={() => setPanelOpen(true)} />}
      <Button variant="primary" size="sm" label="Ny bokning" onClick={() => setBooking(nextWholeHour(new Date()))} />
    </HStack>} />;
  return <Shell user={user} admin={admin} current="kalender" attention={attentionLabel} sideNav={<AreasNav areas={areas} current={undefined} hrefFor={a => a === null ? '/' : `/omrade/${a}`} />}><Layout height="fill" padding={mobile ? 3 : 4}
    header={<LayoutHeader hasDivider>{toolbar}</LayoutHeader>}
    end={!narrow && thread ? <LayoutPanel width={380} hasDivider role="complementary" label="Förslag" padding={0} isScrollable={false}>{panel}</LayoutPanel> : undefined}
    content={<LayoutContent>
      <VStack gap={4}>
        {!thread && error && <Text as="p" role="alert" color="accent">{error}</Text>}
        <EventCalendar view={calendarView} date={anchor} items={items} label={title.charAt(0).toUpperCase() + title.slice(1)} dayHeadingLevel={2}
          accessiblePath={thread ? 'Listan under Förslag är vägen till varje förslag; Retur på en post öppnar den.' : 'Retur på en post öppnar den.'}
          selectedId={openItem?.id} onItemClick={setOpenItem}
          onMoveProposal={open ? moveProposal : undefined}
          onSelectRange={mobile ? undefined : (start, end) => setBooking({ start, end })} />
      </VStack>
    </LayoutContent>} />
    {narrow && thread && <Drawer isOpen={panelOpen} onOpenChange={setPanelOpen} side="end" width={420} label="Förslag">
      <Layout height="fill" padding={0} header={<DrawerHeader title="Förslag" onOpenChange={setPanelOpen} />} content={<LayoutContent>{panelBody}</LayoutContent>} footer={<LayoutFooter hasDivider>{reply}</LayoutFooter>} />
    </Drawer>}
    <EventDialog item={openItem} dayItems={dayItems} onClose={() => setOpenItem(null)} onChanged={t => { if (t) apply(t); else void loadCalendar(); }} onOpenDay={d => go({ date: d, view: 'dag' })} />
    <BookingDialog isOpen={!!booking} initial={booking ?? nextWholeHour(new Date())} onClose={created => { setBooking(null); if (created) void loadCalendar(); }} />
  </Shell>;
}
