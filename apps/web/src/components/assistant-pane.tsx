import { useState, type KeyboardEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ThreadMessage } from '@clew/contracts';
import {
  AreaChip,
  Badge,
  Button,
  ChatComposer,
  ChatLayout,
  ChatMessage,
  ChatMessageBubble,
  ChatMessageList,
  ChatMessageMetadata,
  Divider,
  EmptyState,
  Heading,
  HStack,
  Icon,
  IconButton,
  Link,
  Markdown,
  Skeleton,
  Text,
  Timestamp,
  VStack,
  VisuallyHidden,
  XMarkIcon,
} from '@clew/ui';
import { handoverAssistantsQuery } from '../queries';
import { useMarks } from '../marks';
import { sideMessages } from '../conversation-about';
import { useConversation } from './conversation-context';
import { AssistantMark, StreamingAnswer, keepLines } from './conversation';

/**
 * Another system's assistant beside the conversation (the product owner, 2026-11-16): the transcript and the box under
 * it are Clew's, always, and an assistant of another system is talked to here, in a panel of its own with a box of its
 * own. Where a message goes is which box it is typed in. The panel draws that assistant's whole exchange in this
 * conversation: the question Clew sent on, on the person's yes, and everything asked here since. What is typed here
 * goes to that system, unchanged and alone (D125 item 4). An assistant that does not take a question says so here and
 * the person may put it to Clew, by their own press; nothing is routed for them. The whole assistant, with its files
 * and its own history, is in its own system: the header links there.
 */
export function AssistantPane({
  assistant,
  onClose,
  onKeyDown,
}: {
  assistant: string;
  onClose: () => void;
  onKeyDown?: (e: KeyboardEvent) => void;
}) {
  const talk = useConversation();
  const marks = useMarks();
  const listed = useQuery(handoverAssistantsQuery).data;
  const [value, setValue] = useState('');
  const kept = talk.conversation?.handover?.assistant === assistant ? talk.conversation.handover : undefined;
  const found = listed?.find(a => a.id === assistant);
  const who = kept
    ? { id: assistant, name: kept.name, source: kept.source, description: found?.description }
    : found
      ? { id: assistant, name: found.name, source: found.source, description: found.description }
      : undefined;
  const close = (
    <IconButton label="Stäng" variant="ghost" icon={<Icon icon={XMarkIcon} size="sm" />} onClick={onClose} />
  );
  if (!who)
    return (
      <VStack gap={0} height="100%" onKeyDown={onKeyDown}>
        <HStack hAlign="end" padding={4}>
          {close}
        </HStack>
        {listed ? (
          <EmptyState title="Assistenten finns inte" description="Den går inte att fråga härifrån längre." />
        ) : (
          <VStack gap={2} padding={4}>
            <VisuallyHidden role="status">Hämtar assistenten …</VisuallyHidden>
            <Skeleton width="60%" height={14} />
            <Skeleton width="40%" height={14} index={1} />
          </VStack>
        )}
      </VStack>
    );
  const all = talk.conversation?.messages ?? [];
  const messages = sideMessages(all, assistant);
  const pending = talk.aside?.assistant === assistant ? talk.aside : null;
  const busy = talk.busy || (!!pending && !pending.held);
  // A question this assistant could not answer, already put to Clew by the person.
  const passed = (question: string) =>
    all.some(m => m.role === 'user' && m.meta?.handed?.fromSide && m.body === question) ||
    talk.pending?.text === question;
  const time = (at: string, footer?: string) => (
    <ChatMessageMetadata
      timestamp={<Timestamp value={at} format="time" hasTooltip={false} />}
      {...(footer ? { footer } : {})}
    />
  );
  const asked = (key: string, body: string, at: string, footer?: string) => (
    <ChatMessage key={key} sender="user" name={<VisuallyHidden>Du</VisuallyHidden>}>
      <ChatMessageBubble variant="filled" metadata={time(at, footer)}>
        {body}
      </ChatMessageBubble>
    </ChatMessage>
  );
  const theirs = <VisuallyHidden>{who.name}</VisuallyHidden>;
  const answered = (m: ThreadMessage, i: number) => {
    const meta = m.meta?.handover;
    const question = [...messages.slice(0, i)].reverse().find(x => x.role === 'user')?.body ?? '';
    if (meta?.declined)
      return (
        <ChatMessage key={`side-${i}`} sender="assistant" name={theirs}>
          <ChatMessageBubble variant="ghost" width="100%">
            <VStack gap={3}>
              <Text>{`${who.name} kan inte svara på den här frågan.`}</Text>
              <HStack gap={2} vAlign="center" wrap="wrap">
                <Button
                  size="sm"
                  variant="primary"
                  label="Fråga Clew i stället"
                  isDisabled={talk.busy || passed(question)}
                  onClick={() => talk.askClew(question, assistant)}
                />
                {passed(question) && <Text type="supporting">Frågan står nu i samtalet med Clew</Text>}
              </HStack>
            </VStack>
          </ChatMessageBubble>
        </ChatMessage>
      );
    if (meta?.failed)
      return (
        <ChatMessage key={`side-${i}`} sender="assistant" name={<VisuallyHidden>Clew</VisuallyHidden>}>
          <ChatMessageBubble variant="ghost" width="100%" metadata={time(m.createdAt)}>
            <HStack gap={1} vAlign="center">
              <Icon icon="warning" size="sm" color="warning" />
              <Text>{m.body}</Text>
            </HStack>
          </ChatMessageBubble>
        </ChatMessage>
      );
    const cites = meta?.cites ?? [];
    return (
      <ChatMessage key={`side-${i}`} sender="assistant" name={theirs}>
        <ChatMessageBubble variant="ghost" width="100%" metadata={time(m.createdAt)}>
          <VStack gap={3}>
            <Markdown density="compact" headingLevelStart={3}>
              {keepLines(m.body)}
            </Markdown>
            {cites.length > 0 && (
              <HStack gap={2} wrap="wrap">
                <Text type="supporting">{cites.length === 1 ? 'Källa' : 'Källor'}</Text>
                {cites.map((c, n) =>
                  c.link ? (
                    <Link key={n} href={c.link} target="_blank" rel="noreferrer">
                      {c.label}
                    </Link>
                  ) : (
                    <Text key={n} type="supporting">
                      {c.label}
                    </Text>
                  ),
                )}
              </HStack>
            )}
            {meta?.cut && <Text type="supporting">Svaret var längre än Clew visar.</Text>}
          </VStack>
        </ChatMessageBubble>
      </ChatMessage>
    );
  };
  const n = messages.length;
  return (
    <VStack gap={0} height="100%" onKeyDown={onKeyDown}>
      <HStack hAlign="between" vAlign="center" gap={3} padding={4}>
        <HStack gap={2} vAlign="center">
          <AssistantMark name={who.name} />
          <VStack gap={0.5}>
            <HStack gap={2} vAlign="center" wrap="wrap">
              <Heading level={2}>{who.name}</Heading>
              <AreaChip
                ordinal={marks.system(assistant.slice(0, assistant.indexOf(':')))?.ordinal ?? null}
                label={who.source}
              />
            </HStack>
            {who.description && (
              <Text type="supporting" color="secondary">
                {who.description}
              </Text>
            )}
          </VStack>
        </HStack>
        <HStack gap={2} vAlign="center">
          {kept?.link && (
            <Link href={kept.link} target="_blank" rel="noreferrer">
              {`Öppna i ${who.source}`}
            </Link>
          )}
          {close}
        </HStack>
      </HStack>
      <Divider />
      <VStack height="100%">
        <ChatLayout
          composer={
            <ChatComposer
              density="compact"
              value={value}
              onChange={setValue}
              isDisabled={busy}
              placeholder={`Skriv till ${who.name}`}
              headerContext={
                <Text type="supporting" color="secondary">
                  {`Skickas till ${who.source}. Inget annat ur samtalet följer med.`}
                </Text>
              }
              onSubmit={text => {
                const sent = text;
                setValue('');
                void talk.askAside(who, sent).then(ok => {
                  if (!ok) setValue(v => v || sent);
                });
              }}
              {...(talk.asideError ? { status: { type: 'error' as const, message: talk.asideError } } : {})}
            />
          }
        >
          <ChatMessageList density="compact" align="bottom" isStreaming={!!pending && !pending.held}>
            {[
              ...messages.map((m, i) =>
                m.role === 'user'
                  ? asked(`side-${i}`, m.body, m.createdAt, m.meta?.handed?.side ? undefined : 'Från samtalet med Clew')
                  : answered(m, i),
              ),
              ...(pending
                ? [
                    asked(`side-${n}`, pending.text, pending.at),
                    <ChatMessage
                      key={`side-${n + 1}`}
                      sender="assistant"
                      name={pending.held ? <VisuallyHidden>Clew</VisuallyHidden> : theirs}
                    >
                      <ChatMessageBubble variant="ghost" width="100%">
                        {pending.held ? (
                          <VStack gap={3}>
                            <HStack gap={2} vAlign="center" wrap="wrap">
                              <Badge variant="warning" icon={<Icon icon="warning" size="sm" />} label="Inte skickad" />
                              <Text>
                                {`Frågan ser ut att gälla ${pending.held === 'person' ? 'din personal' : 'ett av dina ärenden'}. Skickar du den lämnar den Clew och hamnar i ${who.source}.`}
                              </Text>
                            </HStack>
                            <HStack gap={2} wrap="wrap">
                              <Button
                                size="sm"
                                variant="primary"
                                label="Låt Clew svara"
                                onClick={() => talk.askClew(pending.text)}
                              />
                              <Button
                                size="sm"
                                label={`Skicka till ${who.name} ändå`}
                                onClick={() => void talk.askAside(who, pending.text, true)}
                              />
                            </HStack>
                          </VStack>
                        ) : pending.answer ? (
                          <StreamingAnswer text={keepLines(pending.answer)} />
                        ) : (
                          <VStack gap={2}>
                            <Skeleton width={220} height={14} />
                            <Skeleton width={150} height={14} index={1} />
                          </VStack>
                        )}
                      </ChatMessageBubble>
                    </ChatMessage>,
                  ]
                : []),
            ]}
          </ChatMessageList>
        </ChatLayout>
      </VStack>
    </VStack>
  );
}
