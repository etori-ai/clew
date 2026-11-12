// The payroll fixture's handlers and HTTP boundary. manifest.mjs owns the contract. Clew never writes here: payroll
// reads the HR system itself, once a night, through the HR fixture's feed (D55 item 8, propagation stays in the
// systems), so Clew only watches that a sick report shows up and says so when it does not. A report registered in the HR
// system reaches payroll the day after it was made; nothing a person does in Clew moves it faster.
import { employees } from './fixture.mjs';
import { createVerifier } from './verification.mjs';
import { manifest, CONNECTOR } from './manifest.mjs';
import { memoryState } from './state.mjs';

export { manifest };

class Denied extends Error {}

export const FAULTS = ['', 'unavailable', 'slow', 'unauthorized'];
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const fail = (code, message, status) => json({ error: { code, message } }, status);
const dateIn = date => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm' }).format(date);
const shortDate = day =>
  new Intl.DateTimeFormat('sv-SE', { day: 'numeric', month: 'short' }).format(new Date(day + 'T12:00:00'));

/** The feed over HTTP: the HR fixture's `GET /fixture/absences` behind its key. `createConnector` takes any `feed` function. */
export function httpFeed({ url, key, fetch: fetchImpl = globalThis.fetch }) {
  if (!url) throw new Error('HR_FEED_URL is required: payroll imports from the HR system');
  return async () => {
    const response = await fetchImpl(url, {
      headers: { 'x-fixture-key': key ?? '' },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error('The HR feed answered ' + response.status);
    const body = await response.json();
    return Array.isArray(body.rows) ? body.rows : [];
  };
}

export function createConnector({
  secret,
  jwks,
  clewUrl = process.env.CLEW_URL ?? '',
  fetch: fetchImpl = globalThis.fetch,
  state = memoryState(),
  clock = () => new Date(),
  fault = '',
  unitMap = {},
  feed = async () => [],
} = {}) {
  if (!FAULTS.includes(fault)) throw new Error(`FIXTURE_FAULT must be one of ${FAULTS.filter(Boolean).join(', ')}`);
  const verify = createVerifier({ secret, jwks, clewUrl, fetch: fetchImpl }, CONNECTOR);
  const today = () => dateIn(clock());
  const unitOf = actor => unitMap[actor.unitId] ?? actor.unitId;
  const staff = actor => employees.filter(e => e.unitId === unitOf(actor));
  const requirePerson = (actor, person) => {
    if (!staff(actor).some(e => e.ref === person)) throw new Denied('Du saknar behörighet för medarbetaren.');
  };

  /** What the nightly import has brought over: every report the HR system registered before today. */
  async function imported(actor) {
    const day = today();
    const rows = await feed();
    const allowed = new Set(staff(actor).map(e => e.ref));
    return rows.filter(r => allowed.has(r.person) && typeof r.at === 'string' && dateIn(new Date(r.at)) < day);
  }

  const reads = {
    'payroll.absences': async actor => ({
      rows: (await imported(actor)).map(r => ({
        ref: r.ref,
        person: r.person,
        from: r.from,
        to: r.to,
        extent: r.extent,
        importedAt: dateIn(new Date(r.at)),
      })),
    }),
    'payroll.absenceStatus': async (actor, input) => {
      requirePerson(actor, input.person);
      const hit = (await imported(actor)).find(
        r => r.person === input.person && r.from <= input.date && r.to >= input.date,
      );
      return {
        status: hit ? 'registered' : 'pending',
        person: input.person,
        date: input.date,
        checkedAt: clock().toISOString(),
      };
    },
    'payroll.followAbsence': async (actor, input) => {
      const a = input.fact.attributes;
      if (typeof a.person !== 'string' || typeof a.from !== 'string') return { steps: [] };
      requirePerson(actor, a.person);
      return {
        steps: [
          {
            kind: 'watch',
            operation: 'payroll.absenceStatus',
            input: { person: a.person, date: a.from },
            expect: { path: ['status'], equals: 'registered' },
            within: 'P1D',
            title: 'Bevakas i lönesystemet',
            detail: `Lönesystemet läser personalsystemet varje natt; sjukanmälan ${shortDate(a.from)} ska synas där.`,
          },
        ],
      };
    },
  };

  async function handle(request) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/clew/manifest') return json(manifest);
    if (request.method !== 'POST' || !url.pathname.startsWith('/clew/')) return fail('not-found', 'Okänd adress.', 404);
    if (fault === 'unavailable') return fail('unavailable', 'Lönesystemet svarar inte just nu.', 503);
    if (fault === 'slow') await new Promise(resolve => setTimeout(resolve, 1500));
    if (fault === 'unauthorized') return fail('denied', 'Lönesystemet godtar inte anslutningens behörighet.', 401);
    const token = (request.headers.get('authorization') ?? '').replace(/^Bearer /, '');
    const actor = await verify(token, request.headers.get('x-clew-connector-key'), request);
    if (!actor) return fail('denied', 'Ogiltigt behörighetsbevis.', 401);
    let body;
    try {
      body = await request.json();
    } catch {
      return fail('invalid', 'Ogiltig förfrågan.', 400);
    }
    if (url.pathname === '/clew/scan') return json({ drafts: [] });
    if (url.pathname === '/clew/figure') return json({ figure: null });
    const name = decodeURIComponent(url.pathname.slice('/clew/capabilities/'.length));
    const declared = manifest.capabilities.find(c => c.name === name);
    if (!declared || !reads[name]) return fail('not-found', 'Okänd förmåga.', 404);
    if (declared.scope.roles && !declared.scope.roles.includes(actor.role))
      return fail('denied', 'Du saknar behörighet för åtgärden.', 403);
    try {
      const input = body && typeof body.input === 'object' && body.input ? body.input : {};
      return json({ output: await reads[name](actor, input) });
    } catch (error) {
      if (error instanceof Denied) return fail('denied', error.message, 403);
      // The HR feed is down: payroll cannot say, and says so, rather than inventing a status.
      console.error(error);
      return fail('unavailable', 'Lönesystemet svarar inte just nu.', 503);
    }
  }

  return { manifest, handle, close: () => state.close() };
}
