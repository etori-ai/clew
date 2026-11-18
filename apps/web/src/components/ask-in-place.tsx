import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Chip, ConversationResponse, Thread, ThreadMessage } from '@clew/contracts';
import {
  ChatComposer,
  ChatComposerInput,
  ChatLayout,
  ChatMessage,
  ChatMessageBubble,
  ChatMessageList,
  HStack,
  Link,
  Markdown,
  Skeleton,
  StackItem,
  VStack,
  VisuallyHidden,
  type ChatComposerInputHandle,
} from '@clew/ui';
import { api } from '../api';
import { threadsQuery } from '../queries';
import { applyThread } from '../thread-cache';
import { errorMessage } from '../query-policy';
import { isSide } from '../conversation-about';
import { StreamingAnswer } from './conversation';
import type { ChipRef, ThingSubject } from './conversation-context';

/** The question on its way and its answer as it is written, until the finished turn is in the conversation. */
interface Running {
  key: string;
  asked: string;
  answer: string;
}
interface Turn {
  controller: AbortController;
  text: string;
}
const EMPTY: Thread[] = [];

/**
 * The person's newest conversation about a thing: a question of theirs that was asked with the thing's chip, as the
 * server keeps it on the question (`MessageMeta.chips`). Read from the conversations the browser already holds (the
 * thread list, D33), so a conversation is found again after a reload and wherever it was started. A read of the
 * calendar's own range (`capability:calendar.week`) is the same chip for every week: there the chip's label, the week
 * or the day it was asked about, tells them apart.
 */
export function conversationAbout(threads: Thread[], chip: Pick<ChipRef, 'ref' | 'kind' | 'label'>): Thread | null {
  const asked = (m: ThreadMessage) =>
    m.role === 'user' &&
    !!m.meta?.chips?.some(c => c.ref === chip.ref && (chip.kind !== 'capability' || c.label === chip.label));
  let newest: Thread | null = null;
  for (const t of threads)
    if (t.kind === 'question' && t.messages.some(asked) && (!newest || t.updatedAt > newest.updatedAt)) newest = t;
  return newest;
}

/**
 * The assistant asked in place (the product owner, 2026-11-18; plan "Asking the assistant in place on Kalender"): where
 * the answer is drawn on the page itself, the page has a box beside the thing instead of leading to a conversation, and
 * the conversation about the thing is drawn whole above the box, as a chat is read. `subject` is what the box is about
 * now, or nothing. The person's newest conversation about it is shown and continued (`conversationAbout`); with none,
 * the first question makes one (`converseStream` without an id), under Alla samtal like any other. The thing goes with
 * every question as its chips and as what stands open (`beside`), and the turn is Clew's own (`own`): it is never
 * offered to another system's assistant. Another thing stops a turn still running and lets go of the words in the box.
 * `onAnswer` hears each finished turn, so a page can draw what the answer prepared (`prepared`). The page-level
 * conversation (`useConversation`) is not touched: this one has its own state, as `askAside` does.
 */
export function useAskInPlace(subject: ThingSubject | null, onAnswer?: (response: ConversationResponse) => void) {
  const client = useQueryClient();
  const threads = useQuery(threadsQuery).data?.threads ?? EMPTY;
  const key = subject?.key ?? null;
  const chip = subject?.chips[0];
  const found = useMemo(
    () => (chip ? conversationAbout(threads, chip) : null),
    // The chip's fields, not the object: a page builds its subject anew on every render.
    [threads, chip?.ref, chip?.kind, chip?.label],
  );
  // The conversation the last answer here came back with, until the thread list has it too.
  const [latest, setLatest] = useState<{ key: string; thread: Thread } | null>(null);
  const [running, setRunning] = useState<Running | null>(null);
  const [failed, setFailed] = useState<{ key: string; text: string } | null>(null);
  const [value, setValue] = useState('');
  // Another thing: the words in the box are let go of before anything is drawn for it.
  const [valueFor, setValueFor] = useState(key);
  if (valueFor !== key) {
    setValueFor(key);
    setValue('');
  }
  const mine = latest && latest.key === key ? latest.thread : null;
  const conversation = mine && !(found?.id === mine.id && found.messages.length > mine.messages.length) ? mine : found;
  const pending = running && running.key === key ? running : null;
  const error = failed && failed.key === key ? failed.text : null;
  const field = useRef<ChatComposerInputHandle>(null);
  const wantsFocus = useRef(false);
  const [focusAsked, setFocusAsked] = useState(0);
  const turn = useRef<Turn | null>(null);
  const about = useRef(subject);
  about.current = subject;
  const continued = useRef(conversation);
  continued.current = conversation;
  const answered = useRef(onAnswer);
  answered.current = onAnswer;
  const abort = () => {
    turn.current?.controller.abort();
    turn.current = null;
  };
  // A turn still running when the thing changes or the page goes away is stopped: the server writes nothing for it, and
  // the question is not left on its way when the thing is opened again.
  useEffect(
    () => () => {
      abort();
      setRunning(null);
    },
    [key],
  );
  /** The box takes the focus: what a page does when the person opened it to ask. */
  const focusBox = useCallback(() => {
    wantsFocus.current = true;
    setFocusAsked(n => n + 1);
  }, []);
  /** Stoppa: the question is not asked after all, and its words are back in the box. */
  const stop = useCallback(() => {
    const was = turn.current;
    if (!was) return;
    abort();
    setRunning(null);
    setValue(v => v || was.text);
  }, []);
  const ask = useCallback(
    async (raw: string): Promise<boolean> => {
      const text = raw.replace(/\s+/g, ' ').trim();
      const thing = about.current;
      if (!text || !thing || turn.current) return false;
      const going = continued.current;
      const now: Turn = { controller: new AbortController(), text };
      turn.current = now;
      const { signal } = now.controller;
      setFailed(null);
      setRunning({ key: thing.key, asked: text, answer: '' });
      // What arrives belongs to the thing it was asked about: once the box is about another, nothing is drawn.
      const write = (change: (p: Running) => Running) =>
        setRunning(p => (p && p.key === thing.key && !signal.aborted ? change(p) : p));
      const chips = thing.chips.map(c => ({ ref: c.ref, kind: c.kind, label: c.label }) as Chip);
      try {
        const result = await api.converseStream(
          {
            text,
            chips,
            ...(chips[0] ? { beside: chips[0].ref } : {}),
            own: true,
            ...(going ? { conversationId: going.id } : {}),
          },
          event => {
            if (event.type === 'text')
              write(p => ({ ...p, answer: event.reset ? event.delta : p.answer + event.delta }));
          },
          signal,
        );
        if (signal.aborted) return true;
        // Asked as Clew's own turn, nothing is offered to another system's assistant; were it, nothing was saved.
        if ('offer' in result) throw new Error('offered');
        setLatest({ key: thing.key, thread: result.thread });
        setRunning(null);
        void applyThread(client, result.thread);
        answered.current?.(result);
        return true;
      } catch (e) {
        if (signal.aborted) return true;
        setRunning(null);
        setFailed({ key: thing.key, text: errorMessage(e, 'Frågan kunde inte ställas.') });
        return false;
      } finally {
        if (turn.current === now) turn.current = null;
      }
    },
    [client],
  );
  const messages = useMemo(
    () => (conversation?.messages ?? []).filter(m => !isSide(m) && (m.role === 'user' || m.role === 'assistant')),
    [conversation],
  );
  return useMemo(
    () => ({
      subject,
      conversation,
      messages,
      pending,
      error,
      focusAsked,
      value,
      setValue,
      field,
      wantsFocus,
      focusBox,
      ask,
      stop,
    }),
    [subject, conversation, messages, pending, error, focusAsked, value, focusBox, ask, stop],
  );
}
export type AskInPlace = ReturnType<typeof useAskInPlace>;

/**
 * The box (boards KalFraga and KalFragaFlytt): Astryx's composer, flat, at its own default density (the product owner,
 * 2026-11-18: the compact one put its text too close to its border). It takes the focus only when the page asked for
 * it (`focusBox`), never by standing there. While an answer is on its way the send button is Stoppa and the field
 * stays open, as in a conversation's own box (D36, D126 item 5); Enter waits until the answer is written. Esc is the
 * page's: the box does not hold it.
 */
export function AskBox({ ask, placeholder }: { ask: AskInPlace; placeholder: string }) {
  const { field, wantsFocus, focusAsked } = ask;
  // Cleared in the frame, not in the effect, so a second run of the effect (React's strict mode) still focuses.
  useEffect(() => {
    if (!wantsFocus.current) return;
    const frame = requestAnimationFrame(() => {
      wantsFocus.current = false;
      field.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [focusAsked, field, wantsFocus]);
  return (
    <ChatComposer
      elevation="none"
      value={ask.value}
      onChange={ask.setValue}
      isStopShown={!!ask.pending}
      onStop={ask.stop}
      placeholder={placeholder}
      input={
        <ChatComposerInput
          handleRef={field}
          label={placeholder}
          placeholder={placeholder}
          maxRows={3}
          hasHistory={false}
          onKeyDown={e => {
            if (ask.pending && e.key === 'Enter' && !e.shiftKey) e.preventDefault();
          }}
        />
      }
      onSubmit={text => {
        const sent = text;
        ask.setValue('');
        void ask.ask(sent).then(ok => {
          if (!ok) ask.setValue(v => v || sent);
        });
      }}
      {...(ask.error ? { status: { type: 'error' as const, message: ask.error } } : {})}
    />
  );
}

/**
 * The conversation about the thing and the box under it (the product owner, 2026-11-18), composed as the panel of
 * another system's assistant is (D128, `assistant-pane.tsx`): Astryx's `ChatLayout` with the box docked in its
 * `composer` slot and the transcript over it, oldest first, kept at the newest while an answer is written. Each answer
 * is drawn as a conversation draws Clew's own (`written()` in `conversation.tsx`), with what the page draws under it
 * (`under`: a decision the answer prepared). "Öppna samtalet" leads to the conversation's page, once, at the head of
 * the region. Rows are keyed by position, so the question on its way and its answer become the written ones in place
 * and the log speaks the answer once (D36, 4.1.3). The region fills what its parent leaves it.
 */
export function AskTalk({
  ask,
  placeholder,
  under,
}: {
  ask: AskInPlace;
  placeholder: string;
  under?: ((m: ThreadMessage) => ReactNode) | undefined;
}) {
  const { conversation, messages, pending, subject } = ask;
  const n = messages.length;
  const asked = (key: string, body: string) => (
    <ChatMessage key={key} sender="user" name={<VisuallyHidden>Du</VisuallyHidden>}>
      <ChatMessageBubble variant="filled">{body}</ChatMessageBubble>
    </ChatMessage>
  );
  return (
    <VStack gap={2} height="100%">
      {conversation && !pending && (
        <HStack hAlign="end">
          <Link href={`/conversations/${conversation.id}${subject?.search ?? ''}`} type="supporting" color="secondary">
            Öppna samtalet
          </Link>
        </HStack>
      )}
      <StackItem size="fill">
        <VStack height="100%">
          <ChatLayout composer={<AskBox ask={ask} placeholder={placeholder} />}>
            <ChatMessageList density="compact" align="bottom" isStreaming={!!pending}>
              {[
                ...messages.map((m, i) =>
                  m.role === 'user' ? (
                    asked(`turn-${i}`, m.body)
                  ) : (
                    <ChatMessage key={`turn-${i}`} sender="assistant" name="Assistenten">
                      <ChatMessageBubble variant="ghost" width="100%">
                        <VStack gap={3}>
                          <Markdown density="compact" headingLevelStart={2}>
                            {m.body}
                          </Markdown>
                          {under?.(m)}
                        </VStack>
                      </ChatMessageBubble>
                    </ChatMessage>
                  ),
                ),
                ...(pending
                  ? [
                      asked(`turn-${n}`, pending.asked),
                      <ChatMessage key={`turn-${n + 1}`} sender="assistant" name="Assistenten">
                        <ChatMessageBubble variant="ghost" width="100%">
                          {pending.answer ? (
                            <StreamingAnswer text={pending.answer} />
                          ) : (
                            <VStack gap={2}>
                              <Skeleton width="72%" height={14} />
                              <Skeleton width="48%" height={14} index={1} />
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
