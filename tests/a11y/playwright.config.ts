import { defineConfig } from '@playwright/test';

/**
 * The WCAG 2.2 AA suite. A production build runs in the pinned Playwright image with `/api` mocked in the browser, so
 * the suite needs neither Keycloak nor a database and a person's real sign-in never enters a test. Run it with
 * `sh scripts/a11y.sh`.
 */
export default defineConfig({
  testDir: '.',
  outputDir: '../../test-results',
  fullyParallel: true,
  forbidOnly: true,
  reporter: [['list'], ['html', { open: 'never', outputFolder: '../../playwright-report' }]],
  use: { baseURL: 'http://localhost:4173', locale: 'sv-SE', timezoneId: 'Europe/Stockholm', trace: 'retain-on-failure' },
  webServer: {
    command: 'node_modules/.bin/vite build --logLevel warn && node_modules/.bin/vite preview --port 4173 --strictPort',
    cwd: '../../apps/web',
    url: 'http://localhost:4173',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
