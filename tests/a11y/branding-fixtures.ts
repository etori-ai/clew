import type { Branding, BrandingInput } from '../../packages/ui/src/branding';

export type A11yBrandProfile = 'sundsvall' | 'neutral' | 'custom';
type BrandingFixture = Readonly<{ input: BrandingInput; expected: Branding; accent: string }>;

/** Explicit test inputs and independent expectations, never read from the operator's environment. */
export const brandingFixtures: Readonly<Record<A11yBrandProfile, BrandingFixture>> = {
  sundsvall: {
    input: { profile: 'sundsvall' },
    expected: { profile: 'sundsvall', colors: { accent: '#005595', accentMuted: '#daeff1' },
      logo: { src: '/branding/sundsvall-dragon.png', darkSrc: '/branding/sundsvall-dragon-white.png', alt: 'Sundsvalls kommun' } },
    accent: '#005595',
  },
  neutral: {
    input: { profile: 'neutral' },
    expected: { profile: 'neutral', colors: null, logo: null },
    accent: '#1b1b1b',
  },
  custom: {
    input: { profile: 'custom', accent: '#5b1f78', accentMuted: '#d7dbf2',
      logoSrc: '/branding/test-municipality.svg', logoAlt: 'Exempelkommunen' },
    expected: { profile: 'custom', colors: { accent: '#5b1f78', accentMuted: '#d7dbf2' },
      logo: { src: '/branding/test-municipality.svg', alt: 'Exempelkommunen' } },
    accent: '#5b1f78',
  },
};

export function a11yBrandProfile(value: string | undefined): A11yBrandProfile {
  if (value === undefined) return 'sundsvall';
  if (value === 'sundsvall' || value === 'neutral' || value === 'custom') return value;
  throw new Error('CLEW_A11Y_BRAND_PROFILE must be sundsvall, neutral or custom.');
}

/** Replace every browser branding input, including absent values that must not inherit process.env. */
export function brandingDefinitions(profile: A11yBrandProfile): Record<string, string> {
  const input = brandingFixtures[profile].input;
  return {
    'import.meta.env.VITE_BRAND_PROFILE': JSON.stringify(input.profile) ?? 'undefined',
    'import.meta.env.VITE_BRAND_ACCENT': JSON.stringify(input.accent) ?? 'undefined',
    'import.meta.env.VITE_BRAND_ACCENT_MUTED': JSON.stringify(input.accentMuted) ?? 'undefined',
    'import.meta.env.VITE_HEADER_LOGO_SRC': JSON.stringify(input.logoSrc) ?? 'undefined',
    'import.meta.env.VITE_HEADER_LOGO_DARK_SRC': JSON.stringify(input.logoDarkSrc) ?? 'undefined',
    'import.meta.env.VITE_HEADER_LOGO_ALT': JSON.stringify(input.logoAlt) ?? 'undefined',
  };
}
