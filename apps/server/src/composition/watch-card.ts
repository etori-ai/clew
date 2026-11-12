import { schema, type Transaction } from '@clew/db';
import type { DurableQueue } from '@clew/db/durable';
import { attentionTx } from '../threads/adapters/attention-postgres';
import type { WatchCard } from '../modules/executions/model';

/**
 * The card a watch leaves when its window ends unseen (D55 item 5), written through the same physical transaction as the
 * step's settlement, as the obligation's follow-up cards are (`followup-store.ts`). The stream admits it like any pushed
 * card (D47): one delivery under the person's automatic attention budget, the message and the audit row. Idempotent by
 * card id, so a retried activity adds nothing. `place` says which connector label and area the card is filed under;
 * `durable` is the queue a deferred delivery's release workflow starts in, with the same commit (D86).
 */
export function watchCardSink(place: (connector: string) => { source: string; area: string }, durable: DurableQueue) {
  return async (tx: Transaction, card: WatchCard) => {
    const { source, area } = place(card.connector);
    const inserted = await tx
      .insert(schema.threads)
      .values({
        id: card.id,
        personId: card.personId,
        sourceAuthorization: card.sourceAuthorization,
        kind: 'pushed',
        topic: card.topic,
        title: card.title,
        state: 'open',
        connector: card.connector,
        area,
        summary: card.summary,
        trigger: { reason: card.reason, source, at: card.at },
        createdAt: new Date(card.at),
        updatedAt: new Date(card.at),
      })
      .onConflictDoNothing()
      .returning({ id: schema.threads.id });
    if (!inserted.length) return;
    await attentionTx(tx, durable).admitDelivery({
      id: `delivery:${card.id}`,
      personId: card.personId,
      threadId: card.id,
      kind: 'automatic',
      at: card.at,
    });
    await tx.insert(schema.threadMessages).values({
      id: `message:${card.id}`,
      threadId: card.id,
      role: 'assistant',
      body: card.summary,
      createdAt: new Date(card.at),
    });
    await tx.insert(schema.audit).values({
      actor: 'system:execution',
      action: 'thread.pushed',
      subject: `thread:${card.id}`,
      createdAt: new Date(card.at),
      details: {
        connector: card.connector,
        topic: card.topic,
        owner: card.personId,
        job: card.jobId,
        step: card.stepId,
      },
    });
  };
}
