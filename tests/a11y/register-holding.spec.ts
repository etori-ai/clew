import type { Page } from '@playwright/test';
import { aboutResult, competenceTypes } from './about';
import {
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

/**
 * Registrera intyg on Personal (D101 item 7): while Clew's competence module is on for the manager, each person who is
 * not deactivated has a menu of actions with it; the form is a dialog over the list, named for the person and in the
 * address; what is missing is said on the field; the server's refusal is an alert and keeps what was chosen; on
 * success the dialog closes, a toast says so and the focus is back on the person's menu. Keyboard, focus, structure,
 * axe and reflow, at desktop, phone and 320 px. The mock's clock stands at 2026-11-04.
 */
const notices = (page: Page) => page.getByRole('region', { name: 'Aviseringar' });
/** The dialog fades in: contrast is measured once every finite animation has run, not in the instant it opens. */
const settled = (page: Page) =>
  page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter(a => a.effect?.getComputedTiming().iterations !== Infinity)
        .map(a => a.finished.catch(() => undefined)),
    ).then(() => undefined),
  );
const menuOf = (page: Page, name: string) => page.getByRole('button', { name: `Åtgärder för ${name}`, exact: true });
const form = (page: Page) => page.getByRole('dialog', { name: 'Registrera intyg' });
const dateField = (page: Page, label: string) =>
  form(page).getByLabel(label, { exact: false }).and(page.locator('input'));

test.describe('Registrera intyg', () => {
  test.describe('desktop', () => {
    test.use({ viewport: desktop });
    test('each person who is not deactivated has a menu of actions; the page has no axe violations', async ({
      page,
      api,
    }) => {
      api.competenceTypes = competenceTypes();
      await open(page, '/staff');
      const school = page.getByRole('table').first();
      await expect(school.getByRole('columnheader', { name: 'Åtgärder' })).toBeVisible();
      await expect(menuOf(page, 'Anna Lindqvist')).toBeVisible();
      await expect(menuOf(page, 'Erik Nyström')).toBeVisible();
      // Sara is deactivated: the server would refuse, so nothing is offered.
      await expect(menuOf(page, 'Sara Pettersson')).toHaveCount(0);
      await expectNoAxeViolations(page);
      const { unmarked } = await hiddenFocusStops(page);
      expect(unmarked).toEqual([]);
    });
    test('the whole flow by keyboard: open the menu, the form, what is missing, choose, register, and the focus is back', async ({
      page,
      api,
    }) => {
      api.competenceTypes = competenceTypes();
      api.about = aboutResult();
      await open(page, '/staff');
      const menu = menuOf(page, 'Anna Lindqvist');
      await menu.focus();
      await page.keyboard.press('Enter');
      const item = page.getByRole('menuitem', { name: 'Registrera intyg' });
      await expect(item).toBeVisible();
      await item.focus();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL('/staff?register=anna');
      const dialog = form(page);
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText('För Anna Lindqvist')).toBeVisible();
      await settled(page);
      await expectNoAxeViolations(page);

      // Nothing chosen: each required field says what is missing and the first one takes the focus.
      await dialog.getByRole('button', { name: 'Registrera', exact: true }).focus();
      await page.keyboard.press('Enter');
      await expect(dialog.getByText('Välj en kompetens.', { exact: true })).toBeVisible();
      await expect(dialog.getByText('Välj dagen då intyget utfärdades.', { exact: true })).toBeVisible();
      const type = dialog.getByRole('combobox', { name: /Kompetens/ });
      await expect(type).toBeFocused();
      expect(api.registered).toEqual([]);

      // Choose the type, by keyboard, and say when it was issued and when it ends.
      await page.keyboard.press('Enter');
      await page.getByRole('option', { name: 'Heta arbeten' }).click();
      await expect(type).toContainText('Heta arbeten');
      const issued = dateField(page, 'Utfärdat');
      await issued.focus();
      await page.keyboard.type('2026-10-01');
      await page.keyboard.press('Tab');
      await expect(issued).toHaveValue('1 oktober 2026');
      const expires = dateField(page, 'Giltigt till');
      await expires.focus();
      await page.keyboard.type('2031-09-30');
      await page.keyboard.press('Tab');
      await dialog.getByRole('button', { name: 'Registrera', exact: true }).focus();
      await page.keyboard.press('Enter');

      await expect(dialog).toBeHidden();
      await expect(page).toHaveURL('/staff');
      expect(api.registered).toEqual([
        { personId: 'anna', body: { typeId: 't-heta', issuedOn: '2026-10-01', expiresOn: '2031-09-30' } },
      ]);
      await expect(notices(page).getByText('Intyget är registrerat för Anna Lindqvist.')).toBeAttached();
      await expect(menu).toBeFocused();
    });
    test('the server’s refusal is an alert in the form and what was chosen stays; Esc closes back to the list', async ({
      page,
      api,
    }) => {
      api.competenceTypes = competenceTypes();
      api.registerFail = 'Kompetensen är arkiverad och kan inte registreras.';
      await open(page, '/staff?register=erik');
      const dialog = form(page);
      await expect(dialog.getByText('För Erik Nyström')).toBeVisible();
      await dialog.getByRole('combobox', { name: /Kompetens/ }).click();
      await page.getByRole('option', { name: 'HLR' }).click();
      // The employer's rule is said where the end date is asked for.
      await expect(dialog.getByText(/då gäller det 2 år från utfärdandet/)).toBeVisible();
      const issued = dateField(page, 'Utfärdat');
      await issued.focus();
      await page.keyboard.type('2026-10-01');
      await page.keyboard.press('Tab');
      await dialog.getByRole('button', { name: 'Registrera', exact: true }).click();
      await expect(
        dialog.getByRole('alert').filter({ hasText: 'Kompetensen är arkiverad och kan inte registreras.' }),
      ).toBeVisible();
      await expect(issued).toHaveValue('1 oktober 2026');
      await expect(dialog.getByRole('combobox', { name: /Kompetens/ })).toContainText('HLR');
      await expectNoAxeViolations(page);
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(page).toHaveURL('/staff');
      await expect(page.getByRole('heading', { level: 1, name: 'Personal' })).toBeVisible();
    });
    test('a day that has not come and an end before the issue are said on their fields, and nothing is sent', async ({
      page,
      api,
    }) => {
      api.competenceTypes = competenceTypes();
      await open(page, '/staff?register=anna');
      const dialog = form(page);
      await dialog.getByRole('combobox', { name: /Kompetens/ }).click();
      await page.getByRole('option', { name: 'Fallskydd' }).click();
      const issued = dateField(page, 'Utfärdat');
      await issued.focus();
      await page.keyboard.type('2026-10-01');
      await page.keyboard.press('Tab');
      const expires = dateField(page, 'Giltigt till');
      await expires.focus();
      await page.keyboard.type('2026-09-01');
      await page.keyboard.press('Tab');
      await expect(expires).toHaveValue('1 september 2026');
      await dialog.getByRole('button', { name: 'Registrera', exact: true }).click();
      await expect(dialog.getByText('Slutdatumet kan inte vara före utfärdandet.', { exact: true })).toBeVisible();
      await expect(expires).toBeFocused();
      // The mock's clock stands at 2026-11-04: the day after has not come.
      await issued.focus();
      await page.keyboard.press('ControlOrMeta+a');
      await page.keyboard.type('2026-11-05');
      await page.keyboard.press('Tab');
      await dialog.getByRole('button', { name: 'Registrera', exact: true }).click();
      await expect(dialog.getByText('Dagen har inte kommit.', { exact: true })).toBeVisible();
      expect(api.registered).toEqual([]);
    });
    test('with the module off, or an address that names nobody on the list, there is no menu and no form', async ({
      page,
      api,
    }) => {
      expect(api.competenceTypes).toBeNull();
      await open(page, '/staff?register=anna');
      await expect(page.getByText('Anna Lindqvist')).toBeVisible();
      await expect(page.getByRole('columnheader', { name: 'Åtgärder' })).toHaveCount(0);
      await expect(form(page)).toBeHidden();
      api.competenceTypes = competenceTypes();
      await open(page, '/staff?register=nobody');
      await expect(menuOf(page, 'Anna Lindqvist')).toBeVisible();
      await expect(form(page)).toBeHidden();
    });
  });
  test.describe('phone', () => {
    test.use({ viewport: phone });
    test('the menu is on the person’s row and the form fills the screen, with no axe violations', async ({
      page,
      api,
    }) => {
      api.competenceTypes = competenceTypes();
      await open(page, '/staff');
      const list = page.getByRole('list', { name: 'Skönsmons skola' });
      await expect(list.getByRole('button', { name: 'Åtgärder för Anna Lindqvist' })).toBeVisible();
      await expectNoAxeViolations(page);
      const { unmarked } = await hiddenFocusStops(page);
      expect(unmarked).toEqual([]);
      await open(page, '/staff?register=anna');
      await expect(form(page).getByText('För Anna Lindqvist')).toBeVisible();
      await expectNoAxeViolations(page);
    });
  });
  test.describe('1.4.10 reflow', () => {
    test('the list with its menus and the form reflow at 320 px', async ({ page, api }) => {
      api.competenceTypes = competenceTypes();
      await page.setViewportSize(narrow);
      await open(page, '/staff');
      await expect(menuOf(page, 'Anna Lindqvist')).toBeVisible();
      expect(await reflowProblems(page)).toEqual([]);
      await open(page, '/staff?register=anna');
      await expect(form(page).getByRole('button', { name: 'Registrera', exact: true })).toBeVisible();
      expect(await reflowProblems(page)).toEqual([]);
    });
  });
});
