import { desktop, expect, expectNoAxeViolations, open, test } from './support';

test.describe('a decision the card is left waiting on keeps its way back where the card lies (D70 amended)', () => {
  test.use({ viewport: desktop });

  test('sending the invitations keeps the row with the receipt and Ångra, the toast says the card is under Väntar på andra, and the row there undoes it', async ({
    page,
    api: _,
  }) => {
    await open(page, '/?card=samtal');
    // The card open beside the page has its own id (D50); on this viewport the panel is no dialog.
    const card = page.locator('#card-samtal');
    await card.getByRole('button', { name: 'Skicka 2 inbjudningar' }).click();
    // The row keeps its place for a moment with what was done; its one control is still the ✕ of the open card (D66), and
    // the open card has its own Ångra allt.
    const row = page.getByRole('main').locator('#thread-samtal');
    await expect(row).toContainText('2 av 2 kalenderändringar är bekräftade · kalendern svarade');
    await expect(row.getByRole('button', { name: 'Stäng kortet' })).toBeVisible();
    await expect(card.getByRole('button', { name: /^Ångra allt · / })).toBeVisible();
    // The toast says where the card went, with the way there and the way back, and stays until closed.
    const toasts = page.getByRole('region', { name: 'Aviseringar' });
    await expect(
      toasts.getByText(/^2 av 2 kalenderändringar är bekräftade\. Kortet ligger under Väntar på andra\./),
    ).toBeVisible();
    await expect(toasts.getByRole('button', { name: 'Ångra' })).toBeVisible();
    await expect(toasts.getByRole('link', { name: 'Visa' })).toHaveAttribute('href', /tab=waiting/);
    // Then the row leaves Behöver dig for Väntar på andra; closed, the card is found there with the receipt and the way back.
    await expect(row).toHaveCount(0, { timeout: 5_000 });
    await page
      .getByRole('dialog', { name: 'Kort', exact: true })
      .getByRole('button', { name: 'Stäng', exact: true })
      .click();
    await page.getByRole('tab', { name: /^Väntar på andra/ }).click();
    const waiting = page.getByRole('main').locator('#thread-samtal');
    await expect(waiting).toContainText('kalendern svarade');
    await expect(waiting).toContainText('väntar på svar från medarbetarna');
    await expect(waiting.getByRole('button', { name: 'Påminn mig' })).toBeVisible();
    await expectNoAxeViolations(page);
    await waiting.getByRole('button', { name: /^Ångra · / }).click();
    // Undone, the card is back under Behöver dig with its proposals, and nothing waits on anyone.
    await expect(waiting).toHaveCount(0);
    await expect(page.getByRole('tab', { name: /^Väntar på andra/ })).not.toHaveText(/· \d/);
    await page.getByRole('tab', { name: /^Behöver dig/ }).click();
    const back = page.getByRole('main').locator('#thread-samtal');
    await expect(back).toBeVisible();
    await expect(back).not.toContainText('kalendern svarade');
  });
});
