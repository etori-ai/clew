import type { Locator, Page } from '@playwright/test';
import { desktop, expect, open, phone, test } from './support';

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
    // At this width the card was in a drawer over the page: it leaves with its row (D66 as amended by D70), so the
    // focus lands on the row after it and nothing stands between the person and the toast.
    await expect(page.getByRole('dialog', { name: 'Kort', exact: true })).toBeHidden();
    await expect(
      page.locator('#thread-ledighet').getByRole('link', { name: 'Ledighetsansökan från Johan Byström', exact: true }),
    ).toBeFocused();
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

test.describe('on a phone the card is in the sheet (artboard 12)', () => {
  test.use({ viewport: phone, hasTouch: true, isMobile: true });

  test('Avfärda closes the sheet with the card, and the focus lands on the row after it', async ({ page, api }) => {
    api.mutationDelay = 1_500;
    await open(page, '/');
    const row = page.getByRole('main').locator('#thread-omtanke');
    await row.getByRole('link', { name: 'Omtankesamtal med Anna Lindqvist', exact: true }).click();
    const sheet = page.getByRole('dialog', { name: 'Kort: Omtankesamtal med Anna Lindqvist' });
    await sheet.getByRole('button', { name: 'Fler val' }).click();
    await page.getByRole('menuitem', { name: 'Avfärda · inte aktuellt' }).click();
    await expect(row).toHaveCount(0, { timeout: 700 });
    // The sheet is a modal dialog: the page under it takes no focus until it has slid away, so the sheet itself hands
    // the focus to the next row when it closes (2.4.3).
    await expect(sheet).toBeHidden();
    await expect(
      page.locator('#thread-ledighet').getByRole('link', { name: 'Ledighetsansökan från Johan Byström', exact: true }),
    ).toBeFocused();
  });
});
