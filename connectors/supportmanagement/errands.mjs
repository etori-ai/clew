// The errand port, the mapping from SupportManagement's errand to what the connector works with, and a fixture that
// stands in for SupportManagement in development. The fixture decides access itself, from the token it is handed, the
// way the real system must (D89): the connector never filters on groups or namespaces.

export class SourceDenied extends Error {}
export class SourceNotFound extends Error {}
export class SourceUnavailable extends Error {}

export const RELATIONS = ['assigned', 'group', 'reported'];

const namespacePattern = /^[A-Za-z0-9_.-]{1,60}$/;
const idPattern = /^[A-Za-z0-9-]{1,80}$/;
const text = value => (typeof value === 'string' && value.trim() ? value.trim() : undefined);
// An instant leaves here as UTC with a zone, whatever the source wrote: the errand row's `since` is checked as one.
const instant = value =>
  typeof value === 'string' && Number.isFinite(Date.parse(value))
    ? new Date(Date.parse(value)).toISOString()
    : undefined;

/**
 * One SupportManagement errand as the connector works with it. `metadata` is the namespace's metadata (categories
 * with types, statuses), where the display names come from; a name without one is shown as it is. Anything without
 * an id, a number, a status or a usable namespace is dropped rather than guessed at.
 */
export function toSourceErrand(raw, { namespace, area, metadata, relation } = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const ns = text(namespace) ?? text(raw.namespace);
  const id = text(raw.id);
  const errandNumber = text(raw.errandNumber);
  const status = text(raw.status);
  const since = instant(raw.touched) ?? instant(raw.modified) ?? instant(raw.created);
  if (!ns || !namespacePattern.test(ns) || !id || !idPattern.test(id) || !errandNumber || !status || !since)
    return null;

  const categories = Array.isArray(metadata?.categories) ? metadata.categories : [];
  const statuses = Array.isArray(metadata?.statuses) ? metadata.statuses : [];
  const category = categories.find(c => c?.name === raw.classification?.category);
  const type = (Array.isArray(category?.types) ? category.types : []).find(t => t?.name === raw.classification?.type);
  const typeLabel = [
    text(category?.displayName) ?? text(raw.classification?.category),
    text(type?.displayName) ?? text(raw.classification?.type),
  ]
    .filter(Boolean)
    .join(', ');

  const errand = {
    namespace: ns,
    area: text(area) ?? text(raw.namespaceDisplayName) ?? ns,
    id,
    errandNumber,
    type: typeLabel,
    status,
    statusLabel: text(statuses.find(s => s?.name === status)?.displayName) ?? status,
    since,
  };
  if (RELATIONS.includes(relation)) errand.relation = relation;
  const suspendedTo = instant(raw.suspension?.suspendedTo);
  if (suspendedTo) errand.suspendedTo = suspendedTo;
  const title = text(raw.title);
  if (title) errand.title = title;
  const description = text(raw.description);
  if (description) errand.description = description;
  return errand;
}

// ---- The fixture: a made-up SupportManagement with three namespaces, AD groups and access rules of its own. ----

const statuses = [
  { name: 'NEW', displayName: 'Inkommet' },
  { name: 'ONGOING', displayName: 'Pågående' },
  { name: 'PENDING', displayName: 'Komplettering' },
  { name: 'AWAITING_INTERNAL_RESPONSE', displayName: 'Internt svar' },
  { name: 'SUSPENDED', displayName: 'Parkerat' },
  { name: 'ASSIGNED', displayName: 'Tilldelat' },
  { name: 'SOLVED', displayName: 'Löst' },
];

/** Namespace -> its display name, the AD groups whose members handle its errands, and its metadata. */
export const fixtureNamespaces = {
  KC: {
    displayName: 'Kontaktcenter',
    groups: ['sg-kontaktcenter'],
    metadata: {
      statuses,
      categories: [
        {
          name: 'INVOICE',
          displayName: 'Faktura',
          types: [{ name: 'INVOICE.QUESTION', displayName: 'Fråga' }],
        },
      ],
    },
  },
  IK: {
    displayName: 'Intern kundtjänst',
    groups: ['sg-intern-kundtjanst'],
    metadata: {
      statuses,
      categories: [
        {
          name: 'ACCESS',
          displayName: 'Behörighet',
          types: [
            { name: 'ACCESS.ORDER', displayName: 'Beställning' },
            { name: 'ACCESS.RESET', displayName: 'Återställning' },
          ],
        },
        {
          name: 'EQUIPMENT',
          displayName: 'Utrustning',
          types: [{ name: 'EQUIPMENT.FAULT', displayName: 'Felanmälan' }],
        },
      ],
    },
  },
  LOP: {
    displayName: 'Lön och pension',
    groups: ['sg-lon-pension'],
    metadata: {
      statuses,
      categories: [
        {
          name: 'SALARY',
          displayName: 'Lön',
          types: [{ name: 'SALARY.QUESTION', displayName: 'Fråga' }],
        },
      ],
    },
  },
};

/** Account -> AD groups, as the fixture's directory knows them. The accounts are Clew's synthetic development users. */
export const fixtureGroups = {
  mikael: ['sg-intern-kundtjanst'],
  karin: ['sg-kontaktcenter'],
  hillevi: [],
  hassan: [],
};

const day = 86_400_000;

function fixtureErrands(now) {
  const ago = days => new Date(now - days * day).toISOString();
  const ahead = days => new Date(now + days * day).toISOString();
  return [
    {
      namespace: 'IK',
      id: 'a1f0c3d2-0001-4000-8000-000000000001',
      errandNumber: 'IK-26110007',
      title: 'Ny medarbetare behöver konto i elevregistret',
      description: 'Vikarien börjar på måndag och saknar inloggning. Beställningen gäller läsbehörighet.',
      status: 'ONGOING',
      classification: { category: 'ACCESS', type: 'ACCESS.ORDER' },
      reporterUserId: 'hillevi',
      assignedUserId: 'mikael',
      assignedGroupId: 'sg-intern-kundtjanst',
      created: ago(3),
      modified: ago(1),
      touched: ago(1),
    },
    {
      namespace: 'IK',
      id: 'a1f0c3d2-0002-4000-8000-000000000002',
      errandNumber: 'IK-26110004',
      title: 'Projektorn i sal 12 startar inte',
      description: 'Lampan blinkar rött. Felsökt enligt lathunden utan resultat.',
      status: 'PENDING',
      classification: { category: 'EQUIPMENT', type: 'EQUIPMENT.FAULT' },
      reporterUserId: 'hillevi',
      assignedUserId: 'mikael',
      assignedGroupId: 'sg-intern-kundtjanst',
      created: ago(6),
      modified: ago(2),
      touched: ago(2),
    },
    {
      namespace: 'IK',
      id: 'a1f0c3d2-0003-4000-8000-000000000003',
      errandNumber: 'IK-26110011',
      title: 'Lösenordet till schemasystemet är låst',
      description: 'Tre felaktiga försök i morse.',
      status: 'NEW',
      classification: { category: 'ACCESS', type: 'ACCESS.RESET' },
      reporterUserId: 'hassan',
      assignedGroupId: 'sg-intern-kundtjanst',
      created: ago(0.2),
      modified: ago(0.2),
      touched: ago(0.2),
    },
    {
      namespace: 'IK',
      id: 'a1f0c3d2-0004-4000-8000-000000000004',
      errandNumber: 'IK-26100031',
      title: 'Behörighet till personalsystemet',
      description: 'Avvaktar besked från systemägaren.',
      status: 'SUSPENDED',
      classification: { category: 'ACCESS', type: 'ACCESS.ORDER' },
      reporterUserId: 'karin',
      assignedUserId: 'mikael',
      assignedGroupId: 'sg-intern-kundtjanst',
      suspension: { suspendedFrom: ago(4), suspendedTo: ahead(3) },
      created: ago(14),
      modified: ago(4),
      touched: ago(4),
    },
    {
      namespace: 'IK',
      id: 'a1f0c3d2-0005-4000-8000-000000000005',
      errandNumber: 'IK-26100019',
      title: 'Byte av skärm',
      description: 'Skärmen är utbytt och testad.',
      status: 'SOLVED',
      classification: { category: 'EQUIPMENT', type: 'EQUIPMENT.FAULT' },
      reporterUserId: 'hillevi',
      assignedUserId: 'mikael',
      assignedGroupId: 'sg-intern-kundtjanst',
      created: ago(20),
      modified: ago(12),
      touched: ago(12),
    },
    {
      namespace: 'LOP',
      id: 'b2e1d4c3-0001-4000-8000-000000000001',
      errandNumber: 'LOP-26110002',
      title: 'Fråga om ob-tillägg i oktober',
      description: 'Två kvällspass saknas på lönespecifikationen.',
      status: 'ONGOING',
      classification: { category: 'SALARY', type: 'SALARY.QUESTION' },
      reporterUserId: 'hassan',
      assignedUserId: 'lena',
      assignedGroupId: 'sg-lon-pension',
      created: ago(5),
      modified: ago(2),
      touched: ago(2),
    },
    {
      namespace: 'KC',
      id: 'c3d2e5f4-0001-4000-8000-000000000001',
      errandNumber: 'KC-26110042',
      title: 'Invånare undrar över dubbel faktura',
      description: 'Samma faktura har kommit två gånger för barnomsorgen.',
      status: 'ONGOING',
      classification: { category: 'INVOICE', type: 'INVOICE.QUESTION' },
      reporterUserId: 'karin',
      assignedUserId: 'karin',
      assignedGroupId: 'sg-kontaktcenter',
      created: ago(2),
      modified: ago(1),
      touched: ago(1),
    },
  ];
}

/**
 * The claims of the person's token, read without checking the signature. That is enough for made-up data and nothing
 * else: SupportManagement itself must verify the token against the identity provider's keys.
 */
function fixtureClaims(token, audience, now) {
  try {
    const claims = JSON.parse(Buffer.from(String(token).split('.')[1] ?? '', 'base64url').toString());
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (typeof claims.preferred_username !== 'string' || !claims.preferred_username) return null;
    if (!audiences.includes(audience)) return null;
    if (Number.isFinite(claims.exp) && claims.exp * 1000 <= now) return null;
    return claims;
  } catch {
    return null;
  }
}

/**
 * The made-up SupportManagement. It answers as the proposed API would (README.md): who the person is comes from the
 * token, which namespaces they handle from their groups, and an errand outside both is not found rather than refused,
 * so its existence is not revealed.
 */
export function createFixtureErrands({
  audience = 'supportmanagement',
  namespaces = fixtureNamespaces,
  groups = fixtureGroups,
  now = () => Date.now(),
} = {}) {
  const handles = (account, namespace) =>
    (groups[account] ?? []).some(group => namespaces[namespace]?.groups.includes(group));
  const open = raw => raw.status !== 'SOLVED';
  const whoIs = token => {
    const claims = fixtureClaims(token, audience, now());
    if (!claims) throw new SourceDenied('The token was not accepted.');
    return claims.preferred_username;
  };
  const present = (raw, relation) =>
    toSourceErrand(raw, {
      namespace: raw.namespace,
      area: namespaces[raw.namespace]?.displayName,
      metadata: namespaces[raw.namespace]?.metadata,
      relation,
    });

  return {
    async mine(token, relation) {
      const me = whoIs(token);
      const errands = fixtureErrands(now()).filter(open);
      const picked =
        relation === 'assigned'
          ? errands.filter(e => handles(me, e.namespace) && e.assignedUserId === me)
          : relation === 'group'
            ? errands.filter(e => handles(me, e.namespace) && !e.assignedUserId)
            : relation === 'reported'
              ? errands.filter(e => e.reporterUserId === me)
              : [];
      return picked.map(raw => present(raw, relation)).filter(Boolean);
    },

    async errand(token, namespace, id) {
      const me = whoIs(token);
      const raw = fixtureErrands(now()).find(e => e.namespace === namespace && e.id === id);
      if (!raw || !(handles(me, raw.namespace) || raw.reporterUserId === me))
        throw new SourceNotFound('No such errand for this person.');
      const relation = raw.assignedUserId === me ? 'assigned' : raw.reporterUserId === me ? 'reported' : undefined;
      return present(raw, relation ?? (raw.assignedUserId ? undefined : 'group'));
    },
  };
}
