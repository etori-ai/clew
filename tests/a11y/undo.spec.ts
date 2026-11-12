import { desktop, expect, expectNoAxeViolations, open, test } from './support';

test.describe('a decision the card is left waiting on keeps its way back where the card lies (D70 amended)', () => {
  test.use({ viewport: desktop });
  test('toast undo keeps a rejected request visible and succeeds when retried', async ({ page, api }) => {
    await open(page, '/todo?item=samtal');
    await page.locator('#card-samtal').getByRole('button', { name: 'Skicka 2 inbjudningar' }).click();
    const toasts = page.getByRole('region', { name: 'Aviseringar' });
    const undo = toasts.getByRole('button', { name: 'Ångra', exact: true });
    await expect(undo).toBeVisible();
    await page.route('**/api/threads/samtal/undo-receipt', route =>
      route.fulfill({ status: 409, json: { error: 'Källan svarar inte. Försök igen.' } }),
    );
    await undo.click();
    await expect(toasts.getByRole('alert')).toContainText('Källan svarar inte');
    await expect(undo).toBeVisible();
    expect(api.threads.find(t => t.id === 'samtal')!.receipt).not.toBeNull();
    await page.unroute('**/api/threads/samtal/undo-receipt');
    await undo.click();
    await expect(undo).toHaveCount(0);
    expect(api.threads.find(t => t.id === 'samtal')!.receipt).toBeNull();
    await expect(page.locator('#card-samtal').getByRole('button', { name: 'Skicka 2 inbjudningar' })).toBeVisible();
  });

  test('the receipt’s toast stays when the person moves on, and its Visa opens the card over the page they are on (D111)', async ({
    page,
    api: _,
  }) => {
    await open(page, '/todo?item=samtal');
    await page.locator('#card-samtal').getByRole('button', { name: 'Skicka 2 inbjudningar' }).click();
    const toasts = page.getByRole('region', { name: 'Aviseringar' });
    const show = toasts.getByRole('link', { name: 'Visa' });
    // In Att göra it leads to the pile the item went to, with the item in the reading pane (D112).
    await expect(show).toHaveAttribute('href', '/todo?tab=waiting&item=samtal');
    // The person goes to Kalender with the toast still there.
    await page
      .getByRole('navigation', { name: 'Sidonavigering' })
      .getByRole('link', { name: 'Kalender', exact: true })
      .click();
    await expect(page.getByRole('heading', { level: 1, name: 'Vecka' })).toBeVisible();
    await expect(show).toHaveAttribute('href', '/calendar?card=samtal');
    await show.click();
    await expect(page).toHaveURL('/calendar?card=samtal');
    await expect(page.getByRole('heading', { level: 1, name: 'Vecka' })).toBeAttached();
    await expect(page.getByRole('dialog', { name: 'Ärende' }).locator('#card-samtal')).toBeVisible();
  });

  test('sending the invitations keeps the row with the receipt and the item with Ångra, the toast says the card is under Väntar på andra, and the item there undoes it', async ({
    page,
    api: _,
  }) => {
    await open(page, '/todo?item=samtal');
    // The work item in Att göra's reading pane (D112 item 3).
    const pane = page.getByRole('complementary', { name: 'Valt ärende' });
    const card = pane.locator('#card-samtal');
    await card.getByRole('button', { name: 'Skicka 2 inbjudningar' }).click();
    // The row keeps its place for a moment with what was done, still the current one, and the item has Ångra allt.
    const row = page.getByRole('list', { name: 'Behöver dig' }).locator('#work-samtal');
    await expect(row).toContainText('2 av 2 kalenderändringar är bekräftade');
    await expect(row).toHaveAttribute('aria-current', 'true');
    await expect(card.getByRole('button', { name: /^Ångra allt · / })).toBeVisible();
    // The toast says where the card went, with the way there and the way back, and stays until closed.
    const toasts = page.getByRole('region', { name: 'Aviseringar' });
    await expect(
      toasts.getByText(/^2 av 2 kalenderändringar är bekräftade\. Ärendet ligger under Väntar på andra\./),
    ).toBeVisible();
    await expect(toasts.getByRole('button', { name: 'Ångra' })).toBeVisible();
    await expect(toasts.getByRole('link', { name: 'Visa' })).toHaveAttribute('href', /tab=waiting/);
    // Then the row leaves Behöver dig for Väntar på andra, where the item is found with the receipt and the way back.
    await expect(row).toHaveCount(0, { timeout: 5_000 });
    await page
      .getByRole('navigation', { name: 'Urval' })
      .getByRole('link', { name: /^Väntar på andra/ })
      .click();
    const waiting = page.getByRole('list', { name: 'Väntar på andra' }).locator('#work-samtal');
    await expect(waiting).toContainText('kalenderändringar är bekräftade');
    await expect(waiting.getByRole('img', { name: 'Väntar på andra' })).toBeVisible();
    await expectNoAxeViolations(page);
    await waiting.getByRole('link').click();
    await pane
      .locator('#card-samtal')
      .getByRole('button', { name: /^Ångra allt · / })
      .click();
    // Undone, the item is back under Behöver dig with its proposals, and nothing waits on anyone.
    await expect(waiting).toHaveCount(0);
    await page
      .getByRole('navigation', { name: 'Urval' })
      .getByRole('link', { name: /^Behöver dig/ })
      .click();
    const back = page.getByRole('list', { name: 'Behöver dig' }).locator('#work-samtal');
    await expect(back).toBeVisible();
    await expect(back).not.toContainText('kalenderändringar är bekräftade');
  });
});
