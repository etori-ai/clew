import { Registry } from '../registry';
import { describe, expect, test } from 'bun:test';
import type { NewsResult, NewsRow } from '../../packages/contracts/src/index';
import { CapabilityError, SEARCH_CONNECTOR, type Actor, type Connector } from '../../packages/connectors/src/index';
import { parseManifest, remoteConnector, type FetchLike } from '../../packages/connectors/src/remote';
import { merge } from '../../apps/server/src/modules/news/domain';
import { newsCapabilities } from '../../apps/server/src/modules/news/capabilities';
import { newsUsecases } from '../../apps/server/src/modules/news/usecases';
import { createConnector, manifest as communicationManifest } from '../../connectors/communication/connector.mjs';
import { memoryState } from '../../connectors/communication/state.mjs';
import { assertionFor, testJwks } from '../connector-authority';

/**
 * The combined news list (D112, amended 2026-11-11): every news source in the person's scope at once under a budget,
 * the rows newest first whichever source holds them, each opening in Clew in its own source or leaving by its link,
 * and a source that fails, is late or answers out of shape contributing nothing, never an error. Fake in-process news
 * sources stand in for an intranet and a newsroom; the communication fixture joins as a source over the protocol.
 */
const at = Date.parse('2026-11-11T09:00:00Z');
const hour = 3_600_000;
const ago = (hours: number) => new Date(at - hours * hour).toISOString();

const mikael: Actor = {
  id: 'mikael',
  name: 'Mikael Lind',
  unitId: 'unit-it',
  unitLabel: 'IT-enheten',
  role: 'employee',
};
const hillevi: Actor = { ...mikael, id: 'hillevi', name: 'Hillevi Berg', role: 'manager' };

const row = (source: string, n: number, over: Partial<NewsRow> = {}): NewsRow => ({
  ref: `${source}:${n}`,
  title: `Nyhet ${n} från ${source}`,
  sender: 'Kommunledningen',
  publishedAt: ago(n),
  ...over,
});

describe('rows from several news sources become one list, in pure code', () => {
  test('newest first whichever source holds it, a repeated ref once, and the list capped', () => {
    const rows = merge([
      { id: 'intranet', source: 'Intranätet', rows: [row('intranet', 5), row('intranet', 1), row('intranet', 1)] },
      { id: 'newsroom', source: 'Nyhetsrummet', rows: [row('newsroom', 3), row('newsroom', 0.5)] },
      { id: 'silent', source: 'Tyst', rows: [] },
    ]);
    expect(rows.map(r => [r.ref, r.connector, r.system])).toEqual([
      ['newsroom:0.5', 'newsroom', 'Nyhetsrummet'],
      ['intranet:1', 'intranet', 'Intranätet'],
      ['newsroom:3', 'newsroom', 'Nyhetsrummet'],
      ['intranet:5', 'intranet', 'Intranätet'],
    ]);
    expect(
      merge([{ id: 'a', source: 'A', rows: Array.from({ length: 150 }, (_, i) => row('a', i + 1)) }]),
    ).toHaveLength(100);
  });
  test('at the same instant the order is stable: by source, then by ref', () => {
    const same = ago(2);
    const rows = merge([
      { id: 'b', source: 'B', rows: [row('b', 2, { ref: 'b:2', publishedAt: same })] },
      {
        id: 'a',
        source: 'A',
        rows: [row('a', 9, { ref: 'a:9', publishedAt: same }), row('a', 1, { ref: 'a:1', publishedAt: same })],
      },
    ]);
    expect(rows.map(r => r.ref)).toEqual(['a:1', 'a:9', 'b:2']);
  });
});

/** A fake news source as an in-process connector: `<id>.news` answers from a list, `<id>.newsItem` opens one. */
function newsSource(
  id: string,
  source: string,
  rows: unknown[],
  options: { delayMs?: number; fail?: boolean; calls?: unknown[]; roles?: Actor['role'][]; open?: boolean } = {},
): Connector {
  return {
    id,
    kind: 'passthrough',
    source,
    areas: [],
    capabilities: [
      {
        name: id + '.news',
        kind: 'read',
        title: 'Nyheter i ' + source,
        description: 'x',
        input: {} as never,
        output: {} as never,
        model: true,
        scope: options.roles ? { roles: options.roles } : {},
        view: {
          kind: 'list',
          title: 'title',
          ref: 'ref',
          ...(options.open === false
            ? {}
            : { open: { capability: id + '.newsItem', title: 'Nyhet', params: { ref: 'ref' } } }),
          fields: [{ key: 'title', label: 'Rubrik' }],
        },
        run: async (_actor, input: unknown) => {
          options.calls?.push(input);
          if (options.delayMs) await new Promise(r => setTimeout(r, options.delayMs));
          if (options.fail) throw new CapabilityError(source + ' svarar inte just nu.');
          return { rows };
        },
      },
      {
        name: id + '.newsItem',
        kind: 'read',
        title: 'Nyhet',
        description: 'x',
        input: {} as never,
        output: {} as never,
        model: false,
        scope: {},
        run: async () => ({}),
      },
    ],
  };
}
function world(connectors: Connector[], budget = { perSourceMs: 40, totalMs: 80 }) {
  const registry = new Registry();
  const news = newsUsecases({ sources: a => registry.newsSources(a), budget });
  for (const c of connectors) registry.register(c);
  registry.register({
    id: SEARCH_CONNECTOR,
    kind: 'core',
    source: 'Startsidan',
    areas: [],
    ...newsCapabilities(news, a => registry.newsSources(a).length > 0),
    uses: ['*'],
  });
  return registry;
}
const list = (registry: Registry, actor: Actor, context = {}) =>
  registry.run<NewsResult>(actor, 'clew.news', {}, context);

describe('clew.news', () => {
  test('asks every news source at once with nothing, and answers one list newest first, each row opening in its own source', async () => {
    const calls: unknown[] = [];
    const registry = world([
      newsSource('intranet', 'Intranätet', [row('intranet', 4)], { calls }),
      newsSource('newsroom', 'Nyhetsrummet', [row('newsroom', 1, { sender: 'HR' })], { calls }),
    ]);
    const result = await list(registry, mikael);
    expect(result).toEqual({
      rows: [
        {
          ...row('newsroom', 1, { sender: 'HR' }),
          connector: 'newsroom',
          system: 'Nyhetsrummet',
          view: {
            capability: 'newsroom.newsItem',
            input: { ref: 'newsroom:1' },
            title: 'Nyhet',
            source: 'Nyhetsrummet',
          },
        },
        {
          ...row('intranet', 4),
          connector: 'intranet',
          system: 'Intranätet',
          view: { capability: 'intranet.newsItem', input: { ref: 'intranet:4' }, title: 'Nyhet', source: 'Intranätet' },
        },
      ],
    });
    // Every source is asked the same question, and nothing else.
    expect(calls).toEqual([{}, {}]);
  });

  test('a row with a link leaves Clew by it and opens nothing in Clew; a source without an open read opens nothing', async () => {
    const registry = world([
      newsSource('intranet', 'Intranätet', [row('intranet', 1, { link: 'https://intranat.example/nyheter/1' })]),
      newsSource('newsroom', 'Nyhetsrummet', [row('newsroom', 2)], { open: false }),
    ]);
    const result = await list(registry, mikael);
    expect(result.rows.map(r => [r.ref, r.link ?? null, r.view ?? null])).toEqual([
      ['intranet:1', 'https://intranat.example/nyheter/1', null],
      ['newsroom:2', null, null],
    ]);
  });

  test('a source that fails or is late contributes nothing, and when none answers the list is empty, never an error', async () => {
    const registry = world([
      newsSource('intranet', 'Intranätet', [row('intranet', 1)]),
      newsSource('newsroom', 'Nyhetsrummet', [row('newsroom', 1)], { fail: true }),
      newsSource('radio', 'Lokalradion', [row('radio', 1)], { delayMs: 200 }),
    ]);
    const result = await list(registry, mikael);
    expect(result.rows.map(r => r.ref)).toEqual(['intranet:1']);
    // Nothing names the sources that did not answer: news is never an error on Hem.
    expect(Object.keys(result)).toEqual(['rows']);
    const none = world([
      newsSource('newsroom', 'Nyhetsrummet', [], { fail: true }),
      newsSource('radio', 'Lokalradion', [], { delayMs: 200 }),
    ]);
    expect(await list(none, mikael)).toEqual({ rows: [] });
  });

  test('the whole fan-out has one budget: what has answered by then is listed', async () => {
    const registry = world(
      [
        newsSource('intranet', 'Intranätet', [row('intranet', 1)]),
        newsSource('radio', 'Lokalradion', [row('radio', 1)], { delayMs: 60 }),
      ],
      { perSourceMs: 100, totalMs: 30 },
    );
    expect((await list(registry, mikael)).rows.map(r => r.ref)).toEqual(['intranet:1']);
  });

  test('an answer that is not news rows is accepted only whole: each refusal drops the whole source, never a row of it', async () => {
    const good = row('ok', 1);
    const refusals: Array<[string, unknown]> = [
      // A body or an image would make the list a news site; the profile carries a headline, a sender and a time.
      ['a body', { ...row('a', 1), body: 'Hela texten …' }],
      ['an image', { ...row('b', 1), image: 'https://intranat.example/bild.jpg' }],
      ['no sender', { ref: 'c:1', title: 'Rubrik', publishedAt: ago(1) }],
      ['an empty title', { ...row('d', 1), title: '' }],
      ['a time that is not an instant', { ...row('e', 1), publishedAt: 'i går' }],
      ['a link that is not http(s)', { ...row('f', 1), link: 'javascript:alert(1)' }],
      ['a ref with a space', { ...row('g', 1), ref: 'g 1' }],
    ];
    const registry = world([
      newsSource('ok', 'Godkänd', [good]),
      ...refusals.map(([, bad], i) => newsSource(`bad${i}`, `Källa ${i}`, [row(`bad${i}`, 2), bad])),
      // Not even an object of rows.
      newsSource('shape', 'Formlös', 'inte en lista' as unknown as unknown[]),
    ]);
    const result = await list(registry, mikael);
    expect(result.rows.map(r => r.ref)).toEqual(['ok:1']);
    expect(JSON.stringify(result)).not.toContain('Hela texten');
  });

  test('a person is only asked about the sources in their scope, and has no list, no menu row and no tool without one', async () => {
    const calls: unknown[] = [];
    const registry = world([
      newsSource('newsroom', 'Nyhetsrummet', [row('newsroom', 1)], { roles: ['manager'], calls }),
    ]);
    expect((await list(registry, hillevi)).rows).toHaveLength(1);
    expect(registry.newsSources(mikael)).toEqual([]);
    expect(registry.allowed(mikael, 'clew.news')).toBeUndefined();
    await expect(list(registry, mikael)).rejects.toThrow();
    expect(calls).toHaveLength(1);
    expect(world([]).allowed(hillevi, 'clew.news')).toBeUndefined();
    expect(registry.tools(mikael).map(t => t.name)).not.toContain('clew.news');
    // The news list can be placed in the menu like any tool (D40); a person without a source does not get the row.
    registry.govern(SEARCH_CONNECTOR, {
      ...registry.governance(SEARCH_CONNECTOR),
      capabilities: { 'clew.news': { menu: true } },
    });
    expect(registry.menu(hillevi).map(e => [e.capability, e.label, e.icon])).toEqual([
      ['clew.news', 'Nyheter', 'book'],
    ]);
    expect(registry.menu(mikael)).toEqual([]);
  });

  test('the model is offered the one combined list, never a source, reads a summary, and is never offered a write', async () => {
    const registry = world([
      newsSource('intranet', 'Intranätet', [row('intranet', 1)]),
      newsSource('newsroom', 'Nyhetsrummet', [row('newsroom', 1)]),
    ]);
    const tools = registry.tools(mikael).filter(t => t.name.endsWith('.news'));
    expect(tools.map(t => [t.name, t.kind])).toEqual([['clew.news', 'read']]);
    expect(registry.viewFor(mikael, 'clew.news')).toMatchObject({
      kind: 'list',
      connector: 'clew',
      rowViews: true,
      modelReads: 'summary',
    });
    expect(registry.viewFor(mikael, 'intranet.news')).not.toHaveProperty('rowViews');
  });

  test('the communication fixture is a news source over the protocol: its notices, newest first, leading out or opening their text', async () => {
    const secret = 'test-secret-test-secret';
    const service = createConnector({
      jwks: testJwks,
      secret,
      state: memoryState(),
      clock: () => new Date('2026-11-04T08:00:00+01:00'),
    });
    const connectorFetch: FetchLike = (input, init) => service.handle(new Request(input, init));
    const registry = world(
      [
        remoteConnector(parseManifest(communicationManifest, 'communication'), {
          url: 'http://communication',
          key: secret,
          assert: assertionFor('communication', secret),
          fetch: connectorFetch,
        }),
        newsSource('intranet', 'Intranätet', [row('intranet', 1, { publishedAt: '2026-11-04T06:00:00.000Z' })]),
      ],
      { perSourceMs: 2000, totalMs: 3000 },
    );
    const result = await list(registry, hillevi);
    expect(result.rows.map(r => [r.title, r.sender, r.system])).toEqual([
      ['Nyhet 1 från intranet', 'Kommunledningen', 'Intranätet'],
      ['Ny rutin vid hot och våld', 'Barn och utbildning', 'Kommunikation'],
      ['Enkät om matsalen', 'Kostenheten', 'Kommunikation'],
    ]);
    // The notice the system shows in full leaves Clew by its link; the one without opens its text in Clew.
    expect(result.rows[1]!.link).toBe('https://kommunikation.example.invalid/meddelanden/2026-44-1');
    expect(result.rows[1]).not.toHaveProperty('view');
    expect(result.rows[2]).not.toHaveProperty('link');
    expect(result.rows[2]!.view).toEqual({
      capability: 'communication.newsItem',
      input: { ref: 'communication:notice:2026-44-2' },
      title: 'Nyhet',
      source: 'Kommunikation',
    });
    expect(
      await registry.run(hillevi, 'communication.newsItem', { ref: 'communication:notice:2026-44-1' }),
    ).toMatchObject({ title: 'Ny rutin vid hot och våld', sender: 'Barn och utbildning' });
  });
});
