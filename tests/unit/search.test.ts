import { describe, expect, test } from 'bun:test';
import type { SearchHit } from '../../packages/contracts/src/index';
import { CapabilityError, Registry, type Actor, type Connector } from '../../packages/connectors/src/index';
import { headingFollowUps, merge, staleness } from '../../apps/server/src/modules/search/domain';
import { searchConnector } from '../../apps/server/src/modules/search/connector';
import { searchUsecases } from '../../apps/server/src/modules/search/usecases';

/**
 * The composite search (D26): every source at once under a budget, hits merged and marked stale in pure code, the
 * sources that missed reported by name. Fake in-process search connectors stand in for Eneo and an intranet.
 */
const hassan: Actor = { id: 'hassan', name: 'Hassan Ali', unitId: 'unit-hemtjanst', unitLabel: 'Hemtjänst Skönsmon', role: 'employee' };
const NOW = Date.parse('2026-11-04T10:42:00.000Z');
const hit = (over: Partial<SearchHit> & { ref: string }): SearchHit => ({ kind: 'document', label: 'Rutin ' + over.ref, snippet: 'text', source: 'Docs', ...over });

describe('staleness is computed in code, from the source\'s dates', () => {
  test('the review interval from the source, else a year, from reviewedAt, else updatedAt, else unknown', () => {
    expect(staleness({ reviewedAt: '2026-03-12T00:00:00Z' }, NOW)).toBe(false);
    expect(staleness({ reviewedAt: '2025-03-12T00:00:00Z' }, NOW)).toBe(true);
    expect(staleness({ reviewedAt: '2025-03-12T00:00:00Z', reviewIntervalDays: 1095 }, NOW)).toBe(false);
    expect(staleness({ reviewedAt: '2026-09-01T00:00:00Z', reviewIntervalDays: 30 }, NOW)).toBe(true);
    expect(staleness({ updatedAt: '2024-11-02T00:00:00Z' }, NOW)).toBe(true);
    expect(staleness({}, NOW)).toBeNull();
    expect(staleness({ reviewedAt: 'not a date' }, NOW)).toBeNull();
  });
  test('merge interleaves the sources, keeps each source\'s order, drops duplicates, clips snippets and caps the list', () => {
    const rows = merge([
      { id: 'a', source: 'A', status: 'ok', rows: [hit({ ref: '1', snippet: 'x'.repeat(700) }), hit({ ref: '2' }), hit({ ref: '2' })] },
      { id: 'b', source: 'B', status: 'timeout' },
      { id: 'c', source: 'C', status: 'ok', rows: [hit({ ref: '1', reviewedAt: '2020-01-01T00:00:00Z' })] },
    ], NOW);
    expect(rows.map(r => r.connector + ':' + r.ref)).toEqual(['a:1', 'c:1', 'a:2']);
    expect(rows[0]!.snippet).toHaveLength(600);
    expect(rows[0]!.snippet.endsWith('…')).toBe(true);
    expect(rows.map(r => r.stale)).toEqual([null, true, null]);
    expect(merge([{ id: 'a', source: 'A', status: 'ok', rows: Array.from({ length: 30 }, (_, i) => hit({ ref: String(i) })) }], NOW)).toHaveLength(10);
  });
  test('headings become the follow-ups without a model, three at most, no repeats', () => {
    expect(headingFollowUps([{ section: 'Vid fall' }, { section: ' Vid fall ' }, {}, { section: 'Avvikelse' }, { section: 'Anhöriga' }, { section: 'Fyra' }])).toEqual(['Vid fall', 'Avvikelse', 'Anhöriga']);
  });
});

/** A fake document system as an in-process connector: `search` answers from a list, `fetch` by ref; the test controls the delay. */
function source(id: string, rows: SearchHit[], options: { delayMs?: number; fail?: boolean; kinds?: SearchHit['kind'][]; calls?: string[] } = {}): Connector {
  return { id, kind: 'passthrough', source: id.toUpperCase(), areas: [], capabilities: [
    { name: id + '.search', kind: 'read', title: 'Sök i ' + id, description: 'x', input: {} as never, output: {} as never, model: true, scope: {}, ...(options.kinds ? { kinds: options.kinds } : {}),
      run: async (_actor, input: { query: string }) => {
        options.calls?.push(id + ':' + input.query);
        if (options.delayMs) await new Promise(r => setTimeout(r, options.delayMs));
        if (options.fail) throw new CapabilityError(id + ' svarar inte just nu.');
        return { rows };
      } },
    { name: id + '.fetch', kind: 'read', title: 'Hämta', description: 'x', input: {} as never, output: {} as never, model: false, scope: {},
      run: async (_actor, input: { ref: string }) => { const found = rows.find(r => r.ref === input.ref); if (!found) throw new CapabilityError('Finns inte.'); return found; } },
  ] };
}
function world(connectors: Connector[], budget = { perSourceMs: 40, totalMs: 80 }) {
  const registry = new Registry();
  const search = searchUsecases({ sources: a => registry.searchSources(a), clock: () => new Date(NOW), budget });
  for (const c of connectors) registry.register(c);
  registry.register(searchConnector(search));
  return { registry, search };
}

describe('the composite search over the registry', () => {
  test('asks every source at the same time and merges what came back; the model sees one search tool', async () => {
    const calls: string[] = [];
    const w = world([source('docs', [hit({ ref: 'r1', label: 'Rutin vid fall', section: 'Vid fall' })], { calls, delayMs: 10 }), source('intra', [hit({ ref: 'p9', source: 'Intranätet' })], { calls, delayMs: 10 })]);
    const started = Date.now();
    const result = await w.registry.run<{ rows: { ref: string }[]; sources: unknown[] }>(hassan, 'clew.search', { query: 'brukaren har ramlat' });
    expect(Date.now() - started).toBeLessThan(35);
    expect(calls).toEqual(['docs:brukaren har ramlat', 'intra:brukaren har ramlat']);
    expect(result.rows.map(r => r.ref)).toEqual(['r1', 'p9']);
    expect(result.sources).toEqual([{ id: 'docs', source: 'DOCS', status: 'ok' }, { id: 'intra', source: 'INTRA', status: 'ok' }]);
    expect(w.registry.tools(hassan).map(t => t.name)).toEqual(['clew.search']);
    expect(w.registry.searchSources(hassan).map(s => s.name)).toEqual(['docs.search', 'intra.search']);
  });
  test('a slow source is reported as timeout and a failing one as unavailable; the others still answer', async () => {
    const w = world([source('docs', [hit({ ref: 'r1' })]), source('slow', [hit({ ref: 's1' })], { delayMs: 200 }), source('down', [], { fail: true })]);
    const result = await w.registry.run<{ rows: { ref: string }[]; sources: { id: string; status: string }[] }>(hassan, 'clew.search', { query: 'x' });
    expect(result.rows.map(r => r.ref)).toEqual(['r1']);
    expect(result.sources.map(s => s.id + ':' + s.status)).toEqual(['docs:ok', 'slow:timeout', 'down:unavailable']);
  });
  test('the whole fan-out ends at the total budget with what has answered', async () => {
    const w = world([source('a', [hit({ ref: 'a1' })], { delayMs: 5 }), source('b', [hit({ ref: 'b1' })], { delayMs: 60 })], { perSourceMs: 500, totalMs: 30 });
    const result = await w.registry.run<{ rows: { ref: string }[]; sources: { id: string; status: string }[] }>(hassan, 'clew.search', { query: 'x' });
    expect(result.rows.map(r => r.ref)).toEqual(['a1']);
    expect(result.sources.map(s => s.id + ':' + s.status)).toEqual(['a:ok', 'b:timeout']);
  });
  test('kinds narrow the fan-out to sources that can hold the answer; a source without kinds is always asked', async () => {
    const calls: string[] = [];
    const w = world([source('docs', [hit({ ref: 'r1' })], { kinds: ['document'], calls }), source('people', [hit({ ref: 'u1', kind: 'person' })], { kinds: ['person'], calls }), source('any', [hit({ ref: 'x1' })], { calls })]);
    await w.registry.run(hassan, 'clew.search', { query: 'q', kinds: ['person'] });
    expect(calls).toEqual(['people:q', 'any:q']);
  });
  test('a source that answers the wrong shape counts as unavailable', async () => {
    const bad: Connector = { id: 'bad', kind: 'passthrough', source: 'Bad', areas: [], capabilities: [{ name: 'bad.search', kind: 'read', title: 'x', description: 'x', input: {} as never, output: {} as never, model: false, scope: {}, run: async () => ({ hits: [] }) }] };
    const w = world([bad]);
    const result = await w.registry.run<{ sources: { status: string }[] }>(hassan, 'clew.search', { query: 'x' });
    expect(result.sources[0]!.status).toBe('unavailable');
  });
  test('openSource and fetchSource go back to the connector that found the hit, and only to sources in scope', async () => {
    const w = world([source('docs', [hit({ ref: 'r1', link: 'https://intra/rutin' })]), { id: 'secret', kind: 'passthrough', source: 'S', areas: [], capabilities: [
      { name: 'secret.search', kind: 'read', title: 'x', description: 'x', input: {} as never, output: {} as never, model: false, scope: { roles: ['manager'] }, run: async () => ({ rows: [] }) },
      { name: 'secret.fetch', kind: 'read', title: 'x', description: 'x', input: {} as never, output: {} as never, model: false, scope: {}, run: async () => hit({ ref: 'z', link: 'https://leak' }) },
    ] }]);
    expect(await w.registry.run(hassan, 'clew.openSource', { ref: 'docs:r1' })).toEqual({ url: 'https://intra/rutin' });
    expect(await w.registry.run(hassan, 'clew.fetchSource', { ref: 'docs:r1' })).toMatchObject({ ref: 'r1', label: 'Rutin r1' });
    await expect(w.registry.run(hassan, 'clew.openSource', { ref: 'docs:nope' })).rejects.toThrow('Källan går inte att öppna härifrån.');
    await expect(w.registry.run(hassan, 'clew.fetchSource', { ref: 'secret:z' })).rejects.toThrow('Avsnittet finns inte längre.');
  });
});
