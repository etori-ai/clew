import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { handoversOf, type ThreadMessage } from '@clew/contracts';
import { useNavigate } from 'react-router';
import {
  AreaChip,
  Badge,
  Button,
  ChatComposer,
  ChatComposerInput,
  ChatLayout,
  type ChatComposerInputHandle,
  ChatMessage,
  ChatMessageBubble,
  ChatMessageList,
  ChatMessageMetadata,
  Divider,
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  EmptyState,
  Heading,
  HStack,
  Icon,
  IconButton,
  Link,
  Markdown,
  Skeleton,
  StackItem,
  Text,
  Timestamp,
  VStack,
  VisuallyHidden,
  XMarkIcon,
} from '@clew/ui';
import { handoverAssistantsQuery } from '../../queries';
import { useMarks } from '../../marks';
import { sideMessages } from '../../conversation-about';
import { DOT } from '../../dot';
import { useConversation } from './conversation-context';
import { AssistantMark, StreamingAnswer, keepLines } from './conversation';

/**
 * The way to any assistant of another system from a conversation, in the page's header and always there: the ones this
 * conversation already has an exchange with first, each with how much was asked of it, then every other assistant the
 * person may ask. Picking one puts its exchange beside the transcript, where its own box is. The box under the
 * transcript takes no `@` or `/` for an assistant: it only ever goes to Clew. Nothing is drawn for a person with no
 * assistant to ask.
 */
export function AssistantsMenu({ open, hrefFor }: { open: string | null; hrefFor: (assistant: string) => string }) {
  const talk = useConversation();
  const navigate = useNavigate();
  const listed = useQuery(handoverAssistantsQuery).data ?? [];
  const here = handoversOf(talk.conversation?.handover);
  if (listed.length === 0 && here.length === 0) return null;
  const all = talk.conversation?.messages ?? [];
  const more = listed.filter(a => !here.some(h => h.assistant === a.id));
  const asked = (assistant: string) => {
    const n = sideMessages(all, assistant).filter(m => m.role === 'user').length;
    return n === 0 ? '' : `${DOT}${n === 1 ? '1 fråga' : `${n} frågor`}`;
  };
  const pick = (assistant: string) => navigate(hrefFor(assistant));
  return (
    <DropdownMenu
      button={{
        // The name holds the words on the button (2.5.3), the count of those in this conversation with them.
        // "Andra": the conversation's own assistant is called assistenten, and these are other systems'.
        label: here.length > 0 ? `Andra assistenter${DOT}${here.length}` : 'Andra assistenter',
        children: here.length > 0 ? `Andra assistenter${DOT}${here.length}` : 'Andra assistenter',
        variant: 'secondary',
        size: 'sm',
      }}
      menuWidth={360}
      menuMaxHeight={460}
    >
      {here.length > 0 && (
        <DropdownMenuGroup title="I det här samtalet">
          <DropdownMenuRadioGroup label="Assistenter i det här samtalet" value={open ?? undefined} onChange={pick}>
            {here.map(h => (
              <DropdownMenuRadioItem
                key={h.assistant}
                value={h.assistant}
                label={h.name}
                description={`${h.source}${asked(h.assistant)}`}
              />
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      )}
      {more.length > 0 && (
        <DropdownMenuGroup title={here.length > 0 ? 'Fler du kan fråga' : 'Du kan fråga'}>
          <DropdownMenuRadioGroup label="Assistenter du kan fråga" value={open ?? undefined} onChange={pick}>
            {more.map(a => (
              <DropdownMenuRadioItem
                key={a.id}
                value={a.id}
                label={a.name}
                description={a.description ? `${a.source}${DOT}${a.description}` : a.source}
              />
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      )}
    </DropdownMenu>
  );
}

/**
 * Another system's assistant beside the conversation (the product owner, 2026-11-16): the transcript and the box under
 * it are Clew's, always, and an assistant of another system is talked to here, in a panel of its own with a box of its
 * own. Where a message goes is which box it is typed in. The panel draws that assistant's whole exchange in this
 * conversation: the question Clew sent on, on the person's yes, and everything asked here since. What is typed here
 * goes to that system, unchanged and alone (D125 item 4). Nothing goes from here to Clew: an assistant does not hand a
 * question back, and a question for Clew is typed in Clew's box. The whole assistant, with its files
 * and its own history, is in its own system: the header links there.
 */
export function AssistantPane({
  assistant,
  onClose,
  onKeyDown,
  tools,
}: {
  assistant: string;
  onClose: () => void;
  onKeyDown?: (e: KeyboardEvent) => void;
  /** What stands before ✕ in the header: the menu over what the conversation has named. */
  tools?: ReactNode;
}) {
  const talk = useConversation();
  const marks = useMarks();
  const listed = useQuery(handoverAssistantsQuery).data;
  const [value, setValue] = useState('');
  // Opening the panel is the person turning to this assistant: its box takes the focus, as a dialog's first field does.
  const field = useRef<ChatComposerInputHandle>(null);
  // Also once the conversation is read from its address, since the page gives the focus to Clew's box when it has, and
  // once the assistant is known: until the list of assistants is read the panel has no field to focus, and a person
  // who then typed would be writing to Clew.
  const conversationId = talk.conversation?.id;
  const known = !!talk.conversation?.handover || !!listed;
  useEffect(() => {
    const frame = requestAnimationFrame(() => field.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [assistant, conversationId, known]);
  // A question Clew held on its way out waits for the person's choice: the safe answer takes the focus (D125 item 13).
  const stay = useRef<HTMLButtonElement>(null);
  const isHeld = talk.aside?.assistant === assistant && !!talk.aside.held;
  useEffect(() => {
    if (isHeld) stay.current?.focus();
  }, [isHeld]);
  const kept = handoversOf(talk.conversation?.handover).find(h => h.assistant === assistant);
  const found = listed?.find(a => a.id === assistant);
  const who = kept
    ? { id: assistant, name: kept.name, source: kept.source, description: found?.description }
    : found
      ? { id: assistant, name: found.name, source: found.source, description: found.description }
      : undefined;
  // What stands before ✕ (the menu over what the conversation has named) keeps its place beside it in every state.
  const close = (
    <HStack gap={1} vAlign="center">
      {tools}
      <IconButton label="Stäng" variant="ghost" icon={<Icon icon={XMarkIcon} size="sm" />} onClick={onClose} />
    </HStack>
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
    // No answer: the system did not answer, or the assistant wrote nothing; said in Clew's words, never in its name.
    if (meta?.failed || meta?.declined)
      return (
        <ChatMessage key={`side-${i}`} sender="assistant" name={<VisuallyHidden>Assistenten</VisuallyHidden>}>
          <ChatMessageBubble variant="ghost" width="100%" metadata={time(m.createdAt)}>
            <VStack gap={3}>
              <HStack gap={1} vAlign="center">
                <Icon icon="warning" size="sm" color="warning" />
                <Text>{m.body || `${who.name} svarade inte på frågan.`}</Text>
              </HStack>
            </VStack>
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
            {meta?.cut && <Text type="supporting">Svaret var längre än det som visas här.</Text>}
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
            {/* What leaves Clew (D125 item 4), said once at the head of the panel so that the box itself stays low. */}
            <Text type="supporting" color="secondary">
              {`Det du skriver här skickas till ${who.source}. Inget annat ur samtalet följer med.`}
            </Text>
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
      {/* The exchange takes what the head leaves, so the box stays docked at the panel's foot. */}
      <StackItem size="fill">
        <VStack height="100%">
          <ChatLayout
            composer={
              <ChatComposer
                density="compact"
                value={value}
                onChange={setValue}
                isDisabled={busy}
                input={
                  <ChatComposerInput
                    handleRef={field}
                    label={`Skriv till ${who.name} i ${who.source}`}
                    maxRows={3}
                    hasHistory={false}
                    placeholder={`Skriv till ${who.name} i ${who.source}`}
                  />
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
                    ? asked(
                        `side-${i}`,
                        m.body,
                        m.createdAt,
                        m.meta?.handed?.side ? undefined : 'Från samtalet med assistenten',
                      )
                    : answered(m, i),
                ),
                ...(pending
                  ? [
                      asked(`side-${n}`, pending.text, pending.at),
                      <ChatMessage
                        key={`side-${n + 1}`}
                        sender="assistant"
                        name={pending.held ? <VisuallyHidden>Assistenten</VisuallyHidden> : theirs}
                      >
                        <ChatMessageBubble variant="ghost" width="100%">
                          {pending.held ? (
                            <VStack gap={3}>
                              <HStack gap={2} vAlign="center" wrap="wrap">
                                <Badge
                                  variant="warning"
                                  icon={<Icon icon="warning" size="sm" />}
                                  label="Inte skickad"
                                />
                                <Text>
                                  {`Frågan ser ut att gälla ${pending.held === 'person' ? 'din personal' : 'ett av dina ärenden'}. Skickar du den hamnar den i ${who.source}.`}
                                </Text>
                              </HStack>
                              <HStack gap={2} wrap="wrap">
                                <Button
                                  ref={stay}
                                  size="sm"
                                  variant="primary"
                                  label="Låt assistenten svara"
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
      </StackItem>
    </VStack>
  );
}
