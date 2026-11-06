import type { Locator, Page } from '@playwright/test';
import { desktop, expect, open, test } from './support';

/** Avfärda the way a person does it (D48, artboard E): from Fler val on the open card, reached from the row's title. */
async function dismiss(page: Page, row: Locator) {
  await row.getByRole('link', { name: 'Omtankesamtal med Anna Lindqvist', exact: true }).click();
  const card = page.getByRole('dialog', { name: 'Kort', exact: true });
  await card.getByRole('button', { name: 'Fler val' }).click();
  await page.getByRole('menuitem', { name: 'Avfärda · inte aktuellt' }).click();
}

test.describe("a card shows the person's own action at once (D64)", () => {
  test.use({ viewport: desktop });

  test('Avfärda takes the card out of the stream before the server has answered, and the toast confirms when it has', async ({
    page,
    api,
  }) => {
    api.mutationDelay = 1_500;
    await open(page, '/');
    const row = page.getByRole('main').locator('#thread-omtanke');
    await expect(row).toBeVisible();
    await dismiss(page, row);
    await expect(row).toHaveCount(0, { timeout: 700 });
    // Focus has moved on (2.4.3) and the toast with Ångra is the way back, as before.
    await expect(page.locator(':focus')).toHaveCount(1);
    // The toast's words are also in Astryx's live region, so the toast is read from its own region.
    const toasts = page.getByRole('region', { name: 'Aviseringar' });
    await expect(toasts.getByText(/^Avfärdad som inte aktuellt/)).toBeVisible();
    await expect(toasts.getByRole('button', { name: 'Ångra' })).toBeVisible();
  });

  test('a request the server refuses brings the card back and says why', async ({ page, api }) => {
    api.mutationDelay = 1_500;
    api.mutationFails = true;
    await open(page, '/');
    const row = page.getByRole('main').locator('#thread-omtanke');
    await dismiss(page, row);
    await expect(row).toHaveCount(0, { timeout: 700 });
    await expect(row).toBeVisible();
    const toasts = page.getByRole('region', { name: 'Aviseringar' });
    await expect(toasts.getByText('Källan svarade inte.')).toBeVisible();
    // The reason is announced at once, as an error should be (4.1.3); the open card says it too, in its own alert.
    await expect(page.getByRole('alert').filter({ hasText: 'Källan svarade inte.' }).first()).toBeVisible();
    await expect(toasts.getByRole('button', { name: 'Ångra' })).toHaveCount(0);
  });
});
