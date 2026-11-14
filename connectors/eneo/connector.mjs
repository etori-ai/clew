// The Eneo connector (D14, D26): Eneo's retrieval over the person's knowledge bases as a search source for Clew. One
// file, no dependencies beyond Node, built the way a third party builds a connector (connectors/hello is the reference).
// It acts as the person: Clew sends an IdP token bound to the audience "eneo" beside its assertion, and every call to
// Eneo carries that token and nothing else. Nothing of Eneo's text is kept here; a source read checks the person's current access.
// It also carries the assistants profile: the assistants an owner in Eneo made available to other systems are listed
// for the person, and a question goes to one of them through Eneo's own conversation API, so the whole assistant
// answers (its instructions, knowledge and tools) and Eneo keeps the conversation as the person's own.
import { createVerifier, callbackFor, b64 } from './verification.mjs';

const CONNECTOR = 'eneo';
const Empty = { type: 'object', properties: {}, additionalProperties: false };
const SNIPPET_LIMIT = 1200;
const FETCH_LIMIT = 1500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// What an answer may not do in Clew's conversation yet: produce files. Eneo leaves these functions out of the turn.
const NO_FILES = ['image_generation', 'file_creation', 'file_analysis', 'compute', 'charts'];
/** The start of one of Eneo's citation tags, `<inref id="1a2b3c4d"/>`, cut anywhere before its end. */
const PARTIAL_TAG = /^<(?:i(?:n(?:r(?:e(?:f(?: (?:i(?:d(?:=(?:"(?:[0-9a-f]*(?:"(?:\s*\/?)?)?)?)?)?)?)?)?)?)?)?)?)?$/;
/** The longest one answer may take, a little under what Clew waits for. */
const ASK_TOTAL_MS = 170_000;

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
      name: 'eneo.assistants',
      kind: 'read',
      title: 'Assistenter i Eneo',
      description: 'De assistenter i Eneo som personen får fråga från andra system.',
      input: Empty,
      output: {
        type: 'object',
        properties: {
          assistants: {
            type: 'array',
            items: {
              type: 'object',
              properties: { ref: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' } },
              required: ['ref', 'name'],
              additionalProperties: false,
            },
          },
        },
        required: ['assistants'],
        additionalProperties: false,
      },
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
  assistants: { list: 'eneo.assistants' },
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
  // Where a person opens Eneo in a browser, for the link that continues a conversation there; https only, else no link.
  eneoPublicUrl = process.env.ENEO_PUBLIC_URL ?? '',
  fetch: fetchImpl = globalThis.fetch,
  perCallMs = 2000,
  askTotalMs = ASK_TOTAL_MS,
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
  const publicBase = /^https:\/\//.test(eneoPublicUrl) ? eneoPublicUrl.replace(/\/+$/, '') : '';
  const sse = event => `data: ${JSON.stringify(event)}\n\n`;
  /**
   * One question to one of Eneo's assistants, as the person: Eneo's conversation API (the UI message stream) read as it
   * is written and answered as the profile's events. The question and what the person attached go as they are. Eneo's
   * citation tags are taken out of the text, and the sources they point at are listed once, in the order cited.
   */
  function ask(token, { assistant, session, question, context }, signal) {
    const encoder = new TextEncoder();
    return new ReadableStream({
      async start(controller) {
        const send = event => controller.enqueue(encoder.encode(sse(event)));
        const end = event => {
          send(event);
          controller.close();
        };
        let upstream;
        try {
          upstream = await fetchImpl(base + '/conversations/?version=3', {
            method: 'POST',
            headers: {
              authorization: 'Bearer ' + token,
              accept: 'text/event-stream',
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              ...(session ? { session_id: session } : { assistant_id: assistant }),
              question,
              stream: true,
              ...(context?.length ? { context } : {}),
              disabled_capabilities: NO_FILES,
            }),
            signal: AbortSignal.any([AbortSignal.timeout(askTotalMs), ...(signal ? [signal] : [])]),
          });
        } catch {
          return end({ type: 'error', code: 'unavailable' });
        }
        if (upstream.status === 401 || upstream.status === 403) return end({ type: 'error', code: 'denied' });
        if (upstream.status === 404) return end({ type: 'error', code: 'not-found' });
        if (!upstream.ok || !upstream.body) return end({ type: 'error', code: 'unavailable' });
        const sources = new Map(); // Eneo's id -> { label, link? }
        const cited = [];
        let sessionId = session;
        let held = ''; // text that may be the start of a citation tag, kept until it is known
        let finished = false;
        const cite = id => {
          const full = [...sources.keys()].find(k => k.startsWith(id));
          if (full && !cited.includes(full)) cited.push(full);
        };
        const text = delta => {
          held += delta;
          held = held.replace(/<inref id="([0-9a-f]+)"\s*\/>/g, (_, id) => (cite(id), ''));
          // Keep back only a tail that could still become a tag.
          const at = held.lastIndexOf('<');
          const tail = at >= 0 && PARTIAL_TAG.test(held.slice(at)) ? at : -1;
          const out = tail >= 0 ? held.slice(0, tail) : held;
          held = tail >= 0 ? held.slice(tail) : '';
          for (let i = 0; i < out.length; i += 4000) send({ type: 'text', delta: out.slice(i, i + 4000) });
        };
        const part = p => {
          if (p.type === 'data-session' && UUID.test(String(p.data?.session_id ?? ''))) sessionId = p.data.session_id;
          else if (p.type === 'text-delta' && typeof p.delta === 'string') text(p.delta);
          else if (p.type === 'source-document' && p.sourceId) {
            const url = p.providerMetadata?.eneo?.metadata?.url;
            sources.set(String(p.sourceId), {
              label: clip(p.title || 'Dokument utan titel', 300),
              ...(typeof url === 'string' && /^https:\/\/\S+$/.test(url) && url.length <= 2000 ? { link: url } : {}),
            });
          } else if (p.type === 'data-mcp-tool-references') {
            for (const ref of p.data?.mcp_tool_references ?? []) {
              const url = ref.meta?.url;
              if (!ref.id) continue;
              sources.set(String(ref.id), {
                label: clip(ref.meta?.title || 'Dokument utan titel', 300),
                ...(typeof url === 'string' && /^https:\/\/\S+$/.test(url) && url.length <= 2000 ? { link: url } : {}),
              });
            }
          } else if (p.type === 'error') throw new EneoError('unavailable', 'Eneo svarar inte just nu.');
          else if (p.type === 'finish') finished = true;
        };
        const reader = upstream.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            for (;;) {
              const cut = buffer.search(/\r?\n\r?\n/);
              if (cut < 0) break;
              const block = buffer.slice(0, cut);
              buffer = buffer.slice(cut).replace(/^\r?\n\r?\n/, '');
              const data = block
                .split(/\r?\n/)
                .filter(line => line.startsWith('data:'))
                .map(line => line.slice(5).replace(/^ /, ''))
                .join('\n');
              if (!data || data === '[DONE]') continue;
              part(JSON.parse(data));
            }
          }
        } catch {
          await reader.cancel().catch(() => undefined);
          return end({ type: 'error', code: 'unavailable' });
        }
        if (!finished || !sessionId) return end({ type: 'error', code: 'unavailable' });
        // A tail that never became a tag was text after all.
        if (held) send({ type: 'text', delta: held });
        for (const id of cited.slice(0, 10)) send({ type: 'source', source: sources.get(id) });
        end({
          type: 'done',
          session: sessionId,
          ...(publicBase
            ? { link: `${publicBase}/dashboard/${encodeURIComponent(assistant)}/${encodeURIComponent(sessionId)}` }
            : {}),
        });
      },
    });
  }
  const capabilities = {
    /** The assistants an owner in Eneo made available to other systems, among those the person may use there. */
    'eneo.assistants': async (actor, input, token) => {
      const page = await eneo(token, '/assistants/external/');
      const listed = Array.isArray(page) ? page : items(page);
      return {
        assistants: listed
          .filter(a => UUID.test(String(a?.id ?? '')) && a.name)
          .slice(0, 50)
          .map(a => ({
            ref: String(a.id),
            name: clip(a.name, 120),
            ...(a.description ? { description: clip(a.description, 400) } : {}),
          })),
      };
    },
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
    if (url.pathname === '/clew/ask') {
      const a = body.ask ?? {};
      // Eneo's own keys are UUIDs: anything else is not an assistant or a conversation of Eneo's.
      if (
        !UUID.test(String(a.assistant ?? '')) ||
        (a.session !== undefined && !UUID.test(String(a.session))) ||
        typeof a.question !== 'string' ||
        !a.question
      )
        return fail('invalid', 'Ogiltig förfrågan.', 400);
      const delegatedToken = request.headers.get('x-clew-delegated-token');
      if (!delegatedToken) return fail('denied', 'Din inloggning kan inte styrkas mot Eneo i den här sessionen.', 403);
      // Whether the person may ask this assistant is Eneo's to say, with their own token: Clew listed it for them just
      // before, and nobody without that token reaches Eneo through here.
      return new Response(ask(delegatedToken, a, request.signal), {
        status: 200,
        headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store' },
      });
    }
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
