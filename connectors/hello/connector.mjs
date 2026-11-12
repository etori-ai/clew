// A small protocol demonstration with no dependencies beyond Node. Keep the companion verification.mjs when copying.
// See docs/reference/connector-protocol.md. Its in-memory writes are not a durability or source-access reference.
import { createVerifier, callbackFor, b64 } from './verification.mjs';
import { createHash } from 'node:crypto';

const CONNECTOR = 'hello';
const Empty = { type: 'object', properties: {}, additionalProperties: false };
const Refs = {
  type: 'object',
  properties: { refs: { type: 'array', items: { type: 'string', pattern: '^hello:item:' }, maxItems: 50 } },
  required: ['refs'],
  additionalProperties: false,
};

export const manifest = {
  protocol: 3,
  id: CONNECTOR,
  kind: 'passthrough',
  source: 'Hello',
  areas: [
    {
      id: 'hello',
      title: 'Hello-anslutningen',
      roles: ['manager', 'employee'],
      standing: ['hello.greeting', 'hello.openItems'],
      schedules: [{ label: 'Nya saker att göra', when: 'Varje vardag 06:00' }],
      figure: true,
    },
  ],
  capabilities: [
    {
      name: 'hello.greeting',
      kind: 'read',
      title: 'Säg hej',
      description: 'En hälsning från hello-anslutningen till den inloggade.',
      input: Empty,
      output: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
      model: true,
      scope: {},
    },
    {
      name: 'hello.openItems',
      kind: 'read',
      title: 'Saker att göra',
      description: 'Öppna saker i hello-anslutningen för chefens enhet.',
      input: Empty,
      output: { type: 'object', properties: { rows: { type: 'array' } }, required: ['rows'] },
      model: true,
      scope: { roles: ['manager'] },
    },
    {
      name: 'hello.dayWithMeetings',
      kind: 'read',
      title: 'Dagen med möten',
      description: 'Hur många möten den inloggade har i dag enligt kalendern, hämtat via Clew.',
      input: Empty,
      output: {
        type: 'object',
        properties: { meetings: { type: 'integer' }, text: { type: 'string' } },
        required: ['meetings', 'text'],
      },
      model: true,
      scope: {},
    },
    {
      name: 'hello.markDone',
      kind: 'execute',
      title: 'Markera klar',
      description: 'Markerar valda saker som klara.',
      input: Refs,
      output: { type: 'object' },
      model: false,
      scope: { roles: ['manager'] },
    },
    {
      name: 'hello.undo',
      kind: 'execute',
      title: 'Ångra',
      description: 'Öppnar valda saker igen.',
      input: Refs,
      output: { type: 'object' },
      model: false,
      scope: { roles: ['manager'] },
    },
  ],
  scan: true,
  uses: ['calendar.today'],
};

// Protocol 2: Clew signs an RS256 actor assertion; the shared key authenticates transport only.

/** Build the service. `fetch` and `clewUrl` are how it calls back into Clew; both are injectable for tests. */
export function createConnector({
  jwks,
  secret,
  clewUrl = process.env.CLEW_URL ?? '',
  fetch: fetchImpl = globalThis.fetch,
} = {}) {
  const verify = createVerifier({ secret, jwks, clewUrl, fetch: fetchImpl }, CONNECTOR);
  const items = [
    { ref: 'hello:item:1', label: 'Välkomna den nya kollegan', detail: 'Första dagen är på måndag' },
    { ref: 'hello:item:2', label: 'Svara på enkäten om arbetsmiljön', detail: 'Senast fredag' },
  ];
  const done = new Map(); // ref -> ISO time; a real connector keeps this in the source system
  const open = () => items.filter(i => !done.has(i.ref));
  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fail = (code, message, status) => json({ error: { code, message } }, status);

  /** Another connector's read, as the same person, through Clew. */
  async function clewCall(token, name, input = {}) {
    const r = await fetchImpl(clewUrl + '/api/connectors/call', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
      body: JSON.stringify({ name, input }),
    });
    const body = await r.json();
    if (!r.ok || body.error) throw new Error(body.error?.message ?? 'Clew svarade ' + r.status);
    return body.output;
  }
  const capabilities = {
    'hello.greeting': async actor => ({
      text: `Hej ${actor.name}! Hälsningar från hello-anslutningen till ${actor.unitLabel}.`,
    }),
    'hello.openItems': async () => ({ rows: open() }),
    'hello.dayWithMeetings': async (actor, input, token) => {
      const today = await clewCall(token, 'calendar.today');
      const meetings = today.events.filter(e => !e.allDay).length;
      return {
        meetings,
        text: `${actor.name} har ${meetings} möten i dag och ${open().length} saker kvar i hello-anslutningen.`,
      };
    },
    'hello.markDone': async (actor, input) => {
      const rows = input.refs.map(ref => {
        const item = items.find(i => i.ref === ref);
        if (!item) return { ref, label: ref, outcome: 'failed', detail: 'Finns inte' };
        done.set(ref, new Date().toISOString());
        return { ref, label: item.label, outcome: 'done', detail: 'Markerad klar' };
      });
      return {
        headline: `${rows.filter(r => r.outcome === 'done').length} saker markerade som klara.`,
        rows,
        undoCapability: 'hello.undo',
        undoMinutes: 10,
      };
    },
    'hello.undo': async (actor, input) => ({
      headline: 'Öppnade igen.',
      rows: input.refs.map(ref => {
        done.delete(ref);
        return { ref, label: items.find(i => i.ref === ref)?.label ?? ref, outcome: 'done', detail: 'Öppen igen' };
      }),
    }),
  };
  function scan(actor) {
    if (actor.role !== 'manager' || !open().length) return [];
    return [
      {
        topic: 'hello:open-items',
        area: 'hello',
        title: 'Saker att göra i hello-anslutningen',
        summary: `${open().length} saker väntar på dig.`,
        reason: 'Hello-anslutningen har öppna saker för din enhet.',
        items: open().map(i => ({ ...i, selectable: true, selected: true })),
        occurrences: open().map(i => ({
          key: i.ref,
          period: 'once',
          revision: createHash('sha256').update(JSON.stringify(i)).digest('hex'),
        })),
        actions: [
          {
            id: 'done',
            label: 'Markera klar',
            capability: 'hello.markDone',
            kind: 'execute',
            role: 'primary',
            usesItems: true,
          },
          {
            id: 'list',
            label: 'Visa listan',
            capability: 'hello.openItems',
            kind: 'read',
            role: 'secondary',
            target: 'panel',
          },
        ],
        deadline: null,
      },
    ];
  }

  async function handle(request) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/clew/manifest') return json(manifest);
    if (request.method !== 'POST' || !url.pathname.startsWith('/clew/'))
      return json({ error: { code: 'not-found', message: 'Okänd adress.' } }, 404);
    const token = (request.headers.get('authorization') ?? '').replace(/^Bearer /, '');
    const actor = await verify(token, request.headers.get('x-clew-connector-key'), request);
    if (!actor) return fail('denied', 'Ogiltigt behörighetsbevis.', 401);
    let body;
    try {
      body = await request.json();
    } catch {
      return fail('invalid', 'Ogiltig förfrågan.', 400);
    }
    if (url.pathname === '/clew/scan')
      return json({
        drafts: scan(actor),
        observation: {
          scope: actor.unitId + ':' + actor.role,
          observedAt: new Date().toISOString(),
          version: createHash('sha256').update(JSON.stringify(open())).digest('hex'),
          completeness: 'complete',
          exhausted: true,
        },
      });
    if (url.pathname === '/clew/figure')
      return json({
        figure:
          body.area === 'hello'
            ? { label: `${open().length} saker väntar`, tone: open().length ? 'warn' : 'ok' }
            : null,
      });
    const name = decodeURIComponent(url.pathname.slice('/clew/capabilities/'.length));
    const capability = capabilities[name],
      declared = manifest.capabilities.find(c => c.name === name);
    if (!capability || !declared) return fail('not-found', 'Okänd förmåga.', 404);
    // Scope again on this side: never trust that the caller filtered. Clew did, but the secret could leak.
    if (declared.scope.roles && !declared.scope.roles.includes(actor.role))
      return fail('denied', 'Du saknar behörighet för åtgärden.', 403);
    try {
      return json({ output: await capability(actor, body.input ?? {}, callbackFor(token)) });
    } catch (error) {
      return fail('unavailable', 'Hello-anslutningen kunde inte svara: ' + error.message, 503);
    }
  }
  return { manifest, handle };
}
