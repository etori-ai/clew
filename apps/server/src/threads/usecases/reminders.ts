import type { AuthenticatedContext } from '@clew/contracts';
import { InputError } from '../../context';
import type { ReminderInput, ReminderTimers, ThreadStore } from '../model';

export const MAX_REMINDER_SECONDS = 30 * 24 * 60 * 60;
const clock = (d: Date) => d.toLocaleTimeString('sv-SE', { timeZone: 'Europe/Stockholm', timeStyle: 'short' });
/** The waiting label while a reminder is pending; the card sits under "Pågår utan dig" until the timer brings it back. */
export const reminderWaiting = (fireAt: Date) => `påminnelsen ${clock(fireAt)}`;
const isReminderWaiting = (waitingOn: string | null) => !!waitingOn && waitingOn.startsWith('påminnelsen ');

export interface ReminderDeps { store: ThreadStore; timers: ReminderTimers; clock: () => Date }
export function reminderUsecases(deps: ReminderDeps) {
  const { store, timers } = deps;
  /**
   * "Påminn mig …" on a card (D17): start a reminder timer for this person about this thread and park the card
   * under "Pågår utan dig" until it fires. The timer id is the thread plus the request time, so two reminders on
   * the same card are two timers. Audited like any mutation.
   */
  async function remind(persona: AuthenticatedContext, threadId: string, seconds: number) {
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > MAX_REMINDER_SECONDS) throw new InputError('Ogiltig tid för påminnelsen.');
    const thread = await store.readThread(persona.id, threadId);
    if (!thread) throw new InputError('Kortet finns inte.');
    if (thread.state !== 'open') throw new InputError('Kortet är redan hanterat.');
    const now = deps.clock(), at = now.toISOString();
    const workflowId = `reminder:${threadId}:${now.getTime()}`;
    const fireAt = new Date(now.getTime() + seconds * 1000);
    try { await timers.start({ workflowId, personId: persona.id, threadId, title: thread.title, area: thread.area, seconds, requestedAt: at }); }
    catch { throw new InputError('Påminnelser är inte tillgängliga just nu.'); }
    await store.transaction(async tx => {
      await tx.updateThread(threadId, { waitingOn: reminderWaiting(fireAt), updatedAt: at });
      await tx.addMessage(threadId, { role: 'user', body: `Påminn mig ${clock(fireAt)}`, at });
      await tx.writeAudit({ actor: persona.principal.id, action: 'reminder.set', subject: 'thread:' + threadId, at, details: { workflowId, seconds, fireAt: fireAt.toISOString() } });
    });
    return { id: workflowId, fireAt: fireAt.toISOString(), thread: (await store.readThread(persona.id, threadId))! };
  }
  /** Ångra on the toast: end the timer quietly and put the card back where it was. */
  async function cancelReminder(persona: AuthenticatedContext, threadId: string, workflowId: string) {
    if (!workflowId.startsWith(`reminder:${threadId}:`)) throw new InputError('Okänd påminnelse.');
    const thread = await store.readThread(persona.id, threadId);
    if (!thread) throw new InputError('Kortet finns inte.');
    await timers.cancel(workflowId);
    const at = deps.clock().toISOString();
    await store.transaction(async tx => {
      if (isReminderWaiting(thread.waitingOn)) await tx.updateThread(threadId, { waitingOn: null, updatedAt: at });
      await tx.addMessage(threadId, { role: 'user', body: 'Ångra påminnelsen', at });
      await tx.writeAudit({ actor: persona.principal.id, action: 'reminder.cancelled', subject: 'thread:' + threadId, at, details: { workflowId } });
    });
    return (await store.readThread(persona.id, threadId))!;
  }
  /**
   * The timer fired: the card comes back, never a second one (D17). The thread is reopened if it was dismissed or
   * snoozed meanwhile, marked `remindedAt` so it sorts first under "Nu" for the day, and its trigger says why it is
   * back. A card already handled with a receipt is left alone: the work is done. Idempotent: a retried timer sees
   * `remindedAt` already at or after the fire time and does nothing. Runs as the Temporal activity `surfaceReminder`.
   */
  async function surface(input: ReminderInput): Promise<'surfaced' | 'skipped'> {
    const at = deps.clock().toISOString();
    return store.transaction(async tx => {
      const row = await tx.lockThread(input.personId, input.threadId);
      if (!row || row.receipt) return 'skipped';
      // A snooze's timer (D29): the card is simply awake again, no badge, no toast. Woken earlier, or snoozed again to another time: nothing to do.
      if (input.silent) {
        const fireAt = Date.parse(input.requestedAt) + input.seconds * 1000;
        if (!row.snoozedUntil || Math.abs(Date.parse(row.snoozedUntil) - fireAt) > 1000) return 'skipped';
        await tx.updateThread(row.id, { snoozedUntil: null, updatedAt: at });
        await tx.writeAudit({ actor: 'assistant:reminder', action: 'thread.woken', subject: 'thread:' + row.id, at, details: { reason: 'time', snoozedUntil: row.snoozedUntil, owner: input.personId } });
        return 'surfaced';
      }
      if (row.remindedAt && Date.parse(row.remindedAt) >= Date.parse(input.requestedAt) + input.seconds * 1000) return 'skipped';
      const asked = clock(new Date(input.requestedAt));
      await tx.updateThread(row.id, {
        state: 'open', handledAt: null, waitingOn: row.waitingOn && !isReminderWaiting(row.waitingOn) ? row.waitingOn : null, snoozedUntil: null, remindedAt: at, updatedAt: at,
        trigger: { reason: `Du bad ${asked} om en påminnelse · ${row.trigger.reason}`, source: row.trigger.source, at },
      });
      await tx.addMessage(row.id, { role: 'assistant', body: `Påminnelse: du bad ${asked} om att få det här kortet igen.`, at });
      await tx.writeAudit({ actor: 'assistant:reminder', action: 'thread.reminded', subject: 'thread:' + row.id, at, details: { requestedAt: input.requestedAt, seconds: input.seconds, wasState: row.state, owner: input.personId } });
      return 'surfaced';
    });
  }
  return { remind, cancelReminder, surface };
}
export type ReminderUsecases = ReturnType<typeof reminderUsecases>;
