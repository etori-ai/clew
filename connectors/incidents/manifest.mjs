// The incidents fixture's contract (D21, D38): deviations and incidents in a unit, and a report filed by anyone. The
// system it stands for is a municipal deviation system; no vendor is named (D52). connector.mjs holds the handlers.

export const CONNECTOR = 'incidents';

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
const deduplicated = { strategy: 'deduplicated', retentionSeconds: 86400, lookup: 'incidents.lookup' };
const everyone = {};

const deviations = {
  name: 'incidents.deviations',
  kind: 'read',
  title: 'Avvikelser och tillbud',
  description: 'Öppna avvikelser och tillbud i enheten, med vad de väntar på.',
  model: true,
  scope: everyone,
  input: empty,
  output: object({
    rows: array(
      object({ ref: string, title: string, state: string, waitingOn: string, dueBy: string }, [
        'ref',
        'title',
        'state',
      ]),
    ),
  }),
  // The view (D38): the open deviations as a list with what each waits on; the state is drawn in Swedish by Clew's value rules.
  view: {
    kind: 'list',
    title: 'title',
    ref: 'ref',
    noun: { one: 'avvikelse', other: 'avvikelser' },
    empty: 'Inga öppna avvikelser.',
    fields: [
      { key: 'title', label: 'Titel' },
      { key: 'state', label: 'Status' },
      { key: 'waitingOn', label: 'Väntar på' },
      { key: 'dueBy', label: 'Senast', format: 'date' },
    ],
  },
};

const report = {
  name: 'incidents.report',
  kind: 'execute',
  title: 'Rapportera avvikelse',
  description: 'Skapar en avvikelserapport i avvikelsesystemet.',
  model: false,
  scope: everyone,
  execution: deduplicated,
  input: object({
    title: { type: 'string', minLength: 3, maxLength: 120 },
    text: { type: 'string', minLength: 3, maxLength: 2000 },
  }),
  output: executeResult,
};

const withdraw = {
  name: 'incidents.withdraw',
  kind: 'execute',
  title: 'Ta tillbaka',
  description: 'Tar tillbaka en avvikelserapport inom ångerfönstret.',
  model: false,
  scope: everyone,
  execution: deduplicated,
  input: object({ refs: array({ type: 'string', pattern: '^incidents:dev:' }) }),
  output: executeResult,
};

const lookup = {
  name: 'incidents.lookup',
  kind: 'read',
  title: 'Läs tillbaka en åtgärd',
  description: 'Om en åtgärd med ett givet operations-id finns i avvikelsesystemets logg, och vad den gav.',
  model: false,
  scope: everyone,
  input: object({ operationId: { type: 'string', minLength: 1, maxLength: 200 } }),
  output: object({ found: boolean, result: executeResult }, ['found']),
};

export const manifest = {
  protocol: 2,
  id: CONNECTOR,
  kind: 'passthrough',
  source: 'Avvikelsesystemet',
  uses: [],
  scan: true,
  areas: [
    {
      id: 'work-environment',
      title: 'Arbetsmiljö',
      icon: 'document',
      roles: ['manager'],
      standing: ['incidents.deviations', 'incidents.report'],
      schedules: [{ label: 'Avvikelser som väntat mer än fem dagar', when: 'Varje vardag 06:00' }],
      figure: true,
    },
  ],
  capabilities: [deviations, report, withdraw, lookup],
};
