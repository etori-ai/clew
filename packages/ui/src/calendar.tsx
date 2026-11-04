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
import { dates, dayLabel, displayDate, minutesOfDay, occursOn, shortDayLabel, timeZone, weekNumber } from '@clew/calendar/dates';
import { clewCalendarTheme } from './calendar-theme';
import type { AgendaItem } from './week-agenda';

/** The views the calendar page offers; FullCalendar's names, so the option passes straight through. */
export type CalendarView = 'timeGridWeek' | 'timeGridDay' | 'dayGridMonth' | 'listWeek';

type Props = {
  view: CalendarView;
  /** The date the view is anchored on: a Monday for the week, any day for the day or month. ISO date in Stockholm. */
  date: string;
  items: AgendaItem[];
  /** Accessible name of the whole calendar, "Vecka 46" on the page. */
  label: string;
  /** Document outline level of the day headings; the page's own heading is above them. */
  dayHeadingLevel?: 2 | 3 | 4;
  onItemClick?: (item: AgendaItem) => void;
  /** Called when a proposal was dragged to a new time; only proposals are draggable (D27). The move is the page's to confirm. */
  onMoveProposal?: (item: AgendaItem, start: string, end: string) => void;
};

const kindLabel = { event: 'bokat', proposal: 'förslag', booked: 'bokat samtal' } as const;
const plugins = [clewCalendarTheme, timeGridPlugin, dayGridPlugin, listPlugin, interactionPlugin];
const timeFormat = { hour: '2-digit', minute: '2-digit', hour12: false } as const;
const officeStart = 7 * 60, officeEnd = 18 * 60;

const clock = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
/** The axis covers office hours and stretches to a whole hour before the earliest and after the latest meeting of the week. */
function axis(items: AgendaItem[]) {
  let start = officeStart, end = officeEnd;
  for (const item of items) {
    if (item.allDay) continue;
    start = Math.min(start, Math.floor(minutesOfDay(item.start) / 60) * 60);
    end = Math.max(end, Math.min(24 * 60, Math.ceil(minutesOfDay(item.end) / 60) * 60));
  }
  return { start: clock(start), end: end === 24 * 60 ? '24:00' : clock(end) };
}

/**
 * The calendar page's grid: FullCalendar 7 Standard under Clew's theme (D27). The toolbar is the page's, so
 * `headerToolbar` stays off; `date` and `view` are controlled by the page through the calendar API. Events render
 * through Astryx Text, the day headers are real headings, and a visually hidden summary names what the week holds,
 * because the time grid itself is not a WAI-ARIA grid. Proposals alone may be dragged; everything else is read-only.
 */
export function EventCalendar({ view, date, items, label, dayHeadingLevel = 2, onItemClick, onMoveProposal }: Props) {
  const ref = useRef<CalendarRef>(null);
  const byId = useMemo(() => new Map(items.map(item => [item.id, item])), [items]);
  const events = useMemo<EventInput[]>(() => items.map(item => ({
    id: item.id, title: item.title, start: item.start, end: item.end, allDay: item.allDay,
    editable: item.kind === 'proposal' && !!onMoveProposal, durationEditable: false,
    extendedProps: { kind: item.kind, subtitle: item.subtitle },
  })), [items, onMoveProposal]);
  const { start, end } = useMemo(() => axis(items), [items]);
  useEffect(() => { const api = ref.current?.getApi(); if (api && api.view.type !== view) api.changeView(view, date); }, [view, date]);
  useEffect(() => { const api = ref.current?.getApi(); if (api && displayDate(api.getDate().toISOString()) !== date) api.gotoDate(date); }, [date]);
  const summary = useMemo(() => summarise(view, date, items), [view, date, items]);
  return <div role="group" aria-label={label}>
    <VisuallyHidden><p>{summary}</p></VisuallyHidden>
    <Calendar ref={ref} plugins={plugins} initialView={view} initialDate={date}
      locale={sv} timeZone={timeZone} weekends={false} headerToolbar={false} height="auto"
      events={events} eventInteractive eventOrder="start,-duration,title" eventTimeFormat={timeFormat}
      slotDuration="00:30" slotHeaderInterval="01:00" slotMinHeight={28} slotHeaderFormat={timeFormat} slotMinTime={start} slotMaxTime={end} scrollTime={start}
      nowIndicator allDaySlot dayMaxEvents navLinks={false}
      dayHeaderContent={info => <DayHeading date={info.date} level={dayHeadingLevel} narrow={info.isNarrow} />}
      eventContent={info => {
        const item = byId.get(info.event.id);
        const kind = item?.kind ?? 'event';
        const title = item?.subtitle && kind !== 'event' ? `${info.event.title} · ${item.subtitle}` : info.event.title;
        return <>
          {info.timeText && <Text type="inherit" weight="semibold" hasTabularNumbers>{info.timeText}</Text>}
          <Text type="inherit">{title}</Text>
          <VisuallyHidden>, {kindLabel[kind]}</VisuallyHidden>
        </>;
      }}
      eventClick={info => { const item = byId.get(info.event.id); if (item) onItemClick?.(item); }}
      eventDrop={info => {
        const item = byId.get(info.event.id);
        if (!item || item.kind !== 'proposal' || !onMoveProposal || !info.event.start || !info.event.end) { info.revert(); return; }
        onMoveProposal(item, info.event.start.toISOString(), info.event.end.toISOString());
      }} />
  </div>;
}

/** The day header as a heading in the document outline, read as "ons 4 nov." like the agenda; shown as the number over the weekday, today in the accent. FullCalendar hands over the real instant, so the Stockholm date is derived, never the UTC one. */
function DayHeading({ date, level, narrow }: { date: Date; level: 2 | 3 | 4; narrow: boolean }) {
  const day = displayDate(date.toISOString());
  const [weekday = '', number = ''] = shortDayLabel(day).split(' ');
  return <Heading level={6} accessibilityLevel={level} weight="semibold">
    <span className="clew-cal-day-header-number" aria-hidden="true">{number}</span>
    <span className="clew-cal-day-header-weekday" aria-hidden="true">{narrow ? weekday.slice(0, 3) : weekday}</span>
    <VisuallyHidden>{shortDayLabel(day)}</VisuallyHidden>
  </Heading>;
}

/** What a screen reader hears first: the span and, per day, how many meetings and proposals, since the grid is a picture. */
function summarise(view: CalendarView, date: string, items: AgendaItem[]) {
  const days = view === 'timeGridDay' ? [date] : view === 'dayGridMonth' ? [] : dates(date, 5);
  const head = view === 'timeGridDay' ? dayLabel(date) : view === 'dayGridMonth' ? 'Månadsvy' : `Vecka ${weekNumber(date)}`;
  if (!days.length) return `${head}. ${items.length} poster. Listan i panelen är vägen till varje förslag.`;
  const parts = days.map(day => {
    const entries = items.filter(item => occursOn(item, day));
    if (!entries.length) return `${shortDayLabel(day)} ledigt`;
    const counts = (['event', 'booked', 'proposal'] as const).map(kind => [kind, entries.filter(e => e.kind === kind).length] as const).filter(([, n]) => n > 0);
    return `${shortDayLabel(day)}: ${counts.map(([kind, n]) => `${n} ${kindLabel[kind]}`).join(', ')}`;
  });
  return `${head}. ${parts.join('. ')}. Listan i panelen är vägen till varje förslag.`;
}
