import type { Page } from '@playwright/test';
import { composer, expect, expectNoAxeViolations, narrow, open, reflowProblems, test } from './support';
import { menuRows } from './phonebook';

/** Release responses explicitly: slow-loading assertions must not race an arbitrary timeout. */
async function hold(page: Page, url: string) {
  let release!: () => void;
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });
  await page.route(url, async route => {
    await gate;
    await route.fallback();
  });
  return release;
}

for (const viewport of [{ width: 1440, height: 1000 }, narrow]) {
  test(`a cold load and hard refresh reserve the home sections at ${viewport.width}px`, async ({ page, api: _ }) => {
    await page.setViewportSize(viewport);
    for (const refresh of [false, true]) {
      const threads = await hold(page, '**/api/threads');
      const areas = await hold(page, '**/api/areas');
      const day = await hold(page, '**/api/today');
      if (refresh) await page.reload();
      else await page.goto('/');
      await expect(page.getByRole('region', { name: 'I dag', exact: true })).toBeAttached();
      await expect(page.getByRole('region', { name: 'Sedan i går' })).toBeAttached();
      await expect(page.getByText('Hämtar det som behöver dig …')).toBeAttached();
      await expect(page.getByText('Lugnt läge', { exact: true })).toHaveCount(0);
      await composer(page).fill('En fråga medan sidan hämtas');
      const before = await composer(page).boundingBox();
      await page.screenshot({ path: `test-results/screens/loading-${viewport.width}.png` });
      threads();
      // Each block arrives with its own read (D112 item 2): the work items and Sedan i går with the cards, while the
      // figures keep their shape until the areas have answered and the day until it has.
      await expect(page.getByText('Hämtar det som behöver dig …')).toHaveCount(0);
      await expect(page.getByText('Hämtar sedan i går …')).toHaveCount(0);
      await expect(page.getByRole('region', { name: 'Läget', exact: true })).toHaveAttribute('aria-busy', 'true');
      await expect(page.getByText('Hämtar i dag …')).toBeAttached();
      areas();
      await expect(page.getByRole('region', { name: 'Läget', exact: true })).not.toHaveAttribute('aria-busy', 'true');
      day();
      await expect(page.getByText('Hämtar i dag …')).toHaveCount(0);
      await expect(page.getByText('Hämtar sedan i går …')).toHaveCount(0);
      await expect(composer(page)).toHaveText('En fråga medan sidan hämtas');
      await expect(composer(page)).toBeFocused();
      expect(Math.abs((await composer(page).boundingBox())!.y - before!.y)).toBeLessThan(2);
      expect(await reflowProblems(page)).toEqual([]);
      await expectNoAxeViolations(page);
      await page.screenshot({ path: `test-results/screens/loaded-${viewport.width}.png` });
    }
  });
}

for (const colorScheme of ['light', 'dark'] as const) {
  test(`the muted card has visible placeholders in ${colorScheme} appearance`, async ({ page, api: _ }) => {
    await page.emulateMedia({ colorScheme });
    const release = await hold(page, '**/api/threads');
    await page.goto('/');
    const card = page.getByRole('region', { name: 'Sedan i går' });
    await expect(card.getByText('Hämtar sedan i går …')).toBeAttached();
    const colors = await card
      .locator('.astryx-skeleton')
      .first()
      .evaluate(el => ({
        skeleton: getComputedStyle(el).backgroundColor,
        card: getComputedStyle(el.closest('.astryx-card')!).backgroundColor,
      }));
    expect(colors.skeleton).not.toBe(colors.card);
    release();
    await expect(card.getByText('Hämtar sedan i går …')).toHaveCount(0);
  });
}

test('session verification has a named loading state without protected content', async ({ page, api: _ }) => {
  const release = await hold(page, '**/api/auth/session');
  await page.goto('/');
  // From Astryx 0.7.12 a spinner's label is also said in the live region: the words on the page are the ones looked for.
  await expect(page.getByText('Hämtar sidan …', { exact: true }).and(page.locator(':not([aria-live])'))).toBeVisible();
  await expect(composer(page)).toHaveCount(0);
  release();
  await expect(composer(page)).toBeVisible();
  await expect(page.getByText('Hämtar sidan …', { exact: true })).toHaveCount(0);
});

test('coming back to the window asks about the session without hiding a page confirmed moments ago', async ({
  page,
  api: _,
}) => {
  await open(page, '/');
  const opacity = () => page.evaluate(() => document.documentElement.style.opacity);
  // The answer is held, so a page hidden for the check would stay hidden until it is released.
  const release = await hold(page, '**/api/auth/session');
  const asked = page.waitForRequest('**/api/auth/session');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await asked;
  expect(await opacity()).toBe('');
  await expect(composer(page)).toBeVisible();
  // A page the browser brings back from its back/forward cache is hidden until the session has answered.
  await page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
  expect(await opacity()).toBe('0');
  release();
  await expect.poll(opacity).toBe('');
});

for (const tab of ['waiting', 'done']) {
  test(`the ${tab} pile does not claim to be empty before its first response`, async ({ page, api: _ }) => {
    const release = await hold(page, '**/api/threads');
    await page.goto('/todo?tab=' + tab);
    await expect(page.getByText('Hämtar det som behöver dig …')).toBeAttached();
    await expect(page.getByText('Tomt här', { exact: true })).toHaveCount(0);
    release();
    await expect(page.getByText('Hämtar det som behöver dig …')).toHaveCount(0);
  });
}

for (const [path, endpoint, label] of [
  ['/calendar', '**/api/calendar?*', 'Hämtar kalendern …'],
  ['/tools/phonebook.directory', '**/api/cap/phonebook.directory', 'Hämtar innehåll …'],
  ['/admin/connectors', '**/api/admin/connectors', 'Hämtar innehåll …'],
  ['/admin/connectors/finance', '**/api/admin/connectors/finance', 'Hämtar innehåll …'],
  ['/admin/models', '**/api/admin/models', 'Hämtar innehåll …'],
] as const) {
  test(`${path} keeps a loading surface until its first response`, async ({ page, api }) => {
    api.admin = true;
    api.menu = menuRows;
    const release = await hold(page, endpoint);
    await page.goto(path);
    await expect(page.getByText(label, { exact: true })).toBeAttached();
    expect(await page.getByRole('main').locator('.astryx-skeleton').count()).toBeGreaterThan(3);
    release();
    await expect(page.getByText(label, { exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });
}

test('loading finishes on failure, including the optional day', async ({ page, api: _ }) => {
  const release = await hold(page, '**/api/threads');
  await page.route('**/api/today', route => route.fulfill({ status: 500, json: { error: 'Otillgänglig' } }));
  await page.route('**/api/areas', route =>
    route.fulfill({ status: 400, json: { error: 'Områden kunde inte läsas.' } }),
  );
  await page.goto('/');
  await expect(page.getByText('Hämtar det som behöver dig …')).toBeAttached();
  release();
  await expect(page.getByText('Hämtar det som behöver dig …')).toHaveCount(0);
  await expect(page.getByText('Hämtar i dag …')).toHaveCount(0);
  await expect(page.getByText('Hämtar sedan i går …')).toHaveCount(0);
  await expect(page.getByRole('alert').filter({ hasText: 'Områden kunde inte läsas.' })).toBeVisible();
});

test('reduced motion disables the content entrance', async ({ page, api: _ }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const release = await hold(page, '**/api/threads');
  await page.goto('/');
  await expect(page.getByText('Hämtar det som behöver dig …')).toBeAttached();
  release();
  await expect(page.getByText('Hämtar det som behöver dig …')).toHaveCount(0);
  const content = page.getByRole('region', { name: 'Behöver dig' }).locator('[aria-busy="false"] > div').first();
  expect(await content.evaluate(el => getComputedStyle(el).animationName)).toBe('none');
});

test('a background refresh preserves content, focus and the composer draft', async ({ page, api: _ }) => {
  await page.addInitScript(() => {
    // The stand-in speaks as the server's stream does: a connection starts by saying the current revision, which
    // invalidates nothing, and a later revision is a change.
    class Changes {
      private listener: ((event: { data: string }) => void) | null = null;
      constructor() {
        (window as unknown as { refresh(): void }).refresh = () => this.say('new');
      }
      get onmessage() {
        return this.listener;
      }
      set onmessage(listener: ((event: { data: string }) => void) | null) {
        this.listener = listener;
        this.say('opened');
      }
      private say(revision: string) {
        this.listener?.({ data: JSON.stringify({ revision, policy: '1:1' }) });
      }
      close() {}
    }
    window.EventSource = Changes as unknown as typeof EventSource;
  });
  await open(page, '/');
  const content = page.getByRole('region', { name: 'Behöver dig' }).locator('[aria-busy="false"] > div').first();
  expect(await content.evaluate(el => getComputedStyle(el).animationName)).not.toBe('none');
  await content.evaluate(el => el.setAttribute('data-kept', 'yes'));
  await composer(page).fill('Behåll min fråga');
  const release = await hold(page, '**/api/threads');
  const request = page.waitForRequest('**/api/threads');
  await page.evaluate(() => (window as unknown as { refresh(): void }).refresh());
  await request;
  await expect(content).toHaveAttribute('data-kept', 'yes');
  await expect(page.getByText('Hämtar det som behöver dig …')).toHaveCount(0);
  await expect(composer(page)).toBeFocused();
  release();
  await page.waitForLoadState('networkidle');
  await expect(content).toHaveAttribute('data-kept', 'yes');
  await expect(composer(page)).toHaveText('Behåll min fråga');
});
