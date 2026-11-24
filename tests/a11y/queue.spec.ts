import {
  announcements,
  desktop,
  expect,
  expectNoAxeViolations,
  hiddenFocusStops,
  narrow,
  open,
  openNav,
  phone,
  reflowProblems,
  silentSaidIn,
  test,
  FAILED,
} from './support';
import { NOTICE_REASON, NOTICE_TEXT, asNotice } from './data';

/**
 * Att göra (D126 rule 2, board Att göra, the `table-inbox` template): a queue that indexes a reading pane. The piles are
 * tabs that lead to their address; the rows are Astryx's Table, the name the row's one link, and choosing it puts the
 * work item in the pane and in the address (`/todo?item=`). Where the pane does not fit beside the list (the template
 * measures the page's own box, 900 px), there is no pane: the row leads to the item's page, with the way back to the
 * list. On a phone (below 768 px; D130 item 19, amended 2026-11-23) there is no table: each work item is a row of a
 * list, the whole row the link to the item's page. Keyboard, focus, announcements, axe and reflow at 320 px, the
 * addresses of Hem's tabs from before D112, and a notice's layout in the pane.
 */
const wide = { width: 1440, height: 900 };
/** The page's box is under 900 px beside the rail: one surface. */
/** Under the `table-inbox` template's own line: with no rail the pane fits beside the list from about 950 px (D130). */
const tablet = { width: 900, height: 768 };
const queue = (page: import('@playwright/test').Page, name = 'Behöver dig') => page.getByRole('table', { name });
/** The queue's rows, each with its one link (the header row has none). */
const rows = (page: import('@playwright/test').Page, name = 'Behöver dig') =>
  queue(page, name)
    .getByRole('row')
    .filter({ has: page.getByRole('link') });
const row = (page: import('@playwright/test').Page, title: string) =>
  page.getByRole('table').getByRole('link', { name: new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) });
/** A phone's queue: a list named by its pile, each row a list item with its one link. */
const phoneQueue = (page: import('@playwright/test').Page, name = 'Behöver dig') =>
  page.getByRole('main').getByRole('list', { name, exact: true });
const phoneRows = (page: import('@playwright/test').Page, name = 'Behöver dig') =>
  phoneQueue(page, name).getByRole('listitem');
const phoneRow = (page: import('@playwright/test').Page, title: string) =>
  page.getByRole('main').getByRole('listitem').getByRole('link', { name: title, exact: true });
/** Whether something in the accessibility tree is drawn: Astryx's `VisuallyHidden` clips what it holds. */
const isDrawn = (l: import('@playwright/test').Locator) =>
  l.evaluate(el => {
    for (let at: Element | null = el; at; at = at.parentElement) {
      const s = getComputedStyle(at);
      if (s.clip === 'rect(0px, 0px, 0px, 0px)' || s.clipPath === 'inset(50%)') return false;
    }
    return (el as HTMLElement).checkVisibility();
  });
const box = async (l: import('@playwright/test').Locator) => (await l.boundingBox())!;
/**
 * The rows in which something is cut: a box that clamps its lines or clips, holding more than it shows. `reflowProblems`
 * sees what is cut sideways; a line clamp cuts downwards (1.4.10).
 */
const cutRows = (rows: import('@playwright/test').Locator) =>
  rows.evaluateAll(list =>
    list
      .filter(row =>
        [...row.querySelectorAll<HTMLElement>('*')].some(el => {
          const s = getComputedStyle(el);
          const clips = s.webkitLineClamp !== 'none' || s.overflowX !== 'visible' || s.overflowY !== 'visible';
          return clips && (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1);
        }),
      )
      .map(row => row.id),
  );

test.describe('Att göra: the piles', () => {
  test.use({ viewport: wide });

  test('only items due before the Stockholm day count as overdue', async ({ page, api }) => {
    // It is already 4 November in Stockholm, still 3 November in UTC.
    await page.clock.setFixedTime(new Date('2026-11-03T23:15:00Z'));
    const invoice = api.threads.find(t => t.id === 'fakturor')!;
    api.threads = ['2026-11-03', '2026-11-04', '2026-11-05'].map(deadline => ({
      ...invoice,
      id: deadline,
      deadline,
    }));
    await open(page, '/todo');
    await expect(page.getByRole('link', { name: 'Behöver dig: 3 ärenden', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: /^Försenade: 1\b/ })).toBeVisible();
  });

  test('a failed first read cannot report zero work', async ({ page, api: _ }) => {
    await page.route('**/api/threads', route => route.fulfill({ status: 503, json: { error: FAILED } }));
    await open(page, '/todo');
    await expect(page.getByRole('main').getByRole('alert')).toBeVisible();
    await expect(page.getByRole('link', { name: /^Försenade:/ })).toHaveCount(0);
    await expectNoAxeViolations(page);
    await expect(page.getByText('0 behöver dig · 0 väntar på andra', { exact: true })).toHaveCount(0);
  });

  test('the piles are tabs that lead to their address, each with its rows; the rail says how much needs the person', async ({
    page,
    api: _,
  }) => {
    await open(page, '/todo');
    await expect(page.getByRole('heading', { level: 1, name: 'Att göra' })).toBeVisible();
    await expect(page).toHaveTitle(/^Att göra/);
    const rail = page.getByRole('navigation', { name: 'Mina sidor', exact: true });
    await expect(rail.getByRole('link', { name: /^Att göra/ })).toHaveAttribute('aria-current', 'page');
    await expect(rail.getByRole('link', { name: /^Att göra/ })).toContainText('7');
    // The tabs are the navigation pattern (no tablist): links, the current one marked, with how many as a badge.
    const tabs = page.getByRole('navigation', { name: 'Urval' });
    await expect(tabs.getByRole('link', { name: /^Behöver dig\s*7 ärenden$/ })).toHaveAttribute('aria-current', 'true');
    await expect(tabs.getByRole('link', { name: /^Väntar på andra\s*3 ärenden$/ })).toBeVisible();
    await expect(tabs.getByRole('link', { name: 'Klart', exact: true })).toBeVisible();
    // The counts line under the title (board Att göra).
    await expect(page.getByText('7 behöver dig\u00a0· 3 väntar på andra', { exact: true })).toBeVisible();
    // Behöver dig in Hem's order: what is due, what comes later, the proposal, the notice.
    const all = rows(page);
    await expect(all).toHaveCount(7);
    await expect(all.first()).toContainText('Attestera 3 fakturor, 48 200 kr');
    await expect(all.first()).toContainText('Ekonomisystemet');
    // An item about nobody in particular says why it is here, and its state in the Status column (1.4.1, D126 item 13).
    // Under Behöver dig the state's word is the tab's name, so the row draws only what it concerns beside the dot, and
    // the dot's name says the whole mark, heard once; a row with nothing more to say draws the dot alone.
    await expect(queue(page).getByRole('columnheader', { name: 'Status' })).toBeVisible();
    await expect(all.first()).toHaveText(/Fakturorna förfaller i veckan.*i dag$/);
    await expect(all.first()).not.toContainText('Behöver dig');
    await expect(all.first().getByRole('img')).toHaveAccessibleName('Behöver dig, i dag');
    let quiet = 0;
    for (const r of await all.all()) {
      const mark = r.getByRole('img', { name: /^Behöver dig/ });
      if ((await mark.count()) === 0) continue;
      quiet++;
      const name = (await mark.getAttribute('aria-label'))!;
      await expect(r.getByRole('cell').last()).toHaveText(
        name === 'Behöver dig' ? '' : name.slice('Behöver dig, '.length),
      );
    }
    expect(quiet).toBeGreaterThan(0);
    await expectNoAxeViolations(page);
    // Väntar på andra holds what waits on others and what the person set aside, which says when it comes back.
    await tabs.getByRole('link', { name: /^Väntar på andra/ }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/todo\?tab=waiting$/);
    const waiting = queue(page, 'Väntar på andra');
    await expect(rows(page, 'Väntar på andra')).toHaveCount(3);
    await expect(row(page, 'Tillbud 2026-1182, halkolycka i duschen')).toBeVisible();
    // What waits on someone says so once, with whom: the reason stands for the state.
    await expect(waiting.locator('#work-tillbud')).toContainText('Väntar på skyddsombudet');
    await expect(waiting.locator('#work-tillbud')).not.toContainText('Väntar på andra');
    const snoozed = rows(page, 'Väntar på andra').filter({ hasText: 'Brandskyddsrond i oktober saknar protokoll' });
    await expect(snoozed).toContainText('Tillbaka i morgon 06:00');
    await expect(snoozed).toContainText('Väntar\u00a0· inte nu');
    await tabs.getByRole('link', { name: 'Klart', exact: true }).click();
    await expect(page).toHaveURL(/\/todo\?tab=done$/);
    // A decision with a row in doubt waits on the person's check under Behöver dig, so Klart holds the dismissal.
    await expect(rows(page, 'Klart')).toHaveCount(1);
    await expect(row(page, 'Påminnelse om brandskyddsrond')).toBeVisible();
    await expectNoAxeViolations(page);
    // Back is the pile before: the address is the state.
    await page.goBack();
    await expect(tabs.getByRole('link', { name: /^Väntar på andra/ })).toHaveAttribute('aria-current', 'true');
  });

  test('the filter and the system narrow the rows and say how many are left; the system is in the address, the typed words never are', async ({
    page,
    api: _,
  }) => {
    await open(page, '/todo');
    const filter = page.getByRole('searchbox', { name: 'Filtrera' });
    await filter.fill('fakt');
    await expect(rows(page)).toHaveCount(2);
    // What is typed is a person's name as often as not: it stays with the page (D100 item 5).
    await expect(page).toHaveURL(/\/todo$/);
    const card = page.locator('section[aria-labelledby="todo-pile"]');
    await expect(card.getByText(/^· 2\b/)).toBeVisible();
    await expect.poll(() => announcements(page)).toContainEqual('2 ärenden');
    await filter.fill('');
    await expect(rows(page)).toHaveCount(7);
    await page.getByRole('button', { name: 'Alla system' }).click();
    await page.getByRole('menuitemradio', { name: 'Personal' }).click();
    await expect(page).toHaveURL(/\/todo\?area=personal$/);
    await expect(rows(page)).toHaveCount(3);
    await expect(row(page, 'Attestera 3 fakturor, 48 200 kr')).toHaveCount(0);
    await expect.poll(() => announcements(page)).toContainEqual('Visar Personal: 3 ärenden');
    await expect(page.getByRole('link', { name: /^Behöver dig\s*3 ärenden$/ })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Personal', exact: true })).toBeVisible();
    await expect(rows(page)).toHaveCount(3);
  });
});

test.describe('Att göra for a person with several units (D135)', () => {
  test.use({ viewport: wide });
  test('the row whose item is about one of the person’s units names it first on its line, and no other row does', async ({
    page,
    api,
  }) => {
    api.assignments = [
      { unitId: 'unit-skola', unitLabel: 'Skönsmons skola', role: 'manager' },
      { unitId: 'unit-haga', unitLabel: 'Hagaskolan', role: 'manager' },
    ];
    api.threads = api.threads.map(t =>
      t.id === 'ledighet' ? { ...t, subjects: [{ entity: 'unit' as const, key: 'unit-haga' }] } : t,
    );
    await open(page, '/todo');
    const ledighet = page.locator('#work-ledighet');
    await expect(ledighet).toContainText('Hagaskolan · ');
    await expect(page.locator('#work-fakturor')).not.toContainText('Hagaskolan');
    // The unit is read in the row beside its link; the link is still named by the title alone.
    await expect(ledighet.getByRole('link')).toHaveAccessibleName(/^Ledighetsansökan från Johan Byström/);
    await expectNoAxeViolations(page);
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
    // The decision stands directly under the title, before the facts (D126 rule 2).
    const y = async (l: import('@playwright/test').Locator) => (await l.boundingBox())!.y;
    expect(await y(pane.getByRole('button', { name: 'Attestera 2 valda' }))).toBeLessThan(
      await y(pane.getByRole('heading', { name: 'Uppgifter' })),
    );
    await expect(rows(page)).toHaveCount(7);
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
    const all = rows(page);
    for (let i = 0; i < (await all.count()); i++) await expect(all.nth(i).getByRole('link')).toHaveCount(1);
    const fakturor = page.locator('#work-fakturor');
    await expect(fakturor.getByRole('link')).toHaveAccessibleName('Attestera 3 fakturor, 48 200 kr');
    // The state and the source are read in the row, beside its link: under Behöver dig the dot names the whole mark.
    await expect(fakturor.getByRole('img', { name: 'Behöver dig, i dag' })).toBeVisible();
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
    // At its far end, clear of the pane's resize handle on the list's edge.
    await page.mouse.click(box.x + box.width - 24, box.y + box.height / 2);
    await expect(page).toHaveURL(/\/todo\?item=omtanke$/);
    await expectNoAxeViolations(page);
  });

  test('an item opened by its address shows the pile it lies in, and ✕ closes it with the focus on its row', async ({
    page,
    api: _,
  }) => {
    await open(page, '/todo?item=tillbud');
    await expect(page.getByRole('link', { name: /^Väntar på andra/ })).toHaveAttribute('aria-current', 'true');
    const pane = page.getByRole('complementary', { name: 'Valt ärende' });
    await expect(pane.locator('#card-tillbud')).toBeVisible();
    await pane.getByRole('button', { name: 'Stäng ärendet' }).click();
    await expect(page).toHaveURL(/\/todo$/);
    await expect(pane).toHaveCount(0);
    // Closing the deep-linked pane replaces its measured element. The next row follows the new width.
    await page.setViewportSize(tablet);
    const next = row(page, 'Ledighetsansökan från Johan Byström');
    await expect(next).toHaveAttribute('href', '/items/ledighet?from=%2Ftodo');
    await next.click();
    await expect(page).toHaveURL('/items/ledighet?from=%2Ftodo');
  });

  test('an item that is no longer among the person’s says so in the pane', async ({ page, api: _ }) => {
    await open(page, '/todo?item=borta');
    const pane = page.getByRole('complementary', { name: 'Valt ärende' });
    await expect(pane.getByRole('heading', { name: 'Ärendet finns inte längre' })).toBeVisible();
    await expectNoAxeViolations(page);
  });
});

test.describe('Att göra where the pane does not fit', () => {
  test('on a narrower screen the row leads to the item’s page, with the way back to the list and the focus on the row', async ({
    page,
    api: _,
  }) => {
    await page.setViewportSize(tablet);
    await open(page, '/todo');
    await row(page, 'Ledighetsansökan från Johan Byström').click();
    await expect(page).toHaveURL('/items/ledighet?from=%2Ftodo');
    // There is no pane: the item is its page (D126 rule 2), its facts above its read where the window is narrow.
    await expect(page.getByRole('complementary')).toHaveCount(0);
    await expect(queue(page)).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1, name: 'Ledighetsansökan från Johan Byström' })).toBeFocused();
    await expect(page).toHaveTitle('Ledighetsansökan från Johan Byström · Startsidan');
    await expect(page.getByRole('main').getByRole('heading', { name: 'Uppgifter' })).toBeVisible();
    await expectNoAxeViolations(page);
    await page.getByRole('main').getByRole('link', { name: 'Att göra', exact: true }).click();
    await expect(page).toHaveURL(/\/todo$/);
    await expect(rows(page)).toHaveCount(7);
    await expect(row(page, 'Ledighetsansökan från Johan Byström')).toBeFocused();
    // An item in the address where the pane does not fit is its page, in that address's place.
    await open(page, '/todo?item=omtanke');
    await expect(page).toHaveURL('/items/omtanke?from=%2Ftodo');
  });

  test('on a phone the rail is the drawer, the piles fit with their short names, and a row opens the item’s page', async ({
    page,
    api: _,
  }) => {
    await page.setViewportSize(phone);
    await open(page, '/todo');
    // The short words on a phone, so the three piles fit 320 px also with the text-spacing overrides (1.4.12).
    const piles = page.getByRole('navigation', { name: 'Urval' });
    await expect(piles.getByRole('link')).toHaveCount(3);
    for (const name of [/^Behöver dig/, /^Väntar/, /^Klart/])
      await expect(piles.getByRole('link', { name })).toBeInViewport({ ratio: 1 });
    const nav = await openNav(page);
    await expect(nav.getByRole('link', { name: /^Att göra/ })).toHaveAttribute('aria-current', 'page');
    await page.keyboard.press('Escape');
    await phoneRow(page, 'Omtankesamtal med Anna Lindqvist').click();
    await expect(page.getByRole('heading', { level: 1, name: 'Omtankesamtal med Anna Lindqvist' })).toBeVisible();
    // The decision under the title (D126 rule 1).
    await expect(page.getByRole('button', { name: 'Boka samtalet' })).toBeInViewport();
    await expect(phoneQueue(page)).toHaveCount(0);
    expect(await reflowProblems(page)).toEqual([]);
    await expectNoAxeViolations(page);
    await page.goBack();
    await expect(phoneRows(page)).toHaveCount(7);
  });

  for (const [path, title] of [
    ['/todo', 'Att göra'],
    ['/todo?tab=waiting', 'Att göra'],
    ['/items/fakturor', 'Attestera 3 fakturor, 48 200 kr'],
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
    ['/?tab=done&card=avfardad', /\/todo\?tab=done&item=avfardad$/],
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

  test('a row of Behöver dig on Hem leads to its item’s page, and the way to all of them to Att göra', async ({
    page,
    api: _,
  }) => {
    await open(page, '/');
    const block = page.getByRole('region', { name: 'Behöver dig' });
    // How many Hem shows is Hem's (`hem.spec.ts`). A row's "Öppna" is the link to its item's page, with Hem as the way back (D126 rule 1).
    await expect(block.getByRole('link', { name: /^Öppna Attestera 3 fakturor/ })).toHaveAttribute(
      'href',
      '/items/fakturor?from=%2F',
    );
    const all = block.getByRole('link', { name: /Att göra|Visa alla/ });
    await expect(all).toHaveAttribute('href', '/todo');
    await all.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/todo$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Att göra' })).toBeVisible();
    await expect(rows(page)).toHaveCount(7);
  });
});

/**
 * A notice (D112, amended 2026-11-12): a work item whose execute is the person's read receipt leads with its text, the
 * thing to read, and the way to the whole of it after the text; "Varför ser jag detta?" is its provenance line and a row
 * that only repeats its title is not drawn. The receipt's button stays among the item's buttons, reached from the text.
 */
/**
 * Below 768 px (D130 item 19, amended 2026-11-23) the queue is no table. Each work item is one row of Astryx's `List`:
 * the title, which is the row's one link and whose target is the whole row; under it the system and what the row says;
 * under that where it stands, in words. The card's heading, which the current tab directly over it already says, is
 * not drawn, and the filter and the system share a row where they fit.
 */
test.describe('Att göra on a phone: the queue is a list', () => {
  test.use({ viewport: phone });

  test('each work item is one row: the title, the system and why under it, where it stands in words, and no table', async ({
    page,
    api: _,
  }) => {
    await open(page, '/todo');
    await expect(page.getByRole('table')).toHaveCount(0);
    const all = phoneRows(page);
    await expect(all).toHaveCount(7);
    // The title, then the system and why the item is here on one line, which is not cut.
    const fakturor = page.locator('#work-fakturor');
    await expect(fakturor).toContainText('Attestera 3 fakturor, 48 200 kr');
    await expect(fakturor).toContainText('Ekonomisystemet\u00a0· Fakturorna förfaller i veckan');
    expect(await cutRows(all)).toEqual([]);
    // A to-do says when it is due as the badge its row on Hem draws, in words, never a dot alone (1.4.1).
    await expect(fakturor.getByText('I dag', { exact: true })).toBeVisible();
    await expect(page.locator('#work-omtanke').getByText('Vecka 46', { exact: true })).toBeVisible();
    await expect(all.getByRole('img')).toHaveCount(0);
    // An item from Clew itself names no system: Clew is not a system the person goes to.
    await expect(page.locator('#work-samtal')).not.toContainText('\u00a0· ');
    // The pile's heading is not drawn, since the current tab over the card says it; it still names the region and
    // says how many rows there are to a screen reader, and the outline keeps its level 2.
    const heading = page.getByRole('heading', { level: 2, name: 'Behöver dig' });
    await expect(heading).toHaveCount(1);
    expect(await isDrawn(heading)).toBe(false);
    const card = page.getByRole('region', { name: 'Behöver dig' });
    await expect(card).toContainText('· 7 ärenden');
    await expect(card.getByRole('list', { name: 'Behöver dig', exact: true })).toBeVisible();
    await expect(
      page.getByRole('navigation', { name: 'Urval' }).getByRole('link', { name: /^Behöver dig/ }),
    ).toHaveAttribute('aria-current', 'true');
    await expectNoAxeViolations(page);
    expect(await reflowProblems(page)).toEqual([]);
    // What waits says so in the vocabulary's word (D126 item 13), with what it concerns after it.
    await page
      .getByRole('navigation', { name: 'Urval' })
      .getByRole('link', { name: /^Väntar/ })
      .click();
    await expect(page).toHaveURL(/\/todo\?tab=waiting$/);
    await expect(phoneRows(page, 'Väntar på andra')).toHaveCount(3);
    const tillbud = page.locator('#work-tillbud');
    await expect(tillbud).toContainText('Avvikelsesystemet\u00a0· Väntar på skyddsombudet');
    await expect(tillbud.getByText('Väntar', { exact: true })).toBeVisible();
    await expect(page.locator('#work-brandskydd')).toContainText('Väntar\u00a0· inte nu');
    await expectNoAxeViolations(page);
    await page.getByRole('navigation', { name: 'Urval' }).getByRole('link', { name: 'Klart', exact: true }).click();
    // A decision with a row in doubt waits on the person's check under Behöver dig, so Klart holds the dismissal.
    await expect(phoneRows(page, 'Klart')).toHaveCount(1);
    await expect(page.locator('#work-attest')).toHaveCount(0);
    await expect(page.locator('#work-avfardad')).toContainText('Klart\u00a0· avfärdat');
    await expectNoAxeViolations(page);
    expect(await reflowProblems(page)).toEqual([]);
  });

  test('a row is one link and one tab stop, named by its title, and the whole row is its target; Enter opens the item’s page and the way back gives the focus to the row', async ({
    page,
    api: _,
  }) => {
    await open(page, '/todo');
    const all = phoneRows(page);
    for (let i = 0; i < (await all.count()); i++) await expect(all.nth(i).getByRole('link')).toHaveCount(1);
    const fakturor = page.locator('#work-fakturor');
    const link = fakturor.getByRole('link');
    await expect(link).toHaveAccessibleName('Attestera 3 fakturor, 48 200 kr');
    await expect(link).toHaveAttribute('href', '/items/fakturor?from=%2Ftodo');
    // 2.5.8: the row is the link's target, at least 44 px tall and as wide as the list.
    const target = await box(fakturor);
    expect(target.height).toBeGreaterThanOrEqual(44);
    expect(target.width).toBeGreaterThanOrEqual((await box(phoneQueue(page))).width - 1);
    // The rows in the order they are drawn, one stop each, and every stop of the page shows its focus (2.4.7) and is
    // not hidden under what is pinned (2.4.11).
    await link.focus();
    await page.keyboard.press('Tab');
    await expect(page.locator('#work-omtanke').getByRole('link')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator('#work-ledighet').getByRole('link')).toBeFocused();
    const { hidden, unmarked } = await hiddenFocusStops(page);
    expect({ hidden, unmarked }).toEqual({ hidden: [], unmarked: [] });
    // A press on the line under the title, or at the row's far end, follows the row's link.
    await fakturor.getByText('Fakturorna förfaller i veckan').click();
    await expect(page).toHaveURL('/items/fakturor?from=%2Ftodo');
    await page.goBack();
    const omtanke = page.locator('#work-omtanke');
    const at = await box(omtanke);
    await page.mouse.click(at.x + at.width - 12, at.y + at.height - 12);
    await expect(page).toHaveURL('/items/omtanke?from=%2Ftodo');
    await page.goBack();
    // From the keyboard, and back by the item's own way back: the row has the focus again (2.4.3).
    await page.locator('#work-ledighet').getByRole('link').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { level: 1, name: 'Ledighetsansökan från Johan Byström' })).toBeFocused();
    await page.getByRole('main').getByRole('link', { name: 'Att göra', exact: true }).click();
    await expect(page).toHaveURL(/\/todo$/);
    await expect(phoneRow(page, 'Ledighetsansökan från Johan Byström')).toBeFocused();
  });

  test('the filter and the system share a row, narrow the rows and say how many are left; a system with a long name stands under the field', async ({
    page,
    api,
  }) => {
    api.areas = [...api.areas, { ...api.areas[0]!, id: 'introduktion', title: 'Introduktion och avslut' }];
    await open(page, '/todo');
    const filter = page.getByRole('searchbox', { name: 'Filtrera' });
    const system = page.getByRole('button', { name: 'Alla system' });
    // One row: the button beside the field, whole, and the field wide enough to type in.
    const [field, button] = [await box(filter), await box(system)];
    expect(button.x).toBeGreaterThan(field.x + field.width);
    expect(button.y).toBeLessThan(field.y + field.height);
    expect(field.width).toBeGreaterThanOrEqual(80);
    expect(
      await system.evaluate(el => [...el.querySelectorAll('*')].every(e => e.scrollWidth <= e.clientWidth + 1)),
    ).toBe(true);
    await filter.fill('fakt');
    await expect(phoneRows(page)).toHaveCount(2);
    await expect(page).toHaveURL(/\/todo$/);
    await expect.poll(() => announcements(page)).toContainEqual('2 ärenden');
    // The count the filter left stays with the pile's name for a screen reader.
    await expect(page.getByRole('region', { name: 'Behöver dig' })).toContainText('· 2 ärenden');
    await filter.fill('');
    await expect(phoneRows(page)).toHaveCount(7);
    await system.click();
    await page.getByRole('menuitemradio', { name: 'Personal' }).click();
    await expect(page).toHaveURL(/\/todo\?area=personal$/);
    await expect(phoneRows(page)).toHaveCount(3);
    await expect.poll(() => announcements(page)).toContainEqual('Visar Personal: 3 ärenden');
    expect(await reflowProblems(page)).toEqual([]);
    // Nothing matches: the card says so in the rows' place.
    await filter.fill('finns inte');
    await expect(page.getByRole('heading', { level: 2, name: 'Inget som stämmer med valet' })).toBeVisible();
    await expect(phoneQueue(page)).toHaveCount(0);
    await expectNoAxeViolations(page);
    // A name the field has no room beside: the menu's button stands under the field, which has the card's width.
    await open(page, '/todo?area=introduktion');
    const long = await box(page.getByRole('button', { name: 'Introduktion och avslut' }));
    const wide = await box(page.getByRole('searchbox', { name: 'Filtrera' }));
    expect(long.y).toBeGreaterThanOrEqual(wide.y + wide.height);
    expect(await reflowProblems(page)).toEqual([]);
  });

  test('at 320 px the system stands under the filter, the rows take the lines they need and nothing scrolls sideways', async ({
    page,
    api: _,
  }) => {
    await page.setViewportSize(narrow);
    await open(page, '/todo');
    const field = await box(page.getByRole('searchbox', { name: 'Filtrera' }));
    const button = await box(page.getByRole('button', { name: 'Alla system' }));
    expect(button.y).toBeGreaterThanOrEqual(field.y + field.height);
    await expect(phoneRows(page)).toHaveCount(7);
    // Neither the title nor the line under it is cut: each takes the lines it needs.
    expect(await cutRows(phoneRows(page))).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(narrow.width);
    expect(await reflowProblems(page)).toEqual([]);
    await expectNoAxeViolations(page);
  });

  test('a work item whose system does not answer says at the end of its line that it may be old', async ({
    page,
    api,
  }) => {
    api.sources = [{ connector: 'hr', state: 'idle', lastSuccess: '2026-11-04T05:00:00.000Z', error: 'unavailable' }];
    await open(page, '/todo');
    await expect(page.locator('#work-omtanke')).toContainText('· kan vara gammal');
    await expect(page.locator('#work-fakturor')).not.toContainText('kan vara gammal');
    expect(await silentSaidIn(page)).toEqual([]);
    await expectNoAxeViolations(page);
  });
});

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
    await why.getByRole('button', { name: 'Varför ser jag detta?' }).click();
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
    // An item that is not a notice says its own words under Varför ser jag detta?, where no sentence of it stands without
    // a heading (D126 item 13), and keeps its rows above it; its link out to the source is under ⋯, marked as leaving Clew.
    await open(page, '/todo?item=fakturor');
    const invoices = pane.locator('#card-fakturor');
    await invoices.getByRole('region', { name: 'Varför ser jag detta?' }).getByRole('button').click();
    await expect(invoices.getByRole('region', { name: 'Varför ser jag detta?' })).toContainText(
      'Alla matchar sina beställningar och ryms i budgeten.',
    );
    await expect(invoices.getByRole('heading', { name: 'Rader' })).toBeVisible();
    expect(await y(invoices.getByRole('heading', { name: 'Rader' }))).toBeLessThan(
      await y(invoices.getByRole('region', { name: 'Varför ser jag detta?' })),
    );
    await invoices.getByRole('button', { name: 'Fler åtgärder' }).click();
    await expect(page.getByRole('menuitem', { name: /^Öppna i ekonomisystemet/ })).toHaveCount(1);
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
    await expect(page.getByRole('link', { name: /^Försenade:/ })).toHaveCount(0);
    await expect(page.locator('#work-omtanke')).toContainText('· kan vara gammal');
    await expect(page.locator('#work-fakturor')).toContainText('· kan vara gammal');
    expect(await rows(page).filter({ hasNotText: 'kan vara gammal' }).count()).toBeGreaterThan(0);
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
    // The most recent successful read is still a usable snapshot even though the source is unavailable now.
    await expect(page.getByRole('link', { name: 'Försenade: 0 ärenden', exact: true })).toBeVisible();
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
