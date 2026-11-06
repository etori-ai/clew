import type { MockApi } from './support';
import { desktop, expect, expectNoAxeViolations, open, test } from './support';

/** The invoice card as a connector that asks for a review one row at a time declares it (D70). */
const reviewed = (api: MockApi) => {
  const card = api.threads.find(t => t.id === 'fakturor')!;
  card.actions = card.actions.map(a =>
    a.id === 'approve' ? { ...a, review: 'each' as const, preview: 'finance.preview' } : a,
  );
};

test.describe('rows with a document are reviewed one at a time, and the receipt earns the check (D70)', () => {
  test.use({ viewport: desktop });

  test('Granska opens the review, each row is decided beside its document, one button writes, and the row keeps its place with the receipt before it goes to Klart', async ({
    page,
    api,
  }) => {
    reviewed(api);
    await open(page, '/');
    const row = page.getByRole('main').locator('#thread-fakturor');
    await row.getByRole('button', { name: 'Granska 3' }).click();
    const dialog = page.getByRole('dialog', { name: 'Granska 3 rader' });
    await expect(dialog).toBeVisible();
    // The document is read from the connector and named; the row's one next step holds the focus, so Enter takes it.
    await expect(dialog.getByRole('img', { name: /Energibolaget AB/ })).toBeVisible();
    const attest = dialog.getByRole('button', { name: 'Attestera', exact: true });
    await expect(attest).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(dialog.getByRole('heading', { name: 'Skolmaterial Norrland AB · 18 300 kr' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Lämna kvar' }).click();
    await expect(dialog.getByRole('heading', { name: 'Städservice Mitt AB · 8 500 kr' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Attestera', exact: true }).click();
    // The last step says what was chosen, and nothing has been written yet.
    await expect(dialog.getByRole('heading', { name: 'Det du valt' })).toBeVisible();
    await expect(dialog).toContainText('2 av 3 skickas, 1 lämnas kvar');
    await expectNoAxeViolations(page);
    await dialog.getByRole('button', { name: 'Attestera 2' }).click();
    await expect(dialog).toHaveCount(0);
    // The row keeps its place with the receipt, the check and Ångra; the toast says where the card went; then the row leaves.
    await expect(row).toContainText('2 fakturor attesterade · ekonomisystemet svarade');
    await expect(row.getByRole('img', { name: 'Klart' })).toBeVisible();
    await expect(row.getByRole('button', { name: /^Ångra · / })).toBeVisible();
    const toasts = page.getByRole('region', { name: 'Aviseringar' });
    await expect(toasts.getByText(/^2 fakturor attesterade\. Kortet ligger under Klart\./)).toBeVisible();
    await expect(toasts.getByRole('button', { name: 'Ångra' })).toBeVisible();
    await expect(toasts.getByRole('link', { name: 'Visa' })).toBeVisible();
    await expect(row).toHaveCount(0, { timeout: 5_000 });
  });

  test('Esc keeps the decisions as the selection on the card, writes nothing, and gives the focus back', async ({
    page,
    api,
  }) => {
    reviewed(api);
    await open(page, '/?card=fakturor');
    const card = page.getByRole('dialog', { name: 'Kort', exact: true });
    await card.getByRole('button', { name: 'Granska 3' }).click();
    const dialog = page.getByRole('dialog', { name: 'Granska 3 rader' });
    await dialog.getByRole('button', { name: 'Lämna kvar' }).click();
    await dialog.getByRole('button', { name: 'Attestera', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    const boxes = card.getByRole('checkbox');
    await expect(boxes.nth(0)).not.toBeChecked();
    await expect(boxes.nth(1)).toBeChecked();
    await expect(boxes.nth(2)).not.toBeChecked();
    await expect(card.getByRole('button', { name: 'Granska 3' })).toBeFocused();
    await expect(page.getByRole('region', { name: 'Aviseringar' }).getByText(/attesterade/)).toHaveCount(0);
  });
});
