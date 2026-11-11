import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitepress';
import { asWritten } from './as-written';
import { mermaidBlocks } from './mermaid';
import { outsideLinks } from './outside-links';
import { navigation } from './sidebar';

/**
 * The documentation site: `docs/` as it is, built to static pages for GitHub Pages. Nothing is copied and no
 * document carries front matter; a page's title is its first heading and a folder's README.md is its index.
 */
const repoDir = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '');
const docsDir = `${repoDir}/docs`;
const branch = 'main';
// In GitHub Actions these come from the run, so a fork publishes links to itself and under its own path.
const repositoryUrl = `https://github.com/${process.env.GITHUB_REPOSITORY ?? 'etori-ai/clew'}`;
const base = (process.env.DOCS_BASE ?? '').replace(/\/?$/, '/');

/** Session notes and frozen history stay in the repository and off the site; links to them go to GitHub. */
const unpublished = ['reviews/', 'history/', 'presentations/', 'decisions/TEMPLATE.md'];
const isPage = (path: string) => !unpublished.some(entry => path === entry || path.startsWith(entry));

const { nav, sidebar } = navigation(docsDir, isPage);
// A text link, not the theme's brand icon: the icon data it would be read from is not under an OSI-approved licence.
nav.push({ text: 'GitHub', link: repositoryUrl });

export default defineConfig({
  lang: 'en',
  title: 'Clew',
  description: "An employee's work across systems in one workspace: product, architecture, connectors and decisions.",
  base,
  srcDir: '../docs',
  srcExclude: unpublished.map(entry => (entry.endsWith('/') ? `${entry}**` : entry)),
  rewrites: id => id.replace(/(^|\/)README\.md$/, '$1index.md'),
  // A link that resolves to nothing fails the build; the development addresses in the maintainer pages are not such links.
  ignoreDeadLinks: 'localhostLinks',
  markdown: {
    config: md => {
      outsideLinks(md, { docsDir, repoDir, repositoryUrl, branch, isPage });
      asWritten(md);
      mermaidBlocks(md);
    },
  },
  themeConfig: {
    nav,
    sidebar,
    outline: { level: [2, 3] },
    search: { provider: 'local' },
    editLink: { pattern: `${repositoryUrl}/blob/${branch}/docs/:path`, text: 'View this page on GitHub' },
  },
  vite: {
    // The documents live outside this folder, so the development server has to be allowed to read them.
    server: { fs: { allow: [repoDir] } },
    plugins: [
      {
        // VitePress builds with `docs/` as Vite's root, and no node_modules lies above it. The static render is
        // therefore told that a page's imports of Vue are the installed package, which Node then finds from here.
        // Mermaid draws in the browser only, so the static render leaves it out as well.
        name: 'clew-static-render-externals',
        config: (_, { isSsrBuild }) =>
          isSsrBuild
            ? { build: { rollupOptions: { external: ['vue', 'vue/server-renderer', 'mermaid'] } } }
            : undefined,
      },
    ],
  },
});
