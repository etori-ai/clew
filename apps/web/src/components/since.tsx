import { dayRhythm, nextStockholmTime, replySummary, snoozeWhen, type Thread } from '@clew/contracts';
import { Card, Heading, HStack, Link, StatusDot, Text, VStack } from '@clew/ui';
import { timeLabel } from '@clew/calendar/dates';

type Source = { connector: string; state: string; lastSuccess: string | null; error: string | null };
type Props = {
  /** Done or dismissed since the day began, newest first. */
  handled: Thread[];
  /** Open, but waiting on someone else. */
  waiting: Thread[];
  /** Every source's state from the last read of the cards, when the page has it. */
  sources?: Source[] | undefined;
  now: string;
  /** Where the log is: the Klart tab. */
  doneHref: string;
};
const when = (t: Thread) => t.handledAt ?? t.updatedAt;
const lower = (s: string) => (s ? s[0]!.toLowerCase() + s.slice(1) : s);
const words = ['', 'en', 'två', 'tre', 'fyra', 'fem', 'sex', 'sju', 'åtta', 'nio', 'tio', 'elva', 'tolv'];
const count = (n: number) => words[n] ?? String(n);
/** "a, b och c". */
const join = (parts: string[]) =>
  parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} och ${parts.at(-1)}`;

/**
 * "Sedan i går" (D53, artboard A): three sentences in the artboard's words. What closed since the day began, with the
 * receipt's time where the source read it back; what still waits on someone else, with how many have answered; and when
 * the assistant next goes through everything, with whether every source answered. "Allt som är klart" leads to the log.
 */
export function Since({ handled, waiting, sources, now, doneHref }: Props) {
  const done = [...handled].sort((a, b) => when(b).localeCompare(when(a)));
  const review = nextStockholmTime(now, dayRhythm.review);
  const doneLine =
    done.length > 0 &&
    `${done.length} ${done.length === 1 ? 'klar' : 'klara'}: ${join(
      done.map(t =>
        t.state === 'dismissed'
          ? `${lower(t.title)}, avfärdad ${timeLabel(when(t))}`
          : t.receipt
            ? `${lower(t.title)}, kvitto läst från ${lower(t.trigger.source)} ${timeLabel(t.receipt.at)}`
            : `${lower(t.title)} ${timeLabel(when(t))}`,
      ),
    )}.`;
  const waitingLine =
    waiting.length > 0 &&
    `${waiting.length} väntar på andra: ${join(
      waiting.map(t => {
        const sum = t.proposals.length ? replySummary(t.proposals) : null;
        return sum && sum.total > 0
          ? `${lower(t.title)} (${sum.accepted + sum.declined} av ${sum.total} har svarat)`
          : lower(t.title);
      }),
    )}.`;
  const failed = sources?.filter(s => s.error || !s.lastSuccess) ?? [];
  const sourcesLine = !sources?.length
    ? ''
    : failed.length === 0
      ? ` Alla ${count(sources.length)} källor svarade i natt.`
      : ` ${count(failed.length)[0]!.toUpperCase()}${count(failed.length).slice(1)} ${failed.length === 1 ? 'källa' : 'källor'} svarade inte.`;
  return (
    <Card variant="muted" padding={4}>
      <VStack gap={2} as="section" aria-label="Sedan i går">
        <HStack gap={2} vAlign="center">
          <StatusDot
            variant={failed.length ? 'warning' : 'success'}
            label={failed.length ? 'Någon källa svarade inte' : 'Alla källor svarade'}
          />
          <Heading level={3} accessibilityLevel={2}>
            Sedan i går
          </Heading>
        </HStack>
        {!doneLine && !waitingLine && (
          <Text as="p" color="secondary">
            Inget är klart och inget väntar på andra.
          </Text>
        )}
        {doneLine && (
          <Text as="p" color="secondary">
            {doneLine}
          </Text>
        )}
        {waitingLine && (
          <Text as="p" color="secondary">
            {waitingLine}
          </Text>
        )}
        <Text as="p" color="secondary">
          Nästa genomgång {snoozeWhen(review, now)}.{sourcesLine}
        </Text>
        <Text type="supporting" weight="medium">
          <Link href={doneHref} color="primary" hasUnderline>
            Allt som är klart
          </Link>
        </Text>
      </VStack>
    </Card>
  );
}
