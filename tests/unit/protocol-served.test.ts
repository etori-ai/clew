import { Registry, type Connector } from '../../packages/connectors/src/index';
import { remoteConnector } from '../../packages/connectors/src/remote';
import { describe, expect, test } from 'bun:test';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { describeBundled } from '../../apps/server/src/connectors/describe';
import {
  ConnectorManifestSchema,
  ManifestPreviewSchema,
  PROTOCOL_ACCEPTED,
  PROTOCOL_VERSION,
  openApiDocument,
  protocolSchema,
} from '../../packages/connectors/src/protocol';
import { previewManifest } from '../../packages/connectors/src/preview';
import { ManifestError, manifestProblems, parseManifest } from '../../packages/connectors/src/remote';
import { protocolRoutes } from '../../apps/server/src/routes/protocol';
import { manifest as hello } from '../../connectors/hello/connector.mjs';
import { manifest as phonebook } from '../../connectors/phonebook/connector.mjs';

/** The protocol as the instance serves it (D60): one OpenAPI document, one dry run, both from the objects the loader validates with. */
const ajv = addFormats(new Ajv({ strict: false }));
const refs = (value: unknown, found: string[] = []): string[] => {
  if (Array.isArray(value)) value.forEach(v => refs(v, found));
  else if (value && typeof value === 'object')
    for (const [k, v] of Object.entries(value)) k === '$ref' ? found.push(v as string) : refs(v, found);
  return found;
};
const edited = (manifest: unknown, change: (m: any) => void) => {
  const copy = JSON.parse(JSON.stringify(manifest));
  change(copy);
  return copy;
};

describe('the OpenAPI document', () => {
  const document = openApiDocument();
  test('is 3.1, carries the protocol version, and every $ref resolves to a component', () => {
    expect(document.openapi).toBe('3.1.0');
    expect(document.info.version).toBe(String(PROTOCOL_VERSION));
    expect(document['x-clew-protocol']).toEqual({
      current: PROTOCOL_VERSION,
      accepted: [...PROTOCOL_ACCEPTED],
      retired: expect.objectContaining({ 1: expect.stringContaining('RS256') }),
    });
    const names = Object.keys(document.components.schemas);
    for (const ref of refs(document.paths)) expect(names).toContain(ref.replace('#/components/schemas/', ''));
  });
  test('publishes every shape of the JSON Schema bundle, without $id, plus the dry-run answer', () => {
    const names = Object.keys(document.components.schemas);
    for (const name of Object.keys(protocolSchema().$defs)) expect(names).toContain(name);
    expect(names).toContain('ManifestPreview');
    expect(Object.values(document.components.schemas).some(s => '$id' in (s as object))).toBe(false);
  });
  test('describes both sides: the routes a connector serves and the routes Clew serves', () => {
    const paths = Object.keys(document.paths);
    expect(paths).toEqual(
      expect.arrayContaining([
        '/clew/manifest',
        '/clew/capabilities/{name}',
        '/clew/scan',
        '/clew/figure',
        '/api/connectors/jwks',
        '/api/connectors/call',
        '/api/protocol/manifest',
      ]),
    );
    for (const path of paths.filter(p => p.startsWith('/clew/')))
      expect((document.paths as any)[path].servers[0].url).toBe('{connector}');
    expect((document.paths as any)['/api/connectors/jwks'].servers[0].url).toBe('{clew}');
    expect(
      (openApiDocument({ clewUrl: 'https://clew.example.se' }).paths as any)['/api/connectors/jwks'].servers[0],
    ).toEqual({ url: 'https://clew.example.se', description: 'This Clew installation.' });
    for (const path of ['/clew/capabilities/{name}', '/clew/scan', '/clew/figure'])
      expect((document.paths as any)[path].post.security).toEqual([{ clewAssertion: [], connectorKey: [] }]);
  });
  test('the real manifests validate against the published ConnectorManifest component', () => {
    const validate = ajv.compile(JSON.parse(JSON.stringify(document.components.schemas.ConnectorManifest)));
    expect(validate(hello)).toBe(true);
    expect(validate(phonebook)).toBe(true);
  });
  test('the committed OpenAPI document is the one the code generates', async () => {
    const committed = await Bun.file(
      new URL('../../docs/protocol/connector-protocol.openapi.json', import.meta.url),
    ).json();
    expect(committed).toEqual(JSON.parse(JSON.stringify(document)));
  });
});

describe('the manifest dry run', () => {
  const validPreview = ajv.compile(JSON.parse(JSON.stringify(ManifestPreviewSchema)));
  test('tells what Clew would make of a good manifest', () => {
    const preview = previewManifest(hello, { id: 'hello' });
    expect(validPreview(preview)).toBe(true);
    expect(preview.ok).toBe(true);
    expect(preview.protocol).toEqual({ current: 2, accepted: [2] });
    const manifest = preview.manifest!;
    expect(manifest.id).toBe('hello');
    expect(manifest.capabilities.map(c => c.name)).toEqual((hello as any).capabilities.map((c: any) => c.name));
    const execute = manifest.capabilities.find(c => c.kind === 'execute')!;
    expect(execute.tool).toBe(false);
    expect(execute.check).toMatch(/human decision/);
    const open = manifest.capabilities.find(c => !c.needsInput && c.kind !== 'execute')!;
    expect(open.check).toMatch(/Called with \{\}/);
    expect(manifest.areas.map(a => a.id)).toEqual((hello as any).areas.map((a: any) => a.id));
  });
  test('names the rows an administrator could put in the menu (D40), and only views that open without a question', () => {
    const preview = previewManifest(phonebook, { id: 'phonebook' });
    expect(preview.ok).toBe(true);
    const menu = preview.manifest!.menu;
    expect(menu.length).toBeGreaterThan(0);
    for (const row of menu) {
      const capability = preview.manifest!.capabilities.find(c => c.name === row.capability)!;
      expect(capability.kind).toBe('read');
      expect(capability.view).not.toBeNull();
      expect(capability.needsInput).toBe(false);
      expect(capability.menu).toEqual({ label: row.label, icon: row.icon });
    }
    expect(preview.manifest!.capabilities.filter(c => c.needsInput).every(c => c.menu === null)).toBe(true);
  });
  test('lists every problem, not the first: the loader throws on the same list', () => {
    const broken = edited(hello, m => {
      m.capabilities[0].name = 'other.thing';
      m.areas[0].standing.push('hello.missing');
    });
    const preview = previewManifest(broken, { id: 'hello' });
    expect(preview.ok).toBe(false);
    expect(preview.manifest).toBeUndefined();
    // Renaming the first capability also orphans the area's standing reference to it: three problems, all listed.
    expect(preview.problems).toEqual([
      expect.stringMatching(/other\.thing must be prefixed with hello/),
      expect.stringMatching(/unknown standing capability hello\.greeting/),
      expect.stringMatching(/unknown standing capability hello\.missing/),
    ]);
    expect(() => parseManifest(broken, 'hello')).toThrow(new ManifestError(preview.problems[0]!));
    expect(validPreview(preview)).toBe(true);
  });
  test('an id that will not match the registration is a problem', () => {
    expect(previewManifest(hello, { id: 'hallo' }).problems).toEqual([
      expect.stringMatching(/does not match the configured id "hallo"/),
    ]);
    expect(previewManifest(hello).ok).toBe(true);
  });
  test('a retired protocol number is named with its reason, an unknown one with what is accepted', () => {
    expect(
      manifestProblems(
        edited(hello, m => {
          m.protocol = 1;
        }),
      ),
    ).toEqual([
      expect.stringMatching(/^\/protocol: 1 is not accepted by this Clew, which loads 2; retired 2026-11-05: .*RS256/),
    ]);
    expect(
      manifestProblems(
        edited(hello, m => {
          m.protocol = 3;
        }),
      ),
    ).toEqual(['/protocol: 3 is not accepted by this Clew, which loads 2']);
    expect(manifestProblems({ protocol: '2' })).toEqual(
      expect.arrayContaining([expect.stringMatching(/^\/protocol: /), expect.stringMatching(/^\/id: /)]),
    );
  });
  test('schema problems come one per path, and a field from a proposal is one of them', () => {
    const problems = manifestProblems(
      edited(hello, m => {
        m.capabilities[0].deprecated = { replacedBy: 'x' };
        delete m.source;
      }),
    );
    expect(problems).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^\/capabilities\/0\/deprecated/),
        expect.stringMatching(/^\/source/),
      ]),
    );
  });
  test('a real validator decides whether {} is accepted when one is handed in', () => {
    const strict = edited(phonebook, m => {
      for (const c of m.capabilities)
        if (!c.input.required?.length) {
          c.input = {
            ...c.input,
            type: 'object',
            properties: { ...(c.input.properties ?? {}), q: { type: 'string' } },
            required: ['q'],
          };
          delete c.menu;
        }
    });
    expect(previewManifest(strict).problems).toEqual([]);
    const loose = previewManifest(strict, { acceptsEmptyInput: () => true }).manifest!;
    const byRule = previewManifest(strict).manifest!;
    expect(loose.capabilities.every(c => !c.needsInput)).toBe(true);
    expect(byRule.capabilities.filter(c => c.kind === 'read').every(c => c.needsInput)).toBe(true);
    expect(byRule.menu).toEqual([]);
  });
});

describe('the served protocol routes', () => {
  test('the OpenAPI document and the schema bundle are public, cacheable and readable from any origin', async () => {
    const openapi = await protocolRoutes.request('http://clew.local/openapi.json');
    expect(openapi.status).toBe(200);
    expect(openapi.headers.get('access-control-allow-origin')).toBe('*');
    expect(openapi.headers.get('cache-control')).toContain('public');
    const document = await openapi.json();
    expect(document.openapi).toBe('3.1.0');
    expect(document.paths['/api/connectors/jwks'].servers[0].url).toBe('http://clew.local');
    const schema = await protocolRoutes.request('http://clew.local/connector-protocol.schema.json');
    expect((await schema.json()).$defs.ConnectorManifest).toBeDefined();
  });
  test('the public URL the operator set wins over the request origin', async () => {
    process.env.PUBLIC_URL = 'https://clew.example.se/';
    try {
      expect(
        (await (await protocolRoutes.request('http://127.0.0.1:3000/openapi.json')).json()).paths[
          '/api/connectors/jwks'
        ].servers[0].url,
      ).toBe('https://clew.example.se');
    } finally {
      delete process.env.PUBLIC_URL;
    }
  });
  test('the dry run answers a manifest, refuses what is not JSON, and takes the id from the query', async () => {
    const post = (body: string, query = '') =>
      protocolRoutes.request('http://clew.local/manifest' + query, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      });
    const good = await post(JSON.stringify(phonebook), '?id=phonebook');
    expect(good.status).toBe(200);
    expect(good.headers.get('cache-control')).toBe('no-store');
    expect((await good.json()).ok).toBe(true);
    expect((await (await post(JSON.stringify(phonebook), '?id=other')).json()).problems[0]).toMatch(
      /does not match the configured id "other"/,
    );
    expect((await post('{not json')).status).toBe(400);
    expect((await post('x'.repeat(500_001))).status).toBe(413);
    expect(
      (await protocolRoutes.request('http://clew.local/manifest', { method: 'OPTIONS' })).headers.get(
        'access-control-allow-methods',
      ),
    ).toContain('POST');
  });
  test('the viewer page and its script come from the image, not a CDN', async () => {
    const page = await protocolRoutes.request('http://clew.local/');
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('<rapi-doc');
    expect(html).toContain('spec-url="/api/protocol/openapi.json"');
    expect(html).toContain('load-fonts="false"');
    expect(html).not.toMatch(/https?:\/\//);
    const script = await protocolRoutes.request('http://clew.local/viewer.js');
    expect(script.status).toBe(200);
    expect(script.headers.get('content-type')).toContain('javascript');
    expect((await script.text()).length).toBeGreaterThan(100_000);
  });
});

describe('a capability about an entity (D97)', () => {
  const validPreview = ajv.compile(JSON.parse(JSON.stringify(ManifestPreviewSchema)));
  const validManifest = ajv.compile(JSON.parse(JSON.stringify(ConnectorManifestSchema)));
  const keys = (maxItems: unknown = 200) => ({
    type: 'object',
    properties: { keys: { type: 'array', items: { type: 'string' }, maxItems } },
    required: ['keys'],
  });
  const rows = (items: object) => ({ type: 'object', properties: { rows: { type: 'array', items } } });
  const keyed = {
    type: 'object',
    properties: { key: { type: 'string' }, state: { type: 'string' }, at: { type: 'string' } },
    required: ['key'],
  };
  const talks = {
    protocol: 2,
    id: 'appraisals',
    kind: 'passthrough',
    source: 'Samtalssystemet',
    scan: false,
    areas: [],
    capabilities: [
      {
        name: 'appraisals.person',
        kind: 'read',
        title: 'Utvecklingssamtal',
        description: 'Samtalet per person.',
        input: keys(),
        output: rows(keyed),
        model: false,
        scope: {},
        about: { entity: 'person' },
        view: {
          kind: 'list',
          title: 'state',
          fields: [
            { key: 'state', label: 'Samtal', format: 'status', tones: { Saknas: 'warn', '*': 'none' } },
            { key: 'at', label: 'När', format: 'instant' },
          ],
          open: { capability: 'appraisals.commitments', title: 'Åtgärdspunkter', params: { person: 'key' } },
        },
      },
      {
        name: 'appraisals.commitments',
        kind: 'read',
        title: 'Åtgärdspunkter',
        description: 'Åtgärdspunkter för en person.',
        input: { type: 'object', properties: { person: { type: 'string' } }, required: ['person'] },
        output: rows({ type: 'object', properties: { text: { type: 'string' } } }),
        model: false,
        scope: {},
        view: { kind: 'table', title: 'text', fields: [{ key: 'text', label: 'Punkt' }] },
      },
      {
        name: 'appraisals.units',
        kind: 'read',
        title: 'Samtal per enhet',
        description: 'Samtalen per enhet.',
        input: keys(50),
        output: { type: 'object', properties: { units: { type: 'array', items: keyed } } },
        model: false,
        scope: { roles: ['manager'] },
        about: { entity: 'unit' },
        view: { kind: 'table', rows: 'units', title: 'state', fields: [{ key: 'state', label: 'Läge' }] },
      },
      {
        name: 'appraisals.book',
        kind: 'propose',
        title: 'Boka samtal',
        description: 'Föreslår en tid.',
        input: {
          type: 'object',
          properties: { person: { type: 'string' }, at: { type: 'string' } },
          required: ['person'],
        },
        output: {},
        model: false,
        scope: { roles: ['manager'] },
        about: { entity: 'person', param: 'person' },
      },
    ],
  };
  test('a read asked with keys and an action that takes one load, and the preview says where each would show', () => {
    expect(manifestProblems(talks, 'appraisals')).toEqual([]);
    const preview = previewManifest(talks, { id: 'appraisals' });
    expect(validPreview(preview)).toBe(true);
    const places = Object.fromEntries(
      preview.manifest!.capabilities.map(c => [c.name, { about: c.about ?? null, places: c.places }]),
    );
    expect(places).toEqual({
      'appraisals.person': { about: { entity: 'person' }, places: ['lens', 'mark', 'section'] },
      'appraisals.commitments': { about: null, places: [] },
      'appraisals.units': { about: { entity: 'unit' }, places: ['lens', 'section'] },
      'appraisals.book': { about: { entity: 'person', param: 'person' }, places: ['menu'] },
    });
    // A read about a person is never a tool, and the dry run says so.
    expect(preview.manifest!.capabilities.find(c => c.name === 'appraisals.person')!.tool).toBe(false);
    // The conformance check calls a read about an entity with keys, though it needs input.
    expect(preview.manifest!.capabilities.find(c => c.name === 'appraisals.person')!.check).toMatch(
      /^Called with \{ keys \} as .*unknown key.*one row per key/,
    );
    // `*` names the tone of any other value: a field whose only tone is `*: warn` still marks the row.
    const starred = edited(talks, m => {
      m.capabilities[2].view.fields[0] = { key: 'state', label: 'Läge', format: 'status', tones: { '*': 'warn' } };
    });
    expect(previewManifest(starred).manifest!.capabilities[2]!.places).toEqual(['lens', 'mark', 'section']);
    const registry = new Registry();
    registry.register(remoteConnector(parseManifest(talks, 'appraisals'), { url: 'http://x', assert: async () => '' }));
    expect(registry.find('appraisals.units')!.capability.about).toEqual({ entity: 'unit' });
  });
  const refused: Array<[string, (m: any) => void, RegExp]> = [
    ['a read with a param', m => (m.capabilities[0].about.param = 'keys'), /declares no param/],
    ['input without keys', m => (m.capabilities[0].input = { type: 'object', properties: {} }), /takes \{ keys \}/],
    ['keys not required', m => (m.capabilities[0].input.required = []), /takes \{ keys \}/],
    ['keys of numbers', m => (m.capabilities[0].input.properties.keys.items = { type: 'number' }), /takes \{ keys \}/],
    ['no maxItems', m => delete m.capabilities[0].input.properties.keys.maxItems, /maxItems at most 200/],
    ['maxItems over 200', m => (m.capabilities[0].input.properties.keys.maxItems = 201), /maxItems at most 200/],
    ['no view', m => delete m.capabilities[0].view, /declares a table or list view/],
    [
      'a detail view',
      m => (m.capabilities[0].view = { kind: 'detail', title: 'state', fields: [{ key: 'state', label: 'Samtal' }] }),
      /declares a table or list view/,
    ],
    ['rows without a required key', m => (m.capabilities[0].output.properties.rows.items.required = []), /string key/],
    [
      'a key that is not a string',
      m => (m.capabilities[0].output.properties.rows.items.properties.key = { type: 'integer' }),
      /string key/,
    ],
    ["the view's rows missing", m => delete m.capabilities[2].output.properties.units, /output units must be/],
    ['a tool', m => (m.capabilities[0].model = true), /never a tool/],
    ['an action without param', m => delete m.capabilities[3].about.param, /names in param/],
    ['a param the input lacks', m => (m.capabilities[3].about.param = 'nobody'), /names in param/],
    [
      'a param that is not a string',
      m => (m.capabilities[3].input.properties.person = { type: 'integer' }),
      /names in param/,
    ],
    ['a follower', m => (m.capabilities[3].follows = ['appraisals:talk']), /follows and about exclude each other/],
    ['a profile read', m => (m.capabilities[0].name = 'appraisals.talks'), /profile read or the header/],
    ['a search source', m => (m.capabilities[0].kinds = ['person']), /profile read or the header/],
    ['a page from a manifest', m => (m.capabilities[0].about.page = { title: 'x', href: '/x' }), /about/],
    ['an unknown entity', m => (m.capabilities[0].about.entity = 'room'), /about\/entity/],
  ];
  test('every rule refuses its break with the field named, in preview, parsing and registration alike', () => {
    for (const [what, change, problem] of refused) {
      const document = edited(talks, change);
      const preview = previewManifest(document, { id: 'appraisals' });
      expect({ what, ok: preview.ok, problems: preview.problems }).toEqual({
        what,
        ok: false,
        problems: expect.arrayContaining([expect.stringMatching(problem)]),
      });
      expect(() => parseManifest(document, 'appraisals')).toThrow(ManifestError);
      // Past the schema, the loader and the registry refuse with the first problem the preview lists.
      if (validManifest(document)) {
        expect(() => parseManifest(document, 'appraisals')).toThrow(preview.problems[0]!);
        expect(() =>
          new Registry().register(remoteConnector(document as never, { url: 'http://x', assert: async () => '' })),
        ).toThrow(preview.problems[0]!);
      }
    }
  });
  test("only Clew's own connectors name a page, and the administration's manifest form leaves it out", () => {
    const own = (kind: 'core' | 'passthrough'): Connector => ({
      id: 'talks',
      kind,
      source: 'Utvecklingssamtal',
      areas: [],
      capabilities: [
        {
          ...(talks.capabilities[0] as object),
          name: 'talks.person',
          view: { ...(talks.capabilities[0]!.view as object), open: undefined },
          about: { entity: 'person', page: { title: 'Öppna samtalet', href: '/personal/{id}/samtal' } },
          run: async () => ({ rows: [] }),
        } as never,
      ],
    });
    expect(() => new Registry().register(own('core'))).not.toThrow();
    expect(() => new Registry().register(own('passthrough'))).toThrow(/only Clew's own connectors name a page/);
    const described = describeBundled(own('core'));
    expect(described.capabilities[0]!.about).toEqual({ entity: 'person' });
    expect(validManifest(described)).toBe(true);
  });
});

test('preview, parsing and registry registration share all manifest-local rules', () => {
  const mutations: Array<(m: any) => void> = [
    m => m.capabilities.push(structuredClone(m.capabilities[0])),
    m => (m.facts = [{ kind: 'other:fact', title: 'Fact', attributes: { type: 'object' } }]),
    m => (m.capabilities.find((c: any) => c.kind === 'read').follows = ['other:fact']),
    m => (m.capabilities[0].creates = 'hello:undeclared'),
    m => (m.capabilities[0].input = { type: 'not-a-schema-type' }),
    m => (m.capabilities[0].output = { $ref: '#/$defs/missing' }),
    m => (m.facts = [{ kind: 'hello:fact', title: 'Fact', attributes: { type: 'invalid' } }]),
    m => m.areas[0].standing.push('hello.missing'),
  ];
  for (const change of mutations) {
    const document = edited(hello, change);
    const preview = previewManifest(document);
    expect(preview.ok).toBe(false);
    expect(preview.problems.length).toBeGreaterThan(0);
    expect(() => parseManifest(document)).toThrow(preview.problems[0]!);
    const registry = new Registry();
    expect(() => registry.register(remoteConnector(document, { url: 'http://test', assert: async () => '' }))).toThrow(
      preview.problems[0]!,
    );
    expect(registry.list()).toEqual([]);
  }
  expect(previewManifest(hello).ok).toBe(true);
  expect(() =>
    new Registry().register(remoteConnector(parseManifest(hello), { url: 'http://test', assert: async () => '' })),
  ).not.toThrow();
});
