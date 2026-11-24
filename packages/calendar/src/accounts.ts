import type { AuthenticatedContext } from '@clew/contracts';
import { CalendarError, type CalendarProvider } from './model';
import { createCalendarProvider, type CalendarAdapterKind, type CalendarCredential } from './adapters';

/**
 * Synthetic calendar accounts for the POC. Who a person is in their calendar is their address in Clew's directory,
 * which the binding is handed (`bindCalendar`); how they sign in to the calendar is what is synthetic and local-only
 * here. Who a manager plans for is not here: that is the people provisioned on the units they manage (D96 item 3), and
 * the colleagues below are the same people with the same addresses as Bergsåkers skola in
 * `scripts/provisioner/directory.ts`.
 */
const calendarUrl = () => process.env.CALENDAR_URL ?? 'http://calendar';
const graphUrl = () => process.env.GRAPH_URL ?? 'http://graph:4010/v1.0';
/**
 * The bearer the synthetic accounts present to the local fake of Microsoft Graph (D69): a convention the fixture
 * directory owns, so the fake is imported by the fake's own process and the tests, never by the server (D61).
 */
export const fakeGraphToken = (email: string) => `fake-graph-token:${email.toLowerCase()}`;
/**
 * Each account names its adapter (D11): a real directory would carry the same `kind` per person. The development stack
 * is a mixed estate (D69, amended): Hillevi, Hassan and Ingrid keep their CalDAV calendars in Nextcloud, Mikael's calendar is in
 * Microsoft 365 over the local fake of Microsoft Graph, which the stack runs beside the fixture connectors. One adapter
 * for everyone is a run-time choice: CALENDAR_ADAPTER=microsoft365 binds every account to the fake, =caldav to Nextcloud.
 */
const adapterFor = (user: string): CalendarAdapterKind => {
  const forced = process.env.CALENDAR_ADAPTER;
  if (forced === 'microsoft365' || forced === 'caldav') return forced;
  return user === 'mikael' ? 'microsoft365' : 'caldav';
};
/** The calendar sign-in for `user`, as `person`: their address and name as the directory holds them. */
const credential = (user: string, person: { email: string; name: string }): CalendarCredential =>
  adapterFor(user) === 'microsoft365'
    ? { kind: 'microsoft365', url: graphUrl(), account: person, token: async () => fakeGraphToken(person.email) }
    : { kind: 'caldav', url: calendarUrl(), user, password: `calendar-${user}-local-only`, account: person };
/** The people with a calendar sign-in, the development directory's (`scripts/provisioner/directory.ts`). */
const names: Record<string, string> = {
  hillevi: 'Hillevi Berg',
  hassan: 'Hassan Ali',
  mikael: 'Mikael Lund',
  ingrid: 'Ingrid Holm',
};
/** The address the development directory gives every synthetic person, for the seeds and the fake of Graph. */
const fixtureAddress = (user: string) => `${user}@clew.test`;
/** Calendar accounts without a sign-in: Hillevi's school, as `.devcontainer/calendar/seed.php` creates them. */
const colleagues: Record<string, string> = {
  anna: 'Anna Lindqvist',
  erik: 'Erik Sandström',
  maria: 'Maria Källström',
  johan: 'Johan Byström',
  karin: 'Karin Lindqvist',
};
/** A person's own calendar (D11). */
export interface CalendarBinding {
  provider: CalendarProvider;
}
/**
 * The person's own calendar, as the person `address` names in Clew's directory: the address an event they organise
 * carries, never one made from how they sign in. A person the directory holds no address for has no calendar.
 */
export function bindCalendar(
  persona: Pick<AuthenticatedContext, 'id' | 'name'>,
  address: string | null,
): CalendarBinding {
  if (process.env.CLEW_POC !== 'true')
    throw new Error('CLEW_POC=true is required: the calendar bindings are synthetic development fixtures.');
  if (!Object.hasOwn(names, persona.id) || !address) throw new CalendarError('Ditt konto har ingen kalender kopplad.');
  return { provider: createCalendarProvider(credential(persona.id, { email: address, name: persona.name })) };
}
/** Seed-only access to a member's own calendar, for fixtures. Never used by the application. */
export function fixtureProvider(user: string) {
  return createCalendarProvider(
    credential(user, { email: fixtureAddress(user), name: names[user] ?? colleagues[user] ?? user }),
  );
}
/** Which adapter the directory binds a user to, for scripts that say where a seed went. */
export const fixtureAdapter = (user: string) => adapterFor(user);
/** The same synthetic people and rooms as the Nextcloud seed, for the local fake of Microsoft Graph (D69). */
export const fixtureDirectory = () => ({
  people: Object.entries({ ...names, ...colleagues }).map(([user, name]) => ({ email: fixtureAddress(user), name })),
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
