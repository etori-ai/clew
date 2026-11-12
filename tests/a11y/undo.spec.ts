import { desktop, expect, expectNoAxeViolations, open, openNav, test } from './support';

test.describe('a decision the card is left waiting on keeps its way back where the card lies (D70 amended)', () => {
  test.use({ viewport: desktop });
  test('toast undo keeps a rejected request visible and succeeds when retried', async ({ page, api }) => {
    await open(page, '/?card=samtal');
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

  test('sending the invitations keeps the row with the receipt and Ångra, the toast says the card is under Väntar på andra, and the row there undoes it', async ({
    page,
    api: _,
  }) => {
    await open(page, '/?card=samtal');
    // The open card has its own id (D50); on this viewport it is in the drawer over the page.
    const card = page.locator('#card-samtal');
    await card.getByRole('button', { name: 'Skicka 2 inbjudningar' }).click();
    // The row keeps its place for a moment with what was done; its one control is still the ✕ of the open card (D66), and
    // the open card has its own Ångra allt.
    const row = page.getByRole('main').locator('#thread-samtal');
    await expect(row).toContainText('2 av 2 kalenderändringar är bekräftade · Kalendern svarade');
    await expect(row.getByRole('button', { name: 'Stäng kortet' })).toBeVisible();
    await expect(card.getByRole('button', { name: /^Ångra allt · / })).toBeVisible();
    // The toast says where the card went, with the way there and the way back, and stays until closed.
    const toasts = page.getByRole('region', { name: 'Aviseringar' });
    await expect(
      toasts.getByText(/^2 av 2 kalenderändringar är bekräftade\. Kortet ligger under Väntar på andra\./),
    ).toBeVisible();
    await expect(toasts.getByRole('button', { name: 'Ångra' })).toBeVisible();
    await expect(toasts.getByRole('link', { name: 'Visa' })).toHaveAttribute('href', /tab=waiting/);
    // Then the row leaves the start page's list for Väntar på andra; closed, the card is found there with the receipt
    // and the way back. The tabs are on Mina aktiviteter (D115 item 4), reached from the header's own row.
    await expect(row).toHaveCount(0, { timeout: 5_000 });
    await page
      .getByRole('dialog', { name: 'Kort', exact: true })
      .getByRole('button', { name: 'Stäng', exact: true })
      .click();
    await (await openNav(page)).getByRole('link', { name: 'Mina aktiviteter' }).click();
    await expect(page).toHaveURL(/\/activities$/);
    const waitingTab = page.getByRole('tab', { name: /^Väntar på andra/ });
    await waitingTab.click();
    const waitingBefore = Number((await waitingTab.textContent())!.match(/(\d+)$/)![1]);
    const waiting = page.getByRole('main').locator('#thread-samtal');
    await expect(waiting).toContainText('Kalendern svarade');
    await expect(waiting).toContainText('väntar på svar från medarbetarna');
    await expect(waiting.getByRole('button', { name: 'Påminn mig' })).toBeVisible();
    await expectNoAxeViolations(page);
    await waiting.getByRole('button', { name: /^Ångra · / }).click();
    // Undone, the card is back under Behöver dig with its proposals, and nothing waits on anyone.
    await expect(waiting).toHaveCount(0);
    // The tab's count badge (D115 item 4) has one card fewer.
    await expect(waitingTab).toHaveText(new RegExp(`^Väntar på andra.*\\D${waitingBefore - 1}$`));
    await page.getByRole('tab', { name: /^Behöver dig/ }).click();
    const back = page.getByRole('main').locator('#thread-samtal');
    await expect(back).toBeVisible();
    await expect(back).not.toContainText('Kalendern svarade');
  });
});
