import { resolveBranding } from '@clew/ui/branding';

/** Vite replaces these public build values; validation and profile defaults have one owner in @clew/ui. */
export const branding = resolveBranding({
  profile: import.meta.env.VITE_BRAND_PROFILE,
  accent: import.meta.env.VITE_BRAND_ACCENT,
  accentMuted: import.meta.env.VITE_BRAND_ACCENT_MUTED,
  logoSrc: import.meta.env.VITE_HEADER_LOGO_SRC,
  logoDarkSrc: import.meta.env.VITE_HEADER_LOGO_DARK_SRC,
  logoAlt: import.meta.env.VITE_HEADER_LOGO_ALT,
});
