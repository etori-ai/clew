// Serves connector.mjs over HTTP with the SQLite store. Environment: PORT (4042), CLEW_CONNECTOR_SECRET, CLEW_URL,
// FIXTURE_DB (the SQLite file), FIXTURE_TODAY (a fixed day, YYYY-MM-DD), FIXTURE_RESEED, FIXTURE_FAULT, FIXTURE_UNIT_MAP,
// FIXTURE_PERSON_MAP (JSON objects, Clew id to the source's id), nothing else.
import { createServer } from 'node:http';
import { createConnector } from './connector.mjs';
import { sqliteState } from './state.mjs';

const env = process.env;
const parse = name => {
  if (!env[name]) return {};
  try {
    return JSON.parse(env[name]);
  } catch {
    throw new Error(name + ' must be a JSON object');
  }
};
const state = await sqliteState(env.FIXTURE_DB ?? './incidents.sqlite');
const connector = createConnector({
  secret: env.CLEW_CONNECTOR_SECRET,
  clewUrl: env.CLEW_URL,
  state,
  clock: env.FIXTURE_TODAY ? () => new Date(env.FIXTURE_TODAY + 'T08:00:00+01:00') : () => new Date(),
  fault: env.FIXTURE_FAULT ?? '',
  unitMap: parse('FIXTURE_UNIT_MAP'),
  personMap: parse('FIXTURE_PERSON_MAP'),
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
      new Request('http://incidents' + req.url, {
        method: req.method,
        headers: req.headers,
        ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
      }),
    );
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    console.error('incidents fixture failure:', error.message);
    res.destroy();
  }
});
server.listen(Number(env.PORT ?? 4042), '0.0.0.0', () =>
  console.log(
    `incidents connector listening on :${server.address().port}${env.FIXTURE_FAULT ? ` (fault: ${env.FIXTURE_FAULT})` : ''}`,
  ),
);
process.on('SIGTERM', () =>
  server.close(() => {
    connector.close();
    process.exit(0);
  }),
);
