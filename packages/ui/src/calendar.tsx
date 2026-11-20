import { useEffect, useMemo, useRef, useState } from 'react';
import { Calendar, type CalendarRef, type EventInput } from '@fullcalendar/react';
import timeGridPlugin from '@fullcalendar/react/timegrid';
import dayGridPlugin from '@fullcalendar/react/daygrid';
import listPlugin from '@fullcalendar/react/list';
import interactionPlugin from '@fullcalendar/react/interaction';
import sv from '@fullcalendar/react/locales/sv';
import '@fullcalendar/react/skeleton.css';
import './calendar-theme.css';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/Layout';
import { VisuallyHidden } from '@astryxdesign/core/VisuallyHidden';
import {
  dates,
  dayLabel,
  displayDate,
  localInstant,
  minutesOfDay,
  monthLabel,
  occursOn,
  shortDayLabel,
  timeRange,
  timeZone,
  weekNumber,
} from '@clew/calendar/dates';
import { clewCalendarTheme } from './calendar-theme';
import type { AgendaItem } from './week-agenda';

/** The views the calendar offers; FullCalendar's names, so the option passes straight through. The list views are the phone's week and the embeds'. */
export type CalendarView = 'timeGridWeek' | 'timeGridDay' | 'dayGridMonth' | 'listWeek' | 'listDay';
export type HeadingLevel = 2 | 3 | 4 | 5 | 6;

type Props = {
  view: CalendarView;
  /** The date the view is anchored on: a Monday for the week, any day for the day or month. ISO date in Stockholm. */
  date: string;
  items: AgendaItem[];
  /** Accessible name of the whole calendar, "Vecka 46" on the page. */
  label: string;
  /** Document outline level of the day headings; the host's own heading is above them. */
  dayHeadingLevel?: HeadingLevel;
  /** Spoken after the summary: where a screen reader finds each entry, since the grid itself is a picture. */
  accessiblePath?: string;
  /** The entry open in a dialog, drawn as selected. */
  selectedId?: string;
  /** An embedded calendar: a tighter axis fitted to its entries and shorter slots. */
  compact?: boolean;
  /**
   * Kalender's page: the grid takes the height it is given, without a frame of its own. The time grid then holds the
   * whole day, midnight to midnight, and scrolls inside itself under its day headers. Its rows are as tall as it takes
   * for 07–18 to fill what is seen, and it opens there: an early or a late hour is a scroll away (the product owner,
   * 2026-11-18). The host gives it a box with a height.
   */
  fill?: boolean;
  /** Saturday and Sunday are drawn too, as days outside the working week. Off in the embeds, whose week is five days. */
  weekends?: boolean;
  /**
   * The entry a person is placing (a new booking, a meeting being moved): it alone is dragged and stretched on the grid,
   * and `onDraftChange` is told where it was put. The host's fields are the keyboard path to the same time (D27).
   */
  draftId?: string;
  /** Where the draft was dragged or stretched to. Returning false puts it back (a span the host cannot take). */
  onDraftChange?: (start: string, end: string) => boolean | void;
  onItemClick?: (item: AgendaItem) => void;
  /** Called when a proposal was dragged to a new time; only proposals are draggable (D27). A rejected promise puts it back. */
  onMoveProposal?: (item: AgendaItem, start: string, end: string) => Promise<unknown> | void;
  /** A span picked on the grid, for "Ny bokning" with the time filled in: dragged, or clicked, which gives an hour (D58). The button is the keyboard path. */
  onSelectRange?: (start: string, end: string) => void;
};

const kindLabel = { event: 'bokat', proposal: 'förslag', booked: 'bokat samtal', gap: 'ledigt' } as const;
const plugins = [clewCalendarTheme, timeGridPlugin, dayGridPlugin, listPlugin, interactionPlugin];
const timeFormat = { hour: '2-digit', minute: '2-digit', hour12: false } as const;
const office = { start: 8 * 60, end: 17 * 60 };
/** The day the page shows without scrolling: the office day with an hour before and after it. */
const pageDay = { start: 7 * 60, end: 18 * 60 };
const pageRows = (pageDay.end - pageDay.start) / 30;
const businessHours = { daysOfWeek: [1, 2, 3, 4, 5], startTime: '08:00', endTime: '17:00' };
const rowMs = 30 * 60_000;
const hourMs = 60 * 60_000;

const clock = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
/** The axis covers office hours (07–18 on the page) and stretches to a whole hour before the earliest and after the latest entry shown. */
function axis(items: AgendaItem[], base: { start: number; end: number }) {
  let start = base.start,
    end = base.end;
  for (const item of items) {
    if (item.allDay) continue;
    start = Math.min(start, Math.floor(minutesOfDay(item.start) / 60) * 60);
    end = Math.max(end, Math.min(24 * 60, Math.ceil(minutesOfDay(item.end) / 60) * 60));
  }
  return { start: clock(start), end: end === 24 * 60 ? '24:00' : clock(end) };
}
/** What a click books (D58): the hour "Ny bokning" starts with, from the row clicked rather than the quarter under the pointer. A day has no clock of its own, so the month and the all-day row start at nine. */
function clickedHour({ allDay, date, dateStr }: { allDay: boolean; date: Date; dateStr: string }) {
  const start = allDay ? Date.parse(localInstant(`${dateStr}T09:00`)) : date.getTime() - (date.getTime() % rowMs);
  return { start: new Date(start).toISOString(), end: new Date(start + hourMs).toISOString() };
}
const isDay = (view: CalendarView) => view === 'timeGridDay' || view === 'listDay';
const isMonth = (view: CalendarView) => view === 'dayGridMonth';
const isList = (view: CalendarView) => view === 'listWeek' || view === 'listDay';
/** The days a view shows, for the axis and the spoken summary. */
const shownDays = (view: CalendarView, date: string, weekends = false) =>
  isDay(view) ? [date] : isMonth(view) ? [] : dates(date, weekends ? 7 : 5);

/** The lowest a half-hour row of the page's grid is fitted to: a 24 px meeting block and its 2 px inset. */
const SLOT_MIN = 26;
/**
 * The event calendar: FullCalendar 7 Standard under Clew's theme (D27). The toolbar is the host's, so `headerToolbar`
 * stays off; `date` and `view` are controlled through the calendar API. Events render through Astryx Text, the day
 * headers are real headings, and a visually hidden summary names what the view holds, because the time grid itself is
 * not a WAI-ARIA grid. A proposal may be dragged, and the one entry a person is placing (`draftId`) dragged and
 * stretched; everything else is read-only. The same component, `compact`,
 * is the day strip and the list inside a panel, a dialog or a chat bubble (D32).
 */
export function EventCalendar({
  view,
  date,
  items: all,
  label,
  dayHeadingLevel = 2,
  accessiblePath,
  selectedId,
  compact = false,
  fill = false,
  weekends = false,
  draftId,
  onDraftChange,
  onItemClick,
  onMoveProposal,
  onSelectRange,
}: Props) {
  const ref = useRef<CalendarRef>(null);
  // A free gap is a row in I dag and nothing in the grid (D71, artboard 6).
  const items = useMemo(() => all.filter(item => item.kind !== 'gap'), [all]);
  const byId = useMemo(() => new Map(items.map(item => [item.id, item])), [items]);
  const events = useMemo<EventInput[]>(
    () =>
      items.map(item => ({
        id: item.id,
        title: item.title,
        start: item.start,
        end: item.end,
        allDay: item.allDay,
        editable: item.id === draftId ? !!onDraftChange : item.kind === 'proposal' && !!onMoveProposal,
        durationEditable: item.id === draftId && !!onDraftChange && !item.proposal,
        extendedProps: { kind: item.kind, selected: item.id === selectedId, draft: item.id === draftId },
      })),
    [items, onMoveProposal, selectedId, draftId, onDraftChange],
  );
  const shown = useMemo(() => {
    const days = shownDays(view, date, weekends);
    return days.length ? items.filter(item => days.some(day => occursOn(item, day))) : items;
  }, [view, date, items, weekends]);
  const { start, end } = useMemo(() => axis(shown, compact ? office : pageDay), [shown, compact]);
  useEffect(() => {
    const api = ref.current?.getApi();
    if (api && api.view.type !== view) api.changeView(view, date);
  }, [view, date]);
  useEffect(() => {
    const api = ref.current?.getApi();
    if (api && displayDate(api.getDate().toISOString()) !== date) api.gotoDate(date);
  }, [date]);
  const summary = useMemo(
    () => summarise(view, date, items, weekends) + (accessiblePath ? ` ${accessiblePath}` : ''),
    [view, date, items, accessiblePath, weekends],
  );
  // Where the grid scrolls inside itself (`fill`), a row's height is a number of pixels, so the row that makes 07–18
  // fill what is seen is measured from FullCalendar's scroller (found from a row it holds) and measured again when the
  // window changes; the grid is then put back at 07. The scroller is left as FullCalendar makes it: a tab stop on it
  // would stand between the grid's row group and its rows, which breaks the table it is part of (axe:
  // aria-required-children). Every entry is a tab stop and comes into view with the focus, and every hour is reached
  // through the host's time fields; an empty stretch outside the office day is seen with a wheel or a finger.
  const host = useRef<HTMLDivElement>(null);
  const [fitted, setFitted] = useState<number | null>(null);
  const timed = fill && !isMonth(view) && !isList(view);
  useEffect(() => {
    if (!timed) return;
    let scroller = host.current?.querySelector('.clew-cal-slot-lane')?.parentElement ?? null;
    while (scroller && scroller !== host.current && !/auto|scroll/.test(getComputedStyle(scroller).overflowY))
      scroller = scroller.parentElement;
    if (!scroller || scroller === host.current) return;
    const seen = scroller;
    // Never lower than a pointer target (2.5.8): a half-hour meeting is drawn 2 px lower than its row, so a row is
    // at least 26 px, and in a low window the grid scrolls inside itself instead of drawing the meeting under 24 px.
    const fit = () => setFitted(Math.max(SLOT_MIN, Math.floor(seen.clientHeight / pageRows)));
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(seen);
    return () => observer.disconnect();
  }, [timed, view]);
  useEffect(() => {
    if (timed && fitted) ref.current?.getApi().scrollToTime(clock(pageDay.start));
  }, [timed, fitted, view]);
  const heading = (day: Date, narrow: boolean, today: boolean, inline = false) => (
    <DayHeading date={day} level={dayHeadingLevel} narrow={narrow} today={today} inline={inline} />
  );
  return (
    <div ref={host} role="group" aria-label={label} className={fill ? 'clew-cal-fill' : undefined}>
      <VisuallyHidden>
        <p>{summary}</p>
      </VisuallyHidden>
      <Calendar
        ref={ref}
        plugins={plugins}
        initialView={view}
        initialDate={date}
        locale={sv}
        timeZone={timeZone}
        weekends={weekends}
        headerToolbar={false}
        height={fill ? '100%' : 'auto'}
        expandRows={fill}
        borderless={fill}
        events={events}
        eventInteractive
        eventOrder="start,-duration,title"
        eventTimeFormat={timeFormat}
        // The start alone: a list and the month say the length in their own words, the grid draws the range under the title.
        displayEventEnd={false}
        slotDuration="00:30"
        slotHeaderInterval="01:00"
        slotMinHeight={timed && fitted ? fitted : compact ? 20 : 28}
        slotHeaderFormat={timeFormat}
        // The page's grid holds the whole day and opens at the start of the office day; an embed and a grid as tall as
        // its day hold the office day, stretched to the entries outside it.
        slotMinTime={fill ? '00:00' : start}
        slotMaxTime={fill ? '24:00' : end}
        scrollTime={fill ? clock(pageDay.start) : start}
        businessHours={businessHours}
        nowIndicator
        allDaySlot
        dayMaxEvents
        navLinks={false}
        selectable={!!onSelectRange}
        selectMirror
        selectMinDistance={4}
        snapDuration="00:15"
        dateClick={
          onSelectRange &&
          (info => {
            const { start, end } = clickedHour(info);
            onSelectRange(start, end);
          })
        }
        dayHeaderContent={info =>
          isMonth(view) ? <Text weight="semibold">{info.text}</Text> : heading(info.date, info.isNarrow, info.isToday)
        }
        listDayHeaderContent={info => (info.level === 0 ? heading(info.date, false, info.isToday, true) : null)}
        noEventsContent={() => (
          <Text type="supporting">{isDay(view) ? 'Inga möten den här dagen.' : 'Inga möten den här veckan.'}</Text>
        )}
        eventContent={info => {
          const item = byId.get(info.event.id);
          const kind = item?.kind ?? 'event';
          // The assistant's mark is seen, not read: the kind is said in words at the end of the name.
          const title = (
            <>
              {item?.marker && <Text aria-hidden="true">{`${item.marker} `}</Text>}
              {info.event.title}
            </>
          );
          const hidden = (
            <VisuallyHidden>
              , {kindLabel[kind]}
              {item?.id === selectedId ? ', öppet' : ''}
            </VisuallyHidden>
          );
          // A list is the row level (D71, artboard 6): the time in its start cell, the title at 14 semibold, the length and the place under it.
          if (isList(view))
            return (
              <>
                <VStack width={52}>
                  <Text weight="semibold" hasTabularNumbers>
                    {info.event.allDay ? 'Heldag' : info.timeText}
                  </Text>
                </VStack>
                <VStack>
                  <Text weight="semibold">{title}</Text>
                  {item?.meta && <Text type="supporting">{item.meta}</Text>}
                </VStack>
                {hidden}
              </>
            );
          // The month is one line a day can hold several of: the start, then the title.
          if (isMonth(view))
            return (
              <>
                {info.timeText && (
                  <Text type="supporting" hasTabularNumbers>
                    {info.timeText}
                  </Text>
                )}
                <Text type="supporting" weight="semibold" color="primary" maxLines={1} hasTruncateTooltip={false}>
                  {title}
                </Text>
                {hidden}
              </>
            );
          // The grid is the one place a title is 12 px (D71): the title in supporting semibold, the time and the place in supporting under it.
          const { start, end } = info.event;
          const when = !info.event.allDay && start && end ? timeRange(start.toISOString(), end.toISOString()) : '';
          const where = item?.place ?? (kind === 'event' ? undefined : item?.subtitle);
          // In a week's narrow column each line is one line that ends in an ellipsis, and a block too short for two keeps
          // its title alone, the time staying in its name. A day has the width: its lines wrap (1.4.10 at 320 px), and a
          // short block puts the time beside the title.
          const week = view === 'timeGridWeek';
          const clip = week ? ({ maxLines: 1, hasTruncateTooltip: false } as const) : {};
          const line = (when || where) && (
            <Text type="supporting" hasTabularNumbers {...clip}>
              {[when, where].filter(Boolean).join('\u00a0· ')}
            </Text>
          );
          return (
            <>
              <Text type="supporting" weight="semibold" color="inherit" {...clip}>
                {title}
              </Text>
              {line && (info.isShort && week ? <VisuallyHidden>{line}</VisuallyHidden> : line)}
              {hidden}
            </>
          );
        }}
        eventClick={info => {
          const item = byId.get(info.event.id);
          if (item) onItemClick?.(item);
        }}
        eventDrop={info => {
          const item = byId.get(info.event.id);
          // The entry being placed is the host's to keep: it says where the block stands, and may refuse.
          if (item && item.id === draftId && onDraftChange && info.event.start && info.event.end) {
            if (onDraftChange(info.event.start.toISOString(), info.event.end.toISOString()) === false) info.revert();
            return;
          }
          if (!item || item.kind !== 'proposal' || !onMoveProposal || !info.event.start || !info.event.end) {
            info.revert();
            return;
          }
          // The move is the host's to write; a refusal puts the block back where it was.
          Promise.resolve(onMoveProposal(item, info.event.start.toISOString(), info.event.end.toISOString())).catch(
            () => info.revert(),
          );
        }}
        eventResize={info => {
          const ok =
            info.event.id === draftId &&
            !!onDraftChange &&
            !!info.event.start &&
            !!info.event.end &&
            onDraftChange(info.event.start.toISOString(), info.event.end.toISOString()) !== false;
          if (!ok) info.revert();
        }}
        select={info => {
          // A booking has a clock and one day: a span of whole days, or one that runs past midnight, starts nothing.
          const oneDay =
            !info.allDay &&
            displayDate(info.start.toISOString()) === displayDate(new Date(info.end.getTime() - 1).toISOString());
          if (oneDay) onSelectRange?.(info.start.toISOString(), info.end.toISOString());
          ref.current?.getApi().unselect();
        }}
      />
    </div>
  );
}

/** The day header as a heading in the document outline, read as "ons 4 nov." like the agenda; shown as the number over the weekday in a grid and as one line in a list, today in the accent. FullCalendar hands over the real instant, so the Stockholm date is derived, never the UTC one. */
function DayHeading({
  date,
  level,
  narrow,
  today,
  inline,
}: {
  date: Date;
  level: HeadingLevel;
  narrow: boolean;
  today: boolean;
  inline: boolean;
}) {
  const day = displayDate(date.toISOString());
  const [weekday = '', number = ''] = shortDayLabel(day).split(' ');
  if (inline)
    return (
      <Heading level={5} accessibilityLevel={level} weight="semibold" color={today ? 'accent' : undefined}>
        {shortDayLabel(day)}
      </Heading>
    );
  return (
    <Heading level={5} accessibilityLevel={level} weight="semibold">
      <span className="clew-cal-day-header-number" aria-hidden="true">
        {number}
      </span>
      <span className="clew-cal-day-header-weekday" aria-hidden="true">
        {narrow ? weekday.slice(0, 3) : weekday}
      </span>
      <VisuallyHidden>{shortDayLabel(day)}</VisuallyHidden>
    </Heading>
  );
}

/** What a screen reader hears first: the span and, per day, how many meetings and proposals, since the grid is a picture. */
function summarise(view: CalendarView, date: string, items: AgendaItem[], weekends = false) {
  const days = shownDays(view, date, weekends);
  const head = isDay(view) ? dayLabel(date) : isMonth(view) ? monthLabel(date) : `Vecka ${weekNumber(date)}`;
  if (!days.length) return `${head}. ${items.length} poster.`;
  const parts = days.map(day => {
    const entries = items.filter(item => occursOn(item, day));
    if (!entries.length) return `${shortDayLabel(day)} ledigt`;
    const counts = (['event', 'booked', 'proposal'] as const)
      .map(kind => [kind, entries.filter(e => e.kind === kind).length] as const)
      .filter(([, n]) => n > 0);
    return `${shortDayLabel(day)}: ${counts.map(([kind, n]) => `${n} ${kindLabel[kind]}`).join(', ')}`;
  });
  return `${head}. ${parts.join('. ')}.`;
}
