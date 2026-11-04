import type { AuthenticatedContext } from '@clew/contracts';
import { bindCalendar, type CalendarBinding } from '@clew/calendar/accounts';
import { postgresProposalStore } from '../modules/calendar/adapters/postgres';
import { temporalObligations } from '../temporal/obligations';
import type { Notifier } from '../modules/calendar/model';
import { systemContext } from '../system-context';
import { calendarUsecases } from '../modules/calendar/usecases/samtal';
import { eventUsecases } from '../modules/calendar/usecases/events';
import type { CalendarBinder } from '../modules/calendar/model';
import { clock, ids } from './ambient';

/**
 * The calendar's live wiring (D25). It is its own file because the registry registers the calendar connector over
 * these use cases, and `composition/index.ts` builds the stream over the registry: this file must not import either.
 */
// Provider discovery is cached only while the person's access scope is unchanged.
const bindings = new Map<string, { version: string; binding: CalendarBinding }>();
const bind: CalendarBinder = (persona: AuthenticatedContext) => {
  let cached = bindings.get(persona.id);
  if (!cached || cached.version !== persona.authorizationVersion) {
    cached = { version: persona.authorizationVersion, binding: bindCalendar(persona) }; bindings.set(persona.id, cached);
  }
  return cached.binding;
};
/** The follow-up card goes into an invitee's stream through the threads module, which is built after this file: `index.ts` fills the slot. */
export const notifier: { push: Notifier } = { push: async () => undefined };
const store = postgresProposalStore();
export const calendar = calendarUsecases({ store, bind, clock, ids, people: { personaFor: id => systemContext(id, 'system:obligation') }, notify: (personId, draft) => notifier.push(personId, draft), obligations: temporalObligations() });
/** A person's own bookings and proposal moves (D28), over the same store and bindings. */
export const events = eventUsecases({ store, bind, clock, ids });
