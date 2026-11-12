import type { Page } from '@playwright/test';
import { competenceCatalogue } from './competence';
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
 * Administration › Kompetens (D108 items 2, 3 and 8): the catalogue of competence types as its administrator keeps it.
 * The list with an archived type marked; a type added in a dialog, with what is missing said on its field; a change of
 * the validity that says what it does to the holdings before it is saved; archiving asked for twice; the server's
 * refusal as an alert that keeps what was typed; and the page's own answer when the module is off or the capability is
 * missing. Keyboard, focus, structure, axe and reflow, at desktop, phone and 320 px.
 */
const notices = (page: Page) => page.getByRole('region', { name: 'Aviseringar' });
const dialogOf = (page: Page, name: string) => page.getByRole('dialog', { name });
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

test.describe('Administration › Kompetens', () => {
  for (const [layout, viewport] of [
    ['desktop', desktop],
    ['phone', phone],
  ] as const)
    test.describe(layout, () => {
      test.use({ viewport });
      test('the catalogue has no axe violations and every focus stop is marked', async ({ page, api }) => {
        api.admin = true;
        api.competenceTypes = competenceCatalogue();
        await open(page, '/admin/competence');
        await expect(page.getByRole('heading', { level: 1, name: 'Kompetens' })).toBeVisible();
        await expect(page.getByText('Heta arbeten', { exact: true })).toBeVisible();
        await expectNoAxeViolations(page);
        const { unmarked } = await hiddenFocusStops(page);
        expect(unmarked).toEqual([]);
      });
    });
  test.describe('desktop', () => {
    test.use({ viewport: desktop });
    test('an administrator reaches it from the rail and reads each type with its area, kind and validity', async ({
      page,
      api,
    }) => {
      api.admin = true;
      api.competenceTypes = competenceCatalogue();
      await open(page, '/admin/connectors');
      // The row under Administration: the place Kompetens in the rail is the reader's own (D120 item 8), another link.
      const row = page
        .getByRole('navigation', { name: 'Sidonavigering' })
        .getByRole('group', { name: 'Administration', exact: true })
        .getByRole('link', { name: 'Kompetens', exact: true });
      await row.click();
      await expect(page).toHaveURL(/\/admin\/competence$/);
      await expect(page).toHaveTitle('Kompetens · Startsidan');
      await expect(row).toHaveAttribute('aria-current', 'page');
      await expect(page.getByRole('status').filter({ hasText: 'att registrera' })).toHaveText(
        '3 kompetenser att registrera, 1 arkiverade',
      );
      const table = page.getByRole('table');
      await expect(table.getByRole('columnheader')).toHaveText(['Kompetens', 'Område', 'Typ', 'Giltighet', 'Ändra']);
      const hlr = table.getByRole('row', { name: /HLR/ });
      await expect(hlr).toContainText('Akut omhändertagande');
      await expect(hlr).toContainText('Kurs');
      await expect(hlr).toContainText('24 månader (2 år)');
      await expect(table.getByRole('row', { name: /Heta arbeten/ })).toContainText('Ingen regel');
      await expect(table.getByRole('row', { name: /Äldre brandskydd/ }).getByText('Arkiverad')).toBeVisible();
    });
    test('the rail draws Kompetens only while the module is on and the person holds admin.competence; an old link still gets the page’s answer', async ({
      page,
      api,
    }) => {
      api.admin = true;
      const kompetens = page
        .getByRole('navigation', { name: 'Sidonavigering' })
        .getByRole('group', { name: 'Administration', exact: true })
        .getByRole('link', { name: 'Kompetens', exact: true });
      // Switched off (D108 item 13): no row, and the page itself still says why for an address from before.
      await open(page, '/admin/connectors');
      await expect(
        page.getByRole('navigation', { name: 'Sidonavigering' }).getByRole('link', { name: 'Anslutna system' }),
      ).toBeVisible();
      await expect(kompetens).toHaveCount(0);
      await open(page, '/admin/competence');
      await expect(page.getByText(/Kompetens är inte påslaget i den här installationen\./).first()).toBeVisible();
      // Switched on: the row is there for the person who holds the capability.
      api.competenceTypes = competenceCatalogue();
      await open(page, '/admin/connectors');
      await expect(kompetens).toBeVisible();
      // On, but without admin.competence: no row.
      api.capabilities = ['admin.connectors', 'admin.users', 'admin.appearance'];
      await open(page, '/admin/connectors');
      await expect(kompetens).toHaveCount(0);
    });
    test('a type is added by keyboard: what is missing is said on its field, then it is saved and listed', async ({
      page,
      api,
    }) => {
      api.admin = true;
      api.competenceTypes = competenceCatalogue();
      await open(page, '/admin/competence');
      const add = page.getByRole('link', { name: 'Lägg till kompetens' });
      await add.focus();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL('/admin/competence?type=new');
      const dialog = dialogOf(page, 'Lägg till kompetens');
      await expect(dialog).toBeVisible();
      await settled(page);
      await expectNoAxeViolations(page);

      await dialog.getByRole('button', { name: 'Spara', exact: true }).focus();
      await page.keyboard.press('Enter');
      await expect(dialog.getByText('Ange ett namn.', { exact: true })).toBeVisible();
      await expect(dialog.getByText('Ange ett område.', { exact: true })).toBeVisible();
      const name = dialog.getByRole('textbox', { name: /Namn/ });
      await expect(name).toBeFocused();
      expect(api.catalogueWrites).toEqual([]);

      await page.keyboard.type('Arbete på väg');
      const area = dialog.getByRole('textbox', { name: /Område/ });
      await area.focus();
      await page.keyboard.type('Säkerhet');
      // The employer's rule is asked for only when it is switched on.
      await expect(dialog.getByRole('spinbutton', { name: /Giltigt i/ })).toHaveCount(0);
      await dialog.getByRole('switch', { name: /Arbetsgivaren bestämmer giltighetstiden/ }).focus();
      await page.keyboard.press('Space');
      const months = dialog.getByRole('spinbutton', { name: /Giltigt i/ });
      await months.focus();
      await page.keyboard.type('36');
      await page.keyboard.press('Tab');
      await dialog.getByRole('button', { name: 'Spara', exact: true }).focus();
      await page.keyboard.press('Enter');

      await expect(dialog).toBeHidden();
      await expect(page).toHaveURL('/admin/competence');
      expect(api.catalogueWrites).toEqual([
        {
          method: 'POST',
          path: '/competence/types',
          body: { name: 'Arbete på väg', area: 'Säkerhet', kind: 'certificate', validityMonths: 36 },
        },
      ]);
      await expect(notices(page).getByText('Arbete på väg finns nu i katalogen.')).toBeAttached();
      await expect(page.getByRole('table').getByRole('row', { name: /Arbete på väg/ })).toContainText(
        '36 månader (3 år)',
      );
    });
    test('a new validity says what it does to the holdings before it is saved, and the second press saves', async ({
      page,
      api,
    }) => {
      api.admin = true;
      api.competenceTypes = competenceCatalogue();
      await open(page, '/admin/competence');
      await page.getByRole('link', { name: 'Ändra HLR' }).click();
      await expect(page).toHaveURL('/admin/competence?type=t-hlr');
      const dialog = dialogOf(page, 'Ändra kompetens');
      await expect(dialog.getByRole('textbox', { name: /Namn/ })).toHaveValue('HLR');
      const months = dialog.getByRole('spinbutton', { name: /Giltigt i/ });
      await expect(months).toHaveValue('24');
      await months.fill('12');
      await page.keyboard.press('Tab');
      await dialog.getByRole('button', { name: 'Spara', exact: true }).click();
      await expect(
        dialog
          .getByRole('status')
          .filter({ hasText: '3 intyg räknas efter regeln. Med ändringen blir 2 av dem utgångna i dag.' }),
      ).toBeVisible();
      expect(api.catalogueWrites).toEqual([]);
      await expectNoAxeViolations(page);
      await dialog.getByRole('button', { name: 'Spara ändringen' }).click();
      await expect(dialog).toBeHidden();
      expect(api.catalogueWrites).toEqual([
        {
          method: 'PATCH',
          path: '/competence/types/t-hlr',
          body: { name: 'HLR', area: 'Akut omhändertagande', kind: 'course', validityMonths: 12 },
        },
      ]);
      await expect(notices(page).getByText('HLR är ändrad.')).toBeAttached();
      await expect(page.getByRole('table').getByRole('row', { name: /HLR/ })).toContainText('12 månader (1 år)');
    });
    test('a change of the name alone is saved at once, and the server’s refusal keeps what was typed', async ({
      page,
      api,
    }) => {
      api.admin = true;
      api.competenceTypes = competenceCatalogue();
      api.catalogueFail = 'Det finns redan en kompetens med det namnet.';
      await open(page, '/admin/competence?type=t-fall');
      const dialog = dialogOf(page, 'Ändra kompetens');
      const name = dialog.getByRole('textbox', { name: /Namn/ });
      await name.fill('Heta arbeten');
      await dialog.getByRole('button', { name: 'Spara', exact: true }).click();
      await expect(
        dialog.getByRole('alert').filter({ hasText: 'Det finns redan en kompetens med det namnet.' }),
      ).toBeVisible();
      await expect(name).toHaveValue('Heta arbeten');
      await name.fill('Fallskydd, grund');
      await dialog.getByRole('button', { name: 'Spara', exact: true }).click();
      await expect(dialog).toBeHidden();
      expect(api.catalogueWrites).toEqual([
        {
          method: 'PATCH',
          path: '/competence/types/t-fall',
          body: { name: 'Fallskydd, grund', area: 'Säkerhet', kind: 'certificate' },
        },
      ]);
    });
    test('archiving is asked for twice, and Esc closes back to the list without it', async ({ page, api }) => {
      api.admin = true;
      api.competenceTypes = competenceCatalogue();
      await open(page, '/admin/competence?type=t-fall');
      const dialog = dialogOf(page, 'Ändra kompetens');
      await dialog.getByRole('button', { name: 'Arkivera', exact: true }).click();
      await expect(
        dialog.getByRole('status').filter({ hasText: 'En arkiverad kompetens kan inte registreras igen' }),
      ).toBeVisible();
      expect(api.catalogueWrites).toEqual([]);
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(page).toHaveURL('/admin/competence');
      expect(api.catalogueWrites).toEqual([]);

      await page.getByRole('link', { name: 'Ändra Fallskydd' }).click();
      await dialog.getByRole('button', { name: 'Arkivera', exact: true }).click();
      await dialog.getByRole('button', { name: 'Arkivera, det går inte att ångra' }).click();
      await expect(dialog).toBeHidden();
      expect(api.catalogueWrites).toEqual([{ method: 'POST', path: '/competence/types/t-fall/archive' }]);
      await expect(notices(page).getByText('Fallskydd är arkiverad.')).toBeAttached();
      await expect(
        page
          .getByRole('table')
          .getByRole('row', { name: /Fallskydd/ })
          .getByText('Arkiverad'),
      ).toBeVisible();
      // An archived type can still be read and renamed, but not archived again.
      await page.getByRole('link', { name: 'Ändra Fallskydd' }).click();
      await expect(dialog.getByText('Kompetensen är arkiverad', { exact: false })).toBeVisible();
      await expect(dialog.getByRole('button', { name: /^Arkivera/ })).toHaveCount(0);
    });
    test('with the module off the page says so and where to go, and an empty catalogue says what to do', async ({
      page,
      api,
    }) => {
      api.admin = true;
      expect(api.competenceTypes).toBeNull();
      await open(page, '/admin/competence');
      await expect(
        page.getByRole('heading', { level: 2, name: 'Katalogen är inte tillgänglig för dig' }),
      ).toBeVisible();
      await expect(page.getByText(/Kompetens är inte påslaget i den här installationen\./).first()).toBeVisible();
      await expect(page.getByRole('link', { name: 'Till Anslutna system' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Lägg till kompetens' })).toHaveCount(0);
      await expectNoAxeViolations(page);
      api.competenceTypes = [];
      await page.reload();
      // By role: the empty state's words are also spoken (4.1.3), and while they sit in the live region the text matches twice.
      await expect(page.getByRole('heading', { name: 'Katalogen är tom' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Lägg till kompetens' })).toBeVisible();
      await settled(page);
      await expectNoAxeViolations(page);
    });
  });
  test.describe('phone', () => {
    test.use({ viewport: phone });
    test('the catalogue is a list with a way to change each type, and the dialog fills the screen', async ({
      page,
      api,
    }) => {
      api.admin = true;
      api.competenceTypes = competenceCatalogue();
      await open(page, '/admin/competence');
      const list = page.getByRole('list', { name: 'Katalogen' });
      await expect(list.getByText('Akut omhändertagande · Kurs · 24 månader (2 år)')).toBeVisible();
      await list.getByRole('link', { name: 'Ändra HLR' }).click();
      const dialog = dialogOf(page, 'Ändra kompetens');
      await expect(dialog.getByRole('textbox', { name: /Namn/ })).toHaveValue('HLR');
      await settled(page);
      await expectNoAxeViolations(page);
    });
  });
  test.describe('1.4.10 reflow', () => {
    test('the catalogue and the dialog reflow at 320 px', async ({ page, api }) => {
      api.admin = true;
      api.competenceTypes = competenceCatalogue();
      await page.setViewportSize(narrow);
      await open(page, '/admin/competence');
      await expect(page.getByRole('list', { name: 'Katalogen' })).toBeVisible();
      expect(await reflowProblems(page)).toEqual([]);
      await open(page, '/admin/competence?type=t-hlr');
      await expect(dialogOf(page, 'Ändra kompetens').getByRole('button', { name: 'Spara', exact: true })).toBeVisible();
      expect(await reflowProblems(page)).toEqual([]);
    });
  });
});
