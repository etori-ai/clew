import type { Thread } from '@clew/contracts';
import { Card, Heading, HStack, Link, StatusDot, Text, VStack } from '@clew/ui';
import { sinceSentences, type Source } from '../since';

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

/**
 * "Sedan i går" (D53, artboard A): three sentences in the artboard's words, built by `sinceSentences` (D65: a sentence
 * names a few cards and sums the rest). The figures to watch are not repeated here: they stand as the board's key
 * figures (D115 item 4); a source that did not answer is the review line's. "Allt som är klart" leads to the log.
 */
export function Since({ handled, waiting, sources, now, doneHref }: Props) {
  const { doneLine, waitingLine, reviewLine, failed } = sinceSentences({ handled, waiting, sources, now });
  return (
    <Card variant="muted" padding={4}>
      <VStack gap={2} as="section" aria-label="Sedan i går">
        <HStack gap={2} vAlign="center">
          <StatusDot
            variant={failed ? 'warning' : 'success'}
            label={failed ? 'Någon källa svarade inte' : 'Alla källor svarade'}
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
          {reviewLine}
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
