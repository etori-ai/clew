import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CalendarEvent, Proposal, SessionUser, Thread } from '@clew/contracts';
import { Badge, Button, CheckboxInput, Heading, IconButton, Icon, Text, WeekView, useMediaQuery, type WeekItem } from '@clew/ui';
import { addDays, rangeLabel, shortDayLabel, timeRange, today, weekNumber, weekStart } from '@clew/calendar/dates';
import { api, ApiError } from '../api';

/** Full week view 08–17 with week navigation. The open proposal thread is the side panel: confirm here or ask for another week. */
export function CalendarPage({ user }: { user: SessionUser }) {
  const mobile = useMediaQuery('(max-width: 720px)');
  const requested = new URLSearchParams(window.location.search).get('vecka');
  const [from, setFrom] = useState(() => requested && /^\d{4}-\d{2}-\d{2}$/.test(requested) ? weekStart(requested) : weekStart(today()));
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [thread, setThread] = useState<Thread | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async (week: string) => {
    setLoading(true);
    try {
      const [data, t] = await Promise.all([api.calendar(week), api.threads()]);
      setEvents(data.events); setProposals(data.proposals); setError(null);
      const open = t.threads.find(x => x.state === 'open' && x.topic === 'utvecklingssamtal') ?? t.threads.find(x => x.topic === 'utvecklingssamtal') ?? null;
      setThread(open); setSelected(open ? open.proposals.filter(p => p.status === 'proposed').map(p => p.id) : []);
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Kalendern kunde inte läsas.'); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(from); }, [from, load]);
  const apply = (t: Thread) => { setThread(t); setSelected(t.proposals.filter(p => p.status === 'proposed').map(p => p.id)); void api.calendar(from).then(d => { setEvents(d.events); setProposals(d.proposals); }); };
  const run = async (action: () => Promise<Thread>) => { setBusy(true); setError(null); try { apply(await action()); } catch (e) { setError(e instanceof ApiError ? e.message : 'Något gick fel.'); } finally { setBusy(false); } };
  const items = useMemo<WeekItem[]>(() => [
    ...events.filter(e => !e.title.startsWith('Utvecklingssamtal')).map(e => ({ id: e.id, title: e.title, start: e.start, end: e.end, allDay: e.allDay, tone: e.mine ? 'mine' as const : 'invited' as const, subtitle: e.participants.length ? e.participants.join(', ') : undefined })),
    ...events.filter(e => e.title.startsWith('Utvecklingssamtal') && !proposals.some(p => p.eventRef && e.id.startsWith(p.eventRef))).map(e => ({ id: e.id, title: e.title, start: e.start, end: e.end, allDay: e.allDay, tone: 'booked' as const })),
    ...proposals.map(p => ({ id: p.id, title: `Utvecklingssamtal · ${p.participant.name}`, start: p.start, end: p.end, allDay: false,
      tone: p.status === 'proposed' ? 'proposal' as const : 'booked' as const, selected: p.status !== 'proposed' || selected.includes(p.id) })),
  ], [events, proposals, selected]);
  const open = thread?.state === 'open' && thread.proposals.some(p => p.status === 'proposed');
  const undoUntil = thread?.proposals.map(p => p.undoUntil).filter((v): v is string => !!v).sort().at(-1);
  const undoOpen = !!undoUntil && Date.parse(undoUntil) > Date.now() && !!thread?.proposals.some(p => p.status === 'confirmed');
  return <main className="page" data-wide="true">
    <header className="calendar-toolbar">
      <div>
        <Heading level={1}>Kalender · vecka {weekNumber(from)}</Heading>
        <Text type="supporting">{rangeLabel(from, 7)} · {user.name}</Text>
      </div>
      <div className="page-header-meta">
        <div className="calendar-nav" role="group" aria-label="Byt vecka">
          <IconButton label="Föregående vecka" icon={<Icon icon="chevronLeft" />} variant="ghost" onClick={() => setFrom(addDays(from, -7))} />
          <Button variant="ghost" size="sm" label="I dag" onClick={() => setFrom(weekStart(today()))} />
          <IconButton label="Nästa vecka" icon={<Icon icon="chevronRight" />} variant="ghost" onClick={() => setFrom(addDays(from, 7))} />
        </div>
        <Button variant="ghost" size="sm" label="Till startsidan" href="/" />
      </div>
    </header>
    {error && <Text as="p" role="alert" color="accent">{error}</Text>}
    <div className="calendar-layout">
      <div className="calendar-view" data-loading={loading}>
        <WeekView date={from} days={mobile ? 5 : 7} items={items} hours={[8, 17]} />
        <Text type="supporting">Förslagen är ritade med streckad kant. Bocka av dem du vill bekräfta, eller be om en annan vecka.</Text>
      </div>
      <aside className="calendar-panel" aria-label="Förslag">
        {!thread && <Text type="supporting">Inga förslag just nu.</Text>}
        {thread && <>
          <div><Heading level={2}>{thread.title}</Heading><Text type="supporting">Varför nu? {thread.trigger.reason}. Källa: {thread.trigger.source}.</Text></div>
          {thread.week && thread.week !== from && <Button size="sm" label={`Visa vecka ${weekNumber(thread.week)}`} onClick={() => setFrom(thread.week!)} />}
          <div className="proposal-list">
            {thread.proposals.map(p => <div key={p.id} className="proposal-row" data-status={p.status}>
              {p.status === 'proposed' && open
                ? <CheckboxInput label={`${shortDayLabel(p.start.slice(0, 10))} ${timeRange(p.start, p.end)} · ${p.participant.name}`} value={selected.includes(p.id)} onChange={checked => setSelected(s => checked ? [...s, p.id] : s.filter(id => id !== p.id))} />
                : <Text>{shortDayLabel(p.start.slice(0, 10))} {timeRange(p.start, p.end)} · {p.participant.name}</Text>}
              <Badge variant={p.status === 'proposed' ? 'purple' : p.status === 'confirmed' || p.status === 'final' ? 'success' : 'neutral'} label={p.status === 'proposed' ? 'Förslag' : p.status === 'confirmed' ? 'Skickad' : p.status === 'final' ? 'Bokad' : p.status === 'undone' ? 'Återkallad' : 'Valdes bort'} />
            </div>)}
          </div>
          <div className="thread-actions">
            {open && <Button variant="primary" label={`Bekräfta ${selected.length} ${selected.length === 1 ? 'tid' : 'tider'}`} isDisabled={!selected.length || busy} clickAction={() => run(() => api.confirm(thread.id, selected))} />}
            {open && thread.week && <Button label={`Vecka ${weekNumber(addDays(thread.week, 7))} i stället`} isDisabled={busy} clickAction={() => run(() => api.replan(thread.id, addDays(thread.week!, 7)))} />}
            {undoOpen && <Button variant="destructive" label="Ångra" isDisabled={busy} clickAction={() => run(() => api.undo(thread.id))} />}
          </div>
          {thread.messages.at(-1) && <Text as="p" type="supporting">{thread.messages.at(-1)!.body}</Text>}
        </>}
      </aside>
    </div>
  </main>;
}
