import { useEffect, useMemo, useState } from 'react';
import type { CalendarEvent, Thread } from '@clew/contracts';
import { Badge, Button, Card, ChatMessage, ChatMessageBubble, ChatMessageList, ChatMessageMetadata, CheckboxList, CheckboxListItem, Collapsible, HStack, Text, Timestamp, VStack, WeekAgenda, type AgendaItem } from '@clew/ui';
import { addDays, shortDayLabel, timeRange, weekNumber } from '@clew/calendar/dates';
import { api, ApiError } from '../api';

type Props = { thread: Thread; events?: CalendarEvent[]; compact: boolean; onChange: (thread: Thread) => void; onLoadWeek?: (week: string) => void };

const statusBadge = (thread: Thread) => {
  if (thread.kind === 'question') return { variant: 'neutral', label: Date.now() - Date.parse(thread.createdAt) < 3600_000 ? 'Du frågade nyss' : 'Du frågade' } as const;
  if (thread.state === 'dismissed') return { variant: 'neutral', label: 'Avfärdad' } as const;
  if (thread.proposals.some(p => p.status === 'confirmed')) return { variant: 'success', label: 'Inbjudningar skickade' } as const;
  if (thread.proposals.some(p => p.status === 'final')) return { variant: 'success', label: 'Bokat' } as const;
  return { variant: 'info', label: 'Förslag att bekräfta' } as const;
};
/** The first assistant message is the lead: one sentence, then the assessment. */
function split(body: string) {
  const index = body.search(/[.!?]\s/);
  return index > 0 ? { lead: body.slice(0, index + 1), rest: body.slice(index + 2).trim() } : { lead: body, rest: '' };
}

const RECENT = 2;
/** The memory of the thread: the latest exchange stays visible, older turns fold away but are never lost. */
function Conversation({ messages }: { messages: Thread['messages'] }) {
  const older = messages.slice(0, -RECENT), recent = messages.slice(-RECENT);
  const list = (items: Thread['messages']) => <ChatMessageList density="compact" align="top">
    {items.map(m => <ChatMessage key={m.id} sender={m.role}>
      <ChatMessageBubble variant={m.role === 'assistant' ? 'ghost' : 'filled'} metadata={<ChatMessageMetadata timestamp={<Timestamp value={m.createdAt} format="time" hasTooltip={false} />} />}>{m.body}</ChatMessageBubble>
    </ChatMessage>)}
  </ChatMessageList>;
  return <Collapsible defaultIsOpen={false} chevronPosition="start" trigger={<Text type="supporting">Tråden · {messages.length} meddelanden</Text>}>
    <VStack gap={2}>{older.length > 0 && list(older)}{list(recent)}</VStack>
  </Collapsible>;
}

/**
 * A thread, not a card: status and source on top, one sentence, the assessment, the proposals drawn in the week,
 * the actions, "varför nu?", and a composer at the bottom so the thread keeps its memory.
 */
export function ThreadCard({ thread, events = [], compact, onChange, onLoadWeek }: Props) {
  const [selected, setSelected] = useState<string[]>(() => thread.proposals.filter(p => p.status === 'proposed').map(p => p.id));
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
  const first = thread.messages.find(m => m.role === 'assistant');
  const conversation = thread.kind === 'question' ? thread.messages : thread.messages.filter(m => m !== first);
  const { lead, rest } = split(first?.body ?? thread.title);
  const items = useMemo<AgendaItem[]>(() => [
    ...events.filter(e => !e.title.startsWith('Utvecklingssamtal')).map(e => ({ id: e.id, title: e.title, start: e.start, end: e.end, allDay: e.allDay, kind: 'event' as const })),
    ...thread.proposals.filter(p => ['proposed', 'confirmed', 'final'].includes(p.status)).map(p => ({ id: p.id, title: 'Utvecklingssamtal', start: p.start, end: p.end, allDay: false, kind: p.status === 'proposed' ? 'proposal' as const : 'booked' as const })),
  ], [events, thread.proposals]);
  const nextWeek = thread.week ? addDays(thread.week, 7) : null;
  const count = selected.length, plural = count === 1 ? 'inbjudan' : 'inbjudningar';
  const badge = statusBadge(thread);
  return <Card padding={0}>
    <VStack gap={2} padding={2} as="article" aria-label={`Tråd: ${thread.title}`} id={`thread-${thread.id}`}>
      <HStack justify="between" vAlign="center" gap={2} wrap="wrap">
        <Badge variant={badge.variant} label={badge.label} />
        <Text type="supporting">{thread.trigger.source} · <Timestamp value={thread.trigger.at} format="time" hasTooltip={false} /></Text>
      </HStack>
      {thread.kind === 'pushed' && <>
        <Text type="large" weight="medium" as="p">{lead}</Text>
        {rest && <Text as="p" color="secondary">{rest}</Text>}
      </>}
      {thread.proposals.length > 0 && thread.week && (compact
        ? <CheckboxList label="Förslag" isLabelHidden value={selected} onChange={setSelected} isReadOnly={!open} density="compact">
          {thread.proposals.filter(p => p.status !== 'declined').map(p => <CheckboxListItem key={p.id} value={p.id} label={`${p.participant.name} · ${shortDayLabel(p.start.slice(0, 10))} ${timeRange(p.start, p.end)}`} isChecked={p.status !== 'proposed' || selected.includes(p.id)} isDisabled={p.status !== 'proposed'} />)}
        </CheckboxList>
        : <WeekAgenda week={thread.week} days={5} items={items} label={`Vecka ${weekNumber(thread.week)} med förslagen`} />)}
      {conversation.length > 0 && <Conversation messages={conversation} />}
      {error && <Text as="p" role="alert" color="accent">{error}</Text>}
      {(open || undoOpen) && <HStack gap={2} wrap="wrap">
        {open && <Button variant="primary" label={`Skicka ${count} ${plural}`} isDisabled={!count || busy} clickAction={() => run(() => api.confirm(thread.id, selected))} />}
        {open && !compact && <Button label="Justera i kalendern" href={`/kalender?vecka=${thread.week}`} />}
        {open && compact && <Button label="Visa i veckan" href={`/kalender?vecka=${thread.week}`} />}
        {open && nextWeek && <Button variant="ghost" label={`Vecka ${weekNumber(nextWeek)} i stället`} isDisabled={busy} clickAction={() => run(() => api.replan(thread.id, nextWeek))} />}
        {open && <Button variant="ghost" label="Inte nu" isDisabled={busy} clickAction={() => run(() => api.dismiss(thread.id))} />}
        {undoOpen && undoUntil && <Button variant="destructive" label={`Ångra (${Math.max(0, Math.ceil((Date.parse(undoUntil) - now) / 60000))} min kvar)`} isDisabled={busy} clickAction={() => run(() => api.undo(thread.id))} />}
      </HStack>}
      {thread.kind === 'pushed' && <Text type="supporting" as="p">Varför nu? {thread.trigger.reason}. {open ? 'Skickas via kalendern med möjlighet att ångra i 10 minuter.' : ''}</Text>}
    </VStack>
  </Card>;
}
