import {
  THEME_COLOR_TOKENS,
  isThemeHex,
  type InstallationAppearance,
  type InstallationTheme,
  type ThemeColorPair,
  type ThemeColorToken,
} from '@clew/contracts';

export type HeaderLogo = Readonly<{ src: string; alt: string; darkSrc?: string }>;
/**
 * The installation's appearance as the browser draws it (D97): the theme an administrator saved, or null for Astryx
 * Neutral, and the header's logo, or null for none. One value for both the Astryx provider and the shared header.
 */
export type Branding = Readonly<{ revision: number; theme: InstallationTheme | null; logo: HeaderLogo | null }>;
/** What an installation nobody has configured looks like, and what is drawn when the appearance cannot be read (D46). */
export const NEUTRAL_BRANDING: Branding = { revision: 0, theme: null, logo: null };

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
/** A same-origin path (Clew's own logo route), or with `base` the same path on the installation the header is embedded from. */
function logoAddress(path: unknown, base: string | undefined): string | null {
  if (
    typeof path !== 'string' ||
    !path.startsWith('/') ||
    path.startsWith('//') ||
    /[\\\u0000-\u001f\u007f]/.test(path)
  )
    return null;
  if (!base) return path;
  try {
    return new URL(path, base).href;
  } catch {
    return null;
  }
}
/**
 * Reads what `GET /api/appearance` answered, or the copy the browser kept of it. The server has validated the theme,
 * but a kept copy is only text in the person's browser: a colour that is not a known token in six-digit hex is dropped,
 * a logo that is not on the installation's own origin is dropped, and anything unreadable is Neutral.
 */
export function readBranding(value: unknown, base?: string): Branding {
  if (!isObject(value)) return NEUTRAL_BRANDING;
  let theme: InstallationTheme | null = null;
  if (isObject(value.theme) && isObject(value.theme.colors)) {
    const colors: Partial<Record<ThemeColorToken, ThemeColorPair>> = {};
    for (const token of THEME_COLOR_TOKENS) {
      const pair = value.theme.colors[token];
      if (Array.isArray(pair) && pair.length === 2 && pair.every(c => typeof c === 'string' && isThemeHex(c)))
        colors[token] = [pair[0].toLowerCase(), pair[1].toLowerCase()];
    }
    if (Object.keys(colors).length)
      theme = { name: typeof value.theme.name === 'string' ? value.theme.name : null, colors };
  }
  let logo: HeaderLogo | null = null;
  if (isObject(value.logo) && typeof value.logo.alt === 'string' && value.logo.alt.trim()) {
    const src = logoAddress(value.logo.src, base),
      darkSrc = logoAddress(value.logo.darkSrc, base);
    if (src) logo = { src, alt: value.logo.alt.trim(), ...(darkSrc ? { darkSrc } : {}) };
  }
  return {
    revision: typeof value.revision === 'number' && Number.isFinite(value.revision) ? value.revision : 0,
    theme,
    logo,
  };
}
export type { InstallationAppearance };
