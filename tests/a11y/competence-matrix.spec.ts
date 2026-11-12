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
  type MockApi,
} from './support';

/**
 * Kompetens › Medarbetare (D108 item 11) at `/competence/matrix`: a manager's reports against the competences required
 * of them, on Astryx's `table-comparison` template, the names pinned. Each cell says where the person stands in words
 * and has its menu: a certificate registered with the competence chosen, in the dialog named in the address, the focus
 * back on the cell's control after; a holding registered in Clew revoked after the confirmation, never a copied one; the
 * manager's own requirement on one person added in a dialog with an address and removed from its cell. More required
 * than ten columns hold is chosen as a set, which is in the address; the matrix as shown is a file. Beside the panel, on
 * a phone and at 320 px the table is a list of one person per item. The page's own answer for someone who manages
 * nobody and with the module off. The mock's clock stands at 2026-11-04.
 */
const MATRIX = '/competence/matrix';
const notices = (page: Page) => page.getByRole('region', { name: 'Aviseringar' });
const registration = (page: Page) => page.getByRole('dialog', { name: 'Registrera intyg' });
const requirement = (page: Page) => page.getByRole('dialog', { name: 'Lägg till krav för en person' });
/** A cell's control: its menu, named for the competence and the person. */
const cell = (page: Page, competence: string, person: string) =>
  page.getByRole('button', { name: `Åtgärder: ${competence} för ${person}`, exact: true });
const row = (page: Page, name: string) => page.getByRole('row').filter({ hasText: name });
const tabs = (page: Page) => page.getByRole('navigation', { name: 'Kompetens', exact: true });
/** A dialog fades in: contrast is measured once every finite animation has run, not in the instant it opens. */
const settled = (page: Page) =>
  page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter(a => a.effect?.getComputedTiming().iterations !== Infinity)
        .map(a => a.finished.catch(() => undefined)),
    ).then(() => undefined),
  );
const switchedOn = (api: MockApi) => {
  api.competenceTypes = competenceTypes();
};

test.describe('Kompetens › Medarbetare', () => {
  for (const [layout, viewport] of [
    ['desktop', desktop],
    ['phone', phone],
  ] as const)
    test.describe(layout, () => {
      test.use({ viewport });
      test('the matrix has no axe violations and every focus stop is marked', async ({ page, api }) => {
        switchedOn(api);
        await open(page, MATRIX);
        await expect(page.getByRole('heading', { level: 1, name: 'Medarbetarnas kompetens' })).toBeVisible();
        await expect(cell(page, 'HLR', 'Anna Lindqvist')).toBeVisible();
        await expectNoAxeViolations(page);
        const { unmarked } = await hiddenFocusStops(page);
        expect(unmarked).toEqual([]);
      });
    });

  test.describe('desktop', () => {
    test.use({ viewport: desktop });
    test('the reports against the competences, the names pinned, each cell where the person stands in words', async ({
      page,
      api,
    }) => {
      switchedOn(api);
      await open(page, MATRIX);
      await expect(page).toHaveTitle('Medarbetarnas kompetens · Startsidan');
      await expect(tabs(page).getByRole('link', { name: 'Medarbetare' })).toHaveAttribute('aria-current', 'true');
      const table = page.getByRole('table');
      await expect(table.getByRole('columnheader')).toHaveText([
        'Medarbetare',
        'HLRAkut omhändertagande',
        'FallskyddSäkerhet',
        'Heta arbetenSäkerhet',
      ]);
      // The status is said in words, the day where a holding ends, and "Krävs inte" where it is held without being required.
      const anna = row(page, 'Anna Lindqvist');
      await expect(anna).toContainText('Går ut snart');
      await expect(anna).toContainText('10 jan. 2027');
      await expect(anna).toContainText('Saknas');
      await expect(anna).toContainText('Utgånget');
      await expect(anna).toContainText('31 maj 2026');
      const erik = row(page, 'Erik Sandström');
      await expect(erik).toContainText('Giltigt');
      await expect(erik).toContainText('till 1 nov. 2028');
      await expect(erik).toContainText('Krävs inte');
      await expect(row(page, 'Lena Berg')).toContainText(/Giltigt\s*Krävs inte/);
      // A name leads to the person's page, with the matrix as the way back.
      await expect(anna.getByRole('link', { name: 'Anna Lindqvist' })).toHaveAttribute(
        'href',
        '/people/anna.lindqvist?from=%2Fcompetence%2Fmatrix',
      );
      // The names are the pinned column of the template, so a row keeps its name while the competences scroll.
      const pinned = await anna
        .getByRole('cell')
        .first()
        .evaluate(el => getComputedStyle(el).position);
      expect(pinned).toBe('sticky');
      expect(api.matrixReads).toEqual(['']);
    });

    test('a certificate is registered from a cell by keyboard: the competence is chosen, both are in the address, and the focus comes back to the cell', async ({
      page,
      api,
    }) => {
      switchedOn(api);
      await open(page, MATRIX);
      const control = cell(page, 'Fallskydd', 'Anna Lindqvist');
      await control.focus();
      await page.keyboard.press('Enter');
      const menu = page.getByRole('menu');
      // The menu says what requires the competence of her, and what can be done.
      await expect(menu.getByRole('group', { name: 'Krävs: enhet Skönsmons skola' })).toBeVisible();
      await expect(menu.getByRole('menuitem')).toHaveText(['Registrera intyg']);
      await expect(menu.getByRole('menuitem', { name: 'Registrera intyg' })).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(`${MATRIX}?register=anna&competence=t-fall`);
      const dialog = registration(page);
      await expect(dialog.getByText('För Anna Lindqvist')).toBeVisible();
      await expect(dialog.getByRole('combobox', { name: /Kompetens/ })).toContainText('Fallskydd');
      await settled(page);
      await expectNoAxeViolations(page);
      const issued = dialog.getByLabel('Utfärdat', { exact: false }).and(page.locator('input'));
      await issued.focus();
      await page.keyboard.type('2026-10-01');
      await page.keyboard.press('Tab');
      await dialog.getByRole('button', { name: 'Registrera', exact: true }).focus();
      await page.keyboard.press('Enter');
      await expect(dialog).toBeHidden();
      await expect(page).toHaveURL(MATRIX);
      expect(api.registered).toEqual([{ personId: 'anna', body: { typeId: 't-fall', issuedOn: '2026-10-01' } }]);
      await expect(notices(page).getByText('Intyget är registrerat för Anna Lindqvist.')).toBeAttached();
      await expect(control).toBeFocused();
    });

    test('an address from before opens the registration over the matrix, and Esc closes it to the cell’s control', async ({
      page,
      api,
    }) => {
      switchedOn(api);
      await open(page, `${MATRIX}?register=erik&competence=t-hlr`);
      const dialog = registration(page);
      await expect(dialog.getByRole('combobox', { name: /Kompetens/ })).toContainText('HLR');
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(page).toHaveURL(MATRIX);
      await expect(cell(page, 'HLR', 'Erik Sandström')).toBeFocused();
      expect(api.registered).toEqual([]);
    });

    test('a holding registered in Clew is revoked after the confirmation; Esc lets go of it; a copied one offers none', async ({
      page,
      api,
    }) => {
      switchedOn(api);
      await open(page, MATRIX);
      // Copied from a source: it cannot be revoked in Clew (D108 item 9).
      await cell(page, 'HLR', 'Erik Sandström').click();
      await expect(page.getByRole('menu').getByRole('menuitem')).toHaveText(['Registrera intyg']);
      await page.keyboard.press('Escape');

      const control = cell(page, 'Heta arbeten', 'Anna Lindqvist');
      await control.click();
      await page.getByRole('menuitem', { name: 'Återkalla intyget' }).click();
      const confirm = page.getByRole('alertdialog', { name: 'Återkalla intyget?' });
      await expect(confirm).toContainText('Heta arbeten för Anna Lindqvist räknas inte längre.');
      await settled(page);
      await expectNoAxeViolations(page);
      await page.keyboard.press('Escape');
      await expect(confirm).toBeHidden();
      await expect(control).toBeFocused();
      expect(api.holdingWrites).toEqual([]);

      await control.click();
      await page.getByRole('menuitem', { name: 'Återkalla intyget' }).click();
      await confirm.getByRole('button', { name: 'Återkalla intyget' }).click();
      await expect(confirm).toBeHidden();
      expect(api.holdingWrites).toEqual([{ method: 'DELETE', path: '/competence/holdings/h-anna-heta' }]);
      await expect(notices(page).getByText('Heta arbeten är återkallat för Anna Lindqvist.')).toBeAttached();
      // Required of her and no longer held: missing.
      await expect(row(page, 'Anna Lindqvist').getByRole('cell').nth(3)).toContainText('Saknas');
      await expect(control).toBeFocused();
    });

    test('a requirement for one person is added in a dialog with an address, and the manager’s own is removed from its cell', async ({
      page,
      api,
    }) => {
      switchedOn(api);
      await open(page, MATRIX);
      const add = page.getByRole('link', { name: 'Lägg till krav för en person' });
      await add.focus();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(`${MATRIX}?requirement=new`);
      const dialog = requirement(page);
      await expect(dialog).toBeVisible();
      await settled(page);
      await expectNoAxeViolations(page);
      const save = dialog.getByRole('button', { name: 'Spara', exact: true });
      await save.focus();
      await page.keyboard.press('Enter');
      await expect(dialog.getByText('Välj en medarbetare.', { exact: true }).first()).toBeVisible();
      await expect(dialog.getByRole('combobox', { name: /Medarbetare/ })).toBeFocused();
      expect(api.requirementWrites).toEqual([]);
      await page.keyboard.press('Enter');
      await page.getByRole('option', { name: 'Lena Berg' }).click();
      await dialog.getByRole('combobox', { name: /Kompetens/ }).click();
      await page.getByRole('option', { name: 'Fallskydd' }).click();
      await save.focus();
      await page.keyboard.press('Enter');
      await expect(dialog).toBeHidden();
      await expect(page).toHaveURL(MATRIX);
      expect(api.requirementWrites).toEqual([
        { method: 'POST', path: '/competence/requirements', body: { typeId: 't-fall', personId: 'lena' } },
      ]);
      await expect(notices(page).getByText('Fallskydd krävs nu av Lena Berg.')).toBeAttached();
      await expect(row(page, 'Lena Berg').getByRole('cell').nth(2)).toContainText('Saknas');
      await expect(add).toBeFocused();

      // Erik's own requirement is the manager's to remove, from its cell, after the confirmation.
      const control = cell(page, 'Fallskydd', 'Erik Sandström');
      await control.click();
      await expect(page.getByRole('menu').getByRole('group', { name: 'Krävs: eget krav' })).toBeVisible();
      await page.getByRole('menuitem', { name: 'Ta bort kravet' }).click();
      const confirm = page.getByRole('alertdialog', { name: 'Ta bort kravet?' });
      await expect(confirm).toContainText('Fallskydd krävs inte längre av Erik Sandström.');
      await confirm.getByRole('button', { name: 'Ta bort kravet' }).click();
      await expect(confirm).toBeHidden();
      expect(api.requirementWrites.at(-1)).toEqual({ method: 'DELETE', path: '/competence/requirements/r-erik-fall' });
      await expect(notices(page).getByText('Fallskydd krävs inte längre av Erik Sandström.')).toBeAttached();
      await expect(row(page, 'Erik Sandström').getByRole('cell').nth(2)).toContainText('Krävs inte');
      await expect(control).toBeFocused();
    });

    test('more required than ten columns hold: the set is chosen with the selector, kept in the address and in the file', async ({
      page,
      api,
    }) => {
      switchedOn(api);
      api.competenceMatrixSets = true;
      await open(page, MATRIX);
      const choice = page.getByRole('combobox', { name: /Visa kompetenser för/ });
      await expect(choice).toContainText('Akut omhändertagande');
      await expect(page.getByText('1 av 12 kompetenser som krävs visas.')).toBeVisible();
      await expect(page.getByRole('table').getByRole('columnheader')).toHaveText([
        'Medarbetare',
        'HLRAkut omhändertagande',
      ]);
      await choice.click();
      await expect(page.getByRole('listbox').getByRole('group')).toHaveText([/^Område/, /^Befattning/]);
      await page.getByRole('option', { name: /^Säkerhet/ }).click();
      await expect(page).toHaveURL(`${MATRIX}?by=area%3AS%C3%A4kerhet`);
      await expect(page.getByRole('table').getByRole('columnheader')).toHaveText([
        'Medarbetare',
        'FallskyddSäkerhet',
        'Heta arbetenSäkerhet',
      ]);
      await expect(page.getByRole('link', { name: 'Ladda ner som CSV' })).toHaveAttribute(
        'href',
        '/api/competence/matrix.csv?by=area%3AS%C3%A4kerhet',
      );
      // A reload shows the same set.
      await page.reload();
      await expect(page.getByRole('combobox', { name: /Visa kompetenser för/ })).toContainText('Säkerhet');
      expect(api.matrixReads).toContain('?by=area%3AS%C3%A4kerhet');
      await expectNoAxeViolations(page);
    });

    test('the matrix as shown is downloaded as a file', async ({ page, api }) => {
      switchedOn(api);
      await open(page, MATRIX);
      const download = page.waitForEvent('download');
      await page.getByRole('link', { name: 'Ladda ner som CSV' }).click();
      expect((await download).suggestedFilename()).toBe('kompetens-2026-11-04.csv');
      expect(api.matrixDownloads).toEqual(['']);
    });

    test('beside the panel the matrix is a list of one person per item, the page never scrolling sideways', async ({
      page,
      api,
    }) => {
      switchedOn(api);
      await page.setViewportSize({ width: 1440, height: 900 });
      await open(page, `${MATRIX}?card=omtanke`);
      await expect(page.getByRole('complementary', { name: 'Ärende' })).toBeVisible();
      await expect(page.getByRole('table')).toHaveCount(0);
      const people = page.getByRole('list', { name: 'Medarbetare' });
      await expect(people.getByRole('link', { name: 'Anna Lindqvist' })).toBeVisible();
      const anna = page.getByRole('list', { name: 'Kompetens för Anna Lindqvist' });
      await expect(anna.getByRole('listitem').filter({ hasText: 'Fallskydd' })).toContainText('Saknas');
      await expect(anna.getByRole('button', { name: 'Åtgärder: Fallskydd för Anna Lindqvist' })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
      await expectNoAxeViolations(page);
      // Closed, the matrix is the table again.
      await page.keyboard.press('Escape');
      await expect(page.getByRole('complementary', { name: 'Ärende' })).toHaveCount(0);
      await expect(page.getByRole('table')).toBeVisible();
    });

    test('someone who manages nobody gets the page’s answer and no tabs; with the module off neither the rail nor the page has it', async ({
      page,
      api,
    }) => {
      switchedOn(api);
      api.employee = true;
      await open(page, MATRIX);
      await expect(
        page.getByRole('heading', { level: 2, name: 'Medarbetarnas kompetens visas inte för dig' }),
      ).toBeVisible();
      await expect(
        page.getByText('Medarbetarnas kompetens visas för den som är chef för en enhet.').first(),
      ).toBeVisible();
      await expect(tabs(page)).toHaveCount(0);
      await expect(page.getByRole('link', { name: 'Lägg till krav för en person' })).toHaveCount(0);
      await expectNoAxeViolations(page);

      api.employee = false;
      api.competenceTypes = null;
      await open(page, MATRIX);
      await expect(page.getByText(/Kompetens är inte påslaget i den här installationen\./).first()).toBeVisible();
      await expect(
        page.getByRole('navigation', { name: 'Sidonavigering' }).getByRole('link', { name: 'Kompetens', exact: true }),
      ).toHaveCount(0);
    });
  });

  test.describe('phone', () => {
    test.use({ viewport: phone });
    test('a list of one person per item, and the registration fills the screen', async ({ page, api }) => {
      switchedOn(api);
      await open(page, MATRIX);
      await expect(page.getByRole('table')).toHaveCount(0);
      const erik = page.getByRole('list', { name: 'Kompetens för Erik Sandström' });
      await expect(erik.getByRole('listitem').filter({ hasText: 'HLR' })).toContainText('Giltigt');
      await open(page, `${MATRIX}?register=anna&competence=t-hlr`);
      await expect(registration(page).getByText('För Anna Lindqvist')).toBeVisible();
      await settled(page);
      await expectNoAxeViolations(page);
    });
  });

  test.describe('1.4.10 reflow', () => {
    test('the matrix, its sets and both dialogs reflow at 320 px', async ({ page, api }) => {
      switchedOn(api);
      api.competenceMatrixSets = true;
      await page.setViewportSize(narrow);
      await open(page, MATRIX);
      await expect(page.getByRole('list', { name: 'Medarbetare' })).toBeVisible();
      await expect(page.getByRole('combobox', { name: /Visa kompetenser för/ })).toBeVisible();
      expect(await reflowProblems(page)).toEqual([]);
      await open(page, `${MATRIX}?register=lena&competence=t-hlr`);
      await expect(registration(page).getByRole('button', { name: 'Registrera', exact: true })).toBeVisible();
      expect(await reflowProblems(page)).toEqual([]);
      await open(page, `${MATRIX}?requirement=new`);
      await expect(requirement(page).getByRole('button', { name: 'Spara', exact: true })).toBeVisible();
      expect(await reflowProblems(page)).toEqual([]);
    });
  });
});
