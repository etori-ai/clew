import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import type {
  Chip,
  ClewObject,
  ConversationResponse,
  ConversationInput,
  HandoverAssistant,
  OpenThing,
  Verb,
  Thread,
} from '@clew/contracts';
import { useLocation, useMatch, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAnnounce, type ChatComposerInputHandle } from '@clew/ui';
import { api } from '../../api';
import { errorMessage } from '../../query-policy';
import { assistantQuery, threadQuery, verbsQuery } from '../../queries';
import { panelSearch } from '../../panel-address';
import { ASSISTANT_PARAM } from '../../conversation-about';
import { applyThread } from '../../thread-cache';
import {
  keyFor,
  writtenUnder,
  type Unanswered,
  useTurns,
  type ClewAction,
  type Conversation,
  type Done,
  type Handed,
  type PendingTurn,
} from './turns';

/** A chip as the page hands it to the composer (D12): the object's ref, kind and label, plus its card when it has one. */
export interface ChipRef {
  ref: string;
  kind: Chip['kind'];
  label: string;
  threadId?: string;
  /**
   * The thing stands open in the pane beside the transcript now: the question says so (`ConversationInput.beside`), so
   * the assistant reads "the open item" as it. Never set on what the person added to the box.
   */
  beside?: true;
}
export type { ClewAction, Conversation, Handed, PendingTurn } from './turns';
/**
 * Where a question was asked when it was not asked in a conversation (D50): what the page asks about as chips for the
 * question, and the panel's part of the address the conversation opens at, so what the person was looking at is beside
 * the transcript. Asking from it also marks the page as the one "Stäng samtalet" leads back to.
 */
export interface AskFrom {
  chips: ChipRef[];
  search: string;
  /**
   * Answered where it is asked (D138 items 2 and 9): Hem's line, under which the answer stands as a card. The column
   * stays Hem's and nothing navigates; while the card stands, the line's next question continues its conversation.
   * Clew answers it itself (`own`), as beside a page: the card has no room for another system's assistant.
   */
  inPlace?: true;
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
  done: Done;
  busy: boolean;
  error: string | null;
  /**
   * Why the box does not send now, or null when it does: the panel's question is starting this conversation (WD-L5),
   * and a question from the box before it has an id would start a second one. The box keeps what is typed.
   */
  waiting: string | null;
  /**
   * The conversation takes the column: on its own page (`/conversations/<id>`, and `/conversations/new` before anything
   * is asked, D126 rule 5). A question asked on Hem's line is answered under it (`inPlace`) and never takes the column.
   */
  open: boolean;
  /**
   * The conversation is answered under the line it was asked on (`AskFrom.inPlace`, D138 item 9): its newest exchange,
   * or the turn on its way, stands there as a card until it is closed (`closeInPlace`) or another conversation is opened
   * or started. The conversation itself is kept under Samtal as any other.
   */
  inPlace: boolean;
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
   * `thing` is a person, a unit or a record beside it, told to the server as what stands open (D136 item 1).
   */
  submit(raw: string, from?: AskFrom, about?: ChipRef[], thing?: OpenThing): Promise<void>;
  ask(text: string, from?: AskFrom, about?: ChipRef[], thing?: OpenThing): void;
  /**
   * Stoppa (D36): the turn is aborted and the question goes back in the box, unless the turn was written before it
   * stopped (a proposal already made into an item, WD-L3): then the written turn is drawn and nothing goes back.
   */
  stop(): void;
  performActions(actions: ClewAction[]): Promise<void>;
  cancelActions(): void;
  /** "Lägg under Behöver dig" under a cited answer (D26): the sources become a card under Behöver dig; nothing is executed. */
  makeCard(messageId: string): Promise<void>;
  openConversation(threadId: string): Promise<void>;
  /**
   * A new conversation with Clew: nothing in it, nothing in the drawer. `from` is the page "Fråga assistenten" was pressed on,
   * where Esc leads back to; `stay` keeps the address (the caller navigates to the new conversation's page itself).
   */
  newConversation(options?: { from?: string; stay?: boolean }): void;
  close(): void;
  /**
   * "Stäng" on the answer under the line (D138 item 9): the card goes and the conversation stays where it is. A turn on
   * its way is stopped and its question goes back in the line, as closing a conversation does; the caller moves the focus.
   */
  closeInPlace(): void;
  focus(): void;
  /** The page that shows cards hears of a thread the conversation changed before the cache is written, to hand the focus on (2.4.3). */
  setThreadListener(listener: ((thread: Thread) => void) | null): void;
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
  /** Stoppa in the panel (WD-L5): the question to the other system's assistant is aborted and goes back in its box. */
  stopAside(): void;
  /** Lets go of a question the panel held or failed to send. */
  dropAside(): void;
  /**
   * Puts a question from the panel to Clew, the person's own press: one the assistant answered or could not, or one
   * Clew held on its way out.
   */
  askClew(text: string): void;
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
/**
 * The conversation that does nothing: what a component reads outside any provider, and what the conversation beside a
 * page (`usePageConversation`, D141) starts from before it puts its own turns over it, so that everything route-bound
 * (the drawer, the panel's assistant, a new conversation, closing) stays inert in the pane.
 */
export const INERT_CONVERSATION: ConversationState = {
  chips: [],
  chipped: [],
  conversation: null,
  latest: null,
  pending: null,
  done: null,
  busy: false,
  error: null,
  waiting: null,
  open: false,
  inPlace: false,
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
  closeInPlace: noop,
  focus: noop,
  setThreadListener: noop,
  aside: null,
  asideError: null,
  askAside: async () => false,
  stopAside: noop,
  dropAside: noop,
  askClew: noop,
  acceptOffer: noop,
  declineOffer: noop,
};
export const ConversationContext = createContext<ConversationState>(INERT_CONVERSATION);
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
 * thing and no "Fråga assistenten" is offered; the thing is drawn alone, as before.
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
  /** The one of the chips that stands open beside the transcript. */
  beside?: string;
  /** The person, the unit or the record beside the transcript (D136 item 1). */
  thing?: OpenThing;
  current: string | null;
  from?: AskFrom;
}
/** The address of a conversation not asked yet: "Fråga assistenten" lands here with the thing beside it (D126 rule 5). */
const NEW = '/conversations/new';
/** Why the box waits while the panel's question starts the conversation (WD-L5). */
const WAIT_FOR_ASIDE =
  'Frågan i sidofältet startar samtalet. Skicka din fråga när den har fått svar, så hamnar båda i samma samtal.';
/**
 * The conversation (D31, D50, D126, D138): one state for the box and the transcript, held above the pages so a question
 * asked on Hem is the same conversation when it is opened as a conversation. On Hem the answer stands under the line
 * (`inPlace`, D138 item 9), and the transcript is on the conversation's own page, `/conversations/:id`; the card under
 * the line is still there when the person comes back to Hem. `/conversations/new` is a conversation not asked yet,
 * where "Fråga assistenten" lands with the thing beside it and nothing is sent until the person writes. The box keeps
 * focus throughout and sending never moves it. Chips travel in the drawer and stay across turns; the text is cleared.
 * Esc leads back to where the conversation was asked, and the conversation is kept under Samtal.
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
    openId,
    setOpenId,
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
  // The panel beside the conversation: one question at a time to another system's assistant, in the same conversation.
  const [aside, setAside] = useState<AsideTurn | null>(null);
  const [asideError, setAsideError] = useState<string | null>(null);
  const asideBusy = useRef(false);
  // The panel's question in flight and why it would be aborted (WD-L5), as for the box's turn: Stoppa puts it back in
  // the panel's box; leaving the conversation (another one, a new one, closing it, another page) lets it go.
  const asideFlight = useRef<AbortController | null>(null);
  const asideReason = useRef<'stop' | 'leave'>('stop');
  const asideUnanswered = useRef<Unanswered | null>(null);
  const stopAside = useCallback((reason: 'stop' | 'leave' = 'stop') => {
    if (!asideFlight.current) return;
    asideReason.current = reason;
    asideFlight.current.abort();
  }, []);
  // The conversation on the page now, for an answer that comes back after the person may have moved on.
  const openNow = useRef<string | null>(null);
  openNow.current = openId;
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
  // A conversation opened again (a reload, a row in the rail) gets back the list its last question pointed at (the
  // product owner, 2026-11-16): the drawer is the browser's, so "Att göra" was gone after a reload and a follow-up
  // had no card. Once per conversation, and only into an empty drawer, so a chip the person removed stays removed.
  const seeded = useRef<string | null>(null);
  useEffect(() => {
    if (!conversation || seeded.current === conversation.id) return;
    seeded.current = conversation.id;
    const last = conversation.messages.filter(m => m.role === 'user').at(-1);
    const lists = (last?.meta?.chips ?? []).filter(c => c.kind === 'capability');
    if (lists.length)
      setChips(list => (list.length ? list : lists.map(c => ({ ref: c.ref, kind: c.kind, label: c.label }))));
  }, [conversation]);
  const announce = useAnnounce();
  const [shown, setShown] = useState(false);
  // The conversation answered under Hem's line (D138 item 9): the line continues it while its card stands.
  const [inPlace, setInPlace] = useState(false);
  const inPlaceRef = useRef(false);
  inPlaceRef.current = inPlace;
  const inline = useMemo(() => refsIn(value), [value]);
  const chipped = useMemo(() => [...new Set([...chips.map(c => c.ref), ...inline])], [chips, inline]);
  const plain = plainText(value);
  // A conversation's page is the conversation, asked or not. A conversation answered on the page it was asked on keeps
  // the column only where `shown` says so; Hem's line answers under itself and never sets it (D138 item 9).
  const open = onRoute || (shown && here && (!!conversation || !!pending));
  const openRef = useRef(false);
  openRef.current = open;
  // One chip in the drawer and nothing typed: the verbs about it, from its actions and Clew's standard actions.
  const chipThread = chips.length === 1 && !plain && chips[0]!.threadId ? chips[0]!.threadId : null;
  const verbsQ = useQuery({ ...verbsQuery(chipThread ?? ''), enabled: !!chipThread });
  const verbs = chipThread ? (verbsQ.data?.verbs ?? EMPTY_VERBS) : EMPTY_VERBS;

  // While Clew asks where a question should go, the offer's first button has the focus (`HandoverOffer`): a page that
  // gives the box the focus as it arrives does not take it from the offer.
  const focus = useCallback(() => {
    if (offered.current) return;
    input.current?.focus();
  }, [input]);
  // Esc reaches here after a dialog or a menu has already taken it; with nothing open there is nothing to close and focus stays where it is.
  const shownRef = useRef(false);
  shownRef.current = shown;
  const close = useCallback(() => {
    if (!shownRef.current && !where.current.onRoute) return;
    abortTurn('stop');
    stopAside('leave');
    setShown(false);
    setError(null);
    onConversation(null);
    input.current?.focus();
  }, [onConversation, abortTurn, stopAside, setError, input]);
  const closeInPlace = useCallback(() => {
    abortTurn('stop');
    setInPlace(false);
    setError(null);
  }, [abortTurn, setError]);
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
      stopAside('leave');
      // A new conversation has nothing in its drawer.
      setOpenId(null);
      setLatest(null);
      setDone(null);
      setError(null);
      setValue('');
      setChips([]);
      setShown(false);
      setInPlace(false);
      origin.current = options?.from ?? null;
      if (where.current.onRoute && !options?.stay) navigate('/');
      input.current?.focus();
    },
    [navigate, abortTurn, stopAside, setOpenId, setLatest, setDone, setError, setValue, input],
  );
  const client = useQueryClient();
  // The conversation asked for last: one that is read after a later one was asked for is not drawn under its address,
  // and its failure is not said there.
  const opening = useRef<string | null>(null);
  /**
   * A conversation asked for by its address is the one on the page at once (WD-L6): nothing is drawn of it until its
   * thread is read (its shape meanwhile), and a question written while it is read continues it, never the one before.
   */
  const openConversation = useCallback(
    async (threadId: string) => {
      abortTurn('leave');
      stopAside('leave');
      opening.current = threadId;
      setOpenId(threadId);
      setLatest(null);
      setDone(null);
      setError(null);
      setShown(true);
      try {
        await client.query(threadQuery(threadId));
        if (opening.current !== threadId) return;
        setInPlace(false);
        input.current?.focus();
      } catch (e) {
        if (opening.current === threadId) setError(errorMessage(e, 'Samtalet kunde inte öppnas.'));
      }
    },
    [client, abortTurn, stopAside, setOpenId, setLatest, setDone, setError, input],
  );
  // The route names the conversation: arriving at /conversations/:id (a link, the back button, a reload) puts the
  // transcript on the page. Arriving at /conversations/new is a conversation not asked yet: whatever conversation was
  // held before is let go of, unless a question is on its way from Hem to this address.
  const wasOnRoute = useRef(false);
  useEffect(() => {
    if (conversationId && conversationId !== openId) void openConversation(conversationId);
    else if (onRoute && !shown) setShown(true);
    if (routeId === 'new' && !pending && openId) {
      opening.current = null;
      setOpenId(null);
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
      stopAside('leave');
      setShown(false);
    }
  }, [here, abortTurn, stopAside]);
  // The panel stands only beside a conversation's transcript, named by the address (`?assistant=`). Whatever takes it
  // away (Back to Hem, another page, its ✕ or Esc, another conversation) lets its question go (WD-L5): an answer is
  // never written where no panel shows it.
  const asideShown = onRoute && new URLSearchParams(location.search).has(ASSISTANT_PARAM);
  useEffect(() => {
    if (!asideShown) stopAside('leave');
  }, [asideShown, stopAside]);
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
  // The panel's question is on its way and the conversation it starts has no id yet (WD-L5): a question from the box now
  // would start a second conversation, so the box waits for it and says why.
  const waiting = !!aside && !aside.held && !openId ? WAIT_FOR_ASIDE : null;
  const waitingRef = useRef<string | null>(null);
  waitingRef.current = waiting;
  /** One question on its way to whoever answers it: Clew, or another system's assistant with nothing attached. */
  const dispatch = useCallback(
    async (
      question: Question,
      how: { to?: Handed | null; suggested?: boolean; own?: boolean; confirmed?: boolean },
    ) => {
      if (waitingRef.current) return;
      const { raw, text, chips: used, current, from } = question;
      // Answered under Hem's line (D138 item 9): decided when the question leaves, so closing the card while the answer
      // is on its way never turns it into a question that takes the person to the conversation's page.
      const inPlace = !!from?.inPlace;
      offered.current = null;
      await send({
        raw,
        text,
        // To another system's assistant the person's words go alone: nothing of the conversation follows them.
        chips: how.to ? [] : used,
        beside: how.to ? undefined : question.beside,
        thing: how.to ? undefined : question.thing,
        current,
        handed: how.to ?? undefined,
        ...(how.suggested ? { suggested: true } : {}),
        ...(how.own ? { own: true } : {}),
        ...(how.confirmed ? { confirmed: true } : {}),
        onOffer: (assistant, held) => {
          offered.current = { question, assistant, ...(held ? { held } : {}) };
        },
        ...(inPlace
          ? {
              // The line keeps the focus it has: nothing here moves it, and the provider's box is not on the page.
              refocus: () => false,
            }
          : {}),
        onStart: () => {
          // Asked on Hem's line (D138 item 9): the answer stands under the line, the column stays Hem's and the address
          // stays; the person never leaves what they asked about.
          if (inPlace) {
            setInPlace(true);
            // "Öppna som samtal" leads from here: closing that conversation leads back to Hem, not to wherever an
            // earlier conversation was asked from.
            origin.current = window.location.pathname + window.location.search;
            return;
          }
          // Any other new conversation is not the one under the line.
          if (!current) setInPlace(false);
          setShown(true);
          // Asked on Ny fråga, or anywhere else outside a conversation (D50): the conversation takes the column at once,
          // with what the page showed beside it, and the address it gets once answered keeps that beside it
          // (`onConversation`); "Stäng samtalet" leads back to the page as it stood.
          if (!current && from) {
            origin.current = window.location.pathname + window.location.search;
            if (!where.current.here) navigate(`/conversations/new${from.search}`);
          }
        },
        onAnswered: response => {
          if (!current && !inPlace) onConversation(response.conversationId);
          const to = response.thread.handover;
          if (response.assistant === 'handover' && to) {
            // The answer is that assistant's; the box stays Clew's, and the way on with the assistant is beside it.
            announce(`${to.name} i ${to.source} har svarat. Rutan skriver fortfarande till assistenten.`);
          }
        },
      });
    },
    [send, onConversation, navigate, announce],
  );
  const submit = useCallback(
    async (raw: string, from?: AskFrom, about?: ChipRef[], thing?: OpenThing) => {
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
      // landing is "Nytt samtal". An earlier conversation is continued from its own address, where its transcript is,
      // and from Hem's line while its answer stands under it (D138 item 9).
      const current = openRef.current || (from?.inPlace && inPlaceRef.current) ? openId : null;
      const beside = about?.find(c => c.beside)?.ref;
      await dispatch(
        {
          raw,
          text,
          chips: used.map(c => ({ ref: c.ref, kind: c.kind, label: c.label }) as Chip),
          ...(beside ? { beside } : {}),
          ...(thing ? { thing } : {}),
          current,
          ...(from ? { from } : {}),
        },
        // Clew answers under the line itself, as beside a page: the card has no room for another system's assistant.
        from?.inPlace ? { own: true } : {},
      );
    },
    [chips, openId, dispatch],
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
    (text: string, from?: AskFrom, about?: ChipRef[], thing?: OpenThing) => void submit(text, from, about, thing),
    [submit],
  );
  const dropAside = useCallback(() => {
    if (!asideBusy.current) setAside(null);
    setAsideError(null);
  }, []);
  /**
   * The panel's question (WD-L5). It can be stopped, and leaving the conversation stops it. Its answer lands in the
   * conversation it was asked in and nowhere else: the thread goes into the cache, where that conversation is drawn
   * from (WD-L6), and the page is given an address only while it is still the conversation not asked yet that the
   * question started. A question stopped or failed is read back by its key, as the box's turn is (WD-L3).
   */
  const askAside = useCallback(
    async (assistant: Handed, raw: string, confirmed?: boolean): Promise<boolean> => {
      const text = raw.replace(/\s+/g, ' ').trim();
      if (!text || asideBusy.current || busy) return false;
      const at = openRef.current ? openId : null;
      const question: ConversationInput = {
        text,
        ...(at ? { conversationId: at } : {}),
        assistant: assistant.id,
        side: true as const,
        ...(confirmed ? { confirmed: true as const } : {}),
      };
      const kept = keyFor(asideUnanswered.current, question);
      const { turn } = kept;
      asideUnanswered.current = null;
      const controller = new AbortController();
      asideFlight.current = controller;
      asideReason.current = 'stop';
      asideBusy.current = true;
      setAsideError(null);
      setAside({ assistant: assistant.id, text, at: new Date().toISOString(), answer: '' });
      announce(`Frågar ${assistant.name} …`);
      const left = () => controller.signal.aborted && asideReason.current === 'leave';
      const land = async (response: ConversationResponse) => {
        await applyThread(client, response.thread);
        setAside(null);
        if (left()) return;
        const started = !at && openNow.current === null && window.location.pathname === NEW;
        if (started) {
          setOpenId(response.thread.id);
          onConversation(response.conversationId);
        }
        // Said only while its conversation is the one on the page: one that lands while another is open, or none, is
        // in its conversation for when the person goes back to it, and is not spoken of here.
        if (!started && openNow.current !== response.thread.id) return;
        const answer = response.thread.messages.at(-1)?.meta?.handover;
        announce(
          answer?.failed
            ? `${assistant.name} svarade inte. Skriv frågan till assistenten om du vill ha svar där.`
            : `${assistant.name} har svarat i sidofältet.`,
        );
      };
      try {
        const response = await api.converseStream(
          { ...question, turn },
          event => {
            if (event.type === 'text')
              setAside(p => p && { ...p, answer: event.reset ? event.delta : p.answer + event.delta });
          },
          controller.signal,
        );
        if ('offer' in response) {
          // Clew held the question before it left: the panel asks where it should go.
          setAside(p => p && { ...p, answer: '', held: response.held ?? 'person' });
          announce('Frågan är inte skickad. Välj i sidofältet.');
          return true;
        }
        await land(response);
        return true;
      } catch (e) {
        const stopped = controller.signal.aborted;
        const written = left() ? null : await writtenUnder(turn, question);
        if (written && written !== 'different') {
          await land(written);
          return true;
        }
        setAside(null);
        if (left()) return false;
        asideUnanswered.current = written === 'different' ? null : kept;
        if (stopped) announce('Frågan avbröts. Den ligger kvar i rutan.');
        else setAsideError(errorMessage(e, 'Frågan kunde inte ställas.'));
        return false;
      } finally {
        if (asideFlight.current === controller) asideFlight.current = null;
        asideBusy.current = false;
      }
    },
    [announce, busy, client, openId, onConversation, setOpenId],
  );
  const askClew = useCallback(
    (text: string) => {
      setAside(null);
      void dispatch({ raw: text, text, chips: [], current: openRef.current ? openId : null }, { own: true });
    },
    [openId, dispatch],
  );
  const stop = useCallback(() => abortTurn('stop'), [abortTurn]);
  const stopPanel = useCallback(() => stopAside('stop'), [stopAside]);

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
      waiting,
      open,
      inPlace,
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
      closeInPlace,
      focus,
      setThreadListener,
      aside,
      asideError,
      askAside,
      stopAside: stopPanel,
      dropAside,
      askClew,
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
      waiting,
      open,
      inPlace,
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
      closeInPlace,
      focus,
      setThreadListener,
      aside,
      asideError,
      askAside,
      stopPanel,
      dropAside,
      askClew,
      acceptOffer,
      declineOffer,
    ],
  );
  return <ConversationContext.Provider value={state}>{children}</ConversationContext.Provider>;
}

/**
 * What "Fråga assistenten" asks about (D126 rule 5): a key that names the thing (`thread:<id>`, a view and its input, a
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
