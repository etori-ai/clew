import type { Thread } from '@clew/contracts';
import { Button, Card, Heading, HStack, Text, VStack } from '@clew/ui';
import { DOT } from '../../dot';
import { executionStatus } from '../../execution-status';
import { receiptAction } from '../../work-items';
import { useCardAction } from '../work/card';
import { publishedDay } from './news';

/**
 * The work item Hem lifts as its callout: of what needs the person, in Att göra's order, the first that asks for a read
 * receipt, so with several the most urgent one is lifted and the rest stay rows under "Behöver dig".
 */
export const focusOf = (needsYou: readonly Thread[]): Thread | undefined => needsYou.find(t => !!receiptAction(t));

/**
 * Fokusnyhet (D112, amended 2026-11-11, board Hem10): one callout between the box and the blocks, the open work item
 * that asks for the person's read receipt. It says what was published, by whom (the source), when, and that a receipt is
 * required, with "Läs", which leads to the item's page as every row on Hem does (`href`, D126 rule 1), and the item's
 * own receipt action as its button, through the one action path (a dialog only when the
 * action asks something, else one press). It stays until the receipt is given; the receipt's arrival is said by Hem's
 * receipt notice, and for the moment the item keeps its place the callout says the source's answer instead of its
 * buttons. Drawn as the reference draws its focus news (D130 item 13): a card in the theme's blue tint.
 */
export function FocusNews({
  thread,
  href,
  onChange,
}: {
  thread: Thread;
  /** Where "Läs" leads: the item's own page, with the page the callout is on as the way back. */
  href: string;
  onChange: (thread: Thread) => void;
}) {
  const { perform, settling, pressed, error, confirmation, dialog } = useCardAction({ thread, onChange });
  const action = receiptAction(thread);
  if (!action?.acknowledgement) return null;
  const waiting = executionStatus(thread.execution);
  const answered = thread.receipt?.headline;
  const published = publishedDay(action.acknowledgement.publishedAt);
  const waits = waiting && !(settling && pressed === action.id);
  // Under the headline: the source's answer once the receipt is given, what the action waits on while it does, else who
  // published it and that a receipt is asked for.
  const line = answered ?? (waits ? waiting : `${thread.trigger.source}${DOT}läskvitto krävs`);
  const open = thread.state === 'open' && !answered && !waits;
  return (
    <VStack gap={2} as="section" aria-labelledby="fokusnyhet">
      {/* The reference's focus news (D130 item 13): a wide card in the assistant's pale blue, a line in small capitals
          saying what it is and when it was published, the headline large, and its buttons. Clew's news carries no
          picture and no lead, so the card holds none. */}
      <Card variant="blue" padding={8}>
        <VStack gap={4}>
          <VStack gap={1}>
            <Text type="eyebrow" color="primary">{`Fokusnyhet${DOT}${published}`}</Text>
            <Heading id="fokusnyhet" level={2} type="display-3">
              {thread.title}
            </Heading>
            <Text>{line}</Text>
          </VStack>
          <HStack gap={2} vAlign="center" wrap="wrap">
            {open ? (
              <>
                <Button variant="secondary" label="Läs" href={href} />
                <Button
                  variant="primary"
                  label={action.label}
                  isLoading={settling && pressed === action.id}
                  clickAction={async () => {
                    await perform(action);
                  }}
                  data-action={action.id}
                  data-thread={thread.id}
                />
              </>
            ) : (
              <Button variant="secondary" label="Läs" href={href} />
            )}
          </HStack>
        </VStack>
      </Card>
      {error && (
        <Text as="p" role="alert">
          {error}
        </Text>
      )}
      {confirmation}
      {dialog}
    </VStack>
  );
}
