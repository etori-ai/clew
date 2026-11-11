import type { Thread } from '@clew/contracts';
import { Button, CompletionFeedback, HStack, Text, VStack } from '@clew/ui';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { useThreadAction } from '../mutations';
import { threadsQuery } from '../queries';
import { canUndoReceipt, receiptComplete } from '../receipt-state';
import { cardOverPage } from '../panel-address';
import { usePageLocation } from '../page-location';
import { useCountdown } from './card';

/**
 * A live receipt notice: expiry, pending compensation and errors must not leave a stale Undo button. The toast stays
 * until closed (2.2.1), also when the person moves on, so Visa follows them: on Hem it leads to the tab the card went to
 * with the card beside it, on any other page to the card over that page (D110 rule 2).
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
  const where =
    thread.state === 'handled'
      ? ['done', 'Klart']
      : thread.waitingOn
        ? ['waiting', 'Väntar på andra']
        : ['needs-you', 'Behöver dig'];
  const message = `${thread.receipt.headline.replace(/\.$/, '')}. Kortet ligger under ${where[1]}.`;
  return (
    <VStack gap={2}>
      {receiptComplete(thread.receipt) ? <CompletionFeedback title={message} /> : <Text>{message}</Text>}
      <HStack gap={1} wrap="wrap">
        <Button
          size="sm"
          variant="ghost"
          label="Visa"
          href={
            pathname === '/'
              ? `/?tab=${where[0]}&card=${encodeURIComponent(thread.id)}`
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
