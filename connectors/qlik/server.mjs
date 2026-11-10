// Serves connector.mjs over HTTP. Environment (README.md has the full table):
//   PORT (default 4048), CLEW_CONNECTOR_SECRET (shared with Clew), CLEW_URL (where Clew's keys are fetched)
//   QLIK_ADAPTER                "fixture" (default: the made-up statistics in statistics.mjs) or "engine" (Qlik)
//   QLIK_UNIT_MAP               JSON object: Clew unit id -> array of Qlik's unit names. Required for engine
//   QLIK_MIN_GROUP              the smallest group whose rates are shown (default 5)
//   QLIK_SICK_LEAVE_WARN_ABOVE  optional rate in percent from which the sick-leave figure says "warn" and qlik.unit "Bevaka"
//   QLIK_CACHE_SECONDS          how long aggregates are kept in memory (default 300)
//   QLIK_URL, QLIK_APP_ID, QLIK_TOKEN, QLIK_SICK_LEAVE_CUBE, QLIK_RATES_AS  the engine adapter (engine.mjs)
import { createServer } from 'node:http';
import { createConnector } from './connector.mjs';
import { createFixtureStatistics, fixtureUnitMap } from './statistics.mjs';
import { createQlikStatistics } from './engine.mjs';

const json = (name, fallback) => {
  const text = process.env[name];
  if (!text) return fallback;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${name} must be valid JSON.`);
  }
};
const positive = (name, fallback) => {
  const text = process.env[name];
  if (!text) return fallback;
  const n = Number(text);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name} must be a non-negative number.`);
  return n;
};

const adapter = process.env.QLIK_ADAPTER ?? 'fixture';
if (adapter !== 'fixture' && adapter !== 'engine')
  throw new Error(`Unknown QLIK_ADAPTER "${adapter}". Known: fixture, engine.`);

const unitMap = json('QLIK_UNIT_MAP', adapter === 'fixture' ? fixtureUnitMap : undefined);
if (
  !unitMap ||
  typeof unitMap !== 'object' ||
  Array.isArray(unitMap) ||
  !Object.values(unitMap).every(v => Array.isArray(v) && v.every(s => typeof s === 'string'))
)
  throw new Error('QLIK_UNIT_MAP must be a JSON object of Clew unit id to an array of unit names.');

const statistics =
  adapter === 'engine'
    ? createQlikStatistics({
        url: process.env.QLIK_URL,
        appId: process.env.QLIK_APP_ID,
        token: process.env.QLIK_TOKEN,
        cube: json('QLIK_SICK_LEAVE_CUBE'),
        ratesAs: process.env.QLIK_RATES_AS ?? 'fraction',
      })
    : createFixtureStatistics();

const { handle } = createConnector({
  secret: process.env.CLEW_CONNECTOR_SECRET,
  statistics,
  unitMap,
  minGroup: positive('QLIK_MIN_GROUP', 5),
  warnAbove: positive('QLIK_SICK_LEAVE_WARN_ABOVE', undefined),
  cacheSeconds: positive('QLIK_CACHE_SECONDS', 300),
});
const port = Number(process.env.PORT ?? 4048);
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
}).listen(port, () => console.log(`qlik connector listening on :${port} (${adapter} adapter)`));
