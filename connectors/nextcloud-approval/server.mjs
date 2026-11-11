// Serves connector.mjs over HTTP. Environment (README.md has the full table):
//   PORT (default 4052), CLEW_CONNECTOR_SECRET (shared with Clew), CLEW_URL (where Clew's keys are fetched)
//   NEXTCLOUD_ADAPTER       "fixture" (default: the in-memory stand-in in approvals.mjs) or "nextcloud" (the real API)
//   NEXTCLOUD_URL           Nextcloud's base address, as the connector reaches it. Required for nextcloud
//   NEXTCLOUD_ALLOW_HTTP    "true" lets NEXTCLOUD_URL be plain http on a private development network
//   NEXTCLOUD_AUDIENCE      what the person's token is issued for (default "nextcloud")
//   NEXTCLOUD_SOURCE_LABEL  the system's name as a person reads it (default "Nextcloud")
//   NEXTCLOUD_PUBLIC_URL    Nextcloud's address in the person's browser, for links to a file (optional)
import { createServer } from 'node:http';
import { createConnector } from './connector.mjs';
import { createFixtureApproval } from './approvals.mjs';
import { createNextcloudApproval } from './nextcloud.mjs';

const env = process.env;
const adapter = env.NEXTCLOUD_ADAPTER || 'fixture';
if (adapter !== 'fixture' && adapter !== 'nextcloud')
  throw new Error(`Unknown NEXTCLOUD_ADAPTER "${adapter}". Known: fixture, nextcloud.`);

const audience = env.NEXTCLOUD_AUDIENCE || 'nextcloud';
if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(audience))
  throw new Error('NEXTCLOUD_AUDIENCE is not a valid audience.');

const publicUrl = env.NEXTCLOUD_PUBLIC_URL || undefined;
if (publicUrl) {
  const parsed = new URL(publicUrl);
  if (
    parsed.protocol !== 'https:' &&
    !(parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname))
  )
    throw new Error('NEXTCLOUD_PUBLIC_URL must be https outside local development.');
}

const source =
  adapter === 'nextcloud'
    ? createNextcloudApproval({ url: env.NEXTCLOUD_URL, allowHttp: env.NEXTCLOUD_ALLOW_HTTP === 'true' })
    : createFixtureApproval({ audience });

const { handle } = createConnector({
  secret: env.CLEW_CONNECTOR_SECRET,
  source,
  audience,
  sourceLabel: env.NEXTCLOUD_SOURCE_LABEL || undefined,
  publicUrl,
});
const port = Number(env.PORT ?? 4052);
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
}).listen(port, () => console.log(`nextcloud-approval connector listening on :${port} (${adapter} adapter)`));
