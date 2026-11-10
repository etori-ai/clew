import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AppearanceAdminView } from '@clew/contracts';
import { parseThemeFile, themeFromAccent, type InstallationTheme } from '../../packages/contracts/src/theme-file';

export type A11yBrandProfile = 'sundsvall' | 'neutral' | 'custom';
type Image = { mediaType: string; data: string };
type BrandingFixture = Readonly<{
  theme: InstallationTheme | null;
  logo: { alt: string; light: Image; dark?: Image } | null;
  /** The accent the page's own tokens must carry in the light appearance. */
  accent: string;
}>;
const root = resolve(import.meta.dirname, '../..');
const base64 = (path: string) => readFileSync(resolve(root, path)).toString('base64');
/** The repository's own example theme file, read the way an administrator's upload is. */
function exampleTheme(path: string): InstallationTheme {
  const parsed = parseThemeFile(JSON.parse(readFileSync(resolve(root, path), 'utf8')));
  if (!parsed.ok)
    throw new Error(`${path} is not a valid theme file: ${parsed.problems.map(p => p.message).join(' ')}`);
  return parsed.theme;
}

/**
 * What an installation has saved (D98), as the mocked API answers it: a theme and a logo are the server's answers, not
 * the build's, so one build serves every profile and a spec chooses by setting the answer.
 */
export const brandingFixtures: Readonly<Record<A11yBrandProfile, BrandingFixture>> = {
  sundsvall: {
    theme: exampleTheme('themes/sundsvall/theme.tokens.json'),
    logo: {
      alt: 'Sundsvalls kommun',
      light: { mediaType: 'image/png', data: base64('apps/web/public/branding/sundsvall-dragon.png') },
      dark: { mediaType: 'image/png', data: base64('apps/web/public/branding/sundsvall-dragon-white.png') },
    },
    accent: '#005595',
  },
  neutral: { theme: null, logo: null, accent: '#1b1b1b' },
  custom: {
    theme: themeFromAccent('#5b1f78', '#d7dbf2', 'Exempelkommunen'),
    logo: {
      alt: 'Exempelkommunen',
      light: {
        mediaType: 'image/svg+xml',
        data: Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><rect width="24" height="24" fill="#5b1f78"/><circle cx="12" cy="12" r="6" fill="white"/></svg>',
        ).toString('base64'),
      },
    },
    accent: '#5b1f78',
  },
};

export function a11yBrandProfile(value: string | undefined): A11yBrandProfile {
  if (value === undefined) return 'neutral';
  if (value === 'sundsvall' || value === 'neutral' || value === 'custom') return value;
  throw new Error('CLEW_A11Y_BRAND_PROFILE must be sundsvall, neutral or custom.');
}

/** The appearance and the logo images a profile has saved, in the shape the mock API keeps them. */
export function savedBranding(profile: A11yBrandProfile): {
  appearance: AppearanceAdminView;
  logos: Partial<Record<'light' | 'dark', Image>>;
} {
  const { theme, logo } = brandingFixtures[profile];
  const revision = theme || logo ? 1 : 0;
  return {
    appearance: {
      revision,
      theme,
      logo: logo
        ? {
            alt: logo.alt,
            src: `/api/appearance/logo/light?v=${revision}`,
            ...(logo.dark ? { darkSrc: `/api/appearance/logo/dark?v=${revision}` } : {}),
          }
        : null,
      updatedAt: revision ? '2026-11-10T08:00:00.000Z' : null,
      updatedBy: revision ? 'Mikael Lund' : null,
    },
    logos: logo ? { light: logo.light, ...(logo.dark ? { dark: logo.dark } : {}) } : {},
  };
}
