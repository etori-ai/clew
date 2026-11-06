// The time-reporting fixture's contract (D21, D38, D55): the day's roster, and the follower that marks a day as absence
// when the HR system reports a sick leave. A kind of system, no vendor (D52). connector.mjs holds the handlers.

export const CONNECTOR = 'timesheet';
/** The HR system's fact this connector follows (D55). The kind's name is the contract (D37). */
export const ABSENCE_FACT = 'hr:absence';

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
const DATE = '^\\d{4}-\\d{2}-\\d{2}$';
const markInput = object({
  person: { type: 'string', pattern: '^hr:emp:[0-9]+$' },
  date: { type: 'string', pattern: DATE },
});

const factEnvelope = object({
  fact: object(
    {
      kind: { type: 'string', pattern: '^[a-z][a-z0-9-]*:[a-z][a-zA-Z0-9-]*$', maxLength: 80 },
      ref: { type: 'string', minLength: 1, maxLength: 400 },
      attributes: { type: 'object' },
    },
    ['kind', 'attributes'],
  ),
});
const capabilityName = { type: 'string', pattern: '^[a-z][a-z0-9-]*\\.[a-zA-Z][a-zA-Z0-9]*$', maxLength: 80 };
const swedish = { type: 'string', minLength: 1, maxLength: 200 };
const followResponse = object({
  steps: {
    type: 'array',
    maxItems: 10,
    items: object(
      { kind: { const: 'execute' }, operation: capabilityName, payload: {}, title: swedish, detail: swedish },
      ['kind', 'operation', 'payload', 'title'],
    ),
  },
});
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
const deduplicated = { strategy: 'deduplicated', retentionSeconds: 86400, lookup: 'timesheet.lookup' };
const manager = { roles: ['manager'] };

const today = {
  name: 'timesheet.today',
  kind: 'read',
  title: 'Dagens pass',
  description: 'Dagens schemarader för enheten och vilka som är markerade som frånvaro.',
  model: true,
  scope: manager,
  input: empty,
  output: object({
    date: string,
    rows: array(object({ ref: string, person: string, start: string, end: string, ward: string, absent: boolean })),
  }),
  // The view (D38): the day's shifts as a table; who works and who is away is the person's, so the model reads a summary.
  view: {
    kind: 'table',
    title: 'person',
    ref: 'ref',
    modelReads: 'summary',
    empty: 'Inga schemarader i dag.',
    fields: [
      { key: 'person', label: 'Medarbetare' },
      { key: 'start', label: 'Börjar' },
      { key: 'end', label: 'Slutar' },
      { key: 'ward', label: 'Avdelning' },
      { key: 'absent', label: 'Frånvaro' },
    ],
  },
};

// The follower (D55): one execute step of this connector, computed from the fact alone.
const followAbsence = {
  name: 'timesheet.followAbsence',
  kind: 'propose',
  title: 'Markera frånvaro',
  description: 'Vad tidrapporteringen gör när en medarbetare blir sjuk: markerar dagen som frånvaro.',
  model: false,
  scope: manager,
  follows: [ABSENCE_FACT],
  input: factEnvelope,
  output: followResponse,
};

const markAbsence = {
  name: 'timesheet.markAbsence',
  kind: 'execute',
  title: 'Markera frånvaro',
  description: 'Markerar en dag som frånvaro i tidrapporteringen.',
  model: false,
  scope: manager,
  execution: deduplicated,
  input: markInput,
  output: executeResult,
};

const unmarkAbsence = {
  name: 'timesheet.unmarkAbsence',
  kind: 'execute',
  title: 'Ta bort markeringen',
  description: 'Tar bort en frånvaromarkering inom ångerfönstret.',
  model: false,
  scope: manager,
  execution: deduplicated,
  input: object({ refs: array({ type: 'string', pattern: '^timesheet:absence:' }) }),
  output: executeResult,
};

const lookup = {
  name: 'timesheet.lookup',
  kind: 'read',
  title: 'Läs tillbaka en markering',
  description: 'Om en åtgärd med ett givet operations-id finns i tidrapporteringens logg, och vad den gav.',
  model: false,
  scope: manager,
  input: object({ operationId: { type: 'string', minLength: 1, maxLength: 200 } }),
  output: object({ found: boolean, result: executeResult }, ['found']),
};

export const manifest = {
  protocol: 2,
  id: CONNECTOR,
  kind: 'passthrough',
  source: 'Tidrapporteringen',
  uses: [],
  scan: false,
  areas: [
    {
      id: 'staffing',
      title: 'Bemanning',
      icon: 'clock',
      roles: ['manager'],
      standing: ['timesheet.today'],
      schedules: [{ label: 'Pass som saknar bemanning', when: 'Varje vardag 06:00' }],
    },
  ],
  capabilities: [today, followAbsence, markAbsence, unmarkAbsence, lookup],
};
