import { Registry } from '../registry';
import { describe, expect, test } from 'bun:test';
import type { AssistantAskEvent } from '../../packages/contracts/src/index';
import { CapabilityError, type Actor } from '../../packages/connectors/src/index';
import { parseManifest, remoteConnector, type FetchLike } from '../../packages/connectors/src/remote';
import { createConnector, decodeClaims, manifest as eneoManifest } from '../../connectors/eneo/connector.mjs';
import { assertionFor, testJwks, testAuthority } from '../connector-authority';
import { searchConnector } from '../../apps/server/src/modules/search/connector';
import { searchUsecases } from '../../apps/server/src/modules/search/usecases';

/**
 * The Eneo connector against recorded Eneo answers (D26, phase F): spaces → knowledge → one search per collection at
 * once → the best chunks with their documents' titles; every call as the person with the delegated token and no other
 * header; denied without the token; one source in the composite search.
 */
const secret = 'test-secret-test-secret';
const hassan: Actor = {
  id: 'hassan',
  name: 'Hassan Ali',
  unitId: 'unit-omsorg',
  unitLabel: 'Hemtjänst Centrum',
  role: 'employee',
};
/** Recorded from Eneo's API models: paginated lists, a chunk per hit, a blob with metadata. */
const eneoFixtures: Record<string, unknown> = {
  'GET /api/v1/spaces/?include_personal=true': {
    items: [
      { id: 'sp-1', name: 'Hemtjänsten' },
      { id: 'sp-2', name: 'Personligt' },
    ],
    count: 2,
  },
  'GET /api/v1/spaces/sp-1/knowledge/': {
    groups: { items: [{ id: 'col-rutiner', name: 'Rutiner hemtjänst', space_id: 'sp-1' }], count: 1 },
    websites: { items: [], count: 0 },
    integration_knowledge_list: { items: [], count: 0 },
  },
  'GET /api/v1/spaces/sp-2/knowledge/': {
    groups: { items: [{ id: 'col-mina', name: 'Mina dokument', space_id: 'sp-2' }], count: 1 },
    websites: { items: [], count: 0 },
    integration_knowledge_list: { items: [], count: 0 },
  },
  'POST /api/v1/groups/col-rutiner/searches/': {
    items: [
      {
        id: 'ch-1',
        info_blob_id: 'blob-fall',
        text: 'Innan den enskilde hjälps upp ska personalen bedöma smärta, yrsel och tecken på huvudskada.',
        score: 0.91,
        created_at: '2026-03-12T10:00:00Z',
        updated_at: '2026-03-12T10:00:00Z',
      },
      {
        id: 'ch-2',
        info_blob_id: 'blob-fall',
        text: 'Varje fall registreras som avvikelse i avvikelsesystemet innan arbetspasset avslutas.',
        score: 0.82,
        created_at: '2026-03-12T10:00:00Z',
        updated_at: '2026-03-12T10:00:00Z',
      },
    ],
    count: 2,
  },
  'POST /api/v1/groups/col-mina/searches/': {
    items: [
      {
        id: 'ch-9',
        info_blob_id: 'blob-gone',
        text: 'borttaget',
        score: 0.95,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      },
    ],
    count: 1,
  },
  'GET /api/v1/info-blobs/blob-fall/': {
    id: 'blob-fall',
    created_at: '2026-03-12T10:00:00Z',
    updated_at: '2026-03-12T10:00:00Z',
    metadata: {
      url: 'https://intra.example/rutin-fall',
      title: 'Rutin vid fall i ordinärt boende',
      embedding_model_id: 'em',
      size: 12000,
    },
    group_id: 'col-rutiner',
    text: 'Rutin vid fall i ordinärt boende. '.repeat(100),
    original_available: true,
    source_metadata: [],
  },
};
const HR = '3f2b8c1e-5a47-4e0b-9a51-0c6d2f7e8a10';
const SESSION = '9d1c2b3a-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
const ASK = 'POST /api/v1/conversations/?version=3';
/** The assistant an owner in Eneo made available to other systems, so that a question to it is sent. */
const withAssistant = {
  ...eneoFixtures,
  'GET /api/v1/assistants/external/': { items: [{ id: HR, name: 'HR-assistenten' }], count: 1 },
};
/** An answer stream as Eneo writes it: the session, one piece of text and the end. */
const answered = () =>
  new Response(
    [
      { type: 'data-session', data: { session_id: SESSION } },
      { type: 'text-delta', id: 'text-0', delta: 'Svar.' },
      { type: 'finish' },
    ]
      .map(event => `data: ${JSON.stringify(event)}\n\n`)
      .join(''),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );
/**
 * A body that never ends: what `first` holds, then `piece` again and again. How much of it was pulled, and whether the
 * reader gave it up.
 */
function endless(piece: Uint8Array, init: { headers?: Record<string, string>; first?: string[] } = {}) {
  const seen = { pulled: 0, cancelled: false };
  const response = new Response(
    new ReadableStream({
      start(controller) {
        for (const text of init.first ?? []) controller.enqueue(new TextEncoder().encode(text));
      },
      pull(controller) {
        // A bound on the test itself, far past any limit: a reader without one stops here.
        if (++seen.pulled > 1000) controller.close();
        else controller.enqueue(piece);
      },
      cancel() {
        seen.cancelled = true;
      },
    }),
    { status: 200, headers: init.headers ?? {} },
  );
  return { seen, response };
}
async function askOf(registry: Registry, context: { delegate: () => Promise<string | undefined> }) {
  const events: AssistantAskEvent[] = [];
  for await (const event of registry.ask(
    hassan,
    'eneo:' + HR,
    { question: 'Hur många semesterdagar har jag?' },
    context,
  ))
    events.push(event);
  return events;
}
function stack(
  options: {
    token?: string | undefined;
    fixtures?: Record<string, unknown>;
    status?: number;
    /** An answer of its own for a call, in place of the fixtures. */
    respond?: (key: string) => Response | undefined;
  } = {},
) {
  const calls: Array<{ key: string; headers: Record<string, string>; body?: unknown }> = [];
  /** How each call to Eneo treats a redirect. */
  const redirects: Array<RequestRedirect | undefined> = [];
  const fixtures = options.fixtures ?? eneoFixtures;
  const eneoFetch: FetchLike = async (input, init) => {
    redirects.push(init?.redirect);
    const url = new URL(String(input));
    const key = `${init?.method ?? 'GET'} ${url.pathname}${url.search}`;
    calls.push({
      key,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}),
    });
    if (options.status) return new Response('', { status: options.status });
    const own = options.respond?.(key);
    if (own) return own;
    const hit = fixtures[key];
    return hit ? Response.json(hit) : new Response('', { status: 404 });
  };
  const eneo = createConnector({
    jwks: testJwks,
    secret,
    eneoUrl: 'https://eneo.example/',
    fetch: eneoFetch,
  });
  const connectorFetch: FetchLike = (input, init) => eneo.handle(new Request(input, init));
  const registry = new Registry();
  registry.register(
    remoteConnector(parseManifest(eneoManifest, 'eneo'), {
      url: 'http://eneo-connector',
      key: secret,
      assert: assertionFor('eneo', secret),
      fetch: connectorFetch,
    }),
  );
  const context =
    'token' in options ? { delegate: async () => options.token } : { delegate: async () => 'idp-token-for-eneo' };
  return {
    registry,
    calls,
    redirects,
    context,
  };
}

describe('the Eneo connector', () => {
  test('searches every collection of every space at once, as the person, and returns the best chunks as hits with their documents', async () => {
    const { registry, calls, context } = stack();
    const result = await registry.run<{ rows: Record<string, unknown>[] }>(
      hassan,
      'eneo.search',
      { query: 'brukaren har ramlat' },
      context,
    );
    expect(result.rows).toEqual([
      {
        ref: 'blob-fall',
        kind: 'document',
        label: 'Rutin vid fall i ordinärt boende',
        snippet: 'Innan den enskilde hjälps upp ska personalen bedöma smärta, yrsel och tecken på huvudskada.',
        source: 'Eneo',
        link: 'https://intra.example/rutin-fall',
        updatedAt: '2026-03-12T10:00:00Z',
        section: 'Rutiner hemtjänst',
        score: 0.91,
      },
      {
        ref: 'blob-fall',
        kind: 'document',
        label: 'Rutin vid fall i ordinärt boende',
        snippet: 'Varje fall registreras som avvikelse i avvikelsesystemet innan arbetspasset avslutas.',
        source: 'Eneo',
        link: 'https://intra.example/rutin-fall',
        updatedAt: '2026-03-12T10:00:00Z',
        section: 'Rutiner hemtjänst',
        score: 0.82,
      },
    ]);
    const keys = calls.map(c => c.key);
    expect(keys.slice(0, 3)).toEqual([
      'GET /api/v1/spaces/?include_personal=true',
      'GET /api/v1/spaces/sp-1/knowledge/',
      'GET /api/v1/spaces/sp-2/knowledge/',
    ]);
    expect(keys.filter(k => k.startsWith('POST')).sort()).toEqual([
      'POST /api/v1/groups/col-mina/searches/',
      'POST /api/v1/groups/col-rutiner/searches/',
    ]);
    expect(calls.find(c => c.key.startsWith('POST'))!.body).toEqual({
      search_string: 'brukaren har ramlat',
      num_chunks: 5,
      rerank: false,
    });
    // The blob fetch is once per document; the vanished one is left out, not an error.
    expect(keys.filter(k => k.startsWith('GET /api/v1/info-blobs/'))).toEqual([
      'GET /api/v1/info-blobs/blob-gone/',
      'GET /api/v1/info-blobs/blob-fall/',
    ]);
    for (const c of calls) {
      expect(c.headers).toMatchObject({ authorization: 'Bearer idp-token-for-eneo', accept: 'application/json' });
      expect(Object.keys(c.headers).sort()).toEqual(
        c.body ? ['accept', 'authorization', 'content-type'] : ['accept', 'authorization'],
      );
    }
  });
  test('every call to Eneo follows no redirect, the question stream included (CS-L3)', async () => {
    const { registry, calls, redirects, context } = stack({
      fixtures: withAssistant,
      respond: key => (key === ASK ? answered() : undefined),
    });
    await registry.run(hassan, 'eneo.search', { query: 'fall' }, context);
    await registry.run(hassan, 'eneo.fetch', { ref: 'blob-fall' }, context);
    expect((await askOf(registry, context)).at(-1)).toMatchObject({ type: 'done', session: SESSION });
    expect(calls.map(c => c.key)).toContain(ASK);
    expect(redirects).toHaveLength(calls.length);
    expect(new Set(redirects)).toEqual(new Set(['error']));
  });
  test('ENEO_URL is https, or plain http towards this host or with ENEO_ALLOW_HTTP, and never another scheme (CS-L3)', () => {
    const make = (eneoUrl: string) => () => createConnector({ jwks: testJwks, secret, eneoUrl });
    const refused = 'ENEO_URL must be https outside local development (ENEO_ALLOW_HTTP=true allows http).';
    const before = process.env.ENEO_ALLOW_HTTP;
    try {
      delete process.env.ENEO_ALLOW_HTTP;
      for (const url of [
        'https://eneo.example',
        'HTTPS://eneo.example',
        'http://localhost:8123',
        'http://127.0.0.1:8123',
      ])
        expect(make(url)).not.toThrow();
      for (const url of [
        'http://eneo.example',
        'HTTP://eneo.example',
        // A compose service name is not this host without the variable.
        'http://eneo:8000',
        // Look-alikes of a local host: another host's name, a user name, a fragment.
        'http://localhost.evil.example',
        'http://localhost:80@evil.example',
        'http://evil.example#@localhost',
        // Another scheme towards this host is not http.
        'ftp://localhost/api',
        'ws://127.0.0.1:8123',
        'file://localhost/etc/passwd',
      ])
        expect(make(url)).toThrow(refused);
      // Read when the connector is made: a development stack on a private network names Eneo's service.
      process.env.ENEO_ALLOW_HTTP = 'true';
      expect(make('http://eneo:8000')).not.toThrow();
      for (const url of ['ftp://eneo/api', 'ws://eneo:8000']) expect(make(url)).toThrow(refused);
    } finally {
      if (before === undefined) delete process.env.ENEO_ALLOW_HTTP;
      else process.env.ENEO_ALLOW_HTTP = before;
    }
  });
  test('an answer that declares more than 4 MiB is unavailable without being read, and one that passes it is given up there', async () => {
    const piece = new Uint8Array(64 * 1024).fill(32);
    const declared = endless(piece, { headers: { 'content-length': String(4 * 1024 * 1024 + 1) } });
    const big = stack({
      respond: key => (key === 'GET /api/v1/info-blobs/blob-fall/' ? declared.response : undefined),
    });
    await expect(big.registry.run(hassan, 'eneo.fetch', { ref: 'blob-fall' }, big.context)).rejects.toThrow(
      'Eneo svarar inte just nu.',
    );
    expect(declared.seen.pulled).toBeLessThanOrEqual(1);
    expect(declared.seen.cancelled).toBe(true);
    // No length declared: read a piece at a time, and given up as the piece that passes 4 MiB arrives.
    const streamed = endless(piece);
    const long = stack({
      respond: key => (key === 'GET /api/v1/info-blobs/blob-fall/' ? streamed.response : undefined),
    });
    await expect(long.registry.run(hassan, 'eneo.fetch', { ref: 'blob-fall' }, long.context)).rejects.toThrow(
      'Eneo svarar inte just nu.',
    );
    expect(streamed.seen.cancelled).toBe(true);
    expect(streamed.seen.pulled).toBeLessThan(70);
  });
  test('an event of the answer stream that passes a million characters without its end gives the question up as unavailable', async () => {
    const upstream = endless(new Uint8Array(64 * 1024).fill(120), {
      headers: { 'content-type': 'text/event-stream' },
      first: [
        `data: ${JSON.stringify({ type: 'data-session', data: { session_id: SESSION } })}\n\n`,
        'data: {"type":"text-delta","id":"text-0","delta":"',
      ],
    });
    const { registry, context } = stack({
      fixtures: withAssistant,
      respond: key => (key === ASK ? upstream.response : undefined),
    });
    const failed = await askOf(registry, context).catch((error: unknown) => error);
    expect(failed).toBeInstanceOf(CapabilityError);
    expect((failed as CapabilityError).code).toBe('unavailable');
    // Given up as the piece that passes the limit arrives, sixteen pieces of 64 KiB in.
    expect(upstream.seen.cancelled).toBe(true);
    expect(upstream.seen.pulled).toBeLessThan(20);
  });
  test('an answer stream longer than that in all, in events that each end, is answered whole', async () => {
    const delta = 'x'.repeat(32 * 1024);
    const { registry, context } = stack({
      fixtures: withAssistant,
      respond: key =>
        key === ASK
          ? new Response(
              [
                { type: 'data-session', data: { session_id: SESSION } },
                ...Array.from({ length: 40 }, () => ({ type: 'text-delta', id: 'text-0', delta })),
                { type: 'finish' },
              ]
                .map(event => `data: ${JSON.stringify(event)}\n\n`)
                .join(''),
              { status: 200, headers: { 'content-type': 'text/event-stream' } },
            )
          : undefined,
    });
    const events = await askOf(registry, context);
    expect(
      events
        .filter(e => e.type === 'text')
        .map(e => (e.type === 'text' ? e.delta : ''))
        .join('').length,
    ).toBe(40 * delta.length);
    expect(events.at(-1)).toMatchObject({ type: 'done', session: SESSION });
  });
  test('a document whose address is no https address, or too long a one, is still a hit, without the link', async () => {
    for (const url of [
      'www.kommun.se/rutin',
      'javascript:alert(1)',
      'http://intra.example/rutin',
      `https://intra.example/${'a'.repeat(1000)}`,
    ]) {
      const blobFall = eneoFixtures['GET /api/v1/info-blobs/blob-fall/'] as { metadata: Record<string, unknown> };
      const fixtures = {
        ...eneoFixtures,
        'GET /api/v1/info-blobs/blob-fall/': { ...blobFall, metadata: { ...blobFall.metadata, url } },
      };
      const { registry, context } = stack({ fixtures });
      const result = await registry.run<{ rows: Record<string, unknown>[] }>(
        hassan,
        'eneo.search',
        { query: 'brukaren har ramlat' },
        context,
      );
      expect(result.rows).toHaveLength(2);
      for (const row of result.rows) {
        expect(row.label).toBe('Rutin vid fall i ordinärt boende');
        expect(row).not.toHaveProperty('link');
      }
    }
  });
  test('rechecks spaces and documents on every search', async () => {
    const { registry, calls, context } = stack();
    await registry.run(hassan, 'eneo.search', { query: 'fall' }, context);
    const before = calls.length;
    await registry.run(hassan, 'eneo.search', { query: 'avvikelse' }, context);
    const repeated = calls.slice(before).map(c => c.key);
    expect(repeated).toContain('GET /api/v1/spaces/?include_personal=true');
    expect(repeated).toContain('GET /api/v1/info-blobs/blob-fall/');
  });
  test('a prior document read grants no access to another user or a user whose access was revoked', async () => {
    let revoked = false;
    const calls: string[] = [];
    const service = createConnector({
      jwks: testJwks,
      secret,
      eneoUrl: 'https://eneo.example',
      fetch: async (_url: string, init?: RequestInit) => {
        const token = new Headers(init?.headers).get('authorization')!;
        calls.push(token);
        return token === 'Bearer allowed' && !revoked
          ? Response.json(eneoFixtures['GET /api/v1/info-blobs/blob-fall/'])
          : new Response('', { status: 403 });
      },
    });
    const call = async (actor: Actor, token: string) => {
      const body = JSON.stringify({ actor, input: { ref: 'blob-fall' } });
      return service.handle(
        new Request('http://eneo/clew/capabilities/eneo.fetch', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization:
              'Bearer ' +
              (await (await testAuthority()).assert('eneo', actor, [], [], { body, capability: 'eneo.fetch' })),
            'x-clew-connector-key': secret,
            'x-clew-delegated-token': token,
          },
          body,
        }),
      );
    };
    expect((await call(hassan, 'allowed')).status).toBe(200);
    expect((await call({ ...hassan, id: 'other-user' }, 'denied')).status).toBe(403);
    revoked = true;
    expect((await call(hassan, 'allowed')).status).toBe(403);
    expect(calls).toEqual(['Bearer allowed', 'Bearer denied', 'Bearer allowed']);
  });
  test('an outage during knowledge, search or document retrieval is unavailable, not an empty success', async () => {
    for (const failedPath of ['/spaces/sp-1/knowledge/', '/groups/col-rutiner/searches/', '/info-blobs/blob-fall/']) {
      const service = createConnector({
        jwks: testJwks,
        secret,
        eneoUrl: 'https://eneo.example',
        fetch: async (url: string, init?: RequestInit) => {
          const path = new URL(url).pathname + new URL(url).search;
          if (path.endsWith(failedPath)) return new Response('', { status: 503 });
          const data = eneoFixtures[(init?.method ?? 'GET') + ' ' + path];
          return data ? Response.json(data) : new Response('', { status: 404 });
        },
      });
      const body = JSON.stringify({ input: { query: 'fall' } });
      const response = await service.handle(
        new Request('http://eneo/clew/capabilities/eneo.search', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization:
              'Bearer ' +
              (await (await testAuthority()).assert('eneo', hassan, [], [], { body, capability: 'eneo.search' })),
            'x-clew-connector-key': secret,
            'x-clew-delegated-token': 'allowed',
          },
          body,
        }),
      );
      expect(response.status).toBe(503);
    }
  });
  test("fetch returns one document by its ref; whoami shows the token's claims and nothing else", async () => {
    const { registry, context } = stack();
    const hit = await registry.run<Record<string, unknown>>(hassan, 'eneo.fetch', { ref: 'blob-fall' }, context);
    expect(hit).toMatchObject({
      ref: 'blob-fall',
      kind: 'document',
      label: 'Rutin vid fall i ordinärt boende',
      link: 'https://intra.example/rutin-fall',
      source: 'Eneo',
    });
    expect((hit.snippet as string).length).toBeLessThanOrEqual(1500);
    const claims = Buffer.from(
      JSON.stringify({
        sub: 'u1',
        aud: 'eneo',
        iss: 'http://kc/realms/clew',
        azp: 'clew-web',
        email: 'hassan@clew.test',
        email_verified: true,
        exp: 2,
        iat: 1,
        secret: 'never',
      }),
    ).toString('base64url');
    const who = await registry.run<{ claims: Record<string, unknown> }>(
      hassan,
      'eneo.whoami',
      {},
      { delegate: async () => `h.${claims}.s` },
    );
    expect(who.claims).toEqual({
      sub: 'u1',
      aud: 'eneo',
      iss: 'http://kc/realms/clew',
      azp: 'clew-web',
      email: 'hassan@clew.test',
      email_verified: true,
      exp: 2,
      iat: 1,
    });
    expect(decodeClaims('nonsense')).toBeNull();
  });
  test("without the person's token it answers denied; Eneo refusing the token is denied too; Eneo down is unavailable", async () => {
    const { registry } = stack({ token: undefined });
    await expect(
      registry.run(hassan, 'eneo.search', { query: 'x' }, { delegate: async () => undefined }),
    ).rejects.toThrow('Din inloggning kan inte styrkas mot Eneo i den här sessionen.');
    await expect(registry.run(hassan, 'eneo.search', { query: 'x' })).rejects.toThrow(
      'Din inloggning kan inte styrkas mot Eneo i den här sessionen.',
    );
    const refused = stack({ status: 401 });
    await expect(refused.registry.run(hassan, 'eneo.search', { query: 'x' }, refused.context)).rejects.toThrow(
      'Eneo godkänner inte din inloggning.',
    );
    const down = stack({ status: 503 });
    await expect(down.registry.run(hassan, 'eneo.fetch', { ref: 'blob-fall' }, down.context)).rejects.toThrow(
      'Eneo svarar inte just nu.',
    );
  });
  test('is one source in the composite search, with its hits marked by connector and the model seeing only the composite', async () => {
    const { registry, context } = stack();
    registry.register(
      searchConnector(
        searchUsecases({ sources: a => registry.searchSources(a), clock: () => new Date('2026-11-04T10:42:00Z') }),
      ),
    );
    const result = await registry.run<{
      rows: { connector: string; ref: string; stale: boolean | null }[];
      sources: unknown[];
    }>(hassan, 'clew.search', { query: 'brukaren har ramlat' }, context);
    expect(result.rows.map(r => [r.connector, r.ref, r.stale])).toEqual([['eneo', 'blob-fall', false]]);
    expect(result.sources).toEqual([{ id: 'eneo', source: 'Eneo', status: 'ok' }]);
    expect(registry.tools(hassan).map(t => t.name)).toEqual(['clew.search']);
    const withoutToken = await registry.run<{
      rows: unknown[];
      sources: { id: string; source: string; status: string }[];
    }>(hassan, 'clew.search', { query: 'x' });
    expect(withoutToken).toEqual({ rows: [], sources: [{ id: 'eneo', source: 'Eneo', status: 'unavailable' }] });
  });
});
