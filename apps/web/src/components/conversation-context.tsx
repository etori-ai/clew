import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { Chip, ClewObject, ConversationResponse, ThreadMessage, Verb, Thread } from '@clew/contracts';
import { useAnnounce, type ChatComposerInputHandle } from '@clew/ui';
import { api, ApiError } from '../api';

/** A chip as the page hands it to the composer (D12): the object's ref, kind and label, plus its card when it has one. */
export interface ChipRef { ref: string; kind: Chip['kind']; label: string; threadId?: string; }
export type ClewAction = ConversationResponse['clewActions'][number];
export interface Conversation { id: string; title: string; messages: ThreadMessage[]; }
/** The conversation's state and verbs, owned here (D31) and read by the row, the transcript, the page and every card. */
export interface ConversationState {
  /** The chips in the composer's drawer: what the person pointed at with "Lägg till i samtalet". */
  chips: ChipRef[];
  /** Every ref in the conversation right now, drawer chips and `@` tokens in the field, so a card can show "I samtalet". */
  chipped: string[];
  conversation: Conversation | null;
  latest: ConversationResponse | null;
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
  performActions(actions: ClewAction[]): Promise<void>;
  cancelActions(): void;
  openConversation(threadId: string): Promise<void>;
  newConversation(): void;
  close(): void;
  focus(): void;
}
const noop = () => undefined;
const never = async () => undefined;
export const ConversationContext = createContext<ConversationState>({
  chips: [], chipped: [], conversation: null, latest: null, done: null, busy: false, error: null, open: false, value: '', verbs: [], input: { current: null },
  setValue: noop, addChip: noop, removeChip: noop, rememberObject: noop, submit: never, ask: noop, performActions: never, cancelActions: noop, openConversation: never, newConversation: noop, close: noop, focus: noop,
});
export const useConversation = () => useContext(ConversationContext);

const TOKEN = /@\[([a-z]+:[^\]]+)\]/g;
export const refsIn = (value: string) => [...value.matchAll(TOKEN)].map(m => m[1]!);
export const tokenValue = (ref: string) => `@[${ref}]`;

type Props = {
  /** The conversation named by the route (`/samtal/:id`), or null. */
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
  const [verbs, setVerbs] = useState<Verb[]>([]);
  const [done, setDone] = useState<{ text: string; undo?: () => Promise<void> } | null>(null);
  const inline = useMemo(() => refsIn(value), [value]);
  const chipped = useMemo(() => [...new Set([...chips.map(c => c.ref), ...inline])], [chips, inline]);
  const plain = value.replace(TOKEN, '').replace(/\s+/g, ' ').trim();
  const open = shown && !!conversation;
  // One chip in the drawer and nothing typed: the verbs about it, from its actions and Clew's standard actions.
  const chipThread = chips.length === 1 && !plain && chips[0]!.threadId ? chips[0]!.threadId : null;
  useEffect(() => { if (!chipThread) { setVerbs([]); return; } let alive = true; void api.verbs(chipThread).then(v => { if (alive) setVerbs(v.verbs); }).catch(() => setVerbs([])); return () => { alive = false; }; }, [chipThread, latest]);

  const focus = useCallback(() => { input.current?.focus(); }, []);
  // Esc reaches here after a dialog or a menu has already taken it; with nothing open there is nothing to close and focus stays where it is.
  const shownRef = useRef(false);
  shownRef.current = shown;
  const close = useCallback(() => { if (!shownRef.current) return; setShown(false); setError(null); onConversation(null); input.current?.focus(); }, [onConversation]);
  const rememberObject = useCallback((o: ClewObject) => { known.current.set(o.ref, { ref: o.ref, kind: o.kind, label: o.label, ...(o.threadId ? { threadId: o.threadId } : {}) }); }, []);
  const addChip = useCallback((chip: ChipRef) => { known.current.set(chip.ref, chip); setChips(list => list.some(c => c.ref === chip.ref) ? list : [...list, chip]); input.current?.focus(); }, []);
  // The removed chip's neighbour takes the focus, or the field when the drawer is empty (2.4.3).
  const removeChip = useCallback((ref: string) => {
    setChips(list => list.filter(c => c.ref !== ref));
    requestAnimationFrame(() => { const next = document.querySelector<HTMLElement>('[data-chip-remove]'); (next ?? input.current)?.focus(); });
  }, []);
  const newConversation = useCallback(() => { setConversation(null); setLatest(null); setDone(null); setValue(''); setShown(false); onConversation(null); input.current?.focus(); }, [onConversation]);
  const openConversation = useCallback(async (threadId: string) => {
    try { const t = await api.thread(threadId); setConversation({ id: t.id, title: t.title, messages: t.messages }); setLatest(null); setDone(null); setShown(true); input.current?.focus(); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Samtalet kunde inte öppnas.'); }
  }, []);
  // The route names the conversation: arriving at /samtal/:id (a link, the back button, a reload) puts the transcript on the page.
  const routeConversation = useRef<string | null>(null);
  useEffect(() => {
    if (conversationId && conversationId !== conversation?.id) void openConversation(conversationId);
    else if (conversationId && !shown) setShown(true);
    // Leaving /samtal/:id by the back button brings the stream back; the conversation stays under Redan hanterat.
    if (!conversationId && routeConversation.current && shown) setShown(false);
    routeConversation.current = conversationId;
  }, [conversationId]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); focus(); }
      // Esc inside a dialog, a menu or the `@` list is theirs (the D29 picker, the pile menu); only a bare Esc closes the conversation.
      else if (e.key === 'Escape' && !document.activeElement?.closest('[role="dialog"], [role="menu"], [role="listbox"], dialog')) close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [focus, close]);

  const submit = useCallback(async (raw: string) => {
    const text = raw.replace(TOKEN, '').replace(/\s+/g, ' ').trim();
    const used = [...new Map([...chips, ...refsIn(raw).map(r => known.current.get(r)).filter((c): c is ChipRef => !!c)].map(c => [c.ref, c])).values()];
    if (!text || busy) return;
    setBusy(true); setError(null); setDone(null);
    announce('Söker svar …');
    try {
      const response = await api.converse({ text, chips: used.map(c => ({ ref: c.ref, kind: c.kind, label: c.label }) as Chip), ...(conversation ? { conversationId: conversation.id } : {}) });
      setConversation({ id: response.conversationId, title: response.thread.title, messages: response.thread.messages });
      setLatest(response);
      // The message list is a live region only once it is on the page, so an answer that opens it has to be spoken (4.1.3).
      if (!open) announce(response.answer.body);
      setShown(true);
      if (!conversation) onConversation(response.conversationId);
      // Sending clears the text, keeps the chips and never moves focus.
      setValue('');
      if (response.draft) onThreadChange(response.draft.thread);
      else if (response.forslag) void api.thread(response.forslag.threadId).then(onThreadChange).catch(() => undefined);
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Frågan kunde inte ställas.'); }
    finally { setBusy(false); input.current?.focus(); }
  }, [chips, busy, conversation, open, announce, onConversation, onThreadChange]);
  const ask = useCallback((text: string) => void submit(text), [submit]);
  const performActions = useCallback(async (actions: ClewAction[]) => {
    setBusy(true); setError(null);
    try {
      const threads: Thread[] = [];
      for (const a of actions) threads.push(a.kind === 'dismiss' ? await api.dismiss(a.threadId) : await api.snooze(a.threadId));
      threads.forEach(onThreadChange);
      setLatest(l => l ? { ...l, clewActions: [] } : l);
      setDone({ text: actions.length === 1 ? `Klart. ${actions[0]!.kind === 'dismiss' ? 'Kortet är avfärdat och ligger under Redan hanterat.' : 'Kortet tas upp i morgon 06:00.'}` : 'Klart. Båda är gjorda.',
        undo: async () => { for (const a of actions) onThreadChange(await api.reopen(a.threadId)); setDone({ text: 'Ångrat. Kortet är tillbaka under Nu.' }); } });
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Något gick fel.'); }
    finally { setBusy(false); input.current?.focus(); }
  }, [onThreadChange]);
  const cancelActions = useCallback(() => setLatest(l => l ? { ...l, clewActions: [] } : l), []);

  const state = useMemo<ConversationState>(() => ({
    chips, chipped, conversation, latest, done, busy, error, open, value, verbs, input,
    setValue, addChip, removeChip, rememberObject, submit, ask, performActions, cancelActions, openConversation, newConversation, close, focus,
  }), [chips, chipped, conversation, latest, done, busy, error, open, value, verbs, addChip, removeChip, rememberObject, submit, ask, performActions, cancelActions, openConversation, newConversation, close, focus]);
  return <ConversationContext.Provider value={state}>{children}</ConversationContext.Provider>;
}
