// The purchasing fixture's contract (D21, D38, D147): purchase requests that wait for the person's approval, in a
// system that takes only tokens its own authorization server issued, so the person links their account once
// (`linkedAccount`). The system it stands for is a municipal purchasing system; no vendor is named (D52). The address
// in `linkedAccount.resource` is the installation's, so the manifest is made from it. connector.mjs holds the handlers.

export const CONNECTOR = 'purchasing';

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
const deduplicated = { strategy: 'deduplicated', retentionSeconds: 86400, lookup: 'purchasing.lookup' };
const everyone = {};
const refs = array({ type: 'string', pattern: '^purchasing:req:' });

const requests = {
  name: 'purchasing.requests',
  kind: 'read',
  title: 'Inköp att godkänna',
  description: 'Inköpsbegäranden som väntar på ditt godkännande i inköpssystemet.',
  model: true,
  scope: everyone,
  input: empty,
  output: object({
    rows: array(
      object({ ref: string, title: string, requester: string, amount: string, dueBy: string, status: string }),
    ),
  }),
  // The view (D38): what waits for the person, as a list.
  view: {
    kind: 'list',
    title: 'title',
    ref: 'ref',
    noun: { one: 'inköp', other: 'inköp' },
    empty: 'Inga inköp väntar på dig.',
    fields: [
      { key: 'title', label: 'Inköp' },
      { key: 'requester', label: 'Beställare' },
      { key: 'amount', label: 'Belopp' },
      { key: 'dueBy', label: 'Senast', format: 'date' },
      { key: 'status', label: 'Status' },
    ],
  },
};

const decide = {
  name: 'purchasing.decide',
  kind: 'execute',
  title: 'Godkänn eller avslå inköp',
  description: 'Godkänner eller avslår inköpsbegäranden i inköpssystemet.',
  model: false,
  scope: everyone,
  execution: deduplicated,
  input: object({ refs, decision: { enum: ['approve', 'reject'] } }),
  output: executeResult,
};

const lookup = {
  name: 'purchasing.lookup',
  kind: 'read',
  title: 'Läs tillbaka en åtgärd',
  description: 'Om en åtgärd med ett givet operations-id finns i inköpssystemets logg, och vad den gav.',
  model: false,
  scope: everyone,
  input: object({ operationId: { type: 'string', minLength: 1, maxLength: 200 } }),
  output: object({ found: boolean, result: executeResult }, ['found']),
};

/** The manifest for a system at `resource`, the address Clew looks for its authorization server from. */
export const manifestFor = ({ resource, scopes = [] }) => ({
  protocol: 1,
  id: CONNECTOR,
  kind: 'passthrough',
  source: 'Inköpssystemet',
  uses: [],
  scan: true,
  linkedAccount: { resource, ...(scopes.length ? { scopes } : {}) },
  areas: [
    {
      id: 'purchases',
      title: 'Inköp',
      icon: 'document',
      roles: ['manager', 'employee'],
      standing: ['purchasing.requests'],
      schedules: [{ label: 'Inköp som väntar på ditt godkännande', when: 'Varje vardag 06:00' }],
    },
  ],
  capabilities: [requests, decide, lookup],
});
