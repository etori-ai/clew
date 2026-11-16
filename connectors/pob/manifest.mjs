// Clew reads this contract to discover what a person has in POB and to draw it. POB is both a case system and a
// service desk, so it answers two profiles, and nothing relates the two lists (D123):
//   - `pob.errands` (D35, D89): the errands a person handles, assigned to them or waiting in their group's queue;
//   - `pob.requests` (D123): what the person reported or ordered and waits for.
// The rows are the models every such system answers with: a ref, a non-personal label, a shared state and the system's
// own status. Free text is in the view of one errand or one request only, read live and never offered to the model.

export const CONNECTOR = 'pob';
export const DEFAULT_AUDIENCE = 'pob';
export const DEFAULT_SOURCE = 'IT-supporten';

/** `errand:pob:<case id>`. One POB per installation is assumed, so nothing in the ref says which. Clew treats it as opaque. */
export const errandRefParts = { id: '[A-Za-z0-9-]{1,80}' };
export const errandRefPattern = `^errand:pob:${errandRefParts.id}$`;

/** `request:pob:<case id>` (D123): the same errand as the person who reported it meets it. */
export const requestRefPattern = `^request:pob:${errandRefParts.id}$`;

/**
 * The area a card of this connector is filed under: Clew's own "Beställningar och felanmälningar", which its combined
 * list of requests owns (D123 item 5). A person has one area for what they reported whatever the number of service
 * desks, so this connector declares none of its own and names that one on its cards.
 */
export const REQUEST_AREA = 'requests';

/** The shared state of an errand (D89): what lets lists from several case systems be ordered together. */
export const STATES = ['new', 'active', 'waiting-on-me', 'waiting-on-others', 'closed'];
/** Where a request stands, seen from the person who waits (D123). No `waiting-on-others`: all that is open waits on the desk. */
export const REQUEST_STATES = ['waiting-on-me', 'new', 'active', 'closed'];

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

const openErrand = { capability: 'pob.errand', title: 'Ärende', params: { ref: 'ref' } };

// Only the person the errand waits on is given a tone; every other value stays neutral.
const waitingOnField = { key: 'waitingOn', label: 'Väntar på', format: 'status', tones: { Dig: 'warn' } };

// The errands a person handles: assigned to them, or waiting unassigned in a group they belong to. The name is the
// errand profile's: Clew lists every connector's `<id>.errands` together as `clew.errands`, and that list is the one a
// person sees. The profile's `view` is taken, since Clew's list says it to every system, but what a person reported
// in POB is a request (`pob.requests`), so `reported` answers no rows here.
const errandsCapability = {
  name: 'pob.errands',
  kind: 'read',
  title: 'Ärenden i IT-supporten',
  model: true,
  scope: {},
  description:
    'Öppna ärenden i IT-supportens ärendesystem som personen handlägger: tilldelade personen eller väntande i personens grupp. Ärendenummer, typ, status och grupp; aldrig rubrik, beskrivning eller parter.',
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
  },
};

// One errand the person handles, with the reporter's own text, read live. Never a tool: the text may name anyone.
const errandCapability = {
  name: 'pob.errand',
  kind: 'read',
  title: 'Ärende',
  model: false,
  scope: {},
  description:
    'Ett ärende som personen handlägger, med rubrik och beskrivning, läst direkt från ärendesystemet för personen som öppnar det.',
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

// ---- What the person reported (D123). ----

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
const REQUEST_TITLE = 'Felanmälan eller beställning';

// The requests profile: what the person reported or ordered, by number and type only. Clew asks every such read in the
// person's scope as `clew.requests` and shows that list; this one is never offered to the model beside it. The shared
// `state` is a code for Clew to order by, which its combined list says in its own words; this connector's own views
// draw POB's own word for it, `status`.
const requestsCapability = {
  name: 'pob.requests',
  kind: 'read',
  title: 'Mina felanmälningar i IT-supporten',
  model: true,
  scope: {},
  description:
    'Det personen har felanmält eller beställt hos IT-supporten: nummer, typ och status. Aldrig rubrik, beskrivning eller namn.',
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
    open: { capability: 'pob.request', title: REQUEST_TITLE, params: { ref: 'ref' } },
    modelReads: 'summary',
    noun: { one: 'felanmälan eller beställning', other: 'felanmälningar och beställningar' },
    empty: 'Du har inga felanmälningar eller beställningar hos IT-supporten.',
    fields: [
      { key: 'label', label: 'Felanmälan eller beställning' },
      { key: 'status', label: 'Status' },
      { key: 'since', label: 'Registrerad', format: 'date' },
    ],
  },
};

// One request with the person's own text, read live: the person's own only. Never a tool: the text may name anyone.
const requestCapability = {
  name: 'pob.request',
  kind: 'read',
  title: REQUEST_TITLE,
  model: false,
  scope: {},
  description: 'En felanmälan eller beställning som personen själv har gjort, med rubrik och beskrivning.',
  input: {
    type: 'object',
    properties: { ref: { type: 'string', pattern: requestRefPattern, maxLength: 200 } },
    required: ['ref'],
    additionalProperties: false,
  },
  output: {
    type: 'object',
    properties: {
      ...requestRow,
      group: { type: 'string', minLength: 1, maxLength: 120 },
      title: { type: 'string', minLength: 1, maxLength: 200 },
      description: { type: 'string', minLength: 1, maxLength: 4000 },
    },
    required: requiredRequestRow,
    additionalProperties: false,
  },
  view: {
    kind: 'detail',
    title: 'label',
    fields: [
      { key: 'status', label: 'Status' },
      { key: 'since', label: 'Registrerad', format: 'date' },
      { key: 'group', label: 'Handläggs av' },
      { key: 'title', label: 'Rubrik' },
      { key: 'description', label: 'Beskrivning' },
      { key: 'link', label: 'Öppna i ärendesystemet', format: 'link' },
    ],
  },
};

// ---- Reporting a fault (only with `writes: ['create']`). The assistant prepares, the person sends. ----

const faultProperties = {
  about: {
    type: 'string',
    enum: ['me', 'other'],
    description:
      '"me" när felet gäller personens egen dator ("min dator", "jag"), "other" när det gäller någon annans ("min kollegas dator", "åt någon annan"). Utelämna när det är oklart.',
  },
  otherName: {
    type: 'string',
    maxLength: 200,
    description: 'Namnet på personen felet gäller, när det gäller någon annan.',
  },
  problem: {
    type: 'string',
    maxLength: 4000,
    description: 'Vad som är fel, sedan när, och eventuella felmeddelanden, med personens egna ord.',
  },
  place: { type: 'string', maxLength: 200, description: 'Var datorn finns: arbetsplats, hus, rum.' },
  computer: {
    type: 'string',
    maxLength: 80,
    description:
      'Datornamnet, som står på ett klistermärke på datorn. Gissa aldrig: utelämna om personen inte har sagt det.',
  },
};

const threadDraftSchema = {
  type: 'object',
  properties: {
    topic: string,
    area: string,
    title: string,
    summary: string,
    reason: string,
    items: { type: 'array', items: { type: 'object' } },
    actions: { type: 'array', items: { type: 'object' } },
  },
  required: ['topic', 'area', 'title', 'summary', 'reason', 'items', 'actions'],
};

// A propose the model may call: it writes nothing and answers a work item whose one button sends the report. Clew
// starts that item, and shows what the assistant was told as a draft of the answers the person can change.
const reportFaultCapability = {
  name: 'pob.reportFault',
  kind: 'propose',
  title: 'Felanmäl dator',
  model: true,
  scope: {},
  description:
    'Förbereder en felanmälan av en dator som ett utkast åt personen. Fyll i det personen har berättat och fråga efter plats och datornamn om de saknas. Inget skickas förrän personen själv skickar.',
  input: { type: 'object', properties: faultProperties, additionalProperties: false },
  output: threadDraftSchema,
};

const faultInput = {
  type: 'object',
  properties: {
    about: { type: 'string', enum: ['me', 'other'] },
    otherName: { type: 'string', maxLength: 200 },
    problem: { type: 'string', minLength: 1, maxLength: 4000 },
    place: { type: 'string', minLength: 1, maxLength: 200 },
    computer: { type: 'string', minLength: 1, maxLength: 80 },
  },
  required: ['problem', 'place', 'computer'],
  additionalProperties: false,
};

const executeResultSchema = {
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
};

// The write. Never a tool: it runs only when the person has decided, with their own token behind it. POB has no way
// to tell a repeated create from a new one, so Clew never repeats it by itself (`manual`).
const createCaseCapability = {
  name: 'pob.createCase',
  kind: 'execute',
  title: 'Skicka felanmälan',
  model: false,
  scope: {},
  description: 'Skapar ett ärende hos IT-supporten med personen som anmälare.',
  execution: { strategy: 'manual' },
  effect: 'pob.createEffect',
  asks: [
    { kind: 'long-text', property: 'problem', label: 'Vad är fel?', required: true },
    { kind: 'text', property: 'place', label: 'Var finns datorn?', required: true },
    { kind: 'text', property: 'computer', label: 'Datornamn (står på klistermärket på datorn)', required: true },
    {
      kind: 'choice',
      property: 'about',
      label: 'Felet gäller',
      required: false,
      options: [
        { value: 'me', label: 'Min dator' },
        { value: 'other', label: 'Någon annans dator' },
      ],
    },
    { kind: 'text', property: 'otherName', label: 'Vem gäller det, om inte dig?', required: false },
  ],
  input: faultInput,
  output: executeResultSchema,
};

// What the write will do, for exactly the input it would get, without writing anything: "Det här händer".
const createEffectCapability = {
  name: 'pob.createEffect',
  kind: 'read',
  title: 'Vad felanmälan gör',
  model: false,
  scope: {},
  description: 'Vad som skapas hos IT-supporten när felanmälan skickas.',
  input: faultInput,
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
 * `audience` is what the person's token is issued for: the identity provider and this connector agree on it, so it is
 * configuration, not a constant. `source` is the system's name as a person reads it; it must differ from every other
 * case system's, since Clew's combined list names the systems that did not answer. `writes` is what the installation
 * has switched on beyond reading: `create` adds the fault report.
 */
export function createManifest({ audience = DEFAULT_AUDIENCE, source = DEFAULT_SOURCE, writes = [] } = {}) {
  return {
    protocol: 3,
    id: CONNECTOR,
    kind: 'passthrough',
    source,
    // No area: "Ärenden" and "Beställningar och felanmälningar" belong to Clew's combined lists, whatever the number
    // of systems.
    areas: [],
    capabilities: [
      errandsCapability,
      errandCapability,
      requestsCapability,
      requestCapability,
      ...(writes.includes('create') ? [reportFaultCapability, createCaseCapability, createEffectCapability] : []),
    ],
    // A request that waits for the person's own answer becomes a card. The scan needs the person's token, so it runs
    // when their session asks for it, never at night (D89 item 5).
    scan: true,
    delegation: { audience },
  };
}

export const manifest = createManifest();
