// The case port, the rule for which errands are a person's, and a made-up POB for development.
//
// POB is asked with one service account that can read every errand, so the rule here is what stands between a person
// and someone else's errand. It is deliberately smaller than POB's own permissions: an errand is a person's when they
// are its handler, when it waits unassigned in a group they belong to, or when they reported it. Nothing wider.
//
// The port, which the fixture below answers and POB's API adapter will answer (README.md, "Unverified"):
//   person(account)                 -> { handler: Match, customer: Match }, the person's records in POB
//   list(person, relation, types)   -> { cases: SourceCase[], complete: boolean }, open and closed alike: the
//                                      connector decides what of it is listed
//   one(id)                         -> SourceCase | null, whoever it belongs to: the connector decides
//   memo(id, type)                  -> { text, extension } | null, one memo type of one errand
//   create(fault, operationId)      -> SourceCase, the errand POB made. Only with writes switched on. `fault` is
//                                      { customerId, title, description, caseType, category, groupId }
//   agreements(code)                -> { agreements: SourceAgreement[], complete: boolean }, the service agreements
//                                      booked on an account that begins with this code, whoever asks: the connector
//                                      decides who may. Only with the cost read switched on (D148).
// A Match is { status: 'none' }, { status: 'one', id, groups? } or { status: 'ambiguous' }.
// A SourceAgreement is { id, account, amount? }: the account its cost is booked on, and what it costs where POB says.

export class SourceUnavailable extends Error {}

export const RELATIONS = ['assigned', 'group', 'reported'];

const idPattern = /^[A-Za-z0-9-]{1,80}$/;
const text = value => (typeof value === 'string' && value.trim() ? value.trim() : undefined);
// An instant leaves here as UTC with a zone, whatever the source wrote: the errand row's `since` is checked as one.
const instant = value =>
  typeof value === 'string' && Number.isFinite(Date.parse(value))
    ? new Date(Date.parse(value)).toISOString()
    : undefined;

/**
 * One POB errand as the connector works with it. Anything without an id, a number, a case type, a status or a time is
 * dropped rather than guessed at. `closed` is the source's own word for finished, where it has one. `since` is when the
 * errand last changed; `created`, where the source says it, is when it was reported.
 */
export function toSourceCase(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = text(raw.id);
  const number = text(raw.number);
  const caseType = text(raw.caseType);
  const status = text(raw.status);
  const since = instant(raw.since);
  if (!id || !idPattern.test(id) || !number || !caseType || !status || !since) return null;
  const shown = {
    id,
    number,
    caseType,
    type: text(raw.type) ?? caseType,
    status,
    statusLabel: text(raw.statusLabel) ?? status,
    closed: raw.closed === true,
    since,
  };
  for (const key of ['category', 'handlerId', 'groupId', 'group', 'customerId', 'title']) {
    const value = text(raw[key]);
    if (value) shown[key] = value;
  }
  for (const key of ['suspendedTo', 'created']) {
    const at = instant(raw[key]);
    if (at) shown[key] = at;
  }
  return shown;
}

/**
 * The person as the rule reads them: only a record that matched exactly once counts. Two records for one account are
 * treated as none, so a field that is not unique in POB can never hand one person another's errands.
 */
/**
 * One service agreement as the connector counts it: an id and the account its cost is booked on, and its amount where
 * the source gave a number. Anything without an id or an account is dropped rather than guessed at. Nothing of what
 * the agreement is for is kept: the connector answers a count and a sum.
 */
export function toSourceAgreement(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = text(raw.id);
  const account = text(raw.account);
  if (!id || !idPattern.test(id) || !account) return null;
  return {
    id,
    account,
    ...(typeof raw.amount === 'number' && Number.isFinite(raw.amount) ? { amount: raw.amount } : {}),
  };
}

export function resolved(found) {
  const person = {};
  if (found?.handler?.status === 'one' && text(found.handler.id))
    person.handler = {
      id: found.handler.id,
      groups: Array.isArray(found.handler.groups) ? found.handler.groups.filter(g => typeof g === 'string') : [],
    };
  if (found?.customer?.status === 'one' && text(found.customer.id)) person.customer = { id: found.customer.id };
  return person;
}

/** Whether an errand is the person's in this relation. The whole access rule. */
export function holds(errand, person, relation) {
  if (relation === 'assigned') return !!person.handler && errand.handlerId === person.handler.id;
  if (relation === 'group')
    return !!person.handler && !errand.handlerId && !!errand.groupId && person.handler.groups.includes(errand.groupId);
  if (relation === 'reported') return !!person.customer && errand.customerId === person.customer.id;
  return false;
}

/** The person's relation to an errand, or undefined when they have none. Their own before their group's. */
export function relationOf(errand, person) {
  return ['assigned', 'reported', 'group'].find(relation => holds(errand, person, relation));
}

const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** A memo as plain text. POB stores text as `.txt` or `.html`; markup is taken out here and never drawn. */
export function plainText(memo) {
  const raw = text(memo?.text);
  if (!raw) return undefined;
  if (memo.extension !== '.html') return raw;
  const stripped = raw
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&([a-z]+);/gi, (whole, name) => entities[name.toLowerCase()] ?? whole)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n');
  return text(stripped);
}

// ---- The fixture: a made-up POB. Synthetic people and errands; nothing here is from a real installation. ----

/** What the fixture's statuses mean (`POB_STATUS_KINDS` for a real POB, where every status must be given a meaning). */
export const fixtureStatusKinds = {
  Registered: 'new',
  InProgress: 'open',
  WaitingCustomer: 'waiting-reporter',
  WaitingSupplier: 'waiting-other',
  Solved: 'closed',
};
/** The case types the fixture's installation lets Clew read. Its HR errands are in the same POB and stay out. */
export const fixtureCaseTypes = ['Incident', 'ServiceRequest'];
export const FIXTURE_PROBLEM_MEMO = 'Problem';
/** What a fault report becomes in the fixture's installation (`POB_CREATE` for a real POB). */
export const fixtureCreate = { caseType: 'Incident', category: 'Dator', groupId: 'g-servicedesk' };

const statusLabels = {
  Registered: 'Registrerat',
  InProgress: 'Pågår',
  WaitingCustomer: 'Väntar på användaren',
  WaitingSupplier: 'Väntar på leverantör',
  Solved: 'Löst',
};
const typeLabels = { Incident: 'Incident', ServiceRequest: 'Beställning', HRCase: 'HR-ärende' };
const groupLabels = { 'g-servicedesk': 'Servicedesk', 'g-natverk': 'Nätverk', 'g-hr': 'HR-support' };

/** Handlers and the people who report, each with the directory account POB knows them by. `karin` has two customer records. */
export const fixturePeople = {
  users: [
    { id: 'u-mikael', account: 'mikael', groups: ['g-servicedesk'] },
    { id: 'u-lena', account: 'lena', groups: ['g-servicedesk', 'g-natverk'] },
    { id: 'u-eva', account: 'eva', groups: ['g-hr'] },
  ],
  customers: [
    { id: 'c-hillevi', account: 'hillevi' },
    { id: 'c-hassan', account: 'hassan' },
    { id: 'c-mikael', account: 'mikael' },
    { id: 'c-karin-1', account: 'karin' },
    { id: 'c-karin-2', account: 'Karin' },
  ],
};

const day = 86_400_000;

function fixtureCases(now) {
  const ago = days => new Date(now - days * day).toISOString();
  const ahead = days => new Date(now + days * day).toISOString();
  return [
    {
      id: '48211',
      number: 'IT-48211',
      caseType: 'Incident',
      category: 'Dator',
      status: 'InProgress',
      customerId: 'c-hillevi',
      handlerId: 'u-mikael',
      groupId: 'g-servicedesk',
      title: 'Datorn startar inte efter uppdateringen',
      since: ago(1),
      created: ago(4),
      memos: {
        Problem: {
          extension: '.html',
          text: '<p>Skärmen är svart sedan gårdagens uppdatering.</p><p>Laddaren lyser &amp; fläkten går.</p>',
        },
        CaseInternalNotesCustom: { extension: '.txt', text: 'Trolig diskkrasch. Användaren har ringt tre gånger.' },
      },
    },
    {
      id: '48190',
      number: 'IT-48190',
      caseType: 'ServiceRequest',
      category: 'Behörighet',
      status: 'WaitingCustomer',
      customerId: 'c-hillevi',
      handlerId: 'u-lena',
      groupId: 'g-servicedesk',
      title: 'Behörighet till ekonomisystemet för en ny kollega',
      since: ago(2),
      created: ago(6),
      memos: {
        Problem: { extension: '.txt', text: 'Vikarien börjar på måndag och behöver läsbehörighet.' },
        CaseInternalNotesCustom: { extension: '.txt', text: 'Saknar attest från ekonomichefen.' },
      },
    },
    {
      id: '48230',
      number: 'IT-48230',
      caseType: 'Incident',
      category: 'Skrivare',
      status: 'Registered',
      customerId: 'c-hassan',
      groupId: 'g-servicedesk',
      title: 'Skrivaren på plan 2 drar in flera papper',
      since: ago(0.2),
      created: ago(0.2),
      memos: { Problem: { extension: '.txt', text: 'Gäller alla utskrifter sedan i morse.' } },
    },
    {
      id: '48102',
      number: 'IT-48102',
      caseType: 'ServiceRequest',
      category: 'Mobiltelefon',
      status: 'WaitingSupplier',
      customerId: 'c-hassan',
      handlerId: 'u-mikael',
      groupId: 'g-servicedesk',
      title: 'Ny tjänstetelefon',
      since: ago(5),
      created: ago(9),
      suspendedTo: ahead(3),
      memos: { Problem: { extension: '.txt', text: 'Den gamla telefonen laddar inte längre.' } },
    },
    {
      id: '48007',
      number: 'IT-48007',
      caseType: 'Incident',
      category: 'Nätverk',
      status: 'Solved',
      closed: true,
      customerId: 'c-hillevi',
      handlerId: 'u-lena',
      groupId: 'g-natverk',
      title: 'Trådlöst nät saknas i sal 12',
      since: ago(12),
      created: ago(20),
      memos: { Problem: { extension: '.txt', text: 'Ingen täckning i den bortre delen av salen.' } },
    },
    {
      id: '00317',
      number: 'HR-00317',
      caseType: 'HRCase',
      category: 'Rehabilitering',
      status: 'InProgress',
      customerId: 'c-hillevi',
      handlerId: 'u-eva',
      groupId: 'g-hr',
      title: 'Rehabiliteringsärende',
      since: ago(3),
      created: ago(15),
      memos: { Problem: { extension: '.txt', text: 'Ärendet rör en medarbetares rehabilitering.' } },
    },
    {
      id: '48244',
      number: 'IT-48244',
      caseType: 'Incident',
      category: 'Programvara',
      status: 'InProgress',
      customerId: 'c-mikael',
      handlerId: 'u-lena',
      groupId: 'g-servicedesk',
      title: 'Fjärrhjälpen kraschar vid start',
      since: ago(1.5),
      created: ago(2),
      memos: { Problem: { extension: '.txt', text: 'Felkod 0x12 varje gång.' } },
    },
    {
      id: '48251',
      number: 'IT-48251',
      caseType: 'Incident',
      category: 'Nätverk',
      status: 'Registered',
      customerId: 'c-karin-1',
      groupId: 'g-natverk',
      title: 'Uttaget i rum 4 är dött',
      since: ago(0.5),
      created: ago(0.5),
      memos: { Problem: { extension: '.txt', text: 'Varken dator eller telefon får kontakt.' } },
    },
  ];
}

/**
 * The made-up POB. It answers the port as the API adapter will: it matches an account without regard to case, reports
 * two records as ambiguous, narrows a list by the relation and the case types asked for, closed errands included, and
 * returns any errand by its id, since POB's service account can read them all. Who may see what, and whether a closed
 * errand is listed, is the connector's to decide.
 */
/**
 * The made-up POB's service agreements. An account is a whole accounting string whose first group is the code of the
 * unit the cost is booked on: the first three are a school's, the fourth another unit's, the fifth has no amount, and
 * the last is booked on an account that is no unit's.
 */
export const fixtureAgreements = [
  { id: 'sla-1001', account: '11000000.5750.100', amount: 14400 },
  { id: 'sla-1002', account: '11000000.5750.200', amount: 3250.5 },
  { id: 'sla-1003', account: '11000000.6211.100', amount: 890 },
  { id: 'sla-2001', account: '11000100.5750.100', amount: 7200 },
  { id: 'sla-2002', account: '11000100.6211.100' },
  { id: 'sla-9001', account: '99999999.5750.100', amount: 120 },
];

export function createFixtureCases({
  people = fixturePeople,
  agreements = fixtureAgreements,
  now = () => Date.now(),
} = {}) {
  const match = (records, account) => {
    const found = records.filter(r => r.account.toLowerCase() === String(account).toLowerCase());
    if (found.length === 0) return { status: 'none' };
    if (found.length > 1) return { status: 'ambiguous' };
    return { status: 'one', id: found[0].id, ...(found[0].groups ? { groups: [...found[0].groups] } : {}) };
  };
  const present = raw =>
    toSourceCase({
      ...raw,
      type: typeLabels[raw.caseType],
      statusLabel: statusLabels[raw.status],
      group: groupLabels[raw.groupId],
    });
  // What has been created through this connector since it started: the made-up POB keeps it in memory, with the
  // operation each came from, so the same operation sent twice is one errand.
  const created = [];
  const byOperation = new Map();
  const all = () => [...fixtureCases(now()), ...created];

  return {
    async person(account) {
      return { handler: match(people.users, account), customer: match(people.customers, account) };
    },
    async list(person, relation, caseTypes) {
      const cases = all()
        .map(present)
        .filter(c => c && caseTypes.includes(c.caseType) && holds(c, person, relation));
      return { cases, complete: true };
    },
    async one(id) {
      const raw = all().find(c => c.id === id);
      return raw ? present(raw) : null;
    },
    async memo(id, type) {
      const memo = all().find(c => c.id === id)?.memos?.[type];
      return memo ? { ...memo } : null;
    },
    async create(fault, operationId) {
      const before = operationId ? byOperation.get(operationId) : undefined;
      if (before) return present(before);
      const id = String(48300 + created.length);
      const raw = {
        id,
        number: 'IT-' + id,
        caseType: fault.caseType,
        category: fault.category,
        status: 'Registered',
        customerId: fault.customerId,
        groupId: fault.groupId,
        title: fault.title,
        since: new Date(now()).toISOString(),
        created: new Date(now()).toISOString(),
        memos: { Problem: { extension: '.txt', text: fault.description } },
      };
      created.push(raw);
      if (operationId) byOperation.set(operationId, raw);
      return present(raw);
    },
    async agreements(code) {
      return {
        agreements: agreements.filter(a => a.account.startsWith(code)).map(a => ({ ...a })),
        complete: true,
      };
    },
  };
}
