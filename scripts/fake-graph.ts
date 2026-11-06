/**
 * Serves the local fake of Microsoft Graph (D69) on `GRAPH_PORT`, for the `graph` service of the devcontainer, and books
 * the synthetic meetings in it as it starts, the way the fixture connectors seed their own records (D61). State lives in
 * memory, so a restart is a fresh seed from today. `/health` answers 503 until the seed is in place, so `--wait` means
 * seeded.
 */
import { fixtureDirectory, fakeGraphToken } from '@clew/calendar/accounts';
import { createCalendarProvider } from '@clew/calendar/adapters';
import { fakeGraph } from '@clew/calendar/fake-graph';
import { fixtureWeeks, seedCalendar } from './calendar-fixtures';

if (process.env.CLEW_POC !== 'true') throw new Error('CLEW_POC=true is required: the fake is a development fixture.');
const directory = fixtureDirectory();
const graph = fakeGraph({ ...directory, roomDelayMs: Number(process.env.GRAPH_ROOM_DELAY_MS ?? 2000) });
let seeded = false;
const server = Bun.serve({
  hostname: '0.0.0.0',
  port: Number(process.env.GRAPH_PORT ?? 4010),
  fetch: request =>
    new URL(request.url).pathname === '/health'
      ? new Response(seeded ? 'ok' : 'seeding', { status: seeded ? 200 : 503 })
      : graph.fetch(request),
});
const url = `http://127.0.0.1:${server.port}/v1.0`;
console.log(`The local fake of Microsoft Graph listens on ${server.url.href}v1.0`);

// Every synthetic person books through the adapter itself, over the network, so the seed exercises what the BFF uses.
const providerFor = (user: string) => {
  const email = `${user}@clew.test`;
  const name = directory.people.find(p => p.email === email)?.name ?? user;
  return createCalendarProvider({
    kind: 'microsoft365',
    url,
    account: { email, name },
    token: async () => fakeGraphToken(email),
  });
};
const { monday, next } = fixtureWeeks();
const { booked } = await seedCalendar(providerFor);
seeded = true;
console.log(`Seeded ${booked} meetings for weeks ${monday} and ${next}, with ${directory.rooms.length} rooms.`);
