// The incidents fixture's handlers and HTTP boundary. manifest.mjs owns the contract, fixture.mjs the generated records,
// state.mjs the store. Independently runnable with Node; imports nothing from the rest of the repository (D21).
import { createHash } from 'node:crypto';
import { createVerifier } from './verification.mjs';
import { manifest, CONNECTOR } from './manifest.mjs';
import { dateIn, seed, shortDate } from './fixture.mjs';
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
  const records = () => state.get('records');

  const unitOf = actor => unitMap[actor.unitId] ?? actor.unitId;
  const personOf = actor => personMap[actor.id] ?? actor.id;
  const personKey = actor => unitOf(actor) + ':' + personOf(actor);
  const own = actor => records().employees.find(e => e.personId === personOf(actor));
  const managerOf = (actor, unitId) => actor.role === 'manager' && unitOf(actor) === unitId;
  /** Reports filed through Clew, the system's own records beside the seeded deviations. */
  const reports = () => state.get('reports', []);
  const openDeviations = unitId => records().deviations.filter(d => d.unitId === unitId && d.state !== 'closed');

  const reads = {
    'incidents.deviations': actor => {
      const me = own(actor);
      const unitId = managerOf(actor, unitOf(actor)) ? unitOf(actor) : me?.unitId;
      if (!unitId) return { rows: [] };
      const manager = managerOf(actor, unitId);
      const rows = openDeviations(unitId)
        .filter(d => manager || d.reportedBy === me?.ref)
        .map(d => ({
          ref: d.ref,
          title: d.title,
          state: d.state,
          ...(d.waitingOn ? { waitingOn: d.waitingOn } : {}),
          ...(d.dueBy ? { dueBy: d.dueBy } : {}),
        }));
      for (const r of reports().filter(r => r.unitId === unitId && (manager || r.by === me?.ref)))
        rows.push({ ref: r.ref, title: r.title, state: 'open', waitingOn: 'chefens bedömning' });
      return { rows };
    },
    'incidents.lookup': (actor, input) => {
      const op = state.get('op:' + input.operationId);
      return op && op.person === personKey(actor) ? { found: true, result: op.result } : { found: false };
    },
  };

  const writes = {
    'incidents.report': (actor, input) => {
      if (fault === 'conflict')
        return {
          headline: 'Avvikelsesystemet tog inte emot rapporten.',
          rows: [
            {
              ref: 'incidents:dev:none',
              label: input.title,
              outcome: 'failed',
              detail: 'ändrad av någon annan, försök igen',
            },
          ],
        };
      const filed = reports();
      const me = own(actor);
      const ref = `incidents:dev:${today().slice(0, 4)}-${1200 + filed.length}`;
      filed.push({
        ref,
        by: me?.ref ?? personOf(actor),
        unitId: me?.unitId ?? unitOf(actor),
        title: input.title,
        text: input.text,
        at: now(),
      });
      state.set('reports', filed);
      return {
        headline: 'Avvikelsen är skickad till avvikelsesystemet. Din chef får den i sitt flöde.',
        rows: [{ ref, label: input.title, outcome: 'done', detail: 'registrerad i avvikelsesystemet' }],
        undoCapability: 'incidents.withdraw',
        undoMinutes: 10,
      };
    },
    'incidents.withdraw': (actor, input) => {
      const me = own(actor);
      const filed = reports();
      const mine = filed.filter(
        r => input.refs.includes(r.ref) && (r.by === (me?.ref ?? personOf(actor)) || managerOf(actor, r.unitId)),
      );
      state.set(
        'reports',
        filed.filter(r => !mine.includes(r)),
      );
      return {
        headline: 'Rapporten är borttagen.',
        rows: input.refs.map(ref => ({
          ref,
          label: 'Avvikelse',
          outcome: mine.some(r => r.ref === ref) ? 'done' : 'failed',
          detail: mine.some(r => r.ref === ref) ? 'borttagen i avvikelsesystemet' : 'inte din rapport',
        })),
      };
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
      const result = writes[name](actor, input);
      if (operationId) state.set('op:' + operationId, { person: personKey(actor), name, digest, result, at: now() });
      return result;
    });
  }

  function scan(actor) {
    const drafts = [];
    const unitId = unitOf(actor);
    if (managerOf(actor, unitId)) {
      for (const d of records().deviations.filter(d => d.unitId === unitId && d.state === 'waiting-safety-rep'))
        drafts.push({
          topic: `incidents:dev:${d.ref}`,
          area: 'work-environment',
          title: d.title,
          summary: `Väntar på ${d.waitingOn}.`,
          reason: `Rapporterat ${shortDate(d.reportedAt.slice(0, 10))}`,
          waitingOn: d.waitingOn ?? null,
          deadline: d.dueBy ?? null,
          actions: [],
        });
      for (const r of reports().filter(r => r.unitId === unitId))
        drafts.push({
          topic: `incidents:report:${r.ref}`,
          area: 'work-environment',
          title: `Ny avvikelse: ${r.title}`,
          summary: r.text.slice(0, 160),
          reason: `Rapporterad ${new Date(r.at).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' })}`,
          items: [{ ref: r.ref, label: r.title, detail: 'väntar på din bedömning', selectable: false, selected: true }],
          actions: [],
        });
    }
    const me = own(actor);
    if (me && actor.role === 'employee')
      for (const d of records().deviations.filter(d => d.reportedBy === me.ref && d.state !== 'closed'))
        drafts.push({
          // The employee's own report is followed under the HR system's area for the person's day, as before the port.
          topic: `incidents:mine:${d.ref}`,
          area: 'my-shift',
          title: d.title,
          summary: `Väntar på ${d.waitingOn}.`,
          reason: `Du rapporterade ${shortDate(d.reportedAt.slice(0, 10))}`,
          waitingOn: d.waitingOn ?? null,
          actions: [],
        });
    return drafts.map(d => ({
      ...d,
      occurrences: d.items?.length
        ? d.items.map(i => ({ key: i.ref, revision: hash([i.label, i.detail, d.summary, d.actions]), period: 'once' }))
        : [{ key: d.topic, revision: hash(d), period: 'once' }],
    }));
  }

  function figure(actor, area) {
    if (area !== 'work-environment' || !managerOf(actor, unitOf(actor))) return null;
    const open = openDeviations(unitOf(actor)).length + reports().filter(r => r.unitId === unitOf(actor)).length;
    return {
      label: open === 0 ? 'Inga öppna avvikelser' : open === 1 ? '1 öppen avvikelse' : `${open} öppna avvikelser`,
      tone: open ? 'warn' : 'ok',
    };
  }

  async function handle(request) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/clew/manifest') return json(manifest);
    if (request.method !== 'POST' || !url.pathname.startsWith('/clew/')) return fail('not-found', 'Okänd adress.', 404);
    if (fault === 'unavailable') return fail('unavailable', 'Avvikelsesystemet svarar inte just nu.', 503);
    if (fault === 'slow') await new Promise(resolve => setTimeout(resolve, 1500));
    if (fault === 'unauthorized') return fail('denied', 'Avvikelsesystemet godtar inte anslutningens behörighet.', 401);
    const token = (request.headers.get('authorization') ?? '').replace(/^Bearer /, '');
    const actor = await verify(token, request.headers.get('x-clew-connector-key'));
    if (!actor) return fail('denied', 'Ogiltigt behörighetsbevis.', 401);
    let body;
    try {
      body = await request.json();
    } catch {
      return fail('invalid', 'Ogiltig förfrågan.', 400);
    }
    try {
      if (url.pathname === '/clew/scan') {
        const drafts = scan(actor);
        return json({
          drafts,
          observation: {
            scope: unitOf(actor) + ':' + actor.role,
            observedAt: now(),
            version: hash(drafts),
            completeness: 'complete',
            exhausted: true,
          },
        });
      }
      if (url.pathname === '/clew/figure') return json({ figure: figure(actor, body.area) });
      const name = decodeURIComponent(url.pathname.slice('/clew/capabilities/'.length));
      const declared = manifest.capabilities.find(c => c.name === name);
      if (!declared) return fail('not-found', 'Okänd förmåga.', 404);
      if (declared.scope.roles && !declared.scope.roles.includes(actor.role))
        return fail('denied', 'Du saknar behörighet för åtgärden.', 403);
      const input = body && typeof body.input === 'object' && body.input ? body.input : {};
      let output;
      if (reads[name]) output = reads[name](actor, input);
      else {
        output = execute(actor, name, input, request.headers.get('x-clew-operation-id') ?? undefined);
        if (fault === 'crash-after-commit') return fail('unavailable', 'Avvikelsesystemet svarar inte just nu.', 503);
      }
      return json({ output });
    } catch (error) {
      if (error instanceof Invalid) return fail('invalid', error.message, 400);
      if (error instanceof Conflict) return fail('invalid', error.message, 409);
      console.error(error);
      return fail('unavailable', 'Avvikelsesystemet svarar inte just nu.', 503);
    }
  }

  return { manifest, handle, close: () => state.close() };
}
