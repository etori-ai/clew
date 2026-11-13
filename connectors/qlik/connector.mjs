// The Qlik connector's read operations and HTTP boundary (D82): sick leave, economy and HME per unit, as aggregates.
// manifest.mjs owns the contract and views; statistics.mjs and engine.mjs own source access and mapping.
// Only aggregates are handled here, and a group smaller than `minGroup` is held back before anything leaves.
import { createHash } from 'node:crypto';
import { createVerifier } from './verification.mjs';
import { StatisticsUnavailable, createFixtureStatistics, fixtureUnitMap } from './statistics.mjs';
import { KEYS_MAX, manifest, unitRefPattern } from './manifest.mjs';

export { manifest };

const unitRef = new RegExp(unitRefPattern);
const monthName = new Intl.DateTimeFormat('sv-SE', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const shortMonth = new Intl.DateTimeFormat('sv-SE', { month: 'short', timeZone: 'UTC' });
const decimal = new Intl.NumberFormat('sv-SE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

class Invalid extends Error {}
class NotFound extends Error {}
class Denied extends Error {}

const round1 = n => Math.round(n * 10) / 10;
const dateOf = period => new Date(`${period}-01T00:00:00Z`);
const monthOf = period => monthName.format(dateOf(period));
const yearBefore = period => `${Number(period.slice(0, 4)) - 1}${period.slice(4)}`;
const signed = (n, format = v => decimal.format(v)) => `${n >= 0 ? '+' : '−'}${format(Math.abs(n))}`;
const hashRef = unit => 'unit:' + createHash('sha256').update(unit).digest('hex').slice(0, 16);

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
 * unit sees; `null` is the fixture's open mode, below. minGroup: the smallest group whose rates may be shown (HR and the
 * data protection officer decide; D82). The tones are the organisation's rules, never the connector's (D82 item 7), and
 * each is off until the operator sets it: warnAbove and alertAbove, rates in percent at or above which sick leave is
 * "warn" and "alert"; economyAlertBelow, a deviation in mnkr below which the economy is "alert"; hmeOkFrom and
 * hmeWarnFrom, indexes from which HME is "ok" and "warn". Identity comes from the verified assertion, never the body.
 *
 * The scope is the units the verified actor follows up (D117): their own unit, and the units Clew lists in `units` (those
 * they manage and those of the managers who report to them, D99) when the call carries them. Any other unit is no row,
 * a chart for it is not found. With a map each of these Clew units is the source's units the map names for it.
 *
 * Open mode (`unitMap: null`), for the fixture only: there is no map from Clew's units to the source's, so a unit's name
 * in the source is Clew's unit id and every manager has figures for the units they follow up, whatever the organisation
 * tree. How Clew's units map to the real source is not settled (the review
 * docs/reviews/2026-11-12-absorbing-big-boss-board-into-clew.md, decision B item 4).
 */
export function createConnector({
  jwks,
  secret,
  statistics = createFixtureStatistics(),
  unitMap = fixtureUnitMap,
  minGroup = 5,
  warnAbove,
  alertAbove,
  economyAlertBelow,
  hmeOkFrom,
  hmeWarnFrom,
  cacheSeconds = 300,
  now = () => Date.now(),
} = {}) {
  const verify = createVerifier({ secret, jwks, clewUrl: process.env.CLEW_URL ?? '' }, manifest.id);
  const open = unitMap === null;

  // Aggregates only, kept in memory for a few minutes so a page of views does not open the source once per view. An
  // adapter that reads only the units it is asked about is cached per set of units; one that reads everything, once.
  const cache = new Map();
  const inflight = new Map();
  async function read(kind, units) {
    const port = statistics[kind];
    if (typeof port !== 'function') return null;
    const key = `${kind}|${statistics.perUnit ? [...units].sort().join('\n') : '*'}`;
    const hit = cache.get(key);
    if (hit && now() - hit.at < cacheSeconds * 1000) return hit.value;
    if (!inflight.has(key))
      inflight.set(
        key,
        Promise.resolve(port.call(statistics, units))
          .then(value => {
            for (const [k, v] of cache) if (now() - v.at >= cacheSeconds * 1000) cache.delete(k);
            cache.set(key, { at: now(), value });
            return value;
          })
          .finally(() => inflight.delete(key)),
      );
    return inflight.get(key);
  }

  /** The Clew units the actor follows up (D117), their own first, each once, with their labels. */
  const followed = actor => {
    const seen = new Map();
    if (actor.unitId) seen.set(actor.unitId, actor.unitLabel);
    for (const u of Array.isArray(actor.units) ? actor.units : [])
      if (u && typeof u.unitId === 'string' && u.unitId && !seen.has(u.unitId)) seen.set(u.unitId, u.unitLabel);
    return seen;
  };
  /** The source's units behind one Clew unit: in open mode the unit itself, else the map's names for it. */
  const sourceUnits = clewUnit => {
    if (open) return [clewUnit];
    const units = unitMap[clewUnit];
    return Array.isArray(units) ? units : [];
  };
  /** Every source unit the actor may see, their own unit's first. */
  const unitsOf = actor => [...new Set([...followed(actor).keys()].flatMap(sourceUnits))];
  /** What a unit is called in a row: in open mode the Clew unit's label as Clew sent it, else the source's name. */
  const nameOf = (actor, unit) => (open ? followed(actor).get(unit) || unit : unit);
  // A unit's ref: in open mode Clew's unit id itself, which is already in Clew's addresses; else a hash of its name in
  // the source, stable, with no unit name in Clew's addresses.
  const refOf = unit => (open && unitRef.test(`unit:${unit}`) ? `unit:${unit}` : hashRef(unit));
  function unitOfRef(actor, ref) {
    if (ref === undefined) return unitsOf(actor)[0];
    if (typeof ref !== 'string' || !unitRef.test(ref)) throw new Invalid('Ogiltig enhet.');
    const unit = unitsOf(actor).find(u => refOf(u) === ref);
    if (!unit) throw new NotFound('Enheten finns inte bland dina enheter.');
    return unit;
  }

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

  // The organisation's rules, each off until set (D82 item 7).
  const sickTone = total =>
    typeof alertAbove === 'number' && total >= alertAbove
      ? 'alert'
      : typeof warnAbove === 'number' && total >= warnAbove
        ? 'warn'
        : typeof alertAbove === 'number' || typeof warnAbove === 'number'
          ? 'ok'
          : 'none';
  const economyTone = deviation =>
    typeof economyAlertBelow === 'number' ? (deviation < economyAlertBelow ? 'alert' : 'ok') : 'none';
  const hmeTone = total =>
    typeof hmeOkFrom !== 'number'
      ? 'none'
      : total >= hmeOkFrom
        ? 'ok'
        : typeof hmeWarnFrom === 'number' && total < hmeWarnFrom
          ? 'alert'
          : 'warn';
  const SICK_WORD = { warn: 'Bevaka', alert: 'Åtgärd krävs' };
  const ECONOMY_WORD = { ok: 'Klarar budget', alert: 'Mot underskott' };
  const HME_WORD = { ok: 'Över mål', warn: 'Bevaka', alert: 'Åtgärd krävs' };

  /** The economy of one unit at the close of its latest month this year: budget, forecast and the deviation. */
  function economyOf(data, unit) {
    const rows = data.rows.filter(r => r.unit === unit).sort((a, b) => a.period.localeCompare(b.period));
    const last = rows.at(-1);
    if (!last) return undefined;
    const deviation = round1(last.budget - last.forecast);
    const tone = economyTone(deviation);
    return {
      period: last.period,
      month: monthOf(last.period),
      budget: last.budget,
      forecast: last.forecast,
      deviation,
      tone,
      ...(ECONOMY_WORD[tone] ? { assessment: ECONOMY_WORD[tone] } : {}),
      months: rows,
    };
  }

  /** HME of one unit at its latest measurement, against the one before; a group below the minimum is held back. */
  function hmeOf(data, unit) {
    const rows = data.rows.filter(r => r.unit === unit).sort((a, b) => a.year - b.year);
    const last = rows.at(-1);
    if (!last) return undefined;
    if (!(last.respondents >= minGroup))
      return { year: last.year, note: `Färre än ${minGroup} svarande. Visas inte.`, years: rows };
    const before = rows.at(-2);
    const tone = hmeTone(last.total);
    return {
      year: last.year,
      total: last.total,
      motivation: last.motivation,
      leadership: last.leadership,
      governance: last.governance,
      ...(before && before.respondents >= minGroup ? { change: last.total - before.total, since: before.year } : {}),
      tone,
      ...(HME_WORD[tone] ? { assessment: HME_WORD[tone] } : {}),
      years: rows,
    };
  }

  function requireManager(actor) {
    if (actor.role !== 'manager') throw new Denied('Bara chefer ser statistiken.');
  }

  /** The keys of a read about units (D97), checked; at most KEYS_MAX, each once. */
  function keysOf(input) {
    const keys = input.keys;
    if (
      Object.keys(input).some(k => k !== 'keys') ||
      !Array.isArray(keys) ||
      keys.length > KEYS_MAX ||
      keys.some(k => typeof k !== 'string' || !k || k.length > 256)
    )
      throw new Invalid('Ogiltig förfrågan.');
    return [...new Set(keys)];
  }

  /**
   * Which source units answer a read about units: each asked Clew unit the reader follows up (D117), with the source
   * units behind it. Any other id is no row, never a refusal (D97); the connector check holds a connector to that.
   */
  const aboutUnits = (actor, keys) => {
    const mine = followed(actor);
    return keys.filter(key => mine.has(key) && sourceUnits(key).length).map(key => ({ key, units: sourceUnits(key) }));
  };

  const updated = data => (data?.reloadedAt ? { updated: data.reloadedAt } : {});
  const dataAt = data => data?.reloadedAt ?? new Date(now()).toISOString();

  const capabilities = {
    'qlik.sickLeaveByUnit': async actor => {
      requireManager(actor);
      const units = unitsOf(actor);
      const data = await read('read', units);
      const latest = latestFor(data, units);
      const output = { rows: [], ...updated(data) };
      if (!latest) return output;
      output.rows = units.map(unit => ({
        ref: refOf(unit),
        unit: nameOf(actor, unit),
        ...present(data, unit, latest),
      }));
      return output;
    },

    'qlik.sickLeaveTrend': async (actor, input) => {
      requireManager(actor);
      const unit = unitOfRef(actor, input.unit);
      const data = await read('read', unit ? [unit] : []);
      const output = { unit: unit ? nameOf(actor, unit) : actor.unitLabel, rows: [], ...updated(data) };
      if (!unit) return output;
      const periods = [...new Set(data.rows.filter(r => r.unit === unit).map(r => r.period))].sort().reverse();
      output.rows = periods.slice(0, 12).map(period => ({ ref: 'month:' + period, ...present(data, unit, period) }));
      return output;
    },

    // A read about a unit (D97): Clew's unit ids, at most KEYS_MAX; any id the connector does not answer is no row and
    // never a refusal. Per unit the latest closed month of the first source unit with a rate to show, as the figure takes
    // it, or the first one with the reason it is not shown.
    'qlik.unit': async (actor, input) => {
      requireManager(actor);
      const asked = aboutUnits(actor, keysOf(input));
      if (!asked.length) return { rows: [] };
      const data = await read(
        'read',
        asked.flatMap(a => a.units),
      );
      const rows = [];
      for (const { key, units } of asked) {
        const latest = latestFor(data, units);
        if (!latest) continue;
        const shown = units.map(unit => ({ unit, ...present(data, unit, latest) }));
        const pick = shown.find(s => s.total !== undefined) ?? shown[0];
        const word = pick.total !== undefined ? SICK_WORD[sickTone(pick.total)] : undefined;
        rows.push({
          key,
          ref: refOf(pick.unit),
          unit: nameOf(actor, pick.unit),
          month: pick.month,
          ...(pick.total !== undefined ? { total: pick.total } : {}),
          ...(word ? { watch: word } : {}),
          ...(pick.lastYear !== undefined ? { lastYear: pick.lastYear } : {}),
          ...(pick.change !== undefined ? { change: pick.change } : {}),
          ...(pick.headcount !== undefined ? { headcount: pick.headcount } : {}),
          ...(pick.note ? { note: pick.note } : {}),
        });
      }
      return { rows };
    },

    'qlik.sickLeaveChart': async (actor, input) => {
      requireManager(actor);
      const unit = unitOfRef(actor, input.unit);
      const data = await read('read', unit ? [unit] : []);
      const periods = unit
        ? [...new Set(data.rows.filter(r => r.unit === unit).map(r => r.period))].sort().slice(-12)
        : [];
      if (!periods.length) throw new NotFound('Statistiken har inga månader för enheten.');
      const shown = periods.map(p => present(data, unit, p));
      return {
        series: {
          title: `Sjukfrånvaro per månad, ${nameOf(actor, unit)}`,
          unit: '%',
          period: `${monthOf(periods[0])} – ${monthOf(periods.at(-1))}`,
          dataAt: dataAt(data),
          axis: 'category',
          categories: periods.map(p => `${shortMonth.format(dateOf(p)).replace('.', '')} ${p.slice(0, 4)}`),
          series: [
            { id: 'total', label: 'Sjukfrånvaro', role: 'actual', values: shown.map(s => s.total ?? null) },
            {
              id: 'last-year',
              label: 'Samma månad i fjol',
              role: 'actual',
              values: shown.map(s => s.lastYear ?? null),
            },
            ...(typeof warnAbove === 'number'
              ? [{ id: 'watch', label: 'Bevaka från', role: 'target', values: periods.map(() => warnAbove) }]
              : []),
          ],
        },
      };
    },

    'qlik.economyByUnit': async actor => {
      requireManager(actor);
      const units = unitsOf(actor);
      const data = await read('economy', units);
      const rows = [];
      for (const unit of units) {
        const e = data && economyOf(data, unit);
        if (!e) continue;
        const { months, tone, ...shown } = e;
        rows.push({ ref: refOf(unit), unit: nameOf(actor, unit), ...shown });
      }
      return { rows, ...updated(data) };
    },

    'qlik.economyChart': async (actor, input) => {
      requireManager(actor);
      const unit = unitOfRef(actor, input.unit);
      const data = await read('economy', unit ? [unit] : []);
      const e = unit && data && economyOf(data, unit);
      if (!e) throw new NotFound('Statistiken har ingen ekonomi för enheten.');
      return {
        series: {
          title: `Avvikelse mot budget vid varje månads stängning, ${nameOf(actor, unit)}`,
          unit: 'mnkr',
          period: e.period.slice(0, 4),
          dataAt: dataAt(data),
          axis: 'category',
          categories: e.months.map(m => shortMonth.format(dateOf(m.period)).replace('.', '')),
          series: [
            {
              id: 'deviation',
              label: 'Avvikelse mot budget',
              role: 'actual',
              values: e.months.map(m => round1(m.budget - m.forecast)),
            },
            { id: 'balance', label: 'Budget i balans', role: 'target', values: e.months.map(() => 0) },
          ],
        },
      };
    },

    'qlik.economyUnit': async (actor, input) => {
      requireManager(actor);
      const asked = aboutUnits(actor, keysOf(input));
      if (!asked.length) return { rows: [] };
      const data = await read(
        'economy',
        asked.flatMap(a => a.units),
      );
      if (!data) return { rows: [] };
      const rows = [];
      for (const { key, units } of asked) {
        const unit = units.find(u => economyOf(data, u));
        if (!unit) continue;
        const e = economyOf(data, unit);
        rows.push({
          key,
          ref: refOf(unit),
          unit: nameOf(actor, unit),
          month: e.month,
          deviation: e.deviation,
          ...(e.assessment ? { assessment: e.assessment } : {}),
          forecast: e.forecast,
          budget: e.budget,
        });
      }
      return { rows };
    },

    'qlik.hmeByUnit': async actor => {
      requireManager(actor);
      const units = unitsOf(actor);
      const data = await read('hme', units);
      const rows = [];
      for (const unit of units) {
        const h = data && hmeOf(data, unit);
        if (!h) continue;
        const { years, tone, since, year, ...shown } = h;
        rows.push({ ref: refOf(unit), unit: nameOf(actor, unit), year: String(year), ...shown });
      }
      return { rows, ...updated(data) };
    },

    'qlik.hmeChart': async (actor, input) => {
      requireManager(actor);
      const unit = unitOfRef(actor, input.unit);
      const data = await read('hme', unit ? [unit] : []);
      const h = unit && data && hmeOf(data, unit);
      if (!h) throw new NotFound('Statistiken har ingen mätning för enheten.');
      const shown = h.years.map(y => (y.respondents >= minGroup ? y : null));
      const line = (id, label, key) => ({ id, label, role: 'actual', values: shown.map(y => (y ? y[key] : null)) });
      return {
        series: {
          title: `Hållbart medarbetarengagemang, ${nameOf(actor, unit)}`,
          unit: 'index',
          period: `${h.years[0].year} – ${h.years.at(-1).year}`,
          dataAt: dataAt(data),
          axis: 'category',
          categories: h.years.map(y => String(y.year)),
          series: [
            line('total', 'HME totalt', 'total'),
            line('motivation', 'Motivation', 'motivation'),
            line('leadership', 'Ledarskap', 'leadership'),
            line('governance', 'Styrning', 'governance'),
            ...(typeof hmeOkFrom === 'number'
              ? [{ id: 'target', label: 'Mål', role: 'target', values: h.years.map(() => hmeOkFrom) }]
              : []),
          ],
        },
      };
    },

    'qlik.hmeUnit': async (actor, input) => {
      requireManager(actor);
      const asked = aboutUnits(actor, keysOf(input));
      if (!asked.length) return { rows: [] };
      const data = await read(
        'hme',
        asked.flatMap(a => a.units),
      );
      if (!data) return { rows: [] };
      const rows = [];
      for (const { key, units } of asked) {
        const found = units.map(u => ({ unit: u, h: hmeOf(data, u) })).filter(x => x.h);
        const { unit, h } = found.find(x => x.h.total !== undefined) ?? found[0] ?? {};
        if (!h) continue;
        rows.push({
          key,
          ref: refOf(unit),
          unit: nameOf(actor, unit),
          year: String(h.year),
          ...(h.total !== undefined ? { total: h.total } : {}),
          ...(h.assessment ? { assessment: h.assessment } : {}),
          ...(h.change !== undefined ? { change: h.change } : {}),
          ...(h.note ? { note: h.note } : {}),
        });
      }
      return { rows };
    },
  };

  /**
   * An area's figure (D54) for the first of the person's units with a value to show, opening the table of units.
   * Without the rule for an area the number is the whole message, so its tone is none.
   */
  async function figure(actor, area) {
    if (actor.role !== 'manager') return null;
    const units = unitsOf(actor);
    if (area === 'sick-leave') {
      const data = await read('read', units);
      const latest = latestFor(data, units);
      if (!latest) return null;
      for (const unit of units) {
        const shown = present(data, unit, latest);
        if (shown.total === undefined) continue;
        const comparison =
          shown.lastYear === undefined
            ? shown.month
            : `${shown.month} · ${decimal.format(shown.lastYear)} % i fjol, ${signed(shown.change)}`;
        return {
          label: 'Sjukfrånvaro',
          value: `${decimal.format(shown.total)} %`,
          comparison,
          tone: sickTone(shown.total),
          opens: 'qlik.sickLeaveByUnit',
        };
      }
      return null;
    }
    if (area === 'economy') {
      const data = await read('economy', units);
      const e = data && units.map(u => economyOf(data, u)).find(Boolean);
      if (!e) return null;
      return {
        label: 'Ekonomi, avvikelse mot budget',
        value: `${signed(e.deviation)} mnkr`,
        comparison: `Helårsprognos mot helårsbudget · ${e.month}`,
        tone: e.tone,
        opens: 'qlik.economyByUnit',
      };
    }
    if (area === 'hme') {
      const data = await read('hme', units);
      const h = data && units.map(u => hmeOf(data, u)).find(x => x?.total !== undefined);
      if (!h) return null;
      return {
        label: 'HME',
        value: String(h.total),
        comparison:
          h.change === undefined ? `Mätår ${h.year}` : `Mätår ${h.year} · ${signed(h.change, String)} sedan ${h.since}`,
        tone: h.tone,
        opens: 'qlik.hmeByUnit',
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
