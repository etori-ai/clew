import type { AuthenticatedContext, TalkCalendarDecision } from '@clew/contracts';
import type { EventOccurrence } from '@clew/calendar/model';
import { ForbiddenError, InputError } from '../../../context';
import type { CalendarBinder, ProposalRecord, ProposalStore, Team } from '../model';
import { BOOKED } from './booked';

/**
 * The invitation to a talk after it was sent (D133). The talk's booking is the talks domain's record (D132) and the
 * calendar event is a copy anyone with the calendar can change, so the calendar module follows the event of each
 * invitation by the id it stored for it, never by a title: it reads the event back, tells the talks domain what the
 * calendar holds now, and carries out what the manager decides when that is not what was booked. Nothing here changes a
 * booking because the calendar changed: only the manager's decision does.
 */
export interface InvitationDeps {
  store: ProposalStore;
  bind: CalendarBinder;
  /** The people the manager may decide for: their team now. */
  team: Team;
  clock: () => Date;
}
/** How long a manager's invitations are left without reading their events again, per server process. */
export const FOLLOW_MS = 60 * 60_000;
/** An invitation is followed from when it is sent until this long after its time, the follow-up policy's own span. */
const FOLLOWED_AFTER_MS = 30 * 86_400_000;
const NOT_YOURS = 'Personen finns inte bland dem du är chef för.';
const NO_INVITATION = 'Samtalet har ingen inbjudan från dig att ändra. Läs om sidan.';
const UNREADABLE = 'Kalendern kunde inte läsas just nu. Försök igen om en stund.';
const DECIDING = 'Ärendet väntar på kalenderns besked. Försök igen om en stund.';
const AGREES = 'Mötet i kalendern stämmer med samtalet. Läs om sidan.';
const STILL_THERE = 'Mötet finns kvar i kalendern. Läs om sidan.';
const IS_GONE = 'Mötet finns inte längre i kalendern. Läs om sidan.';

export function invitationUsecases({ store, bind, team, clock }: InvitationDeps) {
  /** When each manager's invitations were last read back, in this process. */
  const followed = new Map<string, number>();
  /** The manager's invitations that book someone and are still to come, or not long past. */
  async function standing(persona: AuthenticatedContext) {
    const from = clock().getTime() - FOLLOWED_AFTER_MS;
    return (await store.activeProposals(persona.id)).filter(
      p => BOOKED.includes(p.status) && Date.parse(p.start) >= from && (p.eventRef !== null || p.eventUid !== null),
    );
  }
  /** The invitation's event as the calendar holds it now, by the id Clew stored: null when it is gone. Throws when unreadable. */
  async function eventOf(persona: AuthenticatedContext, p: ProposalRecord): Promise<EventOccurrence | null> {
    const { provider } = bind(persona);
    const ref = p.eventRef ?? (await provider.eventRef(p.eventUid!));
    return provider.lookup(ref);
  }
  const differs = (p: ProposalRecord, event: EventOccurrence | null) =>
    event === null || Date.parse(event.start) !== Date.parse(p.start) || Date.parse(event.end) !== Date.parse(p.end);

  return {
    /**
     * The reading back, as part of the manager's scan: every invitation of theirs that books someone is looked up by
     * its event's id, and the talks domain is told what the calendar holds, in one transaction. At most once an hour
     * per manager; an invitation whose event cannot be read now is left for the next reading, and a manager without
     * such an invitation reads no calendar. Returns how many invitations were read.
     */
    async follow(persona: AuthenticatedContext): Promise<number> {
      if (persona.role !== 'manager') return 0;
      const now = clock();
      const last = followed.get(persona.id);
      if (last !== undefined && now.getTime() - last < FOLLOW_MS) return 0;
      followed.set(persona.id, now.getTime());
      const seen: Array<{ p: ProposalRecord; event: EventOccurrence | null }> = [];
      for (const p of await standing(persona)) {
        try {
          seen.push({ p, event: await eventOf(persona, p) });
        } catch {
          /* a calendar that cannot answer now is asked again at the next reading */
        }
      }
      if (!seen.length) return 0;
      const at = now.toISOString();
      await persona.authorize();
      await store.transaction(async tx => {
        for (const { p, event } of seen)
          await tx.invitations.observed({
            actor: 'assistant:scan',
            invitationId: p.id,
            event: event ? { start: event.start, end: event.end } : null,
            at,
          });
      });
      return seen.length;
    },

    /**
     * The manager settles what the calendar holds against their booking of a person's talk. The event is read again
     * first, by its id, so the decision is about what the calendar holds now. `adopt`: the event is at another time,
     * and the invitation and the talk take it. `remove` and `keep`: the event is gone, so the invitation is over; the
     * talk then lacks a time, or keeps it as a time the manager set by hand. A decision that no longer fits what the
     * calendar holds is refused and what it holds is recorded, so the page reads right again. Nothing is written to the
     * calendar: a meeting moved by mistake is moved back there, and the next reading finds them agreeing.
     */
    async settle(persona: AuthenticatedContext, employeeId: string, decision: TalkCalendarDecision): Promise<void> {
      await persona.authorize();
      if (!(await team(persona)).some(m => m.personId === employeeId)) throw new ForbiddenError(NOT_YOURS);
      const candidates = (await standing(persona))
        .filter(p => p.participant.personId === employeeId)
        .sort((a, b) => b.start.localeCompare(a.start));
      if (!candidates.length) throw new InputError(NO_INVITATION);
      const read: Array<{ p: ProposalRecord; event: EventOccurrence | null }> = [];
      for (const p of candidates) {
        try {
          read.push({ p, event: await eventOf(persona, p) });
        } catch {
          throw new InputError(UNREADABLE);
        }
      }
      const found = read.find(r => differs(r.p, r.event));
      const at = clock().toISOString(),
        actor = persona.principal.id;
      const observe = (r: (typeof read)[number]) =>
        store.transaction(tx =>
          tx.invitations.observed({
            actor: 'assistant:scan',
            invitationId: r.p.id,
            event: r.event ? { start: r.event.start, end: r.event.end } : null,
            at,
          }),
        );
      if (!found) {
        // The calendar agrees again: what was recorded as differing is cleared, and there is nothing to decide.
        for (const r of read) await observe(r);
        throw new InputError(AGREES);
      }
      const { p, event } = found;
      if ((decision === 'adopt') !== (event !== null)) {
        await observe(found);
        throw new InputError(event ? STILL_THERE : IS_GONE);
      }
      await store.transaction(async tx => {
        const locked = await tx.lockThread(persona.id, p.threadId);
        const current = locked?.proposals.find(x => x.id === p.id);
        if (!locked || !current || !BOOKED.includes(current.status)) throw new InputError(NO_INVITATION);
        if (locked.thread.execution && ['pending', 'running', 'unknown'].includes(locked.thread.execution.state))
          throw new InputError(DECIDING);
        if (event) {
          await tx.updateProposals([p.id], {
            start: event.start,
            end: event.end,
            eventRef: event.ref,
            eventRevision: event.revision,
          });
          await tx.invitations.moved({ actor, invitationId: p.id, start: event.start, end: event.end, at });
        } else {
          await tx.updateProposals([p.id], { status: 'undone', undoUntil: null });
          await tx.invitations.ended({
            actor,
            invitationId: p.id,
            why: 'cancelled',
            at,
            ...(decision === 'keep' ? { keep: { managerId: persona.id } } : {}),
          });
        }
        await tx.updateThread(p.threadId, { updatedAt: at });
        await tx.writeAudit({
          actor,
          action: event ? 'proposals.moved' : 'proposals.cancelled',
          subject: 'thread:' + p.threadId,
          at,
          details: event
            ? { proposal: p.id, start: event.start, end: event.end, by: 'calendar' }
            : { proposal: p.id, kept: decision === 'keep', by: 'calendar' },
        });
      });
    },
  };
}
export type InvitationUsecases = ReturnType<typeof invitationUsecases>;
