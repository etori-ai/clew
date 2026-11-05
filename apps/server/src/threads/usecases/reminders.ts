import type { AuthenticatedContext } from '@clew/contracts';
import { InputError } from '../../context';
import type { ReminderInput, ReminderTimers, ThreadStore, TimerIntent } from '../model';

export const MAX_REMINDER_SECONDS = 30 * 24 * 60 * 60;
const clock = (d: Date) => d.toLocaleTimeString('sv-SE', { timeZone: 'Europe/Stockholm', timeStyle: 'short' });
/** The waiting label of a card that waits on nothing else while a reminder is pending; it sits under "Pågår utan dig" until the timer brings it back. */
export const reminderWaiting = (fireAt: Date) => `påminnelsen ${clock(fireAt)}`;
const isReminderWaiting = (waitingOn: string | null) => !!waitingOn && waitingOn.startsWith('påminnelsen ');

export interface ReminderDeps { store: ThreadStore; timers?: ReminderTimers; clock: () => Date; authorized?: (timer: TimerIntent) => Promise<boolean> }
export function reminderUsecases(deps: ReminderDeps) {
  const { store } = deps;
  /**
   * Commit the reminder, parked card and audit together. A newer generation supersedes every earlier timer;
   * delivery to Temporal can retry independently without changing the approved absolute due time.
   */
  async function remind(persona: AuthenticatedContext, threadId: string, seconds: number) {
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > MAX_REMINDER_SECONDS) throw new InputError('Ogiltig tid för påminnelsen.');
    await persona.authorize();
    const now = deps.clock(), at = now.toISOString();
    const fireAt = new Date(now.getTime() + seconds * 1000);
    const timer = await store.transaction(async tx => {
      const thread = await tx.lockThread(persona.id, threadId);
      if (!thread) throw new InputError('Kortet finns inte.');
      if (thread.state !== 'open') throw new InputError('Kortet är redan hanterat.');
      const timer = await tx.scheduleTimer({ id: `reminder:${threadId}`, personId: persona.id, threadId, kind: 'reminder', unitId: persona.unitId, authorizationVersion: persona.authorizationVersion, dueAt: fireAt.toISOString(), requestedAt: at });
      // A card that already waits on someone keeps saying so (D49): the reminder is what comes after the wait, not a new reason for it.
      await tx.updateThread(threadId, { waitingOn: thread.waitingOn && !isReminderWaiting(thread.waitingOn) ? thread.waitingOn : reminderWaiting(fireAt), updatedAt: at });
      await tx.addMessage(threadId, { role: 'user', body: `Påminn mig ${clock(fireAt)}`, at });
      await tx.writeAudit({ actor: persona.principal.id, action: 'reminder.set', subject: 'thread:' + threadId, at, details: { timerId: timer.id, generation: timer.generation, seconds, fireAt: fireAt.toISOString(), delivery: 'queued' } });
      return timer;
    });
    return { id: `${timer.id}:v2:${timer.generation}`, fireAt: fireAt.toISOString(), thread: (await store.readThread(persona.id, threadId))! };
  }
  /** Ångra on the toast: end the timer quietly and put the card back where it was. */
  async function cancelReminder(persona: AuthenticatedContext, threadId: string, workflowId: string) {
    if (!workflowId.startsWith(`reminder:${threadId}:`)) throw new InputError('Okänd påminnelse.');
    await persona.authorize();
    const suffix = workflowId.slice(`reminder:${threadId}:`.length);
    if (!/^(v2:)?\d+$/.test(suffix)) throw new InputError('Okänd påminnelse.');
    const generation = suffix.startsWith('v2:') ? Number(suffix.slice(3)) : undefined;
    const at = deps.clock().toISOString();
    await store.transaction(async tx => {
      const thread = await tx.lockThread(persona.id, threadId);
      if (!thread) throw new InputError('Kortet finns inte.');
      const id = `reminder:${threadId}`;
      const existing = await tx.readTimer(id);
      if (generation === undefined && existing) return;
      if (generation === undefined) {
        // Tombstone a legacy workflow without depending on its service being up.
        await tx.scheduleTimer({ id, personId: persona.id, threadId, kind: 'reminder', unitId: persona.unitId, authorizationVersion: persona.authorizationVersion, dueAt: at, requestedAt: at });
      }
      if (!await tx.cancelTimer(id, at, generation)) return;
      if (isReminderWaiting(thread.waitingOn)) await tx.updateThread(threadId, { waitingOn: null, updatedAt: at });
      await tx.addMessage(threadId, { role: 'user', body: 'Ångra påminnelsen', at });
      await tx.writeAudit({ actor: persona.principal.id, action: 'reminder.cancelled', subject: 'thread:' + threadId, at, details: { workflowId } });
    });
    return (await store.readThread(persona.id, threadId))!;
  }
  /**
   * The timer fired: the card comes back, never a second one (D17). The same return whether the person pressed Inte nu
   * or Påminn mig (D49): the thread is reopened if it was dismissed or snoozed meanwhile, marked `remindedAt` so it sorts
   * first under "Nu" for the day, its trigger says why it is back and who it waited on, and the person is told. A card
   * already handled with a receipt is left alone: the work is done. Idempotent: a retried timer sees `remindedAt` already
   * at or after the fire time and does nothing. Runs as the Temporal activity `surfaceReminder`.
   */
  async function surface(input: ReminderInput, generation?: number): Promise<'surfaced' | 'skipped'> {
    const at = deps.clock().toISOString();
    return store.transaction(async tx => {
      const row = await tx.lockThread(input.personId, input.threadId);
      if (!row) return 'skipped';
      const timer = await tx.readTimer(`${input.silent ? 'snooze' : 'reminder'}:${input.threadId}`);
      // Legacy histories remain replayable, but any new intent supersedes them.
      if (generation === undefined ? !!timer : !timer || timer.generation !== generation || timer.state !== 'active' || timer.dueAt > at) return 'skipped';
      if (timer) {
        await tx.updateTimer({ ...timer, state: 'fired', reason: null, leaseUntil: null });
        await tx.writeAudit({ actor: 'assistant:reminder', action: 'timer.fired', subject: 'timer:' + timer.id, at, details: { generation, owner: input.personId } });
      }
      if (row.receipt || row.execution && ['pending', 'running', 'unknown'].includes(row.execution.state)) return 'skipped';
      const fireAt = Date.parse(input.requestedAt) + input.seconds * 1000;
      // A snooze woken earlier, or snoozed again to another time: nothing to do.
      if (input.silent && (!row.snoozedUntil || Math.abs(Date.parse(row.snoozedUntil) - fireAt) > 1000)) return 'skipped';
      if (row.remindedAt && Date.parse(row.remindedAt) >= fireAt) return 'skipped';
      const asked = clock(new Date(input.requestedAt));
      const waited = row.waitingOn && !isReminderWaiting(row.waitingOn) ? `Väntade på ${row.waitingOn} · ` : '';
      await tx.updateThread(row.id, {
        state: 'open', handledAt: null, waitingOn: null, snoozedUntil: null, remindedAt: at, updatedAt: at,
        trigger: { reason: `Du bad ${asked} om en påminnelse · ${waited}${row.trigger.reason}`, source: row.trigger.source, at },
      });
      await tx.addMessage(row.id, { role: 'assistant', body: `Påminnelse: du bad ${asked} om att få det här kortet igen.`, at });
      await tx.admitDelivery({ id: `reminded:${row.id}:${generation ?? input.requestedAt}`, personId: input.personId, threadId: row.id, kind: 'reminder', at });
      await tx.writeAudit(input.silent
        ? { actor: 'assistant:reminder', action: 'thread.woken', subject: 'thread:' + row.id, at, details: { reason: 'time', snoozedUntil: row.snoozedUntil, owner: input.personId } }
        : { actor: 'assistant:reminder', action: 'thread.reminded', subject: 'thread:' + row.id, at, details: { requestedAt: input.requestedAt, seconds: input.seconds, wasState: row.state, owner: input.personId } });
      return 'surfaced';
    });
  }
  async function fire(id: string, generation: number): Promise<'surfaced' | 'skipped'> {
    const timer = await store.readTimer(id);
    if (!timer || timer.kind === 'obligation' || timer.generation !== generation || timer.state !== 'active' || timer.dueAt > deps.clock().toISOString()) return 'skipped';
    // Fail closed when the composition root has not supplied an authority reader.
    if (!deps.authorized || !await deps.authorized(timer)) {
      await store.transaction(async tx => {
        await tx.lockThread(timer.personId, timer.threadId);
        const current = await tx.readTimer(id);
        if (!current || current.generation !== generation || current.state !== 'active') return;
        await tx.updateTimer({ ...current, state: 'blocked', reason: 'authority-revoked', leaseUntil: null });
        await tx.writeAudit({ actor: 'assistant:reminder', action: 'timer.blocked', subject: 'timer:' + id, at: deps.clock().toISOString(), details: { generation, reason: 'authority-revoked' } });
      });
      return 'skipped';
    }
    return surface({ personId: timer.personId, threadId: timer.threadId, title: '', area: '', requestedAt: timer.requestedAt,
      seconds: (Date.parse(timer.dueAt) - Date.parse(timer.requestedAt)) / 1000, silent: timer.kind === 'snooze' }, generation);
  }
  return { remind, cancelReminder, surface, fire };
}
export type ReminderUsecases = ReturnType<typeof reminderUsecases>;
