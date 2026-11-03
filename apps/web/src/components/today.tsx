import type { TodayView } from '@clew/contracts';
import { Heading, Text } from '@clew/ui';
import { dayLabel, minutesOfDay, timeRange, timeLabel } from '@clew/calendar/dates';

const start = 8 * 60, end = 17 * 60;
const pct = (instant: string) => `${Math.min(100, Math.max(0, ((minutesOfDay(instant) - start) / (end - start)) * 100))}%`;
/** "I dag": today's meetings on a timeline with free gaps marked. On a phone the same data is a chip row. */
export function Today({ view, mobile }: { view: TodayView; mobile: boolean }) {
  const timed = view.events.filter(e => !e.allDay);
  const now = new Date().toISOString();
  if (mobile) {
    const items = [...timed.map(e => ({ kind: 'event' as const, start: e.start, end: e.end, title: e.title })), ...view.gaps.map(g => ({ kind: 'gap' as const, start: g.start, end: g.end, title: 'Ledigt' }))].sort((a, b) => a.start.localeCompare(b.start));
    return <section aria-labelledby="today-heading" className="today">
      <Heading level={2} id="today-heading">I dag</Heading>
      <div className="today-chips">
        {items.length === 0 && <Text type="supporting">Inga inbokade möten i dag.</Text>}
        {items.map(item => <div key={item.start + item.kind} className="today-chip" data-kind={item.kind}>
          <Text type="supporting" hasTabularNumbers color="inherit">{timeRange(item.start, item.end)}</Text>
          <Text type="label" color="inherit">{item.title}</Text>
        </div>)}
      </div>
    </section>;
  }
  return <section aria-labelledby="today-heading" className="today">
    <Heading level={2} id="today-heading">I dag · {dayLabel(view.date)}</Heading>
    <div className="today-strip" role="img" aria-label={timed.length ? timed.map(e => `${timeRange(e.start, e.end)} ${e.title}`).join(', ') : 'Inga inbokade möten i dag'}>
      {[9, 10, 11, 12, 13, 14, 15, 16].map(h => <span key={h} className="today-hour" style={{ left: `${((h * 60 - start) / (end - start)) * 100}%` }}><Text type="supporting" size="2xs">{h}</Text></span>)}
      {view.gaps.map(g => <div key={g.start} className="today-gap" style={{ left: pct(g.start), width: `calc(${pct(g.end)} - ${pct(g.start)})` }} title={`Ledigt ${timeRange(g.start, g.end)}`} />)}
      {timed.map(e => <div key={e.id} className="today-event" style={{ left: pct(e.start), width: `calc(${pct(e.end)} - ${pct(e.start)})` }} title={`${timeRange(e.start, e.end)} ${e.title}`}>{e.title}</div>)}
      {minutesOfDay(now) >= start && minutesOfDay(now) <= end && <div className="today-now" style={{ left: pct(now) }} aria-hidden="true" title={`Nu ${timeLabel(now)}`} />}
    </div>
    <Text type="supporting">{timed.length ? `${timed.length} möten.` : 'Inga inbokade möten.'} {view.gaps.length ? `Ledigt ${view.gaps.map(g => timeRange(g.start, g.end)).join(', ')}.` : 'Inga luckor på minst 30 minuter.'}</Text>
  </section>;
}
