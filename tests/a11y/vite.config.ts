import { resolve } from 'node:path';
import { webConfig } from '../../apps/web/vite.config';

/** One build for every spec: the theme and the logo are answers of the mocked API, not of the build (D98). */
export function a11yWebConfig() {
  return {
    ...webConfig(),
    root: resolve(import.meta.dirname, '../../apps/web'),
    envDir: false as const,
    build: { outDir: resolve(import.meta.dirname, '../../test-results/apps/web') },
  };
}

export default () => a11yWebConfig();
