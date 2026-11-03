import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Chip, ClewObject, Completions, ConversationResponse, ThreadMessage, Verb, ViewRef, Thread } from '@clew/contracts';
import { Badge, Button, ChatComposer, ChatComposerDrawer, ChatComposerInput, ChatDictationButton, ChatMessage, ChatMessageBubble, ChatMessageList, ChatMessageMetadata, ChatSystemMessage, HStack, Icon, IconButton, Kbd, List, ListItem, ScrollableArea, Text, Timestamp, VStack, useChatDictation, type ChatComposerInputHandle, type ChatComposerTrigger, type SearchableItem } from '@clew/ui';
import { api, ApiError } from '../api';
import type { ChipRef } from './conversation-context';

export interface ComposerHandle { addChip(chip: ChipRef): void; openConversation(threadId: string): void; close(): void; focus(): void; }
type Mode = 'idle' | 'focus' | 'chat';
type Props = {
  mobile: boolean; needsYou: number;
  /** The conversation named by the route (`/samtal/:id`), or null. */
  conversationId: string | null;
  /** The page keeps the route in step: a new or reopened conversation gets its address, closing it returns to the stream. */
  onConversation: (id: string | null) => void;
  conversationHref: (id: string) => string;
  onThreadChange: (thread: Thread) => void;
  onOpenView: (view: ViewRef) => void;
  onDo: (capability: string) => void;
  onShowHandled: () => void;
  onState: (state: { open: boolean; chipped: string[] }) => void;
};
const TOKEN = /@\[([a-z]+:[^\]]+)\]/g;
const refsIn = (value: string) => [...value.matchAll(TOKEN)].map(m => m[1]!);
const tokenValue = (ref: string) => `@[${ref}]`;

/** Microphone inside the composer; the browser's speech recognition writes into the same input. */
function Dictation({ onResult }: { onResult: (text: string) => void }) {
  const dictation = useChatDictation({ lang: 'sv-SE', onResult });
  return <ChatDictationButton dictation={dictation} />;
}
/** A group in the focus list: a heading with its hint, rows with the source on the right. */
function Group({ title, hint, icon, children }: { title: string; hint?: string; icon: ReactNode; children: ReactNode }) {
  return <List density="compact" header={<HStack gap={1} vAlign="center">{icon}<Text type="supporting" weight="semibold">{title}</Text>{hint && <Text type="supporting">· {hint}</Text>}</HStack>}>{children}</List>;
}

/**
 * The conversation row (D12). The row is always here; focusing it unfolds the grouped list in the composer's drawer,
 * sending unfolds the conversation in the same place, newest nearest the row. Objects become chips as tokens in the
 * field, by `@` or "Lägg till i samtalet"; with a chip the list shrinks to verbs about that object. The row keeps
 * focus throughout; Esc or a click on the dimmed stream closes the overlay and the conversation is kept under
 * Redan hanterat › Frågor.
 */
export const Composer = forwardRef<ComposerHandle, Props>(function Composer({ mobile, needsYou, conversationId, onConversation, conversationHref, onThreadChange, onOpenView, onDo, onShowHandled, onState }, ref) {
  const input = useRef<ChatComposerInputHandle>(null);
  const chips = useRef(new Map<string, ChipRef>());
  const [value, setValue] = useState('');
  const [mode, setMode] = useState<Mode>('idle');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completions, setCompletions] = useState<Completions | null>(null);
  const [conversation, setConversation] = useState<{ id: string; title: string; messages: ThreadMessage[] } | null>(null);
  const [latest, setLatest] = useState<ConversationResponse | null>(null);
  const [verbs, setVerbs] = useState<Verb[]>([]);
  const [done, setDone] = useState<{ text: string; undo?: () => Promise<void> } | null>(null);
  const refs = useMemo(() => refsIn(value), [value]);
  const chipped = useMemo(() => refs.map(r => chips.current.get(r)).filter((c): c is ChipRef => !!c), [refs]);
  const plain = value.replace(TOKEN, '').replace(/\s+/g, ' ').trim();
  const open = mode !== 'idle';
  useEffect(() => { onState({ open, chipped: chipped.map(c => c.ref) }); }, [open, chipped, onState]);
  useEffect(() => { if (open && !completions) void api.completions().then(setCompletions).catch(() => undefined); }, [open, completions]);
  // One chipped card and nothing typed: the verbs about it, from its actions and Clew's standard actions.
  const chipThread = chipped.length === 1 && chipped[0]!.threadId ? chipped[0]!.threadId : null;
  useEffect(() => { if (!chipThread) { setVerbs([]); return; } let alive = true; void api.verbs(chipThread).then(v => { if (alive) setVerbs(v.verbs); }).catch(() => setVerbs([])); return () => { alive = false; }; }, [chipThread, latest]);

  const focus = useCallback(() => { input.current?.focus(); setMode(m => m === 'idle' ? 'focus' : m); }, []);
  const close = useCallback(() => { setMode('idle'); setError(null); onConversation(null); }, [onConversation]);
  const remember = (chip: ChipRef) => { chips.current.set(chip.ref, chip); };
  const addChip = useCallback((chip: ChipRef) => {
    remember(chip);
    const handle = input.current;
    if (!handle) return;
    handle.focus();
    // A programmatic insert does not emit onChange: the controlled value follows the serialized draft so the scope and the verbs update.
    if (!refsIn(handle.getValue()).includes(chip.ref)) { handle.insertToken({ value: tokenValue(chip.ref), label: chip.label, variant: 'neutral' }); setValue(handle.getValue()); }
    setMode(m => m === 'idle' ? 'focus' : m);
  }, []);
  // After a turn the text is cleared but the chips stay: an external value clears the field, so the tokens are put back on the next render.
  const [reinsert, setReinsert] = useState<ChipRef[] | null>(null);
  useEffect(() => {
    if (!reinsert) return;
    const handle = input.current;
    if (handle) { handle.focus(); for (const c of reinsert) handle.insertToken({ value: tokenValue(c.ref), label: c.label, variant: 'neutral' }); setValue(handle.getValue()); }
    setReinsert(null);
  }, [reinsert]);
  const newConversation = () => { setConversation(null); setLatest(null); setDone(null); setValue(''); setMode('focus'); onConversation(null); input.current?.focus(); };
  const openConversation = useCallback(async (threadId: string) => {
    try { const t = await api.thread(threadId); setConversation({ id: t.id, title: t.title, messages: t.messages }); setLatest(null); setDone(null); setMode('chat'); input.current?.focus(); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Samtalet kunde inte öppnas.'); }
  }, []);
  // The route names the conversation: arriving at /samtal/:id (a link, the back button, a reload) opens it in the row.
  const routeConversation = useRef<string | null>(null);
  useEffect(() => {
    if (conversationId && conversationId !== conversation?.id) void openConversation(conversationId);
    // Leaving /samtal/:id by the back button closes the overlay; the conversation stays under Redan hanterat.
    if (!conversationId && routeConversation.current && mode === 'chat') setMode('idle');
    routeConversation.current = conversationId;
  }, [conversationId]);
  useImperativeHandle(ref, () => ({ addChip, openConversation: id => void openConversation(id), close, focus }), [addChip, openConversation, close, focus]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); focus(); }
      else if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [focus, close]);

  const submit = async (raw: string) => {
    const text = raw.replace(TOKEN, '').replace(/\s+/g, ' ').trim();
    const used = refsIn(raw).map(r => chips.current.get(r)).filter((c): c is ChipRef => !!c);
    if (!text || busy) return;
    setBusy(true); setError(null); setDone(null);
    try {
      const response = await api.converse({ text, chips: used.map(c => ({ ref: c.ref, kind: c.kind, label: c.label }) as Chip), ...(conversation ? { conversationId: conversation.id } : {}) });
      setConversation({ id: response.conversationId, title: response.thread.title, messages: response.thread.messages });
      setLatest(response);
      setMode('chat');
      if (!conversation) onConversation(response.conversationId);
      // Sending clears the text, keeps the chips and never moves focus.
      setValue(''); setReinsert(used);
      if (response.draft) onThreadChange(response.draft.thread);
      else if (response.forslag) void api.thread(response.forslag.threadId).then(onThreadChange).catch(() => undefined);
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Frågan kunde inte ställas.'); }
    finally { setBusy(false); input.current?.focus(); }
  };
  const ask = (text: string) => void submit(`${refs.map(tokenValue).join(' ')} ${text}`);
  const performActions = async (actions: ConversationResponse['clewActions']) => {
    setBusy(true); setError(null);
    try {
      const threads: Thread[] = [];
      for (const a of actions) threads.push(a.kind === 'dismiss' ? await api.dismiss(a.threadId) : await api.snooze(a.threadId));
      threads.forEach(onThreadChange);
      setLatest(l => l ? { ...l, clewActions: [] } : l);
      setDone({ text: actions.length === 1 ? `Klart. ${actions[0]!.kind === 'dismiss' ? 'Kortet är avfärdat och ligger under Redan hanterat.' : 'Kortet tas upp i morgon 06:00.'}` : 'Klart. Båda är gjorda.',
        undo: async () => { for (const a of actions) onThreadChange(await api.reopen(a.threadId)); setDone({ text: 'Ångrat. Kortet är tillbaka under Behöver dig.' }); } });
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Något gick fel.'); }
    finally { setBusy(false); input.current?.focus(); }
  };

  // `@` in the row: what is on the page first, then everything in scope.
  const trigger = useMemo<ChatComposerTrigger>(() => {
    const toItems = (objects: ClewObject[]): SearchableItem<ClewObject>[] => objects.map(o => ({ id: o.ref, label: o.label, auxiliaryData: o }));
    return {
      character: '@', hasMultiWordQuery: true, menuLabel: 'Objekt', emptySearchText: 'Inget på sidan matchar', loadingText: 'Söker …',
      searchSource: { search: async q => toItems((await api.objects(q)).objects), bootstrap: async () => toItems((await api.objects('')).objects), cancel: () => undefined },
      renderItem: item => { const o = (item as SearchableItem<ClewObject>).auxiliaryData; return <HStack gap={2} vAlign="center" justify="between"><Text>{item.label}</Text>{o && <Text type="supporting">{o.detail}</Text>}</HStack>; },
      onSelect: item => { const o = (item as SearchableItem<ClewObject>).auxiliaryData!; remember({ ref: o.ref, kind: o.kind, label: o.label, ...(o.threadId ? { threadId: o.threadId } : {}) }); return { value: tokenValue(o.ref), label: o.label, variant: 'neutral' }; },
    };
  }, []);

  const scope = chipped.length ? `Om ${chipped.length} ${chipped.length === 1 ? 'sak' : 'saker'}` : conversation && mode === 'chat' ? 'Samtalet' : 'Allt';
  // With a chip in the field the verb row is the hint; a placeholder would be drawn over the token after a programmatic insert.
  const placeholder = chipped.length ? '' : mode === 'chat' ? 'Fråga vidare … (fokus ligger kvar här)' : mode === 'focus' ? 'Skriv, välj ovan, eller @ för att peka på något …' : 'Fråga, be om något, eller lägg till något från sidan …';

  const focusList = completions && <VStack gap={3}>
    <Group title="Fråga om verksamheten" hint="svaret hämtas ur källsystemen" icon={<Icon icon="search" size="sm" />}>
      {completions.ask.slice(0, 6).map(a => <ListItem key={a.capability} label={a.text} onClick={() => ask(a.text)} endContent={<Text type="supporting">{a.source}</Text>} />)}
    </Group>
    <Group title="Om det som visas på sidan" hint="eller lägg till ett kort i samtalet" icon={<Icon icon="info" size="sm" />}>
      {needsYou > 0 && <ListItem label={`Vad är mest bråttom av de ${needsYou}?`} onClick={() => ask(`Vad är mest bråttom av de ${needsYou} under Behöver dig?`)} endContent={<Text type="supporting">Behöver dig</Text>} />}
      <ListItem label="Varför ser jag detta?" onClick={() => ask('Varför ser jag detta?')} endContent={<Text type="supporting">Startsidan</Text>} />
    </Group>
    {completions.do.length > 0 && <Group title="Gör något" hint="bekräftas innan det utförs" icon={<Icon icon="check" size="sm" />}>
      {completions.do.slice(0, 5).map(d => <ListItem key={d.capability} label={d.text} onClick={() => { onDo(d.capability); close(); }} endContent={<Text type="supporting">{d.source}</Text>} />)}
    </Group>}
    <Group title="Tidigare samtal" icon={<Icon icon="clock" size="sm" />}>
      {completions.recent.map(r => <ListItem key={r.conversationId} label={r.title} href={conversationHref(r.conversationId)} endContent={<Timestamp value={r.at} format="time" hasTooltip={false} />} />)}
      <ListItem label="Alla samtal" description="Redan hanterat › Frågor" onClick={() => { onShowHandled(); close(); }} />
    </Group>
  </VStack>;

  const chat = conversation && <VStack gap={2}>
    <HStack justify="between" vAlign="center" gap={2}>
      <Text type="supporting"><Text as="span" weight="semibold">Samtal</Text> · {conversation.title}</Text>
      <HStack gap={1} vAlign="center">
        <Button size="sm" variant="ghost" label="Nytt samtal" onClick={newConversation} />
        <IconButton size="sm" variant="ghost" label="Stäng samtalet" icon={<Icon icon="close" />} onClick={close} />
      </HStack>
    </HStack>
    <ChatMessageList density="compact" align="bottom">
      {conversation.messages.map(m => <ChatMessage key={m.id} sender={m.role}>
        <ChatMessageBubble variant={m.role === 'assistant' ? 'ghost' : 'filled'} width={m.role === 'assistant' ? '100%' : undefined}
          metadata={<ChatMessageMetadata timestamp={<Timestamp value={m.createdAt} format="time" hasTooltip={false} />}
            footer={m.role === 'assistant' ? (m.meta?.source ?? undefined) : m.meta?.chips?.length ? <HStack gap={1} wrap="wrap">{m.meta.chips.map(c => <Badge key={c.ref} variant="neutral" label={c.label} />)}</HStack> : undefined} />}>
          {m.body}
          {m.meta?.view && <HStack gap={2}><Button size="sm" label={`Visa ${m.meta.view.title.toLowerCase()}`} onClick={() => onOpenView(m.meta!.view!)} /></HStack>}
          {m.meta?.draft && <Text type="supporting" as="p">Utkast i kortet. Inget är skickat förrän du trycker på knappen i kortet.</Text>}
        </ChatMessageBubble>
      </ChatMessage>)}
      {latest && latest.clewActions.length > 0 && <ChatMessage sender="assistant">
        <ChatMessageBubble variant="ghost" width="100%">
          <VStack gap={2}>
            <List density="compact" listStyle="decimal" aria-label="Att bekräfta">{latest.clewActions.map(a => <ListItem key={a.n} label={a.label} description="Clew · ångra i 10 min" />)}</List>
            <HStack gap={2} wrap="wrap">
              <Button size="sm" variant="primary" label={latest.clewActions.length === 1 ? 'Gör det' : 'Gör båda'} isDisabled={busy} clickAction={() => performActions(latest.clewActions)} />
              <Button size="sm" variant="ghost" label="Avbryt" onClick={() => setLatest(l => l ? { ...l, clewActions: [] } : l)} />
            </HStack>
          </VStack>
        </ChatMessageBubble>
      </ChatMessage>}
      {done && <ChatSystemMessage icon={<Icon icon="check" size="sm" />}>{done.text}{done.undo && <> <Button size="sm" variant="ghost" label="Ångra" clickAction={done.undo} /></>}</ChatSystemMessage>}
    </ChatMessageList>
    {latest && latest.followUps.length > 0 && <HStack gap={1} wrap="wrap">{latest.followUps.map(f => <Button key={f} size="sm" variant="secondary" label={f} isDisabled={busy} onClick={() => ask(f)} />)}</HStack>}
    <Text type="supporting">Esc stänger · samtalet sparas under Redan hanterat</Text>
  </VStack>;

  const drawer = open && (mode === 'chat' ? chat : chipped.length ? null : focusList);
  return <ChatComposer value={value} onChange={setValue} onSubmit={text => void submit(text)} isDisabled={busy} density="compact" elevation="low" placeholder={placeholder}
    input={<ChatComposerInput handleRef={input} label="Fråga, be om något eller svara om ett kort" maxRows={3} hasHistory={false} triggers={[trigger]} placeholder={placeholder}
      onKeyDown={e => { if (e.key === 'Escape') close(); }} />}
    drawer={drawer ? <ChatComposerDrawer label="Samtalet"><ScrollableArea label="Samtalet" height={mobile ? 360 : '56vh'} padding={2}>{drawer}</ScrollableArea></ChatComposerDrawer> : undefined}
    headerContext={<HStack gap={1} vAlign="center"><Text type="supporting" weight="semibold">{scope}</Text><Text type="supporting">· svaret kommer här</Text><Kbd keys="mod+k" /></HStack>}
    footerActions={chipped.length === 1 && !plain && verbs.length > 0 ? <HStack gap={1} wrap="wrap" aria-label="Om kortet">{verbs.map(v => <Button key={v.id} size="sm" variant="ghost" label={v.label} isDisabled={busy} onClick={() => ask(v.label)} />)}</HStack> : undefined}
    sendActions={<Dictation onResult={text => setValue(current => (current + ' ' + text).trim())} />}
    status={error ? { type: 'error', message: error } : undefined}
    onFocus={() => setMode(m => m === 'idle' ? 'focus' : m)} />;
});
