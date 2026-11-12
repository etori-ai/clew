import type { Locator, Page } from '@playwright/test';
import { desktop, expect, open, phone, test } from './support';

/** Avfärda the way a person does it (D48): from Fler val on the work item, opened from its row in Att göra (D112). */
async function dismiss(page: Page, row: Locator) {
  await row.getByRole('link').click();
  // The work item in the pane beside the queue, or its page alone on a phone (D112 items 3 and 12).
  await page.getByRole('main').getByRole('button', { name: 'Fler val' }).first().click();
  await page.getByRole('menuitem', { name: 'Avfärda · inte aktuellt' }).click();
}
const row = (page: Page, id: string) => page.getByRole('list', { name: 'Behöver dig' }).locator(`#work-${id}`);

test.describe("a card shows the person's own action at once (D64)", () => {
  test.use({ viewport: desktop });

  test('Avfärda takes the card out of the stream before the server has answered, and the toast confirms when it has', async ({
    page,
    api,
  }) => {
    api.mutationDelay = 1_500;
    await open(page, '/todo');
    const omtanke = row(page, 'omtanke');
    await expect(omtanke).toBeVisible();
    await dismiss(page, omtanke);
    await expect(omtanke).toHaveCount(0, { timeout: 700 });
    // Focus has moved on (2.4.3) and the toast with Ångra is the way back, as before.
    await expect(page.locator(':focus')).toHaveCount(1);
    // The item leaves the pane with its row (D112: the queue lets go of it), so the focus lands on the row after it.
    await expect(page.getByRole('complementary', { name: 'Valt ärende' })).toHaveCount(0);
    await expect(row(page, 'ledighet').getByRole('link')).toBeFocused();
    // The toast's words are also in Astryx's live region, so the toast is read from its own region.
    const toasts = page.getByRole('region', { name: 'Aviseringar' });
    await expect(toasts.getByText(/^Avfärdad som inte aktuellt/)).toBeVisible();
    await expect(toasts.getByRole('button', { name: 'Ångra' })).toBeVisible();
  });

  test('a request the server refuses brings the card back and says why', async ({ page, api }) => {
    api.mutationDelay = 1_500;
    api.mutationFails = true;
    await open(page, '/todo');
    const omtanke = row(page, 'omtanke');
    await dismiss(page, omtanke);
    await expect(omtanke).toHaveCount(0, { timeout: 700 });
    await expect(omtanke).toBeVisible();
    const toasts = page.getByRole('region', { name: 'Aviseringar' });
    await expect(toasts.getByText('Källan svarade inte.')).toBeVisible();
    // The reason is announced at once, as an error should be (4.1.3).
    await expect(page.getByRole('alert').filter({ hasText: 'Källan svarade inte.' }).first()).toBeVisible();
    await expect(toasts.getByRole('button', { name: 'Ångra' })).toHaveCount(0);
  });
});

test.describe('on a phone the work item is alone on the page (D112 item 12)', () => {
  test.use({ viewport: phone, hasTouch: true, isMobile: true });

  test('Avfärda leads back to the list without the item, and the focus lands on the row after it', async ({
    page,
    api,
  }) => {
    api.mutationDelay = 1_500;
    await open(page, '/todo');
    await dismiss(page, row(page, 'omtanke'));
    await expect(page.getByRole('heading', { level: 1, name: 'Omtankesamtal med Anna Lindqvist' })).toHaveCount(0);
    await expect(row(page, 'omtanke')).toHaveCount(0, { timeout: 700 });
    await expect(row(page, 'ledighet').getByRole('link')).toBeFocused();
  });
});
