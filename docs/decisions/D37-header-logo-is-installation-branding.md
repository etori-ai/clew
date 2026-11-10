# D37 · The shared navigation logo is installation branding

**Status:** accepted, extended by [D38](D38-municipal-branding-uses-astryx-themes.md); the build variables and "no database, upload service or administration page" superseded by [D98](D98-the-installations-theme-and-logo-are-saved-in-clew-by-an-administrator.md) (2026-11-10), the native image exception stands · **Date:** 2026-11-05 · **Area:** ui

**Decision.** `apps/web/src/components/shell.tsx` renders one municipality logo on every protected
surface through Astryx `SideNavHeading.icon`, in the rail and its mobile heading. The product name
and home link remain. D38's `packages/ui/src/branding.ts` is the canonical typed configuration and
validation owner; the web adapts public build values. An installation chooses its original source
and accessible name with `VITE_HEADER_LOGO_SRC` and `VITE_HEADER_LOGO_ALT`, served from its own origin.
The Sundsvall default belongs only to the Sundsvall profile. Explicit empty values omit the mark;
a partial configuration fails startup/build. A failed image leaves the name/home link working.

**Astryx gap.** Core 0.7.7 has no general Image component. Thumbnail would crop a municipality mark;
NavIcon adds a circular accent surface. The documented icon slot accepts a React node. A native img
is therefore allowed only there, with contain fit, intrinsic dimensions and token-based clearance;
D39 defines the compact sizing and dark variant/background. No custom layout, image filter, tenant
database, upload service or administration page. Public build values require a Vite restart/rebuild.

**Why.** The product owner requested Sundsvall's dragon while allowing other municipalities to pick
their own mark. One shell and one resolved profile cover all surfaces, with no municipality logic in
pages. The original assets, provenance and ownership are in `apps/web/public/branding/README.md`.

**Replaces.** Extends D31/D34's shared navigation heading with installation branding and this narrow
native-image exception. The current rail/landing/overview design is preserved. The private reference
canvas could not be accessed; Astryx's documented shell-side-nav composition is the available frame.
