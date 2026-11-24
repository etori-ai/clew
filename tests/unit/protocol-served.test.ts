import { openGovernance, Registry, schemaCompiler, type Connector } from '../../packages/connectors/src/index';
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
  type ManifestIssue,
} from '../../packages/connectors/src/protocol';
import { previewManifest } from '../../packages/connectors/src/preview';
import { HOLDINGS_EXAMPLE, RULES, manifestReference } from '../../packages/connectors/src/reference';
import { ManifestError, manifestProblems, parseManifest } from '../../packages/connectors/src/remote';
import {
  PROTOCOL_PAGE_HEADERS,
  VIEWER_SCRIPT,
  mountProtocol,
  protocolRoutes,
} from '../../apps/server/src/routes/protocol';
import {
  VIEWER_BUILT_IN,
  VIEWER_VERSIONS,
  servedViewerNotices,
  viewerPackages,
} from '../../packages/notices/src/viewer';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { MAX_CAPABILITIES, MAX_MANIFEST_BYTES } from '../../packages/connectors/src/protocol';
import { MANIFEST_MAX, overManifestMax } from '../../apps/web/src/pages/protocol-preview-model';
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
      // One version until the first release, changed in place (D129); no list of retired numbers.
      current: 1,
      accepted: [1],
    });
    expect([PROTOCOL_VERSION, PROTOCOL_ACCEPTED]).toEqual([1, [1]]);
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
  test('tells a connector author what Clew does: an administrator chooses the header, and a 503 may be Clew’s own', () => {
    // D88: declaring a header makes a connector a candidate; the one an administrator chose answers, whatever the order.
    const header = (document.components.schemas.ConnectorManifest as any).properties.header.description as string;
    expect(header).toContain('only the one connector an administrator chose to give the header answers');
    expect(header).not.toContain('earliest');
    // The callback answers 503 for a target that cannot answer and for Clew itself, while it starts included; so does
    // the key set, whose body is not the contract's to give.
    expect((document.paths as any)['/api/connectors/call'].post.responses['503']).toEqual({
      description: 'Unavailable: the target or Clew cannot answer now, Clew still starting included; retry later.',
      content: { 'application/json': { schema: { $ref: '#/components/schemas/CallResponse' } } },
    });
    expect((document.paths as any)['/api/connectors/jwks'].get.responses['503']).toEqual({
      description: 'Clew is starting or cannot read its keys now; keep the keys you have and retry later.',
    });
  });
});

describe('the manifest dry run', () => {
  const validPreview = ajv.compile(JSON.parse(JSON.stringify(ManifestPreviewSchema)));
  test('tells what Clew would make of a good manifest', () => {
    const preview = previewManifest(hello, { id: 'hello' });
    expect(validPreview(preview)).toBe(true);
    expect(preview.ok).toBe(true);
    expect(preview.protocol).toEqual({ current: 1, accepted: [1] });
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
  test('any other protocol number is named with the one this Clew loads, not as a literal mismatch', () => {
    // The numbers the records before D129 used, 2 and 3, are refused as any other.
    for (const protocol of [2, 3, 4])
      expect(manifestProblems(edited(hello, m => void (m.protocol = protocol)))).toEqual([
        `/protocol: ${protocol} is not accepted by this Clew, which loads 1`,
      ]);
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
    const loose = previewManifest(strict, { compile: () => () => true }).manifest!;
    const byRule = previewManifest(strict).manifest!;
    expect(loose.capabilities.every(c => !c.needsInput)).toBe(true);
    expect(byRule.capabilities.filter(c => c.kind === 'read').every(c => c.needsInput)).toBe(true);
    expect(byRule.menu).toEqual([]);
  });
});

describe('the served protocol routes', () => {
  // What the routes log: the viewer's notices log what keeps them from being whole.
  const logged: unknown[][] = [];
  const routes = protocolRoutes({ log: (...line) => void logged.push(line) });
  test('the OpenAPI document and the schema bundle are public, cacheable and readable from any origin', async () => {
    const openapi = await routes.request('http://clew.local/openapi.json');
    expect(openapi.status).toBe(200);
    expect(openapi.headers.get('access-control-allow-origin')).toBe('*');
    expect(openapi.headers.get('cache-control')).toContain('public');
    const document = await openapi.json();
    expect(document.openapi).toBe('3.1.0');
    expect(document.paths['/api/connectors/jwks'].servers[0].url).toBe('http://clew.local');
    const schema = await routes.request('http://clew.local/connector-protocol.schema.json');
    expect((await schema.json()).$defs.ConnectorManifest).toBeDefined();
  });
  test('the public URL the operator set wins over the request origin', async () => {
    process.env.PUBLIC_URL = 'https://clew.example.se/';
    try {
      expect(
        (await (await routes.request('http://127.0.0.1:3000/openapi.json')).json()).paths['/api/connectors/jwks']
          .servers[0].url,
      ).toBe('https://clew.example.se');
    } finally {
      delete process.env.PUBLIC_URL;
    }
  });
  test('the dry run page sends no more than the route and the loader take', () => {
    expect(MANIFEST_MAX).toBe(MAX_MANIFEST_BYTES);
    // Counted in bytes, as the route counts them: a character outside ASCII is more than one.
    expect(overManifestMax('x'.repeat(MAX_MANIFEST_BYTES))).toBe(false);
    expect(overManifestMax('x'.repeat(MAX_MANIFEST_BYTES + 1))).toBe(true);
    expect(overManifestMax('ö'.repeat(MAX_MANIFEST_BYTES / 2))).toBe(false);
    expect(overManifestMax('ö'.repeat(MAX_MANIFEST_BYTES / 2 + 1))).toBe(true);
  });
  test('the dry run answers a manifest, refuses what is not JSON, and takes the id from the query', async () => {
    const post = (body: string, query = '') =>
      routes.request('http://clew.local/manifest' + query, {
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
    // The limit is the loader's, in bytes: fewer characters than that may still be more bytes.
    expect((await post('"' + 'ö'.repeat(250_001) + '"')).status).toBe(413);
    // A body that declares no length is stopped at the limit as it is read, not read whole first (CB-6).
    let pieces = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pieces++;
        controller.enqueue(new TextEncoder().encode(' '.repeat(64 * 1024)));
      },
    });
    const chunked = await routes.request(
      new Request('http://clew.local/manifest', { method: 'POST', body: endless, duplex: 'half' } as RequestInit),
    );
    expect(chunked.status).toBe(413);
    expect(pieces).toBeLessThanOrEqual(Math.ceil(MAX_MANIFEST_BYTES / (64 * 1024)) + 2);
    expect(
      (await routes.request('http://clew.local/manifest', { method: 'OPTIONS' })).headers.get(
        'access-control-allow-methods',
      ),
    ).toContain('POST');
  });
  test('the dry run keeps nothing of a request once it is answered (CB-6)', async () => {
    // One compiler for the module kept every schema it compiled, and each request brings new ones: forty requests of a
    // manifest with a hundred capabilities once left some 30 MB behind for good.
    const person = (phonebook as { capabilities: Array<{ name: string; input: unknown }> }).capabilities.find(
      c => c.name === 'phonebook.person',
    )!;
    const many = {
      ...(phonebook as object),
      capabilities: [
        ...(phonebook as { capabilities: unknown[] }).capabilities,
        ...Array.from({ length: 100 }, (_, i) => ({
          ...person,
          name: `phonebook.person${i}`,
          input: structuredClone(person.input),
        })),
      ],
    };
    const body = JSON.stringify(many);
    const post = () =>
      routes.request('http://clew.local/manifest', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      });
    expect((await (await post()).json()).ok).toBe(true);
    Bun.gc(true);
    const before = process.memoryUsage().heapUsed;
    for (let i = 0; i < 40; i++) await (await post()).text();
    Bun.gc(true);
    expect((process.memoryUsage().heapUsed - before) / 1e6).toBeLessThan(16);
  }, 30_000);
  test('a manifest of more capabilities than the protocol allows is refused before any schema is compiled', () => {
    const own = (phonebook as { capabilities: Array<{ name: string; input: object }> }).capabilities;
    const person = own.find(c => c.name === 'phonebook.person')!;
    const team = own.find(c => c.name === 'phonebook.team')!;
    const compiled: object[] = [];
    const counting = () => {
      const compile = schemaCompiler();
      return (schema: object) => {
        compiled.push(schema);
        return compile(schema);
      };
    };
    const filled = (count: number) => ({
      ...(phonebook as object),
      capabilities: [
        ...own,
        ...Array.from({ length: count - own.length }, (_, i) => ({ ...person, name: `phonebook.p${i}` })),
      ],
    });
    const refused = previewManifest(filled(MAX_CAPABILITIES + 1), { compile: counting() });
    expect(refused.ok).toBe(false);
    expect(refused.problems.join(' ')).toContain('/capabilities');
    expect(compiled).toEqual([]);
    expect(previewManifest(filled(MAX_CAPABILITIES), { compile: counting() }).ok).toBe(true);
    // One compilation a schema: the rules and the question of empty input share it.
    const compile = schemaCompiler();
    expect(compile(team.input)).toBe(compile(team.input));
    // Two inputs that carry the same `$id` compile apart, as in the loader, and each still takes `{}`.
    const twins = {
      ...(phonebook as object),
      capabilities: [
        ...own,
        ...[0, 1].map(i => ({ ...team, name: `phonebook.twin${i}`, input: { ...team.input, $id: 'input' } })),
      ],
    };
    const preview = previewManifest(twins, { compile: schemaCompiler() });
    expect(preview.ok).toBe(true);
    expect(preview.manifest!.capabilities.filter(c => c.name.includes('twin')).map(c => c.needsInput)).toEqual([
      false,
      false,
    ]);
  });
  test('the viewer page and its scripts come from the image, not a CDN, under a policy of the page’s own', async () => {
    const page = await routes.request('http://clew.local/');
    expect(page.status).toBe(200);
    const html = await page.text();
    expect([...html.matchAll(/<script\b[^>]*>/g)].map(([tag]) => tag)).toEqual([
      '<script src="/api/protocol/scalar.js">',
      '<script src="/api/protocol/viewer.js">',
    ]);
    expect(html).not.toMatch(/<script[^>]*>[^<]/);
    expect(html).not.toMatch(/https?:\/\//);
    // The web image's headers never reach an address Clew's server answers (D145): the page sends its own.
    const policy = page.headers.get('content-security-policy')!;
    expect(policy).toBe(PROTOCOL_PAGE_HEADERS['Content-Security-Policy']);
    expect(policy).toContain("script-src 'self';");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).not.toMatch(/unsafe-eval|\*|https?:/);
    expect(policy.split(';').filter(part => part.includes('unsafe-inline'))).toEqual([
      " style-src 'self' 'unsafe-inline'",
    ]);
    expect(page.headers.get('x-frame-options')).toBe('DENY');
    expect(page.headers.get('referrer-policy')).toBe('same-origin');
    const start = await routes.request('http://clew.local/viewer.js');
    expect(start.status).toBe(200);
    expect(start.headers.get('content-type')).toContain('javascript');
    const text = await start.text();
    expect(text).toContain('Scalar.createApiReference');
    expect(text).toContain("url: '/api/protocol/openapi.json'");
    expect(text).toContain('withDefaultFonts: false');
    expect(text).toContain('hideTestRequestButton: true');
    const script = await routes.request('http://clew.local/scalar.js');
    expect(script.status).toBe(200);
    expect(script.headers.get('content-type')).toContain('javascript');
    expect(await script.text()).toContain('@scalar/api-reference');
  });
  test('the viewer’s notices name every package its script bundles at the version it bundles, with a licence text for each (D143 item 3)', () => {
    const found = viewerPackages(VIEWER_SCRIPT);
    expect(found.problems).toEqual([]);
    const credited = new Map<string, string[]>();
    for (const p of [...found.bundled, ...found.carried])
      credited.set(p.name, [...(credited.get(p.name) ?? []), p.version]);
    // The script's source map names each file Scalar's build put in it from its folder in Scalar's repository,
    // packages/api-reference/dist/browser/: a package's under its node_modules folder, with its version in the folder
    // above (`.pnpm/name@version[_peers]/node_modules/name`), and the repository's own packages by folder
    // (`../../../<folder>/`), published as `@scalar/<folder>` at the one version Scalar's packages name it at, exactly.
    const map = JSON.parse(readFileSync(`${VIEWER_SCRIPT}.map`, 'utf8')) as { sources: string[] };
    const manifest = (root: string) =>
      JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
        version: string;
        dependencies?: Record<string, string>;
      };
    const pinned = new Map<string, Set<string>>();
    for (const p of [...found.bundled, ...found.carried].filter(p => p.name.startsWith('@scalar/') && p.root))
      for (const [name, version] of Object.entries(manifest(p.root).dependencies ?? {}))
        if (name.startsWith('@scalar/')) pinned.set(name, new Set([...(pinned.get(name) ?? []), version]));
    const scalar = (name: string) => (pinned.get(name)?.size === 1 ? [...pinned.get(name)!][0]! : '');
    const named = new Map([['@scalar/api-reference', manifest(join(dirname(VIEWER_SCRIPT), '../..')).version]]);
    const unplaced: string[] = [];
    for (const source of map.sources) {
      const at = source.lastIndexOf('node_modules/');
      const folder = source.match(/^\.\.\/\.\.\/\.\.\/([^./][^/]*)\//)?.[1];
      if (at >= 0) {
        const [scope, name] = source.slice(at + 'node_modules/'.length).split('/');
        const pkg = scope!.startsWith('@') ? `${scope}/${name}` : scope!;
        named.set(pkg, source.slice(0, at).match(/@(\d+\.\d+\.\d+[^/_]*)(?:_[^/]*)?\/$/)?.[1] ?? '');
      } else if (folder) named.set(`@scalar/${folder}`, scalar(`@scalar/${folder}`));
      else if (!source.startsWith('../../src/')) unplaced.push(source);
    }
    expect(unplaced).toEqual([]);
    expect(named.size).toBeGreaterThan(150);
    expect([...named.keys()].filter(name => name.startsWith('@scalar/')).length).toBeGreaterThan(20);
    // Each once, at the version in the script, never at another the install holds.
    expect([...named].filter(([name, version]) => credited.get(name)?.join() !== version)).toEqual([]);
    // The banners and `@license` comments that survive in the script name a package each, credited at their version.
    const script = readFileSync(VIEWER_SCRIPT, 'utf8');
    const banners = [...script.matchAll(/\/\*[!*]?[\s\S]{0,600}?\*\//g)]
      .map(([comment]) => comment)
      .filter(comment => /^\/\*!|@license/.test(comment));
    const bannerNames = banners.map(banner => banner.match(/(@?[a-z][\w./-]*) v?(\d+\.\d+\.\d+)/)?.slice(1, 3));
    expect(bannerNames.length).toBeGreaterThan(5);
    expect(bannerNames.filter(found => !found || !credited.get(found[0]!)?.includes(found[1]!))).toEqual([]);
    // Tailwind's base styles are in the script by its banner alone, credited from the copy installed as a peer.
    expect(bannerNames.some(found => found?.[0] === 'tailwindcss')).toBe(true);
    // The lists hold what the script holds and no more: a Scalar upgrade that leaves an entry behind fails here.
    expect(VIEWER_BUILT_IN.filter(p => named.get(p.name) !== p.version)).toEqual([]);
    expect(
      Object.keys(VIEWER_VERSIONS).filter(
        key => named.get(key.slice(0, key.lastIndexOf('@'))) !== key.slice(key.lastIndexOf('@') + 1),
      ),
    ).toEqual([]);
    // Only what no install holds is kept in licences/: tailwindcss is installed, as a peer of @headlessui/tailwindcss.
    expect(VIEWER_BUILT_IN.map(p => p.name)).toEqual(['unist-util-find-after']);
  });
  test('a version the script holds that nobody checked is served with a word and logged once, and so is a failure to read', () => {
    const lines: unknown[][] = [];
    const log = (...line: unknown[]) => void lines.push(line);
    // A script whose map names a version of parse5 that neither list records.
    const dir = mkdtempSync(join(tmpdir(), 'clew-viewer-'));
    try {
      const root = join(dir, 'node_modules', '@scalar', 'api-reference');
      mkdirSync(join(root, 'dist', 'browser'), { recursive: true });
      writeFileSync(
        join(root, 'package.json'),
        JSON.stringify({ name: '@scalar/api-reference', version: '1.0.0', license: 'MIT' }),
      );
      writeFileSync(join(root, 'LICENSE'), 'MIT License');
      const script = join(root, 'dist', 'browser', 'standalone.js');
      writeFileSync(script, '');
      writeFileSync(
        `${script}.map`,
        JSON.stringify({
          sources: ['../../src/index.ts', '../../../../node_modules/.pnpm/parse5@6.0.0/node_modules/parse5/index.js'],
        }),
      );
      const served = servedViewerNotices(script, log);
      const first = served();
      expect('text' in first && first.text).toContain('These notices are incomplete');
      expect('text' in first && first.text).toContain('parse5 6.0.0 is in the script, and Clew does not install it');
      expect(served()).toBe(first);
      expect(lines.length).toBe(1);
      const missing = servedViewerNotices(join(dir, 'gone.js'), log);
      expect(missing()).toEqual({ failure: 'The third-party notices could not be read.' });
      expect(missing()).toEqual({ failure: 'The third-party notices could not be read.' });
      expect(lines.length).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  test('the notices and Clew’s licence are served beside the script, and the page answers with a trailing slash', async () => {
    const notices = await routes.request('http://clew.local/third-party-notices.txt');
    expect(notices.status).toBe(200);
    expect(notices.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    const text = await notices.text();
    expect(text).toStartWith('Third-party software in this build of Clew');
    expect(text).not.toContain('These notices are incomplete');
    for (const name of [
      '@scalar/api-reference 1.81.0 (MIT)',
      'vue ',
      'tailwindcss 4.3.5 (MIT)',
      'proto-parser 0.0.9',
      'parse5 7.3.0 (MIT)',
    ])
      expect(text).toContain(`\n${name}`);
    expect(text).not.toContain('\nparse5 8.1.1');
    expect(text).toContain('--- LICENSE (of 8.1.1, which Clew installs: 7.3.0 declares the same licence, MIT)');
    expect(text).toContain("kept in Clew's repository as licences/scalar.txt");
    expect(logged).toEqual([]);
    // Read once: the second answer is the same text.
    expect(await (await routes.request('http://clew.local/third-party-notices.txt')).text()).toBe(text);
    const licence = await routes.request('http://clew.local/LICENSE.txt');
    expect(licence.status).toBe(200);
    expect(await licence.text()).toBe(readFileSync(join(import.meta.dir, '../../LICENSE'), 'utf8'));
    // Mounted as the server mounts it, before a guard that answers everything else under /api without a session, on an
    // app of the same Hono the routes are made with: `hono` does not resolve from the repository root.
    const app = new (routes.constructor as new () => typeof routes)();
    mountProtocol(app, { log: (...line) => void logged.push(line) });
    app.use('/api/*', async c => c.json({ error: 'Sessionen har gått ut.' }, 401));
    // Permanent, keeping the method, and cached as long as the page is, so a browser asks again later.
    const slash = await app.request('http://clew.local/api/protocol/');
    expect(slash.status).toBe(308);
    expect(slash.headers.get('location')).toBe('/api/protocol');
    expect(slash.headers.get('cache-control')).toBe('max-age=300');
    expect((await app.request('http://clew.local/api/protocol')).status).toBe(200);
    expect((await app.request('http://clew.local/api/protocol/third-party-notices.txt')).status).toBe(200);
    expect((await app.request('http://clew.local/api/elsewhere')).status).toBe(401);
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
    protocol: 1,
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
  test('a table of people may say its rows are the read about a person asked for everyone (byKey, D127)', () => {
    const round = {
      name: 'appraisals.round',
      kind: 'read',
      title: 'Omgången',
      description: 'Omgången, en rad per person.',
      input: { type: 'object', properties: {} },
      output: rows({ type: 'object', properties: { person: { type: 'string' }, state: { type: 'string' } } }),
      model: true,
      scope: { roles: ['manager'] },
      view: {
        kind: 'table',
        title: 'state',
        fields: [{ key: 'state', label: 'Samtal' }],
        subject: { entity: 'person', key: 'person' },
        byKey: 'appraisals.person',
      },
    };
    const withRound = edited(talks, m => m.capabilities.push(round));
    expect(manifestProblems(withRound, 'appraisals')).toEqual([]);
    // The registry lists it on the read about a person, for a reader who may call it.
    const registry = new Registry();
    registry
      .register(remoteConnector(parseManifest(withRound, 'appraisals'), { url: 'http://x', assert: async () => '' }))
      .govern('appraisals', openGovernance());
    const actor = { id: 'p', role: 'manager', unitId: 'u', unitLabel: 'U', organisationId: 'o' } as never;
    expect(registry.aboutReads(actor, 'person').map(r => [r.name, r.overviews])).toEqual([
      ['appraisals.person', ['appraisals.round']],
    ]);
    // The round is a manager's: for anyone else the read about a person names no overview.
    expect(
      registry
        .aboutReads({ ...(actor as object), role: 'employee' } as never, 'person')
        .map(r => [r.name, r.overviews]),
    ).toEqual([['appraisals.person', undefined]]);
    const broken: Array<[string, (c: any) => void, RegExp]> = [
      ['without subject', c => delete c.view.subject, /declare them in subject/],
      ['on a read that requires input', c => (c.input = keys()), /requires input cannot declare it/],
      [
        'naming a read about nobody',
        c => (c.view.byKey = 'appraisals.commitments'),
        /not a read of this connector about a person/,
      ],
      [
        'naming a read about units',
        c => (c.view.byKey = 'appraisals.units'),
        /not a read of this connector about a person/,
      ],
      ['naming itself', c => (c.view.byKey = 'appraisals.round'), /not a read of this connector about a person/],
      ['naming another system', c => (c.view.byKey = 'hr.person'), /not a read of this connector about a person/],
    ];
    for (const [what, change, problem] of broken) {
      const document = edited(withRound, m => change(m.capabilities.at(-1)));
      expect({ what, problems: manifestProblems(document, 'appraisals') }).toEqual({
        what,
        problems: [expect.stringMatching(problem)],
      });
    }
  });
  test('the preview says which read opens which, who would see each place, and rows to draw them with', () => {
    const preview = previewManifest(talks, { id: 'appraisals' });
    expect(validPreview(preview)).toBe(true);
    const byName = Object.fromEntries(preview.manifest!.capabilities.map(c => [c.name, c]));
    // The action points open from a row of the read about a person: drawn under its section, not placed of their own.
    expect(byName['appraisals.commitments']!.openedFrom).toEqual(['appraisals.person']);
    expect(byName['appraisals.person']!.openedFrom).toEqual([]);
    expect(byName['appraisals.person']!.audience).toEqual([
      {
        places: ['lens', 'mark'],
        who: expect.stringMatching(/^A person who has a list of people: a manager on Personal/),
      },
      { places: ['section'], who: 'Anyone who opens a person the connector answers a row for.' },
      { places: ['tool'], who: 'No. A read about a person is never offered to the model.' },
    ]);
    // A read whose scope names managers only says so; one without a tone that needs the reader has no mark.
    expect(byName['appraisals.units']!.audience[0]).toEqual({
      places: ['lens'],
      who: 'A manager who has a list of units, once an administrator chooses the source.',
    });
    expect(byName['appraisals.book']!.audience).toEqual([
      { places: ['menu'], who: expect.stringMatching(/^A manager who opens a person .*after their decision\.$/) },
      { places: ['tool'], who: 'No. It declares model: false.' },
    ]);
    expect(byName['appraisals.commitments']!.audience).toEqual([]);
    // A list of people is a manager's: a read about a person for employees only reaches nobody there.
    const employees = edited(talks, m => (m.capabilities[0].scope = { roles: ['employee'] }));
    expect(previewManifest(employees).manifest!.capabilities[0]!.audience[0]!.who).toMatch(/^Nobody yet/);
    // Samples: each toned value in turn (`*` gets one more), a fixed time for an instant, a synthetic key per row.
    expect(byName['appraisals.person']!.samples).toEqual([
      { state: 'Saknas', at: '2026-11-12T08:00:00.000Z', key: 'exempel-1' },
      { state: 'Exempel', at: '2026-11-12T08:00:00.000Z', key: 'exempel-2' },
    ]);
    const enumerated = edited(talks, m => {
      m.capabilities[0].output.properties.rows.items.properties.state = { type: 'string', enum: ['Saknas', 'Bokat'] };
      m.capabilities[0].view.fields.push({ key: 'overdue', label: 'Försenade', format: 'number' });
      m.capabilities[0].output.properties.rows.items.properties.overdue = { type: 'integer' };
    });
    expect(previewManifest(enumerated).manifest!.capabilities[0]!.samples).toEqual([
      { state: 'Saknas', at: '2026-11-12T08:00:00.000Z', overdue: 2, key: 'exempel-1' },
      { state: 'Bokat', at: '2026-11-12T08:00:00.000Z', overdue: 2, key: 'exempel-2' },
    ]);
    expect(byName['appraisals.units']!.samples).toEqual([{ state: 'Exempel', key: 'exempel-1' }]);
    for (const name of ['appraisals.commitments', 'appraisals.book']) expect(byName[name]!.samples).toBeUndefined();
  });
  test('every problem is placed: its path in the document, its reference entry and the rule it breaks', () => {
    const fields = new Set(manifestReference([]).fields.map(f => f.path));
    const cases: Array<[string, unknown, Partial<ManifestIssue>, string?]> = [
      [
        'the row without key (artboard J)',
        edited(talks, m => (m.capabilities[0].output.properties.rows.items.required = [])),
        {
          path: 'capabilities[0].output.properties.rows.items',
          field: 'capabilities[].output',
          anchor: 'rule-about-read-rows',
          rule: { id: 'about-read-rows', title: 'Each row carries the key it was asked with' },
        },
      ],
      [
        'a kind the contract does not know',
        edited(talks, m => (m.capabilities[0].about.entity = 'room')),
        {
          path: 'capabilities[0].about.entity',
          field: 'capabilities[].about.entity',
          anchor: 'field-capabilities-about-entity',
        },
      ],
      [
        'a protocol this Clew does not load',
        edited(talks, m => (m.protocol = 2)),
        { path: 'protocol', anchor: 'rule-protocol-accepted' },
      ],
      ['another id', talks, { path: 'id', anchor: 'rule-id-matches' }, 'other'],
      [
        'a name of another connector',
        edited(talks, m => (m.capabilities[2].name = 'other.units')),
        { path: 'capabilities[2].name', anchor: 'rule-name-prefixed' },
      ],
      [
        'an execute offered to the model',
        edited(talks, m => Object.assign(m.capabilities[3], { kind: 'execute', model: true })),
        { path: 'capabilities[3].model', anchor: 'rule-execute-never-a-tool' },
      ],
      [
        'a view on an action',
        edited(
          talks,
          m => (m.capabilities[3].view = { kind: 'table', title: 'person', fields: [{ key: 'person', label: 'P' }] }),
        ),
        { path: 'capabilities[3].view', anchor: 'rule-view-on-a-read' },
      ],
      [
        'a field the output lacks',
        edited(talks, m => m.capabilities[1].view.fields.push({ key: 'missing', label: 'Saknas' })),
        { path: 'capabilities[1].view.fields[1].key', anchor: 'rule-view-keys-in-output' },
      ],
      [
        'a query the input lacks',
        edited(talks, m => (m.capabilities[1].view.input = { query: { key: 'q', label: 'Sök' } })),
        { path: 'capabilities[1].view.input', anchor: 'rule-view-input-in-input' },
      ],
      [
        'a row that opens another system',
        edited(talks, m => (m.capabilities[0].view.open.capability = 'appraisals.nothing')),
        { path: 'capabilities[0].view.open.capability', anchor: 'rule-row-opens-own-read' },
      ],
      [
        'a table of people whose byKey names a read about nobody',
        edited(talks, m => {
          m.capabilities[2].input = { type: 'object', properties: {} };
          delete m.capabilities[2].about;
          m.capabilities[2].view.byKey = 'appraisals.commitments';
          m.capabilities[2].view.subject = { entity: 'person', key: 'key' };
        }),
        { path: 'capabilities[2].view.byKey', anchor: 'rule-view-by-key-names-a-read-about-the-subject' },
      ],
      [
        'a subject the record lacks',
        edited(talks, m => (m.capabilities[1].view.subject = { entity: 'person', key: 'missing' })),
        { path: 'capabilities[1].view.subject.key', anchor: 'rule-view-subject-is-a-string' },
      ],
      [
        'a first field beside nothing',
        edited(talks, m => (m.capabilities[0].view.fields[0].beside = true)),
        { path: 'capabilities[0].view.fields[0].beside', anchor: 'rule-view-beside-follows' },
      ],
      [
        'two compact fields',
        edited(talks, m => m.capabilities[0].view.fields.forEach((f: any) => (f.compact = true))),
        { path: 'capabilities[0].view.fields', anchor: 'rule-view-compact-once' },
      ],
      [
        'a menu row that needs input',
        edited(talks, m => (m.capabilities[1].menu = { label: 'Punkter', icon: 'document' })),
        { path: 'capabilities[1].menu', anchor: 'rule-menu-needs-open-view' },
      ],
      [
        'a standing action that does not exist',
        edited(
          talks,
          m =>
            (m.areas = [
              { id: 'talks', title: 'Samtal', roles: ['manager'], standing: ['appraisals.gone'], schedules: [] },
            ]),
        ),
        { path: 'areas[0].standing[0]', anchor: 'rule-standing-exists' },
      ],
      [
        'a read that follows a fact',
        edited(talks, m => (m.capabilities[1].follows = ['appraisals:held'])),
        { path: 'capabilities[1].follows', anchor: 'rule-follows-on-a-propose' },
      ],
      [
        'a fact the manifest does not declare',
        edited(talks, m => (m.capabilities[3].creates = 'appraisals:held')),
        { path: 'capabilities[3].creates', anchor: 'rule-creates-declared' },
      ],
      [
        'keys without a bound',
        edited(talks, m => delete m.capabilities[0].input.properties.keys.maxItems),
        { path: 'capabilities[0].input', anchor: 'rule-about-read-keys' },
      ],
      [
        'a param on a read',
        edited(talks, m => (m.capabilities[0].about.param = 'keys')),
        { path: 'capabilities[0].about.param', anchor: 'rule-about-read-keys' },
      ],
      [
        'a read about a person as a tool',
        edited(talks, m => (m.capabilities[0].model = true)),
        { path: 'capabilities[0].model', anchor: 'rule-about-never-a-tool' },
      ],
      [
        'an action without its param',
        edited(talks, m => delete m.capabilities[3].about.param),
        { path: 'capabilities[3].about.param', anchor: 'rule-about-action-param' },
      ],
      [
        'an action that asks more than the key',
        edited(talks, m => (m.capabilities[3].input.required = ['person', 'at'])),
        {
          path: 'capabilities[3].input.required',
          field: 'capabilities[].input',
          anchor: 'rule-about-action-key-alone',
        },
      ],
      [
        'a follower about a person',
        edited(talks, m => (m.capabilities[3].follows = ['appraisals:held'])),
        { path: 'capabilities[3].about', anchor: 'rule-about-not-a-follower' },
      ],
      [
        'a profile read about a person',
        edited(talks, m => (m.capabilities[0].name = 'appraisals.talks')),
        { path: 'capabilities[0].about', anchor: 'rule-about-not-a-profile' },
      ],
      [
        'a read that asks',
        edited(
          talks,
          m => (m.capabilities[1].asks = [{ kind: 'text', property: 'person', label: 'Vem', required: true }]),
        ),
        { path: 'capabilities[1].asks', anchor: 'rule-asks-on-an-action' },
      ],
      [
        'an ask the input lacks',
        edited(
          talks,
          m =>
            (m.capabilities[3].asks = [
              { kind: 'meeting', property: 'when', label: 'När', required: false, durationMinutes: 45 },
            ]),
        ),
        {
          path: 'capabilities[3].asks[0].property',
          field: 'capabilities[].asks[].property',
          anchor: 'rule-ask-names-input',
        },
      ],
      [
        'an ask whose kind does not fit',
        edited(talks, m => {
          m.capabilities[3].input.properties.at = { type: 'integer' };
          m.capabilities[3].asks = [
            { kind: 'text', property: 'person', label: 'Vem', required: true },
            { kind: 'meeting', property: 'at', label: 'När', required: false, durationMinutes: 45 },
          ];
        }),
        { path: 'capabilities[3].asks[1].kind', anchor: 'rule-ask-fits-input' },
      ],
      [
        'an optional ask the input requires',
        edited(talks, m => {
          m.capabilities[3].input.required = ['person', 'at'];
          m.capabilities[3].asks = [{ kind: 'text', property: 'at', label: 'När', required: false }];
        }),
        { path: 'capabilities[3].asks[0].required', anchor: 'rule-ask-fits-input' },
      ],
      [
        'a choice that leaves a value out',
        edited(talks, m => {
          m.capabilities[3].input.properties.at = { type: 'string', enum: ['morning', 'afternoon', 'evening'] };
          m.capabilities[3].asks = [
            {
              kind: 'choice',
              property: 'at',
              label: 'När',
              required: false,
              options: [
                { value: 'morning', label: 'Förmiddag' },
                { value: 'afternoon', label: 'Eftermiddag' },
              ],
            },
          ];
        }),
        { path: 'capabilities[3].asks[0].options', anchor: 'rule-ask-fits-input' },
      ],
      [
        'an effect on a propose',
        edited(talks, m => (m.capabilities[3].effect = 'appraisals.commitments')),
        { path: 'capabilities[3].effect', field: 'capabilities[].effect', anchor: 'rule-effect-is-a-read' },
      ],
      [
        'a person param on a read about a person',
        edited(talks, m => (m.capabilities[0].person = { param: 'keys', admits: ['managed'] })),
        { path: 'capabilities[0].person.param', anchor: 'rule-person-param' },
      ],
      [
        'a person declared on a read that names no input',
        edited(talks, m => (m.capabilities[1].person = { admits: ['self', 'managed'] })),
        { path: 'capabilities[1].person', anchor: 'rule-person-param' },
      ],
      [
        'a person param that is not a string of the input',
        edited(talks, m => (m.capabilities[1].person = { param: 'nobody' })),
        { path: 'capabilities[1].input.properties.nobody', anchor: 'rule-named-input-is-a-string' },
      ],
      [
        'a read a row opens whose person may be an array',
        edited(talks, m => (m.capabilities[1].input.properties.person = { type: 'array', items: { type: 'string' } })),
        { path: 'capabilities[1].input.properties.person', anchor: 'rule-named-input-is-a-string' },
      ],
      [
        'unit declared on a read about a person',
        edited(talks, m => (m.capabilities[0].unit = { admits: ['manages'] })),
        { path: 'capabilities[0].unit', anchor: 'rule-unit-on-a-unit' },
      ],
      [
        'a person declared on a read about a unit',
        edited(talks, m => (m.capabilities[2].person = { admits: ['managed'] })),
        { path: 'capabilities[2].person', anchor: 'rule-person-not-a-unit' },
      ],
      // The reads Clew makes as the installation (D119).
      [
        'an installation read that is no profile',
        edited(
          talks,
          m => (m.installation = [{ ...structuredClone(HOLDINGS_EXAMPLE), name: 'appraisals.everything' }]),
        ),
        { path: 'installation[0].name', anchor: 'rule-installation-profile' },
      ],
      [
        'a holdings read that takes keys',
        edited(talks, m => {
          m.installation = [{ ...structuredClone(HOLDINGS_EXAMPLE), name: 'appraisals.holdings' }];
          m.installation[0].input = { type: 'object', properties: { keys: { type: 'array' } } };
        }),
        { path: 'installation[0].input', anchor: 'rule-installation-holdings-input' },
      ],
      [
        'a holdings read whose rows carry a name',
        edited(talks, m => {
          m.installation = [{ ...structuredClone(HOLDINGS_EXAMPLE), name: 'appraisals.holdings' }];
          m.installation[0].output.properties.rows.items.properties.name = { type: 'string' };
        }),
        { path: 'installation[0].output', anchor: 'rule-installation-holdings-output' },
      ],
    ];
    const placed = new Set<string>();
    for (const [what, document, expected, id] of cases) {
      const preview = previewManifest(document, { id: id ?? 'appraisals' });
      expect({ what, issues: preview.issues.length }).toEqual({ what, issues: preview.problems.length });
      expect({ what, problems: preview.issues.map(i => i.problem) }).toEqual({ what, problems: preview.problems });
      expect({ what, issues: preview.issues }).toEqual({
        what,
        issues: expect.arrayContaining([expect.objectContaining(expected)]),
      });
      expect(validPreview(preview)).toBe(true);
      for (const issue of preview.issues) {
        // The anchor is an entry the reference page draws: a rule by its id, else a field it has.
        if (issue.rule) expect(RULES.map(r => r.id)).toContain(issue.rule.id);
        else expect(issue.field === '' || fields.has(issue.field)).toBe(true);
        if (issue.rule) placed.add(issue.rule.id);
      }
    }
    // A loader rule that a sentence of the loader cannot be traced back to fails here: add it to preview.ts's table.
    expect(
      RULES.filter(r => r.enforced === 'loader')
        .map(r => r.id)
        .filter(id => !placed.has(id)),
    ).toEqual([]);
    // A document that is not an object is placed at its root, under the reference's fields.
    expect(previewManifest('manifest').issues[0]).toEqual(
      expect.objectContaining({ path: '', field: '', anchor: 'fields' }),
    );
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
