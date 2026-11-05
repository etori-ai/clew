import type { MenuEntry } from '@clew/contracts';
import { desktop, expect, expectNoAxeViolations, narrow, open, openNav, phone, test } from './support';
import { menuRow } from './telefonbok';

/**
 * Verktyg in the menu (D40): the calendar and the views that connectors offer as tools, one click away on every page.
 * The phone book's row is the one its real manifest declares; it is in the menu only where a test puts it, as it is in
 * the product only where an administrator switched it on.
 */
const rail = (page: import('@playwright/test').Page) => page.getByRole('navigation', { name: 'Sidonavigering' });
const tool = (label: string, n: number): MenuEntry => ({ connector: 'verktyg-' + n, source: 'System ' + n, capability: `verktyg-${n}.open`, title: label, label, icon: (['book', 'document', 'chart', 'people', 'clock', 'link', 'search'] as const)[n % 7]! });

test.describe('Verktyg in the menu', () => {
  test.use({ viewport: desktop });

  test('the section is named, holds the calendar and the tool in that order, and has no axe violations', async ({ page, api }) => {
    api.menu = [menuRow];
    await open(page, '/');
    const section = rail(page).getByRole('group', { name: 'Verktyg' });
    await expect(section.getByRole('link')).toHaveText(['Kalender', 'Telefonbok']);
    await expect(section.getByRole('link', { name: 'Telefonbok' })).toHaveAttribute('href', /^\/vy\/telefonbok\.directory\?titel=/);
    // The areas, the administration and the way out stay below it.
    const order = await rail(page).getByRole('link').allTextContents();
    expect(order.indexOf('Telefonbok')).toBeGreaterThan(order.indexOf('Kalender'));
    await expectNoAxeViolations(page);
  });

  test('without a tool the section still holds the calendar, and nothing else', async ({ page, api: _ }) => {
    await open(page, '/');
    await expect(rail(page).getByRole('group', { name: 'Verktyg' }).getByRole('link')).toHaveText(['Kalender']);
  });

  test('the row opens the view in the side panel by keyboard, is marked as current, and closing gives the focus back', async ({ page, api }) => {
    api.menu = [menuRow];
    await open(page, '/');
    const row = rail(page).getByRole('link', { name: 'Telefonbok' });
    await row.focus();
    await page.keyboard.press('Enter');
    const panel = page.getByRole('dialog', { name: 'Sök i telefonboken' });
    await expect(panel.getByRole('table')).toBeVisible();
    await expect(page).toHaveURL(/\/vy\/telefonbok\.directory/);
    // The panel is a named dialog and takes the focus, which is how a screen reader hears where the row led.
    await expect(panel.locator(':focus')).toHaveCount(1);
    await expect(page.locator('nav a[aria-current="page"]')).toHaveText('Telefonbok');
    await expectNoAxeViolations(page);
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await expect(row).toBeFocused();
    await expect(page.locator('nav a[aria-current="page"]')).toHaveCount(0);
  });

  test('from the calendar the row leads to the view too', async ({ page, api }) => {
    api.menu = [menuRow];
    await open(page, '/kalender');
    await rail(page).getByRole('link', { name: 'Telefonbok' }).click();
    await expect(page.getByRole('dialog', { name: 'Sök i telefonboken' }).getByRole('table')).toBeVisible();
  });

  test('the menu\'s search finds a tool by its name', async ({ page, api }) => {
    api.menu = [menuRow];
    await open(page, '/');
    const search = rail(page).getByRole('combobox', { name: 'Sök i samtal och kort' });
    await search.fill('telefon');
    await page.getByRole('option', { name: /Telefonbok/ }).click();
    await expect(page.getByRole('dialog', { name: 'Sök i telefonboken' })).toBeVisible();
  });

  test('more than four tools: four show and the rest wait under Fler verktyg, a disclosure that says whether it is open', async ({ page, api }) => {
    api.menu = [menuRow, ...['Avtal', 'Blanketter', 'Diarium', 'Fordon', 'Lokaler'].map(tool)].sort((a, b) => a.label.localeCompare(b.label, 'sv'));
    await open(page, '/');
    const section = rail(page).getByRole('group', { name: 'Verktyg' });
    await expect(section.getByRole('link', { name: 'Fordon' })).toBeVisible();
    await expect(section.getByRole('link', { name: 'Telefonbok' })).toBeHidden();
    const more = section.getByRole('button', { name: 'Fler verktyg' });
    await expect(more).toHaveAttribute('aria-expanded', 'false');
    await more.focus();
    await page.keyboard.press('Enter');
    await expect(more).toHaveAttribute('aria-expanded', 'true');
    await expect(section.getByRole('link', { name: 'Telefonbok' })).toBeVisible();
    await expect(section.getByRole('link', { name: 'Lokaler' })).toBeVisible();
    await expectNoAxeViolations(page);
  });
});

test.describe('Verktyg on a phone', () => {
  test('the row is in the drawer and opens the view as a list', async ({ page, api }) => {
    await page.setViewportSize(phone);
    api.menu = [menuRow];
    await open(page, '/');
    const drawer = await openNav(page);
    await expect(drawer.getByRole('group', { name: 'Verktyg' }).getByRole('link')).toHaveText(['Kalender', 'Telefonbok']);
    await expectNoAxeViolations(page);
    await drawer.getByRole('link', { name: 'Telefonbok' }).click();
    await expect(page.getByRole('dialog', { name: 'Sök i telefonboken' }).getByRole('list').first()).toBeVisible();
  });
  test('at 320 px the tool shows its whole name in the drawer and the page does not scroll sideways', async ({ page, api }) => {
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

test.describe('the administrator switches the row on', () => {
  test.use({ viewport: desktop });
  test('a connector that declares a row has the switch under Områden; using it is said aloud and shown on the overview', async ({ page, api }) => {
    api.admin = true;
    await open(page, '/admin/anslutningar/hello');
    await expect(page.getByText('Hello · visas inte')).toBeVisible();
    await page.getByRole('tab', { name: 'Områden' }).click();
    const toggle = page.getByRole('switch', { name: 'Visa i menyn' });
    await expect(toggle).not.toBeChecked();
    await expectNoAxeViolations(page);
    await toggle.focus();
    await page.keyboard.press('Space');
    await expect(toggle).toBeChecked();
    await expect(page.getByRole('region', { name: 'Aviseringar' }).getByText('Hello visas i menyn under Verktyg.')).toBeVisible();
    expect(api.connectors.find(c => c.id === 'hello')!.menuEnabled).toBe(true);
    await page.getByRole('tab', { name: 'Översikt' }).click();
    await expect(page.getByText('Hello · visas under Verktyg')).toBeVisible();
  });
  test('adding a connector that offers a row asks about the menu in the audience step, off by default, and saves the answer', async ({ page, api }) => {
    api.admin = true;
    await open(page, '/admin/anslutningar');
    await page.getByRole('button', { name: 'Anslut system' }).click();
    const dialog = page.getByRole('dialog', { name: 'Anslut system' });
    await dialog.getByRole('textbox', { name: /^Id/ }).fill('telefonbok');
    await dialog.getByRole('textbox', { name: /^Adress/ }).fill('http://telefonbok:4020');
    await dialog.getByLabel(/Delad nyckel/).fill('en-tillräckligt-lång-nyckel');
    await dialog.getByRole('button', { name: 'Kontrollera' }).click();
    await dialog.getByRole('button', { name: 'Nästa' }).click();
    const toggle = dialog.getByRole('switch', { name: 'Visa i menyn' });
    await expect(toggle).not.toBeChecked();
    await toggle.focus();
    await page.keyboard.press('Space');
    await expect(toggle).toBeChecked();
    await expectNoAxeViolations(page);
    await dialog.getByRole('button', { name: 'Nästa' }).click();
    await expect(dialog.getByText('Rad i menyn')).toBeVisible();
    await dialog.getByRole('button', { name: 'Sätt på' }).click();
    await expect(dialog).toHaveCount(0);
    expect(api.connectors.find(c => c.id === 'telefonbok')).toMatchObject({ menuEnabled: true, state: 'enabled' });
  });
  test('adding a connector that offers no row does not ask', async ({ page, api }) => {
    api.admin = true;
    await open(page, '/admin/anslutningar');
    await page.getByRole('button', { name: 'Anslut system' }).click();
    const dialog = page.getByRole('dialog', { name: 'Anslut system' });
    await dialog.getByRole('textbox', { name: /^Id/ }).fill('nytt');
    await dialog.getByRole('textbox', { name: /^Adress/ }).fill('http://nytt:4010');
    await dialog.getByLabel(/Delad nyckel/).fill('en-tillräckligt-lång-nyckel');
    await dialog.getByRole('button', { name: 'Kontrollera' }).click();
    await dialog.getByRole('button', { name: 'Nästa' }).click();
    await expect(dialog.getByRole('switch', { name: 'Erbjud assistenten' })).toBeVisible();
    await expect(dialog.getByRole('switch', { name: 'Visa i menyn' })).toHaveCount(0);
  });
  test('a connector that declares none has the switch disabled with the reason', async ({ page, api }) => {
    api.admin = true;
    await open(page, '/admin/anslutningar/raindance');
    await expect(page.getByText('Anslutningen har ingen rad för menyn')).toBeVisible();
    await page.getByRole('tab', { name: 'Områden' }).click();
    await expect(page.getByRole('switch', { name: 'Visa i menyn' })).toBeDisabled();
    await expectNoAxeViolations(page);
  });
});
