import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type {
  CalendarEvent,
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
  ChatMessage,
  ChatMessageBubble,
  ChatMessageList,
  ChatMessageMetadata,
  ChatSystemMessage,
  ChatToolCalls,
  EventList,
  HStack,
  Icon,
  List,
  ListItem,
  Markdown,
  MetadataList,
  MetadataListItem,
  Skeleton,
  SparklesIcon,
  Text,
  Timestamp,
  Token,
  VisuallyHidden,
  VStack,
  agendaItems,
  useStreamingText,
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
          accessiblePath="Förslagen bekräftas i kortet."
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
 * view renderer, a few rows of it, without its controls, in a card whose header is the view's own (artboard 4: chip,
 * source, count, "Visa allt" at its end). The rows come from the source in the order it gives them, which is the order
 * the answer's sentence implies; the web never sorts them again. They never come from the model's text or the stored
 * conversation. A read that fails leaves the button alone, so the whole view can still be opened.
 */
const EMBED_ROWS = 3;
function ViewEmbed({
  view,
  hrefFor,
  onShowAll,
}: {
  view: ViewRef;
  hrefFor?: ((view: ViewRef) => string) | undefined;
  onShowAll: () => void;
}) {
  const read = useQuery({
    ...viewQuery(view.capability, Object.keys(view.input).length ? JSON.stringify(view.input) : null),
    retry: false,
  });
  if (read.isPending) return null;
  if (!read.data?.view)
    return (
      <HStack>
        <Button size="sm" label="Visa allt" onClick={onShowAll} />
      </HStack>
    );
  return (
    <Card>
      <DeclaredView
        view={read.data.view}
        output={read.data.output}
        limit={EMBED_ROWS}
        onShowAll={onShowAll}
        {...(hrefFor ? { hrefFor } : {})}
      />
    </Card>
  );
}
export function Transcript({
  onOpenView,
  renderCard,
  viewHref,
}: {
  onOpenView: (view: ViewRef) => void;
  renderCard: (thread: Thread) => ReactNode;
  viewHref?: (view: ViewRef) => string;
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
  if (!conversation && !pending) return null;
  const messages = conversation?.messages ?? [];
  // Rows are keyed by position, so the pending question and answer become the written ones in place: the log (aria-busy
  // while the answer is written) speaks the answer once, and never the question twice (D36, 4.1.3).
  const n = messages.length;
  // The latest answer's declared view is drawn under it, with "Visa allt" in its header; an older answer keeps the button.
  const embedded = (i: number, m: ThreadMessage) => i === n - 1 && !pending && !!m.meta?.view?.declared;
  return (
    <VStack gap={3}>
      <ChatMessageList density="balanced" align="bottom" isStreaming={busy}>
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
                      Assistenten
                      {m.meta?.view
                        ? ` · läste ${m.meta.view.title}`
                        : m.meta?.source && m.meta.source !== 'Assistenten'
                          ? ` · läste ${m.meta.source}`
                          : ''}
                    </Text>
                  </HStack>
                )
              }
            >
              {m.role === 'user' && (m.meta?.chips?.length ?? 0) > 0 && (
                <HStack gap={1} wrap="wrap">
                  {m.meta!.chips!.map(c => (
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
                    footer={m.role === 'assistant' ? answerFooter(m.meta) : undefined}
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
                    {m.meta?.cards?.map(id => (
                      <TurnCard key={id} id={id} render={renderCard} />
                    ))}
                    {/* The latest answer's view, read again; an older answer keeps its button, so opening a long conversation reads one view, not all of them. */}
                    {embedded(i, m) && (
                      <ViewEmbed view={m.meta!.view!} hrefFor={viewHref} onShowAll={() => onOpenView(m.meta!.view!)} />
                    )}
                    {((m.meta?.view && !embedded(i, m)) || m.meta?.sources?.length) && (
                      <HStack gap={2} wrap="wrap">
                        {m.meta?.view && !embedded(i, m) && (
                          <Button
                            size="sm"
                            label={m.meta.view.declared ? 'Visa allt' : `Visa ${m.meta.view.title.toLowerCase()}`}
                            onClick={() => onOpenView(m.meta!.view!)}
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
              {m.meta?.draft && (
                <ChatSystemMessage icon={<Icon icon="warning" color="warning" size="sm" />}>
                  Utkast i kortet. Inget är skickat förrän du trycker på knappen i kortet.
                </ChatSystemMessage>
              )}
            </ChatMessage>
          )),
          // The question on its way (D36): drawn at once as the person sent it, the answer under it pending. Skeleton lines
          // until something is known, the capabilities it reads as calls with a spinner and then their time, then the text.
          ...(pending
            ? [
                <ChatMessage key={`turn-${n}`} sender="user" name={<VisuallyHidden>Du</VisuallyHidden>}>
                  {pending.chips.length > 0 && (
                    <HStack gap={1} wrap="wrap">
                      {pending.chips.map(c => (
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
                  name={<VisuallyHidden>Assistenten</VisuallyHidden>}
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
                            ? 'Kortet avfärdas och hamnar under Redan hanterat'
                            : 'Kortet tas upp i morgon 06:00 i stället'}
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
      {!pending && latest && latest.followUps.length > 0 && (
        <HStack gap={1} wrap="wrap" role="group" aria-label="Följdfrågor">
          {latest.followUps.map(f => (
            <Button key={f} size="sm" variant="secondary" label={f} isDisabled={busy} onClick={() => talk.ask(f)} />
          ))}
        </HStack>
      )}
      <Text
        type="supporting"
        justify="end"
      >{`${mobile ? '' : 'Esc stänger · '}${latest?.draft || messages.some(m => m.meta?.draft) ? 'kortet behåller utkastet' : 'samtalet sparas under Redan hanterat'}`}</Text>
    </VStack>
  );
}
