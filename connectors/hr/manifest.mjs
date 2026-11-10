// The HR fixture's contract: what Clew reads to discover its capabilities, draw their views and assemble jobs from its
// facts (D21, D38, D55). The system it stands for is a municipal HR and scheduling system; no vendor is named (D52).
// connector.mjs holds the handlers and the HTTP boundary; nothing here is code Clew runs.

export const CONNECTOR = 'hr';
/** The fact `hr:absence` (D55): what every follower receives when a sick report is made or found. The name is the contract (D37). */
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
const refs = object({ refs: array({ type: 'string', pattern: '^hr:' }) });
const DATE = '^\\d{4}-\\d{2}-\\d{2}$';

/** The attributes of `hr:absence`: the JSON Schema followers are promised. */
export const AbsenceAttributes = object(
  {
    person: { type: 'string', pattern: '^hr:emp:[0-9]+$', description: 'Medarbetarens ref i personalsystemet.' },
    from: { type: 'string', pattern: DATE, description: 'Första frånvarodagen.' },
    to: { type: 'string', pattern: DATE, description: 'Sista frånvarodagen; samma som from när den saknas.' },
    extent: { type: 'integer', minimum: 25, maximum: 100, description: 'Omfattning i procent; 100 när den saknas.' },
  },
  ['person', 'from'],
);

/** The protocol's FactEnvelope: the input of every `follows` capability. */
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
/** The protocol's FollowResponse: the steps a follower proposes, each naming this connector's own capabilities. */
const capabilityName = { type: 'string', pattern: '^[a-z][a-z0-9-]*\\.[a-zA-Z][a-zA-Z0-9]*$', maxLength: 80 };
const swedish = { type: 'string', minLength: 1, maxLength: 200 };
const followResponse = object({
  steps: {
    type: 'array',
    maxItems: 10,
    items: {
      oneOf: [
        object(
          { kind: { const: 'execute' }, operation: capabilityName, payload: {}, title: swedish, detail: swedish },
          ['kind', 'operation', 'payload', 'title'],
        ),
        object(
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
      ],
    },
  },
});

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
/**
 * What an action about a person answers when it is a propose (D97): the protocol's ThreadDraft, the card the manager
 * reads and decides on. A row may name the person it is about by key (`subject`), never by more.
 */
const cardItem = object(
  {
    ref: string,
    label: string,
    detail: string,
    selectable: boolean,
    selected: boolean,
    subject: object({ entity: { const: 'person' }, key: { type: 'string', minLength: 1, maxLength: 256 } }),
  },
  ['ref', 'label', 'detail', 'selectable', 'selected'],
);
const cardAction = object(
  {
    id: string,
    label: string,
    capability: capabilityName,
    kind: { enum: ['read', 'propose', 'execute'] },
    role: { enum: ['primary', 'secondary', 'overflow'] },
    target: { enum: ['panel', 'link'] },
    input: { type: 'object' },
  },
  ['id', 'label', 'capability', 'kind', 'role'],
);
const threadDraft = object(
  {
    topic: string,
    area: string,
    title: string,
    summary: string,
    reason: string,
    items: array(cardItem),
    actions: array(cardAction),
  },
  ['topic', 'area', 'title', 'summary', 'reason', 'items', 'actions'],
);
/** Every write is deduplicated by Clew's approved operation id and read back through `hr.lookup` (D45). */
const deduplicated = { strategy: 'deduplicated', retentionSeconds: 86400, lookup: 'hr.lookup' };
const manager = { roles: ['manager'] };
const employee = { roles: ['employee'] };
const everyone = {};

const whoIsOn = {
  name: 'hr.whoIsOn',
  kind: 'read',
  title: 'Vem är på plats i dag?',
  description: 'Vilka i enheten som arbetar i dag enligt schemat, och vilka som är frånvarande.',
  model: true,
  scope: everyone,
  input: empty,
  output: object({ date: string, onDuty: array(string), absent: array(object({ name: string, kind: string })) }),
};

const absenceOverview = {
  name: 'hr.absenceOverview',
  kind: 'read',
  title: 'Frånvaro per person',
  description: 'Frånvarodagar per medarbetare de senaste sex månaderna, uppdelat på typ. Bara för medarbetarens chef.',
  model: true,
  scope: manager,
  input: empty,
  output: object({
    rows: array(object({ ref: string, name: string, short: integer, vab: integer, long: integer, periods: integer })),
  }),
  // The view (D38): absence per person as a table whose row opens the person's pattern. Health data: the model is handed only that the rows are shown.
  view: {
    kind: 'table',
    title: 'name',
    ref: 'ref',
    modelReads: 'summary',
    noun: { one: 'medarbetare', other: 'medarbetare' },
    empty: 'Ingen frånvaro de senaste sex månaderna.',
    open: { capability: 'hr.absencePattern', title: 'Mönster', params: { ref: 'ref' } },
    fields: [
      { key: 'name', label: 'Namn' },
      { key: 'short', label: 'Korttidsfrånvaro, dagar', format: 'number' },
      { key: 'vab', label: 'Vab, dagar', format: 'number' },
      { key: 'long', label: 'Långtidsfrånvaro, dagar', format: 'number' },
      { key: 'periods', label: 'Perioder', format: 'number' },
    ],
  },
};

const absencePattern = {
  name: 'hr.absencePattern',
  kind: 'read',
  title: 'Se mönstret i personalsystemet',
  description: 'Frånvaromönster för en medarbetare, för chefen.',
  model: false,
  scope: manager,
  input: object({ ref: { type: 'string', pattern: '^hr:emp:[0-9]+$' } }),
  output: object({ name: string, periods: array(object({ from: string, to: string, kind: string })), rule: string }),
  view: {
    kind: 'detail',
    title: 'name',
    modelReads: 'summary',
    fields: [
      { key: 'periods', label: 'Perioder' },
      { key: 'rule', label: 'Regel' },
    ],
  },
};

const bookTalk = {
  name: 'hr.bookTalk',
  kind: 'execute',
  title: 'Boka samtalet',
  description: 'Registrerar ett omtankesamtal i personalsystemet.',
  model: false,
  scope: manager,
  execution: deduplicated,
  input: object({ refs: array({ type: 'string', pattern: '^hr:emp:' }), when: string }, ['refs']),
  output: executeResult,
};

const unbookTalk = {
  name: 'hr.unbookTalk',
  kind: 'execute',
  title: 'Ångra bokningen',
  description: 'Tar bort ett registrerat samtal inom ångerfönstret.',
  model: false,
  scope: manager,
  execution: deduplicated,
  input: refs,
  output: executeResult,
};

const leaveRequests = {
  name: 'hr.leaveRequests',
  kind: 'read',
  title: 'Ledighetsansökningar',
  description: 'Öppna ledighetsansökningar som väntar på chefens beslut.',
  model: true,
  scope: manager,
  input: empty,
  output: object({
    rows: array(
      object({ ref: string, name: string, from: string, to: string, days: integer, type: string, clash: boolean }),
    ),
  }),
  // The view (D38): the open requests as a table; who asks for leave when is the person's, so the model reads a summary.
  view: {
    kind: 'table',
    title: 'name',
    ref: 'ref',
    modelReads: 'summary',
    noun: { one: 'ansökan', other: 'ansökningar' },
    empty: 'Inga ledighetsansökningar väntar på beslut.',
    fields: [
      { key: 'name', label: 'Namn' },
      { key: 'from', label: 'Från', format: 'date' },
      { key: 'to', label: 'Till', format: 'date' },
      { key: 'days', label: 'Dagar', format: 'number', unit: { one: 'dag', other: 'dagar' } },
      { key: 'type', label: 'Typ' },
      { key: 'clash', label: 'Krock' },
    ],
  },
};

const decideLeave = {
  name: 'hr.decideLeave',
  kind: 'execute',
  title: 'Godkänn',
  description: 'Beslutar en ledighetsansökan i personalsystemet.',
  model: false,
  scope: manager,
  execution: deduplicated,
  input: object(
    {
      refs: array({ type: 'string', pattern: '^hr:leave:' }),
      decision: { enum: ['approve', 'reject'] },
      comment: { type: 'string', maxLength: 400 },
    },
    ['refs', 'decision'],
  ),
  output: executeResult,
};

const undecideLeave = {
  name: 'hr.undecideLeave',
  kind: 'execute',
  title: 'Ångra beslutet',
  description: 'Återställer en ledighetsansökan till väntande inom ångerfönstret.',
  model: false,
  scope: manager,
  execution: deduplicated,
  input: refs,
  output: executeResult,
};

// The follower of its own fact (D55): when the sick report already exists in the HR system (the employee made it) there is nothing to write; otherwise the job registers it.
const proposeAbsence = {
  name: 'hr.proposeAbsence',
  kind: 'propose',
  title: 'Sjukanmälan',
  description:
    'Vad personalsystemet gör när en medarbetare blir sjuk: registrerar sjukanmälan, om den inte redan finns där.',
  model: false,
  scope: manager,
  follows: [ABSENCE_FACT],
  creates: ABSENCE_FACT,
  input: factEnvelope,
  output: followResponse,
};

const reportAbsence = {
  name: 'hr.reportAbsence',
  kind: 'execute',
  title: 'Registrera sjukanmälan',
  description: 'Registrerar en sjukanmälan i personalsystemet.',
  model: false,
  scope: manager,
  execution: deduplicated,
  input: AbsenceAttributes,
  output: executeResult,
};

// An action about a person (D97): "Registrera frånvaro" in the manager's menu on a person. It writes nothing. It finds the
// employee by user name as hr.person does and prepares the sick report hr.reportAbsence registers after the manager's
// decision on the card: from today unless `from` says otherwise, one day, full time. It declares no `creates`: the report
// is one write in this system, and a job that tells the other systems (the follower's path above) is started by the fact.
const prepareAbsence = {
  name: 'hr.prepareAbsence',
  kind: 'propose',
  title: 'Registrera frånvaro',
  description:
    'Förbereder en sjukanmälan för en medarbetare i chefens enhet, från i dag och en dag, som chefen läser och beslutar om på ett kort.',
  model: false,
  scope: manager,
  about: { entity: 'person', param: 'person' },
  input: object(
    {
      person: { type: 'string', minLength: 1, maxLength: 256, description: 'Medarbetarens användarnamn i katalogen.' },
      from: { type: 'string', pattern: DATE, description: 'Första frånvarodagen; i dag när den saknas.' },
    },
    ['person'],
  ),
  output: threadDraft,
};

const withdrawAbsence = {
  name: 'hr.withdrawAbsence',
  kind: 'execute',
  title: 'Ta bort sjukanmälan',
  description: 'Tar bort en sjukanmälan som registrerades av misstag, inom ångerfönstret.',
  model: false,
  scope: manager,
  execution: deduplicated,
  input: refs,
  output: executeResult,
};

const myShift = {
  name: 'hr.myShift',
  kind: 'read',
  title: 'Mitt pass',
  description: 'Dagens och morgondagens pass för den inloggade, och vilka kollegor som jobbar.',
  model: true,
  scope: employee,
  input: empty,
  output: object({
    today: {
      oneOf: [object({ start: string, end: string, ward: string, colleagues: array(string) }), { type: 'null' }],
    },
  }),
};

const myBalance = {
  name: 'hr.myBalance',
  kind: 'read',
  title: 'Mitt saldo',
  description: 'Semesterdagar kvar att ta ut i år.',
  model: true,
  scope: employee,
  input: empty,
  output: object({ vacationDaysLeft: integer, mustUseBy: string }),
};

const renewDelegation = {
  name: 'hr.renewDelegation',
  kind: 'execute',
  title: 'Boka förnyelse',
  description: 'Bokar förnyelse av en delegering med den som utfärdar den.',
  model: false,
  scope: employee,
  execution: deduplicated,
  input: object({ refs: array({ type: 'string', pattern: '^hr:deleg:' }), when: string }, ['refs']),
  output: executeResult,
};

/** The most keys Clew sends in one call to a read about an entity (D97). */
export const KEYS_MAX = 200;
/** The word for a short sick leave on day N; the HR system counts one as short for up to 14 days. */
export const SICK_DAYS = 14;
export const sickOnDay = n => `Sjuk · dag ${n}`;
/**
 * Where each person stands today (D97): a read about a person, asked with a batch of user names, one row per employee of
 * the manager's unit in this system, carrying the key it was asked with. Anyone else is no row. Presence is the column
 * "Närvaro" on Personal: "I tjänst" is plain, an absence a neutral badge, so only the absences carry a tone. It is the
 * row in one value (`compact`): where the whole row is drawn, a section reads "I dag" and "Kommande".
 */
const person = {
  name: 'hr.person',
  kind: 'read',
  title: 'Frånvaro',
  description: 'Om medarbetaren är i tjänst i dag, frånvaron i dag och nästa frånvaro som är känd. Bara för chefen.',
  model: false,
  scope: manager,
  about: { entity: 'person' },
  input: object({
    keys: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 256 }, maxItems: KEYS_MAX },
  }),
  output: object({
    rows: {
      type: 'array',
      maxItems: KEYS_MAX,
      items: object(
        {
          key: string,
          ref: { type: 'string', pattern: '^hr:emp:[0-9]+$' },
          presence: string,
          today: string,
          upcoming: string,
        },
        ['key', 'ref', 'presence', 'today'],
      ),
    },
  }),
  view: {
    kind: 'list',
    title: 'presence',
    modelReads: 'summary',
    noun: { one: 'medarbetare', other: 'medarbetare' },
    empty: 'Personalsystemet har ingen uppgift om dem.',
    fields: [
      {
        key: 'presence',
        label: 'Närvaro',
        format: 'status',
        tones: {
          ...Object.fromEntries(Array.from({ length: SICK_DAYS }, (_, i) => [sickOnDay(i + 1), 'none'])),
          Sjukskriven: 'none',
          VAB: 'none',
          Semester: 'none',
          Ledig: 'none',
        },
        compact: true,
      },
      { key: 'today', label: 'I dag' },
      { key: 'upcoming', label: 'Kommande' },
    ],
    open: { capability: 'hr.absencePattern', title: 'Frånvaromönster', params: { ref: 'ref' } },
  },
};

const lookup = {
  name: 'hr.lookup',
  kind: 'read',
  title: 'Läs tillbaka en åtgärd',
  description: 'Om en åtgärd med ett givet operations-id finns i personalsystemets logg, och vad den gav.',
  model: false,
  scope: everyone,
  input: object({ operationId: { type: 'string', minLength: 1, maxLength: 200 } }),
  output: object({ found: boolean, result: executeResult }, ['found']),
};

export const manifest = {
  protocol: 2,
  id: CONNECTOR,
  kind: 'passthrough',
  source: 'Personalsystemet',
  uses: [],
  scan: true,
  facts: [{ kind: ABSENCE_FACT, title: 'Sjukfrånvaro', attributes: AbsenceAttributes }],
  areas: [
    {
      id: 'employees',
      title: 'Medarbetare',
      icon: 'people',
      roles: ['manager'],
      standing: ['hr.whoIsOn', 'hr.absenceOverview', 'hr.leaveRequests'],
      schedules: [
        { label: 'Frånvaro och mönster enligt rehabrutinen', when: 'Varje vardag 06:00' },
        { label: 'Ledighetsansökningar', when: 'När en ansökan kommer' },
      ],
      figure: true,
    },
    {
      id: 'my-shift',
      title: 'Mitt pass',
      icon: 'clock',
      roles: ['employee'],
      standing: ['hr.myShift', 'hr.whoIsOn', 'hr.myBalance'],
      schedules: [{ label: 'Delegeringar och utbildningar som går ut', when: 'Månadens första måndag' }],
      figure: true,
    },
  ],
  capabilities: [
    whoIsOn,
    absenceOverview,
    absencePattern,
    bookTalk,
    unbookTalk,
    leaveRequests,
    decideLeave,
    undecideLeave,
    proposeAbsence,
    reportAbsence,
    prepareAbsence,
    withdrawAbsence,
    myShift,
    myBalance,
    renewDelegation,
    lookup,
    person,
  ],
};
