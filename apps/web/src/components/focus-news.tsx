import type { CardAction, Thread } from '@clew/contracts';
import { Banner, BellIcon, Button, HStack, Icon, Text, VStack } from '@clew/ui';
import { executionStatus } from '../execution-status';
import { itemHref } from '../work-items';
import { useCardAction } from './card';
import { publishedDay } from './news';

/** The execute a work item marks as the person's read receipt (D112, amended 2026-11-11), when it has one. */
export const receiptAction = (thread: Thread): CardAction | undefined =>
  thread.actions.find(a => a.kind === 'execute' && !!a.acknowledgement);
/**
 * The work item Hem lifts as its callout: of what needs the person, in Att göra's order, the first that asks for a read
 * receipt, so with several the most urgent one is lifted and the rest stay rows under "Behöver dig".
 */
export const focusOf = (needsYou: readonly Thread[]): Thread | undefined => needsYou.find(t => !!receiptAction(t));

/**
 * Fokusnyhet (D112, amended 2026-11-11, board Hem10): one callout between the box and the blocks, the open work item
 * that asks for the person's read receipt. It says what was published, by whom (the source), when, and that a receipt is
 * required, with "Läs", which opens the item in Att göra as every row on Hem does, and the item's own receipt action
 * as its button, through the one action path (a dialog only when the action asks something, else one press). It stays
 * until the receipt is given; the receipt's arrival is said by Hem's receipt notice, and for the moment the item keeps
 * its place the callout says the source's answer instead of its buttons. Astryx's `Banner` in its card container.
 */
export function FocusNews({ thread, onChange }: { thread: Thread; onChange: (thread: Thread) => void }) {
  const { perform, settling, pressed, error, confirmation, dialog } = useCardAction({ thread, onChange });
  const action = receiptAction(thread);
  if (!action?.acknowledgement) return null;
  const waiting = executionStatus(thread.execution);
  const answered = thread.receipt?.headline;
  const description =
    answered ??
    (waiting && !(settling && pressed === action.id)
      ? waiting
      : `${thread.trigger.source}\u00a0· publicerad ${publishedDay(action.acknowledgement.publishedAt)}\u00a0· läskvitto krävs`);
  const open = thread.state === 'open' && !answered && !(waiting && !(settling && pressed === action.id));
  return (
    <VStack gap={2} as="section" aria-label="Viktigt">
      <Banner
        status="info"
        icon={<Icon icon={BellIcon} color="inherit" />}
        title={thread.title}
        description={description}
        endContent={
          open ? (
            <HStack gap={2} vAlign="center" wrap="wrap">
              <Button variant="secondary" label="Läs" href={itemHref(thread.id)} />
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
            </HStack>
          ) : (
            <Button variant="secondary" label="Läs" href={itemHref(thread.id)} />
          )
        }
      />
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
