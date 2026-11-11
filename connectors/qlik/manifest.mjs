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

/** The most keys Clew sends in one call to a read about an entity (D97). */
export const KEYS_MAX = 200;
// A read about a unit (D97): Clew asks with a batch of its unit ids and places the answer itself, as the section
// "Sjukfrånvaro" on the opened unit. One row per unit id the manager is manager of, through the unit map; any other id is
// no row. The rate is the latest closed month's, of the first of the unit's source units with a rate to show, as the
// area's figure takes it. `watch` is there only when the operator set a rate to watch from.
const unitAboutCapability = {
  name: 'qlik.unit',
  kind: 'read',
  title: 'Sjukfrånvaro',
  model: false,
  scope: { roles: ['manager'] },
  about: { entity: 'unit' },
  description:
    'Sjukfrånvaro i procent den senaste månaden för enheter du är chef för, mot samma månad i fjol. Bara sammanställningar per enhet, aldrig personer.',
  input: {
    type: 'object',
    properties: {
      keys: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 256 }, maxItems: KEYS_MAX },
    },
    required: ['keys'],
    additionalProperties: false,
  },
  output: {
    type: 'object',
    properties: {
      rows: {
        type: 'array',
        maxItems: KEYS_MAX,
        items: {
          type: 'object',
          properties: {
            key: string,
            ref: string,
            unit: string,
            month: string,
            total: number,
            watch: string,
            lastYear: number,
            change: number,
            headcount: integer,
            note: string,
          },
          required: ['key', 'ref', 'unit', 'month'],
          additionalProperties: false,
        },
      },
    },
    required: ['rows'],
    additionalProperties: false,
  },
  view: {
    kind: 'list',
    title: 'total',
    empty: 'Statistiken har ingen uppgift om enheten.',
    open: { capability: 'qlik.sickLeaveTrend', title: 'Visa utvecklingen', params: { unit: 'ref' } },
    fields: [
      { key: 'total', label: 'Sjukfrånvaro', format: 'number', unit: { one: '%', other: '%' } },
      { key: 'watch', label: 'Läge', format: 'status', tones: { Bevaka: 'warn' } },
      { key: 'month', label: 'Avser' },
      {
        key: 'change',
        label: 'Mot samma månad i fjol',
        format: 'number',
        unit: { one: 'procentenhet', other: 'procentenheter' },
      },
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
  capabilities: [unitRatesCapability, trendCapability, unitAboutCapability],
  scan: false,
};
