import { resolveBranding } from '@clew/ui/branding';

/**
 * The portal is Sundsvall's start page as the product owner's proof of concept draws it (D67), so its profile is
 * Sundsvall unless the build says otherwise; the main web app keeps Neutral as its default (D46).
 */
export const branding = resolveBranding({
  profile: import.meta.env.VITE_BRAND_PROFILE ?? 'sundsvall',
  accent: import.meta.env.VITE_BRAND_ACCENT,
  accentMuted: import.meta.env.VITE_BRAND_ACCENT_MUTED,
  logoSrc: import.meta.env.VITE_HEADER_LOGO_SRC,
  logoDarkSrc: import.meta.env.VITE_HEADER_LOGO_DARK_SRC,
  logoAlt: import.meta.env.VITE_HEADER_LOGO_ALT,
});
