import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { handoversOf, type ThreadMessage } from '@clew/contracts';
import { useNavigate } from 'react-router';
import {
  AreaChip,
  ChatLayout,
  type ChatComposerInputHandle,
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
  Skeleton,
  StackItem,
  Text,
  VStack,
  VisuallyHidden,
  XMarkIcon,
} from '@clew/ui';
import { handoverAssistantsQuery } from '../../queries';
import { useMarks } from '../../marks';
import { sideMessages } from '../../conversation-about';
import { DOT } from '../../dot';
import { Composer } from './composer';
import {
  ConversationContext,
  INERT_CONVERSATION,
  useConversation,
  type ConversationState,
  type PendingTurn,
} from './conversation-context';
import { AssistantMark, Transcript } from './conversation';

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
 *
 * Under the header the exchange and its box are the conversation's own parts (D130, "One component"): `Transcript` in
 * the panel's room and the plain box of a pane, read from a second provider of the conversation context whose state is
 * this assistant's side of the conversation. Its messages are that assistant's exchange, its turn on the way is the
 * panel's question, and its box sends to that assistant alone; the one way from it to Clew's own turn is "Låt
 * assistenten svara" under a question Clew held.
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
  const field = useRef<ChatComposerInputHandle | null>(null);
  // Also once the conversation is read from its address, since the page gives the focus to Clew's box when it has, and
  // once the assistant is known: until the list of assistants is read the panel has no field to focus, and a person
  // who then typed would be writing to Clew.
  const conversationId = talk.conversation?.id;
  const known = !!talk.conversation?.handover || !!listed;
  useEffect(() => {
    const frame = requestAnimationFrame(() => field.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [assistant, conversationId, known]);
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
  const handed = { id: assistant, name: who.name, source: who.source };
  const turn = talk.aside?.assistant === assistant ? talk.aside : null;
  // The panel's question on its way, as the transcript draws a turn: to this assistant, or held by Clew before it left
  // (D125 item 13), which is drawn as Clew's choice with the safe answer first and taking the focus.
  const pending: PendingTurn | null = turn && {
    text: turn.text,
    at: turn.at,
    chips: [],
    steps: [],
    answer: turn.answer,
    ...(turn.held ? { offer: handed, held: turn.held } : { handed }),
  };
  const exchange: ConversationState = {
    ...INERT_CONVERSATION,
    conversation: talk.conversation && {
      ...talk.conversation,
      messages: sideMessages(all, assistant).map(asWrittenNow),
    },
    pending,
    // The box rests while this assistant's turn or Clew's runs: each waits for the other (D128).
    busy: talk.busy || (!!turn && !turn.held),
    error: talk.asideError,
    value,
    setValue,
    input: field,
    // What is typed goes to this assistant unchanged and alone (D125 item 4); one that could not be sent comes back.
    submit: async raw => {
      setValue('');
      if (!(await talk.askAside(handed, raw))) setValue(v => v || raw);
    },
    focus: () => field.current?.focus(),
    // The two answers to a question Clew held: Clew answers it, or it is sent anyway, as the person's own choice.
    declineOffer: () => {
      if (turn) talk.askClew(turn.text);
    },
    acceptOffer: () => {
      if (turn) void talk.askAside(handed, turn.text, true);
    },
  };
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
          <ConversationContext.Provider value={exchange}>
            <ChatLayout
              composer={
                <Composer place="pane" placeholder={`Skriv till ${who.name} i ${who.source}`} stoppable={false} />
              }
            >
              <Transcript room="aside" renderCard={() => null} onOpenView={() => undefined} />
            </ChatLayout>
          </ConversationContext.Provider>
        </VStack>
      </StackItem>
    </VStack>
  );
}

/**
 * An answer an assistant declined without a word, as it was kept before 2026-11-16 (`handover.declined`, no body), as
 * the server writes one now (D128 item 7): not answered, said in Clew's words.
 */
function asWrittenNow(m: ThreadMessage): ThreadMessage {
  const handover = m.meta?.handover;
  if (!handover?.declined) return m;
  return {
    ...m,
    body: m.body || `${handover.name} svarade inte på frågan.`,
    meta: { ...m.meta, handover: { ...handover, failed: true } },
  };
}
