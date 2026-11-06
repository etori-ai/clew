import { fakeGraphToken } from '../../packages/calendar/src/accounts';
import { Microsoft365Provider } from '../../packages/calendar/src/microsoft365';
import { calendarProviderContract } from '../calendar-provider-contract';

/**
 * The calendar contract on the Microsoft 365 adapter against the development stack's `graph` service, the local fake of
 * Microsoft Graph (D69), over the network as the BFF reaches it, through `bun run test:calendar`. The same contract runs
 * on the fake in-process in `bun run check`; this run proves the service as the stack runs it, seeded and reachable. The
 * contract cancels what it books and draws its days far ahead, so it leaves the seeded weeks alone.
 */
const url = process.env.GRAPH_URL ?? 'http://graph:4010/v1.0';
const person = (user: string, name: string) =>
  new Microsoft365Provider(async () => fakeGraphToken(`${user}@clew.test`), { email: `${user}@clew.test`, name }, url);
const running = await fetch(new URL('/health', url), { signal: AbortSignal.timeout(2000) }).then(
  response => response.ok,
  () => false,
);
if (!running)
  throw new Error(
    `The local fake of Microsoft Graph does not answer at ${url}. Start it with sh scripts/graph.sh start.`,
  );
const run = crypto.randomUUID();
const base = new Date(Date.UTC(2031, 0, 1) + Math.floor(Math.random() * 3000) * 86400000).toISOString().slice(0, 10);
let uids = 0;
calendarProviderContract(
  'Microsoft 365 over the stack’s fake of Graph',
  {
    organizer: () => person('hillevi', 'Hillevi Berg'),
    guest: () => person('anna', 'Anna Lindqvist'),
    guestEmail: 'anna@clew.test',
    uid: () => `clew-contract-${run}-${++uids}`,
  },
  base,
);
