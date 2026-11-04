import { useEffect, useState } from 'react';
import type { CalendarEvent, Thread, ViewRef } from '@clew/contracts';
import { Badge, Button, ChatMessage, ChatMessageBubble, ChatMessageList, ChatMessageMetadata, ChatSystemMessage, EventList, HStack, Icon, List, ListItem, Markdown, Text, Timestamp, Token, VisuallyHidden, VStack, agendaItems } from '@clew/ui';
import { weekNumber } from '@clew/calendar/dates';
import { api } from '../api';
import { useConversation } from './conversation-context';

/** The proposals' week in the transcript (D32): the week's meetings with the drawn times among them, as a list in a ghost bubble, after the `ai-chat` template's card-in-a-bubble. */
function ProposalWeek({ thread }: { thread: Thread }) {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  useEffect(() => { if (!thread.week) return; let alive = true; void api.calendar(thread.week).then(d => { if (alive) setEvents(d.events); }).catch(() => undefined); return () => { alive = false; }; }, [thread.week]);
  if (!thread.week) return null;
  return <ChatMessage sender="assistant" name={<VisuallyHidden>Assistenten</VisuallyHidden>}>
    <ChatMessageBubble variant="ghost" width="100%">
      <EventList from={thread.week} items={agendaItems(events, thread.proposals)} dayHeadingLevel={3} label={`Vecka ${weekNumber(thread.week)} med förslagen`} accessiblePath="Förslagen bekräftas i kortet." />
    </ChatMessageBubble>
  </ChatMessage>;
}

/**
 * The transcript (D31): the conversation in page flow in place of the stream, as the `ai-chat` template draws it. The
 * person's chips sit above their bubble as tokens, the assistant answers in Markdown, a proposal to confirm is plain
 * content in a ghost bubble (one warning badge, the rows, two buttons), and what was done is a system message with Ångra.
 */
export function Transcript({ onOpenView }: { onOpenView: (view: ViewRef) => void }) {
  const talk = useConversation();
  const { conversation, latest, done, busy } = talk;
  // A proposal answer names its thread; the draft carries it. Either way the week is drawn under the answer.
  const [forslag, setForslag] = useState<Thread | null>(null);
  const forslagId = latest?.forslag?.threadId ?? null;
  useEffect(() => { if (!forslagId) { setForslag(null); return; } let alive = true; void api.thread(forslagId).then(t => { if (alive) setForslag(t); }).catch(() => undefined); return () => { alive = false; }; }, [forslagId, latest]);
  const weekThread = latest?.draft?.thread ?? forslag;
  if (!conversation) return null;
  return <VStack gap={3}>
    <ChatMessageList density="balanced" align="bottom" isStreaming={busy}>
      {conversation.messages.map(m => <ChatMessage key={m.id} sender={m.role} name={<VisuallyHidden>{m.role === 'user' ? 'Du' : 'Assistenten'}</VisuallyHidden>}>
        {m.role === 'user' && (m.meta?.chips?.length ?? 0) > 0 && <HStack gap={1} wrap="wrap">{m.meta!.chips!.map(c => <Token key={c.ref} size="sm" label={c.label} />)}</HStack>}
        <ChatMessageBubble variant={m.role === 'assistant' ? 'ghost' : 'filled'} width={m.role === 'assistant' ? '100%' : undefined}
          metadata={<ChatMessageMetadata timestamp={<Timestamp value={m.createdAt} format="time" hasTooltip={false} />} footer={m.role === 'assistant' ? (m.meta?.source ?? undefined) : undefined} />}>
          {m.role === 'assistant' ? <Markdown density="compact" headingLevelStart={2}>{m.body}</Markdown> : m.body}
          {m.meta?.view && <HStack gap={2}><Button size="sm" label={`Visa ${m.meta.view.title.toLowerCase()}`} onClick={() => onOpenView(m.meta!.view!)} /></HStack>}
        </ChatMessageBubble>
        {m.meta?.draft && <ChatSystemMessage icon={<Icon icon="warning" color="warning" size="sm" />}>Utkast i kortet. Inget är skickat förrän du trycker på knappen i kortet.</ChatSystemMessage>}
      </ChatMessage>)}
      {weekThread && weekThread.proposals.some(p => p.status === 'proposed') && <ProposalWeek thread={weekThread} />}
      {latest && latest.clewActions.length > 0 && <ChatMessage sender="assistant" name={<VisuallyHidden>Assistenten</VisuallyHidden>}>
        {/* A proposal waits for a decision: the same "att bekräfta" as a draft on a card, nothing is done until the black button. */}
        <ChatMessageBubble variant="ghost" width="100%">
          <VStack gap={2}>
            <HStack gap={2} vAlign="center" wrap="wrap">
              <Badge variant="warning" icon={<Icon icon="warning" size="sm" />} label="Att bekräfta" />
              <Text type="supporting">Inget görs förrän du trycker. Ångra i 10 min efteråt.</Text>
            </HStack>
            <List density="compact" listStyle="decimal" aria-label="Att bekräfta">{latest.clewActions.map(a => <ListItem key={a.n} label={<Text>{a.label}</Text>} description={<Text type="supporting">{a.kind === 'dismiss' ? 'Kortet avfärdas och hamnar under Redan hanterat' : 'Kortet tas upp i morgon 06:00 i stället'}</Text>} />)}</List>
            <HStack gap={2} wrap="wrap">
              <Button size="sm" variant="primary" label={latest.clewActions.length === 1 ? 'Gör det' : 'Gör båda'} isDisabled={busy} clickAction={() => talk.performActions(latest.clewActions)} />
              <Button size="sm" variant="ghost" label="Avbryt" onClick={talk.cancelActions} />
            </HStack>
          </VStack>
        </ChatMessageBubble>
      </ChatMessage>}
      {done && <ChatSystemMessage icon={<Icon icon="check" size="sm" color="success" />}>{done.text}{done.undo && <> <Button size="sm" variant="ghost" label="Ångra" clickAction={done.undo} /></>}</ChatSystemMessage>}
    </ChatMessageList>
    {latest && latest.followUps.length > 0 && <HStack gap={1} wrap="wrap" role="group" aria-label="Följdfrågor">{latest.followUps.map(f => <Button key={f} size="sm" variant="secondary" label={f} isDisabled={busy} onClick={() => talk.ask(f)} />)}</HStack>}
    <Text type="supporting" justify="end">{latest?.draft || conversation.messages.some(m => m.meta?.draft) ? 'Esc stänger · kortet behåller utkastet' : 'Esc stänger · samtalet sparas under Redan hanterat'}</Text>
  </VStack>;
}
