import type { Thread } from '@clew/contracts';
import { Button, CompletionFeedback, HStack, Text, VStack } from '@clew/ui';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { useThreadAction } from '../mutations';
import { threadsQuery } from '../queries';
import { canUndoReceipt, receiptComplete } from '../receipt-state';
import { cardOverPage } from '../panel-address';
import { usePageLocation } from '../page-location';
import { todoHref, type TodoTab } from '../work-items';
import { useCountdown } from './card';

/** Where an item with a receipt lies now: the pile's address and its name. */
const pileOf = (thread: Thread) =>
  thread.state === 'handled'
    ? (['done', 'Klart'] as const)
    : thread.waitingOn
      ? (['waiting', 'Väntar på andra'] as const)
      : (['needs-you', 'Behöver dig'] as const);
/** What the notice says: the source's headline read back and the pile the item went to. */
export const receiptMessage = (thread: Thread & { receipt: NonNullable<Thread['receipt']> }) =>
  `${thread.receipt.headline.replace(/\.$/, '')}. Ärendet ligger under ${pileOf(thread)[1]}.`;

/**
 * A live receipt notice: expiry, pending compensation and errors must not leave a stale Undo button. The toast stays
 * until closed (2.2.1), also when the person moves on, so Visa follows them: on Hem and Att göra it leads to the pile
 * the item went to with the item in the reading pane (D112), on any other page to the card over that page (D111 rule 2).
 */
export function ReceiptNotice({
  threadId,
  onChange,
  dismiss,
}: {
  threadId: string;
  onChange: (thread: Thread) => void;
  dismiss: () => void;
}) {
  const { data } = useQuery(threadsQuery);
  const thread = data?.threads.find(t => t.id === threadId);
  const { run, error } = useThreadAction({ onChange });
  const countdown = useCountdown(thread?.receipt?.undoUntil ?? null);
  const { pathname, search } = usePageLocation();
  if (!thread?.receipt) return null;
  const where = pileOf(thread);
  const message = receiptMessage({ ...thread, receipt: thread.receipt });
  return (
    <VStack gap={2}>
      {receiptComplete(thread.receipt) ? <CompletionFeedback title={message} /> : <Text>{message}</Text>}
      <HStack gap={1} wrap="wrap">
        <Button
          size="sm"
          variant="ghost"
          label="Visa"
          href={
            pathname === '/' || pathname === '/todo'
              ? todoHref({ tab: where[0] satisfies TodoTab, item: thread.id })
              : cardOverPage(pathname, search, thread.id)
          }
        />
        {countdown && canUndoReceipt(thread) && (
          <Button
            size="sm"
            variant="ghost"
            label="Ångra"
            clickAction={() =>
              run(
                async () => {
                  const next = await api.undoReceipt(thread.id);
                  dismiss();
                  return next;
                },
                { settle: true },
              )
            }
          />
        )}
      </HStack>
      {error && (
        <Text as="p" role="alert">
          {error}
        </Text>
      )}
    </VStack>
  );
}
