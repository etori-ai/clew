import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { Chip, ClewObject, ConversationResponse, ThreadMessage, TurnStep, Verb, Thread } from '@clew/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAnnounce, type ChatComposerInputHandle } from '@clew/ui';
import { api } from '../api';
import { errorMessage } from '../query-policy';
import { threadQuery, verbsQuery } from '../queries';
import { keys } from '../query-keys';
import { useThreadAction } from '../mutations';

/** A chip as the page hands it to the composer (D12): the object's ref, kind and label, plus its card when it has one. */
export interface ChipRef { ref: string; kind: Chip['kind']; label: string; threadId?: string; }
export type ClewAction = ConversationResponse['clewActions'][number];
export interface Conversation { id: string; title: string; messages: ThreadMessage[]; }
/**
 * The turn on its way (D36): the question as sent, drawn at once under the earlier turns, the capabilities the answer
 * reads as they run, and the model's text so far. It gives way to the written turn when the answer is done.
 */
export interface PendingTurn { text: string; chips: Chip[]; at: string; steps: TurnStep[]; answer: string; }
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
  setValue(value: string): void;
  addChip(chip: ChipRef): void;
  removeChip(ref: string): void;
  /** An object picked through the `@` trigger: its token sits in the field, its label is kept for the request. */
  rememberObject(object: ClewObject): void;
  submit(raw: string): Promise<void>;
  ask(text: string): void;
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
}
const noop = () => undefined;
const never = async () => undefined;
const EMPTY_VERBS: Verb[] = [];
export const ConversationContext = createContext<ConversationState>({
  chips: [], chipped: [], conversation: null, latest: null, pending: null, done: null, busy: false, error: null, open: false, value: '', verbs: [], input: { current: null },
  setValue: noop, addChip: noop, removeChip: noop, rememberObject: noop, submit: never, ask: noop, stop: noop, performActions: never, cancelActions: noop, makeCard: never, openConversation: never, newConversation: noop, close: noop, focus: noop,
});
export const useConversation = () => useContext(ConversationContext);
/** A conversation's title is the question as it was typed; as a title it starts with a capital. */
export const titled = (question: string) => question.charAt(0).toLocaleUpperCase('sv-SE') + question.slice(1);

const TOKEN = /@\[([a-z]+:[^\]]+)\]/g;
export const refsIn = (value: string) => [...value.matchAll(TOKEN)].map(m => m[1]!);
export const tokenValue = (ref: string) => `@[${ref}]`;

type Props = {
  /** The conversation named by the route (`/conversations/:id`), or null. */
  conversationId: string | null;
  /** The page keeps the route in step: a new or reopened conversation gets its address, closing it returns to the stream. */
  onConversation: (id: string | null) => void;
  onThreadChange: (thread: Thread) => void;
  children: ReactNode;
};
/**
 * The conversation (D31): one state for the row and the transcript. Sending puts the transcript on the page in place of
 * the stream; the row keeps focus throughout and sending never moves it. Chips travel in the drawer and stay across turns;
 * the text is cleared. Esc or "Stäng samtalet" brings the stream back and the conversation is kept under Redan hanterat.
 */
export function ConversationProvider({ conversationId, onConversation, onThreadChange, children }: Props) {
  const input = useRef<ChatComposerInputHandle>(null);
  const announce = useAnnounce();
  const known = useRef(new Map<string, ChipRef>());
  const [chips, setChips] = useState<ChipRef[]>([]);
  const [value, setValue] = useState('');
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [latest, setLatest] = useState<ConversationResponse | null>(null);
  const [pending, setPending] = useState<PendingTurn | null>(null);
  // The turn in flight and why it would be aborted: Stoppa and closing put the question back in the box, a new or another conversation does not.
  const inflight = useRef<AbortController | null>(null);
  const abortReason = useRef<'stop' | 'leave'>('stop');
  const abortTurn = useCallback((reason: 'stop' | 'leave') => { if (!inflight.current) return; abortReason.current = reason; inflight.current.abort(); }, []);
  // Leaving the page stops the turn too: an answer must not pull the person back to a conversation they left.
  useEffect(() => () => inflight.current?.abort(), []);
  const [done, setDone] = useState<{ text: string; undo?: () => Promise<void> } | null>(null);
  // Every thread an answer carries goes into the cache (D33) through the page's `onThreadChange`, the same path as a card's action.
  const client = useQueryClient();
  const { apply } = useThreadAction({ onChange: onThreadChange });
  const inline = useMemo(() => refsIn(value), [value]);
  const chipped = useMemo(() => [...new Set([...chips.map(c => c.ref), ...inline])], [chips, inline]);
  const plain = value.replace(TOKEN, '').replace(/\s+/g, ' ').trim();
  // The transcript is on the page from the moment a question is sent: the question and its pending answer are drawn at once (D36).
  const open = shown && (!!conversation || !!pending);
  // One chip in the drawer and nothing typed: the verbs about it, from its actions and Clew's standard actions.
  const chipThread = chips.length === 1 && !plain && chips[0]!.threadId ? chips[0]!.threadId : null;
  const verbsQ = useQuery({ ...verbsQuery(chipThread ?? ''), enabled: !!chipThread });
  const verbs = chipThread ? verbsQ.data?.verbs ?? EMPTY_VERBS : EMPTY_VERBS;

  const focus = useCallback(() => { input.current?.focus(); }, []);
  // Esc reaches here after a dialog or a menu has already taken it; with nothing open there is nothing to close and focus stays where it is.
  const shownRef = useRef(false);
  shownRef.current = shown;
  const close = useCallback(() => { if (!shownRef.current) return; abortTurn('stop'); setShown(false); setError(null); onConversation(null); input.current?.focus(); }, [onConversation, abortTurn]);
  const rememberObject = useCallback((o: ClewObject) => { known.current.set(o.ref, { ref: o.ref, kind: o.kind, label: o.label, ...(o.threadId ? { threadId: o.threadId } : {}) }); }, []);
  const addChip = useCallback((chip: ChipRef) => { known.current.set(chip.ref, chip); setChips(list => list.some(c => c.ref === chip.ref) ? list : [...list, chip]); input.current?.focus(); }, []);
  // The removed chip's neighbour takes the focus, or the field when the drawer is empty (2.4.3).
  const removeChip = useCallback((ref: string) => {
    setChips(list => list.filter(c => c.ref !== ref));
    requestAnimationFrame(() => { const next = document.querySelector<HTMLElement>('[data-chip-remove]'); (next ?? input.current)?.focus(); });
  }, []);
  const newConversation = useCallback(() => { abortTurn('leave'); setConversation(null); setLatest(null); setDone(null); setValue(''); setShown(false); onConversation(null); input.current?.focus(); }, [onConversation, abortTurn]);
  const openConversation = useCallback(async (threadId: string) => {
    abortTurn('leave');
    try { const t = await client.query(threadQuery(threadId)); setConversation({ id: t.id, title: t.title, messages: t.messages }); setLatest(null); setDone(null); setShown(true); input.current?.focus(); }
    catch (e) { setError(errorMessage(e, 'Samtalet kunde inte öppnas.')); }
  }, [client, abortTurn]);
  // The route names the conversation: arriving at /conversations/:id (a link, the back button, a reload) puts the transcript on the page.
  const routeConversation = useRef<string | null>(null);
  useEffect(() => {
    if (conversationId && conversationId !== conversation?.id) void openConversation(conversationId);
    else if (conversationId && !shown) setShown(true);
    // Leaving /conversations/:id by the back button brings the stream back; the conversation stays under Redan hanterat.
    if (!conversationId && routeConversation.current && shown) setShown(false);
    routeConversation.current = conversationId;
  }, [conversationId]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // ⌘K is "Nytt samtal" from anywhere (the canvas's H3 item 1): in a conversation it starts a new one, elsewhere it takes the focus to the box.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); if (shownRef.current) newConversation(); else focus(); }
      // Esc inside a dialog, a menu or the `@` list is theirs (the D29 picker, the pile menu); only a bare Esc closes the conversation.
      else if (e.key === 'Escape' && !document.activeElement?.closest('[role="dialog"], [role="menu"], [role="listbox"], dialog')) close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [focus, close, newConversation]);

  /**
   * Sending (D36): the question is drawn at once with its answer pending under it, the box is cleared and rests with
   * Stoppa, and the answer streams in: the capabilities it reads as steps, the model's text as it is written. The written
   * turn replaces the pending one when it is done. Stopped or failed, nothing was saved and the question goes back in the box.
   */
  const submit = useCallback(async (raw: string) => {
    const text = raw.replace(TOKEN, '').replace(/\s+/g, ' ').trim();
    const used = [...new Map([...chips, ...refsIn(raw).map(r => known.current.get(r)).filter((c): c is ChipRef => !!c)].map(c => [c.ref, c])).values()];
    if (!text || busy) return;
    const controller = new AbortController();
    inflight.current = controller;
    abortReason.current = 'stop';
    const sent = used.map(c => ({ ref: c.ref, kind: c.kind, label: c.label }) as Chip);
    setBusy(true); setError(null); setDone(null);
    setPending({ text, chips: sent, at: new Date().toISOString(), steps: [], answer: '' });
    setValue('');
    setShown(true);
    announce('Söker svar …');
    try {
      const response = await api.converseStream({ text, chips: sent, ...(conversation ? { conversationId: conversation.id } : {}) }, event => {
        if (event.type === 'step') setPending(p => p && { ...p, steps: p.steps.some(s => s.id === event.step.id) ? p.steps.map(s => s.id === event.step.id ? event.step : s) : [...p.steps, event.step] });
        else setPending(p => p && { ...p, answer: event.reset ? event.delta : p.answer + event.delta });
      }, controller.signal);
      // The message list was on the page while the answer was written, so the log speaks it once it is done (4.1.3).
      setConversation({ id: response.conversationId, title: response.thread.title, messages: response.thread.messages });
      setLatest(response);
      setPending(null);
      if (!conversation) onConversation(response.conversationId);
      // The answer's thread is the truth for the log (Frågor); a draft's or a proposal's thread for its card; the verbs about a chip may have changed.
      apply(response.thread);
      if (response.draft) apply(response.draft.thread);
      else if (response.forslag) void client.query({ ...threadQuery(response.forslag.threadId), staleTime: 0 }).then(apply).catch(() => undefined);
      void client.invalidateQueries({ queryKey: keys.verbsAll });
    } catch (e) {
      setPending(null);
      const stopped = controller.signal.aborted;
      if (!stopped || abortReason.current === 'stop') setValue(v => v || raw);
      if (!stopped) setError(errorMessage(e, 'Frågan kunde inte ställas.'));
      else if (abortReason.current === 'stop') announce('Frågan avbröts. Den ligger kvar i rutan.');
    } finally {
      if (inflight.current === controller) inflight.current = null;
      setBusy(false);
      input.current?.focus();
    }
  }, [chips, busy, conversation, announce, onConversation, apply, client]);
  const ask = useCallback((text: string) => void submit(text), [submit]);
  const stop = useCallback(() => abortTurn('stop'), [abortTurn]);
  const performActions = useCallback(async (actions: ClewAction[]) => {
    setBusy(true); setError(null);
    try {
      const threads: Thread[] = [];
      for (const a of actions) threads.push(a.kind === 'dismiss' ? await api.dismiss(a.threadId) : await api.snooze(a.threadId));
      threads.forEach(apply);
      setLatest(l => l ? { ...l, clewActions: [] } : l);
      setDone({ text: actions.length === 1 ? `Klart. ${actions[0]!.kind === 'dismiss' ? 'Kortet är avfärdat och ligger under Redan hanterat.' : 'Kortet tas upp i morgon 06:00.'}` : 'Klart. Båda är gjorda.',
        undo: async () => { for (const a of actions) apply(await api.reopen(a.threadId)); setDone({ text: 'Ångrat. Kortet är tillbaka under Nu.' }); } });
    } catch (e) { setError(errorMessage(e, 'Något gick fel.')); }
    finally { setBusy(false); input.current?.focus(); }
  }, [apply]);
  const cancelActions = useCallback(() => setLatest(l => l ? { ...l, clewActions: [] } : l), []);
  const makeCard = useCallback(async (messageId: string) => {
    if (!conversation) return;
    setBusy(true); setError(null);
    try {
      const { output } = await api.runCapability('clew.cardFromAnswer', { conversationId: conversation.id, messageId });
      const thread = await api.thread((output as { threadId: string }).threadId);
      onThreadChange(thread);
      setDone({ text: `Klart. Kortet "${thread.title}" ligger under Behöver dig. Knappen på kortet öppnar källan.` });
    } catch (e) { setError(errorMessage(e, 'Kortet kunde inte skapas.')); }
    finally { setBusy(false); input.current?.focus(); }
  }, [conversation, onThreadChange]);

  const state = useMemo<ConversationState>(() => ({
    chips, chipped, conversation, latest, pending, done, busy, error, open, value, verbs, input,
    setValue, addChip, removeChip, rememberObject, submit, ask, stop, performActions, cancelActions, makeCard, openConversation, newConversation, close, focus,
  }), [chips, chipped, conversation, latest, pending, done, busy, error, open, value, verbs, addChip, removeChip, rememberObject, submit, ask, stop, performActions, cancelActions, makeCard, openConversation, newConversation, close, focus]);
  return <ConversationContext.Provider value={state}>{children}</ConversationContext.Provider>;
}
