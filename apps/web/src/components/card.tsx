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
  type ThreadItem,
} from '@clew/contracts';
import {
  AreaChip,
  AreaLine,
  Badge,
  Button,
  Card,
  CheckboxList,
  CheckboxListItem,
  Collapsible,
  CompletionMark,
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
import { useLocation } from 'react-router';
import { displayDate, today } from '@clew/calendar/dates';
import { api, ApiError } from '../api';
import { snoozePresetsQuery } from '../queries';
import { useSettling, useThreadAction, type RunAction } from '../mutations';
import { dismissed, reopened, snoozed } from '../optimistic';
import { invalidateStream } from '../thread-cache';
import { useConversation } from './conversation-context';
import { executionStatus } from '../execution-status';
import { useMarks, type Mark, type Marks } from '../marks';
import { AddToConversation } from './add-to-conversation';
import { returnedSelection, reviewHref } from '../review-address';
import { canUndoReceipt, receiptComplete } from '../receipt-state';
import { entityHref } from '../person-address';

const outcomeDot = {
  done: { variant: 'success', label: 'Klart' },
  unknown: { variant: 'warning', label: 'Okänt' },
  failed: { variant: 'error', label: 'Misslyckades' },
  skipped: { variant: 'neutral', label: 'Inte skickad' },
} as const;
const shortDate = (d: string) =>
  new Intl.DateTimeFormat('sv-SE', { day: 'numeric', month: 'short' })
    .format(new Date(d.slice(0, 10) + 'T12:00:00'))
    .replace(/\.$/, '');
const clock = (iso: string) => new Date(iso).toLocaleTimeString('sv-SE', { timeStyle: 'short' });
/** The check a receipt earns (D70): drawn when the receipt arrives, on Astryx's own entry motion (which honours reduced motion), never before the source has read back. */
export const ReceiptCheck = CompletionMark;
/** What a decision's row says (D70): the receipt's headline and when the source answered. */
export const receiptLine = (thread: Thread) =>
  thread.receipt
    ? `${thread.receipt.headline.replace(/\.$/, '')} · ${thread.trigger.source} svarade ${clock(thread.receipt.at)}`
    : '';
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

/** Inte nu (D28): when the card comes back, as words on a card in the pile. */
const snoozedLabel = (until: string, now = today()) => {
  const date = new Date(until).toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' });
  return `Tillbaka ${dayWord(date, now) === 'i dag' ? '' : dayWord(date, now) + ' '}${clock(until)}`;
};
/** The receipt's one status (D70, D71): green only when every row was read back, as a dot with its word; a row the source did not confirm, or that failed, is a badge, because it needs a hand. */
function ReceiptFlag({ thread, quiet = false }: { thread: Thread; quiet?: boolean }) {
  const receipt = thread.receipt;
  if (!receipt) return null;
  const unknown = receipt.rows.filter(r => r.outcome === 'unknown').length,
    failed = receipt.rows.filter(r => r.outcome === 'failed').length;
  if (failed)
    return <Badge variant="error" icon={<Icon icon="error" size="sm" />} label={`${failed} rad misslyckades`} />;
  if (unknown)
    return <Badge variant="warning" icon={<Icon icon="warning" size="sm" />} label={`${unknown} rad obekräftad`} />;
  return quiet ? null : <StatusDot variant="success" label="Läst tillbaka" />;
}
/**
 * The systems a card's rows come from (D55, artboard 10): a row's system when its ref names one the person can see. A
 * card is a job across systems when a row is another system's than the card's; then every row carries its system.
 */
function rowSystems(thread: Thread, marks: Marks) {
  const of = new Map<string, ReturnType<Marks['ofRef']>>();
  for (const r of [...thread.items, ...(thread.receipt?.rows ?? [])]) of.set(r.ref, marks.ofRef(r.ref));
  const systems = new Set(thread.items.map(i => of.get(i.ref)?.connector).filter(Boolean));
  return { of, multi: [...of.values()].some(m => m && m.connector !== thread.connector), count: systems.size };
}
type RowSystems = ReturnType<typeof rowSystems>;
/** "3 steg i 3 system": a job's rows in the list and on its card's mark row, never three glyphs (artboard 10). */
const stepsLine = (thread: Thread, systems: RowSystems) =>
  systems.multi ? `${thread.items.length} steg i ${systems.count} system` : '';
/**
 * A row of a job across systems (artboard 10): its system's glyph, the system's word, the area's word, then what it
 * says. A receipt row says which system answered and when instead of the area ("Tidrapporteringen svarade 07:02").
 */
function SystemLine({ mark, words, answered }: { mark: ReturnType<Marks['ofRef']>; words: string; answered?: string }) {
  if (!mark) return <Text type="supporting">{words}</Text>;
  // Clew's own system is named alone ("Kalendern"): its area is the house's, not a guest's place.
  const lead = answered
    ? `${mark.source} svarade ${answered}`
    : [mark.source, mark.area && mark.ordinal !== null ? mark.title : ''].filter(Boolean).join(' · ');
  return <AreaLine icon={mark.area ? mark.icon : undefined}>{[lead, words].filter(Boolean).join(' · ')}</AreaLine>;
}
/** When a card's mark row says it is: the deadline with the days left, the time it was sent, or when the source pushed it. */
function markWhen(thread: Thread, now: string) {
  if (thread.receipt) return `skickat ${clock(thread.receipt.at)}`;
  if (thread.deadline && streamGroup({ deadline: thread.deadline }, now) !== 'nu') {
    const days = daysUntil(thread.deadline.slice(0, 10), now);
    return days <= 30
      ? `${shortDate(thread.deadline)} · ${days} ${days === 1 ? 'dag' : 'dagar'}`
      : shortDate(thread.deadline);
  }
  return `${dayWord(displayDate(thread.trigger.at), now)} ${clock(thread.trigger.at)}`;
}
/**
 * The card's mark row (D71, artboards 5 and 10): the area's chip, then the source and when in supporting, then the one
 * status that needs a hand. On a phone (`stacked`) the chip stands on its own line and the source under it (artboard 12).
 */
function MarkRow({
  thread,
  mark,
  systems,
  position,
  inConversation,
  stacked = false,
}: {
  thread: Thread;
  mark: Mark;
  systems: RowSystems;
  position?: string;
  inConversation?: boolean;
  stacked?: boolean;
}) {
  const now = today();
  const line = [
    systems.multi && thread.receipt ? '' : mark.source,
    markWhen(thread, now),
    thread.receipt ? (systems.multi ? `${systems.count} system` : '') : stepsLine(thread, systems),
    position ?? '',
    inConversation ? 'i samtalet' : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const chip = <AreaChip ordinal={mark.ordinal} icon={mark.icon} label={mark.title} />;
  const rest = (
    <>
      <Text type="supporting" hasTabularNumbers>
        {line}
      </Text>
      <CardStatus thread={thread} />
      <Flags thread={thread} />
    </>
  );
  return stacked ? (
    <VStack gap={1.5}>
      <HStack>{chip}</HStack>
      <HStack gap={2} vAlign="center" wrap="wrap">
        {rest}
      </HStack>
    </VStack>
  ) : (
    <HStack gap={2} vAlign="center" wrap="wrap">
      {chip}
      {rest}
    </HStack>
  );
}
/** The card's state on its mark row: the receipt's status, the one red badge for what is due, the snooze or who it waits on. Never more than one. */
function CardStatus({ thread }: { thread: Thread }) {
  const open = thread.state === 'open';
  if (thread.receipt) return <ReceiptFlag thread={thread} />;
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
  const now = today();
  if (thread.deadline && streamGroup({ deadline: thread.deadline }, now) === 'nu')
    return <Badge variant="error" label={daysUntil(thread.deadline.slice(0, 10), now) < 0 ? 'försenad' : 'i dag'} />;
  return null;
}
/** A reminder the person set that could not be scheduled, said in a sentence under the mark row. */
function TimerNote({ thread }: { thread: Thread }) {
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
  return null;
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
/**
 * Running one of a card's actions, shared by the card, the row and the review's drawer (D73), so a decision sent from the
 * review goes through the same confirm, the same decision endpoint (D45/D47), the same wait for the source and the same
 * error as from the card. Busy never disables the buttons: a disabled button drops the focus it holds (2.4.3).
 * Action-buttons wait on their own promise. The thread an action returns goes into the cache for every screen (D33);
 * `onChange` lets the page move focus first. `perform` says whether it ran: a confirm the person declined runs nothing.
 */
export function useCardAction({
  thread,
  onChange,
  onOpenCardView,
}: Pick<ActionProps, 'thread'> & Partial<Omit<ActionProps, 'thread'>>) {
  const { run, apply, busy, error } = useThreadAction({ onChange });
  // The person's own action is on its way (D64): the card keeps the look it had, with the pressed button loading, and the
  // status is read out once the card has come to rest or the window has ended, not for every committed step in between.
  const held = useSettling(thread);
  const settling = busy || held;
  const [pressed, setPressed] = useState<string | null>(null);
  useEffect(() => {
    if (!settling) setPressed(null);
  }, [settling]);
  const selectable = thread.items.some(i => i.selectable);
  const perform = async (
    action: ThreadAction,
    refs?: string[],
    reviews?: import('@clew/contracts').ReviewEvidence[],
  ): Promise<boolean> => {
    if (busy) return false;
    if (action.confirm && !window.confirm(action.confirm)) return false;
    const chosen = selectable ? refs : undefined;
    if (action.kind === 'read') {
      if (action.target === 'link') {
        await run(async () => {
          const result = await api.act(thread.id, action.id, chosen);
          if (result.kind === 'read' && typeof (result.output as { url?: string }).url === 'string')
            window.open((result.output as { url: string }).url, '_blank', 'noopener');
        });
        return true;
      }
      // A panel view has an address (`open-card` and `open-action`), so it survives reload and the back button closes it.
      onOpenCardView?.(thread.id, action.id);
      return true;
    }
    // The outcome is the source's (D45): nothing is predicted, the button stays loading until the answer has come to rest.
    setPressed(action.id);
    await run(
      async () => {
        const result = await api.act(thread.id, action.id, chosen, reviews);
        if (result.kind !== 'execute') throw new ApiError(500, 'Oväntat svar.');
        return result.thread;
      },
      { settle: true },
    );
    return true;
  };
  return { run, apply, busy, settling, pressed, error, selectable, perform };
}
/** The execute a card reviews one row at a time before it sends (D70): its next step is then "Granska N", which leads to the review's address (D73). */
export const reviewedAction = (thread: Thread) =>
  thread.actions.find(a => a.role === 'primary' && a.kind === 'execute' && a.review === 'each');

/** Everything a card can do, shared by the card and the row: run an action, snooze, dismiss, explain, and keep the selection. */
function useThreadActions({ thread, onChange, onOpenCardView }: ActionProps) {
  const {
    run,
    apply,
    busy,
    settling,
    pressed,
    error,
    selectable,
    perform: performRefs,
  } = useCardAction({
    thread,
    onChange,
    onOpenCardView,
  });
  const status = executionStatus(thread.execution);
  const lastStatus = useRef(status),
    announce = useAnnounce({ hasReplace: true });
  useEffect(() => {
    if (settling || status === lastStatus.current) return;
    lastStatus.current = status;
    announce(status ?? thread.receipt?.headline ?? 'Åtgärden är kontrollerad.');
  }, [status, settling, announce, thread.receipt?.headline]);
  // Back from the review's drawer with ✕, Esc or the scrim (D73), the card starts from the rows the review approved;
  // otherwise from what the connector marked. A change to the thread starts it over from the connector's marks. The card
  // usually stood under the drawer all along (D73 amended), so the selection is taken again for each entry that hands
  // one back, not only when the card is drawn.
  const { state, key } = useLocation();
  const returned = returnedSelection(state, thread.id);
  const returnedAt = returned ? key : null;
  const [selected, setSelected] = useState<string[]>(
    () => returned ?? thread.items.filter(i => i.selected).map(i => i.ref),
  );
  const seededReturn = useRef(returnedAt);
  useEffect(() => {
    if (!returned || seededReturn.current === returnedAt) return;
    seededReturn.current = returnedAt;
    setSelected(returned);
  }, [returnedAt]);
  const seededAt = useRef(thread.updatedAt);
  useEffect(() => {
    if (seededAt.current === thread.updatedAt) return;
    seededAt.current = thread.updatedAt;
    setSelected(thread.items.filter(i => i.selected).map(i => i.ref));
  }, [thread.updatedAt]);
  const client = useQueryClient();
  const leave = useLeaveWithUndo(apply);
  const perform = async (action: ThreadAction, refs?: string[]) => {
    await performRefs(action, refs ?? selected);
  };
  // A card whose next step is a review (D70): "Granska N" leads to the review's drawer, which sends once with the approved refs (D73).
  const reviewed = reviewedAction(thread);
  // The card leaves at once (D64); the toast with Ångra confirms when the server has it.
  const dismiss = () =>
    run(
      async () => {
        const t = await api.dismiss(thread.id);
        leave(
          t,
          `Avfärdad som inte aktuellt. ${thread.trigger.source} skapar inte kortet igen. Kortet ligger under Redan hanterat.`,
        );
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
    reviewed,
    /** The history entry the review handed its decisions back on, or null: the card's "Granska N" takes the focus once per entry. */
    returned: returnedAt,
  };
}
type Actions = ReturnType<typeof useThreadActions>;

/**
 * The action row shared by every card and row (artboards A and E): the one next step from the connector, filled only
 * when the thread is due today (D48), with the secondary actions, "Lägg till i samtalet" and the card's one time action
 * (D49) beside it on a card, also when the card is open beside the page (the product owner, 2026-11-06: the panel's
 * header is the panel's, so the picker left it for the card's own buttons, against artboard E). A row (`quiet`) shows
 * "Lägg till i samtalet" and the next step, nothing more: Inte nu, Avfärda and "Varför nu?" belong to the open card.
 * Beside a panel (`compact`) a row keeps the next step alone. On a phone (artboards 11 and 12) a row's next step fills
 * the line under it with "Lägg till i samtalet" as the `@` beside it (`phone`), and the card in the sheet stands its
 * next step and secondary actions full width above the rest (`stacked`).
 */
function ActionRow({
  thread,
  level,
  actions,
  quiet = false,
  compact = false,
  phone = false,
  stacked = false,
}: {
  thread: Thread;
  level: AttentionLevel;
  actions: Actions;
  quiet?: boolean;
  compact?: boolean;
  phone?: boolean;
  stacked?: boolean;
}) {
  const conversation = useConversation();
  const countdown = useCountdown(thread.receipt?.undoUntil ?? null);
  const chipRef = 'thread:' + thread.id;
  const inConversation = conversation.chipped.includes(chipRef);
  const open = thread.state === 'open';
  const { selected, selectable, settling, pressed, perform, dismiss, run, leave, pickRemind } = actions;
  const { reviewed, returned } = actions;
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
  // A row's step fills the phone's line, and the sheet's steps stand full width (artboards 11 and 12).
  const width = phone || stacked ? '100%' : undefined;
  // Back from the review's drawer with ✕, Esc or the scrim (D73), the focus is on "Granska N" again. On the card, not the
  // row: the card is what the address opens beside Hem or in the sheet. The drawer leads back only once it has slid
  // away, so the page is no longer inert; the panel puts the focus on its heading when it opens with Hem (usePanel's
  // effect runs after the card's), so this waits a frame.
  const review = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!returned || quiet) return;
    const frame = requestAnimationFrame(() => review.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [returned]);
  // The one next step: the execute itself, or "Granska N" when the rows are reviewed one at a time first (D70), a link
  // to the review's address, which opens it as a drawer over Hem (D73 amended).
  const primaryButton = primary ? (
    reviewed ? (
      <Button
        ref={review}
        size={size}
        variant={due ? 'primary' : 'secondary'}
        label={`Granska ${thread.items.filter(i => i.selectable).length}`}
        width={width}
        href={reviewHref(thread.id)}
      />
    ) : (
      <Button
        size={size}
        variant={due ? 'primary' : 'secondary'}
        label={primaryLabel ?? ''}
        isDisabled={selectable && count === 0}
        isLoading={settling && pressed === primary.id}
        width={width}
        clickAction={() => perform(primary)}
      />
    )
  ) : null;
  const addChip = () =>
    conversation.addChip({ ref: chipRef, kind: 'thread', label: thread.title, threadId: thread.id });
  const addToConversation = phone ? (
    <AddToConversation size="md" added={inConversation} onAdd={addChip} />
  ) : (
    <Button
      size={size}
      variant="ghost"
      label={inConversation ? 'I samtalet' : 'Lägg till i samtalet'}
      isDisabled={inConversation}
      onClick={addChip}
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
  // The way back is open while the receipt's window is (D70): on a done card, and on one the decision left waiting on others.
  const undoOpen = !!countdown && canUndoReceipt(thread);
  const pending = executionStatus(thread.execution);
  const viewReview =
    reviewed && (receipt || pending || !open) && !quiet ? (
      <Button ref={review} size={size} variant="secondary" label="Visa granskning" href={reviewHref(thread.id)} />
    ) : null;
  // A decision the source has not confirmed is said so, unless it is the person's own and still on its way (D64).
  if (pending && (!settling || pressed === null))
    return (
      <HStack gap={2} vAlign="center" wrap="wrap">
        {(!thread.execution ||
          ['pending', 'running', 'unknown'].includes(thread.execution.state) ||
          thread.execution.reason) && (
          <Button size={size} label="Kontrollera status" clickAction={() => run(() => api.checkExecution(thread.id))} />
        )}
        {undoOpen && (
          <Button
            size={size}
            variant="destructive"
            label={`Ångra bekräftade · ${countdown} kvar`}
            clickAction={() => run(() => api.undoReceipt(thread.id))}
          />
        )}
        {viewReview}
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
  if (open && !thread.waitingOn && quiet && phone)
    return (
      <HStack gap={2} vAlign="center">
        {primaryButton}
        {addToConversation}
      </HStack>
    );
  if (open && !thread.waitingOn && quiet)
    return (
      <HStack gap={2} vAlign="center">
        {!compact && addToConversation}
        {primaryButton}
      </HStack>
    );
  if (open && !thread.waitingOn) {
    const secondaryButtons = secondary.map(a => (
      <Button
        key={a.id}
        size={size}
        variant="secondary"
        label={a.label}
        isLoading={settling && pressed === a.id}
        width={width}
        clickAction={() => perform(a)}
      />
    ));
    const rest = (
      <>
        <TimePicker label="Inte nu" rows={snoozeRows.rows} own={snoozeRows.own} size={size === 'lg' ? 'md' : size} />
        {addToConversation}
        {more({})}
      </>
    );
    return stacked ? (
      <VStack gap={2}>
        {primaryButton}
        {secondaryButtons}
        <HStack gap={1} vAlign="center" wrap="wrap">
          {rest}
        </HStack>
      </VStack>
    ) : (
      <HStack gap={2} vAlign="center" wrap="wrap">
        {primaryButton}
        {secondaryButtons}
        {rest}
      </HStack>
    );
  }
  // A card that waits on others after the person's own decision (D70 amended): the way back comes first while the window
  // is open, with the time left, then the card's own timer. The receipt line beside it says what was done.
  if (open && thread.waitingOn)
    return (
      <HStack gap={2} vAlign="center" wrap="wrap">
        {undoOpen && (
          <Button
            size={size}
            variant="destructive"
            label={`Ångra · ${countdown} kvar`}
            clickAction={() => run(() => api.undoReceipt(thread.id))}
          />
        )}
        {viewReview}
        <TimePicker label="Påminn mig" rows={remindRows.rows} own={remindRows.own} size="md" />
        {quiet ? !compact && addToConversation : more({})}
      </HStack>
    );
  // The row a receipt has just arrived on (D70): its one control is the way back, while the window is open.
  if (undoOpen && quiet)
    return (
      <Button
        size={size}
        variant="destructive"
        label={`Ångra · ${countdown} kvar`}
        clickAction={() => run(() => api.undoReceipt(thread.id))}
      />
    );
  if (undoOpen)
    return (
      <HStack gap={2} vAlign="center" wrap="wrap">
        {viewReview}
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
  return viewReview;
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
/**
 * A row's name (D97 item 6): the source's own words, and a link to the person or unit the row names when it names one,
 * with the page it was opened on as the way back. Never a name the row did not have.
 */
function ItemLabel({ item, from }: { item: ThreadItem; from: string }) {
  return item.subject ? (
    <Link href={entityHref(item.subject, from)} weight="semibold" hasUnderline>
      {item.label}
    </Link>
  ) : (
    <Text weight="semibold">{item.label}</Text>
  );
}
type Props = ActionProps & {
  position?: string;
  headingLevel?: 2 | 3 | 4;
  autoFocusTitle?: boolean;
  /** The card in the panel beside its own row (D50): the row keeps the thread's id, so the card takes another; the panel is its border, and its header holds the card's time action (artboard E). */
  beside?: boolean;
  /** After a receipt (D70): the first card that needs the person, as the way on from the done card. */
  next?: { title: string; href: string };
  /** In the phone's bottom sheet (artboard 12): the chip on its own line, the next step and the secondary actions full width. */
  sheet?: boolean;
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
  position,
  headingLevel = 3,
  autoFocusTitle = false,
  beside = false,
  next,
  sheet = false,
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
  const marks = useMarks();
  const mark = marks.ofThread(thread);
  const systems = rowSystems(thread, marks);
  const rowChipped = (ref: string) => conversation.chipped.includes(ref);
  const { pathname, search } = useLocation();
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
        {/* The mark row (D71) in place of the area and source words: the chip, the source and when, the one status. */}
        <MarkRow
          thread={thread}
          mark={mark}
          systems={systems}
          position={position}
          inConversation={inConversation}
          stacked={sheet}
        />
        <TimerNote thread={thread} />
        {/* The check is drawn once, here, when the receipt has come (D70): the card's heading is then what was done. */}
        <HStack gap={3} vAlign="center">
          {receiptComplete(receipt) && <ReceiptCheck size="lg" />}
          <Heading ref={title} tabIndex={-1} level={2} accessibilityLevel={headingLevel}>
            {receipt ? receipt.headline : thread.title}
          </Heading>
        </HStack>
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
                  label={<ItemLabel item={i} from={pathname + search} />}
                  description={
                    systems.multi ? (
                      <SystemLine mark={systems.of.get(i.ref)} words={i.detail} />
                    ) : (
                      <Text type="supporting">{i.detail}</Text>
                    )
                  }
                />
              ))}
            </CheckboxList>
          ) : (
            <List density="balanced" hasDividers edge="flush">
              {thread.items.map(i => (
                <ListItem
                  key={i.ref}
                  isSelected={rowChipped(i.ref)}
                  label={<ItemLabel item={i} from={pathname + search} />}
                  description={
                    systems.multi ? (
                      <SystemLine mark={systems.of.get(i.ref)} words={i.detail} />
                    ) : (
                      <Text type="supporting">{i.detail}</Text>
                    )
                  }
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
                  <Text weight="semibold">{r.label}</Text>
                </HStack>
              }
              description={
                // A job's receipt reads back per system (artboard 10): which system answered and when.
                systems.multi ? (
                  <SystemLine
                    mark={systems.of.get(r.ref)}
                    words={r.detail}
                    answered={r.outcome === 'done' ? clock(receipt.at) : undefined}
                  />
                ) : (
                  <Text type="supporting">{r.detail}</Text>
                )
              }
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
      <ActionRow thread={thread} level={level} actions={actions} stacked={sheet} />
      {/* The way on from a done card (D70, artboard D): the first card that needs the person, never opened on its own. */}
      {receipt && next && (
        <Card padding={3} variant="muted">
          <VStack gap={1.5}>
            <Text type="supporting" weight="semibold">
              Nästa som behöver dig
            </Text>
            <HStack gap={2} vAlign="center" justify="between" wrap="wrap">
              <Text weight="semibold">{next.title}</Text>
              <Button size="sm" variant="secondary" label="Öppna" href={next.href} />
            </HStack>
          </VStack>
        </Card>
      )}
      {/* What the next step does (artboard E): written to the source and read back, without the model. The source's name
          stands as the source wrote it ("Nextcloud" is a name, not a noun), and nothing is said about undo here: whether
          a write can be undone, and for how long, is only known from the receipt, which offers Ångra when the source does. */}
      {open &&
        !receipt &&
        primary?.kind === 'execute' &&
        (!executionStatus(thread.execution) || (actions.settling && actions.pressed !== null)) && (
          <Text type="supporting" as="p">
            {primary.label} skrivs till {thread.trigger.source} och läses tillbaka som kvitto. Fungerar utan modellen.
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
  notice?: boolean;
  /** Where the title leads: the card beside the column (D50, artboard E). */
  href: string;
  /** The row whose card is in the panel (D50): marked as the current one, its line says so, and its one control closes the card. */
  isOpen?: boolean;
  onClose?: () => void;
  /** Beside an open panel the column is narrower: the row keeps its next step alone (artboard E). */
  compact?: boolean;
  /** On a phone (artboard 11): the next step fills the line under the row, with the `@` beside it. */
  phone?: boolean;
};
/**
 * A thread as a row in its group's list (artboard A; Astryx: records are rows, a Card is the exception): the day cell at
 * the start ("i dag" as the one red badge, the day word for a later deadline, "✦ klart" or "✦ utkast" on a proposal, the
 * info mark on a notice), the title as the link to its card, the meta line under it (D71: the area's glyph first, then
 * the area and why it is here in supporting, a status badge after it only when the row needs a hand), and at the end
 * "Lägg till i samtalet" and the one next step. The row keeps the card's id so focus and the toasts find it.
 */
const rowNarrowQuery = '(max-width: 1200px)';
/** A row's head: the title's line and the meta line's first, from the type scale's own sizes and leadings (D62). */
const rowHead =
  'calc(var(--text-body-size) * var(--text-body-leading) + var(--text-supporting-size) * var(--text-supporting-leading))';
/** The day cell is one word (artboard A: "fre"): tomorrow is its weekday, since "i morgon" is two. */
const dayCell = (date: string, now: string) => {
  const word = dayWord(date, now);
  return word === 'i morgon'
    ? new Intl.DateTimeFormat('sv-SE', { weekday: 'short' }).format(new Date(date + 'T12:00:00Z')).replace(/\.$/, '')
    : word;
};

export function ThreadRow({
  thread,
  notice = false,
  href,
  isOpen = false,
  onClose,
  compact = false,
  phone = false,
  onChange,
  onOpenCardView,
}: RowProps) {
  const actions = useThreadActions({ thread, onChange, onOpenCardView });
  const { error } = actions;
  const conversation = useConversation();
  const marks = useMarks();
  const mark = marks.ofThread(thread);
  const level = notice ? 'notice' : attentionLevel(thread, today());
  const inConversation = conversation.chipped.includes('thread:' + thread.id);
  const todayDate = today();
  // A button's label does not wrap, so where the column beside the day is narrow the step goes under the line and the title keeps its words.
  // A decision on its way says so in a sentence, which takes the room the title needs: then too the step goes under the line.
  const narrowColumn = useMediaQuery(rowNarrowQuery);
  const narrow = phone || narrowColumn || !!executionStatus(thread.execution);
  const open = thread.state === 'open';
  const draft = thread.messages.at(-1)?.meta?.draft;
  const due = open && !thread.waitingOn && !notice && streamGroup(thread, todayDate) === 'nu';
  // A receipt that has just arrived (D70): the row keeps its place for a moment, the check in its day cell and what was done
  // in its line. A row that waits on others after the decision keeps its day and carries the receipt in its line too.
  const done = thread.state === 'handled' && receiptComplete(thread.receipt);
  const day = done ? (
    <ReceiptCheck />
  ) : notice ? (
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
  // A reminder that is not on its way says so on the row too, not only on the open card (`TimerNote`): queued work has
  // a visible status and never reads as scheduled (reliability roadmap, phase 5A). One that was stopped needs a hand,
  // so it is a badge after the words; one that waits to be scheduled is words on the line, and not inside the settle
  // window, where a queued timer is not drawn (D64 item 2).
  const timerStopped = !!thread.timers?.some(t => t.state === 'blocked');
  const timerWaits = !timerStopped && !actions.settling && !!thread.timers?.some(t => t.state === 'queued');
  // A job across systems says how many steps in how many systems, never three glyphs (artboard 10).
  const line = [
    mark.title,
    stepsLine(thread, rowSystems(thread, marks)),
    thread.receipt ? receiptLine(thread) : thread.trigger.reason.replace(/\.$/, ''),
    thread.waitingOn ? `väntar på ${thread.waitingOn}` : '',
    thread.waitingOn && reminder ? `påminner dig ${snoozeWhen(reminder.dueAt, new Date().toISOString())}` : '',
    timerWaits ? 'påminnelsen väntar på schemaläggning' : '',
    inConversation ? 'i samtalet' : '',
    isOpen ? 'öppet bredvid' : '',
  ]
    .filter(Boolean)
    .join(' · ');
  // The open row's one control is the ✕, an icon that fits beside any title: it stays at the end of the row even where
  // the buttons would go under the line, else it would stand alone and centred under the line (seen 2026-11-06).
  const close =
    isOpen && onClose ? (
      <IconButton size="md" variant="ghost" label="Stäng kortet" icon={<Icon icon="close" />} onClick={onClose} />
    ) : null;
  const end = close ?? (
    <ActionRow thread={thread} level={level} actions={actions} quiet compact={compact} phone={phone} />
  );
  const under = narrow && !close;
  return (
    <ListItem
      id={`thread-${thread.id}`}
      tabIndex={-1}
      // The day cell and the buttons belong to the row's head, the title and the first meta line, not to the middle of a
      // row that runs to three or four lines (a receipt's badge, "Kontrollera status" under the line; seen 2026-11-07).
      // So the slots stand at the top, each centred in a box as tall as the head: a two-line row looks as it did when
      // the slots were centred on it, and a taller row keeps them beside its title.
      align="start"
      isSelected={isOpen}
      // The day cell is one width so the titles line up; on a phone it takes what it needs, as artboard 11 draws it.
      startContent={
        phone ? (
          day
        ) : (
          <VStack width={56} minHeight={rowHead} vAlign="center">
            {day}
          </VStack>
        )
      }
      label={
        <Text weight="semibold">
          <Link href={href} color="primary" weight="semibold">
            {thread.title}
          </Link>
        </Text>
      }
      description={
        <VStack gap={phone ? 2 : 1}>
          {/* A status badge follows the words on their line when the two fit there, and folds under them when not. Not
              inline in the words' flow: a Badge with an icon takes its baseline from the icon and stood 4.5 px above
              the words (tried 2026-11-07). */}
          <HStack gap={2} vAlign="center" wrap="wrap">
            <AreaLine icon={mark.icon}>{line}</AreaLine>
            <ReceiptFlag thread={thread} quiet />
            <Flags thread={thread} />
            {timerStopped && (
              <Badge variant="warning" icon={<Icon icon="warning" size="sm" />} label="Påminnelsen stoppad" />
            )}
          </HStack>
          {under && end}
          {error && (
            <Text as="p" role="alert" color="accent">
              {error}
            </Text>
          )}
        </VStack>
      }
      endContent={
        under ? undefined : phone ? (
          end
        ) : (
          <VStack minHeight={rowHead} vAlign="center" hAlign="end">
            {end}
          </VStack>
        )
      }
    />
  );
}
