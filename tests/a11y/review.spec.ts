import type { Page } from '@playwright/test';
import type { MockApi } from './support';
import {
  announcements,
  composer,
  desktop,
  expect,
  expectNoAxeViolations,
  narrow,
  open,
  phone,
  reflowProblems,
  test,
} from './support';

/** The invoice card as a connector that asks for a review one row at a time declares it (D70). */
const reviewed = (api: MockApi) => {
  const card = api.threads.find(t => t.id === 'fakturor')!;
  card.actions = card.actions.map(a =>
    a.id === 'approve' ? { ...a, review: 'each' as const, preview: 'finance.preview' } : a,
  );
  return card;
};
/** The same card with `count` invoices. */
const invoices = (api: MockApi, count: number) => {
  const card = reviewed(api);
  card.items = Array.from({ length: count }, (_, index) => ({
    ...card.items[0]!,
    ref: `invoice-${index}`,
    label: `Leverantör ${index + 1} · 1 000 kr`,
  }));
  return card;
};
const ROWS = ['Energibolaget AB · 21 400 kr', 'Skolmaterial Norrland AB · 18 300 kr', 'Städservice Mitt AB · 8 500 kr'];
const FROM_TODO = '/items/fakturor/review?from=%2Ftodo%3Fitem%3Dfakturor';
const pane = (page: Page) => page.getByRole('complementary', { name: 'Valt ärende' });
const title = (page: Page, name: string) => page.getByRole('heading', { level: 1, name });
const rowHeading = (page: Page, name: string) => page.getByRole('heading', { level: 2, name });
const verb = (page: Page) => page.getByRole('button', { name: 'Attestera', exact: true });
const soFar = (page: Page) => page.getByRole('list', { name: 'Hittills' });
const draftOf = (page: Page) => page.evaluate(() => window.sessionStorage.getItem('clew.review.fakturor'));

test.describe('the review is a page with its own address (D70, D73 amended 2026-11-12)', () => {
  test.use({ viewport: desktop });

  test('Granska on the work item in Att göra leads to the page; the keyboard takes each row beside its document, the step in the address; Skicka writes once, shows the check and leads back to the item with its receipt', async ({
    page,
    api,
  }) => {
    reviewed(api);
    await open(page, '/todo');
    await page.locator('#work-fakturor').getByRole('link').click();
    const granska = pane(page).getByRole('link', { name: 'Granska 3' });
    await expect(granska).toHaveAttribute('href', FROM_TODO);
    await granska.click();
    // A page in the shell, not a dialog: its title is the h1 and the tab's, the way back names Att göra.
    await expect(page).toHaveURL(FROM_TODO);
    await expect(title(page, 'Granska 3 rader')).toBeVisible();
    await expect(page).toHaveTitle('Granska 3 rader · Startsidan');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('main')).toContainText(
      'Attestera 3 fakturor, 48 200 kr · inget skrivs förrän du skickar',
    );
    await expect(page.getByRole('main').getByRole('link', { name: 'Att göra' })).toHaveAttribute(
      'href',
      '/todo?item=fakturor',
    );
    await expect(page.getByRole('list', { name: 'Rader', exact: true })).toBeVisible();
    await expect(page.getByRole('complementary', { name: 'Hittills' })).toBeVisible();
    // The document is read from the connector and named; the row's one next step holds the focus, so Enter takes it.
    await expect(page.getByRole('img', { name: /Energibolaget AB/ })).toBeVisible();
    await expect(verb(page)).toBeFocused();
    await expect.poll(() => announcements(page)).toContainEqual(expect.stringContaining('Granska 3 rader'));
    await page.screenshot({ path: 'test-results/review-page-desktop.png' });
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(`${FROM_TODO}&step=2`);
    await expect(rowHeading(page, ROWS[1]!)).toBeVisible();
    await expect(verb(page)).toBeFocused();
    await expect.poll(() => announcements(page)).toContainEqual(expect.stringContaining('2 av 3'));
    await page.getByRole('button', { name: 'Lämna kvar' }).click();
    await expect(page).toHaveURL(`${FROM_TODO}&step=3`);
    await expect(rowHeading(page, ROWS[2]!)).toBeVisible();
    await verb(page).focus();
    await page.keyboard.press('Enter');
    // The last step says what was chosen, and nothing has been written yet.
    await expect(page).toHaveURL(`${FROM_TODO}&step=4`);
    await expect(rowHeading(page, 'Det du valt')).toBeVisible();
    await expect(page.getByRole('main')).toContainText('2 av 3 skickas, 1 lämnas kvar');
    await expect(soFar(page).getByRole('listitem').nth(0)).toContainText('Vald för godkännande');
    await expect(soFar(page).getByRole('listitem').nth(1)).toContainText('Lämnas kvar');
    await expect(page.getByRole('button', { name: 'Attestera 2' })).toBeFocused();
    expect(api.threads.find(t => t.id === 'fakturor')!.state).toBe('open');
    await expectNoAxeViolations(page);
    await page.keyboard.press('Enter');
    // The source's answer is read back: the check, then the item in Att göra with the row keeping its place with the
    // receipt and Ångra; the toast says where the item went. The draft has done its work.
    await expect(page.getByRole('status', { name: 'Bekräftat av källan' })).toContainText('2 fakturor attesterade');
    await expect(page).toHaveURL('/todo?item=fakturor');
    expect(api.acted.at(-1)?.body.refs).toEqual(['finance:inv:1', 'finance:inv:3']);
    const row = page.getByRole('list', { name: 'Behöver dig' }).locator('#work-fakturor');
    await expect(row).toContainText('Klart · 2 fakturor attesterade');
    await expect(pane(page).getByRole('button', { name: /^Ångra · \d+ min kvar$/ })).toBeVisible();
    await expect(pane(page).getByRole('list', { name: 'Kvitto, rad för rad' }).getByRole('listitem')).toHaveCount(2);
    const toasts = page.getByRole('region', { name: 'Aviseringar' });
    await expect(toasts.getByText(/^2 fakturor attesterade\. Ärendet ligger under Klart\./)).toBeVisible();
    expect(await draftOf(page)).toBeNull();
    // The review left by Back's own way: one step back is the queue before the item, and Forward is the sent review,
    // read, not decided.
    await page.goBack();
    await expect(page).toHaveURL('/todo');
    await page.goForward();
    await page.goForward();
    await expect(page).toHaveURL(`${FROM_TODO}&step=4`);
    await expect(title(page, 'Visa 3 rader')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Attestera/ })).toHaveCount(0);
  });

  test('12 rows: a progress bar instead of steps, the keyboard through every row, Hittills beside the document, and a decision changed from it', async ({
    page,
    api,
  }) => {
    invoices(api, 12);
    await open(page, '/todo?item=fakturor');
    await pane(page).getByRole('link', { name: 'Granska 12' }).click();
    await expect(title(page, 'Granska 12 rader')).toBeVisible();
    await expect(page.getByRole('list', { name: 'Rader', exact: true })).toHaveCount(0);
    const progress = page.getByRole('progressbar', { name: 'Bedömda rader' });
    await expect(progress).toHaveAttribute('aria-valuenow', '0');
    await expect(soFar(page).getByRole('listitem')).toHaveCount(12);
    for (let n = 1; n <= 12; n++) {
      await expect(rowHeading(page, `Leverantör ${n} · 1 000 kr`)).toBeVisible();
      await expect(page.getByText(`${n} av 12`, { exact: true })).toBeVisible();
      await expect(verb(page)).toBeFocused();
      if (n === 6) {
        await expectNoAxeViolations(page);
        expect(await reflowProblems(page)).toEqual([]);
        await page.screenshot({ path: 'test-results/review-page-twelve.png' });
      }
      await page.keyboard.press('Enter');
    }
    await expect(rowHeading(page, 'Det du valt')).toBeVisible();
    await expect(progress).toHaveAttribute('aria-valuenow', '12');
    await expect(page.getByRole('main')).toContainText('12 av 12 skickas');
    // Changing an earlier decision: Ändra on its row in Hittills, then Lämna kvar there.
    await page.getByRole('button', { name: 'Ändra rad 5: Leverantör 5 · 1 000 kr' }).click();
    await expect(page).toHaveURL(/step=5$/);
    await page.getByRole('button', { name: 'Lämna kvar' }).click();
    await expect(rowHeading(page, 'Leverantör 6 · 1 000 kr')).toBeVisible();
    await page.getByRole('button', { name: 'Översikt', exact: true }).click();
    await expect(page.getByRole('main')).toContainText('11 av 12 skickas, 1 lämnas kvar');
    await expect(soFar(page).getByRole('listitem').nth(4)).toContainText('Lämnas kvar');
    await expect(page.getByRole('button', { name: 'Attestera 11' })).toBeEnabled();
    expect(api.acted).toHaveLength(0);
  });

  test('the decisions are kept: through a reload, Back and Forward between the item and the steps, and a way out and back; the item says the review is begun and goes on where it stopped', async ({
    page,
    api,
  }) => {
    reviewed(api);
    await open(page, '/todo');
    await page.locator('#work-fakturor').getByRole('link').click();
    await pane(page).getByRole('link', { name: 'Granska 3' }).click();
    await page.getByRole('button', { name: 'Lämna kvar' }).click();
    await verb(page).click();
    await expect(page).toHaveURL(`${FROM_TODO}&step=3`);
    await page.reload();
    await expect(rowHeading(page, ROWS[2]!)).toBeVisible();
    await expect(page.getByText('2 av 3 bedömda')).toBeVisible();
    await expect(soFar(page).getByRole('listitem').nth(0)).toContainText('Lämnas kvar');
    await expect(soFar(page).getByRole('listitem').nth(1)).toContainText('Vald för godkännande');
    // Back to the item: "Fortsätt granska", to the first row not judged; the decisions as its ticks.
    await page.goBack();
    await expect(page).toHaveURL('/todo?item=fakturor');
    const going = pane(page).getByRole('link', { name: 'Fortsätt granska' });
    await expect(going).toHaveAttribute('href', `${FROM_TODO}&step=3`);
    await expect(pane(page).getByRole('link', { name: 'Granska 3' })).toHaveCount(0);
    const boxes = pane(page).getByRole('checkbox');
    await expect(boxes.nth(0)).not.toBeChecked();
    await expect(boxes.nth(1)).toBeChecked();
    await expect(boxes.nth(2)).not.toBeChecked();
    // Forward is the review where it was.
    await page.goForward();
    await expect(rowHeading(page, ROWS[2]!)).toBeVisible();
    await expect(page.getByText('2 av 3 bedömda')).toBeVisible();
    // Out by the trail and in again by "Fortsätt granska".
    await page.getByRole('main').getByRole('link', { name: 'Att göra' }).click();
    await expect(page).toHaveURL('/todo?item=fakturor');
    await going.click();
    await expect(rowHeading(page, ROWS[2]!)).toBeVisible();
    await verb(page).click();
    await expect(page.getByRole('main')).toContainText('2 av 3 skickas, 1 lämnas kvar');
    // A person opened on the way, and back: the same.
    await open(page, '/staff');
    await open(page, '/todo?item=fakturor');
    await expect(pane(page).getByRole('link', { name: 'Fortsätt granska' })).toHaveAttribute(
      'href',
      `${FROM_TODO}&step=4`,
    );
    expect(api.acted).toHaveLength(0);
    expect(api.threads.find(t => t.id === 'fakturor')!.state).toBe('open');
  });

  test('a change to the rows takes the draft back: the item is another than the one decided on', async ({
    page,
    api,
  }) => {
    const card = reviewed(api);
    await open(page, '/todo?item=fakturor');
    await pane(page).getByRole('link', { name: 'Granska 3' }).click();
    await verb(page).click();
    await expect(page.getByText('1 av 3 bedömda')).toBeVisible();
    card.items = card.items.map((i, n) => (n === 0 ? { ...i, detail: 'Konto 4010 · förfaller 5 nov · ny summa' } : i));
    card.updatedAt = '2026-11-04T08:30:00.000Z';
    await page.reload();
    await expect(page.getByText('0 av 3 bedömda')).toBeVisible();
    await expect(soFar(page).getByRole('listitem').nth(0)).toContainText('Inte bedömd än');
    expect(await draftOf(page)).toBeNull();
  });

  test('Back from the page gives the focus to the control that was pressed: Granska N in Att göra, a row under Dokument on the item’s page', async ({
    page,
    api,
  }) => {
    reviewed(api);
    await open(page, '/todo?item=fakturor');
    const granska = pane(page).getByRole('link', { name: 'Granska 3' });
    await granska.focus();
    await page.keyboard.press('Enter');
    await expect(title(page, 'Granska 3 rader')).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL('/todo?item=fakturor');
    await expect(granska).toBeFocused();
    // On the item's page, from a row under Dokument: the page at that row, its way back the item's page by its title.
    await open(page, '/items/fakturor');
    const document = page
      .getByRole('region', { name: 'Dokument' })
      .getByRole('link', { name: `Öppna underlaget för ${ROWS[1]}` });
    await document.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL('/items/fakturor/review?from=%2Fitems%2Ffakturor&step=2');
    await expect(rowHeading(page, ROWS[1]!)).toBeVisible();
    await expect(page.getByRole('main').getByRole('link', { name: 'Attestera 3 fakturor, 48 200 kr' })).toHaveAttribute(
      'href',
      '/items/fakturor',
    );
    await expectNoAxeViolations(page);
    await page.goBack();
    await expect(page).toHaveURL('/items/fakturor');
    await expect(document).toBeFocused();
  });

  test('Granska on a card beside Personal and in a conversation’s answer leads to the page, and Back to where it was with the focus on Granska', async ({
    page,
    api,
  }) => {
    reviewed(api);
    const card = page.getByRole('article', { name: 'Ärende: Attestera 3 fakturor, 48 200 kr' });
    await open(page, '/staff?card=fakturor');
    const granska = card.getByRole('link', { name: 'Granska 3' });
    await expect(granska).toHaveAttribute('href', '/items/fakturor/review?from=%2Fstaff%3Fcard%3Dfakturor');
    await granska.click();
    await expect(title(page, 'Granska 3 rader')).toBeVisible();
    await expect(page.getByRole('main').getByRole('link', { name: 'Personal' })).toHaveAttribute(
      'href',
      '/staff?card=fakturor',
    );
    await page.getByRole('button', { name: 'Lämna kvar' }).click();
    await page.goBack();
    await expect(page).toHaveURL('/staff?card=fakturor');
    await expect(page).toHaveTitle('Personal · Startsidan');
    await expect(card.getByRole('link', { name: 'Fortsätt granska' })).toBeFocused();
    await expect(card.getByRole('checkbox').nth(0)).not.toBeChecked();

    await open(page, '/');
    await composer(page).fill('attestera en faktura');
    await composer(page).press('Enter');
    await expect(card).toBeVisible();
    await expect(page).toHaveURL(/\/conversations\/[^/?]+$/);
    const conversation = new URL(page.url()).pathname;
    await card.getByRole('link', { name: 'Fortsätt granska' }).click();
    await expect(page).toHaveURL(`/items/fakturor/review?from=${encodeURIComponent(conversation)}&step=2`);
    await page.goBack();
    await expect(page).toHaveURL(conversation);
    await expect(card.getByRole('link', { name: 'Fortsätt granska' })).toBeFocused();
  });

  test('a sent review is read on the page; a rejected row offers Granska avvisade igen, which puts the new item’s review in its place', async ({
    page,
    api,
  }) => {
    const card = reviewed(api);
    card.state = 'handled';
    card.handledAt = '2026-11-04T07:00:00.000Z';
    card.execution = {
      id: 'rejected-execution',
      decisionId: 'first',
      operation: 'finance.approve',
      state: 'partial',
      reason: null,
      compensates: null,
    };
    card.receipt = {
      at: '2026-11-04T07:00:00.000Z',
      headline: 'Två bekräftade, en avvisad.',
      undoUntil: null,
      undoCapability: null,
      rows: card.items.map((i, n) => ({
        ref: i.ref,
        label: i.label,
        outcome: n === 2 ? ('failed' as const) : ('done' as const),
        detail: n === 2 ? 'Beställningsnummer saknas.' : 'Attesterad.',
      })),
    };
    await page.route('**/api/threads/fakturor/retry', async route => {
      const retry = {
        ...card,
        id: 'retry:rejected-execution',
        topic: 'retry:rejected-execution',
        state: 'open' as const,
        handledAt: null,
        receipt: null,
        execution: null,
        items: [card.items[2]!],
      };
      api.threads.push(retry);
      await route.fulfill({ json: retry });
    });
    await open(page, '/todo?tab=done&item=fakturor');
    await pane(page).getByRole('link', { name: 'Visa granskning' }).click();
    await expect(title(page, 'Visa 3 rader')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Attestera|^Lämna kvar/ })).toHaveCount(0);
    await page.getByRole('button', { name: `Visa rad 3: ${ROWS[2]}` }).click();
    await expect(page.getByRole('main')).toContainText('Beställningsnummer saknas.');
    await expect(soFar(page).getByRole('listitem').nth(2)).toContainText('Avvisad');
    await expectNoAxeViolations(page);
    await page.getByRole('button', { name: 'Granska avvisade igen' }).click();
    await expect(page).toHaveURL(
      '/items/retry%3Arejected-execution/review?from=%2Ftodo%3Ftab%3Ddone%26item%3Dretry%253Arejected-execution',
    );
    await expect(title(page, 'Granska 1 rad')).toBeVisible();
    await expect(rowHeading(page, ROWS[2]!)).toBeVisible();
    await expect(verb(page)).toBeEnabled();
    // The new review took the old one's place in the history: Back is the item as it was before.
    await page.goBack();
    await expect(page).toHaveURL('/todo?tab=done&item=fakturor');
  });

  test('the addresses from before lead to the page, in their own place in the history; a step or an item that is not there says so', async ({
    page,
    api,
  }) => {
    reviewed(api);
    await open(page, '/todo?item=fakturor&review=fakturor&step=2');
    await expect(page).toHaveURL(`${FROM_TODO}&step=2`);
    await expect(rowHeading(page, ROWS[1]!)).toBeVisible();
    await expect(page.getByText('2 av 3', { exact: true })).toBeVisible();
    await open(page, '/staff?card=fakturor&review=fakturor');
    await expect(page).toHaveURL('/items/fakturor/review?from=%2Fstaff%3Fcard%3Dfakturor');
    await expect(page.getByRole('main').getByRole('link', { name: 'Personal' })).toBeVisible();
    await open(page, '/cards/fakturor/review?step=2');
    await expect(page).toHaveURL('/items/fakturor/review?step=2');
    await expect(rowHeading(page, ROWS[1]!)).toBeVisible();
    await expect(page.getByRole('main').getByRole('link', { name: 'Attestera 3 fakturor, 48 200 kr' })).toHaveAttribute(
      'href',
      '/items/fakturor',
    );
    // Replaced, not stepped through: Back is the page before the old address.
    await page.goBack();
    await expect(page).toHaveURL('/items/fakturor/review?from=%2Fstaff%3Fcard%3Dfakturor');

    await open(page, '/items/fakturor/review?step=9');
    await expect(title(page, 'Steget finns inte')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Till första steget' })).toHaveAttribute(
      'href',
      '/items/fakturor/review',
    );
    await expectNoAxeViolations(page);
    await open(page, '/items/okand/review');
    await expect(title(page, 'Ärendet finns inte')).toBeVisible();
    await expect(page).toHaveTitle('Ärendet finns inte · Startsidan');
  });

  test('a card without a review has nothing to review', async ({ page, api }) => {
    expect(api.threads.find(t => t.id === 'fakturor')!.actions.some(a => a.review)).toBe(false);
    await open(page, '/items/fakturor/review');
    await expect(title(page, 'Ärendet finns inte')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Till ärendet' })).toHaveAttribute('href', '/items/fakturor');
  });
});

test.describe('confirmed review completion', () => {
  test.use({ viewport: desktop });
  for (const reducedMotion of ['no-preference', 'reduce'] as const) {
    test(`a confirmed receipt shows a check and respects ${reducedMotion} motion`, async ({ page, api }) => {
      await page.emulateMedia({ reducedMotion });
      reviewed(api);
      await open(page, '/items/fakturor/review?from=%2Ftodo%3Fitem%3Dfakturor');
      await verb(page).click();
      await page.getByRole('button', { name: 'Lämna kvar', exact: true }).click();
      await page.getByRole('button', { name: 'Lämna kvar', exact: true }).click();
      await expect(page.getByText('Redo att skicka', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Attestera 1', exact: true }).click();
      const completion = page.getByRole('status', { name: 'Bekräftat av källan' });
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
      // Opened by its address, the page leads back to the item where it was shown, in its own place.
      await expect(page).toHaveURL('/todo?item=fakturor');
      await expect(completion).toHaveCount(0);
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
    await open(page, '/todo?item=fakturor');
    await pane(page).getByRole('link', { name: 'Granska 3' }).click();
    await verb(page).click();
    await page.getByRole('button', { name: 'Hoppa över', exact: true }).click();
    await page.getByRole('button', { name: 'Hoppa över', exact: true }).click();
    await page.getByRole('button', { name: 'Attestera 1', exact: true }).click();
    await expect(page).toHaveURL('/todo?item=fakturor');
    expect(completionShown).toBe(false);
  });
  test('a refusal from the source keeps the decisions and says why', async ({ page, api }) => {
    reviewed(api);
    api.actRefusal = 'Fakturan är redan attesterad i ekonomisystemet.';
    await open(page, '/items/fakturor/review');
    await verb(page).click();
    await verb(page).click();
    await page.getByRole('button', { name: 'Lämna kvar', exact: true }).click();
    await page.getByRole('button', { name: 'Attestera 2', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Fakturan är redan attesterad' })).toBeVisible();
    await expect(page.getByText('Kunde inte skicka', { exact: true })).toBeVisible();
    await expect(page.getByRole('main')).toContainText('2 av 3 skickas, 1 lämnas kvar');
    expect(await draftOf(page)).not.toBeNull();
  });
});

test.describe('the review on a phone: the same page, stacked (D73 amended 2026-11-12)', () => {
  test.use({ viewport: phone });

  test('Granska on the item leads to the page, no sheet; a step opens on its document with the verb pinned under it; Back gives the focus to Granska', async ({
    page,
    api,
  }) => {
    reviewed(api);
    await open(page, '/todo?item=fakturor');
    // Where the pane does not fit the item is its page, alone on the surface (D112 item 12).
    await expect(page.getByRole('heading', { level: 1, name: 'Attestera 3 fakturor, 48 200 kr' })).toBeVisible();
    const granska = page.getByRole('main').getByRole('link', { name: 'Granska 3' });
    await granska.click();
    await expect(page).toHaveURL(FROM_TODO);
    await expect(title(page, 'Granska 3 rader')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // The document above the decision; on a phone a step opens on its document, the verb a thumb's reach below it.
    const img = page.getByRole('img', { name: /Energibolaget AB/ });
    await expect(img).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Underlag från ekonomisystemet' })).toBeFocused();
    const [paper, button] = [await img.boundingBox(), await verb(page).boundingBox()];
    expect(paper!.y).toBeLessThan(button!.y);
    await expect(verb(page)).toBeInViewport();
    // Hittills is under the step, not beside it.
    await expect(page.getByRole('complementary', { name: 'Hittills' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Hittills' })).toBeAttached();
    await expectNoAxeViolations(page);
    await page.screenshot({ path: 'test-results/review-page-phone.png' });
    await page.getByRole('button', { name: 'Lämna kvar' }).click();
    await expect(page).toHaveURL(`${FROM_TODO}&step=2`);
    await expect(rowHeading(page, ROWS[1]!)).toBeVisible();
    await verb(page).click();
    await expect(page).toHaveURL(`${FROM_TODO}&step=3`);
    expect(await reflowProblems(page)).toEqual([]);
    await page.goBack();
    await expect(page).toHaveURL('/todo?item=fakturor');
    await expect(page.getByRole('main').getByRole('link', { name: 'Fortsätt granska' })).toBeFocused();
    const boxes = page.getByRole('main').getByRole('checkbox');
    await expect(boxes.nth(0)).not.toBeChecked();
    await expect(boxes.nth(1)).toBeChecked();
    expect(api.threads.find(t => t.id === 'fakturor')!.state).toBe('open');
  });

  test('narrowing a review to a phone keeps the step and the decisions', async ({ page, api }) => {
    reviewed(api);
    await page.setViewportSize(desktop);
    await open(page, '/items/fakturor/review');
    await verb(page).click();
    await expect(page).toHaveURL('/items/fakturor/review?step=2');
    await page.setViewportSize(phone);
    await expect(rowHeading(page, ROWS[1]!)).toBeVisible();
    await expect(page.getByText('1 av 3 bedömda')).toBeVisible();
    await expect(soFar(page).getByRole('listitem').nth(0)).toContainText('Vald för godkännande');
  });
});

test.describe('the review at 320 px', () => {
  test.use({ viewport: narrow });

  for (const [name, count] of [
    ['3 rows', 3],
    ['12 rows', 12],
  ] as const)
    test(`reflows without sideways scrolling, a step and the summary, with ${name}`, async ({ page, api }) => {
      invoices(api, count);
      await open(page, '/items/fakturor/review?from=%2Ftodo%3Fitem%3Dfakturor');
      await expect(title(page, `Granska ${count} rader`)).toBeVisible();
      await expect(page.getByRole('img', { name: /Leverantör 1/ })).toBeVisible();
      expect(await reflowProblems(page)).toEqual([]);
      await page.getByRole('button', { name: 'Översikt', exact: true }).click();
      await expect(rowHeading(page, 'Det du valt')).toBeVisible();
      expect(await reflowProblems(page)).toEqual([]);
      await expectNoAxeViolations(page);
    });
});
