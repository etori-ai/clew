import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/**
 * The licence notices of what a browser build passes on (D143 item 3), shared by every Vite build Clew publishes: the
 * web app and its workers, the header embed and the documentation site. Each writes `third-party-notices.txt` and
 * Clew's own `LICENSE.txt` beside its files.
 */

const REPOSITORY = 'https://github.com/etori-ai/clew';
const ROOT = resolve(import.meta.dirname, '..');
// LICENSE, LICENCE, COPYING, NOTICE and OFL, also as a suffix (MIT-LICENSE) or with an extension; files only, and no
// code: a script named `license-update.mjs` is no licence.
const NOTICE_FILE = /^(licen[cs]e|copying|notice|ofl)|[-_](licen[cs]e|notice)(\.|$)/i;
const CODE_FILE = /\.([cm]?[jt]sx?|json|map)$/i;
// `@import 'x.css'`, `@import "x.css"` and `@import url(x.css)`, quoted or not.
const CSS_IMPORT = /@import\s+(?:url\(\s*['"]?([^'")\s]+)['"]?\s*\)|['"]([^'"]+)['"])/g;
// A typeface a stylesheet brings with it: `url(x.woff2)`, `url('x.ttf?v=1')`.
const FONT_URL = /url\(\s*['"]?[^'")\s]+\.(woff2?|ttf|otf|eot)([?#][^'")\s]*)?['"]?\s*\)/i;
const RULE = '='.repeat(72);

/**
 * The part of a Vite (Rollup, Rolldown) plugin this one uses, typed here: the scripts folder has no Vite of its own,
 * and the apps and the documentation site each pass it to theirs.
 */
interface BuildContext {
  resolve(source: string, importer?: string): Promise<{ id: string } | null>;
  getModuleIds(): IterableIterator<string>;
  emitFile(file: { type: 'asset'; fileName: string; source: string }): string;
  error(message: string): never;
}
export interface NoticesPlugin {
  name: string;
  apply: 'build';
  enforce: 'pre';
  configResolved?(config: { build: { ssr?: unknown } }): void;
  buildStart?(this: BuildContext): void;
  transform(this: BuildContext, code: string, id: string): Promise<null>;
  generateBundle(this: BuildContext): void;
}

/**
 * Packages that declare a licence but ship no licence file, with the upstream text kept in `licences/`. MIT asks that
 * the copyright and permission notice travel with copies, and a minifier strips the headers that carried it.
 */
export const VENDORED: Readonly<Record<string, string>> = {
  // github.com/meta/astryx, LICENSE
  '@astryxdesign/core': 'licences/astryxdesign-core.txt',
  // github.com/facebook/stylex, LICENSE
  '@stylexjs/stylex': 'licences/stylexjs-stylex.txt',
  // gitlab.com/catamphetamine/worker-f, LICENSE
  'worker-f': 'licences/worker-f.txt',
  // The licence section of its own README: 1.0.0 ships no licence file.
  isarray: 'licences/isarray.txt',
  // github.com/algolia/docsearch, LICENSE: VitePress's search packages, in the documentation site.
  '@docsearch/css': 'licences/algolia-docsearch.txt',
  '@docsearch/js': 'licences/algolia-docsearch.txt',
  '@docsearch/react': 'licences/algolia-docsearch.txt',
  // github.com/algolia/autocomplete, LICENSE
  '@algolia/autocomplete-core': 'licences/algolia-autocomplete.txt',
  '@algolia/autocomplete-plugin-algolia-insights': 'licences/algolia-autocomplete.txt',
  '@algolia/autocomplete-preset-algolia': 'licences/algolia-autocomplete.txt',
  '@algolia/autocomplete-shared': 'licences/algolia-autocomplete.txt',
  // github.com/scalar/scalar, LICENSE: the connector protocol's viewer, which the server serves (D60).
  '@scalar/api-reference': 'licences/scalar.txt',
  '@scalar/openapi-types': 'licences/scalar.txt',
  '@scalar/schemas': 'licences/scalar.txt',
  '@scalar/workspace-store': 'licences/scalar.txt',
  // github.com/tailwindlabs/headlessui, LICENSE
  '@headlessui/vue': 'licences/headlessui.txt',
  // github.com/vercel/ai, LICENSE
  '@ai-sdk/provider-utils': 'licences/vercel-ai.txt',
  // Its repository holds no licence file; the file says what its package.json and README name.
  'proto-parser': 'licences/proto-parser.txt',
};
/**
 * Typefaces a package ships inside its own files under a licence of their own, with the upstream text kept in
 * `licences/`: the package's licence file covers its code, not the typeface.
 */
export const TYPEFACES: Readonly<Record<string, { typeface: string; text: string }>> = {
  // github.com/rsms/inter, LICENSE.txt: the typeface of VitePress's default theme, in the documentation site.
  vitepress: { typeface: 'Inter', text: 'licences/inter-OFL.txt' },
};
/** Licences that ask for no notice: a package under one of them is listed, and its notice may be empty. */
const NO_NOTICE = new Set(['CC0-1.0', '0BSD', 'MIT-0', 'Unlicense']);

/** Where the texts Clew keeps for packages are, and which packages they are for. */
export interface Kept {
  vendored?: Readonly<Record<string, string>>;
  typefaces?: Readonly<Record<string, { typeface: string; text: string }>>;
  base?: string;
}

export interface Package {
  name: string;
  version: string;
  license: string;
  notices: Array<{ file: string; text: string }>;
  root: string;
  dependencies: string[];
}

/** The folder of the package a bundled file comes from, or none for Clew's own sources and virtual modules. */
export function packageRoot(id: string): string | undefined {
  const file = id.split('?')[0]!.replace(/\\/g, '/');
  if (file.startsWith('\0')) return undefined;
  const marker = '/node_modules/';
  const at = file.lastIndexOf(marker);
  if (at < 0) return undefined;
  const rest = file.slice(at + marker.length).split('/');
  const segments = rest[0]?.startsWith('@') ? 2 : 1;
  if (rest.length <= segments) return undefined;
  return file.slice(0, at + marker.length) + rest.slice(0, segments).join('/');
}

/** A path with its links followed, so a package reached through a link is the same package as its real folder. */
const real = (path: string) => (existsSync(path) ? realpathSync(path) : path);

/**
 * Where `name` resolves from a package's real folder, as Node resolves it: its own node_modules, then each parent's.
 * The answer is a real folder too, so the next package's dependencies resolve from where it is installed.
 */
export function dependencyRoot(from: string, name: string): string | undefined {
  for (let dir = real(from); ;) {
    const candidate = join(dir, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) return real(candidate);
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/** A package's name, licence and notices, or none when its folder holds no `package.json` that names it. */
export function readPackage(root: string, kept: Kept = {}): Package | undefined {
  const { vendored = VENDORED, typefaces = TYPEFACES, base = ROOT } = kept;
  const manifest = join(root, 'package.json');
  if (!existsSync(manifest)) return undefined;
  const json = JSON.parse(readFileSync(manifest, 'utf8')) as {
    name?: string;
    version?: string;
    license?: string | { type?: string };
    dependencies?: Record<string, string>;
  };
  if (!json.name) return undefined;
  const license = typeof json.license === 'string' ? json.license : (json.license?.type ?? 'not declared');
  let notices = readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isFile() && NOTICE_FILE.test(entry.name) && !CODE_FILE.test(entry.name))
    .map(entry => entry.name)
    .sort()
    .map(file => ({ file, text: readFileSync(join(root, file), 'utf8').trim() }))
    // An empty file is no notice.
    .filter(n => n.text);
  const upstream = vendored[json.name];
  if (!notices.length && upstream)
    notices = [
      {
        file: `LICENSE (upstream, kept in Clew's repository as ${upstream})`,
        text: readFileSync(join(base, upstream), 'utf8').trim(),
      },
    ];
  const typeface = typefaces[json.name];
  if (typeface)
    notices.push({
      file: `the ${typeface.typeface} typeface the package ships (upstream licence, kept in Clew's repository as ${typeface.text})`,
      text: readFileSync(join(base, typeface.text), 'utf8').trim(),
    });
  return {
    name: json.name,
    version: json.version ?? '',
    license,
    notices,
    root,
    dependencies: Object.keys(json.dependencies ?? {}).sort(),
  };
}

/**
 * A package that a dependency's own build put inside its files and that no install brings, credited from its upstream
 * licence kept in `licences/`: Scalar's standalone script is built from Scalar's lockfile, not Clew's.
 */
export function keptPackage(
  p: { name: string; version: string; license: string; text: string },
  base: string = ROOT,
): Package {
  const text = readFileSync(join(base, p.text), 'utf8').trim();
  return {
    name: p.name,
    version: p.version,
    license: p.license,
    notices: [{ file: `LICENSE (upstream, kept in Clew's repository as ${p.text})`, text }],
    root: '',
    dependencies: [],
  };
}

const byName = (a: Package, b: Package) =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : a.version < b.version ? -1 : 1;

/**
 * The packages a build bundles, and every runtime dependency they reach. A package built ahead of time can carry its
 * dependencies inside its own files (jszip's browser build carries pako), so each is credited whether or not its code
 * reached these files; a package already bundled is listed once. `unread` names the folders a bundled file came from
 * that hold no named package, and the dependencies that resolve nowhere: a notice that leaves them out is not whole.
 */
export function collect(
  roots: Iterable<string>,
  kept: Kept = {},
): { bundled: Package[]; carried: Package[]; unread: string[] } {
  const seen = new Map<string, Package>();
  const bundled: Package[] = [];
  const unread: string[] = [];
  for (const root of new Set([...roots].map(real))) {
    const p = readPackage(root, kept);
    if (!p) unread.push(root);
    if (!p || seen.has(`${p.name}@${p.version}`)) continue;
    seen.set(`${p.name}@${p.version}`, p);
    bundled.push(p);
  }
  const carried: Package[] = [];
  const queue = [...bundled];
  while (queue.length) {
    const from = queue.shift()!;
    for (const name of from.dependencies) {
      const root = dependencyRoot(from.root, name);
      const p = root ? readPackage(root, kept) : undefined;
      if (!p) unread.push(`${name} (a dependency of ${from.name} ${from.version})`);
      if (!p || seen.has(`${p.name}@${p.version}`)) continue;
      seen.set(`${p.name}@${p.version}`, p);
      carried.push(p);
      queue.push(p);
    }
  }
  return { bundled: bundled.sort(byName), carried: carried.sort(byName), unread: unread.sort() };
}

/** The notices as one text: Clew's own licence and source first, then each package with its licence and files. */
export function noticesText({ bundled, carried }: { bundled: readonly Package[]; carried: readonly Package[] }) {
  const parts = [
    'Third-party software in this build of Clew',
    '',
    `Clew is licensed under the GNU Affero General Public License v3.0, in LICENSE.txt beside these files. Its source`,
    `is at ${REPOSITORY}. The packages below are bundled into these files under their own licences, and`,
    'their notices travel with them here.',
  ];
  const write = (p: Package) => {
    parts.push('', RULE, `${p.name} ${p.version} (${p.license})`, RULE);
    if (!p.notices.length) parts.push('', `The package carries no licence file, and ${p.license} asks for no notice.`);
    for (const n of p.notices) parts.push('', `--- ${n.file}`, '', n.text);
  };
  bundled.forEach(write);
  if (carried.length) {
    parts.push(
      '',
      RULE,
      'Carried by the packages above',
      RULE,
      '',
      'The runtime dependencies of the packages above. A package built ahead of time can carry its dependencies',
      'inside its own files, so each is credited here whether or not its code is in these files.',
    );
    carried.forEach(write);
  }
  return parts.join('\n') + '\n';
}

/** The packages whose notice would be empty: no licence file and no kept upstream text. */
export const unnoticed = ({ bundled, carried }: { bundled: readonly Package[]; carried: readonly Package[] }) =>
  [...bundled, ...carried]
    .filter(p => !p.notices.length && !NO_NOTICE.has(p.license))
    .map(p => `${p.name} ${p.version} (${p.license})`);

/**
 * The packages whose stylesheets bring a typeface while no notice of theirs is a typeface's licence: a font package's
 * own licence says "Font Software" (the OFL) or "font", and a package that ships a typeface beside its code needs the
 * typeface's text kept in `licences/` and named in TYPEFACES.
 */
export const typefaceUnnoticed = (packages: readonly Package[], withTypeface: ReadonlySet<string>) =>
  packages
    .filter(p => withTypeface.has(p.root) && !p.notices.some(n => /\bfont/i.test(n.text)))
    .map(p => `${p.name} ${p.version}`);

/**
 * The plugin for a build, and the one for its workers, which Vite builds as bundles of their own with
 * `worker.plugins`. They share what they find; the build's plugin writes it all once, after the workers are built.
 * A server-side build (the documentation site's prerender) writes nothing: none of it reaches a browser.
 */
export function thirdPartyNotices(options: { fileName?: string } & Kept = {}): {
  plugin: NoticesPlugin;
  worker: NoticesPlugin;
} {
  const { fileName = 'third-party-notices.txt', ...kept } = options;
  const base = kept.base ?? ROOT;
  const roots = new Set<string>();
  // The packages whose stylesheets bring a typeface, by real folder.
  const withTypeface = new Set<string>();
  // Module ids inside a node_modules folder that name no package's file.
  const untraced = new Set<string>();
  let ssr = false;
  const stylesheet = (code: string, id: string) => {
    const root = packageRoot(id);
    if (root && FONT_URL.test(code)) withTypeface.add(real(root));
  };
  // A stylesheet's `@import`, such as the typeface's, is inlined and is no module of its own, so the imports are resolved
  // as each stylesheet is read.
  const transform: NoticesPlugin['transform'] = async function (code, id) {
    if (!/\.css(\?|$)/.test(id)) return null;
    stylesheet(code, id);
    const seen = new Set<string>([id]);
    const pending: Array<{ code: string; id: string }> = [{ code, id }];
    while (pending.length) {
      const sheet = pending.pop()!;
      for (const [, url, quoted] of sheet.code.matchAll(CSS_IMPORT)) {
        const resolved = (await this.resolve((url ?? quoted)!, sheet.id))?.id.split('?')[0];
        if (!resolved || seen.has(resolved)) continue;
        seen.add(resolved);
        const root = packageRoot(resolved);
        if (root) roots.add(root);
        if (resolved.endsWith('.css') && existsSync(resolved)) {
          const imported = readFileSync(resolved, 'utf8');
          stylesheet(imported, resolved);
          pending.push({ code: imported, id: resolved });
        }
      }
    }
    return null;
  };
  const gather = (ids: Iterable<string>) => {
    for (const id of ids) {
      const root = packageRoot(id);
      if (root) roots.add(root);
      // A virtual module (`\0…?commonjs-module`) wraps a file that is a module of its own, and is traced as that file.
      else if (!id.startsWith('\0') && id.replace(/\\/g, '/').includes('/node_modules/')) untraced.add(id);
    }
  };
  const worker: NoticesPlugin = {
    name: 'clew-third-party-notices:worker',
    apply: 'build',
    enforce: 'pre',
    transform,
    generateBundle() {
      gather(this.getModuleIds());
    },
  };
  const plugin: NoticesPlugin = {
    name: 'clew-third-party-notices',
    apply: 'build',
    enforce: 'pre',
    configResolved(config) {
      ssr = !!config.build.ssr;
    },
    buildStart() {
      roots.clear();
      withTypeface.clear();
      untraced.clear();
    },
    transform,
    generateBundle() {
      if (ssr) return;
      gather(this.getModuleIds());
      // A module id that no longer looks like a package's file would drop that package from the notice without a word.
      if (untraced.size)
        this.error(
          `Third-party notices: these bundled modules could not be traced to a package: ${[...untraced].join(', ')}.`,
        );
      const found = collect(roots, kept);
      if (found.unread.length) this.error(`Third-party notices: no named package.json for ${found.unread.join(', ')}.`);
      const missing = unnoticed(found);
      if (missing.length)
        this.error(
          `Third-party notices: no licence file for ${missing.join(', ')}. Keep the upstream licence text in licences/ and name it in VENDORED (scripts/third-party-notices.ts).`,
        );
      const typefaces = typefaceUnnoticed(found.bundled, withTypeface);
      if (typefaces.length)
        this.error(
          `Third-party notices: ${typefaces.join(', ')} brings a typeface with no typeface licence. Keep the typeface's licence text in licences/ and name it in TYPEFACES (scripts/third-party-notices.ts).`,
        );
      this.emitFile({ type: 'asset', fileName, source: noticesText(found) });
      this.emitFile({ type: 'asset', fileName: 'LICENSE.txt', source: readFileSync(join(base, 'LICENSE'), 'utf8') });
    },
  };
  return { plugin, worker };
}
