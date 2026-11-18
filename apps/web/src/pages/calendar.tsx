import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type Ref } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import {
  keepPreviousData,
  useIsFetching,
  useQueries,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import type { CalendarEvent, Prepared, Proposal, SessionUser, Thread, ThreadMessage } from '@clew/contracts';
import {
  AreaMark,
  Badge,
  Button,
  CHOSEN_ID,
  DatePicker,
  Divider,
  Drawer,
  DropdownMenu,
  EmptyState,
  EventCalendar,
  HStack,
  Heading,
  Icon,
  IconButton,
  Layout,
  LayoutContent,
  LayoutFooter,
  LayoutHeader,
  LayoutPanel,
  Link,
  MetadataList,
  MetadataListItem,
  SegmentedControl,
  SegmentedControlItem,
  StackItem,
  Text,
  VStack,
  agendaItems,
  useAnnounce,
  useMediaQuery,
  type AgendaItem,
  type CalendarView,
} from '@clew/ui';
import {
  addDays,
  dayLabel,
  displayDate,
  monthLabel,
  occursOn,
  rangeLabel,
  shortDayLabel,
  timeRange,
  today,
  weekNumber,
  weekStart,
} from '@clew/calendar/dates';
import { api } from '../api';
import { areasQuery, calendarWeekQuery, threadsQuery } from '../queries';
import { keys } from '../query-keys';
import { pickProposalThread } from '../thread-cache';
import { useThreadAction } from '../mutations';
import { errorMessage, noCalendar } from '../query-policy';
import { usePageTitle } from '../page-title';
import { useMarks } from '../marks';
import { ENTRY_PARAM, viewSearch, withEntry } from '../panel-address';
import { itemPageHref } from '../work-items';
import { Shell, mobileQuery, shortQuery } from '../components/shell';
import { useRail } from '../components/nav';
import { EventDialog, type Mode } from '../components/calendar/event-dialog';
import { BookingDialog } from '../components/calendar/booking-dialog';
import { BookingButtons, BookingFields, BookingHint, useBooking } from '../components/calendar/booking';
import { MoveButtons, MoveFields, useMove } from '../components/calendar/move';
import { PageFrame } from '../components/page-frame';
import { AsyncContent, ContentSkeleton } from '../components/loading';
import type { Mark } from '../marks';
import { AskClew } from '../components/thing-panel';
import { useModelConfigured, type ThingSubject } from '../components/conversation-context';
import { AskTalk, useAskInPlace } from '../components/ask-in-place';
import { PreparedRow } from '../components/conversation';
import { SilentNotice, useSaySilent, useSilentSources } from '../components/silent-sources';

/** The three views as the URL names them, so a view is addressable and the back button works. */
type View = 'day' | 'week' | 'month';
const views: View[] = ['day', 'week', 'month'];
const viewLabels: Record<View, string> = { day: 'Dag', week: 'Vecka', month: 'Månad' };
const isoDate = /^\d{4}-\d{2}-\d{2}$/;
const monthStart = (date: string) => date.slice(0, 8) + '01';
const addMonths = (date: string, months: number) => {
  const d = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1 + months, 1));
  return d.toISOString().slice(0, 10);
};
/** The Mondays whose weeks the month grid shows, so the whole grid is read with the week endpoint the API already has. */
const weeksOfMonth = (date: string) => {
  const first = weekStart(monthStart(date)),
    last = weekStart(addDays(addMonths(date, 1), -1));
  const weeks: string[] = [];
  for (let w = first; w <= last; w = addDays(w, 7)) weeks.push(w);
  return weeks;
};
const nextWholeHour = (now: Date) => {
  const d = new Date(now);
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return { start: d.toISOString(), end: new Date(d.getTime() + 3600_000).toISOString() };
};
const EMPTY_PROPOSALS: Proposal[] = [];
type Week = { from: string; events: CalendarEvent[]; proposals: Proposal[] };
/** The loaded weeks as one calendar. Weeks overlap at the month's edges; an occurrence is one id at one start. A stable function, so useQueries re-combines only when an answer changes. */
const combineWeeks = (results: UseQueryResult<Week>[]) => {
  const parts = results.map(r => r.data).filter((d): d is Week => d !== undefined);
  const seen = new Set<string>();
  return {
    events: parts
      .flatMap(p => p.events)
      .filter(e => {
        const key = `${e.id}@${e.start}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }),
    proposals: parts[0]?.proposals ?? EMPTY_PROPOSALS,
    pending: results.some(r => r.isPending),
    /** A week that could not be read, whether or not an earlier answer is still on the grid. */
    failed: results.find(r => r.isError)?.error,
    /** Whether any week on screen has been read: what the grid can show while the calendar does not answer. */
    read: parts.length > 0,
    /** When the calendar last answered for a week that now fails, if this page read it before. */
    lastRead: Math.max(0, ...results.filter(r => r.isError && r.data !== undefined).map(r => r.dataUpdatedAt)),
  };
};
const selectProposalThread = (data: { threads: Thread[] }) => pickProposalThread(data.threads);
const capital = (s: string) => (s ? s[0]!.toLocaleUpperCase('sv-SE') + s.slice(1) : s);
/** A chip's ref as the server takes it (`ChipSchema`): an id outside it goes without a chip rather than failing the question. */
const CHIP_REF = /^[a-z]+:[A-Za-z0-9:_.@-]+$/;
/**
 * The window the server resolves an event chip in (`assistant/chips.ts`): this week's Monday and the two weeks from it.
 * An event outside it is still asked about in the panel, without its chip.
 */
const inChipWindow = (start: string) => {
  const from = weekStart(today());
  const day = displayDate(start);
  return day >= from && day < addDays(from, 14);
};
/** When an entry is, as the pane says it under the name: "Torsdag 19 november · 13:15–14:00", or the day and "hela dagen". */
const whenOf = (item: AgendaItem) =>
  item.allDay
    ? `${capital(dayLabel(displayDate(item.start)))}, hela dagen`
    : `${capital(dayLabel(displayDate(item.start)))}\u00a0· ${timeRange(item.start, item.end)}`;
/** A meeting the person may move or cancel: their own, one occurrence, with a clock (the rules of `ownEvent` on the server). */
const movable = (event: CalendarEvent) => event.mine && event.canCancel && !event.recurring && !event.allDay;
/**
 * What the assistant is asked about an entry with: its chip, which is also what stands open (D126 rule 5). A meeting
 * outside the window the server resolves its chip in has nothing to ask with, and so neither a box nor a button.
 */
const entrySubject = (item: AgendaItem): ThingSubject | null => {
  if (item.proposal) {
    const p = item.proposal;
    const ref = 'proposal:' + p.id;
    // The conversation about a proposal has its work item beside it, where several are chosen at once.
    return CHIP_REF.test(ref)
      ? {
          key: ref,
          label: 'förslaget',
          chips: [{ ref, kind: 'proposal', label: `${item.title} · ${p.participant.name}` }],
          search: '?card=' + encodeURIComponent(p.threadId),
        }
      : null;
  }
  if (!item.event) return null;
  const ref = 'event:' + item.event.id;
  return CHIP_REF.test(ref) && inChipWindow(item.start)
    ? { key: ref, label: 'mötet', chips: [{ ref, kind: 'event', label: item.title }], search: '' }
    : null;
};
const proposalStatus: Partial<Record<Proposal['status'], string>> = {
  proposed: 'Förslag, inte bokat',
  confirmed: 'Inbjudan skickad',
  final: 'Bokat',
  accepted: 'Medarbetaren har tackat ja',
  'declined-by-invitee': 'Medarbetaren har tackat nej',
};

/**
 * A meeting's buttons (D112 item 9, board Calendar, the `invited` state): what the calendar lets the person do, move
 * their own booking (in this pane, the block on the grid being the one that is placed) or cancel it (a confirmation,
 * so a dialog). The assistant is asked in the box at the pane's foot (board KalFraga); on a phone, which has no pane,
 * "Fråga assistenten" leads to a conversation (`askButton`). A meeting someone else organises has no buttons of the
 * organiser's, and the calendar offers no reply of the person's own, so it has none.
 */
function EventActions({
  item,
  askButton,
  onAct,
}: {
  item: AgendaItem;
  /** What a phone's "Fråga assistenten" asks about; null where the box stands in the pane instead. */
  askButton: ThingSubject | null;
  onAct: (mode: Exclude<Mode, 'view'>) => void;
}) {
  const own = movable(item.event!);
  if (!own && !askButton) return null;
  return (
    <HStack gap={2} wrap="wrap" vAlign="center">
      {own && <Button size="sm" variant="secondary" label="Flytta …" onClick={() => onAct('move')} />}
      {own && <Button size="sm" variant="secondary" label="Ställ in …" onClick={() => onAct('cancel')} />}
      {askButton && <AskClew subject={askButton} size="sm" />}
    </HStack>
  );
}
/** A meeting's facts: that the person is invited to one they do not organise, where and with whom. Its time stands under its name. */
function EventFacts({ item }: { item: AgendaItem }) {
  const event = item.event!;
  return (
    <VStack gap={4}>
      {!event.mine && (
        <HStack gap={2} wrap="wrap">
          <Badge variant="neutral" label="Du är inbjuden" />
        </HStack>
      )}
      <MetadataList columns="single">
        {event.room && (
          <MetadataListItem label="Plats">
            <Text>{event.room}</Text>
          </MetadataListItem>
        )}
        <MetadataListItem label="Organisatör">
          <Text>{event.mine ? 'Du' : event.organizer}</Text>
        </MetadataListItem>
        {event.participants.length > 0 && (
          <MetadataListItem label="Deltagare">
            <VStack gap={1}>
              {event.participants.map(name => (
                <Text key={name}>{name}</Text>
              ))}
            </VStack>
          </MetadataListItem>
        )}
      </MetadataList>
    </VStack>
  );
}

/**
 * A proposal's buttons (D112 item 9, board Calendar, the `thing` state): the proposal's existing decisions, through the
 * same use cases as before (`modules/calendar/usecases/decisions.ts`): send the invitation for this time, move it (the
 * dialog, never drag alone), draw the proposals again in the next week, and undo while the calendar allows it. The
 * assistant is asked in the box at the pane's foot; on a phone "Fråga assistenten" ends the row (`askButton`). A
 * decision that fails says so above the buttons.
 */
function ProposalActions({
  item,
  thread,
  askButton,
  onMove,
}: {
  item: AgendaItem;
  thread: Thread | null;
  askButton: ThingSubject | null;
  onMove: () => void;
}) {
  const p = item.proposal!;
  const { run, error } = useThreadAction();
  const proposed = p.status === 'proposed';
  const open = thread?.state === 'open';
  const undoUntil = thread?.proposals
    .map(x => x.undoUntil)
    .filter((v): v is string => !!v)
    .sort()
    .at(-1);
  const undoOpen =
    !!undoUntil && Date.parse(undoUntil) > Date.now() && !!thread?.proposals.some(x => x.status === 'confirmed');
  return (
    <VStack gap={2}>
      {error && (
        <Text as="p" role="alert" color="accent">
          {error}
        </Text>
      )}
      <HStack gap={2} wrap="wrap" vAlign="center">
        {proposed && open && (
          <Button
            size="sm"
            variant="primary"
            label="Skicka inbjudan"
            clickAction={() => run(() => api.confirm(p.threadId, [p.id]))}
          />
        )}
        {proposed && <Button size="sm" variant="secondary" label="Flytta …" onClick={onMove} />}
        {proposed && open && thread?.week && (
          <Button
            size="sm"
            variant="ghost"
            label="Föreslå andra tider"
            clickAction={() => run(() => api.replan(p.threadId, addDays(thread.week!, 7)))}
          />
        )}
        {undoOpen && (
          <Button size="sm" variant="destructive" label="Ångra" clickAction={() => run(() => api.undo(p.threadId))} />
        )}
        {askButton && <AskClew subject={askButton} size="sm" />}
      </HStack>
    </VStack>
  );
}
/** A proposal's facts: that it is a proposal and not booked, when the round must be done and with whom. Its time stands under its name. */
function ProposalFacts({ item, thread }: { item: AgendaItem; thread: Thread | null }) {
  const p = item.proposal!;
  const deadline = thread?.deadline?.slice(0, 10);
  return (
    <VStack gap={4}>
      <HStack gap={2} wrap="wrap">
        <Badge variant={p.status === 'proposed' ? 'info' : 'neutral'} label={proposalStatus[p.status] ?? 'Förslag'} />
        {deadline && <Badge variant="warning" label={`Senast ${shortDayLabel(deadline)}`} />}
      </HStack>
      <MetadataList columns="single">
        <MetadataListItem label="Med">
          <Text>{p.participant.name}</Text>
        </MetadataListItem>
      </MetadataList>
      {thread?.summary && <Text as="p">{thread.summary}</Text>}
    </VStack>
  );
}

/**
 * What the calendar's pane holds: an entry (its time and buttons under its name, its facts under them), or a form of the
 * page's own, "Ny bokning" or "Flytta …" (its fields, and its buttons at the pane's foot).
 */
interface Shown {
  /** What the pane's focus tells apart: an entry's id, the booking, a move of an entry. */
  id: string;
  /** The line over the name: the system and what the thing is, in words (the mark's colour never stands alone, 1.4.1). */
  source: string;
  mark: Pick<Mark, 'ordinal' | 'icon'> | undefined;
  title: string;
  /** The entry's own page (a proposal's work item): its name in the pane's header is the link there. */
  page?: string;
  /** Under the name, where it never scrolls away: an entry's time and buttons, a form's one line. */
  under?: ReactNode;
  body: ReactNode;
  /** A form's buttons, which stay at the pane's foot. */
  foot?: ReactNode;
  /** A form gives the focus to its first field when it opens; an entry to its name. */
  form: boolean;
  /**
   * The pane holds a conversation with the assistant (`AskTalk`): its body does not scroll as one, the transcript
   * scrolls in itself between the facts and the box.
   */
  talk?: boolean;
}
/**
 * The pane's content, beside the grid and in the drawer alike (board "En post i rutan bredvid", 2026-11-18). Its header
 * is the one the pane beside a conversation has: the area's mark and the source line, ✕, then the name (a link to the
 * entry's page where it has one, the name being the way in). Under the name, where nothing scrolls away, an entry's time
 * and buttons (D126 rule 2's pane); the facts or the fields under the rule with their own inset, and under them the
 * conversation with the assistant and its box where the pane has one; a form's buttons at the foot. An entry's name
 * takes the focus when the pane opens, from a script only; a form's first field does.
 */
function PaneFrame({
  shown,
  headingRef,
  onClose,
}: {
  shown: Shown;
  headingRef: Ref<HTMLHeadingElement>;
  onClose: () => void;
}) {
  return (
    <Layout
      height="fill"
      header={
        <LayoutHeader padding={6} hasDivider>
          <VStack gap={4}>
            <VStack gap={2}>
              <HStack hAlign="between" vAlign="center" gap={3}>
                <HStack gap={2} vAlign="center">
                  <AreaMark ordinal={shown.mark?.ordinal ?? null} icon={shown.mark?.icon ?? 'calendar'} />
                  <Text type="supporting" color="secondary">
                    {shown.source}
                  </Text>
                </HStack>
                <IconButton size="sm" variant="ghost" label="Stäng" icon={<Icon icon="close" />} onClick={onClose} />
              </HStack>
              <Heading level={2} {...(shown.form ? {} : { ref: headingRef, tabIndex: -1, 'data-autofocus': '' })}>
                {shown.page ? (
                  <Link href={shown.page} hasUnderline>
                    {shown.title}
                  </Link>
                ) : (
                  shown.title
                )}
              </Heading>
            </VStack>
            {shown.under}
          </VStack>
        </LayoutHeader>
      }
      content={
        <LayoutContent padding={6} isScrollable={!shown.talk}>
          {shown.body}
        </LayoutContent>
      }
      footer={
        shown.foot ? (
          <LayoutFooter padding={6} hasDivider>
            {shown.foot}
          </LayoutFooter>
        ) : undefined
      }
    />
  );
}
/**
 * The window width from which the pane stands beside the grid: the rail, the week's least column and the pane,
 * 260 + 640 + 440 px, the line the shared panel kept before D126. Narrower, short (1.4.10) or on a phone it is a drawer.
 */
const PANE = 440;
const besideQuery = `(min-width: ${260 + 640 + PANE}px)`;
/** The pane's id while "Fråga om veckan" holds it: one id for every range, so stepping to another week keeps the focus. */
const RANGE_ID = 'ask:range';
/** What a key pressed in the pane belongs to rather than the pane: a menu, a list box or a dialog over it. */
const OWNS_ESCAPE = '[role="menu"], [role="listbox"], [role="dialog"], dialog';
const TYPING = 'input, textarea, [contenteditable="true"], [role="textbox"], [role="combobox"]';
/** The page's title, where the focus goes when the pane closes and what opened it has left the grid. */
const TITLE_ID = 'calendar-title';

/**
 * The calendar as a page (D27, D32, D112 item 9, board Calendar; the pass of 2026-11-18, canvas "Clew · Kalender, a
 * pass"): one day, one week or one month on FullCalendar under Clew's theme, inside the one shell; it keeps its own page
 * type (D126, D27). The grid is the sheet's own content: it has no frame of its own and fills the sheet. The week is
 * seven days and the day twenty-four hours (the product owner, 2026-11-18: people work late and at weekends): the grid
 * opens at the start of the office day and scrolls inside itself to the hours before and after it, the days and hours
 * outside the working week drawn as the ground. An event or a proposal chosen in the grid opens in the page's own pane in the end slot (`entry`
 * in the address, so Back, a reload and Esc keep working): its time and buttons under its name and its facts under
 * them, a proposal's name the link to its work item. The same pane holds the page's two forms: "Ny bokning" (the
 * button, a click on an hour or a span dragged) and "Flytta …". While one is open the time is a block on the grid that
 * is dragged and stretched, and the form's fields say the same time, so every action has a keyboard path and drag is
 * never the only way (D27); the week stays in view and in use, and nothing is written before the form's last button. A
 * booking being made has no address: a reload never greets the person with a form they did not ask for. Below the width
 * where the pane fits beside the week and on a short screen the same pane is a drawer over the grid; on a phone the two
 * forms are the dialogs they were. Nothing else opens beside the calendar (D126 rule 3). The assistant is asked in place
 * here, since its answer is drawn on the page itself (the product owner, 2026-11-18, boards KalFraga, KalFragaFlytt and
 * KalFragaVecka): under an entry's facts stands the person's conversation about it, found again when the entry is
 * opened again, over a box at the pane's foot; "Fråga om veckan" gives the pane to the same for the range on screen.
 * An answer that prepared a move of the person's own meeting fills in "Flytta …", its block on the grid where it would
 * end up; one that prepared a cancellation asks "Ställ in mötet?". Nothing is written before the person's own button,
 * and an earlier answer makes nothing ready by itself. On a phone the question is still asked in a conversation with
 * the entry or the range beside it (D126 rule 5). The proposals are reached from "Förslag N" in the page's header, a
 * menu that leads to each one. "Ställ in …" asks in a dialog: a confirmation is what a dialog is for.
 */
export function CalendarPage({ user, admin = false }: { user: SessionUser; admin?: boolean }) {
  const mobile = useMediaQuery(mobileQuery);
  // 1.4.10: on a short screen nothing is pinned beside the page; the pane is the drawer over it.
  const short = useMediaQuery(shortQuery);
  const beside = useMediaQuery(besideQuery) && !short;
  const [params, setParams] = useSearchParams();
  const { pathname, search, state: routed } = useLocation();
  const navigate = useNavigate();
  const requested = params.get('date') ?? params.get('week');
  const date = requested && isoDate.test(requested) ? requested : today();
  const view: View = views.includes(params.get('view') as View) ? (params.get('view') as View) : 'week';
  const anchor = view === 'week' ? weekStart(date) : view === 'month' ? monthStart(date) : date;
  const go = (next: { date?: string; view?: View }) =>
    setParams(p => {
      const q = new URLSearchParams(p);
      q.delete('week');
      q.set('date', next.date ?? date);
      q.set('view', next.view ?? view);
      return q;
    });
  // The same frame as the start page (D31, D34), from the same cache (D33): the rail with the person's time axis.
  const nav = useRail({ current: { surface: 'calendar' }, admin, manager: user.role === 'manager' });
  const marks = useMarks();
  // The proposal thread is picked from the stream's own list, so a decision here and the item on Att göra agree.
  const threadsQ = useQuery({ ...threadsQuery, select: selectProposalThread });
  const thread = threadsQ.data ?? null;
  const { apply } = useThreadAction();
  const [moveError, setMoveError] = useState<string | null>(null);
  // The entry's own dialog: the question before a meeting is cancelled, and on a phone the move as well.
  const [acting, setActing] = useState<{ item: AgendaItem; mode: Exclude<Mode, 'view'> } | null>(null);
  // The page's two forms, kept here so the pane, the drawer and a phone's dialog draw the same draft and the grid its block.
  const booking = useBooking();
  const move = useMove();
  const announce = useAnnounce();
  const model = useModelConfigured();
  // "Fråga om veckan" holds the pane by itself until it is closed, or something else takes the pane.
  const [rangeOpen, setRangeOpen] = useState(false);
  const title =
    view === 'day'
      ? dayLabel(anchor)
      : view === 'month'
        ? monthLabel(anchor)
        : `Vecka ${weekNumber(anchor)}\u00a0· ${rangeLabel(anchor, 7)}`;
  const shortTitle = view === 'week' ? `Vecka ${weekNumber(anchor)}` : capital(title);
  /** The weeks the view needs: one for a day or a week, every week the month grid shows. */
  const weeks = useMemo(() => (view === 'month' ? weeksOfMonth(anchor) : [weekStart(anchor)]), [view, anchor]);
  // Each week is one query, shared with the cards on the start page; the previous answer stays on the grid while the next week loads, and answers can no longer land out of order.
  const { events, proposals, failed, pending, lastRead, read } = useQueries({
    queries: weeks.map(w => ({ ...calendarWeekQuery(w), placeholderData: keepPreviousData })),
    combine: combineWeeks,
  });
  /**
   * A week that cannot be read (D116, amended 2026-11-12). The person has no calendar when the registry does not show it
   * to them (D23) or their account has none bound: the page says so, without a warning. Any other failure is the calendar
   * not answering, said in the page's head with since when and "Försök igen", once aloud in the session; the grid keeps
   * what it has.
   */
  const client = useQueryClient();
  const systems = useQuery(areasQuery).data?.systems;
  const calendarHidden =
    (!!systems && !systems.some(s => s.connector === 'calendar')) || noCalendar(failed) === 'hidden';
  const withoutCalendar = calendarHidden || noCalendar(failed) === 'unbound';
  const calendarSilent = !!failed && !withoutCalendar;
  const silent = useSilentSources();
  const say = useSaySilent();
  const calendarName = marks.system('calendar')?.source ?? 'Kalendern';
  /** The calendar's mark at the start of the pane's header (D71), as the pane beside a conversation has its thing's. */
  const calendarMark = marks.ofRef('calendar:');
  const calendarSince = silent.of('calendar')?.since ?? (lastRead ? new Date(lastRead).toISOString() : null);
  const retrying = useIsFetching({ queryKey: keys.calendarAll }) > 0;
  useEffect(() => {
    if (calendarSilent && silent.named) say([{ connector: 'calendar', source: calendarName }]);
  }, [calendarSilent, silent.named, calendarName, say]);
  const silentHead = calendarSilent ? (
    <SilentNotice
      silent={{ source: calendarName, since: calendarSince }}
      retrying={retrying}
      onRetry={() => void client.refetchQueries({ queryKey: keys.calendarAll, type: 'active' })}
    />
  ) : null;
  const error = moveError;
  usePageTitle(
    withoutCalendar ? 'Kalender' : `${shortTitle} · Kalender`,
    withoutCalendar
      ? 'Kalender'
      : view === 'week'
        ? `Vecka ${weekNumber(anchor)}, ${rangeLabel(anchor, 7)}`
        : `${view === 'day' ? 'Dagvy' : 'Månadsvy'}, ${title}`,
  );
  // The time being placed is a block on the grid: a booking's as the entry `agendaItems` draws for a time a person is
  // choosing (D112 item 10), a move's as the entry's own block at the time the fields say.
  const draftTitle = booking.draft ? booking.draft.title.trim() || 'Ny bokning' : null;
  const draftSpan = mobile ? null : booking.span;
  const movingId = !mobile && move.item ? move.item.id : null;
  const moveSpan = move.span;
  const moved = move.item;
  const agenda = useMemo(
    () => agendaItems(events, proposals, [], draftSpan && draftTitle ? { ...draftSpan, title: draftTitle } : undefined),
    [events, proposals, draftSpan, draftTitle],
  );
  // The entry being moved stands where the fields say, also in a week other than its own (a time the assistant
  // prepared, a day typed in the field), so the week its new time is in shows its block.
  const items = useMemo(() => {
    if (!movingId || !moveSpan || !moved) return agenda;
    return agenda.some(i => i.id === movingId)
      ? agenda.map(i => (i.id === movingId ? { ...i, ...moveSpan } : i))
      : [...agenda, { ...moved, ...moveSpan }];
  }, [agenda, movingId, moveSpan, moved]);
  // The entry the pane holds (`entry`): looked up among the loaded weeks, and kept while another week is on screen. What
  // is kept is the entry as the calendar answered it, never the time a move being made puts it at.
  const entryId = params.get(ENTRY_PARAM);
  const seen = useRef(new Map<string, AgendaItem>());
  for (const i of agenda) seen.current.set(i.id, i);
  const entryItem =
    entryId && entryId !== CHOSEN_ID ? (agenda.find(i => i.id === entryId) ?? seen.current.get(entryId) ?? null) : null;
  const dayItems = useMemo(
    () => (acting ? items.filter(i => occursOn(i, displayDate(acting.item.start))) : []),
    [items, acting],
  );
  // A drop on the grid: the promise has to reject for the calendar to put the block back, so this one does not go through `run`.
  const moveProposal = (item: AgendaItem, start: string, end: string) => {
    const p = item.proposal!;
    setMoveError(null);
    return api
      .moveProposal(p.threadId, p.id, { start, end })
      .then(apply)
      .catch(e => {
        setMoveError(errorMessage(e, 'Något gick fel.'));
        throw e;
      });
  };
  const step = (direction: 1 | -1) =>
    go({
      date:
        view === 'day'
          ? addDays(anchor, direction)
          : view === 'month'
            ? addMonths(anchor, direction)
            : addDays(anchor, 7 * direction),
    });
  const calendarView: CalendarView =
    view === 'day' ? 'timeGridDay' : view === 'month' ? 'dayGridMonth' : mobile ? 'listWeek' : 'timeGridWeek';
  const stepLabel = view === 'day' ? 'dag' : view === 'month' ? 'månad' : 'vecka';
  const proposed = thread?.state === 'open' ? thread.proposals.filter(p => p.status === 'proposed') : [];
  const mark = thread ? marks.ofThread(thread) : null;

  /** "Flytta …": in the pane where there is one; on a phone the entry's dialog at that step. "Ställ in …" always asks in the dialog. */
  const act = (item: AgendaItem, mode: Exclude<Mode, 'view'>) =>
    mode === 'move' && !mobile ? move.start(item) : setActing({ item, mode });
  /**
   * "Fråga om veckan", "om dagen", "om månaden" (board Calendar, the `week` state): the range on screen, with the
   * calendar's own read of that range as its chip, is what the box in the pane asks about (the product owner,
   * 2026-11-18), and what a conversation is about on a phone (D126 rule 5).
   */
  const rangeRead =
    view === 'day'
      ? { capability: 'calendar.day', title: shortTitle, input: { date: anchor } }
      : { capability: 'calendar.week', title: shortTitle, input: { from: weekStart(anchor) } };
  const rangeWord = view === 'day' ? 'dagen' : view === 'month' ? 'månaden' : 'veckan';
  const rangeSubject: ThingSubject = {
    key: `range:${view}:${anchor}`,
    label: rangeWord,
    chips: [{ ref: 'capability:' + rangeRead.capability, kind: 'capability', label: shortTitle }],
    search: viewSearch(rangeRead),
  };
  /** What the box in the pane can be about: the entry being moved, else the entry in the address. */
  const paneItem = (movingId ? move.item : null) ?? entryItem;
  /** "Fråga om veckan" holds the pane: on a phone there is no pane, and its button leads to a conversation (D126 rule 5). */
  const rangeAsk = rangeOpen && !mobile;
  /**
   * What the conversation and the box in the pane are about (the product owner, 2026-11-18: they stand under every
   * entry from the start, no button opens them): the range while "Fråga om veckan" holds the pane, else the entry in the
   * pane, or its move. A booking made by hand has none. Without a model there is no box (D8), and on a phone no pane.
   */
  const askSubject = mobile || !model ? null : rangeAsk ? rangeSubject : paneItem ? entrySubject(paneItem) : null;
  // Another entry or another range on screen is another subject: the person's conversation about that one is shown and
  // continued, or the next question starts one (`useAskInPlace`).
  const ask = useAskInPlace(askSubject, response => takeAnswer(response.prepared));
  // An entry chosen while "Fråga om veckan" holds the pane (on the grid, from Förslag) takes the pane. Compared with the
  // entry before, since an entry that stood in the pane leaves the address only after the range has taken it.
  const lastEntry = useRef(entryId);
  useEffect(() => {
    const was = lastEntry.current;
    lastEntry.current = entryId;
    if (entryId && entryId !== was) setRangeOpen(false);
  }, [entryId]);
  /** Whether a day is in the range on screen. */
  const inView = (day: string) =>
    view === 'week' ? weekStart(day) === anchor : view === 'month' ? monthStart(day) === anchor : day === anchor;
  /**
   * A decision of the calendar's the assistant prepared (`Prepared`), made where the person makes it by hand and never
   * by itself: nothing is written before the person's own button (D45, D47). A move of a meeting of their own fills in
   * "Flytta …" (board KalFragaFlytt), its block on the grid where it would end up, in the week of its new time unless
   * the box is about the range on screen; a cancellation asks the page's own question, "Ställ in mötet?", in the
   * entry's dialog. Only for a meeting that is loaded and is the person's to change; a move needs the pane, so not on a
   * phone. `about` is the subject a box answer was asked about: a meeting other than that one is left alone.
   */
  const takePrepared = (prepared: Prepared, about?: ThingSubject | null): boolean => {
    if (about && !about.key.startsWith('range:') && about.key !== 'event:' + prepared.event.id) return false;
    const item = seen.current.get(prepared.event.id);
    if (!item?.event || !movable(item.event)) return false;
    if (prepared.kind === 'calendar.cancel') {
      if (move.moving) move.close();
      setActing({ item, mode: 'cancel' });
      announce(`Frågan om att ställa in ${item.title} är öppen. Inget är inställt förrän du svarar ja.`);
      return true;
    }
    if (mobile) return false;
    move.start(item);
    move.setSpan({ start: prepared.start, end: prepared.end });
    announce(
      `${whenOf({ ...item, start: prepared.start, end: prepared.end })} står i formuläret Flytta ${item.title}. Inget är sparat förrän du trycker på Spara.`,
    );
    const day = displayDate(prepared.start);
    if (about && !about.key.startsWith('range:') && !inView(day)) go({ date: day });
    return true;
  };
  /** An answer in the box: what it prepared for the meeting the box is about is made ready (`takePrepared`). */
  const takeAnswer = (prepared: Prepared | undefined) => {
    if (prepared && askSubject) takePrepared(prepared, askSubject);
  };
  /**
   * Under an earlier answer in the pane, what it prepared is never made by itself (a reload never greets the person
   * with a form or a question they did not ask for): the row under it has the button that makes it ready.
   */
  const preparedAction = (prepared: Prepared) => {
    const item = seen.current.get(prepared.event.id);
    if (!item?.event || !movable(item.event) || (prepared.kind === 'calendar.move' && mobile)) return null;
    return {
      label: prepared.kind === 'calendar.move' ? 'Använd tiden' : 'Ställ in mötet …',
      onPress: () => void takePrepared(prepared, askSubject),
    };
  };
  // "Visa i kalendern" under an answer in a conversation brings the prepared decision in the router's state, never in
  // the address: once the meeting is read it is made ready, and the state is cleared, so Back or a reload never does it
  // again. A move's week replaces the meeting's own in the history.
  const handed = (routed as { prepared?: Prepared } | null)?.prepared;
  const tookHanded = useRef<Prepared | null>(null);
  useEffect(() => {
    if (!handed || tookHanded.current === handed || pending) return;
    tookHanded.current = handed;
    const q = new URLSearchParams(search);
    if (entryItem?.id === handed.event.id && takePrepared(handed) && handed.kind === 'calendar.move') {
      const day = displayDate(handed.start);
      if (!inView(day)) {
        q.delete('week');
        q.set('date', day);
      }
    }
    const rest = q.toString();
    navigate(rest ? `${pathname}?${rest}` : pathname, { replace: true, state: null });
  });
  /**
   * An entry as the pane draws it (D112 item 9). On a phone, which has no box, "Fråga assistenten" ends its buttons and
   * leads to a conversation about it (D126 rule 5).
   */
  const entryShown = (item: AgendaItem): Shown | null => {
    const askButton = mobile ? entrySubject(item) : null;
    if (item.proposal) {
      const p = item.proposal;
      const own = thread?.id === p.threadId ? thread : null;
      return {
        id: item.id,
        source: `${mark?.source ?? calendarName}\u00a0· Förslag`,
        mark: mark ?? calendarMark,
        title: item.title,
        // The name is the way in (2026-11-13): the proposal's work item as a page, with Kalender as the way back.
        page: itemPageHref(p.threadId, pathname + search),
        under: (
          <>
            <Text weight="semibold">{whenOf(item)}</Text>
            <ProposalActions item={item} thread={own} askButton={askButton} onMove={() => act(item, 'move')} />
          </>
        ),
        body: <ProposalFacts item={item} thread={own} />,
        form: false,
      };
    }
    if (!item.event) return null;
    return {
      id: item.id,
      source: `${calendarName}\u00a0· ${item.kind === 'booked' ? 'Bokat samtal' : 'Möte'}`,
      mark: calendarMark,
      title: item.title,
      under: (
        <>
          <Text weight="semibold">{whenOf(item)}</Text>
          <EventActions item={item} askButton={askButton} onAct={mode => act(item, mode)} />
        </>
      ),
      body: <EventFacts item={item} />,
      form: false,
    };
  };
  // A form's foot: why its button is greyed or what went wrong, then its buttons, which never scroll away.
  const foot = (said: ReactNode, buttons: ReactNode) => (
    <HStack gap={3} vAlign="center" wrap="wrap">
      <StackItem size="fill">{said}</StackItem>
      <HStack gap={2} vAlign="center">
        {buttons}
      </HStack>
    </HStack>
  );
  const alert = (text: string) => (
    <Text as="p" role="alert" color="accent">
      {text}
    </Text>
  );
  const paneFocus = useRef<HTMLElement>(null);
  /**
   * The conversation about what the pane holds, and the box (the product owner, 2026-11-18; boards KalFraga,
   * KalFragaFlytt and the head and box of KalFragaVecka): the entry's facts or the form's fields at the top of the body,
   * a rule, then the whole conversation over the box (`AskTalk`); a form's buttons stay at the foot, under the box. The
   * box keeps its place in the tree from the entry to its move form and back, so the focus and the words in it stay. Esc
   * and ✕ are the pane's as they were: Esc in the move form goes back to the entry, with the conversation.
   */
  const withAsk = (s: Shown | null): Shown | null => {
    if (!s || !ask.subject || s.id === 'booking') return s;
    const placeholder =
      s.id === RANGE_ID
        ? `Fråga om ${rangeWord}`
        : paneItem?.proposal
          ? 'Fråga om förslaget'
          : s.id.startsWith('move:')
            ? 'Be om en annan tid'
            : paneItem?.event && movable(paneItem.event)
              ? 'Fråga om mötet, eller be om en ändring'
              : 'Fråga om mötet';
    const under = (m: ThreadMessage) =>
      m.meta?.prepared ? <PreparedRow prepared={m.meta.prepared} action={preparedAction(m.meta.prepared)} /> : null;
    return {
      ...s,
      talk: true,
      body: (
        <VStack gap={6} height="100%">
          {s.body && (
            <>
              {s.body}
              <Divider />
            </>
          )}
          <StackItem size="fill">
            <AskTalk ask={ask} placeholder={placeholder} under={under} />
          </StackItem>
        </VStack>
      ),
    };
  };
  /**
   * What the pane holds: the move being made, else "Fråga om veckan", else the entry in the address, else the booking
   * being made. The range comes before the entry, since the entry it replaced leaves the address a moment after.
   */
  const shown: Shown | null = withAsk(
    movingId && move.item
      ? {
          id: 'move:' + movingId,
          source: `${calendarName}\u00a0· ${move.item.proposal ? 'Förslag' : 'Möte'}`,
          mark: calendarMark,
          title: `Flytta ${move.item.title}`,
          body: <MoveFields move={move} dayRef={paneFocus as Ref<HTMLInputElement>} />,
          foot: foot(move.error ? alert(move.error) : null, <MoveButtons move={move} />),
          form: true,
        }
      : rangeAsk && ask.subject
        ? {
            // Board KalFragaVecka, its head and box: the calendar's mark and name, the range as the title, ✕; the
            // exchange once something is asked; the box with the focus in it.
            id: RANGE_ID,
            source: calendarName,
            mark: calendarMark,
            title: shortTitle,
            body: null,
            form: true,
          }
        : entryItem
          ? entryShown(entryItem)
          : !mobile && booking.draft
            ? {
                id: 'booking',
                source: calendarName,
                mark: calendarMark,
                title: 'Ny bokning',
                under: (
                  <Text type="supporting" color="secondary">
                    I din kalender, med inbjudan till dem du väljer.
                  </Text>
                ),
                body: <BookingFields booking={booking} titleRef={paneFocus as Ref<HTMLInputElement>} />,
                foot: foot(
                  booking.error && !booking.error.uncertain ? (
                    alert(booking.error.text)
                  ) : (
                    <BookingHint booking={booking} />
                  ),
                  <BookingButtons booking={booking} />,
                ),
                form: true,
              }
            : null,
  );
  /** The entry leaves the address, everything else in it stays. */
  const closeEntry = () => {
    const q = new URLSearchParams(search);
    if (!q.has(ENTRY_PARAM)) return;
    q.delete(ENTRY_PARAM);
    const rest = q.toString();
    navigate(rest ? `${pathname}?${rest}` : pathname);
  };
  /**
   * ✕ and Esc let go of what the pane holds: a move goes back to its entry (or to the range that prepared it), "Fråga om
   * veckan" closes and a booking being made under it comes back, a booking is dropped, an entry leaves the address.
   */
  const closePane = () => {
    if (!shown) return;
    if (shown.id.startsWith('move:')) move.close();
    else if (shown.id === RANGE_ID) setRangeOpen(false);
    else if (shown.id === 'booking') booking.close();
    else closeEntry();
  };
  /**
   * A booking is started, or the one being made is put at another time: by the button, by a click on an hour or by a
   * span dragged. It takes the pane, so an entry standing there leaves the address and a move is let go of.
   */
  const startBooking = (at: { start: string; end: string } | null) => {
    // What the person was on when they asked for the form is where the focus goes back to: taken here, since the
    // form's first field has the focus before the pane's own effect could look.
    const active = document.activeElement;
    if (!shown && active instanceof HTMLElement && active !== document.body) opener.current = active;
    if (move.moving) move.close();
    setRangeOpen(false);
    if (!booking.draft) booking.start(at ?? nextWholeHour(new Date()));
    else if (at) booking.setSpan(at);
    closeEntry();
  };
  /**
   * "Fråga om veckan" (the product owner, 2026-11-18, board KalFragaVecka): the pane holds the box alone, with the focus
   * in it, the way a booking takes the pane: an entry standing there leaves the address and a move is let go of; a
   * booking being made is kept and comes back when the box is closed. What the person was on is the way back, taken here
   * as `startBooking` takes it.
   */
  const openRangeAsk = () => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body && !paneRegion.current?.contains(active))
      opener.current = active;
    if (move.moving) move.close();
    setRangeOpen(true);
    ask.focusBox();
    closeEntry();
  };
  /** An entry chosen on the grid: the block of the booking being made leads back to its form, any other entry opens. */
  const openItem = (item: AgendaItem) => {
    if (move.moving && item.id !== movingId) move.close();
    if (item.id === CHOSEN_ID) return closeEntry();
    if (item.id !== entryId) navigate(withEntry(pathname, search, item.id));
  };
  /** Where the block being placed was dragged or stretched to: the form's fields follow. A booking has one day. */
  const placeDraft = (start: string, end: string) => {
    if (displayDate(start) !== displayDate(end)) return false;
    (movingId ? move : booking).setSpan({ start, end });
    return true;
  };
  // Beside the grid the pane is the page's own, non-modal (the grid stays in use): opening it gives the focus to an
  // entry's name or a form's first field, never away from a field the person is typing in, and closing it gives the
  // focus back to what opened it, the entry in the grid or the button (2.4.3). Another thing taking its place keeps the
  // first opener as the way back unless the person opened it from outside the pane. The drawer does all of this itself
  // (Astryx's Drawer).
  const paneRegion = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const shownId = useRef<string | null>(null);
  const besideId = beside && shown ? shown.id : null;
  useLayoutEffect(() => {
    const was = shownId.current;
    shownId.current = besideId;
    if (besideId === null) {
      const back = opener.current;
      opener.current = null;
      if (was !== null) (back?.isConnected ? back : document.getElementById(TITLE_ID))?.focus();
      return;
    }
    if (was === besideId) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body && !paneRegion.current?.contains(active))
      opener.current = active;
    if (!(active instanceof HTMLElement && active.matches(TYPING))) paneFocus.current?.focus();
  }, [besideId]);
  // The drawer keeps the last thing while it slides away, so its heading is never empty (axe: empty-heading).
  const lastShown = useRef<Shown | null>(null);
  if (shown) lastShown.current = shown;
  const drawn = shown ?? lastShown.current;
  const pane =
    beside && shown ? (
      <LayoutPanel width={PANE} padding={0} hasDivider isScrollable={false} role="complementary" label={shown.title}>
        <VStack
          ref={paneRegion}
          height="100%"
          onKeyDown={e => {
            // Esc inside a menu, a list or a dialog is theirs; a bare Esc lets go of what the pane holds.
            if (e.key !== 'Escape' || (e.target as HTMLElement).closest(OWNS_ESCAPE)) return;
            e.stopPropagation();
            closePane();
          }}
        >
          <PaneFrame shown={shown} headingRef={paneFocus as Ref<HTMLHeadingElement>} onClose={closePane} />
        </VStack>
      </LayoutPanel>
    ) : undefined;
  const drawer = beside ? null : (
    <Drawer
      isOpen={!!shown}
      onOpenChange={open => {
        if (!open) closePane();
      }}
      side="end"
      width={PANE}
      label={drawn?.title ?? 'Kalender'}
      padding={0}
    >
      {drawn && <PaneFrame shown={drawn} headingRef={paneFocus as Ref<HTMLHeadingElement>} onClose={closePane} />}
    </Drawer>
  );
  const steps = (
    <HStack gap={1} vAlign="center" role="group" aria-label={`Byt ${stepLabel}`}>
      <IconButton
        label={view === 'day' ? 'Förra dagen' : view === 'month' ? 'Förra månaden' : 'Förra veckan'}
        icon={<Icon icon="chevronLeft" />}
        variant="ghost"
        size="sm"
        onClick={() => step(-1)}
      />
      <Button variant="ghost" size="sm" label="I dag" onClick={() => go({ date: today() })} />
      <IconButton
        label={`Nästa ${stepLabel}`}
        icon={<Icon icon="chevronRight" />}
        variant="ghost"
        size="sm"
        onClick={() => step(1)}
      />
      <DatePicker size="sm" value={anchor} onChange={d => go({ date: d })} />
    </HStack>
  );
  /**
   * "Förslag N" (D112 item 9): the proposals that wait for the person, each a link to its week with it open in the
   * panel. Nothing waits, no button.
   */
  const proposalsMenu = proposed.length > 0 && (
    <DropdownMenu
      button={{
        // The count is drawn as the board draws it, a badge after the word (Astryx's `endContent`), and the name is read
        // from what is drawn, the word and the badge, so the visible label is the start of the name (2.5.3).
        label: 'Förslag',
        size: 'sm',
        variant: 'secondary',
        endContent: <Badge variant="neutral" label={String(proposed.length)} />,
      }}
      menuWidth={280}
      items={proposed.map(p => {
        const at = new URLSearchParams(search);
        at.set('date', displayDate(p.start));
        at.set('view', view === 'month' ? 'week' : view);
        return {
          id: p.id,
          label: `${p.participant.name}`,
          description: `${capital(shortDayLabel(displayDate(p.start)))} ${timeRange(p.start, p.end)}`,
          href: withEntry(pathname, at, p.id),
        };
      })}
    />
  );
  // In the pane on a wide screen and in the drawer; a phone's head has no room for it (see the head below).
  const askWeek = (
    <AskClew
      subject={rangeSubject}
      onAsk={mobile ? undefined : openRangeAsk}
      label={`Fråga om ${rangeWord}`}
      size="sm"
    />
  );
  const bookButton = <Button variant="primary" size="sm" label="Ny bokning" onClick={() => startBooking(null)} />;
  // The one page header (D74): the title first, what can be done at the end of its line. A phone has two rows: the
  // title with what can be done, and under it where in time with how it is shown, 44 px controls under a finger. The
  // controls are Astryx's `sm`, as the toolbar that held them made them (28 px, under the heading's 32 px line). Both
  // rows are full at 375 px, so "Fråga om veckan" is not on a phone's head (it would make a third row and push the week
  // down); an entry opened on a phone still has "Fråga assistenten" among its buttons in the drawer.
  // In the one page frame (D126): the title on the line every page's title stands on. Where in time stands beside the
  // title it changes (board "Förslag: veckan fyller arket"); how it is shown and what can be done at the line's end.
  const head = mobile
    ? {
        title: shortTitle,
        actions: (
          <HStack gap={2} vAlign="center" wrap="wrap">
            {proposalsMenu}
            {bookButton}
          </HStack>
        ),
        status: undefined,
        meta: (
          <VStack gap={2}>
            <HStack justify="between" vAlign="center" gap={2} wrap="wrap">
              {steps}
              {/* Three labels do not fit 320 px with text spacing (1.4.12), so a phone gets an adaptive menu, as the piles do (D31 §5). */}
              <DropdownMenu
                presentation="adaptive"
                button={{ label: `Vy: ${viewLabels[view]}`, size: 'sm', variant: 'secondary' }}
                items={views.map(v => ({ id: v, label: viewLabels[v], onClick: () => go({ view: v }) }))}
              />
            </HStack>
            {silentHead}
          </VStack>
        ),
      }
    : {
        title: capital(title),
        status: steps,
        actions: (
          <HStack gap={3} vAlign="center" wrap="wrap">
            <SegmentedControl label="Vy" size="sm" value={view} onChange={v => go({ view: v as View })}>
              <SegmentedControlItem value="day" label="Dag" />
              <SegmentedControlItem value="week" label="Vecka" />
              <SegmentedControlItem value="month" label="Månad" />
            </SegmentedControl>
            <HStack gap={2} vAlign="center" wrap="wrap">
              {askWeek}
              {proposalsMenu}
              {bookButton}
            </HStack>
          </HStack>
        ),
        meta: silentHead,
      };
  // A person with no calendar (D116, amended 2026-11-12): the page says so and who connects one, and draws no grid or
  // controls that would only fail.
  if (withoutCalendar)
    return (
      <Shell user={user} nav={nav}>
        <PageFrame title="Kalender" titleId={TITLE_ID}>
          <EmptyState
            headingLevel={2}
            icon={<Icon icon="calendar" size="lg" />}
            title="Ingen kalender är kopplad till dig"
            description={
              calendarHidden
                ? 'En administratör kopplar kalendern under Anslutna system.'
                : 'En administratör kopplar ditt kalenderkonto.'
            }
          />
        </PageFrame>
      </Shell>
    );
  // The grid fills the sheet wherever the page is pinned (a wide window that is not short); on a phone and on a short
  // screen the page scrolls as one and the grid is as tall as its day (1.4.10).
  const fill = !mobile && !short;
  const draftId = movingId ?? (draftSpan && draftTitle ? CHOSEN_ID : undefined);
  const grid = (
    <EventCalendar
      view={calendarView}
      date={anchor}
      items={items}
      label={capital(title)}
      dayHeadingLevel={2}
      accessiblePath={
        proposed.length
          ? 'Förslag i sidhuvudet leder till varje förslag; Retur på en post öppnar den.'
          : 'Retur på en post öppnar den.'
      }
      fill={fill}
      weekends
      selectedId={movingId ?? entryId ?? (shown?.id === 'booking' ? CHOSEN_ID : undefined)}
      {...(draftId ? { draftId, onDraftChange: placeDraft } : {})}
      onItemClick={openItem}
      onMoveProposal={proposed.length ? moveProposal : undefined}
      onSelectRange={mobile ? undefined : (start, end) => startBooking({ start, end })}
    />
  );
  // Nothing read while the calendar does not answer: no empty grid that would pass for a free week.
  const unread = calendarSilent && !read && (
    <EmptyState
      headingLevel={2}
      icon={<Icon icon="calendar" size="lg" />}
      title="Kalendern kan inte visas just nu"
      description="Mötena visas här när kalendern svarar igen."
    />
  );
  const skeleton = <ContentSkeleton label="Hämtar kalendern …" rows={7} heading={false} />;
  const moveAlert = error && (
    <Text as="p" role="alert" color="accent">
      {error}
    </Text>
  );
  return (
    <Shell user={user} nav={nav}>
      <PageFrame
        title={head.title}
        titleId={TITLE_ID}
        status={head.status}
        meta={head.meta}
        actions={head.actions}
        actionsOnLine
        bleed={fill}
        label="Kalender"
        end={pane}
      >
        {fill ? (
          // The grid is the sheet's own content: what stands in its place, or over it, keeps the page's inset.
          <>
            {moveAlert && (
              <VStack padding={4} paddingInline={6}>
                {moveAlert}
              </VStack>
            )}
            {unread || pending ? (
              <VStack padding={6} aria-busy={pending}>
                {unread || skeleton}
              </VStack>
            ) : (
              grid
            )}
          </>
        ) : (
          <VStack gap={4}>
            {moveAlert}
            {unread || (
              <AsyncContent pending={pending} fallback={skeleton}>
                {grid}
              </AsyncContent>
            )}
          </VStack>
        )}
      </PageFrame>
      {drawer}
      {/* Both dialogs write the cache themselves (D33): a moved proposal's thread, or the loaded weeks read again. */}
      <EventDialog
        item={acting?.item ?? null}
        dayItems={dayItems}
        startIn={acting?.mode ?? 'view'}
        onClose={() => setActing(null)}
        onOpenDay={d => go({ date: d, view: 'day' })}
      />
      {/* A phone has no pane for the form: there it is the dialog it was, and the dialog is mounted there alone. */}
      {mobile && <BookingDialog booking={booking} isOpen={!!booking.draft} />}
    </Shell>
  );
}
