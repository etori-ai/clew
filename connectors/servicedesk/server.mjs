// Serves connector.mjs over HTTP with the SQLite store. Environment: PORT (4054), CLEW_CONNECTOR_SECRET, CLEW_URL,
// FIXTURE_DB (the SQLite file), FIXTURE_TODAY (a fixed day, YYYY-MM-DD), FIXTURE_RESEED, FIXTURE_FAULT, FIXTURE_KEY (the
// key of the fixture's own route that moves a request forward), nothing else.
import { createServer } from 'node:http';
import { createConnector } from './connector.mjs';
import { sqliteState } from './state.mjs';

const env = process.env;
const state = await sqliteState(env.FIXTURE_DB ?? './servicedesk.sqlite');
const connector = createConnector({
  secret: env.CLEW_CONNECTOR_SECRET,
  clewUrl: env.CLEW_URL,
  state,
  clock: env.FIXTURE_TODAY ? () => new Date(env.FIXTURE_TODAY + 'T08:00:00+01:00') : () => new Date(),
  fault: env.FIXTURE_FAULT ?? '',
  fixtureKey: env.FIXTURE_KEY ?? '',
  fresh: env.FIXTURE_RESEED === 'true',
});
const server = createServer(async (req, res) => {
  try {
    const chunks = [];
    let length = 0;
    for await (const chunk of req) {
      length += chunk.length;
      if (length > 65536) {
        res.writeHead(413);
        res.end();
        return;
      }
      chunks.push(chunk);
    }
    const response = await connector.handle(
      new Request('http://servicedesk' + req.url, {
        method: req.method,
        headers: req.headers,
        ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
      }),
    );
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    console.error('servicedesk fixture failure:', error.message);
    res.destroy();
  }
});
server.listen(Number(env.PORT ?? 4054), '0.0.0.0', () =>
  console.log(
    `servicedesk connector listening on :${server.address().port}${env.FIXTURE_FAULT ? ` (fault: ${env.FIXTURE_FAULT})` : ''}`,
  ),
);
process.on('SIGTERM', () =>
  server.close(() => {
    connector.close();
    process.exit(0);
  }),
);
