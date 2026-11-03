import type { AuthenticatedContext } from '@clew/contracts';
import { CalendarError, type CalendarAccount, type CalendarProvider } from './model';
import { createCalendarProvider, type CalendarCredential } from './adapters';

/**
 * Synthetic directory for the POC. The real system would resolve a person's calendar account and
 * unit membership from the directory; here the bindings are explicit and local-only.
 */
export interface UnitMember extends CalendarAccount { personId: string; }
const calendarUrl = () => process.env.CALENDAR_URL ?? 'http://calendar';
/** Each account names its adapter. A real directory would carry the same `kind` per person, so a mixed estate (CalDAV and Microsoft 365) is one lookup away. */
const credential = (user: string): CalendarCredential => ({ kind: 'caldav', url: calendarUrl(), user, password: `calendar-${user}-local-only` });
const accounts: Record<string, { name: string; credential: CalendarCredential }> = {
  hillevi: { name: 'Hillevi Berg', credential: credential('hillevi') },
  hassan: { name: 'Hassan Ali', credential: credential('hassan') },
};
const units: Record<string, UnitMember[]> = {
  'unit-skola': [
    { personId: 'anna', ref: 'nextcloud:account:anna', email: 'anna@clew.test', name: 'Anna Lindqvist' },
    { personId: 'erik', ref: 'nextcloud:account:erik', email: 'erik@clew.test', name: 'Erik Sandström' },
    { personId: 'maria', ref: 'nextcloud:account:maria', email: 'maria@clew.test', name: 'Maria Källström' },
    { personId: 'johan', ref: 'nextcloud:account:johan', email: 'johan@clew.test', name: 'Johan Byström' },
  ],
};
export interface CalendarBinding { provider: CalendarProvider; members: UnitMember[]; }
export function bindCalendar(persona: Pick<AuthenticatedContext, 'id' | 'unitId' | 'role'>): CalendarBinding {
  if (process.env.CLEW_POC !== 'true') throw new Error('CLEW_POC=true is required: the calendar bindings are synthetic development fixtures.');
  const account = accounts[persona.id];
  if (!account) throw new CalendarError('Ditt konto har ingen kalender kopplad.');
  return {
    provider: createCalendarProvider(account.credential),
    members: persona.role === 'manager' ? units[persona.unitId] ?? [] : [],
  };
}
/** Seed-only access to a member's own calendar, for fixtures. Never used by the application. */
export function fixtureProvider(user: string) { return createCalendarProvider(credential(user)); }
export const unitMembers = (unitId: string) => units[unitId] ?? [];
