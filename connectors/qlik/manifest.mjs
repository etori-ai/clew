// Clew reads this contract to discover what Qlik offers and draw its views (D82). Sick leave is the first area.
// The contract describes sick-leave rates, not Qlik: another statistics source can fulfil it later (D1).
// Only aggregates cross this boundary: a rate per unit and month, never a person.

export const unitRefPattern = '^unit:[A-Za-z0-9_.-]{1,80}$';

const string = { type: 'string' };
const number = { type: 'number' };
const integer = { type: 'integer' };

// One unit in one month. A rate is a percentage of planned working time, one decimal. A row for a group smaller
// than the minimum carries no rates, only `note`.
const unitRowSchema = {
  type: 'object',
  properties: {
    ref: string,
    unit: string,
    period: string,
    month: string,
    total: number,
    short: number,
    long: number,
    lastYear: number,
    change: number,
    headcount: integer,
    note: string,
  },
  required: ['ref', 'unit', 'period', 'month'],
};

const monthRowSchema = {
  type: 'object',
  properties: {
    ref: string,
    period: string,
    month: string,
    total: number,
    short: number,
    long: number,
    lastYear: number,
    headcount: integer,
    note: string,
  },
  required: ['ref', 'period', 'month'],
};

const rateFields = [
  { key: 'total', label: 'Sjukfrånvaro, %', format: 'number' },
  { key: 'short', label: 'Korttid, %', format: 'number' },
  { key: 'long', label: 'Långtid, %', format: 'number' },
  { key: 'lastYear', label: 'Samma månad i fjol, %', format: 'number' },
];

// The rate per unit for the latest month: the manager's own unit, or the units the operator mapped to it.
const unitRatesCapability = {
  name: 'qlik.sickLeaveByUnit',
  kind: 'read',
  title: 'Sjukfrånvaro per enhet',
  model: true,
  scope: { roles: ['manager'] },
  menu: { label: 'Sjukfrånvaro', icon: 'chart' },
  description:
    'Sjukfrånvaro i procent för chefens enheter den senaste månaden, kort- och långtid, mot samma månad i fjol. Bara sammanställningar per enhet, aldrig personer.',
  input: { type: 'object', properties: {}, additionalProperties: false },
  output: {
    type: 'object',
    properties: {
      updated: string,
      rows: { type: 'array', items: unitRowSchema },
    },
    required: ['rows'],
  },
  view: {
    kind: 'table',
    title: 'unit',
    ref: 'ref',
    open: { capability: 'qlik.sickLeaveTrend', title: 'Utveckling', params: { unit: 'ref' } },
    empty: 'Statistiken har ingen enhet som hör till dig.',
    fields: [
      { key: 'unit', label: 'Enhet' },
      { key: 'month', label: 'Avser' },
      ...rateFields,
      { key: 'change', label: 'Förändring, procentenheter', format: 'number' },
      { key: 'headcount', label: 'Medarbetare', format: 'number' },
      { key: 'note', label: 'Anmärkning' },
    ],
  },
};

// The last twelve months for one unit, newest first. Opened from a unit row, or for the first of the person's units.
const trendCapability = {
  name: 'qlik.sickLeaveTrend',
  kind: 'read',
  title: 'Sjukfrånvaro per månad',
  model: true,
  scope: { roles: ['manager'] },
  description:
    'Sjukfrånvaro i procent per månad de senaste tolv månaderna för en av chefens enheter, mot samma månad i fjol. Bara sammanställningar, aldrig personer.',
  input: {
    type: 'object',
    properties: { unit: { type: 'string', pattern: unitRefPattern } },
    additionalProperties: false,
  },
  output: {
    type: 'object',
    properties: {
      unit: string,
      updated: string,
      rows: { type: 'array', items: monthRowSchema },
    },
    required: ['unit', 'rows'],
  },
  view: {
    kind: 'table',
    title: 'month',
    ref: 'ref',
    empty: 'Statistiken har inga månader för enheten.',
    fields: [
      { key: 'month', label: 'Månad' },
      ...rateFields,
      { key: 'headcount', label: 'Medarbetare', format: 'number' },
      { key: 'note', label: 'Anmärkning' },
    ],
  },
};

export const manifest = {
  protocol: 2,
  id: 'qlik',
  kind: 'passthrough',
  source: 'Qlik',
  areas: [
    {
      id: 'sick-leave',
      title: 'Sjukfrånvaro',
      icon: 'chart',
      roles: ['manager'],
      standing: ['qlik.sickLeaveByUnit', 'qlik.sickLeaveTrend'],
      schedules: [{ label: 'Statistiken läses om', when: 'När källan har laddats om, oftast varje natt' }],
      figure: true,
    },
  ],
  capabilities: [unitRatesCapability, trendCapability],
  scan: false,
};
