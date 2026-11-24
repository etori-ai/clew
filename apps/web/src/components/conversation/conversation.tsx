import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { stockholmDate, type AskValues } from '@clew/contracts';
import type {
  HandoverAssistant,
  CalendarEvent,
  Draft,
  MessageMeta,
  SourceCitation,
  Thread,
  ThreadMessage,
  TurnStep,
  ViewRef,
} from '@clew/contracts';
import {
  AreaChip,
  AreaGlyph,
  Avatar,
  Badge,
  Button,
  Card,
  Collapsible,
  ChatMessage,
  ChatMessageBubble,
  ChatMessageList,
  ChatMessageMetadata,
  ChatSystemMessage,
  ChatToolCalls,
  EventList,
  HStack,
  Icon,
  Link,
  List,
  ListItem,
  MetadataList,
  MetadataListItem,
  Skeleton,
  StatusDot,
  SparklesIcon,
  Text,
  Timestamp,
  Token,
  UntrustedMarkdown,
  VisuallyHidden,
  VStack,
  agendaItems,
  useAnimatedLayout,
  useEntryAnimation,
  useStreamingText,
  type AnimatedLayout,
  type ChatToolCallItem,
  useMediaQuery,
} from '@clew/ui';
import { mobileQuery } from '../../media';
import { weekNumber } from '@clew/calendar/dates';
import { areasQuery, calendarWeekQuery, entityDetailQuery, threadQuery, viewQuery } from '../../queries';
import { DeclaredView } from '../views/view';
import { useConversation, type ChipRef } from './conversation-context';
import { reviewLabel, staleLabel } from '../views/panel-labels';
import { useMarks, useObjectMark } from '../../marks';
import { FigureLines } from './figure-line';
import { ActionDialog } from '../work/action-dialog';
import { api, ApiError } from '../../api';
import { useDecisionSend } from '../../mutations';
import { valueText, type ActionStep } from '../../action-path';
import { executionStatus } from '../../execution-status';
import { answerCard, figureBelongs, type AnswerCard, type ViewRows } from '../../answer-card';
import { isSide, sentWords, sideCount, suggestedWords } from '../../conversation-about';
import { DOT } from '../../dot';
import { itemPageHref, rowFacts, rowLine } from '../../work-items';
import { isWebAddress } from '../../web-address';

/** An action the assistant filled in (D112 item 8), as the transcript keeps it. */
export type ActionDraftRef = Draft & { kind: 'action'; actionId: string };
const isActionDraft = (draft: Draft | undefined): draft is ActionDraftRef =>
  draft?.kind === 'action' && !!draft.actionId;
/** "Granska och boka" for "Boka samtalet": the action's own first word, as the verb. */
const verbOf = (label: string) => (label.split(' ')[0] ?? label).toLocaleLowerCase('sv-SE');

/**
 * The assistant's draft of an action (D112 item 8, boards Assistant and Calendar): the action's name, an "Utkast"
 * badge, the filled-in values as a short list, and two buttons. "Granska och <verb>" opens the action's own dialog at its
 * last step with these values, "Ändra" at its first; both are the dialog the action's button opens (D112 item 10), on
 * the work item, which sends through the human decision. Nothing is sent from here. The draft reads the work item from
 * the same cache as every screen (D33), so once the person has sent it the draft says what came back, and a newer draft
 * of the same action marks this one as replaced.
 */
function ActionDraftCard({ draft, at, replaced }: { draft: ActionDraftRef; at: string; replaced: boolean }) {
  const item = useQuery(threadQuery(draft.threadId));
  const thread = item.data;
  const action = thread?.actions.find(a => a.id === draft.actionId);
  // The draft opens the action's dialog itself (the product owner, 2026-11-16): the work item is not put beside the
  // transcript for it, where its head, facts and buttons said nothing the draft does not. The dialog and the decision
  // it sends are the same as on the item (`ActionDialog`, `useDecisionSend`); what the person changes in the dialog
  // is kept while the conversation is open.
  // `shown` is the item's version the decision is on (AM-4), as in the item's own dialog (`card.tsx`): the one it had
  // when the dialog opened, and after a refusal the one the dialog draws now.
  const [dialog, setDialog] = useState<{ open: boolean; startAt: ActionStep; shown: string } | null>(null);
  const shownNow = useRef(item.data?.updatedAt);
  shownNow.current = item.data?.updatedAt;
  const [typed, setTyped] = useState<AskValues | null>(null);
  const decision = useDecisionSend();
  if (!thread || !action) return null;
  const asks = action.path?.asks ?? [];
  const values = typed ?? draft.values ?? {};
  const shown = asks.filter(a => values[a.property]);
  // What the person did after the draft was written: the receipt read back, a decision on its way, or the item gone.
  const after = (instant: string | null | undefined) => !!instant && Date.parse(instant) >= Date.parse(at);
  const receipt = thread.receipt && after(thread.receipt.at) ? thread.receipt : null;
  const waiting = !receipt && after(thread.updatedAt) ? executionStatus(thread.execution) : null;
  const state = receipt
    ? { variant: 'success' as const, label: 'Skickat' }
    : waiting
      ? { variant: 'warning' as const, label: 'Skickat, väntar på källan' }
      : replaced
        ? { variant: 'neutral' as const, label: 'Ersatt av ett nyare utkast' }
        : thread.state !== 'open'
          ? { variant: 'neutral' as const, label: 'Ärendet är redan hanterat' }
          : null;
  const superseded = !receipt && !waiting && replaced;
  const open = (startAt: ActionStep) => setDialog({ open: true, startAt, shown: thread.updatedAt });
  const send = async (sent: AskValues): Promise<string | null> => {
    const version = dialog?.shown ?? thread.updatedAt;
    const result = await decision.send(async () => {
      const answer = await api.act({ id: thread.id, updatedAt: version }, action.id, undefined, undefined, sent);
      if (answer.kind !== 'execute') throw new ApiError(500, 'Oväntat svar.');
      setDialog(d => (d ? { ...d, open: false } : d));
      return answer.thread;
    });
    if (result && 'error' in result) {
      setDialog(d => (d ? { ...d, shown: shownNow.current ?? d.shown } : d));
      return result.error;
    }
    return null;
  };
  return (
    <ChatMessageBubble variant="ghost" width="100%">
      <Card padding={4}>
        <VStack gap={3} as="section" aria-label={`Utkast: ${action.label}`}>
          {/* The item the draft belongs to, by name and as the way to it: the item is not drawn whole above its draft. */}
          <Text type="supporting">
            {`${thread.trigger.source}${DOT}`}
            <Link href={itemPageHref(thread.id, window.location.pathname + window.location.search)}>
              {thread.title}
            </Link>
          </Text>
          <HStack gap={2} justify="between" vAlign="center" wrap="wrap">
            <Text weight="semibold">{action.label}</Text>
            {state ? (
              <HStack gap={1.5} vAlign="center">
                <StatusDot variant={state.variant} label={state.label} aria-hidden />
                <Text type="supporting">{state.label}</Text>
              </HStack>
            ) : (
              <Badge variant="neutral" label="Utkast" />
            )}
          </HStack>
          {/* A draft a newer one replaced keeps its line and drops its values (the product owner, 2026-11-16): the
              values that count are in the newest draft, and the older ones were read as a second form. */}
          {shown.length > 0 && !superseded && (
            <MetadataList columns="single">
              {shown.map(a => (
                <MetadataListItem key={a.property} label={a.label}>
                  <Text>{valueText(a, values[a.property]!)}</Text>
                </MetadataListItem>
              ))}
            </MetadataList>
          )}
          {receipt && <Text type="supporting">{receipt.headline}</Text>}
          {waiting && <Text type="supporting">{waiting}</Text>}
          {!state && (
            <HStack gap={2} wrap="wrap">
              <Button
                size="sm"
                variant="primary"
                label={`Granska och ${verbOf(action.label)}`}
                onClick={() => open('effect')}
              />
              <Button size="sm" variant="secondary" label="Ändra" onClick={() => open('fill-in')} />
            </HStack>
          )}
        </VStack>
      </Card>
      {dialog && (
        <ActionDialog
          target={{ kind: 'item', thread, action }}
          isOpen={dialog.open}
          onOpenChange={isOpen => {
            if (!isOpen) setDialog(d => (d ? { ...d, open: false } : d));
          }}
          startAt={dialog.startAt}
          values={values}
          onValuesChange={setTyped}
          onSend={send}
        />
      )}
    </ChatMessageBubble>
  );
}

/**
 * Another assistant's answer with its lines kept: it is drawn as Markdown, where a single line break joins two lines,
 * and an assistant that was not written for Clew puts one thing per line. Each such break becomes a hard one; blank
 * lines, which already part paragraphs, are left.
 */
export const keepLines = (body: string) => body.replace(/([^\n])\n(?=[^\n])/g, '$1  \n');
/** The other system's assistant that wrote an answer, or undefined: Clew's own answers, and Clew's words about one that failed. */
const answeredBy = (m: ThreadMessage) => (m.meta?.handover && !m.meta.handover.failed ? m.meta.handover : undefined);
/** Whom a question went to: another system's assistant, or null for Clew. */
const askedOf = (m: ThreadMessage) => (m.meta?.handed && !m.meta.handed.declined ? m.meta.handed : null);
const lastQuestion = (messages: ThreadMessage[]) => [...messages].reverse().find(x => x.role === 'user');
/** A line in the transcript where whom the person talks to changes: its words, and the system it turns to, if any. */
interface TurnLineContent {
  text: string;
  /** The other system the conversation turns to: its connector, for the colour of its mark, and its word. Absent for Clew. */
  system?: { connector: string; source: string };
}
const connectorOf = (assistant: string) => assistant.slice(0, assistant.indexOf(':'));
const toAssistant = (to: { assistant: string; name: string; source: string }): TurnLineContent => ({
  text: `Du pratar med ${to.name}`,
  system: { connector: connectorOf(to.assistant), source: to.source },
});
const toClew = (text: string): TurnLineContent => ({ text });
/**
 * The line drawn above a question where the recipient changed: the first question to another assistant, a question to
 * Clew after one, or to another assistant after Clew. Nothing where the conversation went on with the same one, and
 * nothing above a conversation that starts with Clew.
 */
function switchLine(messages: ThreadMessage[], i: number): TurnLineContent | undefined {
  const m = messages[i]!;
  if (m.role !== 'user') return undefined;
  const before = lastQuestion(messages.slice(0, i));
  const to = askedOf(m);
  const from = before ? recipientAfter(messages.slice(0, i)) : null;
  if ((to?.assistant ?? null) === (from?.assistant ?? null)) return undefined;
  // The box under the transcript is Clew's, always: a question to Clew needs no line saying so.
  return to ? toAssistant(to) : undefined;
}
/**
 * Whom the conversation was with once its turns so far had ended: the assistant of the last question, unless that
 * assistant handed the question back or answered and returned the conversation (D125 item 12), which has its own line.
 */
function recipientAfter(messages: ThreadMessage[]) {
  const question = lastQuestion(messages);
  const answer = [...messages].reverse().find(x => x.role === 'assistant');
  if (!question || answer?.meta?.handedBack || answer?.meta?.handover?.returned) return null;
  return askedOf(question);
}
/**
 * The words above Clew's own answer to a question another assistant handed back, in a conversation from before
 * 2026-11-16: an assistant no longer hands a question back, and Clew no longer answers in its place unasked.
 */
const handedBackText = (name: string) => `${name} lämnade tillbaka frågan · assistenten svarar`;
function handedBackLine(m: ThreadMessage): TurnLineContent | undefined {
  return m.role === 'assistant' && m.meta?.handedBack ? toClew(handedBackText(m.meta.handedBack.name)) : undefined;
}
/** The same line for the question on its way. */
function pendingSwitch(
  messages: ThreadMessage[],
  pending: { handed?: { id: string; name: string; source: string } },
): TurnLineContent | undefined {
  const from = recipientAfter(messages);
  const to = pending.handed ?? null;
  if ((to?.id ?? null) === (from?.assistant ?? null)) return undefined;
  return to ? toAssistant({ assistant: to.id, name: to.name, source: to.source }) : undefined;
}
/**
 * A line in the transcript where whom the person talks to changes (D125 items 5 and 12): Astryx's system message, with
 * the words in the interface's strong weight and, before them, the mark of who answers from here on: the other system's, in
 * its own colour and with its word, or Clew's own. It enters on Astryx's entry motion when it appears in a conversation
 * already on the page, so a change that takes a moment (an assistant handing a question back) is seen as it happens;
 * nothing moves when the conversation is opened with the line already in it, or under reduced motion.
 */
function TurnLine({ line }: { line: TurnLineContent }) {
  const marks = useMarks();
  const entry = useEntryAnimation('slideDown');
  // The status row, not the ruled divider: its content wraps, which a mark and a sentence need at 320 px (1.4.10).
  return (
    <ChatSystemMessage xstyle={entry ?? undefined}>
      <HStack gap={2} vAlign="center" hAlign="center" wrap="wrap">
        {line.system ? (
          <AreaChip ordinal={marks.system(line.system.connector)?.ordinal ?? null} label={line.system.source} />
        ) : (
          <Icon icon={SparklesIcon} size="sm" color="accent" />
        )}
        <Text weight="semibold" color="primary">
          {line.text}
        </Text>
      </HStack>
    </ChatSystemMessage>
  );
}
/** The mark of another system's assistant beside what it wrote (board SamtalEneo): its initials on a square tile, as a person's are on a round one. */
export function AssistantMark({ name }: { name: string }) {
  return <Avatar name={name} size="sm" shape="square" tooltip={false} />;
}
/**
 * Where Clew suggested another system's assistant and the person chose it (D126 item 6, board SamtalEneo): the
 * suggestion has become this one line under the question, which stands once and says it was sent on. Ruled as the
 * board draws it where the line fits; on a phone the plain system message, whose words wrap (1.4.10), since the ruled
 * one keeps them on one line.
 */
function SuggestedLine({ name, source }: { name: string; source: string }) {
  const mobile = useMediaQuery(mobileQuery);
  return (
    <ChatSystemMessage variant={mobile ? 'default' : 'divider'}>{suggestedWords({ name, source })}</ChatSystemMessage>
  );
}
/**
 * Above what another system's assistant wrote: its name, and the mark of the system it lives in, in that system's own
 * colour (D71) with the system's word on it, so the colour never stands alone. With the surface under it and the
 * assistant's initials beside it, that says whose answer this is without saying whose it is not.
 */
function AssistantName({ assistant, name, source }: { assistant: string; name: string; source: string }) {
  const marks = useMarks();
  return (
    <HStack gap={2} vAlign="center" wrap="wrap">
      <Text weight="semibold">{name}</Text>
      <AreaChip ordinal={marks.system(assistant.slice(0, assistant.indexOf(':')))?.ordinal ?? null} label={source} />
    </HStack>
  );
}
/**
 * Clew's suggestion to hand the question to another system's assistant, and the person's two answers to it (board
 * SamtalEneoFraga). The first button takes the focus when it appears, since the turn waits for this choice; either
 * button sends the question as it was written, to that assistant or to Clew. Yes does not write the question again: the
 * one on the page is marked as sent on, and this suggestion becomes one line under it (D126 item 6).
 */
function HandoverOffer({
  offer,
  held,
  isDisabled,
}: {
  offer: HandoverAssistant;
  held?: 'person' | 'card' | undefined;
  isDisabled: boolean;
}) {
  const talk = useConversation();
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    first.current?.focus();
  }, [offer.id, held]);
  // A question Clew held on its way out (D125 item 13): the safe answer comes first and takes the focus.
  if (held)
    return (
      <VStack gap={3}>
        <HStack gap={2} vAlign="center" wrap="wrap">
          <Badge variant="warning" icon={<Icon icon="warning" size="sm" />} label="Inte skickad" />
          <Text>
            {`Frågan ser ut att gälla ${held === 'person' ? 'din personal' : 'ett av dina ärenden'}. Skickar du den till `}
            <Text as="span" weight="semibold">
              {offer.name}
            </Text>
            {` hamnar den i ${offer.source}.`}
          </Text>
        </HStack>
        <HStack gap={2} wrap="wrap">
          <Button
            ref={first}
            size="sm"
            variant="primary"
            label="Låt assistenten svara"
            isDisabled={isDisabled}
            onClick={talk.declineOffer}
          />
          <Button
            size="sm"
            label={`Skicka till ${offer.name} ändå`}
            isDisabled={isDisabled}
            onClick={talk.acceptOffer}
          />
        </HStack>
      </VStack>
    );
  return (
    <VStack gap={3}>
      <Text>
        <Text as="span" weight="semibold">
          {offer.name}
        </Text>
        {` i ${offer.source} kan svara på det här. Vill du att jag skickar frågan dit? Bara din fråga skickas, inget annat ur samtalet.`}
      </Text>
      {offer.description && <Text type="supporting">{offer.description}</Text>}
      <HStack gap={2} wrap="wrap">
        <Button
          ref={first}
          variant="primary"
          label={`Skicka till ${offer.name}`}
          isDisabled={isDisabled}
          onClick={talk.acceptOffer}
        />
        <Button variant="secondary" label="Svara själv" isDisabled={isDisabled} onClick={talk.declineOffer} />
      </HStack>
    </VStack>
  );
}
/**
 * What another system's assistant wrote, on a surface of its own (D125 item 6, board SamtalEneo): its answer unchanged,
 * the sources it cites as that system named them, each a link when it has an address, that the answer was longer than
 * Clew keeps when it was, and the way to the same conversation in the system itself, where it continues with everything
 * that assistant can do. Everything on the surface is that assistant's; Clew offers nothing of its own under it.
 */
function AssistantAnswer({
  handover,
  isHeld,
  children,
}: {
  handover: HandoverMeta;
  /** Nothing of the answer is written yet: the surface takes a width of its own, since the placeholder's is a share of it. */
  isHeld?: boolean;
  children: ReactNode;
}) {
  const cites = handover.cites ?? [];
  return (
    <Card variant="muted" padding={4} {...(isHeld ? { width: '100%', maxWidth: 360 } : {})}>
      <VStack gap={3}>
        {children}
        {cites.length > 0 && (
          <MetadataList orientation="horizontal" title={<VisuallyHidden>Om källorna</VisuallyHidden>}>
            <MetadataListItem label={cites.length === 1 ? 'Källa' : 'Källor'}>
              <HStack gap={2} wrap="wrap">
                {cites.map((c, i) =>
                  c.link && isWebAddress(c.link) ? (
                    <Link key={i} href={c.link} target="_blank" rel="noreferrer">
                      {c.label}
                    </Link>
                  ) : (
                    <Text key={i} type="supporting">
                      {c.label}
                    </Text>
                  ),
                )}
              </HStack>
            </MetadataListItem>
          </MetadataList>
        )}
        {handover.cut && <Text type="supporting">Svaret var längre än det som visas här.</Text>}
        {handover.link && isWebAddress(handover.link) && (
          <Link href={handover.link} target="_blank" rel="noreferrer">
            {`Fortsätt samtalet i ${handover.source}`}
          </Link>
        )}
      </VStack>
    </Card>
  );
}
type HandoverMeta = Pick<NonNullable<MessageMeta['handover']>, 'source' | 'cites' | 'cut' | 'link'>;

/** The sources an answer cites (D26): `[n]` in the body becomes a numbered citation that opens the document; the first source's owner and review date are named under the answer, in supporting (artboard 7). */
function Sources({ sources }: { sources: SourceCitation[] }) {
  const first = sources[0]!;
  const stale = sources.find(s => s.stale);
  return (
    <MetadataList orientation="horizontal" title={<VisuallyHidden>Om källan</VisuallyHidden>}>
      <MetadataListItem label="Källa">
        <Text type="supporting">
          {sources.length === 1 ? first.label : `${first.label} och ${sources.length - 1} till`}
        </Text>
      </MetadataListItem>
      {first.owner && (
        <MetadataListItem label="Ägare">
          <Text type="supporting">{first.owner}</Text>
        </MetadataListItem>
      )}
      {first.reviewedAt && (
        <MetadataListItem label="Granskad">
          <Text type="supporting">{reviewLabel(first.reviewedAt).replace(/^granskad /, '')}</Text>
        </MetadataListItem>
      )}
      {stale && (
        <MetadataListItem label="Obs">
          <Text type="supporting">
            {stale.reviewedAt ? `Granskad för ${staleLabel(true, stale.reviewedAt)}` : staleLabel(true, undefined)}
          </Text>
        </MetadataListItem>
      )}
    </MetadataList>
  );
}
/** Under an answer: where it came from and, when a model wrote it, which one (D24), so a changed model is visible. A cited answer names its source in `Sources`, once. */
const answerFooter = (meta: MessageMeta | undefined) =>
  (meta?.model ? `Svar från ${meta.model.title}` : undefined) || undefined;
const citationSources = (sources: SourceCitation[]) =>
  Object.fromEntries(
    sources.map(s => [String(s.n), { title: s.label, ...(s.link && isWebAddress(s.link) ? { url: s.link } : {}) }]),
  );

const EMPTY_EVENTS: CalendarEvent[] = [];
/** How long a read took, as H1 writes it: "0,8 s"; a read faster than a tenth is "< 0,1 s", never "0 s". */
const seconds = (ms: number) =>
  ms < 100 ? '< 0,1 s' : `${(ms / 1000).toLocaleString('sv-SE', { maximumFractionDigits: 1 })} s`;
/** The step a handed-over turn shows (`HANDOVER_STEP` on the server): no capability of that name exists. */
const HANDOVER_STEP = 'clew.handover';
/**
 * What a call did, in words (board SamtalVerktyg): a read is "Läser …" while it runs and "Läste …" once it has
 * answered; one that failed says so. A question handed to another system's assistant is already said as a verb
 * ("Frågar …").
 */
const callWords = (title: string, status: TurnStep['status'], handover = false) =>
  handover
    ? title
    : status === 'running'
      ? `Läser ${title}`
      : status === 'error'
        ? `Kunde inte läsa ${title}`
        : `Läste ${title}`;
/**
 * A capability the pending answer reads (D36, D126 item 5): what it does as the call's name, the system it goes to as
 * its target, its own status as the stream says it (running, done, failed), and the time once it has answered. The
 * stream says a call when it starts, so there is no waiting status to show for a call not started yet.
 */
const stepCall = (s: TurnStep): ChatToolCallItem => ({
  key: s.id,
  name: callWords(s.title, s.status, s.capability === HANDOVER_STEP),
  target: s.source,
  status: s.status,
  ...(s.ms !== undefined && s.status !== 'running' ? { duration: seconds(s.ms) } : {}),
});
/** The model's text as it is written (D36), revealed at a steady pace by Astryx's hook; with reduced motion it shows whole. */
export function StreamingAnswer({ text }: { text: string }) {
  const shown = useStreamingText(text, true);
  // Astryx parses what has arrived so far and fades each piece in, so a list or bold text half written is drawn as
  // what it is becoming, not as stray asterisks.
  return (
    <UntrustedMarkdown headingLevelStart={2} isStreaming>
      {shown}
    </UntrustedMarkdown>
  );
}
/** The proposals' week in the transcript (D32): the week's meetings with the drawn times among them, as a list in a ghost bubble, after the `ai-chat` template's card-in-a-bubble. */
function ProposalWeek({ thread }: { thread: Thread }) {
  const week = useQuery({ ...calendarWeekQuery(thread.week ?? ''), enabled: !!thread.week });
  const events = week.data?.events ?? EMPTY_EVENTS;
  if (!thread.week) return null;
  return (
    <ChatMessage sender="assistant" name={<VisuallyHidden>Assistenten</VisuallyHidden>}>
      <ChatMessageBubble variant="ghost" width="100%">
        <EventList
          from={thread.week}
          items={agendaItems(events, thread.proposals)}
          dayHeadingLevel={3}
          label={`Vecka ${weekNumber(thread.week)} med förslagen`}
          accessiblePath="Förslagen bekräftas i ärendet."
        />
      </ChatMessageBubble>
    </ChatMessage>
  );
}

/** A card a turn is about (D34, H1), read from the same cache as the page, so it is live: tick, attest and undo here and every screen agrees. */
function TurnCard({ id, render }: { id: string; render: (thread: Thread) => ReactNode }) {
  const card = useQuery(threadQuery(id));
  return card.data ? <>{render(card.data)}</> : null;
}

/**
 * A declared view under the answer it belongs to (D38): the capability is read again as the person and drawn by the one
 * view renderer, without its controls, in a card whose header is the view's own (artboard 4: chip, source, count, "Visa
 * allt" at its end). Of its rows the card draws what the turn recorded (`MessageMeta.viewRows`): the rows the answer
 * names, every one of them; or, where the answer is about the read as a whole, its first few. The rows come from the
 * source in the order it gives them, which is the order the answer's sentence implies; the web never sorts them again.
 * They never come from the model's text or the stored conversation. A read that fails leaves the button alone, so the
 * whole view can still be opened. A figure is drawn above it only where the figure belongs to this read (`opens`) and
 * the card is the read as a whole (D54).
 */
/**
 * Several work items a turn is about (the product owner, 2026-11-16): one card of rows, not a whole item each. A whole
 * item carries its buttons, its facts and its events, and three of them push the answer off the screen; a row is the
 * item's name as the link to it, the system it comes from and the line Att göra's row says about it. The item opens
 * beside the conversation, where its buttons are. One item alone is still drawn whole (`TurnCard`): it is the thing the
 * turn is about. Read from the same cache as the page, so a row is the item as it is now.
 */
function TurnCardRow({ id, href }: { id: string; href: string }) {
  const card = useQuery(threadQuery(id));
  const t = card.data;
  // Whom the item concerns, by name, and what its first row says (the period of a leave, an amount): read by the
  // browser as the person, from the item and from the person's own page. None of it is the model's: the model is not
  // given a name or a source's words about a person (D97 item 7, D115), and the row shows them all the same, since
  // the person asking may see them (the product owner, 2026-11-16).
  const about = t
    ? [...(t.subjects ?? []), ...t.items.map(i => i.subject)].find(x => x?.entity === 'person')
    : undefined;
  const who = useQuery({ ...entityDetailQuery('person', about?.key ?? ''), enabled: !!about });
  if (!t) return null;
  const now = new Date().toISOString();
  const facts = [
    who.data?.entity.name,
    t.items[0]?.detail,
    t.trigger.source,
    rowLine(rowFacts(t, now, stockholmDate(now))),
  ].filter(Boolean);
  return (
    <ListItem
      label={
        <Link href={href} color="primary">
          {t.title}
        </Link>
      }
      description={<Text type="supporting">{facts.join(DOT)}</Text>}
    />
  );
}
function TurnCardRows({ ids, hrefFor }: { ids: string[]; hrefFor: (id: string) => string }) {
  return (
    <Card padding={0}>
      <List hasDividers density="compact" aria-label="Ärenden i svaret">
        {ids.map(id => (
          <TurnCardRow key={id} id={id} href={hrefFor(id)} />
        ))}
      </List>
    </Card>
  );
}
const EMBED_ROWS = 5;
function ViewEmbed({
  view,
  rows,
  at,
  framed = true,
  hrefFor,
  onShowAll,
}: {
  view: ViewRef;
  rows?: ViewRows | undefined;
  /** When the answer was written, which a figure line is said against. */
  at: string;
  /** In a card of its own; a folded card is the card itself. */
  framed?: boolean;
  /** Where the view and its rows lead (D116): a list to its own page, one thing beside the page. */
  hrefFor?: ((view: ViewRef) => string) | undefined;
  onShowAll: () => void;
}) {
  const read = useQuery({
    ...viewQuery(view.capability, Object.keys(view.input).length ? JSON.stringify(view.input) : null),
    retry: false,
  });
  const figure = figureBelongs(view, rows);
  // A cut list unfolds in the card on the person's own press (the product owner, 2026-11-16): the answer no longer
  // repeats the rows, so the card is where all of them are read.
  const [whole, setWhole] = useState(false);
  if (read.isPending) return null;
  if (!read.data?.view)
    return (
      <HStack>
        {hrefFor ? (
          <Button size="sm" label="Visa allt" href={hrefFor(view)} />
        ) : (
          <Button size="sm" label="Visa allt" onClick={onShowAll} />
        )}
      </HStack>
    );
  const marks = rows?.show === 'named' ? rows.marks : undefined;
  const drawn = (
    <DeclaredView
      view={read.data.view}
      output={read.data.output}
      {...(marks ? { only: marks } : whole ? {} : { limit: EMBED_ROWS })}
      heading={view.title}
      onShowAll={onShowAll}
      showAllHref={hrefFor?.(view)}
      {...(hrefFor ? { hrefFor } : {})}
    />
  );
  const more = !marks && !whole && (rows?.count ?? 0) > EMBED_ROWS;
  const body = more ? (
    <VStack gap={2}>
      {drawn}
      <HStack>
        <Button size="sm" variant="secondary" label={`Visa alla ${rows!.count}`} onClick={() => setWhole(true)} />
      </HStack>
    </VStack>
  ) : (
    drawn
  );
  return (
    <VStack gap={3}>
      {/* The figure that belongs to this read is said as a line above it (D54, artboard 3), as the tile on Hem says it. */}
      {figure && <FigureLines select={figure} now={at} />}
      {framed ? <Card>{body}</Card> : body}
    </VStack>
  );
}
/**
 * An older answer's card (D38): kept in its place in the history, folded, saying the view's title, its system and its
 * count as the turn recorded them, so nothing is read to draw it. Unfolding it reads the view as the person, once: the
 * read stays while the conversation is open, so folding and unfolding again reads nothing more. A read that is logged
 * when it is made (`logged-reads.ts`, one person's holdings) is made here only because the person unfolded it. Astryx's
 * Collapsible, the composition of "Varför nu?" and a card's read, gliding what comes after it (`useAnimatedLayout`).
 */
function FoldedCard({
  card,
  at,
  animatedLayout,
  hrefFor,
  onShowAll,
}: {
  card: Extract<AnswerCard, { kind: 'folded' }>;
  at: string;
  animatedLayout: AnimatedLayout;
  hrefFor?: ((view: ViewRef) => string) | undefined;
  onShowAll: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [asked, setAsked] = useState(false);
  return (
    <Card padding={3}>
      <Collapsible
        isOpen={open}
        onOpenChange={next => {
          setOpen(next);
          if (next) setAsked(true);
        }}
        chevronPosition="start"
        animatedLayout={animatedLayout}
        trigger={
          <>
            <Text weight="semibold">{card.view.title}</Text>
            <Text type="supporting">{` · ${card.summary}`}</Text>
          </>
        }
      >
        {asked && (
          <ViewEmbed view={card.view} rows={card.rows} at={at} framed={false} hrefFor={hrefFor} onShowAll={onShowAll} />
        )}
      </Collapsible>
    </Card>
  );
}
/** An answer's card where it is drawn in the message (`answerCard`): open and read, or folded; a button is drawn with the answer's other buttons. */
function AnswerView({
  card,
  at,
  animatedLayout,
  hrefFor,
  onShowAll,
}: {
  card: AnswerCard | undefined;
  at: string;
  animatedLayout: AnimatedLayout;
  hrefFor?: ((view: ViewRef) => string) | undefined;
  onShowAll: () => void;
}) {
  if (card?.kind === 'open')
    return <ViewEmbed view={card.view} rows={card.rows} at={at} hrefFor={hrefFor} onShowAll={onShowAll} />;
  if (card?.kind === 'folded')
    return <FoldedCard card={card} at={at} animatedLayout={animatedLayout} hrefFor={hrefFor} onShowAll={onShowAll} />;
  return null;
}
/**
 * What a written turn read (D122 item 8, `MessageMeta.reads`), as the calls its pending turn showed (D126 item 5): the
 * read's title, the system it went to and whether it answered. What the read held is never kept, so nothing more is
 * said. A turn from before the reads were kept names its view, when it had one.
 */
function readCalls(
  m: ThreadMessage,
  titleOf: (capability: string) => string | undefined,
  systemOf: (capability: string) => string | undefined,
): ChatToolCallItem[] {
  const reads = m.meta?.reads ?? (m.meta?.view ? [{ capability: m.meta.view.capability }] : []);
  return reads.map((r, i) => {
    const status = 'failed' in r && r.failed ? ('error' as const) : ('complete' as const);
    const title = titleOf(r.capability) ?? (m.meta?.view?.capability === r.capability ? m.meta.view.title : undefined);
    const target = systemOf(r.capability);
    return {
      key: `${m.id}:${i}`,
      name: title ? callWords(title, status) : status === 'error' ? 'Kunde inte läsa' : 'Läste',
      ...(target ? { target } : {}),
      status,
    };
  });
}
/** Clew's own turn names itself (boards Samtal and SamtalVerktyg); what it read is said by its calls. */
const CLEW = 'Assistenten';
/**
 * The transcript (D31; D126, boards Samtal, SamtalVerktyg, SamtalEneoFraga and SamtalEneo): the conversation in the
 * `ai-chat` template's message list. The person's chips sit above their bubble as tokens, except the thing the
 * conversation is about, which stands beside it; Clew answers on the page itself under its name, with the reads it made
 * as tool calls and a read's result as a card whose names are links; another system's assistant answers on a surface of
 * its own. While a turn runs every call is a row with its own status and the answer's place is held. A proposal to
 * confirm is plain content in a ghost bubble (one warning badge, the rows, two buttons), and what was done is a system
 * message with Ångra. The answer is the card (H1): a turn about an open card draws that card in the turn, under its
 * sentence, with the card's own rows and buttons; it is drawn once per conversation and stays live.
 */
export function Transcript({
  onOpenView,
  renderCard,
  viewHref,
  about,
  firstLine,
  asideHref,
  asideOpen,
  cardHref,
}: {
  onOpenView: (view: ViewRef) => void;
  renderCard: (thread: Thread) => ReactNode;
  viewHref?: (view: ViewRef) => string;
  /**
   * The chips of the thing the conversation is about, beside the transcript: not drawn again as a token above each
   * question, and sent with a follow-up as with any question here.
   */
  about?: ChipRef[] | undefined;
  /**
   * Under the first question, in its metadata line: whom the conversation is about ("om Johan Byström"), for a person or
   * a unit, which no chip above the question names, so the transcript reads alone when it is read later.
   */
  firstLine?: string | undefined;
  /**
   * The address that puts an assistant's own exchange beside the transcript: the way on with another system's
   * assistant under its answer. Absent where nothing can stand beside the transcript.
   */
  asideHref?: ((assistant: string) => string) | undefined;
  /** The assistant whose exchange stands beside the transcript now. */
  asideOpen?: string | null | undefined;
  /** The address that puts a work item beside the transcript: where a row of several items leads. */
  cardHref?: ((threadId: string) => string) | undefined;
}) {
  const talk = useConversation();
  const markOf = useObjectMark();
  const marks = useMarks();
  const views = useQuery(areasQuery).data?.views;
  /** A chip above the person's bubble carries its system's glyph (D71, artboard 8). */
  const glyph = (ref: string) => {
    const icon = markOf(ref)?.icon;
    return icon ? <AreaGlyph icon={icon} /> : undefined;
  };
  const titleOf = (capability: string) => views?.find(v => v.capability === capability)?.title;
  const systemOf = (capability: string) => marks.system(capability.slice(0, capability.indexOf('.')))?.source;
  const { conversation, latest, done, busy, pending } = talk;
  // A proposal answer names its thread; the draft carries it. Either way the week is drawn under the answer. The named thread comes from the cache the answer wrote it into.
  const forslagId = latest?.forslag?.threadId ?? null;
  const forslag = useQuery({ ...threadQuery(forslagId ?? ''), enabled: !!forslagId });
  const weekThread = latest?.draft?.thread ?? (forslagId ? (forslag.data ?? null) : null);
  const transcriptArea = useRef<HTMLDivElement>(null);
  const animatedLayout = useAnimatedLayout({ containerRef: transcriptArea });
  if (!conversation && !pending) return null;
  // What was said in the panel beside the conversation is drawn there: the transcript is Clew's.
  const everything = conversation?.messages ?? [];
  const messages = everything.filter(m => !isSide(m));
  // An assistant the person turned to in the panel without Clew sending a question on has no card in the transcript:
  // one line stands where it first was asked, so the transcript shows that the exchange exists when it is read later.
  const joined = new Map<number, NonNullable<NonNullable<ThreadMessage['meta']>['handed']>[]>();
  everything.forEach((m, at) => {
    const handed = m.role === 'user' ? m.meta?.handed : undefined;
    if (!handed?.side) return;
    if (everything.slice(0, at).some(x => x.meta?.handed?.side && x.meta.handed.assistant === handed.assistant)) return;
    // Its answer in the transcript already leads to the panel and counts what was asked there.
    if (everything.some(x => !isSide(x) && answeredBy(x)?.assistant === handed.assistant)) return;
    const before = everything.slice(0, at).filter(x => !isSide(x)).length;
    joined.set(before, [...(joined.get(before) ?? []), handed]);
  });
  const joinedLines = (i: number) =>
    (joined.get(i) ?? []).map(h => (
      <ChatSystemMessage key={`joined-${h.assistant}`}>
        <HStack gap={2} vAlign="center" hAlign="center" wrap="wrap">
          <AreaChip ordinal={marks.system(connectorOf(h.assistant))?.ordinal ?? null} label={h.source} />
          <Text weight="semibold" color="primary">{`Du frågade ${h.name} i sidofältet`}</Text>
          {asideHref && asideOpen !== h.assistant && (
            <Button size="sm" variant="ghost" label="Visa" href={asideHref(h.assistant)} />
          )}
        </HStack>
      </ChatSystemMessage>
    ));
  // Rows are keyed by position, so the pending question and answer become the written ones in place: the log (aria-busy
  // while the answer is written) speaks the answer once, and never the question twice (D36, 4.1.3).
  const n = messages.length;
  // Each answer's card (`answerCard`): the latest answer's open and read, an older one's folded in its place, read when
  // the person unfolds it, so a long conversation opened again reads one view.
  const cardOf = (i: number, m: ThreadMessage) =>
    m.role === 'assistant' ? answerCard(m.meta, i === n - 1 && !pending) : undefined;
  // The thing the conversation is about is named in the header and stands beside it: its chip is not repeated above
  // every question.
  const tokens = (chips: { ref: string; label: string }[] | undefined) =>
    (chips ?? []).filter(c => !about?.some(a => a.ref === c.ref));
  // A draft is replaced by a newer draft of the same action on the same item further down (D112 item 8).
  const replaced = (i: number, draft: ActionDraftRef) =>
    messages
      .slice(i + 1)
      .some(
        m =>
          isActionDraft(m.meta?.draft) &&
          m.meta!.draft!.threadId === draft.threadId &&
          m.meta!.draft!.actionId === draft.actionId,
      );
  const chipRow = (chips: { ref: string; label: string }[] | undefined) =>
    tokens(chips).length > 0 && (
      <HStack gap={1} wrap="wrap">
        {tokens(chips).map(c => (
          <Token key={c.ref} size="sm" label={c.label} icon={glyph(c.ref)} />
        ))}
      </HStack>
    );
  // The first question of the conversation says whom it is about; every later one is under it.
  const firstAsked = messages.findIndex(m => m.role === 'user');
  const isFirst = (key: string) => key === `turn-${firstAsked === -1 ? n : firstAsked}`;
  /** The person's question: its tokens, the words, when, whom it is about, and where it went when not to Clew. */
  const question = (
    key: string,
    body: string,
    at: string,
    chips: { ref: string; label: string }[] | undefined,
    sent?: string,
  ) => {
    const footer = [isFirst(key) ? firstLine : undefined, sent].filter(Boolean).join(DOT);
    return (
      <ChatMessage key={key} sender="user" name={<VisuallyHidden>Du</VisuallyHidden>}>
        {chipRow(chips)}
        <ChatMessageBubble
          variant="filled"
          metadata={
            <ChatMessageMetadata
              timestamp={<Timestamp value={at} format="time" hasTooltip={false} />}
              {...(footer ? { footer } : {})}
            />
          }
        >
          {body}
        </ChatMessageBubble>
      </ChatMessage>
    );
  };
  /** Clew's name over its own turn; the other system's failure to answer is said in Clew's words, never under its name. */
  const clewName = (m?: ThreadMessage) =>
    m?.meta?.handover?.failed ? (
      <HStack gap={1} vAlign="center">
        <Icon icon="warning" size="sm" color="warning" />
        <Text type="supporting">{`Clew · ${m.meta.handover.name} svarade inte`}</Text>
      </HStack>
    ) : (
      CLEW
    );
  /** Another system's assistant over its own answer: its mark, its name and its system's. */
  const otherName = (who: { assistant: string; name: string; source: string }) => (
    <AssistantName assistant={who.assistant} name={who.name} source={who.source} />
  );
  /** The answer's place while nothing of it is written yet (board SamtalVerktyg). */
  const held = (
    <VStack gap={2}>
      <Skeleton width="72%" height={14} />
      <Skeleton width="48%" height={14} index={1} />
    </VStack>
  );
  const written = (m: ThreadMessage, i: number) => {
    if (m.role === 'user') {
      const handed = m.meta?.handed;
      return question(`turn-${i}`, m.body, m.createdAt, m.meta?.chips, handed ? sentWords(handed) : undefined);
    }
    const other = answeredBy(m);
    const time = (
      <ChatMessageMetadata
        timestamp={<Timestamp value={m.createdAt} format="time" hasTooltip={false} />}
        footer={other ? undefined : answerFooter(m.meta)}
      />
    );
    if (other)
      return (
        <ChatMessage
          key={`turn-${i}`}
          sender="assistant"
          avatar={<AssistantMark name={other.name} />}
          name={otherName(other)}
          metadata={time}
        >
          <AssistantAnswer handover={other}>
            <UntrustedMarkdown headingLevelStart={2}>{keepLines(m.body)}</UntrustedMarkdown>
          </AssistantAnswer>
          {asideHref && (
            <HStack gap={3} vAlign="center" wrap="wrap">
              <Button
                size="sm"
                variant="secondary"
                label={`Fortsätt med ${other.name}`}
                isDisabled={asideOpen === other.assistant}
                href={asideHref(other.assistant)}
              />
              {sideCount(everything, other.assistant) > 0 && (
                <Text type="supporting">
                  {sideCount(everything, other.assistant) === 1
                    ? '1 fråga i sidofältet'
                    : `${sideCount(everything, other.assistant)} frågor i sidofältet`}
                </Text>
              )}
            </HStack>
          )}
        </ChatMessage>
      );
    const calls = readCalls(m, titleOf, systemOf);
    const card = cardOf(i, m);
    // The item a turn's draft belongs to is not drawn whole above the draft (the product owner, 2026-11-16): the draft
    // names it and opens the action's dialog itself.
    const drafted = isActionDraft(m.meta?.draft) ? m.meta!.draft!.threadId : null;
    const cards = (m.meta?.cards ?? []).filter(id => id !== drafted);
    return (
      <ChatMessage key={`turn-${i}`} sender="assistant" name={clewName(m)}>
        {calls.length > 0 && <ChatToolCalls calls={calls} />}
        <ChatMessageBubble variant="ghost" width="100%" metadata={time}>
          <VStack gap={3}>
            <UntrustedMarkdown
              headingLevelStart={2}
              {...(m.meta?.sources?.length
                ? { sources: citationSources(m.meta.sources), citationStyle: 'number' as const }
                : {})}
            >
              {m.body}
            </UntrustedMarkdown>
            {m.meta?.sources && m.meta.sources.length > 0 && <Sources sources={m.meta.sources} />}
            {cards.length > 1 || (cards.length > 0 && m.meta?.cardsAs === 'rows') ? (
              <TurnCardRows
                ids={cards}
                hrefFor={id => cardHref?.(id) ?? itemPageHref(id, window.location.pathname + window.location.search)}
              />
            ) : (
              cards.map(id => <TurnCard key={id} id={id} render={renderCard} />)
            )}
            <AnswerView
              card={card}
              at={m.createdAt}
              animatedLayout={animatedLayout}
              hrefFor={viewHref}
              onShowAll={() => onOpenView(m.meta!.view!)}
            />
            {(card?.kind === 'button' || m.meta?.sources?.length) && (
              <HStack gap={2} wrap="wrap">
                {card?.kind === 'button' && (
                  <Button
                    size="sm"
                    label={m.meta!.view!.declared ? 'Visa allt' : `Visa ${m.meta!.view!.title.toLowerCase()}`}
                    {...(viewHref ? { href: viewHref(m.meta!.view!) } : { onClick: () => onOpenView(m.meta!.view!) })}
                  />
                )}
                {m.meta?.sources && m.meta.sources.length > 0 && (
                  <Button
                    size="sm"
                    label="Lägg under Behöver dig"
                    isDisabled={busy}
                    clickAction={() => talk.makeCard(m.id)}
                  />
                )}
              </HStack>
            )}
          </VStack>
        </ChatMessageBubble>
        {isActionDraft(m.meta?.draft) ? (
          <ActionDraftCard
            draft={m.meta!.draft as ActionDraftRef}
            at={m.createdAt}
            replaced={replaced(i, m.meta!.draft as ActionDraftRef)}
          />
        ) : (
          m.meta?.draft && (
            <ChatSystemMessage icon={<Icon icon="warning" color="warning" size="sm" />}>
              Utkast i ärendet. Inget är skickat förrän du trycker på knappen i ärendet.
            </ChatSystemMessage>
          )
        )}
      </ChatMessage>
    );
  };
  return (
    <VStack gap={3} ref={transcriptArea}>
      <ChatMessageList density="balanced" align="bottom" isStreaming={busy}>
        {[
          ...messages.flatMap((m, i) => {
            // Clew suggested the assistant and the person chose it (D126 item 6): the question stands once, says it was
            // sent on, and one line under it takes the suggestion's place. Anywhere else the person turned to another
            // system's assistant, or back to Clew, the transcript says so once, above the question (D125 item 5).
            const routed = m.role === 'user' && m.meta?.handed?.routed ? m.meta.handed : null;
            const line = routed ? undefined : (switchLine(messages, i) ?? handedBackLine(m));
            return [
              ...joinedLines(i),
              ...(line ? [<TurnLine key={`switch-${i}`} line={line} />] : []),
              written(m, i),
              ...(routed ? [<SuggestedLine key={`suggested-${i}`} name={routed.name} source={routed.source} />] : []),
            ];
          }),
          ...joinedLines(n),
          // The question on its way (D36): drawn at once as the person sent it, the answer under it pending: its place
          // held until something is known, the capabilities it reads as calls with their status, then the text.
          ...(pending
            ? [
                ...(!pending.suggested && pendingSwitch(messages, pending)
                  ? [<TurnLine key={`switch-${n}`} line={pendingSwitch(messages, pending)!} />]
                  : []),
                question(
                  `turn-${n}`,
                  pending.text,
                  pending.at,
                  pending.chips,
                  pending.handed ? sentWords({ ...pending.handed, routed: pending.suggested }) : undefined,
                ),
                ...(pending.handed && pending.suggested
                  ? [<SuggestedLine key={`suggested-${n}`} name={pending.handed.name} source={pending.handed.source} />]
                  : []),
                pending.offer ? (
                  <ChatMessage key={`turn-${n + 1}`} sender="assistant" name={CLEW}>
                    {/* Clew asks before anything leaves it (D125 item 11): the question stays as written above, and
                        the person says where it goes. */}
                    <ChatMessageBubble variant="ghost" width="100%">
                      <HandoverOffer offer={pending.offer} held={pending.held} isDisabled={busy} />
                    </ChatMessageBubble>
                  </ChatMessage>
                ) : (
                  <ChatMessage
                    key={`turn-${n + 1}`}
                    sender="assistant"
                    avatar={pending.handed ? <AssistantMark name={pending.handed.name} /> : undefined}
                    name={
                      pending.handed
                        ? otherName({
                            assistant: pending.handed.id,
                            name: pending.handed.name,
                            source: pending.handed.source,
                          })
                        : CLEW
                    }
                  >
                    {pending.steps.length > 0 && (
                      <ChatToolCalls
                        calls={pending.steps.map(stepCall)}
                        defaultIsExpanded
                        label={`Assistenten arbetar · ${pending.steps.length} steg`}
                      />
                    )}
                    {pending.handed ? (
                      <AssistantAnswer handover={{ source: pending.handed.source }} isHeld={!pending.answer}>
                        {pending.answer ? <StreamingAnswer text={keepLines(pending.answer)} /> : held}
                      </AssistantAnswer>
                    ) : (
                      <ChatMessageBubble variant="ghost" width="100%">
                        {pending.answer ? <StreamingAnswer text={pending.answer} /> : held}
                      </ChatMessageBubble>
                    )}
                  </ChatMessage>
                ),
              ]
            : []),
        ]}
        {!pending && weekThread && weekThread.proposals.some(p => p.status === 'proposed') && (
          <ProposalWeek thread={weekThread} />
        )}
        {!pending && latest && latest.clewActions.length > 0 && (
          <ChatMessage sender="assistant" name={<VisuallyHidden>{CLEW}</VisuallyHidden>}>
            {/* A proposal waits for a decision: the same "att bekräfta" as a draft on a card, nothing is done until the black button. */}
            <ChatMessageBubble variant="ghost" width="100%">
              <VStack gap={2}>
                <HStack gap={2} vAlign="center" wrap="wrap">
                  <Badge variant="warning" icon={<Icon icon="warning" size="sm" />} label="Att bekräfta" />
                  <Text type="supporting">Inget görs förrän du trycker. Ångra i 10 min efteråt.</Text>
                </HStack>
                <List density="compact" listStyle="decimal" aria-label="Att bekräfta">
                  {latest.clewActions.map(a => (
                    <ListItem
                      key={a.n}
                      label={<Text>{a.label}</Text>}
                      description={
                        <Text type="supporting">
                          {a.kind === 'dismiss'
                            ? 'Ärendet avfärdas och hamnar under Klart'
                            : 'Ärendet tas upp i morgon 06:00 i stället'}
                        </Text>
                      }
                    />
                  ))}
                </List>
                <HStack gap={2} wrap="wrap">
                  <Button
                    size="sm"
                    variant="primary"
                    label={latest.clewActions.length === 1 ? 'Gör det' : 'Gör båda'}
                    isDisabled={busy}
                    clickAction={() => talk.performActions(latest.clewActions)}
                  />
                  <Button size="sm" variant="ghost" label="Avbryt" onClick={talk.cancelActions} />
                </HStack>
              </VStack>
            </ChatMessageBubble>
          </ChatMessage>
        )}
        {done && (
          <ChatSystemMessage icon={<Icon icon="check" size="sm" color="success" />}>
            {done.text}
            {done.undo && (
              <>
                {' '}
                <Button size="sm" variant="ghost" label="Ångra" clickAction={done.undo} />
              </>
            )}
          </ChatSystemMessage>
        )}
      </ChatMessageList>
      {/* No suggested follow-up questions under an answer (D126 rule 8; the product owner, 2026-11-16: they add no
          value). What the server suggests is not drawn. */}
    </VStack>
  );
}
