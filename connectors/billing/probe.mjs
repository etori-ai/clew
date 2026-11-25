// A read-only probe of BillingPreprocessor through the gateway, before the connector is put in front of anyone: it
// fetches a token with the client credentials, lists the category's records that wait for attest and reads the oldest
// one, as the connector would. It writes nothing. It prints counts and which of the fields the connector reads are
// present, never a name, a reference or a row's text.
//
//   BILLING_URL=… BILLING_TOKEN_URL=… BILLING_CLIENT_ID=… BILLING_CLIENT_SECRET=… BILLING_MUNICIPALITY_ID=… \
//   PROBE_ACCOUNT=<the AD account named in X-Sent-By> node connectors/billing/probe.mjs
import { createBillingPreprocessor } from './billingpreprocessor.mjs';
import { shownRecord } from './connector.mjs';
import { customersFrom } from './customers.mjs';

const env = process.env;
const account = env.PROBE_ACCOUNT;
if (!account) throw new Error('PROBE_ACCOUNT is required: the AD account the gateway is told in X-Sent-By.');
const category = env.BILLING_CATEGORY || 'SALARY_AND_PENSION';
const source = createBillingPreprocessor({
  url: env.BILLING_URL,
  tokenUrl: env.BILLING_TOKEN_URL,
  clientId: env.BILLING_CLIENT_ID,
  clientSecret: env.BILLING_CLIENT_SECRET,
  municipalityId: env.BILLING_MUNICIPALITY_ID,
  category,
});

const count = (values, key) =>
  Object.entries(values.reduce((n, v) => ({ ...n, [key(v)]: (n[key(v)] ?? 0) + 1 }), {}))
    .map(([k, v]) => `${k} ${v}`)
    .join(', ') || 'none';

try {
  const records = await source.list(account);
  console.log(`token and list: ok. ${records.length} ${category} records wait for attest (NEW).`);
  console.log(`  by type: ${count(records, r => r.type ?? 'no type')}`);
  if (records.length === 0) {
    console.log('Nothing to read further. Create a billing record in the category to try a decision.');
    process.exit(0);
  }
  const first = await source.get(account, records[0].id);
  const shown = shownRecord(first, customersFrom(env.BILLING_CUSTOMERS));
  console.log(`read one: ok, status ${first.status}.`);
  const fields = {
    'invoice.description': !!first.invoice?.description,
    'invoice.totalAmount or row totals': Number.isFinite(shown.amount) && shown.amount > 0,
    'invoice.invoiceRows': shown.lines.length > 0,
    'extraParameters.errandNumber': !!shown.errand,
    'extraParameters.referenceName (Chef)': !!shown.chef,
    'customer named by BILLING_CUSTOMERS': !shown.customer.startsWith('Kundnummer'),
    created: !!shown.created,
    modified: !!first.modified,
    transferDate: !!shown.transferDate,
    'accountInformation on a row': shown.lines.some(line => line.account),
  };
  for (const [field, present] of Object.entries(fields)) console.log(`  ${present ? 'present' : 'missing'}  ${field}`);
} catch (error) {
  // The adapter's errors say what failed and carry nothing from a record.
  console.error(`failed: ${error?.name}: ${error?.message}`);
  process.exit(1);
}
