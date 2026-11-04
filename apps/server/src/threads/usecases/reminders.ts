import type { AuthenticatedContext } from '@clew/contracts';
import { eq } from 'drizzle-orm';
import { database, schema } from '@clew/db';
import { addMessage, readThread, writeAudit } from '@clew/db/threads';
import { InputError } from '../../context';
import { TASK_QUEUE, temporalClient } from '../../temporal/client';
import type { reminder } from '../../temporal/workflows';

export const MAX_REMINDER_SECONDS = 24 * 60 * 60;
const clock = (d: Date) => d.toLocaleTimeString('sv-SE', { timeZone: 'Europe/Stockholm', timeStyle: 'short' });
/** The waiting label while a reminder is pending; the card sits under "Pågår utan dig" until the timer brings it back. */
export const reminderWaiting = (fireAt: Date) => `påminnelsen ${clock(fireAt)}`;
const isReminderWaiting = (waitingOn: string | null) => !!waitingOn && waitingOn.startsWith('påminnelsen ');

/**
 * "Påminn mig …" on a card (D17): start a reminder workflow for this person about this thread and park the card
 * under "Pågår utan dig" until it fires. The workflow id is the thread plus the request time, so two reminders on
 * the same card are two timers. Audited like any mutation.
 */
export async function remind(persona: AuthenticatedContext, threadId: string, seconds: number) {
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > MAX_REMINDER_SECONDS) throw new InputError('Ogiltig tid för påminnelsen.');
  const found = await readThread(persona.id, threadId);
  if (!found) throw new InputError('Tråden finns inte.');
  if (found.thread.state !== 'open') throw new InputError('Tråden är redan hanterad.');
  let client; try { client = await temporalClient(); } catch { throw new InputError('Påminnelser är inte tillgängliga just nu.'); }
  const now = new Date();
  const workflowId = `reminder:${threadId}:${now.getTime()}`;
  const fireAt = new Date(now.getTime() + seconds * 1000);
  await client.workflow.start<typeof reminder>('reminder', {
    taskQueue: TASK_QUEUE, workflowId,
    args: [{ personId: persona.id, threadId, title: found.thread.title, area: found.thread.area, seconds, requestedAt: now.toISOString() }],
  });
  await database().transaction(async tx => {
    await tx.update(schema.threads).set({ waitingOn: reminderWaiting(fireAt), updatedAt: now }).where(eq(schema.threads.id, threadId));
    await addMessage(tx, threadId, 'user', `Påminn mig ${clock(fireAt)}`);
    await writeAudit(tx, { actor: persona.principal.id, action: 'reminder.set', subject: 'thread:' + threadId, details: { workflowId, seconds, fireAt: fireAt.toISOString() } });
  });
  return { id: workflowId, fireAt: fireAt.toISOString(), thread: (await readThread(persona.id, threadId))!.thread };
}

/** Ångra on the toast: signal the workflow to end quietly and put the card back where it was. */
export async function cancelReminder(persona: AuthenticatedContext, threadId: string, workflowId: string) {
  if (!workflowId.startsWith(`reminder:${threadId}:`)) throw new InputError('Okänd påminnelse.');
  const found = await readThread(persona.id, threadId);
  if (!found) throw new InputError('Tråden finns inte.');
  try { const client = await temporalClient(); await client.workflow.getHandle(workflowId).signal('cancel'); }
  catch { /* already fired or gone: the card state below is still corrected */ }
  const now = new Date();
  await database().transaction(async tx => {
    if (isReminderWaiting(found.thread.waitingOn)) await tx.update(schema.threads).set({ waitingOn: null, updatedAt: now }).where(eq(schema.threads.id, threadId));
    await addMessage(tx, threadId, 'user', 'Ångra påminnelsen');
    await writeAudit(tx, { actor: persona.principal.id, action: 'reminder.cancelled', subject: 'thread:' + threadId, details: { workflowId } });
  });
  return (await readThread(persona.id, threadId))!.thread;
}
