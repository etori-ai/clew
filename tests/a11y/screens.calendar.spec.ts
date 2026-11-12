import { desktop, open, phone, test } from './support';
import { NEXT_WEEK } from './data';

/**
 * Not a test: screenshots of the calendar surfaces for the comparison against the canvas row Chef-kalender
 * (docs/reviews). Run on demand with `CLEW_SCREENS=1 … playwright test -c tests/a11y screens.calendar`; the images land in
 * test-results/screens/.
 */
// Playwright resolves a screenshot path against the process cwd, the workspace root.
const out = (name: string) => `test-results/screens/${name}.png`;
test.describe('screens', () => {
  test.skip(!process.env.CLEW_SCREENS, 'screenshots are taken on demand: CLEW_SCREENS=1');
  for (const [name, path] of [
    ['week', '/calendar'],
    ['day', '/calendar?view=day'],
    ['month', '/calendar?view=month'],
    ['week-proposals', `/calendar?date=${NEXT_WEEK}`],
  ] as const) {
    test(`${name} desktop`, async ({ page, api: _ }) => {
      await page.setViewportSize(desktop);
      await open(page, path);
      await page.screenshot({ path: out(`${name}-1280`), fullPage: true });
    });
    test(`${name} phone`, async ({ page, api: _ }) => {
      await page.setViewportSize(phone);
      await open(page, path);
      await page.screenshot({ path: out(`${name}-375`), fullPage: true });
    });
  }
  test('booking dialog', async ({ page, api: _ }) => {
    await page.setViewportSize(desktop);
    await open(page, '/calendar');
    await page.getByRole('button', { name: 'Ny bokning' }).click();
    const dialog = page.getByRole('dialog', { name: 'Ny bokning' });
    await dialog.getByRole('textbox', { name: /Rubrik/ }).fill('Ledningsgrupp');
    await dialog.getByRole('button', { name: 'Kontrollera tillgänglighet' }).click();
    await page.screenshot({ path: out('booking-1280') });
  });
  test('event dialog', async ({ page, api: _ }) => {
    await page.setViewportSize(desktop);
    await open(page, '/calendar');
    await page.locator('.clew-cal-event').first().click();
    await page.getByRole('dialog').waitFor();
    await page.waitForTimeout(500);
    await page.screenshot({ path: out('event-1280') });
  });
  test('proposal dialog moving', async ({ page, api: _ }) => {
    await page.setViewportSize(desktop);
    await open(page, `/calendar?date=${NEXT_WEEK}`);
    await page.locator('.clew-cal-event-proposal').first().click();
    // The proposal opens in the panel (D112 item 9); its "Flytta …" opens the move dialog.
    await page.getByRole('dialog', { name: 'Utvecklingssamtal' }).getByRole('button', { name: 'Flytta …' }).click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: out('proposal-move-1280') });
  });
});
