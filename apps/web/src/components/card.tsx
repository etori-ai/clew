import { useEffect, useRef, useState } from 'react';
import {
  dayWord,
  isSnoozed,
  parseSwedishTime,
  snoozeWhen,
  streamGroup,
  SUBJECT_CHANGED,
  type AskValues,
  type CardAction,
  type SnoozeInput,
  type SnoozePreset,
  type Thread,
  type ThreadAction,
  type ThreadItem,
} from '@clew/contracts';
import {
  AlertDialog,
  AreaLine,
  Button,
  Dialog,
  DialogHeader,
  DropdownMenu,
  DropdownMenuDivider,
  DropdownMenuItem,
  DropdownMenuSubMenu,
  HStack,
  Icon,
  IconButton,
  Link,
  StackItem,
  Text,
  TextInput,
  useAnnounce,
  useToast,
  VStack,
} from '@clew/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'react-router';
import { today } from '@clew/calendar/dates';
import { api, ApiError } from '../api';
import { confirmParts } from '../confirm-parts';
import { snoozePresetsQuery } from '../queries';
import { useDecisionSend, useSettling, useThreadAction, type RunAction } from '../mutations';
import { opensDialog, type ActionStep } from '../action-path';
import { takeActionRequest, useActionRequest } from '../action-requests';
import { ActionDialog } from './action-dialog';
import { dismissed, reopened, snoozed } from '../optimistic';
import { invalidateStream } from '../thread-cache';
import { useConversation } from './conversation-context';
import { executionStatus } from '../execution-status';
import { QUEUED_LINE, useSilentSources } from './silent-sources';
import type { Marks } from '../marks';
import { reviewHref } from '../review-address';
import {
  approvedOf,
  begun,
  leftOf,
  nextStep,
  reviewLeftFor,
  reviewRows,
  selectionAfterReview,
  useReviewDraft,
} from '../review-session';
import { entityHref } from '../person-address';

/**
 * What a work item can do (D112 item 4), shared by every place one is drawn (`work-item.tsx`) and by its review's page
 * (D73): its actions, the confirm they ask, the time pickers, Avfärda and Återöppna, and the row of buttons. The item's
 * shape is `work-item.tsx`'s; this file holds no layout of its own beyond the buttons.
 */
export const clock = (iso: string) => new Date(iso).toLocaleTimeString('sv-SE', { timeStyle: 'short' });
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
/** The time left to undo, in whole minutes as the receipt says it (board ActReceipt: "9 min kvar"); null once it has run out. */
export function useMinutesLeft(until: string | null) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!until) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [until]);
  if (!until) return null;
  const left = Date.parse(until) - now;
  return left > 0 ? Math.ceil(left / 60000) : null;
}
/**
 * Avfärda and Inte nu: the item leaves the queue and a toast with Ångra takes its place; reopen brings it back. The toast
 * stays until the person closes it: Ångra is the only way back to the item, so it carries no time limit (2.2.1).
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

/** Inte nu (D28): when the item comes back, in words. */
export const snoozedLabel = (until: string, now = today()) => {
  const date = new Date(until).toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' });
  return `Tillbaka ${dayWord(date, now) === 'i dag' ? '' : dayWord(date, now) + ' '}${clock(until)}`;
};
/**
 * The systems an item's rows come from (D55, artboard 10): a row's system when its ref names one the person can see. An
 * item is a job across systems when a row is another system's than the item's; then every row carries its system.
 */
export function rowSystems(thread: Thread, marks: Marks) {
  const of = new Map<string, ReturnType<Marks['ofRef']>>();
  for (const r of [...thread.items, ...(thread.receipt?.rows ?? [])]) of.set(r.ref, marks.ofRef(r.ref));
  const systems = new Set(thread.items.map(i => of.get(i.ref)?.connector).filter(Boolean));
  return { of, multi: [...of.values()].some(m => m && m.connector !== thread.connector), count: systems.size };
}
export type RowSystems = ReturnType<typeof rowSystems>;
/**
 * A row of a job across systems (artboard 10): its system's glyph, the system's word, the area's word, then what it
 * says. A receipt row says which system answered and when instead of the area ("Tidrapporteringen svarade 07:02").
 */
export function SystemLine({
  mark,
  words,
  answered,
}: {
  mark: ReturnType<Marks['ofRef']>;
  words: string;
  answered?: string;
}) {
  if (!mark) return <Text type="supporting">{words}</Text>;
  // Clew's own system is named alone ("Kalendern"): its area is the house's, not a guest's place.
  const lead = answered
    ? `${mark.source} svarade ${answered}`
    : [mark.source, mark.area && mark.ordinal !== null ? mark.title : ''].filter(Boolean).join('\u00a0· ');
  return <AreaLine icon={mark.area ? mark.icon : undefined}>{[lead, words].filter(Boolean).join('\u00a0· ')}</AreaLine>;
}
/** A reminder the person set that could not be scheduled, said in a sentence under the item's status. */
export function TimerNote({ thread }: { thread: Thread }) {
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
/**
 * A row's name (D97 item 6): the source's own words, and a link to the person or unit the row names when it names one,
 * with the page it was opened on as the way back. Never a name the row did not have, and no link on the page of the
 * person or unit it names (`entityHref`): it would lead out of the item to the page the reader is on.
 */
export function ItemLabel({ item, from }: { item: ThreadItem; from: string }) {
  const href = item.subject ? entityHref(item.subject, from) : null;
  return href ? (
    <Link href={href} weight="semibold" hasUnderline>
      {item.label}
    </Link>
  ) : (
    <Text weight="semibold">{item.label}</Text>
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
            `Jag påminner dig ${t.snoozedUntil ? snoozeWhen(t.snoozedUntil, new Date().toISOString()) : 'i morgon 06:00'}. Ärendet ligger under Väntar på andra tills dess.`,
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
  /** One of the card's own reads into the panel was pressed: the card unfolds it, a row opens its card with it unfolded. */
  onRead?: (action: ThreadAction) => void;
};
/**
 * Running one of a card's actions, shared by the card, the row and the review (D73), so a decision sent from the
 * review goes through the same confirm, the same decision endpoint (D45/D47), the same wait for the source and the same
 * error as from the card. Busy never disables the buttons: a disabled button drops the focus it holds (2.4.3).
 * Action-buttons wait on their own promise. The thread an action returns goes into the cache for every screen (D33);
 * `onChange` lets the page move focus first. `perform` says whether it ran: a confirm the person declined runs nothing.
 * An action with `confirm` asks in an alert dialog (`confirmation`, which the caller renders): Avbryt has the focus,
 * Esc cancels, and the dialog closes on the answer, so the focus is back on the pressed button before the card shows
 * the wait and the source's answer, as for an action that asks nothing (D45, D64).
 */
export function useCardAction({
  thread,
  onChange,
  onRead,
}: Pick<ActionProps, 'thread'> & Partial<Omit<ActionProps, 'thread'>>) {
  const { run, apply, busy: running, error } = useThreadAction({ onChange });
  const decision = useDecisionSend({ onChange });
  const busy = running || decision.busy;
  // The person's own action is on its way (D64): the card keeps the look it had, with the pressed button loading, and the
  // status is read out once the card has come to rest or the window has ended, not for every committed step in between.
  const held = useSettling(thread);
  const settling = busy || held;
  const [pressed, setPressed] = useState<string | null>(null);
  useEffect(() => {
    if (!settling) setPressed(null);
  }, [settling]);
  const selectable = thread.items.some(i => i.selectable);
  // The question an action asks before it runs. The one asked stays in the dialog while it closes.
  const [asked, setAsked] = useState<ThreadAction | null>(null);
  const answered = useRef<((yes: boolean) => void) | null>(null);
  const question = useRef<ThreadAction | null>(null);
  if (asked) question.current = asked;
  // Astryx runs a button's `clickAction` as a transition, which holds every state change until the action has ended.
  // The question is therefore asked a task later, outside it, so the dialog can open while a caller waits for the answer.
  const ask = (action: ThreadAction) =>
    new Promise<boolean>(resolve => {
      answered.current = resolve;
      setTimeout(() => setAsked(action), 0);
    });
  const answer = (yes: boolean) => {
    answered.current?.(yes);
    answered.current = null;
    setAsked(null);
  };
  // The action dialog (D112 item 10): the action it is open for, the rows chosen when it opened, the step it opens at,
  // and whether the focus goes back to the action's own button on a close (it was opened from elsewhere: an execute
  // started on a person, an assistant's draft). It stays mounted once opened, so its close gives the focus back.
  const [dialog, setDialog] = useState<{
    action: CardAction;
    refs?: string[];
    startAt?: ActionStep;
    open: boolean;
    refocus: boolean;
  } | null>(null);
  // What the person typed, per action, kept while the work item is open and dropped with it or once sent.
  const [drafts, setDrafts] = useState<Record<string, AskValues>>({});
  const openDialog = (
    action: CardAction,
    refs: string[] | undefined,
    options: { startAt?: ActionStep; values?: AskValues; refocus?: boolean } = {},
  ) => {
    if (options.values) setDrafts(d => ({ ...d, [action.id]: { ...d[action.id], ...options.values } }));
    setDialog({
      action,
      ...(refs ? { refs } : {}),
      ...(options.startAt ? { startAt: options.startAt } : {}),
      open: true,
      refocus: !!options.refocus,
    });
  };
  const closeDialog = () => {
    if (!dialog?.open) return;
    setDialog({ ...dialog, open: false });
    if (dialog.refocus) {
      // Opened from elsewhere, the dialog gives the focus to the action's own button on the item, once it has closed.
      const selector = `[data-action="${CSS.escape(dialog.action.id)}"][data-thread="${CSS.escape(thread.id)}"]`;
      requestAnimationFrame(() => requestAnimationFrame(() => document.querySelector<HTMLElement>(selector)?.focus()));
    }
  };
  const sendDialog = async (values: AskValues): Promise<string | null> => {
    if (!dialog) return null;
    const { action, refs } = dialog;
    const result = await decision.send(async () => {
      const answer = await api.act(thread.id, action.id, refs, undefined, values);
      if (answer.kind !== 'execute') throw new ApiError(500, 'Oväntat svar.');
      // Sent: the dialog closes first and the focus is back on the pressed button, which loads until the item has come
      // to rest, before the item shows the source's answer, as for a one-press action (D64).
      setPressed(action.id);
      setDialog(d => (d ? { ...d, open: false } : d));
      setDrafts(({ [action.id]: _sent, ...rest }) => rest);
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return answer.thread;
    });
    return result && 'error' in result ? result.error : null;
  };
  // The action as the item has it now: its path is resolved from the registered manifest on every read.
  const dialogAction = dialog ? (thread.actions.find(a => a.id === dialog.action.id) ?? dialog.action) : null;
  const actionDialog = dialog ? (
    <ActionDialog
      target={{ kind: 'item', thread, action: dialogAction!, ...(dialog.refs ? { refs: dialog.refs } : {}) }}
      isOpen={dialog.open}
      onOpenChange={open => {
        if (!open) closeDialog();
      }}
      {...(dialog.startAt ? { startAt: dialog.startAt } : {})}
      values={drafts[dialog.action.id] ?? {}}
      onValuesChange={values => setDrafts(d => ({ ...d, [dialog.action.id]: values }))}
      onSend={sendDialog}
    />
  ) : null;
  const parts = question.current ? confirmParts(question.current) : null;
  // The item's system does not answer: the question says that what is sent is queued and read back (D45, D47).
  const silent = useSilentSources().of(thread.connector);
  const confirmation = (
    <AlertDialog
      isOpen={asked !== null}
      onOpenChange={open => {
        if (!open) answer(false);
      }}
      title={parts?.title ?? ''}
      description={parts ? (silent ? `${parts.description} ${QUEUED_LINE}` : parts.description) : ''}
      actionLabel={question.current?.label ?? ''}
      cancelLabel="Avbryt"
      onAction={() => answer(true)}
    />
  );
  const perform = async (
    action: CardAction,
    refs?: string[],
    reviews?: import('@clew/contracts').ReviewEvidence[],
  ): Promise<boolean> => {
    if (busy) return false;
    const chosen = selectable ? refs : undefined;
    // An action that asks the person something or says beforehand what it writes opens the dialog; nothing is sent yet.
    if (action.kind !== 'read' && !reviews && opensDialog(action)) {
      openDialog(action, chosen);
      return true;
    }
    if (action.confirm && !(await ask(action))) return false;
    if (action.kind === 'read') {
      if (action.target === 'link') {
        await run(async () => {
          const result = await api.act(thread.id, action.id, chosen);
          if (result.kind === 'read' && typeof (result.output as { url?: string }).url === 'string')
            window.open((result.output as { url: string }).url, '_blank', 'noopener');
        });
        return true;
      }
      // A read into the panel unfolds in the card, by its address (`open-card` and `open-action`), so it survives reload.
      onRead?.(action);
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
  return {
    run,
    apply,
    busy,
    settling,
    pressed,
    error,
    selectable,
    perform,
    confirmation,
    openDialog,
    dialog: actionDialog,
  };
}
/** The execute a card reviews one row at a time before it sends (D70): its next step is then "Granska N", which leads to the review's page (D73, amended 2026-11-12). */
export const reviewedAction = (thread: Thread) =>
  thread.actions.find(a => a.role === 'primary' && a.kind === 'execute' && a.review === 'each');

/** Everything a work item can do, wherever it is drawn: run an action, snooze, dismiss, and keep the selection. */
export function useThreadActions({ thread, onChange, onRead }: ActionProps) {
  const {
    run,
    apply,
    busy,
    settling,
    pressed,
    error,
    selectable,
    perform: performRefs,
    confirmation,
    openDialog,
    dialog,
  } = useCardAction({
    thread,
    onChange,
    onRead,
  });
  const status = executionStatus(thread.execution);
  // Said in the words the item shows, which say that it is queued while its system does not answer.
  const said = executionStatus(thread.execution, !!useSilentSources().of(thread.connector));
  const lastStatus = useRef(status),
    announce = useAnnounce({ hasReplace: true });
  useEffect(() => {
    if (settling || status === lastStatus.current) return;
    lastStatus.current = status;
    announce(said ?? thread.receipt?.headline ?? 'Åtgärden är kontrollerad.');
  }, [status, settling, announce, thread.receipt?.headline]);
  // The card starts from the rows the connector marked, with a review begun on its page laid over them
  // (`review-session.ts`): a row chosen for approval is ticked, a row left behind is not, and a row the review has not
  // judged keeps the tick it had, so a review opened and left again changes nothing (the product owner, 2026-11-11). A
  // change to the thread starts it over. Back from the review, the item gives the focus to the control that led there
  // (`reviewLeftFor`, read as the item is drawn).
  const [draft] = useReviewDraft(reviewedAction(thread) ? thread : undefined);
  const marked = () => thread.items.filter(i => i.selected).map(i => i.ref);
  const withDraft = () =>
    selectionAfterReview(marked(), { approved: approvedOf(draft, thread.items), left: leftOf(draft, thread.items) });
  const [selected, setSelected] = useState<string[]>(withDraft);
  const [returned] = useState(() => reviewLeftFor(thread.id));
  const seededAt = useRef(thread.updatedAt);
  useEffect(() => {
    if (seededAt.current === thread.updatedAt) return;
    seededAt.current = thread.updatedAt;
    setSelected(withDraft());
  }, [thread.updatedAt]);
  const client = useQueryClient();
  const leave = useLeaveWithUndo(apply);
  // A button waits on its action (the pressed button loads until the source has answered). An action that asks first
  // is not waited on: the button stays as it is, enabled, while the question is open, so the focus can come back to
  // it on Avbryt; after a yes it loads as `pressed` while the card settles.
  const perform = (action: CardAction, refs?: string[]): Promise<void> | void => {
    const ran = performRefs(action, refs ?? selected).then(() => undefined);
    if (action.confirm) return;
    return ran;
  };
  // An action asked for from outside the item (`requestAction`: an execute started on a person, an assistant's draft)
  // opens in the dialog once the item is drawn with it.
  const request = useActionRequest(thread.id);
  useEffect(() => {
    if (!request) return;
    takeActionRequest(request);
    const action = thread.actions.find(a => a.id === request.actionId);
    if (!action || !opensDialog(action) || thread.state !== 'open') return;
    openDialog(action, selectable ? selected : undefined, {
      ...(request.startAt ? { startAt: request.startAt } : {}),
      ...(request.values ? { values: request.values } : {}),
      refocus: true,
    });
  }, [request]);
  // A card whose next step is a review (D70): "Granska N" leads to the review's page, which sends once with the approved refs (D73).
  const reviewed = reviewedAction(thread);
  // The card leaves at once (D64); the toast with Ångra confirms when the server has it.
  const dismiss = () =>
    run(
      async () => {
        const t = await api.dismiss(thread.id);
        leave(
          t,
          `Avfärdad som inte aktuellt. ${thread.trigger.source} skapar inte ärendet igen. Ärendet ligger under Klart.`,
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
    /** The review begun on its page, if any: "Granska N" is then "Fortsätt granska". */
    draft,
    /** The address of this item's review the person has just left, or null: the control leading there takes the focus. */
    returned,
    /** The alert dialog an action with `confirm` asks in; the card and the row render it. */
    confirmation,
    /** The action dialog (D112 item 10) of an action that asks or says what it writes; the item renders it. */
    dialog,
  };
}
export type Actions = ReturnType<typeof useThreadActions>;

/**
 * A read whose answer is an address out of Clew (`target: 'link'`) says on its control that it leaves (D111 rule 8):
 * Astryx's external-link glyph after the label, named with the words Astryx's own external link says in Swedish, so the
 * control's name is "Öppna i ekonomisystemet (öppnas i ny flik)" as a link out's is. A read into the panel unfolds in
 * the card instead and is not marked.
 */
export const leavingMark = (action: ThreadAction) =>
  action.kind === 'read' && action.target === 'link'
    ? { endContent: <Icon icon="externalLink" label="(öppnas i ny flik)" /> }
    : {};
/** "Återöppna" on an item dismissed in the last ten minutes (the server's window); the toast's Ångra does the same. */
const reopenable = (thread: Thread) =>
  thread.state === 'dismissed' && !!thread.handledAt && Date.now() - Date.parse(thread.handledAt) <= 10 * 60_000;

/**
 * A work item's buttons (D112 item 4, boards WorkItem, Inbox and PhoneItem): the one next step from the connector,
 * filled only when the item is due today (D48), its secondary actions, the item's one time action (D49: Inte nu while
 * it is the person's, Påminn mig while it waits on someone else), "Lägg till i samtalet" where the page has a box (D111
 * rule 6), and ⋯ with the rest and Avfärda. A step reviewed one row at a time is "Granska N", a link to the review's own
 * page ("Fortsätt granska" once begun; D70, D73 amended 2026-11-12). A decision on its way says so with Kontrollera status; a decided item keeps
 * "Visa granskning" and its reads; a dismissed one offers Återöppna. The receipt's Ångra is the receipt's own
 * (`work-item.tsx`). `pinned` is the phone's bar at the foot of the page (board PhoneItem): the next step and the first
 * secondary side by side the width of the screen, everything else under ⋯. An action the item draws elsewhere
 * (`omit`: a notice's link out, after its text) is not drawn here too.
 */
export function ActionRow({
  thread,
  actions,
  pinned = false,
  openRead = null,
  readHref,
  readSection,
  omit,
}: {
  thread: Thread;
  actions: Actions;
  pinned?: boolean;
  /** The read unfolded in the item now (`CardRead`), whose button says so. */
  openRead?: string | null;
  /** Where a read that answers with rows leads: its own page (D116). Such a read is a link, not a disclosure. */
  readHref?: ((action: ThreadAction) => string | undefined) | undefined;
  /** The id of the section a read unfolds in. */
  readSection?: string;
  /** The ids of the actions the item draws in another place. */
  omit?: readonly string[] | undefined;
}) {
  const conversation = useConversation();
  const silent = useSilentSources().of(thread.connector);
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
  const here = omit?.length ? thread.actions.filter(a => !omit.includes(a.id)) : thread.actions;
  const primary = here.find(a => a.role === 'primary');
  const secondary = here.filter(a => a.role === 'secondary').slice(0, 2);
  const overflow = here.filter(a => a.role === 'overflow' || (a.role === 'secondary' && !secondary.includes(a)));
  const count = selected.length;
  /**
   * A read that unfolds in the item says so on its button (a disclosure, 4.1.2): whether it is unfolded and, while it
   * is, the section it controls. The item finds the button again by `data-read` when the section's own toggle folds it.
   */
  const readState = (a: ThreadAction) =>
    a.kind === 'read' && a.target !== 'link' && !readHref?.(a)
      ? {
          'aria-expanded': openRead === a.id,
          ...(openRead === a.id && readSection ? { 'aria-controls': readSection } : {}),
          'data-read': a.id,
        }
      : {};
  /** A read that answers with rows leads to its page as a link (D116); every other action is pressed. */
  const pressOrLink = (a: ThreadAction) => {
    const href = readHref?.(a);
    return href ? { href } : { clickAction: () => perform(a) };
  };
  // "Attestera 2 valda" on an item whose rows are chosen (boards WorkItem and Inbox).
  const primaryLabel = primary && selectable ? `${primary.label} ${count} valda` : primary?.label;
  const due = streamGroup(thread, today()) === 'nu';
  const size = 'lg' as const;
  const width = pinned ? '100%' : undefined;
  // Back from the review's page (by Back, its trail, or once it is sent), the focus is on the control that led there,
  // wherever the item is drawn: a row under Dokument, else "Granska N" (now perhaps "Fortsätt granska" or "Visa
  // granskning"). The page puts the focus on its heading or the item's as it is drawn, a frame after the item's own
  // effects, so this waits two.
  const review = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!returned) return;
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        const pressed = document.querySelector<HTMLElement>(`a[href="${CSS.escape(returned)}"]`);
        (pressed ?? review.current)?.focus();
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [returned]);
  // "Granska N" leads to the review's page with this page as its way back; once begun, "Fortsätt granska" leads to the
  // first row not yet judged (`review-session.ts`).
  const { pathname, search } = useLocation();
  const rows = reviewRows(thread);
  const going = open && begun(actions.draft);
  const reviewLink = reviewHref(thread.id, {
    from: pathname + search,
    ...(going ? { step: nextStep(actions.draft, rows) } : {}),
  });
  const primaryButton = primary ? (
    reviewed ? (
      <Button
        ref={review}
        size={size}
        variant={due ? 'primary' : 'secondary'}
        label={going ? 'Fortsätt granska' : `Granska ${rows.length}`}
        width={width}
        href={reviewLink}
      />
    ) : (
      <Button
        size={size}
        variant={due ? 'primary' : 'secondary'}
        label={primaryLabel ?? ''}
        isDisabled={selectable && count === 0}
        isLoading={settling && pressed === primary.id}
        width={width}
        {...pressOrLink(primary)}
        data-action={primary.id}
        data-thread={thread.id}
        {...readState(primary)}
        {...leavingMark(primary)}
      />
    )
  ) : null;
  const addChip = () =>
    conversation.addChip({ ref: chipRef, kind: 'thread', label: thread.title, threadId: thread.id });
  // Only beside a conversation's own box (D112 item 7): everywhere else the item has its own box in the panel.
  const addToConversation = conversation.hasBox ? (
    <Button
      size={size}
      variant="ghost"
      label={inConversation ? 'I samtalet' : 'Lägg till i samtalet'}
      isDisabled={inConversation}
      onClick={addChip}
    />
  ) : null;
  /** ⋯: MoreMenu's button over DropdownMenu's compound rows, because MoreMenu's data rows cannot hold a sub-menu. */
  const more = ({ tucked = [], time }: { tucked?: ThreadAction[]; time?: TimeRows }) => (
    <>
      <DropdownMenu
        renderTrigger={trigger => (
          <IconButton
            {...trigger}
            size="md"
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
          <DropdownMenuItem
            key={a.id}
            label={a.label}
            {...(readHref?.(a) ? { href: readHref(a) } : { onClick: () => void perform(a) })}
            {...leavingMark(a)}
          />
        ))}
        {time && <TimeSubMenu label="Inte nu" rows={time.rows} own={time.own} />}
        {([...tucked, ...overflow].length > 0 || time) && <DropdownMenuDivider />}
        <DropdownMenuItem label={'Avfärda\u00a0· inte aktuellt'} onClick={() => void dismiss()} />
      </DropdownMenu>
      {snoozeRows.dialog}
      {remindRows.dialog}
    </>
  );
  const pending = executionStatus(thread.execution, !!silent);
  const viewReview =
    reviewed && (thread.receipt || pending || !open) ? (
      <Button
        ref={review}
        size={size}
        variant="secondary"
        label="Visa granskning"
        href={reviewHref(thread.id, { from: pathname + search })}
      />
    ) : null;
  // A started action that was not sent because its user name had moved to someone else, or away (D122): said so, and
  // decided again with the item's own button, on the user name the person has now. Nothing is left to check.
  const decideAgain = open && thread.execution?.state === 'failed' && thread.execution.reason === SUBJECT_CHANGED;
  // A decision the source has not confirmed is said so, unless it is the person's own and still on its way (D64).
  if (pending && (!settling || pressed === null))
    return (
      <HStack gap={2} vAlign="center" wrap="wrap">
        {decideAgain
          ? primaryButton
          : (!thread.execution ||
              ['pending', 'running', 'unknown'].includes(thread.execution.state) ||
              thread.execution.reason) && (
              <Button
                size={size}
                label="Kontrollera status"
                clickAction={() => run(() => api.checkExecution(thread.id))}
              />
            )}
        {viewReview}
        <Text type="supporting">{pending}</Text>
        {addToConversation}
      </HStack>
    );
  // Set aside (D28): the way back is the first button; nothing else is due until the item is back.
  if (open && isSnoozed(thread, new Date().toISOString()))
    return (
      <HStack gap={2} vAlign="center" wrap="wrap">
        <Button
          size={size}
          variant="secondary"
          label="Ta upp nu"
          clickAction={() => run(() => api.reopen(thread.id), { optimistic: reopened(thread) })}
        />
        {more({})}
      </HStack>
    );
  if (open && !thread.waitingOn) {
    const secondaryButton = (a: ThreadAction) => (
      <Button
        key={a.id}
        size={size}
        variant="secondary"
        label={a.label}
        isLoading={settling && pressed === a.id}
        width={width}
        {...pressOrLink(a)}
        data-action={a.id}
        data-thread={thread.id}
        {...readState(a)}
        {...leavingMark(a)}
      />
    );
    // The phone's bar (board PhoneItem): the next step the width of the screen, everything else under ⋯, so its words
    // are never cut at 320 px (1.4.10). The board draws a second step beside it, which only fits a short label.
    if (pinned)
      return (
        <HStack gap={2} vAlign="center">
          {primaryButton ? (
            <StackItem size="fill">{primaryButton}</StackItem>
          ) : (
            secondary[0] && <StackItem size="fill">{secondaryButton(secondary[0])}</StackItem>
          )}
          {more({ tucked: primaryButton ? secondary : secondary.slice(1), time: snoozeRows })}
        </HStack>
      );
    return (
      <HStack gap={2} vAlign="center" wrap="wrap">
        {primaryButton}
        {secondary.map(secondaryButton)}
        <TimePicker label="Inte nu" rows={snoozeRows.rows} own={snoozeRows.own} size="md" />
        {addToConversation}
        {more({})}
      </HStack>
    );
  }
  // An item that waits on others, also after the person's own decision (D70 amended): its own timer, and the review
  // that was sent. The receipt above says what was done, with its Ångra while the window is open.
  if (open && thread.waitingOn)
    return (
      <HStack gap={2} vAlign="center" wrap="wrap">
        {viewReview}
        <TimePicker label="Påminn mig" rows={remindRows.rows} own={remindRows.own} size="md" />
        {more({})}
      </HStack>
    );
  // Decided or set aside for good: the review that was sent, the item's reads, and Återöppna while the server allows it.
  const reads = secondary.filter(a => a.kind === 'read');
  if (!viewReview && !reads.length && !reopenable(thread)) return null;
  return (
    <HStack gap={2} vAlign="center" wrap="wrap">
      {reopenable(thread) && (
        <Button
          size={size}
          variant="secondary"
          label="Återöppna"
          clickAction={() => run(() => api.reopen(thread.id), { optimistic: reopened(thread) })}
        />
      )}
      {viewReview}
      {reads.map(a => (
        <Button
          key={a.id}
          size={size}
          variant="secondary"
          label={a.label}
          {...pressOrLink(a)}
          {...readState(a)}
          {...leavingMark(a)}
        />
      ))}
    </HStack>
  );
}
