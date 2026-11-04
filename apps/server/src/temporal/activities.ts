import { and, eq } from 'drizzle-orm';
import { database, schema } from '@clew/db';
import { addMessage, writeAudit } from '@clew/db/threads';
import type { ReminderInput } from './workflows';

const clock = (iso: string) => new Date(iso).toLocaleTimeString('sv-SE', { timeZone: 'Europe/Stockholm', timeStyle: 'short' });

/**
 * A reminder brings the card back; it never creates a second one (D17). The thread is reopened if it was dismissed
 * or snoozed meanwhile, marked `remindedAt` so it sorts first under "Nu" for the day, and its trigger says why it is
 * back. A card already handled with a receipt is left alone: the work is done. Idempotent: a retried activity sees
 * `remindedAt` already at or after the fire time and does nothing.
 */
export async function surfaceReminder(input: ReminderInput): Promise<'surfaced' | 'skipped'> {
  const now = new Date();
  return database().transaction(async tx => {
    const [row] = await tx.select().from(schema.threads).where(and(eq(schema.threads.id, input.threadId), eq(schema.threads.personId, input.personId))).for('update');
    if (!row || row.receipt) return 'skipped';
    if (row.remindedAt && row.remindedAt.getTime() >= Date.parse(input.requestedAt) + input.seconds * 1000) return 'skipped';
    const asked = clock(input.requestedAt);
    await tx.update(schema.threads).set({
      state: 'open', handledAt: null, waitingOn: row.waitingOn && !row.waitingOn.startsWith('påminnelsen ') && row.waitingOn !== 'i morgon 06:00' ? row.waitingOn : null, remindedAt: now, updatedAt: now,
      trigger: { reason: `Du bad ${asked} om en påminnelse · ${row.trigger.reason}`, source: row.trigger.source, at: now.toISOString() },
    }).where(eq(schema.threads.id, row.id));
    await addMessage(tx, row.id, 'assistant', `Påminnelse: du bad ${asked} om att få det här kortet igen.`);
    await writeAudit(tx, { actor: 'assistant:reminder', action: 'thread.reminded', subject: 'thread:' + row.id, details: { requestedAt: input.requestedAt, seconds: input.seconds, wasState: row.state, owner: input.personId } });
    return 'surfaced';
  });
}
