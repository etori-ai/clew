// The finance fixture's contract (D21, D38): invoices to attest and the budget position of a manager's cost centre. The
// system it stands for is a municipal economy system; no vendor is named (D52). connector.mjs holds the handlers.

export const CONNECTOR = 'finance';

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
const empty = object({});
const refs = object({ refs: array({ type: 'string', pattern: '^finance:inv:' }) });

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
const deduplicated = { strategy: 'deduplicated', retentionSeconds: 86400, lookup: 'finance.lookup' };
const manager = { roles: ['manager'] };

const invoices = {
  name: 'finance.invoices',
  kind: 'read',
  title: 'Fakturor att attestera',
  description: 'Fakturor som väntar på attest för chefens kostnadsställe.',
  model: true,
  scope: manager,
  input: empty,
  output: object({
    rows: array(object({ ref: string, supplier: string, amount: number, due: string, order: string, account: string })),
  }),
  // The view (D38): the invoices as a table, drawn by Clew in an answer, in the panel or as a page; the model reads the rows, which hold no personal data.
  view: {
    kind: 'table',
    title: 'supplier',
    ref: 'ref',
    empty: 'Inga fakturor väntar på attest.',
    fields: [
      { key: 'supplier', label: 'Leverantör' },
      { key: 'amount', label: 'Belopp', format: 'number' },
      { key: 'due', label: 'Förfaller', format: 'date' },
      { key: 'order', label: 'Beställning' },
      { key: 'account', label: 'Konto' },
    ],
  },
};

const budget = {
  name: 'finance.budget',
  kind: 'read',
  title: 'Budget mot prognos',
  description: 'Budgetavvikelse och prognos för kostnadsstället, med den största drivaren.',
  model: true,
  scope: manager,
  input: empty,
  output: object({ label: string, deviationPct: number, driver: string, budget: number, forecast: number }),
  // The view (D38): the budget position as a detail, so a question about the budget is answered with the figures and not a sentence about them.
  view: {
    kind: 'detail',
    title: 'label',
    fields: [
      { key: 'deviationPct', label: 'Avvikelse i procent', format: 'number' },
      { key: 'forecast', label: 'Prognos', format: 'number' },
      { key: 'budget', label: 'Budget', format: 'number' },
      { key: 'driver', label: 'Orsak' },
    ],
  },
};

const approve = {
  name: 'finance.approve',
  kind: 'execute',
  title: 'Attestera',
  description: 'Attesterar valda fakturor i ekonomisystemet.',
  model: false,
  scope: manager,
  execution: deduplicated,
  input: refs,
  output: executeResult,
};

const unapprove = {
  name: 'finance.unapprove',
  kind: 'execute',
  title: 'Ångra attest',
  description: 'Tar tillbaka en attest inom ångerfönstret.',
  model: false,
  scope: manager,
  execution: deduplicated,
  input: refs,
  output: executeResult,
};

const open = {
  name: 'finance.open',
  kind: 'read',
  title: 'Öppna i ekonomisystemet',
  description: 'Länk till fakturan i ekonomisystemet.',
  model: false,
  scope: manager,
  input: object({ ref: { type: 'string', pattern: '^finance:inv:' } }),
  output: object({ url: string }),
};

const lookup = {
  name: 'finance.lookup',
  kind: 'read',
  title: 'Läs tillbaka en åtgärd',
  description: 'Om en åtgärd med ett givet operations-id finns i ekonomisystemets logg, och vad den gav.',
  model: false,
  scope: manager,
  input: object({ operationId: { type: 'string', minLength: 1, maxLength: 200 } }),
  output: object({ found: boolean, result: executeResult }, ['found']),
};

export const manifest = {
  protocol: 2,
  id: CONNECTOR,
  kind: 'passthrough',
  source: 'Ekonomisystemet',
  uses: [],
  scan: true,
  areas: [
    {
      id: 'budget',
      title: 'Budget',
      icon: 'chart',
      roles: ['manager'],
      standing: ['finance.invoices', 'finance.budget'],
      schedules: [
        { label: 'Fakturor som förfaller inom en vecka', when: 'Varje vardag 06:00' },
        { label: 'Prognosavvikelse', when: 'Månadens första måndag' },
      ],
      figure: true,
    },
  ],
  capabilities: [invoices, budget, approve, unapprove, open, lookup],
};
