import type { Locator, Page } from '@playwright/test';
import {
  announcements,
  desktop,
  expect,
  expectNoAxeViolations,
  hiddenFocusStops,
  narrow,
  open,
  phone,
  reflowProblems,
  test,
} from './support';
import { PRESENCE_LENS, TALK_LENS } from './data';

/**
 * Personal (D94, D97, artboards A2, B and A3): the people the reader may ask about, one card per unit. "Alla" has the
 * two columns an administrator chose, each with its source under its label, "Just nu" with the marks of the chosen
 * sources, and each row's menu grouped by source. "Visa" picks a lens: the list is then that source's view, sorted by
 * need, under the source's heading. A source that does not answer is said once with Försök igen; someone who manages
 * nobody gets the page's empty state. Keyboard, structure, axe and reflow, at desktop, phone and 320 px.
 *
 * The mock (`data.ts`): Bergsåkers skola with Anna, Erik, Johan, Karin and Maria; Närvaro from Personalsystemet and
 * Nästa samtal from Utvecklingssamtal as columns; the lenses Utvecklingssamtal (Karin's talk missing and Johan's two
 * late action points need the reader) and Frånvaro (nothing does); Boka samtal and Registrera frånvaro as actions.
 */
const LENS = `/staff?show=${TALK_LENS}`;
const row = (page: Page, name: string) => page.getByRole('row').filter({ hasText: name });
const showMenu = (page: Page) => page.getByRole('button', { name: /^Visa: / });
/** The section of a menu titled `title`: Astryx draws it as a named group. */
const section = (menu: Locator, title: string) => menu.getByRole('group', { name: title });
// Every test takes `api` (as `_` where it changes nothing): the fixture is what installs the mock.

test.describe('Personal', () => {
  for (const [layout, viewport] of [
    ['desktop', desktop],
    ['phone', phone],
  ] as const)
    test.describe(layout, () => {
      test.use({ viewport });
      for (const [what, path] of [
        ['Alla', '/staff'],
        ['a lens', LENS],
      ] as const)
        test(`${what} has no axe violations and every focus stop is marked`, async ({ page, api: _ }) => {
          await open(page, path);
          await expect(page.getByRole('heading', { level: 1, name: 'Personal' })).toBeVisible();
          await expect(page.getByRole('link', { name: 'Johan Byström' })).toBeVisible();
          await expectNoAxeViolations(page);
          const { unmarked } = await hiddenFocusStops(page);
          expect(unmarked).toEqual([]);
        });
      test('the Visa menu opens, chooses a lens and gives the focus back', async ({ page, api: _ }) => {
        await open(page, '/staff');
        const button = showMenu(page);
        await expect(button).toHaveText('Visa: Alla');
        await button.focus();
        await page.keyboard.press('Enter');
        const menu = page.getByRole('menu');
        await expect(menu.getByRole('menuitemradio', { name: 'Alla' })).toHaveAttribute('aria-checked', 'true');
        await expect(menu.getByText('Visa medarbetarna efter')).toBeVisible();
        await page.keyboard.press('ArrowDown');
        await expect(menu.getByRole('menuitemradio', { name: /^Utvecklingssamtal/ })).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL(LENS);
        await expect(menu).toBeHidden();
        await expect(showMenu(page)).toHaveText('Visa: Utvecklingssamtal');
        await expect(showMenu(page)).toBeFocused();
        await expect(page.getByRole('heading', { level: 2, name: 'Utvecklingssamtal 2026' })).toBeVisible();
      });
    });

  test.describe('desktop', () => {
    test.use({ viewport: desktop });
    test('a manager reaches it from the rail and sees the unit with its columns and marks', async ({
      page,
      api: _,
    }) => {
      await open(page, '/');
      const rail = page.getByRole('link', { name: 'Personal', exact: true });
      await rail.click();
      await expect(page).toHaveURL(/\/staff$/);
      await expect(page).toHaveTitle('Personal · Startsidan');
      await expect(page.getByRole('link', { name: 'Personal', exact: true })).toHaveAttribute('aria-current', 'page');
      await expect(page.getByText('5 medarbetare på Bergsåkers skola', { exact: true })).toBeVisible();
      await expect(page.getByRole('toolbar', { name: 'Bergsåkers skola' })).toContainText('5 medarbetare');
      const table = page.getByRole('table');
      await expect(table.getByRole('columnheader')).toHaveText([
        'Person',
        'NärvaroPersonalsystemet',
        'Nästa samtalUtvecklingssamtal',
        'Just nu',
        'Åtgärder',
      ]);
      await expect(table.getByRole('row').nth(1)).toContainText('Anna Lindqvist');
      // A column draws one field of the person's row from its source, a toned value as a badge.
      await expect(row(page, 'Erik Sandström').getByText('Sjuk · dag 1', { exact: true })).toBeVisible();
      await expect(row(page, 'Anna Lindqvist').getByText('I tjänst', { exact: true })).toBeVisible();
      await expect(row(page, 'Johan Byström').getByText('tors 12 nov', { exact: true })).toBeVisible();
      await expect(row(page, 'Karin Lindqvist').getByText('Inte bokat', { exact: true })).toBeVisible();
      // "Just nu": what needs the reader from the chosen sources and is not a column, with the source's words.
      await expect(row(page, 'Johan Byström').getByText('2 försenade', { exact: true })).toBeVisible();
      await expect(row(page, 'Karin Lindqvist').getByText('Samtal saknas', { exact: true })).toBeVisible();
      await expect(row(page, 'Anna Lindqvist').getByRole('cell').nth(3)).toHaveText('');
      // The name opens the person beside the list (D83 rule 1).
      await expect(page.getByRole('link', { name: 'Johan Byström' })).toHaveAttribute('href', '/staff?person=johan');
    });
    test("a column's heading reads in two lines, the label and its source, neither cut", async ({ page, api: _ }) => {
      await open(page, '/staff');
      const header = page.getByRole('columnheader', { name: 'Närvaro Personalsystemet' });
      await expect(header).toBeVisible();
      for (const text of ['Närvaro', 'Personalsystemet']) {
        const line = header.getByText(text, { exact: true });
        await expect(line).toBeVisible();
        expect(await line.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      }
      const [label, source] = await Promise.all(
        ['Närvaro', 'Personalsystemet'].map(t => header.getByText(t, { exact: true }).boundingBox()),
      );
      expect(source!.y).toBeGreaterThan(label!.y);
    });
    test('the Visa menu counts what needs the reader under each lens, and only that', async ({ page, api: _ }) => {
      await open(page, '/staff');
      await showMenu(page).click();
      const menu = page.getByRole('menu');
      await expect(section(menu, 'Visa medarbetarna efter').getByRole('menuitemradio')).toHaveText([
        /^Utvecklingssamtal/,
        /^Frånvaro/,
      ]);
      await expect(
        menu.getByRole('menuitemradio', { name: 'Utvecklingssamtal 2 medarbetare behöver dig' }),
      ).toBeVisible();
      await expect(menu.getByRole('menuitemradio', { name: 'Frånvaro', exact: true })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(showMenu(page)).toBeFocused();
    });
    test('under a lens the list is its view, sorted by need, under the source’s heading and counts', async ({
      page,
      api: _,
    }) => {
      await open(page, '/staff');
      await showMenu(page).click();
      await page.getByRole('menuitemradio', { name: /^Utvecklingssamtal/ }).click();
      await expect(page).toHaveURL(LENS);
      await expect(page).toHaveTitle('Personal · Startsidan');
      await expect(page.getByRole('heading', { level: 2, name: 'Utvecklingssamtal 2026' })).toBeVisible();
      await expect(
        page.getByText('Senast lör 28 nov · 1 saknas, 3 bokat, 1 hållet · Utvecklingssamtal', { exact: true }),
      ).toBeVisible();
      const table = page.getByRole('table');
      await expect(table.getByRole('columnheader')).toHaveText([
        'Person',
        'Samtal',
        'När',
        'Nästa samtal',
        'Åtgärdspunkter',
        'Försenade',
        'Åtgärder',
      ]);
      // A row that needs the reader first (Johan's late points, Karin's missing talk), in the directory's order.
      const names = table.getByRole('row').locator('a');
      await expect(names).toHaveText([
        'Johan Byström',
        'Karin Lindqvist',
        'Anna Lindqvist',
        'Erik Sandström',
        'Maria Källström',
      ]);
      const johan = row(page, 'Johan Byström');
      await expect(johan.getByText('Bokat', { exact: true })).toBeVisible();
      await expect(johan.getByText('tors 12 nov. kl. 09:00', { exact: true })).toBeVisible();
      await expect(johan.getByText('3 öppna', { exact: true })).toBeVisible();
      await expect(johan.getByText('2 försenade', { exact: true })).toBeVisible();
      await expect(row(page, 'Karin Lindqvist').getByText('Saknas', { exact: true })).toBeVisible();
      const maria = row(page, 'Maria Källström');
      await expect(maria.getByText('Hållet', { exact: true })).toBeVisible();
      // A day without a time is the day alone.
      await expect(maria.getByText('ons 4 nov.', { exact: true })).toBeVisible();
      // "Alla" is one step back.
      await page.goBack();
      await expect(page).toHaveURL('/staff');
      await expect(showMenu(page)).toHaveText('Visa: Alla');
    });
    test('a person the lens has no row for comes last with nothing in its columns', async ({ page, api }) => {
      api.entityRows[TALK_LENS]!.rows = api.entityRows[TALK_LENS]!.rows.filter(r => r.key !== 'anna');
      await open(page, LENS);
      const names = page.getByRole('table').getByRole('row').locator('a');
      await expect(names.last()).toHaveText('Anna Lindqvist');
      const anna = row(page, 'Anna Lindqvist').getByRole('cell');
      for (const i of [1, 2, 3, 4, 5]) await expect(anna.nth(i)).toHaveText('');
    });
    test("the row's menu is named for the person and grouped by source, the lens's own first", async ({
      page,
      api,
    }) => {
      await open(page, '/staff');
      await page.getByRole('button', { name: 'Åtgärder för Karin Lindqvist' }).click();
      let menu = page.getByRole('menu');
      await expect(menu.getByRole('group')).toHaveText([/^Utvecklingssamtal/, /^Personalsystemet/]);
      const talk = section(menu, 'Utvecklingssamtal');
      await expect(talk.getByRole('menuitem')).toHaveText(['Boka samtal', 'Öppna samtalet']);
      await expect(talk.getByRole('menuitem', { name: 'Öppna samtalet' })).toHaveAttribute('href', '/staff?talk=karin');
      await expect(section(menu, 'Personalsystemet').getByRole('menuitem')).toHaveText(['Registrera frånvaro']);
      await page.keyboard.press('Escape');
      await expect(page.getByRole('button', { name: 'Åtgärder för Karin Lindqvist' })).toBeFocused();
      // Under Frånvaro its source leads, and a page way in keeps the lens in the address.
      await open(page, `/staff?show=${PRESENCE_LENS}`);
      await page.getByRole('button', { name: 'Åtgärder för Karin Lindqvist' }).click();
      menu = page.getByRole('menu');
      await expect(menu.getByRole('group')).toHaveText([/^Personalsystemet/, /^Utvecklingssamtal/]);
      await expect(menu.getByRole('menuitem', { name: 'Öppna samtalet' })).toHaveAttribute(
        'href',
        `/staff?show=${PRESENCE_LENS}&talk=karin`,
      );
      // An action starts as a standing action does: the box asks, naming the person and their key.
      await menu.getByRole('menuitem', { name: 'Boka samtal' }).click();
      await expect.poll(() => api.asked.map(a => a.text)).toContain('Boka samtal för Karin Lindqvist (karin)');
    });
    test('a source that does not answer is said once, its column stays empty, and Försök igen asks again', async ({
      page,
      api,
    }) => {
      api.entitySilent[PRESENCE_LENS] = 'timeout';
      await open(page, '/staff');
      const said = page.getByText('Personalsystemet svarade inte i tid.', { exact: true });
      await expect(said).toHaveCount(1);
      await expect(row(page, 'Erik Sandström').getByRole('cell').nth(1)).toHaveText('');
      // The other source stands.
      await expect(row(page, 'Johan Byström').getByText('2 försenade', { exact: true })).toBeVisible();
      await expect
        .poll(async () => (await announcements(page)).filter(a => a.includes('Personalsystemet svarade inte')))
        .toHaveLength(1);
      await expectNoAxeViolations(page);
      delete api.entitySilent[PRESENCE_LENS];
      await page.getByRole('button', { name: 'Försök igen' }).click();
      await expect(said).toHaveCount(0);
      await expect(row(page, 'Erik Sandström').getByText('Sjuk · dag 1', { exact: true })).toBeVisible();
    });
    test('under a lens whose source does not answer the sentence takes the table’s place', async ({ page, api }) => {
      api.entitySilent[PRESENCE_LENS] = 'unavailable';
      await open(page, `/staff?show=${PRESENCE_LENS}`);
      await expect(page.getByRole('heading', { level: 2, name: 'Frånvaro' })).toBeVisible();
      await expect(page.getByText('Personalsystemet svarade inte.', { exact: true })).toHaveCount(1);
      await expect(page.getByRole('table')).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Försök igen' })).toBeVisible();
      await expectNoAxeViolations(page);
    });
    test('beside an opened person the list is compact: the names, the opened one current, the lens’s state', async ({
      page,
      api: _,
    }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await open(page, `${LENS}&person=johan`);
      const school = page.getByRole('list', { name: 'Bergsåkers skola' });
      await expect(school.getByRole('listitem')).toHaveCount(5);
      await expect(school.getByRole('link')).toHaveText([
        'Johan Byström',
        'Karin Lindqvist',
        'Anna Lindqvist',
        'Erik Sandström',
        'Maria Källström',
      ]);
      await expect(school.locator('[aria-current="true"]')).toContainText('Johan Byström');
      await expect(school.getByRole('listitem').filter({ hasText: 'Karin Lindqvist' })).toContainText('Saknas');
      await expect(page.getByRole('table')).toHaveCount(0);
      await expect(school.getByRole('link', { name: 'Karin Lindqvist' })).toHaveAttribute(
        'href',
        `/staff?show=${TALK_LENS}&person=karin`,
      );
      await expectNoAxeViolations(page);
    });
    test('someone who manages nobody gets the page’s empty state and the way back', async ({ page, api }) => {
      api.entitiesEmpty = true;
      await open(page, '/staff');
      await expect(page.getByRole('heading', { level: 2, name: 'Inga medarbetare att visa' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Till startsidan' })).toBeVisible();
      await expect(showMenu(page)).toHaveCount(0);
      await expect(page.getByRole('table')).toHaveCount(0);
      await expectNoAxeViolations(page);
    });
  });

  test.describe('phone', () => {
    test.use({ viewport: phone });
    test('each unit is a list: the name, the columns’ words, the marks and the menu', async ({ page, api: _ }) => {
      await open(page, '/staff');
      const school = page.getByRole('list', { name: 'Bergsåkers skola' });
      const johan = school.getByRole('listitem').filter({ hasText: 'Johan Byström' });
      await expect(johan.getByRole('link', { name: 'Johan Byström' })).toHaveAttribute('href', '/staff?person=johan');
      await expect(johan.getByText('Närvaro: I tjänst · Nästa samtal: tors 12 nov', { exact: true })).toBeVisible();
      await expect(johan.getByText('2 försenade', { exact: true })).toBeVisible();
      // A toned column value is a badge, as on the table.
      const karin = school.getByRole('listitem').filter({ hasText: 'Karin Lindqvist' });
      await expect(karin.getByText('Inte bokat', { exact: true })).toBeVisible();
      await expect(karin.getByText('Samtal saknas', { exact: true })).toBeVisible();
      await expect(johan.getByRole('button', { name: 'Åtgärder för Johan Byström' })).toBeVisible();
    });
    test('the Visa menu works on a phone and the lens draws its rows by need', async ({ page, api: _ }) => {
      await open(page, '/staff');
      await showMenu(page).click();
      await page.getByRole('menuitemradio', { name: /^Utvecklingssamtal/ }).click();
      await expect(page).toHaveURL(LENS);
      const school = page.getByRole('list', { name: 'Bergsåkers skola' });
      await expect(school.getByRole('listitem').first()).toContainText('Johan Byström');
      const karin = school.getByRole('listitem').filter({ hasText: 'Karin Lindqvist' });
      await expect(karin.getByText('Saknas', { exact: true })).toBeVisible();
      await expect(karin.getByText('Åtgärdspunkter: Inga', { exact: true })).toBeVisible();
    });
  });

  test.describe('1.4.10 reflow', () => {
    for (const [what, path] of [
      ['Alla', '/staff'],
      ['a lens', LENS],
    ] as const)
      test(`${what} reflows at 320 px`, async ({ page, api: _ }) => {
        await page.setViewportSize(narrow);
        await open(page, path);
        await expect(page.getByRole('list', { name: 'Bergsåkers skola' })).toBeVisible();
        expect(await reflowProblems(page)).toEqual([]);
      });
  });
});
