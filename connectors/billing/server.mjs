// Serves connector.mjs over HTTP. Environment (README.md has the full table):
//   PORT (default 4056), CLEW_CONNECTOR_SECRET (shared with Clew), CLEW_URL (where Clew's keys are fetched)
//   BILLING_ADAPTER          "fixture" (default: the made-up records in records.mjs) or "api" (BillingPreprocessor)
//   BILLING_SOURCE_LABEL     the system's name as a person reads it (default "Lön och pension")
//   BILLING_CATEGORY         the billing records shown and changed (default "SALARY_AND_PENSION")
//   BILLING_ERRAND_LINK      optional: an https address with {errandNumber} in it, the errand a record comes from
//   BILLING_CUSTOMERS        optional: JSON, customer number to name per type (customers.mjs); the fixture has its own
// For api:
//   BILLING_URL              BillingPreprocessor at the gateway, with its version
//   BILLING_MUNICIPALITY_ID  the municipality id
//   BILLING_TOKEN_URL, BILLING_CLIENT_ID, BILLING_CLIENT_SECRET   the gateway's client credentials
// For fixture:
//   BILLING_FIXTURE_FAULT    "" or "unavailable"
import { createServer } from 'node:http';
import { createConnector } from './connector.mjs';
import { FIXTURE_CUSTOMERS, createFixtureRecords } from './records.mjs';
import { customersFrom } from './customers.mjs';
import { createBillingPreprocessor } from './billingpreprocessor.mjs';
import { listener } from './http.mjs';

const env = process.env;
const adapter = env.BILLING_ADAPTER || 'fixture';
if (adapter !== 'fixture' && adapter !== 'api')
  throw new Error(`Unknown BILLING_ADAPTER "${adapter}". Known: fixture, api.`);
const category = env.BILLING_CATEGORY || 'SALARY_AND_PENSION';
const fault = env.BILLING_FIXTURE_FAULT || '';
if (!['', 'unavailable'].includes(fault)) throw new Error('BILLING_FIXTURE_FAULT must be empty or "unavailable".');

const source =
  adapter === 'api'
    ? createBillingPreprocessor({
        url: env.BILLING_URL,
        tokenUrl: env.BILLING_TOKEN_URL,
        clientId: env.BILLING_CLIENT_ID,
        clientSecret: env.BILLING_CLIENT_SECRET,
        municipalityId: env.BILLING_MUNICIPALITY_ID,
        category,
      })
    : createFixtureRecords({ category, today: () => new Date().toISOString().slice(0, 10), fault });

// One line per decision and per scan that failed: what happened, never a record's text or a person's name.
const log = entry => console.log(JSON.stringify({ connector: 'billing', ...entry }));

const { handle } = createConnector({
  secret: env.CLEW_CONNECTOR_SECRET,
  clewUrl: env.CLEW_URL,
  source,
  sourceLabel: env.BILLING_SOURCE_LABEL || undefined,
  errandLink: env.BILLING_ERRAND_LINK || undefined,
  customers: env.BILLING_CUSTOMERS || adapter === 'api' ? customersFrom(env.BILLING_CUSTOMERS) : FIXTURE_CUSTOMERS,
  log,
});

/**
 * For trying the fixture by hand, and nowhere else: `POST /fixture/reset` puts the made-up records back as they were,
 * and `POST /fixture/transfer` sends the attested ones on, as the monthly transfer to the economy system does.
 */
async function serve(request) {
  const { pathname } = new URL(request.url);
  if (adapter !== 'fixture' || request.method !== 'POST' || !pathname.startsWith('/fixture/')) return handle(request);
  if (pathname === '/fixture/reset') source.reset();
  else if (pathname === '/fixture/transfer') source.transfer();
  else return new Response('Unknown fixture action.\n', { status: 404 });
  return new Response('Done.\n');
}

const port = Number(env.PORT ?? 4056);
createServer(listener(serve)).listen(port, () =>
  console.log(`billing connector listening on :${port} (${adapter} adapter, ${category})`),
);
