import { describe, expect, test } from 'bun:test';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import {
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
