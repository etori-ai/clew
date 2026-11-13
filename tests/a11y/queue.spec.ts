import {
  announcements,
  desktop,
  expect,
  expectNoAxeViolations,
  narrow,
  open,
  openNav,
  phone,
  reflowProblems,
  test,
} from './support';

/**
 * Att göra (D112 item 3, board Inbox, the `table-inbox` template): a queue that indexes a reading pane. The piles are
 * tabs that lead to their address; a row is one link, and choosing it puts the work item in the pane and in the
 * address (`/todo?item=`). Where the pane does not fit beside the list (the template measures the page's own box,
 * 900 px), the row leads to the item as its page, alone on the surface, with the way back to the list. Keyboard, focus, announcements, axe and
 * reflow at 320 px, and the addresses of Hem from before D112.
 */
const wide = { width: 1440, height: 900 };
/** The page's box is under 900 px beside the rail: one surface. */
const tablet = { width: 1024, height: 768 };
const queue = (page: import('@playwright/test').Page, name = 'Behöver dig') => page.getByRole('list', { name });
const row = (page: import('@playwright/test').Page, title: string) =>
  page.getByRole('link', { name: new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) });

test.describe('Att göra: the piles', () => {
  test.use({ viewport: wide });

  test('the piles are tabs that lead to their address, each with its rows; the rail says how much needs the person', async ({
    page,
    api: _,
  }) => {
    await open(page, '/todo');
    await expect(page.getByRole('heading', { level: 1, name: 'Att göra' })).toBeVisible();
    await expect(page).toHaveTitle(/^Att göra/);
    const rail = page.getByRole('navigation', { name: 'Sidonavigering' });
    await expect(rail.getByRole('link', { name: /^Att göra/ })).toHaveAttribute('aria-current', 'page');
    await expect(rail.getByRole('link', { name: /^Att göra/ })).toContainText('6');
    // The tabs are the navigation pattern (no tablist): links, the current one marked.
    const tabs = page.getByRole('navigation', { name: 'Urval' });
    await expect(tabs.getByRole('link', { name: 'Behöver dig · 6' })).toHaveAttribute('aria-current', 'true');
    await expect(tabs.getByRole('link', { name: 'Väntar på andra · 3' })).toBeVisible();
    await expect(tabs.getByRole('link', { name: 'Klart', exact: true })).toBeVisible();
    // Behöver dig in Hem's order: what is due, what comes later, the proposal, the notice.
    const rows = queue(page).getByRole('listitem');
    await expect(rows).toHaveCount(6);
    await expect(rows.first()).toContainText('Attestera 3 fakturor, 48 200 kr');
    await expect(rows.first()).toContainText('I dag');
    await expect(rows.first().getByRole('img', { name: 'Ska göras i dag' })).toBeVisible();
    await expectNoAxeViolations(page);
    // Väntar på andra holds what waits on others and what the person set aside, which says when it comes back.
    await tabs.getByRole('link', { name: 'Väntar på andra · 3' }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/todo\?tab=waiting$/);
    const waiting = queue(page, 'Väntar på andra');
    await expect(waiting.getByRole('listitem')).toHaveCount(3);
    await expect(row(page, 'Tillbud 2026-1182, halkolycka i duschen')).toBeVisible();
    const snoozed = waiting.getByRole('listitem').filter({ hasText: 'Brandskyddsrond i oktober saknar protokoll' });
    await expect(snoozed.getByRole('img', { name: 'Inte nu' })).toBeVisible();
    await expect(snoozed).toContainText('Tillbaka i morgon 06:00');
    await tabs.getByRole('link', { name: 'Klart', exact: true }).click();
    await expect(page).toHaveURL(/\/todo\?tab=done$/);
    await expect(queue(page, 'Klart').getByRole('listitem')).toHaveCount(2);
    await expect(row(page, 'Attesterade fakturor')).toBeVisible();
    await expectNoAxeViolations(page);
    // Back is the pile before: the address is the state.
    await page.goBack();
    await expect(tabs.getByRole('link', { name: 'Väntar på andra · 3' })).toHaveAttribute('aria-current', 'true');
  });

  test('the filter and the system narrow the rows, stay in the address and say how many are left', async ({
    page,
    api: _,
  }) => {
    await open(page, '/todo');
    const filter = page.getByRole('searchbox', { name: 'Filtrera' });
    await filter.fill('fakt');
    await expect(page).toHaveURL(/\/todo\?filter=fakt$/);
    await expect(queue(page).getByRole('listitem')).toHaveCount(1);
    await expect.poll(() => announcements(page)).toContainEqual('1 ärenden');
    await filter.fill('');
    await expect(queue(page).getByRole('listitem')).toHaveCount(6);
    await page.getByRole('button', { name: 'Alla system' }).click();
    await page.getByRole('menuitemradio', { name: 'Personal' }).click();
    await expect(page).toHaveURL(/\/todo\?area=personal$/);
    await expect(queue(page).getByRole('listitem')).toHaveCount(3);
    await expect(row(page, 'Attestera 3 fakturor, 48 200 kr')).toHaveCount(0);
    await expect.poll(() => announcements(page)).toContainEqual('Visar Personal: 3 ärenden');
    await expect(page.getByRole('link', { name: 'Behöver dig · 3' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Personal', exact: true })).toBeVisible();
    await expect(queue(page).getByRole('listitem')).toHaveCount(3);
  });
});

test.describe('Att göra: the reading pane', () => {
  test.use({ viewport: wide });

  test('a row puts its work item in the pane beside the list and in the address; another row takes its place; Back, Forward and a reload show the same; Esc gives the focus back', async ({
    page,
    api: _,
  }) => {
    await open(page, '/todo');
    await row(page, 'Attestera 3 fakturor, 48 200 kr').focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/todo\?item=fakturor$/);
    const pane = page.getByRole('complementary', { name: 'Valt ärende' });
    await expect(pane).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // The focus is on the item's own heading; the row is marked as the current one; the list is still there.
    await expect(pane.getByRole('heading', { level: 2, name: 'Attestera 3 fakturor, 48 200 kr' })).toBeFocused();
    await expect(page.locator('#work-fakturor')).toHaveAttribute('aria-current', 'true');
    await expect(pane.locator('#card-fakturor').getByRole('button', { name: 'Attestera 2 valda' })).toBeVisible();
    await expect(queue(page).getByRole('listitem')).toHaveCount(6);
    await expectNoAxeViolations(page);
    await row(page, 'Omtankesamtal med Anna Lindqvist').click();
    await expect(page).toHaveURL(/\/todo\?item=omtanke$/);
    await expect(pane.locator('#card-omtanke')).toBeVisible();
    await expect(pane.locator('#card-fakturor')).toHaveCount(0);
    await expect(pane.getByRole('heading', { level: 2, name: 'Omtankesamtal med Anna Lindqvist' })).toBeFocused();
    await expect
      .poll(() => announcements(page))
      .toContainEqual(expect.stringContaining('Omtankesamtal med Anna Lindqvist'));
    await page.goBack();
    await expect(page).toHaveURL(/\/todo\?item=fakturor$/);
    await expect(pane.locator('#card-fakturor')).toBeVisible();
    await page.goForward();
    await expect(pane.locator('#card-omtanke')).toBeVisible();
    await page.reload();
    await expect(page.getByRole('complementary', { name: 'Valt ärende' }).locator('#card-omtanke')).toBeVisible();
    await expect(page.locator('#work-omtanke')).toHaveAttribute('aria-current', 'true');
    // Esc lets go of the item and gives the focus back to its row.
    await page.getByRole('heading', { level: 2, name: 'Omtankesamtal med Anna Lindqvist' }).focus();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('complementary', { name: 'Valt ärende' })).toHaveCount(0);
    await expect(page).toHaveURL(/\/todo$/);
    await expect(row(page, 'Omtankesamtal med Anna Lindqvist')).toBeFocused();
    await expect(page.locator('#work-omtanke')).not.toHaveAttribute('aria-current', 'true');
  });

  test('a row is one target: a press on its why line or at its far end opens the item, and it has one link and one tab stop, named by its title', async ({
    page,
    api: _,
  }) => {
    await open(page, '/todo');
    const rows = queue(page).getByRole('listitem');
    for (let i = 0; i < (await rows.count()); i++) await expect(rows.nth(i).getByRole('link')).toHaveCount(1);
    const fakturor = page.locator('#work-fakturor');
    await expect(fakturor.getByRole('link')).toHaveAccessibleName('Attestera 3 fakturor, 48 200 kr');
    // The badge and the source are read in the row, beside its link.
    await expect(fakturor).toContainText('I dag');
    // The row names its system, as the same row on Hem does.
    await expect(fakturor).toContainText('Ekonomisystemet');
    expect((await fakturor.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    // One tab stop per row: from one row's link the next is the next row's.
    await fakturor.getByRole('link').focus();
    await page.keyboard.press('Tab');
    await expect(page.locator('#work-omtanke').getByRole('link')).toBeFocused();
    await fakturor.getByText('Fakturorna förfaller i veckan').click();
    await expect(page).toHaveURL(/\/todo\?item=fakturor$/);
    await expect(fakturor).toHaveAttribute('aria-current', 'true');
    await expect(fakturor.getByRole('link')).toHaveAttribute('aria-current', 'true');
    const omtanke = page.locator('#work-omtanke');
    const box = (await omtanke.boundingBox())!;
    await page.mouse.click(box.x + box.width - 4, box.y + box.height / 2);
    await expect(page).toHaveURL(/\/todo\?item=omtanke$/);
    await expectNoAxeViolations(page);
  });

  test('an item opened by its address shows the pile it lies in, and ✕ closes it with the focus on its row', async ({
    page,
    api: _,
  }) => {
    await open(page, '/todo?item=tillbud');
    await expect(page.getByRole('link', { name: 'Väntar på andra · 3' })).toHaveAttribute('aria-current', 'true');
    const pane = page.getByRole('complementary', { name: 'Valt ärende' });
    await expect(pane.locator('#card-tillbud')).toBeVisible();
    await pane.getByRole('button', { name: 'Stäng ärendet' }).click();
    await expect(page).toHaveURL(/\/todo$/);
    await expect(pane).toHaveCount(0);
  });

  test('an item that is no longer among the person’s says so in the pane', async ({ page, api: _ }) => {
    await open(page, '/todo?item=borta');
    const pane = page.getByRole('complementary', { name: 'Valt ärende' });
    await expect(pane.getByRole('heading', { name: 'Ärendet finns inte längre' })).toBeVisible();
    await expectNoAxeViolations(page);
  });
});

test.describe('Att göra where the pane does not fit', () => {
  test('on a narrower screen the row leads to the item alone, with the way back to the list and the focus on the row', async ({
    page,
    api: _,
  }) => {
    await page.setViewportSize(tablet);
    await open(page, '/todo');
    await row(page, 'Ledighetsansökan från Johan Byström').click();
    await expect(page).toHaveURL(/\/todo\?item=ledighet$/);
    // The item alone is its page (D112 items 3 and 4): its title is the page's heading, the details behind a button.
    await expect(page.getByRole('complementary')).toHaveCount(0);
    await expect(queue(page)).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1, name: 'Ledighetsansökan från Johan Byström' })).toBeFocused();
    await expect(page).toHaveTitle('Ledighetsansökan från Johan Byström · Startsidan');
    await expect(page.getByRole('button', { name: 'Visa detaljer' })).toBeVisible();
    await expectNoAxeViolations(page);
    await page.getByRole('main').getByRole('link', { name: 'Att göra', exact: true }).click();
    await expect(page).toHaveURL(/\/todo$/);
    await expect(queue(page).getByRole('listitem')).toHaveCount(6);
    await expect(row(page, 'Ledighetsansökan från Johan Byström')).toBeFocused();
  });

  test('on a phone the rail is the drawer, the piles fit with their short names, and a row opens the item full screen', async ({
    page,
    api: _,
  }) => {
    await page.setViewportSize(phone);
    await open(page, '/todo');
    // The short words alone on a phone, so the three piles fit 320 px also with the text-spacing overrides (1.4.12).
    const piles = page.getByRole('navigation', { name: 'Urval' });
    await expect(piles.getByRole('link')).toHaveCount(3);
    for (const name of ['Behöver dig', 'Väntar', 'Klart'])
      await expect(piles.getByRole('link', { name, exact: true })).toBeInViewport({ ratio: 1 });
    const nav = await openNav(page);
    await expect(nav.getByRole('link', { name: /^Att göra/ })).toHaveAttribute('aria-current', 'page');
    await page.keyboard.press('Escape');
    await row(page, 'Omtankesamtal med Anna Lindqvist').click();
    await expect(page.getByRole('heading', { level: 1, name: 'Omtankesamtal med Anna Lindqvist' })).toBeVisible();
    // The next step pinned to the foot (board PhoneItem).
    await expect(page.getByRole('button', { name: 'Boka samtalet' })).toBeInViewport();
    await expect(queue(page)).toHaveCount(0);
    expect(await reflowProblems(page)).toEqual([]);
    await expectNoAxeViolations(page);
    await page.goBack();
    await expect(queue(page).getByRole('listitem')).toHaveCount(6);
  });

  for (const [path, title] of [
    ['/todo', 'Att göra'],
    ['/todo?tab=waiting', 'Att göra'],
    ['/todo?item=fakturor', 'Attestera 3 fakturor, 48 200 kr'],
  ] as const)
    test(`${path} reflows at 320 px`, async ({ page, api: _ }) => {
      await page.setViewportSize(narrow);
      await open(page, path);
      await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
      expect(await reflowProblems(page)).toEqual([]);
    });
});

test.describe('the addresses that led to a card on Hem', () => {
  test.use({ viewport: desktop });

  for (const [from, to] of [
    ['/?card=ledighet', /\/todo\?item=ledighet$/],
    ['/?tab=waiting', /\/todo\?tab=waiting$/],
    ['/?tab=snoozed', /\/todo\?tab=waiting$/],
    ['/?tab=done&card=attest', /\/todo\?tab=done&item=attest$/],
    ['/?area=personal', /\/todo\?area=personal$/],
    ['/cards/fakturor/review', /\/todo\?item=fakturor&review=fakturor$/],
  ] as const)
    test(`${from} leads to Att göra`, async ({ page, api: _ }) => {
      await page.goto(from);
      await expect(page).toHaveURL(to);
      await expect(page.getByRole('heading', { level: 1, name: 'Att göra' })).toBeVisible();
    });
});

test.describe('Hem leads to Att göra', () => {
  test.use({ viewport: wide });

  test('Behöver dig on Hem is the three most urgent items, each leading to it in Att göra, and the way to all of them', async ({
    page,
    api: _,
  }) => {
    await open(page, '/');
    const block = page.getByRole('region', { name: 'Behöver dig' });
    await expect(block.getByRole('listitem')).toHaveCount(3);
    await expect(block.getByRole('link', { name: /^Attestera 3 fakturor/ })).toHaveAttribute(
      'href',
      '/todo?item=fakturor',
    );
    await expect(block.getByRole('link', { name: 'Alla 6 i Att göra' })).toHaveAttribute('href', '/todo');
    await block.getByRole('link', { name: /^Omtankesamtal med Anna Lindqvist/ }).click();
    await expect(page).toHaveURL(/\/todo\?item=omtanke$/);
    await expect(page.getByRole('complementary', { name: 'Valt ärende' }).locator('#card-omtanke')).toBeVisible();
  });
});
