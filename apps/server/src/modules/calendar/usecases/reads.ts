import type { AuthenticatedContext, CalendarEvent, TodayView } from '@clew/contracts';
import { bindCalendar, type CalendarBinding } from '@clew/calendar/accounts';
import type { EventOccurrence } from '@clew/calendar/model';
import { addDays, dayStart, today, weekStart } from '@clew/calendar/dates';
import { freeGaps } from '@clew/calendar/proposals';

// Provider discovery is cached only while the person's access scope is unchanged.
const bindings = new Map<string, { version: string; binding: CalendarBinding }>();
export function calendarFor(persona: AuthenticatedContext) {
  let cached = bindings.get(persona.id);
  if (!cached || cached.version !== persona.authorizationVersion) {
    cached = { version: persona.authorizationVersion, binding: bindCalendar(persona) }; bindings.set(persona.id, cached);
  }
  return cached.binding;
}
export const SAMTAL_TITLE = 'Utvecklingssamtal';
/** Projection for the browser: participants are display names, resolved from the unit directory, never raw addresses. */
export function toEvent(event: EventOccurrence, binding: CalendarBinding, ownName: string): CalendarEvent {
  const names = new Map<string, string>([[binding.provider.account.email.toLowerCase(), ownName], ...binding.members.map(m => [m.email.toLowerCase(), m.name] as const)]);
  const mine = event.organizer.toLowerCase() === binding.provider.account.email.toLowerCase();
  return { id: event.id, title: event.title, start: event.start, end: event.end, allDay: event.allDay, mine, room: event.room,
    participants: event.participants.filter(p => !p.resource).map(p => names.get(p.email.toLowerCase()) ?? p.name ?? 'Deltagare') };
}
export async function listWeek(persona: AuthenticatedContext, from: string, days = 7) {
  const binding = calendarFor(persona);
  const events = await binding.provider.list(dayStart(from), dayStart(addDays(from, days)));
  return { binding, events, view: events.map(e => toEvent(e, binding, persona.name)) };
}
export async function readToday(persona: AuthenticatedContext): Promise<TodayView> {
  const date = today();
  const { view } = await listWeek(persona, date, 1);
  const timed = view.filter(e => !e.allDay);
  return { date, events: view, gaps: freeGaps(date, timed) };
}
/** Utvecklingssamtal already in the calendar between now and the deadline, by participant address. */
export async function heldSamtal(persona: AuthenticatedContext, deadline: string) {
  const binding = calendarFor(persona);
  // The provider caps a read at 32 days: from the start of this week to the day after the deadline.
  const events = await binding.provider.list(dayStart(weekStart(today())), dayStart(addDays(deadline, 1)));
  const done = new Set<string>();
  for (const event of events) if (event.title.startsWith(SAMTAL_TITLE)) for (const p of event.participants) done.add(p.email.toLowerCase());
  return { binding, events, done };
}
