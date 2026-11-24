import { desktop, expect, expectNoAxeViolations, open, test } from './support';

test.describe('a decision the card is left waiting on keeps its way back where the card lies (D70 amended)', () => {
  test.use({ viewport: desktop });
  test('toast undo keeps a failed request visible and succeeds when retried', async ({ page, api }) => {
    await open(page, '/todo?item=samtal');
    await page.locator('#card-samtal').getByRole('button', { name: 'Skicka 2 inbjudningar' }).click();
    // The toast comes with the calendar's answer, which carries the way back.
    const toasts = page.getByRole('region', { name: 'Aviseringar' });
    const undo = toasts.getByRole('button', { name: 'Ångra', exact: true });
    await expect(undo).toBeVisible();
    // The server fails the request as the routes fail what is nobody's input (`context.ts`).
    await page.route('**/api/threads/samtal/undo-receipt', route =>
      route.fulfill({ status: 503, json: { error: 'Något gick fel. Försök igen.' } }),
    );
    await undo.click();
    await expect(toasts.getByRole('alert')).toContainText('Något gick fel. Försök igen.');
    await expect(undo).toBeVisible();
    expect(api.threads.find(t => t.id === 'samtal')!.receipt).not.toBeNull();
    await page.unroute('**/api/threads/samtal/undo-receipt');
    await undo.click();
    // The undo is a decision of its own: Ångra goes at once, and the receipt once the calendar has cancelled.
    await expect(undo).toHaveCount(0);
    await expect.poll(() => api.threads.find(t => t.id === 'samtal')!.receipt).toBeNull();
    const card = page.locator('#card-samtal');
    await expect(card.getByText('2 av 2 kalenderändringar är bekräftade')).toHaveCount(0);
    // The undone invitations are proposed times again (DE-L17): the card sends them once more, or draws another week.
    await expect(card.getByRole('button', { name: 'Skicka 2 inbjudningar' })).toBeVisible();
    await expect(card.getByRole('button', { name: /^Vecka \d+ i stället$/ })).toBeVisible();
  });

  test('the receipt’s toast stays when the person moves on, and its Visa leads to the item’s page with the page they are on as the way back (D126 rule 1)', async ({
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
      .getByRole('navigation', { name: 'Mina sidor', exact: true })
      .getByRole('link', { name: 'Kalender', exact: true })
      .click();
    await expect(page.getByRole('heading', { level: 1, name: 'Vecka' })).toBeVisible();
    // Elsewhere nothing opens over the page (D126 rule 3): Visa is the item's own page, Kalender its way back.
    await expect(show).toHaveAttribute('href', '/items/samtal?from=%2Fcalendar');
    await show.click();
    await expect(page).toHaveURL('/items/samtal?from=%2Fcalendar');
    await expect(page.getByRole('main').locator('#card-samtal')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(
      page
        .getByRole('main')
        .getByRole('link', { name: /Kalender/ })
        .first(),
    ).toHaveAttribute('href', '/calendar');
    await page.goBack();
    await expect(page).toHaveURL('/calendar');
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
    // The queue is a table whose piles are tabs (D126 rule 2, the `table-inbox` template).
    const row = page.getByRole('table', { name: 'Behöver dig' }).locator('#work-samtal');
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
    const waiting = page.getByRole('table', { name: 'Väntar på andra' }).locator('#work-samtal');
    await expect(waiting).toContainText('kalenderändringar är bekräftade');
    // Its Status column says the vocabulary's word alone (D126 item 13): whom it waits on is the notice's.
    await expect(waiting.getByText('Väntar', { exact: true })).toBeVisible();
    await expectNoAxeViolations(page);
    await waiting.getByRole('link').click();
    await pane
      .locator('#card-samtal')
      .getByRole('button', { name: /^Ångra allt · / })
      .click();
    // Undone, the item is back under Behöver dig without its receipt, and nothing waits on anyone.
    await expect(waiting).toHaveCount(0);
    await page
      .getByRole('navigation', { name: 'Urval' })
      .getByRole('link', { name: /^Behöver dig/ })
      .click();
    const back = page.getByRole('table', { name: 'Behöver dig' }).locator('#work-samtal');
    await expect(back).toBeVisible();
    await expect(back).not.toContainText('kalenderändringar är bekräftade');
    // The undone invitations are proposed times again, so the item, opened again, sends them once more (DE-L17).
    await back.getByRole('link', { name: 'Planera utvecklingssamtal' }).click();
    await expect(pane.locator('#card-samtal').getByRole('button', { name: 'Skicka 2 inbjudningar' })).toBeVisible();
  });
});
