import { resolve } from 'node:path';
import { webConfig } from '../../apps/web/vite.config';
import { resolveBranding } from '../../packages/ui/src/branding';
import { a11yBrandProfile, brandingDefinitions, brandingFixtures, type A11yBrandProfile } from './branding-fixtures';

export function a11yWebConfig(profile: A11yBrandProfile) {
  resolveBranding(brandingFixtures[profile].input);
  return {
    ...webConfig(),
    root: resolve(import.meta.dirname, '../../apps/web'),
    envDir: false as const,
    define: brandingDefinitions(profile),
    build: { outDir: resolve(import.meta.dirname, '../../test-results/apps', profile) },
  };
}

export default () => a11yWebConfig(a11yBrandProfile(process.env.CLEW_A11Y_BRAND_PROFILE));
