// Serves connector.mjs over HTTP. Environment (README.md has the full table):
//   PORT (default 4050), CLEW_CONNECTOR_SECRET (shared with Clew), CLEW_URL (where Clew's keys are fetched)
//   SM_ADAPTER            "fixture" (default: the made-up errands in errands.mjs) or "api" (SupportManagement)
//   SM_AUDIENCE           what the person's token is issued for (default "supportmanagement")
//   SM_SOURCE_LABEL       the system's name as a person reads it (default "Ärendesystemet")
//   SM_MUNICIPALITY_ID    the municipality id, part of every ref. Required for api
//   SM_URL                the API base. Required for api
//   SM_STATUS_KINDS       JSON object: status name -> new | open | waiting-reporter | waiting-other | closed
//   SM_NAMESPACE_LABELS   JSON object: namespace -> the name a person reads
//   SM_NAMESPACE_LINKS    JSON object: namespace -> an address with {errandNumber} in it
import { createServer } from 'node:http';
import { STATUS_KINDS, createConnector } from './connector.mjs';
import { createFixtureErrands } from './errands.mjs';
import { createSupportManagementErrands } from './supportmanagement.mjs';

/** A JSON object of strings from the environment, or `{}` when the variable is unset. */
const strings = name => {
  const text = process.env[name];
  if (!text) return {};
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(`${name} must be valid JSON.`);
  }
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !Object.values(value).every(v => typeof v === 'string')
  )
    throw new Error(`${name} must be a JSON object of strings.`);
  return value;
};

const adapter = process.env.SM_ADAPTER ?? 'fixture';
if (adapter !== 'fixture' && adapter !== 'api')
  throw new Error(`Unknown SM_ADAPTER "${adapter}". Known: fixture, api.`);

const audience = process.env.SM_AUDIENCE || 'supportmanagement';
if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(audience)) throw new Error('SM_AUDIENCE is not a valid audience.');

const statusKinds = strings('SM_STATUS_KINDS');
for (const [status, kind] of Object.entries(statusKinds))
  if (!STATUS_KINDS.includes(kind))
    throw new Error(`SM_STATUS_KINDS: "${status}" has the unknown kind "${kind}". Known: ${STATUS_KINDS.join(', ')}.`);

const areas = strings('SM_NAMESPACE_LABELS');
const municipalityId = process.env.SM_MUNICIPALITY_ID || (adapter === 'fixture' ? '0000' : undefined);

const source =
  adapter === 'api'
    ? createSupportManagementErrands({ url: process.env.SM_URL, municipalityId, areas })
    : createFixtureErrands({ audience });

const { handle } = createConnector({
  secret: process.env.CLEW_CONNECTOR_SECRET,
  source,
  municipalityId,
  audience,
  sourceLabel: process.env.SM_SOURCE_LABEL || undefined,
  statusKinds,
  links: strings('SM_NAMESPACE_LINKS'),
});
const port = Number(process.env.PORT ?? 4050);
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
}).listen(port, () => console.log(`sm connector listening on :${port} (${adapter} adapter)`));
