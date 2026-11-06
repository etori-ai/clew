import type { AuthenticatedContext } from '@clew/contracts';
import { CalendarError, type CalendarAccount, type CalendarProvider } from './model';
import { createCalendarProvider, type CalendarCredential } from './adapters';
import { fakeGraphToken } from './fake-graph';

/**
 * Synthetic directory for the POC. The real system would resolve a person's calendar account and
 * unit membership from the directory; here the bindings are explicit and local-only.
 */
export interface UnitMember extends CalendarAccount {
  personId: string;
}
const calendarUrl = () => process.env.CALENDAR_URL ?? 'http://calendar';
const graphUrl = () => process.env.GRAPH_URL ?? 'http://graph:4010/v1.0';
/** Each account names its adapter. A real directory would carry the same `kind` per person, so a mixed estate (CalDAV and Microsoft 365) is one lookup away. */
const credential = (user: string, name = user): CalendarCredential => {
  const email = `${user}@clew.test`;
  // The local fake of Microsoft Graph (D61), for a BFF started with CALENDAR_ADAPTER=microsoft365.
  return process.env.CALENDAR_ADAPTER === 'microsoft365'
    ? { kind: 'microsoft365', url: graphUrl(), account: { email, name }, token: async () => fakeGraphToken(email) }
    : { kind: 'caldav', url: calendarUrl(), user, password: `calendar-${user}-local-only` };
};
const names: Record<string, string> = { hillevi: 'Hillevi Berg', hassan: 'Hassan Ali', mikael: 'Mikael Lund' };
const accounts = Object.fromEntries(
  Object.entries(names).map(([user, name]) => [user, { name, credential: credential(user, name) }]),
);
const units: Record<string, UnitMember[]> = {
  'unit-skola': [
    { personId: 'anna', ref: 'nextcloud:account:anna', email: 'anna@clew.test', name: 'Anna Lindqvist' },
    { personId: 'erik', ref: 'nextcloud:account:erik', email: 'erik@clew.test', name: 'Erik Sandström' },
    { personId: 'maria', ref: 'nextcloud:account:maria', email: 'maria@clew.test', name: 'Maria Källström' },
    { personId: 'johan', ref: 'nextcloud:account:johan', email: 'johan@clew.test', name: 'Johan Byström' },
  ],
};
export interface CalendarBinding {
  provider: CalendarProvider;
  members: UnitMember[];
}
export function bindCalendar(persona: Pick<AuthenticatedContext, 'id' | 'unitId' | 'role'>): CalendarBinding {
  if (process.env.CLEW_POC !== 'true')
    throw new Error('CLEW_POC=true is required: the calendar bindings are synthetic development fixtures.');
  const account = accounts[persona.id];
  if (!account) throw new CalendarError('Ditt konto har ingen kalender kopplad.');
  return {
    provider: createCalendarProvider(account.credential),
    members: persona.role === 'manager' ? (units[persona.unitId] ?? []) : [],
  };
}
/** Seed-only access to a member's own calendar, for fixtures. Never used by the application. */
export function fixtureProvider(user: string) {
  return createCalendarProvider(credential(user));
}
export const unitMembers = (unitId: string) => units[unitId] ?? [];
/** The same synthetic people and rooms as the Nextcloud seed, for the local fake of Microsoft Graph (D61). */
export const fixtureDirectory = () => ({
  people: [
    ...Object.entries(names).map(([user, name]) => ({ email: `${user}@clew.test`, name })),
    ...Object.values(units)
      .flat()
      .map(({ email, name }) => ({ email, name })),
  ],
  rooms: [
    { name: 'Granen', email: 'granen@clew.test', capacity: 2, equipment: ['skärm'] },
    { name: 'Aspen', email: 'aspen@clew.test', capacity: 4, equipment: ['skärm', 'video'] },
    { name: 'Eken', email: 'eken@clew.test', capacity: 6, equipment: ['whiteboard'] },
    { name: 'Linden', email: 'linden@clew.test', capacity: 8, equipment: ['whiteboard', 'video', 'rullstolsanpassat'] },
    { name: 'Tallen', email: 'tallen@clew.test', capacity: 12, equipment: ['whiteboard', 'projektor', 'video'] },
    {
      name: 'Boken',
      email: 'boken@clew.test',
      capacity: 20,
      equipment: ['projektor', 'mikrofon', 'hörslinga', 'rullstolsanpassat'],
    },
    {
      name: 'Almen',
      email: 'almen@clew.test',
      capacity: 40,
      equipment: ['projektor', 'mikrofon', 'hörslinga', 'video', 'rullstolsanpassat'],
    },
  ],
});
