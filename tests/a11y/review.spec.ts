import type { MockApi } from './support';
import { desktop, expect, expectNoAxeViolations, narrow, open, phone, reflowProblems, test } from './support';

/** The invoice card as a connector that asks for a review one row at a time declares it (D70). */
const reviewed = (api: MockApi) => {
  const card = api.threads.find(t => t.id === 'fakturor')!;
  card.actions = card.actions.map(a =>
    a.id === 'approve' ? { ...a, review: 'each' as const, preview: 'finance.preview' } : a,
  );
};

test.describe('rows with a document are reviewed one at a time on a page of their own, and the receipt earns the check (D70, D73)', () => {
  test.use({ viewport: desktop });

  test('Granska leads to the review page, each row is decided beside its document with the step in the address, one button writes, and Hem keeps the row in place with the receipt before it goes to Klart', async ({
    page,
    api,
  }) => {
    reviewed(api);
    await open(page, '/');
    const row = page.getByRole('main').locator('#thread-fakturor');
    await row.getByRole('link', { name: 'Granska 3' }).click();
    // A page in the shell (D73): its own address, the title as the h1 and the document title, Hem current in the rail.
    await expect(page).toHaveURL('/cards/fakturor/review');
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { level: 1, name: 'Granska 3 rader' })).toBeVisible();
    await expect(page).toHaveTitle('Granska 3 rader · Startsidan');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('navigation').getByRole('link', { name: /^Hem/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
    // The document is read from the connector and named; the row's one next step holds the focus, so Enter takes it.
    await expect(main.getByRole('img', { name: /Energibolaget AB/ })).toBeVisible();
    const attest = main.getByRole('button', { name: 'Attestera', exact: true });
    await expect(attest).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL('/cards/fakturor/review?step=2');
    await expect(main.getByRole('heading', { name: 'Skolmaterial Norrland AB · 18 300 kr' })).toBeVisible();
    await main.getByRole('button', { name: 'Lämna kvar' }).click();
    await expect(page).toHaveURL('/cards/fakturor/review?step=3');
    await expect(main.getByRole('heading', { name: 'Städservice Mitt AB · 8 500 kr' })).toBeVisible();
    await main.getByRole('button', { name: 'Attestera', exact: true }).click();
    // The last step says what was chosen, and nothing has been written yet.
    await expect(page).toHaveURL('/cards/fakturor/review?step=4');
    await expect(main.getByRole('heading', { name: 'Det du valt' })).toBeVisible();
    await expect(main).toContainText('2 av 3 skickas, 1 lämnas kvar');
    await expectNoAxeViolations(page);
    await main.getByRole('button', { name: 'Attestera 2' }).click();
    // Back on Hem with the card beside it: the row keeps its place with the receipt and the check, the card carries
    // Ångra, the toast says where the card went; then the row leaves. The steps were replaced, so Back leaves Hem's card.
    await expect(page).toHaveURL('/?card=fakturor');
    const hemRow = page.getByRole('main').locator('#thread-fakturor');
    await expect(hemRow).toContainText('2 fakturor attesterade · ekonomisystemet svarade');
    await expect(hemRow.getByRole('img', { name: 'Klart' })).toBeVisible();
    const card = page.getByRole('dialog', { name: 'Kort', exact: true });
    await expect(card.getByRole('button', { name: /^Ångra allt · / })).toBeVisible();
    const toasts = page.getByRole('region', { name: 'Aviseringar' });
    await expect(toasts.getByText(/^2 fakturor attesterade\. Kortet ligger under Klart\./)).toBeVisible();
    await expect(toasts.getByRole('button', { name: 'Ångra' })).toBeVisible();
    await expect(toasts.getByRole('link', { name: 'Visa' })).toBeVisible();
    await expect(hemRow).toHaveCount(0, { timeout: 5_000 });
    await page.goBack();
    await expect(page).toHaveURL('/');
  });

  test('Esc on a step leads back to the card with the decisions as its selection, writes nothing, and gives the focus back to Granska', async ({
    page,
    api,
  }) => {
    reviewed(api);
    await open(page, '/?card=fakturor');
    const card = page.getByRole('dialog', { name: 'Kort', exact: true });
    await card.getByRole('link', { name: 'Granska 3' }).click();
    const main = page.getByRole('main');
    await main.getByRole('button', { name: 'Lämna kvar' }).click();
    await main.getByRole('button', { name: 'Attestera', exact: true }).click();
    await main.getByRole('button', { name: 'Föregående' }).click();
    await expect(page).toHaveURL('/cards/fakturor/review?step=2');
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL('/?card=fakturor');
    const boxes = card.getByRole('checkbox');
    await expect(boxes.nth(0)).not.toBeChecked();
    await expect(boxes.nth(1)).toBeChecked();
    await expect(boxes.nth(2)).not.toBeChecked();
    await expect(card.getByRole('link', { name: 'Granska 3' })).toBeFocused();
    await expect(page.getByRole('region', { name: 'Aviseringar' }).getByText(/attesterade/)).toHaveCount(0);
    expect(api.threads.find(t => t.id === 'fakturor')!.state).toBe('open');
  });

  test('the address opens a step directly, Föregående rewrites it, and a card or a step that is not there says so with the way home', async ({
    page,
    api,
  }) => {
    reviewed(api);
    await open(page, '/cards/fakturor/review?step=2');
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { name: 'Skolmaterial Norrland AB · 18 300 kr' })).toBeVisible();
    await expect(main.getByText('2 av 3', { exact: true })).toBeVisible();
    await expect(main.getByRole('img', { name: /Skolmaterial Norrland AB/ })).toBeVisible();
    await main.getByRole('button', { name: 'Föregående' }).click();
    await expect(page).toHaveURL('/cards/fakturor/review');
    await expect(main.getByRole('heading', { name: 'Energibolaget AB · 21 400 kr' })).toBeVisible();

    await open(page, '/cards/fakturor/review?step=9');
    await expect(main.getByRole('heading', { level: 1, name: 'Steget finns inte' })).toBeVisible();
    await expect(main.getByRole('link', { name: 'Till första steget' })).toHaveAttribute(
      'href',
      '/cards/fakturor/review',
    );
    await expectNoAxeViolations(page);

    await open(page, '/cards/okand/review');
    await expect(main.getByRole('heading', { level: 1, name: 'Kortet finns inte' })).toBeVisible();
    await expect(page).toHaveTitle('Kortet finns inte · Startsidan');
    await main.getByRole('link', { name: 'Till startsidan' }).click();
    await expect(page).toHaveURL('/');
  });

  test('a card without a review has no review page', async ({ page, api }) => {
    expect(api.threads.find(t => t.id === 'fakturor')!.actions.some(a => a.review)).toBe(false);
    await open(page, '/cards/fakturor/review');
    await expect(page.getByRole('main').getByRole('heading', { level: 1, name: 'Kortet finns inte' })).toBeVisible();
  });
});

test.describe('the review page on a phone (D73 item 4)', () => {
  test.use({ viewport: phone });

  test('the same page, the document above the decision, no axe violations', async ({ page, api }) => {
    reviewed(api);
    await open(page, '/cards/fakturor/review');
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { level: 1, name: 'Granska 3 rader' })).toBeVisible();
    const img = main.getByRole('img', { name: /Energibolaget AB/ });
    await expect(img).toBeVisible();
    const attest = main.getByRole('button', { name: 'Attestera', exact: true });
    const [paper, button] = [await img.boundingBox(), await attest.boundingBox()];
    expect(paper!.y + paper!.height).toBeLessThanOrEqual(button!.y);
    await expectNoAxeViolations(page);
  });
});

test.describe('the review page at 320 px', () => {
  test.use({ viewport: narrow });

  test('reflows without sideways scrolling', async ({ page, api }) => {
    reviewed(api);
    await open(page, '/cards/fakturor/review');
    await expect(page.getByRole('main').getByRole('heading', { level: 1, name: 'Granska 3 rader' })).toBeVisible();
    expect(await reflowProblems(page)).toEqual([]);
  });
});
