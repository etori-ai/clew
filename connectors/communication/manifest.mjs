// The communication fixture's contract (D21, D38): the municipality's notices and the person's read receipts. The system
// it stands for is an internal communication system; no vendor is named (D52). connector.mjs holds the handlers.

export const CONNECTOR = 'communication';

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
const deduplicated = { strategy: 'deduplicated', retentionSeconds: 86400, lookup: 'communication.lookup' };
const everyone = {};

const notices = {
  name: 'communication.notices',
  kind: 'read',
  title: 'Viktigt nu',
  description: 'Meddelanden från kommunen som kräver läskvitto, och om den inloggade kvitterat.',
  model: true,
  scope: everyone,
  input: empty,
  output: object({
    rows: array(object({ ref: string, title: string, requiresReceipt: boolean, acknowledged: boolean })),
  }),
  // The view (D38): the notices as a list that says which still need the person's receipt.
  view: {
    kind: 'list',
    title: 'title',
    ref: 'ref',
    empty: 'Inga meddelanden just nu.',
    fields: [
      { key: 'title', label: 'Titel' },
      { key: 'requiresReceipt', label: 'Kräver läskvitto' },
      { key: 'acknowledged', label: 'Läst' },
    ],
  },
};

const acknowledge = {
  name: 'communication.acknowledge',
  kind: 'execute',
  title: 'Jag har läst',
  description: 'Kvitterar ett meddelande.',
  model: false,
  scope: everyone,
  execution: deduplicated,
  input: object({ refs: array({ type: 'string', pattern: '^communication:notice:' }) }),
  output: executeResult,
};

const lookup = {
  name: 'communication.lookup',
  kind: 'read',
  title: 'Läs tillbaka en åtgärd',
  description: 'Om ett läskvitto med ett givet operations-id finns registrerat, och vad det gav.',
  model: false,
  scope: everyone,
  input: object({ operationId: { type: 'string', minLength: 1, maxLength: 200 } }),
  output: object({ found: boolean, result: executeResult }, ['found']),
};

export const manifest = {
  protocol: 2,
  id: CONNECTOR,
  kind: 'passthrough',
  source: 'Kommunikation',
  uses: [],
  scan: true,
  areas: [
    {
      id: 'important-now',
      title: 'Viktigt nu',
      icon: 'bell',
      roles: ['manager', 'employee'],
      standing: ['communication.notices'],
      schedules: [{ label: 'Nya meddelanden som kräver läskvitto', when: 'Direkt när de publiceras' }],
    },
  ],
  capabilities: [notices, acknowledge, lookup],
};
