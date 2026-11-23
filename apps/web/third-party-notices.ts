import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';

const NOTICE_FILE = /^(licen[cs]e|copying|notice|ofl)/i;
const RULE = '='.repeat(72);
const CSS_IMPORT = /@import\s+(?:url\(\s*)?['"]([^'"]+)['"]/g;

interface Package {
  name: string;
  version: string;
  license: string;
  notices: Array<{ file: string; text: string }>;
}

/** The folder of the package a bundled file comes from, or none for Clew's own sources and virtual modules. */
export function packageRoot(id: string): string | undefined {
  const file = id.split('?')[0]!;
  if (file.startsWith('\0')) return undefined;
  const marker = '/node_modules/';
  const at = file.lastIndexOf(marker);
  if (at < 0) return undefined;
  const rest = file.slice(at + marker.length).split('/');
  const segments = rest[0]?.startsWith('@') ? 2 : 1;
  if (rest.length <= segments) return undefined;
  return file.slice(0, at + marker.length) + rest.slice(0, segments).join('/');
}

function readPackage(root: string): Package | undefined {
  const manifest = join(root, 'package.json');
  if (!existsSync(manifest)) return undefined;
  const json = JSON.parse(readFileSync(manifest, 'utf8')) as {
    name?: string;
    version?: string;
    license?: string | { type?: string };
  };
  if (!json.name) return undefined;
  const license = typeof json.license === 'string' ? json.license : (json.license?.type ?? 'not declared');
  const notices = readdirSync(root)
    .filter(file => NOTICE_FILE.test(file))
    .sort()
    .map(file => ({ file, text: readFileSync(join(root, file), 'utf8').trim() }));
  return { name: json.name, version: json.version ?? '', license, notices };
}

/** The notices as one text: Clew's own licence first, then each package by name with its declared licence and files. */
export function noticesText(packages: readonly Package[]): string {
  const parts = [
    "Third-party software in Clew's web app",
    '',
    "Clew is licensed under the GNU Affero General Public License v3.0 (LICENSE in Clew's repository). The packages",
    'below are bundled into these files under their own licences, and their notices travel with them here.',
  ];
  for (const p of packages) {
    parts.push('', RULE, `${p.name} ${p.version} (${p.license})`, RULE);
    if (!p.notices.length) parts.push('', `The package carries no licence file. It declares: ${p.license}.`);
    for (const n of p.notices) parts.push('', `--- ${n.file}`, '', n.text);
  }
  return parts.join('\n') + '\n';
}

/**
 * The licence notices of what the web build passes on: every package a bundled module or stylesheet comes from, with
 * its version, declared licence and its own licence and notice files, written beside the built files. MIT, BSD,
 * Apache-2.0, MPL-2.0 and the SIL Open Font License ask that the notice travel with copies. Clew's own packages are
 * workspace sources, not under `node_modules`, so they are not listed: the repository's LICENSE covers them.
 */
export function thirdPartyNotices(fileName = 'third-party-notices.txt'): Plugin {
  // A stylesheet's `@import`, such as the typeface's, is inlined into the stylesheet and is no module of its own, so
  // the imports are resolved here as each stylesheet is read.
  let fromStylesheets = new Set<string>();
  return {
    name: 'clew-third-party-notices',
    apply: 'build',
    enforce: 'pre',
    buildStart() {
      fromStylesheets = new Set();
    },
    async transform(code, id) {
      if (!/\.css(\?|$)/.test(id)) return null;
      const seen = new Set<string>([id]);
      const pending: Array<{ code: string; id: string }> = [{ code, id }];
      while (pending.length) {
        const sheet = pending.pop()!;
        for (const [, spec] of sheet.code.matchAll(CSS_IMPORT)) {
          const resolved = (await this.resolve(spec!, sheet.id))?.id.split('?')[0];
          if (!resolved || seen.has(resolved)) continue;
          seen.add(resolved);
          const root = packageRoot(resolved);
          if (root) fromStylesheets.add(root);
          if (resolved.endsWith('.css') && existsSync(resolved))
            pending.push({ code: readFileSync(resolved, 'utf8'), id: resolved });
        }
      }
      return null;
    },
    generateBundle() {
      const roots = new Set(fromStylesheets);
      for (const id of this.getModuleIds()) {
        const root = packageRoot(id);
        if (root) roots.add(root);
      }
      const byName = new Map<string, Package>();
      for (const root of roots) {
        const p = readPackage(root);
        if (p) byName.set(`${p.name}@${p.version}`, p);
      }
      const packages = [...byName.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      this.emitFile({ type: 'asset', fileName, source: noticesText(packages) });
    },
  };
}
