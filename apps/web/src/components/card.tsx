import { useEffect, useState } from 'react';
import type { Thread, ThreadAction } from '@clew/contracts';
import { Badge, Button, Card, CheckboxList, CheckboxListItem, Collapsible, HStack, List, ListItem, MoreMenu, StatusDot, Text, Timestamp, VStack, useToast } from '@clew/ui';
import { api, ApiError } from '../api';
import { useConversation } from './conversation-context';

type Props = { thread: Thread; areaTitle: string; position?: string; compact: boolean; expanded?: boolean; onChange: (thread: Thread) => void; onOpenCardView: (threadId: string, actionId: string) => void };
const outcomeDot = { done: { variant: 'success', label: 'Klart' }, unknown: { variant: 'warning', label: 'Okänt' }, failed: { variant: 'error', label: 'Misslyckades' }, skipped: { variant: 'neutral', label: 'Inte skickad' } } as const;
const deadlineLabel = (d: string | null) => d ? new Intl.DateTimeFormat('sv-SE', { day: 'numeric', month: 'short' }).format(new Date(d + 'T12:00:00')) : null;
const clock = (iso: string) => new Date(iso).toLocaleTimeString('sv-SE', { timeStyle: 'short' });
export function useCountdown(until: string | null) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!until) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [until]);
  if (!until) return null;
  const left = Math.max(0, Date.parse(until) - now);
  return left > 0 ? `${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, '0')}` : null;
}
/** Avfärda and Inte nu: the card leaves the stream and a toast with Ångra takes its place for ten seconds; reopen brings it back. */
export function useLeaveWithUndo(onChange: (thread: Thread) => void) {
  const toast = useToast();
  return (thread: Thread, text: string) => {
    const dismiss = toast({ body: text, autoHideDuration: 10_000, uniqueID: 'leave:' + thread.id,
      endContent: <Button size="sm" variant="ghost" label="Ångra" clickAction={async () => { onChange(await api.reopen(thread.id)); dismiss(); }} /> });
  };
}

/**
 * A generic card for any module's thread (thread action contract): one lead sentence, rows with refs, one primary
 * and up to two secondary actions from the module, Clew's standard actions (Lägg till i samtalet, Inte nu, and
 * Avfärda and Varför ser jag detta? behind ⋯), and the receipt read back from the source after an execute.
 * Modules contribute actions, never layout. Cards hold state and actions and never contain a text input (D12).
 */
export function GenericCard({ thread, areaTitle, position, compact, expanded: expandedByDefault = true, onChange, onOpenCardView }: Props) {
  const [expanded, setExpanded] = useState(expandedByDefault);
  useEffect(() => { setExpanded(expandedByDefault); }, [expandedByDefault]);
  const [selected, setSelected] = useState<string[]>(() => thread.items.filter(i => i.selected).map(i => i.ref));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [why, setWhy] = useState(false);
  useEffect(() => { setSelected(thread.items.filter(i => i.selected).map(i => i.ref)); }, [thread.updatedAt]);
  const countdown = useCountdown(thread.receipt?.undoUntil ?? null);
  const conversation = useConversation();
  const leave = useLeaveWithUndo(onChange);
  const chipRef = 'thread:' + thread.id;
  const inConversation = conversation.chipped.includes(chipRef);
  const open = thread.state === 'open';
  const selectable = thread.items.some(i => i.selectable);
  const draft = thread.messages.at(-1)?.meta?.draft;
  const run = async (fn: () => Promise<Thread>) => {
    setBusy(true); setError(null);
    try { onChange(await fn()); } catch (e) { setError(e instanceof ApiError ? e.message : 'Något gick fel.'); } finally { setBusy(false); }
  };
  const perform = async (action: ThreadAction) => {
    if (action.confirm && !window.confirm(action.confirm)) return;
    if (action.kind === 'read') {
      if (action.target === 'link') {
        setBusy(true); setError(null);
        try {
          const result = await api.act(thread.id, action.id, selectable ? selected : undefined);
          if (result.kind === 'read' && typeof (result.output as { url?: string }).url === 'string') window.open((result.output as { url: string }).url, '_blank', 'noopener');
        } catch (e) { setError(e instanceof ApiError ? e.message : 'Något gick fel.'); } finally { setBusy(false); }
        return;
      }
      // A panel view has an address: /vy/kort/:thread/:action, so it survives reload and the back button closes it.
      onOpenCardView(thread.id, action.id);
      return;
    }
    await run(async () => { const result = await api.act(thread.id, action.id, selectable ? selected : undefined); if (result.kind !== 'execute') throw new ApiError(500, 'Oväntat svar.'); return result.thread; });
  };
  const snooze = () => run(async () => { const t = await api.snooze(thread.id); leave(t, 'Tas upp i morgon 06:00 i stället.'); return t; });
  const dismiss = () => run(async () => { const t = await api.dismiss(thread.id); leave(t, `Avfärdad som inte aktuellt. ${thread.trigger.source} skapar inte kortet igen.`); return t; });
  const primary = thread.actions.find(a => a.role === 'primary');
  const secondary = thread.actions.filter(a => a.role === 'secondary').slice(0, 2);
  const overflow = thread.actions.filter(a => a.role === 'overflow' || (a.role === 'secondary' && !secondary.includes(a)));
  const count = selected.length;
  const primaryLabel = primary && selectable ? `${primary.label} · ${count}` : primary?.label;
  const menu = [
    ...overflow.map(a => ({ id: a.id, label: a.label, onClick: () => void perform(a) })),
    ...(overflow.length ? [{ type: 'divider' as const }] : []),
    { id: 'dismiss', label: 'Avfärda · inte aktuellt', onClick: () => void dismiss() },
    { id: 'why', label: 'Varför ser jag detta?', onClick: () => setWhy(v => !v) },
  ];
  const receipt = thread.receipt;
  const undoOpen = !!receipt && thread.state === 'handled' && !!receipt.undoCapability && !!countdown;
  const actionRow = open && !thread.waitingOn ? <HStack gap={2} vAlign="center" wrap="wrap">
    {primary && <Button size="sm" variant="primary" label={primaryLabel ?? ''} isDisabled={busy || (selectable && count === 0)} clickAction={() => void perform(primary)} />}
    {secondary.map(a => <Button key={a.id} size="sm" label={a.label} isDisabled={busy} clickAction={() => void perform(a)} />)}
    <Button size="sm" variant="ghost" label={inConversation ? 'I samtalet ✓' : 'Lägg till i samtalet'} isDisabled={inConversation} onClick={() => conversation.addChip({ ref: chipRef, kind: 'thread', label: thread.title, threadId: thread.id })} />
    <Button size="sm" variant="ghost" label="Inte nu" isDisabled={busy} clickAction={snooze} />
    <MoreMenu label="Fler val" size="sm" variant="ghost" items={menu} />
  </HStack> : undoOpen ? <HStack gap={2} vAlign="center" wrap="wrap">
    <Button size="sm" variant="destructive" label={`Ångra allt · ${countdown} kvar`} isDisabled={busy} clickAction={() => void run(() => api.undoReceipt(thread.id))} />
    {secondary.filter(a => a.kind === 'read').map(a => <Button key={a.id} size="sm" label={a.label} isDisabled={busy} clickAction={() => void perform(a)} />)}
    <Text type="supporting">Varje rad visar källsystemets svar. Grönt bara när det lästs tillbaka.</Text>
  </HStack> : null;
  const headerRow = <HStack justify="between" vAlign="center" gap={2} wrap="wrap">
    <HStack gap={2} vAlign="center" wrap="wrap">
      <Badge variant="neutral" label={areaTitle} />
      <Text type="supporting">{position ? `${position} · ` : ''}{thread.trigger.source} · <Timestamp value={thread.trigger.at} format="time" hasTooltip={false} /></Text>
      {inConversation && <Badge variant="info" label="I samtalet" />}
      {draft && open && <Badge variant="info" label="Utkast från samtalet" />}
    </HStack>
    {receipt ? <Badge variant={receipt.rows.some(r => r.outcome === 'failed') ? 'error' : receipt.rows.some(r => r.outcome === 'unknown') ? 'warning' : 'success'} label={`Skickat ${clock(receipt.at)} · kontrollerat mot ${thread.trigger.source}`} />
      : thread.waitingOn ? <Badge variant="neutral" label={`Väntar på ${thread.waitingOn}`} />
      : thread.deadline ? <Badge variant={Date.parse(thread.deadline) - Date.now() < 3 * 86400000 ? 'error' : 'warning'} label={`Senast ${deadlineLabel(thread.deadline)}`} /> : null}
  </HStack>;
  const whyLine = why && <Text type="supporting" as="p">Varför nu? {thread.trigger.reason}. Källa: {thread.trigger.source}, {clock(thread.trigger.at)}.</Text>;
  // Collapsed: the two-line row from the canvas. Title and summary on the left, the actions on the right.
  if (!expanded && !receipt && !compact) return <Card padding={2}>
    <VStack gap={1} as="article" aria-label={`Tråd: ${thread.title}`} id={`thread-${thread.id}`} aria-current={inConversation ? 'true' : undefined}>
      {headerRow}
      <HStack justify="between" vAlign="center" gap={3} wrap="wrap">
        <Button variant="ghost" size="sm" label={thread.title} clickAction={() => setExpanded(true)} />
        {actionRow}
      </HStack>
      <Text type="supporting" as="p">{thread.summary}</Text>
      {whyLine}
      {error && <Text as="p" role="alert" color="accent">{error}</Text>}
    </VStack>
  </Card>;
  return <Card padding={2}>
    <VStack gap={2} as="article" aria-label={`Tråd: ${thread.title}`} id={`thread-${thread.id}`} aria-current={inConversation ? 'true' : undefined}>
      {headerRow}
      <Text weight="semibold" as="p">{receipt ? receipt.headline : thread.title}</Text>
      {!receipt && thread.summary && <Text as="p" color="secondary">{thread.summary}</Text>}
      {thread.items.length > 0 && !receipt && (selectable
        ? <CheckboxList label="Rader" isLabelHidden value={selected} onChange={setSelected} isReadOnly={!open} density="compact">
          {thread.items.map(i => <CheckboxListItem key={i.ref} value={i.ref} label={`${i.label} · ${i.detail}`} />)}
        </CheckboxList>
        : <List density="compact" hasDividers>{thread.items.map(i => <ListItem key={i.ref} label={<HStack gap={2} vAlign="center"><Text weight="semibold">{i.label}</Text><Text type="supporting">{i.detail}</Text></HStack>} />)}</List>)}
      {receipt && <List density="compact" hasDividers aria-label="Kvitto, rad för rad">
        {receipt.rows.map(r => <ListItem key={r.ref} label={<HStack gap={2} vAlign="center"><StatusDot variant={outcomeDot[r.outcome].variant} label={outcomeDot[r.outcome].label} /><Text>{r.label}</Text></HStack>} description={r.detail} />)}
      </List>}
      {draft && open && <Text type="supporting" as="p">Utkast från samtalet. Inget är skickat förrän du trycker på knappen här.</Text>}
      {error && <Text as="p" role="alert" color="accent">{error}</Text>}
      {actionRow}
      {whyLine}
      {thread.messages.length > 2 && <Collapsible defaultIsOpen={false} chevronPosition="start" trigger={<Text type="supporting">Tråden · {thread.messages.length} meddelanden</Text>}>
        <List density="compact">{thread.messages.map(m => <ListItem key={m.id} label={m.body} description={m.role === 'user' ? 'Du' : thread.trigger.source} />)}</List>
      </Collapsible>}
    </VStack>
  </Card>;
}
