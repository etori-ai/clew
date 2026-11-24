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
      externalTags: [{ key: 'caseId', value: '48299' }],
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
    // Two errands Hillevi, a manager, sent to the drakar: she is their owner (the `PRIMARY` stakeholder), while the
    // handler who registered each is its reporter, as in Draken. Lön och pension mails her; Intern kundtjänst writes in
    // the e-service the errand came from.
    {
      namespace: 'LOP',
      id: 'b2e1d4c3-0002-4000-8000-000000000002',
      errandNumber: 'LOP-26110021',
      title: 'Vikarie har inte fått lön för oktober',
      description: 'Chefen mejlade om en vikarie som saknar oktoberlönen.',
      status: 'PENDING',
      classification: { category: 'SALARY', type: 'SALARY.QUESTION' },
      reporterUserId: 'lena',
      assignedUserId: 'lena',
      assignedGroupId: 'sg-lon-pension',
      created: ago(3),
      modified: ago(1.1),
      touched: ago(1.1),
    },
    {
      namespace: 'IK',
      id: 'a1f0c3d2-0006-4000-8000-000000000006',
      errandNumber: 'IK-26110015',
      title: 'Behörighet till elevregistret för ny lärare',
      description: 'Beställning från e-tjänsten Beställ behörighet.',
      status: 'PENDING',
      classification: { category: 'ACCESS', type: 'ACCESS.ORDER' },
      reporterUserId: 'sofia',
      assignedUserId: 'sofia',
      assignedGroupId: 'sg-intern-kundtjanst',
      externalTags: [{ key: 'caseId', value: '48213' }],
      created: ago(2),
      modified: ago(0.8),
      touched: ago(0.8),
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

// ---- What an errand's owner sees: the `PRIMARY` stakeholder, the messages, and the answers (owner.mjs). ----

/** The people the fixture's directory knows, with the address their mail comes from. */
const people = {
  hillevi: { name: 'Hillevi Berg', email: 'hillevi@clew.test' },
  hassan: { name: 'Hassan Ali', email: 'hassan@clew.test' },
  karin: { name: 'Karin Holm', email: 'karin@clew.test' },
};
/** Each namespace's mailbox, the address its e-mail reader reads and its drakes write from. */
export const fixtureReplyAddresses = { IK: 'ik@clew.test', LOP: 'lon@clew.test', KC: 'kontaktcenter@clew.test' };

/**
 * The made-up Open-E's flow instances: flow instance id -> the account that owns it. The e-service's messages are that
 * person's; the connector shows and answers them only for an errand owner who is this account too.
 */
export const fixtureFlowOwners = { 48213: 'hillevi', 48299: 'sara.nystrom' };

/** Errand number -> the account of its owner. */
const fixtureOwners = {
  'IK-26110007': 'hillevi',
  'IK-26110004': 'hillevi',
  'IK-26100019': 'hillevi',
  'LOP-26110021': 'hillevi',
  'IK-26110015': 'hillevi',
  'IK-26110011': 'hassan',
  'LOP-26110002': 'hassan',
  'IK-26100031': 'karin',
};

/** The `PRIMARY` stakeholder SupportManagement holds for an employee, as Draken writes it. */
const primary = account => ({
  role: 'PRIMARY',
  externalIdType: 'EMPLOYEE',
  externalId: `party-${account}`,
  firstName: people[account]?.name.split(' ')[0],
  lastName: people[account]?.name.split(' ').slice(1).join(' '),
  contactChannels: people[account] ? [{ type: 'Email', value: people[account].email }] : [],
  parameters: [{ key: 'username', displayName: 'Användarnamn', values: [account] }],
});

/**
 * The owner of a SupportManagement errand: the `PRIMARY` stakeholder's account (the parameter `username`) and e-mail.
 * `null` when there is no such stakeholder or it has no account: then nobody owns the errand in Clew.
 */
export function ownerOf(raw) {
  const stakeholder = (Array.isArray(raw?.stakeholders) ? raw.stakeholders : []).find(s => s?.role === 'PRIMARY');
  const values = (Array.isArray(stakeholder?.parameters) ? stakeholder.parameters : []).find(
    p => p?.key === 'username',
  )?.values;
  const username = text(Array.isArray(values) ? values[0] : undefined);
  if (!username) return null;
  const channel = (Array.isArray(stakeholder.contactChannels) ? stakeholder.contactChannels : []).find(c =>
    /^e-?mail$/i.test(c?.type ?? ''),
  );
  const email = text(channel?.value);
  return email ? { username, email } : { username };
}

/** The errand's Open-E flow instance, from its `caseId` tag, as SupportManagement sends it on. */
export const flowInstanceOf = raw =>
  text((Array.isArray(raw?.externalTags) ? raw.externalTags : []).find(tag => tag?.key === 'caseId')?.value);

/** `Name <address>`, a bare address, or, for an e-service message, the handler's name. */
function sender(value) {
  const said = text(value);
  if (!said) return {};
  const named = /^(.*?)\s*<([^<>\s]+)>$/.exec(said);
  if (named) return { ...(text(named[1]) ? { name: text(named[1]) } : {}), address: named[2] };
  return said.includes('@') ? { address: said } : { name: said };
}
const addresses = value => (Array.isArray(value) ? value : [value]).map(v => sender(v).address).filter(Boolean);
const CHANNEL_OF = { EMAIL: 'email', WEB_MESSAGE: 'webmessage' };

/**
 * An errand's communications and conversations as SupportManagement answers them, as the messages owner.mjs works
 * with. A communication of another type (an SMS) is left out; so is anything without a time.
 */
export function toMessages({ communications = [], conversations = [] } = {}, owner) {
  const messages = [];
  for (const raw of Array.isArray(communications) ? communications : []) {
    const channel = CHANNEL_OF[raw?.communicationType];
    const at = instant(raw?.sent);
    if (!channel || !at) continue;
    messages.push({
      id: text(raw.communicationID) ?? `${channel}-${at}`,
      channel,
      direction: raw.direction === 'INBOUND' ? 'in' : 'out',
      internal: raw.internal === true,
      at,
      from: sender(raw.sender),
      to: addresses([...(raw.target ? [raw.target] : []), ...(Array.isArray(raw.recipients) ? raw.recipients : [])]),
      cc: addresses(Array.isArray(raw.ccRecipients) ? raw.ccRecipients : []),
      text: typeof raw.messageBody === 'string' ? raw.messageBody : '',
      attachments: (Array.isArray(raw.communicationAttachments) ? raw.communicationAttachments : [])
        .map(a => text(a?.fileName) ?? text(a?.name))
        .filter(Boolean),
    });
  }
  for (const conversation of Array.isArray(conversations) ? conversations : []) {
    const participants = (Array.isArray(conversation?.participants) ? conversation.participants : [])
      .filter(p => /^adaccount$/i.test(p?.type ?? ''))
      .map(p => text(p.value))
      .filter(Boolean);
    const shape = {
      type: conversation?.type === 'EXTERNAL' ? 'EXTERNAL' : 'INTERNAL',
      related: Array.isArray(conversation?.relationIds) && conversation.relationIds.length > 0,
      participants,
    };
    for (const raw of Array.isArray(conversation?.messages) ? conversation.messages : []) {
      const at = instant(raw?.created);
      if (!at) continue;
      const by = text(raw.createdBy?.value);
      messages.push({
        id: text(raw.id) ?? `conversation-${at}`,
        channel: 'conversation',
        direction: owner && by && by.toLowerCase() === owner.username.toLowerCase() ? 'in' : 'out',
        at,
        from: {
          ...(by ? { account: by } : {}),
          ...(text(raw.createdBy?.name) ? { name: text(raw.createdBy.name) } : {}),
        },
        text: typeof raw.content === 'string' ? raw.content : '',
        conversation: shape,
      });
    }
  }
  return messages.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

/** Errand number -> what SupportManagement holds of its communications and conversations, in its own shape. */
function fixtureCommunications(now) {
  const ago = days => new Date(now - days * day).toISOString();
  return {
    'LOP-26110021': {
      communications: [
        {
          communicationID: 'lop21-1',
          communicationType: 'EMAIL',
          direction: 'INBOUND',
          sender: 'Hillevi Berg <hillevi@clew.test>',
          target: 'lon@clew.test',
          subject: 'Lön till vikarie',
          messageBody:
            'Hej!\n\nVår vikarie Sara Lund har inte fått någon lön för oktober. Kan ni titta på det?\n\nHälsningar\nHillevi',
          sent: ago(3),
        },
        {
          // Between handlers: never the owner's to read.
          communicationID: 'lop21-2',
          communicationType: 'EMAIL',
          direction: 'OUTBOUND',
          internal: true,
          sender: 'Lena Ström <lon@clew.test>',
          target: 'per.lon@clew.test',
          subject: 'Ärende #LOP-26110021',
          messageBody: 'Per, kan du kontrollera vikariens schema i lönesystemet? Jag tror att anställningen saknas.',
          sent: ago(2.6),
        },
        {
          // To the employee the errand is about: hers, not the manager's.
          communicationID: 'lop21-3',
          communicationType: 'EMAIL',
          direction: 'OUTBOUND',
          sender: 'Lena Ström <lon@clew.test>',
          target: 'sara.lund@clew.test',
          subject: 'Ärende #LOP-26110021',
          messageBody: 'Hej Sara! Vi utreder din oktoberlön och återkommer så snart vi vet mer.',
          sent: ago(2.2),
        },
        {
          communicationID: 'lop21-4',
          communicationType: 'EMAIL',
          direction: 'OUTBOUND',
          sender: 'Lena Ström <lon@clew.test>',
          target: 'hillevi@clew.test',
          subject: 'Ärende #LOP-26110021',
          messageBody:
            'Hej Hillevi!\n\nFör att kunna rätta lönen behöver vi Saras anställningsnummer och vilka datum hon arbetade i oktober. Fyll gärna i den bifogade tidrapporten.\n\nVänliga hälsningar\nLena Ström\nLön och pension\n\n-----Ursprungligt meddelande-----\nFrån: Hillevi Berg\nVår vikarie Sara Lund har inte fått någon lön för oktober.',
          communicationAttachments: [{ fileName: 'Tidrapport-oktober.pdf' }],
          sent: ago(1.1),
        },
        {
          // From the employee, with the manager in Cc: shown to her under Sara's name, and not her answer.
          communicationID: 'lop21-5',
          communicationType: 'EMAIL',
          direction: 'INBOUND',
          sender: 'Sara Lund <sara.lund@clew.test>',
          target: 'lon@clew.test',
          ccRecipients: ['hillevi@clew.test'],
          subject: 'SV: Ärende #LOP-26110021',
          messageBody: 'Hej! Jag arbetade den 3, 4 och 10 oktober. Anställningsnumret vet Hillevi.',
          sent: ago(0.9),
        },
      ],
    },
    'IK-26110015': {
      communications: [
        {
          communicationID: 'ik15-1',
          communicationType: 'WEB_MESSAGE',
          direction: 'OUTBOUND',
          sender: 'Sofia Nord',
          messageBody:
            'Hej! Vi har tagit emot beställningen av behörighet till elevregistret. Från vilket datum ska behörigheten gälla, och ska den vara tidsbegränsad?',
          sent: ago(0.8),
        },
      ],
      conversations: [
        {
          // Between handlers: never the owner's to read.
          id: 'ik15-internal',
          type: 'INTERNAL',
          participants: [
            { type: 'adAccount', value: 'sofia' },
            { type: 'adAccount', value: 'mikael' },
          ],
          messages: [
            {
              id: 'ik15-internal-1',
              content: 'Mikael, behöver vi chefens godkännande för skrivbehörighet i elevregistret?',
              created: ago(0.7),
              createdBy: { type: 'adAccount', value: 'sofia' },
            },
          ],
        },
        {
          // The one KC shares with this errand through a relation: KC's and the drake's, not the owner's.
          id: 'ik15-kc',
          type: 'EXTERNAL',
          relationIds: ['relation-kc-ik15'],
          participants: [
            { type: 'adAccount', value: 'karin' },
            { type: 'adAccount', value: 'hillevi' },
          ],
          messages: [
            {
              id: 'ik15-kc-1',
              content: 'Överlämnat från Kontaktcenter: rektorn ringde om behörigheten.',
              created: ago(1.5),
              createdBy: { type: 'adAccount', value: 'karin' },
            },
          ],
        },
      ],
    },
    'IK-26110004': {
      communications: [
        {
          communicationID: 'ik04-1',
          communicationType: 'EMAIL',
          direction: 'OUTBOUND',
          sender: 'Mikael Lind <ik@clew.test>',
          target: 'hillevi@clew.test',
          subject: 'Ärende #IK-26110004',
          messageBody: 'Hej! Vilken modell är projektorn, och när byttes lampan senast?',
          sent: ago(2.5),
        },
        {
          communicationID: 'ik04-2',
          communicationType: 'EMAIL',
          direction: 'INBOUND',
          sender: 'Hillevi Berg <hillevi@clew.test>',
          target: 'ik@clew.test',
          subject: 'SV: Ärende #IK-26110004',
          messageBody:
            'Det är en Epson EB-W49. Lampan bytte vi i våras.\n\n> Hej! Vilken modell är projektorn, och när byttes lampan senast?',
          sent: ago(1.9),
        },
        {
          // To the technicians, Hillevi in Cc for her information: the question is theirs, not hers.
          communicationID: 'ik04-3',
          communicationType: 'EMAIL',
          direction: 'OUTBOUND',
          sender: 'Mikael Lind <ik@clew.test>',
          target: 'tekniker@clew.test',
          ccRecipients: ['hillevi@clew.test'],
          subject: 'Ärende #IK-26110004',
          messageBody: 'Kan ni byta lampan i projektorn i sal 12 i veckan?',
          sent: ago(1),
        },
      ],
    },
    'IK-26110011': {
      communications: [
        {
          // An e-service message to the person who filled in the form, Sara, on an errand whose owner is Hassan: the
          // e-service's messages are the flow instance owner's, so Hassan sees nothing of it.
          communicationID: 'ik11-1',
          communicationType: 'WEB_MESSAGE',
          direction: 'OUTBOUND',
          sender: 'Mikael Lind',
          messageBody: 'Hej Sara! Vilket system gäller det?',
          sent: ago(0.1),
        },
      ],
    },
    'IK-26100019': {
      communications: [
        {
          communicationID: 'ik19-1',
          communicationType: 'EMAIL',
          direction: 'OUTBOUND',
          sender: 'Mikael Lind <ik@clew.test>',
          target: 'hillevi@clew.test',
          subject: 'Ärende #IK-26100019',
          messageBody: 'Skärmen är utbytt och testad. Vi avslutar ärendet.',
          sent: ago(12),
        },
      ],
    },
  };
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

  // The made-up history is placed relative to when the fixture started, so an errand's times stay the same from one
  // read to the next, as a real system's do. What happens after that (an answer, a handler writing) is stamped now.
  const start = now();
  // What has happened since the fixture started: messages filed on an errand, and the operations already posted.
  const added = new Map();
  const operations = new Map();
  const posted = [];
  let count = 0;
  const file = (errandNumber, message) => added.set(errandNumber, [...(added.get(errandNumber) ?? []), message]);
  /** Every errand with its stakeholders, as SupportManagement holds it. */
  const all = () =>
    fixtureErrands(start).map(raw =>
      fixtureOwners[raw.errandNumber] ? { ...raw, stakeholders: [primary(fixtureOwners[raw.errandNumber])] } : raw,
    );
  /**
   * One errand as the owner's side works with it: the errand, when it was registered, its owner, its flow instance and
   * who owns that, as Open-E would answer.
   */
  const record = raw => {
    const flowInstanceId = flowInstanceOf(raw);
    const flowInstanceOwner = flowInstanceId ? fixtureFlowOwners[flowInstanceId] : undefined;
    return {
      errand: present(raw),
      created: instant(raw.created),
      owner: ownerOf(raw),
      ...(flowInstanceId ? { flowInstanceId } : {}),
      ...(flowInstanceOwner ? { flowInstanceOwner } : {}),
    };
  };

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

    // ---- The owner's side. The fixture answers as SupportManagement does with access control off: whatever it is
    // asked, for whoever `X-Sent-By` names. The connector holds the rule (owner.mjs); nothing here checks it. ----

    async owned(account) {
      const key = String(account).toLowerCase();
      return all()
        .filter(raw => ownerOf(raw)?.username.toLowerCase() === key)
        .map(record)
        .filter(record => record.errand);
    },

    async record(_account, namespace, id) {
      const raw = all().find(e => e.namespace === namespace && e.id === id);
      const found = raw && record(raw);
      return found?.errand ? found : null;
    },

    async messages(_account, { errand, owner }) {
      const held = fixtureCommunications(start)[errand.errandNumber] ?? {};
      return toMessages(
        {
          communications: [...(held.communications ?? []), ...(added.get(errand.errandNumber) ?? [])],
          conversations: held.conversations ?? [],
        },
        owner,
      );
    },

    /**
     * Open-E's `AddMessageAsOwner` through the integrator, and the web message collector bringing it to the errand at
     * once. The same operation sent twice is one message.
     */
    async postOwnerMessage(account, { errand, flowInstanceId }, text, operationId) {
      if (!flowInstanceId) throw new SourceUnavailable('The errand has no flow instance.');
      if (operationId && operations.has(operationId)) return operations.get(operationId);
      const message = {
        communicationID: `opene-${flowInstanceId}-${++count}`,
        communicationType: 'WEB_MESSAGE',
        direction: 'INBOUND',
        sender: people[account]?.name ?? account,
        messageBody: text,
        sent: new Date(now()).toISOString(),
      };
      file(errand.errandNumber, message);
      const result = { id: message.communicationID, at: message.sent };
      if (operationId) operations.set(operationId, result);
      posted.push({ flowInstanceId, userId: account, message: text });
      return result;
    },

    // ---- For trying the fixture by hand (server.mjs, fixture only): what a drake and the e-mail reader would do. ----

    /** What was posted to the made-up Open-E, for tests. */
    posted: () => posted.map(entry => ({ ...entry })),

    /** The handler writes to the errand's owner again, in the channel given. */
    handlerWrites(errandNumber, channel = 'email') {
      const raw = all().find(e => e.errandNumber === errandNumber);
      const owner = raw && ownerOf(raw);
      if (!owner) return false;
      const name = handlers[raw.assignedUserId] ?? namespaces[raw.namespace]?.displayName ?? raw.namespace;
      const sent = new Date(now()).toISOString();
      file(
        errandNumber,
        channel === 'webmessage'
          ? {
              communicationID: `handler-${++count}`,
              communicationType: 'WEB_MESSAGE',
              direction: 'OUTBOUND',
              sender: name,
              messageBody: 'Tack för svaret! En sak till: ska behörigheten även gälla schemasystemet?',
              sent,
            }
          : {
              communicationID: `handler-${++count}`,
              communicationType: 'EMAIL',
              direction: 'OUTBOUND',
              sender: `${name} <${fixtureReplyAddresses[raw.namespace]}>`,
              target: owner.email,
              subject: `Ärende #${errandNumber}`,
              messageBody: 'Tack för svaret! Vi behöver också veta om vikarien ska ha ob-tillägg för kvällspassen.',
              sent,
            },
      );
      return true;
    },

    /** The e-mail reader files the owner's mail answer on the errand, as it would within five minutes. */
    mailFiled(errandNumber) {
      const raw = all().find(e => e.errandNumber === errandNumber);
      const owner = raw && ownerOf(raw);
      if (!owner?.email) return false;
      file(errandNumber, {
        communicationID: `mail-${++count}`,
        communicationType: 'EMAIL',
        direction: 'INBOUND',
        sender: `${people[owner.username]?.name ?? owner.username} <${owner.email}>`,
        target: fixtureReplyAddresses[raw.namespace],
        subject: `SV: Ärende #${errandNumber}`,
        messageBody: 'Hej! Svaret skickades från min e-post.',
        sent: new Date(now()).toISOString(),
      });
      return true;
    },
  };
}

/** The fixture's handlers by account, for the name a drake's message carries. */
const handlers = { lena: 'Lena Ström', sofia: 'Sofia Nord', mikael: 'Mikael Lind' };
