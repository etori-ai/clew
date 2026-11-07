import type { Page } from '@playwright/test';
import type { MockApi } from './support';
import { desktop, expect, expectNoAxeViolations, narrow, open, phone, reflowProblems, test } from './support';

/** The invoice card as a connector that asks for a review one row at a time declares it (D70). */
const reviewed = (api: MockApi) => {
  const card = api.threads.find(t => t.id === 'fakturor')!;
  card.actions = card.actions.map(a =>
    a.id === 'approve' ? { ...a, review: 'each' as const, preview: 'finance.preview' } : a,
  );
};

test.describe('rows with a document are reviewed one at a time in a drawer over Hem, and the receipt earns the check (D70, D73 amended)', () => {
  test.use({ viewport: desktop });

  test('Granska opens the review over Hem at its own address, each row is decided beside its document with the step in the address, one button writes, and Hem keeps the row in place with the receipt before it goes to Klart', async ({
    page,
    api,
  }) => {
    reviewed(api);
    await open(page, '/');
    const row = page.getByRole('main').locator('#thread-fakturor');
    await row.getByRole('link', { name: 'Granska 3' }).click();
    // A drawer over Hem with an address of its own (D73 amended): named by its title, Hem under the scrim with the card
    // beside the column, so the row says "öppet bredvid"; the ✕ is the one close, and no "Spara och stäng" in words.
    await expect(page).toHaveURL('/cards/fakturor/review');
    const review = page.getByRole('dialog', { name: 'Granska 3 rader' });
    await expect(review).toBeVisible();
    await expect(review.getByRole('heading', { level: 2, name: 'Granska 3 rader' })).toBeVisible();
    await expect(review).toContainText('Attestera 3 fakturor, 48 200 kr · inget skrivs förrän du skickar');
    await expect(review).toContainText('Esc sparar och stänger. Inget skrivs till ekonomisystemet förrän du skickar.');
    await expect(page).toHaveTitle('Granska 3 rader · Startsidan');
    await expect(page.locator('#thread-fakturor')).toContainText('öppet bredvid');
    await expect(review.getByRole('button', { name: 'Stäng', exact: true })).toBeVisible();
    await expect(review.getByRole('button', { name: 'Spara och stäng' })).toHaveCount(0);
    // The document is read from the connector and named; the row's one next step holds the focus, so Enter takes it.
    await expect(review.getByRole('img', { name: /Energibolaget AB/ })).toBeVisible();
    const attest = review.getByRole('button', { name: 'Attestera', exact: true });
    await expect(attest).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL('/cards/fakturor/review?step=2');
    await expect(review.getByRole('heading', { name: 'Skolmaterial Norrland AB · 18 300 kr' })).toBeVisible();
    await review.getByRole('button', { name: 'Lämna kvar' }).click();
    await expect(page).toHaveURL('/cards/fakturor/review?step=3');
    await expect(review.getByRole('heading', { name: 'Städservice Mitt AB · 8 500 kr' })).toBeVisible();
    await review.getByRole('button', { name: 'Attestera', exact: true }).click();
    // The last step says what was chosen, and nothing has been written yet.
    await expect(page).toHaveURL('/cards/fakturor/review?step=4');
    await expect(review.getByRole('heading', { name: 'Det du valt' })).toBeVisible();
    await expect(review).toContainText('2 av 3 skickas, 1 lämnas kvar');
    await expectNoAxeViolations(page);
    await review.getByRole('button', { name: 'Attestera 2' }).click();
    // Back on Hem with the card beside it: the row keeps its place with the receipt and the check, the card carries
    // Ångra, the toast says where the card went; then the row leaves. The steps were replaced, so Back leaves Hem's card.
    await expect(page).toHaveURL('/?card=fakturor');
    await expect(review).toHaveCount(0);
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
    const review = page.getByRole('dialog', { name: 'Granska 3 rader' });
    await review.getByRole('button', { name: 'Lämna kvar' }).click();
    await review.getByRole('button', { name: 'Attestera', exact: true }).click();
    await review.getByRole('button', { name: 'Föregående' }).click();
    await expect(page).toHaveURL('/cards/fakturor/review?step=2');
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL('/?card=fakturor');
    await expect(review).toHaveCount(0);
    const boxes = card.getByRole('checkbox');
    await expect(boxes.nth(0)).not.toBeChecked();
    await expect(boxes.nth(1)).toBeChecked();
    await expect(boxes.nth(2)).not.toBeChecked();
    await expect(card.getByRole('link', { name: 'Granska 3' })).toBeFocused();
    await expect(page.getByRole('region', { name: 'Aviseringar' }).getByText(/attesterade/)).toHaveCount(0);
    expect(api.threads.find(t => t.id === 'fakturor')!.state).toBe('open');
  });

  test('the address opens a step directly and survives a reload, Föregående rewrites it, ✕ leads back to the card, and a card or a step that is not there says so in the drawer', async ({
    page,
    api,
  }) => {
    reviewed(api);
    await open(page, '/cards/fakturor/review?step=2');
    const review = page.getByRole('dialog', { name: 'Granska 3 rader' });
    await expect(review.getByRole('heading', { name: 'Skolmaterial Norrland AB · 18 300 kr' })).toBeVisible();
    await expect(review.getByText('2 av 3', { exact: true })).toBeVisible();
    await expect(review.getByRole('img', { name: /Skolmaterial Norrland AB/ })).toBeVisible();
    // Under the drawer stands what `/?card=fakturor` draws.
    await expect(page.locator('#thread-fakturor')).toContainText('öppet bredvid');
    await page.reload();
    await expect(review.getByRole('heading', { name: 'Skolmaterial Norrland AB · 18 300 kr' })).toBeVisible();
    await review.getByRole('button', { name: 'Föregående' }).click();
    await expect(page).toHaveURL('/cards/fakturor/review');
    await expect(review.getByRole('heading', { name: 'Energibolaget AB · 21 400 kr' })).toBeVisible();
    await review.getByRole('button', { name: 'Attestera', exact: true }).click();
    await review.getByRole('button', { name: 'Stäng', exact: true }).click();
    await expect(page).toHaveURL('/?card=fakturor');
    const card = page.getByRole('dialog', { name: 'Kort', exact: true });
    await expect(card.getByRole('checkbox').nth(0)).toBeChecked();
    await expect(card.getByRole('link', { name: 'Granska 3' })).toBeFocused();

    await open(page, '/cards/fakturor/review?step=9');
    const noStep = page.getByRole('dialog', { name: 'Steget finns inte' });
    await expect(noStep.getByRole('heading', { level: 2, name: 'Steget finns inte' })).toBeVisible();
    await expect(noStep.getByRole('link', { name: 'Till första steget' })).toHaveAttribute(
      'href',
      '/cards/fakturor/review',
    );
    await expectNoAxeViolations(page);
    await noStep.getByRole('button', { name: 'Stäng', exact: true }).click();
    await expect(page).toHaveURL('/?card=fakturor');

    await open(page, '/cards/okand/review');
    const noCard = page.getByRole('dialog', { name: 'Kortet finns inte' });
    await expect(noCard.getByRole('heading', { level: 2, name: 'Kortet finns inte' })).toBeVisible();
    await expect(page).toHaveTitle('Kortet finns inte · Startsidan');
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL('/');
    await expect(noCard).toHaveCount(0);
  });

  test('a card without a review has nothing to review', async ({ page, api }) => {
    expect(api.threads.find(t => t.id === 'fakturor')!.actions.some(a => a.review)).toBe(false);
    await open(page, '/cards/fakturor/review');
    await expect(
      page.getByRole('dialog', { name: 'Kortet finns inte' }).getByRole('heading', { name: 'Kortet finns inte' }),
    ).toBeVisible();
  });
});

test.describe('the review where the card stands beside Hem (D73 amended)', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('the card is the panel beside the column under the drawer, and Esc gives the focus back to its Granska', async ({
    page,
    api,
  }) => {
    reviewed(api);
    await open(page, '/cards/fakturor/review?step=2');
    const review = page.getByRole('dialog', { name: 'Granska 3 rader' });
    await expect(review.getByRole('heading', { name: 'Skolmaterial Norrland AB · 18 300 kr' })).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Kort', exact: true })).toHaveCount(0);
    await review.getByRole('button', { name: 'Attestera', exact: true }).click();
    await expect(page).toHaveURL('/cards/fakturor/review?step=3');
    await expectNoAxeViolations(page);
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL('/?card=fakturor');
    const card = page.getByRole('complementary', { name: 'Kort' });
    await expect(card.getByRole('checkbox').nth(1)).toBeChecked();
    await expect(card.getByRole('checkbox').nth(0)).not.toBeChecked();
    await expect(card.getByRole('link', { name: 'Granska 3' })).toBeFocused();
  });
});

test.describe("the review on a phone: a tall sheet stacked over the card's sheet (D73, second amendment)", () => {
  test.use({ viewport: phone });

  /** The card's sheet, found by its dialog: covered by the review it is inert and hidden, so not by its role. */
  const cardSheet = (page: Page) => page.locator('dialog[aria-label="Kort: Attestera 3 fakturor, 48 200 kr"]');

  test("Granska in the card's sheet opens the review over it, the steps follow the address, and Esc leads back into the card's sheet with the selection and the focus on Granska", async ({
    page,
    api,
  }) => {
    reviewed(api);
    await open(page, '/');
    await page
      .locator('#thread-fakturor')
      .getByRole('link', { name: 'Attestera 3 fakturor, 48 200 kr', exact: true })
      .click();
    await expect(page).toHaveURL('/?card=fakturor');
    const card = page.getByRole('dialog', { name: 'Kort: Attestera 3 fakturor, 48 200 kr' });
    await expect(card).toBeVisible();
    await card.getByRole('link', { name: 'Granska 3' }).click();
    await expect(page).toHaveURL('/cards/fakturor/review');
    // Two sheets, one stack: the review on top with the focus, the card's sheet receding beneath it and inert.
    const review = page.getByRole('dialog', { name: 'Granska 3 rader' });
    await expect(review).toBeVisible();
    await expect(review).toHaveAttribute('data-sheet-stack', 'top');
    await expect(cardSheet(page)).toHaveAttribute('data-sheet-stack', 'covered');
    await expect(cardSheet(page)).toHaveAttribute('inert', '');
    await expect(review.getByRole('heading', { level: 2, name: 'Granska 3 rader' })).toBeVisible();
    await expect(review).toContainText('Attestera 3 fakturor, 48 200 kr · inget skrivs förrän du skickar');
    await expect(review.getByRole('button', { name: 'Stäng', exact: true })).toBeVisible();
    // The phone drops the footer's sentence about Esc; the decision's own line says nothing is written yet.
    await expect(review).not.toContainText('Esc sparar och stänger');
    // The document above the decision; on a phone a step opens on its document, not on the verb under it, so the
    // document is in view and the verb is a thumb's reach below (D73, second amendment).
    const img = review.getByRole('img', { name: /Energibolaget AB/ });
    await expect(img).toBeVisible();
    const attest = review.getByRole('button', { name: 'Attestera', exact: true });
    await expect(review.getByRole('heading', { name: 'Underlag från ekonomisystemet' })).toBeFocused();
    await expect(attest).not.toHaveAttribute('data-autofocus', '');
    const [paper, button] = [await img.boundingBox(), await attest.boundingBox()];
    expect(paper!.y + paper!.height).toBeLessThanOrEqual(button!.y);
    await expectNoAxeViolations(page);
    await review.getByRole('button', { name: 'Lämna kvar' }).click();
    await expect(page).toHaveURL('/cards/fakturor/review?step=2');
    await expect(review.getByRole('heading', { name: 'Skolmaterial Norrland AB · 18 300 kr' })).toBeVisible();
    await review.getByRole('button', { name: 'Attestera', exact: true }).click();
    await expect(page).toHaveURL('/cards/fakturor/review?step=3');
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL('/?card=fakturor');
    await expect(review).toHaveCount(0);
    await expect(card).toBeVisible();
    const boxes = card.getByRole('checkbox');
    await expect(boxes.nth(0)).not.toBeChecked();
    await expect(boxes.nth(1)).toBeChecked();
    await expect(boxes.nth(2)).not.toBeChecked();
    await expect(card.getByRole('link', { name: 'Granska 3' })).toBeFocused();
    expect(api.threads.find(t => t.id === 'fakturor')!.state).toBe('open');
  });

  test("a cold open of a step stacks the review over the card's sheet, and ✕ leads back into the card's sheet", async ({
    page,
    api,
  }) => {
    reviewed(api);
    await open(page, '/cards/fakturor/review?step=2');
    const review = page.getByRole('dialog', { name: 'Granska 3 rader' });
    await expect(review.getByRole('heading', { name: 'Skolmaterial Norrland AB · 18 300 kr' })).toBeVisible();
    await expect(review.getByText('2 av 3', { exact: true })).toBeVisible();
    // Both sheets opened in one update: tree order puts the review on top.
    await expect(review).toHaveAttribute('data-sheet-stack', 'top');
    await expect(cardSheet(page)).toHaveAttribute('data-sheet-stack', 'covered');
    await expect(review.getByRole('heading', { name: 'Underlag från ekonomisystemet' })).toBeFocused();
    await expectNoAxeViolations(page);
    await review.getByRole('button', { name: 'Attestera', exact: true }).click();
    await expect(page).toHaveURL('/cards/fakturor/review?step=3');
    await review.getByRole('button', { name: 'Stäng', exact: true }).click();
    await expect(page).toHaveURL('/?card=fakturor');
    await expect(review).toHaveCount(0);
    const card = page.getByRole('dialog', { name: 'Kort: Attestera 3 fakturor, 48 200 kr' });
    await expect(card).toBeVisible();
    await expect(card.getByRole('checkbox').nth(1)).toBeChecked();
    await expect(card.getByRole('link', { name: 'Granska 3' })).toBeFocused();
  });
});

test.describe('the review across a resize (D73, second amendment)', () => {
  test.use({ viewport: desktop });

  test('narrowing to a phone swaps the drawer for the sheet and keeps the step and the decisions', async ({
    page,
    api,
  }) => {
    reviewed(api);
    await open(page, '/cards/fakturor/review');
    const review = page.getByRole('dialog', { name: 'Granska 3 rader' });
    await review.getByRole('button', { name: 'Attestera', exact: true }).click();
    await expect(page).toHaveURL('/cards/fakturor/review?step=2');
    await expect(review).not.toHaveAttribute('data-sheet-stack');
    await page.setViewportSize(phone);
    await expect(review).toHaveAttribute('data-sheet-stack', 'top');
    await expect(review.getByRole('heading', { name: 'Skolmaterial Norrland AB · 18 300 kr' })).toBeVisible();
    await expect(review.getByRole('list', { name: 'Hittills' })).toContainText('Godkänd');
  });
});

test.describe('the review at 320 px', () => {
  test.use({ viewport: narrow });

  test('reflows without sideways scrolling', async ({ page, api }) => {
    reviewed(api);
    await open(page, '/cards/fakturor/review');
    const review = page.getByRole('dialog', { name: 'Granska 3 rader' });
    await expect(review.getByRole('heading', { level: 2, name: 'Granska 3 rader' })).toBeVisible();
    expect(await reflowProblems(page)).toEqual([]);
  });
});
