import { existsSync, statSync } from 'node:fs';
import { basename, dirname, relative, resolve, sep } from 'node:path';

/** The part of markdown-it this rule touches; the site does not depend on markdown-it's types. */
type Token = {
  type: string;
  children: Token[] | null;
  attrGet(name: string): string | null;
  attrSet(name: string, value: string): void;
};
type Markdown = {
  core: { ruler: { push(name: string, rule: (state: { tokens: Token[]; env: { path?: string } }) => void): void } };
};

export type OutsideLinks = {
  /** Absolute path of `docs/`, the folder the site is built from. */
  docsDir: string;
  /** Absolute path of the repository root. */
  repoDir: string;
  /** `https://github.com/<owner>/<name>`. */
  repositoryUrl: string;
  branch: string;
  /** Whether a Markdown file under `docs/` (path relative to it) becomes a page of the site. */
  isPage(path: string): boolean;
};

const inside = (directory: string, path: string) => path === directory || path.startsWith(directory + sep);

/**
 * The documents link to each other and to the code as files in the repository. On the site a link to a published
 * page stays a page link (a folder's README.md is that folder's index), and every other link that resolves to
 * something in the repository (code, a schema, a review that is not published) goes to the file on GitHub. A link
 * that resolves to nothing is left alone, so the build's dead-link check reports it.
 */
export function outsideLinks(md: Markdown, options: OutsideLinks) {
  md.core.ruler.push('clew-outside-links', state => {
    const file = state.env.path;
    if (!file) return;
    for (const block of state.tokens) {
      for (const token of block.children ?? []) {
        if (token.type !== 'link_open') continue;
        const href = token.attrGet('href');
        if (!href || /^([a-z][a-z0-9+.-]*:|#|\/)/i.test(href)) continue;
        const [, path = '', suffix = ''] = href.match(/^([^?#]*)(.*)$/) ?? [];
        if (!path) continue;
        const target = resolve(dirname(file), decodeURI(path));
        if (!inside(options.repoDir, target) || !existsSync(target)) continue;
        const directory = statSync(target).isDirectory();
        const page =
          !directory &&
          target.endsWith('.md') &&
          inside(options.docsDir, target) &&
          options.isPage(relative(options.docsDir, target).split(sep).join('/'));
        if (page) {
          if (basename(target) === 'README.md') token.attrSet('href', path.replace(/README\.md$/, 'index.md') + suffix);
          continue;
        }
        const repositoryPath = relative(options.repoDir, target).split(sep).map(encodeURIComponent).join('/');
        token.attrSet(
          'href',
          `${options.repositoryUrl}/${directory ? 'tree' : 'blob'}/${options.branch}/${repositoryPath}${suffix}`,
        );
      }
    }
  });
}
