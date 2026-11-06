// The payroll fixture's contract (D21, D38, D55): what has reached payroll from the HR system, the read a watch repeats,
// and the follower that proposes that watch. Clew never writes here. A kind of system, no vendor (D52).

export const CONNECTOR = 'payroll';
/** The HR system's fact this connector follows (D55). */
export const ABSENCE_FACT = 'hr:absence';

const string = { type: 'string' };
const integer = { type: 'integer' };
const object = (properties, required = Object.keys(properties)) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
const array = items => ({ type: 'array', items });
const empty = object({});
const DATE = '^\\d{4}-\\d{2}-\\d{2}$';
const absenceQuery = object({
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
      {
        kind: { const: 'watch' },
        operation: capabilityName,
        input: {},
        expect: object({ path: array({ type: 'string', minLength: 1, maxLength: 80 }), equals: {} }),
        within: { type: 'string', pattern: '^P(?!$)(\\d+D)?(T(?=\\d)(\\d+H)?(\\d+M)?)?$' },
        title: swedish,
        detail: swedish,
      },
      ['kind', 'operation', 'input', 'expect', 'within', 'title'],
    ),
  },
});
const manager = { roles: ['manager'] };

const absences = {
  name: 'payroll.absences',
  kind: 'read',
  title: 'Frånvaro som nått lönesystemet',
  description: 'Sjukanmälningar som lönesystemet har läst in från personalsystemet, med dag och omfattning.',
  model: true,
  scope: manager,
  input: empty,
  output: object({
    rows: array(object({ ref: string, person: string, from: string, to: string, extent: integer, importedAt: string })),
  }),
  // The view (D38): what payroll holds, as a table; who is sick is the person's, so the model reads a summary.
  view: {
    kind: 'table',
    title: 'person',
    ref: 'ref',
    modelReads: 'summary',
    empty: 'Ingen sjukanmälan har nått lönesystemet.',
    fields: [
      { key: 'person', label: 'Medarbetare' },
      { key: 'from', label: 'Från', format: 'date' },
      { key: 'to', label: 'Till', format: 'date' },
      { key: 'extent', label: 'Omfattning, procent', format: 'number' },
      { key: 'importedAt', label: 'Inläst', format: 'date' },
    ],
  },
};

// The read a watch step repeats (D55 item 5): has the report for this person and day reached payroll?
const absenceStatus = {
  name: 'payroll.absenceStatus',
  kind: 'read',
  title: 'Har sjukanmälan nått lönesystemet?',
  description: 'Om lönesystemet har läst in en sjukanmälan för en medarbetare och en dag: registered eller pending.',
  model: false,
  scope: manager,
  input: absenceQuery,
  output: object({ status: { enum: ['registered', 'pending'] }, person: string, date: string, checkedAt: string }),
};

// The follower (D55): one watch step, a read of this connector repeated inside a window; payroll is never written by Clew.
const followAbsence = {
  name: 'payroll.followAbsence',
  kind: 'propose',
  title: 'Bevaka i lönesystemet',
  description:
    'Vad lönesystemet gör när en medarbetare blir sjuk: ingenting självt, så Clew bevakar att sjukanmälan kommer fram.',
  model: false,
  scope: manager,
  follows: [ABSENCE_FACT],
  input: factEnvelope,
  output: followResponse,
};

export const manifest = {
  protocol: 2,
  id: CONNECTOR,
  kind: 'passthrough',
  source: 'Lönesystemet',
  uses: [],
  scan: false,
  areas: [
    {
      id: 'payroll',
      title: 'Lön',
      icon: 'document',
      roles: ['manager'],
      standing: ['payroll.absences'],
      schedules: [{ label: 'Inläsning från personalsystemet', when: 'Varje natt' }],
    },
  ],
  capabilities: [absences, absenceStatus, followAbsence],
};
