import { Grid } from '@astryxdesign/core/Grid';
import { Heading } from '@astryxdesign/core/Heading';
import { VStack, HStack } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';
import { Token } from '@astryxdesign/core/Token';
import { List, ListItem } from '@astryxdesign/core/List';
import { Badge } from '@astryxdesign/core/Badge';
import { dates, displayDate, occursOn, shortDayLabel, timeLabel, timeRange, today } from '@clew/calendar/dates';

/** One entry in a day column: an existing meeting, a drawn proposal or a booked samtal. */
export interface AgendaItem { id: string; title: string; start: string; end: string; allDay: boolean; kind: 'event' | 'proposal' | 'booked'; subtitle?: string; }
type Props = { week: string; days?: number; items: AgendaItem[]; detailed?: boolean; label?: string; dayHeadingLevel?: 2 | 3 | 4 | 5 | 6 };

const color = { event: 'gray', proposal: 'purple', booked: 'green' } as const;
const kindLabel = { event: 'Redan bokat', proposal: 'Förslag', booked: 'Bokat' } as const;

/**
 * The week as an agenda: one Astryx Grid column per weekday, entries in time order. No hour axis and no custom
 * composition: the assistant redraws proposals, the person never drags them. `detailed` is the calendar page.
 */
export function WeekAgenda({ week, days = 5, items, detailed = false, label = 'Veckovy', dayHeadingLevel = 3 }: Props) {
  const current = today();
  const columns = dates(week, days).map(day => ({ day, entries: items.filter(item => occursOn(item, day)).sort((a, b) => a.start.localeCompare(b.start)) }));
  return <VStack gap={2} role="group" aria-label={label}>
    <Grid columns={{ minWidth: detailed ? 160 : 120, max: days }} gap={detailed ? 3 : 2}>
      {columns.map(({ day, entries }) => <VStack key={day} gap={detailed ? 2 : 1}>
        <Heading level={detailed ? 5 : 6} accessibilityLevel={dayHeadingLevel} weight="semibold" color={day === current ? 'accent' : undefined}>{shortDayLabel(day)}</Heading>
        {entries.length === 0 && <Text type="supporting">Ledigt</Text>}
        {detailed
          ? <List density="compact" hasDividers edge="flush">
            {entries.map(item => <ListItem key={item.id}
              label={<Text type="label" hasTabularNumbers>{item.allDay ? 'Hela dagen' : timeRange(item.start, item.end)}</Text>}
              description={<Text type="supporting">{item.title}{item.subtitle ? ` · ${item.subtitle}` : ''}</Text>}
              endContent={item.kind !== 'event' ? <Badge variant={item.kind === 'proposal' ? 'purple' : 'success'} label={kindLabel[item.kind]} /> : undefined} />)}
          </List>
          : entries.map(item => <Token key={item.id} size="sm" color={color[item.kind]} label={`${item.allDay ? 'Hela dagen' : timeLabel(item.start)} ${item.title}`}
            description={`${kindLabel[item.kind]}, ${item.allDay ? 'hela dagen' : timeRange(item.start, item.end)}`} />)}
      </VStack>)}
    </Grid>
    <HStack gap={2} wrap="wrap" role="group" aria-label="Teckenförklaring">
      {(['event', 'proposal', 'booked'] as const).map(kind => <Token key={kind} size="sm" color={color[kind]} label={kindLabel[kind]} />)}
    </HStack>
  </VStack>;
}
export const agendaDay = displayDate;
