// Serves connector.mjs over HTTP. Environment:
//   PORT (default 4020), CLEW_CONNECTOR_SECRET (shared with Clew),
//   TELEFONBOK_ADAPTER  "fixture" (default: the made-up organisation in directory.mjs) or "http"
//   TELEFONBOK_URL, TELEFONBOK_API_KEY  the phone book API and its integration key, for the http adapter
//   TELEFONBOK_UNIT_MAP  optional JSON object: Clew unit id -> the phone book's unit id, where they differ
import { createServer } from 'node:http';
import { createConnector } from './connector.mjs';
import { createFixtureDirectory, createHttpDirectory } from './directory.mjs';

const adapter = process.env.TELEFONBOK_ADAPTER ?? 'fixture';
if (adapter !== 'fixture' && adapter !== 'http')
  throw new Error(`Unknown TELEFONBOK_ADAPTER "${adapter}". Known: fixture, http.`);
const directory =
  adapter === 'http'
    ? createHttpDirectory({ url: process.env.TELEFONBOK_URL, apiKey: process.env.TELEFONBOK_API_KEY })
    : createFixtureDirectory();
let unitMap = {};
if (process.env.TELEFONBOK_UNIT_MAP) {
  try {
    unitMap = JSON.parse(process.env.TELEFONBOK_UNIT_MAP);
  } catch {
    throw new Error('TELEFONBOK_UNIT_MAP must be a JSON object.');
  }
}

const { handle } = createConnector({ secret: process.env.CLEW_CONNECTOR_SECRET, directory, unitMap });
const port = Number(process.env.PORT ?? 4020);
createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const request = new Request(`http://${req.headers.host ?? 'connector'}${req.url}`, {
    method: req.method,
    headers: req.headers,
    body: chunks.length ? Buffer.concat(chunks) : undefined,
  });
  const response = await handle(request);
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}).listen(port, () => console.log(`telefonbok connector listening on :${port} (${adapter} adapter)`));
