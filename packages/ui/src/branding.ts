export type HeaderLogo = Readonly<{ src: string; alt: string; darkSrc?: string }>;
export type BrandColors = Readonly<{ accent: string; accentMuted: string }>;
export type Branding = Readonly<
  | { profile: 'sundsvall' | 'custom'; colors: BrandColors; logo: HeaderLogo | null }
  | { profile: 'neutral'; colors: null; logo: HeaderLogo | null }
>;
export type BrandingInput = Readonly<{
  profile?: string;
  accent?: string;
  accentMuted?: string;
  logoSrc?: string;
  logoAlt?: string;
  logoDarkSrc?: string;
}>;

/** Published municipal colours, checked 2026-11-05. Source and mapping: D38. */
export const sundsvallPalette = {
  gronsta: { dark: '#00733b', light: '#e0f6de' },
  vattjom: { dark: '#005595', light: '#daeff1' },
  bjornstigen: { dark: '#5b1f78', light: '#d7dbf2' },
  juniskar: { dark: '#a90074', light: '#fedfe2' },
  black: '#000000',
  darkGray: '#4b4b4b',
  lightGray: '#ececec',
  white: '#ffffff',
} as const;

/** WCAG relative luminance for the six-digit sRGB colours accepted by this configuration. */
export function contrastRatio(first: string, second: string): number {
  const luminance = (hex: string) =>
    (
      [
        [1, 0.2126],
        [3, 0.7152],
        [5, 0.0722],
      ] as const
    ).reduce((sum, [offset, weight]) => {
      const channel = parseInt(hex.slice(offset, offset + 2), 16) / 255;
      const linear = channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      return sum + linear * weight;
    }, 0);
  const a = luminance(first),
    b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function logoPath(path: string): string {
  if (!path.startsWith('/') || path.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(path)) {
    throw new Error(
      'Logo sources must be a same-origin path starting with a single slash, such as /branding/logo.svg.',
    );
  }
  return path;
}

function resolveHeaderLogo(
  src: string | undefined,
  alt: string | undefined,
  darkSrc: string | undefined,
  fallback: HeaderLogo | null,
): HeaderLogo | null {
  if (src === undefined && alt === undefined && darkSrc === undefined) return fallback;
  const path = src?.trim() ?? '';
  const label = alt?.trim() ?? '';
  const darkPath = darkSrc?.trim() ?? '';
  if (!path && !label && !darkPath) return null;
  if (!path || !label)
    throw new Error('Set both VITE_HEADER_LOGO_SRC and VITE_HEADER_LOGO_ALT, or leave both empty to hide the logo.');
  return { src: logoPath(path), alt: label, ...(darkPath ? { darkSrc: logoPath(darkPath) } : {}) };
}

function customColors(accent: string | undefined, accentMuted: string | undefined): BrandColors {
  const strong = accent?.trim().toLowerCase() ?? '';
  const muted = accentMuted?.trim().toLowerCase() ?? '';
  if (!/^#[0-9a-f]{6}$/.test(strong) || !/^#[0-9a-f]{6}$/.test(muted)) {
    throw new Error(
      'The custom profile requires VITE_BRAND_ACCENT and VITE_BRAND_ACCENT_MUTED as six-digit hex colours.',
    );
  }
  if (
    contrastRatio(strong, sundsvallPalette.white) < 4.5 ||
    contrastRatio(muted, sundsvallPalette.darkGray) < 4.5 ||
    contrastRatio(strong, muted) < 3
  ) {
    throw new Error(
      `Custom branding requires 4.5:1 contrast for white on the accent and dark-grey (${sundsvallPalette.darkGray}) text on the muted accent, and 3:1 between the accent colours.`,
    );
  }
  return { accent: strong, accentMuted: muted };
}

/** One resolved installation profile for both the Astryx provider and the shared header (D38). */
export function resolveBranding(input: BrandingInput = {}): Branding {
  const profile = input.profile?.trim() ?? 'neutral';
  if (profile !== 'sundsvall' && profile !== 'neutral' && profile !== 'custom') {
    throw new Error('VITE_BRAND_PROFILE must be sundsvall, neutral or custom.');
  }
  if (profile !== 'custom' && (input.accent !== undefined || input.accentMuted !== undefined)) {
    throw new Error('Set VITE_BRAND_PROFILE=custom to configure accent colours.');
  }
  const fallback =
    profile === 'sundsvall'
      ? {
          src: '/branding/sundsvall-dragon.png',
          darkSrc: '/branding/sundsvall-dragon-white.png',
          alt: 'Sundsvalls kommun',
        }
      : null;
  const logo = resolveHeaderLogo(input.logoSrc, input.logoAlt, input.logoDarkSrc, fallback);
  if (profile === 'neutral') return { profile, colors: null, logo };
  const colors =
    profile === 'custom'
      ? customColors(input.accent, input.accentMuted)
      : { accent: sundsvallPalette.vattjom.dark, accentMuted: sundsvallPalette.vattjom.light };
  return { profile, colors, logo };
}
