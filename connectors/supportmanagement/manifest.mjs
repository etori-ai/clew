// Clew reads this contract to discover the errands a person has in SupportManagement and to draw them (D35, D89).
// The rows are the errand model every case system answers with: a ref, a non-personal label, a shared state and the
// system's own status. Free text is in the errand view only, read live and never offered to the model.

export const CONNECTOR = 'sm';
export const DEFAULT_AUDIENCE = 'supportmanagement';
export const DEFAULT_SOURCE = 'Ärendesystemet';

/** `errand:sm:<municipalityId>:<namespace>:<id>` (D35). Clew treats it as opaque. */
export const errandRefParts = {
  municipalityId: '[0-9]{1,8}',
  namespace: '[A-Za-z0-9_.-]{1,60}',
  id: '[A-Za-z0-9-]{1,80}',
};
export const errandRefPattern = `^errand:sm:${errandRefParts.municipalityId}:${errandRefParts.namespace}:${errandRefParts.id}$`;

/** The shared state (D89): what lets lists from several case systems be ordered together. */
export const STATES = ['new', 'active', 'waiting-on-me', 'waiting-on-others', 'closed'];

const string = { type: 'string' };

const errandRowSchema = {
  type: 'object',
  properties: {
    ref: { type: 'string', pattern: errandRefPattern },
    label: string,
    state: { type: 'string', enum: STATES },
    status: string,
    waitingOn: string,
    since: string,
    dueAt: string,
    area: string,
    link: string,
  },
  required: ['ref', 'label', 'state', 'status', 'since', 'area'],
};

const errandViewSchema = {
  type: 'object',
  properties: {
    ...errandRowSchema.properties,
    title: string,
    description: string,
  },
  required: errandRowSchema.required,
};

const openErrand = { capability: 'sm.errand', title: 'Ärende', params: { ref: 'ref' } };

// Only the person the errand waits on is given a tone; every other value stays neutral.
const waitingOnField = { key: 'waitingOn', label: 'Väntar på', format: 'status', tones: { Dig: 'warn' } };

// The list: what is assigned to the person or their group, or what the person reported (D35's two views). The name
// is the errand profile's: Clew lists every connector's `<id>.errands` together as `clew.errands`, and that list is
// the one a person sees, so this read has no menu row and no button of its own.
const errandsCapability = {
  name: 'sm.errands',
  kind: 'read',
  title: 'Ärenden i ärendesystemet',
  model: true,
  scope: {},
  description:
    'Personens öppna ärenden i ärendesystemet: tilldelade personen eller gruppen, eller anmälda av personen. Ärendenummer, typ, status och område; aldrig rubrik, beskrivning eller parter.',
  input: {
    type: 'object',
    properties: { view: { type: 'string', enum: ['assigned', 'reported'] } },
    additionalProperties: false,
  },
  output: {
    type: 'object',
    properties: { rows: { type: 'array', items: errandRowSchema } },
    required: ['rows'],
  },
  view: {
    kind: 'list',
    title: 'label',
    ref: 'ref',
    open: openErrand,
    modelReads: 'summary',
    noun: { one: 'ärende', other: 'ärenden' },
    empty: 'Du har inga öppna ärenden här.',
    fields: [
      { key: 'label', label: 'Ärende' },
      { key: 'status', label: 'Status' },
      waitingOnField,
      { key: 'area', label: 'Område' },
      { key: 'since', label: 'Senast ändrat', format: 'date' },
    ],
    input: {
      filter: {
        key: 'view',
        label: 'Visa',
        options: [
          { value: 'assigned', label: 'Tilldelade mig eller min grupp' },
          { value: 'reported', label: 'Anmälda av mig' },
        ],
      },
    },
  },
};

// One errand with its free text, read live for the panel. Never a tool: the text may name a citizen.
const errandCapability = {
  name: 'sm.errand',
  kind: 'read',
  title: 'Ärende',
  model: false,
  scope: {},
  description: 'Ett ärende med rubrik och beskrivning, läst direkt från ärendesystemet för personen som öppnar det.',
  input: {
    type: 'object',
    properties: { ref: { type: 'string', pattern: errandRefPattern } },
    required: ['ref'],
    additionalProperties: false,
  },
  output: errandViewSchema,
  view: {
    kind: 'detail',
    title: 'label',
    fields: [
      { key: 'status', label: 'Status' },
      waitingOnField,
      { key: 'area', label: 'Område' },
      { key: 'since', label: 'Senast ändrat', format: 'date' },
      { key: 'title', label: 'Rubrik' },
      { key: 'description', label: 'Beskrivning' },
      { key: 'link', label: 'Öppna i ärendesystemet', format: 'link' },
    ],
  },
};

// ---- What a person sent to a drake and owns (D123, docs/reviews/2026-11-23-an-errand-owner-answers-supportmanagement-from-clew.md). ----

/** `request:sm:<municipalityId>:<namespace>:<id>`: an errand as its owner meets it. */
export const requestRefPattern = `^request:sm:${errandRefParts.municipalityId}:${errandRefParts.namespace}:${errandRefParts.id}$`;
/** Where a request stands, seen from the person who waits (D123). */
export const REQUEST_STATES = ['waiting-on-me', 'new', 'active', 'closed'];
const instant = { type: 'string', format: 'date-time', maxLength: 40 };
/** The protocol's RequestRow, written out: a connector does not import the repository. Nothing else may be in a row. */
const requestRow = {
  ref: { type: 'string', minLength: 1, maxLength: 200, pattern: requestRefPattern },
  label: { type: 'string', minLength: 1, maxLength: 200 },
  state: { type: 'string', enum: REQUEST_STATES },
  status: { type: 'string', minLength: 1, maxLength: 80 },
  since: instant,
  link: { type: 'string', maxLength: 1000, pattern: '^https?://[^\\s]+$' },
};
const requiredRequestRow = ['ref', 'label', 'state', 'status', 'since'];
const REQUEST_TITLE = 'Ärende';
const requestInput = {
  type: 'object',
  properties: { ref: { type: 'string', pattern: requestRefPattern, maxLength: 200 } },
  required: ['ref'],
  additionalProperties: false,
};

// What the person sent to a drake, by number and type only, with where it stands for them. Clew asks every such read
// as `clew.requests`, "Mina beställningar", and shows that list.
const requestsCapability = {
  name: 'sm.requests',
  kind: 'read',
  title: 'Mina ärenden hos drakarna',
  model: true,
  scope: {},
  description:
    'Ärenden personen har skickat till en handläggande enhet och äger: nummer, typ och status, och om enheten väntar på personens svar. Aldrig rubrik, meddelanden eller namn.',
  input: { type: 'object', properties: {}, additionalProperties: false },
  output: {
    type: 'object',
    properties: {
      rows: {
        type: 'array',
        maxItems: 500,
        items: { type: 'object', properties: requestRow, required: requiredRequestRow, additionalProperties: false },
      },
    },
    required: ['rows'],
    additionalProperties: false,
  },
  view: {
    kind: 'list',
    title: 'label',
    ref: 'ref',
    open: { capability: 'sm.request', title: REQUEST_TITLE, params: { ref: 'ref' } },
    modelReads: 'summary',
    noun: { one: 'ärende', other: 'ärenden' },
    empty: 'Du har inga ärenden hos drakarna.',
    fields: [
      { key: 'label', label: 'Ärende' },
      { key: 'status', label: 'Status' },
      { key: 'since', label: 'Registrerat', format: 'date' },
    ],
  },
};

// One errand with the messages between the drake and its owner, and how to answer. Never a tool: a message can be
// about anyone, so the assistant is never offered it.
const requestCapability = {
  name: 'sm.request',
  kind: 'read',
  title: REQUEST_TITLE,
  model: false,
  scope: {},
  description: 'Ett ärende personen äger, med meddelandena mellan handläggaren och personen och hur personen svarar.',
  input: requestInput,
  output: {
    type: 'object',
    properties: { ...requestRow, body: { type: 'string', minLength: 1, maxLength: 200000 } },
    required: [...requiredRequestRow, 'body'],
    additionalProperties: false,
  },
  view: { kind: 'text', body: 'body' },
};

const answerInput = {
  type: 'object',
  properties: {
    ref: requestInput.properties.ref,
    text: { type: 'string', minLength: 1, maxLength: 4000 },
  },
  required: ['ref', 'text'],
  additionalProperties: false,
};

// The answer through Open-E. Never a tool: it runs only when the person has decided, with their own token behind it.
// A message in Open-E cannot be taken back, and Open-E cannot tell a repeated one from a new one, so Clew never
// repeats it by itself (`manual`).
const replyCapability = {
  name: 'sm.reply',
  kind: 'execute',
  title: 'Svara',
  model: false,
  scope: {},
  description: 'Skickar personens svar till handläggaren genom e-tjänsten, som ärendets ägare.',
  execution: { strategy: 'manual' },
  effect: 'sm.replyEffect',
  asks: [{ kind: 'long-text', property: 'text', label: 'Ditt svar', required: true }],
  input: answerInput,
  output: {
    type: 'object',
    properties: {
      headline: string,
      rows: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            ref: string,
            label: string,
            outcome: { type: 'string', enum: ['done', 'unknown', 'failed', 'skipped'] },
            detail: string,
          },
          required: ['ref', 'label', 'outcome', 'detail'],
        },
      },
    },
    required: ['headline', 'rows'],
  },
};

// What the answer will do, without sending anything: "Det här händer".
const replyEffectCapability = {
  name: 'sm.replyEffect',
  kind: 'read',
  title: 'Vad svaret gör',
  model: false,
  scope: {},
  description: 'Vart svaret skickas och vilket meddelande det svarar på.',
  input: answerInput,
  output: {
    type: 'object',
    properties: {
      rows: {
        type: 'array',
        items: { type: 'object', properties: { label: string, detail: string }, required: ['label'] },
      },
    },
    required: ['rows'],
  },
};

/**
 * `audience` is what the person's token is issued for: the identity provider and SupportManagement's gateway agree on
 * it, so it is configuration, not a constant. `source` is the system's name as a person reads it. `owner` adds what
 * an errand's owner sees and answers, and the cards while an errand waits on them; it needs the connector to check
 * the person's token itself.
 */
export function createManifest({ audience = DEFAULT_AUDIENCE, source = DEFAULT_SOURCE, owner = false } = {}) {
  return {
    protocol: 1,
    id: CONNECTOR,
    kind: 'passthrough',
    source,
    // No area: "Ärenden" and "Mina beställningar" belong to Clew's combined lists, whatever the number of systems.
    areas: [],
    capabilities: [
      errandsCapability,
      errandCapability,
      ...(owner ? [requestsCapability, requestCapability, replyCapability, replyEffectCapability] : []),
    ],
    // A scan runs with the person's token while their session asks (D89 item 5); only the owner's side has cards.
    scan: owner,
    delegation: { audience },
  };
}

export const manifest = createManifest();
