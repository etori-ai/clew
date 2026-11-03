import type { TodayView } from '@clew/contracts';
import { Button, Heading, HStack, List, ListItem, Text, VStack } from '@clew/ui';
import { dayLabel, timeRange } from '@clew/calendar/dates';

/** "I dag": the day's meetings in order with the free gaps as their own rows, and one sentence from the assistant. */
export function Today({ view, compact = false }: { view: TodayView; compact?: boolean }) {
  const timed = view.events.filter(e => !e.allDay);
  const rows = [...timed.map(e => ({ kind: 'event' as const, start: e.start, end: e.end, title: e.title })),
    ...view.gaps.map(g => ({ kind: 'gap' as const, start: g.start, end: g.end, title: 'ledigt' }))].sort((a, b) => a.start.localeCompare(b.start));
  const longest = [...view.gaps].sort((a, b) => (Date.parse(b.end) - Date.parse(b.start)) - (Date.parse(a.end) - Date.parse(a.start)))[0];
  const minutes = (g: { start: string; end: string }) => Math.round((Date.parse(g.end) - Date.parse(g.start)) / 60000);
  return <VStack gap={2} as="section" aria-label="I dag">
    <HStack justify="between" vAlign="center" gap={2} wrap="wrap">
      <Heading level={2}>I dag{compact ? '' : ` · ${dayLabel(view.date)}`}</Heading>
      <Button variant="ghost" size="sm" label="Hela veckan" href="/kalender" />
    </HStack>
    <List hasDividers density={compact ? 'compact' : 'balanced'} listStyle="none">
      {rows.length === 0 && <ListItem label="Inga inbokade möten i dag" />}
      {rows.map(row => row.kind === 'event'
        ? <ListItem key={row.start + row.kind} label={<Text weight="semibold" hasTabularNumbers>{timeRange(row.start, row.end)} {row.title}</Text>} />
        : <ListItem key={row.start + row.kind} label={<Text color="secondary" hasTabularNumbers>{timeRange(row.start, row.end)} · {minutes(row)} min ledigt</Text>} />)}
    </List>
    {longest && <Text type="supporting">Luckan {timeRange(longest.start, longest.end)} är den längsta i dag. Jag bokar inget i den utan att fråga.</Text>}
  </VStack>;
}
