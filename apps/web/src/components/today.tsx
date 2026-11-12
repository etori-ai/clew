import { useMemo, type ReactNode } from 'react';
import type { Thread, TodayView } from '@clew/contracts';
import { Card, Heading, HStack, Link, List, ListItem, PROPOSAL_MARK, Text, VStack, agendaItems } from '@clew/ui';
import { timeLabel } from '@clew/calendar/dates';

/**
 * "I dag" (D53, artboard A; D71, artboard 6): a card with the day's meetings in order, each with its time, its name and
 * its length and room, and the free gaps as their own rows ("Ledigt till …"); the longest gap says that the assistant
 * books nothing there without asking. The rows come from `agendaItems()`, the calendar family's one mapping (D32). The
 * calendar is one link away (board Main: "Kalender"). No sentence sums the day up: the rows do. The card stays when the
 * day cannot be read (D116, amended 2026-11-12): the calendar's silence with "Försök igen" stands under the heading, over
 * what was read before if anything was, and a person with no calendar is told so and who connects one, with no warning.
 */
type Props = {
  /** The day as last read, or null when it has not been read. */
  view: TodayView | null;
  /** Every thread the page has: a card whose confirmed proposal made the meeting, a conversation whose chips name it. */
  threads?: Thread[];
  cardHref?: (threadId: string) => string;
  /** What stands under the heading when the day cannot be read now (`SilentNotice`, `NoCalendar`). */
  notice?: ReactNode;
  /** The person has a calendar: the link to Kalender is drawn. */
  calendar?: boolean;
};

/**
 * A person with no calendar (D116, amended 2026-11-12): no warning, what is true and who changes it. `hidden`: the
 * calendar is not switched on for them (D23), which an administrator changes under Anslutna system; otherwise their
 * account has no calendar bound to it, which an administrator binds.
 */
export function NoCalendar({ hidden }: { hidden: boolean }) {
  return (
    <VStack gap={1}>
      <Text as="p">Ingen kalender är kopplad till dig.</Text>
      <Text as="p" type="supporting" color="secondary">
        {hidden
          ? 'En administratör kopplar kalendern under Anslutna system.'
          : 'En administratör kopplar ditt kalenderkonto.'}
      </Text>
    </VStack>
  );
}

export function Today({ view, threads = [], cardHref, notice, calendar = true }: Props) {
  // What a meeting came from (D63, the product owner's choice): the card whose confirmed time it is, and the
  // conversation the meeting was pointed at in ("underlaget ligger i samtalet"), each one link from its row.
  const madeBy = (e: TodayView['events'][number]) =>
    threads.find(t => t.kind === 'pushed' && t.proposals.some(p => p.eventRef === e.ref));
  const talkedIn = (e: TodayView['events'][number]) =>
    threads.find(
      t => t.kind === 'question' && t.messages.some(m => m.meta?.chips?.some(c => c.ref === 'event:' + e.id)),
    );
  const rows = useMemo(
    () =>
      view
        ? agendaItems(
            view.events.filter(e => !e.allDay),
            [],
            view.gaps,
          ).sort((a, b) => a.start.localeCompare(b.start))
        : [],
    [view],
  );
  return (
    <Card padding={4}>
      <VStack gap={1} as="section" aria-label="I dag">
        <HStack justify="between" vAlign="center" gap={2}>
          <Heading level={3} accessibilityLevel={2}>
            I dag
          </Heading>
          {calendar && (
            <Text type="supporting" weight="medium">
              <Link href="/calendar" color="primary" hasUnderline>
                Kalender
              </Link>
            </Text>
          )}
        </HStack>
        {notice}
        {view && (
          <List hasDividers density="balanced" edge="flush" listStyle="none">
            {rows.length === 0 && <ListItem label={<Text color="secondary">Inga inbokade möten i dag</Text>} />}
            {rows.map(row => {
              if (row.kind === 'gap')
                return (
                  <ListItem
                    key={row.id}
                    startContent={
                      <VStack width={52}>
                        <Text weight="medium" color="secondary" hasTabularNumbers>
                          {timeLabel(row.start)}
                        </Text>
                      </VStack>
                    }
                    label={<Text color="secondary">{row.title}</Text>}
                    description={row.meta ? <Text type="supporting">{row.meta}</Text> : undefined}
                  />
                );
              const card = row.event && madeBy(row.event),
                talk = row.event && talkedIn(row.event);
              return (
                <ListItem
                  key={row.id}
                  startContent={
                    <VStack width={52}>
                      <Text weight="semibold" hasTabularNumbers>
                        {timeLabel(row.start)}
                      </Text>
                    </VStack>
                  }
                  label={
                    <Text weight="semibold">
                      {row.marker && <Text aria-hidden="true">{`${PROPOSAL_MARK} `}</Text>}
                      {row.title}
                    </Text>
                  }
                  description={
                    <Text type="supporting">
                      {row.meta}
                      {talk && (
                        <>
                          {' · '}
                          <Link href={`/conversations/${talk.id}`} color="secondary" hasUnderline>
                            underlaget ligger i samtalet
                          </Link>
                        </>
                      )}
                      {card && cardHref && (
                        <>
                          {' · '}
                          <Link href={cardHref(card.id)} color="secondary" hasUnderline>
                            från ärendet {card.title}
                          </Link>
                        </>
                      )}
                    </Text>
                  }
                />
              );
            })}
          </List>
        )}
      </VStack>
    </Card>
  );
}
