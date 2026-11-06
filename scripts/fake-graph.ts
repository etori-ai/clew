/** Serves the local fake of Microsoft Graph (D61) on `GRAPH_PORT`, for the `graph` service of the devcontainer. State lives in memory. */
import { fixtureDirectory } from '@clew/calendar/accounts';
import { fakeGraph } from '@clew/calendar/fake-graph';

if (process.env.CLEW_POC !== 'true') throw new Error('CLEW_POC=true is required: the fake is a development fixture.');
const graph = fakeGraph({ ...fixtureDirectory(), roomDelayMs: Number(process.env.GRAPH_ROOM_DELAY_MS ?? 2000) });
const server = Bun.serve({
  hostname: '0.0.0.0',
  port: Number(process.env.GRAPH_PORT ?? 4010),
  fetch: request => (new URL(request.url).pathname === '/health' ? new Response('ok') : graph.fetch(request)),
});
console.log(`The local fake of Microsoft Graph listens on ${server.url.href}v1.0`);
