import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type RefObject,
  type SetStateAction,
} from 'react';
import type {
  Chip,
  ClewObject,
  ConversationResponse,
  Handover,
  HandoverAssistant,
  ThreadMessage,
  TurnStep,
  Verb,
  Thread,
} from '@clew/contracts';
import { useLocation, useMatch, useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAnnounce, type ChatComposerInputHandle } from '@clew/ui';
import { api } from '../api';
import { errorMessage } from '../query-policy';
import { assistantQuery, threadQuery, verbsQuery } from '../queries';
import { keys } from '../query-keys';
import { useThreadAction } from '../mutations';
import { panelSearch } from '../panel-address';
import { applyThread } from '../thread-cache';

/** A chip as the page hands it to the composer (D12): the object's ref, kind and label, plus its card when it has one. */
export interface ChipRef {
  ref: string;
  kind: Chip['kind'];
  label: string;
  threadId?: string;
}
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
const conversationOf = (t: Pick<Thread, 'id' | 'title' | 'messages' | 'handover'>): Conversation => ({
  id: t.id,
  title: t.title,
  messages: t.messages,
  ...(t.handover ? { handover: t.handover } : {}),
});
/**
 * Where a question was asked when it was not asked in a conversation (D50): what the page asks about as chips for the
 * question, and the panel's part of the address the conversation opens at, so what the person was looking at is beside
 * the transcript. Asking from it also marks the page as the one "Stäng samtalet" leads back to.
 */
export interface AskFrom {
  chips: ChipRef[];
  search: string;
}
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
   * The assistant the question went to handed it back (D125 item 12): the answer on its way is Clew's own, under a
   * line that says so.
   */
  back?: Handed;
  /**
   * With `handed`: the person said yes to Clew's suggestion of that assistant (D126 item 6). The question already on
   * the page is the one sent on: it says so, and the suggestion has become one line under it.
   */
  suggested?: true;
}
/** The conversation's state and verbs, owned here (D31) and read by the row, the transcript, the page and every card. */
export interface ConversationState {
  /** The chips in the composer's drawer: what the person pointed at with "Lägg till i samtalet". */
  chips: ChipRef[];
  /** Every ref in the conversation right now, drawer chips and `@` tokens in the field, so a card can show "I samtalet". */
  chipped: string[];
  conversation: Conversation | null;
  latest: ConversationResponse | null;
  /** The question being answered right now, or null. */
  pending: PendingTurn | null;
  done: { text: string; undo?: () => Promise<void> } | null;
  busy: boolean;
  error: string | null;
  /**
   * The conversation takes the column: on its own page (`/conversations/<id>`, and `/conversations/new` before anything
   * is asked, D126 rule 5), or on Hem from the moment a question is sent there.
   */
  open: boolean;
  value: string;
  verbs: Verb[];
  input: RefObject<ChatComposerInputHandle | null>;
  /**
   * A conversation's own box is on the page (`/conversations/<id>`). "Lägg till i samtalet" is offered only then: no
   * other page has a box (D126 rule 5).
   */
  hasBox: boolean;
  /** The box says it is on the page while it is mounted; the returned function says it has gone. */
  claimBox(): () => void;
  setValue(value: string): void;
  addChip(chip: ChipRef): void;
  removeChip(ref: string): void;
  /** An object picked through the `@` trigger: its token sits in the field, its label is kept for the request. */
  rememberObject(object: ClewObject): void;
  /**
   * Sends a question. `about` is what the conversation's page is about by its address (the thing beside the
   * transcript): it goes with every question there, as the chips in the drawer do, without being drawn in the drawer.
   */
  submit(raw: string, from?: AskFrom, about?: ChipRef[]): Promise<void>;
  ask(text: string, from?: AskFrom, about?: ChipRef[]): void;
  /** Stoppa (D36): the turn is aborted, nothing is saved, and the question goes back in the box. */
  stop(): void;
  performActions(actions: ClewAction[]): Promise<void>;
  cancelActions(): void;
  /** "Lägg under Behöver dig" under a cited answer (D26): the sources become a card under Behöver dig; nothing is executed. */
  makeCard(messageId: string): Promise<void>;
  openConversation(threadId: string): Promise<void>;
  /**
   * A new conversation with Clew: nothing in it, nothing in the drawer. `from` is the page "Fråga Clew" was pressed on,
   * where Esc leads back to; `stay` keeps the address (the caller navigates to the new conversation's page itself).
   */
  newConversation(options?: { from?: string; stay?: boolean }): void;
  close(): void;
  focus(): void;
  /** The page that shows cards hears of a thread the conversation changed before the cache is written, to hand the focus on (2.4.3). */
  setThreadListener(listener: ((thread: Thread) => void) | null): void;
  /**
   * The assistant of another system the box talks to, or null for Clew's own. Sticky: once the person picks one, every
   * question goes to it, unchanged and alone, until they leave it or start a new conversation.
   */
  handed: Handed | null;
  /** The person picked an assistant of another system in the box's menu. */
  handTo(assistant: Handed): void;
  /** Back to Clew's own assistant; the conversation and what the other assistant said stay. */
  leaveHandover(): void;
  /**
   * The question on its way in the panel beside the conversation, to another system's assistant; null when none is.
   */
  aside: AsideTurn | null;
  asideError: string | null;
  /**
   * Asks that assistant in the panel: the words go there unchanged and alone, and the exchange is drawn in the panel.
   * Resolves false when nothing was sent, so the panel's box keeps what was typed.
   */
  askAside(assistant: Handed, text: string, confirmed?: boolean): Promise<boolean>;
  /** Lets go of a question the panel held or failed to send. */
  dropAside(): void;
  /**
   * Puts a question from the panel to Clew, the person's own press: one the assistant could not answer (`returnedBy`),
   * or one Clew held on its way out.
   */
  askClew(text: string, returnedBy?: string): void;
  /** Yes to Clew's suggestion: the question on the page goes to the suggested assistant, as it was written. */
  acceptOffer(): void;
  /** No to it: Clew answers the question itself. */
  declineOffer(): void;
}
/** A question asked in the panel while it is answered, or held before it left Clew (D125 item 13). */
export interface AsideTurn {
  assistant: string;
  text: string;
  at: string;
  answer: string;
  held?: 'person' | 'card';
}
const noop = () => undefined;
const never = async () => undefined;
const EMPTY_VERBS: Verb[] = [];
export const ConversationContext = createContext<ConversationState>({
  chips: [],
  chipped: [],
  conversation: null,
  latest: null,
  pending: null,
  done: null,
  busy: false,
  error: null,
  open: false,
  value: '',
  verbs: [],
  input: { current: null },
  hasBox: false,
  claimBox: () => noop,
  setValue: noop,
  addChip: noop,
  removeChip: noop,
  rememberObject: noop,
  submit: never,
  ask: noop,
  stop: noop,
  performActions: never,
  cancelActions: noop,
  makeCard: never,
  openConversation: never,
  newConversation: noop,
  close: noop,
  focus: noop,
  setThreadListener: noop,
  aside: null,
  asideError: null,
  askAside: async () => false,
  dropAside: noop,
  askClew: noop,
  handed: null,
  handTo: noop,
  leaveHandover: noop,
  acceptOffer: noop,
  declineOffer: noop,
});
export const useConversation = () => useContext(ConversationContext);
/**
 * Called by a conversation's own box: the page has that box for as long as one is mounted. A layout effect, so the
 * controls that depend on it are drawn or left out before the browser paints. The box moving between the landing and a
 * conversation's dock is one unmount and one mount in the same commit, so the count never reads none in between.
 */
export function useClaimBox(claims = true) {
  const { claimBox } = useConversation();
  useLayoutEffect(() => (claims ? claimBox() : undefined), [claimBox, claims]);
}
/** A conversation's title is the question as it was typed; as a title it starts with a capital. */
export const titled = (question: string) => question.charAt(0).toLocaleUpperCase('sv-SE') + question.slice(1);
/**
 * Whether the assistant may be asked here (D8, D112 item 7): a model is configured. Without one no box is drawn beside a
 * thing and no "Fråga Clew" is offered; the thing is drawn alone, as before.
 */
export function useModelConfigured(): boolean {
  return !!useQuery(assistantQuery).data?.configured;
}

const TOKEN = /@\[([a-z]+:[^\]]+)\]/g;
export const refsIn = (value: string) => [...value.matchAll(TOKEN)].map(m => m[1]!);
export const tokenValue = (ref: string) => `@[${ref}]`;
const plainText = (raw: string) => raw.replace(TOKEN, '').replace(/\s+/g, ' ').trim();

/** A question as the person asked it: kept whole so it can be sent again when Clew asks where it should go. */
interface Question {
  raw: string;
  text: string;
  chips: Chip[];
  current: Conversation | null;
  from?: AskFrom;
}
/** One question on its way: what was typed, what goes with it, the conversation it continues, and what the host hears. */
interface Send {
  raw: string;
  text: string;
  chips: Chip[];
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
  /** The assistant that could not answer this question in the panel; the person put it to Clew. */
  returnedBy?: string | undefined;
  /** The assistant handed the question back while the turn runs: the host gives the box back to Clew and says so. */
  onHandedBack?: (assistant: Handed) => void;
  /** Clew suggests another system's assistant for this question: the host hears it and asks the person. */
  onOffer?: (assistant: HandoverAssistant, held?: 'person' | 'card') => void;
  /** The question is drawn: the host puts the transcript where it belongs. */
  onStart?: () => void;
  /** The written turn has come back, before the cache is written. */
  onAnswered?: (response: ConversationResponse) => void;
  /** Whether the box takes the focus back when the turn has ended; it does unless the host says otherwise. */
  refocus?: () => boolean;
}
/** The turn machinery a box and its transcript share: one conversation, its turn on its way, and what an answer offers. */
interface Turns {
  conversation: Conversation | null;
  setConversation: Dispatch<SetStateAction<Conversation | null>>;
  latest: ConversationResponse | null;
  setLatest: Dispatch<SetStateAction<ConversationResponse | null>>;
  pending: PendingTurn | null;
  done: ConversationState['done'];
  setDone: Dispatch<SetStateAction<ConversationState['done']>>;
  busy: boolean;
  error: string | null;
  setError: Dispatch<SetStateAction<string | null>>;
  value: string;
  setValue: Dispatch<SetStateAction<string>>;
  input: RefObject<ChatComposerInputHandle | null>;
  abortTurn(reason: 'stop' | 'leave'): void;
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
function useTurns(onThreadChange: (thread: Thread) => void): Turns {
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
  const [done, setDone] = useState<ConversationState['done']>(null);
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
  // Leaving the page stops the turn too: an answer must not pull the person back to a conversation they left.
  useEffect(() => () => inflight.current?.abort(), []);
  const send = useCallback(
    async ({
      raw,
      text,
      chips,
      current,
      handed,
      suggested,
      own,
      confirmed,
      returnedBy,
      onOffer,
      onHandedBack,
      onStart,
      onAnswered,
      refocus,
    }: Send) => {
      if (!text || busyRef.current) return;
      if (!current) {
        setConversation(null);
        setLatest(null);
      }
      const controller = new AbortController();
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
          {
            text,
            chips,
            ...(current ? { conversationId: current.id } : {}),
            ...(handed ? { assistant: handed.id } : {}),
            ...(handed && suggested ? { suggested: true as const } : {}),
            ...(own ? { own: true as const } : {}),
            ...(handed && confirmed ? { confirmed: true as const } : {}),
            ...(!handed && returnedBy ? { returnedBy } : {}),
          },
          event => {
            // The turn went to another system's assistant: what follows is drawn as that assistant's from its first word.
            if (event.type === 'handed') setPending(p => p && { ...p, handed: event.assistant, answer: '' });
            else if (event.type === 'handedBack') {
              // It handed the question back: from here the pending answer is Clew's, under the line that says so.
              setPending(p => {
                if (!p) return p;
                const { handed: _was, ...rest } = p;
                return { ...rest, back: event.assistant, steps: [], answer: '' };
              });
              onHandedBack?.(event.assistant);
            } else if (event.type === 'step')
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
        if (refocus?.() ?? true) input.current?.focus();
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
    send,
    performActions,
    cancelActions,
    makeCard,
  };
}

/** The address of a conversation not asked yet: "Fråga Clew" lands here with the thing beside it (D126 rule 5). */
const NEW = '/conversations/new';
/**
 * The conversation (D31, D50, D126): one state for the box and the transcript, held above the pages so a question asked
 * on Hem is the same conversation when the transcript takes the column. The transcript is on the page at `/` once a
 * question is sent there, and on the conversation's own page, `/conversations/:id`; `/conversations/new` is a
 * conversation not asked yet, where "Fråga Clew" lands with the thing beside it and nothing is sent until the person
 * writes. The box keeps focus throughout and sending never moves it. Chips travel in the drawer and stay across turns;
 * the text is cleared. Esc leads back to where the conversation was asked, and the conversation is kept under Samtal.
 */
export function ConversationProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const routeId = useMatch('/conversations/:conversationId')?.params.conversationId ?? null;
  const conversationId = routeId && routeId !== 'new' ? routeId : null;
  const onRoute = routeId !== null;
  // The transcript belongs to the landing and to a conversation's own address; every other page keeps its column.
  const here = location.pathname === '/' || onRoute;
  const where = useRef({ onRoute: false, here: true });
  where.current = { onRoute, here };
  // Where Esc leads: the page the conversation was asked from, else the landing.
  const origin = useRef<string | null>(null);
  const onConversation = useCallback(
    (id: string | null) => {
      // A new conversation's page keeps what it is about (the thing beside it, `?card=`, `?open=`) at its own address.
      const fresh = window.location.pathname === NEW;
      if (id)
        navigate(`/conversations/${id}${fresh ? window.location.search : panelSearch(window.location.search)}`, {
          replace: fresh,
        });
      else if (where.current.onRoute) {
        const back = origin.current ?? '/';
        origin.current = null;
        navigate(back);
      }
    },
    [navigate],
  );
  const listener = useRef<((thread: Thread) => void) | null>(null);
  const setThreadListener = useCallback((next: ((thread: Thread) => void) | null) => {
    listener.current = next;
  }, []);
  const onThreadChange = useCallback((thread: Thread) => {
    listener.current?.(thread);
  }, []);
  const turns = useTurns(onThreadChange);
  const {
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
    send,
    performActions,
    cancelActions,
    makeCard,
  } = turns;
  // How many conversation boxes are mounted (`useClaimBox`): state, not the input's ref, so the controls that add to the
  // box are drawn again when one comes or goes.
  const [boxes, setBoxes] = useState(0);
  const claimBox = useCallback(() => {
    setBoxes(n => n + 1);
    return () => setBoxes(n => n - 1);
  }, []);
  const hasBox = boxes > 0;
  const known = useRef(new Map<string, ChipRef>());
  const [chips, setChips] = useState<ChipRef[]>([]);
  const [handed, setHanded] = useState<Handed | null>(null);
  const announce = useAnnounce();
  const handTo = useCallback(
    (assistant: Handed) => {
      setHanded({ id: assistant.id, name: assistant.name, source: assistant.source });
      // The box's own status line says whom it now writes to, and is spoken as it appears: nothing more is announced.
      input.current?.focus();
    },
    [input],
  );
  const leaveHandover = useCallback(() => {
    setHanded(null);
    announce('Du pratar med Clew igen.');
    input.current?.focus();
  }, [announce, input]);
  const [shown, setShown] = useState(false);
  const inline = useMemo(() => refsIn(value), [value]);
  const chipped = useMemo(() => [...new Set([...chips.map(c => c.ref), ...inline])], [chips, inline]);
  const plain = plainText(value);
  // A conversation's page is the conversation, asked or not; on Hem the transcript takes the column from the moment a
  // question is sent: the question and its pending answer are drawn at once (D36).
  const open = onRoute || (shown && here && (!!conversation || !!pending));
  const openRef = useRef(false);
  openRef.current = open;
  // One chip in the drawer and nothing typed: the verbs about it, from its actions and Clew's standard actions.
  const chipThread = chips.length === 1 && !plain && chips[0]!.threadId ? chips[0]!.threadId : null;
  const verbsQ = useQuery({ ...verbsQuery(chipThread ?? ''), enabled: !!chipThread });
  const verbs = chipThread ? (verbsQ.data?.verbs ?? EMPTY_VERBS) : EMPTY_VERBS;

  const focus = useCallback(() => {
    input.current?.focus();
  }, [input]);
  // Esc reaches here after a dialog or a menu has already taken it; with nothing open there is nothing to close and focus stays where it is.
  const shownRef = useRef(false);
  shownRef.current = shown;
  const close = useCallback(() => {
    if (!shownRef.current && !where.current.onRoute) return;
    abortTurn('stop');
    setShown(false);
    setError(null);
    onConversation(null);
    input.current?.focus();
  }, [onConversation, abortTurn, setError, input]);
  const rememberObject = useCallback((o: ClewObject) => {
    known.current.set(o.ref, {
      ref: o.ref,
      kind: o.kind,
      label: o.label,
      ...(o.threadId ? { threadId: o.threadId } : {}),
    });
  }, []);
  // The box takes the focus from the pressed button, which rests as "I samtalet" (2.4.3). The control is drawn only
  // where a conversation's box is (`hasBox`), so adding never takes the person to another page.
  const addChip = useCallback(
    (chip: ChipRef) => {
      known.current.set(chip.ref, chip);
      setChips(list => (list.some(c => c.ref === chip.ref) ? list : [...list, chip]));
      input.current?.focus();
    },
    [input],
  );
  // The removed chip's neighbour takes the focus, or the field when the drawer is empty (2.4.3).
  const removeChip = useCallback(
    (ref: string) => {
      setChips(list => list.filter(c => c.ref !== ref));
      requestAnimationFrame(() => {
        const next = document.querySelector<HTMLElement>('[data-chip-remove]');
        (next ?? input.current)?.focus();
      });
    },
    [input],
  );
  const newConversation = useCallback(
    (options?: { from?: string; stay?: boolean }) => {
      abortTurn('leave');
      // A new conversation is with Clew's own assistant until the person picks another, and has nothing in its drawer.
      setHanded(null);
      setConversation(null);
      setLatest(null);
      setDone(null);
      setError(null);
      setValue('');
      setChips([]);
      setShown(false);
      origin.current = options?.from ?? null;
      if (where.current.onRoute && !options?.stay) navigate('/');
      input.current?.focus();
    },
    [navigate, abortTurn, setConversation, setLatest, setDone, setError, setValue, input],
  );
  const client = useQueryClient();
  const openConversation = useCallback(
    async (threadId: string) => {
      abortTurn('leave');
      try {
        const t = await client.query(threadQuery(threadId));
        setConversation(conversationOf(t));
        // A conversation that was handed to another system's assistant opens still talking to it, and says so, unless
        // that assistant handed it back or returned it (D125 item 12).
        // The box under the transcript is Clew's, always: another system's assistant is talked to beside it.
        setHanded(null);
        setLatest(null);
        setDone(null);
        setShown(true);
        input.current?.focus();
      } catch (e) {
        setError(errorMessage(e, 'Samtalet kunde inte öppnas.'));
      }
    },
    [client, abortTurn, setConversation, setLatest, setDone, setError, input],
  );
  // No conversation is named any more ("Ny fråga" in the rail, the back button to Hem): the box is Clew's again, as a
  // new conversation's always is until the person picks someone else.
  useEffect(() => {
    if (!conversationId) setHanded(null);
  }, [conversationId]);
  // The route names the conversation: arriving at /conversations/:id (a link, the back button, a reload) puts the
  // transcript on the page. Arriving at /conversations/new is a conversation not asked yet: whatever conversation was
  // held before is let go of, unless a question is on its way from Hem to this address.
  const wasOnRoute = useRef(false);
  useEffect(() => {
    if (conversationId && conversationId !== conversation?.id) void openConversation(conversationId);
    else if (onRoute && !shown) setShown(true);
    if (routeId === 'new' && !pending && conversation) {
      setConversation(null);
      setLatest(null);
      setDone(null);
    }
    // Leaving the conversation's page by the back button brings Hem back; the conversation stays under Samtal.
    if (!onRoute && wasOnRoute.current && shown) setShown(false);
    wasOnRoute.current = onRoute;
  }, [routeId]);
  // Another page takes the column: the turn on its way is stopped, as leaving the page always did, and nothing pulls the person back.
  useEffect(() => {
    if (!here && shownRef.current) {
      abortTurn('leave');
      setShown(false);
    }
  }, [here, abortTurn]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // ⌘K is "Nytt samtal" from anywhere (the canvas's H3 item 1): in a conversation it starts a new one, elsewhere it takes the focus to the box.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (shownRef.current) newConversation();
        else focus();
      }
      // Esc inside a dialog, a menu or the `@` list is theirs (the D29 picker, the pile menu); only a bare Esc closes the
      // conversation. A menu that closed on it has handed the focus back to its button by now, so its handled Esc is
      // known by `defaultPrevented` (the "Till:" menu on Ny fråga, D126 item 14).
      else if (
        e.key === 'Escape' &&
        !e.defaultPrevented &&
        !document.activeElement?.closest('[role="dialog"], [role="menu"], [role="listbox"], dialog')
      )
        close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [focus, close, newConversation]);

  // The question Clew's assistant suggested another system's assistant for, kept so the person's answer sends it again.
  const offered = useRef<{ question: Question; assistant: HandoverAssistant; held?: 'person' | 'card' } | null>(null);
  // Whether this turn's handback was already said while it ran.
  const saidBack = useRef(false);
  /** One question on its way to whoever answers it: Clew, or another system's assistant with nothing attached. */
  const dispatch = useCallback(
    async (
      question: Question,
      how: { to?: Handed | null; suggested?: boolean; own?: boolean; confirmed?: boolean; returnedBy?: string },
    ) => {
      const { raw, text, chips: used, current, from } = question;
      offered.current = null;
      saidBack.current = false;
      await send({
        raw,
        text,
        // To another system's assistant the person's words go alone: nothing of the conversation follows them.
        chips: how.to ? [] : used,
        current,
        handed: how.to ?? undefined,
        ...(how.suggested ? { suggested: true } : {}),
        ...(how.own ? { own: true } : {}),
        ...(how.confirmed ? { confirmed: true } : {}),
        ...(how.returnedBy ? { returnedBy: how.returnedBy } : {}),
        onOffer: (assistant, held) => {
          offered.current = { question, assistant, ...(held ? { held } : {}) };
        },
        onHandedBack: assistant => {
          // The box is Clew's again from this moment, while Clew is still writing its answer.
          saidBack.current = true;
          setHanded(null);
          announce(`${assistant.name} lämnade tillbaka frågan. Clew svarar, och du pratar med Clew igen.`);
        },
        onStart: () => {
          setShown(true);
          // Asked on Hem (D50): the transcript takes the column in place, and the address it gets once answered keeps
          // the card or view open beside it (`onConversation`). Asked elsewhere, the conversation takes the column at
          // once, with what the page showed beside it, and "Stäng samtalet" leads back to the page as it stood.
          if (!current && from) {
            origin.current = window.location.pathname + window.location.search;
            if (!where.current.here) navigate(`/conversations/new${from.search}`);
          }
        },
        onAnswered: response => {
          if (!current) onConversation(response.conversationId);
          const to = response.thread.handover;
          const last = response.thread.messages.at(-1)?.meta;
          // The assistant returned the conversation (D125 item 12): it handed the question back, which Clew then
          // answered, or it answered and considers the matter done. Either way the box is Clew's again.
          const back = last?.handedBack ?? (last?.handover?.returned ? last.handover : undefined);
          if (back) {
            setHanded(null);
            // A question handed back was said when it happened; said here only if that moment was not heard.
            if (!saidBack.current)
              announce(
                last?.handedBack
                  ? `${back.name} lämnade tillbaka frågan. Clew svarade, och du pratar med Clew igen.`
                  : `${back.name} är klar. Du pratar med Clew igen.`,
              );
          } else if (response.assistant === 'handover' && to) {
            // The answer is that assistant's; the box stays Clew's, and the way on with the assistant is beside it.
            announce(`${to.name} i ${to.source} har svarat. Rutan skriver fortfarande till Clew.`);
            setHanded(null);
          }
        },
      });
    },
    [send, onConversation, navigate, announce],
  );
  const submit = useCallback(
    async (raw: string, from?: AskFrom, about?: ChipRef[]) => {
      const text = plainText(raw);
      const used = [
        ...new Map(
          [
            ...(about ?? []),
            ...chips,
            ...(from?.chips ?? []),
            ...refsIn(raw)
              .map(r => known.current.get(r))
              .filter((c): c is ChipRef => !!c),
          ].map(c => [c.ref, c]),
        ).values(),
      ];
      // A question asked where no transcript is on the page starts a conversation of its own (D50): the box on the
      // landing is "Nytt samtal". An earlier conversation is continued from its own address, where its transcript is.
      const current = openRef.current ? conversation : null;
      await dispatch(
        {
          raw,
          text,
          chips: used.map(c => ({ ref: c.ref, kind: c.kind, label: c.label }) as Chip),
          current,
          ...(from ? { from } : {}),
        },
        { to: handed },
      );
    },
    [chips, conversation, handed, dispatch],
  );
  const acceptOffer = useCallback(() => {
    const o = offered.current;
    // Yes to Clew's suggestion, or "send it anyway" for a question Clew held: it goes as it was written.
    if (o)
      void dispatch(o.question, {
        to: { id: o.assistant.id, name: o.assistant.name, source: o.assistant.source },
        ...(o.held ? { confirmed: true } : { suggested: true }),
      });
  }, [dispatch]);
  const declineOffer = useCallback(() => {
    const o = offered.current;
    if (o) void dispatch(o.question, { own: true });
  }, [dispatch]);
  const ask = useCallback(
    (text: string, from?: AskFrom, about?: ChipRef[]) => void submit(text, from, about),
    [submit],
  );
  // The panel beside the conversation: one question at a time to another system's assistant, in the same conversation.
  const [aside, setAside] = useState<AsideTurn | null>(null);
  const [asideError, setAsideError] = useState<string | null>(null);
  const asideBusy = useRef(false);
  const dropAside = useCallback(() => {
    if (!asideBusy.current) setAside(null);
    setAsideError(null);
  }, []);
  const askAside = useCallback(
    async (assistant: Handed, raw: string, confirmed?: boolean): Promise<boolean> => {
      const text = raw.replace(/\s+/g, ' ').trim();
      if (!text || asideBusy.current || busy) return false;
      asideBusy.current = true;
      setAsideError(null);
      setAside({ assistant: assistant.id, text, at: new Date().toISOString(), answer: '' });
      announce(`Frågar ${assistant.name} …`);
      const current = openRef.current ? conversation : null;
      try {
        const response = await api.converseStream(
          {
            text,
            ...(current ? { conversationId: current.id } : {}),
            assistant: assistant.id,
            side: true as const,
            ...(confirmed ? { confirmed: true as const } : {}),
          },
          event => {
            if (event.type === 'text')
              setAside(p => p && { ...p, answer: event.reset ? event.delta : p.answer + event.delta });
          },
        );
        if ('offer' in response) {
          // Clew held the question before it left: the panel asks where it should go.
          setAside(p => p && { ...p, answer: '', held: response.held ?? 'person' });
          announce('Frågan är inte skickad. Välj i sidofältet.');
          return true;
        }
        setConversation(conversationOf(response.thread));
        setAside(null);
        void applyThread(client, response.thread);
        if (!current) onConversation(response.conversationId);
        const answer = response.thread.messages.at(-1)?.meta?.handover;
        announce(
          answer?.declined
            ? `${assistant.name} kunde inte svara. Du kan fråga Clew i stället.`
            : `${assistant.name} har svarat i sidofältet.`,
        );
        return true;
      } catch (e) {
        setAside(null);
        setAsideError(errorMessage(e, 'Frågan kunde inte ställas.'));
        return false;
      } finally {
        asideBusy.current = false;
      }
    },
    [announce, busy, client, conversation, onConversation, setConversation],
  );
  const askClew = useCallback(
    (text: string, returnedBy?: string) => {
      setAside(null);
      void dispatch(
        { raw: text, text, chips: [], current: openRef.current ? conversation : null },
        returnedBy ? { returnedBy } : { own: true },
      );
    },
    [conversation, dispatch],
  );
  const stop = useCallback(() => abortTurn('stop'), [abortTurn]);

  const state = useMemo<ConversationState>(
    () => ({
      chips,
      chipped,
      conversation,
      latest,
      pending,
      done,
      busy,
      error,
      open,
      value,
      verbs,
      input,
      hasBox,
      claimBox,
      setValue,
      addChip,
      removeChip,
      rememberObject,
      submit,
      ask,
      stop,
      performActions,
      cancelActions,
      makeCard,
      openConversation,
      newConversation,
      close,
      focus,
      setThreadListener,
      aside,
      asideError,
      askAside,
      dropAside,
      askClew,
      handed,
      handTo,
      leaveHandover,
      acceptOffer,
      declineOffer,
    }),
    [
      chips,
      chipped,
      conversation,
      latest,
      pending,
      done,
      busy,
      error,
      open,
      value,
      verbs,
      input,
      hasBox,
      claimBox,
      setValue,
      addChip,
      removeChip,
      rememberObject,
      submit,
      ask,
      stop,
      performActions,
      cancelActions,
      makeCard,
      openConversation,
      newConversation,
      close,
      focus,
      setThreadListener,
      aside,
      asideError,
      askAside,
      dropAside,
      askClew,
      handed,
      handTo,
      leaveHandover,
      acceptOffer,
      declineOffer,
    ],
  );
  return <ConversationContext.Provider value={state}>{children}</ConversationContext.Provider>;
}

/**
 * What "Fråga Clew" asks about (D126 rule 5): a key that names the thing (`thread:<id>`, a view and its input, a
 * calendar entry, a person), the words for it, the chips that go with the question so the answer is about it, and the
 * part of the conversation page's address that puts the thing beside the transcript (`?card=`, `?open=`, `?person=`;
 * empty when nothing stands beside it, a list or a range of rows going as its chips alone).
 */
export interface ThingSubject {
  key: string;
  label: string;
  chips: ChipRef[];
  search: string;
}
