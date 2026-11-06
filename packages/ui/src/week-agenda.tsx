import { Grid } from '@astryxdesign/core/Grid';
import { VStack, HStack } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';
import { Token } from '@astryxdesign/core/Token';
import { ProgressBar } from '@astryxdesign/core/ProgressBar';
import { VisuallyHidden } from '@astryxdesign/core/VisuallyHidden';
import { dates, displayDate, occursOn, shortDayLabel, timeLabel, timeRange, today } from '@clew/calendar/dates';
import { dayLoad } from '@clew/calendar/proposals';
import { PROPOSAL_MARK, type AgendaItem } from './agenda-items';

export type { AgendaItem };
type Props = { week: string; days?: number; items: AgendaItem[]; label?: string };

// The proposal is the assistant's blue (D71, artboard 6), the only blue in the calendar; a booked samtal is a status, green.
const color = { proposal: 'blue', booked: 'green' } as const;
const kindLabel = { event: 'Redan bokat', proposal: 'Förslag', booked: 'Bokat' } as const;

/**
 * The week as an agenda on a start-page card (D27 §6, D32): an Astryx Grid of up to five columns that folds rather than
 * pushes the last day out of the card, the day as a label ranked by weight, entries in time order. What is new is a
 * token, what is already booked is a plain line that can wrap: the same meeting five times over is context, not news.
 * No hour axis and no custom composition; the calendar page and the embeds are `EventCalendar`.
 */
export function WeekAgenda({ week, days = 5, items, label = 'Veckovy' }: Props) {
  const current = today();
  const columns = dates(week, days).map(day => ({
    day,
    entries: items
      .filter(item => item.kind !== 'gap' && occursOn(item, day))
      .sort((a, b) => a.start.localeCompare(b.start)),
  }));
  return (
    <VStack gap={2} role="group" aria-label={label}>
      <Grid columns={{ minWidth: 96, max: days }} gap={2}>
        {columns.map(({ day, entries }) => (
          <VStack key={day} gap={1}>
            <Text weight="semibold" color={day === current ? 'accent' : undefined}>
              {shortDayLabel(day)}
            </Text>
            {/* The load of the day (D30): busy minutes of the office day, from what is already drawn, so a full day reads as full before anything is sent. */}
            {(() => {
              const load = dayLoad(
                day,
                entries.filter(e => !e.allDay),
              );
              const hours = Math.round(load.busyMinutes / 6) / 10;
              return (
                <ProgressBar
                  label={`Belastning ${shortDayLabel(day)}: ${hours} av 9 timmar upptagna`}
                  isLabelHidden
                  value={load.busyMinutes}
                  max={540}
                  variant={load.share > 0.8 ? 'warning' : 'neutral'}
                />
              );
            })()}
            {entries.length === 0 && <Text type="supporting">Ledigt</Text>}
            {entries.map(item => {
              const label = `${item.allDay ? 'Hela dagen' : timeLabel(item.start)} ${item.marker ? `${item.marker} ` : ''}${item.short ?? item.title}`;
              return item.kind === 'event' || item.kind === 'gap' ? (
                <Text key={item.id} type="supporting">
                  {label}
                  <VisuallyHidden> · {kindLabel.event}</VisuallyHidden>
                </Text>
              ) : (
                <Token
                  key={item.id}
                  size="sm"
                  color={color[item.kind]}
                  label={label}
                  description={`${item.title}${item.subtitle ? ` · ${item.subtitle}` : ''}: ${kindLabel[item.kind]}, ${item.allDay ? 'hela dagen' : timeRange(item.start, item.end)}`}
                />
              );
            })}
          </VStack>
        ))}
      </Grid>
      <HStack gap={2} wrap="wrap" role="group" aria-label="Teckenförklaring">
        {(['proposal', 'booked'] as const).map(kind => (
          <Token
            key={kind}
            size="sm"
            color={color[kind]}
            label={kind === 'proposal' ? `${PROPOSAL_MARK} ${kindLabel[kind]}` : kindLabel[kind]}
          />
        ))}
      </HStack>
    </VStack>
  );
}
export const agendaDay = displayDate;
