import type { AuthenticatedContext } from '@clew/contracts';
import type { CalendarBinding } from '@clew/calendar/accounts';
import type { CalendarBinder } from '../model';

/** What the binder is built over: the person's address in Clew's directory and the binding of a calendar to it. */
export interface CalendarBinderDeps {
  /** The address the directory holds for the person now, or null when it holds none. */
  email: (personId: string) => Promise<string | null>;
  /** The person's calendar as that address names them; throws when there is none to bind. */
  bindCalendar: (persona: Pick<AuthenticatedContext, 'id' | 'name'>, address: string | null) => CalendarBinding;
}

/**
 * The person's calendar as Clew's directory holds them (DE-M8), the `CalendarBinder` the composition binds over the
 * directory's addresses and `bindCalendar`. The address is read on every call, one row by its key; a binding, with the
 * provider's discovery it holds, is kept while that address and the person's authorization version stay the same. A
 * changed address or version binds again, and the old binding is let go of before, so a person whose address is gone
 * (erased, or left without one) has none left in memory when the new one is refused.
 */
export function calendarBinder({ email, bindCalendar }: CalendarBinderDeps): CalendarBinder {
  const bindings = new Map<string, { version: string; address: string | null; binding: CalendarBinding }>();
  return async (persona: AuthenticatedContext) => {
    const address = await email(persona.id);
    const cached = bindings.get(persona.id);
    if (cached && cached.version === persona.authorizationVersion && cached.address === address) return cached.binding;
    bindings.delete(persona.id);
    const binding = bindCalendar(persona, address);
    bindings.set(persona.id, { version: persona.authorizationVersion, address, binding });
    return binding;
  };
}
