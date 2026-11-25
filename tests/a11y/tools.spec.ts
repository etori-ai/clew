import {
  announcements,
  desktop,
  expect,
  expectNoAxeViolations,
  narrow,
  open,
  pagesNav,
  phone,
  reflowProblems,
  test,
  toolRow,
  toolsButton,
} from './support';
import { menuRows } from './phonebook';
import { roomsMenuRow } from './rooms';
import { TOOLBOX_HREF, siteHeaderWithToolbox } from './data';

/**
 * A tool as a page (D42, D112 item 6, board Tool): a view an administrator chose for the menu opens at
 * `/tools/:capability` inside the one shell, as Kalender does, and never in the side panel. The phone book is the
 * example, answered by the connector itself. The page is the tool's name with the system's badge, the filter bar (the
 * view's search field and choice, the count of its rows) and the rows; a row's own read, the contact card, is a page of
 * its own with the tool as its way back (D126 rules 1 and 3): nothing opens beside or over the tool.
 */
const directory = '/tools/phonebook.directory';
const team = '/tools/phonebook.team';
const wide = { width: 1440, height: 900 };
const withInput = (input: object) => `${directory}?input=${encodeURIComponent(JSON.stringify(input))}`;
const rail = pagesNav;
/** The tools' menu's button (D130), named by the tool whose page is open. */
const named = (page: import('@playwright/test').Page, tool: string) =>
  rail(page).getByRole('button', { name: tool, exact: true });

test.describe('a tool as a page', () => {
  test.use({ viewport: wide });

  test('the page is named by the tool, holds the view as a table, opens no dialog, and has no axe violations', async ({
    page,
    api,
  }) => {
    api.menu = menuRows;
    await open(page, directory);
    const title = page.locator('h1:not([aria-level]), [aria-level="1"]');
    await expect(title).toHaveText('Telefonbok');
    await expect(page).toHaveTitle('Telefonbok · Startsidan');
    // The title's line: the name and the system's badge (board Tool). Under it the filter bar: the search field, the
    // view's own choice and the count of the rows at its end.
    const main = page.getByRole('main');
    await expect(main.getByText('Telefonboken', { exact: true }).first()).toBeVisible();
    const field = page.getByRole('searchbox', { name: 'Sök i telefonboken' });
    await expect(field).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Sök i', exact: true })).toBeVisible();
    const count = main.getByText('14 kontakter', { exact: true });
    await expect(count).toBeVisible();
    const [t, f, c] = await Promise.all([title.boundingBox(), field.boundingBox(), count.boundingBox()]);
    expect(f!.y).toBeGreaterThanOrEqual(t!.y + t!.height);
    expect(c!.x).toBeGreaterThan(f!.x + f!.width);
    // No "Samtal" column: a row goes into a conversation only beside a conversation's own box (D112 item 7).
    await expect(page.getByRole('columnheader')).toHaveText(['Namn', 'Titel', 'Enhet', 'Telefon', 'Mobil', 'E-post']);
    await expect(page.getByRole('row')).toHaveCount(15);
    await expect(page.getByRole('link', { name: '0980-319 203' })).toHaveAttribute('href', 'tel:0980319203');
    await expect(page.getByText('14 rader · Telefonboken')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(named(page, 'Telefonbok')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(wide.width);
    await expectNoAxeViolations(page);
  });

  test("the calendar's rooms are a tool like any connector's view: a row under Verktyg, a page named by it, and no axe violations", async ({
    page,
    api,
  }) => {
    api.menu = [...menuRows, roomsMenuRow];
    await open(page, '/tools/calendar.rooms');
    await expect(page.locator('h1:not([aria-level]), [aria-level="1"]')).toHaveText('Mötesrum');
    await expect(page).toHaveTitle('Mötesrum · Startsidan');
    await expect(page.getByRole('columnheader')).toHaveText(['Rum', 'Platser', 'Utrustning']);
    await expect(page.getByRole('row')).toHaveCount(8);
    await expect(page.getByText('7 rader · Kalendern')).toBeVisible();
    await expect(named(page, 'Mötesrum')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expectNoAxeViolations(page);
  });

  test('typing asks again in place: the field keeps the focus, the address never holds the words, the count is spoken, and one step back leaves the tool', async ({
    page,
    api,
  }) => {
    api.menu = menuRows;
    await open(page, '/');
    await (await toolRow(page, 'Telefonbok')).click();
    const field = page.getByRole('searchbox', { name: 'Sök i telefonboken' });
    await field.fill('lärare');
    await expect(page.getByRole('row')).toHaveCount(3);
    await expect(field).toBeFocused();
    await expect(page).toHaveURL(/\/tools\/phonebook\.directory(\?|$)/);
    expect(page.url()).not.toContain('l%C3%A4rare');
    await expect.poll(() => announcements(page)).toContainEqual(expect.stringContaining('2 kontakter'));
    await field.fill('');
    await page.getByRole('combobox', { name: 'Sök i', exact: true }).click();
    await page.getByRole('option', { name: 'Min enhet' }).click();
    await expect(page.getByRole('row')).toHaveCount(6);
    await field.fill('xyzzy');
    await expect(page.getByRole('paragraph').filter({ hasText: 'Inga träffar i telefonboken.' })).toBeVisible();
    await expectNoAxeViolations(page);
    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
  });

  test('a name opens the contact card’s own page with the tool as the way back; Back gives the rows and the focus back (D126 rules 1 and 3)', async ({
    page,
    api,
  }) => {
    api.menu = menuRows;
    await open(page, withInput({ query: 'lärare' }));
    const name = page.getByRole('link', { name: 'Anna Lindqvist' });
    await name.focus();
    await page.keyboard.press('Enter');
    // Nothing opens over the page: the card is a page of its own, the record's name its heading.
    await expect(page).toHaveURL(/\/tools\/phonebook\.person\?.*from=/);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('complementary', { name: 'Kontaktkort' })).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1, name: 'Anna Lindqvist' })).toBeVisible();
    await expect(page.getByRole('main').getByRole('link', { name: '0980-319 203' })).toHaveAttribute(
      'href',
      'tel:0980319203',
    );
    await expect(page.getByRole('main').getByRole('link', { name: 'Telefonbok', exact: true })).toBeVisible();
    await expectNoAxeViolations(page);
    await page.goBack();
    await expect(page.getByRole('searchbox')).toHaveValue('lärare');
    await expect(page.getByRole('row')).toHaveCount(3);
    await expect(name).toBeFocused();
  });

  test('an address from before that opened a card or a contact card beside the tool leads to its page, the tool as the way back', async ({
    page,
    api,
  }) => {
    api.menu = menuRows;
    await open(page, `${directory}?card=fakturor`);
    await expect(page).toHaveURL(`/items/fakturor?from=${encodeURIComponent(directory)}`);
    await expect(page.getByRole('heading', { level: 1, name: /^Attestera 3 fakturor/ })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('the page asks through the corner’s Fråga AI, not a button on its title line or a box at its foot, the page stays when it is pressed, and nothing offers Lägg till i samtalet', async ({
    page,
    api,
  }) => {
    api.menu = menuRows;
    await open(page, directory);
    // The corner's button (D138 items 1 and 3): the door to the assistant's pane beside the page, which stays
    // (`ask-pane.spec.ts`). The page draws no way to ask of its own.
    const ask = page.getByRole('button', { name: 'Fråga AI', exact: true });
    await expect(ask).toBeVisible();
    await expect(page.getByRole('button', { name: 'Fråga assistenten' })).toHaveCount(0);
    await expect(page.getByRole('combobox', { name: 'Vad vill du göra' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Lägg till i samtalet' })).toHaveCount(0);
    await ask.click();
    await expect(page).toHaveURL(/\/tools\/phonebook\.directory\?ask=1$/);
    await expect(page.getByRole('button', { name: 'Lägg till i samtalet' })).toHaveCount(0);
  });

  test("another tool takes the page: its name is the heading and is said aloud, and its rows replace the first tool's", async ({
    page,
    api,
  }) => {
    api.menu = menuRows;
    await open(page, directory);
    await expect(page.getByRole('row')).toHaveCount(15);
    await (await toolRow(page, 'Mitt team')).click();
    await expect(page.locator('h1:not([aria-level]), [aria-level="1"]')).toHaveText('Mitt team');
    await expect(page.getByRole('list', { name: 'Telefonboken' }).getByRole('listitem')).toHaveCount(5);
    await expect(page.getByRole('table')).toHaveCount(0);
    await expect(page.getByRole('searchbox', { name: 'Sök i telefonboken' })).toHaveCount(0);
    // A view without controls has a filter bar of its count alone.
    await expect(page.getByRole('main').getByText('5 kontakter', { exact: true })).toBeVisible();
    await expect.poll(() => announcements(page)).toContainEqual(expect.stringContaining('Mitt team'));
    await expect(named(page, 'Mitt team')).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test('a view not placed in the menu has a page of its own all the same, under its own title or the one it was opened under (D116)', async ({
    page,
    api: _,
  }) => {
    // No row in the menu: the directory is still a read the person may open.
    await open(page, directory);
    const title = page.locator('h1:not([aria-level]), [aria-level="1"]');
    await expect(title).toHaveText('Sök i telefonboken');
    await expect(page).toHaveTitle('Sök i telefonboken · Startsidan');
    await expect(page.getByRole('row')).toHaveCount(15);
    // Opened from nowhere it names no way back, and neither a page nor a tool is said to be open.
    await expect(page.getByRole('main').getByRole('link', { name: 'Hem', exact: true })).toHaveCount(0);
    await expect(rail(page).locator('a[aria-current="page"]')).toHaveCount(0);
    await expect(toolsButton(page)).toHaveCount(0);
    await expectNoAxeViolations(page);
    // Opened from Hem under another name: that name, Hem as the way back, and Start marked among the pages.
    await open(page, `${directory}?title=Telefonlistan&from=%2F`);
    await expect(title).toHaveText('Telefonlistan');
    await expect(page.getByRole('main').getByRole('link', { name: 'Hem', exact: true })).toHaveAttribute('href', '/');
    await expect(rail(page).locator('a[aria-current="page"]')).toHaveText('Start');
    // Its own search keeps the name and the way back, and its words stay out of the address.
    await page.getByRole('searchbox', { name: 'Sök i telefonboken' }).fill('lärare');
    await expect(page.getByRole('row')).toHaveCount(3);
    await expect(page).toHaveURL(/\/tools\/phonebook\.directory\?title=Telefonlistan&from=%2F$/);
  });

  test('a read the person may not open says the same as one that does not exist, and neither is asked for', async ({
    page,
    api,
  }) => {
    api.views = api.views.filter(v => v.capability !== 'phonebook.directory');
    const asked: string[] = [];
    page.on('request', request => {
      const path = new URL(request.url()).pathname;
      if (path.startsWith('/api/cap/')) asked.push(path);
    });
    const missing = async (path: string) => {
      await open(page, path);
      const title = page.locator('h1:not([aria-level]), [aria-level="1"]');
      await expect(title).toHaveText('Verktyget finns inte');
      await expect(page).toHaveTitle('Verktyget finns inte · Startsidan');
      await expect(page.getByRole('table')).toHaveCount(0);
      await expect(page.getByRole('link', { name: 'Till startsidan' })).toHaveAttribute('href', '/');
      return page.getByRole('main').innerText();
    };
    const notTheirs = await missing(`${directory}?title=Telefonbok&from=%2F`);
    await expectNoAxeViolations(page);
    const unknown = await missing('/tools/nothing.here?title=Telefonbok&from=%2F');
    expect(notTheirs).toBe(unknown);
    expect(asked.filter(p => p.endsWith('/phonebook.directory') || p.endsWith('/nothing.here'))).toEqual([]);
  });

  test('the keyboard reaches the field, the choice, each name and each number, in the order they are read', async ({
    page,
    api,
  }) => {
    api.menu = menuRows;
    await open(page, withInput({ query: 'lindqvist' }));
    await page.getByRole('searchbox').focus();
    const stops: string[] = [];
    for (let i = 0; i < 7; i++) {
      await page.keyboard.press('Tab');
      stops.push(
        await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          return (el?.getAttribute('aria-label') ?? el?.textContent ?? '').trim();
        }),
      );
    }
    expect(stops.join(' | ')).toContain('Anna Lindqvist | 0980-319 203 | anna.lindqvist@kommun.example');
    expect(stops).not.toContain('Lägg till i samtalet');
  });
});

test.describe("a tool's page on a smaller screen", () => {
  test('on a laptop the rows are a table, one line a person, and nothing scrolls sideways', async ({ page, api }) => {
    await page.setViewportSize(desktop);
    api.menu = menuRows;
    await open(page, directory);
    await expect(page.locator('h1:not([aria-level]), [aria-level="1"]')).toHaveText('Telefonbok');
    const rows = page.getByRole('table').getByRole('row');
    await expect(rows).toHaveCount(15);
    expect((await rows.nth(1).boundingBox())!.height).toBeLessThan(60);
    expect(await page.getByRole('table').evaluate(table => table.scrollWidth <= table.clientWidth + 1)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(desktop.width);
    // A Swedish title is one long word, and a table's cells break a word they cannot hold: Löneadministratör must not.
    const brokenWords = await page.getByRole('table').evaluate(table => {
      const walker = document.createTreeWalker(table, NodeFilter.SHOW_TEXT),
        found: string[] = [];
      for (let node = walker.nextNode(); node; node = walker.nextNode())
        for (const word of node.textContent!.matchAll(/\S+/g)) {
          const range = document.createRange();
          range.setStart(node, word.index);
          range.setEnd(node, word.index + word[0].length);
          if (new Set([...range.getClientRects()].map(rect => Math.round(rect.top))).size > 1) found.push(word[0]);
        }
      return found;
    });
    expect(brokenWords).toEqual([]);
    await expectNoAxeViolations(page);
  });

  test('in a narrower window the same rows are a list, and nothing scrolls sideways', async ({ page, api }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    api.menu = menuRows;
    await open(page, directory);
    await expect(page.getByRole('list', { name: 'Telefonboken' }).getByRole('listitem')).toHaveCount(14);
    await expect(page.getByRole('table')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1024);
  });

  test('on a phone the page fits, and a name leads to the contact card’s page', async ({ page, api }) => {
    await page.setViewportSize(phone);
    api.menu = menuRows;
    await open(page, directory);
    await expect(page.locator('h1:not([aria-level]), [aria-level="1"]')).toHaveText('Telefonbok');
    await expectNoAxeViolations(page);
    await page.getByRole('link', { name: 'Hassan Ali' }).click();
    await expect(page).toHaveURL(/\/tools\/phonebook\.person\?/);
    await expect(page.getByRole('heading', { level: 1, name: 'Hassan Ali' })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expectNoAxeViolations(page);
  });

  test('at 320 px the page reflows: no sideways scrolling and nothing cut off', async ({ page, api }) => {
    await page.setViewportSize(narrow);
    api.menu = menuRows;
    await open(page, directory);
    await expect(page.getByRole('list', { name: 'Telefonboken' })).toBeVisible();
    expect(await reflowProblems(page)).toEqual([]);
    await expectNoAxeViolations(page);
  });
});

/**
 * Alla verktyg (D126 rule 7, the `library` template): every tool the person may open, where the menu's first four end.
 * The title and how many there are, a search field that narrows the tiles in place, the tiles in sections by the
 * system they belong to, each tile the link to its tool's page with the catalogue as its way back, and at the foot the
 * intranet's own page of tools when the shared header names one. The menu's last row leads here, and the menu's button is named by it while it is open.
 */
test.describe('Alla verktyg', () => {
  test.use({ viewport: wide });
  const catalogue = (page: import('@playwright/test').Page) => page.getByRole('main');
  const tile = (page: import('@playwright/test').Page, name: string) =>
    catalogue(page).getByRole('link', { name, exact: true });
  const field = (page: import('@playwright/test').Page) => page.getByRole('searchbox', { name: 'Sök bland verktygen' });

  test('every tool by its system, each tile its link with its icon, name, what it is and system; the menu’s button named by it; one heading order', async ({
    page,
    api,
  }) => {
    api.menu = [...menuRows, roomsMenuRow];
    await open(page, '/');
    const all = await toolRow(page, 'Alla verktyg');
    await expect(all).toHaveAttribute('href', '/tools');
    await all.click();
    await expect(page).toHaveURL('/tools');
    await expect(page).toHaveTitle('Alla verktyg · Startsidan');
    await expect(page.locator('h1:not([aria-level]), [aria-level="1"]')).toHaveText('Alla verktyg');
    await expect(named(page, 'Alla verktyg')).toBeVisible();
    await expect(catalogue(page).getByText('3 verktyg', { exact: true })).toBeVisible();
    // A section per system, Clew's own (the calendar's house mark) before the systems in their registered order.
    const sections = catalogue(page).getByRole('region');
    await expect(sections).toHaveCount(2);
    await expect(sections.nth(0).getByRole('heading', { level: 2 })).toHaveText('Kalendern');
    await expect(sections.nth(1).getByRole('heading', { level: 2 })).toHaveText('Telefonboken');
    const phonebook = page.getByRole('region', { name: 'Telefonboken' });
    await expect(phonebook.getByRole('heading', { level: 3 })).toHaveText(['Mitt team', 'Telefonbok']);
    // What the tool is, when the read's own title says more than its name, and its system.
    await expect(phonebook.getByText('Sök i telefonboken', { exact: true })).toBeVisible();
    await expect(phonebook.getByText('Telefonboken', { exact: true })).toHaveCount(3);
    await expect(tile(page, 'Telefonbok')).toHaveAttribute('href', '/tools/phonebook.directory?from=%2Ftools');
    // The tiles of a row are one height.
    const [a, b] = await Promise.all([tile(page, 'Mitt team').boundingBox(), tile(page, 'Telefonbok').boundingBox()]);
    expect(Math.abs(a!.height - b!.height)).toBeLessThan(2);
    // No intranet link without a header that names the intranet's page of tools.
    await expect(page.getByRole('link', { name: /Fler verktyg på intranätet/ })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(wide.width);
    await expectNoAxeViolations(page);
  });

  test('the field narrows in place: the address carries the words, the count is said; with no match the empty state clears the search back to the field', async ({
    page,
    api,
  }) => {
    api.menu = [...menuRows, roomsMenuRow];
    await open(page, '/tools');
    await field(page).fill('mitt');
    await expect(field(page)).toBeFocused();
    await expect(page).toHaveURL('/tools?filter=mitt');
    await expect(catalogue(page).getByRole('heading', { level: 3 })).toHaveText(['Mitt team']);
    await expect(catalogue(page).getByText('1 av 3 verktyg', { exact: true })).toBeVisible();
    await expect.poll(() => announcements(page)).toContainEqual(expect.stringContaining('1 verktyg'));
    // A system's name narrows too.
    await field(page).fill('kalendern');
    await expect(catalogue(page).getByRole('heading', { level: 3 })).toHaveText(['Mötesrum']);
    await field(page).fill('fordon');
    await expect(page.getByRole('heading', { level: 2, name: 'Inget verktyg matchar sökningen' })).toBeVisible();
    await expect
      .poll(() => announcements(page))
      .toContainEqual(expect.stringContaining('Inget verktyg matchar sökningen'));
    await expectNoAxeViolations(page);
    await page.getByRole('button', { name: 'Rensa sökningen' }).click();
    await expect(field(page)).toBeFocused();
    await expect(field(page)).toHaveValue('');
    await expect(page).toHaveURL('/tools');
    await expect(catalogue(page).getByRole('heading', { level: 3 })).toHaveCount(3);
    // The address is the state: a reload keeps the words.
    await open(page, '/tools?filter=tele');
    await expect(field(page)).toHaveValue('tele');
    await expect(catalogue(page).getByRole('heading', { level: 3 })).toHaveText(['Mitt team', 'Telefonbok']);
  });

  test('a tile opens its tool’s page by keyboard, named as its way back, and Back returns to the tile', async ({
    page,
    api,
  }) => {
    api.menu = menuRows;
    await open(page, '/tools');
    await tile(page, 'Telefonbok').focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL('/tools/phonebook.directory?from=%2Ftools');
    await expect(page.locator('h1:not([aria-level]), [aria-level="1"]')).toHaveText('Telefonbok');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(named(page, 'Telefonbok')).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL('/tools');
    await expect(tile(page, 'Telefonbok')).toBeFocused();
  });

  test('the intranet’s page of tools at the foot, in a new tab, when the shared header names one', async ({
    page,
    api,
  }) => {
    api.menu = menuRows;
    api.header = siteHeaderWithToolbox();
    await open(page, '/tools');
    const more = catalogue(page).getByRole('link', { name: /^Fler verktyg på intranätet/ });
    await expect(more).toHaveAccessibleName(/^Fler verktyg på intranätet\s*\(öppnas i ny flik\)$/);
    await expect(more).toHaveAttribute('href', TOOLBOX_HREF);
    await expect(more).toHaveAttribute('target', '_blank');
    // At the foot: after the last tile.
    const [last, foot] = await Promise.all([tile(page, 'Telefonbok').boundingBox(), more.boundingBox()]);
    expect(foot!.y).toBeGreaterThan(last!.y + last!.height);
    await expectNoAxeViolations(page);
  });

  test('without a tool the page says so, with no field, and the pages have no Verktyg', async ({ page, api }) => {
    api.menu = [];
    await open(page, '/tools');
    await expect(page.getByRole('heading', { level: 2, name: 'Inga verktyg för dig än' })).toBeVisible();
    await expect(field(page)).toHaveCount(0);
    await expect(toolsButton(page)).toHaveCount(0);
    await expectNoAxeViolations(page);
  });

  test('at 320 px the tiles are one column, nothing reflows past the edge, and the field narrows them', async ({
    page,
    api,
  }) => {
    await page.setViewportSize(narrow);
    api.menu = [...menuRows, roomsMenuRow];
    await open(page, '/tools');
    const [a, b] = await Promise.all([tile(page, 'Mitt team').boundingBox(), tile(page, 'Telefonbok').boundingBox()]);
    expect(b!.y).toBeGreaterThan(a!.y + a!.height);
    expect(await reflowProblems(page)).toEqual([]);
    await field(page).fill('tele');
    await expect(catalogue(page).getByRole('heading', { level: 3 })).toHaveText(['Mitt team', 'Telefonbok']);
    expect(await reflowProblems(page)).toEqual([]);
    await expectNoAxeViolations(page);
  });
});
