import type { Locator, Page } from '@playwright/test';
import { desktop, expect, expectNoAxeViolations, narrow, open, phone, reflowProblems, short, test } from './support';
import { NOTICE_REASON, NOTICE_TEXT, NOW, asNotice } from './data';

/**
 * A work item as a page (D126 rule 1, board Ärende, `/items/<threadId>`, the `work-item-detail` template): reached by
 * its name in every row and by its title in Att göra's reading pane, with `from` as the way back. The page is the
 * header (the way back with the source, the title with when it is due, the buttons directly under it), the read in the
 * column (the item's own words, Varför ser jag detta?, the rows, Dokument, Händelser) and the facts under "Uppgifter"
 * in the end panel; at 1024 px and below the facts stand above the read.
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

  test('the title leads from the reading pane to the page, which opens on its heading, keeps one outline and leads back to the pane', async ({
    page,
    api: _,
  }) => {
    await open(page, '/todo?item=fakturor');
    const pane = page.getByRole('complementary', { name: 'Valt ärende' });
    // The name is the way in (2026-11-13): the title is the link, and there is no "Öppna som sida" beside it.
    const asPage = pane.getByRole('heading', { name: INVOICES }).getByRole('link', { name: INVOICES });
    await expect(pane.getByRole('link', { name: 'Öppna som sida' })).toHaveCount(0);
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
    // The sections are the outline's second level, drawn at the size the board gives them (board Ärende): the level a
    // screen reader is told is `aria-level` where the drawn element is a smaller heading.
    for (const name of ['Varför ser jag detta?', 'Rader', 'Händelser']) {
      const section = page.getByRole('main').getByRole('heading', { name, exact: true });
      await expect(section).toBeVisible();
      expect(await section.evaluate(h => Number(h.getAttribute('aria-level') ?? h.tagName.slice(1))), name).toBe(2);
    }
    // The status among the facts, in words; the dot beside its word is decoration with no name of its own, so the
    // state is heard once. When it is due is a badge beside the title (board Ärende).
    await expect(page.getByText('Ska göras i dag', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('img', { name: 'Ska göras i dag' })).toHaveCount(0);
    await expect(page.getByText('Svara i dag', { exact: true })).toBeVisible();
    // The rows are a checklist with how many are chosen, the action's label counting them.
    await expect(page.getByText('2 av 3 valda', { exact: true })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: /Energibolaget AB/ })).toBeChecked();
    await expect(page.getByRole('button', { name: 'Attestera 2 valda' })).toBeVisible();
    // Händelser from the item's audit rows: Clew created it, with why.
    const events = page.getByRole('list', { name: 'Händelser, de senaste först' });
    await expect(events).toContainText('Clew');
    await expect(events).toContainText('skapade ärendet: Fakturorna förfaller i veckan');
    // The facts under Uppgifter in the end panel (board Ärende).
    const details = page.getByRole('complementary', { name: 'Uppgifter' });
    await expect(details.locator('[aria-level="2"]').filter({ hasText: /^Uppgifter$/ })).toBeVisible();
    for (const term of ['Status', 'Källa', 'Svara senast', 'Kom']) await expect(details).toContainText(term);
    // The way out to the source is under ⋯, marked as leaving Clew (D111 rule 8).
    await page.getByRole('main').getByRole('button', { name: 'Fler åtgärder' }).click();
    await expect(
      page.getByRole('menuitem', { name: /^Öppna i ekonomisystemet\s*\(öppnas i ny flik\)$/ }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await expectNoAxeViolations(page);
    // From the title the keyboard reaches the decision first: the buttons stand directly under the title.
    await title.focus();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Attestera 2 valda' })).toBeFocused();
    // The trail leads back to the pane it was opened from.
    await page.getByRole('main').getByRole('link', { name: 'Att göra', exact: true }).click();
    await expect(page).toHaveURL('/todo?item=fakturor');
    await expect(pane.locator('#card-fakturor')).toBeVisible();
  });

  test('opened from another page, its way back is that page; an address from before is the same page; with no way back it is Att göra', async ({
    page,
    api: _,
  }) => {
    // An address from before D126 that held the item beside Personal leads to its page, Personal as the way back.
    await open(page, '/staff?card=omtanke');
    await expect(page).toHaveURL('/items/omtanke?from=%2Fstaff');
    await expect(page.getByRole('heading', { level: 1, name: 'Omtankesamtal med Anna Lindqvist' })).toBeVisible();
    const main = page.getByRole('main');
    await expect(main.getByRole('link', { name: 'Personal', exact: true })).toHaveAttribute('href', '/staff');
    await open(page, '/items/omtanke');
    await expect(page.getByRole('main').getByRole('link', { name: 'Att göra', exact: true })).toHaveAttribute(
      'href',
      '/todo',
    );
    // An address from before D112 leads to the same page.
    await page.goto('/cards/omtanke');
    await expect(page).toHaveURL('/items/omtanke');
    await expect(page.getByRole('heading', { level: 1, name: 'Omtankesamtal med Anna Lindqvist' })).toBeVisible();
  });

  test('a calendar proposal opened from Hem is its page, and its title there leads nowhere further', async ({
    page,
    api,
  }) => {
    const proposal = api.threads.find(t => t.proposals.length > 0)!;
    await open(page, `/?card=${proposal.id}`);
    await expect(page).toHaveURL(`/items/${proposal.id}?from=%2F`);
    await expect(page.getByRole('heading', { level: 1, name: proposal.title })).toBeVisible();
    await expect(page.getByRole('main').getByRole('heading', { level: 1 }).getByRole('link')).toHaveCount(0);
    await expect(page.getByRole('main').getByRole('link', { name: 'Hem', exact: true })).toHaveAttribute('href', '/');
    await expectNoAxeViolations(page);
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

  test('a notice as a page: its text first in the column, the way to the whole of it after the text and in the rail, its receipt in the header, and the text still there after it', async ({
    page,
    api,
  }) => {
    api.threads = api.threads.map(t => (t.id === 'rutin' ? asNotice(t) : t));
    await open(page, '/items/rutin');
    await expect(page.getByRole('heading', { level: 1, name: 'Ny rutin för läkemedelshantering' })).toBeFocused();
    const main = page.getByRole('main');
    const ack = main.getByRole('button', { name: 'Jag har läst' });
    await expect(ack).toBeVisible();
    // The text first in the column, under no heading of its own; then Varför ser jag detta? as the provenance line.
    const y = async (l: Locator) => (await l.boundingBox())!.y;
    const first = main.getByText(NOTICE_TEXT[0]!, { exact: true });
    const why = main.getByRole('region', { name: 'Varför ser jag detta?' });
    expect(await y(first)).toBeGreaterThan(await y(ack));
    expect(await y(why)).toBeGreaterThan(await y(main.getByText(NOTICE_TEXT.at(-1)!, { exact: true })));
    await expect(why).toContainText(NOTICE_REASON);
    await expect(why).not.toContainText(NOTICE_TEXT[0]!);
    await expect(page.getByRole('heading', { level: 2, name: 'Rader' })).toHaveCount(0);
    // The way to the whole of it after the text, marked as leaving Clew; not among the header's buttons.
    const out = /^Läs hela nyheten\s*\(öppnas i ny flik\)$/;
    await expect(page.getByRole('button', { name: out })).toHaveCount(1);
    expect(await y(main.getByRole('button', { name: out }).first())).toBeGreaterThan(await y(first));
    // One outline: the title, then the column's sections and the rail's, each one level under it.
    const levels = await outline(page);
    expect(levels.filter(l => l === 1)).toHaveLength(1);
    for (let i = 1; i < levels.length; i++) expect(levels[i]! - levels[i - 1]!).toBeLessThanOrEqual(1);
    await expectNoAxeViolations(page);
    // The receipt: the source's answer on the item, and the text still there to read again.
    await ack.focus();
    await page.keyboard.press('Enter');
    await expect(main.getByText('Läskvittot är registrerat.', { exact: true })).toBeVisible();
    await expect(first).toBeVisible();
    await expect(why).toHaveCount(0);
    await expectNoAxeViolations(page);
  });

  test('an item reminded today that has no day says Påminnelse as its state, with no badge that repeats it', async ({
    page,
    api,
  }) => {
    const card = api.threads.find(t => t.id === 'ledighet')!;
    card.deadline = null;
    card.remindedAt = NOW;
    // The row: the state begins its line, and no badge says the same word at its end.
    await open(page, '/todo');
    const row = page.getByRole('main').locator('#work-ledighet');
    await expect(row).toContainText('Påminnelse\u00a0· Ansökan väntar på beslut');
    await expect(row.getByText('Påminnelse', { exact: true })).toHaveCount(0);
    // The page: the word as its status among the facts, and no badge that says the word again.
    await open(page, '/items/ledighet');
    await expect(page.getByRole('heading', { level: 1, name: card.title })).toBeVisible();
    await expect(page.getByText('Påminnelse', { exact: true }).first()).toBeVisible();
    await expect(page.locator('.astryx-badge').filter({ hasText: 'Påminnelse' })).toHaveCount(0);
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

test.describe('the work item page where the end panel does not fit', () => {
  test.use({ viewport: tablet });

  test('the facts stand above the read, and the buttons under the title', async ({ page, api: _ }) => {
    await open(page, '/items/fakturor');
    await expect(page.getByRole('complementary', { name: 'Uppgifter' })).toHaveCount(0);
    const main = page.getByRole('main');
    for (const term of ['Status', 'Källa', 'Svara senast', 'Kom']) await expect(main).toContainText(term);
    const y = async (l: Locator) => (await l.boundingBox())!.y;
    expect(await y(main.getByText('Status', { exact: true }))).toBeLessThan(
      await y(main.getByRole('heading', { name: 'Varför ser jag detta?' })),
    );
    await expect(page.getByRole('button', { name: 'Attestera 2 valda' })).toBeVisible();
    await expectNoAxeViolations(page);
  });
});

test.describe('the work item page on a phone', () => {
  test.use({ viewport: phone, hasTouch: true, isMobile: true });

  test('the buttons stand under the title, the rest is under Fler åtgärder, and the facts above the read', async ({
    page,
    api: _,
  }) => {
    await open(page, '/items/fakturor');
    await expect(page.getByRole('heading', { level: 1, name: INVOICES })).toBeFocused();
    const step = page.getByRole('button', { name: 'Attestera 2 valda' });
    await expect(step).toBeInViewport();
    await page.getByRole('button', { name: 'Fler åtgärder' }).click();
    await expect(page.getByRole('menuitem', { name: 'Inte nu' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Avfärda · inte aktuellt' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('main').getByText('Status', { exact: true })).toBeVisible();
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

  test('on a desktop a row under Dokument leads to the review’s page at that row, and Back to the row', async ({
    page,
    api,
  }) => {
    await page.setViewportSize(desktop);
    const card = api.threads.find(t => t.id === 'fakturor')!;
    card.actions = card.actions.map(a =>
      a.id === 'approve' ? { ...a, review: 'each' as const, preview: 'finance.preview' } : a,
    );
    await open(page, '/items/fakturor');
    // Dokument: each row's document leads to the review's page at that row (D73, amended 2026-11-12).
    const documents = page.getByRole('region', { name: 'Dokument' });
    const row = documents.getByRole('link', { name: 'Öppna underlaget för Skolmaterial Norrland AB · 18 300 kr' });
    await row.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL('/items/fakturor/review?from=%2Fitems%2Ffakturor&step=2');
    await expect(page.getByRole('heading', { level: 1, name: 'Granska 3 rader' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Skolmaterial Norrland AB · 18 300 kr' })).toBeVisible();
    await expectNoAxeViolations(page);
    await page.goBack();
    await expect(page).toHaveURL('/items/fakturor');
    await expect(row).toBeFocused();
  });
});
