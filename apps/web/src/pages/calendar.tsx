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
import type { CalendarEvent, Proposal, SessionUser, Thread } from '@clew/contracts';
import {
  Badge,
  Button,
  DatePicker,
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
import { PageFrame } from '../components/page-frame';
import { AsyncContent, ContentSkeleton } from '../components/loading';
import { AskClew } from '../components/thing-panel';
import type { ThingSubject } from '../components/conversation-context';
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
/** When an entry is, as the panel says it: "Torsdag 19 november 13:15–14:00", or the day and "hela dagen". */
const whenOf = (item: AgendaItem) =>
  item.allDay
    ? `${capital(dayLabel(displayDate(item.start)))}, hela dagen`
    : `${capital(dayLabel(displayDate(item.start)))} ${timeRange(item.start, item.end)}`;
const proposalStatus: Partial<Record<Proposal['status'], string>> = {
  proposed: 'Förslag, inte bokat',
  confirmed: 'Inbjudan skickad',
  final: 'Bokat',
  accepted: 'Medarbetaren har tackat ja',
  'declined-by-invitee': 'Medarbetaren har tackat nej',
};

/**
 * A meeting's buttons (D112 item 9, board Calendar, the `invited` state): what the calendar lets the person do, move or
 * cancel their own booking (the dialog that was the entry's, opened at that step, so the keyboard path is the same as
 * before), and "Fråga Clew". A meeting someone else organises has no buttons of the organiser's, and the calendar
 * offers no reply of the person's own, so it has none.
 */
function EventActions({
  item,
  subject,
  onAct,
}: {
  item: AgendaItem;
  subject: ThingSubject | null;
  onAct: (mode: Exclude<Mode, 'view'>) => void;
}) {
  const event = item.event!;
  const own = event.mine && event.canCancel && !event.recurring && !event.allDay;
  return (
    <HStack gap={2} wrap="wrap" vAlign="center">
      {own && <Button size="sm" variant="secondary" label="Flytta …" onClick={() => onAct('move')} />}
      {own && <Button size="sm" variant="ghost" label="Ställ in …" onClick={() => onAct('cancel')} />}
      {subject && <AskClew subject={subject} size="sm" />}
    </HStack>
  );
}
/** A meeting's facts: that the person is invited to one they do not organise, when, where and with whom. */
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
        <MetadataListItem label="När">
          <Text weight="semibold">{whenOf(item)}</Text>
        </MetadataListItem>
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
            <Text>{event.participants.join(', ')}</Text>
          </MetadataListItem>
        )}
      </MetadataList>
    </VStack>
  );
}

/**
 * A proposal's buttons (D112 item 9, board Calendar, the `thing` state): the proposal's existing decisions, through the
 * same use cases as before (`modules/calendar/usecases/decisions.ts`): send the invitation for this time, move it (the
 * dialog, never drag alone), draw the proposals again in the next week, and undo while the calendar allows it; then
 * "Fråga Clew". A decision that fails says so above the buttons.
 */
function ProposalActions({
  item,
  thread,
  subject,
  onMove,
}: {
  item: AgendaItem;
  thread: Thread | null;
  subject: ThingSubject | null;
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
        {subject && <AskClew subject={subject} size="sm" />}
      </HStack>
    </VStack>
  );
}
/** A proposal's facts: that it is a proposal and not booked, when the round must be done, when it is and with whom. */
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
        <MetadataListItem label="När">
          <Text weight="semibold">{whenOf(item)}</Text>
        </MetadataListItem>
        <MetadataListItem label="Med">
          <Text>{p.participant.name}</Text>
        </MetadataListItem>
      </MetadataList>
      {thread?.summary && <Text as="p">{thread.summary}</Text>}
    </VStack>
  );
}

/** An entry as the calendar's pane draws it: its name, its line, its page where it has one, its buttons and its facts. */
interface Opened {
  id: string;
  title: string;
  subtitle: string;
  /** The entry's own page (a proposal's work item): its name in the pane's header is the link there. */
  page?: string;
  actions: ReactNode;
  facts: ReactNode;
}
/**
 * The pane's content, beside the grid and in the drawer alike: the name (a link to the entry's page where it has one,
 * the name being the way in) with its line and ✕, the buttons directly under the name where they never scroll away
 * (D126 rule 2's pane), and the facts under them. The heading takes the focus when the pane opens, from a script only.
 */
function EntryPane({
  opened,
  headingRef,
  onClose,
}: {
  opened: Opened;
  headingRef: Ref<HTMLHeadingElement>;
  onClose: () => void;
}) {
  return (
    <Layout
      height="fill"
      padding={6}
      header={
        <LayoutHeader hasDivider>
          <VStack gap={4}>
            <HStack justify="between" vAlign="start" gap={2}>
              <StackItem size="fill">
                <VStack gap={0}>
                  <Heading ref={headingRef} tabIndex={-1} data-autofocus="" level={2}>
                    {opened.page ? (
                      <Link href={opened.page} hasUnderline>
                        {opened.title}
                      </Link>
                    ) : (
                      opened.title
                    )}
                  </Heading>
                  <Text type="supporting" color="secondary">
                    {opened.subtitle}
                  </Text>
                </VStack>
              </StackItem>
              <IconButton size="sm" variant="ghost" label="Stäng" icon={<Icon icon="close" />} onClick={onClose} />
            </HStack>
            {opened.actions}
          </VStack>
        </LayoutHeader>
      }
      content={<LayoutContent>{opened.facts}</LayoutContent>}
    />
  );
}
/**
 * The window width from which the entry's pane stands beside the grid: the rail, the week's least column and the pane,
 * 260 + 640 + 440 px, the line the shared panel kept before D126. Narrower, short (1.4.10) or on a phone it is a drawer.
 */
const PANE = 440;
const besideQuery = `(min-width: ${260 + 640 + PANE}px)`;
/** What a key pressed in the pane belongs to rather than the pane: a menu, a list box or a dialog over it. */
const OWNS_ESCAPE = '[role="menu"], [role="listbox"], [role="dialog"], dialog';
const TYPING = 'input, textarea, [contenteditable="true"], [role="textbox"], [role="combobox"]';
/** The page's title, where the focus goes when the pane closes and what opened it has left the grid. */
const TITLE_ID = 'calendar-title';

/**
 * The calendar as a page (D27, D32, D112 item 9, board Calendar): one day, one week or one month on FullCalendar under
 * Clew's theme, inside the one shell; it keeps its own page type (D126, D27), and `EventCalendar` is not redesigned. An
 * event or a proposal chosen in the grid opens in the page's own pane in the end slot (`entry` in the address, so Back,
 * a reload and Esc keep working): its buttons under its name and its facts under them, a proposal's name the link to
 * its work item. Below the width where the pane fits beside the week, on a short screen and on a phone, the same pane is
 * a drawer over the grid. Nothing else opens beside the calendar (D126 rule 3), and the pane has no box: "Fråga Clew"
 * and "Fråga om veckan" lead to a conversation with the entry or the range beside it (rule 5). The proposals are reached
 * from "Förslag N" in the page's header, a menu that leads to each one. A booking of one's own and a moved or cancelled
 * entry go through dialogs, so every action has a keyboard path; drag is a convenience for proposals alone.
 */
export function CalendarPage({ user, admin = false }: { user: SessionUser; admin?: boolean }) {
  const mobile = useMediaQuery(mobileQuery);
  // 1.4.10: on a short screen nothing is pinned beside the page; the pane is the drawer over it.
  const short = useMediaQuery(shortQuery);
  const beside = useMediaQuery(besideQuery) && !short;
  const [params, setParams] = useSearchParams();
  const { pathname, search } = useLocation();
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
  // The entry's own dialog, opened from its buttons in the pane at the step they name.
  const [acting, setActing] = useState<{ item: AgendaItem; mode: Exclude<Mode, 'view'> } | null>(null);
  const [booking, setBooking] = useState<{ start: string; end: string } | null>(null);
  const title =
    view === 'day'
      ? dayLabel(anchor)
      : view === 'month'
        ? monthLabel(anchor)
        : `Vecka ${weekNumber(anchor)}\u00a0· ${rangeLabel(anchor, 5)}`;
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
        ? `Vecka ${weekNumber(anchor)}, ${rangeLabel(anchor, 5)}`
        : `${view === 'day' ? 'Dagvy' : 'Månadsvy'}, ${title}`,
  );
  const items = useMemo(() => agendaItems(events, proposals), [events, proposals]);
  // The entry the pane holds (`entry`): looked up among the loaded weeks, and kept while another week is on screen.
  const entryId = params.get(ENTRY_PARAM);
  const seen = useRef(new Map<string, AgendaItem>());
  for (const i of items) seen.current.set(i.id, i);
  const entryItem = entryId ? (items.find(i => i.id === entryId) ?? seen.current.get(entryId) ?? null) : null;
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

  /** An entry as the pane draws it (D112 item 9), and what "Fråga Clew" asks about it with (D126 rule 5). */
  const entryOpened = (item: AgendaItem): Opened | null => {
    if (item.proposal) {
      const p = item.proposal;
      const own = thread?.id === p.threadId ? thread : null;
      // The conversation about a proposal has its work item beside it, where several are chosen at once.
      const subject: ThingSubject | null = CHIP_REF.test('proposal:' + p.id)
        ? {
            key: 'proposal:' + p.id,
            label: 'förslaget',
            chips: [{ ref: 'proposal:' + p.id, kind: 'proposal', label: `${item.title}\u00a0· ${p.participant.name}` }],
            search: '?card=' + encodeURIComponent(p.threadId),
          }
        : null;
      return {
        id: item.id,
        title: item.title,
        subtitle: `Förslag\u00a0· ${mark?.source ?? 'Kalendern'}`,
        // The name is the way in (2026-11-13): the proposal's work item as a page, with Kalender as the way back.
        page: itemPageHref(p.threadId, pathname + search),
        actions: (
          <ProposalActions
            item={item}
            thread={own}
            subject={subject}
            onMove={() => setActing({ item, mode: 'move' })}
          />
        ),
        facts: <ProposalFacts item={item} thread={own} />,
      };
    }
    if (!item.event) return null;
    const ref = 'event:' + item.event.id;
    // A meeting outside the window the server resolves its chip in has nothing to ask with: no "Fråga Clew" (D126 rule 5).
    const subject: ThingSubject | null =
      CHIP_REF.test(ref) && inChipWindow(item.start)
        ? { key: ref, label: 'mötet', chips: [{ ref, kind: 'event', label: item.title }], search: '' }
        : null;
    return {
      id: item.id,
      title: item.title,
      subtitle: `${item.kind === 'booked' ? 'Bokat samtal' : 'Möte'}\u00a0· Kalendern`,
      actions: <EventActions item={item} subject={subject} onAct={mode => setActing({ item, mode })} />,
      facts: <EventFacts item={item} />,
    };
  };
  const opened = entryItem ? entryOpened(entryItem) : null;
  /** The pane closes: the entry leaves the address, everything else in it stays. */
  const closeEntry = () => {
    const q = new URLSearchParams(search);
    q.delete(ENTRY_PARAM);
    const rest = q.toString();
    navigate(rest ? `${pathname}?${rest}` : pathname);
  };
  // Beside the grid the pane is the page's own, non-modal (the grid stays in use): opening it gives its heading the
  // focus, never away from a field the person is typing in, and closing it gives the focus back to what opened it, the
  // entry in the grid (2.4.3). Another entry taking its place keeps the first opener as the way back unless the person
  // opened it from outside the pane. The drawer does all of this itself (Astryx's Drawer).
  const paneHeading = useRef<HTMLHeadingElement>(null);
  const paneRegion = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const shownId = useRef<string | null>(null);
  const besideId = beside && opened ? opened.id : null;
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
    if (!(active instanceof HTMLElement && active.matches(TYPING))) paneHeading.current?.focus();
  }, [besideId]);
  // The drawer keeps the last entry while it slides away, so its heading is never empty (axe: empty-heading).
  const lastOpened = useRef<Opened | null>(null);
  if (opened) lastOpened.current = opened;
  const drawn = opened ?? lastOpened.current;
  const pane =
    beside && opened ? (
      <LayoutPanel width={PANE} padding={0} hasDivider isScrollable={false} role="complementary" label={opened.title}>
        <VStack
          ref={paneRegion}
          height="100%"
          onKeyDown={e => {
            // Esc inside a menu, a list or a dialog is theirs; a bare Esc lets go of the pane.
            if (e.key !== 'Escape' || (e.target as HTMLElement).closest(OWNS_ESCAPE)) return;
            e.stopPropagation();
            closeEntry();
          }}
        >
          <EntryPane opened={opened} headingRef={paneHeading} onClose={closeEntry} />
        </VStack>
      </LayoutPanel>
    ) : undefined;
  const drawer = beside ? null : (
    <Drawer
      isOpen={!!opened}
      onOpenChange={open => {
        if (!open) closeEntry();
      }}
      side="end"
      width={PANE}
      label={drawn?.title ?? 'Kalender'}
      padding={0}
    >
      {drawn && <EntryPane opened={drawn} headingRef={paneHeading} onClose={closeEntry} />}
    </Drawer>
  );

  /**
   * "Fråga om veckan" (board Calendar, the `week` state): the range on screen is what the conversation is about, with the
   * calendar's own read of that range as its chip and beside the conversation (D126 rule 5).
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
  const askWeek = <AskClew subject={rangeSubject} label={`Fråga om ${rangeWord}`} size="sm" />;
  const bookButton = (
    <Button variant="primary" size="sm" label="Ny bokning" onClick={() => setBooking(nextWholeHour(new Date()))} />
  );
  // The one page header (D74): the title first, what can be done at the end of its line. A phone has two rows: the
  // title with what can be done, and under it where in time with how it is shown, 44 px controls under a finger. The
  // controls are Astryx's `sm`, as the toolbar that held them made them (28 px, under the heading's 32 px line). Both
  // rows are full at 375 px, so "Fråga om veckan" is not on a phone's head (it would make a third row and push the week
  // down); an entry opened on a phone still has "Fråga Clew" among its buttons in the drawer.
  // In the one page frame (D126): the title on the line every page's title stands on, the controls at its end.
  const head = mobile
    ? {
        title: shortTitle,
        actions: (
          <HStack gap={2} vAlign="center" wrap="wrap">
            {proposalsMenu}
            {bookButton}
          </HStack>
        ),
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
        actions: (
          <HStack gap={3} vAlign="center" wrap="wrap">
            {steps}
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
  return (
    <Shell user={user} nav={nav}>
      <PageFrame
        title={head.title}
        titleId={TITLE_ID}
        meta={head.meta}
        actions={head.actions}
        actionsOnLine
        end={pane}
      >
        <VStack gap={4}>
          {error && (
            <Text as="p" role="alert" color="accent">
              {error}
            </Text>
          )}
          {/* Nothing read while the calendar does not answer: no empty grid that would pass for a free week. */}
          {calendarSilent && !read ? (
            <EmptyState
              headingLevel={2}
              icon={<Icon icon="calendar" size="lg" />}
              title="Kalendern kan inte visas just nu"
              description="Mötena visas här när kalendern svarar igen."
            />
          ) : (
            <AsyncContent
              pending={pending}
              fallback={<ContentSkeleton label="Hämtar kalendern …" rows={7} heading={false} />}
            >
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
                selectedId={entryId ?? undefined}
                onItemClick={item => navigate(withEntry(pathname, search, item.id))}
                onMoveProposal={proposed.length ? moveProposal : undefined}
                onSelectRange={mobile ? undefined : (start, end) => setBooking({ start, end })}
              />
            </AsyncContent>
          )}
        </VStack>
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
      <BookingDialog
        isOpen={!!booking}
        initial={booking ?? nextWholeHour(new Date())}
        onClose={() => setBooking(null)}
      />
    </Shell>
  );
}
