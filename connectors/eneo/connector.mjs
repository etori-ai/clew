// The Eneo connector (D14, D26): Eneo's retrieval over the person's knowledge bases as a search source for Clew. One
// file, no dependencies beyond Node, built the way a third party builds a connector (connectors/hello is the reference).
// It acts as the person: Clew sends an IdP token bound to the audience "eneo" beside its assertion, and every call to
// Eneo carries that token and nothing else. Nothing of Eneo's text is kept here; a source read checks the person's current access.
import { createVerifier, callbackFor, b64 } from './verification.mjs';

const CONNECTOR = 'eneo';
const Empty = { type: 'object', properties: {}, additionalProperties: false };
const SNIPPET_LIMIT = 1200;
const FETCH_LIMIT = 1500;

export const manifest = {
  protocol: 3,
  id: CONNECTOR,
  kind: 'passthrough',
  source: 'Eneo',
  areas: [],
  capabilities: [
    {
      name: 'eneo.search',
      kind: 'read',
      title: 'Sök i Eneo',
      description:
        'Söker i de kunskapsbaser personen har tillgång till i Eneo och ger avsnitten som matchar. Ange frågan som query.',
      input: {
        type: 'object',
        properties: {
          query: { type: 'string', minLength: 1, maxLength: 200 },
          limit: { type: 'integer', minimum: 1, maximum: 20 },
        },
        required: ['query'],
        additionalProperties: false,
      },
      output: { type: 'object', properties: { rows: { type: 'array' } }, required: ['rows'] },
      model: false,
      scope: {},
      kinds: ['document'],
    },
    {
      name: 'eneo.fetch',
      kind: 'read',
      title: 'Hämta ett dokument',
      description: 'Ett dokument som en tidigare sökning hittade, hämtat igen från Eneo.',
      input: {
        type: 'object',
        properties: { ref: { type: 'string', minLength: 1, maxLength: 200 } },
        required: ['ref'],
        additionalProperties: false,
      },
      output: { type: 'object' },
      model: false,
      scope: {},
    },
    {
      name: 'eneo.whoami',
      kind: 'read',
      title: 'Vem är jag i Eneo',
      description: 'De uppgifter Eneo får om personen: vem token är utställd för och till vem.',
      input: Empty,
      output: { type: 'object' },
      model: false,
      scope: {},
    },
  ],
  scan: false,
  delegation: { audience: 'eneo' },
};

// The verifier checks the installation-signed RS256 assertion; Eneo checks the delegated token independently.

/** The claims of a JWT, read without verification: for `whoami` only, so an operator can see what Eneo is handed. */
export function decodeClaims(token) {
  try {
    const p = JSON.parse(b64(String(token).split('.')[1] ?? '').toString());
    const { sub, iss, aud, azp, email, email_verified, exp, iat } = p;
    return { sub, iss, aud, azp, email, email_verified, exp, iat };
  } catch {
    return null;
  }
}
const clip = (text, limit) => {
  const t = String(text ?? '');
  return t.length <= limit ? t : t.slice(0, limit - 1).trimEnd() + '…';
};

/**
 * Build the service. `eneoUrl` is Eneo's API base (the `/api/v1` prefix is added here), `fetch` is injectable for tests. Source responses are not cached across requests. Every request to Eneo is built from scratch: the person's token, `accept`, `content-type`, never an
 * Origin and never a header from the incoming request.
 */
export function createConnector({
  jwks,
  secret,
  eneoUrl = process.env.ENEO_URL ?? '',
  fetch: fetchImpl = globalThis.fetch,
  perCallMs = 2000,
} = {}) {
  const verify = createVerifier({ secret, jwks, clewUrl: process.env.CLEW_URL ?? '' }, CONNECTOR);
  const base = eneoUrl.replace(/\/+$/, '') + '/api/v1';
  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fail = (code, message, status) => json({ error: { code, message } }, status);
  class EneoError extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  }
  const denied = () =>
    new EneoError('denied', 'Eneo godkänner inte din inloggning. Be systemförvaltaren koppla ditt konto.');
  const unavailable = () => new EneoError('unavailable', 'Eneo svarar inte just nu.');

  async function eneo(token, path, init = {}) {
    let r;
    try {
      r = await fetchImpl(base + path, {
        ...init,
        headers: {
          authorization: 'Bearer ' + token,
          accept: 'application/json',
          ...(init.body ? { 'content-type': 'application/json' } : {}),
        },
        signal: AbortSignal.timeout(perCallMs),
      });
    } catch {
      throw unavailable();
    }
    if (r.status === 401 || r.status === 403) throw denied();
    if (r.status === 404) throw new EneoError('not-found', 'Dokumentet eller samlingen finns inte längre i Eneo.');
    if (!r.ok) throw unavailable();
    try {
      return await r.json();
    } catch {
      throw unavailable();
    }
  }
  const items = page => (Array.isArray(page?.items) ? page.items : []);
  /** Resolve current source access on every request, including when permissions changed since the last search. */
  async function collectionsFor(token) {
    const spaces = items(await eneo(token, '/spaces/?include_personal=true'));
    const knowledge = await Promise.all(
      spaces.map(s =>
        eneo(token, `/spaces/${encodeURIComponent(s.id)}/knowledge/`).catch(error => {
          if (error.code === 'not-found') return null;
          throw error;
        }),
      ),
    );
    const collections = knowledge.flatMap((k, i) =>
      items(k?.groups).map(g => ({ id: g.id, name: g.name, space: spaces[i]?.name ?? '' })),
    );
    return collections;
  }
  async function blob(token, id) {
    return eneo(token, `/info-blobs/${encodeURIComponent(id)}/`);
  }
  const hitOf = (b, text, extra = {}) => ({
    ref: String(b.id),
    kind: 'document',
    label: b.metadata?.title || 'Dokument utan titel',
    snippet: clip(text, SNIPPET_LIMIT),
    source: 'Eneo',
    ...(b.metadata?.url ? { link: b.metadata.url } : {}),
    ...(b.updated_at ? { updatedAt: b.updated_at } : {}),
    ...extra,
  });
  const capabilities = {
    /** Eneo searches one collection at a time; every collection the person may see is asked at once and the best chunks win. */
    'eneo.search': async (actor, input, token) => {
      const limit = input.limit ?? 10;
      const collections = await collectionsFor(token);
      const searched = await Promise.all(
        collections.map(c =>
          eneo(token, `/groups/${encodeURIComponent(c.id)}/searches/`, {
            method: 'POST',
            body: JSON.stringify({ search_string: input.query, num_chunks: 5, rerank: false }),
          })
            .then(page => items(page).map(chunk => ({ chunk, collection: c })))
            .catch(error => {
              if (error.code === 'not-found') return [];
              throw error;
            }),
        ),
      );
      const chunks = searched
        .flat()
        .sort((a, b) => (b.chunk.score ?? 0) - (a.chunk.score ?? 0))
        .slice(0, limit);
      const blobs = new Map();
      await Promise.all(
        [...new Set(chunks.map(x => x.chunk.info_blob_id))].map(async id => {
          try {
            blobs.set(id, await blob(token, id));
          } catch (error) {
            if (error.code !== 'not-found') throw error;
            /* a blob that vanished is left out */
          }
        }),
      );
      const rows = chunks
        .filter(x => blobs.has(x.chunk.info_blob_id))
        .map(x =>
          hitOf(blobs.get(x.chunk.info_blob_id), x.chunk.text, {
            section: x.collection.name,
            ...(typeof x.chunk.score === 'number' ? { score: x.chunk.score } : {}),
          }),
        );
      return { rows };
    },
    'eneo.fetch': async (actor, input, token) => {
      const b = await blob(token, input.ref);
      return hitOf(b, clip(b.text ?? '', FETCH_LIMIT));
    },
    'eneo.whoami': async (actor, input, token) => ({ claims: decodeClaims(token) }),
  };

  async function handle(request) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/clew/manifest') return json(manifest);
    if (request.method !== 'POST' || !url.pathname.startsWith('/clew/'))
      return json({ error: { code: 'not-found', message: 'Okänd adress.' } }, 404);
    const assertion = (request.headers.get('authorization') ?? '').replace(/^Bearer /, '');
    const actor = await verify(assertion, request.headers.get('x-clew-connector-key'), request);
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
    const capability = capabilities[name];
    if (!capability) return fail('not-found', 'Okänd förmåga.', 404);
    // The person's own token for Eneo. Without it there is nothing to act as: a scan, a figure, a callback or a session without IdP tokens.
    const token = request.headers.get('x-clew-delegated-token');
    if (!token) return fail('denied', 'Din inloggning kan inte styrkas mot Eneo i den här sessionen.', 403);
    try {
      return json({ output: await capability(actor, body.input ?? {}, token) });
    } catch (error) {
      if (error instanceof EneoError)
        return fail(error.code, error.message, error.code === 'denied' ? 403 : error.code === 'not-found' ? 404 : 503);
      return fail('unavailable', 'Eneo-anslutningen kunde inte svara.', 503);
    }
  }
  return { manifest, handle };
}
