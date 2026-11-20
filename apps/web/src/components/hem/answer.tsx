import { useMemo, type ReactNode, type RefObject } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Thread, ViewRef } from '@clew/contracts';
import {
  Button,
  Card,
  ChatMessage,
  ChatMessageList,
  Heading,
  HStack,
  StackItem,
  Text,
  VisuallyHidden,
  VStack,
} from '@clew/ui';
import { areasQuery, threadQuery } from '../../queries';
import { answerEyebrow, namedItems, newestExchange } from '../../start-answer';
import { declaredPage, viewPageHref } from '../../view-address';
import { titled, useConversation } from '../conversation/conversation-context';
import { AfterTheTurns, AssistantTurn } from '../conversation/conversation';
import { AssistantMark } from '../shell/page-frame';

/** The card's heading, which names the card as a region. */
const TITLE_ID = 'answer-title';
/** Hem's address, the way back from a view the answer leads to (D116). */
const HEM = '/';

/** A work item the answer names, from Hem's own list when it is there, else read as every screen reads it (D33). */
function NamedItem({
  id,
  listed,
  row,
}: {
  id: string;
  listed: Thread | undefined;
  row: (thread: Thread) => ReactNode;
}) {
  const read = useQuery({ ...threadQuery(id), enabled: !listed });
  const thread = listed ?? read.data;
  return thread ? <VStack role="listitem">{row(thread)}</VStack> : null;
}

/**
 * The answer under Hem's line (D133 items 2 and 9, board Start variant b): one card directly under the line, with the
 * board below it. The line is the box: a question asked there is answered here and nothing navigates
 * (`AskFrom.inPlace`). The card shows the conversation's newest exchange: what it read in the line over the question,
 * the question as its heading, the answer, the work items the answer names as the rows "Behöver dig" has (`row`, the
 * board's own), and "Öppna som samtal" and "Stäng". The earlier exchanges are in the conversation, which "Öppna som
 * samtal" opens on its page whole and which is found under Samtal as any other.
 *
 * The answer is drawn with the transcript's own parts, as the pane beside a page draws it (`AssistantTurn`,
 * `AfterTheTurns`, room `pane`), so it reads as it does in a conversation: while it is on its way the reads as calls
 * with their status and time and the answer's place held, then its text as it is written; once written, the reads it
 * made, its words with the sources it cites as numbered citations, a prepared decision's row, an action it filled in as
 * the row "Ifyllt åt dig" with "Granska och skicka", the work items it names, and one row "Visa i samtalet" for a view,
 * the sources or a proposals' week, which need the conversation's page; then Clew's own actions to confirm and what was
 * done. The card is the answer's frame, so the parts stand without the transcript's bubbles (`bare`).
 *
 * The answer stands in a chat log, as in the transcript, one message from the question's sending to its written answer,
 * so a screen reader hears it once, when it is written (4.1.3). "Stäng" takes the card away and leaves the conversation
 * where it is; a turn still running is stopped and its question goes back in the line, as closing a conversation does.
 * The focus goes to the line (2.4.3). "Öppna som samtal" waits for the answer, as the pane's does: the conversation has
 * no page before the answer has come back.
 */
export function HemAnswer({
  field,
  threads,
  row,
}: {
  /** Hem's line, where the focus goes when the card closes. */
  field: RefObject<HTMLInputElement | null>;
  /** Hem's work items, so a row the answer names is the row already read. */
  threads: readonly Thread[];
  /** A work item as a row of "Behöver dig". */
  row: (thread: Thread) => ReactNode;
}) {
  const talk = useConversation();
  const { conversation, pending, latest, busy } = talk;
  const views = useQuery(areasQuery).data?.views;
  const exchange = useMemo(() => (conversation ? newestExchange(conversation.messages) : null), [conversation]);
  if (!talk.inPlace) return null;
  const question = pending?.text ?? exchange?.question.body;
  if (!question) return null;
  const answer = pending ? null : (exchange?.answer ?? null);
  const titleOf = (capability: string) => views?.find(v => v.capability === capability)?.title;
  // A proposal answer names the item it made in the turn's response only (`forslag`): the newest answer's, when it is.
  const proposals =
    answer && latest?.conversationId === conversation?.id && latest?.thread.messages.at(-1)?.id === answer.id
      ? latest.forslag?.threadId
      : undefined;
  const items = answer ? namedItems(answer.meta, proposals) : [];
  const whole = conversation ? `/conversations/${conversation.id}` : undefined;
  // A view the answer names leads to its own page, with Hem as the way back, as Hem's own views do (D126 rule 1).
  const viewHref = (v: ViewRef) => declaredPage(views, v.capability, v.input) ?? viewPageHref(v, HEM);
  const close = () => {
    talk.closeInPlace();
    field.current?.focus();
  };
  // The chat log insets its message by 12 px at the sides and 8 px over and under, so the card's inset of 24 px is split:
  // 12 px the card's, 12 px more the header's and the stack's, and the heading and the answer start on one line, as drawn.
  return (
    <Card padding={3}>
      <VStack gap={3} paddingBlockStart={3} paddingBlockEnd={1} as="section" aria-labelledby={TITLE_ID}>
        <HStack justify="between" vAlign="center" gap={3} wrap="wrap" paddingInline={3}>
          <HStack gap={3} vAlign="center">
            {/* Its natural size, so a question that wraps at 320 px never squeezes the round mark (1.4.10). */}
            <StackItem>
              <AssistantMark />
            </StackItem>
            <StackItem size="fill">
              <VStack gap={0}>
                <Text type="eyebrow">{answerEyebrow(answer, titleOf)}</Text>
                <Heading level={2} id={TITLE_ID}>
                  {titled(question)}
                </Heading>
              </VStack>
            </StackItem>
          </HStack>
          <HStack gap={2} vAlign="center" wrap="wrap">
            {!pending && whole && <Button size="sm" variant="secondary" label="Öppna som samtal" href={whole} />}
            <Button size="sm" variant="ghost" label="Stäng" onClick={close} />
          </HStack>
        </HStack>
        {/* One message in the log, the same element from the question's sending to its written answer, so the answer
            on its way becomes the written one in place and the log speaks it once (D36). */}
        <ChatMessageList density="compact" align="top" isStreaming={busy}>
          <ChatMessage sender="assistant" name={<VisuallyHidden>Assistenten</VisuallyHidden>}>
            {/* The message's own content is as wide as what it holds; the answer's place takes the card's width. */}
            <VStack gap={4} width="100%">
              <AssistantTurn
                pending={pending}
                message={answer}
                room="pane"
                bare
                headingStart={3}
                latest
                items={
                  items.length > 0 ? (
                    <VStack gap={2} role="list" aria-label="Ärenden i svaret">
                      {items.map(id => (
                        <NamedItem key={id} id={id} listed={threads.find(t => t.id === id)} row={row} />
                      ))}
                    </VStack>
                  ) : null
                }
                wholeHref={whole}
                viewHref={viewHref}
              />
            </VStack>
          </ChatMessage>
          <AfterTheTurns room="pane" bare wholeHref={whole} />
        </ChatMessageList>
      </VStack>
    </Card>
  );
}
