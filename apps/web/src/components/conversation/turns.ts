import { useCallback, useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';
import type {
  Chip,
  ConversationInput,
  ConversationResponse,
  Handover,
  HandoverAssistant,
  OpenThing,
  ThreadMessage,
  TurnStep,
  Thread,
} from '@clew/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useAnnounce, type ChatComposerInputHandle } from '@clew/ui';
import { api } from '../../api';
import { errorMessage } from '../../query-policy';
import { threadQuery } from '../../queries';
import { keys } from '../../query-keys';
import { useThreadAction } from '../../mutations';

/**
 * The turn machinery of a conversation (D31, D36), apart from where the conversation is drawn: the app's one
 * conversation (`ConversationProvider`, bound to the route) and the conversation beside a page (`usePageConversation`,
 * D130 rule 6) each hold one of these, so the box and the transcript are the same parts in both (D130, "One component").
 * Nothing here navigates.
 */
export type ClewAction = ConversationResponse['clewActions'][number];
export interface Conversation {
  id: string;
  title: string;
  messages: ThreadMessage[];
  /** The assistant of another system this conversation was handed to, if it was. */
  handover?: Handover;
}
/** The assistant of another system the box is talking to: its key, its name and the system it lives in. */
export type Handed = Pick<HandoverAssistant, 'id' | 'name' | 'source'>;
export const conversationOf = (t: Pick<Thread, 'id' | 'title' | 'messages' | 'handover'>): Conversation => ({
  id: t.id,
  title: t.title,
  messages: t.messages,
  ...(t.handover ? { handover: t.handover } : {}),
});
/**
 * The turn on its way (D36): the question as sent, drawn at once under the earlier turns, the capabilities the answer
 * reads as they run, and the model's text so far. It gives way to the written turn when the answer is done.
 */
export interface PendingTurn {
  text: string;
  chips: Chip[];
  at: string;
  steps: TurnStep[];
  answer: string;
  /** The assistant of another system the question went to, when it did: the answer on its way is that assistant's. */
  handed?: Handed;
  /**
   * Clew's assistant suggests this assistant of another system for the question (D125 item 11). Nothing has been sent
   * there or saved: the question stays drawn with the choice under it until the person says yes or lets Clew answer.
   */
  offer?: HandoverAssistant;
  /**
   * With `offer`: the question was already on its way to that assistant and Clew held it, because it names someone the
   * person manages or one of their cards (D125 item 13). The choice is then to let Clew answer, or to send it anyway.
   */
  held?: 'person' | 'card';
  /**
   * With `handed`: the person said yes to Clew's suggestion of that assistant (D126 item 6). The question already on
   * the page is the one sent on: it says so, and the suggestion has become one line under it.
   */
  suggested?: true;
}
/** What was done for the person, said under the transcript, with Ångra while it can be undone. */
export type Done = { text: string; undo?: () => Promise<void> } | null;
/** One question on its way: what was typed, what goes with it, the conversation it continues, and what the host hears. */
export interface Send {
  raw: string;
  text: string;
  chips: Chip[];
  /** The one of the chips that stands open beside the transcript; never with a question to another system's assistant. */
  beside?: string | undefined;
  /** The conversation the question continues; null starts a new one. */
  current: Conversation | null;
  /** The assistant of another system the question goes to; absent, Clew's own answers. */
  handed?: Handed | undefined;
  /** The person said yes to Clew's suggestion of that assistant. */
  suggested?: boolean;
  /** The person chose to let Clew answer: the question is not offered to another assistant again. */
  own?: boolean;
  /** Clew held the question and the person chose to send it anyway. */
  confirmed?: boolean;
  /**
   * The page the question was asked beside (D130 rules 4 and 6): what it shows, as the subject's key and its words. A
   * conversation the question starts is kept as asked beside that subject, so the pane finds it again on any device
   * and the rail leaves it out until it is opened as a conversation; on a conversation that exists it says nothing.
   */
  page?: { subject: string; label: string } | undefined;
  /**
   * The thing that stands open where the question is asked (D131 item 1): a person, a unit or a record on its page
   * beside the pane, or beside the transcript on the conversation's page. Only which thing: the server resolves it as
   * the asker. Never with a question to another system's assistant.
   */
  thing?: OpenThing | undefined;
  /** Clew suggests another system's assistant for this question: the host hears it and asks the person. */
  onOffer?: (assistant: HandoverAssistant, held?: 'person' | 'card') => void;
  /** The question is drawn: the host puts the transcript where it belongs. */
  onStart?: () => void;
  /** The written turn has come back, before the cache is written. */
  onAnswered?: (response: ConversationResponse) => void;
  /** Whether the box takes the focus back when the turn has ended; it does unless the host says otherwise. */
  refocus?: () => boolean;
}
/**
 * The request one question goes as (`ConversationInput`): what stands open (`beside`), the page it was asked beside
 * (`page`) and the thing that stands open there (`thing`, D131 item 1) go with a question to Clew only; to another
 * system's assistant the words go with the chips the person chose and nothing of the page.
 */
export function turnInput({
  text,
  chips,
  beside,
  current,
  handed,
  suggested,
  own,
  confirmed,
  page,
  thing,
}: Omit<Send, 'raw'>): ConversationInput {
  return {
    text,
    chips,
    ...(beside && !handed ? { beside } : {}),
    ...(current ? { conversationId: current.id } : {}),
    ...(handed ? { assistant: handed.id } : {}),
    ...(handed && suggested ? { suggested: true as const } : {}),
    ...(own ? { own: true as const } : {}),
    ...(handed && confirmed ? { confirmed: true as const } : {}),
    ...(page && !handed ? { page } : {}),
    ...(thing && !handed ? { thing } : {}),
  };
}

/** The turn machinery a box and its transcript share: one conversation, its turn on its way, and what an answer offers. */
export interface Turns {
  conversation: Conversation | null;
  setConversation: Dispatch<SetStateAction<Conversation | null>>;
  latest: ConversationResponse | null;
  setLatest: Dispatch<SetStateAction<ConversationResponse | null>>;
  pending: PendingTurn | null;
  done: Done;
  setDone: Dispatch<SetStateAction<Done>>;
  busy: boolean;
  error: string | null;
  setError: Dispatch<SetStateAction<string | null>>;
  value: string;
  setValue: Dispatch<SetStateAction<string>>;
  input: RefObject<ChatComposerInputHandle | null>;
  abortTurn(reason: 'stop' | 'leave'): void;
  /**
   * Lets go of everything at once: the turn on its way is left (nothing goes back in the box) and the conversation, the
   * answer, what was done, the error and the words in the box are cleared. The conversation beside a page does this
   * when the page shows another subject (D130 rule 6: one conversation per subject).
   */
  reset(): void;
  send(request: Send): Promise<void>;
  performActions(actions: ClewAction[]): Promise<void>;
  cancelActions(): void;
  makeCard(messageId: string): Promise<void>;
}

/**
 * One conversation's turns (D31, D36): the question is drawn at once with its answer pending under it, the box is
 * cleared and rests with Stoppa, and the answer streams in, the capabilities it reads as steps and the model's text as
 * it is written. The written turn replaces the pending one when it is done. Stopped or failed, nothing was saved and the
 * question goes back in the box; a turn left behind (another conversation) is stopped and nothing goes back. Every
 * thread an answer carries goes into the cache (D33), the same path as a card's own action.
 */
export function useTurns(onThreadChange: (thread: Thread) => void): Turns {
  const announce = useAnnounce();
  const client = useQueryClient();
  const { apply } = useThreadAction({ onChange: onThreadChange });
  const input = useRef<ChatComposerInputHandle>(null);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  busyRef.current = busy;
  const [error, setError] = useState<string | null>(null);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [latest, setLatest] = useState<ConversationResponse | null>(null);
  const [pending, setPending] = useState<PendingTurn | null>(null);
  const [done, setDone] = useState<Done>(null);
  // The turn in flight and why it would be aborted: Stoppa and closing put the question back in the box, leaving does not.
  const inflight = useRef<AbortController | null>(null);
  const abortReason = useRef<'stop' | 'leave'>('stop');
  const abortTurn = useCallback((reason: 'stop' | 'leave') => {
    // A suggestion waiting for the person's answer is not a turn in flight: leaving it behind just takes it away.
    setPending(p => (p?.offer ? null : p));
    if (!inflight.current) return;
    abortReason.current = reason;
    inflight.current.abort();
  }, []);
  const reset = useCallback(() => {
    abortTurn('leave');
    setPending(null);
    setConversation(null);
    setLatest(null);
    setDone(null);
    setError(null);
    setValue('');
  }, [abortTurn]);
  // Leaving the page stops the turn too: an answer must not pull the person back to a conversation they left.
  useEffect(() => () => inflight.current?.abort(), []);
  const send = useCallback(
    async (request: Send) => {
      const { raw, text, chips, current, handed, suggested, onOffer, onStart, onAnswered, refocus } = request;
      if (!text || busyRef.current) return;
      if (!current) {
        setConversation(null);
        setLatest(null);
      }
      const controller = new AbortController();
      let offered = false;
      inflight.current = controller;
      abortReason.current = 'stop';
      busyRef.current = true;
      setBusy(true);
      setError(null);
      setDone(null);
      setPending({
        text,
        chips,
        at: new Date().toISOString(),
        steps: [],
        answer: '',
        ...(handed ? { handed } : {}),
        ...(handed && suggested ? { suggested: true as const } : {}),
      });
      setValue('');
      onStart?.();
      announce(handed ? `Frågar ${handed.name} …` : 'Söker svar …');
      try {
        const response = await api.converseStream(
          turnInput(request),
          event => {
            // The turn went to another system's assistant: what follows is drawn as that assistant's from its first word.
            if (event.type === 'handed') setPending(p => p && { ...p, handed: event.assistant, answer: '' });
            else if (event.type === 'step')
              setPending(
                p =>
                  p && {
                    ...p,
                    steps: p.steps.some(s => s.id === event.step.id)
                      ? p.steps.map(s => (s.id === event.step.id ? event.step : s))
                      : [...p.steps, event.step],
                  },
              );
            else setPending(p => p && { ...p, answer: event.reset ? event.delta : p.answer + event.delta });
          },
          controller.signal,
        );
        if ('offer' in response) {
          // Nothing was sent or saved: the question stays on the page with the choice under it, and the box rests.
          const { offer, held } = response;
          setPending(p => {
            if (!p) return p;
            const { handed: _sentTo, held: _before, ...rest } = p;
            return { ...rest, steps: [], answer: '', offer, ...(held ? { held } : {}) };
          });
          announce(
            held
              ? `Frågan är inte skickad. Den ser ut att gälla ${held === 'person' ? 'din personal' : 'ett av dina ärenden'}. Välj i samtalet.`
              : `${offer.name} i ${offer.source} kan svara på det här. Välj i samtalet.`,
          );
          onOffer?.(offer, held);
          // The offer's first button takes the focus (`HandoverOffer`); the box does not take it back.
          offered = true;
          return;
        }
        // The message list was on the page while the answer was written, so the log speaks it once it is done (4.1.3).
        setConversation(conversationOf(response.thread));
        setLatest(response);
        setPending(null);
        onAnswered?.(response);
        // The answer's thread is the truth for the log (Frågor); a draft's or a proposal's thread for its card; the verbs about a chip may have changed.
        apply(response.thread);
        if (response.draft) apply(response.draft.thread);
        else if (response.forslag)
          void client
            .query({ ...threadQuery(response.forslag.threadId), staleTime: 0 })
            .then(apply)
            .catch(() => undefined);
        void client.invalidateQueries({ queryKey: keys.verbsAll });
      } catch (e) {
        setPending(null);
        const stopped = controller.signal.aborted;
        if (!stopped || abortReason.current === 'stop') setValue(v => v || raw);
        if (!stopped) setError(errorMessage(e, 'Frågan kunde inte ställas.'));
        else if (abortReason.current === 'stop') announce('Frågan avbröts. Den ligger kvar i rutan.');
      } finally {
        if (inflight.current === controller) inflight.current = null;
        busyRef.current = false;
        setBusy(false);
        if (!offered && (refocus?.() ?? true)) input.current?.focus();
      }
    },
    [announce, apply, client],
  );
  const performActions = useCallback(
    async (actions: ClewAction[]) => {
      setBusy(true);
      setError(null);
      try {
        const threads: Thread[] = [];
        for (const a of actions)
          threads.push(a.kind === 'dismiss' ? await api.dismiss(a.threadId) : await api.snooze(a.threadId));
        threads.forEach(apply);
        setLatest(l => (l ? { ...l, clewActions: [] } : l));
        setDone({
          text:
            actions.length === 1
              ? `Klart. ${actions[0]!.kind === 'dismiss' ? 'Ärendet är avfärdat och ligger under Klart.' : 'Ärendet tas upp i morgon 06:00.'}`
              : 'Klart. Båda är gjorda.',
          undo: async () => {
            for (const a of actions) apply(await api.reopen(a.threadId));
            setDone({ text: 'Ångrat. Ärendet är tillbaka under Behöver dig.' });
          },
        });
      } catch (e) {
        setError(errorMessage(e, 'Något gick fel.'));
      } finally {
        setBusy(false);
        input.current?.focus();
      }
    },
    [apply],
  );
  const cancelActions = useCallback(() => setLatest(l => (l ? { ...l, clewActions: [] } : l)), []);
  const makeCard = useCallback(
    async (messageId: string) => {
      if (!conversation) return;
      setBusy(true);
      setError(null);
      try {
        const { output } = await api.runCapability('clew.cardFromAnswer', {
          conversationId: conversation.id,
          messageId,
        });
        const thread = await api.thread((output as { threadId: string }).threadId);
        apply(thread);
        setDone({
          text: `Klart. Ärendet "${thread.title}" ligger under Behöver dig. Knappen i ärendet öppnar källan.`,
        });
      } catch (e) {
        setError(errorMessage(e, 'Ärendet kunde inte skapas.'));
      } finally {
        setBusy(false);
        input.current?.focus();
      }
    },
    [conversation, apply],
  );
  return {
    conversation,
    setConversation,
    latest,
    setLatest,
    pending,
    done,
    setDone,
    busy,
    error,
    setError,
    value,
    setValue,
    input,
    abortTurn,
    reset,
    send,
    performActions,
    cancelActions,
    makeCard,
  };
}
