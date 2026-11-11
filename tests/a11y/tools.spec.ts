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
import { menuRows } from './phonebook';
import { roomsMenuRow } from './rooms';

/**
 * A tool as a page (D42): a view an administrator chose for the menu opens at `/tools/:capability` inside the one
 * shell, as Kalender does, and never in the side panel. The phone book is the example, answered by the connector
 * itself. The page is the declared view under the tool's name; a row's own view, the contact card, opens in the side
 * panel over the page, and the address names both.
 */
const directory = '/tools/phonebook.directory';
const team = '/tools/phonebook.team';
const wide = { width: 1440, height: 900 };
const withInput = (input: object) => `${directory}?input=${encodeURIComponent(JSON.stringify(input))}`;
const rail = (page: import('@playwright/test').Page) => page.getByRole('navigation', { name: 'Sidonavigering' });

test.describe('a tool as a page', () => {
  test.use({ viewport: wide });

  test('the page is named by the tool, holds the view as a table, opens no dialog, and has no axe violations', async ({
    page,
    api,
  }) => {
    api.menu = menuRows;
    await open(page, directory);
    await expect(page.locator('h1:not([aria-level]), [aria-level="1"]')).toHaveText('Telefonbok');
    await expect(page).toHaveTitle('Telefonbok · Startsidan');
    await expect(page.getByRole('columnheader')).toHaveText([
      'Namn',
      'Titel',
      'Enhet',
      'Telefon',
      'Mobil',
      'E-post',
      'Samtal',
    ]);
    await expect(page.getByRole('row')).toHaveCount(15);
    await expect(page.getByRole('link', { name: '0980-319 203' })).toHaveAttribute('href', 'tel:0980319203');
    await expect(page.getByText('14 rader · Telefonboken')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(rail(page).locator('a[aria-current="page"]')).toHaveText('Telefonbok');
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
    await expect(rail(page).getByRole('link', { name: 'Mötesrum' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expectNoAxeViolations(page);
  });

  test('typing asks again in place: the field keeps the focus, the address carries the question, the count is spoken, and one step back leaves the tool', async ({
    page,
    api,
  }) => {
    api.menu = menuRows;
    await open(page, '/');
    await rail(page).getByRole('link', { name: 'Telefonbok' }).click();
    const field = page.getByRole('searchbox', { name: 'Sök i telefonboken' });
    await field.fill('lärare');
    await expect(page.getByRole('row')).toHaveCount(3);
    await expect(field).toBeFocused();
    await expect(page).toHaveURL(/\/tools\/phonebook\.directory\?input=.*l%C3%A4rare/);
    await expect.poll(() => announcements(page)).toContainEqual(expect.stringContaining('2 kontakter'));
    await field.fill('');
    await page.getByRole('combobox', { name: 'Sök i', exact: true }).click();
    await page.getByRole('option', { name: 'Min enhet' }).click();
    await expect(page.getByRole('row')).toHaveCount(6);
    await field.fill('xyzzy');
    await expect(page.getByRole('heading', { level: 2, name: 'Inga träffar i telefonboken.' })).toBeVisible();
    await expectNoAxeViolations(page);
    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
  });

  test('a name opens the contact card in the side panel beside the page; closing it gives the rows and the focus back', async ({
    page,
    api,
  }) => {
    api.menu = menuRows;
    await open(page, withInput({ query: 'lärare' }));
    const name = page.getByRole('link', { name: 'Anna Lindqvist' });
    await name.focus();
    await page.keyboard.press('Enter');
    const contact = page.getByRole('complementary', { name: 'Kontaktkort' });
    await expect(contact.getByText('Anna Lindqvist')).toBeVisible();
    await expect(contact.getByRole('link', { name: '0980-319 203' })).toHaveAttribute('href', 'tel:0980319203');
    // The address names the tool, what was asked in it and the card, so a link or a reload lands here.
    await expect(page).toHaveURL(
      /\/tools\/phonebook\.directory\?input=.*&open=phonebook\.person&open-title=Kontaktkort&open-input=/,
    );
    await expect(contact.locator(':focus')).toHaveCount(1);
    // The first view in the panel has nothing to go back to: the way out is to close it.
    await expect(contact.getByRole('button', { name: 'Tillbaka' })).toHaveCount(0);
    await expect(page).toHaveTitle('Kontaktkort · Startsidan');
    await expectNoAxeViolations(page);
    await page.keyboard.press('Escape');
    await expect(contact).toHaveCount(0);
    await expect(page).toHaveURL(/\/tools\/phonebook\.directory\?input=[^&]*$/);
    await expect(page.getByRole('searchbox')).toHaveValue('lärare');
    await expect(page.getByRole('row')).toHaveCount(3);
    await expect(name).toBeFocused();
    await expect(page).toHaveTitle('Telefonbok · Startsidan');
  });

  test('an address with a card opens the page and the card after a reload, and the back button closes the card', async ({
    page,
    api,
  }) => {
    api.menu = menuRows;
    await open(page, directory);
    await page.getByRole('link', { name: 'Anna Lindqvist' }).click();
    await expect(page.getByRole('complementary', { name: 'Kontaktkort' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('complementary', { name: 'Kontaktkort' }).getByText('Anna Lindqvist')).toBeVisible();
    await expect(page.locator('h1:not([aria-level]), [aria-level="1"]')).toHaveText('Telefonbok');
    await page.goBack();
    await expect(page.getByRole('complementary', { name: 'Kontaktkort' })).toHaveCount(0);
    await expect(page.getByRole('row')).toHaveCount(15);
  });

  test('the page has a question box, so a card beside it and its rows offer Lägg till i samtalet, which puts the card in the box', async ({
    page,
    api,
  }) => {
    api.menu = menuRows;
    // Wide enough for the table to keep its width beside the card (1720 px), so the rows are the table's.
    await page.setViewportSize({ width: 1920, height: 1080 });
    await open(page, `${directory}?card=fakturor`);
    await expect(
      page.getByRole('row').filter({ hasText: 'Anna Lindqvist' }).getByRole('button', { name: 'Lägg till i samtalet' }),
    ).toBeVisible();
    const card = page.getByRole('complementary', { name: 'Kort' }).locator('#card-fakturor');
    await expect(card.getByRole('button', { name: 'Attestera 2 valda' })).toBeVisible();
    await card.getByRole('button', { name: 'Lägg till i samtalet' }).click();
    await expect(composer(page)).toBeFocused();
    await expect(page.getByRole('button', { name: 'Ta bort Attestera 3 fakturor, 48 200 kr' })).toBeVisible();
    await expect(card.getByRole('button', { name: 'I samtalet' })).toBeDisabled();
    await expect(page).toHaveURL(`${directory}?card=fakturor`);
  });

  test("another tool takes the page: its name is the heading and is said aloud, and its rows replace the first tool's", async ({
    page,
    api,
  }) => {
    api.menu = menuRows;
    await open(page, directory);
    await expect(page.getByRole('row')).toHaveCount(15);
    await rail(page).getByRole('link', { name: 'Mitt team' }).click();
    await expect(page.locator('h1:not([aria-level]), [aria-level="1"]')).toHaveText('Mitt team');
    await expect(page.getByRole('list', { name: 'Telefonboken' }).getByRole('listitem')).toHaveCount(5);
    await expect(page.getByRole('table')).toHaveCount(0);
    await expect(page.getByRole('searchbox', { name: 'Sök i telefonboken' })).toHaveCount(0);
    await expect.poll(() => announcements(page)).toContainEqual(expect.stringContaining('Mitt team'));
    await expect(rail(page).locator('a[aria-current="page"]')).toHaveText('Mitt team');
    await expectNoAxeViolations(page);
  });

  test("a view that is not in the person's menu has no page: the page says so and leads home", async ({
    page,
    api: _,
  }) => {
    await open(page, directory);
    await expect(page.locator('h1:not([aria-level]), [aria-level="1"]')).toHaveText('Verktyget finns inte');
    await expect(page).toHaveTitle('Verktyget finns inte · Startsidan');
    await expect(page.getByRole('table')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Till startsidan' })).toHaveAttribute('href', '/');
    await expectNoAxeViolations(page);
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
    expect(stops.join(' | ')).toContain(
      'Anna Lindqvist | 0980-319 203 | anna.lindqvist@kommun.example | Lägg till i samtalet',
    );
  });
});

test.describe("a tool's page on a smaller screen", () => {
  test('beside the rail on a laptop the rows are a table, one line a person, and nothing scrolls sideways', async ({
    page,
    api,
  }) => {
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

  test('with a contact card beside it the page gives way: its rows are the list until the table fits beside the panel too', async ({
    page,
    api,
  }) => {
    // The panel stands beside every page from 1336 px; the table needs 1280 px beside the rail, and as much again
    // beside the panel (1720 px), so between the two the page draws the list it draws on a narrower window.
    await page.setViewportSize(wide);
    api.menu = menuRows;
    await open(page, directory);
    await expect(page.getByRole('table')).toBeVisible();
    await page.getByRole('link', { name: 'Hassan Ali' }).click();
    const contact = page.getByRole('complementary', { name: 'Kontaktkort' });
    await expect(contact.getByText('Hassan Ali').first()).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('table')).toHaveCount(0);
    await expect(page.getByRole('list', { name: 'Telefonboken' }).getByRole('listitem')).toHaveCount(14);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expectNoAxeViolations(page);
    await contact.getByRole('button', { name: 'Stäng panelen' }).click();
    await expect(page.getByRole('table')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Hassan Ali' })).toBeFocused();
  });

  test('on a phone the page and the card both fit, and the card closes back to the rows', async ({ page, api }) => {
    await page.setViewportSize(phone);
    api.menu = menuRows;
    await open(page, directory);
    await expect(page.locator('h1:not([aria-level]), [aria-level="1"]')).toHaveText('Telefonbok');
    await expectNoAxeViolations(page);
    await page.getByRole('link', { name: 'Hassan Ali' }).click();
    const contact = page.getByRole('dialog', { name: 'Kontaktkort' });
    await expect(contact.getByText('Hassan Ali')).toBeVisible();
    await expectNoAxeViolations(page);
    await contact.getByRole('button', { name: 'Stäng panelen' }).click();
    await expect(page.getByRole('list', { name: 'Telefonboken' }).getByRole('listitem')).toHaveCount(14);
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
