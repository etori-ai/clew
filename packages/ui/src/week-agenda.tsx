import type { CalendarEvent, Proposal } from '@clew/contracts';
import { Grid } from '@astryxdesign/core/Grid';
import { VStack, HStack } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';
import { Token } from '@astryxdesign/core/Token';
import { ProgressBar } from '@astryxdesign/core/ProgressBar';
import { dates, displayDate, occursOn, shortDayLabel, timeLabel, timeRange, today } from '@clew/calendar/dates';
import { dayLoad } from '@clew/calendar/proposals';

/** One entry in a day column: an existing meeting, a drawn proposal or a booked samtal. */
export interface AgendaItem {
  id: string; title: string; start: string; end: string; allDay: boolean; kind: 'event' | 'proposal' | 'booked'; subtitle?: string;
  /** One or two words for the token on the start-page card; the full title stays in the description. */
  short?: string;
  /** What the entry stands for, so a dialog can act on it: the calendar's event or the drawn proposal. */
  event?: CalendarEvent; proposal?: Proposal;
}
type Props = { week: string; days?: number; items: AgendaItem[]; label?: string };

const color = { event: 'gray', proposal: 'purple', booked: 'green' } as const;
const kindLabel = { event: 'Redan bokat', proposal: 'Förslag', booked: 'Bokat' } as const;

/**
 * The week as an agenda on a start-page card (D27 §6, D32): a fixed five-column Astryx Grid (a number never reflows, so
 * the card shows it on a desktop only), the day as a label ranked by weight, each entry as a token, entries in time
 * order. No hour axis and no custom composition; the calendar page and the embeds are `EventCalendar`.
 */
export function WeekAgenda({ week, days = 5, items, label = 'Veckovy' }: Props) {
  const current = today();
  const columns = dates(week, days).map(day => ({ day, entries: items.filter(item => occursOn(item, day)).sort((a, b) => a.start.localeCompare(b.start)) }));
  return <VStack gap={2} role="group" aria-label={label}>
    <Grid columns={days} gap={2}>
      {columns.map(({ day, entries }) => <VStack key={day} gap={1}>
        <Text weight="semibold" color={day === current ? 'accent' : undefined}>{shortDayLabel(day)}</Text>
        {/* The load of the day (D30): busy minutes of the office day, from what is already drawn, so a full day reads as full before anything is sent. */}
        {(() => { const load = dayLoad(day, entries.filter(e => !e.allDay)); const hours = Math.round(load.busyMinutes / 6) / 10;
          return <ProgressBar label={`Belastning ${shortDayLabel(day)}: ${hours} av 9 timmar upptagna`} isLabelHidden value={load.busyMinutes} max={540} variant={load.share > 0.8 ? 'warning' : 'neutral'} />; })()}
        {entries.length === 0 && <Text type="supporting">Ledigt</Text>}
        {entries.map(item => <Token key={item.id} size="sm" color={color[item.kind]} label={`${item.allDay ? 'Hela dagen' : timeLabel(item.start)} ${item.short ?? item.title}`}
          description={`${item.title}${item.subtitle ? ` · ${item.subtitle}` : ''}: ${kindLabel[item.kind]}, ${item.allDay ? 'hela dagen' : timeRange(item.start, item.end)}`} />)}
      </VStack>)}
    </Grid>
    <HStack gap={2} wrap="wrap" role="group" aria-label="Teckenförklaring">
      {(['event', 'proposal', 'booked'] as const).map(kind => <Token key={kind} size="sm" color={color[kind]} label={kindLabel[kind]} />)}
    </HStack>
  </VStack>;
}
export const agendaDay = displayDate;
