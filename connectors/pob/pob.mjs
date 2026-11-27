// POB's API behind the case port: the only file that knows the address, the credential, the paths and the field names.
//
// A DRAFT. It has not met a POB. It is written from an endpoint catalogue that names no field, and from public code
// that calls one installation's POB (README.md, "The API adapter's assumptions"). Each assumption is marked ASSUMED.
// It is built so that a wrong one fails as "the system does not answer" and never as someone else's errand or as a
// list that looks whole:
//   - one condition per question to POB, the most selective one; everything else is decided by the connector's own
//     check of each errand, which runs whatever POB answers;
//   - a record that came back for an account is compared with the account again here, so a filter POB ignored or
//     matched loosely cannot make one person another;
//   - an answer this file cannot read (not a list, an errand without an id, a status or a time) is an outage.
// It only ever sends GET.
import { COST_CODE, SourceUnavailable } from './cases.mjs';

/**
 * What the connector needs from POB, and what each is called there. The defaults are what the public code uses, where
 * it uses one; an installation whose POB names a field otherwise sets it in `POB_FIELDS`. A table of names, nothing
 * more: no expressions. `closed`, `userGroups` and `created` may be empty: then an errand is closed by its status alone,
 * a handler has no group queue, and a request says when it last changed, not when it was reported.
 */
export const DEFAULT_FIELDS = {
  id: 'Id',
  // ASSUMED: the errand's number is its id. No field for a separate number has been seen.
  number: 'Id',
  title: 'Description',
  status: 'CaseStatus',
  caseType: 'CaseType',
  category: 'CaseCategory',
  handler: 'Responsible',
  group: 'ResponsibleGroup',
  customer: 'Contact.Customer',
  // ASSUMED, with no evidence at all: the field for when the errand last changed.
  changed: 'Modified',
  // ASSUMED, with no evidence at all: the field for when the errand was reported. Empty: a request is listed with when
  // it last changed instead.
  created: 'Created',
  closed: '',
  // ASSUMED, with no evidence at all: the field of a user that lists their groups.
  userGroups: '',
};
const OPTIONAL_FIELDS = ['closed', 'userGroups', 'created'];
/**
 * What the cost read (D148) needs of a service agreement, and what each is called in POB. ASSUMED throughout, from one
 * installation's own reading of its POB and from no documentation: an agreement has an id, and the account its cost
 * is booked on is a whole accounting string that begins with the unit's code. No field for an amount has been seen, so
 * `amount` is empty until an installation names it; then the read answers a sum, and until then a count.
 */
export const DEFAULT_AGREEMENT_FIELDS = { id: 'Id', account: 'Account.Id', amount: '' };
/** ASSUMED, on the same grounds: where POB lists its service agreements. */
export const DEFAULT_AGREEMENT_PATH = '/sla';
const AGREEMENT_PATH = /^\/[A-Za-z0-9_/-]{1,80}$/;
const FIELD_NAME = /^[A-Za-z0-9_.]{1,80}$/;
/** A value that may stand in a filter sent to POB: an account or an id. Anything else is never sent. */
const FILTER_VALUE = /^[A-Za-z0-9._@:-]{1,128}$/;

const text = value => (typeof value === 'string' && value.trim() ? value.trim() : undefined);
const scalar = value => (typeof value === 'number' && Number.isFinite(value) ? String(value) : text(value));
// ASSUMED: a reference is `{ Type, Data: { Id, … } }` when read, as the public code's JSON paths say; a bare value is taken too.
const refId = value => (value && typeof value === 'object' ? scalar(value.Data?.Id ?? value.Id) : scalar(value));
// ASSUMED: a referenced record carries its display name as `Description` or `Name`.
const refLabel = value =>
  value && typeof value === 'object' ? text(value.Data?.Description ?? value.Data?.Name) : undefined;

// ASSUMED: a field named with a dot is either a key written so, as the public code's JSON paths have it, or a field
// of a referenced record; both are read.
const pick = (data, name) => {
  if (Object.hasOwn(data, name)) return data[name];
  let at = data;
  for (const part of name.split('.')) {
    at = at && typeof at === 'object' ? (at.Data && !Object.hasOwn(at, part) ? at.Data[part] : at[part]) : undefined;
    if (at === undefined || at === null) return undefined;
  }
  return at;
};
// An amount as a number: a JSON number, or digits with a decimal point or comma. Anything else is no amount, which the
// connector says of the agreement; it is never read as zero.
const amountOf = value => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string' || !/^-?\d{1,15}([.,]\d{1,6})?$/.test(value.trim())) return undefined;
  return Number(value.trim().replace(',', '.'));
};

/** The fields as configured: the defaults with an installation's own names over them. Throws on a name that is none. */
export function fieldMap(overrides = {}) {
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides))
    throw new Error('POB_FIELDS must be a JSON object.');
  const fields = { ...DEFAULT_FIELDS };
  for (const [concept, name] of Object.entries(overrides)) {
    if (!Object.hasOwn(DEFAULT_FIELDS, concept))
      throw new Error(`POB_FIELDS: "${concept}" is not one of ${Object.keys(DEFAULT_FIELDS).join(', ')}.`);
    if (name === '' && OPTIONAL_FIELDS.includes(concept)) fields[concept] = '';
    else if (typeof name !== 'string' || !FIELD_NAME.test(name))
      throw new Error(`POB_FIELDS: "${concept}" must be a field name.`);
    else fields[concept] = name;
  }
  return fields;
}

/** The agreement fields as configured, over the defaults. Throws on a concept or a name that is none. */
export function agreementFieldMap(overrides = {}) {
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides))
    throw new Error('POB_AGREEMENT_FIELDS must be a JSON object.');
  const fields = { ...DEFAULT_AGREEMENT_FIELDS };
  for (const [concept, name] of Object.entries(overrides)) {
    if (!Object.hasOwn(DEFAULT_AGREEMENT_FIELDS, concept))
      throw new Error(
        `POB_AGREEMENT_FIELDS: "${concept}" is not one of ${Object.keys(DEFAULT_AGREEMENT_FIELDS).join(', ')}.`,
      );
    if (name === '' && concept === 'amount') fields.amount = '';
    else if (typeof name !== 'string' || !FIELD_NAME.test(name))
      throw new Error(`POB_AGREEMENT_FIELDS: "${concept}" must be a field name.`);
    else fields[concept] = name;
  }
  return fields;
}

/**
 * An instant from what POB wrote. A time with a zone is read as it stands; one without is read in `timeZone`, the zone
 * the installation says its POB writes in. Undefined for anything that is not a time.
 */
export function instantIn(value, timeZone) {
  if (typeof value !== 'string') return undefined;
  if (/([zZ]|[+-]\d{2}:?\d{2})$/.test(value))
    return Number.isFinite(Date.parse(value)) ? new Date(Date.parse(value)).toISOString() : undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(value);
  if (!m) return undefined;
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0));
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(wall));
  const part = type => +parts.find(p => p.type === type).value;
  const shown = Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second'));
  return new Date(wall - (shown - wall)).toISOString();
}

/**
 * url: POB's API base, with this installation's path prefix. authorization: the whole value of the Authorization
 * header. fields: see `fieldMap`. userMatch, customerMatch: the field of a POB user and of a POB customer that holds
 * the directory account; there is no safe default for either. statusLabels: what a person reads for a status value.
 * listLimit: the most errands one question may answer with; more than that is an answer that was cut.
 */
export function createPobCases({
  url,
  authorization,
  fields = DEFAULT_FIELDS,
  userMatch,
  customerMatch,
  statusLabels = {},
  timeZone = 'Europe/Stockholm',
  agreementFields = DEFAULT_AGREEMENT_FIELDS,
  agreementPath = DEFAULT_AGREEMENT_PATH,
  listLimit = 500,
  timeoutMs = 3000,
  inFlight = 4,
  insecureHosts = ['localhost', '127.0.0.1'],
  fetch: fetchImpl = globalThis.fetch,
  now = () => Date.now(),
} = {}) {
  if (!url) throw new Error('POB_URL is required.');
  const base = new URL(url);
  if (base.protocol !== 'https:' && !(base.protocol === 'http:' && insecureHosts.includes(base.hostname)))
    throw new Error('POB_URL must be https.');
  if (!authorization)
    throw new Error('A credential for POB is required: POB_AUTHORIZATION, or POB_USER and POB_PASSWORD.');
  for (const [name, value] of [
    ['POB_USER_MATCH', userMatch],
    ['POB_CUSTOMER_MATCH', customerMatch],
  ])
    if (typeof value !== 'string' || !FIELD_NAME.test(value)) throw new Error(`${name} must be a field name.`);
  if (typeof agreementPath !== 'string' || !AGREEMENT_PATH.test(agreementPath))
    throw new Error('POB_AGREEMENT_PATH must be a path that begins with a slash.');
  const root = base.toString().replace(/\/+$/, '');

  // A credential POB refuses is not tried again at once: a wrong password must not become a locked account.
  let refusals = 0,
    blockedUntil = 0;
  // A few calls at a time, so that one page of Clew does not become a burst against POB.
  let running = 0;
  const waiting = [];
  const slot = async () => {
    if (running >= inFlight) await new Promise(resolve => waiting.push(resolve));
    running++;
  };
  const release = () => {
    running--;
    waiting.shift()?.();
  };

  /** One GET. The parsed answer, or null for a 404. Anything else is an outage; POB's own error text stays here. */
  async function get(path, params = {}) {
    if (now() < blockedUntil) throw new SourceUnavailable('POB refused the credential; waiting before the next try.');
    const address = new URL(root + path);
    for (const [key, value] of Object.entries(params)) address.searchParams.set(key, value);
    await slot();
    try {
      let response;
      try {
        response = await fetchImpl(address.toString(), {
          method: 'GET',
          headers: { Authorization: authorization, Accept: 'application/json' },
          signal: AbortSignal.timeout(timeoutMs),
          redirect: 'error',
        });
      } catch {
        throw new SourceUnavailable('POB did not answer.');
      }
      if (response.status === 401 || response.status === 403) {
        refusals++;
        blockedUntil = now() + Math.min(30_000 * 2 ** (refusals - 1), 600_000);
        throw new SourceUnavailable('POB refused the credential.');
      }
      refusals = 0;
      if (response.status === 404) return null;
      if (!response.ok) throw new SourceUnavailable(`POB answered ${response.status}.`);
      try {
        return await response.json();
      } catch {
        throw new SourceUnavailable('POB answered something that is not JSON.');
      }
    } finally {
      release();
    }
  }

  // ASSUMED: a list endpoint answers a JSON array of records; a filter is `Filter=<field>=<value>`; `limit` caps the rows.
  async function rows(path, field, value, limit) {
    if (!FILTER_VALUE.test(value)) throw new SourceUnavailable('A value that cannot stand in a filter.');
    const answer = await get(path, { Filter: `${field}=${value}`, limit: String(limit) });
    if (!Array.isArray(answer)) throw new SourceUnavailable('POB answered something that is not a list.');
    return answer;
  }

  /** An errand in the shape cases.mjs works with, or an outage: an errand this file cannot read is not skipped. */
  function errand(payload) {
    const data = payload?.Data;
    const id = data && scalar(data[fields.id]);
    const status = data && refId(data[fields.status]);
    const since = data && instantIn(data[fields.changed], timeZone);
    const caseType = data && refId(data[fields.caseType]);
    const created = data && fields.created ? instantIn(data[fields.created], timeZone) : undefined;
    if (!id || !status || !since || !caseType || (fields.created && !created))
      throw new SourceUnavailable('An errand that could not be read.');
    return {
      id,
      number: scalar(data[fields.number]) ?? id,
      caseType,
      type: refLabel(data[fields.caseType]) ?? caseType,
      category: refLabel(data[fields.category]) ?? refId(data[fields.category]),
      status,
      statusLabel: text(statusLabels[status]) ?? refLabel(data[fields.status]) ?? status,
      closed: fields.closed ? !!data[fields.closed] : false,
      handlerId: refId(data[fields.handler]),
      groupId: refId(data[fields.group]),
      group: refLabel(data[fields.group]) ?? refId(data[fields.group]),
      customerId: refId(data[fields.customer]),
      title: text(data[fields.title]),
      since,
      ...(created ? { created } : {}),
    };
  }

  /** The records of one kind whose account field is this account, compared here again whatever POB filtered on. */
  async function matching(path, field, account) {
    const found = (await rows(path, field, account, 5)).filter(record => {
      const value = record?.Data?.[field];
      // A record without the field cannot be compared, and is not guessed at.
      if (value === undefined) throw new SourceUnavailable('A record without the field it was asked for by.');
      return String(value).toLowerCase() === account.toLowerCase();
    });
    if (found.length === 0) return { status: 'none' };
    if (found.length > 1) return { status: 'ambiguous' };
    const id = scalar(found[0].Data.Id);
    if (!id) throw new SourceUnavailable('A record without an id.');
    return { status: 'one', id, record: found[0] };
  }

  return {
    async person(account) {
      const [user, customer] = await Promise.all([
        matching('/user', userMatch, account),
        matching('/customer', customerMatch, account),
      ]);
      const handler = { status: user.status };
      if (user.status === 'one') {
        handler.id = user.id;
        const groups = fields.userGroups ? user.record.Data[fields.userGroups] : undefined;
        handler.groups = Array.isArray(groups) ? groups.map(refId).filter(Boolean) : [];
      }
      return { handler, customer: customer.status === 'one' ? { status: 'one', id: customer.id } : customer };
    },

    // `caseTypes` is not sent to POB: one condition per question. The connector's own check drops any other type.
    async list(person, relation) {
      const asked =
        relation === 'assigned' && person.handler
          ? [[fields.handler, person.handler.id]]
          : relation === 'reported' && person.customer
            ? [[fields.customer, person.customer.id]]
            : relation === 'group' && person.handler
              ? person.handler.groups.map(group => [fields.group, group])
              : [];
      const answers = await Promise.all(asked.map(([field, value]) => rows('/case', field, value, listLimit + 1)));
      return {
        cases: answers.flat().map(errand),
        // One row more than the limit was asked for, so a full answer says that there is more.
        complete: answers.every(answer => answer.length <= listLimit),
      };
    },

    async one(id) {
      const payload = await get('/case/' + encodeURIComponent(id));
      return payload ? errand(payload) : null;
    },

    // ASSUMED: agreements are listed like errands (a JSON array of `{ Data }`), and a filter value that ends in `%`
    // matches the accounts that begin with what stands before it. A POB that ignores the filter answers every
    // agreement: each is compared with the code again here and in the connector, and more rows than the limit is an
    // answer that was cut.
    async agreements(code) {
      // The port's own bound, whatever pattern the installation configured: a shorter code would stand as a prefix of
      // other units' accounts in the filter, and the comparison below would let every one of them through.
      if (typeof code !== 'string' || !COST_CODE.test(code))
        throw new SourceUnavailable('A value that cannot stand in a filter.');
      const answer = await get(agreementPath, {
        Filter: `${agreementFields.account}=${code}%`,
        limit: String(listLimit + 1),
      });
      if (!Array.isArray(answer)) throw new SourceUnavailable('POB answered something that is not a list.');
      const agreements = [];
      for (const payload of answer) {
        const data = payload?.Data;
        const id = data && scalar(data[agreementFields.id]);
        const account =
          data && (scalar(pick(data, agreementFields.account)) ?? refId(pick(data, agreementFields.account)));
        // An agreement without an id or an account cannot be compared with the code, and is not guessed at.
        if (!id || !account) throw new SourceUnavailable('An agreement that could not be read.');
        if (!account.startsWith(code)) continue;
        const amount = agreementFields.amount ? amountOf(pick(data, agreementFields.amount)) : undefined;
        agreements.push({ id, account, ...(amount !== undefined ? { amount } : {}) });
      }
      return { agreements, complete: answer.length <= listLimit };
    },

    // ASSUMED: `GET /case/{id}/memo?type=<type>&scope=all` answers `{ Memo: { <type>: { Memo, Extension } } }`.
    async memo(id, type) {
      const payload = await get('/case/' + encodeURIComponent(id) + '/memo', { type, scope: 'all' });
      const memo = payload?.Memo?.[type];
      return memo && typeof memo.Memo === 'string' ? { text: memo.Memo, extension: text(memo.Extension) } : null;
    },

    /**
     * Whether this POB has the fields the configuration names, asked of POB itself (`GET /entity/case`). ASSUMED: the
     * answer names every field of an errand somewhere in it, as a key or as a value; its shape is not known, so every
     * key and string in it is looked at. Answers the configured names that were not found.
     */
    async check() {
      const metadata = await get('/entity/case');
      if (metadata === null) return { described: false, missing: [] };
      const names = new Set();
      const walk = value => {
        if (typeof value === 'string') names.add(value);
        else if (Array.isArray(value)) value.forEach(walk);
        else if (value && typeof value === 'object')
          for (const [key, inner] of Object.entries(value)) {
            names.add(key);
            walk(inner);
          }
      };
      walk(metadata);
      const wanted = [
        'id',
        'number',
        'title',
        'status',
        'caseType',
        'category',
        'handler',
        'group',
        'customer',
        'changed',
        'created',
        'closed',
      ];
      const missing = wanted.filter(concept => fields[concept] && !names.has(fields[concept]));
      return { described: true, missing: missing.map(concept => `${concept} (${fields[concept]})`) };
    },
  };
}
