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
  silentSaidIn,
  test,
} from './support';
import { NOTICE_REASON, NOTICE_TEXT, asNotice } from './data';

/**
 * Att göra (D112 item 3, board Inbox, the `table-inbox` template): a queue that indexes a reading pane. The piles are
 * tabs that lead to their address; a row is one link, and choosing it puts the work item in the pane and in the
 * address (`/todo?item=`). Where the pane does not fit beside the list (the template measures the page's own box,
 * 900 px), the row leads to the item as its page, alone on the surface, with the way back to the list. Keyboard, focus, announcements, axe and
 * reflow at 320 px, the addresses of Hem's tabs from before D112, and a notice's layout in the pane.
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
    await expect(rows.first().getByRole('img', { name: 'Att göra i dag' })).toBeVisible();
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
    await expect(fakturor).toContainText('Budget');
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

// A work item alone in Hem's address is Hem's own since 2026-11-12, beside Hem in its panel (`hem.spec.ts`).
test.describe('the addresses of Hem’s old tabs', () => {
  test.use({ viewport: desktop });

  for (const [from, to] of [
    ['/?tab=waiting', /\/todo\?tab=waiting$/],
    ['/?tab=snoozed', /\/todo\?tab=waiting$/],
    ['/?tab=done&card=attest', /\/todo\?tab=done&item=attest$/],
    ['/?area=personal', /\/todo\?area=personal$/],
  ] as const)
    test(`${from} leads to Att göra`, async ({ page, api: _ }) => {
      await page.goto(from);
      await expect(page).toHaveURL(to);
      await expect(page.getByRole('heading', { level: 1, name: 'Att göra' })).toBeVisible();
    });
});

test.describe('Hem leads to Att göra', () => {
  test.use({ viewport: wide });

  test('Behöver dig on Hem is the three most urgent items, each opening beside Hem, and the way to all of them in Att göra', async ({
    page,
    api: _,
  }) => {
    await open(page, '/');
    const block = page.getByRole('region', { name: 'Behöver dig' });
    await expect(block.getByRole('listitem')).toHaveCount(3);
    // A row opens its item in the panel beside Hem (D112, amended 2026-11-12; `hem.spec.ts`).
    await expect(block.getByRole('link', { name: /^Attestera 3 fakturor/ })).toHaveAttribute('href', '/?card=fakturor');
    const all = block.getByRole('link', { name: 'Alla 6 i Att göra' });
    await expect(all).toHaveAttribute('href', '/todo');
    await all.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/todo$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Att göra' })).toBeVisible();
    await expect(queue(page).getByRole('listitem')).toHaveCount(6);
  });
});

/**
 * A notice (D112, amended 2026-11-12): a work item whose execute is the person's read receipt leads with its text, the
 * thing to read, and the way to the whole of it after the text; "Varför ser jag detta?" is its provenance line and a row
 * that only repeats its title is not drawn. The receipt's button stays among the item's buttons, reached from the text.
 */
test.describe('Att göra: a notice in the reading pane', () => {
  test.use({ viewport: wide });

  test('the notice leads with its text and its link out; the receipt stays among the buttons and is reached from the text; no row repeats the title', async ({
    page,
    api,
  }) => {
    api.threads = api.threads.map(t => (t.id === 'rutin' ? asNotice(t) : t));
    await open(page, '/todo?item=rutin');
    const pane = page.getByRole('complementary', { name: 'Valt ärende' });
    const item = pane.locator('#card-rutin');
    const ack = item.getByRole('button', { name: 'Jag har läst' });
    const whole = item.getByRole('button', { name: /^Läs hela nyheten\s*\(öppnas i ny flik\)$/ });
    const why = item.getByRole('region', { name: 'Varför ser jag detta?' });
    await expect(ack).toBeVisible();
    // Drawn once, after the text, not among the buttons too.
    await expect(whole).toHaveCount(1);
    const y = async (l: import('@playwright/test').Locator) => (await l.boundingBox())!.y;
    const first = item.getByText(NOTICE_TEXT[0]!, { exact: true });
    expect(await y(first)).toBeGreaterThan(await y(ack));
    expect(await y(whole)).toBeGreaterThan(await y(item.getByText(NOTICE_TEXT.at(-1)!, { exact: true })));
    expect(await y(why)).toBeGreaterThan(await y(whole));
    await expect(why).toContainText(NOTICE_REASON);
    await expect(why).not.toContainText(NOTICE_TEXT[1]!);
    await expect(item.getByRole('heading', { name: 'Rader' })).toHaveCount(0);
    await expectNoAxeViolations(page);
    // The keyboard goes from the receipt to the link out after the text, and from there back to the receipt.
    await ack.focus();
    let steps = 0;
    while (steps < 10 && !(await whole.evaluate(el => el === document.activeElement))) {
      await page.keyboard.press('Tab');
      steps++;
    }
    await expect(whole).toBeFocused();
    for (let i = 0; i < steps; i++) await page.keyboard.press('Shift+Tab');
    await expect(ack).toBeFocused();
    // An item that is not a notice keeps its lead under Varför ser jag detta? and its rows.
    await open(page, '/todo?item=fakturor');
    const invoices = pane.locator('#card-fakturor');
    await expect(invoices.getByRole('region', { name: 'Varför ser jag detta?' })).toContainText(
      'Alla matchar sina beställningar och ryms i budgeten.',
    );
    await expect(invoices.getByRole('heading', { name: 'Rader' })).toBeVisible();
    await expect(invoices.getByRole('button', { name: /^Öppna i ekonomisystemet/ })).toHaveCount(1);
  });
});

/**
 * A system that does not answer is said on the work items that come from it (D116, amended 2026-11-12): "kan vara
 * gammal" at the end of the row's why line, and in the item's head with since when, never as a banner over the page or
 * a sentence over the list. The first time a system is seen silent in the session it is said aloud once.
 */
test.describe('Att göra when a system does not answer', () => {
  test.use({ viewport: wide });

  test('its work items may be old, said on their rows and in their heads with since when; two systems at once are said once together and stack nothing over the page', async ({
    page,
    api,
  }) => {
    api.sources = [
      { connector: 'hr', state: 'idle', lastSuccess: '2026-11-04T05:00:00.000Z', error: 'unavailable' },
      { connector: 'finance', state: 'idle', lastSuccess: null, error: 'timeout' },
    ];
    await open(page, '/todo');
    await expect(page.locator('#work-omtanke')).toContainText('· kan vara gammal');
    await expect(page.locator('#work-fakturor')).toContainText('· kan vara gammal');
    expect(await queue(page).getByRole('listitem').filter({ hasNotText: 'kan vara gammal' }).count()).toBeGreaterThan(
      0,
    );
    // No sentence over the list and nothing over the page: the rows say it.
    expect(await silentSaidIn(page)).toEqual([]);
    await expect
      .poll(() => announcements(page))
      .toContainEqual(expect.stringContaining('Personalsystemet och Ekonomisystemet svarar inte'));
    await expectNoAxeViolations(page);
    const pane = page.getByRole('complementary', { name: 'Valt ärende' });
    await row(page, 'Omtankesamtal med Anna Lindqvist').click();
    await expect(
      pane.getByText('Kan vara gammal · Personalsystemet svarar inte sedan 06:00', { exact: true }),
    ).toBeVisible();
    expect(await silentSaidIn(page)).toEqual(['Ärende: Omtankesamtal med Anna Lindqvist']);
    await expectNoAxeViolations(page);
    await row(page, 'Attestera 3 fakturor, 48 200 kr').click();
    await expect(pane.getByText('Kan vara gammal · Ekonomisystemet svarar inte', { exact: true })).toBeVisible();
    // Said once in the session, together, and not again as the items open.
    expect((await announcements(page)).filter(text => text.includes('svarar inte'))).toHaveLength(1);
  });

  test('with nothing left to draw the empty pile says it waits and names the system that does not answer', async ({
    page,
    api,
  }) => {
    api.threads = [];
    api.sources = [{ connector: 'hr', state: 'idle', lastSuccess: '2026-11-04T05:00:00.000Z', error: 'unavailable' }];
    await open(page, '/todo');
    await expect(page.getByRole('heading', { level: 2, name: 'Inväntar källornas besked' })).toBeVisible();
    await expect(page.getByText('Personalsystemet svarar inte sedan 06:00.', { exact: true })).toBeVisible();
    await expect(page.getByText('Inget behöver dig just nu.', { exact: true })).toHaveCount(0);
    await expectNoAxeViolations(page);
  });

  test('the marks reflow at 320 px', async ({ page, api }) => {
    await page.setViewportSize(narrow);
    api.sources = [{ connector: 'hr', state: 'idle', lastSuccess: '2026-11-04T05:00:00.000Z', error: 'unavailable' }];
    await open(page, '/todo');
    await expect(page.locator('#work-omtanke')).toContainText('kan vara gammal');
    expect(await reflowProblems(page)).toEqual([]);
  });
});
