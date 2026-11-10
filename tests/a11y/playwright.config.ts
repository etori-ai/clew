import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';
import { a11yBrandProfile } from './branding-fixtures';

const profile = a11yBrandProfile(process.env.CLEW_A11Y_BRAND_PROFILE);

/**
 * The WCAG 2.2 AA suite. A production build runs in the pinned Playwright image with `/api` mocked in the browser, so
 * the suite needs neither Keycloak nor a database and a person's real sign-in never enters a test. Run it with
 * `sh scripts/a11y.sh`.
 */
export default defineConfig({
  testDir: '.',
  outputDir: resolve(import.meta.dirname, '../../test-results', profile),
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: resolve(import.meta.dirname, '../../playwright-report', profile) }],
  ],
  use: {
    baseURL: 'http://localhost:4173',
    locale: 'sv-SE',
    timezoneId: 'Europe/Stockholm',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command:
        'node_modules/.bin/vite build --config ../../tests/a11y/vite.config.ts --logLevel warn && node_modules/.bin/vite preview --config ../../tests/a11y/vite.config.ts --port 4173 --strictPort',
      cwd: '../../apps/web',
      url: 'http://localhost:4173',
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      // The shared header's embed on the intranet stand-in (D87, D88), served by the web app's dev server: `/intranat/…`.
      // The stand-in names Sundsvall's dragon itself and asks Clew for the theme (D97); the spec answers that request.
      command: 'node_modules/.bin/vite --port 4175 --strictPort --logLevel warn',
      cwd: '../../apps/web',
      url: 'http://localhost:4175/intranat/',
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
