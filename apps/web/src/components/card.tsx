import { useEffect, useRef, useState } from 'react';
import { attentionLevel, dayWord, daysUntil, isSnoozed, parseSwedishTime, snoozeWhen, streamGroup, type AttentionLevel, type SnoozeInput, type SnoozePreset, type Thread, type ThreadAction } from '@clew/contracts';
import { Badge, Button, Card, CheckboxList, CheckboxListItem, Collapsible, Dialog, DialogHeader, DropdownMenu, DropdownMenuDivider, DropdownMenuItem, DropdownMenuSubMenu, Heading, HStack, Icon, IconButton, List, ListItem, StatusDot, Text, TextInput, Timestamp, VStack, useToast } from '@clew/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { today } from '@clew/calendar/dates';
import { api, ApiError } from '../api';
import { snoozePresetsQuery } from '../queries';
import { useThreadAction } from '../mutations';
import { invalidateStream } from '../thread-cache';
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
export function useLeaveWithUndo(apply: (thread: Thread) => void) {
  const toast = useToast();
  return (thread: Thread, text: string, undo: () => Promise<Thread> = () => api.reopen(thread.id)) => {
    const dismiss = toast({ body: text, isAutoHide: false, uniqueID: 'leave:' + thread.id,
      endContent: <Button size="sm" variant="ghost" label="Ångra" clickAction={async () => { apply(await undo()); dismiss(); }} /> });
  };
}

/**
 * The deadline is text, with the day word in place of a colour (D28); only a deadline that is today or has passed is a
 * status that needs action, and gets the one red badge on the page (Astryx: a Badge is for status that needs action,
 * never for a date or a duration).
 */
export function deadlineLabel(deadline: string, now = today()) {
  const days = daysUntil(deadline.slice(0, 10), now);
  if (days < 0) return `Skulle varit klar ${shortDate(deadline)}`;
  if (days === 0) return 'Senast i dag';
  return days <= 30 ? `${dayWord(deadline.slice(0, 10), now)} · ${days} ${days === 1 ? 'dag' : 'dagar'}` : `${dayWord(deadline.slice(0, 10), now)}`;
}
export function Deadline({ thread }: { thread: Thread }) {
  if (!thread.deadline) return null;
  const now = today();
  if (streamGroup({ deadline: thread.deadline }, now) === 'nu') return <Badge variant="error" icon={<Icon icon="clock" size="sm" />} label={daysUntil(thread.deadline.slice(0, 10), now) < 0 ? 'Försenad' : 'Senast i dag'} />;
  return <Text type="supporting" hasTabularNumbers>{deadlineLabel(thread.deadline, now)}</Text>;
}
/** Inte nu (D28): when the card comes back, as words on a card in the pile. */
const snoozedLabel = (until: string, now = today()) => { const date = new Date(until).toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' }); return `Tillbaka ${dayWord(date, now) === 'i dag' ? '' : dayWord(date, now) + ' '}${clock(until)}`; };
/** The receipt: green only when every row was read back, as a dot with its word; a row the source did not confirm is a badge, because it needs a hand. */
export function ReceiptStatus({ thread }: { thread: Thread }) {
  const receipt = thread.receipt;
  if (!receipt) return null;
  const unknown = receipt.rows.filter(r => r.outcome === 'unknown').length, failed = receipt.rows.filter(r => r.outcome === 'failed').length;
  const sent = <Text type="supporting">Skickat {clock(receipt.at)}{!failed && !unknown ? ` · kontrollerat mot ${thread.trigger.source}` : ''}</Text>;
  if (failed) return <HStack gap={2} vAlign="center" wrap="wrap"><Badge variant="error" icon={<Icon icon="error" size="sm" />} label={`${failed} rad misslyckades`} />{sent}</HStack>;
  if (unknown) return <HStack gap={2} vAlign="center" wrap="wrap"><Badge variant="warning" icon={<Icon icon="warning" size="sm" />} label={`${unknown} rad obekräftad`} />{sent}</HStack>;
  return <HStack gap={1} vAlign="center" wrap="wrap"><StatusDot variant="success" label="Läst tillbaka" />{sent}</HStack>;
}

/** The picker's rows (D29): one query for the whole page, kept a minute (snoozePresetsQuery), so every card shows the same times. */
const EMPTY_PRESETS: SnoozePreset[] = [];
const usePresets = () => useQuery(snoozePresetsQuery).data?.presets ?? EMPTY_PRESETS;
type TimeChoice = SnoozeInput & { seconds?: number };
/**
 * "Inte nu" and "Påminn mig" are the same picker (D29): the presets with the time each lands on, then "Skriv själv …"
 * for free text in the composer's grammar, parsed as the person types so the time is shown before it is set. The rows
 * go in a menu of their own or under ⋯; the form Dialog stays mounted outside the menu, which closes when it opens.
 */
function useTimeRows({ presets, demo, onPick }: { presets: SnoozePreset[]; demo?: { label: string; seconds: number }; onPick: (choice: TimeChoice) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const parsed = text.trim() ? parseSwedishTime(text, new Date().toISOString()) : null;
  const when = parsed ? snoozeWhen(parsed, new Date().toISOString()) : null;
  const rows = [
    ...(demo ? [{ id: 'demo', label: demo.label, description: 'demo', onClick: () => onPick({ seconds: demo.seconds }) }] : []),
    ...presets.map(p => ({ id: p.id, label: p.label, description: p.detail, onClick: () => onPick({ preset: p.id, until: p.at }) })),
  ];
  const own = { id: 'text', label: 'Skriv själv …', description: '”fredag kl 9”, ”om 20 min”', onClick: () => { setText(''); setOpen(true); } };
  const pick = () => { if (parsed) { onPick({ text, until: parsed }); setOpen(false); } };
  const dialog = <Dialog isOpen={open} onOpenChange={setOpen} purpose="form">
    <DialogHeader title="När ska jag ta upp det igen?" />
    <VStack gap={3} padding={3}>
      <TextInput label="När?" value={text} onChange={setText} placeholder="fredag kl 9" description="Till exempel ”om 20 min”, ”efter lunch”, ”i morgon kl 9”, ”fredag kl 9”, ”nästa vecka”"
        status={text.trim() && !parsed ? { type: 'error', message: 'Jag förstod inte tiden.' } : undefined} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); pick(); } }} />
      <HStack gap={2} justify="between" vAlign="center" wrap="wrap">
        <Text type="supporting" role="status">{when ? `Tas upp ${when}` : ' '}</Text>
        <HStack gap={2}>
          <Button size="sm" variant="ghost" label="Avbryt" onClick={() => setOpen(false)} />
          <Button size="sm" variant="primary" label={when ? `Ta upp ${when}` : 'Ta upp'} isDisabled={!parsed} onClick={pick} />
        </HStack>
      </HStack>
    </VStack>
  </Dialog>;
  return { rows, own, dialog };
}
type TimeRows = ReturnType<typeof useTimeRows>;
/** The picker as its own button: an Astryx DropdownMenu, a bottom sheet on a phone, the rows with the time as description. */
const TimePicker = ({ label, rows, own }: { label: string; rows: TimeRows['rows']; own: TimeRows['own'] }) =>
  <DropdownMenu button={{ label, size: 'sm', variant: 'ghost' }} presentation="adaptive" menuMaxHeight={480} items={[...rows, { type: 'divider' as const }, own]} />;
/** The picker as a row under ⋯: Astryx's flyout beside the row, a drilled-in view with a Back row on a phone. */
const TimeSubMenu = ({ label, rows, own }: { label: string; rows: TimeRows['rows']; own: TimeRows['own'] }) => <DropdownMenuSubMenu label={label} menuWidth={260}>
  {rows.map(r => <DropdownMenuItem key={r.id} label={r.label} description={r.description} onClick={r.onClick} />)}
  <DropdownMenuDivider />
  <DropdownMenuItem label={own.label} description={own.description} onClick={own.onClick} />
</DropdownMenuSubMenu>;
type ActionProps = { thread: Thread; onChange: (thread: Thread) => void; onOpenCardView: (threadId: string, actionId: string) => void };
/** Everything a card can do, shared by the card and the row: run an action, snooze, dismiss, explain, and keep the selection. */
function useThreadActions({ thread, onChange, onOpenCardView }: ActionProps) {
  const [selected, setSelected] = useState<string[]>(() => thread.items.filter(i => i.selected).map(i => i.ref));
  const [why, setWhy] = useState(false);
  useEffect(() => { setSelected(thread.items.filter(i => i.selected).map(i => i.ref)); }, [thread.updatedAt]);
  // Busy never disables the buttons: a disabled button drops the focus it holds (2.4.3). Action-buttons wait on their own promise.
  // The thread an action returns goes into the cache for every screen (D33); `onChange` lets the page move focus first.
  const { run, apply, busy, error } = useThreadAction({ onChange });
  const client = useQueryClient();
  const leave = useLeaveWithUndo(apply);
  const selectable = thread.items.some(i => i.selectable);
  const perform = async (action: ThreadAction) => {
    if (busy) return;
    if (action.confirm && !window.confirm(action.confirm)) return;
    if (action.kind === 'read') {
      if (action.target === 'link') {
        await run(async () => {
          const result = await api.act(thread.id, action.id, selectable ? selected : undefined);
          if (result.kind === 'read' && typeof (result.output as { url?: string }).url === 'string') window.open((result.output as { url: string }).url, '_blank', 'noopener');
        });
        return;
      }
      // A panel view has an address: /views/card/:thread/:action, so it survives reload and the back button closes it.
      onOpenCardView(thread.id, action.id);
      return;
    }
    await run(async () => { const result = await api.act(thread.id, action.id, selectable ? selected : undefined); if (result.kind !== 'execute') throw new ApiError(500, 'Oväntat svar.'); return result.thread; });
  };
  const snooze = (choice: SnoozeInput = {}) => run(async () => { const t = await api.snooze(thread.id, choice); leave(t, `Tas upp ${t.snoozedUntil ? snoozeWhen(t.snoozedUntil, new Date().toISOString()) : 'i morgon 06:00'} i stället.`); return t; });
  const dismiss = () => run(async () => { const t = await api.dismiss(thread.id); leave(t, `Avfärdad som inte aktuellt. ${thread.trigger.source} skapar inte kortet igen.`); return t; });
  /** A person's own timer (D17): the card waits under Pågår utan dig until the timer brings it back; Ångra cancels the timer. When it fires, the stream is read again. */
  const remind = (seconds: number) => run(async () => {
    const r = await api.remind(thread.id, seconds);
    const when = seconds < 60 ? `om ${seconds} sekunder` : clock(r.fireAt);
    leave(r.thread, `Påminner dig ${when}. Kortet väntar under Pågår utan dig tills dess.`, () => api.cancelReminder(thread.id, r.id));
    window.setTimeout(() => invalidateStream(client), seconds * 1000 + 1_500);
    return r.thread;
  });
  /** The same picker for both (D29): a preset or free text parsed to an instant, or the demo's seconds. */
  const pickSnooze = (choice: TimeChoice) => { const { seconds: _s, ...input } = choice; void snooze(input); };
  const pickRemind = (choice: TimeChoice) => { const seconds = choice.seconds ?? (choice.until ? Math.max(1, Math.ceil((Date.parse(choice.until) - Date.now()) / 1000)) : 0); if (seconds) void remind(seconds); };
  return { selected, setSelected, selectable, busy, error, why, setWhy, run, perform, snooze, dismiss, remind, pickSnooze, pickRemind };
}
type Actions = ReturnType<typeof useThreadActions>;

/**
 * The action row shared by every card and row: one primary and up to two secondary actions from the connector, Inte nu,
 * and the rest behind ⋯ (Lägg till i samtalet, Påminn mig, Avfärda, Varför ser jag detta?). One control size for the
 * whole row. Black is kept for what is due today, so the eye finds the day's work; everything else is a secondary
 * button. A row (`quiet`) shows the primary alone and keeps the rest behind ⋯; opening the row as a card shows them.
 */
function ActionRow({ thread, level, actions, quiet = false }: { thread: Thread; level: AttentionLevel; actions: Actions; quiet?: boolean }) {
  const conversation = useConversation();
  const countdown = useCountdown(thread.receipt?.undoUntil ?? null);
  const chipRef = 'thread:' + thread.id;
  const inConversation = conversation.chipped.includes(chipRef);
  const open = thread.state === 'open';
  const { selected, selectable, perform, dismiss, setWhy, run, pickSnooze, pickRemind } = actions;
  const presets = usePresets();
  const snoozeRows = useTimeRows({ presets, onPick: pickSnooze });
  const remindRows = useTimeRows({ presets, demo: { label: 'Om 10 sekunder', seconds: 10 }, onPick: pickRemind });
  const primary = thread.actions.find(a => a.role === 'primary');
  const secondary = thread.actions.filter(a => a.role === 'secondary').slice(0, 2);
  const overflow = thread.actions.filter(a => a.role === 'overflow' || (a.role === 'secondary' && !secondary.includes(a)));
  const count = selected.length;
  const primaryLabel = primary && selectable ? `${primary.label} · ${count}` : primary?.label;
  const due = level !== 'notice' && streamGroup(thread, today()) === 'nu';
  /** ⋯: MoreMenu's button over DropdownMenu's compound rows, because MoreMenu's data rows cannot hold a sub-menu. */
  const more = ({ tucked = [], times = [] }: { tucked?: ThreadAction[]; times?: { label: string; rows: TimeRows }[] }) => <>
    <DropdownMenu renderTrigger={trigger => <IconButton {...trigger} size="sm" variant="ghost" label="Fler val" tooltip="Fler val" icon={<Icon icon="moreHorizontal" />} />} alignment="end" menuWidth={300} menuMaxHeight={480}>
      {[...tucked, ...overflow].map(a => <DropdownMenuItem key={a.id} label={a.label} onClick={() => void perform(a)} />)}
      <DropdownMenuItem label={inConversation ? 'I samtalet' : 'Lägg till i samtalet'} isDisabled={inConversation} onClick={() => conversation.addChip({ ref: chipRef, kind: 'thread', label: thread.title, threadId: thread.id })} />
      {times.map(t => <TimeSubMenu key={t.label} label={t.label} rows={t.rows.rows} own={t.rows.own} />)}
      <DropdownMenuDivider />
      <DropdownMenuItem label="Avfärda · inte aktuellt" onClick={() => void dismiss()} />
      <DropdownMenuItem label="Varför ser jag detta?" onClick={() => setWhy(v => !v)} />
    </DropdownMenu>
    {snoozeRows.dialog}
    {remindRows.dialog}
  </>;
  const receipt = thread.receipt;
  const undoOpen = !!receipt && thread.state === 'handled' && !!receipt.undoCapability && !!countdown;
  // In the Inte nu pile (D28): the way back is the first button; nothing else is due until the card is back.
  if (open && isSnoozed(thread, new Date().toISOString())) return <HStack gap={2} vAlign="center" wrap="wrap">
    <Button size="sm" variant="secondary" label="Ta upp nu" clickAction={() => run(() => api.reopen(thread.id))} />
    {more({})}
  </HStack>;
  if (open && !thread.waitingOn) return <HStack gap={2} vAlign="center" wrap={quiet ? undefined : 'wrap'}>
    {primary && <Button size="sm" variant={due ? 'primary' : 'secondary'} label={primaryLabel ?? ''} isDisabled={selectable && count === 0} clickAction={() => perform(primary)} />}
    {!quiet && secondary.map(a => <Button key={a.id} size="sm" variant={due ? 'secondary' : 'ghost'} label={a.label} clickAction={() => perform(a)} />)}
    {!quiet && <TimePicker label="Inte nu" rows={snoozeRows.rows} own={snoozeRows.own} />}
    {more(quiet ? { tucked: secondary, times: [{ label: 'Inte nu · lägg undan', rows: snoozeRows }, { label: 'Påminn mig · kortet ligger kvar', rows: remindRows }] } : { times: [{ label: 'Påminn mig · kortet ligger kvar', rows: remindRows }] })}
  </HStack>;
  if (undoOpen) return <HStack gap={2} vAlign="center" wrap="wrap">
    <Button size="sm" variant="destructive" label={`Ångra allt · ${countdown} kvar`} clickAction={() => run(() => api.undoReceipt(thread.id))} />
    {secondary.filter(a => a.kind === 'read').map(a => <Button key={a.id} size="sm" label={a.label} clickAction={() => perform(a)} />)}
    <Text type="supporting">Varje rad visar källsystemets svar. Grönt bara när det lästs tillbaka.</Text>
  </HStack>;
  if (open && thread.waitingOn) return <HStack gap={2} vAlign="center" wrap="wrap">
    <TimePicker label="Påminn mig" rows={remindRows.rows} own={remindRows.own} />
    {more({})}
  </HStack>;
  return null;
}
const WhyLine = ({ thread }: { thread: Thread }) => <Text type="supporting" as="p">Varför nu? {thread.trigger.reason.replace(/\.$/, '')}. Källa: {thread.trigger.source}, {clock(thread.trigger.at)}.</Text>;

/** The right-hand state of a card or row: the receipt, the snooze, who it waits on, or the deadline. Never more than one. */
function State({ thread }: { thread: Thread }) {
  const open = thread.state === 'open';
  if (thread.receipt) return <ReceiptStatus thread={thread} />;
  if (open && thread.snoozedUntil && isSnoozed(thread, new Date().toISOString())) return <Text type="supporting">{snoozedLabel(thread.snoozedUntil)}</Text>;
  if (thread.waitingOn) return <Text type="supporting">Väntar på {thread.waitingOn}</Text>;
  return <Deadline thread={thread} />;
}
/** The badges that need a hand: a draft to confirm, a reminder that has fired. */
function Flags({ thread }: { thread: Thread }) {
  const open = thread.state === 'open';
  const draft = thread.messages.at(-1)?.meta?.draft;
  return <>
    {draft && open && <Badge variant="warning" icon={<Icon icon="warning" size="sm" />} label="Att bekräfta" />}
    {open && thread.remindedAt && attentionLevel(thread, today()) === 'now' && <Badge variant="error" icon={<Icon icon="clock" size="sm" />} label="Påminnelse" />}
  </>;
}
/** A card's metadata line, in words and one colour: the area, the position in the group, the source and the time, whether it is in the conversation. On the page, colour means something is due. */
function Meta({ thread, areaTitle, position, inConversation }: { thread: Thread; areaTitle: string; position?: string; inConversation?: boolean }) {
  return <HStack gap={2} vAlign="center" wrap="wrap">
    <Text type="supporting">{areaTitle} · {position ? `${position} · ` : ''}{thread.trigger.source} · <Timestamp value={thread.trigger.at} format="time" hasTooltip={false} />{inConversation ? ' · I samtalet' : ''}</Text>
    <Flags thread={thread} />
  </HStack>;
}

type Props = ActionProps & { areaTitle: string; position?: string; headingLevel?: 2 | 3 | 4; autoFocusTitle?: boolean };
/**
 * A thread open on the page (thread action contract): one lead sentence, rows with refs, the shared action row, and the
 * receipt read back from the source after an execute. Connectors contribute actions, never layout. Cards hold state and
 * actions and never contain a text input (D12). A card is the exception on the page (Astryx: a Card is a discrete item);
 * the collapsed threads in a group are rows (`ThreadRow`). A card due today is lifted, a card in the conversation too;
 * a card waiting on someone else or set aside is muted.
 */
export function GenericCard({ thread, areaTitle, position, headingLevel = 3, autoFocusTitle = false, onChange, onOpenCardView }: Props) {
  // Opened from its row, the title takes the focus the row's button had (2.4.3).
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (autoFocusTitle) title.current?.focus(); }, []);
  const actions = useThreadActions({ thread, onChange, onOpenCardView });
  const { selected, setSelected, selectable, error, why } = actions;
  const conversation = useConversation();
  const rowChipped = (ref: string) => conversation.chipped.includes(ref);
  const inConversation = rowChipped('thread:' + thread.id) || thread.items.some(i => rowChipped(i.ref));
  const open = thread.state === 'open';
  const level = attentionLevel(thread, today());
  const draft = thread.messages.at(-1)?.meta?.draft;
  const receipt = thread.receipt;
  const elevation = open && !thread.waitingOn && (streamGroup(thread, today()) === 'nu' || inConversation) ? 'low' : 'none';
  const variant = open && (thread.waitingOn || isSnoozed(thread, new Date().toISOString())) ? 'muted' : 'default';
  return <Card padding={3} elevation={elevation} variant={variant}>
    <VStack gap={2} as="article" tabIndex={-1} aria-label={`Kort: ${thread.title}`} id={`thread-${thread.id}`} aria-current={inConversation ? 'true' : undefined}>
      <HStack justify="between" vAlign="center" gap={2} wrap="wrap">
        <Meta thread={thread} areaTitle={areaTitle} position={position} inConversation={inConversation} />
        <State thread={thread} />
      </HStack>
      <Heading ref={title} tabIndex={-1} level={3} accessibilityLevel={headingLevel}>{receipt ? receipt.headline : thread.title}</Heading>
      {!receipt && thread.summary && <Text as="p" color="secondary">{thread.summary}</Text>}
      {/* Why the card is here, as words that can be read and announced, never a tooltip (D28). */}
      {!receipt && <Text as="p" type="supporting">Varför: {thread.trigger.reason}</Text>}
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
      <ActionRow thread={thread} level={level} actions={actions} />
      {why && <WhyLine thread={thread} />}
      {thread.messages.length > 2 && <Collapsible defaultIsOpen={false} chevronPosition="start" trigger={<Text type="supporting">Historik · {thread.messages.length} meddelanden</Text>}>
        <List density="compact">{thread.messages.map(m => <ListItem key={m.id} label={<Text>{m.body}</Text>} description={m.role === 'user' ? 'Du' : thread.trigger.source} />)}</List>
      </Collapsible>}
    </VStack>
  </Card>;
}

type RowProps = ActionProps & { areaTitle: string; notice?: boolean; onExpand: (threadId: string) => void };
/**
 * A thread as a row in its group's list (Astryx: records are rows, a Card is the exception): the title is the control
 * that opens it as a card, one line under it says where it belongs and why it is here, the same line as the brief's,
 * and the state and the one next step sit at the end. A notice carries the info icon in place of a deadline. The row
 * keeps the card's id so focus and the toasts find it.
 */
export function ThreadRow({ thread, areaTitle, notice = false, onChange, onOpenCardView, onExpand }: RowProps) {
  const actions = useThreadActions({ thread, onChange, onOpenCardView });
  const { error, why } = actions;
  const conversation = useConversation();
  const level = notice ? 'notice' : attentionLevel(thread, today());
  const inConversation = conversation.chipped.includes('thread:' + thread.id);
  return <ListItem id={`thread-${thread.id}`} tabIndex={-1} align="start"
    startContent={notice ? <Icon icon="info" color="info" /> : undefined}
    label={<Button variant="ghost" size="sm" label={thread.title} aria-expanded={false} onClick={() => onExpand(thread.id)} />}
    description={<VStack gap={1} paddingInlineStart={3}>
      <HStack gap={2} vAlign="center" wrap="wrap">
        <Text type="supporting">{areaTitle} · {thread.trigger.reason.replace(/\.$/, '')}{inConversation ? ' · I samtalet' : ''}</Text>
        <Flags thread={thread} />
      </HStack>
      {why && <WhyLine thread={thread} />}
      {error && <Text as="p" role="alert" color="accent">{error}</Text>}
    </VStack>}
    endContent={<HStack gap={3} vAlign="center"><State thread={thread} /><ActionRow thread={thread} level={level} actions={actions} quiet /></HStack>} />;
}

/**
 * The next step alone (D34): the thread's primary action as one button, for the brief on the landing. Black where the day
 * is today, soft otherwise; the count follows the selection the connector wrote. The full action row is on the card.
 */
export function PrimaryAction({ thread, onChange, onOpenCardView }: ActionProps) {
  const actions = useThreadActions({ thread, onChange, onOpenCardView });
  const primary = thread.actions.find(a => a.role === 'primary');
  if (!primary || thread.state !== 'open') return null;
  const label = actions.selectable ? `${primary.label} · ${actions.selected.length}` : primary.label;
  return <VStack gap={1}>
    <Button size="sm" variant={thread.deadline && streamGroup(thread, today()) === 'nu' ? 'primary' : 'secondary'} label={label} isDisabled={actions.selectable && actions.selected.length === 0} clickAction={() => actions.perform(primary)} />
    {actions.error && <Text as="p" role="alert" color="accent">{actions.error}</Text>}
  </VStack>;
}
