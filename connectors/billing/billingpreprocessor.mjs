// BillingPreprocessor's API (4.5) behind the billing record port, as Draken's Lön och pension calls it: through the
// API gateway with the connector's own client credential, and the person named in `X-Sent-By` as Draken names them
// (`type=adAccount; <account>`). Whether BillingPreprocessor reads that header for anything but its log is not
// known; the rule for who may attest is held by Clew's audience (README.md, "Who may attest"). Not run against a real
// installation.
import { SourceNotFound, SourceRefused, SourceUnavailable } from './records.mjs';

/** An account as it may be sent on in `X-Sent-By`. Anything else is refused here and never reaches the gateway. */
export const ACCOUNT_PATTERN = /^[A-Za-z0-9._@-]{1,128}$/;
const ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;
const CATEGORY_PATTERN = /^[A-Z_]{1,40}$/;
const MAX_PAGES = 5;

const local = url => ['localhost', '127.0.0.1'].includes(url.hostname);
const twoDecimals = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

/**
 * The body of a write, as Draken's Lön och pension shapes it before its PUT (`satisfyApi` in
 * `support-billing-service.ts`): the API takes the fields a person may set and refuses the rest. The record's id is
 * in the path; its dates, both `totalAmount`s and an internal record's `recipient` are the API's own and are left out.
 */
export function writable(record) {
  const invoice = { ...record.invoice };
  delete invoice.totalAmount;
  invoice.invoiceRows = (invoice.invoiceRows ?? []).map(row => {
    const next = { ...row };
    delete next.totalAmount;
    next.detailedDescriptions = (next.detailedDescriptions ?? []).filter(d => d !== '');
    if (next.quantity != null) next.quantity = twoDecimals(next.quantity);
    if (next.costPerUnit != null) next.costPerUnit = twoDecimals(next.costPerUnit);
    return next;
  });
  return {
    ...(record.type === 'EXTERNAL' ? { recipient: record.recipient } : {}),
    invoice,
    category: record.category,
    type: record.type,
    status: record.status,
    ...(record.approvedBy != null ? { approvedBy: record.approvedBy } : {}),
    extraParameters: record.extraParameters,
  };
}

/** What the API said when it refused a change: its problem's title, detail and violated fields, no values. */
async function refusalOf(response) {
  try {
    const problem = await response.json();
    const violations = Array.isArray(problem?.violations)
      ? problem.violations.map(v => `${v.field}: ${v.message}`).join('; ')
      : '';
    return [problem?.title, problem?.detail, violations].filter(Boolean).join(' · ').slice(0, 500);
  } catch {
    return '';
  }
}

/**
 * url: the API base for BillingPreprocessor at the gateway, with its version (`https://…/billingpreprocessor/4.5`).
 * tokenUrl, clientId, clientSecret: the gateway's OAuth 2 client credentials. municipalityId: the installation's.
 * category: the billing records this connector shows and changes (`SALARY_AND_PENSION` for Lön och pension).
 * `fetch` and `now` are injectable for tests.
 */
export function createBillingPreprocessor({
  url,
  tokenUrl,
  clientId,
  clientSecret,
  municipalityId,
  category = 'SALARY_AND_PENSION',
  fetch: fetchImpl = globalThis.fetch,
  timeoutMs = 8000,
  pageSize = 100,
  now = () => Date.now(),
} = {}) {
  if (!url) throw new Error('BILLING_URL is required: the gateway address of BillingPreprocessor, with its version.');
  if (!tokenUrl || !clientId || !clientSecret)
    throw new Error('BILLING_TOKEN_URL, BILLING_CLIENT_ID and BILLING_CLIENT_SECRET are required for the gateway.');
  if (!/^[0-9]{1,8}$/.test(String(municipalityId ?? '')))
    throw new Error('BILLING_MUNICIPALITY_ID is required: the municipality id the installation serves.');
  if (!CATEGORY_PATTERN.test(category)) throw new Error('BILLING_CATEGORY is not a billing category.');
  const base = new URL(url);
  const tokenAt = new URL(tokenUrl);
  for (const [name, at] of [
    ['BILLING_URL', base],
    ['BILLING_TOKEN_URL', tokenAt],
  ])
    if (at.protocol !== 'https:' && !local(at)) throw new Error(`${name} must be https outside local development.`);
  const root = base.toString().replace(/\/+$/, '') + '/' + municipalityId + '/billingrecords';

  let token;
  async function bearer() {
    if (token && now() < token.until) return token.value;
    let response;
    try {
      response = await fetchImpl(tokenAt.toString(), {
        method: 'POST',
        headers: {
          authorization: 'Basic ' + Buffer.from(clientId + ':' + clientSecret).toString('base64'),
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/json',
        },
        body: 'grant_type=client_credentials',
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new SourceUnavailable('The gateway did not answer for a token.');
    }
    if (!response.ok) throw new SourceUnavailable('The gateway refused the client credentials: ' + response.status);
    let body;
    try {
      body = await response.json();
    } catch {
      throw new SourceUnavailable('The gateway answered a token that is not JSON.');
    }
    if (typeof body?.access_token !== 'string') throw new SourceUnavailable('The gateway answered no access token.');
    const seconds = Number.isFinite(body.expires_in) ? body.expires_in : 300;
    token = { value: body.access_token, until: now() + Math.max(0, seconds - 30) * 1000 };
    return token.value;
  }

  async function call(userName, method, path, data) {
    if (!ACCOUNT_PATTERN.test(String(userName ?? '')))
      throw new SourceRefused('The account cannot be named to the gateway.');
    const headers = {
      authorization: 'Bearer ' + (await bearer()),
      accept: 'application/json',
      'x-sent-by': 'type=adAccount; ' + userName,
      ...(data ? { 'content-type': 'application/json' } : {}),
    };
    let response;
    try {
      response = await fetchImpl(root + path, {
        method,
        headers,
        body: data ? JSON.stringify(data) : undefined,
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new SourceUnavailable('BillingPreprocessor did not answer.');
    }
    // A token that ran out early is fetched again on the next call.
    if (response.status === 401) token = undefined;
    if (response.status === 404) throw new SourceNotFound('Not found.');
    if (response.status === 400 || response.status === 409 || response.status === 422)
      throw new SourceRefused(
        'BillingPreprocessor refused the change: ' + response.status + ' ' + (await refusalOf(response)),
      );
    if (!response.ok) throw new SourceUnavailable('BillingPreprocessor answered ' + response.status + '.');
    // A write may answer without a body; the connector reads the record back either way.
    if (method !== 'GET' && response.status === 204) return null;
    try {
      return await response.json();
    } catch {
      if (method !== 'GET') return null;
      throw new SourceUnavailable('BillingPreprocessor answered with something that is not JSON.');
    }
  }

  const ofCategory = record => record && typeof record === 'object' && record.category === category;
  const filter = (...parts) => '&filter=' + encodeURIComponent(parts.join(' and '));

  return {
    /** The records of the category that wait for attest (`NEW`), oldest first, at most five pages. */
    async list(userName) {
      const records = [];
      for (let page = 0; page < MAX_PAGES; page++) {
        const answer = await call(
          userName,
          'GET',
          `?page=${page}&size=${pageSize}&sort=created,asc` + filter(`category:'${category}'`, `status:'NEW'`),
        );
        const content = Array.isArray(answer?.content) ? answer.content : [];
        records.push(...content.filter(ofCategory));
        if (answer?.last !== false || content.length === 0) break;
      }
      return records;
    },
    /** One record. One of another category is answered as not found: this connector never shows or changes it. */
    async get(userName, id) {
      if (!ID_PATTERN.test(id)) throw new SourceNotFound('Not a record id.');
      const record = await call(userName, 'GET', '/' + id);
      if (!ofCategory(record)) throw new SourceNotFound('Not a record of the category.');
      return record;
    },
    /** The whole record, changed: the API's PUT replaces it, so the caller has read it right before. */
    async put(userName, record) {
      if (!ID_PATTERN.test(String(record?.id ?? ''))) throw new SourceNotFound('Not a record id.');
      if (!ofCategory(record)) throw new SourceRefused('Not a record of the category.');
      return call(userName, 'PUT', '/' + record.id, writable(record));
    },
  };
}
