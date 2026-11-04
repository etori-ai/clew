import type { CalendarEvent } from '@clew/contracts';
import type { CalendarBinding } from '@clew/calendar/accounts';
import type { EventOccurrence } from '@clew/calendar/model';

/** Pure projections of calendar events for the use cases in `samtal.ts`. */
export const SAMTAL_TITLE = 'Utvecklingssamtal';
/** Projection for the browser: participants are display names, resolved from the unit directory, never raw addresses. */
export function toEvent(event: EventOccurrence, binding: CalendarBinding, ownName: string): CalendarEvent {
  const names = new Map<string, string>([[binding.provider.account.email.toLowerCase(), ownName], ...binding.members.map(m => [m.email.toLowerCase(), m.name] as const)]);
  const mine = event.organizer.toLowerCase() === binding.provider.account.email.toLowerCase();
  return { id: event.id, title: event.title, start: event.start, end: event.end, allDay: event.allDay, mine, room: event.room,
    participants: event.participants.filter(p => !p.resource).map(p => names.get(p.email.toLowerCase()) ?? p.name ?? 'Deltagare') };
}
/** Addresses that already have an utvecklingssamtal among these events. */
export function heldAddresses(events: EventOccurrence[]) {
  const done = new Set<string>();
  for (const event of events) if (event.title.startsWith(SAMTAL_TITLE)) for (const p of event.participants) done.add(p.email.toLowerCase());
  return done;
}
