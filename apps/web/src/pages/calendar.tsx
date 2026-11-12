import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { keepPreviousData, useQueries, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import type { Area, CalendarEvent, Proposal, SessionUser, Thread } from '@clew/contracts';
import {
  AreaChip,
  Badge,
  Button,
  ChatComposer,
  CheckboxList,
  CheckboxListItem,
  DatePicker,
  Drawer,
  DrawerHeader,
  DropdownMenu,
  EventCalendar,
  Heading,
  HStack,
  Icon,
  IconButton,
  Layout,
  LayoutContent,
  LayoutFooter,
  LayoutHeader,
  LayoutPanel,
  SegmentedControl,
  SegmentedControlItem,
  StatusDot,
  Text,
  VStack,
  PROPOSAL_MARK,
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
import { pickProposalThread } from '../thread-cache';
import { useThreadAction } from '../mutations';
import { errorMessage } from '../query-policy';
import { usePageTitle } from '../page-title';
import { useMarks } from '../marks';
import { Shell, mobileQuery } from '../components/shell';
import { useNav } from '../components/nav';
import { EventDialog } from '../components/calendar/event-dialog';
import { BookingDialog } from '../components/calendar/booking-dialog';
import { PageHeader } from '../components/page-header';
import { AsyncContent, ContentSkeleton } from '../components/loading';

/** The three views as the URL names them, so a view is addressable and the back button works. */
type View = 'day' | 'week' | 'month';
const views: View[] = ['day', 'week', 'month'];
const viewLabels: Record<View, string> = { day: 'Dag', week: 'Vecka', month: 'Månad' };
const isoDate = /^\d{4}-\d{2}-\d{2}$/;
/** The panel leaves the side below 1024 px (the responsive guide's three-two-one contract) and opens as a drawer from the toolbar. */
const panelQuery = '(max-width: 1279px)';
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
const EMPTY_AREAS: Area[] = [];
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

/**
 * The calendar as a page (D27, D32): one day, one week or one month on FullCalendar under Clew's theme, inside the one
 * shell, with the proposal thread beside it to confirm or redraw. A booking of one's own, an opened entry and a moved
 * proposal all go through dialogs, so every action has a keyboard path; drag is a convenience for proposals alone.
 */
export function CalendarPage({ user, admin = false }: { user: SessionUser; admin?: boolean }) {
  const mobile = useMediaQuery(mobileQuery);
  const narrow = useMediaQuery(panelQuery);
  const [params, setParams] = useSearchParams();
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
  const client = useQueryClient();
  const areas = useQuery(areasQuery).data?.areas ?? EMPTY_AREAS;
  const nav = useNav({ current: { surface: 'calendar' }, admin, manager: user.role === 'manager' });
  const marks = useMarks();
  // The proposal thread beside the grid is picked from the stream's own list, so a confirm here and the card on the start page agree.
  const threadsQ = useQuery({ ...threadsQuery, select: selectProposalThread });
  const thread = threadsQ.data ?? null;
  // The selection is the panel's draft: every proposed time, seeded again when the thread itself changes.
  const [selected, setSelected] = useState<string[]>([]);
  useEffect(() => {
    setSelected(thread ? thread.proposals.filter(p => p.status === 'proposed').map(p => p.id) : []);
  }, [thread?.id, thread?.updatedAt]);
  const { run, apply, busy, error: actionError } = useThreadAction();
  const [moveError, setMoveError] = useState<string | null>(null);
  const [openItem, setOpenItem] = useState<AgendaItem | null>(null);
  const [booking, setBooking] = useState<{ start: string; end: string } | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const title =
    view === 'day'
      ? dayLabel(anchor)
      : view === 'month'
        ? monthLabel(anchor)
        : `Vecka ${weekNumber(anchor)} · ${rangeLabel(anchor, 5)}`;
  const short = view === 'week' ? `Vecka ${weekNumber(anchor)}` : title.charAt(0).toUpperCase() + title.slice(1);
  usePageTitle(
    `${short} · Kalender`,
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
  const readError = failed
    ? errorMessage(failed, 'Kalendern kunde inte läsas.')
    : threadsQ.isError && threadsQ.data === undefined
      ? errorMessage(threadsQ.error, 'Kalendern kunde inte läsas.')
      : null;
  const error = actionError ?? moveError ?? readError;
  const items = useMemo(() => agendaItems(events, proposals), [events, proposals]);
  const dayItems = useMemo(
    () => (openItem ? items.filter(i => occursOn(i, displayDate(openItem.start))) : []),
    [items, openItem],
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
  const open = thread?.state === 'open' && thread.proposals.some(p => p.status === 'proposed');
  const proposed = thread?.proposals.filter(p => p.status === 'proposed') ?? [];
  const undoUntil = thread?.proposals
    .map(p => p.undoUntil)
    .filter((v): v is string => !!v)
    .sort()
    .at(-1);
  const undoOpen =
    !!undoUntil && Date.parse(undoUntil) > Date.now() && !!thread?.proposals.some(p => p.status === 'confirmed');
  const mark = thread ? marks.ofThread(thread) : null;
  const plural = selected.length === 1 ? 'inbjudan' : 'inbjudningar';
  // The panel is its own Layout (side-panels guide): the card and the list scroll, the reply field is the pinned footer.
  // The card is drawn as artboard 6 draws it (D71): the mark row (the house chip, the source and the week, the one
  // badge), the title at level 2, the proposals as rows with the assistant's ✦.
  const panelBody = thread && mark && (
    <VStack gap={3}>
      <VStack gap={2}>
        <HStack gap={2} vAlign="center" wrap="wrap">
          <AreaChip ordinal={mark.ordinal} icon={mark.icon} label={mark.title} />
          <Text type="supporting">
            {thread.week ? `${mark.source} · vecka ${weekNumber(thread.week)}` : mark.source}
          </Text>
          {open ? (
            <Badge variant="warning" icon={<Icon icon="warning" size="sm" />} label="Förslag att bekräfta" />
          ) : (
            <StatusDot variant="neutral" label="Hanterad" />
          )}
        </HStack>
        <Heading level={2}>{thread.title}</Heading>
      </VStack>
      {/* The grid can show another week than the proposals are in: said first, with the way there, before anything is decided. */}
      {thread.week && (view !== 'week' || thread.week !== anchor) && (
        <HStack gap={2} vAlign="center" justify="between" wrap="wrap">
          <Text type="supporting">Kalendern visar en annan vecka.</Text>
          <Button
            size="sm"
            variant="secondary"
            label={`Visa vecka ${weekNumber(thread.week)}`}
            onClick={() => {
              setPanelOpen(false);
              go({ date: thread.week!, view: 'week' });
            }}
          />
        </HStack>
      )}
      <CheckboxList
        label="Förslag"
        isLabelHidden
        value={selected}
        onChange={setSelected}
        isReadOnly={!open}
        hasDividers
      >
        {thread.proposals
          .filter(p => p.status !== 'declined')
          .map(p => (
            <CheckboxListItem
              key={p.id}
              value={p.id}
              label={
                <HStack gap={3} vAlign="start">
                  <VStack width={52}>
                    <Text weight="semibold" hasTabularNumbers>
                      {shortDayLabel(p.start.slice(0, 10)).split(' ').slice(0, 2).join(' ')}
                    </Text>
                  </VStack>
                  <VStack>
                    <Text weight="semibold">
                      {p.status === 'proposed' && <Text aria-hidden="true">{`${PROPOSAL_MARK} `}</Text>}
                      {p.participant.name}
                    </Text>
                    <Text type="supporting">{timeRange(p.start, p.end)}</Text>
                  </VStack>
                </HStack>
              }
              isChecked={p.status !== 'proposed' || selected.includes(p.id)}
              isDisabled={p.status !== 'proposed'}
              endContent={
                p.status !== 'proposed' ? (
                  <StatusDot
                    variant={p.status === 'confirmed' || p.status === 'final' ? 'success' : 'neutral'}
                    label={p.status === 'confirmed' ? 'Skickad' : p.status === 'final' ? 'Bokad' : 'Återkallad'}
                  />
                ) : undefined
              }
            />
          ))}
      </CheckboxList>
      {open && (
        <Text type="supporting" as="p">
          Inbjudningarna skickas först när du bekräftar. Öppna ett förslag i kalendern för att flytta det, eller be mig
          rita om dem i en annan vecka.
        </Text>
      )}
      {error && (
        <Text as="p" role="alert" color="accent">
          {error}
        </Text>
      )}
      <HStack gap={2} wrap="wrap">
        {open && (
          <Button
            variant="primary"
            label={`Skicka ${selected.length} ${plural}`}
            isDisabled={!selected.length}
            clickAction={() => run(() => api.confirm(thread.id, selected))}
          />
        )}
        {open && thread.week && (
          <Button
            label="Föreslå andra tider"
            clickAction={() => run(() => api.replan(thread.id, addDays(thread.week!, 7)))}
          />
        )}
        {undoOpen && <Button variant="destructive" label="Ångra" clickAction={() => run(() => api.undo(thread.id))} />}
      </HStack>
    </VStack>
  );
  const reply = thread && (
    <ChatComposer
      density="compact"
      elevation="none"
      isDisabled={busy}
      placeholder="Svara här"
      onSubmit={text => {
        const body = text.trim();
        if (body) void run(() => api.reply(thread.id, body));
      }}
    />
  );
  const panel = thread && (
    <Layout
      height="fill"
      padding={3}
      content={<LayoutContent>{panelBody}</LayoutContent>}
      footer={<LayoutFooter hasDivider>{reply}</LayoutFooter>}
    />
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
  const proposalsButton = narrow && thread && (
    <Button
      variant="secondary"
      size="sm"
      label={open ? `Förslag · ${proposed.length}` : 'Förslag'}
      onClick={() => setPanelOpen(true)}
    />
  );
  const bookButton = (
    <Button variant="primary" size="sm" label="Ny bokning" onClick={() => setBooking(nextWholeHour(new Date()))} />
  );
  // The one page header (D74): the title first, what can be done at the end of its line. A phone has two rows: the
  // title with what can be done, and under it where in time with how it is shown, 44 px controls under a finger. The
  // controls are Astryx's `sm`, as the toolbar that held them made them (28 px, under the heading's 32 px line).
  const header = mobile ? (
    <VStack as="section" aria-label="Kalender">
      <PageHeader
        title={short}
        end={
          <HStack gap={2} vAlign="center">
            {proposalsButton}
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
      title={title.charAt(0).toUpperCase() + title.slice(1)}
      end={
        <HStack gap={3} vAlign="center" wrap="wrap">
          {steps}
          <SegmentedControl label="Vy" size="sm" value={view} onChange={v => go({ view: v as View })}>
            <SegmentedControlItem value="day" label="Dag" />
            <SegmentedControlItem value="week" label="Vecka" />
            <SegmentedControlItem value="month" label="Månad" />
          </SegmentedControl>
          <HStack gap={2} vAlign="center">
            {proposalsButton}
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
        end={
          !narrow && thread ? (
            <LayoutPanel width={340} hasDivider role="complementary" label="Förslag" padding={0} isScrollable={false}>
              {panel}
            </LayoutPanel>
          ) : undefined
        }
        content={
          <LayoutContent>
            <VStack gap={4}>
              {!thread && error && (
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
                  label={title.charAt(0).toUpperCase() + title.slice(1)}
                  dayHeadingLevel={2}
                  accessiblePath={
                    thread
                      ? 'Listan under Förslag är vägen till varje förslag; Retur på en post öppnar den.'
                      : 'Retur på en post öppnar den.'
                  }
                  selectedId={openItem?.id}
                  onItemClick={setOpenItem}
                  onMoveProposal={open ? moveProposal : undefined}
                  onSelectRange={mobile ? undefined : (start, end) => setBooking({ start, end })}
                />
              </AsyncContent>
            </VStack>
          </LayoutContent>
        }
      />
      {narrow && thread && (
        <Drawer isOpen={panelOpen} onOpenChange={setPanelOpen} side="end" width={420} label="Förslag">
          <Layout
            height="fill"
            padding={3}
            header={<DrawerHeader title="Förslag" onOpenChange={setPanelOpen} />}
            content={<LayoutContent>{panelBody}</LayoutContent>}
            footer={<LayoutFooter hasDivider>{reply}</LayoutFooter>}
          />
        </Drawer>
      )}
      {/* Both dialogs write the cache themselves (D33): a moved proposal's thread, or the loaded weeks read again. */}
      <EventDialog
        item={openItem}
        dayItems={dayItems}
        onClose={() => setOpenItem(null)}
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
