import type { Page } from '@playwright/test';
import type { MenuEntry } from '@clew/contracts';
import { desktop, expect, expectNoAxeViolations, narrow, open, openNav, phone, test } from './support';
import { menuRow, menuRows } from './phonebook';

/**
 * Verktyg in the menu (D40): the calendar and the views an administrator chose as tools, one click away on every page.
 * There is no rail (D115 item 3): Clew's own pages are the links of the row under the header's band, the navigation
 * named after the header's place, Start. A link leads to the tool's own page (D42), as Kalender does; the page itself
 * is tested in `tools.spec.ts`. The test person is a manager, so Personal (D94) stands after Kalender; `staff.spec.ts`
 * owns it. The shared header (D88) marks Start as the current place on every page of Clew, so "the current page" is
 * asked of that row, where one link is current at a time.
 * The phone book's rows are named by its real manifest; they are in the menu only where a test puts them, as they are in
 * the product only where an administrator chose them.
 */
const pages = (page: Page) => page.getByRole('banner').getByRole('navigation', { name: 'Start', exact: true });
const tool = (label: string, n: number): MenuEntry => ({
  connector: 'verktyg-' + n,
  source: 'System ' + n,
  capability: `verktyg-${n}.open`,
  title: label,
  label,
  icon: (['book', 'document', 'chart', 'people', 'clock', 'link', 'search'] as const)[n % 7]!,
});
/** Six tools in alphabetical order, as the server hands them over: Avtal, Blanketter, Diarium, Fordon, Lokaler, Telefonbok. */
const sixTools = () =>
  [menuRow, ...['Avtal', 'Blanketter', 'Diarium', 'Fordon', 'Lokaler'].map(tool)].sort((a, b) =>
    a.label.localeCompare(b.label, 'sv'),
  );
/** A mark on the document that a page load would lose: a link of the row moves inside the app (D115 item 3). */
const markDocument = (page: Page) =>
  page.evaluate(() => void ((window as unknown as { sameDocument: true }).sameDocument = true));
const sameDocument = (page: Page) =>
  page.evaluate(() => (window as unknown as { sameDocument?: true }).sameDocument === true);

test.describe('Verktyg in the menu', () => {
  test.use({ viewport: desktop });

  // The suite's person is a manager, so Personal (D94) stands after the calendar, before the chosen views.
  test("the row is named after Start and holds Mina aktiviteter, Min AI, the calendar, a manager's Personal and then the chosen views of a connector in alphabetical order, and has no axe violations", async ({
    page,
    api,
  }) => {
    api.menu = menuRows;
    await open(page, '/');
    const row = pages(page);
    await expect(row.getByRole('link')).toHaveText([
      'Mina aktiviteter',
      'Min AI',
      'Kalender',
      'Personal',
      'Mitt team',
      'Telefonbok',
    ]);
    // Mina aktiviteter and Min AI open the row (D115 items 3 to 5).
    await expect(row.getByRole('link', { name: 'Mina aktiviteter' })).toHaveAttribute('href', '/activities');
    await expect(row.getByRole('link', { name: 'Min AI' })).toHaveAttribute('href', '/conversations');
    await expect(row.getByRole('link', { name: 'Kalender' })).toHaveAttribute('href', '/calendar');
    await expect(row.getByRole('link', { name: 'Personal' })).toHaveAttribute('href', '/staff');
    await expect(row.getByRole('link', { name: 'Mitt team' })).toHaveAttribute('href', '/tools/phonebook.team');
    await expect(row.getByRole('link', { name: 'Telefonbok' })).toHaveAttribute('href', '/tools/phonebook.directory');
    // Few enough tools to stand in the row: nothing waits under a menu.
    await expect(row.getByRole('button')).toHaveCount(0);
    // The start page is the header's own place, Start: none of Clew's pages is the current one there.
    await expect(row.locator('[aria-current]')).toHaveCount(0);
    // The rail is gone, and with it a second place for the same links.
    await expect(page.getByRole('navigation', { name: 'Sidonavigering' })).toHaveCount(0);
    await expectNoAxeViolations(page);
  });

  test("without a tool the row still holds Mina aktiviteter, Min AI, the calendar and a manager's Personal, and nothing else", async ({
    page,
    api: _,
  }) => {
    await open(page, '/');
    await expect(pages(page).getByRole('link')).toHaveText(['Mina aktiviteter', 'Min AI', 'Kalender', 'Personal']);
    await expect(pages(page).getByRole('button')).toHaveCount(0);
  });

  test('the link opens the tool as a page by keyboard, without a page load and not in the side panel, and is marked as current', async ({
    page,
    api,
  }) => {
    api.menu = [menuRow];
    await open(page, '/');
    await markDocument(page);
    const link = pages(page).getByRole('link', { name: 'Telefonbok' });
    await link.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/tools\/phonebook\.directory$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Telefonbok' })).toBeVisible();
    await expect(page.getByRole('searchbox', { name: 'Sök i telefonboken' })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page).toHaveTitle('Telefonbok · Startsidan');
    await expect(pages(page).locator('[aria-current]')).toHaveText(['Telefonbok']);
    await expect(pages(page).getByRole('link', { name: 'Telefonbok' })).toHaveAttribute('aria-current', 'page');
    await expectNoAxeViolations(page);
    // Kalender is the same kind of link: one page is current at a time.
    await pages(page).getByRole('link', { name: 'Kalender' }).click();
    await expect(page).toHaveURL(/\/calendar$/);
    await expect(pages(page).locator('[aria-current]')).toHaveText(['Kalender']);
    await expect(pages(page).getByRole('link', { name: 'Kalender' })).toHaveAttribute('aria-current', 'page');
    // The links are Clew's own, so they went through its router: the document is the one the test marked.
    expect(await sameDocument(page)).toBe(true);
  });

  test("from the calendar the link leads to the tool's page too", async ({ page, api }) => {
    api.menu = [menuRow];
    await open(page, '/calendar');
    await pages(page).getByRole('link', { name: 'Telefonbok' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Telefonbok' })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('more than four tools: four are links and the rest wait under Fler verktyg, a menu button that works by keyboard and takes the focus back on Escape', async ({
    page,
    api,
  }) => {
    api.menu = sixTools();
    await open(page, '/');
    const row = pages(page);
    await expect(row.getByRole('link')).toHaveText([
      'Mina aktiviteter',
      'Min AI',
      'Kalender',
      'Personal',
      'Avtal',
      'Blanketter',
      'Diarium',
      'Fordon',
    ]);
    const more = row.getByRole('button', { name: 'Fler verktyg', exact: true });
    await expect(more).toHaveAttribute('aria-haspopup', 'menu');
    await expect(more).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expectNoAxeViolations(page);
    await more.focus();
    await page.keyboard.press('Enter');
    await expect(more).toHaveAttribute('aria-expanded', 'true');
    const menu = page.getByRole('menu', { name: 'Fler verktyg', exact: true });
    await expect(menu.getByRole('menuitem')).toHaveText(['Lokaler', 'Telefonbok']);
    await expect(menu.getByRole('menuitem', { name: 'Telefonbok' })).toHaveAttribute(
      'href',
      '/tools/phonebook.directory',
    );
    // The focus is in the menu, and the arrows move it between the tools.
    await expect(menu.getByRole('menuitem', { name: 'Lokaler' })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(menu.getByRole('menuitem', { name: 'Telefonbok' })).toBeFocused();
    await expectNoAxeViolations(page);
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(more).toHaveAttribute('aria-expanded', 'false');
    await expect(more).toBeFocused();
    // Chosen by keyboard, a tool under the menu opens its page as a link of the row does: inside the app.
    await markDocument(page);
    await page.keyboard.press('Enter');
    await expect(menu.getByRole('menuitem', { name: 'Lokaler' })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(menu.getByRole('menuitem', { name: 'Telefonbok' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/tools\/phonebook\.directory$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Telefonbok' })).toBeVisible();
    await expect(page.getByRole('menu')).toHaveCount(0);
    expect(await sameDocument(page)).toBe(true);
    // The row still says where the person is: the menu button carries the open tool's name, and no link is current.
    await expect(pages(page).getByRole('button', { name: 'Telefonbok', exact: true })).toHaveAttribute(
      'aria-haspopup',
      'menu',
    );
    await expect(pages(page).locator('a[aria-current]')).toHaveCount(0);
    await expectNoAxeViolations(page);
  });
});

test.describe('Verktyg on a phone', () => {
  test("the link is in the header's Meny, under Start, and opens the tool's page, its rows as a list", async ({
    page,
    api,
  }) => {
    await page.setViewportSize(phone);
    api.menu = [menuRow];
    await open(page, '/');
    const drawer = await openNav(page);
    await expect(drawer.getByRole('group', { name: 'Start', exact: true }).getByRole('link')).toHaveText([
      'Mina aktiviteter',
      'Min AI',
      'Kalender',
      'Personal',
      'Telefonbok',
    ]);
    await expectNoAxeViolations(page);
    await drawer.getByRole('link', { name: 'Telefonbok' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Telefonbok' })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Telefonboken' })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // The drawer marks the page among Start's own, as the row does on a wide window.
    const again = await openNav(page);
    await expect(again.getByRole('group', { name: 'Start', exact: true }).locator('[aria-current]')).toHaveText([
      'Telefonbok',
    ]);
  });
  test('more than four tools are all links in the drawer, with no menu inside the menu', async ({ page, api }) => {
    await page.setViewportSize(phone);
    api.menu = sixTools();
    await open(page, '/');
    const drawer = await openNav(page);
    await expect(drawer.getByRole('group', { name: 'Start', exact: true }).getByRole('link')).toHaveText([
      'Mina aktiviteter',
      'Min AI',
      'Kalender',
      'Personal',
      'Avtal',
      'Blanketter',
      'Diarium',
      'Fordon',
      'Lokaler',
      'Telefonbok',
    ]);
    await expect(drawer.getByRole('button', { name: 'Fler verktyg' })).toHaveCount(0);
    await expect(drawer.getByRole('link', { name: 'Telefonbok' })).toBeInViewport();
    await expectNoAxeViolations(page);
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
