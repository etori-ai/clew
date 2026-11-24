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
// What an errand's owner sees and answers is switched on by SM_IDP_ISSUER, since the connector then checks the
// person's token itself:
//   SM_IDP_ISSUER         the identity provider's issuer
//   SM_IDP_JWKS_URL       where its keys are. https, or a host in SM_INSECURE_HTTP_HOSTS for development
//   SM_ACCOUNT_CLAIM      the claim that carries the AD account (default "preferred_username")
//   SM_REPLY_ADDRESSES    JSON object: namespace -> the address its e-mail reader reads (the fixture has its own)
//   SM_STATE_SECONDS      how long an errand's state for its owner is kept (default 120)
import { createServer } from 'node:http';
import { STATUS_KINDS, createConnector } from './connector.mjs';
import { createFixtureErrands, fixtureReplyAddresses } from './errands.mjs';
import { createSupportManagementErrands } from './supportmanagement.mjs';
import { listener } from './http.mjs';

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

/** The owner's side, when SM_IDP_ISSUER is set. Every error names its variable, so a wrong setting stops the start. */
function ownerSettings() {
  const issuer = process.env.SM_IDP_ISSUER;
  if (!issuer) return undefined;
  const insecureHosts = (process.env.SM_INSECURE_HTTP_HOSTS || 'localhost,127.0.0.1')
    .split(',')
    .map(host => host.trim())
    .filter(Boolean);
  let jwksAt;
  try {
    jwksAt = new URL(process.env.SM_IDP_JWKS_URL ?? '');
  } catch {
    throw new Error('SM_IDP_JWKS_URL is required with SM_IDP_ISSUER, and must be an address.');
  }
  if (jwksAt.protocol !== 'https:' && !(jwksAt.protocol === 'http:' && insecureHosts.includes(jwksAt.hostname)))
    throw new Error('SM_IDP_JWKS_URL must be https, or its host listed in SM_INSECURE_HTTP_HOSTS for development.');
  const accountClaim = process.env.SM_ACCOUNT_CLAIM || 'preferred_username';
  if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(accountClaim)) throw new Error('SM_ACCOUNT_CLAIM is not a claim name.');
  const replyAddresses = process.env.SM_REPLY_ADDRESSES
    ? strings('SM_REPLY_ADDRESSES')
    : adapter === 'fixture'
      ? fixtureReplyAddresses
      : {};
  const stateSeconds = Number(process.env.SM_STATE_SECONDS ?? 120);
  if (!Number.isInteger(stateSeconds) || stateSeconds < 0 || stateSeconds > 3600)
    throw new Error('SM_STATE_SECONDS must be a whole number of seconds, at most 3600.');
  return {
    identity: { issuer, jwksUrl: jwksAt.toString(), insecureHosts },
    accountClaim,
    replyAddresses,
    stateSeconds,
  };
}

const { handle, forget } = createConnector({
  secret: process.env.CLEW_CONNECTOR_SECRET,
  source,
  municipalityId,
  audience,
  sourceLabel: process.env.SM_SOURCE_LABEL || undefined,
  statusKinds,
  links: strings('SM_NAMESPACE_LINKS'),
  owner: ownerSettings(),
});

/**
 * For trying the fixture by hand, and nowhere else: `POST /fixture/handler-writes` with `{ "errandNumber", "channel":
 * "email" | "webmessage" }` makes the handler write to the owner again, and `POST /fixture/mail-filed` with
 * `{ "errandNumber" }` files the owner's mail answer as the e-mail reader would.
 */
async function serve(request) {
  const { pathname } = new URL(request.url);
  if (adapter !== 'fixture' || request.method !== 'POST' || !pathname.startsWith('/fixture/')) return handle(request);
  let body;
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const number = typeof body?.errandNumber === 'string' ? body.errandNumber : '';
  const done =
    pathname === '/fixture/handler-writes'
      ? source.handlerWrites(number, body.channel === 'webmessage' ? 'webmessage' : 'email')
      : pathname === '/fixture/mail-filed'
        ? source.mailFiled(number)
        : undefined;
  if (done === undefined) return new Response('Unknown fixture action.\n', { status: 404 });
  forget();
  return new Response(done ? 'Done.\n' : 'No owned errand with that number.\n', { status: done ? 200 : 404 });
}

const port = Number(process.env.PORT ?? 4050);
createServer(listener(serve)).listen(port, () =>
  console.log(`sm connector listening on :${port} (${adapter} adapter)`),
);
