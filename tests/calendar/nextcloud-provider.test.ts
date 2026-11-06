import { describe } from 'bun:test';
import { NextcloudProvider } from '../../packages/calendar/src/nextcloud';
import { calendarProviderContract } from '../calendar-provider-contract';

/**
 * The calendar contract on the CalDAV adapter against the devcontainer's Nextcloud (`sh scripts/calendar.sh start`),
 * through `bun run test:calendar`. Outside `bun run check`, which never needs the stack (D25). The contract cancels
 * what it books; a run that fails leaves a booking behind, so every run draws its own days far ahead.
 */
const url = process.env.CALENDAR_URL ?? 'http://calendar';
const person = (user: string) => new NextcloudProvider(user, `calendar-${user}-local-only`, url);
const running = await fetch(new URL('/status.php', url), { signal: AbortSignal.timeout(2000) }).then(
  response => response.ok,
  () => false,
);
const run = crypto.randomUUID();
const base = new Date(Date.UTC(2031, 0, 1) + Math.floor(Math.random() * 3000) * 86400000).toISOString().slice(0, 10);
let uids = 0;
describe.skipIf(!running)('Nextcloud', () => {
  calendarProviderContract(
    'Nextcloud',
    {
      organizer: () => person('hillevi'),
      guest: () => person('anna'),
      guestEmail: 'anna@clew.test',
      uid: () => `clew-contract-${run}-${++uids}`,
    },
    base,
  );
});
