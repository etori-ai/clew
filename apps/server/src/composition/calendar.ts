import type { AuthenticatedContext } from '@clew/contracts';
import { bindCalendar, type CalendarBinding } from '@clew/calendar/accounts';
import { postgresProposalStore } from '../modules/calendar/adapters/postgres';
import { calendarUsecases } from '../modules/calendar/usecases/samtal';
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
export const calendar = calendarUsecases({ store: postgresProposalStore(), bind, clock, ids });
