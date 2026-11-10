# D38 · Municipal branding uses Astryx themes

**Status:** accepted, extended by [D39](D39-compact-header-profile-and-reminders.md), default profile changed by [D46](D46-astryx-neutral-is-the-default-theme.md); the profile contract and `VITE_BRAND_PROFILE` superseded by [D97](D97-the-installations-theme-and-logo-are-saved-in-clew-by-an-administrator.md) (2026-11-10): a theme is an uploaded file, and Sundsvall's mapping is `themes/sundsvall/theme.tokens.json` · **Date:** 2026-11-05 · **Area:** ui

**Decision.** Keep Astryx as the component system. Extend the existing Neutral-based theme in
`packages/ui/src/theme.ts`; the shared ChatLayout focus-clearance override from D31 remains in every
profile. `packages/ui/src/branding.ts` owns the profile contract, official palette, logo defaults and
configuration validation. The web layer
only reads public build variables and passes the resolved branding to the existing providers/shell.

`VITE_BRAND_PROFILE` selects `sundsvall` (default), `neutral` or `custom`. Sundsvall supplies the
official original dragon and the published palette, with Vattjom dark as the primary accent. Neutral
inherits Astryx Neutral; custom inherits it with explicit strong/muted accent colours. Neither
neutral nor custom inherits Sundsvall's logo. Existing explicit logo/alt overrides remain available.
Custom colours must be six-digit hex and pass contrast checks before Vite starts/builds: white on
the strong accent and dark-grey secondary text on the pale accent each need 4.5:1, and the two
accent colours need 3:1. Invalid profile names or partially configured colours fail explicitly,
rather than selecting a different brand.

Sundsvall maps its published colours to Astryx semantic tokens: white on strong primary fills, black
on pale fills, black primary text and dark-grey secondary text. Colour-bearing blue/green/purple/pink
roles use the corresponding published primary/complement pairs. Astryx warning/error colours retain
their status meaning. Typography, motion, radii, layout and component behaviour remain Astryx's.
D39 adds light/dark appearance using only the same published colour pairs.

**Logo clearance.** The original dragon remains unmodified, with its aspect ratio preserved. D37's native image exception also permits token-based padding and content-box sizing:
a 20 × 20 contain box with 12 px padding leaves at least the symbol's rendered width around it,
following the official clear-space illustration. This is image clearance inside the existing navigation icon
slot; no shell CSS or custom layout component. Other logos use the same protected area and may
include further clearance in their original asset.

**Why.** The product owner explicitly requires Sundsvall's symbol/colours while allowing other
municipalities to reuse the repository, and authorises Astryx rather than Sundsvall's component library.
Astryx 0.7.7 documents `defineTheme({ extends, tokens })` for precisely this change. Explicit tokens
preserve the published colours instead of generating approximate brand shades. One resolved profile
keeps the logo and theme together, including the logged-out and session-ended screens.

Sources checked 2026-11-05:

- [Sundsvall colours and contrast guidance](https://sundsvall.se/kommun/kommun-och-politik/press--och-informationsmaterial/grafisk-profil/farger).
- [Sundsvall logo, original files and clearance](https://sundsvall.se/kommun/kommun-och-politik/press--och-informationsmaterial/grafisk-profil/logotyp).
- [Clear-space illustration](https://sundsvall.se/images/18.235b114b198e57425bc5b302/1674553584583/Logotyp%20frizon%202023.PNG).
- Installed Astryx CLI: `docs theme`, `docs author-a-theme`, `docs use-a-theme`, `docs color`,
  `docs tokens/tokens-focus` and `component SideNavHeading`.

**Replaces.** Supersedes D34 item 7 (plain Neutral only) with the product owner’s configurable
municipal profile requirement. Extends D31's theme policy and D37's logo configuration: the logo default now belongs to
the selected profile rather than every installation. No persisted-data compatibility path is needed.
