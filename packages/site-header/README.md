# Shared header (`@clew/site-header`)

One header for Clew's web app and the intranet, so a person moving between Startsidan and `/intranat` sees the same
bar ([D87](../../docs/decisions/D87-one-header-shared-by-the-portal-and-the-intranet.md),
[D88](../../docs/decisions/D88-the-web-app-draws-the-shared-header-and-an-administrator-owns-its-content.md)). In the
web app the header's content comes from the connector whose manifest declares a `header` capability, served to the
signed-in person at `/api/header`; the intranet's embed reads its own menu as described below. An experiment in Clew's
repository, meant to move to its own repository.

## On a page Clew does not render (the intranet)

```bash
bun run build:site-header   # writes packages/site-header/dist/
```

Serve `dist/` (all files: the entry loads its chunks by relative path) and put this in the page template:

```html
<script type="module" src="/shared/site-header/site-header.js"></script>
<site-header
  menu-src="/shared/site-menu.json"
  source="sitevision"
  source-root="4.1a2b3c"
  login-href="/intranat/login"
></site-header>
```

| Attribute                         | Meaning                                                                                                                                                                                                     |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `menu-src`                        | The static menu (JSON, see `fixtures/site-menu.json`). Served to everyone, so it must be the public one. An inline `<script type="application/json">` child is read instead when present.                   |
| `source`                          | Which content system lists the places: `sitevision` or `wordpress` (`src/sources/index.ts`). Without it the static menu is all there is.                                                                    |
| `source-root`                     | The start page's id in that system: a Sitevision node id, a WordPress page id (`0` for the top level). The element asks the system's API, with the visitor's own session, which pages this visitor may see. |
| `source-depth`                    | Levels fetched under the root, 1 to 3 (default 1; the bar draws one).                                                                                                                                       |
| `source-base`                     | The system's origin when it is not the page's own (then it needs CORS with credentials).                                                                                                                    |
| `source-nonce`                    | WordPress's REST nonce (`wp_create_nonce('wp_rest')`), without which WordPress treats a signed-in visitor as anonymous.                                                                                     |
| `selected`                        | The current item's id. Without it the page's address decides.                                                                                                                                               |
| `login-href`                      | "Logga in" for a visitor who is not signed in.                                                                                                                                                              |
| `user-name`, `logout-href` | The signed-in person, as the page's own system knows them (with single sign-on, the same person Clew knows), and where "Logga ut" goes. The header never asks who is signed in. |
| `help-href` | Where "Hjälp" in the signed-in person's dialog leads: Startsidan with its help open, `https://<startsidan>/?open=clew.help&open-title=Så%20fungerar%20Startsidan` (D97). Without it the dialog has no such row. |
| `profile`, `logo-src`, `logo-dark-src`, `logo-alt` | The branding profile (`sundsvall` default), the logo and its variant for a dark bar. |
| `appearance` | `auto` (default): the person's colour choice from Clew, stored in the browser for the domain, else the system's; the signed-in person can change it in their settings. `light`, `dark` or `system` fix it. |

The header renders in a shadow root: the page's CSS does not reach it and its CSS does not reach the page.

## In a React app with Astryx (the web app)

```tsx
import { SITE_HEADER_BREAKPOINT, SiteHeader, SiteHeaderPerson } from '@clew/site-header';

<SiteHeader
  menu={menu}
  selected="start"
  logo={branding.logo}
  end={<SiteHeaderPerson name={name} onSignOut={signOut} />}
/>;
```

Give `AppShell` `mobileNav={{ breakpoint: SITE_HEADER_BREAKPOINT }}` so both sites turn compact at the same width.

## Sources: Sitevision, WordPress, or your own

The header only knows its menu JSON. A content system is a source in `src/sources/`: an adapter that reads the
system's own API and returns pages with absolute addresses. Adding a system is one file there and one line in
`src/sources/index.ts`. A system that can serve the menu JSON itself, per visitor, needs no adapter: give `menu-src`
alone.

Sitevision returns both a page's path (`URI`) and its absolute address (`URL`); the adapter uses the path resolved on
the public origin, since `URL` may be an internal host behind a proxy. WordPress returns an absolute `link`.

```bash
bun packages/site-header/scripts/site-menu.ts --source sitevision --base https://intranet.example.org \
  --root 4.1a2b3c --start-href / --out site-menu.json   # the public menu: no credentials are sent
bun packages/site-header/scripts/site-menu.ts --source wordpress --base https://intranet.example.org \
  --root 0 --depth 3 --list                                     # every page and its address
```

`--as-user` reads `SITE_MENU_USER` and `SITE_MENU_PASSWORD` (a Sitevision read user, a WordPress application password)
and lists that user's pages; such a file names pages that are not public and must not be served to anonymous visitors.

## Trying it locally

`bun run dev`, then open `/intranat/` on the web app's address (3020): a stand-in intranet page with the element,
deliberately loud CSS and two sections that are not public. Signed in to Clew, it shows you and your sections, as an
intranet with single sign-on would; without a Clew server, `/intranat/logga-in` sets a demo cookie instead.
`/intranat/?source=wordpress` reads the same pages through the WordPress source, and `/intranat/?built` loads the
production bundle instead of the source code.
