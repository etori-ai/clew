/**
 * Books the synthetic meetings (`calendar-fixtures.ts`) through the synthetic directory: each persona's fixtures land in
 * the calendar the directory binds them to, Nextcloud or the local fake of Microsoft Graph (D69). Idempotent by UID.
 */
import { fixtureProvider } from '@clew/calendar/accounts';
import { fixtureWeeks, seedCalendar } from './calendar-fixtures';
if (process.env.CLEW_POC !== 'true') throw new Error('Synthetic POC mode required');
const { monday, next } = fixtureWeeks();
const { booked, kept } = await seedCalendar(fixtureProvider);
console.log(
  `Calendar fixtures for weeks ${monday} and ${next} are in place: ${booked} booked, ${kept} already there. Existing meetings were kept.`,
);
