# D46 · Astryx Neutral is the default theme; Sundsvall is a profile to opt into

**Status:** accepted; Neutral is still the default, and "Switching back" is now an upload of `themes/sundsvall/theme.tokens.json` on Administration › Utseende ([D98](D98-the-installations-theme-and-logo-are-saved-in-clew-by-an-administrator.md), 2026-11-10); the rail's surface to be replaced by [D115](D115-the-startsidan-prototypes-version-1-0-is-the-reference-for-clews-look-and-layout.md) (provisional, 2026-11-11; not built, so this record still binds what is built) · **Date:** 2026-11-05 · **Area:** ui

**Decision.** An installation that chooses nothing gets Astryx Neutral: `resolveBranding` in
`packages/ui/src/branding.ts` falls back to `neutral`, with no logo and no municipal colours.
`VITE_BRAND_PROFILE=sundsvall` still selects everything D38 built, and nothing of it is removed: the
tokens in `theme.ts`, the dragon and the `custom` profile stay as they were. `apps/web/.env.example`,
`README.md`, `scripts/a11y.sh` and `tests/a11y/branding-fixtures.ts` follow the new default. The full
WCAG suite now runs on Neutral; CI runs `branding.spec.ts` on `sundsvall` and `custom` after it.

**Why.** The product owner wanted the rail to stop being as white as the page, so that the rail reads as
its own area, and then chose a ready-made theme over more work on the Sundsvall one ("Vi kan byta till
Sundsvall om vi verkligen behöver det").

AppShell's `elevated` variant draws the rail on `--color-background-body` and the page on
`--color-background-surface`. Neutral gives them different values (`#f1f1f1` and `#ffffff`, dark
`#1b1b1b` and `#262626`). D38's Sundsvall map set both to white, and both to black in dark mode, which
is why the rail had no colour of its own. Astryx has no other setting for this: `AppShell.variant` was
already right.

Of the seven themes `bunx astryx theme list` offers, Neutral is the only one marked as maintained. It
is also the only one already installed, and `clewBaseTheme` extends it, so choosing it adds no dependency
and no licence to check. Butter, Chocolate, Matcha, Stone and Y2K bring display typefaces and colour
characters that a municipal tool has no use for, and Gothic is dark-only.

**Switching back.** Set `VITE_BRAND_PROFILE=sundsvall`, and first change two things, because the rail is
white on that profile until they are done. Both were built and checked in the browser on 2026-11-05,
in light mode, dark mode and the phone drawer, then taken out when this decision was made:

1. In `sundsvallTokens`, set `'--color-background-body'` to `[palette.lightGray, palette.darkGray]`.
2. Sundsvall's `--color-neutral` is opaque and has that same colour, so the selected row would vanish
   into the rail. Add `'app-shell-sidenav': { base: { '--color-neutral': 'var(--color-background-surface)' } }`
   as a `components` override on the Sundsvall profile. The selected row then takes the page's colour
   and keeps it on hover. The phone drawer sits on surface outside that wrapper and keeps the token.

Then remove the `test.skip` for Sundsvall in `tests/a11y/branding.spec.ts`, and update the two token
assertions on `--color-background-body` in `tests/unit/branding.test.ts`.

**Replaces.** D38's `sundsvall (default)`: only which profile is the default changes. The header shows no
logo by default until an installation chooses one, which D38 already allows.
