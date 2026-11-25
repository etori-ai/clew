import { resolve } from 'node:path';
import { webConfig } from '../../apps/web/vite.config';
import { securityHeaders } from './security-headers';

/**
 * One build for every spec: the theme and the logo are answers of the mocked API, not of the build (D98). It is served
 * with the web image's security headers (D145), so a page that breaks the policy fails its spec.
 */
export function a11yWebConfig() {
  return {
    ...webConfig(),
    root: resolve(import.meta.dirname, '../../apps/web'),
    envDir: false as const,
    build: { outDir: resolve(import.meta.dirname, '../../test-results/apps/web') },
    preview: { headers: securityHeaders() },
  };
}

export default () => a11yWebConfig();
