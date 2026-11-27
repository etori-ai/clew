// Reads and checks the connector's configuration. Every error names its variable, so a wrong setting is found when the
// connector starts and not when a person opens their errands. README.md has the full table.
import { STATUS_KINDS } from './connector.mjs';
import { COST_CODE, FIXTURE_PROBLEM_MEMO, fixtureCaseTypes, fixtureCreate, fixtureStatusKinds } from './cases.mjs';
import { DEFAULT_AUDIENCE } from './manifest.mjs';
import { DEFAULT_AGREEMENT_PATH, agreementFieldMap, fieldMap } from './pob.mjs';
import { readFileSync } from 'node:fs';

function json(env, name) {
  const text = env[name];
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${name} must be valid JSON.`);
  }
}
function address(env, name) {
  const text = env[name];
  if (!text) throw new Error(`${name} is required.`);
  try {
    return new URL(text).toString();
  } catch {
    throw new Error(`${name} must be an address.`);
  }
}
/**
 * Whether a pattern for a unit's code takes one shorter than the port's bound lets through (`COST_CODE`: four letters
 * or digits at least). Tried against every code of one, two and three letters or digits, which is all there are, so
 * the answer is exact for whatever form the pattern has.
 */
const CODE_CHARACTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
function takesShortCode(pattern) {
  for (const a of CODE_CHARACTERS) {
    if (pattern.test(a)) return true;
    for (const b of CODE_CHARACTERS) {
      if (pattern.test(a + b)) return true;
      for (const c of CODE_CHARACTERS) if (pattern.test(a + b + c)) return true;
    }
  }
  return false;
}

export function readConfig(env = process.env) {
  // The adapter is always said. The made-up POB answers with invented errands under POB's name, so a deployment that
  // names none does not start, and neither does one that names it beside a POB address or credential.
  const adapter = (env.POB_ADAPTER || '').trim();
  if (!adapter)
    throw new Error(
      'POB_ADAPTER is not set. Set it to "api" to read POB (with POB_URL and a credential), or to "fixture" for the ' +
        'made-up errands in cases.mjs: development and tests only.',
    );
  if (adapter !== 'fixture' && adapter !== 'api')
    throw new Error(`Unknown POB_ADAPTER "${adapter}". Known: api, fixture.`);
  const api = adapter === 'api';
  const real = ['POB_URL', 'POB_AUTHORIZATION', 'POB_USER', 'POB_PASSWORD', 'POB_PASSWORD_FILE'].filter(name =>
    (env[name] || '').trim(),
  );
  if (!api && real.length)
    throw new Error(
      `POB_ADAPTER is "fixture" but ${real.join(' and ')} ${real.length > 1 ? 'are' : 'is'} set. The stand-in reads ` +
        `no POB and answers with made-up errands: set POB_ADAPTER=api to read it, or remove ${real.join(' and ')} to ` +
        'run the stand-in.',
    );

  // What the installation switches on beyond reading. `create` is the fault report; replying in an errand is not built.
  const writes = (env.POB_WRITES || '')
    .split(',')
    .map(write => write.trim())
    .filter(Boolean);
  for (const write of writes)
    if (write !== 'create') throw new Error(`POB_WRITES: "${write}" is not known. Known: create.`);
  // The draft adapter for POB's own API only reads: how POB creates an errand has not been seen.
  if (writes.length && api) throw new Error('POB_WRITES must be empty with the api adapter: it only reads.');

  const create = json(env, 'POB_CREATE') ?? fixtureCreate;
  if (
    !create ||
    typeof create !== 'object' ||
    Array.isArray(create) ||
    !['caseType', 'category', 'groupId'].every(key => typeof create[key] === 'string' && create[key])
  )
    throw new Error('POB_CREATE must be a JSON object with caseType, category and groupId.');

  const audience = env.POB_AUDIENCE || DEFAULT_AUDIENCE;
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(audience)) throw new Error('POB_AUDIENCE is not a valid audience.');

  // The person's token is checked against the identity provider with every adapter, the fixture included.
  if (!env.POB_IDP_ISSUER) throw new Error('POB_IDP_ISSUER is required.');
  const jwksUrl = address(env, 'POB_IDP_JWKS_URL');
  const insecureHosts = (env.POB_INSECURE_HTTP_HOSTS || 'localhost,127.0.0.1')
    .split(',')
    .map(host => host.trim())
    .filter(Boolean);
  const jwksAt = new URL(jwksUrl);
  if (jwksAt.protocol !== 'https:' && !(jwksAt.protocol === 'http:' && insecureHosts.includes(jwksAt.hostname)))
    throw new Error('POB_IDP_JWKS_URL must be https, or its host listed in POB_INSECURE_HTTP_HOSTS for development.');

  const accountClaim = env.POB_ACCOUNT_CLAIM || 'preferred_username';
  if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(accountClaim)) throw new Error('POB_ACCOUNT_CLAIM is not a claim name.');

  // A real POB's statuses and case types are its own: there is nothing to default to.
  if (api && !env.POB_STATUS_KINDS) throw new Error('POB_STATUS_KINDS is required with the api adapter.');
  if (api && !env.POB_CASE_TYPES) throw new Error('POB_CASE_TYPES is required with the api adapter.');
  const statusKinds = json(env, 'POB_STATUS_KINDS') ?? fixtureStatusKinds;
  if (!statusKinds || typeof statusKinds !== 'object' || Array.isArray(statusKinds))
    throw new Error('POB_STATUS_KINDS must be a JSON object.');
  for (const [status, kind] of Object.entries(statusKinds))
    if (!STATUS_KINDS.includes(kind))
      throw new Error(
        `POB_STATUS_KINDS: "${status}" has the unknown kind "${kind}". Known: ${STATUS_KINDS.join(', ')}.`,
      );

  const caseTypes = json(env, 'POB_CASE_TYPES') ?? fixtureCaseTypes;
  if (!Array.isArray(caseTypes) || !caseTypes.length || !caseTypes.every(t => typeof t === 'string' && t))
    throw new Error('POB_CASE_TYPES must be a JSON array of case types, at least one.');

  const caseLink = env.POB_CASE_LINK || undefined;
  if (caseLink && !/\{(id|number)\}/.test(caseLink)) throw new Error('POB_CASE_LINK must have {id} or {number} in it.');

  // The cost read (D148) is on when the installation says which of the directory's unit identifiers the service desk
  // books a unit's costs on. The type is the directory's own word, so there is nothing to default to.
  // An empty value is no value: a compose file passes every variable, set or not.
  const costIdentifier = env.POB_COST_IDENTIFIER || undefined;
  if (
    costIdentifier !== undefined &&
    (costIdentifier !== costIdentifier.trim() ||
      /\p{Cc}/u.test(costIdentifier) ||
      Array.from(costIdentifier).length > 64)
  )
    throw new Error(
      'POB_COST_IDENTIFIER must be the type of unit identifier as the directory sends it: at most 64 characters, ' +
        'with no space at either end.',
    );
  for (const name of ['POB_COST_CODE_PATTERN', 'POB_COST_AMOUNT_LABEL', 'POB_AGREEMENT_FIELDS', 'POB_AGREEMENT_PATH'])
    if (env[name] && !costIdentifier) throw new Error(`${name} is set without POB_COST_IDENTIFIER.`);
  let codePattern;
  if (env.POB_COST_CODE_PATTERN) {
    codePattern = env.POB_COST_CODE_PATTERN;
    // A code stands at the start of an account in a filter sent to POB, so the pattern is held to whole codes of
    // letters and digits: anchored at both ends, and nothing in it that could let another character through.
    if (!/^\^[A-Za-z0-9[\]{},-]{1,60}\$$/.test(codePattern))
      throw new Error(
        'POB_COST_CODE_PATTERN must be a pattern for a whole code of letters and digits, such as ^[0-9]{8}$.',
      );
    let own;
    try {
      own = new RegExp(codePattern);
    } catch {
      throw new Error('POB_COST_CODE_PATTERN is not a pattern.');
    }
    // The pattern narrows what a code is and never widens it: a code is at least four letters or digits whatever it
    // says, since a shorter one is a prefix of other units' accounts. One that takes a shorter code is a mistake the
    // installation is told at start, not a read that silently answers nothing. Every code of one to three characters
    // is tried, which is all there are.
    if (takesShortCode(own))
      throw new Error(
        `POB_COST_CODE_PATTERN takes a code shorter than four characters, which would read as other units' accounts. ` +
          `A code is ${COST_CODE.source} and the pattern can only narrow that, such as ^[0-9]{8}$.`,
      );
  }
  const agreementFields =
    costIdentifier && api ? agreementFieldMap(json(env, 'POB_AGREEMENT_FIELDS') ?? {}) : undefined;
  if (env.POB_AGREEMENT_FIELDS && !api) throw new Error('POB_AGREEMENT_FIELDS is read with the api adapter only.');
  if (env.POB_AGREEMENT_PATH && !api) throw new Error('POB_AGREEMENT_PATH is read with the api adapter only.');
  if (env.POB_AGREEMENT_PATH && !/^\/[A-Za-z0-9_/-]{1,80}$/.test(env.POB_AGREEMENT_PATH))
    throw new Error('POB_AGREEMENT_PATH must be a path that begins with a slash, such as /sla.');
  // A sum is shown only where there is an amount to add up: the made-up POB has one, a real one when its field is named.
  const priced = costIdentifier && (!api || !!agreementFields.amount);
  const amountLabel = priced ? (env.POB_COST_AMOUNT_LABEL || 'Avtalskostnad').trim() : undefined;
  if (env.POB_COST_AMOUNT_LABEL && !priced)
    throw new Error('POB_COST_AMOUNT_LABEL is set, but POB_AGREEMENT_FIELDS names no amount to sum.');
  if (amountLabel !== undefined && (!amountLabel || amountLabel.length > 40))
    throw new Error('POB_COST_AMOUNT_LABEL must be a label of at most 40 characters.');

  const port = Number(env.PORT ?? 4055);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT is not a port.');

  return {
    adapter,
    ...(api
      ? {
          pob: {
            ...readPob(env, insecureHosts),
            ...(agreementFields
              ? { agreementFields, agreementPath: env.POB_AGREEMENT_PATH || DEFAULT_AGREEMENT_PATH }
              : {}),
          },
        }
      : {}),
    port,
    secret: env.CLEW_CONNECTOR_SECRET,
    audience,
    identity: { issuer: env.POB_IDP_ISSUER, jwksUrl, insecureHosts },
    accountClaim,
    sourceLabel: env.POB_SOURCE_LABEL || undefined,
    statusKinds,
    caseTypes,
    problemMemo: env.POB_PROBLEM_MEMO || FIXTURE_PROBLEM_MEMO,
    caseLink,
    writes,
    ...(costIdentifier
      ? {
          costs: {
            identifier: costIdentifier.normalize('NFC'),
            ...(amountLabel ? { amountLabel } : {}),
            ...(codePattern ? { codePattern } : {}),
          },
        }
      : {}),
    create: { caseType: create.caseType, category: create.category, groupId: create.groupId },
    urgentNote: env.POB_URGENT_NOTE || undefined,
  };
}

/** The settings of the adapter for POB's own API. The credential is read here and goes nowhere but the adapter. */
function readPob(env, insecureHosts) {
  const url = address(env, 'POB_URL');
  const at = new URL(url);
  if (at.protocol !== 'https:' && !(at.protocol === 'http:' && insecureHosts.includes(at.hostname)))
    throw new Error('POB_URL must be https, or its host listed in POB_INSECURE_HTTP_HOSTS for development.');

  // Either the whole header value, for a POB that takes a ready key, or an account's user name and password.
  let authorization = env.POB_AUTHORIZATION || undefined;
  if (!authorization) {
    let password = env.POB_PASSWORD;
    if (!password && env.POB_PASSWORD_FILE) {
      try {
        password = readFileSync(env.POB_PASSWORD_FILE, 'utf8').trim();
      } catch {
        throw new Error('POB_PASSWORD_FILE could not be read.');
      }
    }
    if (!env.POB_USER || !password)
      throw new Error(
        'A credential for POB is required: POB_AUTHORIZATION, or POB_USER with POB_PASSWORD or POB_PASSWORD_FILE.',
      );
    authorization = 'Basic ' + Buffer.from(`${env.POB_USER}:${password}`).toString('base64');
  }

  for (const name of ['POB_USER_MATCH', 'POB_CUSTOMER_MATCH'])
    if (!env[name])
      throw new Error(
        `${name} is required: the field in POB that holds a person's directory account. There is no safe default.`,
      );

  const statusLabels = json(env, 'POB_STATUS_LABELS') ?? {};
  if (
    !statusLabels ||
    typeof statusLabels !== 'object' ||
    Array.isArray(statusLabels) ||
    !Object.values(statusLabels).every(v => typeof v === 'string')
  )
    throw new Error('POB_STATUS_LABELS must be a JSON object of strings.');

  const timeZone = env.POB_TIMEZONE || 'Europe/Stockholm';
  try {
    new Intl.DateTimeFormat('en', { timeZone });
  } catch {
    throw new Error('POB_TIMEZONE is not a time zone.');
  }

  const listLimit = Number(env.POB_LIST_LIMIT ?? 500);
  if (!Number.isInteger(listLimit) || listLimit < 1 || listLimit > 5000)
    throw new Error('POB_LIST_LIMIT must be a whole number from 1 to 5000.');

  const startCheck = env.POB_START_CHECK || 'warn';
  if (!['strict', 'warn', 'off'].includes(startCheck)) throw new Error('POB_START_CHECK must be strict, warn or off.');

  return {
    url,
    authorization,
    fields: fieldMap(json(env, 'POB_FIELDS') ?? {}),
    userMatch: env.POB_USER_MATCH,
    customerMatch: env.POB_CUSTOMER_MATCH,
    statusLabels,
    timeZone,
    listLimit,
    insecureHosts,
    startCheck,
  };
}
