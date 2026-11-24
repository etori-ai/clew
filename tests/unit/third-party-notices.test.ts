import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  collect,
  noticesText,
  packageRoot,
  thirdPartyNotices,
  typefaceUnnoticed,
  unnoticed,
} from '../../scripts/third-party-notices';

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
  'OFL.txt': 'This Font Software is licensed under the SIL Open Font License',
  'index.css': "@font-face { src: url(./files/raleway.woff2) format('woff2'); }",
});
// A package whose code is MIT and whose theme ships a typeface under a licence of its own, as VitePress ships Inter.
const theme = pkg('theme@1.0.0', 'theme', '1.0.0', {
  LICENSE: 'MIT License, Copyright (c) Theme',
  'styles/fonts.css': "@font-face { src: url('../fonts/sans.woff2') format('woff2'); }",
});
// A script named like a licence, and an empty licence file, are no notice.
const script = pkg('script@1.0.0', 'script', '1.0.0', { 'license-update.mjs': 'export {}', LICENSE: '\n' });
// A folder with a package.json that names no package, and a package whose dependency resolves nowhere.
const nameless = join(store, 'nameless@1.0.0', 'node_modules', 'nameless');
mkdirSync(nameless, { recursive: true });
writeFileSync(join(nameless, 'package.json'), JSON.stringify({ version: '1.0.0', type: 'module' }));
pkg('lonely@1.0.0', 'lonely', '1.0.0', { LICENSE: 'lonely licence' }, ['ghost']);
const lonely = join(store, 'lonely@1.0.0', 'node_modules', 'lonely');
// A workspace's node_modules links to the store, as Bun installs it.
mkdirSync(join(base, 'apps', 'web', 'node_modules'), { recursive: true });
const linked = join(base, 'apps', 'web', 'node_modules', 'jszip');
symlinkSync(jszip, linked);
mkdirSync(join(base, 'licences'));
writeFileSync(join(base, 'licences', 'acme.txt'), 'MIT License\n\nCopyright (c) Acme');
writeFileSync(
  join(base, 'licences', 'sans-OFL.txt'),
  'Copyright Sans Authors. This Font Software is licensed under the OFL.',
);
writeFileSync(join(base, 'LICENSE'), 'GNU AFFERO GENERAL PUBLIC LICENSE');
const vendored = { '@acme/widgets': 'licences/acme.txt' };
const typefaces = { theme: { typeface: 'Sans', text: 'licences/sans-OFL.txt' } };

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
    const found = collect([jszip, scoped, reuse], { vendored, base });
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
    expect(unnoticed(collect([scoped], { vendored: {}, base }))).toEqual(['@acme/widgets 1.0.0 (MIT)']);
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
    expect(() => call(odd.plugin.generateBundle, context(['/app/node_modules/react']))).toThrow(
      'could not be traced to a package: /app/node_modules/react',
    );
    // A virtual module that wraps a package's file is traced as that file, which is a module of its own.
    call(odd.plugin.buildStart, context([]));
    call(
      odd.plugin.generateBundle,
      context([join(jszip, 'dist/jszip.min.js'), `\0${join(jszip, 'dist/jszip.min.js')}?commonjs-module`]),
    );
    // One untraced module among traced ones is a notice with a package missing, and fails too.
    call(odd.plugin.buildStart, context([]));
    expect(() =>
      call(odd.plugin.generateBundle, context([join(jszip, 'dist/jszip.min.js'), '/app/node_modules/react'])),
    ).toThrow('could not be traced');
    // A folder whose package.json names no package, and a dependency that resolves nowhere, leave the notice short.
    call(odd.plugin.buildStart, context([]));
    expect(() => call(odd.plugin.generateBundle, context([join(nameless, 'index.js')]))).toThrow(
      'no named package.json for',
    );
    expect(collect([lonely], { vendored, base }).unread).toEqual(['ghost (a dependency of lonely 1.0.0)']);
  });
  test('a script named like a licence, or an empty licence file, is no notice', () => {
    const found = collect([script], { vendored: {}, base });
    expect(found.bundled[0]!.notices).toEqual([]);
    expect(unnoticed(found)).toEqual(['script 1.0.0 (MIT)']);
  });
  test('a package reached through a link is its real folder: its dependencies resolve from the store, and it is listed once', () => {
    const found = collect([linked, jszip], { vendored, base });
    expect(found.bundled.map(p => [p.name, p.root])).toEqual([['jszip', realpathSync(jszip)]]);
    expect(found.carried.map(p => p.name)).toEqual(['pako']);
    expect(found.unread).toEqual([]);
  });
  test("a typeface a package's stylesheet brings needs the typeface's own licence, kept beside the package's", async () => {
    const run = async (kept: { typefaces: Record<string, { typeface: string; text: string }> }) => {
      const { plugin } = thirdPartyNotices({ vendored, base, ...kept });
      const emitted: Record<string, string> = {};
      const context = (ids: string[]) => ({
        getModuleIds: () => ids.values(),
        emitFile: (f: { fileName: string; source: string }) => {
          emitted[f.fileName] = f.source;
        },
        error: (message: string) => {
          throw new Error(message);
        },
        resolve: async () => null,
      });
      const call = (hook: unknown, self: unknown, ...args: unknown[]) =>
        (hook as (...a: unknown[]) => unknown).call(self, ...args);
      call(plugin.buildStart, context([]));
      const fonts = join(theme, 'styles/fonts.css');
      await call(plugin.transform, context([]), readFileSync(fonts, 'utf8'), fonts);
      call(plugin.generateBundle, context([fonts]));
      return emitted['third-party-notices.txt']!;
    };
    await expect(run({ typefaces: {} })).rejects.toThrow('theme 1.0.0 brings a typeface with no typeface licence');
    const text = await run({ typefaces });
    expect(text).toContain(
      "--- the Sans typeface the package ships (upstream licence, kept in Clew's repository as licences/sans-OFL.txt)",
    );
    expect(text).toContain('This Font Software is licensed under the OFL.');
    // A font package's own licence is a typeface's licence.
    const raleway = collect([font], { vendored, base }).bundled;
    expect(typefaceUnnoticed(raleway, new Set([realpathSync(font)]))).toEqual([]);
  });
});

// The names of a configuration's plugins; Vite takes nested lists and `false` for a plugin left out.
const pluginNames = (plugins: unknown[]) =>
  plugins.flat(Infinity).flatMap(p => (p && typeof p === 'object' && 'name' in p ? [String(p.name)] : []));

describe('every browser build Clew publishes writes the notices (D143 item 3)', () => {
  test('the web app, with its workers', async () => {
    const { webConfig } = await import('../../apps/web/vite.config');
    const config = webConfig();
    expect(pluginNames(config.plugins)).toContain('clew-third-party-notices');
    expect(config.worker.plugins().map(p => p.name)).toEqual(['clew-third-party-notices:worker']);
  });
  test('the header embed', async () => {
    const config = (await import('../../packages/site-header/vite.config')).default as { plugins: unknown[] };
    expect(pluginNames(config.plugins)).toContain('clew-third-party-notices');
  });
  test('the documentation site, whose VitePress is installed on its own', () => {
    // The site's packages are not installed with the repository's, so its configuration is read rather than loaded.
    const source = readFileSync(join(import.meta.dirname, '../../site/.vitepress/config.ts'), 'utf8');
    expect(source).toMatch(/vite:\s*\{[\s\S]*plugins:\s*\[[\s\S]*thirdPartyNotices\(\)\.plugin/);
  });
});
