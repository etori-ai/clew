# D87 · One header shared by the portal and the intranet, built with Astryx and embedded as a custom element

**Status:** proposed, built 2026-11-09 as an experiment in this repository, to move to its own repository if it holds ·
**Date:** 2026-11-09 · **Area:** ui

**Decision.** The top bar of Clew's portal and of the intranet (Sitevision, under `/intranat`) is one component,
`packages/site-header` (`@clew/site-header`), so a person moving between `/portal` and `/intranat` sees the same
header and cannot tell the two sites apart. The product owner asked for it on 2026-11-09 with the proof of concept at
https://start.sundsvall.dev/intranat/ as the reference ("Start" leads to `/portal`, the other items to the intranet's
sections), asked that the intranet's pages could be listed from Sitevision's API, and decided to build it with
Astryx here first and break it out to its own repository once it works as intended. The same day the product owner added
that parts of the intranet are public, so a visitor who is not signed in must get the pages Sitevision shows publicly,
and that the header must not be bound to Sitevision: another installation may list its pages from WordPress, and Clew
should only receive addresses and map them.

1. **One menu, as data.** `src/menu.ts`: `{ version: 1, site: { name, href }, items: [{ id, label, href, children? }] }`,
   checked by `parseSiteMenu` (a root-relative path or an http(s) address, nothing else; unique top-level ids). The
   header draws the top level. `children` is the listing of the pages under each item. `selectedItem` finds the
   current item from the page's address (longest same-origin parent path), and `withHref` lets a host point an item
   elsewhere (the portal's Start is its own root wherever it is served). `fixtures/site-menu.json` holds the proof of
   concept's five places.
2. **The React component** `SiteHeader` composes Astryx only: `TopNav` with `TopNavHeading` (the installation's logo,
   D37/D38's native image, and the site's name) and `TopNavItem` per place, and the host's own controls at the end.
   `SiteHeaderPerson` is the signed-in person for every host: avatar and name as a button (the avatar alone when
   compact) that opens the web app's own settings composition (D39), an Astryx `Dialog` with the colour choice as a
   `RadioList` (Samma som datorn, Ljust, Mörkt) and "Logga ut". It was a `DropdownMenu` first; Astryx's menu finds its
   focused row through `document.activeElement`, which inside a shadow root is the `<site-header>` element, so Enter
   and the arrow keys did nothing on the intranet, "Logga ut" included. The person is the host's to name: the header
   never asks who is signed in. Every link is a whole-page load (`as={PageLink}`), so no host's client-side router
   catches a link to the other site.
3. **The portal** (`apps/portal/src/shell.tsx`) puts `SiteHeader` in `AppShell`'s `topNav` with Start selected, the
   reminder bell and the person at the end. Clew's own places (Översikt, Mina aktiviteter, the menu's views, D40) move
   from the top bar to a `SideNav`, because the bar is the intranet's and identical on both sites; this amends D67
   item 1's shell. The menu is the fixture unless `VITE_SITE_MENU_SRC` names the file the intranet serves.
4. **The intranet** loads `dist/site-header.js` (`bun run build:site-header`, one ES module with React and Astryx inside)
   and writes `<site-header menu-src="…" source="sitevision" source-root="…" login-href="…">`, or `user-name` and `logout-href` for a
   signed-in visitor. The element renders into an **open shadow root**: Astryx's reset and component CSS and the
   installation's theme are adopted into it (`:root` and `html` rules rewritten to `:host`), so the intranet's CSS
   cannot restyle the header and Astryx cannot restyle the intranet. The theme is the portal's own `createClewTheme`
   over `resolveBranding`, imported from `@clew/ui/theme` and `@clew/ui/branding`, so both sites are drawn from the
   same tokens. Astryx's `Theme` gets the theme marked as built, which is how a pre-built theme skips Astryx's
   injection into the document head; that injection is scoped to `[data-astryx-theme]` and `Theme` also marks `<html>`
   with that attribute, so on the intranet it would have restyled the page. Only the font's `@font-face` goes into the
   document, because a font declared inside a shadow root is not loaded.
   **Colour** follows the person as the portal does: by default (`appearance="auto"`) the person's own choice from
   Clew (D39, `clew:color-mode` in the browser, now `APPEARANCE_PREFERENCE_KEY` in `@clew/ui/appearance-preference`),
   which on one domain is the same stored choice the portal reads, else the system's; it follows a change in another
   tab (`storage`) or in the system while the page is open. `light`, `dark` or `system` fix it. The host element
   carries the mode in `data-site-header-mode` and sets `color-scheme` from it, because Astryx's reset sets the scheme
   from `data-theme` on `<html>`, which never matches inside a shadow root, and `:host { all: initial }` clears it;
   without it every `light-dark()` token resolved light. When the mode changes the element adopts
   `* { transition: none !important; }` into its shadow root for one frame, because a colour under a CSS transition
   kept its old `light-dark()` value when only the scheme changed (Chrome, 2026-11-09; measured with and without);
   redrawing the header instead would have closed the settings dialog on every choice. The portal (light DOM, the
   web app's own Astryx) has no such step and may show the same held-over colours after a live switch; not checked. `SiteHeader` draws the logo's dark variant (`darkSrc`, `logo-dark-src`; Sundsvall's white
   dragon) on a dark bar, deciding by `useDarkSiteHeader` (the nearest `Theme`'s mode, and for `system` the media
   query, followed live, which Astryx's `useTheme` does not).
5. **Where the places come from is configuration, not code.** The header knows only the neutral menu. A content
   system is a *source*, an adapter in `src/sources/` behind one port (`MenuSource.list({ base, root, depth, init,
   nonce })` returning menu items); `src/sources/index.ts` is the only file that names them, and a host picks one by
   name (`source="sitevision"`, `source="wordpress"`, `--source` in the script). An adapter speaks its system's API and
   nothing else, and returns **absolute** addresses resolved against the system's public origin, so a menu read from
   the intranet is still right when the portal draws it on another host. The shared `walkTree` fetches the levels and
   `withListing` keeps the static menu's site name and `start` item and replaces the rest. A system that serves the
   menu JSON itself, per visitor, needs no adapter: `menu-src` alone.
   - *Sitevision*: `/rest-api/1/1/<node>/headless`, `sv:page` and `sv:structurePage` only, hidden pages left out. Each
     page has `URI`, its path, and `URL`, the absolute address; the path is preferred and resolved against the public
     origin, because `URL` is the address Sitevision knows itself by, which behind a proxy may not be the public one.
   - *WordPress*: `/wp-json/wp/v2/pages?parent=<id>` in menu order (`0` is the top level); `link` is absolute and
     `title.rendered` is HTML, reduced to text. WordPress takes a signed-in visitor's cookie only with its REST nonce,
     which the page passes as `source-nonce`. One page of 100 children per parent; `?rest_route=` sites not handled.
6. **Public and signed-in visitors.** Both APIs answer with what the caller may read, so the caller is the audience and
   an adapter adds no credential of its own. In the browser the element calls the source with the visitor's own
   session (`credentials: 'same-origin'`, or `'include'` when `source-base` names another origin, which then needs
   CORS with credentials there): an anonymous visitor gets the public sections, a signed-in one their own. The static
   menu is drawn until the listing arrives and if it fails, so the static file must be the public one.
   `scripts/site-menu.ts` writes that file and lists every page (`--list`), anonymously by default; `--as-user` with
   `SITE_MENU_USER` and `SITE_MENU_PASSWORD` (a Sitevision read user, a WordPress application password) lists that
   user's pages and warns that such a file must never be served to anonymous visitors. `selectedItem` treats
   `/organisation` and `/organisation/` as one page (WordPress writes the slash).
7. **Compact below `xl` (1 280 px).** Five places with the intranet's long names and the person need about 1 100 px on
   one line; at 1 024 px two items wrapped. `SITE_HEADER_BREAKPOINT` is passed to the portal's `AppShell` (whose own
   drawer then holds the bar's places and the `SideNav`) and used by the standalone header, which composes the
   `MobileNavBasicMobileNav` block: a "Meny" button and `MobileNav` with a `SideNavItem` per place.
8. **The development stand-in.** The portal's dev server (`packages/site-header/demo/plugin.ts`, `apply: 'serve'`)
   answers `/intranat/…` with a page of deliberately loud global CSS carrying the element, `/site-menu.json` with the
   public part of the fixture, `/rest-api/1/1/<id>/headless` and `/wp-json/wp/v2/pages` from
   `fixtures/sitevision-tree.json` (invented demo pages, two sections not public; `/intranat/?source=wordpress` reads
   them through the WordPress source), and the visitor as an intranet with single sign-on would know them: the person
   signed in to Clew, read from the BFF's `/api/auth/session` with the visitor's cookie (their name, their sections;
   `/intranat/logga-ut` ends that session through the BFF's own sign-out with the session's CSRF token, as an
   intranet's sign-out ends the shared one, and accepts only a same-site request), else a demo cookie's invented person
   (`/intranat/logga-in`, `/intranat/logga-ut`) for the WCAG suite, which runs no Clew server, and
   `/shared/site-header/*.js` from the build (`/intranat/?built`). Both sites are then the portal's origin, as they are
   one domain in production.

**Checks.** `tests/unit/site-header.test.ts` (menu parsing and safety, current item, the source registry, absolute
addresses, the tree walker, both adapters' mappings, the audience and WordPress's nonce); `tests/a11y/site-header.spec.ts`
on the stand-in (the public and signed-in menus, the same header from the WordPress source, dark mode by the system
and by Clew's stored choice with the white logo and axe's contrast, the current item,
the host's font kept out, axe, 320 px reflow, the drawer by keyboard and Escape back to its button), with a second web
server in `tests/a11y/playwright.config.ts`. The portal stays outside the WCAG suite (D67 item 7).

**Who is signed in** is the host's to say, never the header's: the portal passes Clew's session (`user.name`), a
Sitevision page template the visitor's display name and its own sign-out address, a WordPress theme the current
user's display name, sign-out address and REST nonce (`source-nonce`); an anonymous visitor gets `login-href`. The
same person on both sides therefore needs both sites to sign in through the same identity provider; that is an
operations requirement, not something the header can supply. Asking Clew's session from the header was weighed and
left: it would make the intranet depend on Clew to show who is there, and show a person signed in to the intranet but
not to Clew as anonymous.

**Not verified and open.** Neither adapter has been run against a live installation: Sitevision's endpoint follows
developer.sitevision.se and WordPress's the REST API reference as read on 2026-11-09. Whether the API is open to
anonymous callers is each site's setting. In production the source's API (`/rest-api/`, `/wp-json/`) must be reachable
on the domain the header is drawn on, or `source-base` points at it with CORS. A signed-in visitor first sees
the public menu and then their own (no cache yet). The portal's header was not compared side by side with a signed-in
session in this build (the development sign-in host is outside what the build session may type credentials into). An
overflow menu (TopNav's anatomy names a "More menu") would suit section names that vary better than a fixed breakpoint.
The bundle is about 193 kB gzipped. Breaking out to its own repository means taking the theme (`createClewTheme`,
`resolveBranding`, the Swedish catalogue) with it or publishing it from `@clew/ui`.

**Astryx gaps** (recorded, not styled around): a standalone `TopNav` has no compact mode of its own (that is
`AppShell`'s, which also renders `main`, so it cannot wrap a header on someone else's page); `TopNavMegaMenu` has no
selected state, so the sections' subpages are listed in the data but not drawn as mega menus, which would have lost
`aria-current` on the current section; Astryx has no built stylesheet for a custom runtime theme, so the element
generates it with `generateThemeCSS`. The stylesheets the element adds itself are the boundary (`:host { all: initial; display:
block; }` and the `color-scheme` from `data-site-header-mode`) and the one-frame `transition: none` when the mode
changes; they style no component. `DropdownMenu` is not usable by keyboard inside a shadow root (see item 2).

**Why.** The alternatives weighed in conversation with the product owner:

- **The same design built twice with shared tokens** (Astryx in the portal, the intranet's own templates) keeps
  Clew's rules untouched but drifts, and drift is what gives the trick away.
- **An HTML fragment from a header service, included by both** gives one source but needs server-side includes on
  both sides and a second rendering of the same thing outside Astryx.
- **A light-DOM custom element** lets the intranet's global CSS win over Astryx's layered CSS (unlayered rules beat
  every layer) and lets Astryx's reset and theme reach the intranet's page.

A custom element in a shadow root with Astryx inside is one implementation and one set of tokens on both sites, and
the boundary goes both ways. Building it here first keeps the theme and the portal beside it while the idea is tried.

**Replaces.** Amends D67 item 1 (the portal's top bar held Clew's places; they are now the `SideNav`) and item 2 (the
intranet's sections are drawn, by the intranet's own header, not by Clew). D37/D38 stand for the logo and the profile.
