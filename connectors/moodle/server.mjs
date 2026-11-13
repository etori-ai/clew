// Serves connector.mjs over HTTP. Environment (README.md has the full table):
//   PORT (default 4053), CLEW_CONNECTOR_SECRET (shared with Clew), CLEW_URL (where Clew's keys are fetched)
//   MOODLE_ADAPTER        "moodle" (the real API) or "fixture" (the in-memory stand-in in learning.mjs, whose people
//                         are made up: development and tests only). Required: there is no default (config.mjs)
//   MOODLE_URL            Moodle's base address, as the connector reaches it. Required for moodle, refused for fixture
//   MOODLE_TOKEN          the service account's web service token. Required for moodle, refused for fixture
//   MOODLE_ALLOW_HTTP     "true" lets MOODLE_URL be plain http on a private development network
//   MOODLE_MATCH_FIELD    the Moodle field that holds the key Clew sends: "username" (default) or "idnumber"
//   MOODLE_SOURCE_LABEL   the system's name as a person reads it (default "Lärplattformen")
//   MOODLE_PUBLIC_URL     Moodle's address in the person's browser, for links to a course (optional)
//   MOODLE_TIMEZONE       the zone Moodle's times are read as days in (default "Europe/Stockholm")
//   MOODLE_CONCURRENCY    how many Moodle calls one request may have open at once (default 4, at most 16)
import { createServer } from 'node:http';
import { adapterOf } from './config.mjs';
import { MATCH_FIELDS, createConnector } from './connector.mjs';
import { createFixtureLearning } from './learning.mjs';
import { createMoodleLearning } from './moodle.mjs';

const env = process.env;
const adapter = adapterOf(env);

const match = env.MOODLE_MATCH_FIELD || 'username';
if (!MATCH_FIELDS.includes(match))
  throw new Error(`Unknown MOODLE_MATCH_FIELD "${match}". Known: ${MATCH_FIELDS.join(', ')}.`);

const timeZone = env.MOODLE_TIMEZONE || 'Europe/Stockholm';
try {
  new Intl.DateTimeFormat('sv-SE', { timeZone });
} catch {
  throw new Error(`MOODLE_TIMEZONE "${timeZone}" is not a time zone.`);
}

const concurrency = Number(env.MOODLE_CONCURRENCY || 4);
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16)
  throw new Error('MOODLE_CONCURRENCY must be a whole number from 1 to 16.');

const sourceLabel = (env.MOODLE_SOURCE_LABEL || '').trim() || undefined;
if (sourceLabel && sourceLabel.length > 80) throw new Error('MOODLE_SOURCE_LABEL is longer than 80 characters.');

const publicUrl = env.MOODLE_PUBLIC_URL || undefined;
if (publicUrl) {
  const parsed = new URL(publicUrl);
  if (
    parsed.protocol !== 'https:' &&
    !(parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname))
  )
    throw new Error('MOODLE_PUBLIC_URL must be https outside local development.');
}

const source =
  adapter === 'moodle'
    ? createMoodleLearning({
        url: env.MOODLE_URL,
        token: env.MOODLE_TOKEN,
        allowHttp: env.MOODLE_ALLOW_HTTP === 'true',
      })
    : createFixtureLearning();

const { handle } = createConnector({
  secret: env.CLEW_CONNECTOR_SECRET,
  source,
  match,
  sourceLabel,
  publicUrl,
  timeZone,
  concurrency,
});
const port = Number(env.PORT ?? 4053);
createServer(async (req, res) => {
  // When Clew goes away before the answer (its own timeout, a page closed), the read's Moodle calls are stopped.
  const gone = new AbortController();
  res.on('close', () => {
    if (!res.writableFinished) gone.abort();
  });
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const request = new Request(`http://${req.headers.host ?? 'connector'}${req.url}`, {
    method: req.method,
    headers: req.headers,
    body: chunks.length ? Buffer.concat(chunks) : undefined,
    signal: gone.signal,
  });
  const response = await handle(request);
  if (gone.signal.aborted) return;
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}).listen(port, () =>
  console.log(`moodle connector listening on :${port} (${adapter} adapter, people matched on ${match})`),
);
