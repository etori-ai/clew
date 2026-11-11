# Documentation site

The documentation site is `docs/` built to static pages and published to GitHub Pages
([D106](../decisions/D106-the-documentation-site-is-vitepress-over-docs-as-it-is.md)). The Markdown files in the
repository stay the only source: nothing is copied, no document carries front matter and none is written for the
site. The generator is VitePress, in [site/](../../site), with its own `package.json` and lockfile outside the Bun
workspace.

## What is published

Everything under `docs/` except `reviews/`, `history/`, `presentations/` and the decision template. Those stay in
the repository; a link to one of them leads to the file on GitHub.

## How a document becomes a page

| In the repository | On the site | Where |
|---|---|---|
| The first `#` heading | The page title and its label in the sidebar | [sidebar.ts](../../site/.vitepress/sidebar.ts) |
| A folder's `README.md` | That folder's index page | [config.ts](../../site/.vitepress/config.ts) |
| The order in which a folder's `README.md` links to its documents | The order in the sidebar; documents it does not link to follow in alphabetical order | [sidebar.ts](../../site/.vitepress/sidebar.ts) |
| A decision's status and area | Its group in the decision sidebar, the same grouping as [decisions in force](../decisions/in-force.md) | [sidebar.ts](../../site/.vitepress/sidebar.ts) |
| A link to another published document | A link to that page | VitePress |
| A link to code, a schema, a review or anything else in the repository | A link to the file on GitHub | [outside-links.ts](../../site/.vitepress/outside-links.ts) |
| A placeholder in angle brackets or double curly braces | The text as written | [as-written.ts](../../site/.vitepress/as-written.ts) |
| A `mermaid` code block | The drawn diagram; its source where scripts do not run | [Mermaid.vue](../../site/.vitepress/theme/Mermaid.vue) |

A new document or decision appears on the site without editing anything in `site/`. A new top-level folder under
`docs/` needs a section in [sidebar.ts](../../site/.vitepress/sidebar.ts).

## Build and look at it

```sh
docker exec -w /workspace clew-app-1 bun run docs:site
python3 -m http.server 4173 --bind 127.0.0.1 --directory site/.vitepress/dist
```

The first command installs the site's own dependencies from its lockfile and builds into `site/.vitepress/dist`.
The second runs on the host and serves the result on port 4173; any static file server will do. The build fails
on a link that resolves to nothing, which `docs:check` also reports, and on a page that VitePress cannot compile,
which `docs:check` does not.

## Publishing

The [site workflow](../../.github/workflows/pages.yml) builds on every pull request that touches `docs/` or `site/`
and publishes from `main`. GitHub Pages has to be enabled once for the repository, with GitHub Actions as its
source (Settings › Pages). The workflow reads the path the site is served under and the repository's name from
the run, so a fork publishes under its own address and links to its own files.

Search is an index built into the site. There is no hosted search service and no analytics.

## Upgrading

Pin exact versions in [site/package.json](../../site/package.json), run `bun install` in `site/`, and record the
licence check in the [licence record](../reference/licences.md). The site's dependencies never enter the root
lockfile.
