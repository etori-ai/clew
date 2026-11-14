import { useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type {
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
  AreaGlyph,
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
import { useObjectMark } from '../marks';
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
          ...messages.map((m, i) => (
            <ChatMessage
              key={`turn-${i}`}
              sender={m.role}
              /* The assistant's turn names itself and what it read (artboard G: "Assistenten · läste Mitt team"); the person's turn is theirs. */
              name={
                m.role === 'user' ? (
                  <VisuallyHidden>Du</VisuallyHidden>
                ) : (
                  <HStack gap={1} vAlign="center">
                    <Icon icon={SparklesIcon} size="sm" color="accent" />
                    <Text type="supporting">
                      {m.meta?.handover
                        ? // Another system's assistant wrote this, or did not answer: its name and its system, never "Assistenten".
                          m.meta.handover.failed
                          ? `Clew\u00a0· ${m.meta.handover.name} svarade inte`
                          : `${m.meta.handover.name}\u00a0· ${m.meta.handover.source}`
                        : `Assistenten${
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
                variant={m.role === 'assistant' ? 'ghost' : 'filled'}
                width={m.role === 'assistant' ? '100%' : undefined}
                metadata={
                  <ChatMessageMetadata
                    timestamp={<Timestamp value={m.createdAt} format="time" hasTooltip={false} />}
                    footer={
                      m.role === 'assistant'
                        ? answerFooter(m.meta)
                        : m.meta?.handed
                          ? `Skickat till ${m.meta.handed.name}`
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
                      {m.body}
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
            </ChatMessage>
          )),
          // The question on its way (D36): drawn at once as the person sent it, the answer under it pending. Skeleton lines
          // until something is known, the capabilities it reads as calls with a spinner and then their time, then the text.
          ...(pending
            ? [
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
                <ChatMessage
                  key={`turn-${n + 1}`}
                  sender="assistant"
                  name={
                    pending.handed ? (
                      <HStack gap={1} vAlign="center">
                        <Icon icon={SparklesIcon} size="sm" color="accent" />
                        <Text type="supporting">{`${pending.handed.name}\u00a0· ${pending.handed.source}`}</Text>
                      </HStack>
                    ) : (
                      <VisuallyHidden>Assistenten</VisuallyHidden>
                    )
                  }
                >
                  <ChatMessageBubble variant="ghost" width="100%">
                    <VStack gap={2}>
                      {pending.steps.length > 0 && (
                        <ChatToolCalls calls={pending.steps.map(stepCall)} label={`${pending.steps.length} uppslag`} />
                      )}
                      {pending.answer ? (
                        <StreamingAnswer text={pending.answer} />
                      ) : (
                        <VStack gap={2}>
                          <Skeleton height={16} width="85%" />
                          <Skeleton height={16} width="55%" index={1} />
                        </VStack>
                      )}
                    </VStack>
                  </ChatMessageBubble>
                </ChatMessage>,
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
