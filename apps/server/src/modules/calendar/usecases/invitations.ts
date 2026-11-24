import type { AuthenticatedContext, TalkCalendarDecision } from '@clew/contracts';
import { dayStart } from '@clew/calendar/dates';
import type { EventOccurrence } from '@clew/calendar/model';
import { ForbiddenError, InputError } from '../../../context';
import type { CalendarBinder, ProposalRecord, ProposalStore, ProposalTx, Team } from '../model';
import { chunks } from '../domain';
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
/** How many events are looked up at the same time when a manager's invitations are read back. */
const FOLLOW_AT_ONCE = 4;
/** An invitation is followed from when it is sent until this long after its time, the follow-up policy's own span. */
const FOLLOWED_AFTER_MS = 30 * 86_400_000;
const NOT_YOURS = 'Personen finns inte bland dem du är chef för.';
const NO_INVITATION = 'Samtalet har ingen inbjudan från dig att ändra. Läs om sidan.';
const UNREADABLE = 'Kalendern kunde inte läsas just nu. Försök igen om en stund.';
const DECIDING = 'Ärendet väntar på kalenderns besked. Försök igen om en stund.';
const AGREES = 'Mötet i kalendern stämmer med samtalet. Läs om sidan.';
const STILL_THERE = 'Mötet finns kvar i kalendern. Läs om sidan.';
const IS_GONE = 'Mötet finns inte längre i kalendern. Läs om sidan.';
const NOT_YET = 'Tiden för samtalet har inte passerat än.';
const ALL_DAY = 'Mötet i kalendern gäller hela dagen. Ge det en tid i kalendern innan samtalet flyttas dit.';
const RECURRING = 'Mötet i kalendern återkommer. Gör det till ett enstaka möte i kalendern innan samtalet flyttas dit.';
const instant = (value: string) => new Date(value).toISOString();
/**
 * The span the calendar holds for an event, as instants: an all-day event's dates are the start of its first day and
 * of the day after its last in Clew's zone, never midnight UTC (DE-L15).
 */
const spanOf = (event: EventOccurrence) =>
  event.allDay
    ? { start: instant(dayStart(event.start)), end: instant(dayStart(event.end)) }
    : { start: event.start, end: event.end };

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
    const { provider } = await bind(persona);
    const ref = p.eventRef ?? (await provider.eventRef(p.eventUid!));
    return provider.lookup(ref);
  }
  const differs = (p: ProposalRecord, event: EventOccurrence | null) =>
    event === null ||
    event.allDay ||
    Date.parse(event.start) !== Date.parse(p.start) ||
    Date.parse(event.end) !== Date.parse(p.end);

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
      // A few at a time: a manager's twenty invitations are not twenty requests in a row, nor twenty at once.
      const seen: Array<{ p: ProposalRecord; event: EventOccurrence | null }> = [];
      for (const part of chunks(await standing(persona), FOLLOW_AT_ONCE))
        seen.push(
          ...(
            await Promise.all(
              part.map(async p => {
                try {
                  return [{ p, event: await eventOf(persona, p) }];
                } catch {
                  // A calendar that cannot answer now is asked again at the next reading.
                  return [];
                }
              }),
            )
          ).flat(),
        );
      if (!seen.length) return 0;
      const at = now.toISOString();
      await persona.authorize();
      await store.transaction(async tx => {
        for (const { p, event } of seen)
          await tx.invitations.observed({
            actor: 'assistant:scan',
            invitationId: p.id,
            event: event ? spanOf(event) : null,
            at,
          });
      });
      return seen.length;
    },

    /**
     * The manager settles what the calendar holds against their booking of a person's talk. The event is read again
     * first, by its id, so the decision is about what the calendar holds now. `adopt`: the event is at another time,
     * and the invitation and the talk take it; an event made all-day or recurring has no one time to take, and is
     * refused until it has one. `remove` and `keep`: the event is gone, so the invitation is over; the
     * talk then lacks a time, or keeps it as a time the manager set by hand. A decision that no longer fits what the
     * calendar holds is refused and what it holds is recorded, so the page reads right again. Nothing is written to the
     * calendar: a meeting moved by mistake is moved back there, and the next reading finds them agreeing.
     *
     * `missed` is the manager's answer when the meeting's time has passed and the talk did not take place (D134): the
     * invitation is over, the talk lacks a time, and it is planned again. The calendar is not read for it, and the
     * meeting stays there as what was once planned.
     */
    async settle(persona: AuthenticatedContext, employeeId: string, decision: TalkCalendarDecision): Promise<void> {
      await persona.authorize();
      if (!(await team(persona)).some(m => m.personId === employeeId)) throw new ForbiddenError(NOT_YOURS);
      const candidates = (await standing(persona))
        .filter(p => p.participant.personId === employeeId)
        .sort((a, b) => b.start.localeCompare(a.start));
      if (!candidates.length) throw new InputError(NO_INVITATION);
      const at = clock().toISOString(),
        actor = persona.principal.id;
      /** The proposal as it is now, locked: still an invitation that books someone, with no decision on its way. */
      const locked = async (tx: ProposalTx, p: ProposalRecord) => {
        const found = await tx.lockThread(persona.id, p.threadId);
        const current = found?.proposals.find(x => x.id === p.id);
        if (!found || !current || !BOOKED.includes(current.status)) throw new InputError(NO_INVITATION);
        if (found.thread.execution && ['pending', 'running', 'unknown'].includes(found.thread.execution.state))
          throw new InputError(DECIDING);
      };
      /** The invitation is over: the proposal is undone and the talks domain told, with the audit row, in one transaction. */
      const end = (p: ProposalRecord, why: 'cancelled' | 'missed', keep: boolean) =>
        store.transaction(async tx => {
          await locked(tx, p);
          await tx.updateProposals([p.id], { status: 'undone', undoUntil: null });
          await tx.invitations.ended({
            actor,
            invitationId: p.id,
            why,
            at,
            ...(keep ? { keep: { managerId: persona.id } } : {}),
          });
          await tx.updateThread(p.threadId, { updatedAt: at });
          await tx.writeAudit({
            actor,
            action: why === 'missed' ? 'proposals.missed' : 'proposals.cancelled',
            subject: 'thread:' + p.threadId,
            at,
            details: why === 'missed' ? { proposal: p.id } : { proposal: p.id, kept: keep, by: 'calendar' },
          });
        });
      if (decision === 'missed') {
        // The person's latest invitation is the one that carries the talk's booking: an older one whose talk was held
        // is never the one that was missed.
        const latest = candidates[0]!;
        if (Date.parse(latest.end) > Date.parse(at)) throw new InputError(NOT_YET);
        return end(latest, 'missed', false);
      }
      const read: Array<{ p: ProposalRecord; event: EventOccurrence | null }> = [];
      for (const p of candidates) {
        try {
          read.push({ p, event: await eventOf(persona, p) });
        } catch {
          throw new InputError(UNREADABLE);
        }
      }
      const observe = (r: (typeof read)[number]) =>
        store.transaction(tx =>
          tx.invitations.observed({
            actor: 'assistant:scan',
            invitationId: r.p.id,
            event: r.event ? spanOf(r.event) : null,
            at,
          }),
        );
      const found = read.find(r => differs(r.p, r.event));
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
      if (!event) return end(p, 'cancelled', decision === 'keep');
      // A talk is one meeting at one time: a meeting made all-day or recurring in the calendar has none it could take,
      // so it is not adopted, and the manager gives it a time there first (DE-L15).
      if (event.allDay || event.recurring) {
        await observe(found);
        throw new InputError(event.allDay ? ALL_DAY : RECURRING);
      }
      await store.transaction(async tx => {
        await locked(tx, p);
        await tx.updateProposals([p.id], {
          start: event.start,
          end: event.end,
          eventRef: event.ref,
          eventRevision: event.revision,
        });
        await tx.invitations.moved({ actor, invitationId: p.id, start: event.start, end: event.end, at });
        await tx.updateThread(p.threadId, { updatedAt: at });
        await tx.writeAudit({
          actor,
          action: 'proposals.moved',
          subject: 'thread:' + p.threadId,
          at,
          details: { proposal: p.id, start: event.start, end: event.end, by: 'calendar' },
        });
      });
    },
  };
}
export type InvitationUsecases = ReturnType<typeof invitationUsecases>;
