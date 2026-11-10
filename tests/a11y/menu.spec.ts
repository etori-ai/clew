import type { MenuEntry } from '@clew/contracts';
import { desktop, expect, expectNoAxeViolations, narrow, open, openNav, phone, test } from './support';
import { menuRow, menuRows } from './phonebook';

/**
 * Verktyg in the menu (D40): the calendar and the views an administrator chose as tools, one click away on every page.
 * A row leads to the tool's own page (D42), as Kalender does; the page itself is tested in `tools.spec.ts`.
 * The phone book's rows are named by its real manifest; they are in the menu only where a test puts them, as they are in
 * the product only where an administrator chose them.
 */
const rail = (page: import('@playwright/test').Page) => page.getByRole('navigation', { name: 'Sidonavigering' });
const tool = (label: string, n: number): MenuEntry => ({
  connector: 'verktyg-' + n,
  source: 'System ' + n,
  capability: `verktyg-${n}.open`,
  title: label,
  label,
  icon: (['book', 'document', 'chart', 'people', 'clock', 'link', 'search'] as const)[n % 7]!,
});

test.describe('Verktyg in the menu', () => {
  test.use({ viewport: desktop });

  // The suite's person is a manager, so Personal (D94) stands under the calendar, before the chosen views.
  test("the section is named, holds the calendar, a manager's Personal and then the chosen views of a connector in alphabetical order, and has no axe violations", async ({
    page,
    api,
  }) => {
    api.menu = menuRows;
    await open(page, '/');
    const section = rail(page).getByRole('group', { name: 'Verktyg' });
    await expect(section.getByRole('link')).toHaveText(['Kalender', 'Personal', 'Mitt team', 'Telefonbok']);
    await expect(section.getByRole('link', { name: 'Personal' })).toHaveAttribute('href', '/staff');
    await expect(section.getByRole('link', { name: 'Mitt team' })).toHaveAttribute('href', '/tools/phonebook.team');
    await expect(section.getByRole('link', { name: 'Telefonbok' })).toHaveAttribute(
      'href',
      '/tools/phonebook.directory',
    );
    // The areas, the administration and the way out stay below it.
    const order = await rail(page).getByRole('link').allTextContents();
    expect(order.indexOf('Telefonbok')).toBeGreaterThan(order.indexOf('Kalender'));
    await expectNoAxeViolations(page);
  });

  test("without a tool the section still holds the calendar and a manager's Personal, and nothing else", async ({
    page,
    api: _,
  }) => {
    await open(page, '/');
    await expect(rail(page).getByRole('group', { name: 'Verktyg' }).getByRole('link')).toHaveText([
      'Kalender',
      'Personal',
    ]);
  });

  test('the row opens the tool as a page by keyboard, not in the side panel, and is marked as current', async ({
    page,
    api,
  }) => {
    api.menu = [menuRow];
    await open(page, '/');
    const row = rail(page).getByRole('link', { name: 'Telefonbok' });
    await row.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/tools\/phonebook\.directory$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Telefonbok' })).toBeVisible();
    await expect(page.getByRole('searchbox', { name: 'Sök i telefonboken' })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page).toHaveTitle('Telefonbok · Startsidan');
    await expect(rail(page).locator('a[aria-current="page"]')).toHaveText('Telefonbok');
    await expectNoAxeViolations(page);
    // Kalender is the same kind of row: one tool is current at a time.
    await rail(page).getByRole('link', { name: 'Kalender' }).click();
    await expect(rail(page).locator('a[aria-current="page"]')).toHaveText('Kalender');
  });

  test("from the calendar the row leads to the tool's page too", async ({ page, api }) => {
    api.menu = [menuRow];
    await open(page, '/calendar');
    await rail(page).getByRole('link', { name: 'Telefonbok' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Telefonbok' })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test("the menu's search finds a tool by its name and opens its page", async ({ page, api }) => {
    api.menu = [menuRow];
    await open(page, '/');
    const search = rail(page).getByRole('combobox', { name: 'Sök i samtal och kort' });
    await search.fill('telefon');
    await page.getByRole('option', { name: /Telefonbok/ }).click();
    await expect(page).toHaveURL(/\/tools\/phonebook\.directory$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Telefonbok' })).toBeVisible();
  });

  test('more than four tools: four show and the rest wait under Fler verktyg, a disclosure that says whether it is open', async ({
    page,
    api,
  }) => {
    api.menu = [menuRow, ...['Avtal', 'Blanketter', 'Diarium', 'Fordon', 'Lokaler'].map(tool)].sort((a, b) =>
      a.label.localeCompare(b.label, 'sv'),
    );
    await open(page, '/');
    const section = rail(page).getByRole('group', { name: 'Verktyg' });
    await expect(section.getByRole('link', { name: 'Fordon' })).toBeVisible();
    await expect(section.getByRole('link', { name: 'Telefonbok' })).toBeHidden();
    const more = section.getByRole('button', { name: 'Fler verktyg' });
    await expect(more).toHaveAttribute('aria-expanded', 'false');
    const moreLabel = (await more.getByText('Fler verktyg', { exact: true }).boundingBox())!;
    const toolLabel = (await section
      .getByRole('link', { name: 'Fordon' })
      .getByText('Fordon', { exact: true })
      .boundingBox())!;
    expect(moreLabel.x).toBe(toolLabel.x);
    await more.focus();
    await page.keyboard.press('Enter');
    await expect(more).toHaveAttribute('aria-expanded', 'true');
    await expect(section.getByRole('link', { name: 'Telefonbok' })).toBeVisible();
    await expect(section.getByRole('link', { name: 'Lokaler' })).toBeVisible();
    await expect(
      section.getByRole('group', { name: 'Fler verktyg' }).locator('[data-orientation="vertical"]'),
    ).toBeVisible();
    await expectNoAxeViolations(page);
  });
});

test.describe('Verktyg on a phone', () => {
  test("the row is in the drawer and opens the tool's page, its rows as a list", async ({ page, api }) => {
    await page.setViewportSize(phone);
    api.menu = [menuRow];
    await open(page, '/');
    const drawer = await openNav(page);
    await expect(drawer.getByRole('group', { name: 'Verktyg' }).getByRole('link')).toHaveText([
      'Kalender',
      'Personal',
      'Telefonbok',
    ]);
    await expectNoAxeViolations(page);
    await drawer.getByRole('link', { name: 'Telefonbok' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Telefonbok' })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Telefonboken' })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
  test('at 320 px the tool shows its whole name in the drawer and the page does not scroll sideways', async ({
    page,
    api,
  }) => {
    await page.setViewportSize(narrow);
    api.menu = [menuRow];
    await open(page, '/');
    const row = (await openNav(page)).getByRole('link', { name: 'Telefonbok' });
    await page.evaluate(() => Promise.all(document.getAnimations().map(a => a.finished.catch(() => undefined))));
    const { width, needed, right } = await row.evaluate(el => {
      const probe = document.createElement('span');
      probe.textContent = el.textContent;
      probe.style.cssText = `position:absolute;visibility:hidden;white-space:nowrap;font:${getComputedStyle(el).font}`;
      document.body.append(probe);
      const needed = probe.getBoundingClientRect().width;
      probe.remove();
      return { width: el.getBoundingClientRect().width, needed, right: el.getBoundingClientRect().right };
    });
    expect(width).toBeGreaterThanOrEqual(needed);
    expect(right).toBeLessThanOrEqual(320);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  });
});

test.describe('the administrator chooses which views are in the menu', () => {
  test.use({ viewport: desktop });
  test('every view that can be a tool has its own switch under Områden; choosing one is said aloud and shown on the overview', async ({
    page,
    api,
  }) => {
    api.admin = true;
    await open(page, '/admin/connectors/hello');
    await expect(page.getByText('Ingen vy vald')).toBeVisible();
    await page.getByRole('tab', { name: 'Områden' }).click();
    const tools = page.getByRole('list', { name: 'Verktyg i menyn' });
    await expect(tools.getByRole('listitem')).toHaveCount(2);
    await expect(tools.getByRole('switch')).toHaveCount(2);
    const second = tools.getByRole('switch', { name: 'Visa Saker att göra i menyn' });
    await expect(second).not.toBeChecked();
    await expectNoAxeViolations(page);
    await second.focus();
    await page.keyboard.press('Space');
    await expect(second).toBeChecked();
    await expect(tools.getByRole('switch', { name: 'Visa Hello i menyn' })).not.toBeChecked();
    await expect(
      page.getByRole('region', { name: 'Aviseringar' }).getByText('Saker att göra visas i menyn under Verktyg.'),
    ).toBeVisible();
    expect(api.menuOn).toEqual(['hello.openItems']);
    await tools.getByRole('switch', { name: 'Visa Hello i menyn' }).click();
    await expect.poll(() => api.menuOn).toEqual(['hello.openItems', 'hello.overview']);
    await page.getByRole('tab', { name: 'Översikt' }).click();
    await expect(page.getByText('Hello, Saker att göra')).toBeVisible();
  });
  test('the list of views is the same on a phone, with no sideways scrolling', async ({ page, api }) => {
    api.admin = true;
    await page.setViewportSize(narrow);
    await open(page, '/admin/connectors/hello');
    await page.getByRole('button', { name: /^Visa:/ }).click();
    await page.getByRole('menuitem', { name: 'Områden' }).click();
    const tools = page.getByRole('list', { name: 'Verktyg i menyn' });
    await expect(tools.getByRole('switch')).toHaveCount(2);
    await tools.getByRole('switch', { name: 'Visa Hello i menyn' }).click();
    await expect.poll(() => api.menuOn).toEqual(['hello.overview']);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    await expectNoAxeViolations(page);
  });
  test('a connector with no view that can be a tool says so, and adding a connector does not ask about the menu', async ({
    page,
    api,
  }) => {
    api.admin = true;
    await open(page, '/admin/connectors/finance');
    await expect(page.getByText('Ingen vy kan ligga i menyn')).toBeVisible();
    await page.getByRole('tab', { name: 'Områden' }).click();
    await expect(page.getByText('Ingen av anslutningens vyer kan ligga i menyn.')).toBeVisible();
    await expect(page.getByRole('list', { name: 'Verktyg i menyn' })).toHaveCount(0);
    await expectNoAxeViolations(page);
  });
});
