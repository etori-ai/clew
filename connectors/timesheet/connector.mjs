// The time-reporting fixture's handlers and HTTP boundary. manifest.mjs owns the contract, fixture.mjs the roster,
// state.mjs the store. Independently runnable with Node; imports nothing from the rest of the repository (D21).
import { createHash } from 'node:crypto';
import { createVerifier } from './verification.mjs';
import { manifest, CONNECTOR } from './manifest.mjs';
import { dateIn, seed, shortDate, staffOf, substitutesOf } from './fixture.mjs';
import { memoryState } from './state.mjs';

export { manifest };

class Invalid extends Error {}
class Conflict extends Error {}
export const FAULTS = ['', 'unavailable', 'slow', 'unauthorized', 'conflict', 'crash-after-commit'];

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const fail = (code, message, status) => json({ error: { code, message } }, status);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function createConnector({
  secret,
  jwks,
  clewUrl = process.env.CLEW_URL ?? '',
  fetch: fetchImpl = globalThis.fetch,
  state = memoryState(),
  clock = () => new Date(),
  fault = '',
  unitMap = {},
  personMap = {},
  fresh = false,
} = {}) {
  if (!FAULTS.includes(fault)) throw new Error(`FIXTURE_FAULT must be one of ${FAULTS.filter(Boolean).join(', ')}`);
  const verify = createVerifier({ secret, jwks, clewUrl, fetch: fetchImpl }, CONNECTOR);
  const today = () => dateIn(clock());
  const now = () => clock().toISOString();
  if (fresh) for (const key of state.keys('')) state.delete(key);
  if (!state.get('records')) state.set('records', seed(today()));
  const shifts = () => state.get('records').shifts;

  const unitOf = actor => unitMap[actor.unitId] ?? actor.unitId;
  const personOf = actor => personMap[actor.id] ?? actor.id;
  const personKey = actor => unitOf(actor) + ':' + personOf(actor);
  /** The days marked as absence through Clew, keyed by the operation that marked them. */
  const marked = () => state.get('absences', {});
  // The units the person leads (D149), as Clew signs them into the actor of every manager: `leads`. `role` says only
  // that the person is a manager, which someone people report to is without leading a unit, and `unitId` is the unit
  // they are employed on, which need not be one they lead. The roster and the unit rule of the writes cover every
  // unit in `leads`, as the HR fixture's do, and no unit when the list is empty or absent.
  const managedUnits = actor =>
    (Array.isArray(actor.leads) ? actor.leads : [])
      .filter(u => u && typeof u.unitId === 'string' && u.unitId)
      .map(u => unitMap[u.unitId] ?? u.unitId);
  /**
   * The one unit a figure is about (D54): the unit the person is employed on when they lead it, else the first they
   * lead. It is the unit Clew says Läget of, so the figure and the heading over it are about the same unit.
   */
  const ledUnit = actor => {
    const units = managedUnits(actor);
    return units.includes(unitOf(actor)) ? unitOf(actor) : units[0];
  };
  /** Whether the person is on the staff of a unit the actor manages, as the time system registers it. */
  const inUnit = (actor, person) => managedUnits(actor).some(unit => (staffOf[unit] ?? []).includes(person));
  /** The person's shift on a day in a unit the actor manages; a shift in another unit is not theirs to see. */
  const shiftOf = (actor, person, date) => {
    const units = managedUnits(actor);
    const s = shifts().find(s => s.employee === person && s.date === date && units.includes(s.unitId));
    return s ? `${s.start}–${s.end} på ${s.ward}` : null;
  };
  const receipt = row => ({
    headline: 'Passet är markerat som frånvaro i tidrapporteringen.',
    rows: [
      {
        ref: row.ref,
        label: 'Frånvaro',
        outcome: 'done',
        detail: `${shortDate(row.date)}${row.shift ? ', ' + row.shift : ''}, markerad i tidrapporteringen`,
      },
    ],
    undoCapability: 'timesheet.unmarkAbsence',
    undoMinutes: 10,
  });

  const reads = {
    'timesheet.today': actor => {
      const date = today();
      const away = Object.values(marked());
      const units = managedUnits(actor);
      return {
        date,
        rows: shifts()
          .filter(s => s.date === date && units.includes(s.unitId))
          .map(s => ({
            ref: `timesheet:shift:${s.employee.split(':').pop()}:${s.date}`,
            person: s.employee,
            start: s.start,
            end: s.end,
            ward: s.ward,
            absent: away.some(a => a.person === s.employee && a.date === s.date),
          })),
      };
    },
    'timesheet.lookup': (actor, input) => {
      const op = state.get('op:' + input.operationId);
      return op && op.person === personKey(actor) ? { found: true, result: op.result } : { found: false };
    },
  };

  const proposals = {
    'timesheet.followAbsence': (actor, input) => {
      const a = input.fact.attributes;
      if (typeof a.person !== 'string' || typeof a.from !== 'string') return { steps: [] };
      const shift = shiftOf(actor, a.person, a.from);
      return {
        steps: [
          {
            kind: 'execute',
            operation: 'timesheet.markAbsence',
            payload: { person: a.person, date: a.from },
            title: 'Passet markeras frånvaro',
            detail: shift ? `${shortDate(a.from)}, ${shift}` : `${shortDate(a.from)}, ingen schemarad den dagen`,
          },
        ],
      };
    },
  };

  const writes = {
    // A write answers for the units the actor manages: someone outside them is a failed row, no shift told.
    'timesheet.markAbsence': (actor, input, operationId) => {
      const failed = (headline, detail) => ({
        headline,
        rows: [
          {
            ref: `timesheet:shift:${input.person.split(':').pop()}:${input.date}`,
            label: 'Frånvaro',
            outcome: 'failed',
            detail,
          },
        ],
      });
      if (fault === 'conflict')
        return failed(
          'Schemaraden har ändrats i tidrapporteringen.',
          'ändrad av någon annan, läs tillbaka och försök igen',
        );
      if (!inUnit(actor, input.person)) return failed('Passet kunde inte markeras som frånvaro.', 'inte i din enhet');
      const rows = marked();
      const key = operationId ?? `${input.person}:${input.date}`;
      if (rows[key]) return receipt(rows[key]);
      const row = {
        ref: `timesheet:absence:${input.person.split(':').pop()}:${input.date}`,
        person: input.person,
        date: input.date,
        shift: shiftOf(actor, input.person, input.date),
        at: now(),
      };
      rows[key] = row;
      state.set('absences', rows);
      return receipt(row);
    },
    'timesheet.unmarkAbsence': (actor, input) => {
      const rows = marked();
      const answered = input.refs.map(ref => {
        const keys = Object.keys(rows).filter(key => rows[key].ref === ref && inUnit(actor, rows[key].person));
        // A mark outside the unit answers as one that does not exist, so whether it does is not told.
        if (keys.length === 0)
          return { ref, label: 'Frånvaro', outcome: 'failed', detail: 'finns inte i tidrapporteringen' };
        for (const key of keys) delete rows[key];
        return { ref, label: 'Frånvaro', outcome: 'done', detail: 'borttagen i tidrapporteringen' };
      });
      state.set('absences', rows);
      const any = answered.some(r => r.outcome === 'done');
      return { headline: any ? 'Markeringen är borttagen.' : 'Markeringen kunde inte tas bort.', rows: answered };
    },
  };

  function execute(actor, name, input, operationId) {
    return state.transaction(() => {
      const digest = hash({ person: personKey(actor), name, input });
      if (operationId) {
        const existing = state.get('op:' + operationId);
        if (existing) {
          if (existing.person !== personKey(actor) || existing.digest !== digest)
            throw new Conflict('Beslutet gäller annat innehåll.');
          return existing.result;
        }
      }
      const result = writes[name](actor, input, operationId);
      if (operationId) state.set('op:' + operationId, { person: personKey(actor), name, digest, result, at: now() });
      return result;
    });
  }

  // The figure (D54): today's booked substitutes on the unit, and whether a shift marked absent is still without a
  // person. One unit's, never a sum over every unit the person leads.
  function figure(actor, area) {
    const unit = ledUnit(actor);
    if (area !== 'staffing' || !unit) return null;
    const date = today();
    const mine = shifts().filter(s => s.date === date && s.unitId === unit);
    if (!mine.length) return { label: 'Inga pass i dag.', tone: 'none' };
    const open = Object.values(marked()).filter(a => a.date === date && mine.some(s => s.employee === a.person)).length;
    return {
      label: 'Vikarier i dag',
      value: String(substitutesOf[unit] ?? 0),
      comparison: open ? (open === 1 ? '1 pass obemannat' : `${open} pass obemannade`) : 'alla pass bemannade',
      tone: open ? 'warn' : 'ok',
    };
  }

  async function handle(request) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/clew/manifest') return json(manifest);
    if (request.method !== 'POST' || !url.pathname.startsWith('/clew/')) return fail('not-found', 'Okänd adress.', 404);
    if (fault === 'unavailable') return fail('unavailable', 'Tidrapporteringen svarar inte just nu.', 503);
    if (fault === 'slow') await new Promise(resolve => setTimeout(resolve, 1500));
    if (fault === 'unauthorized') return fail('denied', 'Tidrapporteringen godtar inte anslutningens behörighet.', 401);
    const token = (request.headers.get('authorization') ?? '').replace(/^Bearer /, '');
    const actor = await verify(token, request.headers.get('x-clew-connector-key'), request);
    if (!actor) return fail('denied', 'Ogiltigt behörighetsbevis.', 401);
    let body;
    try {
      body = await request.json();
    } catch {
      return fail('invalid', 'Ogiltig förfrågan.', 400);
    }
    try {
      if (url.pathname === '/clew/scan') return json({ drafts: [] });
      if (url.pathname === '/clew/figure') return json({ figure: figure(actor, body.area) });
      const name = decodeURIComponent(url.pathname.slice('/clew/capabilities/'.length));
      const declared = manifest.capabilities.find(c => c.name === name);
      if (!declared) return fail('not-found', 'Okänd förmåga.', 404);
      if (declared.scope.roles && !declared.scope.roles.includes(actor.role))
        return fail('denied', 'Du saknar behörighet för åtgärden.', 403);
      const input = body && typeof body.input === 'object' && body.input ? body.input : {};
      let output;
      if (reads[name]) output = reads[name](actor, input);
      else if (proposals[name]) output = proposals[name](actor, input);
      else {
        output = execute(actor, name, input, request.headers.get('x-clew-operation-id') ?? undefined);
        if (fault === 'crash-after-commit') return fail('unavailable', 'Tidrapporteringen svarar inte just nu.', 503);
      }
      return json({ output });
    } catch (error) {
      if (error instanceof Invalid) return fail('invalid', error.message, 400);
      if (error instanceof Conflict) return fail('invalid', error.message, 409);
      console.error(error);
      return fail('unavailable', 'Tidrapporteringen svarar inte just nu.', 503);
    }
  }

  return { manifest, handle, close: () => state.close() };
}
