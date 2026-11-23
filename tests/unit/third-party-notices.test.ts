import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collect, noticesText, packageRoot, thirdPartyNotices, unnoticed } from '../../scripts/third-party-notices';

/**
 * A repository in miniature, laid out as Bun installs it: every package in `node_modules/.bun/<name>@<version>/`, its
 * dependencies beside it there. jszip carries pako inside its own build; a scoped package ships no licence file and
 * its upstream text is kept in `licences/`; another keeps its licence in a REUSE folder and an `MIT-LICENSE`.
 */
const base = mkdtempSync(join(tmpdir(), 'clew-notices-'));
afterAll(() => rmSync(base, { recursive: true, force: true }));
const store = join(base, 'node_modules', '.bun');
function pkg(dir: string, name: string, version: string, files: Record<string, string>, deps: string[] = []) {
  const root = join(store, dir, 'node_modules', name);
  mkdirSync(root, { recursive: true });
  const dependencies = Object.fromEntries(deps.map(d => [d, '*']));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name, version, license: 'MIT', dependencies }));
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(join(root, file, '..'), { recursive: true });
    writeFileSync(join(root, file), text);
  }
  return root;
}
const jszip = pkg('jszip@3.10.1', 'jszip', '3.10.1', { LICENSE: 'jszip licence', 'dist/jszip.min.js': '' }, ['pako']);
pkg('jszip@3.10.1', 'pako', '1.0.11', { LICENSE: 'pako licence' });
const scoped = pkg('@acme+widgets@1.0.0', '@acme/widgets', '1.0.0', { 'index.js': '', 'styles.css': '' });
const reuse = pkg('reuse@2.0.0', 'reuse', '2.0.0', {
  'LICENSES/MIT.txt': 'a folder, not a file',
  'MIT-LICENSE': 'reuse licence',
  'index.js': '',
});
const font = pkg('@fontsource-variable+raleway@5.3.0', '@fontsource-variable/raleway', '5.3.0', {
  'OFL.txt': 'SIL Open Font License',
  'index.css': '',
});
mkdirSync(join(base, 'licences'));
writeFileSync(join(base, 'licences', 'acme.txt'), 'MIT License\n\nCopyright (c) Acme');
writeFileSync(join(base, 'LICENSE'), 'GNU AFFERO GENERAL PUBLIC LICENSE');
const vendored = { '@acme/widgets': 'licences/acme.txt' };

describe("the third-party notices of Clew's browser builds (D143 item 3)", () => {
  test('a bundled file is traced to its package through Bun’s store, scoped or not, with a query or a Windows path', () => {
    expect(packageRoot(join(jszip, 'dist/jszip.min.js'))).toBe(jszip);
    expect(packageRoot(join(font, 'index.css') + '?inline')).toBe(font);
    expect(packageRoot('C:\\app\\node_modules\\.bun\\react@19\\node_modules\\react\\index.js')).toBe(
      'C:/app/node_modules/.bun/react@19/node_modules/react',
    );
    expect(packageRoot('/app/packages/ui/src/index.tsx')).toBeUndefined();
    expect(packageRoot('\0vite/preload-helper.js')).toBeUndefined();
    expect(packageRoot('/app/node_modules/react')).toBeUndefined();
  });
  test('a dependency a package carries inside its own build is credited, and a kept upstream text stands in for a missing file', () => {
    const found = collect([jszip, scoped, reuse], vendored, base);
    expect(found.bundled.map(p => p.name)).toEqual(['@acme/widgets', 'jszip', 'reuse']);
    expect(found.carried.map(p => p.name)).toEqual(['pako']);
    expect(found.bundled[0]!.notices).toEqual([
      {
        file: "LICENSE (upstream, kept in Clew's repository as licences/acme.txt)",
        text: 'MIT License\n\nCopyright (c) Acme',
      },
    ]);
    // A REUSE folder is no file to read; the suffixed name is.
    expect(found.bundled[2]!.notices).toEqual([{ file: 'MIT-LICENSE', text: 'reuse licence' }]);
    expect(unnoticed(found)).toEqual([]);
    expect(unnoticed(collect([scoped], {}, base))).toEqual(['@acme/widgets 1.0.0 (MIT)']);
    const text = noticesText(found);
    expect(text).toContain('GNU Affero General Public License v3.0, in LICENSE.txt');
    expect(text).toContain('https://github.com/etori-ai/clew');
    expect(text).toContain('Carried by the packages above');
    expect(text.indexOf('pako 1.0.11 (MIT)')).toBeGreaterThan(text.indexOf('Carried by the packages above'));
  });
  test("the build's plugin writes what it and its workers bundle, a stylesheet's imports included, and Clew's licence", async () => {
    const { plugin, worker } = thirdPartyNotices({ vendored, base });
    const emitted: Record<string, string> = {};
    const context = (ids: string[]) => ({
      getModuleIds: () => ids.values(),
      emitFile: (f: { fileName: string; source: string }) => {
        emitted[f.fileName] = f.source;
      },
      error: (message: string) => {
        throw new Error(message);
      },
      // `@import url(...)` without quotes resolves as a quoted one does.
      resolve: async (spec: string) => ({ id: spec === 'raleway' ? join(font, 'index.css') : join(scoped, spec) }),
    });
    const call = (hook: unknown, self: unknown, ...args: unknown[]) =>
      (hook as (...a: unknown[]) => unknown).call(self, ...args);
    call(plugin.configResolved, undefined, { build: {} });
    call(plugin.buildStart, context([]));
    await call(plugin.transform, context([]), '@import url(raleway);', '/app/packages/ui/src/styles.css');
    // The worker is a bundle of its own: what it holds reaches the notice through the shared list.
    call(worker.generateBundle, context([join(reuse, 'index.js')]));
    call(plugin.generateBundle, context([join(jszip, 'dist/jszip.min.js'), '/app/apps/web/src/main.tsx']));
    const text = emitted['third-party-notices.txt']!;
    for (const line of [
      'jszip 3.10.1 (MIT)',
      'reuse 2.0.0 (MIT)',
      '@fontsource-variable/raleway 5.3.0 (MIT)',
      'pako 1.0.11',
    ])
      expect(text).toContain(line);
    expect(text).toContain('SIL Open Font License');
    expect(emitted['LICENSE.txt']).toBe('GNU AFFERO GENERAL PUBLIC LICENSE');
  });
  test('a package with no notice, or modules that cannot be traced, fail the build rather than ship an empty notice', () => {
    const silent = thirdPartyNotices({ vendored: {}, base });
    const context = (ids: string[]) => ({
      getModuleIds: () => ids.values(),
      emitFile: () => undefined,
      error: (message: string) => {
        throw new Error(message);
      },
    });
    const call = (hook: unknown, self: unknown) => (hook as () => unknown).call(self);
    call(silent.plugin.buildStart, context([]));
    expect(() => call(silent.plugin.generateBundle, context([join(scoped, 'index.js')]))).toThrow(
      'no licence file for @acme/widgets 1.0.0',
    );
    const odd = thirdPartyNotices({ vendored, base });
    call(odd.plugin.buildStart, context([]));
    expect(() => call(odd.plugin.generateBundle, context(['/app/node_modules/react']))).toThrow('could be traced');
  });
});
