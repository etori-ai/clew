import { dayRhythm, nextStockholmTime, snoozeWhen, type Thread } from '@clew/contracts';
import { Heading, Icon, List, ListItem, Text, VStack } from '@clew/ui';
import { timeLabel } from '@clew/calendar/dates';

type Props = {
  /** Done or dismissed since the day began, newest first. */
  handled: Thread[];
  /** Open, but waiting on someone else. */
  waiting: Thread[];
  now: string;
  /** Where a waiting card opens: beside the column. */
  cardHref: (threadId: string) => string;
  /** Where the log is: the Klart tab. */
  doneHref: string;
};
const when = (t: Thread) => t.handledAt ?? t.updatedAt;

/**
 * "Sedan i går" (D53, artboard A): what closed since the day began and what still waits on someone else, each a row
 * that leads to where it is, and when the assistant next goes through everything. No sentence sums it up: the rows
 * are the summary, and a person who wants one in words asks the box.
 */
export function Since({ handled, waiting, now, cardHref, doneHref }: Props) {
  const done = [...handled].sort((a, b) => when(b).localeCompare(when(a)));
  const review = nextStockholmTime(now, dayRhythm.review);
  return (
    <VStack gap={2} as="section" aria-label="Sedan i går">
      <Heading level={2}>Sedan i går</Heading>
      {done.length === 0 && waiting.length === 0 ? (
        <Text type="supporting">Inget är klart och inget väntar på andra.</Text>
      ) : (
        <List hasDividers density="compact" listStyle="none">
          {done.map(t => (
            <ListItem
              key={t.id}
              startContent={
                <Icon
                  icon={t.state === 'dismissed' ? 'close' : 'check'}
                  color={t.state === 'dismissed' ? 'secondary' : 'success'}
                />
              }
              label={<Text weight="semibold">{t.title}</Text>}
              description={
                <Text type="supporting" hasTabularNumbers>
                  {t.state === 'dismissed' ? 'Avfärdad' : 'Klart'} {timeLabel(when(t))}
                </Text>
              }
              href={doneHref}
            />
          ))}
          {waiting.map(t => (
            <ListItem
              key={t.id}
              startContent={<Icon icon="clock" color="secondary" />}
              label={<Text weight="semibold">{t.title}</Text>}
              description={<Text type="supporting">Väntar på {t.waitingOn}</Text>}
              href={cardHref(t.id)}
            />
          ))}
        </List>
      )}
      <Text type="supporting">Nästa genomgång {snoozeWhen(review, now)}.</Text>
    </VStack>
  );
}
