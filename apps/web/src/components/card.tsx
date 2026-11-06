import { useEffect, useRef, useState } from 'react';
import {
  attentionLevel,
  cardKind,
  dayWord,
  daysUntil,
  isSnoozed,
  parseSwedishTime,
  snoozeWhen,
  streamGroup,
  type AttentionLevel,
  type SnoozeInput,
  type SnoozePreset,
  type Thread,
  type ThreadAction,
} from '@clew/contracts';
import {
  Badge,
  Button,
  Card,
  CheckboxList,
  CheckboxListItem,
  Collapsible,
  Dialog,
  DialogHeader,
  DropdownMenu,
  DropdownMenuDivider,
  DropdownMenuItem,
  DropdownMenuSubMenu,
  Heading,
  HStack,
  Icon,
  IconButton,
  Link,
  List,
  ListItem,
  MoreMenu,
  StatusDot,
  Text,
  TextInput,
  useAnimatedLayout,
  useAnnounce,
  useMediaQuery,
  useToast,
  VStack,
} from '@clew/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { today } from '@clew/calendar/dates';
import { api, ApiError } from '../api';
import { snoozePresetsQuery } from '../queries';
import { useSettling, useThreadAction, type RunAction } from '../mutations';
import { dismissed, reopened, snoozed } from '../optimistic';
import { invalidateStream } from '../thread-cache';
import { useConversation } from './conversation-context';
import { executionStatus } from '../execution-status';

const outcomeDot = {
  done: { variant: 'success', label: 'Klart' },
  unknown: { variant: 'warning', label: 'Okänt' },
  failed: { variant: 'error', label: 'Misslyckades' },
  skipped: { variant: 'neutral', label: 'Inte skickad' },
} as const;
const shortDate = (d: string) =>
  new Intl.DateTimeFormat('sv-SE', { day: 'numeric', month: 'short' }).format(new Date(d.slice(0, 10) + 'T12:00:00'));
const clock = (iso: string) => new Date(iso).toLocaleTimeString('sv-SE', { timeStyle: 'short' });
export function useCountdown(until: string | null) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!until) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [until]);
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
    const dismiss = toast({
      body: text,
      isAutoHide: false,
      uniqueID: 'leave:' + thread.id,
      endContent: (
        <Button
          size="sm"
          variant="ghost"
          label="Ångra"
          clickAction={async () => {
            apply(await undo());
            dismiss();
          }}
        />
      ),
    });
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
  return days <= 30
    ? `${dayWord(deadline.slice(0, 10), now)} · ${days} ${days === 1 ? 'dag' : 'dagar'}`
    : `${dayWord(deadline.slice(0, 10), now)}`;
}
export function Deadline({ thread }: { thread: Thread }) {
  if (!thread.deadline) return null;
  const now = today();
  if (streamGroup({ deadline: thread.deadline }, now) === 'nu')
    return <Badge variant="error" label={daysUntil(thread.deadline.slice(0, 10), now) < 0 ? 'försenad' : 'i dag'} />;
  return (
    <Text type="supporting" hasTabularNumbers>
      {deadlineLabel(thread.deadline, now)}
    </Text>
  );
}
/** Inte nu (D28): when the card comes back, as words on a card in the pile. */
const snoozedLabel = (until: string, now = today()) => {
  const date = new Date(until).toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' });
  return `Tillbaka ${dayWord(date, now) === 'i dag' ? '' : dayWord(date, now) + ' '}${clock(until)}`;
};
/** The receipt: green only when every row was read back, as a dot with its word; a row the source did not confirm is a badge, because it needs a hand. */
export function ReceiptStatus({ thread }: { thread: Thread }) {
  const receipt = thread.receipt;
  if (!receipt) return null;
  const unknown = receipt.rows.filter(r => r.outcome === 'unknown').length,
    failed = receipt.rows.filter(r => r.outcome === 'failed').length;
  const sent = (
    <Text type="supporting">
      Skickat {clock(receipt.at)}
      {!failed && !unknown ? ` · kontrollerat mot ${thread.trigger.source}` : ''}
    </Text>
  );
  if (failed)
    return (
      <HStack gap={2} vAlign="center" wrap="wrap">
        <Badge variant="error" icon={<Icon icon="error" size="sm" />} label={`${failed} rad misslyckades`} />
        {sent}
      </HStack>
    );
  if (unknown)
    return (
      <HStack gap={2} vAlign="center" wrap="wrap">
        <Badge variant="warning" icon={<Icon icon="warning" size="sm" />} label={`${unknown} rad obekräftad`} />
        {sent}
      </HStack>
    );
  return (
    <HStack gap={1} vAlign="center" wrap="wrap">
      <StatusDot variant="success" label="Läst tillbaka" />
      {sent}
    </HStack>
  );
}

/** The picker's rows (D29): one query for the whole page, kept a minute (snoozePresetsQuery), so every card shows the same times. */
const EMPTY_PRESETS: SnoozePreset[] = [];
const usePresets = () => useQuery(snoozePresetsQuery).data?.presets ?? EMPTY_PRESETS;
type TimeChoice = SnoozeInput & { seconds?: number };
/**
 * A card has one time action (D49): Inte nu while it is the person's, Påminn mig while it waits on someone else. Both are
 * this picker: the presets with the time each lands on, then "Skriv själv …" for free text in the composer's grammar,
 * parsed as the person types so the time is shown before it is set. The rows go in a menu of their own or under ⋯; the
 * form Dialog stays mounted outside the menu, which closes when it opens.
 */
function useTimeRows({
  presets,
  demo,
  onPick,
}: {
  presets: SnoozePreset[];
  demo?: { label: string; seconds: number };
  onPick: (choice: TimeChoice) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const parsed = text.trim() ? parseSwedishTime(text, new Date().toISOString()) : null;
  const when = parsed ? snoozeWhen(parsed, new Date().toISOString()) : null;
  const rows = [
    ...(demo
      ? [{ id: 'demo', label: demo.label, description: 'demo', onClick: () => onPick({ seconds: demo.seconds }) }]
      : []),
    ...presets.map(p => ({
      id: p.id,
      label: p.label,
      description: p.detail,
      onClick: () => onPick({ preset: p.id, until: p.at }),
    })),
  ];
  const own = {
    id: 'text',
    label: 'Skriv själv …',
    description: '”fredag kl 9”, ”om 20 min”',
    onClick: () => {
      setText('');
      setOpen(true);
    },
  };
  const pick = () => {
    if (parsed) {
      onPick({ text, until: parsed });
      setOpen(false);
    }
  };
  const dialog = (
    <Dialog isOpen={open} onOpenChange={setOpen} purpose="form">
      <DialogHeader title="När ska jag ta upp det igen?" />
      <VStack gap={3} padding={3}>
        <TextInput
          label="När?"
          value={text}
          onChange={setText}
          placeholder="fredag kl 9"
          description="Till exempel ”om 20 min”, ”efter lunch”, ”i morgon kl 9”, ”fredag kl 9”, ”nästa vecka”"
          status={text.trim() && !parsed ? { type: 'error', message: 'Jag förstod inte tiden.' } : undefined}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault();
              pick();
            }
          }}
        />
        <HStack gap={2} justify="between" vAlign="center" wrap="wrap">
          <Text type="supporting" role="status">
            {when ? `Tas upp ${when}` : ' '}
          </Text>
          <HStack gap={2}>
            <Button size="sm" variant="ghost" label="Avbryt" onClick={() => setOpen(false)} />
            <Button
              size="sm"
              variant="primary"
              label={when ? `Ta upp ${when}` : 'Ta upp'}
              isDisabled={!parsed}
              onClick={pick}
            />
          </HStack>
        </HStack>
      </VStack>
    </Dialog>
  );
  return { rows, own, dialog };
}
type TimeRows = ReturnType<typeof useTimeRows>;
/** Inte nu: the card leaves for the time chosen and comes back saying so (D49). Shared by the card, the row and the open thread. */
export function useSnoozeRows({
  thread,
  run,
  leave,
}: {
  thread: Thread;
  run: RunAction;
  leave: ReturnType<typeof useLeaveWithUndo>;
}) {
  return useTimeRows({
    presets: usePresets(),
    // The card leaves for the chosen time at once (D64); the toast confirms when the server has it.
    onPick: ({ seconds: _s, ...input }) =>
      void run(
        async () => {
          const t = await api.snooze(thread.id, input);
          leave(
            t,
            `Jag påminner dig ${t.snoozedUntil ? snoozeWhen(t.snoozedUntil, new Date().toISOString()) : 'i morgon 06:00'}. Kortet ligger under Inte nu tills dess.`,
          );
          return t;
        },
        input.until ? { optimistic: snoozed(thread, input.until) } : {},
      ),
  });
}
/** The picker as its own button: an Astryx DropdownMenu, a bottom sheet on a phone, the rows with the time as description. */
export const TimePicker = ({
  label,
  rows,
  own,
  size = 'sm',
}: {
  label: string;
  rows: TimeRows['rows'];
  own: TimeRows['own'];
  size?: 'sm' | 'md';
}) => (
  <DropdownMenu
    button={{ label, size, variant: 'ghost' }}
    presentation="adaptive"
    menuMaxHeight={480}
    items={[...rows, { type: 'divider' as const }, own]}
  />
);
/** The picker as a row under ⋯: Astryx's flyout beside the row, a drilled-in view with a Back row on a phone. */
const TimeSubMenu = ({ label, rows, own }: { label: string; rows: TimeRows['rows']; own: TimeRows['own'] }) => (
  <DropdownMenuSubMenu label={label} menuWidth={260}>
    {rows.map(r => (
      <DropdownMenuItem key={r.id} label={r.label} description={r.description} onClick={r.onClick} />
    ))}
    <DropdownMenuDivider />
    <DropdownMenuItem label={own.label} description={own.description} onClick={own.onClick} />
  </DropdownMenuSubMenu>
);
type ActionProps = {
  thread: Thread;
  onChange: (thread: Thread) => void;
  onOpenCardView: (threadId: string, actionId: string) => void;
};
/** Everything a card can do, shared by the card and the row: run an action, snooze, dismiss, explain, and keep the selection. */
function useThreadActions({ thread, onChange, onOpenCardView }: ActionProps) {
  // Busy never disables the buttons: a disabled button drops the focus it holds (2.4.3). Action-buttons wait on their own promise.
  // The thread an action returns goes into the cache for every screen (D33); `onChange` lets the page move focus first.
  const { run, apply, busy, error } = useThreadAction({ onChange });
  // The person's own action is on its way (D64): the card keeps the look it had, with the pressed button loading, and the
  // status is read out once the card has come to rest or the window has ended, not for every committed step in between.
  const held = useSettling(thread);
  const settling = busy || held;
  const [pressed, setPressed] = useState<string | null>(null);
  const status = executionStatus(thread.execution);
  const lastStatus = useRef(status),
    announce = useAnnounce({ hasReplace: true });
  useEffect(() => {
    if (settling || status === lastStatus.current) return;
    lastStatus.current = status;
    announce(status ?? thread.receipt?.headline ?? 'Åtgärden är kontrollerad.');
  }, [status, settling, announce, thread.receipt?.headline]);
  const [selected, setSelected] = useState<string[]>(() => thread.items.filter(i => i.selected).map(i => i.ref));
  useEffect(() => {
    setSelected(thread.items.filter(i => i.selected).map(i => i.ref));
  }, [thread.updatedAt]);
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
          if (result.kind === 'read' && typeof (result.output as { url?: string }).url === 'string')
            window.open((result.output as { url: string }).url, '_blank', 'noopener');
        });
        return;
      }
      // A panel view has an address (`open-card` and `open-action`), so it survives reload and the back button closes it.
      onOpenCardView(thread.id, action.id);
      return;
    }
    // The outcome is the source's (D45): nothing is predicted, the button stays loading until the answer has come to rest.
    setPressed(action.id);
    await run(
      async () => {
        const result = await api.act(thread.id, action.id, selectable ? selected : undefined);
        if (result.kind !== 'execute') throw new ApiError(500, 'Oväntat svar.');
        return result.thread;
      },
      { settle: true },
    );
  };
  // The card leaves at once (D64); the toast with Ångra confirms when the server has it.
  const dismiss = () =>
    run(
      async () => {
        const t = await api.dismiss(thread.id);
        leave(t, `Avfärdad som inte aktuellt. ${thread.trigger.source} skapar inte kortet igen.`);
        return t;
      },
      { optimistic: dismissed(thread, new Date().toISOString()) },
    );
  /** A person's own timer on a card that waits on someone else (D17, D49): the card stays where it is until the timer brings it back; Ångra cancels the timer. When it fires, the stream is read again. */
  const remind = (seconds: number) =>
    run(async () => {
      const r = await api.remind(thread.id, seconds);
      const when = seconds < 60 ? `om ${seconds} sekunder` : snoozeWhen(r.fireAt, new Date().toISOString());
      leave(r.thread, `Jag påminner dig ${when}.`, () => api.cancelReminder(thread.id, r.id));
      window.setTimeout(() => invalidateStream(client), seconds * 1000 + 1_500);
      return r.thread;
    });
  /** A preset or free text parsed to an instant, or the demo's seconds. */
  const pickRemind = (choice: TimeChoice) => {
    const seconds =
      choice.seconds ?? (choice.until ? Math.max(1, Math.ceil((Date.parse(choice.until) - Date.now()) / 1000)) : 0);
    if (seconds) void remind(seconds);
  };
  return {
    selected,
    setSelected,
    selectable,
    busy,
    settling,
    pressed,
    error,
    run,
    leave,
    perform,
    dismiss,
    pickRemind,
  };
}
type Actions = ReturnType<typeof useThreadActions>;

/**
 * The card's one time action (D49) on its own, for the panel's header beside the close button (artboard E): Inte nu while
 * the card is the person's, Påminn mig while it waits on someone else.
 */
export function CardTimeAction({ thread, onChange }: { thread: Thread; onChange: (thread: Thread) => void }) {
  const { run, apply } = useThreadAction({ onChange });
  const leave = useLeaveWithUndo(apply);
  const client = useQueryClient();
  const snoozeRows = useSnoozeRows({ thread, run, leave });
  const remindRows = useTimeRows({
    presets: usePresets(),
    demo: { label: 'Om 10 sekunder', seconds: 10 },
    onPick: choice => {
      const seconds =
        choice.seconds ?? (choice.until ? Math.max(1, Math.ceil((Date.parse(choice.until) - Date.now()) / 1000)) : 0);
      if (!seconds) return;
      void run(async () => {
        const r = await api.remind(thread.id, seconds);
        const when = seconds < 60 ? `om ${seconds} sekunder` : snoozeWhen(r.fireAt, new Date().toISOString());
        leave(r.thread, `Jag påminner dig ${when}.`, () => api.cancelReminder(thread.id, r.id));
        window.setTimeout(() => invalidateStream(client), seconds * 1000 + 1_500);
        return r.thread;
      });
    },
  });
  if (thread.state !== 'open' || isSnoozed(thread, new Date().toISOString()) || executionStatus(thread.execution))
    return null;
  return thread.waitingOn ? (
    <>
      <TimePicker label="Påminn mig" rows={remindRows.rows} own={remindRows.own} size="md" />
      {remindRows.dialog}
    </>
  ) : (
    <>
      <TimePicker label="Inte nu" rows={snoozeRows.rows} own={snoozeRows.own} size="md" />
      {snoozeRows.dialog}
    </>
  );
}

/**
 * The action row shared by every card and row (artboards A and E): the one next step from the connector, filled only
 * when the thread is due today (D48), with the secondary actions, "Lägg till i samtalet" and the card's one time action
 * (D49) beside it on a card. A row (`quiet`) shows "Lägg till i samtalet" and the next step, nothing more: Inte nu,
 * Avfärda and "Varför nu?" belong to the open card. Beside a panel (`compact`) a row keeps the next step alone.
 */
function ActionRow({
  thread,
  level,
  actions,
  quiet = false,
  compact = false,
  timeAction = true,
}: {
  thread: Thread;
  level: AttentionLevel;
  actions: Actions;
  quiet?: boolean;
  compact?: boolean;
  /** The card's time action is drawn here unless the panel's header holds it (artboard E). */
  timeAction?: boolean;
}) {
  const conversation = useConversation();
  const countdown = useCountdown(thread.receipt?.undoUntil ?? null);
  const chipRef = 'thread:' + thread.id;
  const inConversation = conversation.chipped.includes(chipRef);
  const open = thread.state === 'open';
  const { selected, selectable, settling, pressed, perform, dismiss, run, leave, pickRemind } = actions;
  const snoozeRows = useSnoozeRows({ thread, run, leave });
  const remindRows = useTimeRows({
    presets: usePresets(),
    demo: { label: 'Om 10 sekunder', seconds: 10 },
    onPick: pickRemind,
  });
  const primary = thread.actions.find(a => a.role === 'primary');
  const secondary = thread.actions.filter(a => a.role === 'secondary').slice(0, 2);
  const overflow = thread.actions.filter(
    a => a.role === 'overflow' || (a.role === 'secondary' && !secondary.includes(a)),
  );
  const count = selected.length;
  // "Granska 3" on a row, "Attestera 2 valda" on the card (artboards A and E).
  const primaryLabel =
    primary && selectable ? (quiet ? `${primary.label} ${count}` : `${primary.label} ${count} valda`) : primary?.label;
  const due = level !== 'notice' && streamGroup(thread, today()) === 'nu';
  // Rows take the artboard's 32 px buttons, a card its 36 px ones.
  const size = quiet ? 'md' : 'lg';
  const addToConversation = (
    <Button
      size={size}
      variant="ghost"
      label={inConversation ? 'I samtalet' : 'Lägg till i samtalet'}
      isDisabled={inConversation}
      onClick={() => conversation.addChip({ ref: chipRef, kind: 'thread', label: thread.title, threadId: thread.id })}
    />
  );
  /** ⋯: MoreMenu's button over DropdownMenu's compound rows, because MoreMenu's data rows cannot hold a sub-menu. */
  const more = ({ tucked = [], time }: { tucked?: ThreadAction[]; time?: TimeRows }) => (
    <>
      <DropdownMenu
        renderTrigger={trigger => (
          <IconButton
            {...trigger}
            size={size === 'lg' ? 'md' : size}
            variant="ghost"
            label="Fler val"
            tooltip="Fler val"
            icon={<Icon icon="moreHorizontal" />}
          />
        )}
        alignment="end"
        menuWidth={300}
        menuMaxHeight={480}
      >
        {[...tucked, ...overflow].map(a => (
          <DropdownMenuItem key={a.id} label={a.label} onClick={() => void perform(a)} />
        ))}
        {time && <TimeSubMenu label="Inte nu" rows={time.rows} own={time.own} />}
        {([...tucked, ...overflow].length > 0 || time) && <DropdownMenuDivider />}
        <DropdownMenuItem label="Avfärda · inte aktuellt" onClick={() => void dismiss()} />
      </DropdownMenu>
      {snoozeRows.dialog}
      {remindRows.dialog}
    </>
  );
  const receipt = thread.receipt;
  const undoOpen = !!receipt && thread.state === 'handled' && !!receipt.undoCapability && !!countdown;
  const pending = executionStatus(thread.execution);
  // A decision the source has not confirmed is said so, unless it is the person's own and still on its way (D64).
  if (pending && !settling)
    return (
      <HStack gap={2} vAlign="center" wrap="wrap">
        <Button size={size} label="Kontrollera status" clickAction={() => run(() => api.checkExecution(thread.id))} />
        <Text type="supporting">{pending}</Text>
        <DropdownMenu
          renderTrigger={trigger => (
            <IconButton
              {...trigger}
              size={size === 'lg' ? 'md' : size}
              variant="ghost"
              label="Fler val"
              tooltip="Fler val"
              icon={<Icon icon="moreHorizontal" />}
            />
          )}
          alignment="end"
        >
          <DropdownMenuItem
            label={inConversation ? 'I samtalet' : 'Lägg till i samtalet'}
            isDisabled={inConversation}
            onClick={() =>
              conversation.addChip({ ref: chipRef, kind: 'thread', label: thread.title, threadId: thread.id })
            }
          />
        </DropdownMenu>
      </HStack>
    );
  // In the Inte nu pile (D28): the way back is the first button; nothing else is due until the card is back.
  if (open && isSnoozed(thread, new Date().toISOString()))
    return (
      <HStack gap={2} vAlign="center" wrap="wrap">
        <Button
          size={size}
          variant="secondary"
          label="Ta upp nu"
          clickAction={() => run(() => api.reopen(thread.id), { optimistic: reopened(thread) })}
        />
        {quiet ? !compact && addToConversation : more({})}
      </HStack>
    );
  if (open && !thread.waitingOn && quiet)
    return (
      <HStack gap={2} vAlign="center">
        {!compact && addToConversation}
        {primary && (
          <Button
            size={size}
            variant={due ? 'primary' : 'secondary'}
            label={primaryLabel ?? ''}
            isDisabled={selectable && count === 0}
            isLoading={settling && pressed === primary.id}
            clickAction={() => perform(primary)}
          />
        )}
      </HStack>
    );
  if (open && !thread.waitingOn)
    return (
      <HStack gap={2} vAlign="center" wrap="wrap">
        {primary && (
          <Button
            size={size}
            variant={due ? 'primary' : 'secondary'}
            label={primaryLabel ?? ''}
            isDisabled={selectable && count === 0}
            isLoading={settling && pressed === primary.id}
            clickAction={() => perform(primary)}
          />
        )}
        {secondary.map(a => (
          <Button
            key={a.id}
            size={size}
            variant="secondary"
            label={a.label}
            isLoading={settling && pressed === a.id}
            clickAction={() => perform(a)}
          />
        ))}
        {timeAction && (
          <TimePicker label="Inte nu" rows={snoozeRows.rows} own={snoozeRows.own} size={size === 'lg' ? 'md' : size} />
        )}
        {addToConversation}
        {more({})}
      </HStack>
    );
  if (undoOpen)
    return (
      <HStack gap={2} vAlign="center" wrap="wrap">
        <Button
          size={size}
          variant="destructive"
          label={`Ångra allt · ${countdown} kvar`}
          clickAction={() => run(() => api.undoReceipt(thread.id))}
        />
        {secondary
          .filter(a => a.kind === 'read')
          .map(a => (
            <Button key={a.id} size={size} label={a.label} clickAction={() => perform(a)} />
          ))}
        <Text type="supporting">Varje rad visar källsystemets svar. Grönt bara när det lästs tillbaka.</Text>
      </HStack>
    );
  if (open && thread.waitingOn)
    return (
      <HStack gap={2} vAlign="center" wrap="wrap">
        {timeAction && (
          <TimePicker label="Påminn mig" rows={remindRows.rows} own={remindRows.own} size={quiet ? 'md' : 'md'} />
        )}
        {quiet ? !compact && addToConversation : more({})}
      </HStack>
    );
  return null;
}
/** The right-hand state of a card or row: the receipt, the snooze, who it waits on, or the deadline. Never more than one. */
function State({ thread }: { thread: Thread }) {
  const open = thread.state === 'open';
  if (thread.timers?.some(t => t.state === 'blocked'))
    return (
      <Text type="supporting" role="status">
        Påminnelsen stoppades eftersom behörigheten har ändrats. Välj en ny påminnelse om den fortfarande behövs.
      </Text>
    );
  if (thread.timers?.some(t => t.state === 'queued'))
    return (
      <Text type="supporting" role="status">
        Påminnelsen är sparad och väntar på schemaläggning.
      </Text>
    );
  if (thread.receipt) return <ReceiptStatus thread={thread} />;
  if (open && thread.snoozedUntil && isSnoozed(thread, new Date().toISOString()))
    return <Text type="supporting">{snoozedLabel(thread.snoozedUntil)}</Text>;
  if (thread.waitingOn) {
    const reminder = thread.waitingOn.startsWith('påminnelsen ')
      ? undefined
      : thread.timers?.find(t => t.kind === 'reminder' && t.state === 'scheduled');
    return (
      <Text type="supporting">
        Väntar på {thread.waitingOn}
        {reminder ? ` · påminner dig ${snoozeWhen(reminder.dueAt, new Date().toISOString())}` : ''}
      </Text>
    );
  }
  return <Deadline thread={thread} />;
}
/** The badges that need a hand: a draft to confirm, a reminder that has fired. */
function Flags({ thread }: { thread: Thread }) {
  const open = thread.state === 'open';
  const draft = thread.messages.at(-1)?.meta?.draft;
  return (
    <>
      {draft && open && <Badge variant="warning" icon={<Icon icon="warning" size="sm" />} label="Att bekräfta" />}
      {open && thread.remindedAt && attentionLevel(thread, today()) === 'now' && (
        <Badge variant="error" icon={<Icon icon="clock" size="sm" />} label="Påminnelse" />
      )}
    </>
  );
}
/** A card's metadata line, in words and one colour: the area, the position in the group, the source and the time, whether it is in the conversation. On the page, colour means something is due. */
function Meta({
  thread,
  areaTitle,
  position,
  inConversation,
}: {
  thread: Thread;
  areaTitle: string;
  position?: string;
  inConversation?: boolean;
}) {
  return (
    <HStack gap={2} vAlign="center" wrap="wrap">
      <Text type="supporting">
        {areaTitle} · {position ? `${position} · ` : ''}
        {thread.trigger.source.toLowerCase()}
        {inConversation ? ' · i samtalet' : ''}
      </Text>
      <Flags thread={thread} />
    </HStack>
  );
}

type Props = ActionProps & {
  areaTitle: string;
  position?: string;
  headingLevel?: 2 | 3 | 4;
  autoFocusTitle?: boolean;
  /** The card in the panel beside its own row (D50): the row keeps the thread's id, so the card takes another; the panel is its border, and its header holds the card's time action (artboard E). */
  beside?: boolean;
};
/**
 * A thread open on the page (thread action contract, artboard E): the state line (what is due, the area and the source),
 * the title, one lead sentence, the rows with refs, the action row with the one next step, what the next step does, and
 * "Varför nu?" folded away. Connectors contribute actions, never layout. Cards hold state and actions and never contain
 * a text input (D12). On the page a card is the exception (Astryx: a Card is a discrete item); the collapsed threads in a
 * group are rows (`ThreadRow`). Beside the column the panel is the card's surface, so no Card is drawn around it.
 */
export function GenericCard({
  thread,
  areaTitle,
  position,
  headingLevel = 3,
  autoFocusTitle = false,
  beside = false,
  onChange,
  onOpenCardView,
}: Props) {
  // Opened from its row, the title takes the focus the row's button had (2.4.3).
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (autoFocusTitle) title.current?.focus();
  }, []);
  const actions = useThreadActions({ thread, onChange, onOpenCardView });
  const { selected, setSelected, selectable, error } = actions;
  const conversation = useConversation();
  const rowChipped = (ref: string) => conversation.chipped.includes(ref);
  const inConversation = rowChipped('thread:' + thread.id) || thread.items.some(i => rowChipped(i.ref));
  const open = thread.state === 'open';
  const level = attentionLevel(thread, today());
  const draft = thread.messages.at(-1)?.meta?.draft;
  const receipt = thread.receipt;
  const primary = thread.actions.find(a => a.role === 'primary');
  const elevation =
    open && !thread.waitingOn && (streamGroup(thread, today()) === 'nu' || inConversation) ? 'low' : 'none';
  const variant = open && (thread.waitingOn || isSnoozed(thread, new Date().toISOString())) ? 'muted' : 'default';
  // What folds open glides the content under it instead of jumping (Astryx's useAnimatedLayout), within the card.
  const root = useRef<HTMLDivElement>(null);
  const animatedLayout = useAnimatedLayout({ containerRef: root });
  const body = (
    <VStack
      ref={root}
      gap={beside ? 3 : 2}
      as="article"
      tabIndex={-1}
      aria-label={`Kort: ${thread.title}`}
      id={`${beside ? 'card' : 'thread'}-${thread.id}`}
      aria-current={inConversation ? 'true' : undefined}
    >
      <VStack gap={1.5}>
        <HStack gap={2} vAlign="center" wrap="wrap">
          <State thread={thread} />
          <Meta thread={thread} areaTitle={areaTitle} position={position} inConversation={inConversation} />
        </HStack>
        <Heading ref={title} tabIndex={-1} level={beside ? 2 : 3} accessibilityLevel={headingLevel}>
          {receipt ? receipt.headline : thread.title}
        </Heading>
        {!receipt && thread.summary && (
          <Text as="p" color="secondary">
            {thread.summary}
          </Text>
        )}
      </VStack>
      {thread.items.length > 0 && !receipt && (
        <Card padding={beside ? 3 : 2}>
          {selectable ? (
            <CheckboxList
              label="Rader"
              isLabelHidden
              value={selected}
              onChange={setSelected}
              isReadOnly={!open || !!executionStatus(thread.execution)}
              density="balanced"
            >
              {thread.items.map(i => (
                <CheckboxListItem
                  key={i.ref}
                  value={i.ref}
                  align="start"
                  label={<Text weight="semibold">{i.label}</Text>}
                  description={<Text type="supporting">{i.detail}</Text>}
                />
              ))}
            </CheckboxList>
          ) : (
            <List density="balanced" hasDividers edge="flush">
              {thread.items.map(i => (
                <ListItem
                  key={i.ref}
                  isSelected={rowChipped(i.ref)}
                  label={<Text weight="semibold">{i.label}</Text>}
                  description={<Text type="supporting">{i.detail}</Text>}
                />
              ))}
            </List>
          )}
        </Card>
      )}
      {receipt && (
        <List density="compact" hasDividers aria-label="Kvitto, rad för rad">
          {receipt.rows.map(r => (
            <ListItem
              key={r.ref}
              label={
                <HStack gap={2} vAlign="center">
                  <StatusDot variant={outcomeDot[r.outcome].variant} label={outcomeDot[r.outcome].label} />
                  <Text>{r.label}</Text>
                </HStack>
              }
              description={<Text type="supporting">{r.detail}</Text>}
            />
          ))}
        </List>
      )}
      {draft && open && (
        <Text type="supporting" as="p">
          Utkast från samtalet. Inget är skickat förrän du trycker på knappen här.
        </Text>
      )}
      {error && (
        <Text as="p" role="alert" color="accent">
          {error}
        </Text>
      )}
      <ActionRow thread={thread} level={level} actions={actions} timeAction={!beside} />
      {/* What the next step does (artboard E): written to the source and read back, undone within the window, without the model. */}
      {open && !receipt && primary?.kind === 'execute' && (!executionStatus(thread.execution) || actions.settling) && (
        <Text type="supporting" as="p">
          {primary.label} skrivs till {thread.trigger.source.toLowerCase()} och läses tillbaka som kvitto. Ångra i 10
          minuter. Fungerar utan modellen.
        </Text>
      )}
      {/* Why the card is here, folded away as the artboard draws it; the words can be read and announced, never a tooltip (D28). */}
      {!receipt && (
        <Card padding={3}>
          <Collapsible
            defaultIsOpen={false}
            chevronPosition="start"
            animatedLayout={animatedLayout}
            trigger={<Text weight="semibold">Varför nu?</Text>}
          >
            <Text as="p" color="secondary">
              {thread.trigger.reason.replace(/\.$/, '')}. Kortet kom från {thread.trigger.source}{' '}
              {clock(thread.trigger.at)}.
            </Text>
          </Collapsible>
        </Card>
      )}
      {thread.messages.length > 2 && (
        <Card padding={3}>
          <Collapsible
            defaultIsOpen={false}
            chevronPosition="start"
            animatedLayout={animatedLayout}
            trigger={<Text weight="semibold">Historik · {thread.messages.length} händelser</Text>}
          >
            <List density="compact">
              {thread.messages.map(m => (
                <ListItem
                  key={m.id}
                  label={<Text>{m.body}</Text>}
                  description={m.role === 'user' ? 'Du' : thread.trigger.source}
                />
              ))}
            </List>
          </Collapsible>
        </Card>
      )}
    </VStack>
  );
  return beside ? (
    body
  ) : (
    <Card padding={3} elevation={elevation} variant={variant}>
      {body}
    </Card>
  );
}

type RowProps = ActionProps & {
  areaTitle: string;
  notice?: boolean;
  /** Where the title leads: the card beside the column (D50, artboard E). */
  href: string;
  /** The row whose card is in the panel (D50): marked as the current one, its line says so, and its one control closes the card. */
  isOpen?: boolean;
  onClose?: () => void;
  /** Beside an open panel the column is narrower: the row keeps its next step alone (artboard E). */
  compact?: boolean;
};
/**
 * A thread as a row in its group's list (artboard A; Astryx: records are rows, a Card is the exception): the day cell at
 * the start ("i dag" as the one red badge, the day word for a later deadline, "✦ klart" or "✦ utkast" on a proposal, the
 * info mark on a notice), the title as the link to its card, one line under it with the area and why it is here, and at
 * the end "Lägg till i samtalet" and the one next step. The row keeps the card's id so focus and the toasts find it.
 */
const rowNarrowQuery = '(max-width: 1200px)';
/** The day cell is one word (artboard A: "fre"): tomorrow is its weekday, since "i morgon" is two. */
const dayCell = (date: string, now: string) => {
  const word = dayWord(date, now);
  return word === 'i morgon'
    ? new Intl.DateTimeFormat('sv-SE', { weekday: 'short' }).format(new Date(date + 'T12:00:00Z')).replace(/\.$/, '')
    : word;
};

export function ThreadRow({
  thread,
  areaTitle,
  notice = false,
  href,
  isOpen = false,
  onClose,
  compact = false,
  onChange,
  onOpenCardView,
}: RowProps) {
  const actions = useThreadActions({ thread, onChange, onOpenCardView });
  const { error } = actions;
  const conversation = useConversation();
  const level = notice ? 'notice' : attentionLevel(thread, today());
  const inConversation = conversation.chipped.includes('thread:' + thread.id);
  const todayDate = today();
  // A button's label does not wrap, so where the column beside the day is narrow the step goes under the line and the title keeps its words.
  // A decision on its way says so in a sentence, which takes the room the title needs: then too the step goes under the line.
  const narrow = useMediaQuery(rowNarrowQuery) || (!!executionStatus(thread.execution) && !actions.settling);
  const open = thread.state === 'open';
  const draft = thread.messages.at(-1)?.meta?.draft;
  const due = open && !thread.waitingOn && !notice && streamGroup(thread, todayDate) === 'nu';
  const day = notice ? (
    <Icon icon="info" color="info" />
  ) : due ? (
    <Badge
      variant="error"
      label={thread.deadline && daysUntil(thread.deadline.slice(0, 10), todayDate) < 0 ? 'försenad' : 'i dag'}
    />
  ) : cardKind(thread) === 'forslag' ? (
    <Badge variant="info" label={draft ? '✦ utkast' : '✦ klart'} />
  ) : thread.deadline ? (
    <Text weight="semibold" hasTabularNumbers textWrap="nowrap">
      {dayCell(thread.deadline.slice(0, 10), todayDate)}
    </Text>
  ) : null;
  const reminder = thread.timers?.find(t => t.kind === 'reminder' && t.state === 'scheduled');
  const line = [
    areaTitle,
    thread.trigger.reason.replace(/\.$/, ''),
    thread.waitingOn ? `väntar på ${thread.waitingOn}` : '',
    thread.waitingOn && reminder ? `påminner dig ${snoozeWhen(reminder.dueAt, new Date().toISOString())}` : '',
    inConversation ? 'i samtalet' : '',
    isOpen ? 'öppet bredvid' : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const end =
    isOpen && onClose ? (
      <IconButton size="md" variant="ghost" label="Stäng kortet" icon={<Icon icon="close" />} onClick={onClose} />
    ) : (
      <ActionRow thread={thread} level={level} actions={actions} quiet compact={compact} />
    );
  return (
    <ListItem
      id={`thread-${thread.id}`}
      tabIndex={-1}
      align="center"
      isSelected={isOpen}
      startContent={<VStack width={56}>{day}</VStack>}
      label={
        <Text weight="semibold">
          <Link href={href} color="primary">
            {thread.title}
          </Link>
        </Text>
      }
      description={
        <VStack gap={1}>
          <HStack gap={2} vAlign="center" wrap="wrap">
            <Text color="secondary">{line}</Text>
            <Flags thread={thread} />
          </HStack>
          {narrow && end}
          {error && (
            <Text as="p" role="alert" color="accent">
              {error}
            </Text>
          )}
        </VStack>
      }
      endContent={narrow ? undefined : end}
    />
  );
}
