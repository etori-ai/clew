import { useEffect, useState } from 'react';
import type { Thread, ThreadAction } from '@clew/contracts';
import { Badge, Button, Card, CheckboxList, CheckboxListItem, Collapsible, HStack, List, ListItem, MoreMenu, StatusDot, Text, Timestamp, VStack } from '@clew/ui';
import { api, ApiError } from '../api';

type Props = { thread: Thread; areaTitle: string; position?: string; compact: boolean; expanded?: boolean; onChange: (thread: Thread) => void; onOpenView: (title: string, output: unknown) => void };
const outcomeDot = { done: { variant: 'success', label: 'Klart' }, unknown: { variant: 'warning', label: 'Okänt' }, failed: { variant: 'error', label: 'Misslyckades' }, skipped: { variant: 'neutral', label: 'Inte skickad' } } as const;
const deadlineLabel = (d: string | null) => d ? new Intl.DateTimeFormat('sv-SE', { day: 'numeric', month: 'short' }).format(new Date(d + 'T12:00:00')) : null;
function useCountdown(until: string | null) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!until) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [until]);
  if (!until) return null;
  const left = Math.max(0, Date.parse(until) - now);
  return left > 0 ? `${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, '0')}` : null;
}

/**
 * A generic card for any module's thread (thread action contract): one lead sentence, rows with refs, one primary
 * and up to two secondary actions from the module, Clew's standard actions behind the ⋯ menu, and the receipt
 * read back from the source after an execute. Modules contribute actions, never layout.
 */
export function GenericCard({ thread, areaTitle, position, compact, expanded: expandedByDefault = true, onChange, onOpenView }: Props) {
  const [expanded, setExpanded] = useState(expandedByDefault);
  useEffect(() => { setExpanded(expandedByDefault); }, [expandedByDefault]);
  const [selected, setSelected] = useState<string[]>(() => thread.items.filter(i => i.selected).map(i => i.ref));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [why, setWhy] = useState(false);
  useEffect(() => { setSelected(thread.items.filter(i => i.selected).map(i => i.ref)); }, [thread.updatedAt]);
  const countdown = useCountdown(thread.receipt?.undoUntil ?? null);
  const open = thread.state === 'open';
  const selectable = thread.items.some(i => i.selectable);
  const run = async (fn: () => Promise<Thread>) => {
    setBusy(true); setError(null);
    try { onChange(await fn()); } catch (e) { setError(e instanceof ApiError ? e.message : 'Något gick fel.'); } finally { setBusy(false); }
  };
  const perform = async (action: ThreadAction) => {
    if (action.confirm && !window.confirm(action.confirm)) return;
    if (action.kind === 'read') {
      setBusy(true); setError(null);
      try {
        const result = await api.act(thread.id, action.id, selectable ? selected : undefined);
        if (result.kind === 'read' && action.target === 'link' && typeof (result.output as { url?: string }).url === 'string') window.open((result.output as { url: string }).url, '_blank', 'noopener');
        else if (result.kind !== 'execute') onOpenView(action.label, result.output);
      } catch (e) { setError(e instanceof ApiError ? e.message : 'Något gick fel.'); } finally { setBusy(false); }
      return;
    }
    await run(async () => { const result = await api.act(thread.id, action.id, selectable ? selected : undefined); if (result.kind !== 'execute') throw new ApiError(500, 'Oväntat svar.'); return result.thread; });
  };
  const primary = thread.actions.find(a => a.role === 'primary');
  const secondary = thread.actions.filter(a => a.role === 'secondary').slice(0, 2);
  const overflow = thread.actions.filter(a => a.role === 'overflow' || (a.role === 'secondary' && !secondary.includes(a)));
  const count = selected.length;
  const primaryLabel = primary && selectable ? `${primary.label} · ${count}` : primary?.label;
  const menu = [
    ...overflow.map(a => ({ id: a.id, label: a.label, onClick: () => void perform(a) })),
    ...(overflow.length ? [{ type: 'divider' as const }] : []),
    { id: 'snooze', label: 'Inte nu · i morgon 06:00', onClick: () => void run(() => api.snooze(thread.id)) },
    { id: 'dismiss', label: 'Avfärda · inte aktuellt', onClick: () => void run(() => api.dismiss(thread.id)) },
    { id: 'why', label: 'Varför ser jag detta?', onClick: () => setWhy(v => !v) },
  ];
  const receipt = thread.receipt;
  const actionRow = open && !thread.waitingOn && <HStack gap={2} vAlign="center" wrap="wrap">
    {primary && <Button size="sm" variant="primary" label={primaryLabel ?? ''} isDisabled={busy || (selectable && count === 0)} clickAction={() => void perform(primary)} />}
    {secondary.map(a => <Button key={a.id} size="sm" label={a.label} isDisabled={busy} clickAction={() => void perform(a)} />)}
    <MoreMenu label="Fler val" size="sm" variant="ghost" items={menu} />
  </HStack>;
  const headerRow = <HStack justify="between" vAlign="center" gap={2} wrap="wrap">
    <HStack gap={2} vAlign="center" wrap="wrap">
      <Badge variant="neutral" label={areaTitle} />
      <Text type="supporting">{position ? `${position} · ` : ''}{thread.trigger.source} · <Timestamp value={thread.trigger.at} format="time" hasTooltip={false} /></Text>
    </HStack>
    {receipt ? <Badge variant={receipt.rows.some(r => r.outcome === 'failed') ? 'error' : receipt.rows.some(r => r.outcome === 'unknown') ? 'warning' : 'success'} label={`Utfört ${new Date(receipt.at).toLocaleTimeString('sv-SE', { timeStyle: 'short' })} · kontrollerat mot ${thread.trigger.source}`} />
      : thread.waitingOn ? <Badge variant="neutral" label={`Väntar på ${thread.waitingOn}`} />
      : thread.deadline ? <Badge variant={Date.parse(thread.deadline) - Date.now() < 3 * 86400000 ? 'error' : 'warning'} label={`Senast ${deadlineLabel(thread.deadline)}`} /> : null}
  </HStack>;
  // Collapsed: the two-line row from the canvas. Title and summary on the left, the actions on the right.
  if (!expanded && !receipt && !compact) return <Card padding={2}>
    <VStack gap={1} as="article" aria-label={`Tråd: ${thread.title}`} id={`thread-${thread.id}`}>
      {headerRow}
      <HStack justify="between" vAlign="center" gap={3} wrap="wrap">
        <Button variant="ghost" size="sm" label={thread.title} clickAction={() => setExpanded(true)} />
        {actionRow}
      </HStack>
      <Text type="supporting" as="p">{thread.summary}</Text>
      {error && <Text as="p" role="alert" color="accent">{error}</Text>}
    </VStack>
  </Card>;
  return <Card padding={2}>
    <VStack gap={2} as="article" aria-label={`Tråd: ${thread.title}`} id={`thread-${thread.id}`}>
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
      {error && <Text as="p" role="alert" color="accent">{error}</Text>}
      {actionRow}
      {receipt && thread.state === 'handled' && <HStack gap={2} vAlign="center" wrap="wrap">
        {receipt.undoCapability && countdown && <Button variant="destructive" label={`Ångra · ${countdown} kvar`} isDisabled={busy} clickAction={() => void run(() => api.undoReceipt(thread.id))} />}
        <Text type="supporting">Varje rad visar källsystemets svar. Grönt bara när det lästs tillbaka.</Text>
      </HStack>}
      {why && <Text type="supporting" as="p">Varför nu? {thread.trigger.reason}.</Text>}
      {thread.messages.length > 2 && <Collapsible defaultIsOpen={false} chevronPosition="start" trigger={<Text type="supporting">Tråden · {thread.messages.length} meddelanden</Text>}>
        <List density="compact">{thread.messages.map(m => <ListItem key={m.id} label={m.body} description={m.role === 'user' ? 'Du' : thread.trigger.source} />)}</List>
      </Collapsible>}
    </VStack>
  </Card>;
}
