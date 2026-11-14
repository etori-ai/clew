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
  /** The transcript is on the page in place of the stream. */
  open: boolean;
  value: string;
  verbs: Verb[];
  input: RefObject<ChatComposerInputHandle | null>;
  /**
   * A conversation's own box is on the page (`/conversations/<id>`). "Lägg till i samtalet" is offered only then (D112
   * item 7): everywhere else an opened thing has its own box in the panel, which asks about that thing.
   */
  hasBox: boolean;
  /** The box says it is on the page while it is mounted; the returned function says it has gone. */
  claimBox(): () => void;
  setValue(value: string): void;
  addChip(chip: ChipRef): void;
  removeChip(ref: string): void;
  /** An object picked through the `@` trigger: its token sits in the field, its label is kept for the request. */
  rememberObject(object: ClewObject): void;
  submit(raw: string, from?: AskFrom): Promise<void>;
  ask(text: string, from?: AskFrom): void;
  /** Stoppa (D36): the turn is aborted, nothing is saved, and the question goes back in the box. */
  stop(): void;
  performActions(actions: ClewAction[]): Promise<void>;
  cancelActions(): void;
  /** "Lägg under Behöver dig" under a cited answer (D26): the sources become a card under Behöver dig; nothing is executed. */
  makeCard(messageId: string): Promise<void>;
  openConversation(threadId: string): Promise<void>;
  newConversation(): void;
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
}
const noop = () => undefined;
const never = async () => undefined;
const EMPTY_VERBS: Verb[] = [];
const EMPTY_CHIPS: ChipRef[] = [];
const EMPTY_REFS: string[] = [];
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
  handed: null,
  handTo: noop,
  leaveHandover: noop,
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

/** One question on its way: what was typed, what goes with it, the conversation it continues, and what the host hears. */
interface Send {
  raw: string;
  text: string;
  chips: Chip[];
  /** The conversation the question continues; null starts a new one. */
  current: Conversation | null;
  /** The assistant of another system the question goes to; absent, Clew's own answers. */
  handed?: Handed | undefined;
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
 * question goes back in the box; a turn left behind (another conversation, another thing) is stopped and nothing goes
 * back. Every thread an answer carries goes into the cache (D33), the same path as a card's own action. The landing's
 * conversation and the conversation about a thing in the panel (D112 item 7) are this one machinery twice.
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
    if (!inflight.current) return;
    abortReason.current = reason;
    inflight.current.abort();
  }, []);
  // Leaving the page stops the turn too: an answer must not pull the person back to a conversation they left.
  useEffect(() => () => inflight.current?.abort(), []);
  const send = useCallback(
    async ({ raw, text, chips, current, handed, onStart, onAnswered, refocus }: Send) => {
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
      setPending({ text, chips, at: new Date().toISOString(), steps: [], answer: '', ...(handed ? { handed } : {}) });
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
          },
          event => {
            if (event.type === 'step')
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

/**
 * The conversation (D31, D50): one state for the box and the transcript, held above the pages so a question asked on Hem
 * is the same conversation when the transcript takes the column. The transcript is on the page at `/` and at
 * `/conversations/:id`; `/conversations/new` is a conversation on its way, asked from another page and not yet answered.
 * Sending puts the transcript on the page; the box keeps focus throughout and sending never moves it. Chips travel in the
 * drawer and stay across turns; the text is cleared. Esc or "Stäng samtalet" leads back to where the conversation was
 * asked, and the conversation is kept under Samtal in the menu. A question about a thing opened beside a page is the
 * thing's own conversation (`ThingConversationProvider`), drawn in the panel.
 */
export function ConversationProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const routeId = useMatch('/conversations/:conversationId')?.params.conversationId ?? null;
  const conversationId = routeId && routeId !== 'new' ? routeId : null;
  // The transcript belongs to the landing and to a conversation's own address; every other page keeps its column.
  const here = location.pathname === '/' || routeId !== null;
  const where = useRef({ onRoute: false, here: true });
  where.current = { onRoute: routeId !== null, here };
  // Where "Stäng samtalet" leads: the page the conversation was asked from, else the landing.
  const origin = useRef<string | null>(null);
  const onConversation = useCallback(
    (id: string | null) => {
      if (id)
        navigate(`/conversations/${id}${panelSearch(window.location.search)}`, {
          replace: window.location.pathname === '/conversations/new',
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
      announce(`Du pratar nu med ${assistant.name} i ${assistant.source}. Det du skriver skickas dit.`);
      input.current?.focus();
    },
    [announce, input],
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
  // The transcript is on the page from the moment a question is sent: the question and its pending answer are drawn at once (D36).
  const open = shown && here && (!!conversation || !!pending);
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
    if (!shownRef.current) return;
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
  const newConversation = useCallback(() => {
    abortTurn('leave');
    // A new conversation is with Clew's own assistant until the person picks another.
    setHanded(null);
    setConversation(null);
    setLatest(null);
    setDone(null);
    setValue('');
    setShown(false);
    origin.current = null;
    if (where.current.onRoute) navigate('/');
    input.current?.focus();
  }, [navigate, abortTurn, setConversation, setLatest, setDone, setValue, input]);
  const client = useQueryClient();
  const openConversation = useCallback(
    async (threadId: string) => {
      abortTurn('leave');
      try {
        const t = await client.query(threadQuery(threadId));
        setConversation(conversationOf(t));
        // A conversation that was handed to another system's assistant opens still talking to it, and says so.
        setHanded(t.handover ? { id: t.handover.assistant, name: t.handover.name, source: t.handover.source } : null);
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
  // The route names the conversation: arriving at /conversations/:id (a link, the back button, a reload) puts the transcript on the page.
  const routeConversation = useRef<string | null>(null);
  useEffect(() => {
    if (conversationId && conversationId !== conversation?.id) void openConversation(conversationId);
    else if (conversationId && !shown) setShown(true);
    // Leaving /conversations/:id by the back button brings the stream back; the conversation stays under Samtal.
    if (!conversationId && routeConversation.current && shown) setShown(false);
    routeConversation.current = conversationId;
  }, [conversationId]);
  // Another page takes the column: the turn on its way is stopped, as leaving the page always did, and nothing pulls the person back.
  useEffect(() => {
    if (!here && shownRef.current) {
      abortTurn('leave');
      setShown(false);
    }
  }, [here, abortTurn]);
  // `/conversations/new` with nothing on its way (a reload, a stopped first question) is the landing, with the question back in the box.
  useEffect(() => {
    if (routeId === 'new' && !pending && !conversation) navigate('/', { replace: true });
  }, [routeId, pending, conversation, navigate]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // ⌘K is "Nytt samtal" from anywhere (the canvas's H3 item 1): in a conversation it starts a new one, elsewhere it takes the focus to the box.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (shownRef.current) newConversation();
        else focus();
      }
      // Esc inside a dialog, a menu or the `@` list is theirs (the D29 picker, the pile menu); only a bare Esc closes the conversation.
      else if (
        e.key === 'Escape' &&
        !document.activeElement?.closest('[role="dialog"], [role="menu"], [role="listbox"], dialog')
      )
        close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [focus, close, newConversation]);

  const submit = useCallback(
    async (raw: string, from?: AskFrom) => {
      const text = plainText(raw);
      const used = [
        ...new Map(
          [
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
      await send({
        raw,
        text,
        // To another system's assistant the person's words go alone: nothing of the conversation follows them.
        chips: handed ? [] : used.map(c => ({ ref: c.ref, kind: c.kind, label: c.label }) as Chip),
        current,
        handed: handed ?? undefined,
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
        },
      });
    },
    [chips, conversation, handed, send, onConversation, navigate],
  );
  const ask = useCallback((text: string, from?: AskFrom) => void submit(text, from), [submit]);
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
      handed,
      handTo,
      leaveHandover,
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
      handed,
      handTo,
      leaveHandover,
    ],
  );
  return <ConversationContext.Provider value={state}>{children}</ConversationContext.Provider>;
}

/**
 * What a thing in the panel is asked about (D112 item 7): a key that names the thing (`thread:<id>`, a view and its
 * input, a calendar entry, the page itself), the words the box uses for it, the chips that go with every question so
 * the answer is about it, and the panel's part of the conversation page's address, where the thing is the transcript's
 * artifact (`/conversations/<id>` with it beside).
 */
export interface ThingSubject {
  key: string;
  label: string;
  chips: ChipRef[];
  search: string;
}
interface ThingConversations {
  /** The thing the conversation held now is about, or null before anything was asked. */
  key: string | null;
  turns: Turns;
  ask(subject: ThingSubject, raw: string): Promise<void>;
  /** The thing on screen is not the one asked about: a turn still on its way is stopped and nothing is saved. */
  leave(): void;
}
const ThingContext = createContext<ThingConversations | null>(null);

/**
 * The conversation about the thing in the panel (D112 item 7), above the pages so it follows the thing from one page to
 * another (Att göra's item opened as its page continues the same exchange). One at a time: asking about another thing
 * starts a new conversation, and the earlier one stays under Samtal in the rail. It is the landing's turn machinery
 * (`useTurns`), the same API, the same transcript and the same box; only where it is drawn differs.
 */
export function ThingConversationProvider({ children }: { children: ReactNode }) {
  const turns = useTurns(noop);
  const [key, setKey] = useState<string | null>(null);
  const keyRef = useRef<string | null>(null);
  keyRef.current = key;
  const { send, conversation, abortTurn, setError } = turns;
  const ask = useCallback(
    async (subject: ThingSubject, raw: string) => {
      const continuing = keyRef.current === subject.key ? conversation : null;
      await send({
        raw,
        text: plainText(raw),
        chips: subject.chips.map(c => ({ ref: c.ref, kind: c.kind, label: c.label }) as Chip),
        current: continuing,
        onStart: () => {
          keyRef.current = subject.key;
          setKey(subject.key);
        },
        // The box keeps the focus only while the panel is still about the thing asked about.
        refocus: () => keyRef.current === subject.key,
      });
    },
    [send, conversation],
  );
  const leave = useCallback(() => {
    abortTurn('leave');
    setError(null);
  }, [abortTurn, setError]);
  const value = useMemo(() => ({ key, turns, ask, leave }), [key, turns, ask, leave]);
  return <ThingContext.Provider value={value}>{children}</ThingContext.Provider>;
}

/** The thing's conversation as the panel reads it, in the shape the box and the transcript already read. */
export type ThingConversation = ConversationState & {
  /** A conversation about this thing exists or is on its way: the thing's facts fold (D112 item 7). */
  running: boolean;
};
/**
 * The conversation about `subject`, for the panel to provide to its box and transcript. A conversation about another
 * thing is not drawn here: a new thing starts with an empty transcript, and a turn still on its way about the previous
 * one is stopped (nothing is saved), as leaving the page stops it. The messages are read from the cache as well, so an
 * exchange continued on the conversation's own page is up to date when the person comes back to the thing.
 */
export function useThingConversation(subject: ThingSubject | null): ThingConversation {
  const things = useContext(ThingContext);
  const active = !!things && !!subject && things.key === subject.key;
  const key = subject?.key ?? null;
  useEffect(() => {
    // Another thing in the panel's place stops the turn about the previous one; closing the panel lets it finish, so
    // the exchange is kept under Samtal and is there when the thing is opened again.
    if (things && key !== null && things.key !== null && things.key !== key) things.leave();
  }, [key]);
  const turns = things?.turns;
  const own = active ? (turns?.conversation ?? null) : null;
  const live = useQuery({ ...threadQuery(own?.id ?? ''), enabled: !!own });
  const conversation: Conversation | null =
    own && live.data && live.data.messages.length > own.messages.length
      ? { id: own.id, title: live.data.title, messages: live.data.messages }
      : own;
  const pending = active ? (turns?.pending ?? null) : null;
  const ask = things?.ask;
  const submit = useCallback(
    async (raw: string) => {
      if (subject && ask) await ask(subject, raw);
    },
    [subject, ask],
  );
  return useMemo<ThingConversation>(
    () => ({
      chips: EMPTY_CHIPS,
      chipped: EMPTY_REFS,
      conversation,
      latest: active ? (turns?.latest ?? null) : null,
      pending,
      done: active ? (turns?.done ?? null) : null,
      busy: turns?.busy ?? false,
      error: active ? (turns?.error ?? null) : null,
      open: !!conversation || !!pending,
      value: turns?.value ?? '',
      verbs: EMPTY_VERBS,
      input: turns?.input ?? { current: null },
      hasBox: false,
      claimBox: () => noop,
      setValue: turns?.setValue ?? noop,
      addChip: noop,
      removeChip: noop,
      rememberObject: noop,
      submit,
      ask: (text: string) => void submit(text),
      stop: () => turns?.abortTurn('stop'),
      performActions: turns?.performActions ?? never,
      cancelActions: turns?.cancelActions ?? noop,
      makeCard: turns?.makeCard ?? never,
      openConversation: never,
      newConversation: noop,
      close: noop,
      focus: () => turns?.input.current?.focus(),
      setThreadListener: noop,
      // The box beside a thing asks Clew about that thing; it is never handed to another system's assistant.
      handed: null,
      handTo: noop,
      leaveHandover: noop,
      running: !!conversation || !!pending,
    }),
    [conversation, active, turns, pending, submit],
  );
}
/** The box beside the thing takes the focus (Att göra's "Fråga Clew" with an item already open in the reading pane). */
export function useFocusThingBox(): () => void {
  const things = useContext(ThingContext);
  return useCallback(() => things?.turns.input.current?.focus(), [things]);
}
