import { expect, open, phone, test } from './support';
import type { Page } from '@playwright/test';

const dark = (page: Page) =>
  page.evaluate(() => {
    const [r = 255, g = 255, b = 255] = (getComputedStyle(document.body).backgroundColor.match(/[\d.]+/g) ?? []).map(
      Number,
    );
    return r + g + b < 150;
  });

test.describe('appearance (D39)', () => {
  test.use({ viewport: phone, colorScheme: 'dark' });

  test('follows the computer until the person chooses, and the choice is kept', async ({ page, api: _ }) => {
    await open(page, '/');
    await expect.poll(() => dark(page)).toBe(true);
    // The person and the settings are in the header's bar on a phone too (D88).
    await page.getByRole('button', { name: 'Testa Testsson, inställningar', exact: true }).click();
    await expect(page.getByRole('radio', { name: 'Samma som datorn', exact: true })).toBeChecked();
    await page.getByRole('radio', { name: 'Ljust', exact: true }).check();
    await expect.poll(() => dark(page)).toBe(false);
    await page.reload();
    await expect.poll(() => dark(page)).toBe(false);
  });
});
