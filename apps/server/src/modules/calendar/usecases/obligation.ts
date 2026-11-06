import { stockholmClock, stockholmDate, stockholmInstant, type ObligationStep } from '@clew/contracts';
import { addWorkdays, onOrAfterWeekday } from '@clew/calendar/dates';
import type { ProposalRecord } from '../model';

/**
 * The follow-up policy of an obligation (D30), as pure functions over instants: when the next reminder is due, when
 * the thread goes back to the manager, and when the workflow should look again. Fixed in the decision; nothing in
 * here reads a clock. "Workday" is Monday to Friday in Stockholm.
 */
export const FOLLOW_UP = {
  afterWorkdays: 2,
  maxReminders: 2,
  at: '06:00',
  returnWeekday: 5,
  office: { from: 8, to: 17 },
} as const;
export const waitingOnInvitee = (p: Pick<ProposalRecord, 'status'>) => p.status === 'confirmed' || p.status === 'final';
const sentAt = (p: ProposalRecord, fallback: string) => p.confirmedAt ?? fallback;
/** The next reminder a waiting invitee gets: two workdays after the last one (or the invitation), at the morning review. */
export function nextReminderAt(p: ProposalRecord, fallback: string): string | null {
  if (!waitingOnInvitee(p) || p.reminders >= FOLLOW_UP.maxReminders) return null;
  return stockholmInstant(
    addWorkdays(stockholmDate(p.remindedAt ?? sentAt(p, fallback)), FOLLOW_UP.afterWorkdays),
    FOLLOW_UP.at,
  );
}
/** When the thread goes back to the manager: the Friday review on or after two workdays from the first invitation. */
export function returnAt(proposals: ProposalRecord[], fallback: string): string {
  const first =
    proposals
      .filter(waitingOnInvitee)
      .map(p => sentAt(p, fallback))
      .sort()[0] ?? fallback;
  return stockholmInstant(
    onOrAfterWeekday(addWorkdays(stockholmDate(first), FOLLOW_UP.afterWorkdays), FOLLOW_UP.returnWeekday),
    FOLLOW_UP.at,
  );
}
/** The next whole hour inside office hours on a workday, in Stockholm. */
export function nextCheck(now: string): string {
  let date = stockholmDate(now);
  const hour = Number(stockholmClock(now).slice(0, 2));
  const weekday = (d: string) => new Date(d + 'T12:00:00Z').getUTCDay();
  let next = hour + 1;
  if (next < FOLLOW_UP.office.from) next = FOLLOW_UP.office.from;
  if (next >= FOLLOW_UP.office.to || weekday(date) === 0 || weekday(date) === 6) {
    date = addWorkdays(date, 1);
    next = FOLLOW_UP.office.from;
  }
  return stockholmInstant(date, `${String(next).padStart(2, '0')}:00`);
}
export interface ObligationPlan {
  action: 'wait' | 'remind' | 'return';
  why: 'answered' | 'deadline' | 'waiting' | 'overdue';
  due: ProposalRecord[];
  next: string;
}
/** What the workflow does now: remind whoever is overdue, return the thread, or wait until the next check. */
export function obligationPlan(now: string, proposals: ProposalRecord[]): ObligationPlan {
  const waiting = proposals.filter(waitingOnInvitee);
  if (!waiting.length) return { action: 'return', why: 'answered', due: [], next: now };
  const back = returnAt(proposals, now);
  if (Date.parse(now) >= Date.parse(back)) return { action: 'return', why: 'deadline', due: waiting, next: now };
  const due = waiting.filter(p => {
    const at = nextReminderAt(p, now);
    return !!at && Date.parse(at) <= Date.parse(now);
  });
  if (due.length) return { action: 'remind', why: 'overdue', due, next: nextCheck(now) };
  const check = nextCheck(now);
  return { action: 'wait', why: 'waiting', due: [], next: Date.parse(check) < Date.parse(back) ? check : back };
}
/** The step the card shows, read from the module's own records (superseded ones left out, as the contract view does). */
export const stepOf = (
  proposals: ProposalRecord[],
  step: (rows: Array<{ status: ProposalRecord['status'] }>) => ObligationStep,
) => step(proposals.filter(p => p.status !== 'superseded'));
