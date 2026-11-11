# D106 · The documentation site is VitePress over `docs/` as it is, published to GitHub Pages

**Status:** provisional (product owner chose the generator, 2026-11-11; accepted when the site has been published from `main` and read there) · **Date:** 2026-11-11 · **Area:** platform

**Decision.** The documentation gets a static site, so that the decisions and the patterns can be searched and
read in order. Seven rules bind it.

1. **VitePress, in `site/`.** `vitepress` is pinned exactly in `site/package.json`, which has its own lockfile and
   is outside the Bun workspace. Nothing in `apps/`, `packages/` or `connectors/` depends on it, and its
   dependencies never enter the root lockfile.
2. **`docs/` is the only source.** Nothing is copied, no document carries front matter, and no document is
   written for the site. A page's title is its first heading and a folder's `README.md` is its index. What the
   documents need that VitePress does not do alone is done in `site/.vitepress/`: a link to something that is
   not a published page goes to the file on GitHub (`outside-links.ts`), a placeholder in angle brackets and
   double curly braces are shown as written (`as-written.ts`), and a `mermaid` block is drawn in the browser
   with its source as the fallback (`theme/Mermaid.vue`).
3. **Decisions are published; reviews and history are not.** Everything under `docs/` is on the site except
   `reviews/`, `history/`, `presentations/` and `decisions/TEMPLATE.md`. Links to those lead to GitHub.
4. **The sidebar is drawn from the folder** (`sidebar.ts`): a new document or decision appears without an edit in
   `site/`. Decisions are grouped as in `docs/decisions/in-force.md`: in force by area, then proposed, then
   superseded or withdrawn.
5. **A link that resolves to nothing fails the build.** `.github/workflows/pages.yml` builds on every pull
   request that touches `docs/` or `site/` and publishes from `main`.
6. **Search is the index built into the site.** No hosted search, no analytics, no account.
7. **The site is VitePress's own theme.** The Astryx rule binds the product's interface, not this site, and the
   site carries no installation's colours or logo.

How to build and publish it: `docs/maintainers/documentation-site.md`.

**Why.** Following 113 decision records and the documents around them as files had become hard; search and a
sidebar are what was missing. The generator was chosen for one property: it reads the 228 Markdown files as they
are. The alternatives weighed on 2026-11-11:

| Generator | Why not |
|---|---|
| Starlight 0.42.10 (Astro) | Every page needs a `title` in front matter, and one document has front matter today; it is before 1.0. It is the stronger choice on accessibility, and the one to revisit if the site must meet the product's own WCAG bar. |
| Nextra 4.6.1 | Tried on 2026-11-05 and removed: it needed a copy of `docs/`, a pinned `zod` and a build flag, and it reads Markdown as MDX. |
| Docusaurus 3.10.2 | MDX by default as well, and the heaviest of the four. |

Three things are known about the choice and accepted with it. VitePress's stable line has stood at 1.6.4 while
2.0 is in alpha. It compiles every page as a Vue template, which is why `as-written.ts` exists, and it builds
with `docs/` as Vite's root, which is why the configuration names Vue as an external package for the static
render. The default theme has not been tested against WCAG 2.2 AA; that requirement is stated for the product,
and nothing here claims it for the site.

One dependency of VitePress carries a licence the OSI has not approved (an icon data package under CC0-1.0); it
is in the licence record and among the open questions, and nothing from it is in the built site.

**Replaces.** No numbered decision. It changes the product owner's call of 2026-11-05 that decisions and reviews
stay off any public site: the repository has been made public since, so the records are readable there already,
and following them is what the site is for. Reviews and history stay off it as before.
