import type { Thread, TodayView } from '@clew/contracts';
import { Card, Heading, HStack, Link, List, ListItem, Text, VStack } from '@clew/ui';
import { timeLabel } from '@clew/calendar/dates';

const minutes = (g: { start: string; end: string }) => Math.round((Date.parse(g.end) - Date.parse(g.start)) / 60000);
/** How long a meeting is, as the artboard writes it: "30 min", "1 tim", "1,5 tim". */
const duration = (m: number) =>
  m < 60 ? `${m} min` : `${(m / 60).toLocaleString('sv-SE', { maximumFractionDigits: 1 })} tim`;

/**
 * "I dag" (D53, artboard A): a card with the day's meetings in order, each with its time, its name and its room and
 * length, and the free gaps as their own rows ("Ledigt till …"); the longest gap says that the assistant books nothing
 * there without asking. The week is one link away. No sentence sums the day up: the rows do.
 */
type Props = {
  view: TodayView;
  /** Every thread the page has: a card whose confirmed proposal made the meeting, a conversation whose chips name it. */
  threads?: Thread[];
  cardHref?: (threadId: string) => string;
};
export function Today({ view, threads = [], cardHref }: Props) {
  // What a meeting came from (D63, the product owner's choice): the card whose confirmed time it is, and the
  // conversation the meeting was pointed at in ("underlaget ligger i samtalet"), each one link from its row.
  const madeBy = (e: TodayView['events'][number]) =>
    threads.find(t => t.kind === 'pushed' && t.proposals.some(p => p.eventRef === e.ref));
  const talkedIn = (e: TodayView['events'][number]) =>
    threads.find(
      t => t.kind === 'question' && t.messages.some(m => m.meta?.chips?.some(c => c.ref === 'event:' + e.id)),
    );
  const timed = view.events.filter(e => !e.allDay);
  const longest = view.gaps.reduce<(typeof view.gaps)[number] | null>(
    (best, g) => (best && minutes(best) >= minutes(g) ? best : g),
    null,
  );
  const rows = [
    ...timed.map(e => ({
      kind: 'event' as const,
      start: e.start,
      end: e.end,
      title: e.title,
      room: e.room,
      card: madeBy(e),
      talk: talkedIn(e),
    })),
    ...view.gaps.map(g => ({
      kind: 'gap' as const,
      start: g.start,
      end: g.end,
      title: '',
      room: '',
      card: undefined,
      talk: undefined,
    })),
  ].sort((a, b) => a.start.localeCompare(b.start));
  return (
    <Card padding={4}>
      <VStack gap={1} as="section" aria-label="I dag">
        <HStack justify="between" vAlign="center" gap={2}>
          <Heading level={3} accessibilityLevel={2}>
            I dag
          </Heading>
          <Text type="supporting" weight="medium">
            <Link href="/calendar" color="primary" hasUnderline>
              Hela veckan
            </Link>
          </Text>
        </HStack>
        <List hasDividers density="balanced" edge="flush" listStyle="none">
          {rows.length === 0 && <ListItem label={<Text color="secondary">Inga inbokade möten i dag</Text>} />}
          {rows.map(row =>
            row.kind === 'event' ? (
              <ListItem
                key={row.start + row.kind}
                startContent={
                  <VStack width={52}>
                    <Text weight="semibold" hasTabularNumbers>
                      {timeLabel(row.start)}
                    </Text>
                  </VStack>
                }
                label={<Text weight="semibold">{row.title}</Text>}
                description={
                  <Text type="supporting">
                    {[row.room, duration(minutes(row))].filter(Boolean).join(' · ')}
                    {row.talk && (
                      <>
                        {' · '}
                        <Link href={`/conversations/${row.talk.id}`} color="secondary" hasUnderline>
                          underlaget ligger i samtalet
                        </Link>
                      </>
                    )}
                    {row.card && cardHref && (
                      <>
                        {' · '}
                        <Link href={cardHref(row.card.id)} color="secondary" hasUnderline>
                          från kortet {row.card.title}
                        </Link>
                      </>
                    )}
                  </Text>
                }
              />
            ) : (
              <ListItem
                key={row.start + row.kind}
                startContent={
                  <VStack width={52}>
                    <Text weight="medium" color="secondary" hasTabularNumbers>
                      {timeLabel(row.start)}
                    </Text>
                  </VStack>
                }
                label={<Text color="secondary">Ledigt till {timeLabel(row.end)}</Text>}
                description={
                  longest && longest.start === row.start ? (
                    <Text type="supporting">Längsta luckan · jag bokar inget här utan att fråga</Text>
                  ) : undefined
                }
              />
            ),
          )}
        </List>
      </VStack>
    </Card>
  );
}
