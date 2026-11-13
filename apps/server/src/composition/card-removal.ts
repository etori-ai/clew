import { inArray, type SQL } from 'drizzle-orm';
import { schema, type Transaction } from '@clew/db';
import type { ThreadTx } from '../threads/model';

/**
 * Remove the cards `which` selects, with everything that hangs on them, in the thread store's transaction: what an
 * erasure of one person removes from the stream (D96 item 10, D108 item 14). Every running wait ends after the commit, as
 * a replaced generation's does; messages, proposals, timers, deliveries and follow-up policies cascade with the card; a
 * work occurrence only loses its pointer, so it goes here; and each card gets one `thread.removed` row by `actor`.
 * Returns the ids removed, in id order. Cards are locked in id order, as every other write of several cards takes them.
 */
export async function removeCards(
  tx: Transaction,
  thread: Pick<ThreadTx, 'cancelTimer' | 'writeAudit'>,
  which: SQL | undefined,
  actor: string,
  at: string,
): Promise<string[]> {
  const cards = await tx
    .select({ id: schema.threads.id })
    .from(schema.threads)
    .where(which)
    .orderBy(schema.threads.id)
    .for('update');
  if (!cards.length) return [];
  const ids = cards.map(c => c.id);
  const timers = await tx
    .select({ id: schema.timerIntents.id })
    .from(schema.timerIntents)
    .where(inArray(schema.timerIntents.threadId, ids))
    .orderBy(schema.timerIntents.id)
    .for('update');
  for (const timer of timers) await thread.cancelTimer(timer.id, at);
  await tx.delete(schema.workOccurrences).where(inArray(schema.workOccurrences.threadId, ids));
  await tx.delete(schema.threads).where(inArray(schema.threads.id, ids));
  for (const id of ids)
    await thread.writeAudit({
      actor,
      action: 'thread.removed',
      subject: `thread:${id}`,
      at,
      details: { reason: 'erasure' },
    });
  return ids;
}
