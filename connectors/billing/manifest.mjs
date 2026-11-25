// The billing connector's contract: the billing records of one category in BillingPreprocessor that wait for attest,
// and the decision on them (attest, reject, and back to waiting as the undo). connector.mjs holds the handlers.

export const CONNECTOR = 'billing';
export const AREA = 'invoices';
export const REF_PATTERN = '^billing:[A-Za-z0-9-]{1,64}$';

const string = { type: 'string' };
const number = { type: 'number' };
const integer = { type: 'integer' };
const boolean = { type: 'boolean' };
const object = (properties, required = Object.keys(properties)) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
const array = items => ({ type: 'array', items });
const ref = { type: 'string', pattern: REF_PATTERN };
const refs = array(ref);
const money = { format: 'number', unit: { one: 'kr', other: 'kr' } };

// Everyone in the connector's audience may call it: who may attest is the audience an administrator sets (README.md,
// "Who may attest"), not a role.
const anyone = {};

const records = {
  name: 'billing.records',
  kind: 'read',
  title: 'Fakturor att attestera',
  description: 'Faktureringsunderlag som väntar på attest innan de förs över till ekonomisystemet.',
  // The rows name no person, but a record does: the model is kept out of the whole connector.
  model: false,
  scope: anyone,
  input: object({}),
  output: object({
    rows: array(
      object({
        ref,
        description: string,
        amount: number,
        chef: string,
        customer: string,
        errand: string,
        created: string,
      }),
    ),
  }),
  menu: { label: 'Fakturor att attestera', icon: 'document' },
  view: {
    kind: 'table',
    title: 'description',
    ref: 'ref',
    noun: { one: 'faktura', other: 'fakturor' },
    empty: 'Inga fakturor väntar på attest.',
    open: { capability: 'billing.record', title: 'Faktura', params: { ref: 'ref' } },
    fields: [
      { key: 'description', label: 'Kostnadstyp' },
      { key: 'amount', label: 'Belopp', ...money },
      { key: 'chef', label: 'Chef' },
      { key: 'customer', label: 'Kund' },
      { key: 'errand', label: 'Ärende' },
      { key: 'created', label: 'Registrerad', format: 'date' },
    ],
  },
};

const record = {
  name: 'billing.record',
  kind: 'read',
  title: 'Faktura',
  description: 'Ett faktureringsunderlag med dess rader, läst direkt ur källsystemet.',
  model: false,
  scope: anyone,
  input: object({ ref }),
  output: object({
    title: string,
    description: string,
    amount: number,
    status: string,
    errand: string,
    chef: string,
    customer: string,
    recipient: string,
    customerId: string,
    customerReference: string,
    ourReference: string,
    type: string,
    created: string,
    updated: string,
    transferDate: string,
    approvedBy: string,
    lines: array(object({ text: string, quantity: number, costPerUnit: number, amount: number, account: string })),
  }),
  view: {
    kind: 'record',
    title: 'title',
    fields: [
      { key: 'status', label: 'Status' },
      { key: 'amount', label: 'Belopp', ...money },
      { key: 'errand', label: 'Ärende' },
      { key: 'chef', label: 'Chef' },
      { key: 'customer', label: 'Kund' },
      { key: 'customerId', label: 'Kundnummer' },
      { key: 'recipient', label: 'Mottagare' },
      { key: 'customerReference', label: 'Kundens referens' },
      { key: 'ourReference', label: 'Vår referens' },
      { key: 'type', label: 'Typ' },
      { key: 'created', label: 'Registrerad', format: 'date' },
      { key: 'updated', label: 'Uppdaterad', format: 'date' },
      { key: 'transferDate', label: 'Förs över', format: 'date' },
      { key: 'approvedBy', label: 'Beslutad av' },
    ],
    items: {
      rows: 'lines',
      title: 'text',
      fields: [
        { key: 'text', label: 'Rad' },
        { key: 'quantity', label: 'Antal', format: 'number' },
        { key: 'costPerUnit', label: 'Á-pris', ...money },
        { key: 'amount', label: 'Belopp', ...money },
        { key: 'account', label: 'Kontering' },
      ],
    },
  },
};

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
const deduplicated = { strategy: 'deduplicated', retentionSeconds: 86400, lookup: 'billing.lookup' };

const approve = {
  name: 'billing.approve',
  kind: 'execute',
  title: 'Attestera',
  description: 'Attesterar valda faktureringsunderlag, så att de förs över till ekonomisystemet.',
  model: false,
  scope: anyone,
  execution: deduplicated,
  input: object({ refs }),
  output: executeResult,
};

const reject = {
  name: 'billing.reject',
  kind: 'execute',
  title: 'Avslå',
  description: 'Avslår valda faktureringsunderlag, så att de inte förs över till ekonomisystemet.',
  model: false,
  scope: anyone,
  execution: deduplicated,
  input: object({ refs }),
  output: executeResult,
};

const reopen = {
  name: 'billing.reopen',
  kind: 'execute',
  title: 'Ångra beslut',
  description: 'Lägger tillbaka attesterade eller avslagna underlag som väntande, inom ångerfönstret.',
  model: false,
  scope: anyone,
  execution: deduplicated,
  input: object(
    {
      refs,
      references: {
        type: 'object',
        description: 'Vår referens som varje underlag hade före beslutet, per ref.',
        additionalProperties: { type: 'string', maxLength: 200 },
      },
    },
    ['refs'],
  ),
  output: executeResult,
};

const lookup = {
  name: 'billing.lookup',
  kind: 'read',
  title: 'Läs tillbaka ett beslut',
  description: 'Vad ett beslut med ett givet operations-id gav, läst tillbaka ur källsystemet.',
  model: false,
  scope: anyone,
  input: object({ operationId: { type: 'string', minLength: 1, maxLength: 200 } }),
  output: object({ found: boolean, result: executeResult }, ['found']),
};

// The record as one page, for the review one at a time before attest (D70): an SVG drawn from the record, base64.
const preview = {
  name: 'billing.preview',
  kind: 'read',
  title: 'Visa underlaget',
  description: 'Faktureringsunderlaget som en sida, för granskning innan attest.',
  model: false,
  scope: anyone,
  input: object({ ref }),
  output: object({
    title: string,
    mediaType: { enum: ['image/svg+xml'] },
    data: { type: 'string', pattern: '^[A-Za-z0-9+/]*={0,2}$' },
  }),
};

const open = {
  name: 'billing.open',
  kind: 'read',
  title: 'Öppna ärendet',
  description: 'Länk till ärendet som underlaget kommer från.',
  model: false,
  scope: anyone,
  input: object({ ref }),
  output: object({ url: string }),
};

/** source: the system's name as a person reads it. linked: whether `billing.open` is declared (BILLING_ERRAND_LINK). */
export function createManifest({ source = 'Lön och pension', linked = false } = {}) {
  return {
    protocol: 1,
    id: CONNECTOR,
    kind: 'passthrough',
    source,
    uses: [],
    areas: [
      {
        id: AREA,
        title: 'Fakturor',
        icon: 'document',
        roles: ['manager', 'employee'],
        standing: ['billing.records'],
        schedules: [{ label: 'Fakturor som väntar på attest', when: 'Varje natt och när du öppnar Clew' }],
      },
    ],
    scan: true,
    capabilities: [records, record, preview, approve, reject, reopen, lookup, ...(linked ? [open] : [])],
  };
}

export const manifest = createManifest();
