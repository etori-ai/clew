import type { AuthenticatedContext } from '@clew/contracts';
import { CalendarError, type CalendarAccount, type CalendarProvider } from './model';
import { NextcloudProvider } from './nextcloud';

/**
 * Synthetic directory for the POC. The real system would resolve a person's calendar account and
 * unit membership from the directory; here the bindings are explicit and local-only.
 */
export interface UnitMember extends CalendarAccount { personId: string; }
const accounts: Record<string, { user: string; password: string; name: string }> = {
  hillevi: { user: 'hillevi', password: 'calendar-hillevi-local-only', name: 'Hillevi Berg' },
  hassan: { user: 'hassan', password: 'calendar-hassan-local-only', name: 'Hassan Ali' },
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
    provider: new NextcloudProvider(account.user, account.password, process.env.CALENDAR_URL ?? 'http://calendar'),
    members: persona.role === 'manager' ? units[persona.unitId] ?? [] : [],
  };
}
/** Seed-only access to a member's own calendar, for fixtures. Never used by the application. */
export function fixtureProvider(user: string) { return new NextcloudProvider(user, `calendar-${user}-local-only`, process.env.CALENDAR_URL ?? 'http://calendar'); }
export const unitMembers = (unitId: string) => units[unitId] ?? [];
