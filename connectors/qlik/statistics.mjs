// The statistics behind a port: one read returns every unit's rates per month and when the source was last reloaded.
// Adapters: the made-up statistics below (default) and Qlik's Engine API in engine.mjs. Both answer the same shape:
//   { reloadedAt: ISO string | null, rows: [{ unit, period: 'YYYY-MM', total, short, long, headcount }] }
// where a rate is a percentage with one decimal or null, and headcount an integer or null.

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

/**
 * Twenty-four closed months ending with the month before `now`, the same every time for the same month: winter is
 * higher, and this year runs a little below last year so the comparison has something to say.
 */
export function createFixtureStatistics({ now = () => new Date() } = {}) {
  return {
    async read() {
      const today = now();
      const rows = [];
      for (let back = 24; back >= 1; back--) {
        const period = monthsBefore(today, back);
        const month = Number(period.slice(5));
        const winter = [12, 1, 2, 3].includes(month) ? 1.6 : [6, 7].includes(month) ? -1.2 : 0;
        const thisYear = back <= 12 ? -0.6 : 0;
        for (const u of fixtureUnits) {
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
      // Reloaded at 03:00 UTC, as a nightly reload would be.
      const reload = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 3);
      const reloadedAt = new Date(reload <= today.getTime() ? reload : reload - 86_400_000).toISOString();
      return { reloadedAt, rows };
    },
  };
}
