// The Qlik connector's read operations and HTTP boundary (D82): sick-leave statistics, the first thing it shows.
// manifest.mjs owns the contract and views; statistics.mjs and engine.mjs own source access and mapping.
// Only aggregates are handled here, and a group smaller than `minGroup` is held back before anything leaves.
import { createHash } from 'node:crypto';
import { createVerifier } from './verification.mjs';
import { StatisticsUnavailable, createFixtureStatistics, fixtureUnitMap } from './statistics.mjs';
import { manifest, unitRefPattern } from './manifest.mjs';

export { manifest };

const unitRef = new RegExp(unitRefPattern);
const monthName = new Intl.DateTimeFormat('sv-SE', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const decimal = new Intl.NumberFormat('sv-SE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

class Invalid extends Error {}
class NotFound extends Error {}
class Denied extends Error {}

const round1 = n => Math.round(n * 10) / 10;
const monthOf = period => monthName.format(new Date(`${period}-01T00:00:00Z`));
const yearBefore = period => `${Number(period.slice(0, 4)) - 1}${period.slice(4)}`;
// A unit's ref is a hash of its name in the source: stable, and no unit name in Clew's addresses.
const refOf = unit => 'unit:' + createHash('sha256').update(unit).digest('hex').slice(0, 16);

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function errorResponse(code, message, status) {
  return jsonResponse({ error: { code, message } }, status);
}

/**
 * statistics: the source port (fixture by default). unitMap: Clew unit id -> the source's unit names a manager of that
 * unit sees. minGroup: the smallest group whose rates may be shown (HR and the data protection officer decide; D82).
 * warnAbove: an optional rate, in percent, from which the area figure says "warn". Identity comes from the verified
 * assertion, never from the request body.
 */
export function createConnector({
  jwks,
  secret,
  statistics = createFixtureStatistics(),
  unitMap = fixtureUnitMap,
  minGroup = 5,
  warnAbove,
  cacheSeconds = 300,
  now = () => Date.now(),
} = {}) {
  const verify = createVerifier({ secret, jwks, clewUrl: process.env.CLEW_URL ?? '' }, manifest.id);

  // Aggregates only, kept in memory for a few minutes so a page of views does not open the source once per view.
  let cached = null;
  let inflight = null;
  async function read() {
    if (cached && now() - cached.at < cacheSeconds * 1000) return cached.value;
    inflight ??= statistics
      .read()
      .then(value => {
        cached = { at: now(), value };
        return value;
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  }

  const unitsOf = actor => {
    const units = unitMap[actor.unitId];
    return Array.isArray(units) ? units : [];
  };

  const withheld = row => row.headcount === null || row.headcount < minGroup;
  const withheldNote = row =>
    row.headcount === null
      ? 'Antalet medarbetare saknas. Visas inte.'
      : `Färre än ${minGroup} medarbetare. Visas inte.`;

  /** One unit in one month, as the views show it: rates only for a group large enough, with last year beside it. */
  function present(data, unit, period) {
    const row = data.rows.find(r => r.unit === unit && r.period === period);
    const shown = { period, month: monthOf(period) };
    if (!row) return { ...shown, note: 'Ingen uppgift för månaden.' };
    if (withheld(row)) return { ...shown, note: withheldNote(row) };
    if (row.total !== null) shown.total = row.total;
    if (row.short !== null) shown.short = row.short;
    if (row.long !== null) shown.long = row.long;
    const before = data.rows.find(r => r.unit === unit && r.period === yearBefore(period));
    if (before && !withheld(before) && before.total !== null) {
      shown.lastYear = before.total;
      if (row.total !== null) shown.change = round1(row.total - before.total);
    }
    shown.headcount = row.headcount;
    return shown;
  }

  const latestFor = (data, units) =>
    data.rows
      .filter(r => units.includes(r.unit))
      .map(r => r.period)
      .sort()
      .at(-1);

  function requireManager(actor) {
    if (actor.role !== 'manager') throw new Denied('Bara chefer ser sjukfrånvarostatistiken.');
  }

  const capabilities = {
    'qlik.sickLeaveByUnit': async actor => {
      requireManager(actor);
      const units = unitsOf(actor);
      const data = await read();
      const latest = latestFor(data, units);
      const output = { rows: [] };
      if (data.reloadedAt) output.updated = data.reloadedAt;
      if (!latest) return output;
      output.rows = units.map(unit => ({ ref: refOf(unit), unit, ...present(data, unit, latest) }));
      return output;
    },

    'qlik.sickLeaveTrend': async (actor, input) => {
      requireManager(actor);
      if (input.unit !== undefined && (typeof input.unit !== 'string' || !unitRef.test(input.unit)))
        throw new Invalid('Ogiltig enhet.');
      const units = unitsOf(actor);
      const unit = input.unit === undefined ? units[0] : units.find(u => refOf(u) === input.unit);
      if (input.unit !== undefined && !unit) throw new NotFound('Enheten finns inte bland dina enheter.');
      const data = await read();
      const output = { unit: unit ?? actor.unitLabel, rows: [] };
      if (data.reloadedAt) output.updated = data.reloadedAt;
      if (!unit) return output;
      const periods = [...new Set(data.rows.filter(r => r.unit === unit).map(r => r.period))].sort().reverse();
      output.rows = periods.slice(0, 12).map(period => ({ ref: 'month:' + period, ...present(data, unit, period) }));
      return output;
    },
  };

  /**
   * The area's figure (D54): the first of the person's units with a rate to show, its month and last year in the
   * comparison, opening the table of units. Without `warnAbove` the number is the whole message, so the tone is none.
   */
  async function figure(actor, area) {
    if (area !== 'sick-leave' || actor.role !== 'manager') return null;
    const units = unitsOf(actor);
    const data = await read();
    const latest = latestFor(data, units);
    if (!latest) return null;
    for (const unit of units) {
      const shown = present(data, unit, latest);
      if (shown.total === undefined) continue;
      const signed = n => `${n >= 0 ? '+' : '−'}${decimal.format(Math.abs(n))}`;
      const comparison =
        shown.lastYear === undefined
          ? shown.month
          : `${shown.month} · ${decimal.format(shown.lastYear)} % i fjol, ${signed(shown.change)}`;
      const tone = typeof warnAbove === 'number' ? (shown.total >= warnAbove ? 'warn' : 'ok') : 'none';
      return {
        label: 'Sjukfrånvaro',
        value: `${decimal.format(shown.total)} %`,
        comparison,
        tone,
        opens: 'qlik.sickLeaveByUnit',
      };
    }
    return null;
  }

  // HTTP boundary: route, verify identity, read input, dispatch and translate errors.
  async function handle(request) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/clew/manifest') {
      return jsonResponse(manifest);
    }
    if (request.method !== 'POST' || !url.pathname.startsWith('/clew/')) {
      return errorResponse('not-found', 'Okänd adress.', 404);
    }

    const token = (request.headers.get('authorization') ?? '').replace(/^Bearer /, '');
    const actor = await verify(token, request.headers.get('x-clew-connector-key'));
    if (!actor) {
      return errorResponse('denied', 'Ogiltigt behörighetsbevis.', 401);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return errorResponse('invalid', 'Ogiltig förfrågan.', 400);
    }

    try {
      if (url.pathname === '/clew/scan') return jsonResponse({ drafts: [] });
      if (url.pathname === '/clew/figure') {
        return jsonResponse({ figure: await figure(actor, typeof body?.area === 'string' ? body.area : '') });
      }

      const name = decodeURIComponent(url.pathname.slice('/clew/capabilities/'.length));
      const capability = capabilities[name];
      if (!capability) {
        return errorResponse('not-found', 'Okänd förmåga.', 404);
      }
      const input = body && typeof body.input === 'object' && body.input ? body.input : {};
      return jsonResponse({ output: await capability(actor, input) });
    } catch (error) {
      if (error instanceof Invalid) return errorResponse('invalid', error.message, 400);
      if (error instanceof NotFound) return errorResponse('not-found', error.message, 404);
      if (error instanceof Denied) return errorResponse('denied', error.message, 403);

      // The source's error text stays here, and so does anything an unexpected error might carry: only its name is logged.
      if (!(error instanceof StatisticsUnavailable)) console.error('qlik connector: unexpected', error?.name);
      return errorResponse('unavailable', 'Qlik svarar inte just nu.', 503);
    }
  }

  return { manifest, handle };
}
