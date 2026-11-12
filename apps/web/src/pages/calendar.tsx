import { useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { keepPreviousData, useQueries, useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { CalendarEvent, Proposal, SessionUser, Thread } from '@clew/contracts';
import {
  Badge,
  Button,
  DatePicker,
  DropdownMenu,
  EventCalendar,
  HStack,
  Icon,
  IconButton,
  Layout,
  LayoutContent,
  LayoutHeader,
  MetadataList,
  MetadataListItem,
  SegmentedControl,
  SegmentedControlItem,
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
import { calendarWeekQuery, threadsQuery } from '../queries';
import { pickProposalThread } from '../thread-cache';
import { useThreadAction } from '../mutations';
import { errorMessage } from '../query-policy';
import { usePageTitle } from '../page-title';
import { useMarks } from '../marks';
import { ENTRY_PARAM, viewSearch, withEntry } from '../panel-address';
import { itemPageHref } from '../work-items';
import { Shell, mobileQuery, shortQuery } from '../components/shell';
import { useRail } from '../components/nav';
import { EventDialog, type Mode } from '../components/calendar/event-dialog';
import { BookingDialog } from '../components/calendar/booking-dialog';
import { PageHeader } from '../components/page-header';
import { AsyncContent, ContentSkeleton } from '../components/loading';
import { usePagePanel, type OwnThing } from '../components/page-panel';
import { AskClew } from '../components/thing-panel';
import { Unfold } from '../components/unfold';
import { useThingHead } from '../components/thing-head';
import type { ChipRef } from '../components/conversation-context';

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
    failed: results.find(r => r.isError && r.data === undefined)?.error,
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
 * A meeting in the panel (D112 item 9, board Calendar, the `invited` state): when it is, and while no conversation runs
 * where and with whom; a meeting the person does not organise says they are invited. The buttons are what the calendar
 * lets the person do: move or cancel their own booking (the dialog that was the entry's, opened at that step, so the
 * keyboard path is the same as before). A meeting someone else organises has no buttons of the organiser's, and the
 * calendar offers no reply of the person's own, so it has none; the box beside it still answers about it.
 */
function EventFacts({
  item,
  folded,
  onAct,
}: {
  item: AgendaItem;
  folded: boolean;
  onAct: (mode: Exclude<Mode, 'view'>) => void;
}) {
  const event = item.event!;
  const own = event.mine && event.canCancel && !event.recurring && !event.allDay;
  // Beside a conversation the essentials and the buttons stand above it, out of its scroll (`useThingHead`).
  const dock = useThingHead();
  const head = (
    <>
      {!event.mine && (
        <HStack gap={2} wrap="wrap">
          <Badge variant="neutral" label="Du är inbjuden" />
        </HStack>
      )}
      <MetadataList columns="single">
        <MetadataListItem label="När">
          <Text weight="semibold">{whenOf(item)}</Text>
        </MetadataListItem>
      </MetadataList>
    </>
  );
  const buttons = own && (
    <HStack gap={2} wrap="wrap">
      <Button variant="secondary" label="Flytta …" onClick={() => onAct('move')} />
      <Button variant="ghost" label="Ställ in …" onClick={() => onAct('cancel')} />
    </HStack>
  );
  return (
    <VStack gap={4}>
      {dock
        ? dock(
            <VStack gap={4}>
              {head}
              {buttons}
            </VStack>,
          )
        : head}
      <Unfold folded={folded}>
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
              <Text>{event.participants.join(', ')}</Text>
            </MetadataListItem>
          )}
        </MetadataList>
      </Unfold>
      {!dock && buttons}
    </VStack>
  );
}

/**
 * A proposal in the panel (D112 item 9, board Calendar, the `thing` and `asking` states): that it is a proposal and not
 * booked, when the round must be done, when it is and with whom. Its buttons are the proposal's existing decisions,
 * through the same use cases as before (`modules/calendar/usecases/decisions.ts`): send the invitation for this time,
 * move it (the dialog, never drag alone), draw the proposals again in the next week, and undo while the calendar allows
 * it. "Öppna som sida" leads to the proposals' work item, where several are chosen at once.
 */
function ProposalFacts({
  item,
  thread,
  folded,
  onMove,
}: {
  item: AgendaItem;
  thread: Thread | null;
  folded: boolean;
  onMove: () => void;
}) {
  const p = item.proposal!;
  const { pathname, search } = useLocation();
  const from = pathname + search;
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
  const deadline = thread?.deadline?.slice(0, 10);
  // Beside a conversation the essentials and the buttons stand above it, out of its scroll (`useThingHead`).
  const dock = useThingHead();
  const head = (
    <>
      <HStack gap={2} wrap="wrap">
        <Badge variant={proposed ? 'info' : 'neutral'} label={proposalStatus[p.status] ?? 'Förslag'} />
        {deadline && <Badge variant="warning" label={`Senast ${shortDayLabel(deadline)}`} />}
      </HStack>
      <MetadataList columns="single">
        <MetadataListItem label="När">
          <Text weight="semibold">{whenOf(item)}</Text>
        </MetadataListItem>
      </MetadataList>
    </>
  );
  const facts = (
    <Unfold folded={folded}>
      <VStack gap={3}>
        <MetadataList columns="single">
          <MetadataListItem label="Med">
            <Text>{p.participant.name}</Text>
          </MetadataListItem>
        </MetadataList>
        {thread?.summary && <Text as="p">{thread.summary}</Text>}
      </VStack>
    </Unfold>
  );
  const buttons = (
    <>
      {error && (
        <Text as="p" role="alert" color="accent">
          {error}
        </Text>
      )}
      <HStack gap={2} wrap="wrap">
        {proposed && open && (
          <Button
            variant="primary"
            label="Skicka inbjudan"
            clickAction={() => run(() => api.confirm(p.threadId, [p.id]))}
          />
        )}
        {proposed && <Button variant="secondary" label="Flytta …" onClick={onMove} />}
        {proposed && open && thread?.week && (
          <Button
            variant="ghost"
            label="Föreslå andra tider"
            clickAction={() => run(() => api.replan(p.threadId, addDays(thread.week!, 7)))}
          />
        )}
        {undoOpen && <Button variant="destructive" label="Ångra" clickAction={() => run(() => api.undo(p.threadId))} />}
        <Button variant="ghost" label="Öppna som sida" href={itemPageHref(p.threadId, from)} />
      </HStack>
    </>
  );
  return dock ? (
    <VStack gap={4}>
      {dock(
        <VStack gap={4}>
          {head}
          {buttons}
        </VStack>,
      )}
      {facts}
    </VStack>
  ) : (
    <VStack gap={4}>
      {head}
      {facts}
      {buttons}
    </VStack>
  );
}

/**
 * The calendar as a page (D27, D32, D112 item 9, board Calendar): one day, one week or one month on FullCalendar under
 * Clew's theme, inside the one shell. `EventCalendar` is not redesigned. An event or a proposal chosen in the grid opens
 * in the panel in the end slot, as any thing does (`entry` in the address): its facts and buttons, the conversation
 * about it and the box. The proposals are reached from "Förslag N" in the page's header, a menu that leads to each one;
 * "Fråga om veckan" makes the range on screen the thing. A booking of one's own and a moved or cancelled entry go
 * through dialogs, so every action has a keyboard path; drag is a convenience for proposals alone.
 */
export function CalendarPage({ user, admin = false }: { user: SessionUser; admin?: boolean }) {
  const mobile = useMediaQuery(mobileQuery);
  // 1.4.10: on a short screen nothing is pinned beside the page; the panel is the drawer over it.
  const short = useMediaQuery(shortQuery);
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
  // The entry's own dialog, opened from its buttons in the panel at the step they name.
  const [acting, setActing] = useState<{ item: AgendaItem; mode: Exclude<Mode, 'view'> } | null>(null);
  const [booking, setBooking] = useState<{ start: string; end: string } | null>(null);
  const title =
    view === 'day'
      ? dayLabel(anchor)
      : view === 'month'
        ? monthLabel(anchor)
        : `Vecka ${weekNumber(anchor)} · ${rangeLabel(anchor, 5)}`;
  const shortTitle = view === 'week' ? `Vecka ${weekNumber(anchor)}` : capital(title);
  usePageTitle(
    `${shortTitle} · Kalender`,
    view === 'week'
      ? `Vecka ${weekNumber(anchor)}, ${rangeLabel(anchor, 5)}`
      : `${view === 'day' ? 'Dagvy' : 'Månadsvy'}, ${title}`,
  );
  /** The weeks the view needs: one for a day or a week, every week the month grid shows. */
  const weeks = useMemo(() => (view === 'month' ? weeksOfMonth(anchor) : [weekStart(anchor)]), [view, anchor]);
  // Each week is one query, shared with the cards on the start page; the previous answer stays on the grid while the next week loads, and answers can no longer land out of order.
  const { events, proposals, failed, pending } = useQueries({
    queries: weeks.map(w => ({ ...calendarWeekQuery(w), placeholderData: keepPreviousData })),
    combine: combineWeeks,
  });
  const readError = failed ? errorMessage(failed, 'Kalendern kunde inte läsas.') : null;
  const error = moveError ?? readError;
  const items = useMemo(() => agendaItems(events, proposals), [events, proposals]);
  // The entry the panel holds (`entry`): looked up among the loaded weeks, and kept while another week is on screen.
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

  /** An entry as the thing in the panel (D112 items 7 and 9): its facts and buttons, and what the box asks about. */
  const entryThing = (item: AgendaItem): OwnThing | null => {
    if (item.proposal) {
      const p = item.proposal;
      const chips: ChipRef[] = CHIP_REF.test('proposal:' + p.id)
        ? [{ ref: 'proposal:' + p.id, kind: 'proposal', label: `${item.title} · ${p.participant.name}` }]
        : [];
      return {
        id: 'entry:' + item.id,
        title: item.title,
        subtitle: `Förslag · ${mark?.source ?? 'Kalendern'}`,
        subject: {
          key: 'proposal:' + p.id,
          label: 'förslaget',
          chips,
          search: '?card=' + encodeURIComponent(p.threadId),
        },
        body: (_inline, folded) => (
          <ProposalFacts
            item={item}
            thread={thread?.id === p.threadId ? thread : null}
            folded={folded}
            onMove={() => setActing({ item, mode: 'move' })}
          />
        ),
      };
    }
    if (!item.event) return null;
    const ref = 'event:' + item.event.id;
    return {
      id: 'entry:' + item.id,
      title: item.title,
      subtitle: `${item.kind === 'booked' ? 'Bokat samtal' : 'Möte'} · Kalendern`,
      subject: {
        key: ref,
        label: 'mötet',
        chips: CHIP_REF.test(ref) && inChipWindow(item.start) ? [{ ref, kind: 'event', label: item.title }] : [],
        search: '',
      },
      body: (_inline, folded) => <EventFacts item={item} folded={folded} onAct={mode => setActing({ item, mode })} />,
    };
  };
  const entry = entryItem ? entryThing(entryItem) : null;

  /**
   * "Fråga om veckan" (board Calendar, the `week` state): the range on screen is the thing. Its facts are what is booked
   * and what waits for the person in it; the box asks about it with the calendar's own read of that range as its chip.
   */
  const inRange = (i: AgendaItem) => {
    const day = displayDate(i.start);
    if (view === 'day') return occursOn(i, anchor);
    if (view === 'week') return day >= anchor && day < addDays(anchor, 7);
    return day.slice(0, 7) === anchor.slice(0, 7);
  };
  const shown = items.filter(inRange);
  const booked = shown.filter(i => i.kind === 'event' || i.kind === 'booked').length;
  const waiting = shown.filter(i => i.kind === 'proposal').length;
  const rangeRead =
    view === 'day'
      ? { capability: 'calendar.day', title: shortTitle, input: { date: anchor } }
      : { capability: 'calendar.week', title: shortTitle, input: { from: weekStart(anchor) } };
  const rangeWord = view === 'day' ? 'dagen' : view === 'month' ? 'månaden' : 'veckan';
  const pageThing: OwnThing = {
    id: `page:calendar:${view}:${anchor}`,
    title: shortTitle,
    subtitle: `Kalendern · ${view === 'week' ? rangeLabel(anchor, 5) : title}`,
    subject: {
      key: `range:${view}:${anchor}`,
      label: rangeWord,
      chips: [{ ref: 'capability:' + rangeRead.capability, kind: 'capability', label: shortTitle }],
      search: viewSearch(rangeRead),
    },
    body: () => (
      <MetadataList columns="single">
        <MetadataListItem label="Bokat">
          <Text>{booked === 1 ? '1 tillfälle' : `${booked} tillfällen`}</Text>
        </MetadataListItem>
        <MetadataListItem label="Förslag">
          <Text>{waiting === 0 ? 'Inga väntar på dig' : `${waiting} väntar på dig`}</Text>
        </MetadataListItem>
      </MetadataList>
    ),
  };
  const slot = usePagePanel({ overlayOnly: short, entry, pageThing });

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
  const askWeek = <AskClew label={`Fråga om ${rangeWord}`} size="sm" />;
  const bookButton = (
    <Button variant="primary" size="sm" label="Ny bokning" onClick={() => setBooking(nextWholeHour(new Date()))} />
  );
  // The one page header (D74): the title first, what can be done at the end of its line. A phone has two rows: the
  // title with what can be done, and under it where in time with how it is shown, 44 px controls under a finger. The
  // controls are Astryx's `sm`, as the toolbar that held them made them (28 px, under the heading's 32 px line). Both
  // rows are full at 375 px, so "Fråga om veckan" is not on a phone's head (it would make a third row and push the week
  // down); an entry opened on a phone still has its box in the sheet.
  const header = mobile ? (
    <VStack as="section" aria-label="Kalender">
      <PageHeader
        title={shortTitle}
        end={
          <HStack gap={2} vAlign="center" wrap="wrap">
            {proposalsMenu}
            {bookButton}
          </HStack>
        }
        meta={
          <HStack justify="between" vAlign="center" gap={2} wrap="wrap">
            {steps}
            {/* Three labels do not fit 320 px with text spacing (1.4.12), so a phone gets an adaptive menu, as the piles do (D31 §5). */}
            <DropdownMenu
              presentation="adaptive"
              button={{ label: `Vy: ${viewLabels[view]}`, size: 'sm', variant: 'secondary' }}
              items={views.map(v => ({ id: v, label: viewLabels[v], onClick: () => go({ view: v }) }))}
            />
          </HStack>
        }
      />
    </VStack>
  ) : (
    <PageHeader
      title={capital(title)}
      end={
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
      }
    />
  );
  return (
    <Shell user={user} nav={nav}>
      {/* The same gutter as every page (D74, D63 item 13): the Layout's padding reaches the header, so the title stands 32 px in from the rail and 32 px down on a desktop, 12 on a phone. */}
      <Layout
        height="fill"
        padding={mobile ? 3 : 8}
        header={<LayoutHeader hasDivider>{header}</LayoutHeader>}
        end={slot.end}
        content={
          <LayoutContent>
            <VStack gap={4}>
              {error && (
                <Text as="p" role="alert" color="accent">
                  {error}
                </Text>
              )}
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
            </VStack>
          </LayoutContent>
        }
      />
      {slot.overlay}
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
