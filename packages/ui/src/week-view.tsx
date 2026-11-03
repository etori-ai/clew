import { useEffect, useId, useState } from 'react';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { dates, displayDate, isPast, minutesOfDay, occursOn, shortDayLabel, timeLabel, timeRange, today } from '@clew/calendar/dates';

/** One chip in the grid: a calendar event, a drawn proposal or a booked samtal. */
export interface WeekItem { id: string; title: string; start: string; end: string; allDay: boolean; tone: 'mine' | 'invited' | 'proposal' | 'booked'; selected?: boolean; subtitle?: string; }
type Props = { date: string; days?: number; items: WeekItem[]; compact?: boolean; hours?: [number, number]; onSelect?: (item: WeekItem) => void };

const slot = 30;
const defaultStart = 8 * 60, defaultEnd = 17 * 60;
type Placed = { item: WeekItem; start: number; end: number; lane: number; lanes: number };

/** Assign overlapping timed items to side-by-side lanes within each cluster of the day. */
function place(items: WeekItem[], day: string): Placed[] {
  const timed = items.filter(item => !item.allDay && occursOn(item, day))
    .map(item => ({ item, start: minutesOfDay(item.start), end: Math.max(minutesOfDay(item.start) + 15, endMinutes(item, day)) }))
    .sort((a, b) => a.start - b.start || b.end - a.end);
  const placed: Placed[] = []; let cluster: Placed[] = [], clusterEnd = -1;
  const flush = () => { const lanes = Math.max(1, ...cluster.map(c => c.lane + 1)); for (const c of cluster) c.lanes = lanes; placed.push(...cluster); cluster = []; };
  for (const entry of timed) {
    if (cluster.length && entry.start >= clusterEnd) flush();
    const taken = new Set(cluster.filter(other => other.end > entry.start).map(other => other.lane));
    let lane = 0; while (taken.has(lane)) lane++;
    cluster.push({ ...entry, lane, lanes: 1 }); clusterEnd = Math.max(clusterEnd, entry.end);
  }
  if (cluster.length) flush();
  return placed;
}
function endMinutes(item: WeekItem, day: string) { return occursOn({ start: item.end, end: item.end, allDay: false }, day) ? minutesOfDay(item.end) : 24 * 60; }

/**
 * Columns on a time axis, 08–17 by default and stretched to include earlier or later meetings. Inherited from the
 * startsidan calendar module: the only authorised custom composition. Proposals are adjusted by the assistant, never dragged.
 */
export function WeekView({ date, days: count = 7, items, compact = false, hours, onSelect }: Props) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const update = () => setNow(new Date()); update();
    const interval = window.setInterval(update, 15000);
    return () => window.clearInterval(interval);
  }, []);
  const slotHeight = compact ? 14 : 28;
  const instant = now?.toISOString();
  const current = instant ? displayDate(instant) : today();
  const currentMinutes = instant ? minutesOfDay(instant) : null;
  const days = dates(date, count);
  const columns = days.map(day => ({ day, placed: place(items, day), allDay: items.filter(item => item.allDay && occursOn(item, day)) }));
  const timed = columns.flatMap(column => column.placed);
  const axisStart = hours ? hours[0] * 60 : Math.min(defaultStart, ...timed.map(i => Math.floor(i.start / 60) * 60));
  const axisEnd = hours ? hours[1] * 60 : Math.max(defaultEnd, ...timed.map(i => Math.ceil(i.end / 60) * 60));
  const offset = (minutes: number) => ((minutes - axisStart) / slot) * slotHeight;
  const height = offset(axisEnd);
  const hourMarks = Array.from({ length: (axisEnd - axisStart) / 60 }, (_, index) => axisStart + index * 60);
  const hasAllDay = columns.some(column => column.allDay.length > 0);
  return <div className="week" role="group" aria-label="Veckovy" style={{ '--week-days': count } as React.CSSProperties}>
    <div className="week-header">
      <div className="week-corner" />
      {days.map(day => <div key={day} className="week-day-heading" data-today={day === current}>
        {compact ? <Text type="supporting">{shortDayLabel(day)}</Text> : <Heading level={3}>{shortDayLabel(day)}</Heading>}
      </div>)}
    </div>
    {hasAllDay && <div className="week-allday">
      <div className="week-corner"><Text type="supporting">Hela dagen</Text></div>
      {columns.map(({ day, allDay }) => <div key={day} className="week-allday-cell">
        {allDay.map(item => <EventChip key={item.id} item={item} onSelect={onSelect} compact />)}
      </div>)}
    </div>}
    <div className="week-body" style={{ height }}>
      <div className="week-axis" aria-hidden="true">
        {hourMarks.map(minutes => <span key={minutes} className="week-hour" style={{ top: offset(minutes) }}>
          <Text type="supporting" size={compact ? '2xs' : undefined} hasTabularNumbers>{String(minutes / 60).padStart(2, '0')}{compact ? '' : ':00'}</Text>
        </span>)}
      </div>
      {columns.map(({ day, placed }) => <div key={day} className="week-column" data-today={day === current} style={{ backgroundSize: `100% ${slotHeight * 2}px` }}>
        {day === current && currentMinutes !== null && currentMinutes >= axisStart && currentMinutes < axisEnd &&
          <div className="week-now" role="img" aria-label={`Aktuell tid: ${timeLabel(instant!)}, Stockholm`} style={{ top: offset(currentMinutes) }}>
            {!compact && <time className="week-now-label" dateTime={instant} aria-hidden="true">{timeLabel(instant!)}</time>}
          </div>}
        {placed.map(entry => {
          const chipHeight = Math.max(slotHeight - 2, offset(entry.end) - offset(entry.start) - 2);
          const width = 100 / entry.lanes;
          return <div key={entry.item.id} className="week-event" style={{ top: offset(entry.start), height: chipHeight, left: `${entry.lane * width}%`, width: `${width}%` }}>
            <EventChip item={entry.item} onSelect={onSelect} compact={compact || chipHeight < slotHeight * 1.5} />
          </div>;
        })}
      </div>)}
    </div>
  </div>;
}

/** One chip, tinted by the person's relation to it: own meeting, invitation, drawn proposal or booked samtal. */
export function EventChip({ item, onSelect, compact = false }: { item: WeekItem; onSelect?: (item: WeekItem) => void; compact?: boolean }) {
  const id = useId();
  const time = item.allDay ? 'Hela dagen' : timeRange(item.start, item.end);
  const label = `${item.title}, ${time}${item.subtitle ? `, ${item.subtitle}` : ''}`;
  return <div className="event-card" data-tone={item.tone} data-past={isPast(item.end)}>
    <button type="button" className="event-chip" data-compact={compact} data-selected={item.selected ?? true} aria-label={label} aria-describedby={`${id}-time`}
      onClick={onSelect ? () => onSelect(item) : undefined}>
      <span className="event-chip-title">{item.title}</span>
      <span id={`${id}-time`} className="event-chip-time" hidden={compact}>{time}{item.subtitle ? ` · ${item.subtitle}` : ''}</span>
    </button>
  </div>;
}
