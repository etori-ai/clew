import { useEffect, useMemo, useState } from 'react';
import type { CalendarEvent, Thread } from '@clew/contracts';
import { Badge, Button, Card, ChatMessage, ChatMessageBubble, ChatMessageList, ChatMessageMetadata, CheckboxList, CheckboxListItem, Collapsible, Heading, HStack, MoreMenu, Text, Timestamp, VStack, VisuallyHidden, WeekAgenda, type AgendaItem } from '@clew/ui';
import { useConversation } from './conversation-context';
import { useLeaveWithUndo } from './card';
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
    {items.map(m => <ChatMessage key={m.id} sender={m.role} name={<VisuallyHidden>{m.role === 'user' ? 'Du' : 'Assistenten'}</VisuallyHidden>}>
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
  // The selection is the card's draft (D12): the rows' `selected` flags when the server wrote them, else every proposed time.
  const seed = () => thread.items.length ? thread.items.filter(i => i.selected).map(i => i.ref.replace(/^proposal:/, '')).filter(id => thread.proposals.some(p => p.id === id && p.status === 'proposed')) : thread.proposals.filter(p => p.status === 'proposed').map(p => p.id);
  const [selected, setSelected] = useState<string[]>(seed);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [why, setWhy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const talk = useConversation();
  const leave = useLeaveWithUndo(onChange);
  const chipRef = 'thread:' + thread.id;
  const inConversation = talk.chipped.includes(chipRef);
  const draft = thread.messages.at(-1)?.meta?.draft;
  useEffect(() => { setSelected(seed()); }, [thread.updatedAt, thread.proposals.length]);
  useEffect(() => { if (thread.week) onLoadWeek?.(thread.week); }, [thread.week]);
  const undoUntil = thread.proposals.map(p => p.undoUntil).filter((v): v is string => !!v).sort().at(-1);
  const undoOpen = !!undoUntil && Date.parse(undoUntil) > now && thread.proposals.some(p => p.status === 'confirmed');
  useEffect(() => { if (!undoOpen) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [undoOpen]);
  const open = thread.state === 'open' && thread.proposals.some(p => p.status === 'proposed');
  // Busy never disables the buttons: a disabled button drops the focus it holds (2.4.3). Action-buttons wait on their own promise.
  const run = async (action: () => Promise<Thread>) => {
    if (busy) return;
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
    <VStack gap={2} padding={2} as="article" tabIndex={-1} aria-label={`Tråd: ${thread.title}`} id={`thread-${thread.id}`} aria-current={inConversation ? 'true' : undefined}>
      <HStack justify="between" vAlign="center" gap={2} wrap="wrap">
        <HStack gap={2} vAlign="center" wrap="wrap">
          <Badge variant={badge.variant} label={badge.label} />
          {inConversation && <Badge variant="info" label="I samtalet" />}
          {draft && open && <Badge variant="info" label="Utkast från samtalet" />}
        </HStack>
        <Text type="supporting">{thread.trigger.source} · <Timestamp value={thread.trigger.at} format="time" hasTooltip={false} /></Text>
      </HStack>
      {thread.kind === 'pushed' && <>
        <Heading level={3} accessibilityLevel={4} weight="medium">{lead}</Heading>
        {rest && <Text as="p" color="secondary">{rest}</Text>}
      </>}
      {thread.proposals.length > 0 && thread.week && (compact
        ? <CheckboxList label="Förslag" isLabelHidden value={selected} onChange={setSelected} isReadOnly={!open} density="compact">
          {thread.proposals.filter(p => p.status !== 'declined').map(p => <CheckboxListItem key={p.id} value={p.id} label={<Text>{`${p.participant.name} · ${shortDayLabel(p.start.slice(0, 10))} ${timeRange(p.start, p.end)}`}</Text>} isChecked={p.status !== 'proposed' || selected.includes(p.id)} isDisabled={p.status !== 'proposed'} />)}
        </CheckboxList>
        : <WeekAgenda week={thread.week} days={5} items={items} dayHeadingLevel={5} label={`Vecka ${weekNumber(thread.week)} med förslagen`} />)}
      {conversation.length > 0 && <Conversation messages={conversation} />}
      {error && <Text as="p" role="alert" color="accent">{error}</Text>}
      {(open || undoOpen) && <HStack gap={2} wrap="wrap">
        {open && <Button variant="primary" label={`Skicka ${count} ${plural}`} isDisabled={!count} clickAction={() => run(() => api.confirm(thread.id, selected))} />}
        {open && !compact && <Button label="Justera i kalendern" href={`/kalender?vecka=${thread.week}`} />}
        {open && compact && <Button label="Visa i veckan" href={`/kalender?vecka=${thread.week}`} />}
        {open && nextWeek && <Button label={`Vecka ${weekNumber(nextWeek)} i stället`} clickAction={() => run(() => api.replan(thread.id, nextWeek))} />}
        {open && <Button variant="ghost" label={inConversation ? 'I samtalet ✓' : 'Lägg till i samtalet'} isDisabled={inConversation} onClick={() => talk.addChip({ ref: chipRef, kind: 'thread', label: thread.title, threadId: thread.id })} />}
        {open && <Button variant="ghost" label="Inte nu" clickAction={() => run(async () => { const t = await api.snooze(thread.id); leave(t, 'Tas upp i morgon 06:00 i stället.'); return t; })} />}
        {open && <MoreMenu label="Fler val" size="sm" variant="ghost" items={[
          { id: 'dismiss', label: 'Avfärda · inte aktuellt', onClick: () => void run(async () => { const t = await api.dismiss(thread.id); leave(t, 'Avfärdad som inte aktuellt. Förslagen ligger kvar under Redan hanterat i tio minuter.'); return t; }) },
          { id: 'why', label: 'Varför ser jag detta?', onClick: () => setWhy(v => !v) },
        ]} />}
        {undoOpen && undoUntil && <Button variant="destructive" label={`Ångra allt · ${Math.max(0, Math.ceil((Date.parse(undoUntil) - now) / 60000))} min kvar`} clickAction={() => run(() => api.undo(thread.id))} />}
      </HStack>}
      {draft && open && <Text type="supporting" as="p">Utkast från samtalet. Inget är skickat förrän du trycker på knappen här.</Text>}
      {thread.kind === 'pushed' && (why || !open) && <Text type="supporting" as="p">Varför nu? {thread.trigger.reason}. {open ? 'Skickas via kalendern med möjlighet att ångra i 10 minuter.' : ''}</Text>}
    </VStack>
  </Card>;
}
