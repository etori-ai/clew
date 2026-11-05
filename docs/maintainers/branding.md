# Installation branding

For operators customizing the installation. Connector authors declare semantic views and do not control the theme.

## Municipal branding

Copy `apps/web/.env.example` to `apps/web/.env.local` to choose an installation profile. Components
remain Astryx; colours and the header logo come from one resolved profile, used on every screen.

| `VITE_BRAND_PROFILE` | Colours | Default logo |
|---|---|---|
| `neutral` (default) | Astryx Neutral | None |
| `sundsvall` | Published Sundsvall palette, Vattjom dark blue accent | Original black/white Sundsvall dragon |
| `custom` | Own strong and pale accent colours over the shared Neutral base | None |

For another municipality, place its original image in `apps/web/public/branding/` and configure:

```dotenv
VITE_BRAND_PROFILE=custom
VITE_BRAND_ACCENT="#5b1f78"
VITE_BRAND_ACCENT_MUTED="#d7dbf2"
VITE_HEADER_LOGO_SRC=/branding/my-municipality.svg
VITE_HEADER_LOGO_ALT=Kommunens namn
# Optional original variant for dark mode:
# VITE_HEADER_LOGO_DARK_SRC=/branding/my-municipality-white.svg
```

Quote hex values: an unquoted `#` starts a dotenv comment. Custom colours must be six-digit hex.
Vite rejects colours below 4.5:1 for white on the strong accent or dark-grey text on the pale accent,
and below 3:1 between the two accents. This validates the configured pairs; browser and screen-reader
checks are still needed for the actual components and states. `neutral` and `custom` never inherit
Sundsvall's logo. An explicit logo override works with any profile.

SVG, PNG and other browser-supported images keep their proportions inside a 20 × 20 contain box
with token-based clearance in the rail and mobile heading. The path must be on the installation's own origin, starting with a single
`/`; `public` is not part of the URL. Set both logo values empty to omit the image:

```dotenv
VITE_HEADER_LOGO_SRC=
VITE_HEADER_LOGO_ALT=
```

All values are public and embedded at build time. Restart Vite after local changes, or rebuild a
deployed frontend with the new configuration. A missing image leaves the text and home link available.

The Sundsvall theme follows the published [colours](https://sundsvall.se/kommun/kommun-och-politik/press--och-informationsmaterial/grafisk-profil/farger)
and [logo guidance](https://sundsvall.se/kommun/kommun-och-politik/press--och-informationsmaterial/grafisk-profil/logotyp):
white text on strong fills, black text on pale fills, and the original black/white dragon with
clearance on a light/dark header. Astryx keeps typography, component behaviour, warning/error semantics
and the shared keyboard focus clearance. The account row › Inställningar offers light and dark mode, saved
as a local display preference. A logo without a dark variant keeps a white clearance area in dark mode. The palette and validation
are owned by `packages/ui/src/branding.ts`; token mappings by `packages/ui/src/theme.ts`.
Asset provenance is in [`apps/web/public/branding/README.md`](../../apps/web/public/branding/README.md);
the decisions are [D37](../decisions/D37-header-logo-is-installation-branding.md) and
[D38](../decisions/D38-municipal-branding-uses-astryx-themes.md), extended by
[D39](../decisions/D39-compact-header-profile-and-reminders.md). The [Neutral default decision](../decisions/D46-astryx-neutral-is-the-default-theme.md) records the current default and the remaining contrast work if an installation switches back to Sundsvall.

The browser suite uses its own Vite configuration (`tests/a11y/vite.config.ts`): no installation
environment files, explicit replacements for all six branding inputs, and separate test output per
profile. The ordinary suite selects the Neutral fixture. To check another fixture on this Mac:

```sh
CLEW_A11Y_BRAND_PROFILE=custom sh scripts/a11y.sh branding.spec.ts
```

The supported fixture names are `sundsvall`, `neutral` and `custom`. The custom fixture uses a test
image fulfilled by Playwright; it adds no production asset. CI runs the full suite on Neutral,
then the Sundsvall and custom branding scenarios sequentially, with one worker. Reports are kept in
`playwright-report/<profile>` and artifacts in `test-results/<profile>`; test bundles use
`test-results/apps/<profile>` and never replace the installation's `dist`.

The focused Vite configuration contracts live in `apps/web/tests/branding-config.test.ts`, next to
the app that owns the Vite dependency, and run with the existing `bun run test` command. They package
only the small branding entry and verify that conflicting environment variables and a local env file
cannot change the fixture's browser output.

The shared navigation places the reminder bell beside the logo and product name. The account is the
rail's last row, with an account icon and the person's full session name. Reminders reuse active thread
reminders and link to their cards; start/calendar shortcuts are always available. Read/unread rules
and additional notification kinds remain open. The account row expands to Inställningar, which shows
identity/unit and controls appearance, and Logga ut, which uses the existing session flow. Administration expands in the same rail; see [the navigation decision](../decisions/D45-administration-keeps-the-rail.md).
