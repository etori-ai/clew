import { afterEach, describe, expect, test } from 'bun:test';
import fixture from '../../packages/site-header/fixtures/site-menu.json';
import {
  flattenSiteMenu,
  parseSiteMenu,
  selectedItem,
  withHref,
  type SiteMenu,
} from '../../packages/site-header/src/menu';
import { absoluteHref, menuSource, walkTree, withListing } from '../../packages/site-header/src/sources';
import {
  sitevisionHeadlessUrl,
  sitevisionPages,
  sitevisionSource,
  type SitevisionNode,
} from '../../packages/site-header/src/sources/sitevision';
import {
  plainTitle,
  wordpressPages,
  wordpressPagesUrl,
  wordpressSource,
} from '../../packages/site-header/src/sources/wordpress';

const menu = (items: SiteMenu['items']): SiteMenu => ({
  version: 1,
  site: { name: 'Startsidan', href: '/portal/' },
  items,
});

describe('the shared header menu (D87)', () => {
  test('the fixture is a menu the header will draw', () => {
    const parsed = parseSiteMenu(fixture);
    expect(parsed.items.map(item => item.id)).toEqual([
      'start',
      'anstallning-arbetsmiljo',
      'ekonomi-styrning',
      'kompetensforsorjning',
      'organisation',
    ]);
  });

  test('addresses are root-relative paths or http(s); nothing a link could run or leave by', () => {
    const bad = ['javascript:alert(1)', '//evil.example/x', 'intranat/x', 'data:text/html,x', '/a\\b', ' '];
    for (const href of bad)
      expect(() => parseSiteMenu(menu([{ id: 'x', label: 'X', href }]))).toThrow(/Invalid site menu/);
    const ok = parseSiteMenu(menu([{ id: 'x', label: 'X', href: 'https://intranet.example.org/a' }]));
    expect(ok.items[0]!.href).toBe('https://intranet.example.org/a');
  });

  test('refuses a second item with the same id, an empty menu and an unknown version', () => {
    const one = { id: 'a', label: 'A', href: '/a' };
    expect(() => parseSiteMenu(menu([one, one]))).toThrow(/appears twice/);
    expect(() => parseSiteMenu(menu([]))).toThrow(/non-empty array/);
    expect(() => parseSiteMenu({ ...menu([one]), version: 2 })).toThrow(/version/);
  });

  test('a page belongs to the longest item address that is it or its parent, on the same origin', () => {
    const m = menu([
      { id: 'start', label: 'Start', href: '/portal/' },
      { id: 'ekonomi', label: 'Ekonomi', href: '/intranat/ekonomi' },
      { id: 'budget', label: 'Budget', href: '/intranat/ekonomi/budget' },
      { id: 'away', label: 'Away', href: 'https://elsewhere.example.org/intranat/organisation' },
    ]);
    const at = (path: string) => selectedItem(m, `https://start.example.org${path}`);
    expect(at('/portal/')).toBe('start');
    expect(at('/portal/activities')).toBe('start');
    expect(at('/intranat/ekonomi')).toBe('ekonomi');
    expect(at('/intranat/ekonomi/')).toBe('ekonomi');
    expect(at('/intranat/ekonomi/budget/2027')).toBe('budget');
    // A trailing slash on either side is the same page.
    const wp = menu([{ id: 'org', label: 'Organisation', href: 'https://start.example.org/intranat/organisation/' }]);
    expect(selectedItem(wp, 'https://start.example.org/intranat/organisation')).toBe('org');
    expect(selectedItem(wp, 'https://start.example.org/intranat/organisation/enheter')).toBe('org');
    // A shared prefix is not a parent.
    expect(at('/intranat/ekonomisk-rapport')).toBeNull();
    expect(at('/intranat/organisation')).toBeNull();
    expect(at('/intranat/')).toBeNull();
  });

  test('a host can point one item elsewhere, and the listing walks every level', () => {
    const m = withHref(
      menu([
        { id: 'start', label: 'Start', href: '/portal/' },
        { id: 'a', label: 'A', href: '/a', children: [{ id: 'a1', label: 'A1', href: '/a/1' }] },
      ]),
      'start',
      '/',
    );
    expect(m.items[0]!.href).toBe('/');
    expect(() => withHref(m, 'start', 'javascript:x')).toThrow();
    expect(flattenSiteMenu(m).map(page => [page.trail.join('/'), page.label])).toEqual([
      ['', 'Start'],
      ['', 'A'],
      ['A', 'A1'],
    ]);
  });
});

describe('menu sources are adapters behind one port (D87)', () => {
  const base = 'https://intranet.example.org';

  test('a source is chosen by name, and an unknown name is an error', () => {
    expect(menuSource('sitevision')).toBe(sitevisionSource);
    expect(menuSource('wordpress')).toBe(wordpressSource);
    expect(() => menuSource('toString')).toThrow(/Unknown menu source/);
  });

  test('every address a source reports is absolute on http(s)', () => {
    expect(absoluteHref('/intranat/organisation', base)).toBe('https://intranet.example.org/intranat/organisation');
    expect(absoluteHref('https://other.example.org/x', base)).toBe('https://other.example.org/x');
    expect(absoluteHref('javascript:alert(1)', base)).toBeNull();
    expect(absoluteHref('', base)).toBeNull();
    expect(absoluteHref(42, base)).toBeNull();
  });

  test('the walker fetches depth levels, nests children and does not follow a page under itself', async () => {
    const tree: Record<string, Array<{ id: string; label: string; href: string }>> = {
      root: [
        { id: 'a', label: 'A', href: `${base}/a` },
        { id: 'b', label: 'B', href: `${base}/b` },
      ],
      a: [
        { id: 'a1', label: 'A1', href: `${base}/a/1` },
        { id: 'a', label: 'A again', href: `${base}/a` },
      ],
      a1: [{ id: 'deep', label: 'Deep', href: `${base}/deep` }],
    };
    const asked: string[] = [];
    const children = async (id: string) => {
      asked.push(id);
      return tree[id] ?? [];
    };
    expect(await walkTree(children, 'root', 1)).toEqual(tree.root!);
    asked.length = 0;
    const two = await walkTree(children, 'root', 2);
    expect(asked.sort()).toEqual(['a', 'b', 'root']);
    expect(two[0]!.children).toEqual([{ id: 'a1', label: 'A1', href: `${base}/a/1` }]);
    expect(two[1]!.children).toBeUndefined();
  });

  test('a listing keeps the site and Start and replaces the other places', () => {
    const framed = withListing(
      menu([
        { id: 'start', label: 'Start', href: '/portal/' },
        { id: 'old', label: 'Old', href: '/old' },
      ]),
      [{ id: 'n', label: 'New', href: `${base}/new` }],
    );
    expect(framed.site.name).toBe('Startsidan');
    expect(framed.items.map(item => item.id)).toEqual(['start', 'n']);
  });
});

describe('Sitevision as a source (D87)', () => {
  const base = 'https://start.example.org';
  const page = (id: string, properties: Record<string, unknown>, type = 'sv:page'): SitevisionNode => ({
    id,
    type,
    name: `node ${id}`,
    properties,
  });

  test('a page by display name and its path resolved on the public origin; hidden, non-page, unaddressed left out', () => {
    expect(
      sitevisionPages(
        {
          nodes: [
            page('1', {
              displayName: 'Organisation',
              URI: '/intranat/organisation',
              URL: 'http://sv-internal:8080/intranat/organisation',
            }),
            page('2', { URL: 'https://start.example.org/x' }),
            page('3', { displayName: 'Dold', URI: '/dold', visibleInMenus: false }),
            page('4', { displayName: 'Nyhet', URI: '/n' }, 'sv:article'),
            page('5', { displayName: 'Ingen adress' }),
            page('6', { displayName: 'Skript', URI: 'javascript:alert(1)' }),
          ],
        },
        base,
      ),
    ).toEqual([
      // The path wins over Sitevision's own idea of its address, which behind a proxy is not the public one.
      { id: '1', label: 'Organisation', href: 'https://start.example.org/intranat/organisation' },
      { id: '2', label: 'node 2', href: 'https://start.example.org/x' },
    ]);
  });

  test('the headless address uses the online model and asks only for the menu properties', () => {
    const url = new URL(sitevisionHeadlessUrl(base, '4.1a2b'));
    expect(url.pathname).toBe('/rest-api/1/1/4.1a2b/headless');
    expect(JSON.parse(url.searchParams.get('properties')!)).toEqual(['displayName', 'URI', 'URL', 'visibleInMenus']);
  });
});

describe('WordPress as a source (D87)', () => {
  const base = 'https://wp.example.org';

  test('titles are text, links absolute, untitled pages left out', () => {
    expect(plainTitle('Anst&auml;llning &amp; arbetsmilj&#246; &#8211; <em>nytt</em>')).toBe(
      'Anst&auml;llning & arbetsmiljö – nytt',
    );
    expect(
      wordpressPages(
        [
          { id: 12, link: 'https://wp.example.org/intranat/organisation/', title: { rendered: 'Organisation' } },
          { id: 13, link: '/relative/', title: { rendered: 'Relativ' } },
          { id: 14, link: 'https://wp.example.org/x/', title: { rendered: '' } },
          { id: 15, title: { rendered: 'Ingen länk' } },
        ],
        base,
      ),
    ).toEqual([
      { id: '12', label: 'Organisation', href: 'https://wp.example.org/intranat/organisation/' },
      { id: '13', label: 'Relativ', href: 'https://wp.example.org/relative/' },
    ]);
  });

  test('children of a page in menu order, only the fields the menu needs', () => {
    const url = new URL(wordpressPagesUrl(base, '0'));
    expect(url.pathname).toBe('/wp-json/wp/v2/pages');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      parent: '0',
      per_page: '100',
      orderby: 'menu_order',
      order: 'asc',
      _fields: 'id,link,title',
    });
  });
});

describe('a source takes the caller as the audience (D87)', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test('sends no credential of its own and passes the caller’s mode on', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const id = new URL(url).pathname.split('/')[4];
      const nodes =
        id === 'root'
          ? [{ id: 'a', type: 'sv:page', properties: { displayName: 'A', URI: '/a' } }]
          : [{ id: `${id}1`, type: 'sv:page', properties: { displayName: 'A1', URI: '/a/1' } }];
      return new Response(JSON.stringify({ nodes }), { status: 200 });
    }) as typeof fetch;

    const anonymous = await sitevisionSource.list({
      base: 'https://intranet.example.org',
      root: 'root',
      depth: 1,
      init: { credentials: 'omit' },
    });
    expect(anonymous).toEqual([{ id: 'a', label: 'A', href: 'https://intranet.example.org/a' }]);
    expect(calls[0]!.init?.credentials).toBe('omit');
    expect(new Headers(calls[0]!.init?.headers).has('authorization')).toBe(false);

    calls.length = 0;
    await sitevisionSource.list({
      base: 'https://intranet.example.org',
      root: 'root',
      depth: 2,
      init: { credentials: 'same-origin' },
    });
    expect(calls.map(call => new URL(call.url).pathname)).toEqual([
      '/rest-api/1/1/root/headless',
      '/rest-api/1/1/a/headless',
    ]);
    expect(calls.every(call => call.init?.credentials === 'same-origin')).toBe(true);
  });

  test('WordPress gets its REST nonce only when the page gave one', async () => {
    const seen: Headers[] = [];
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      seen.push(new Headers(init?.headers));
      return new Response('[]', { status: 200 });
    }) as typeof fetch;
    await wordpressSource.list({ base: 'https://wp.example.org', root: '0', depth: 1 });
    await wordpressSource.list({ base: 'https://wp.example.org', root: '0', depth: 1, nonce: 'abc' });
    expect(seen.map(h => h.get('x-wp-nonce'))).toEqual([null, 'abc']);
  });

  test('an error answer is an error, not an empty menu', async () => {
    globalThis.fetch = (async () => new Response('nope', { status: 401 })) as unknown as typeof fetch;
    await expect(wordpressSource.list({ base: 'https://wp.example.org', root: '0', depth: 1 })).rejects.toThrow(/401/);
  });
});
