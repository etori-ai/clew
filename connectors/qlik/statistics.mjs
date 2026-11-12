// The statistics behind a port: one read returns every unit's rates per month and when the source was last reloaded.
// Adapters: the made-up statistics below (default) and Qlik's Engine API in engine.mjs. Both answer the same shape:
//   { reloadedAt: ISO string | null, rows: [{ unit, period: 'YYYY-MM', total, short, long, headcount }] }
// where a rate is a percentage with one decimal or null, and headcount an integer or null. An adapter may also answer
//   economy(units): { reloadedAt, rows: [{ unit, period: 'YYYY-MM', budget, forecast }] }   full-year net cost, mnkr
//   hme(units):     { reloadedAt, rows: [{ unit, year, total, motivation, leadership, governance, respondents }] }
// and say `perUnit: true` when it reads only the units it is asked about. Only the fixture answers economy and HME
// today: where they come from in production is not settled, and HME's real source is the survey, not Qlik.

/** The source could not be read. Its own error text never leaves this container. */
export class StatisticsUnavailable extends Error {}

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

const rate = value => {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n * 10) / 10 : null;
};
const count = value => (Number.isInteger(value) && value >= 0 ? value : null);

/** One source row in the shape every adapter answers, or null when it cannot be one. */
export function toStatRow(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const unit = typeof raw.unit === 'string' ? raw.unit.trim() : '';
  const period = typeof raw.period === 'string' ? raw.period.trim() : '';
  if (!unit || unit.length > 120 || !PERIOD.test(period)) return null;
  return {
    unit,
    period,
    total: rate(raw.total),
    short: rate(raw.short),
    long: rate(raw.long),
    headcount: count(raw.headcount),
  };
}

// Made-up units: the three in Clew's synthetic organisation, a second unit under IT, and one too small to show.
const fixtureUnits = [
  { unit: 'Bergsåkers skola', base: 5.4, long: 0.45, headcount: 46, seed: 1 },
  { unit: 'Hemtjänst Centrum', base: 8.9, long: 0.55, headcount: 62, seed: 2 },
  { unit: 'IT och digitalisering', base: 3.1, long: 0.35, headcount: 28, seed: 3 },
  { unit: 'Servicedesk', base: 4.2, long: 0.3, headcount: 4, seed: 4 },
];

/** Clew's synthetic unit ids to the fixture's unit names, used when no map is configured. */
export const fixtureUnitMap = {
  'unit-skola': ['Bergsåkers skola'],
  'unit-omsorg': ['Hemtjänst Centrum'],
  'unit-it': ['IT och digitalisering', 'Servicedesk'],
};

const monthsBefore = (date, n) => {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

/** A small, stable number from a unit's name, so a unit the fixture has never heard of still gets the same figures. */
const seedOf = unit => {
  let h = 2166136261;
  for (const ch of unit) h = Math.imul(h ^ ch.codePointAt(0), 16777619) >>> 0;
  return h;
};
const pick = (seed, salt, lo, hi) => lo + (((seed >>> salt) % 1000) / 999) * (hi - lo);
const round1 = n => Math.round(n * 10) / 10;

/** A made-up unit for any name: its level of sick leave, the long-term share and its headcount, about one in thirteen too small. */
const madeUp = unit => {
  const seed = seedOf(unit);
  const small = seed % 13 === 5;
  return {
    unit,
    base: round1(pick(seed, 3, 3.2, 9.4)),
    long: pick(seed, 7, 0.3, 0.6),
    headcount: small ? 3 : Math.round(pick(seed, 11, 8, 140)),
    seed: seed % 97,
  };
};

const reloadedAtOf = today => {
  // Reloaded at 03:00 UTC, as a nightly reload would be.
  const reload = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 3);
  return new Date(reload <= today.getTime() ? reload : reload - 86_400_000).toISOString();
};

/** The fixture's own units, and every unit the connector asks about that is not one of them. */
const unitsFor = asked => [
  ...fixtureUnits,
  ...[...new Set(asked ?? [])].filter(u => !fixtureUnits.some(f => f.unit === u)).map(madeUp),
];

/**
 * Made-up statistics for any unit, the same every time for the same unit and month (D82; synthetic, never real figures).
 * `read` is sick leave: twenty-four closed months ending with the month before `now`; winter is higher, and this year
 * runs a little below last year so the comparison has something to say. `economy` is the full-year budget and forecast
 * of net cost, in mnkr, as it stood at the close of each month of the current year. `hme` is the yearly employee survey's
 * index, every other year, with its three perspectives. The fixture answers for its own units and for every unit name
 * it is asked about (`perUnit`), so a development stack with any organisation tree has figures for every manager.
 */
export function createFixtureStatistics({ now = () => new Date() } = {}) {
  return {
    perUnit: true,
    async read(asked) {
      const today = now();
      const rows = [];
      for (let back = 24; back >= 1; back--) {
        const period = monthsBefore(today, back);
        const month = Number(period.slice(5));
        const winter = [12, 1, 2, 3].includes(month) ? 1.6 : [6, 7].includes(month) ? -1.2 : 0;
        const thisYear = back <= 12 ? -0.6 : 0;
        for (const u of unitsFor(asked)) {
          const wobble = (((u.seed * 31 + month * 17 + back * 7) % 11) - 5) / 10;
          const total = Math.max(0.5, u.base + winter + thisYear + wobble);
          const long = total * u.long;
          rows.push(
            toStatRow({
              unit: u.unit,
              period,
              total,
              short: total - long,
              long,
              headcount: u.headcount,
            }),
          );
        }
      }
      return { reloadedAt: reloadedAtOf(today), rows };
    },

    async economy(asked) {
      const today = now();
      const last = monthsBefore(today, 1);
      const year = last.slice(0, 4);
      const rows = [];
      for (const u of unitsFor(asked)) {
        const seed = seedOf(u.unit);
        const budget = round1(pick(seed, 5, 18, 420));
        // Where the year is heading, as a share of the budget: most a little over or under, a few clearly over.
        const heading = pick(seed, 9, -0.045, 0.03);
        for (let month = 1; month <= Number(last.slice(5)); month++) {
          const wobble = ((((seed >>> 13) + month * 23) % 9) - 4) / 400;
          const drift = (heading * month) / 12 + wobble;
          rows.push({
            unit: u.unit,
            period: `${year}-${String(month).padStart(2, '0')}`,
            budget,
            forecast: round1(budget * (1 - drift)),
          });
        }
      }
      return { reloadedAt: reloadedAtOf(today), rows };
    },

    async hme(asked) {
      const today = now();
      // Every other year, the latest the year before this one or the one before that.
      const latest = today.getUTCFullYear() - 1 - ((today.getUTCFullYear() - 1) % 2 === 0 ? 1 : 0);
      const rows = [];
      for (const u of unitsFor(asked)) {
        const seed = seedOf(u.unit);
        const level = pick(seed, 4, 66, 86);
        const climb = pick(seed, 8, -2.5, 2.5);
        for (let i = 3; i >= 0; i--) {
          const year = latest - i * 2;
          const total = Math.round(Math.min(100, Math.max(0, level - climb * i)));
          const around = salt => Math.round(Math.min(100, Math.max(0, total + pick(seed, salt, -5, 5))));
          rows.push({
            unit: u.unit,
            year,
            total,
            motivation: around(12),
            leadership: around(15),
            governance: around(18),
            respondents: Math.round(u.headcount * 0.8),
          });
        }
      }
      return { reloadedAt: reloadedAtOf(today), rows };
    },
  };
}
