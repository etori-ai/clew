import { readFileSync } from 'node:fs';
import { collect, keptPackage, noticesText, packageRoot, unnoticed, type Kept, type Package } from './index';

/**
 * The notices of the connector protocol's viewer (D60, D143 item 3): Scalar's standalone script, which the server
 * serves beside the protocol's page. Scalar builds the script from its own lockfile, not Clew's, so the notices credit
 * what Clew's install holds of Scalar's package and its runtime dependencies, each at the version the script's source
 * map names: a package's file as `…/.pnpm/<name>@<version>[_<peers>]/node_modules/<name>/…`, and the packages of
 * Scalar's own repository, built at the versions Scalar's package names exactly, as `../../../<folder>/…`.
 */

/** A package the script holds that Clew's install does not hold at all, credited from its upstream text in licences/. */
export const VIEWER_BUILT_IN: ReadonlyArray<{ name: string; version: string; license: string; text: string }> = [
  // hast-util-to-text 4.0.2, which the script is built with, uses it; 4.0.3, which Clew installs, no longer does.
  { name: 'unist-util-find-after', version: '5.0.0', license: 'MIT', text: 'licences/unist-util-find-after.txt' },
];

/**
 * The packages the script holds at another version than the one Clew installs, each with the licence that version
 * declares (`npm view <name>@<version> license`, checked on 2026-11-24). Where it is the licence the installed copy
 * declares, the installed copy's licence file is credited for that version; where it is not, the version's own text is
 * kept in licences/ and the package is named in VIEWER_BUILT_IN instead. A Scalar upgrade changes the list: a version
 * in neither is logged by the server and fails the unit test until it is checked and written here.
 */
export const VIEWER_VERSIONS: Readonly<Record<string, string>> = {
  '@lezer/lr@1.4.11': 'MIT',
  '@marijn/find-cluster-break@1.0.2': 'MIT',
  '@ungap/structured-clone@1.2.0': 'ISC',
  'crelt@1.0.6': 'MIT',
  'decode-named-character-reference@1.0.2': 'MIT',
  'entities@6.0.1': 'BSD-2-Clause',
  'hast-util-from-html@2.0.3': 'MIT',
  'hast-util-from-parse5@8.0.1': 'MIT',
  'hast-util-is-body-ok-link@3.0.0': 'MIT',
  'hast-util-sanitize@5.0.1': 'MIT',
  'hast-util-to-mdast@10.1.2': 'MIT',
  'hast-util-to-text@4.0.2': 'MIT',
  'hastscript@8.0.0': 'MIT',
  'js-base64@3.9.6': 'BSD-3-Clause',
  'markdown-table@3.0.3': 'MIT',
  'mdast-util-find-and-replace@3.0.1': 'MIT',
  'mdast-util-from-markdown@2.0.1': 'MIT',
  'mdast-util-gfm-autolink-literal@2.0.0': 'MIT',
  'mdast-util-gfm-footnote@2.0.0': 'MIT',
  'mdast-util-gfm-strikethrough@2.0.0': 'MIT',
  'mdast-util-gfm-table@2.0.0': 'MIT',
  'mdast-util-gfm-task-list-item@2.0.0': 'MIT',
  'mdast-util-gfm@3.0.0': 'MIT',
  'mdast-util-to-markdown@2.1.0': 'MIT',
  'micromark-core-commonmark@2.0.1': 'MIT',
  'micromark-extension-gfm-autolink-literal@2.0.0': 'MIT',
  'micromark-extension-gfm-footnote@2.0.0': 'MIT',
  'micromark-extension-gfm-strikethrough@2.0.0': 'MIT',
  'micromark-extension-gfm-table@2.0.0': 'MIT',
  'micromark-extension-gfm-task-list-item@2.0.1': 'MIT',
  'micromark-factory-destination@2.0.0': 'MIT',
  'micromark-factory-label@2.0.0': 'MIT',
  'micromark-factory-space@2.0.0': 'MIT',
  'micromark-factory-title@2.0.0': 'MIT',
  'micromark-factory-whitespace@2.0.0': 'MIT',
  'micromark-util-character@2.1.0': 'MIT',
  'micromark-util-chunked@2.0.0': 'MIT',
  'micromark-util-classify-character@2.0.0': 'MIT',
  'micromark-util-combine-extensions@2.0.0': 'MIT',
  'micromark-util-decode-numeric-character-reference@2.0.1': 'MIT',
  'micromark-util-decode-string@2.0.0': 'MIT',
  'micromark-util-html-tag-name@2.0.0': 'MIT',
  'micromark-util-normalize-identifier@2.0.0': 'MIT',
  'micromark-util-resolve-all@2.0.0': 'MIT',
  'micromark-util-subtokenize@2.0.1': 'MIT',
  'micromark@4.0.0': 'MIT',
  'parse5@7.3.0': 'MIT',
  'rehype-minify-whitespace@6.0.0': 'MIT',
  'style-mod@4.1.2': 'MIT',
  'unist-util-is@6.0.0': 'MIT',
  'unist-util-visit-parents@6.0.2': 'MIT',
  'unist-util-visit@5.1.0': 'MIT',
  'vfile-location@5.0.2': 'MIT',
  'vfile-message@4.0.2': 'MIT',
};

/**
 * What the script's source map names: each package with the version the script holds, or `undefined` for a package of
 * Scalar's own repository, whose files it names by folder and not by version. The map is written from the script's
 * folder in Scalar's repository, `packages/api-reference/dist/browser/`: `../../src/` is that package's own source and
 * `../../../<folder>/` another package of the repository, published as `@scalar/<folder>`. `unplaced` lists the files
 * that are neither and no package's.
 */
export function scriptPackages(script: string): { named: Map<string, string | undefined>; unplaced: string[] } {
  const { sources } = JSON.parse(readFileSync(`${script}.map`, 'utf8')) as { sources: string[] };
  const named = new Map<string, string | undefined>();
  const unplaced: string[] = [];
  for (const source of sources) {
    const at = source.lastIndexOf('node_modules/');
    const folder = /^\.\.\/\.\.\/\.\.\/([^./][^/]*)\//.exec(source)?.[1];
    if (at >= 0) {
      const [first, second] = source.slice(at + 'node_modules/'.length).split('/');
      const name = first!.startsWith('@') ? `${first}/${second}` : first!;
      // A file outside the store's versioned folders names no version: '' is a version no install holds.
      named.set(name, /@(\d+\.\d+\.\d+[^/_]*)(?:_[^/]*)?\/$/.exec(source.slice(0, at))?.[1] ?? '');
    } else if (folder) named.set(`@scalar/${folder}`, undefined);
    else if (!source.startsWith('../../src/')) unplaced.push(source);
  }
  return { named, unplaced };
}

const byName = (a: Package, b: Package) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/**
 * The packages the script passes on, and what keeps the notice from being whole. Every package the source map names is
 * listed as bundled, once, at the version it names: the installed copy at that version; else, for a version that
 * declares the installed copy's licence (VIEWER_VERSIONS), the installed copy's licence files, saying so; else the kept
 * text of VIEWER_BUILT_IN. The runtime dependencies the map does not name stay carried, as every build's notices carry
 * them. `problems` names what the notice leaves out or cannot vouch for.
 */
export function viewerPackages(
  script: string,
  kept: Kept = {},
): { bundled: Package[]; carried: Package[]; problems: string[] } {
  const root = packageRoot(script);
  if (!root) throw new Error(`The viewer's script ${script} is not inside an installed package.`);
  const found = collect([root], kept);
  const problems = found.unread.map(folder => `no named package.json for ${folder}`);
  const installed = new Map<string, Package[]>();
  for (const p of [...found.bundled, ...found.carried]) installed.set(p.name, [...(installed.get(p.name) ?? []), p]);
  // Scalar's package itself, the one root the walk began from.
  const bundled = new Map(found.bundled.map(p => [p.name, p]));
  const { named, unplaced } = scriptPackages(script);
  problems.push(...unplaced.map(source => `the script's file ${source} is no package's that the notices can name`));
  for (const [name, version] of named) {
    const copies = installed.get(name) ?? [];
    if (version === undefined) {
      // Scalar's own packages are built at the versions Scalar's package names exactly, which Clew installs.
      if (copies.length === 1) bundled.set(name, copies[0]!);
      else
        problems.push(`${name}, built into the script from Scalar's repository, is installed ${copies.length} times`);
      continue;
    }
    const same = copies.find(p => p.version === version);
    const builtIn = VIEWER_BUILT_IN.find(p => p.name === name && p.version === version);
    const declared = VIEWER_VERSIONS[`${name}@${version}`];
    const alike = copies.find(p => p.license === declared);
    if (same) bundled.set(name, same);
    else if (builtIn) bundled.set(name, keptPackage(builtIn, kept.base));
    else if (alike)
      bundled.set(name, {
        ...alike,
        version,
        notices: alike.notices.map(n => ({
          file: `${n.file} (of ${alike.version}, which Clew installs: ${version} declares the same licence, ${declared})`,
          text: n.text,
        })),
      });
    else
      problems.push(
        `${name} ${version || '(no version)'} is in the script, and ${copies.length ? `Clew installs ${copies.map(p => p.version).join(', ')}` : 'Clew does not install it'}: check its licence with \`npm view ${name}@${version} license\` and record it in VIEWER_VERSIONS, or keep its text in licences/ and name it in VIEWER_BUILT_IN (packages/notices/src/viewer.ts)`,
      );
  }
  // Every installed copy of a package the map names gives way to the one the script holds.
  const result = {
    bundled: [...bundled.values()].sort(byName),
    carried: found.carried.filter(p => !bundled.has(p.name)),
  };
  problems.push(...unnoticed(result).map(p => `${p} has no licence file and no kept text`));
  return { ...result, problems };
}

export type Log = (message: string, ...details: unknown[]) => void;
/** The notices as the server answers with them: the text, or why it could not be read. */
export type Served = { text: string } | { failure: string };

/**
 * The viewer's notices as the server serves them, read on the first call and kept, a failure as well: reading walks
 * the install and the script's source map, which no request should repeat. Incomplete notices are logged as an error
 * and served with a section that says what they leave out, never silently short; a failure is logged once.
 */
export function servedViewerNotices(script: string, log: Log): () => Served {
  let served: Served | undefined;
  const read = (): Served => {
    try {
      const found = viewerPackages(script);
      if (!found.problems.length) return { text: noticesText(found) };
      log("the connector protocol viewer's third-party notices are incomplete", found.problems);
      const rule = '='.repeat(72);
      return {
        text: [noticesText(found), rule, 'These notices are incomplete', rule, '', ...found.problems, ''].join('\n'),
      };
    } catch (error) {
      log("the connector protocol viewer's third-party notices could not be read", error);
      return { failure: 'The third-party notices could not be read.' };
    }
  };
  return () => (served ??= read());
}
