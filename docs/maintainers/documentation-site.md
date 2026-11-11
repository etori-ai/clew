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

## Swedish pages

The documentation is English. A page whose readers are outside the team may also have a Swedish translation
(D106 item 8), at the same path under `docs/sv/`: `docs/guides/provisioning-for-operations.md` is translated by
`docs/sv/guides/provisioning-for-operations.md`. [docs/sv/README.md](../sv/README.md) lists them.

- The English page is the source. Change both in the same change; `docs:check` fails on a Swedish page with no
  English page at its path, or whose headings are not the same in number and level.
- Each of the two pages links to the other in its first line. The language menu of the site leads to the other
  language's index, because almost no page has a translation to lead to.
- On the site `sv` is a locale ([config.ts](../../site/.vitepress/config.ts)): the page says it is Swedish, the
  theme's own words are Swedish and the search finds Swedish pages only. A new folder under `docs/sv/` gets its
  Swedish name in [sidebar.ts](../../site/.vitepress/sidebar.ts).
- Do not link to a heading that has å, ä or ö in it. GitHub keeps the letter in the heading's address and the
  site writes it without its dots, so such a link works in one of the two places. Give a section that is linked
  to a heading without them.

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
