// The phone book as a Clew connector: a pass-through with reads only. It shows what a find-and-look integration needs
// from the connector protocol (docs/architecture/connector-protocol.md): a search source for the composite search
// (D26), and declared views (D38) so Clew draws the table, the team list and the contact card itself, with or without
// a model. Nothing here is markup; the connector says what the fields are and Clew decides how they look.
// No dependencies beyond Node. The phone book's own API lives behind the port in directory.mjs.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { DirectoryUnavailable, createFixtureDirectory } from './directory.mjs';

const CONNECTOR = 'telefonbok';
const SOURCE = 'Telefonboken';
const LIMIT = 50;
const REF = '^person:[A-Za-z0-9_.@-]{1,80}$';

const str = { type: 'string' };
// A person as a row: work contact details only. The contract has no private field to leak.
const Person = { type: 'object', properties: { ref: str, name: str, title: str, unit: str, phone: str, mobile: str, email: str }, required: ['ref', 'name', 'title', 'unit'] };
const Card = { type: 'object', properties: { ...Person.properties, room: str, manager: str, link: str }, required: ['ref', 'name', 'title', 'unit'] };
const Hit = { type: 'object', properties: { ref: str, kind: str, label: str, snippet: str, link: str, source: str }, required: ['ref', 'kind', 'label', 'snippet', 'source'] };
const RefInput = { type: 'object', properties: { ref: { type: 'string', pattern: REF } }, required: ['ref'], additionalProperties: false };
// What a row opens, in every view: the contact card of the same connector.
const openCard = { capability: 'telefonbok.person', title: 'Kontaktkort', params: { ref: 'ref' } };
const contact = [{ key: 'phone', label: 'Telefon', format: 'phone' }, { key: 'mobile', label: 'Mobil', format: 'phone' }, { key: 'email', label: 'E-post', format: 'email' }];

export const manifest = {
  protocol: 1, id: CONNECTOR, kind: 'passthrough', source: SOURCE,
  // The area puts both reads under "Gör själv" and as chips under the box for everyone in the connector's audience:
  // each person's own team list is one click away without anyone composing a page.
  areas: [{ id: 'kontakter', title: 'Kontakter', roles: ['manager', 'employee'], standing: ['telefonbok.team', 'telefonbok.directory'], schedules: [] }],
  capabilities: [
    { name: 'telefonbok.directory', kind: 'read', title: 'Sök i telefonboken', model: true, scope: {},
      description: 'Söker kollegor i hela organisationen eller på den egna enheten, på namn, titel eller enhet. Träffarna visas för personen som en tabell med telefon och e-post.',
      input: { type: 'object', properties: { query: { type: 'string', maxLength: 80 }, scope: { type: 'string', enum: ['all', 'unit'] } }, additionalProperties: false },
      output: { type: 'object', properties: { rows: { type: 'array', items: Person } }, required: ['rows'] },
      view: { kind: 'table', title: 'name', ref: 'ref', open: openCard, modelReads: 'summary', empty: 'Inga träffar i telefonboken.',
        fields: [{ key: 'name', label: 'Namn' }, { key: 'title', label: 'Titel' }, { key: 'unit', label: 'Enhet' }, ...contact],
        input: { query: { key: 'query', label: 'Sök i telefonboken', placeholder: 'Namn, titel eller enhet' },
          filter: { key: 'scope', label: 'Sök i', options: [{ value: 'all', label: 'Hela organisationen' }, { value: 'unit', label: 'Min enhet' }] } } } },
    { name: 'telefonbok.team', kind: 'read', title: 'Mitt teams kontaktlista', model: true, scope: {},
      description: 'Kontaktuppgifter till alla på den inloggades enhet. Listan visas för personen i en vy.',
      input: { type: 'object', properties: {}, additionalProperties: false },
      output: { type: 'object', properties: { unit: str, rows: { type: 'array', items: Person } }, required: ['unit', 'rows'] },
      view: { kind: 'list', title: 'name', ref: 'ref', open: openCard, modelReads: 'summary', empty: 'Telefonboken har ingen på din enhet.',
        fields: [{ key: 'name', label: 'Namn' }, { key: 'title', label: 'Titel' }, ...contact] } },
    { name: 'telefonbok.person', kind: 'read', title: 'Kontaktkort', model: false, scope: {},
      description: 'Arbetsrelaterade kontaktuppgifter för en kollega: telefon, e-post, rum, enhet och chef.',
      input: RefInput, output: Card,
      view: { kind: 'detail', title: 'name', modelReads: 'summary',
        fields: [{ key: 'title', label: 'Titel' }, { key: 'unit', label: 'Enhet' }, ...contact, { key: 'room', label: 'Rum' }, { key: 'manager', label: 'Chef' }, { key: 'link', label: 'Öppna i telefonboken', format: 'link' }] } },
    // The search source (D26): what the box finds when someone types a name. The hit says who and where, not the number;
    // the number is in the contact card the hit opens, so it reaches the person and not the model or the stored answer.
    { name: 'telefonbok.search', kind: 'read', title: 'Sök person', model: true, scope: {}, kinds: ['person'],
      description: 'Hittar kollegor på namn, titel eller enhet.',
      input: { type: 'object', properties: { query: { type: 'string', minLength: 1, maxLength: 200 } }, required: ['query'], additionalProperties: false },
      output: { type: 'object', properties: { rows: { type: 'array', items: Hit } }, required: ['rows'] },
      view: { kind: 'list', title: 'label', ref: 'ref', open: openCard, fields: [{ key: 'label', label: 'Namn' }, { key: 'snippet', label: 'Titel och enhet' }] } },
    { name: 'telefonbok.fetch', kind: 'read', title: 'Hämta person', model: false, scope: {},
      description: 'En träff från en tidigare sökning, hämtad igen.', input: RefInput, output: Hit },
  ],
  scan: false,
};

// --- the assertion Clew sends: HS256 JWT, iss "clew", aud = this connector id, sub = the person id.
const b64 = s => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
export function verifyAssertion(token, secret, now = Date.now()) {
  const [h, p, s] = String(token).split('.');
  if (!h || !p || !s) return null;
  const expected = createHmac('sha256', secret).update(`${h}.${p}`).digest();
  const given = b64(s);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let header, payload;
  try { header = JSON.parse(b64(h).toString()); payload = JSON.parse(b64(p).toString()); } catch { return null; }
  if (header.alg !== 'HS256' || payload.iss !== 'clew' || payload.aud !== CONNECTOR || !payload.exp || payload.exp * 1000 < now) return null;
  if (!payload.actor || payload.actor.id !== payload.sub) return null;
  return payload.actor;
}

class Invalid extends Error {}
class NotFound extends Error {}
const refOf = id => 'person:' + id;
const idOf = ref => { if (typeof ref !== 'string' || !new RegExp(REF).test(ref)) throw new Invalid('Ogiltig referens.'); return ref.slice('person:'.length); };
const row = p => ({ ref: refOf(p.id), name: p.name, title: p.title, unit: p.unit, ...(p.phone ? { phone: p.phone } : {}), ...(p.mobile ? { mobile: p.mobile } : {}), ...(p.email ? { email: p.email } : {}) });
const hit = p => ({ ref: refOf(p.id), kind: 'person', label: p.name, snippet: [p.title, p.unit].filter(Boolean).join(' · '), source: SOURCE, ...(p.link ? { link: p.link } : {}) });

/**
 * Build the service. `directory` is the phone book behind its port (directory.mjs); the fixture when none is given.
 * `unitMap` translates Clew's unit ids to the phone book's when they differ: Clew knows a person's unit from its own
 * grants, and "my team" is whoever the phone book has on that unit.
 */
export function createConnector({ secret, directory = createFixtureDirectory(), unitMap = {} } = {}) {
  if (!secret) throw new Error('A shared secret is required (CLEW_CONNECTOR_SECRET).');
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fail = (code, message, status) => json({ error: { code, message } }, status);
  const unitOf = actor => unitMap[actor.unitId] ?? actor.unitId;

  const capabilities = {
    'telefonbok.directory': async (actor, input) => {
      const query = typeof input.query === 'string' ? input.query.trim() : '';
      if (query.length > 80 || (input.scope !== undefined && input.scope !== 'all' && input.scope !== 'unit')) throw new Invalid('Ogiltig sökning.');
      return { rows: (await directory.search(query, { ...(input.scope === 'unit' ? { unit: unitOf(actor) } : {}), limit: LIMIT })).map(row) };
    },
    'telefonbok.team': async actor => ({ unit: actor.unitLabel, rows: (await directory.search('', { unit: unitOf(actor), limit: LIMIT })).map(row) }),
    'telefonbok.person': async (actor, input) => {
      const p = await directory.person(idOf(input.ref));
      if (!p) throw new NotFound('Personen finns inte i telefonboken.');
      return { ...row(p), ...(p.room ? { room: p.room } : {}), ...(p.manager ? { manager: p.manager } : {}), ...(p.link ? { link: p.link } : {}) };
    },
    'telefonbok.search': async (actor, input) => {
      const query = typeof input.query === 'string' ? input.query.trim() : '';
      if (!query || query.length > 200) throw new Invalid('Ogiltig sökning.');
      return { rows: (await directory.search(query, { limit: 10 })).map(hit) };
    },
    'telefonbok.fetch': async (actor, input) => {
      const p = await directory.person(idOf(input.ref));
      if (!p) throw new NotFound('Personen finns inte i telefonboken.');
      return hit(p);
    },
  };

  async function handle(request) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/clew/manifest') return json(manifest);
    if (request.method !== 'POST' || !url.pathname.startsWith('/clew/')) return fail('not-found', 'Okänd adress.', 404);
    const token = (request.headers.get('authorization') ?? '').replace(/^Bearer /, '');
    const actor = verifyAssertion(token, secret);
    if (!actor) return fail('denied', 'Ogiltigt behörighetsbevis.', 401);
    let body; try { body = await request.json(); } catch { return fail('invalid', 'Ogiltig förfrågan.', 400); }
    if (url.pathname === '/clew/scan') return json({ drafts: [] });
    if (url.pathname === '/clew/figure') return json({ figure: null });
    const name = decodeURIComponent(url.pathname.slice('/clew/capabilities/'.length));
    const capability = capabilities[name];
    if (!capability) return fail('not-found', 'Okänd förmåga.', 404);
    try { return json({ output: await capability(actor, body && typeof body.input === 'object' && body.input ? body.input : {}) }); }
    catch (error) {
      if (error instanceof Invalid) return fail('invalid', error.message, 400);
      if (error instanceof NotFound) return fail('not-found', error.message, 404);
      // Nothing of the phone book's own error text is passed on: it may name the system's internals.
      if (!(error instanceof DirectoryUnavailable)) console.error(error);
      return fail('unavailable', 'Telefonboken svarar inte just nu.', 503);
    }
  }
  return { manifest, handle };
}
