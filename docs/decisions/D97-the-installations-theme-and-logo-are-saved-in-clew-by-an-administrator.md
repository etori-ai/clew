# D97 · The installation's theme and logo are saved in Clew by an administrator, the theme as a design tokens file

**Status:** accepted, built 2026-11-10; no signed-in pass against the development identity provider and no manual screen-reader pass yet · **Date:** 2026-11-10 · **Area:** ui

**Decision.** An installation's colours and its header logo are data in Clew's own PostgreSQL, changed on
Administration › Utseende by a person with the grant capability `admin.appearance`, and read by every browser from
`GET /api/appearance` before anyone has signed in. Nothing about them is in the build: `VITE_BRAND_PROFILE`,
`VITE_BRAND_ACCENT`, `VITE_BRAND_ACCENT_MUTED` and the three `VITE_HEADER_LOGO_*` variables are removed, and so are
the `sundsvall` and `custom` profiles as code. An installation nobody has configured is Astryx Neutral with no logo
(D46 stands).

1. **A theme is a file.** The format is the Design Tokens Community Group's Format Module 2025.10 (`.tokens.json`,
   checked against the specification on 2026-11-10). Clew reads two groups, `light.color` and `dark.color`, whose token
   names are Astryx's semantic colour tokens without the `--color-` prefix (`accent`, `background-surface`,
   `text-primary`, …). Any other group is the file's own, typically a palette, and may be referenced as
   `{palette.blue}`. A value is six-digit hex or a DTCG sRGB colour object without transparency. A token set in one
   appearance is set in both. `packages/contracts/src/theme-file.ts` owns the closed token list, the parser, the
   serialiser and the JSON Schema published as `docs/protocol/theme-file.schema.json`.
2. **A theme carries colour and nothing else.** Typography, sizes, motion, component overrides, the coarse-pointer
   adaptation and the tokens that carry an error or a warning (and the red and yellow families behind them) are
   Clew's base theme and are not in the list, so a file cannot change behaviour or what a status colour means (D38).
3. **Contrast decides.** A file is refused unless the theme it would make holds every pair in `THEME_CONTRAST_PAIRS`
   in both appearances: 4.5:1 for text on the surfaces and on the accent, info and success fills, 3:1 for the accent,
   the focus ring, icons and a progress bar's fill on its track (the text colour on `track`, D71 item 5 as amended). A colour the file leaves alone is the base theme's, from `THEME_BASE_COLORS`, a table a
   unit test holds to the theme as Astryx resolves it. Every problem is named at once, in Swedish.
4. **One check, two places.** The page reads and checks a file in the browser with the same functions, shows it in
   both appearances inside nested Astryx `Theme`s, and saves only what holds. The server checks again and is the one
   that decides. Two colours instead of a file make the same kind of theme through `themeFromAccent`, the mapping the
   `custom` profile drew.
5. **The logo is stored, not addressed.** A PNG or an SVG of at most 256 kB, an optional variant for dark ground and
   a required accessible name. Clew serves it from `/api/appearance/logo/:variant` on its own origin. An SVG that
   carries script, event attributes, foreign content, a document type or a reference out of the file is refused whole
   (`modules/appearance/domain.ts`); the route also serves it under `Content-Security-Policy: default-src 'none'; …
   sandbox`, and the header draws it through `img`, where an SVG cannot run. The header connector's logo still wins
   when a connector gives one (D88).
6. **Module and audit.** `apps/server/src/modules/appearance/` is a core module with a port and two adapters (D20,
   D25). Every change needs `admin.appearance` and the step-up `authorize()` and writes its audit row in the same
   transaction: `appearance.theme.set`, `appearance.theme.cleared`, `appearance.logo.set`, `appearance.logo.cleared`,
   subject `installation:appearance`. An audit row names the theme and an image's type and size, never the file or
   the image. One row, `installation_appearance`; its `revision` rises with every save.
7. **The browser.** `apps/web/src/branding.ts` reads the appearance before the first render, keeps a copy in
   `localStorage` so the next visit starts in the right colours, and re-reads it through `readBranding`, which drops
   anything that is not a known token in hex or a same-origin logo path. A save on Utseende redraws the whole app
   without a reload. `createClewTheme` builds one Astryx theme per set of colours.
8. **The embedded header.** `<site-header>` takes `appearance-src` (the installation's `/api/appearance`, which any
   origin may read) in place of `profile`; without it the element is Neutral. `logo-src`, `logo-dark-src` and
   `logo-alt` remain for a page that names its own logo.
9. **Sundsvall is an example folder.** `themes/sundsvall/theme.tokens.json` carries the published palette and D38's
   mapping, as an ordinary theme file with its palette as references, and `themes/sundsvall/appearance.json` names it
   together with the logo. The dragon stays in `apps/web/public/branding/` for the development intranet fixture, and
   the example points there; an installation uploads its own originals.
10. **The command line makes the same changes.** `bun scripts/appearance-set.ts <folder>` saves the theme and logo an
    example folder names, `--reset` goes back to Neutral and `--show` reads. It runs where the database is, as
    `scripts/connector-add.ts` does (D23), through the use cases' `operator` side: the same checks of the file and the
    images, the same audit rows, `bootstrap:appearance` as the actor, and no route that reaches it.

No first-run wizard. People enter only through SCIM and the first administrator gets a capability from a
`capability:` group (D68, D85), so at first start there is nobody to answer one; the page is where it is chosen.

**Astryx gaps, recorded here and not filed.** Astryx 0.7.12 documents `defineTheme` and palette generation but no
import of a standard token file, so the mapping from file to `defineTheme` tokens is Clew's. It has no colour input,
so a colour is typed as hex in a `TextInput`. It still has no general image component (D37), so Utseende shows no
picture of the stored logo: the header, where it is used, is where it is seen.

**Why.** The product owner asked for the logo and the theme to be chosen from administration at first start and for
a theme that can be uploaded in a standard form and draw everything. A build variable makes a municipality that runs
a ready image rebuild it to change a logo; D23 gave the same reasons for moving connectors out of the environment:
the person who decides is a systemförvaltare with a browser, a change needs no restart, and it leaves an audit trail.
Keeping the environment as a second source was dropped for D23's reason, two sources of truth for one value. Palette
generation (`generateTonalPalette`) was weighed for the two-colour path and left out: it lives in
`@astryxdesign/cli`, which would become a run-time dependency of the server, and its output is a candidate Astryx
itself says makes no accessibility claim, while D38 chose explicit published colours over generated ones.

**Replaces.** D37's "no tenant database, upload service or administration page" and its build variables; D38's
profile contract in `packages/ui/src/branding.ts` and `VITE_BRAND_PROFILE` (its Astryx-themes rule, its colour
mapping and its status-colour rule stand); the part of D46 that names `VITE_BRAND_PROFILE=sundsvall` as the way
back, which is now uploading `themes/sundsvall/theme.tokens.json`. The closed list of D85 gains `admin.appearance`.
