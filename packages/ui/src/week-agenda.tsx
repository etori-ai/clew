import { Grid } from '@astryxdesign/core/Grid';
import { Heading } from '@astryxdesign/core/Heading';
import { VStack, HStack } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';
import { Token } from '@astryxdesign/core/Token';
import { List, ListItem } from '@astryxdesign/core/List';
import { ProgressBar } from '@astryxdesign/core/ProgressBar';
import { dates, displayDate, occursOn, shortDayLabel, timeLabel, timeRange, today } from '@clew/calendar/dates';
import { dayLoad } from '@clew/calendar/proposals';

/** One entry in a day column: an existing meeting, a drawn proposal or a booked samtal. */
export interface AgendaItem { id: string; title: string; start: string; end: string; allDay: boolean; kind: 'event' | 'proposal' | 'booked'; subtitle?: string; /** One or two words for the token on the start-page card; the full title stays in the description. */ short?: string; }
type Props = { week: string; days?: number; items: AgendaItem[]; detailed?: boolean; label?: string; dayHeadingLevel?: 2 | 3 | 4 | 5 | 6 };

const color = { event: 'gray', proposal: 'purple', booked: 'green' } as const;
const kindLabel = { event: 'Redan bokat', proposal: 'Förslag', booked: 'Bokat' } as const;

/**
 * The week as an agenda: one Astryx Grid column per weekday, entries in time order. No hour axis and no custom
 * composition: the assistant redraws proposals, the person never drags them. `detailed` is the phone's calendar page,
 * with real day headings and rows; the card variant is a fixed five-column week (a number never reflows, so the card
 * shows it on a desktop only) with the day as a label ranked by weight and each entry as a token.
 */
export function WeekAgenda({ week, days = 5, items, detailed = false, label = 'Veckovy', dayHeadingLevel = 3 }: Props) {
  const current = today();
  const columns = dates(week, days).map(day => ({ day, entries: items.filter(item => occursOn(item, day)).sort((a, b) => a.start.localeCompare(b.start)) }));
  return <VStack gap={2} role="group" aria-label={label}>
    <Grid columns={detailed ? { minWidth: 160, max: days } : days} gap={detailed ? 3 : 2}>
      {columns.map(({ day, entries }) => <VStack key={day} gap={detailed ? 2 : 1}>
        {detailed
          ? <Heading level={5} accessibilityLevel={dayHeadingLevel} weight="semibold" color={day === current ? 'accent' : undefined}>{shortDayLabel(day)}</Heading>
          : <Text weight="semibold" color={day === current ? 'accent' : undefined}>{shortDayLabel(day)}</Text>}
        {/* The load of the day (D30): busy minutes of the office day, from what is already drawn, so a full day reads as full before anything is sent. */}
        {(() => { const load = dayLoad(day, entries.filter(e => !e.allDay)); const hours = Math.round(load.busyMinutes / 6) / 10;
          return <ProgressBar label={`Belastning ${shortDayLabel(day)}: ${hours} av 9 timmar upptagna`} isLabelHidden value={load.busyMinutes} max={540} variant={load.share > 0.8 ? 'warning' : 'neutral'} />; })()}
        {entries.length === 0 && <Text type="supporting">Ledigt</Text>}
        {detailed
          ? <List density="compact" hasDividers edge="flush">
            {entries.map(item => <ListItem key={item.id}
              label={<Text type="label" hasTabularNumbers>{item.allDay ? 'Hela dagen' : timeRange(item.start, item.end)}</Text>}
              description={<Text type="supporting">{item.title}{item.subtitle ? ` · ${item.subtitle}` : ''}</Text>}
              endContent={item.kind !== 'event' ? <Token size="sm" color={color[item.kind]} label={kindLabel[item.kind]} /> : undefined} />)}
          </List>
          : entries.map(item => <Token key={item.id} size="sm" color={color[item.kind]} label={`${item.allDay ? 'Hela dagen' : timeLabel(item.start)} ${item.short ?? item.title}`}
            description={`${item.title}${item.subtitle ? ` · ${item.subtitle}` : ''}: ${kindLabel[item.kind]}, ${item.allDay ? 'hela dagen' : timeRange(item.start, item.end)}`} />)}
      </VStack>)}
    </Grid>
    <HStack gap={2} wrap="wrap" role="group" aria-label="Teckenförklaring">
      {(['event', 'proposal', 'booked'] as const).map(kind => <Token key={kind} size="sm" color={color[kind]} label={kindLabel[kind]} />)}
    </HStack>
  </VStack>;
}
export const agendaDay = displayDate;
