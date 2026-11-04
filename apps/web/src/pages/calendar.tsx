import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CalendarEvent, Proposal, SessionUser, Thread } from '@clew/contracts';
import { Badge, Button, ChatComposer, CheckboxList, CheckboxListItem, Divider, EventCalendar, Heading, HStack, Icon, IconButton, Layout, LayoutContent, LayoutHeader, LayoutPanel, Text, VStack, WeekAgenda, useMediaQuery, type AgendaItem } from '@clew/ui';
import { addDays, rangeLabel, shortDayLabel, timeRange, today, weekNumber, weekStart } from '@clew/calendar/dates';
import { api, ApiError } from '../api';
import { usePageTitle } from '../page-title';
import { Shell, mobileQuery } from '../components/shell';

/** The calendar as a page: the week on a time grid (D27), or as an agenda on a phone, with the proposal thread beside it to confirm or redraw. */
export function CalendarPage({ user }: { user: SessionUser }) {
  const mobile = useMediaQuery(mobileQuery);
  const requested = new URLSearchParams(window.location.search).get('vecka');
  const [from, setFrom] = useState(() => requested && /^\d{4}-\d{2}-\d{2}$/.test(requested) ? weekStart(requested) : weekStart(today()));
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [thread, setThread] = useState<Thread | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  usePageTitle(`Vecka ${weekNumber(from)} · Kalender`, `Vecka ${weekNumber(from)}, ${rangeLabel(from, 5)}`);
  const load = useCallback(async (week: string) => {
    try {
      const [data, t] = await Promise.all([api.calendar(week), api.threads()]);
      setEvents(data.events); setProposals(data.proposals); setError(null);
      const open = t.threads.find(x => x.state === 'open' && x.topic === 'utvecklingssamtal') ?? t.threads.find(x => x.topic === 'utvecklingssamtal') ?? null;
      setThread(open); setSelected(open ? open.proposals.filter(p => p.status === 'proposed').map(p => p.id) : []);
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Kalendern kunde inte läsas.'); }
  }, []);
  useEffect(() => { void load(from); }, [from, load]);
  const apply = (t: Thread) => { setThread(t); setSelected(t.proposals.filter(p => p.status === 'proposed').map(p => p.id)); void api.calendar(from).then(d => { setEvents(d.events); setProposals(d.proposals); }); };
  const run = async (action: () => Promise<Thread>) => { if (busy) return; setBusy(true); setError(null); try { apply(await action()); } catch (e) { setError(e instanceof ApiError ? e.message : 'Något gick fel.'); } finally { setBusy(false); } };
  const items = useMemo<AgendaItem[]>(() => [
    ...events.filter(e => !e.title.startsWith('Utvecklingssamtal')).map(e => ({ id: e.id, title: e.title, start: e.start, end: e.end, allDay: e.allDay, kind: 'event' as const, subtitle: e.participants.length ? e.participants.join(', ') : undefined })),
    ...events.filter(e => e.title.startsWith('Utvecklingssamtal') && !proposals.some(p => p.eventRef && e.id.startsWith(p.eventRef))).map(e => ({ id: e.id, title: e.title, start: e.start, end: e.end, allDay: e.allDay, kind: 'booked' as const })),
    ...proposals.map(p => ({ id: p.id, title: 'Utvecklingssamtal', subtitle: p.participant.name, start: p.start, end: p.end, allDay: false, kind: p.status === 'proposed' ? 'proposal' as const : 'booked' as const })),
  ], [events, proposals]);
  const open = thread?.state === 'open' && thread.proposals.some(p => p.status === 'proposed');
  const proposed = thread?.proposals.filter(p => p.status === 'proposed') ?? [];
  const undoUntil = thread?.proposals.map(p => p.undoUntil).filter((v): v is string => !!v).sort().at(-1);
  const undoOpen = !!undoUntil && Date.parse(undoUntil) > Date.now() && !!thread?.proposals.some(p => p.status === 'confirmed');
  const lead = thread?.messages.find(m => m.role === 'assistant')?.body.split(/(?<=[.!?])\s/)[0];
  const plural = selected.length === 1 ? 'inbjudan' : 'inbjudningar';
  const panel = thread && <VStack gap={3}>
    <HStack justify="between" vAlign="center" gap={2} wrap="wrap">
      <Badge variant={open ? 'info' : 'neutral'} label={open ? 'Förslag att bekräfta' : 'Hanterad'} />
      {open && <Text type="supporting">{selected.length} av {proposed.length} valda</Text>}
    </HStack>
    {lead && <Text type="large" weight="medium" as="p">{lead}</Text>}
    <CheckboxList label="Förslag" isLabelHidden value={selected} onChange={setSelected} isReadOnly={!open} hasDividers>
      {thread.proposals.filter(p => p.status !== 'declined').map(p => <CheckboxListItem key={p.id} value={p.id} label={p.participant.name}
        description={`${shortDayLabel(p.start.slice(0, 10))} · ${timeRange(p.start, p.end)}`} isChecked={p.status !== 'proposed' || selected.includes(p.id)} isDisabled={p.status !== 'proposed'}
        endContent={p.status !== 'proposed' ? <Badge variant={p.status === 'confirmed' || p.status === 'final' ? 'success' : 'neutral'} label={p.status === 'confirmed' ? 'Skickad' : p.status === 'final' ? 'Bokad' : 'Återkallad'} /> : undefined} />)}
    </CheckboxList>
    {open && <Text type="supporting" as="p">Inbjudningarna skickas först när du bekräftar. Vill du ha andra tider ritar jag om förslagen i en annan vecka.</Text>}
    {error && <Text as="p" role="alert" color="accent">{error}</Text>}
    <HStack gap={2} wrap="wrap">
      {open && <Button variant="primary" label={`Skicka ${selected.length} ${plural}`} isDisabled={!selected.length} clickAction={() => run(() => api.confirm(thread.id, selected))} />}
      {open && thread.week && <Button label="Föreslå andra tider" clickAction={() => run(() => api.replan(thread.id, addDays(thread.week!, 7)))} />}
      {undoOpen && <Button variant="destructive" label="Ångra" clickAction={() => run(() => api.undo(thread.id))} />}
      {thread.week && thread.week !== from && <Button variant="ghost" size="sm" label={`Visa vecka ${weekNumber(thread.week)}`} onClick={() => setFrom(thread.week!)} />}
    </HStack>
    <Divider />
    <ChatComposer density="compact" elevation="none" isDisabled={busy} placeholder="Svara här" onSubmit={text => { const body = text.trim(); if (body) void run(() => api.reply(thread.id, body)); }} />
  </VStack>;
  return <Shell user={user} current="kalender"><Layout height="fill" padding={mobile ? 3 : 4}
    header={<LayoutHeader hasDivider>
      <HStack gap={2} vAlign="center" wrap="wrap">
        <Heading level={1}>Vecka {weekNumber(from)} · {rangeLabel(from, 5)}</Heading>
        <HStack gap={1} vAlign="center" role="group" aria-label="Byt vecka">
          <IconButton label="Förra veckan" icon={<Icon icon="chevronLeft" />} variant="ghost" size="sm" onClick={() => setFrom(addDays(from, -7))} />
          <Button variant="ghost" size="sm" label="I dag" onClick={() => setFrom(weekStart(today()))} />
          <IconButton label="Nästa vecka" icon={<Icon icon="chevronRight" />} variant="ghost" size="sm" onClick={() => setFrom(addDays(from, 7))} />
        </HStack>
      </HStack>
    </LayoutHeader>}
    end={!mobile && thread ? <LayoutPanel width={380} hasDivider role="complementary" label="Förslag">{panel}</LayoutPanel> : undefined}
    content={<LayoutContent>
      <VStack gap={4}>
        {!thread && error && <Text as="p" role="alert" color="accent">{error}</Text>}
        {mobile
          ? <WeekAgenda week={from} days={5} items={items} detailed dayHeadingLevel={2} label={`Vecka ${weekNumber(from)}`} />
          : <EventCalendar view="timeGridWeek" date={from} items={items} label={`Vecka ${weekNumber(from)}`} dayHeadingLevel={2} />}
        {mobile && panel}
      </VStack>
    </LayoutContent>} /></Shell>;
}
