import type { Page } from '@playwright/test';
import { competenceTypes } from './competence';
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
 * Registrera intyg on Personal (D107 item 7): the competence module's page for one person, a dialog over the list at
 * `/staff?register=<personId>`, which is where the "Registrera intyg" link of the person's Kompetens section leads
 * (D97: the page a core source declares on its read about a person). The form is named for the person; what is missing
 * is said on the field; the server's refusal is an alert and keeps what was chosen; on success the dialog closes and
 * a toast says so. With the module off, or for someone not on the list, the address opens nothing. Keyboard,
 * structure, axe and reflow, at desktop, phone and 320 px. The mock's clock stands at 2026-11-04.
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
const form = (page: Page) => page.getByRole('dialog', { name: 'Registrera intyg' });
const dateField = (page: Page, label: string) =>
  form(page).getByLabel(label, { exact: false }).and(page.locator('input'));

test.describe('Registrera intyg', () => {
  test.describe('desktop', () => {
    test.use({ viewport: desktop });
    test('the whole flow by keyboard: what is missing, choose, register, and the list is the page again', async ({
      page,
      api,
    }) => {
      api.competenceTypes = competenceTypes();
      await open(page, '/staff?register=anna');
      const dialog = form(page);
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText('För Anna Lindqvist')).toBeVisible();
      await settled(page);
      await expectNoAxeViolations(page);
      const { unmarked } = await hiddenFocusStops(page);
      expect(unmarked).toEqual([]);

      // Nothing chosen: each required field says what is missing and the first one takes the focus.
      await dialog.getByRole('button', { name: 'Registrera', exact: true }).focus();
      await page.keyboard.press('Enter');
      await expect(dialog.getByText('Välj en kompetens.', { exact: true })).toBeVisible();
      await expect(dialog.getByText('Välj dagen då intyget utfärdades.', { exact: true })).toBeVisible();
      const type = dialog.getByRole('combobox', { name: /Kompetens/ });
      await expect(type).toBeFocused();
      expect(api.registered).toEqual([]);

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
      await expect(page.getByRole('heading', { level: 1, name: 'Personal' })).toBeVisible();
    });
    test('the server’s refusal is an alert in the form and what was chosen stays; Esc closes back to the list', async ({
      page,
      api,
    }) => {
      api.competenceTypes = competenceTypes();
      api.registerFail = 'Kompetensen är arkiverad och kan inte registreras.';
      await open(page, '/staff?register=erik');
      const dialog = form(page);
      await expect(dialog.getByText('För Erik Sandström')).toBeVisible();
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
      await expect(dialog.getByText('Dagen har inte kommit.', { exact: true }).first()).toBeVisible();
      expect(api.registered).toEqual([]);
    });
    test('with the module off, a deactivated person or an address that names nobody, the address opens nothing', async ({
      page,
      api,
    }) => {
      expect(api.competenceTypes).toBeNull();
      await open(page, '/staff?register=anna');
      await expect(page.getByRole('heading', { level: 1, name: 'Personal' })).toBeVisible();
      await expect(form(page)).toBeHidden();
      api.competenceTypes = competenceTypes();
      // Karin is deactivated here: the server would refuse, so the form does not open for her.
      api.staff.units[0]!.people.find(p => p.id === 'karin')!.enabled = false;
      for (const id of ['karin', 'nobody']) {
        await open(page, '/staff?register=' + id);
        await expect(page.getByRole('heading', { level: 1, name: 'Personal' })).toBeVisible();
        await expect(form(page)).toBeHidden();
      }
    });
  });
  test.describe('phone', () => {
    test.use({ viewport: phone });
    test('the form fills the screen, with no axe violations', async ({ page, api }) => {
      api.competenceTypes = competenceTypes();
      await open(page, '/staff?register=anna');
      await expect(form(page).getByText('För Anna Lindqvist')).toBeVisible();
      await settled(page);
      await expectNoAxeViolations(page);
    });
  });
  test.describe('1.4.10 reflow', () => {
    test('the form reflows at 320 px', async ({ page, api }) => {
      api.competenceTypes = competenceTypes();
      await page.setViewportSize(narrow);
      await open(page, '/staff?register=anna');
      await expect(form(page).getByRole('button', { name: 'Registrera', exact: true })).toBeVisible();
      expect(await reflowProblems(page)).toEqual([]);
    });
  });
});
