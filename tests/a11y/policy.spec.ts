import { expect, test } from '@playwright/test';
import { securityHeaders } from './security-headers';
import { MockApi, test as guarded } from './support';

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

/**
 * The guard every other spec runs under (`policy` in `support.ts`): it hears what the policy refuses in the page, in a
 * frame of it, in a popup it opens and in a worker it starts, and a refusal left at the end fails the spec.
 */
guarded.describe('the suite’s policy guard', () => {
  const inlineScript = () => {
    const script = document.createElement('script');
    script.textContent = 'window.ran = true';
    document.head.append(script);
  };
  guarded('hears a refusal in the page, a frame, a popup and a worker', async ({ page, context, api, policy }) => {
    api.signedIn = false;
    await context.route('**/api/**', route => api.handle(route));
    await page.goto('/login');
    await expect(page.getByRole('link', { name: 'Logga in', exact: true })).toBeVisible();
    await page.evaluate(inlineScript);
    await page.evaluate(() => {
      const frame = document.createElement('iframe');
      frame.title = 'Prov';
      frame.srcdoc = '<script>parent.framed = true</script>';
      document.body.append(frame);
    });
    const [popup] = await Promise.all([
      context.waitForEvent('page'),
      page.evaluate(() => void window.open('/login?probe=popup')),
    ]);
    await expect(popup.getByRole('link', { name: 'Logga in', exact: true })).toBeVisible();
    await popup.evaluate(inlineScript);
    // A worker's policy is the one its own file is served with; this one keeps asking another origin, which it may
    // not, so it asks again once the guard listens in it.
    await context.route('**/policy-probe-worker.js', route =>
      route.fulfill({
        contentType: 'text/javascript',
        headers: securityHeaders(),
        body: "setInterval(() => fetch('https://elsewhere.example/probe').catch(() => undefined), 100);",
      }),
    );
    await page.evaluate(() => Object.assign(window, { probe: new Worker('/policy-probe-worker.js') }));
    await expect
      .poll(async () => {
        const heard = await policy.violations();
        return {
          page: heard.some(text => /^script-src-elem refused inline in http:\/\/localhost:4173\/login$/.test(text)),
          frame: heard.some(text => /^script-src-elem refused inline in about(:srcdoc)?$/.test(text)),
          popup: heard.some(text => text.endsWith('/login?probe=popup')),
          worker: heard.some(text => text.includes('https://elsewhere.example/probe')),
        };
      })
      .toEqual({ page: true, frame: true, popup: true, worker: true });
    await page.evaluate(() => (window as unknown as { probe: Worker }).probe.terminate());
    for (const at of [page, popup])
      expect(await at.evaluate(() => (window as unknown as { ran?: boolean; framed?: boolean }).ran)).toBeUndefined();
    expect(await page.evaluate(() => (window as unknown as { framed?: boolean }).framed)).toBeUndefined();
    await policy.clear();
    expect(await policy.violations()).toEqual([]);
  });
  guarded('fails the spec when a refusal is left at the end', async ({ page, api }) => {
    guarded.fail();
    api.signedIn = false;
    await page.goto('/login');
    await expect(page.getByRole('link', { name: 'Logga in', exact: true })).toBeVisible();
    await page.evaluate(inlineScript);
  });
});
