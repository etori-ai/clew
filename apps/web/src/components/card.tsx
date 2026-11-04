import { useEffect, useRef, useState } from 'react';
import { attentionLevel, dayWord, daysUntil, isSnoozed, parseSwedishTime, snoozeWhen, streamGroup, type AttentionLevel, type SnoozeInput, type SnoozePreset, type Thread, type ThreadAction } from '@clew/contracts';
import { Badge, Button, Card, CheckboxList, CheckboxListItem, Collapsible, Dialog, DialogHeader, DropdownMenu, Heading, HStack, Icon, List, ListItem, MoreMenu, StatusDot, Text, TextInput, Timestamp, Token, VStack, useToast } from '@clew/ui';
import { today } from '@clew/calendar/dates';
import { api, ApiError } from '../api';
import { useConversation } from './conversation-context';

const outcomeDot = { done: { variant: 'success', label: 'Klart' }, unknown: { variant: 'warning', label: 'Okänt' }, failed: { variant: 'error', label: 'Misslyckades' }, skipped: { variant: 'neutral', label: 'Inte skickad' } } as const;
const shortDate = (d: string) => new Intl.DateTimeFormat('sv-SE', { day: 'numeric', month: 'short' }).format(new Date(d.slice(0, 10) + 'T12:00:00'));
const clock = (iso: string) => new Date(iso).toLocaleTimeString('sv-SE', { timeStyle: 'short' });
export function useCountdown(until: string | null) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!until) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [until]);
  if (!until) return null;
  const left = Math.max(0, Date.parse(until) - now);
  return left > 0 ? `${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, '0')}` : null;
}
/**
 * Avfärda and Inte nu: the card leaves the stream and a toast with Ångra takes its place; reopen brings it back. The toast
 * stays until the person closes it: Ångra is the only way back to the card, so it carries no time limit (2.2.1).
 */
export function useLeaveWithUndo(onChange: (thread: Thread) => void) {
  const toast = useToast();
  return (thread: Thread, text: string, undo: () => Promise<Thread> = () => api.reopen(thread.id)) => {
    const dismiss = toast({ body: text, isAutoHide: false, uniqueID: 'leave:' + thread.id,
      endContent: <Button size="sm" variant="ghost" label="Ångra" clickAction={async () => { onChange(await undo()); dismiss(); }} /> });
  };
}

/**
 * Colour comes from today's deadline, never from the category (D28): red for a deadline that is today or has passed,
 * and for every other deadline the day word in a neutral badge, so the day is read, not the hue. Notices carry no
 * deadline and are blue rows, not cards.
 */
export function deadlineLabel(deadline: string, now = today()) {
  const days = daysUntil(deadline.slice(0, 10), now);
  if (days < 0) return `Skulle varit klar ${shortDate(deadline)}`;
  if (days === 0) return 'Senast i dag';
  return days <= 30 ? `${dayWord(deadline.slice(0, 10), now)} · ${days} ${days === 1 ? 'dag' : 'dagar'}` : `${dayWord(deadline.slice(0, 10), now)}`;
}
export function DeadlineBadge({ thread }: { thread: Thread }) {
  if (!thread.deadline) return null;
  const due = streamGroup({ deadline: thread.deadline }, today()) === 'nu';
  return <Badge variant={due ? 'error' : 'neutral'} icon={<Icon icon={due ? 'clock' : 'calendar'} size="sm" />} label={deadlineLabel(thread.deadline)} />;
}
/** Inte nu (D28): when the card comes back, as the badge of a card in the pile. */
const snoozedLabel = (until: string, now = today()) => { const date = new Date(until).toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' }); return `Tillbaka ${dayWord(date, now) === 'i dag' ? '' : dayWord(date, now) + ' '}${clock(until)}`; };
/** The receipt badge: green only when every row was read back, with the icon saying the same as the colour. */
export function ReceiptBadge({ thread }: { thread: Thread }) {
  const receipt = thread.receipt;
  if (!receipt) return null;
  const state = receipt.rows.some(r => r.outcome === 'failed') ? 'error' : receipt.rows.some(r => r.outcome === 'unknown') ? 'warning' : 'success';
  const label = state === 'success' ? `Skickat ${clock(receipt.at)} · kontrollerat mot ${thread.trigger.source}`
    : state === 'warning' ? `Skickat ${clock(receipt.at)} · ${receipt.rows.filter(r => r.outcome === 'unknown').length} rad obekräftad`
    : `Skickat ${clock(receipt.at)} · ${receipt.rows.filter(r => r.outcome === 'failed').length} rad misslyckades`;
  return <Badge variant={state} icon={<Icon icon={state === 'success' ? 'check' : state === 'warning' ? 'warning' : 'error'} size="sm" />} label={label} />;
}

/** The picker's rows (D29), read once a minute for the whole page: every card shows the same times. */
let presetCache: { at: number; promise: Promise<SnoozePreset[]> } | null = null;
function loadPresets() {
  if (!presetCache || Date.now() - presetCache.at > 60_000) presetCache = { at: Date.now(), promise: api.snoozePresets().then(r => r.presets).catch(() => []) };
  return presetCache.promise;
}
function usePresets() {
  const [presets, setPresets] = useState<SnoozePreset[]>([]);
  useEffect(() => { let alive = true; void loadPresets().then(p => { if (alive) setPresets(p); }); return () => { alive = false; }; }, []);
  return presets;
}
/**
 * "Inte nu" and "Påminn mig" are the same picker (D29): the presets with the time each lands on, then "Skriv själv …"
 * for free text in the composer's grammar, parsed as the person types so the time is shown before it is set. An
 * Astryx DropdownMenu (a bottom sheet on a phone) and a Dialog; the rows are the menu's items with the time as description.
 */
function TimePicker({ label, presets, demo, onPick }: { label: string; presets: SnoozePreset[]; demo?: { label: string; seconds: number }; onPick: (choice: SnoozeInput & { seconds?: number }) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const parsed = text.trim() ? parseSwedishTime(text, new Date().toISOString()) : null;
  const when = parsed ? snoozeWhen(parsed, new Date().toISOString()) : null;
  const items = [
    ...(demo ? [{ id: 'demo', label: demo.label, description: 'demo', onClick: () => onPick({ seconds: demo.seconds }) }] : []),
    ...presets.map(p => ({ id: p.id, label: p.label, description: p.detail, onClick: () => onPick({ preset: p.id, until: p.at }) })),
    { type: 'divider' as const },
    { id: 'text', label: 'Skriv själv …', description: '”fredag kl 9”, ”om 20 min”', onClick: () => { setText(''); setOpen(true); } },
  ];
  return <>
    <DropdownMenu button={{ label, size: 'sm', variant: 'ghost' }} presentation="adaptive" items={items} />
    <Dialog isOpen={open} onOpenChange={setOpen}>
      <DialogHeader title="När ska jag ta upp det igen?" />
      <form onSubmit={e => { e.preventDefault(); if (parsed) { onPick({ text, until: parsed }); setOpen(false); } }} style={{ display: 'contents' }}>
        <VStack gap={3} padding={3}>
          <TextInput label="När?" value={text} onChange={setText} placeholder="fredag kl 9" description="Till exempel ”om 20 min”, ”efter lunch”, ”i morgon kl 9”, ”fredag kl 9”, ”nästa vecka”"
            status={text.trim() && !parsed ? { type: 'error', message: 'Jag förstod inte tiden.' } : undefined} />
          <HStack gap={2} justify="between" vAlign="center" wrap="wrap">
            <Text type="supporting" aria-live="polite">{when ? `Tas upp ${when}` : ' '}</Text>
            <HStack gap={2}>
              <Button size="sm" variant="ghost" label="Avbryt" onClick={() => setOpen(false)} />
              <Button size="sm" variant="primary" label={when ? `Ta upp ${when}` : 'Ta upp'} isDisabled={!parsed} type="submit" />
            </HStack>
          </HStack>
        </VStack>
      </form>
    </Dialog>
  </>;
}
type ActionProps = { thread: Thread; onChange: (thread: Thread) => void; onOpenCardView: (threadId: string, actionId: string) => void };
/** Everything a card can do, shared by the card and the notice row: run an action, snooze, dismiss, explain, and keep the selection. */
function useThreadActions({ thread, onChange, onOpenCardView }: ActionProps) {
  const [selected, setSelected] = useState<string[]>(() => thread.items.filter(i => i.selected).map(i => i.ref));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [why, setWhy] = useState(false);
  useEffect(() => { setSelected(thread.items.filter(i => i.selected).map(i => i.ref)); }, [thread.updatedAt]);
  const leave = useLeaveWithUndo(onChange);
  const selectable = thread.items.some(i => i.selectable);
  // Busy never disables the buttons: a disabled button drops the focus it holds (2.4.3). Action-buttons wait on their own promise.
  const run = async (fn: () => Promise<Thread>) => {
    if (busy) return;
    setBusy(true); setError(null);
    try { onChange(await fn()); } catch (e) { setError(e instanceof ApiError ? e.message : 'Något gick fel.'); } finally { setBusy(false); }
  };
  const perform = async (action: ThreadAction) => {
    if (busy) return;
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
  const snooze = (choice: SnoozeInput = {}) => run(async () => { const t = await api.snooze(thread.id, choice); leave(t, `Tas upp ${t.snoozedUntil ? snoozeWhen(t.snoozedUntil, new Date().toISOString()) : 'i morgon 06:00'} i stället.`); return t; });
  const dismiss = () => run(async () => { const t = await api.dismiss(thread.id); leave(t, `Avfärdad som inte aktuellt. ${thread.trigger.source} skapar inte kortet igen.`); return t; });
  /** A person's own timer (D17): the card waits under Pågår utan dig until the timer brings it back; Ångra cancels the timer. */
  const remind = async (seconds: number) => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const r = await api.remind(thread.id, seconds);
      const when = seconds < 60 ? `om ${seconds} sekunder` : clock(r.fireAt);
      onChange(r.thread);
      leave(r.thread, `Påminner dig ${when}. Kortet väntar under Pågår utan dig tills dess.`, () => api.cancelReminder(thread.id, r.id));
      window.setTimeout(() => window.dispatchEvent(new Event('clew:refresh')), seconds * 1000 + 1_500);
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Något gick fel.'); } finally { setBusy(false); }
  };
  /** The same picker for both (D29): a preset or free text parsed to an instant, or the demo's seconds. */
  const pickSnooze = (choice: SnoozeInput & { seconds?: number }) => { const { seconds: _s, ...input } = choice; void snooze(input); };
  const pickRemind = (choice: SnoozeInput & { seconds?: number }) => { const seconds = choice.seconds ?? (choice.until ? Math.max(1, Math.ceil((Date.parse(choice.until) - Date.now()) / 1000)) : 0); if (seconds) void remind(seconds); };
  return { selected, setSelected, selectable, busy, error, why, setWhy, run, perform, snooze, dismiss, remind, pickSnooze, pickRemind };
}
type Actions = ReturnType<typeof useThreadActions>;

/**
 * The action row shared by every card: one primary and up to two secondary actions from the connector, then Clew's
 * standard actions (Lägg till i samtalet, Inte nu, and Avfärda and Varför ser jag detta? behind ⋯). The primary button
 * is black only where something is due; a notice gets a secondary button so it never competes with a deadline.
 */
function ActionRow({ thread, level, actions }: { thread: Thread; level: AttentionLevel; actions: Actions }) {
  const conversation = useConversation();
  const countdown = useCountdown(thread.receipt?.undoUntil ?? null);
  const chipRef = 'thread:' + thread.id;
  const inConversation = conversation.chipped.includes(chipRef);
  const open = thread.state === 'open';
  const { selected, selectable, perform, dismiss, setWhy, run, pickSnooze, pickRemind } = actions;
  const presets = usePresets();
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
  /** Inte nu and Påminn mig (D17, D29): the same picker, the first silent, the second with the badge and the toast. Ten seconds is the demo entry. */
  const snoozeMenu = <TimePicker label="Inte nu" presets={presets} onPick={pickSnooze} />;
  const remindMenu = <TimePicker label="Påminn mig" presets={presets} demo={{ label: 'Om 10 sekunder', seconds: 10 }} onPick={pickRemind} />;
  const receipt = thread.receipt;
  const undoOpen = !!receipt && thread.state === 'handled' && !!receipt.undoCapability && !!countdown;
  // In the Inte nu pile (D28): the way back is the first button; nothing else is due until the card is back.
  if (open && isSnoozed(thread, new Date().toISOString())) return <HStack gap={2} vAlign="center" wrap="wrap">
    <Button size="sm" variant="secondary" label="Ta upp nu" clickAction={() => run(() => api.reopen(thread.id))} />
    <Button size="sm" variant="ghost" label={inConversation ? 'I samtalet ✓' : 'Lägg till i samtalet'} isDisabled={inConversation} onClick={() => conversation.addChip({ ref: chipRef, kind: 'thread', label: thread.title, threadId: thread.id })} />
    <MoreMenu label="Fler val" size="sm" variant="ghost" items={menu} />
  </HStack>;
  if (open && !thread.waitingOn) return <HStack gap={2} vAlign="center" wrap="wrap">
    {primary && <Button size="sm" variant={level === 'notice' ? 'secondary' : 'primary'} label={primaryLabel ?? ''} isDisabled={selectable && count === 0} clickAction={() => perform(primary)} />}
    {secondary.map(a => <Button key={a.id} size="sm" variant={level === 'notice' ? 'ghost' : 'secondary'} label={a.label} clickAction={() => perform(a)} />)}
    <Button size="sm" variant="ghost" label={inConversation ? 'I samtalet ✓' : 'Lägg till i samtalet'} isDisabled={inConversation} onClick={() => conversation.addChip({ ref: chipRef, kind: 'thread', label: thread.title, threadId: thread.id })} />
    {snoozeMenu}
    {remindMenu}
    <MoreMenu label="Fler val" size="sm" variant="ghost" items={menu} />
  </HStack>;
  if (undoOpen) return <HStack gap={2} vAlign="center" wrap="wrap">
    <Button size="sm" variant="destructive" label={`Ångra allt · ${countdown} kvar`} clickAction={() => run(() => api.undoReceipt(thread.id))} />
    {secondary.filter(a => a.kind === 'read').map(a => <Button key={a.id} size="sm" label={a.label} clickAction={() => perform(a)} />)}
    <Text type="supporting">Varje rad visar källsystemets svar. Grönt bara när det lästs tillbaka.</Text>
  </HStack>;
  if (open && thread.waitingOn) return <HStack gap={2} vAlign="center" wrap="wrap">
    <Button size="sm" variant="ghost" label={inConversation ? 'I samtalet ✓' : 'Lägg till i samtalet'} isDisabled={inConversation} onClick={() => conversation.addChip({ ref: chipRef, kind: 'thread', label: thread.title, threadId: thread.id })} />
    {remindMenu}
    <MoreMenu label="Fler val" size="sm" variant="ghost" items={menu} />
  </HStack>;
  return null;
}
const WhyLine = ({ thread }: { thread: Thread }) => <Text type="supporting" as="p">Varför nu? {thread.trigger.reason}. Källa: {thread.trigger.source}, {clock(thread.trigger.at)}.</Text>;

type Props = ActionProps & { areaTitle: string; position?: string; compact: boolean; expanded?: boolean; headingLevel?: 2 | 3 | 4 };
/**
 * A generic card for any connector's thread (thread action contract): one lead sentence, rows with refs, the shared
 * action row, and the receipt read back from the source after an execute. Connectors contribute actions, never layout.
 * Cards hold state and actions and never contain a text input (D12). A card due within three days is lifted
 * (elevation), a card waiting on someone else is muted; nothing else about its shape changes with the level.
 */
export function GenericCard({ thread, areaTitle, position, compact, expanded: expandedByDefault = true, headingLevel = 3, onChange, onOpenCardView }: Props) {
  const [expanded, setExpanded] = useState(expandedByDefault);
  useEffect(() => { setExpanded(expandedByDefault); }, [expandedByDefault]);
  // The title button is gone once the card is open, and focus goes with it: it continues at the title in the open card (2.4.3).
  const title = useRef<HTMLHeadingElement>(null);
  const focusTitle = useRef(false);
  useEffect(() => { if (expanded && focusTitle.current) { focusTitle.current = false; title.current?.focus(); } }, [expanded]);
  const actions = useThreadActions({ thread, onChange, onOpenCardView });
  const { selected, setSelected, selectable, error, why } = actions;
  const conversation = useConversation();
  // The card is lifted while its chip, or one of its rows' chips, is in the row (canvas row Chips); the row itself is marked too.
  const rowChipped = (ref: string) => conversation.chipped.includes(ref);
  const inConversation = rowChipped('thread:' + thread.id) || thread.items.some(i => rowChipped(i.ref));
  const open = thread.state === 'open';
  const level = attentionLevel(thread, today());
  const draft = thread.messages.at(-1)?.meta?.draft;
  const receipt = thread.receipt;
  const headerRow = <HStack justify="between" vAlign="center" gap={2} wrap="wrap">
    <HStack gap={2} vAlign="center" wrap="wrap">
      <Badge variant="neutral" label={areaTitle} />
      <Text type="supporting">{position ? `${position} · ` : ''}{thread.trigger.source} · <Timestamp value={thread.trigger.at} format="time" hasTooltip={false} /></Text>
      {/* Why the card is here, as a token that can be read and announced, never a tooltip (D28). A token never wraps, so a phone gets the same words as text (1.4.10). */}
      {compact ? <Text type="supporting">Varför: {thread.trigger.reason}</Text> : <Token size="sm" color="gray" label={`Varför: ${thread.trigger.reason}`} />}
      {inConversation && <Badge variant="neutral" icon={<Icon icon="checkDouble" size="sm" />} label="I samtalet" />}
      {draft && open && <Badge variant="warning" icon={<Icon icon="warning" size="sm" />} label="Att bekräfta · utkast från samtalet" />}
      {open && thread.remindedAt && attentionLevel(thread, today()) === 'now' && <Badge variant="error" icon={<Icon icon="clock" size="sm" />} label={`Påminnelse · ${clock(thread.remindedAt)}`} />}
    </HStack>
    {receipt ? <ReceiptBadge thread={thread} /> : open && thread.snoozedUntil && isSnoozed(thread, new Date().toISOString()) ? <Badge variant="neutral" icon={<Icon icon="clock" size="sm" />} label={snoozedLabel(thread.snoozedUntil)} /> : thread.waitingOn ? <Badge variant="neutral" label={`Väntar på ${thread.waitingOn}`} /> : <DeadlineBadge thread={thread} />}
  </HStack>;
  const actionRow = <ActionRow thread={thread} level={level} actions={actions} />;
  // A card due today is lifted, a card waiting on someone else or set aside is muted; nothing else about its shape changes (D28).
  const elevation = open && !thread.waitingOn && streamGroup(thread, today()) === 'nu' ? 'low' : 'none';
  const variant = open && (thread.waitingOn || isSnoozed(thread, new Date().toISOString())) ? 'muted' : 'default';
  // Collapsed: the two-line row from the canvas. Title and summary on the left, the actions on the right.
  if (!expanded && !receipt && !compact) return <Card padding={2} elevation={elevation} variant={variant}>
    <VStack gap={1} as="article" tabIndex={-1} aria-label={`Tråd: ${thread.title}`} id={`thread-${thread.id}`} aria-current={inConversation ? 'true' : undefined}>
      {headerRow}
      <HStack justify="between" vAlign="center" gap={3} wrap="wrap">
        <Heading level={4} accessibilityLevel={headingLevel}><Button variant="ghost" size="sm" label={thread.title} aria-expanded={false} onClick={() => { focusTitle.current = true; setExpanded(true); }} /></Heading>
        {actionRow}
      </HStack>
      <Text type="supporting" as="p">{thread.summary}</Text>
      {why && <WhyLine thread={thread} />}
      {error && <Text as="p" role="alert" color="accent">{error}</Text>}
    </VStack>
  </Card>;
  return <Card padding={2} elevation={elevation} variant={variant}>
    <VStack gap={2} as="article" tabIndex={-1} aria-label={`Tråd: ${thread.title}`} id={`thread-${thread.id}`} aria-current={inConversation ? 'true' : undefined}>
      {headerRow}
      <Heading ref={title} tabIndex={-1} level={4} accessibilityLevel={headingLevel}>{receipt ? receipt.headline : thread.title}</Heading>
      {!receipt && thread.summary && <Text as="p" color="secondary">{thread.summary}</Text>}
      {thread.items.length > 0 && !receipt && (selectable
        ? <CheckboxList label="Rader" isLabelHidden value={selected} onChange={setSelected} isReadOnly={!open} density="compact">
          {thread.items.map(i => <CheckboxListItem key={i.ref} value={i.ref} label={<Text>{`${i.label} · ${i.detail}`}</Text>} />)}
        </CheckboxList>
        : <List density="compact" hasDividers>{thread.items.map(i => <ListItem key={i.ref} isSelected={rowChipped(i.ref)} label={<HStack gap={2} vAlign="center"><Text weight="semibold">{i.label}</Text><Text type="supporting">{i.detail}</Text></HStack>} />)}</List>)}
      {receipt && <List density="compact" hasDividers aria-label="Kvitto, rad för rad">
        {receipt.rows.map(r => <ListItem key={r.ref} label={<HStack gap={2} vAlign="center"><StatusDot variant={outcomeDot[r.outcome].variant} label={outcomeDot[r.outcome].label} /><Text>{r.label}</Text></HStack>} description={<Text type="supporting">{r.detail}</Text>} />)}
      </List>}
      {draft && open && <Text type="supporting" as="p">Utkast från samtalet. Inget är skickat förrän du trycker på knappen här.</Text>}
      {error && <Text as="p" role="alert" color="accent">{error}</Text>}
      {actionRow}
      {why && <WhyLine thread={thread} />}
      {thread.messages.length > 2 && <Collapsible defaultIsOpen={false} chevronPosition="start" trigger={<Text type="supporting">Tråden · {thread.messages.length} meddelanden</Text>}>
        <List density="compact">{thread.messages.map(m => <ListItem key={m.id} label={<Text>{m.body}</Text>} description={m.role === 'user' ? 'Du' : thread.trigger.source} />)}</List>
      </Collapsible>}
    </VStack>
  </Card>;
}

/** One notice as a row: a blue "Till kännedom" badge, the title, the source and the summary, and the action row at the end. */
function NoticeRow({ thread, onChange, onOpenCardView }: ActionProps) {
  const actions = useThreadActions({ thread, onChange, onOpenCardView });
  const { error, why } = actions;
  const conversation = useConversation();
  return <ListItem id={`thread-${thread.id}`} tabIndex={-1} align="start" isSelected={conversation.chipped.includes('thread:' + thread.id)} startContent={<Badge variant="info" label="Till kännedom" />}
    label={<Text weight="semibold">{thread.title}</Text>}
    description={<VStack gap={1}>
      <Text type="supporting">{thread.trigger.source} · <Timestamp value={thread.trigger.at} format="time" hasTooltip={false} />{thread.summary ? ` · ${thread.summary}` : ''}</Text>
      {why && <WhyLine thread={thread} />}
      {error && <Text as="p" role="alert" color="accent">{error}</Text>}
    </VStack>}
    endContent={<ActionRow thread={thread} level="notice" actions={actions} />} />;
}
/**
 * Notices share one card as rows (Astryx: dense data is rows, not cards). A card per notice would weigh as much as a
 * card with a deadline, and the blue row never competes with a red card for the eye.
 */
export function NoticeList({ threads, onChange, onOpenCardView }: { threads: Thread[]; onChange: (thread: Thread) => void; onOpenCardView: (threadId: string, actionId: string) => void }) {
  // The same inset as a thread card, so a lifted row's ring stays inside the card's rounded edge.
  return <Card padding={2}>
    <List density="balanced" hasDividers aria-label="Till kännedom">
      {threads.map(t => <NoticeRow key={t.id} thread={t} onChange={onChange} onOpenCardView={onOpenCardView} />)}
    </List>
  </Card>;
}
