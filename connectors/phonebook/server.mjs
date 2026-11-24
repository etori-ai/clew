// Serves connector.mjs over HTTP. Environment:
//   PORT (default 4020), CLEW_CONNECTOR_SECRET (shared with Clew), CLEW_URL (where Clew's keys are fetched)
//   PHONEBOOK_ADAPTER  "http" or "fixture" (the made-up organisation in directory.mjs: development and tests only).
//                      Required: there is no default (`adapterOf` in connector.mjs)
//   PHONEBOOK_URL, PHONEBOOK_API_KEY  the phone book API and its integration key, for the http adapter
//   PHONEBOOK_ALLOW_HTTP  true lets PHONEBOOK_URL be plain http on a private development network
//   PHONEBOOK_UNIT_MAP  optional JSON object: Clew unit id -> the phone book's unit id, where they differ
import { createServer } from 'node:http';
import { listener } from './http.mjs';
import { adapterOf, createConnector } from './connector.mjs';
import { createFixtureDirectory, createHttpDirectory } from './directory.mjs';

const adapter = adapterOf(process.env);
const directory =
  adapter === 'http'
    ? createHttpDirectory({ url: process.env.PHONEBOOK_URL, apiKey: process.env.PHONEBOOK_API_KEY })
    : createFixtureDirectory();
let unitMap = {};
if (process.env.PHONEBOOK_UNIT_MAP) {
  try {
    unitMap = JSON.parse(process.env.PHONEBOOK_UNIT_MAP);
  } catch {
    throw new Error('PHONEBOOK_UNIT_MAP must be a JSON object.');
  }
}

const { handle } = createConnector({ secret: process.env.CLEW_CONNECTOR_SECRET, directory, unitMap });
const port = Number(process.env.PORT ?? 4020);
createServer(listener(handle)).listen(port, () =>
  console.log(`phonebook connector listening on :${port} (${adapter} adapter)`),
);
