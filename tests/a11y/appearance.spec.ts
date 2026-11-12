import { expect, open, openNav, phone, test } from './support';
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
    // Without a header connector the person is the rail's last row, in the drawer on a phone (D111 item 1).
    await (await openNav(page)).getByRole('button', { name: 'Testa Testsson', exact: true }).click();
    await expect(page.getByRole('radio', { name: 'Samma som datorn', exact: true })).toBeChecked();
    await page.getByRole('radio', { name: 'Ljust', exact: true }).check();
    await expect.poll(() => dark(page)).toBe(false);
    await page.reload();
    await expect.poll(() => dark(page)).toBe(false);
  });
});
