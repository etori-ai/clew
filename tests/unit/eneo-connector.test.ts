import { Registry } from '../registry';
import { describe, expect, test } from 'bun:test';
import { type Actor } from '../../packages/connectors/src/index';
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
const hassan: Actor = { id: 'hassan', name: 'Hassan Ali', unitId: 'unit-omsorg', unitLabel: 'Hemtjänst Centrum', role: 'employee' };
/** Recorded from Eneo's API models: paginated lists, a chunk per hit, a blob with metadata. */
const eneoFixtures: Record<string, unknown> = {
  'GET /api/v1/spaces/?include_personal=true': { items: [{ id: 'sp-1', name: 'Hemtjänsten' }, { id: 'sp-2', name: 'Personligt' }], count: 2 },
  'GET /api/v1/spaces/sp-1/knowledge/': { groups: { items: [{ id: 'col-rutiner', name: 'Rutiner hemtjänst', space_id: 'sp-1' }], count: 1 }, websites: { items: [], count: 0 }, integration_knowledge_list: { items: [], count: 0 } },
  'GET /api/v1/spaces/sp-2/knowledge/': { groups: { items: [{ id: 'col-mina', name: 'Mina dokument', space_id: 'sp-2' }], count: 1 }, websites: { items: [], count: 0 }, integration_knowledge_list: { items: [], count: 0 } },
  'POST /api/v1/groups/col-rutiner/searches/': { items: [
    { id: 'ch-1', info_blob_id: 'blob-fall', text: 'Innan den enskilde hjälps upp ska personalen bedöma smärta, yrsel och tecken på huvudskada.', score: 0.91, created_at: '2026-03-12T10:00:00Z', updated_at: '2026-03-12T10:00:00Z' },
    { id: 'ch-2', info_blob_id: 'blob-fall', text: 'Varje fall registreras som avvikelse i Treserva innan arbetspasset avslutas.', score: 0.82, created_at: '2026-03-12T10:00:00Z', updated_at: '2026-03-12T10:00:00Z' },
  ], count: 2 },
  'POST /api/v1/groups/col-mina/searches/': { items: [{ id: 'ch-9', info_blob_id: 'blob-gone', text: 'borttaget', score: 0.95, created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z' }], count: 1 },
  'GET /api/v1/info-blobs/blob-fall/': { id: 'blob-fall', created_at: '2026-03-12T10:00:00Z', updated_at: '2026-03-12T10:00:00Z', metadata: { url: 'https://intra.example/rutin-fall', title: 'Rutin vid fall i ordinärt boende', embedding_model_id: 'em', size: 12000 }, group_id: 'col-rutiner', text: 'Rutin vid fall i ordinärt boende. '.repeat(100), original_available: true, source_metadata: [] },
};
function stack(options: { token?: string | undefined; fixtures?: Record<string, unknown>; status?: number } = {}) {
  const calls: Array<{ key: string; headers: Record<string, string>; body?: unknown }> = [];
  const fixtures = options.fixtures ?? eneoFixtures;
  const eneoFetch: FetchLike = async (input, init) => {
    const url = new URL(String(input));
    const key = `${init?.method ?? 'GET'} ${url.pathname}${url.search}`;
    calls.push({ key, headers: Object.fromEntries(new Headers(init?.headers).entries()), ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) });
    if (options.status) return new Response('', { status: options.status });
    const hit = fixtures[key];
    return hit ? Response.json(hit) : new Response('', { status: 404 });
  };
  let now = Date.parse('2026-11-04T10:42:00Z');
  const eneo = createConnector({ jwks: testJwks, secret, eneoUrl: 'https://eneo.example/', fetch: eneoFetch, now: () => now, ttlSeconds: 300 });
  const connectorFetch: FetchLike = (input, init) => eneo.handle(new Request(input, init));
  const registry = new Registry();
  registry.register(remoteConnector(parseManifest(eneoManifest, 'eneo'), { url: 'http://eneo-connector', key: secret, assert: assertionFor('eneo', secret), fetch: connectorFetch }));
  const context = 'token' in options ? { delegate: async () => options.token } : { delegate: async () => 'idp-token-for-eneo' };
  return { registry, calls, context, advance: (ms: number) => { now += ms; } };
}

describe('the Eneo connector', () => {
  test('searches every collection of every space at once, as the person, and returns the best chunks as hits with their documents', async () => {
    const { registry, calls, context } = stack();
    const result = await registry.run<{ rows: Record<string, unknown>[] }>(hassan, 'eneo.search', { query: 'brukaren har ramlat' }, context);
    expect(result.rows).toEqual([
      { ref: 'blob-fall', kind: 'document', label: 'Rutin vid fall i ordinärt boende', snippet: 'Innan den enskilde hjälps upp ska personalen bedöma smärta, yrsel och tecken på huvudskada.', source: 'Eneo', link: 'https://intra.example/rutin-fall', updatedAt: '2026-03-12T10:00:00Z', section: 'Rutiner hemtjänst', score: 0.91 },
      { ref: 'blob-fall', kind: 'document', label: 'Rutin vid fall i ordinärt boende', snippet: 'Varje fall registreras som avvikelse i Treserva innan arbetspasset avslutas.', source: 'Eneo', link: 'https://intra.example/rutin-fall', updatedAt: '2026-03-12T10:00:00Z', section: 'Rutiner hemtjänst', score: 0.82 },
    ]);
    const keys = calls.map(c => c.key);
    expect(keys.slice(0, 3)).toEqual(['GET /api/v1/spaces/?include_personal=true', 'GET /api/v1/spaces/sp-1/knowledge/', 'GET /api/v1/spaces/sp-2/knowledge/']);
    expect(keys.filter(k => k.startsWith('POST')).sort()).toEqual(['POST /api/v1/groups/col-mina/searches/', 'POST /api/v1/groups/col-rutiner/searches/']);
    expect(calls.find(c => c.key.startsWith('POST'))!.body).toEqual({ search_string: 'brukaren har ramlat', num_chunks: 5, rerank: false });
    // The blob fetch is once per document; the vanished one is left out, not an error.
    expect(keys.filter(k => k.startsWith('GET /api/v1/info-blobs/'))).toEqual(['GET /api/v1/info-blobs/blob-gone/', 'GET /api/v1/info-blobs/blob-fall/']);
    for (const c of calls) {
      expect(c.headers).toMatchObject({ authorization: 'Bearer idp-token-for-eneo', accept: 'application/json' });
      expect(Object.keys(c.headers).sort()).toEqual(c.body ? ['accept', 'authorization', 'content-type'] : ['accept', 'authorization']);
    }
  });
  test('the collection list and the documents are cached for the TTL, per person', async () => {
    const { registry, calls, context, advance } = stack();
    await registry.run(hassan, 'eneo.search', { query: 'fall' }, context);
    const before = calls.length;
    await registry.run(hassan, 'eneo.search', { query: 'avvikelse' }, context);
    // Only the searches and the vanished blob (a miss is not cached) are asked again; the list and the known document are remembered.
    expect(calls.slice(before).map(c => c.key).filter(k => !k.startsWith('POST'))).toEqual(['GET /api/v1/info-blobs/blob-gone/']);
    advance(301_000);
    const mid = calls.length;
    await registry.run(hassan, 'eneo.search', { query: 'fall' }, context);
    expect(calls.slice(mid).map(c => c.key)).toContain('GET /api/v1/spaces/?include_personal=true');
    expect(calls.slice(mid).map(c => c.key)).toContain('GET /api/v1/info-blobs/blob-fall/');
  });
  test('fetch returns one document by its ref; whoami shows the token\'s claims and nothing else', async () => {
    const { registry, context } = stack();
    const hit = await registry.run<Record<string, unknown>>(hassan, 'eneo.fetch', { ref: 'blob-fall' }, context);
    expect(hit).toMatchObject({ ref: 'blob-fall', kind: 'document', label: 'Rutin vid fall i ordinärt boende', link: 'https://intra.example/rutin-fall', source: 'Eneo' });
    expect((hit.snippet as string).length).toBeLessThanOrEqual(1500);
    const claims = Buffer.from(JSON.stringify({ sub: 'u1', aud: 'eneo', iss: 'http://kc/realms/clew', azp: 'clew-web', email: 'hassan@clew.test', email_verified: true, exp: 2, iat: 1, secret: 'never' })).toString('base64url');
    const who = await registry.run<{ claims: Record<string, unknown> }>(hassan, 'eneo.whoami', {}, { delegate: async () => `h.${claims}.s` });
    expect(who.claims).toEqual({ sub: 'u1', aud: 'eneo', iss: 'http://kc/realms/clew', azp: 'clew-web', email: 'hassan@clew.test', email_verified: true, exp: 2, iat: 1 });
    expect(decodeClaims('nonsense')).toBeNull();
  });
  test('without the person\'s token it answers denied; Eneo refusing the token is denied too; Eneo down is unavailable', async () => {
    const { registry } = stack({ token: undefined });
    await expect(registry.run(hassan, 'eneo.search', { query: 'x' }, { delegate: async () => undefined })).rejects.toThrow('Din inloggning kan inte styrkas mot Eneo i den här sessionen.');
    await expect(registry.run(hassan, 'eneo.search', { query: 'x' })).rejects.toThrow('Din inloggning kan inte styrkas mot Eneo i den här sessionen.');
    const refused = stack({ status: 401 });
    await expect(refused.registry.run(hassan, 'eneo.search', { query: 'x' }, refused.context)).rejects.toThrow('Eneo godkänner inte din inloggning.');
    const down = stack({ status: 503 });
    await expect(down.registry.run(hassan, 'eneo.fetch', { ref: 'blob-fall' }, down.context)).rejects.toThrow('Eneo svarar inte just nu.');
  });
  test('is one source in the composite search, with its hits marked by connector and the model seeing only the composite', async () => {
    const { registry, context } = stack();
    registry.register(searchConnector(searchUsecases({ sources: a => registry.searchSources(a), clock: () => new Date('2026-11-04T10:42:00Z') })));
    const result = await registry.run<{ rows: { connector: string; ref: string; stale: boolean | null }[]; sources: unknown[] }>(hassan, 'clew.search', { query: 'brukaren har ramlat' }, context);
    expect(result.rows.map(r => [r.connector, r.ref, r.stale])).toEqual([['eneo', 'blob-fall', false]]);
    expect(result.sources).toEqual([{ id: 'eneo', source: 'Eneo', status: 'ok' }]);
    expect(registry.tools(hassan).map(t => t.name)).toEqual(['clew.search']);
    const withoutToken = await registry.run<{ rows: unknown[]; sources: { id: string; source: string; status: string }[] }>(hassan, 'clew.search', { query: 'x' });
    expect(withoutToken).toEqual({ rows: [], sources: [{ id: 'eneo', source: 'Eneo', status: 'unavailable' }] });
  });
});
