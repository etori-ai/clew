import type { Locator, Page } from '@playwright/test';
import type { CompetenceMatrixOutput } from '@clew/contracts';
import { annaJournal, competenceTypes, lenaApproval, withJournal, withLenaWaiting, withSkills } from './competence';
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
 * nobody and with the module off. A report's own registration that waits (D108 item 7) is noted in its cell, and is
 * approved or, after the confirmation, rejected in a dialog named in the address (`approve`), from the cell, from a cold
 * address, and from the page the approval's card leads to. A skill's column (D120) says the least level asked and each
 * cell the level held in words; a skill is confirmed at a level in a dialog named in the address (`validate`), from the
 * cell and from a cold address, and registered for a report with a level. The mock's clock stands at 2026-11-04.
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
const heading = (page: Page) => page.getByRole('heading', { level: 1, name: 'Medarbetarnas kompetens' });
const approvalDialog = (page: Page) => page.getByRole('dialog', { name: 'Granska intyg' });
const validation = (page: Page) => page.getByRole('dialog', { name: 'Bekräfta nivå' });
/** Journalsystem is required of every report at least Självständig; Anna's own rating of it waits to be confirmed. */
const journal = (api: MockApi) => {
  api.competenceTypes = withSkills();
  api.competenceMatrix = withJournal(api.competenceMatrix);
  api.competenceSkills = { 'h-anna-journal': annaJournal() };
};
/** Lena has registered HLR herself, and it waits for the reader. */
const lenaWaits = (api: MockApi) => {
  api.competenceMatrix = withLenaWaiting(api.competenceMatrix);
  api.competenceApprovals = { 'own-lena': lenaApproval() };
};
/**
 * Presses Tab (or Shift+Tab) until `target` has the focus, as a person moving through the page does, from wherever the
 * focus is; fails after `max` stops.
 */
async function tabTo(page: Page, target: Locator, { backwards = false, max = 80 } = {}) {
  for (let i = 0; i < max; i++) {
    if ((await target.count()) && (await target.evaluate(el => el === document.activeElement))) return;
    await page.keyboard.press(backwards ? 'Shift+Tab' : 'Tab');
  }
  await expect(target).toBeFocused();
}
/** The matrix with seven more columns, required of nobody and held by nobody: ten in all, wider than a laptop's page. */
function wide(m: CompetenceMatrixOutput): CompetenceMatrixOutput {
  const extra = Array.from({ length: 7 }, (_, i) => ({
    typeId: `t-extra-${i + 1}`,
    name: `Extra ${i + 1}`,
    area: 'Övrigt',
    kind: 'course' as const,
  }));
  return {
    ...m,
    columns: [...m.columns, ...extra],
    rows: m.rows.map(r => ({
      ...r,
      cells: [
        ...r.cells,
        ...extra.map(c => ({
          typeId: c.typeId,
          status: 'none' as const,
          required: false,
          through: [],
          revocable: false,
        })),
      ],
    })),
  };
}

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
      // The name is each row's header (1.3.1), so a screen reader names the person with each status down a column, and
      // the pinned column of the template, so a row keeps its name while the competences scroll.
      await expect(anna.getByRole('rowheader')).toHaveText('Anna Lindqvist');
      await expect(page.getByRole('rowheader')).toHaveText(['Anna Lindqvist', 'Erik Sandström', 'Lena Berg']);
      await expect(anna.getByRole('cell')).toHaveCount(3);
      const pinned = await anna.getByRole('rowheader').evaluate(el => getComputedStyle(el).position);
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
      await tabTo(page, control);
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

    test('where no cell opened a dialog, closing it gives the focus to the page’s heading or to the header’s button', async ({
      page,
      api,
    }) => {
      switchedOn(api);
      // A competence that is no column: no cell to go back to, so the heading takes the focus.
      await open(page, `${MATRIX}?register=lena&competence=t-annat`);
      await expect(registration(page).getByText('För Lena Berg')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(registration(page)).toBeHidden();
      await expect(page).toHaveURL(MATRIX);
      await expect(heading(page)).toBeFocused();
      // The requirement's dialog from an address: its button in the header takes the focus.
      await open(page, `${MATRIX}?requirement=new`);
      await expect(requirement(page)).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(requirement(page)).toBeHidden();
      await expect(page).toHaveURL(MATRIX);
      await expect(page.getByRole('link', { name: 'Lägg till krav för en person' })).toBeFocused();
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

      // By keyboard: Tab to the cell's control, Enter opens its menu, the arrow goes to the revocation.
      const control = cell(page, 'Heta arbeten', 'Anna Lindqvist');
      const choose = async () => {
        await tabTo(page, control, { backwards: true });
        await page.keyboard.press('Enter');
        await expect(page.getByRole('menu').getByRole('menuitem')).toHaveText([
          'Registrera intyg',
          'Återkalla intyget',
        ]);
        await expect(page.getByRole('menuitem', { name: 'Registrera intyg' })).toBeFocused();
        await page.keyboard.press('ArrowDown');
        await expect(page.getByRole('menuitem', { name: 'Återkalla intyget' })).toBeFocused();
        await page.keyboard.press('Enter');
      };
      await choose();
      const confirm = page.getByRole('alertdialog', { name: 'Återkalla intyget?' });
      await expect(confirm).toContainText('Heta arbeten för Anna Lindqvist räknas inte längre.');
      await settled(page);
      await expectNoAxeViolations(page);
      await page.keyboard.press('Escape');
      await expect(confirm).toBeHidden();
      await expect(control).toBeFocused();
      expect(api.holdingWrites).toEqual([]);

      await choose();
      await tabTo(page, confirm.getByRole('button', { name: 'Återkalla intyget' }), { max: 4 });
      await page.keyboard.press('Enter');
      await expect(confirm).toBeHidden();
      expect(api.holdingWrites).toEqual([{ method: 'DELETE', path: '/competence/holdings/h-anna-heta' }]);
      await expect(notices(page).getByText('Heta arbeten är återkallat för Anna Lindqvist.')).toBeAttached();
      // Required of her and no longer held: missing.
      await expect(row(page, 'Anna Lindqvist').getByRole('cell').nth(2)).toContainText('Saknas');
      await expect(control).toBeFocused();
    });

    test('a requirement for one person is added in a dialog with an address, and the manager’s own is removed from its cell', async ({
      page,
      api,
    }) => {
      switchedOn(api);
      await open(page, MATRIX);
      const add = page.getByRole('link', { name: 'Lägg till krav för en person' });
      await tabTo(page, add);
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(`${MATRIX}?requirement=new`);
      const dialog = requirement(page);
      await expect(dialog).toBeVisible();
      await settled(page);
      await expectNoAxeViolations(page);
      const save = dialog.getByRole('button', { name: 'Spara', exact: true });
      await save.focus();
      await page.keyboard.press('Enter');
      // What is missing is said on the field itself, which takes the focus.
      const who = dialog.getByRole('combobox', { name: /Medarbetare/ });
      await expect(who).toHaveAttribute('aria-invalid', 'true');
      await expect(who).toHaveAccessibleDescription(/Välj en medarbetare\./);
      await expect(dialog.getByRole('combobox', { name: /Kompetens/ })).toHaveAccessibleDescription(
        /Välj en kompetens\./,
      );
      await expect(who).toBeFocused();
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
      await expect(row(page, 'Lena Berg').getByRole('cell').nth(1)).toContainText('Saknas');
      await expect(add).toBeFocused();

      // Erik's own requirement is the manager's to remove, from its cell, after the confirmation, by keyboard.
      const control = cell(page, 'Fallskydd', 'Erik Sandström');
      await tabTo(page, control);
      await page.keyboard.press('Enter');
      await expect(page.getByRole('menu').getByRole('group', { name: 'Krävs: eget krav' })).toBeVisible();
      await expect(page.getByRole('menuitem', { name: 'Registrera intyg' })).toBeFocused();
      await page.keyboard.press('ArrowDown');
      await expect(page.getByRole('menuitem', { name: 'Ta bort kravet' })).toBeFocused();
      await page.keyboard.press('Enter');
      const confirm = page.getByRole('alertdialog', { name: 'Ta bort kravet?' });
      await expect(confirm).toContainText('Fallskydd krävs inte längre av Erik Sandström.');
      await tabTo(page, confirm.getByRole('button', { name: 'Ta bort kravet' }), { max: 4 });
      await page.keyboard.press('Enter');
      await expect(confirm).toBeHidden();
      expect(api.requirementWrites.at(-1)).toEqual({ method: 'DELETE', path: '/competence/requirements/r-erik-fall' });
      await expect(notices(page).getByText('Fallskydd krävs inte längre av Erik Sandström.')).toBeAttached();
      await expect(row(page, 'Erik Sandström').getByRole('cell').nth(1)).toContainText('Krävs inte');
      await expect(control).toBeFocused();
    });

    test('a removal that takes the cell’s column with it gives the focus to the page’s heading', async ({
      page,
      api,
    }) => {
      switchedOn(api);
      // Fallskydd required of Erik alone, by his manager's own requirement.
      const m = api.competenceMatrix;
      api.competenceMatrix = {
        ...m,
        rows: m.rows.map(r =>
          r.personId === 'anna'
            ? {
                ...r,
                cells: r.cells.map(c =>
                  c.typeId === 't-fall'
                    ? { typeId: c.typeId, status: 'none', required: false, through: [], revocable: false }
                    : c,
                ),
              }
            : r,
        ),
      };
      await open(page, MATRIX);
      await tabTo(page, cell(page, 'Fallskydd', 'Erik Sandström'));
      await page.keyboard.press('Enter');
      await expect(page.getByRole('menuitem', { name: 'Registrera intyg' })).toBeFocused();
      await page.keyboard.press('ArrowDown');
      await expect(page.getByRole('menuitem', { name: 'Ta bort kravet' })).toBeFocused();
      await page.keyboard.press('Enter');
      const confirm = page.getByRole('alertdialog', { name: 'Ta bort kravet?' });
      await tabTo(page, confirm.getByRole('button', { name: 'Ta bort kravet' }), { max: 4 });
      await page.keyboard.press('Enter');
      await expect(confirm).toBeHidden();
      // Required of nobody now: the column is gone, and with it the control that opened the confirmation.
      await expect(page.getByRole('table').getByRole('columnheader')).toHaveText([
        'Medarbetare',
        'HLRAkut omhändertagande',
        'Heta arbetenSäkerhet',
      ]);
      await expect(heading(page)).toBeFocused();
    });

    test('a report’s own registration is approved from its cell by keyboard: the decision has its address, a toast says it, and the focus comes back to the cell', async ({
      page,
      api,
    }) => {
      switchedOn(api);
      lenaWaits(api);
      await open(page, MATRIX);
      const lena = row(page, 'Lena Berg');
      // The cell is what it is without the registration, and says that one waits.
      await expect(lena.getByRole('cell').nth(0)).toContainText('Saknas');
      await expect(lena.getByRole('cell').nth(0)).toContainText('Att granska');
      const control = cell(page, 'HLR', 'Lena Berg');
      await tabTo(page, control);
      await page.keyboard.press('Enter');
      await expect(page.getByRole('menu').getByRole('menuitem')).toHaveText(['Granska', 'Registrera intyg']);
      await expect(page.getByRole('menuitem', { name: 'Granska' })).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(`${MATRIX}?approve=own-lena`);
      const dialog = approvalDialog(page);
      await expect(dialog.getByText('Registrerat av Lena Berg')).toBeVisible();
      await expect(dialog).toContainText('HLR');
      await expect(dialog).toContainText('1 okt. 2026');
      await expect(dialog).toContainText('1 okt. 2028');
      await settled(page);
      await expectNoAxeViolations(page);
      await tabTo(page, dialog.getByRole('button', { name: 'Godkänn' }), { max: 12 });
      await page.keyboard.press('Enter');
      await expect(dialog).toBeHidden();
      await expect(page).toHaveURL(MATRIX);
      expect(api.approvalWrites).toEqual([{ path: '/competence/approvals/own-lena', body: { decision: 'approve' } }]);
      await expect(notices(page).getByText('HLR är godkänt för Lena Berg.')).toBeAttached();
      await expect(lena.getByRole('cell').nth(0)).toContainText('Giltigt');
      await expect(lena.getByRole('cell').nth(0)).not.toContainText('Att granska');
      await expect(control).toBeFocused();
    });

    test('from a cold address it is rejected after the confirmation, Esc in which closes back into the dialog, and the focus goes to the heading', async ({
      page,
      api,
    }) => {
      switchedOn(api);
      lenaWaits(api);
      await open(page, `${MATRIX}?approve=own-lena`);
      const dialog = approvalDialog(page);
      await expect(dialog.getByText('Registrerat av Lena Berg')).toBeVisible();
      const reject = dialog.getByRole('button', { name: 'Avvisa', exact: true });
      await tabTo(page, reject, { max: 12 });
      await page.keyboard.press('Enter');
      const confirm = page.getByRole('alertdialog', { name: 'Avvisa intyget?' });
      await expect(confirm).toContainText('HLR för Lena Berg räknas inte, och Lena Berg ser att det är avvisat.');
      await settled(page);
      await expectNoAxeViolations(page);
      await page.keyboard.press('Escape');
      await expect(confirm).toBeHidden();
      await expect(dialog).toBeVisible();
      await expect(reject).toBeFocused();
      expect(api.approvalWrites).toEqual([]);
      await page.keyboard.press('Enter');
      await tabTo(page, confirm.getByRole('button', { name: 'Avvisa intyget' }), { max: 4 });
      await page.keyboard.press('Enter');
      await expect(confirm).toBeHidden();
      await expect(dialog).toBeHidden();
      await expect(page).toHaveURL(MATRIX);
      expect(api.approvalWrites).toEqual([{ path: '/competence/approvals/own-lena', body: { decision: 'reject' } }]);
      await expect(notices(page).getByText('HLR är avvisat för Lena Berg.')).toBeAttached();
      await expect(row(page, 'Lena Berg').getByRole('cell').nth(0)).toContainText('Saknas');
      await expect(row(page, 'Lena Berg').getByRole('cell').nth(0)).not.toContainText('Att granska');
      await expect(heading(page)).toBeFocused();
    });

    test('an address for a registration the reader may not decide, or one decided, opens nothing and the page says why', async ({
      page,
      api,
    }) => {
      switchedOn(api);
      await open(page, `${MATRIX}?approve=own-elsewhere`);
      await expect(page.getByRole('main').getByRole('alert')).toHaveText(
        'Registreringen finns inte bland dem du kan granska.',
      );
      await expect(page).toHaveURL(MATRIX);
      await expect(approvalDialog(page)).toHaveCount(0);
      await expectNoAxeViolations(page);
    });

    test('the page the approval’s card leads to is the decision over the matrix, and Esc closes it to the matrix', async ({
      page,
      api,
    }) => {
      switchedOn(api);
      lenaWaits(api);
      const input = encodeURIComponent(JSON.stringify({ holding: 'own-lena' }));
      await open(page, `/tools/competence.approval?input=${input}&from=%2F`);
      await expect(page).toHaveURL(`${MATRIX}?approve=own-lena`);
      await expect(approvalDialog(page).getByText('Registrerat av Lena Berg')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(approvalDialog(page)).toBeHidden();
      await expect(page).toHaveURL(MATRIX);
      await expect(heading(page)).toBeFocused();
      expect(api.approvalWrites).toEqual([]);
    });

    test('a skill’s column says the level asked and each cell the level held in words; its level is confirmed from the cell by keyboard, preset to what was rated', async ({
      page,
      api,
    }) => {
      journal(api);
      await open(page, MATRIX);
      const table = page.getByRole('table');
      await expect(table.getByRole('columnheader').nth(4)).toHaveText(
        'JournalsystemDigital kompetensMinst Självständig',
      );
      const at = (name: string) => row(page, name).getByRole('cell').nth(3);
      // Her own rating meets nothing until it is confirmed: missing, with what is asked and what she rated beside it.
      await expect(at('Anna Lindqvist')).toContainText('Saknas');
      await expect(at('Anna Lindqvist')).toContainText('kräver Självständig, egen bedömning: Expert');
      await expect(at('Anna Lindqvist')).toContainText('Vill utveckla');
      await expect(at('Erik Sandström')).toContainText('Självständig');
      await expect(at('Erik Sandström')).not.toContainText('Saknas');
      await expect(at('Lena Berg')).toContainText('Saknas');
      await expect(at('Lena Berg')).toContainText('kräver Självständig');
      await expectNoAxeViolations(page);
      const control = cell(page, 'Journalsystem', 'Anna Lindqvist');
      await tabTo(page, control);
      await page.keyboard.press('Enter');
      await expect(page.getByRole('menu').getByRole('menuitem')).toHaveText(['Bekräfta nivå', 'Återkalla färdigheten']);
      await expect(page.getByRole('menuitem', { name: 'Bekräfta nivå' })).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(`${MATRIX}?validate=h-anna-journal`);
      const dialog = validation(page);
      await expect(dialog.getByText('Journalsystem för Anna Lindqvist')).toBeVisible();
      await expect(dialog).toContainText('Egen bedömning');
      const rated = dialog.getByRole('radio', { name: /Expert/ });
      await expect(rated).toBeChecked();
      await settled(page);
      await expectNoAxeViolations(page);
      // Another level than she rated, chosen with the arrow keys.
      await rated.focus();
      await page.keyboard.press('ArrowUp');
      await expect(dialog.getByRole('radio', { name: /Självständig/ })).toBeChecked();
      await tabTo(page, dialog.getByRole('button', { name: 'Bekräfta nivå' }), { max: 8 });
      await page.keyboard.press('Enter');
      await expect(dialog).toBeHidden();
      await expect(page).toHaveURL(MATRIX);
      expect(api.skillWrites).toEqual([
        { method: 'POST', path: '/competence/skills/h-anna-journal/validation', body: { level: 2 } },
      ]);
      await expect(
        notices(page).getByText('Journalsystem för Anna Lindqvist är bekräftad på nivån Självständig.'),
      ).toBeAttached();
      await expect(at('Anna Lindqvist')).toContainText('Självständig');
      await expect(at('Anna Lindqvist')).not.toContainText('Saknas');
      await expect(control).toBeFocused();
      // Confirmed, the cell offers to change the level.
      await page.keyboard.press('Enter');
      await expect(page.getByRole('menuitem', { name: 'Ändra nivå' })).toBeFocused();
      await page.keyboard.press('Escape');
    });

    test('from a cold address the confirmation opens over the matrix and Esc closes it to the heading; one the reader may not confirm opens nothing', async ({
      page,
      api,
    }) => {
      journal(api);
      await open(page, `${MATRIX}?validate=h-anna-journal`);
      const dialog = validation(page);
      await expect(dialog.getByText('Journalsystem för Anna Lindqvist')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(page).toHaveURL(MATRIX);
      await expect(heading(page)).toBeFocused();
      expect(api.skillWrites).toEqual([]);
      await open(page, `${MATRIX}?validate=h-elsewhere`);
      await expect(page.getByRole('main').getByRole('alert')).toHaveText(
        'Färdigheten finns inte bland dem du kan bekräfta.',
      );
      await expect(page).toHaveURL(MATRIX);
      await expect(validation(page)).toHaveCount(0);
      await expectNoAxeViolations(page);
    });

    test('a skill is registered for a report from a cell by keyboard with a level, confirmed by the manager at once', async ({
      page,
      api,
    }) => {
      journal(api);
      await open(page, MATRIX);
      const control = cell(page, 'Journalsystem', 'Lena Berg');
      await tabTo(page, control);
      await page.keyboard.press('Enter');
      await expect(page.getByRole('menu').getByRole('menuitem')).toHaveText(['Registrera färdighet']);
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(`${MATRIX}?register=lena&competence=t-journal`);
      const dialog = page.getByRole('dialog', { name: 'Registrera färdighet' });
      await expect(
        dialog
          .getByRole('status')
          .filter({ hasText: 'En färdighet registreras med en nivå, som räknas som bekräftad av dig.' }),
      ).toBeVisible();
      await expect(dialog.getByLabel('Utfärdat', { exact: false })).toHaveCount(0);
      await expect(dialog.getByRole('switch')).toHaveCount(0);
      await settled(page);
      await expectNoAxeViolations(page);
      // No level chosen: said on the group, whose first choice takes the focus; the arrow keys choose.
      await dialog.getByRole('button', { name: 'Registrera', exact: true }).focus();
      await page.keyboard.press('Enter');
      await expect(dialog.getByRole('radiogroup', { name: /Nivå/ })).toHaveAttribute('aria-invalid', 'true');
      await expect(dialog.getByRole('radio', { name: /Grundläggande/ })).toBeFocused();
      await page.keyboard.press('ArrowDown');
      await expect(dialog.getByRole('radio', { name: /Självständig/ })).toBeChecked();
      await tabTo(page, dialog.getByRole('button', { name: 'Registrera', exact: true }), { max: 8 });
      await page.keyboard.press('Enter');
      await expect(dialog).toBeHidden();
      await expect(page).toHaveURL(MATRIX);
      expect(api.skillWrites).toEqual([
        { method: 'POST', path: '/competence/people/lena/skills', body: { typeId: 't-journal', level: 2 } },
      ]);
      await expect(
        notices(page).getByText('Journalsystem är registrerad för Lena Berg på nivån Självständig.'),
      ).toBeAttached();
      await expect(row(page, 'Lena Berg').getByRole('cell').nth(3)).toContainText('Självständig');
      await expect(row(page, 'Lena Berg').getByRole('cell').nth(3)).not.toContainText('Saknas');
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

    test('choosing a set keeps what is open beside the matrix', async ({ page, api }) => {
      switchedOn(api);
      api.competenceMatrixSets = true;
      await page.setViewportSize({ width: 1440, height: 900 });
      await open(page, `${MATRIX}?card=omtanke`);
      const panel = page.getByRole('complementary', { name: 'Ärende' });
      await expect(panel).toBeVisible();
      await page.getByRole('combobox', { name: /Visa kompetenser för/ }).click();
      await page.getByRole('option', { name: /^Undersköterska/ }).click();
      await expect(page).toHaveURL(`${MATRIX}?card=omtanke&by=position%3Aunderskoterska`);
      await expect(panel).toBeVisible();
      // Two columns fit beside the panel, so the matrix is the table again.
      await expect(page.getByRole('table').getByRole('columnheader')).toHaveText([
        'Medarbetare',
        'HLRAkut omhändertagande',
        'Heta arbetenSäkerhet',
      ]);
    });

    /**
     * Tabbing through a row of a table that scrolls sideways, forwards to its last competence and back to its first:
     * how far each cell's control, as it takes the focus, lies under the pinned column of names, and how wide it is.
     */
    async function walkUnderThePinnedNames(page: Page, api: MockApi) {
      switchedOn(api);
      api.competenceMatrix = wide(api.competenceMatrix);
      await open(page, MATRIX);
      // Ten columns are wider than the page at this width: the table scrolls sideways inside its own region.
      const scrolls = await page.getByRole('table').evaluate(el => {
        let n: HTMLElement | null = el.parentElement;
        while (n && !/(auto|scroll)/.test(getComputedStyle(n).overflowX)) n = n.parentElement;
        return !!n && n.scrollWidth > n.clientWidth;
      });
      expect(scrolls).toBe(true);
      const names = ['HLR', 'Fallskydd', 'Heta arbeten', ...Array.from({ length: 7 }, (_, i) => `Extra ${i + 1}`)];
      const pinned = row(page, 'Anna Lindqvist').getByRole('rowheader');
      const stops: Array<{ name: string; way: string; under: number; width: number }> = [];
      const measure = async (name: string, way: string) => {
        await expect(cell(page, name, 'Anna Lindqvist')).toBeFocused();
        const edge = (await pinned.boundingBox())!;
        const box = await page.evaluate(() => document.activeElement!.getBoundingClientRect().toJSON() as DOMRect);
        stops.push({ name, way, under: Math.max(0, Math.round(edge.x + edge.width - box.left)), width: box.width });
      };
      await tabTo(page, cell(page, names[0]!, 'Anna Lindqvist'));
      for (const name of names.slice(1)) {
        await page.keyboard.press('Tab');
        await measure(name, 'forwards');
      }
      for (const name of names.slice(0, -1).reverse()) {
        await page.keyboard.press('Shift+Tab');
        await measure(name, 'backwards');
      }
      return stops;
    }

    // Astryx gap (2.4.11): tabbing backwards through a row of a table that scrolls sideways, the browser leaves a cell's
    // control where it already lies inside the scroll region, which is under the column `useTableStickyColumns` pins at
    // its start edge, so the focused control can be entirely hidden (measured 2026-11-12 at 1280 px: Extra 2 lay 188 px
    // and Fallskydd 110 px inside the pinned column, the menu button being 28 px wide). Tabbing forwards is clear. The
    // plugin sets no `scroll-padding` for its pinned run and documents no way to keep a focused cell clear of it, and Clew
    // adds no CSS or scrolling script of its own, so this stays as found until Astryx offers one.
    test.fixme('a cell’s control taking the focus is never under the pinned names, tabbing forwards or backwards (2.4.11)', async ({
      page,
      api,
    }) => {
      const stops = await walkUnderThePinnedNames(page, api);
      expect(stops.filter(s => s.under > 0)).toEqual([]);
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
    test('the matrix, its sets and its dialogs reflow at 320 px', async ({ page, api }) => {
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
      lenaWaits(api);
      await open(page, `${MATRIX}?approve=own-lena`);
      await expect(approvalDialog(page).getByRole('button', { name: 'Godkänn' })).toBeVisible();
      expect(await reflowProblems(page)).toEqual([]);
    });
  });
});
