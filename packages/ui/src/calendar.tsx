import { useEffect, useMemo, useRef } from 'react';
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
import { VisuallyHidden } from '@astryxdesign/core/VisuallyHidden';
import { dates, dayLabel, displayDate, minutesOfDay, monthLabel, occursOn, shortDayLabel, timeZone, weekNumber } from '@clew/calendar/dates';
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
  onItemClick?: (item: AgendaItem) => void;
  /** Called when a proposal was dragged to a new time; only proposals are draggable (D27). A rejected promise puts it back. */
  onMoveProposal?: (item: AgendaItem, start: string, end: string) => Promise<unknown> | void;
  /** A span selected with the pointer on the grid, for "Ny bokning" with the time filled in. The button is the keyboard path. */
  onSelectRange?: (start: string, end: string) => void;
};

const kindLabel = { event: 'bokat', proposal: 'förslag', booked: 'bokat samtal' } as const;
const plugins = [clewCalendarTheme, timeGridPlugin, dayGridPlugin, listPlugin, interactionPlugin];
const timeFormat = { hour: '2-digit', minute: '2-digit', hour12: false } as const;
const office = { start: 8 * 60, end: 17 * 60 };
const businessHours = { daysOfWeek: [1, 2, 3, 4, 5], startTime: '08:00', endTime: '17:00' };

const clock = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
/** The axis covers office hours (07–18 on the page) and stretches to a whole hour before the earliest and after the latest entry shown. */
function axis(items: AgendaItem[], base: { start: number; end: number }) {
  let start = base.start, end = base.end;
  for (const item of items) {
    if (item.allDay) continue;
    start = Math.min(start, Math.floor(minutesOfDay(item.start) / 60) * 60);
    end = Math.max(end, Math.min(24 * 60, Math.ceil(minutesOfDay(item.end) / 60) * 60));
  }
  return { start: clock(start), end: end === 24 * 60 ? '24:00' : clock(end) };
}
const isDay = (view: CalendarView) => view === 'timeGridDay' || view === 'listDay';
const isMonth = (view: CalendarView) => view === 'dayGridMonth';
/** The days a view shows, for the axis and the spoken summary. */
const shownDays = (view: CalendarView, date: string) => isDay(view) ? [date] : isMonth(view) ? [] : dates(date, 5);

/**
 * The event calendar: FullCalendar 7 Standard under Clew's theme (D27). The toolbar is the host's, so `headerToolbar`
 * stays off; `date` and `view` are controlled through the calendar API. Events render through Astryx Text, the day
 * headers are real headings, and a visually hidden summary names what the view holds, because the time grid itself is
 * not a WAI-ARIA grid. Proposals alone may be dragged; everything else is read-only. The same component, `compact`,
 * is the day strip and the list inside a panel, a dialog or a chat bubble (D32).
 */
export function EventCalendar({ view, date, items, label, dayHeadingLevel = 2, accessiblePath, selectedId, compact = false, onItemClick, onMoveProposal, onSelectRange }: Props) {
  const ref = useRef<CalendarRef>(null);
  const byId = useMemo(() => new Map(items.map(item => [item.id, item])), [items]);
  const events = useMemo<EventInput[]>(() => items.map(item => ({
    id: item.id, title: item.title, start: item.start, end: item.end, allDay: item.allDay,
    editable: item.kind === 'proposal' && !!onMoveProposal, durationEditable: false,
    extendedProps: { kind: item.kind, subtitle: item.subtitle, selected: item.id === selectedId },
  })), [items, onMoveProposal, selectedId]);
  const shown = useMemo(() => { const days = shownDays(view, date); return days.length ? items.filter(item => days.some(day => occursOn(item, day))) : items; }, [view, date, items]);
  const { start, end } = useMemo(() => axis(shown, compact ? office : { start: 7 * 60, end: 18 * 60 }), [shown, compact]);
  useEffect(() => { const api = ref.current?.getApi(); if (api && api.view.type !== view) api.changeView(view, date); }, [view, date]);
  useEffect(() => { const api = ref.current?.getApi(); if (api && displayDate(api.getDate().toISOString()) !== date) api.gotoDate(date); }, [date]);
  const summary = useMemo(() => summarise(view, date, items) + (accessiblePath ? ` ${accessiblePath}` : ''), [view, date, items, accessiblePath]);
  const heading = (day: Date, narrow: boolean, today: boolean, inline = false) => <DayHeading date={day} level={dayHeadingLevel} narrow={narrow} today={today} inline={inline} />;
  return <div role="group" aria-label={label}>
    <VisuallyHidden><p>{summary}</p></VisuallyHidden>
    <Calendar ref={ref} plugins={plugins} initialView={view} initialDate={date}
      locale={sv} timeZone={timeZone} weekends={false} headerToolbar={false} height="auto"
      events={events} eventInteractive eventOrder="start,-duration,title" eventTimeFormat={timeFormat}
      // Five columns leave no room for a range on a short block; the block's height tells the end, and the dialog says it.
      displayEventEnd={view !== 'timeGridWeek'}
      slotDuration="00:30" slotHeaderInterval="01:00" slotMinHeight={compact ? 20 : 28} slotHeaderFormat={timeFormat} slotMinTime={start} slotMaxTime={end} scrollTime={start}
      businessHours={businessHours} nowIndicator allDaySlot dayMaxEvents navLinks={false}
      selectable={!!onSelectRange} selectMirror selectMinDistance={4} snapDuration="00:15" selectConstraint={businessHours}
      dayHeaderContent={info => isMonth(view) ? <Text weight="semibold">{info.text}</Text> : heading(info.date, info.isNarrow, info.isToday)}
      listDayHeaderContent={info => info.level === 0 ? heading(info.date, false, info.isToday, true) : null}
      noEventsContent={() => <Text type="supporting">{isDay(view) ? 'Inga möten den här dagen.' : 'Inga möten den här veckan.'}</Text>}
      eventContent={info => {
        const item = byId.get(info.event.id);
        const kind = item?.kind ?? 'event';
        const title = item?.subtitle && kind !== 'event' ? `${info.event.title} · ${item.subtitle}` : info.event.title;
        // A week's five columns leave a short meeting room for its name or its time: the grid's own axis says when, the name is what only the block can say.
        const time = info.timeText && <Text type="inherit" weight="semibold" hasTabularNumbers>{info.timeText}</Text>;
        return <>
          {time && (view === 'timeGridWeek' ? <VisuallyHidden>{time}</VisuallyHidden> : time)}
          <Text type="inherit">{title}</Text>
          <VisuallyHidden>, {kindLabel[kind]}{item?.id === selectedId ? ', öppet' : ''}</VisuallyHidden>
        </>;
      }}
      eventClick={info => { const item = byId.get(info.event.id); if (item) onItemClick?.(item); }}
      eventDrop={info => {
        const item = byId.get(info.event.id);
        if (!item || item.kind !== 'proposal' || !onMoveProposal || !info.event.start || !info.event.end) { info.revert(); return; }
        // The move is the host's to write; a refusal puts the block back where it was.
        Promise.resolve(onMoveProposal(item, info.event.start.toISOString(), info.event.end.toISOString())).catch(() => info.revert());
      }}
      select={info => { onSelectRange?.(info.start.toISOString(), info.end.toISOString()); ref.current?.getApi().unselect(); }} />
  </div>;
}

/** The day header as a heading in the document outline, read as "ons 4 nov." like the agenda; shown as the number over the weekday in a grid and as one line in a list, today in the accent. FullCalendar hands over the real instant, so the Stockholm date is derived, never the UTC one. */
function DayHeading({ date, level, narrow, today, inline }: { date: Date; level: HeadingLevel; narrow: boolean; today: boolean; inline: boolean }) {
  const day = displayDate(date.toISOString());
  const [weekday = '', number = ''] = shortDayLabel(day).split(' ');
  if (inline) return <Heading level={5} accessibilityLevel={level} weight="semibold" color={today ? 'accent' : undefined}>{shortDayLabel(day)}</Heading>;
  return <Heading level={5} accessibilityLevel={level} weight="semibold">
    <span className="clew-cal-day-header-number" aria-hidden="true">{number}</span>
    <span className="clew-cal-day-header-weekday" aria-hidden="true">{narrow ? weekday.slice(0, 3) : weekday}</span>
    <VisuallyHidden>{shortDayLabel(day)}</VisuallyHidden>
  </Heading>;
}

/** What a screen reader hears first: the span and, per day, how many meetings and proposals, since the grid is a picture. */
function summarise(view: CalendarView, date: string, items: AgendaItem[]) {
  const days = shownDays(view, date);
  const head = isDay(view) ? dayLabel(date) : isMonth(view) ? monthLabel(date) : `Vecka ${weekNumber(date)}`;
  if (!days.length) return `${head}. ${items.length} poster.`;
  const parts = days.map(day => {
    const entries = items.filter(item => occursOn(item, day));
    if (!entries.length) return `${shortDayLabel(day)} ledigt`;
    const counts = (['event', 'booked', 'proposal'] as const).map(kind => [kind, entries.filter(e => e.kind === kind).length] as const).filter(([, n]) => n > 0);
    return `${shortDayLabel(day)}: ${counts.map(([kind, n]) => `${n} ${kindLabel[kind]}`).join(', ')}`;
  });
  return `${head}. ${parts.join('. ')}.`;
}
