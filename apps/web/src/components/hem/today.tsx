import { useMemo, type ReactNode } from 'react';
import type { Thread, TodayView } from '@clew/contracts';
import {
  Card,
  Divider,
  Heading,
  HStack,
  Link,
  List,
  ListItem,
  PROPOSAL_MARK,
  Skeleton,
  Text,
  VStack,
  VisuallyHidden,
  agendaItems,
} from '@clew/ui';
import { timeLabel } from '@clew/calendar/dates';

/**
 * "I dag" on Hem (D53, D71; D126, board Hem): the heading with the way to Kalender beside it (`TodayHeading`), and under
 * it a card with the day's meetings in order, each with its time, its name and its room, and the free gaps as their own
 * rows ("Ledigt till …") (`TodayCard`). The rows come from `agendaItems()`, the calendar family's one mapping (D32). No
 * sentence sums the day up: the rows do. The card stays when the day cannot be read (D116, amended 2026-11-12): the
 * calendar's silence with "Försök igen" stands in it, over what was read before if anything was, and a person with no
 * calendar is told so and who connects one, with no warning. Hem lays the heading and the card out itself, so the card
 * is as tall as Behöver dig's beside it.
 */
type Props = {
  /** The day as last read, or null when it has not been read. */
  view: TodayView | null;
  /** Every thread the page has: a card whose confirmed proposal made the meeting, a conversation whose chips name it. */
  threads?: Thread[];
  /** A work item's page (D126 rule 1): where "från ärendet …" on a meeting leads. */
  itemHref?: (threadId: string) => string;
  /** What stands in the card when the day cannot be read now (`SilentNotice`, `NoCalendar`). */
  notice?: ReactNode;
  /** The day without a card of its own: the content of a board's card (D130). */
  bare?: boolean;
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

/** The block's heading line, the same while the day is read and once it has arrived, so the block does not move. */
export function TodayHeading({ calendar = true }: { calendar?: boolean }) {
  return (
    <HStack justify="between" vAlign="center" gap={2} wrap="wrap">
      <Heading id="i-dag" level={2}>
        I dag
      </Heading>
      {calendar && <Link href="/calendar">Kalender</Link>}
    </HStack>
  );
}

/** The width of the time column: "08:30" in the row's semibold figures, the same for every row so the names line up. */
const TIME_WIDTH = 52;
/** The time at the start of a row, as wide for every row so the names line up. */
const At = ({ at, quiet = false }: { at: string; quiet?: boolean }) => (
  <VStack width={TIME_WIDTH}>
    <Text weight="semibold" color={quiet ? 'secondary' : undefined} hasTabularNumbers>
      {timeLabel(at)}
    </Text>
  </VStack>
);

/** The card's placeholder while the day is read: rows in the agenda's shape, the time column as wide as the rows'. */
export function TodayCardSkeleton() {
  return (
    <Card padding={4}>
      <VisuallyHidden role="status">Hämtar i dag …</VisuallyHidden>
      {Array.from({ length: 3 }, (_, i) => (
        <VStack key={i} gap={0}>
          {i > 0 && <Divider />}
          <HStack gap={3} paddingBlock={3}>
            <VStack width={TIME_WIDTH}>
              <Skeleton height={18} width={40} index={i} />
            </VStack>
            <VStack gap={1.5} width="100%">
              <Skeleton height={18} width="85%" index={i} />
              <Skeleton height={14} width="60%" index={i} />
            </VStack>
          </HStack>
        </VStack>
      ))}
    </Card>
  );
}

/** The day's card, filling the height Hem gives it (the row it shares with Behöver dig). */
export function TodayCard({ view, threads = [], itemHref, notice, bare = false }: Props) {
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
  const body = (
    <>
      {notice && <VStack padding={4}>{notice}</VStack>}
      {view && (
        <List hasDividers aria-label="Dagens möten">
          {rows.length === 0 && <ListItem label={<Text color="secondary">Inga inbokade möten i dag</Text>} />}
          {rows.map(row => {
            if (row.kind === 'gap')
              return (
                <ListItem
                  key={row.id}
                  startContent={<At at={row.start} quiet />}
                  label={<Text color="secondary">{row.title}</Text>}
                  description={row.meta ? <Text type="supporting">{row.meta}</Text> : undefined}
                />
              );
            const card = row.event && madeBy(row.event),
              talk = row.event && talkedIn(row.event);
            return (
              <ListItem
                key={row.id}
                startContent={<At at={row.start} />}
                label={
                  <Text>
                    {row.marker && <Text aria-hidden="true">{`${PROPOSAL_MARK} `}</Text>}
                    {row.title}
                  </Text>
                }
                description={
                  <Text type="supporting">
                    {row.meta}
                    {talk && (
                      <>
                        {' · '}
                        <Link href={`/conversations/${talk.id}`} color="secondary" hasUnderline>
                          underlaget ligger i samtalet
                        </Link>
                      </>
                    )}
                    {card && itemHref && (
                      <>
                        {' · '}
                        <Link href={itemHref(card.id)} color="secondary" hasUnderline>
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
    </>
  );
  // In a board's card (D130) the day is the card's content; elsewhere it is a card of its own.
  return bare ? (
    body
  ) : (
    <Card padding={0} height="100%">
      {body}
    </Card>
  );
}
