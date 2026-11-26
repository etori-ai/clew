// Serves connector.mjs over HTTP. Environment (README.md has the full table):
//   PORT (default 4052), CLEW_CONNECTOR_SECRET (shared with Clew), CLEW_URL (where Clew's keys are fetched)
//   NEXTCLOUD_ADAPTER       "nextcloud" (the real API) or "fixture" (the in-memory stand-in in approvals.mjs, whose
//                           files are made up: development and tests only). Required: there is no default (`adapterOf`)
//   NEXTCLOUD_URL           Nextcloud's base address, as the connector reaches it. Required for nextcloud
//   NEXTCLOUD_ALLOW_HTTP    "true" lets NEXTCLOUD_URL be plain http on a private development network
//   NEXTCLOUD_AUDIENCE      what the person's token is issued for (default "nextcloud")
//   NEXTCLOUD_ACCOUNT       "delegated" (default: the identity provider's token, through user_oidc) or "linked" (the
//                           person links an account at Nextcloud's own OAuth 2 server, D147)
//   NEXTCLOUD_SOURCE_LABEL  the system's name as a person reads it (default "Nextcloud")
//   NEXTCLOUD_PUBLIC_URL    Nextcloud's address in the person's browser, for links to a file (optional)
import { createServer } from 'node:http';
import { listener } from './http.mjs';
import { adapterOf, createConnector } from './connector.mjs';
import { createFixtureApproval } from './approvals.mjs';
import { createNextcloudApproval } from './nextcloud.mjs';
import { keysAddress } from './verification.mjs';

// CLEW_URL is where Clew's public keys are fetched on the first call: one they cannot be fetched from is refused here.
if (!keysAddress(process.env.CLEW_URL))
  throw new Error(
    "CLEW_URL must be Clew's base URL, where its public keys are fetched: https, or plain http only on a host of the " +
      'development stack.',
  );

const env = process.env;
const adapter = adapterOf(env);

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

// How the connector acts as the person. Linked: the manifest names Nextcloud's address, as the person's browser reaches
// it where that is configured, and the token is one Nextcloud's own OAuth 2 server issued.
const account = env.NEXTCLOUD_ACCOUNT || 'delegated';
if (!['delegated', 'linked'].includes(account)) throw new Error('NEXTCLOUD_ACCOUNT must be "delegated" or "linked".');
const resource = publicUrl ?? env.NEXTCLOUD_URL;
if (account === 'linked' && !resource)
  throw new Error('NEXTCLOUD_ACCOUNT=linked needs NEXTCLOUD_PUBLIC_URL or NEXTCLOUD_URL: the address of Nextcloud.');

const source =
  adapter === 'nextcloud'
    ? createNextcloudApproval({ url: env.NEXTCLOUD_URL, allowHttp: env.NEXTCLOUD_ALLOW_HTTP === 'true' })
    : createFixtureApproval({ audience });

const { handle } = createConnector({
  secret: env.CLEW_CONNECTOR_SECRET,
  source,
  audience,
  ...(account === 'linked' ? { linkedAccount: { resource: resource.replace(/\/+$/, '') } } : {}),
  sourceLabel: env.NEXTCLOUD_SOURCE_LABEL || undefined,
  publicUrl,
});
const port = Number(env.PORT ?? 4052);
createServer(listener(handle)).listen(port, () =>
  console.log(`nextcloud-approval connector listening on :${port} (${adapter} adapter, ${account} account)`),
);
