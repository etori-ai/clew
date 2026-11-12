import type { Page } from '@playwright/test';
import type { MockApi } from './support';
import { composer, desktop, expect, expectNoAxeViolations, narrow, open, phone, reflowProblems, test } from './support';

/** The invoice card as a connector that asks for a review one row at a time declares it (D70). */
const reviewed = (api: MockApi) => {
  const card = api.threads.find(t => t.id === 'fakturor')!;
  card.actions = card.actions.map(a =>
    a.id === 'approve' ? { ...a, review: 'each' as const, preview: 'finance.preview' } : a,
  );
};

test.describe('confirmed review completion', () => {
  test.use({ viewport: desktop });
  for (const reducedMotion of ['no-preference', 'reduce'] as const) {
    test(`a confirmed receipt shows a check and respects ${reducedMotion} motion`, async ({ page, api }) => {
      await page.emulateMedia({ reducedMotion });
      reviewed(api);
      await open(page, '/todo?item=fakturor&review=fakturor');
      const review = page.getByRole('dialog', { name: 'Granska 3 rader' });
      await review.getByRole('button', { name: 'Attestera', exact: true }).click();
      await review.getByRole('button', { name: 'Lämna kvar', exact: true }).click();
      await review.getByRole('button', { name: 'Lämna kvar', exact: true }).click();
      await expect(review.getByText('Redo att skicka', { exact: true })).toBeVisible();
      await expect(review.getByRole('status', { name: 'Bekräftat av källan' })).toHaveCount(0);
      await review.getByRole('button', { name: 'Attestera 1', exact: true }).click();
      const completion = review.getByRole('status', { name: 'Bekräftat av källan' });
      await expect(completion).toBeVisible();
      const check = completion.getByRole('img', { name: 'Klart' });
      const animation = await check.evaluate(el => ({
        name: getComputedStyle(el).animationName,
        duration: getComputedStyle(el).animationDuration,
      }));
      if (reducedMotion === 'reduce')
        expect(animation.name === 'none' || animation.duration.split(',').every(value => parseFloat(value) === 0)).toBe(
          true,
        );
      else expect(animation.name).not.toBe('none');
      await expect(completion).toContainText('1 faktura attesterad');
      if (reducedMotion === 'no-preference') await page.screenshot({ path: 'test-results/review-completed.png' });
      await expect(page).toHaveURL('/todo?item=fakturor');
      await expect(review).toHaveCount(0);
    });
  }
  test('an uncertain source result never shows the success animation', async ({ page, api }) => {
    reviewed(api);
    let completionShown = false;
    await page.exposeFunction('recordCompletion', () => {
      completionShown = true;
    });
    await page.addInitScript(() => {
      new MutationObserver(() => {
        if (document.querySelector('[aria-label="Bekräftat av källan"]'))
          (window as unknown as { recordCompletion(): void }).recordCompletion();
      }).observe(document, { childList: true, subtree: true });
    });
    await page.route('**/api/threads/fakturor/act', async route => {
      const card = api.threads.find(t => t.id === 'fakturor')!;
      const refs = route.request().postDataJSON().refs as string[];
      const next = {
        ...card,
        state: 'handled' as const,
        receipt: {
          at: '2026-11-04T08:00:00.000Z',
          headline: 'Resultatet kunde inte bekräftas',
          undoUntil: null,
          undoCapability: null,
          rows: refs.map(ref => ({ ref, label: ref, outcome: 'unknown' as const, detail: 'Källan svarade inte.' })),
        },
      };
      api.threads = api.threads.map(t => (t.id === card.id ? next : t));
      await route.fulfill({ json: { kind: 'execute', thread: next } });
    });
    await open(page, '/todo?item=fakturor&review=fakturor');
    const review = page.getByRole('dialog', { name: 'Granska 3 rader' });
    await review.getByRole('button', { name: 'Attestera', exact: true }).click();
    await review.getByRole('button', { name: 'Hoppa över', exact: true }).click();
    await review.getByRole('button', { name: 'Hoppa över', exact: true }).click();
    await review.getByRole('button', { name: 'Attestera 1', exact: true }).click();
    await expect(page).toHaveURL('/todo?item=fakturor');
    expect(completionShown).toBe(false);
  });
});

for (const [layout, viewport] of [
  ['desktop', desktop],
  ['phone', narrow],
] as const) {
  test.describe('review batch navigation on ' + layout, () => {
    test.use({ viewport });
    for (const count of [4, 5, 10]) {
      test(`${count} invoices keep readable progress and allow jumping through the overview`, async ({ page, api }) => {
        reviewed(api);
        const card = api.threads.find(t => t.id === 'fakturor')!;
        card.items = Array.from({ length: count }, (_, index) => ({
          ...card.items[0]!,
          ref: `invoice-${index}`,
          label: `Leverantör ${index + 1} · 1 000 kr`,
        }));
        await open(page, '/todo?item=fakturor&review=fakturor');
        const review = page.getByRole('dialog', { name: `Granska ${count} rader` });
        await expect(review.getByRole('button', { name: 'Attestera', exact: true })).toBeEnabled();
        await expect(review.getByRole('list', { name: 'Rader', exact: true })).toHaveCount(count < 5 ? 1 : 0);
        await expect(review.getByRole('progressbar', { name: 'Bedömda rader' })).toHaveCount(count >= 5 ? 1 : 0);
        expect(await reflowProblems(page, review)).toEqual([]);
        if (count === 10) {
          await expectNoAxeViolations(page);
          await page.screenshot({ path: `test-results/review-ten-${layout}.png` });
        }
        await review.getByRole('button', { name: 'Översikt', exact: true }).click();
        await review.getByRole('button', { name: `Granska rad ${count}:`, exact: false }).click();
        await expect(page).toHaveURL(`/todo?item=fakturor&review=fakturor&step=${count}`);
        await expect(review.getByRole('heading', { name: `Leverantör ${count} · 1 000 kr` })).toBeVisible();
        await review.getByRole('button', { name: 'Attestera', exact: true }).click();
        await expect(review.getByRole('list', { name: 'Hittills' })).toContainText('Vald för godkännande');
        await expect(review.getByRole('button', { name: 'Attestera 1', exact: true })).toBeEnabled();
        expect(card.state).toBe('open');
      });
    }
  });
}

test.describe('rows with a document are reviewed one at a time in a drawer over the page, and the receipt earns the check (D70, D73 amended, D111 rule 5)', () => {
  test.use({ viewport: desktop });

  test('Granska on a work item in Att göra opens the review over the queue, each row is decided beside its document with the step in the address, one button writes, and the queue keeps the row in place with the receipt before it goes to Klart', async ({
    page,
    api,
  }) => {
    reviewed(api);
    await open(page, '/todo');
    await page.locator('#work-fakturor').getByRole('link').click();
    await page.getByRole('complementary', { name: 'Valt ärende' }).getByRole('link', { name: 'Granska 3' }).click();
    // A drawer over Att göra, in its own address (D111 rule 5): named by its title, the queue under the scrim with the
    // item in its pane, so its row is the current one; the ✕ is the one close, and no "Spara och stäng" in words.
    await expect(page).toHaveURL('/todo?item=fakturor&review=fakturor');
    const review = page.getByRole('dialog', { name: 'Granska 3 rader' });
    await expect(review).toBeVisible();
    await expect(review.getByRole('heading', { level: 2, name: 'Granska 3 rader' })).toBeVisible();
    await expect(review).toContainText('Attestera 3 fakturor, 48 200 kr · inget skrivs förrän du skickar');
    await expect(review).toContainText('Dina val skickas i sista steget.');
    await expect(page).toHaveTitle('Granska 3 rader · Startsidan');
    await expect(page.locator('#work-fakturor')).toHaveAttribute('aria-current', 'true');
    await expect(review.getByRole('button', { name: 'Stäng', exact: true })).toBeVisible();
    await expect(review.getByRole('button', { name: 'Spara och stäng' })).toHaveCount(0);
    // The document is read from the connector and named; the row's one next step holds the focus, so Enter takes it.
    await expect(review.getByRole('img', { name: /Energibolaget AB/ })).toBeVisible();
    const attest = review.getByRole('button', { name: 'Attestera', exact: true });
    await expect(attest).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL('/todo?item=fakturor&review=fakturor&step=2');
    await expect(review.getByRole('heading', { name: 'Skolmaterial Norrland AB · 18 300 kr' })).toBeVisible();
    await review.getByRole('button', { name: 'Lämna kvar' }).click();
    await expect(page).toHaveURL('/todo?item=fakturor&review=fakturor&step=3');
    await expect(review.getByRole('heading', { name: 'Städservice Mitt AB · 8 500 kr' })).toBeVisible();
    await review.getByRole('button', { name: 'Attestera', exact: true }).click();
    // The last step says what was chosen, and nothing has been written yet.
    await expect(page).toHaveURL('/todo?item=fakturor&review=fakturor&step=4');
    await expect(review.getByRole('heading', { name: 'Det du valt' })).toBeVisible();
    await expect(review).toContainText('2 av 3 skickas, 1 lämnas kvar');
    await expectNoAxeViolations(page);
    await review.getByRole('button', { name: 'Attestera 2' }).click();
    // Back in Att göra with the item in its pane: the row keeps its place with the receipt and its state, the card
    // carries Ångra, the toast says where the card went; then the row leaves. The steps were replaced, so Back leaves
    // the item.
    await expect(page).toHaveURL('/todo?item=fakturor');
    await expect(review).toHaveCount(0);
    const hemRow = page.getByRole('list', { name: 'Behöver dig' }).locator('#work-fakturor');
    await expect(hemRow).toContainText('2 fakturor attesterade');
    await expect(hemRow.getByRole('img', { name: 'Klart' })).toBeVisible();
    const card = page.getByRole('complementary', { name: 'Valt ärende' });
    // The receipt is on the item, row by row, with its Ångra and the time left (D112 item 4, board ActReceipt).
    await expect(card.getByRole('button', { name: /^Ångra · \d+ min kvar$/ })).toBeVisible();
    await expect(card.getByRole('list', { name: 'Kvitto, rad för rad' }).getByRole('listitem')).toHaveCount(2);
    const toasts = page.getByRole('region', { name: 'Aviseringar' });
    await expect(toasts.getByText(/^2 fakturor attesterade\. Ärendet ligger under Klart\./)).toBeVisible();
    await expect(toasts.getByRole('button', { name: 'Ångra' })).toBeVisible();
    await expect(toasts.getByRole('link', { name: 'Visa' })).toBeVisible();
    await expect(hemRow).toHaveCount(0, { timeout: 5_000 });
    await page.goBack();
    await expect(page).not.toHaveURL(/review=/);
  });

  test('Esc on a step leads back to the card with the decisions as its selection, writes nothing, and gives the focus back to Granska', async ({
    page,
    api,
  }) => {
    reviewed(api);
    await open(page, '/todo?item=fakturor');
    const card = page.getByRole('complementary', { name: 'Valt ärende' });
    await card.getByRole('link', { name: 'Granska 3' }).click();
    const review = page.getByRole('dialog', { name: 'Granska 3 rader' });
    await review.getByRole('button', { name: 'Lämna kvar' }).click();
    await review.getByRole('button', { name: 'Attestera', exact: true }).click();
    await review.getByRole('button', { name: 'Föregående' }).click();
    await expect(page).toHaveURL('/todo?item=fakturor&review=fakturor&step=2');
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL('/todo?item=fakturor');
    await expect(review).toHaveCount(0);
    const boxes = card.getByRole('checkbox');
    await expect(boxes.nth(0)).not.toBeChecked();
    await expect(boxes.nth(1)).toBeChecked();
    await expect(boxes.nth(2)).not.toBeChecked();
    await expect(card.getByRole('link', { name: 'Granska 3' })).toBeFocused();
    await expect(page.getByRole('region', { name: 'Aviseringar' }).getByText(/attesterade/)).toHaveCount(0);
    expect(api.threads.find(t => t.id === 'fakturor')!.state).toBe('open');
  });

  test('the address opens a step directly and survives a reload, the address from before leads there, Föregående rewrites it, ✕ leads back to the card, and a card or a step that is not there says so in the drawer', async ({
    page,
    api,
  }) => {
    reviewed(api);
    // A link from before the review lay over its page (D73 amended): the work item in Att göra with the review over it,
    // at its step (D112).
    await open(page, '/cards/fakturor/review?step=2');
    await expect(page).toHaveURL('/todo?item=fakturor&review=fakturor&step=2');
    const review = page.getByRole('dialog', { name: 'Granska 3 rader' });
    await expect(review.getByRole('heading', { name: 'Skolmaterial Norrland AB · 18 300 kr' })).toBeVisible();
    await expect(review.getByText('2 av 3', { exact: true })).toBeVisible();
    await expect(review.getByRole('img', { name: /Skolmaterial Norrland AB/ })).toBeVisible();
    // Under the drawer stands what `/todo?item=fakturor` draws.
    await expect(page.locator('#work-fakturor')).toHaveAttribute('aria-current', 'true');
    await page.reload();
    await expect(review.getByRole('heading', { name: 'Skolmaterial Norrland AB · 18 300 kr' })).toBeVisible();
    await review.getByRole('button', { name: 'Föregående' }).click();
    await expect(page).toHaveURL('/todo?item=fakturor&review=fakturor');
    await expect(review.getByRole('heading', { name: 'Energibolaget AB · 21 400 kr' })).toBeVisible();
    await review.getByRole('button', { name: 'Attestera', exact: true }).click();
    await review.getByRole('button', { name: 'Stäng', exact: true }).click();
    await expect(page).toHaveURL('/todo?item=fakturor');
    const card = page.getByRole('complementary', { name: 'Valt ärende' });
    await expect(card.getByRole('checkbox').nth(0)).toBeChecked();
    await expect(card.getByRole('link', { name: 'Granska 3' })).toBeFocused();

    await open(page, '/todo?item=fakturor&review=fakturor&step=9');
    const noStep = page.getByRole('dialog', { name: 'Steget finns inte' });
    await expect(noStep.getByRole('heading', { level: 2, name: 'Steget finns inte' })).toBeVisible();
    await expect(noStep.getByRole('link', { name: 'Till första steget' })).toHaveAttribute(
      'href',
      '/todo?item=fakturor&review=fakturor',
    );
    await expectNoAxeViolations(page);
    await noStep.getByRole('button', { name: 'Stäng', exact: true }).click();
    await expect(page).toHaveURL('/todo?item=fakturor');

    await open(page, '/todo?item=okand&review=okand');
    const noCard = page.getByRole('dialog', { name: 'Ärendet finns inte' });
    await expect(noCard.getByRole('heading', { level: 2, name: 'Ärendet finns inte' })).toBeVisible();
    await expect(page).toHaveTitle('Ärendet finns inte · Startsidan');
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL('/todo');
    await expect(noCard).toHaveCount(0);
  });

  test('a card without a review has nothing to review', async ({ page, api }) => {
    expect(api.threads.find(t => t.id === 'fakturor')!.actions.some(a => a.review)).toBe(false);
    await open(page, '/todo?item=fakturor&review=fakturor');
    await expect(
      page.getByRole('dialog', { name: 'Ärendet finns inte' }).getByRole('heading', { name: 'Ärendet finns inte' }),
    ).toBeVisible();
  });
});

test.describe('the review where the work item stands beside the queue (D73 amended, D112)', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('the item is the reading pane beside the list under the drawer, and Esc gives the focus back to its Granska', async ({
    page,
    api,
  }) => {
    reviewed(api);
    await open(page, '/todo?item=fakturor&review=fakturor&step=2');
    const review = page.getByRole('dialog', { name: 'Granska 3 rader' });
    await expect(review.getByRole('heading', { name: 'Skolmaterial Norrland AB · 18 300 kr' })).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Ärende' })).toHaveCount(0);
    await expect(page.getByRole('complementary', { name: 'Valt ärende' })).toHaveCount(1);
    await review.getByRole('button', { name: 'Attestera', exact: true }).click();
    await expect(page).toHaveURL('/todo?item=fakturor&review=fakturor&step=3');
    await expectNoAxeViolations(page);
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL('/todo?item=fakturor');
    // The approved row is ticked; the rows the review never judged are as the source marked them (amended 2026-11-11).
    const card = page.getByRole('complementary', { name: 'Valt ärende' });
    await expect(card.getByRole('checkbox').nth(1)).toBeChecked();
    await expect(card.getByRole('checkbox').nth(0)).toBeChecked();
    await expect(card.getByRole('checkbox').nth(2)).not.toBeChecked();
    await expect(card.getByRole('link', { name: 'Granska 3' })).toBeFocused();
  });

  test('a review opened and closed with nothing judged leaves the card as it was, and a row left behind loses its tick', async ({
    page,
    api,
  }) => {
    reviewed(api);
    await open(page, '/todo?item=fakturor');
    const card = page.getByRole('complementary', { name: 'Valt ärende' });
    const boxes = card.getByRole('checkbox');
    // The source marks the two rows that match an order.
    await expect(boxes.nth(0)).toBeChecked();
    await expect(boxes.nth(1)).toBeChecked();
    await expect(boxes.nth(2)).not.toBeChecked();
    await card.getByRole('link', { name: 'Granska 3' }).click();
    const review = page.getByRole('dialog', { name: 'Granska 3 rader' });
    await expect(review).toBeVisible();
    await review.getByRole('button', { name: 'Stäng', exact: true }).click();
    await expect(page).toHaveURL('/todo?item=fakturor');
    await expect(review).toHaveCount(0);
    await expect(boxes.nth(0)).toBeChecked();
    await expect(boxes.nth(1)).toBeChecked();
    await expect(boxes.nth(2)).not.toBeChecked();
    await expect(card.getByRole('link', { name: 'Granska 3' })).toBeFocused();
    // A tick the person set on the card stands through a review too; a row left behind in it loses its own.
    await boxes.nth(2).check();
    await card.getByRole('link', { name: 'Granska 3' }).click();
    await review.getByRole('button', { name: 'Lämna kvar' }).click();
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL('/todo?item=fakturor');
    await expect(boxes.nth(0)).not.toBeChecked();
    await expect(boxes.nth(1)).toBeChecked();
    await expect(boxes.nth(2)).toBeChecked();
  });
});

test.describe('the review lies over the page it was opened on and closes to it as it was (D111 rule 5)', () => {
  test.use({ viewport: desktop });
  const invoices = (page: Page) => page.getByRole('article', { name: 'Ärende: Attestera 3 fakturor, 48 200 kr' });

  test('Granska on a card beside Personal stays over Personal and closes to that card, with the focus on Granska', async ({
    page,
    api,
  }) => {
    reviewed(api);
    await open(page, '/staff?card=fakturor');
    const granska = invoices(page).getByRole('link', { name: 'Granska 3' });
    await expect(granska).toHaveAttribute('href', '/staff?card=fakturor&review=fakturor');
    await granska.click();
    await expect(page).toHaveURL('/staff?card=fakturor&review=fakturor');
    const review = page.getByRole('dialog', { name: 'Granska 3 rader' });
    await expect(review.getByRole('heading', { level: 2, name: 'Granska 3 rader' })).toBeVisible();
    await expect(page).toHaveTitle('Granska 3 rader · Startsidan');
    // Personal stays the page under it; nothing leads to Hem.
    await expect(page.getByRole('heading', { level: 1, name: 'Personal' })).toBeAttached();
    await expect(page.getByRole('heading', { level: 1, name: /^Hej / })).toHaveCount(0);
    await expectNoAxeViolations(page);
    await review.getByRole('button', { name: 'Lämna kvar' }).click();
    await page.keyboard.press('Escape');
    await expect(review).toHaveCount(0);
    await expect(page).toHaveURL('/staff?card=fakturor');
    await expect(page).toHaveTitle('Personal · Startsidan');
    // The row left behind loses its tick on the card, and the focus is back on the card's Granska.
    await expect(invoices(page).getByRole('checkbox').nth(0)).not.toBeChecked();
    await expect(granska).toBeFocused();
    expect(api.threads.find(t => t.id === 'fakturor')!.state).toBe('open');
  });

  test('Granska on a card in an answer lies over the conversation and closes to it', async ({ page, api }) => {
    reviewed(api);
    await open(page, '/');
    await composer(page).fill('attestera en faktura');
    await composer(page).press('Enter');
    const card = invoices(page);
    await expect(card).toBeVisible();
    await expect(page).toHaveURL(/\/conversations\/[^/?]+$/);
    const conversation = new URL(page.url()).pathname;
    await card.getByRole('link', { name: 'Granska 3' }).click();
    await expect(page).toHaveURL(`${conversation}?review=fakturor`);
    const review = page.getByRole('dialog', { name: 'Granska 3 rader' });
    await expect(review).toBeVisible();
    await review.getByRole('button', { name: 'Stäng', exact: true }).click();
    await expect(review).toHaveCount(0);
    await expect(page).toHaveURL(conversation);
    await expect(page.getByRole('article', { name: /^Assistenten/ })).toContainText('saknar beställning');
    await expect(card.getByRole('link', { name: 'Granska 3' })).toBeFocused();
  });

  test("over the shell's drawer on Kalender Esc closes the review, then the card, and Kalender stays", async ({
    page,
    api,
  }) => {
    reviewed(api);
    await open(page, '/calendar?card=fakturor');
    const drawer = page.getByRole('dialog', { name: 'Ärende' });
    const granska = drawer.getByRole('link', { name: 'Granska 3' });
    await granska.click();
    await expect(page).toHaveURL('/calendar?card=fakturor&review=fakturor');
    const review = page.getByRole('dialog', { name: 'Granska 3 rader' });
    await expect(review.getByRole('button', { name: 'Attestera', exact: true })).toBeFocused();
    await expectNoAxeViolations(page);
    await page.keyboard.press('Escape');
    await expect(review).toHaveCount(0);
    await expect(page).toHaveURL('/calendar?card=fakturor');
    await expect(granska).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
    await expect(page).toHaveURL(/\/calendar$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Vecka' })).toBeVisible();
  });
});

test.describe('the review on a phone: a tall sheet over the work item alone (D73, second amendment, D112)', () => {
  test.use({ viewport: phone });

  test('Granska on the item opens the review over it, the steps follow the address, and Esc leads back to the item with the selection and the focus on Granska', async ({
    page,
    api,
  }) => {
    reviewed(api);
    await open(page, '/todo');
    await page.locator('#work-fakturor').getByRole('link').click();
    await expect(page).toHaveURL('/todo?item=fakturor');
    // Where the pane does not fit the item is its page, alone on the surface (D112 item 12).
    const card = page.getByRole('main');
    await expect(page.getByRole('heading', { level: 1, name: 'Attestera 3 fakturor, 48 200 kr' })).toBeVisible();
    await expect(card).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await card.getByRole('link', { name: 'Granska 3' }).click();
    await expect(page).toHaveURL('/todo?item=fakturor&review=fakturor');
    const review = page.getByRole('dialog', { name: 'Granska 3 rader' });
    await expect(review).toBeVisible();
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
    expect(paper!.y).toBeLessThan(button!.y);
    await expect(attest).toBeInViewport();
    await expectNoAxeViolations(page);
    await review.getByRole('button', { name: 'Lämna kvar' }).click();
    await expect(page).toHaveURL('/todo?item=fakturor&review=fakturor&step=2');
    await expect(review.getByRole('heading', { name: 'Skolmaterial Norrland AB · 18 300 kr' })).toBeVisible();
    await review.getByRole('button', { name: 'Attestera', exact: true }).click();
    await expect(page).toHaveURL('/todo?item=fakturor&review=fakturor&step=3');
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL('/todo?item=fakturor');
    await expect(review).toHaveCount(0);
    await expect(card).toBeVisible();
    const boxes = card.getByRole('checkbox');
    await expect(boxes.nth(0)).not.toBeChecked();
    await expect(boxes.nth(1)).toBeChecked();
    await expect(boxes.nth(2)).not.toBeChecked();
    await expect(card.getByRole('link', { name: 'Granska 3' })).toBeFocused();
    expect(api.threads.find(t => t.id === 'fakturor')!.state).toBe('open');
  });

  test('a cold open of a step lays the review over the item, and ✕ leads back to the item', async ({ page, api }) => {
    reviewed(api);
    await open(page, '/todo?item=fakturor&review=fakturor&step=2');
    const review = page.getByRole('dialog', { name: 'Granska 3 rader' });
    await expect(review.getByRole('heading', { name: 'Skolmaterial Norrland AB · 18 300 kr' })).toBeVisible();
    await expect(review.getByText('2 av 3', { exact: true })).toBeVisible();
    await expect(review.getByRole('heading', { name: 'Underlag från ekonomisystemet' })).toBeFocused();
    await expectNoAxeViolations(page);
    await review.getByRole('button', { name: 'Attestera', exact: true }).click();
    await expect(page).toHaveURL('/todo?item=fakturor&review=fakturor&step=3');
    await review.getByRole('button', { name: 'Stäng', exact: true }).click();
    await expect(page).toHaveURL('/todo?item=fakturor');
    await expect(review).toHaveCount(0);
    const card = page.getByRole('main');
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
    await open(page, '/todo?item=fakturor&review=fakturor');
    const review = page.getByRole('dialog', { name: 'Granska 3 rader' });
    await review.getByRole('button', { name: 'Attestera', exact: true }).click();
    await expect(page).toHaveURL('/todo?item=fakturor&review=fakturor&step=2');
    await expect(review).not.toHaveAttribute('data-sheet-stack');
    await page.setViewportSize(phone);
    // The item is alone on the page there (D112 item 12), so the review is the one sheet, with no stack under it.
    await expect(review.getByRole('heading', { name: 'Skolmaterial Norrland AB · 18 300 kr' })).toBeVisible();
    await expect(review).toContainText('1 av 3 bedömda');
    await review.getByRole('button', { name: 'Översikt', exact: true }).click();
    await expect(review.getByRole('list', { name: 'Hittills' })).toContainText('Vald för godkännande');
  });
});

test.describe('the review at 320 px', () => {
  test.use({ viewport: narrow });

  test('reflows without sideways scrolling', async ({ page, api }) => {
    reviewed(api);
    await open(page, '/todo?item=fakturor&review=fakturor');
    const review = page.getByRole('dialog', { name: 'Granska 3 rader' });
    await expect(review.getByRole('heading', { level: 2, name: 'Granska 3 rader' })).toBeVisible();
    expect(await reflowProblems(page)).toEqual([]);
  });
});
