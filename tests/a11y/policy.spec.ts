import { expect, test } from '@playwright/test';
import { securityHeaders } from './security-headers';
import { MockApi } from './support';

/**
 * The suite draws every page under the web image's security headers (D145), and the suite's fixture fails a spec on
 * any violation the page reports. This spec holds the guard itself: the build is served with the headers, and the
 * policy refuses an inline script and says so. It drives the page without the fixture, whose check would fail it.
 */
test('the build is served under the web image’s headers, and its policy refuses an inline script and reports it', async ({
  page,
}) => {
  const api = new MockApi();
  api.signedIn = false;
  await page.route('**/api/**', route => api.handle(route));
  const response = await page.goto('/login');
  const sent = response!.headers();
  for (const [name, value] of Object.entries(securityHeaders())) expect(sent[name.toLowerCase()]).toBe(value);
  await expect(page.getByRole('link', { name: 'Logga in', exact: true })).toBeVisible();
  const refused = await page.evaluate(
    () =>
      new Promise<string>(resolve => {
        document.addEventListener('securitypolicyviolation', event => resolve(event.effectiveDirective), {
          once: true,
        });
        const script = document.createElement('script');
        script.textContent = 'window.ran = true';
        document.head.append(script);
      }),
  );
  expect(refused).toBe('script-src-elem');
  expect(await page.evaluate(() => (window as unknown as { ran?: boolean }).ran)).toBeUndefined();
});
