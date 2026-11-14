import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
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
  Markdown,
  MetadataList,
  MetadataListItem,
  Skeleton,
  StatusDot,
  SparklesIcon,
  Text,
  Timestamp,
  Token,
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
import { mobileQuery } from './shell';
import { weekNumber } from '@clew/calendar/dates';
import { calendarWeekQuery, threadQuery, viewQuery } from '../queries';
import { DeclaredView } from './view';
import { useConversation } from './conversation-context';
import { reviewLabel, staleLabel } from './panel-labels';
import { useMarks, useObjectMark } from '../marks';
import { FigureLines } from './figure-line';
import { requestAction } from '../action-requests';
import { valueText, type ActionStep } from '../action-path';
import { executionStatus } from '../execution-status';
import { answerCard, figureBelongs, type AnswerCard, type ViewRows } from '../answer-card';

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
function ActionDraftCard({
  draft,
  at,
  replaced,
  onOpen,
}: {
  draft: ActionDraftRef;
  at: string;
  replaced: boolean;
  onOpen?: ((draft: ActionDraftRef) => void) | undefined;
}) {
  const item = useQuery(threadQuery(draft.threadId));
  const thread = item.data;
  const action = thread?.actions.find(a => a.id === draft.actionId);
  if (!thread || !action) return null;
  const asks = action.path?.asks ?? [];
  const values = draft.values ?? {};
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
  const open = (startAt: ActionStep) => {
    requestAction({ threadId: thread.id, actionId: action.id, startAt, values });
    onOpen?.(draft);
  };
  return (
    <ChatMessageBubble variant="ghost" width="100%">
      <Card padding={4}>
        <VStack gap={3} as="section" aria-label={`Utkast: ${action.label}`}>
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
          {shown.length > 0 && (
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
const askedOf = (m: ThreadMessage) => m.meta?.handed ?? null;
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
  return to ? toAssistant(to) : toClew('Du pratar med Clew igen');
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
/** The line under a turn in which the assistant returned the conversation: it is done. */
function returnLine(m: ThreadMessage): TurnLineContent | undefined {
  return m.role === 'assistant' && m.meta?.handover?.returned
    ? toClew(`${m.meta.handover.name} är klar · du pratar med Clew igen`)
    : undefined;
}
/** The words above Clew's own answer to a question another assistant handed back. */
const handedBackText = (name: string) => `${name} lämnade tillbaka frågan · Clew svarar`;
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
  return to ? toAssistant({ assistant: to.id, name: to.name, source: to.source }) : toClew('Du pratar med Clew igen');
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
/** The mark of another system's assistant beside what it wrote: its initials on a rounded tile, as a person's are on a round one. */
function AssistantMark({ name }: { name: string }) {
  return <Avatar name={name} size="sm" shape="rounded" tooltip={false} />;
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
 * Clew's suggestion to hand the question to another system's assistant, and the person's two answers to it. The first
 * button takes the focus when it appears, since the turn waits for this choice; either button sends the question as it
 * was written, to that assistant or to Clew.
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
            {` lämnar den Clew och hamnar i ${offer.source}.`}
          </Text>
        </HStack>
        <HStack gap={2} wrap="wrap">
          <Button
            ref={first}
            size="sm"
            variant="primary"
            label="Låt Clew svara"
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
        {` i ${offer.source} kan svara på det här. Väljer du det skickas din fråga dit, precis som du skrev den, och inget annat från samtalet.`}
      </Text>
      {offer.description && <Text type="supporting">{offer.description}</Text>}
      <HStack gap={2} wrap="wrap">
        <Button
          ref={first}
          size="sm"
          variant="primary"
          label={`Fråga ${offer.name}`}
          isDisabled={isDisabled}
          onClick={talk.acceptOffer}
        />
        <Button size="sm" label="Låt Clew svara" isDisabled={isDisabled} onClick={talk.declineOffer} />
      </HStack>
    </VStack>
  );
}
/**
 * Under an answer another system's assistant wrote: the sources it cites, as that system named them, each a link when
 * it has an address; that the answer was longer than Clew keeps, when it was; and the way to the same conversation in
 * the system itself, where it continues with everything that assistant can do.
 */
function HandoverFoot({ handover }: { handover: NonNullable<MessageMeta['handover']> }) {
  const cites = handover.cites ?? [];
  if (!cites.length && !handover.cut && !handover.link) return null;
  return (
    <VStack gap={2}>
      {cites.length > 0 && (
        <MetadataList orientation="horizontal" title={<VisuallyHidden>Om källorna</VisuallyHidden>}>
          <MetadataListItem label={cites.length === 1 ? 'Källa' : 'Källor'}>
            <HStack gap={2} wrap="wrap">
              {cites.map((c, i) =>
                c.link ? (
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
      {handover.cut && <Text type="supporting">Svaret var längre än Clew visar.</Text>}
      {handover.link && (
        <HStack gap={2} wrap="wrap">
          <Button
            size="sm"
            label={`Fortsätt i ${handover.source}`}
            href={handover.link}
            target="_blank"
            rel="noreferrer"
          />
        </HStack>
      )}
    </VStack>
  );
}

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
  Object.fromEntries(sources.map(s => [String(s.n), { title: s.label, ...(s.link ? { url: s.link } : {}) }]));

const EMPTY_EVENTS: CalendarEvent[] = [];
/** How long a read took, as H1 writes it: "0,8 s"; a read faster than a tenth is "< 0,1 s", never "0 s". */
const seconds = (ms: number) =>
  ms < 100 ? '< 0,1 s' : `${(ms / 1000).toLocaleString('sv-SE', { maximumFractionDigits: 1 })} s`;
/** A capability the pending answer reads (D36): the system as the call's name, what it asks as its target, the time once done. */
const stepCall = (s: TurnStep): ChatToolCallItem => ({
  key: s.id,
  name: s.source,
  target: s.title,
  status: s.status,
  ...(s.ms !== undefined && s.status !== 'running' ? { duration: seconds(s.ms) } : {}),
});
/** The model's text as it is written (D36), revealed at a steady pace by Astryx's hook; with reduced motion it shows whole. */
function StreamingAnswer({ text }: { text: string }) {
  const shown = useStreamingText(text, true);
  return (
    <Markdown density="compact" headingLevelStart={2}>
      {shown}
    </Markdown>
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
 * The transcript (D31): the conversation in page flow in place of the stream, as the `ai-chat` template draws it. The
 * person's chips sit above their bubble as tokens, the assistant answers in Markdown, a proposal to confirm is plain
 * content in a ghost bubble (one warning badge, the rows, two buttons), and what was done is a system message with Ångra.
 * The answer is the card (H1): a turn about an open card draws that card in the assistant's bubble, under its sentence,
 * with the card's own rows and buttons; it is drawn once per conversation and stays live.
 */
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
const EMBED_ROWS = 3;
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
      {...(marks ? { only: marks } : { limit: EMBED_ROWS })}
      onShowAll={onShowAll}
      showAllHref={hrefFor?.(view)}
      {...(hrefFor ? { hrefFor } : {})}
    />
  );
  return (
    <VStack gap={3}>
      {/* The figure that belongs to this read is said as a line above it (D54, artboard 3), as the tile on Hem says it. */}
      {figure && <FigureLines select={figure} now={at} />}
      {framed ? <Card>{drawn}</Card> : drawn}
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
export function Transcript({
  onOpenView,
  renderCard,
  viewHref,
  place = 'page',
  subject,
  onDraft,
}: {
  onOpenView: (view: ViewRef) => void;
  renderCard: (thread: Thread) => ReactNode;
  viewHref?: (view: ViewRef) => string;
  /**
   * `panel`: under the thing in the panel (D112 item 7). The messages start at the top under the thing, and what belongs
   * to a conversation's own page is left out: the questions to follow up with and the line about Esc and Samtal.
   */
  place?: 'page' | 'panel';
  /** The ref of the thing the panel is about: not drawn again as a token above each question. */
  subject?: string[] | undefined;
  /** A draft's button was pressed: the host makes sure the work item is drawn, so its dialog can open (D112 item 8). */
  onDraft?: (draft: ActionDraftRef) => void;
}) {
  const talk = useConversation();
  const mobile = useMediaQuery(mobileQuery);
  const markOf = useObjectMark();
  /** A chip above the person's bubble carries its system's glyph (D71, artboard 8). */
  const glyph = (ref: string) => {
    const icon = markOf(ref)?.icon;
    return icon ? <AreaGlyph icon={icon} /> : undefined;
  };
  const { conversation, latest, done, busy, pending } = talk;
  // A proposal answer names its thread; the draft carries it. Either way the week is drawn under the answer. The named thread comes from the cache the answer wrote it into.
  const forslagId = latest?.forslag?.threadId ?? null;
  const forslag = useQuery({ ...threadQuery(forslagId ?? ''), enabled: !!forslagId });
  const weekThread = latest?.draft?.thread ?? (forslagId ? (forslag.data ?? null) : null);
  const transcriptArea = useRef<HTMLDivElement>(null);
  const animatedLayout = useAnimatedLayout({ containerRef: transcriptArea });
  if (!conversation && !pending) return null;
  const messages = conversation?.messages ?? [];
  // Rows are keyed by position, so the pending question and answer become the written ones in place: the log (aria-busy
  // while the answer is written) speaks the answer once, and never the question twice (D36, 4.1.3).
  const n = messages.length;
  // Each answer's card (`answerCard`): the latest answer's open and read, an older one's folded in its place, read when
  // the person unfolds it, so a long conversation opened again reads one view.
  const cardOf = (i: number, m: ThreadMessage) =>
    m.role === 'assistant' ? answerCard(m.meta, i === n - 1 && !pending) : undefined;
  // Another system's assistant has answered in this conversation: then every answer says whose it is.
  const mixed = messages.some(m => !!m.meta?.handover || !!m.meta?.handed || !!m.meta?.handedBack) || !!pending?.handed;
  const panel = place === 'panel';
  // The thing the panel is about is named in its header: its chip is not repeated above every question.
  const tokens = (chips: { ref: string; label: string }[] | undefined) =>
    (chips ?? []).filter(c => !subject?.includes(c.ref));
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
  return (
    <VStack gap={3} ref={transcriptArea}>
      <ChatMessageList density={panel ? 'compact' : 'balanced'} align={panel ? 'top' : 'bottom'} isStreaming={busy}>
        {[
          ...messages.flatMap((m, i) => [
            // Where the person turned to another system's assistant, or back to Clew, the transcript says so once.
            ...(switchLine(messages, i) || handedBackLine(m)
              ? [<TurnLine key={`switch-${i}`} line={(switchLine(messages, i) ?? handedBackLine(m))!} />]
              : []),
            <ChatMessage
              key={`turn-${i}`}
              sender={m.role}
              /* An answer another system's assistant wrote carries that assistant's mark beside it; Clew's own has none. */
              avatar={
                m.role === 'assistant' && answeredBy(m) ? <AssistantMark name={answeredBy(m)!.name} /> : undefined
              }
              /* The assistant's turn names itself and what it read (artboard G: "Assistenten · läste Mitt team"); the person's turn is theirs. */
              name={
                m.role === 'user' ? (
                  <VisuallyHidden>Du</VisuallyHidden>
                ) : answeredBy(m) ? (
                  <AssistantName
                    assistant={answeredBy(m)!.assistant}
                    name={answeredBy(m)!.name}
                    source={answeredBy(m)!.source}
                  />
                ) : (
                  <HStack gap={1} vAlign="center">
                    <Icon
                      icon={m.meta?.handover?.failed ? 'warning' : SparklesIcon}
                      size="sm"
                      color={m.meta?.handover?.failed ? 'warning' : 'accent'}
                    />
                    <Text type="supporting">
                      {m.meta?.handover
                        ? // The other system did not answer: these are Clew's words, never under the assistant's name.
                          `Clew\u00a0· ${m.meta.handover.name} svarade inte`
                        : // Beside another assistant's answers, Clew's own are named as Clew's.
                          `${mixed ? 'Clew' : 'Assistenten'}${
                            m.meta?.view
                              ? `\u00a0· läste ${m.meta.view.title}`
                              : m.meta?.source && m.meta.source !== 'Assistenten'
                                ? `\u00a0· läste ${m.meta.source}`
                                : ''
                          }`}
                    </Text>
                  </HStack>
                )
              }
            >
              {m.role === 'user' && tokens(m.meta?.chips).length > 0 && (
                <HStack gap={1} wrap="wrap">
                  {tokens(m.meta?.chips).map(c => (
                    <Token key={c.ref} size="sm" label={c.label} icon={glyph(c.ref)} />
                  ))}
                </HStack>
              )}
              <ChatMessageBubble
                /* Clew's answers are on the page itself; another assistant's answer is on a surface of its own, with its
                   sources and the way on inside it, so everything on that surface is visibly that assistant's. */
                variant={m.role === 'assistant' && !answeredBy(m) ? 'ghost' : 'filled'}
                width={m.role === 'assistant' ? '100%' : undefined}
                metadata={
                  <ChatMessageMetadata
                    timestamp={<Timestamp value={m.createdAt} format="time" hasTooltip={false} />}
                    footer={
                      m.role === 'assistant'
                        ? answerFooter(m.meta)
                        : m.meta?.handed
                          ? // Who sent it on: the person by their own choice, or Clew's assistant for them.
                            m.meta.handed.routed
                            ? `Clew skickade frågan till ${m.meta.handed.name}`
                            : `Skickat till ${m.meta.handed.name}`
                          : undefined
                    }
                  />
                }
              >
                {m.role === 'assistant' ? (
                  <VStack gap={3}>
                    <Markdown
                      density="compact"
                      headingLevelStart={2}
                      {...(m.meta?.sources?.length
                        ? { sources: citationSources(m.meta.sources), citationStyle: 'number' as const }
                        : {})}
                    >
                      {answeredBy(m) ? keepLines(m.body) : m.body}
                    </Markdown>
                    {m.meta?.sources && m.meta.sources.length > 0 && <Sources sources={m.meta.sources} />}
                    {m.meta?.handover && !m.meta.handover.failed && <HandoverFoot handover={m.meta.handover} />}
                    {m.meta?.cards?.map(id => (
                      <TurnCard key={id} id={id} render={renderCard} />
                    ))}
                    <AnswerView
                      card={cardOf(i, m)}
                      at={m.createdAt}
                      animatedLayout={animatedLayout}
                      hrefFor={viewHref}
                      onShowAll={() => onOpenView(m.meta!.view!)}
                    />
                    {(cardOf(i, m)?.kind === 'button' || m.meta?.sources?.length) && (
                      <HStack gap={2} wrap="wrap">
                        {cardOf(i, m)?.kind === 'button' && (
                          <Button
                            size="sm"
                            label={m.meta!.view!.declared ? 'Visa allt' : `Visa ${m.meta!.view!.title.toLowerCase()}`}
                            {...(viewHref
                              ? { href: viewHref(m.meta!.view!) }
                              : { onClick: () => onOpenView(m.meta!.view!) })}
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
                ) : (
                  m.body
                )}
              </ChatMessageBubble>
              {isActionDraft(m.meta?.draft) ? (
                <ActionDraftCard
                  draft={m.meta!.draft as ActionDraftRef}
                  at={m.createdAt}
                  replaced={replaced(i, m.meta!.draft as ActionDraftRef)}
                  onOpen={onDraft}
                />
              ) : (
                m.meta?.draft && (
                  <ChatSystemMessage icon={<Icon icon="warning" color="warning" size="sm" />}>
                    Utkast i ärendet. Inget är skickat förrän du trycker på knappen i ärendet.
                  </ChatSystemMessage>
                )
              )}
            </ChatMessage>,
            ...(returnLine(m) ? [<TurnLine key={`return-${i}`} line={returnLine(m)!} />] : []),
          ]),
          // The question on its way (D36): drawn at once as the person sent it, the answer under it pending. Skeleton lines
          // until something is known, the capabilities it reads as calls with a spinner and then their time, then the text.
          ...(pending
            ? [
                ...(pendingSwitch(messages, pending) && !pending.back
                  ? [<TurnLine key={`switch-${n}`} line={pendingSwitch(messages, pending)!} />]
                  : []),
                <ChatMessage key={`turn-${n}`} sender="user" name={<VisuallyHidden>Du</VisuallyHidden>}>
                  {tokens(pending.chips).length > 0 && (
                    <HStack gap={1} wrap="wrap">
                      {tokens(pending.chips).map(c => (
                        <Token key={c.ref} size="sm" label={c.label} icon={glyph(c.ref)} />
                      ))}
                    </HStack>
                  )}
                  <ChatMessageBubble
                    variant="filled"
                    metadata={
                      <ChatMessageMetadata
                        timestamp={<Timestamp value={pending.at} format="time" hasTooltip={false} />}
                      />
                    }
                  >
                    {pending.text}
                  </ChatMessageBubble>
                </ChatMessage>,
                // The assistant handed the question back while the turn runs: the line says so at once, and what is
                // written under it is Clew's own answer.
                ...(pending.back
                  ? [<TurnLine key={`back-${n}`} line={toClew(handedBackText(pending.back.name))} />]
                  : []),
                pending.offer ? (
                  <ChatMessage
                    key={`turn-${n + 1}`}
                    sender="assistant"
                    name={
                      <HStack gap={1} vAlign="center">
                        <Icon icon={SparklesIcon} size="sm" color="accent" />
                        <Text type="supporting">Clew</Text>
                      </HStack>
                    }
                  >
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
                      pending.handed ? (
                        <AssistantName
                          assistant={pending.handed.id}
                          name={pending.handed.name}
                          source={pending.handed.source}
                        />
                      ) : pending.back ? (
                        // Handed back: the answer on its way is Clew's own, and says so from the start.
                        <HStack gap={1} vAlign="center">
                          <Icon icon={SparklesIcon} size="sm" color="accent" />
                          <Text type="supporting">Clew</Text>
                        </HStack>
                      ) : (
                        <VisuallyHidden>Assistenten</VisuallyHidden>
                      )
                    }
                  >
                    <ChatMessageBubble variant={pending.handed ? 'filled' : 'ghost'} width="100%">
                      <VStack gap={2}>
                        {pending.steps.length > 0 && (
                          <ChatToolCalls
                            calls={pending.steps.map(stepCall)}
                            label={`${pending.steps.length} uppslag`}
                          />
                        )}
                        {pending.answer ? (
                          <StreamingAnswer text={pending.handed ? keepLines(pending.answer) : pending.answer} />
                        ) : (
                          <VStack gap={2}>
                            <Skeleton height={16} width="85%" />
                            <Skeleton height={16} width="55%" index={1} />
                          </VStack>
                        )}
                      </VStack>
                    </ChatMessageBubble>
                  </ChatMessage>
                ),
              ]
            : []),
        ]}
        {!pending && weekThread && weekThread.proposals.some(p => p.status === 'proposed') && (
          <ProposalWeek thread={weekThread} />
        )}
        {!pending && latest && latest.clewActions.length > 0 && (
          <ChatMessage sender="assistant" name={<VisuallyHidden>Assistenten</VisuallyHidden>}>
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
      {!panel && !pending && latest && latest.followUps.length > 0 && (
        <HStack gap={1} wrap="wrap" role="group" aria-label="Följdfrågor">
          {latest.followUps.map(f => (
            <Button key={f} size="sm" variant="secondary" label={f} isDisabled={busy} onClick={() => talk.ask(f)} />
          ))}
        </HStack>
      )}
      {!panel && (
        <Text
          type="supporting"
          justify="end"
        >{`${mobile ? '' : 'Esc stänger\u00a0· '}${latest?.draft || messages.some(m => m.meta?.draft) ? 'ärendet behåller utkastet' : 'samtalet sparas under Samtal'}`}</Text>
      )}
    </VStack>
  );
}
