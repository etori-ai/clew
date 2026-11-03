import { useEffect, useMemo, useState } from 'react';
import type { CalendarEvent, Thread } from '@clew/contracts';
import { Badge, Button, CheckboxInput, Heading, Text, TextInput, WeekView, type WeekItem } from '@clew/ui';
import { addDays, dateLabel, shortDayLabel, timeLabel, timeRange, weekNumber } from '@clew/calendar/dates';
import { api, ApiError } from '../api';

type Props = { thread: Thread; events?: CalendarEvent[]; mobile: boolean; onChange: (thread: Thread) => void; onLoadWeek?: (week: string) => void };
const statusLabel: Record<string, string> = { proposed: 'Förslag', confirmed: 'Inbjudan skickad', final: 'Bokad', undone: 'Återkallad', declined: 'Valdes bort', superseded: '' };

/** A thread: title, why-line, memory, the proposals as a small week and the actions. The reply field keeps it alive. */
export function ThreadCard({ thread, events = [], mobile, onChange, onLoadWeek }: Props) {
  const [selected, setSelected] = useState<string[]>(() => thread.proposals.filter(p => p.status === 'proposed').map(p => p.id));
  const [reply, setReply] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { setSelected(thread.proposals.filter(p => p.status === 'proposed').map(p => p.id)); }, [thread.updatedAt, thread.proposals.length]);
  useEffect(() => { if (thread.week) onLoadWeek?.(thread.week); }, [thread.week]);
  const undoUntil = thread.proposals.map(p => p.undoUntil).filter((v): v is string => !!v).sort().at(-1);
  const undoOpen = !!undoUntil && Date.parse(undoUntil) > now && thread.proposals.some(p => p.status === 'confirmed');
  useEffect(() => { if (!undoOpen) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [undoOpen]);
  const open = thread.state === 'open' && thread.proposals.some(p => p.status === 'proposed');
  const run = async (action: () => Promise<Thread>) => {
    setBusy(true); setError(null);
    try { onChange(await action()); } catch (e) { setError(e instanceof ApiError ? e.message : 'Något gick fel.'); } finally { setBusy(false); }
  };
  const items = useMemo<WeekItem[]>(() => [
    ...events.filter(e => !e.title.startsWith('Utvecklingssamtal')).map(e => ({ id: e.id, title: e.title, start: e.start, end: e.end, allDay: e.allDay, tone: e.mine ? 'mine' as const : 'invited' as const })),
    ...thread.proposals.filter(p => ['proposed', 'confirmed', 'final'].includes(p.status)).map(p => ({ id: p.id, title: 'Utvecklingssamtal', start: p.start, end: p.end, allDay: false,
      tone: p.status === 'proposed' ? 'proposal' as const : 'booked' as const, selected: p.status !== 'proposed' || selected.includes(p.id) })),
  ], [events, thread.proposals, selected]);
  const nextWeek = thread.week ? addDays(thread.week, 7) : null;
  const confirmedCount = thread.proposals.filter(p => p.status === 'confirmed' || p.status === 'final').length;
  return <article className="thread" data-state={thread.state} aria-labelledby={`thread-${thread.id}`}>
    <div className="thread-head">
      <div>
        <Heading level={2} id={`thread-${thread.id}`}>{thread.title}</Heading>
        <div className="thread-why">
          <Text type="supporting">Varför nu? {thread.trigger.reason}.</Text>
          <Text type="supporting">Källa: {thread.trigger.source}, {dateLabel(thread.trigger.at.slice(0, 10))} {timeLabel(thread.trigger.at)}.</Text>
        </div>
      </div>
      {thread.kind === 'pushed' && <Badge variant={thread.state === 'open' ? 'info' : 'neutral'} label={thread.state === 'open' ? 'Behöver dig' : thread.state === 'handled' ? 'Redan hanterat' : 'Avfärdad'} />}
    </div>
    <div className="thread-messages">
      {thread.messages.map(m => <div key={m.id} className="thread-message" data-role={m.role}>
        <Text type="supporting">{m.role === 'user' ? 'Du' : 'Assistenten'} · {timeLabel(m.createdAt)}</Text>
        <Text as="p">{m.body}</Text>
      </div>)}
    </div>
    {thread.proposals.length > 0 && thread.week && <>
      {!mobile && <WeekView date={thread.week} days={5} items={items} compact hours={[8, 17]} />}
      <div className="legend" aria-label="Teckenförklaring">
        <span className="legend-item event-card" data-tone="mine"><span className="legend-swatch" /><Text type="supporting">Dina möten</Text></span>
        <span className="legend-item event-card" data-tone="proposal"><span className="legend-swatch" /><Text type="supporting">Förslag</Text></span>
        <span className="legend-item event-card" data-tone="booked"><span className="legend-swatch" /><Text type="supporting">Bokat</Text></span>
      </div>
      <div className="proposal-list" role="group" aria-label="Förslag">
        {thread.proposals.map(p => <div key={p.id} className="proposal-row" data-status={p.status}>
          {p.status === 'proposed' && open
            ? <CheckboxInput label={`${shortDayLabel(p.start.slice(0, 10))} ${timeRange(p.start, p.end)} · Utvecklingssamtal`} value={selected.includes(p.id)} onChange={checked => setSelected(s => checked ? [...s, p.id] : s.filter(id => id !== p.id))} />
            : <Text>{shortDayLabel(p.start.slice(0, 10))} {timeRange(p.start, p.end)} · Utvecklingssamtal</Text>}
          <Badge variant={p.status === 'proposed' ? 'purple' : p.status === 'confirmed' || p.status === 'final' ? 'success' : 'neutral'} label={statusLabel[p.status] ?? p.status} />
        </div>)}
      </div>
    </>}
    {error && <Text as="p" color="accent" role="alert">{error}</Text>}
    <div className="thread-actions">
      {open && <Button variant="primary" label={`Bekräfta ${selected.length} ${selected.length === 1 ? 'tid' : 'tider'}`} isDisabled={!selected.length || busy} clickAction={() => run(() => api.confirm(thread.id, selected))} />}
      {open && <Button label="Visa i kalendern" href={`/kalender?vecka=${thread.week}`} />}
      {open && nextWeek && <Button label={`Vecka ${weekNumber(nextWeek)} i stället`} isDisabled={busy} clickAction={() => run(() => api.replan(thread.id, nextWeek))} />}
      {open && <Button variant="ghost" label="Inte nu" isDisabled={busy} clickAction={() => run(() => api.dismiss(thread.id))} />}
      {undoOpen && undoUntil && <Button variant="destructive" label={`Ångra (${Math.max(0, Math.ceil((Date.parse(undoUntil) - now) / 60000))} min kvar)`} isDisabled={busy} clickAction={() => run(() => api.undo(thread.id))} />}
      {!undoOpen && confirmedCount > 0 && thread.state === 'handled' && <Text type="supporting">{confirmedCount} samtal bokade. Deltagarna ser du i kalendern.</Text>}
    </div>
    <form className="thread-reply" onSubmit={event => { event.preventDefault(); if (reply.trim()) { const body = reply.trim(); setReply(''); void run(() => api.reply(thread.id, body)); } }}>
      <TextInput label="Svara i tråden" isLabelHidden placeholder="Svara i tråden …" value={reply} onChange={setReply} enterKeyHint="send" />
      <Button type="submit" label="Skicka" isDisabled={!reply.trim() || busy} />
    </form>
  </article>;
}
