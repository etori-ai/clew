import type { ReactNode } from 'react';
import { useLocation } from 'react-router';
import type { Thread } from '@clew/contracts';
import { Button, StatusRow, Text, type RowStatus } from '@clew/ui';
import { reviewHref } from '../../review-address';
import { useReviewDraft } from '../../review-session';
import { rowStep } from '../../row-step';
import { useCardAction, useItemStatus } from './card';

/**
 * A work item as a row of Hem's "Behöver dig" (D130 item 13) whose button names the next press (D142, `rowStep`):
 * "Öppna" to the item's page; "Granska N" to the same page where it is the review of the item's rows; or the item's
 * one decision itself, run from the row when there is nothing to read first (D70 item 1), through the same path as on
 * the item (`useCardAction`: the decision endpoint, the wait for the source, D45/D47). The row then keeps its place
 * with the receipt for a moment and the toast offers Ångra, as Hem already does for a receipt that arrives.
 */
export function NeedRow({
  thread,
  id,
  status,
  meta,
  href,
  end,
}: {
  thread: Thread;
  id?: string;
  status: RowStatus;
  meta: ReactNode;
  /** The item's page. */
  href: string;
  end?: ReactNode;
}) {
  const { pathname, search } = useLocation();
  const itemStatus = useItemStatus(thread);
  const plain = itemStatus.kind === 'needs-you' && !itemStatus.notice && !itemStatus.noDecision;
  const reviewed = thread.actions.some(a => a.role === 'primary' && a.review === 'each');
  const [draft] = useReviewDraft(reviewed && thread.state === 'open' ? thread : undefined);
  const step = rowStep(thread, plain, draft);
  const { perform, settling, pressed, error, confirmation } = useCardAction({ thread, onChange: () => {} });
  return (
    <>
      <StatusRow
        {...(id ? { id } : {})}
        status={status}
        title={thread.title}
        meta={meta}
        href={href}
        end={end}
        {...(step.kind === 'review'
          ? {
              open: {
                label: step.label,
                href: reviewHref(thread.id, {
                  from: pathname + search,
                  ...(step.step !== undefined ? { step: step.step } : {}),
                }),
              },
            }
          : {})}
        {...(step.kind === 'press'
          ? {
              action: (
                <Button
                  size="sm"
                  variant="secondary"
                  label={step.action.label}
                  aria-label={`${step.action.label}: ${thread.title}`}
                  isLoading={settling && pressed === step.action.id}
                  clickAction={async () => {
                    await perform(step.action, []);
                  }}
                  data-action={step.action.id}
                  data-thread={thread.id}
                />
              ),
            }
          : {})}
      />
      {error && (
        <Text as="p" role="alert" color="accent">
          {error}
        </Text>
      )}
      {confirmation}
    </>
  );
}
