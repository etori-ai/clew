// Serves connector.mjs over HTTP. Environment: PORT (default 4051), CLEW_CONNECTOR_SECRET (shared with Clew), CLEW_URL,
// FIXTURE_TODAY (a fixed day, YYYY-MM-DD), FIXTURE_PERSON_MAP (a JSON object, Clew person id to user name),
// APPRAISALS_LINK_BASE (the https address rows link to).
import { createServer } from 'node:http';
import { createConnector } from './connector.mjs';

const env = process.env;
let personMap = {};
if (env.FIXTURE_PERSON_MAP) {
  try {
    personMap = JSON.parse(env.FIXTURE_PERSON_MAP);
  } catch {
    throw new Error('FIXTURE_PERSON_MAP must be a JSON object');
  }
}
if (env.FIXTURE_TODAY && !/^\d{4}-\d{2}-\d{2}$/.test(env.FIXTURE_TODAY))
  throw new Error('FIXTURE_TODAY must be a day, YYYY-MM-DD');
if (env.APPRAISALS_LINK_BASE && !env.APPRAISALS_LINK_BASE.startsWith('https://'))
  throw new Error('APPRAISALS_LINK_BASE must be an https address');

const { handle } = createConnector({
  secret: env.CLEW_CONNECTOR_SECRET,
  personMap,
  ...(env.FIXTURE_TODAY ? { today: () => env.FIXTURE_TODAY } : {}),
  ...(env.APPRAISALS_LINK_BASE ? { linkBase: env.APPRAISALS_LINK_BASE.replace(/\/+$/, '') } : {}),
});
const port = Number(env.PORT ?? 4051);
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
}).listen(port, () => console.log(`appraisals connector listening on :${port}`));
