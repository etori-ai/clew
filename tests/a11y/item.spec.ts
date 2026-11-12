import type { Page } from '@playwright/test';
import { desktop, expect, expectNoAxeViolations, narrow, open, phone, reflowProblems, short, test } from './support';

/**
 * A work item as a page (D111 item 4, board WorkItem, `/items/<threadId>`, the `work-item-detail` template): reached
 * with "Öppna som sida" from Att göra's reading pane and from the panel beside a page, with `from` as the way back. The
 * page is the item's header (the trail, the title, the status and badges, the buttons), the main column (Varför ser
 * jag detta?, the rows, Dokument, Händelser) and the details rail; at 1024 px and below the rail is behind "Visa
 * detaljer" in a fullscreen dialog, and on a phone the buttons are pinned to the foot (board PhoneItem, D111 item 12).
 */
const wide = { width: 1440, height: 900 };
const tablet = { width: 1024, height: 768 };
const INVOICES = 'Attestera 3 fakturor, 48 200 kr';

/** The headings' levels as assistive technology gets them, in document order. */
const outline = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]')]
      .filter(h => (h as HTMLElement).checkVisibility())
      .map(h => Number(h.getAttribute('aria-level') ?? h.tagName.slice(1))),
  );

test.describe('the work item as a page', () => {
  test.use({ viewport: wide });

  test('Öppna som sida leads from the reading pane to the page, which opens on its heading, keeps one outline and leads back to the pane', async ({
    page,
    api: _,
  }) => {
    await open(page, '/todo?item=fakturor');
    const pane = page.getByRole('complementary', { name: 'Valt ärende' });
    const asPage = pane.getByRole('link', { name: 'Öppna som sida' });
    await expect(asPage).toHaveAttribute('href', '/items/fakturor?from=%2Ftodo%3Fitem%3Dfakturor');
    await asPage.click();
    await expect(page).toHaveURL('/items/fakturor?from=%2Ftodo%3Fitem%3Dfakturor');
    const title = page.getByRole('heading', { level: 1, name: INVOICES });
    await expect(title).toBeFocused();
    await expect(page).toHaveTitle(`${INVOICES} · Startsidan`);
    // The rail says where the page belongs: Att göra.
    const rail = page.getByRole('navigation', { name: 'Sidonavigering' });
    await expect(rail.getByRole('link', { name: /^Att göra/ })).toHaveAttribute('aria-current', 'page');
    // One outline: the title, then the main column's sections and the rail's, each one level under it.
    const levels = await outline(page);
    expect(levels.filter(l => l === 1)).toHaveLength(1);
    for (let i = 1; i < levels.length; i++) expect(levels[i]! - levels[i - 1]!).toBeLessThanOrEqual(1);
    for (const name of ['Varför ser jag detta?', 'Rader', 'Händelser'])
      await expect(page.getByRole('heading', { level: 2, name })).toBeVisible();
    // The status as the queue's dot says it, with its word; the badges: when it is due and its area.
    await expect(page.getByRole('img', { name: 'Att göra i dag' }).first()).toBeVisible();
    await expect(page.getByText('Förfaller i dag', { exact: true })).toBeVisible();
    // The rows are a checklist with how many are chosen, the action's label counting them.
    await expect(page.getByText('2 av 3 valda', { exact: true })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: /Energibolaget AB/ })).toBeChecked();
    await expect(page.getByRole('button', { name: 'Attestera 2 valda' })).toBeVisible();
    // Händelser from the item's audit rows: Clew created it, with why.
    const events = page.getByRole('list', { name: 'Händelser, de senaste först' });
    await expect(events).toContainText('Clew');
    await expect(events).toContainText('skapade ärendet: Fakturorna förfaller i veckan');
    // The details rail: the facts the item has, and the way out to the source, marked as leaving Clew (D110 rule 8).
    const details = page.getByRole('complementary', { name: 'Detaljer' });
    await expect(details.locator('[aria-level="2"]').filter({ hasText: /^Detaljer$/ })).toBeVisible();
    for (const term of ['Status', 'Källa', 'Förfaller', 'Skapat']) await expect(details).toContainText(term);
    await expect(details).toContainText('4 november');
    await expect(
      details.getByRole('button', { name: /^Öppna i ekonomisystemet\s*\(öppnas i ny flik\)$/ }),
    ).toBeVisible();
    await expectNoAxeViolations(page);
    // From the title the keyboard reaches the rows before the source's link out in the rail.
    await page.keyboard.press('Tab');
    const order: string[] = [];
    for (let i = 0; i < 20 && !order.some(o => o.startsWith('Öppna i ekonomisystemet')); i++) {
      order.push(await page.evaluate(() => document.activeElement?.textContent?.trim() ?? ''));
      await page.keyboard.press('Tab');
    }
    expect(order.findIndex(o => o.startsWith('Attestera 2 valda'))).toBeGreaterThanOrEqual(0);
    // The trail leads back to the pane it was opened from.
    await page.getByRole('main').getByRole('link', { name: 'Att göra', exact: true }).click();
    await expect(page).toHaveURL('/todo?item=fakturor');
    await expect(pane.locator('#card-fakturor')).toBeVisible();
  });

  test('opened from a panel beside another page, its way back is that page; with no way back it is Att göra', async ({
    page,
    api: _,
  }) => {
    await open(page, '/staff?card=omtanke');
    const asPage = page.getByRole('link', { name: 'Öppna som sida' });
    await expect(asPage).toHaveAttribute('href', '/items/omtanke?from=%2Fstaff%3Fcard%3Domtanke');
    await asPage.click();
    await expect(page.getByRole('heading', { level: 1, name: 'Omtankesamtal med Anna Lindqvist' })).toBeFocused();
    const main = page.getByRole('main');
    await expect(main.getByRole('link', { name: 'Personal', exact: true })).toHaveAttribute(
      'href',
      '/staff?card=omtanke',
    );
    await open(page, '/items/omtanke');
    await expect(page.getByRole('main').getByRole('link', { name: 'Att göra', exact: true })).toHaveAttribute(
      'href',
      '/todo',
    );
    // An address from before D111 leads to the same page.
    await page.goto('/cards/omtanke');
    await expect(page).toHaveURL('/items/omtanke');
    await expect(page.getByRole('heading', { level: 1, name: 'Omtankesamtal med Anna Lindqvist' })).toBeVisible();
  });

  test('a decided item shows its receipt row by row, and its Händelser read the decision back', async ({
    page,
    api: _,
  }) => {
    await open(page, '/items/attest');
    await expect(page.getByRole('heading', { level: 1, name: 'Attesterade fakturor' })).toBeVisible();
    const receipt = page.getByRole('list', { name: 'Kvitto, rad för rad' });
    await expect(receipt.getByRole('listitem')).toHaveCount(2);
    await expect(receipt.getByRole('img', { name: 'Okänt' })).toBeVisible();
    await expect(page.getByText('2 fakturor attesterade', { exact: true })).toBeVisible();
    // A row the source did not confirm leaves no way back to undo: Ångra waits for the source's answer.
    await expect(page.getByRole('button', { name: /^Ångra/ })).toHaveCount(0);
    await expect(page.getByRole('list', { name: 'Händelser, de senaste först' })).toContainText(
      'fick inget säkert besked från Ekonomisystemet',
    );
    await expectNoAxeViolations(page);
  });

  test('an item that is not the person’s says so as the page', async ({ page, api: _ }) => {
    await open(page, '/items/okand');
    await expect(page.getByRole('heading', { level: 1, name: 'Ärendet finns inte' })).toBeVisible();
    await expect(page).toHaveTitle('Ärendet finns inte · Startsidan');
    await expectNoAxeViolations(page);
  });

  test('Händelser that cannot be read say so, with Försök igen, and the rest of the item stands', async ({
    page,
    api,
  }) => {
    api.itemEventsFail = true;
    await open(page, '/items/omtanke');
    const events = page.getByRole('region', { name: 'Händelser' });
    await expect(events.getByText('Källan svarade inte.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Boka samtalet' })).toBeVisible();
    api.itemEventsFail = false;
    await events.getByRole('button', { name: 'Försök igen' }).click();
    await expect(events.getByRole('list', { name: 'Händelser, de senaste först' })).toContainText('skapade ärendet');
  });
});

test.describe('the work item page where the rail does not fit', () => {
  test.use({ viewport: tablet });

  test('the details are behind Visa detaljer in a fullscreen dialog, which takes the focus and gives it back', async ({
    page,
    api: _,
  }) => {
    await open(page, '/items/fakturor');
    await expect(page.getByRole('complementary', { name: 'Detaljer' })).toHaveCount(0);
    const show = page.getByRole('button', { name: 'Visa detaljer' });
    await show.click();
    const dialog = page.getByRole('dialog', { name: 'Detaljer' });
    await expect(dialog).toBeVisible();
    await expect.poll(() => dialog.evaluate(d => d.contains(document.activeElement))).toBe(true);
    for (const term of ['Status', 'Källa', 'Förfaller', 'Skapat']) await expect(dialog).toContainText(term);
    await expectNoAxeViolations(page);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(show).toBeFocused();
    // The buttons stand under the status, in the page.
    await expect(page.getByRole('button', { name: 'Attestera 2 valda' })).toBeVisible();
  });
});

test.describe('the work item page on a phone (D111 item 12, board PhoneItem)', () => {
  test.use({ viewport: phone, hasTouch: true, isMobile: true });

  test('the buttons are pinned to the foot, the rest is under Fler val, and the details are behind the information button', async ({
    page,
    api: _,
  }) => {
    await open(page, '/items/fakturor');
    await expect(page.getByRole('heading', { level: 1, name: INVOICES })).toBeFocused();
    const step = page.getByRole('button', { name: 'Attestera 2 valda' });
    await expect(step).toBeInViewport();
    const box = await step.boundingBox();
    expect(box!.y + box!.height).toBeGreaterThan(phone.height - 90);
    // Pinned: scrolling the column to its end leaves the step where it is.
    await page.getByRole('heading', { level: 2, name: 'Händelser' }).scrollIntoViewIfNeeded();
    await expect(step).toBeInViewport();
    expect((await step.boundingBox())!.y).toBeCloseTo(box!.y, 0);
    await page.getByRole('button', { name: 'Fler val' }).click();
    await expect(page.getByRole('menuitem', { name: 'Inte nu' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Avfärda · inte aktuellt' })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Visa detaljer' }).click();
    await expect(page.getByRole('dialog', { name: 'Detaljer' })).toBeVisible();
    await expectNoAxeViolations(page);
  });
});

test.describe('the work item page at 320 px and on a short screen', () => {
  for (const [name, viewport] of [
    ['320 px', narrow],
    ['a short screen', short],
  ] as const)
    test(`reflows without sideways scrolling at ${name}`, async ({ page, api: _ }) => {
      await page.setViewportSize(viewport);
      await open(page, '/items/fakturor');
      await expect(page.getByRole('heading', { level: 1, name: INVOICES })).toBeVisible();
      expect(await reflowProblems(page)).toEqual([]);
    });

  test('on a desktop the page has no axe violations with the review over it', async ({ page, api }) => {
    await page.setViewportSize(desktop);
    const card = api.threads.find(t => t.id === 'fakturor')!;
    card.actions = card.actions.map(a =>
      a.id === 'approve' ? { ...a, review: 'each' as const, preview: 'finance.preview' } : a,
    );
    await open(page, '/items/fakturor');
    // Dokument: each row's document opens the review over the page at that row.
    const documents = page.getByRole('region', { name: 'Dokument' });
    await documents.getByRole('link', { name: 'Öppna underlaget för Skolmaterial Norrland AB · 18 300 kr' }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL('/items/fakturor?review=fakturor&step=2');
    const review = page.getByRole('dialog', { name: 'Granska 3 rader' });
    await expect(review.getByRole('heading', { name: 'Skolmaterial Norrland AB · 18 300 kr' })).toBeVisible();
    await expectNoAxeViolations(page);
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL('/items/fakturor');
    await expect(page.getByRole('link', { name: 'Granska 3' })).toBeFocused();
  });
});
