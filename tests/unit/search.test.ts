import { Registry } from '../registry';
import { describe, expect, test } from 'bun:test';
import type { SearchHit, Subject } from '../../packages/contracts/src/index';
import { CapabilityError, type Actor, type Connector } from '../../packages/connectors/src/index';
import { headingFollowUps, merge, staleness } from '../../apps/server/src/modules/search/domain';
import { searchConnector } from '../../apps/server/src/modules/search/connector';
import { searchUsecases } from '../../apps/server/src/modules/search/usecases';
import type { SearchDeps } from '../../apps/server/src/modules/search/model';
import type { UserRecord } from '../../apps/server/src/modules/people/domain';
import { memoryPersonKeys } from '../person-keys';

/**
 * The composite search (D26): every source at once under a budget, hits merged and marked stale in pure code, the
 * sources that missed reported by name. Fake in-process search connectors stand in for Eneo and an intranet.
 */
const hassan: Actor = {
  id: 'hassan',
  name: 'Hassan Ali',
  unitId: 'unit-hemtjanst',
  unitLabel: 'Hemtjänst Skönsmon',
  role: 'employee',
};
const NOW = Date.parse('2026-11-04T10:42:00.000Z');
const hit = (over: Partial<SearchHit> & { ref: string }): SearchHit => ({
  kind: 'document',
  label: 'Rutin ' + over.ref,
  snippet: 'text',
  source: 'Docs',
  ...over,
});

describe("staleness is computed in code, from the source's dates", () => {
  test('the review interval from the source, else a year, from reviewedAt, else updatedAt, else unknown', () => {
    expect(staleness({ reviewedAt: '2026-03-12T00:00:00Z' }, NOW)).toBe(false);
    expect(staleness({ reviewedAt: '2025-03-12T00:00:00Z' }, NOW)).toBe(true);
    expect(staleness({ reviewedAt: '2025-03-12T00:00:00Z', reviewIntervalDays: 1095 }, NOW)).toBe(false);
    expect(staleness({ reviewedAt: '2026-09-01T00:00:00Z', reviewIntervalDays: 30 }, NOW)).toBe(true);
    expect(staleness({ updatedAt: '2024-11-02T00:00:00Z' }, NOW)).toBe(true);
    expect(staleness({}, NOW)).toBeNull();
    expect(staleness({ reviewedAt: 'not a date' }, NOW)).toBeNull();
  });
  test("merge interleaves the sources, keeps each source's order, drops duplicates, clips snippets and caps the list", () => {
    const rows = merge(
      [
        {
          id: 'a',
          source: 'A',
          status: 'ok',
          rows: [hit({ ref: '1', snippet: 'x'.repeat(700) }), hit({ ref: '2' }), hit({ ref: '2' })],
        },
        { id: 'b', source: 'B', status: 'timeout' },
        { id: 'c', source: 'C', status: 'ok', rows: [hit({ ref: '1', reviewedAt: '2020-01-01T00:00:00Z' })] },
      ],
      NOW,
    );
    expect(rows.map(r => r.connector + ':' + r.ref)).toEqual(['a:1', 'c:1', 'a:2']);
    expect(rows[0]!.snippet).toHaveLength(600);
    expect(rows[0]!.snippet.endsWith('…')).toBe(true);
    expect(rows.map(r => r.stale)).toEqual([null, true, null]);
    expect(
      merge(
        [{ id: 'a', source: 'A', status: 'ok', rows: Array.from({ length: 30 }, (_, i) => hit({ ref: String(i) })) }],
        NOW,
      ),
    ).toHaveLength(10);
  });
  test('hits about the same person from several sources are one hit, the first one where it came, naming every source that answered (D97 item 6)', () => {
    const anna = { entity: 'person' as const, key: 'anna.l' };
    const person = (ref: string, source: string, subject: Subject = anna) =>
      hit({ ref, kind: 'person', label: 'Anna Lindqvist', source, subject });
    const rows = merge(
      [
        {
          id: 'phonebook',
          source: 'Telefonboken',
          status: 'ok',
          rows: [person('p1', 'Telefonboken'), hit({ ref: 'd1' })],
        },
        // The key without regard to case for a person; a second hit of the same source adds no source.
        {
          id: 'hr',
          source: 'Personalsystemet',
          status: 'ok',
          rows: [person('h1', 'Personalsystemet', { ...anna, key: 'Anna.L' }), person('h2', 'Personalsystemet')],
        },
        { id: 'docs', source: 'Intranätet', status: 'ok', rows: [hit({ ref: 'x1' }), hit({ ref: 'x2' })] },
        {
          id: 'unit',
          source: 'Lokalsystemet',
          status: 'ok',
          rows: [person('u1', 'Lokalsystemet', { entity: 'unit', key: 'anna.l' })],
        },
      ],
      NOW,
    );
    expect(rows.map(r => [r.connector, r.ref, r.sources?.map(s => s.source)])).toEqual([
      ['phonebook', 'p1', ['Telefonboken', 'Personalsystemet']],
      ['docs', 'x1', undefined],
      // A unit with the same key is another entity.
      ['unit', 'u1', undefined],
      ['phonebook', 'd1', undefined],
      ['docs', 'x2', undefined],
    ]);
    expect(rows[0]).toMatchObject({
      label: 'Anna Lindqvist',
      source: 'Telefonboken',
      subject: anna,
      connector: 'phonebook',
    });
    expect(rows[0]!.sources).toEqual([
      { connector: 'phonebook', source: 'Telefonboken' },
      { connector: 'hr', source: 'Personalsystemet' },
    ]);
    // A source whose hit about a listed person came after the list was full still answered for her.
    const full = merge(
      [
        {
          id: 'a',
          source: 'A',
          status: 'ok',
          rows: [person('pa', 'A'), ...Array.from({ length: 12 }, (_, i) => hit({ ref: 'a' + i }))],
        },
        {
          id: 'b',
          source: 'B',
          status: 'ok',
          rows: [...Array.from({ length: 12 }, (_, i) => hit({ ref: 'b' + i })), person('pb', 'B')],
        },
      ],
      NOW,
    );
    expect(full).toHaveLength(10);
    expect(full[0]!.sources?.map(s => s.connector)).toEqual(['a', 'b']);
  });
  test('a user name is the same person in its decomposed form and its composed one, as Clew stores it (D116, NFC)', () => {
    const person = (ref: string, key: string) => hit({ ref, kind: 'person', subject: { entity: 'person', key } });
    const rows = merge(
      [
        // "å" as "a" and a combining ring, as some systems send it, and as the one character.
        { id: 'a', source: 'A', status: 'ok', rows: [person('a1', 'a\u030asa.oberg')] },
        { id: 'b', source: 'B', status: 'ok', rows: [person('b1', '\u00c5sa.Oberg')] },
      ],
      NOW,
    );
    expect(rows.map(r => [r.ref, r.sources?.map(s => s.connector)])).toEqual([['a1', ['a', 'b']]]);
  });
  test('headings become the follow-ups without a model, three at most, no repeats', () => {
    expect(
      headingFollowUps([
        { section: 'Vid fall' },
        { section: ' Vid fall ' },
        {},
        { section: 'Avvikelse' },
        { section: 'Anhöriga' },
        { section: 'Fyra' },
      ]),
    ).toEqual(['Vid fall', 'Avvikelse', 'Anhöriga']);
  });
});

/** A fake document system as an in-process connector: `search` answers from a list, `fetch` by ref; the test controls the delay. */
function source(
  id: string,
  rows: SearchHit[],
  options: { delayMs?: number; fail?: boolean; kinds?: SearchHit['kind'][]; calls?: string[] } = {},
): Connector {
  return {
    id,
    kind: 'passthrough',
    source: id.toUpperCase(),
    areas: [],
    capabilities: [
      {
        name: id + '.search',
        kind: 'read',
        title: 'Sök i ' + id,
        description: 'x',
        input: {} as never,
        output: {} as never,
        model: true,
        scope: {},
        ...(options.kinds ? { kinds: options.kinds } : {}),
        run: async (_actor, input: { query: string }) => {
          options.calls?.push(id + ':' + input.query);
          if (options.delayMs) await new Promise(r => setTimeout(r, options.delayMs));
          if (options.fail) throw new CapabilityError(id + ' svarar inte just nu.');
          return { rows };
        },
      },
      {
        name: id + '.fetch',
        kind: 'read',
        title: 'Hämta',
        description: 'x',
        input: {} as never,
        output: {} as never,
        model: false,
        scope: {},
        run: async (_actor, input: { ref: string }) => {
          const found = rows.find(r => r.ref === input.ref);
          if (!found) throw new CapabilityError('Finns inte.');
          return found;
        },
      },
    ],
  };
}
function world(connectors: Connector[], budget = { perSourceMs: 40, totalMs: 80 }, people?: SearchDeps['people']) {
  const registry = new Registry();
  const search = searchUsecases({
    sources: a => registry.searchSources(a),
    clock: () => new Date(NOW),
    budget,
    ...(people ? { people } : {}),
  });
  for (const c of connectors) registry.register(c);
  registry.register(searchConnector(search));
  return { registry, search };
}

describe('the composite search over the registry', () => {
  test('asks every source at the same time and merges what came back; the model sees one search tool', async () => {
    const calls: string[] = [];
    const w = world([
      source('docs', [hit({ ref: 'r1', label: 'Rutin vid fall', section: 'Vid fall' })], { calls, delayMs: 10 }),
      source('intra', [hit({ ref: 'p9', source: 'Intranätet' })], { calls, delayMs: 10 }),
    ]);
    const started = Date.now();
    const result = await w.registry.run<{ rows: { ref: string }[]; sources: unknown[] }>(hassan, 'clew.search', {
      query: 'brukaren har ramlat',
    });
    expect(Date.now() - started).toBeLessThan(35);
    expect(calls).toEqual(['docs:brukaren har ramlat', 'intra:brukaren har ramlat']);
    expect(result.rows.map(r => r.ref)).toEqual(['r1', 'p9']);
    expect(result.sources).toEqual([
      { id: 'docs', source: 'DOCS', status: 'ok' },
      { id: 'intra', source: 'INTRA', status: 'ok' },
    ]);
    expect(w.registry.tools(hassan).map(t => t.name)).toEqual(['clew.search']);
    expect(w.registry.searchSources(hassan).map(s => s.name)).toEqual(['docs.search', 'intra.search']);
  });
  test("a hit that names a person by user name names the one of the reader's organisation who holds it, by id (D116)", async () => {
    const user = (id: string, userName: string, organisationId = 'org'): UserRecord => ({
      id,
      organisationId,
      externalId: null,
      userName,
      name: id,
      email: null,
      title: null,
      enabled: true,
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-01T00:00:00.000Z',
      phoneNumbers: [],
      employments: [],
    });
    const users = new Map(
      [user('hassan', 'hassan.ali'), user('anna', 'anna.lindqvist'), user('outsider', 'ute.person', 'other')].map(
        u => [u.id, u] as const,
      ),
    );
    const keys = memoryPersonKeys({ users });
    const asked: Array<[string, readonly string[]]> = [];
    const person = (ref: string, key: string, label = 'Anna Lindqvist') =>
      hit({ ref, kind: 'person', label, subject: { entity: 'person', key } });
    const sources = [
      source('phonebook', [person('p1', 'Anna.Lindqvist'), person('p2', 'okand', 'Okänd'), person('p3', 'ute.person')]),
      // The same person in another spelling, and a unit, whose id is both keys.
      source('hr', [
        person('h1', 'anna.lindqvist'),
        hit({ ref: 'u1', kind: 'room', subject: { entity: 'unit', key: 'u-1' } }),
      ]),
    ];
    const w = world(sources, undefined, {
      holders: async (readerId, names) => {
        asked.push([readerId, names]);
        return keys.holders(readerId, names);
      },
    });
    type Row = { connector: string; ref: string; subject?: Subject; sources?: Array<{ connector: string }> };
    const result = await w.registry.run<{ rows: Row[] }>(hassan, 'clew.search', { query: 'anna' });
    expect(result.rows.map(r => [r.connector, r.ref, r.subject, r.sources?.map(s => s.connector)])).toEqual([
      // Two sources' hits about Anna are one, which links to her page by her id.
      ['phonebook', 'p1', { entity: 'person', key: 'anna' }, ['phonebook', 'hr']],
      // A user name nobody of the reader's organisation holds, here or only in another, names nobody: the hit stays.
      ['phonebook', 'p2', undefined, undefined],
      ['hr', 'u1', { entity: 'unit', key: 'u-1' }, undefined],
      ['phonebook', 'p3', undefined, undefined],
    ]);
    // One question for the list, as the reader, each user name once, in the spelling of the hit that was kept.
    expect(asked).toEqual([['hassan', ['Anna.Lindqvist', 'okand', 'ute.person']]]);
    // Without the people wired, a hit names no person; a unit is unchanged.
    const unwired = await world(sources).registry.run<{ rows: Row[] }>(hassan, 'clew.search', { query: 'anna' });
    expect(unwired.rows.map(r => [r.ref, r.subject])).toEqual([
      ['p1', undefined],
      ['p2', undefined],
      ['u1', { entity: 'unit', key: 'u-1' }],
      ['p3', undefined],
    ]);
  });
  test('a slow source is reported as timeout and a failing one as unavailable; the others still answer', async () => {
    const w = world([
      source('docs', [hit({ ref: 'r1' })]),
      source('slow', [hit({ ref: 's1' })], { delayMs: 200 }),
      source('down', [], { fail: true }),
    ]);
    const result = await w.registry.run<{ rows: { ref: string }[]; sources: { id: string; status: string }[] }>(
      hassan,
      'clew.search',
      { query: 'x' },
    );
    expect(result.rows.map(r => r.ref)).toEqual(['r1']);
    expect(result.sources.map(s => s.id + ':' + s.status)).toEqual(['docs:ok', 'slow:timeout', 'down:unavailable']);
  });
  test('the whole fan-out ends at the total budget with what has answered', async () => {
    const w = world(
      [source('a', [hit({ ref: 'a1' })], { delayMs: 5 }), source('b', [hit({ ref: 'b1' })], { delayMs: 60 })],
      { perSourceMs: 500, totalMs: 30 },
    );
    const result = await w.registry.run<{ rows: { ref: string }[]; sources: { id: string; status: string }[] }>(
      hassan,
      'clew.search',
      { query: 'x' },
    );
    expect(result.rows.map(r => r.ref)).toEqual(['a1']);
    expect(result.sources.map(s => s.id + ':' + s.status)).toEqual(['a:ok', 'b:timeout']);
  });
  test('kinds narrow the fan-out to sources that can hold the answer; a source without kinds is always asked', async () => {
    const calls: string[] = [];
    const w = world([
      source('docs', [hit({ ref: 'r1' })], { kinds: ['document'], calls }),
      source('people', [hit({ ref: 'u1', kind: 'person' })], { kinds: ['person'], calls }),
      source('any', [hit({ ref: 'x1' })], { calls }),
    ]);
    await w.registry.run(hassan, 'clew.search', { query: 'q', kinds: ['person'] });
    expect(calls).toEqual(['people:q', 'any:q']);
  });
  test('a source that answers the wrong shape counts as unavailable', async () => {
    const bad: Connector = {
      id: 'bad',
      kind: 'passthrough',
      source: 'Bad',
      areas: [],
      capabilities: [
        {
          name: 'bad.search',
          kind: 'read',
          title: 'x',
          description: 'x',
          input: {} as never,
          output: {} as never,
          model: false,
          scope: {},
          run: async () => ({ hits: [] }),
        },
      ],
    };
    const w = world([bad]);
    const result = await w.registry.run<{ sources: { status: string }[] }>(hassan, 'clew.search', { query: 'x' });
    expect(result.sources[0]!.status).toBe('unavailable');
  });
  test('openSource and fetchSource go back to the connector that found the hit, and only to sources in scope', async () => {
    const w = world([
      source('docs', [hit({ ref: 'r1', link: 'https://intra/rutin' })]),
      {
        id: 'secret',
        kind: 'passthrough',
        source: 'S',
        areas: [],
        capabilities: [
          {
            name: 'secret.search',
            kind: 'read',
            title: 'x',
            description: 'x',
            input: {} as never,
            output: {} as never,
            model: false,
            scope: { roles: ['manager'] },
            run: async () => ({ rows: [] }),
          },
          {
            name: 'secret.fetch',
            kind: 'read',
            title: 'x',
            description: 'x',
            input: {} as never,
            output: {} as never,
            model: false,
            scope: {},
            run: async () => hit({ ref: 'z', link: 'https://leak' }),
          },
        ],
      },
    ]);
    expect(await w.registry.run(hassan, 'clew.openSource', { ref: 'docs:r1' })).toEqual({ url: 'https://intra/rutin' });
    expect(await w.registry.run(hassan, 'clew.fetchSource', { ref: 'docs:r1' })).toMatchObject({
      ref: 'r1',
      label: 'Rutin r1',
    });
    await expect(w.registry.run(hassan, 'clew.openSource', { ref: 'docs:nope' })).rejects.toThrow(
      'Källan går inte att öppna härifrån.',
    );
    await expect(w.registry.run(hassan, 'clew.fetchSource', { ref: 'secret:z' })).rejects.toThrow(
      'Avsnittet finns inte längre.',
    );
  });
});
