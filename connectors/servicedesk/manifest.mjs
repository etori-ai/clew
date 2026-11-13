// The service-desk fixture's contract (D21, D38, D123): what the asking person ordered or reported and waits for, one
// such request with its free text, an order placed for a person from the desk's catalogue with what it will do, and the
// equipment the desk has registered to a person. The system it stands for is a municipality's IT service desk; no
// vendor is named (D52). connector.mjs holds the handlers, desk.mjs the source port and the one mapping to these rows.

export const CONNECTOR = 'servicedesk';
export const SOURCE = 'IT-servicedesken';

const string = { type: 'string' };
const integer = { type: 'integer' };
const boolean = { type: 'boolean' };
const object = (properties, required = Object.keys(properties)) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
const array = items => ({ type: 'array', items });
const empty = object({});
const calendarDay = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', maxLength: 10 };
const instant = { type: 'string', format: 'date-time', maxLength: 40 };
/** A person's user name as the directory spells it (D97): the key Clew asks with. */
const userName = { type: 'string', minLength: 1, maxLength: 256 };

/** The most keys one call about people takes (D97). */
export const KEYS_MAX = 200;
/** Who a read or an order about a person answers for (D117): the caller, and a manager's direct reports. Never a colleague. */
export const ADMITS = ['self', 'managed'];

/** `request:servicedesk:<the desk's number>` (D123). Clew treats it as opaque. */
export const requestRefPattern = '^request:servicedesk:SD-[0-9]{4,12}$';
/** Where a request stands, seen from the person who waits (D123): whose move it is. */
export const STATES = ['waiting-on-me', 'new', 'active', 'closed'];

/**
 * What can be ordered from the desk's catalogue through Clew, in the person's words. The value is the order's input; the
 * desk's own category, the group that handles it and how long it takes are the desk's (fixture.mjs).
 */
export const CATALOGUE = [
  { value: 'laptop', label: 'Bärbar dator' },
  { value: 'phone', label: 'Mobiltelefon' },
  { value: 'access-card', label: 'Passerkort' },
  { value: 'system-access', label: 'Behörighet till ett system' },
];

/** The protocol's RequestRow (D123), written out: a connector does not import the repository. */
const requestRow = {
  ref: { type: 'string', minLength: 1, maxLength: 200, pattern: requestRefPattern },
  label: { type: 'string', minLength: 1, maxLength: 200 },
  state: { type: 'string', enum: STATES },
  status: { type: 'string', minLength: 1, maxLength: 80 },
  since: instant,
  expectedAt: { anyOf: [calendarDay, instant] },
  link: { type: 'string', maxLength: 1000, pattern: '^https?://[^\\s]+$' },
};
const requiredRow = ['ref', 'label', 'state', 'status', 'since'];
const text = maxLength => ({ type: 'string', minLength: 1, maxLength });

/** The shared state as a badge, in Clew's words for it: only what waits on the person has a tone (D123 item 6). */
const stateField = {
  key: 'state',
  label: 'Läge',
  format: 'status',
  tones: { 'waiting-on-me': 'warn', new: 'none', active: 'none', closed: 'none' },
};
/** What a row opens: one request, in the panel. */
export const REQUEST_TITLE = 'Beställning eller felanmälan';

// The requests profile (D123): what the person ordered or reported, by number and type only. Clew asks every such read
// in the person's scope as `clew.requests` and shows that list; this one is never offered to the model beside it.
const requests = {
  name: 'servicedesk.requests',
  kind: 'read',
  title: 'Mina beställningar i IT-servicedesken',
  description:
    'Det personen har beställt eller felanmält i IT-servicedesken: nummer, typ, status och när det beräknas klart. Aldrig rubrik, beskrivning eller namn.',
  model: true,
  scope: {},
  input: empty,
  output: object({ rows: { type: 'array', maxItems: 500, items: object(requestRow, requiredRow) } }),
  view: {
    kind: 'list',
    title: 'label',
    ref: 'ref',
    modelReads: 'summary',
    noun: { one: 'beställning eller felanmälan', other: 'beställningar och felanmälningar' },
    empty: 'Du har inga beställningar eller felanmälningar i IT-servicedesken.',
    open: { capability: 'servicedesk.request', title: REQUEST_TITLE, params: { ref: 'ref' } },
    fields: [
      { key: 'label', label: 'Beställning eller felanmälan' },
      stateField,
      { key: 'status', label: 'Status' },
      { key: 'expectedAt', label: 'Beräknas klar', format: 'date' },
      { key: 'since', label: 'Registrerad', format: 'date' },
    ],
  },
};

// One request with its free text, read live for the panel: the person's own only. Never a tool: the text is the
// person's and the desk's.
const request = {
  name: 'servicedesk.request',
  kind: 'read',
  title: REQUEST_TITLE,
  description:
    'En beställning eller felanmälan som personen själv har gjort, med rubrik, beskrivning och det servicedesken senast skrev.',
  model: false,
  scope: {},
  input: object({ ref: { type: 'string', pattern: requestRefPattern, maxLength: 200 } }),
  output: object(
    {
      ...requestRow,
      group: text(120),
      title: text(200),
      description: text(4000),
      latest: text(1000),
    },
    [...requiredRow, 'group', 'title'],
  ),
  view: {
    kind: 'detail',
    title: 'label',
    fields: [
      stateField,
      { key: 'status', label: 'Status' },
      { key: 'expectedAt', label: 'Beräknas klar', format: 'date' },
      { key: 'since', label: 'Registrerad', format: 'date' },
      { key: 'group', label: 'Handläggs av' },
      { key: 'title', label: 'Rubrik' },
      { key: 'description', label: 'Beskrivning' },
      { key: 'latest', label: 'Senast från servicedesken' },
      { key: 'link', label: 'Öppna i IT-servicedesken', format: 'link' },
    ],
  },
};

/** What every execute answers (the protocol's ExecuteResult), read back row by row. */
export const executeResult = object(
  {
    headline: string,
    rows: array(
      object({
        ref: string,
        label: string,
        outcome: { enum: ['done', 'failed', 'unknown', 'skipped'] },
        detail: string,
      }),
    ),
    undoCapability: string,
    undoMinutes: integer,
    undoInput: {},
  },
  ['headline', 'rows'],
);
/** What an `effect` read answers (D112, the protocol's EffectOutput): what a write will do where, without writing. */
const effectOutput = object(
  {
    rows: {
      type: 'array',
      minItems: 1,
      maxItems: 10,
      items: object(
        {
          label: { type: 'string', minLength: 1, maxLength: 200 },
          detail: { type: 'string', maxLength: 400 },
          source: { type: 'string', minLength: 1, maxLength: 80 },
        },
        ['label'],
      ),
    },
    undoMinutes: { type: 'integer', minimum: 1, maximum: 1440 },
  },
  ['rows'],
);
/** Every write is deduplicated by Clew's approved operation id and read back through `servicedesk.lookup` (D45). */
const deduplicated = { strategy: 'deduplicated', retentionSeconds: 86400, lookup: 'servicedesk.lookup' };

/** An order's input: the person it is for by user name, what from the catalogue, and an optional message to the desk. */
const orderInput = object(
  {
    person: { ...userName, description: 'Användarnamnet på den som beställningen gäller.' },
    item: { type: 'string', enum: CATALOGUE.map(c => c.value), description: 'Vad som beställs ur katalogen.' },
    note: { type: 'string', maxLength: 1000, description: 'Ett meddelande till servicedesken.' },
  },
  ['person', 'item'],
);

// An action about a person (D97): "Beställ från IT-servicedesken" in the person's menu, for the person themself or, for
// a manager, someone who reports to them (D117). The desk records the order as the caller's, for the person by key.
const order = {
  name: 'servicedesk.order',
  kind: 'execute',
  title: 'Beställ från IT-servicedesken',
  description:
    'Lägger en beställning ur IT-servicedeskens katalog åt dig själv eller åt en medarbetare du är chef för. Beställningen blir din och följs tills servicedesken har levererat.',
  model: false,
  scope: {},
  about: { entity: 'person', param: 'person' },
  person: { admits: ADMITS },
  execution: deduplicated,
  input: orderInput,
  output: executeResult,
  // The dialog (D112): what to order, and a message the person may add; then what the desk will do.
  asks: [
    { kind: 'choice', property: 'item', label: 'Vad', required: true, options: CATALOGUE },
    { kind: 'long-text', property: 'note', label: 'Meddelande till servicedesken', required: false },
  ],
  effect: 'servicedesk.orderEffect',
};

// What servicedesk.order will do with the same input, checked as the order checks it and written nowhere (D112). It
// names what the order names and admits what the order admits, without saying so (D117).
const orderEffect = {
  name: 'servicedesk.orderEffect',
  kind: 'read',
  title: 'Det här händer när beställningen läggs',
  description: 'Vad en beställning gör i IT-servicedesken, utan att något skrivs.',
  model: false,
  scope: {},
  input: orderInput,
  output: effectOutput,
};

const lookup = {
  name: 'servicedesk.lookup',
  kind: 'read',
  title: 'Läs tillbaka en åtgärd',
  description: 'Om en åtgärd med ett givet operations-id finns i IT-servicedeskens logg, och vad den gav.',
  model: false,
  scope: {},
  input: object({ operationId: { type: 'string', minLength: 1, maxLength: 200 } }),
  output: object({ found: boolean, result: executeResult }, ['found']),
};

const devices = { one: 'enhet', other: 'enheter' };
// About a person (D97): a section on the opened person, one row per key the desk knows, the count of what is registered
// to them and of what is ordered for them and not yet delivered; the row opens the equipment itself. Read about oneself,
// every such order counts; read by anyone else (a manager), only the orders someone else placed on the person's behalf,
// never what the person ordered for themself.
const person = {
  name: 'servicedesk.person',
  kind: 'read',
  title: 'IT-utrustning',
  description:
    'Enheter som IT-servicedesken har registrerade på personen, och beställningar till personen som inte är levererade. Om någon annan räknas bara det andra har beställt åt personen.',
  model: false,
  scope: {},
  about: { entity: 'person' },
  person: { admits: ADMITS },
  input: object({ keys: { type: 'array', items: userName, maxItems: KEYS_MAX } }),
  output: object({
    rows: {
      type: 'array',
      maxItems: KEYS_MAX,
      items: object(
        { key: userName, devices: { type: 'integer', minimum: 0 }, ordered: { type: 'integer', minimum: 1 } },
        ['key', 'devices'],
      ),
    },
  }),
  view: {
    kind: 'list',
    title: 'devices',
    empty: 'IT-servicedesken har inga uppgifter om dem.',
    fields: [
      { key: 'devices', label: 'Registrerat', format: 'number', unit: devices },
      {
        key: 'ordered',
        label: 'Beställt, inte levererat',
        format: 'number',
        unit: { one: 'beställning', other: 'beställningar' },
      },
    ],
    open: { capability: 'servicedesk.equipment', title: 'IT-utrustning', params: { person: 'key' } },
  },
};

// One person's equipment as the desk has it registered: what it is, the model, its inventory number and since when it is
// the person's. Opened from the section's row with the person's key.
const equipment = {
  name: 'servicedesk.equipment',
  kind: 'read',
  title: 'IT-utrustning',
  description:
    'Utrustningen IT-servicedesken har registrerad på en person: typ, modell, inventarienummer och sedan när.',
  model: false,
  scope: {},
  person: { param: 'person', admits: ADMITS },
  input: object({ person: userName }),
  output: object({
    rows: {
      type: 'array',
      maxItems: 200,
      items: object({
        ref: { type: 'string', maxLength: 200 },
        kind: text(80),
        model: text(120),
        inventoryNumber: text(40),
        since: calendarDay,
      }),
    },
  }),
  view: {
    kind: 'list',
    title: 'kind',
    ref: 'ref',
    noun: devices,
    empty: 'Ingen utrustning är registrerad på personen.',
    fields: [
      { key: 'kind', label: 'Typ' },
      { key: 'model', label: 'Modell' },
      { key: 'inventoryNumber', label: 'Inventarienummer' },
      { key: 'since', label: 'Registrerad', format: 'date' },
    ],
  },
};

export const manifest = {
  protocol: 3,
  id: CONNECTOR,
  kind: 'passthrough',
  source: SOURCE,
  uses: [],
  scan: true,
  areas: [
    {
      id: 'it-service',
      title: 'IT-service',
      icon: 'clock',
      roles: ['manager', 'employee'],
      standing: ['servicedesk.requests'],
      schedules: [{ label: 'Beställningar och felanmälningar som inte är klara', when: 'Varje vardag 06:00' }],
    },
  ],
  capabilities: [requests, request, order, orderEffect, lookup, person, equipment],
};
