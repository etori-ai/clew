// Clew reads this contract to discover what Qlik offers and draw its views (D82). Sick leave was the first area;
// economy and HME follow it as the key figures of the follow-up dialogue (docs/reviews/2026-11-12-absorbing-big-boss-
// board-into-clew.md), served by the fixture until their source is settled. The contract describes the figures, not
// Qlik: another statistics source can fulfil it later (D1). Only aggregates cross this boundary, never a person.

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
  // Clew asks only about the units the manager manages and those below them that they follow up (D117, both records);
  // the statistics answer for the units the signed actor carries in `units`, and refuse the rest.
  unit: { admits: ['manages', 'below'] },
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
            change: string,
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
    open: { capability: 'qlik.sickLeaveChart', title: 'Visa utvecklingen', params: { unit: 'ref' } },
    fields: [
      { key: 'total', label: 'Sjukfrånvaro', format: 'number', unit: { one: '%', other: '%' } },
      {
        key: 'watch',
        label: 'Läge',
        format: 'status',
        tones: { 'Inom målet': 'ok', Bevaka: 'warn', 'Åtgärd krävs': 'alert' },
      },
      { key: 'month', label: 'Avser' },
      // With its sign, as words ("+0,4 procentenheter"): a number field draws no plus.
      { key: 'change', label: 'Mot samma månad i fjol' },
      { key: 'note', label: 'Anmärkning' },
    ],
  },
};

// A chart for one unit (D79's series view), opened from a row with the unit's ref; it is never a standing action, since
// a chart needs a unit. The body is Clew's series payload, checked against Clew's published schema at the boundary.
const chartCapability = (name, title, description) => ({
  name,
  kind: 'read',
  title,
  model: true,
  scope: { roles: ['manager'] },
  description,
  input: {
    type: 'object',
    properties: { unit: { type: 'string', pattern: unitRefPattern } },
    required: ['unit'],
    additionalProperties: false,
  },
  output: { type: 'object', properties: { series: { type: 'object' } }, required: ['series'] },
  view: { kind: 'series', body: 'series', chart: 'line' },
});

const keysInput = {
  type: 'object',
  properties: {
    keys: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 256 }, maxItems: KEYS_MAX },
  },
  required: ['keys'],
  additionalProperties: false,
};
const aboutOutput = properties => ({
  type: 'object',
  properties: {
    rows: {
      type: 'array',
      maxItems: KEYS_MAX,
      items: { type: 'object', properties, required: ['key', 'ref', 'unit'], additionalProperties: false },
    },
  },
  required: ['rows'],
  additionalProperties: false,
});

const sickLeaveChartCapability = chartCapability(
  'qlik.sickLeaveChart',
  'Sjukfrånvaron över tid',
  'Sjukfrånvaro i procent per månad de senaste tolv månaderna för en av chefens enheter, mot samma månad i fjol, som diagram. Bara sammanställningar, aldrig personer.',
);

// Economy: net cost, the full-year budget against the full-year forecast as it stood at the close of a month, in mnkr.
// The deviation is budget minus forecast: positive is within budget. Not about people, so no group is held back.
const economyFields = [
  { key: 'budget', label: 'Helårsbudget, mnkr', format: 'number' },
  { key: 'forecast', label: 'Helårsprognos, mnkr', format: 'number' },
  { key: 'deviation', label: 'Avvikelse mot budget, mnkr', format: 'number' },
];
const economyAssessment = {
  key: 'assessment',
  label: 'Läge',
  format: 'status',
  tones: { 'Klarar budget': 'ok', 'Mot underskott': 'alert' },
};
const economyByUnitCapability = {
  name: 'qlik.economyByUnit',
  kind: 'read',
  title: 'Ekonomi per enhet',
  model: true,
  scope: { roles: ['manager'] },
  menu: { label: 'Ekonomi', icon: 'chart' },
  description:
    'Nettokostnadens helårsbudget och helårsprognos i mnkr för chefens enheter vid den senaste månadens stängning, och avvikelsen mellan dem.',
  input: { type: 'object', properties: {}, additionalProperties: false },
  output: {
    type: 'object',
    properties: {
      updated: string,
      rows: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            ref: string,
            unit: string,
            period: string,
            month: string,
            budget: number,
            forecast: number,
            deviation: number,
            assessment: string,
          },
          required: ['ref', 'unit', 'period', 'month', 'budget', 'forecast', 'deviation'],
        },
      },
    },
    required: ['rows'],
  },
  view: {
    kind: 'table',
    title: 'unit',
    ref: 'ref',
    open: { capability: 'qlik.economyChart', title: 'Utveckling', params: { unit: 'ref' } },
    empty: 'Statistiken har ingen ekonomi för dina enheter.',
    fields: [{ key: 'unit', label: 'Enhet' }, { key: 'month', label: 'Avser' }, ...economyFields, economyAssessment],
  },
};
const economyChartCapability = chartCapability(
  'qlik.economyChart',
  'Ekonomin över året',
  'Avvikelsen mellan helårsbudget och helårsprognos i mnkr vid varje månads stängning i år, för en av chefens enheter, som diagram.',
);
const economyAboutCapability = {
  name: 'qlik.economyUnit',
  kind: 'read',
  title: 'Ekonomi',
  model: false,
  scope: { roles: ['manager'] },
  about: { entity: 'unit' },
  unit: { admits: ['manages', 'below'] },
  description: 'Avvikelsen mellan nettokostnadens helårsbudget och helårsprognos för en enhet, den senaste månaden.',
  input: keysInput,
  output: aboutOutput({
    key: string,
    ref: string,
    unit: string,
    month: string,
    deviation: string,
    assessment: string,
    forecast: number,
    budget: number,
  }),
  view: {
    kind: 'list',
    title: 'deviation',
    empty: 'Statistiken har ingen ekonomi för enheten.',
    open: { capability: 'qlik.economyChart', title: 'Visa utvecklingen', params: { unit: 'ref' } },
    fields: [
      // With its sign and unit, as words ("+10,6 mnkr"): a number field draws no plus, and a surplus must read as one.
      { key: 'deviation', label: 'Avvikelse mot budget' },
      economyAssessment,
      { key: 'month', label: 'Avser' },
      { key: 'forecast', label: 'Helårsprognos', format: 'number', unit: { one: 'mnkr', other: 'mnkr' } },
      { key: 'budget', label: 'Helårsbudget', format: 'number', unit: { one: 'mnkr', other: 'mnkr' } },
    ],
  },
};

// HME, the yearly employee survey's index (0–100) and its three perspectives, every other year. The year is text, so it
// is not drawn as a number ("2 025"). A unit with fewer
// respondents than the minimum group is held back like sick leave. HME's real source is the survey, not Qlik: it is here
// only so the development stack can show it, until its source is settled.
const hmeAssessment = {
  key: 'assessment',
  label: 'Läge',
  format: 'status',
  tones: { 'Över mål': 'ok', Bevaka: 'warn', 'Åtgärd krävs': 'alert' },
};
const hmeByUnitCapability = {
  name: 'qlik.hmeByUnit',
  kind: 'read',
  title: 'Medarbetarengagemang per enhet',
  model: true,
  scope: { roles: ['manager'] },
  menu: { label: 'HME', icon: 'people' },
  description:
    'Hållbart medarbetarengagemang (HME) för chefens enheter vid den senaste mätningen: totalindex och perspektiven motivation, ledarskap och styrning, mot mätningen före. Bara sammanställningar per enhet.',
  input: { type: 'object', properties: {}, additionalProperties: false },
  output: {
    type: 'object',
    properties: {
      updated: string,
      rows: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            ref: string,
            unit: string,
            year: string,
            total: integer,
            motivation: integer,
            leadership: integer,
            governance: integer,
            change: integer,
            assessment: string,
            note: string,
          },
          required: ['ref', 'unit'],
        },
      },
    },
    required: ['rows'],
  },
  view: {
    kind: 'table',
    title: 'unit',
    ref: 'ref',
    open: { capability: 'qlik.hmeChart', title: 'Utveckling', params: { unit: 'ref' } },
    empty: 'Statistiken har ingen mätning för dina enheter.',
    fields: [
      { key: 'unit', label: 'Enhet' },
      { key: 'year', label: 'Mätår' },
      { key: 'total', label: 'HME totalt', format: 'number' },
      hmeAssessment,
      { key: 'change', label: 'Mot mätningen före', format: 'number' },
      { key: 'motivation', label: 'Motivation', format: 'number' },
      { key: 'leadership', label: 'Ledarskap', format: 'number' },
      { key: 'governance', label: 'Styrning', format: 'number' },
      { key: 'note', label: 'Anmärkning' },
    ],
  },
};
const hmeChartCapability = chartCapability(
  'qlik.hmeChart',
  'Medarbetarengagemanget över tid',
  'HME totalt och perspektiven motivation, ledarskap och styrning vid de senaste mätningarna för en av chefens enheter, som diagram.',
);
const hmeAboutCapability = {
  name: 'qlik.hmeUnit',
  kind: 'read',
  title: 'Medarbetarengagemang',
  model: false,
  scope: { roles: ['manager'] },
  about: { entity: 'unit' },
  unit: { admits: ['manages', 'below'] },
  description: 'Hållbart medarbetarengagemang (HME) för en enhet vid den senaste mätningen, mot mätningen före.',
  input: keysInput,
  output: aboutOutput({
    key: string,
    ref: string,
    unit: string,
    year: string,
    total: integer,
    assessment: string,
    change: string,
    note: string,
  }),
  view: {
    kind: 'list',
    title: 'total',
    empty: 'Statistiken har ingen mätning för enheten.',
    open: { capability: 'qlik.hmeChart', title: 'Visa utvecklingen', params: { unit: 'ref' } },
    fields: [
      // The index is out of a hundred, so it reads "74 av 100", not a bare number.
      { key: 'total', label: 'HME totalt', format: 'number', unit: { one: 'av 100', other: 'av 100' } },
      hmeAssessment,
      { key: 'year', label: 'Mätår' },
      { key: 'change', label: 'Mot mätningen före' },
      { key: 'note', label: 'Anmärkning' },
    ],
  },
};

export const manifest = {
  protocol: 3,
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
    {
      id: 'economy',
      title: 'Ekonomi',
      icon: 'chart',
      roles: ['manager'],
      standing: ['qlik.economyByUnit'],
      schedules: [{ label: 'Ekonomin läses om', when: 'Efter månadens stängning, oftast den 7:e' }],
      figure: true,
    },
    {
      id: 'hme',
      title: 'Hållbart medarbetarengagemang',
      icon: 'people',
      roles: ['manager'],
      standing: ['qlik.hmeByUnit'],
      schedules: [{ label: 'Medarbetarenkäten', when: 'Vartannat år' }],
      figure: true,
    },
  ],
  capabilities: [
    unitRatesCapability,
    trendCapability,
    unitAboutCapability,
    sickLeaveChartCapability,
    economyByUnitCapability,
    economyChartCapability,
    economyAboutCapability,
    hmeByUnitCapability,
    hmeChartCapability,
    hmeAboutCapability,
  ],
  scan: false,
};
