import type { CalendarEvent } from '@clew/contracts';
import type { CalendarBinding } from '@clew/calendar/accounts';
import { organisedBy, type EventOccurrence } from '@clew/calendar/model';
import type { ProposalStore, UnitMember } from '../model';
import { BOOKED } from './booked';

/** Pure projections of calendar events for the use cases in `samtal.ts`. */
/**
 * The title Clew gives the invitation to a talk. It is what the invitee reads, never how a talk is recognised: who has
 * a talk booked is the round's record (D132), by person id.
 */
export const SAMTAL_TITLE = 'Utvecklingssamtal';
/**
 * The meetings of the invitations to a talk that Clew sent and that still stand (D133), by the ids Clew stored for their
 * events: the reader's own invitations by the event's ref and its uid, and those that invite the reader by the uid Clew
 * gave the event, which the invitee's copy keeps. What `CalendarEvent.talk` is drawn from; never a title (WA-L5).
 */
export async function talkMeetings(
  store: Pick<ProposalStore, 'activeProposals' | 'bookedProposals'>,
  personId: string,
): Promise<ReadonlySet<string>> {
  const [own, invited] = await Promise.all([store.activeProposals(personId), store.bookedProposals([personId])]);
  return new Set(
    [...own.filter(p => BOOKED.includes(p.status)), ...invited].flatMap(p =>
      [p.eventRef, p.eventUid].filter((id): id is string => !!id),
    ),
  );
}
/**
 * Projection for the browser: participants are display names, resolved from the person's team, never raw addresses.
 * An event with no organiser is the person's own appointment (DE-M8). `talks` holds the ids of the meetings of Clew's
 * invitations to a talk (`talkMeetings`).
 */
export function toEvent(
  event: EventOccurrence,
  binding: CalendarBinding,
  ownName: string,
  team: readonly UnitMember[],
  talks: ReadonlySet<string> = new Set(),
): CalendarEvent {
  const names = new Map<string, string>([
    [binding.provider.account.email.toLowerCase(), ownName],
    ...team.map(m => [m.email.toLowerCase(), m.name] as const),
  ]);
  const mine = organisedBy(event, binding.provider.account);
  return {
    id: event.id,
    title: event.title,
    start: event.start,
    end: event.end,
    allDay: event.allDay,
    mine,
    room: event.room,
    participants: event.participants
      .filter(p => !p.resource)
      .map(p => names.get(p.email.toLowerCase()) ?? p.name ?? 'Deltagare'),
    ref: event.ref,
    revision: event.revision,
    canCancel: event.canCancel,
    recurring: event.recurring,
    organizer: event.organizer ? names.get(event.organizer.toLowerCase()) || event.organizerName || 'Okänd' : ownName,
    ...(talks.has(event.ref) || talks.has(event.uid) ? { talk: true } : {}),
  };
}
