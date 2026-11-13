import type { Page } from '@playwright/test';
import { competenceCatalogue, competenceRequirements, competenceShareTargets, skillTypes } from './competence';
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
 * Administration › Kompetens › Krav (D108 item 6): the requirements on positions and on units, each kind a card, and the
 * share targets as a card of their own. A requirement and a share target are added in a dialog with an address, what is
 * missing is said on its field, and the address is the page's own again after close; a removal is asked for through the
 * confirmation and the focus then goes to the card's heading. The page's own answer when the module is off and when
 * nothing is set, and a person's list drawing a required competence they lack as "saknas". Keyboard, focus, structure,
 * axe and reflow, at desktop, phone and 320 px.
 */
const REQUIREMENTS = '/admin/competence/requirements';
const notices = (page: Page) => page.getByRole('region', { name: 'Aviseringar' });
const requirementDialog = (page: Page) => page.getByRole('dialog', { name: 'Lägg till krav' });
const targetDialog = (page: Page) => page.getByRole('dialog', { name: 'Lägg till andelsmål' });
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
/** The module on, the catalogue, the requirements and the share targets as the fixtures have them. */
const switchedOn = (api: {
  admin: boolean;
  competenceTypes: unknown;
  competenceRequirements: unknown;
  competenceShareTargets: unknown;
}) => {
  api.admin = true;
  api.competenceTypes = competenceCatalogue();
  api.competenceRequirements = competenceRequirements();
  api.competenceShareTargets = competenceShareTargets();
};

test.describe('Administration › Kompetens › Krav', () => {
  for (const [layout, viewport] of [
    ['desktop', desktop],
    ['phone', phone],
  ] as const)
    test.describe(layout, () => {
      test.use({ viewport });
      test('the requirements have no axe violations and every focus stop is marked', async ({ page, api }) => {
        switchedOn(api);
        await open(page, REQUIREMENTS);
        await expect(page.getByRole('heading', { level: 1, name: 'Krav på kompetens' })).toBeVisible();
        await expect(page.getByRole('heading', { level: 2, name: 'Krav på befattningar' })).toBeVisible();
        await expect(page.getByRole('heading', { level: 2, name: 'Andelsmål' })).toBeVisible();
        await expectNoAxeViolations(page);
        const { unmarked } = await hiddenFocusStops(page);
        expect(unmarked).toEqual([]);
      });
    });

  test.describe('desktop', () => {
    test.use({ viewport: desktop });
    test('reached from the catalogue: the requirements by what they are set on, and the share targets', async ({
      page,
      api,
    }) => {
      switchedOn(api);
      await open(page, '/admin/competence');
      await page.getByRole('main').getByRole('link', { name: 'Krav', exact: true }).click();
      await expect(page).toHaveURL(REQUIREMENTS);
      await expect(page).toHaveTitle('Krav på kompetens · Startsidan');
      // The rail keeps Kompetens as the place, and the trail leads back to the catalogue.
      await expect(
        // Under Administration: the place Kompetens in the rail is the reader's own (D120 item 8), another link.
        page
          .getByRole('navigation', { name: 'Sidonavigering' })
          .getByRole('group', { name: 'Administration', exact: true })
          .getByRole('link', { name: 'Kompetens', exact: true }),
      ).toHaveAttribute('aria-current', 'page');
      await expect(
        page.getByRole('navigation', { name: 'Du är här' }).getByRole('link', { name: 'Kompetens' }),
      ).toHaveAttribute('href', '/admin/competence');
      const tables = page.getByRole('table');
      await expect(tables).toHaveCount(3);
      const [positions, units, targets] = [tables.nth(0), tables.nth(1), tables.nth(2)];
      await expect(positions.getByRole('columnheader')).toHaveText(['Befattning', 'Kompetens', 'Ta bort']);
      await expect(positions.getByRole('row', { name: /Undersköterska/ })).toContainText('HLR');
      // A requirement is bound to the position's code, shown beside its current name.
      await expect(positions.getByRole('row', { name: /Undersköterska/ })).toContainText('underskoterska');
      // A requirement on a type since archived counts towards nothing, and says so.
      await expect(
        positions.getByRole('row', { name: /Sjuksköterska/ }).getByText('Arkiverad', { exact: true }),
      ).toBeVisible();
      // So does one on a position the provisioner has removed, listed by its code so that it can be removed.
      const gone = positions.getByRole('row', { name: /tolk/ });
      await expect(gone.getByText('Finns inte längre', { exact: true })).toBeVisible();
      await expect(gone.getByRole('button', { name: /Ta bort kravet på Heta arbeten/ })).toBeVisible();
      await expect(units.getByRole('columnheader')).toHaveText(['Enhet', 'Kompetens', 'Ta bort']);
      await expect(units.getByRole('row', { name: /Gata och park/ })).toContainText('Fallskydd');
      await expect(targets.getByRole('columnheader')).toHaveText([
        'Kompetens',
        'Befattning',
        'Gäller',
        'Minst',
        'Utfall',
        'Ta bort',
      ]);
      // A target across the organisation is measured over it once, a figure naming nobody, or is too few to show; a
      // unit's target is read by the manager who leads the unit.
      const target = targets.getByRole('row', { name: /HLR/ });
      await expect(target).toContainText('Undersköterska');
      await expect(target).toContainText('Hela organisationen');
      await expect(target).toContainText('80 %');
      await expect(target).toContainText('83 %, uppfyllt');
      await expect(targets.getByRole('row', { name: /Fallskydd/ })).toContainText('För få för att visas');
      await expect(targets.getByRole('row', { name: /Heta arbeten/ })).toContainText('Visas för enhetens chef');
    });

    test('a requirement is added by keyboard: what is missing is said on its field, then it is saved, said and listed', async ({
      page,
      api,
    }) => {
      switchedOn(api);
      await open(page, REQUIREMENTS);
      await page.getByRole('link', { name: 'Lägg till krav' }).focus();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(`${REQUIREMENTS}?requirement=new`);
      const dialog = requirementDialog(page);
      await expect(dialog).toBeVisible();
      await settled(page);
      await expectNoAxeViolations(page);

      const save = dialog.getByRole('button', { name: 'Spara', exact: true });
      await save.focus();
      await page.keyboard.press('Enter');
      // The field itself is marked invalid and takes the focus; its message is the field's description.
      const competence = dialog.getByRole('combobox', { name: /Kompetens/ });
      await expect(competence).toHaveAttribute('aria-invalid', 'true');
      await expect(competence).toHaveAccessibleDescription(/Välj en kompetens\./);
      await expect(competence).toBeFocused();
      expect(api.requirementWrites).toEqual([]);

      await page.keyboard.press('Enter');
      // An archived type takes nothing new, so it is not offered.
      await expect(page.getByRole('option', { name: 'Äldre brandskydd' })).toHaveCount(0);
      await page.getByRole('option', { name: 'Heta arbeten' }).click();
      await expect(competence).toContainText('Heta arbeten');
      // A unit instead of a position: the field that follows asks for a unit.
      await dialog.getByRole('radio', { name: /En enhet/ }).check();
      await save.focus();
      await page.keyboard.press('Enter');
      const unit = dialog.getByRole('combobox', { name: /Enhet/ });
      await expect(unit).toHaveAttribute('aria-invalid', 'true');
      await expect(competence).not.toHaveAttribute('aria-invalid', 'true');
      await expect(unit).toBeFocused();
      await page.keyboard.press('Enter');
      await page.getByRole('option', { name: 'Hemtjänst Norr' }).click();
      await save.focus();
      await page.keyboard.press('Enter');

      await expect(dialog).toBeHidden();
      await expect(page).toHaveURL(REQUIREMENTS);
      // Saved, the focus is back on the button that opened the dialog.
      await expect(page.getByRole('link', { name: 'Lägg till krav' })).toBeFocused();
      expect(api.requirementWrites).toEqual([
        { method: 'POST', path: '/competence/requirements', body: { typeId: 't-heta', unitId: 'unit-hemtjanst' } },
      ]);
      await expect(notices(page).getByText('Heta arbeten krävs nu av dem på Hemtjänst Norr.')).toBeAttached();
      await expect(
        page
          .getByRole('table')
          .nth(1)
          .getByRole('row', { name: /Hemtjänst Norr/ }),
      ).toContainText('Heta arbeten');
    });

    test('a skill is required at a least level (D120): the level is asked once a skill is chosen, Grundläggande unless another is', async ({
      page,
      api,
    }) => {
      switchedOn(api);
      api.competenceTypes = [...competenceCatalogue(), ...skillTypes()];
      api.competenceRequirements = {
        ...competenceRequirements(),
        rows: [
          ...competenceRequirements().rows,
          {
            id: 'r-eng-ssk',
            typeId: 't-eng',
            on: 'position',
            targetId: 'sjukskoterska',
            targetLabel: 'Sjuksköterska',
            minLevel: 3,
          },
        ],
      };
      await open(page, REQUIREMENTS);
      // A skill's requirement says its least level where it is listed.
      await expect(
        page
          .getByRole('table')
          .first()
          .getByRole('row', { name: /Engelska/ }),
      ).toContainText('Minst Expert');
      await page.getByRole('link', { name: 'Lägg till krav' }).focus();
      await page.keyboard.press('Enter');
      const dialog = requirementDialog(page);
      await expect(dialog).toBeVisible();
      // Not asked of a certificate.
      await expect(dialog.getByRole('radiogroup', { name: /Lägsta nivå/ })).toHaveCount(0);
      const competence = dialog.getByRole('combobox', { name: /Kompetens/ });
      await competence.focus();
      await page.keyboard.type('Journalsystem');
      await expect(competence).toContainText('Journalsystem');
      const least = dialog.getByRole('radiogroup', { name: /Lägsta nivå/ });
      await expect(least).toBeVisible();
      const basic = dialog.getByRole('radio', { name: /Grundläggande/ });
      await expect(basic).toBeChecked();
      await settled(page);
      await expectNoAxeViolations(page);
      await basic.focus();
      await page.keyboard.press('ArrowDown');
      await expect(dialog.getByRole('radio', { name: /Självständig/ })).toBeChecked();
      const position = dialog.getByRole('combobox', { name: /Befattning/ });
      await position.focus();
      await page.keyboard.type('Under');
      await expect(position).toContainText('Undersköterska');
      await dialog.getByRole('button', { name: 'Spara', exact: true }).focus();
      await page.keyboard.press('Enter');
      await expect(dialog).toBeHidden();
      expect(api.requirementWrites).toEqual([
        {
          method: 'POST',
          path: '/competence/requirements',
          body: { typeId: 't-journal', positionCode: 'underskoterska', minLevel: 2 },
        },
      ]);
      await expect(
        notices(page).getByText(
          'Journalsystem krävs nu av dem med befattningen Undersköterska på minst nivån Självständig.',
        ),
      ).toBeAttached();
      await expect(
        page
          .getByRole('table')
          .first()
          .getByRole('row', { name: /Journalsystem/ }),
      ).toContainText('Minst Självständig');
    });

    test('a removal is asked for in the confirmation: Esc lets go of it, the second press removes and the focus goes to the card', async ({
      page,
      api,
    }) => {
      switchedOn(api);
      await open(page, REQUIREMENTS);
      const remove = page.getByRole('button', {
        name: 'Ta bort kravet på HLR för dem med befattningen Undersköterska',
      });
      await remove.focus();
      await page.keyboard.press('Enter');
      const confirm = page.getByRole('alertdialog', { name: 'Ta bort kravet?' });
      await expect(confirm).toBeVisible();
      await expect(confirm).toContainText('HLR krävs inte längre av dem med befattningen Undersköterska.');
      await settled(page);
      await expectNoAxeViolations(page);
      await page.keyboard.press('Escape');
      await expect(confirm).toBeHidden();
      await expect(remove).toBeFocused();
      expect(api.requirementWrites).toEqual([]);

      await page.keyboard.press('Enter');
      await confirm.getByRole('button', { name: 'Ta bort kravet' }).click();
      await expect(confirm).toBeHidden();
      expect(api.requirementWrites).toEqual([{ method: 'DELETE', path: '/competence/requirements/r-hlr-usk' }]);
      await expect(
        notices(page).getByText('HLR krävs inte längre av dem med befattningen Undersköterska.'),
      ).toBeAttached();
      await expect(
        page
          .getByRole('table')
          .first()
          .getByRole('row', { name: /Undersköterska/ }),
      ).toHaveCount(0);
      await expect(page.getByRole('heading', { level: 2, name: 'Krav på befattningar' })).toBeFocused();
      await expect(page).toHaveURL(REQUIREMENTS);
    });

    test('a share target is added with its unit and least share, said and listed; Esc closes back to the page', async ({
      page,
      api,
    }) => {
      switchedOn(api);
      await open(page, `${REQUIREMENTS}?target=new`);
      const dialog = targetDialog(page);
      await expect(dialog).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(page).toHaveURL(REQUIREMENTS);
      // Opened by its address nothing on the page opened it: the button that opens it takes the focus.
      await expect(page.getByRole('link', { name: 'Lägg till andelsmål' })).toBeFocused();
      expect(api.requirementWrites).toEqual([]);

      await page.getByRole('link', { name: 'Lägg till andelsmål' }).focus();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(`${REQUIREMENTS}?target=new`);
      await dialog.getByRole('combobox', { name: /Kompetens/ }).click();
      await page.getByRole('option', { name: 'Fallskydd' }).click();
      await dialog.getByRole('combobox', { name: /Befattning/ }).click();
      await page.getByRole('option', { name: 'Maskinförare' }).click();
      await dialog.getByRole('radio', { name: /En enhet/ }).check();
      const save = dialog.getByRole('button', { name: 'Spara', exact: true });
      await save.focus();
      await page.keyboard.press('Enter');
      // The unit is asked for first, then the share.
      const unit = dialog.getByRole('combobox', { name: /Enhet/ });
      await expect(unit).toHaveAttribute('aria-invalid', 'true');
      await expect(unit).toBeFocused();
      await page.keyboard.press('Enter');
      await page.getByRole('option', { name: 'Gata och park' }).click();
      await save.focus();
      await page.keyboard.press('Enter');
      const share = dialog.getByRole('spinbutton', { name: /Minst/ });
      await expect(share).toHaveAttribute('aria-invalid', 'true');
      await expect(share).toHaveAccessibleDescription(/Ange en andel, 1 till 100 procent\./);
      await expect(share).toBeFocused();
      await page.keyboard.type('50');
      await page.keyboard.press('Tab');
      await save.focus();
      await page.keyboard.press('Enter');

      await expect(dialog).toBeHidden();
      await expect(page).toHaveURL(REQUIREMENTS);
      expect(api.requirementWrites).toEqual([
        {
          method: 'POST',
          path: '/competence/share-targets',
          body: { typeId: 't-fall', positionCode: 'maskinforare', minShare: 50, unitId: 'unit-gata' },
        },
      ]);
      await expect(
        notices(page).getByText('Minst 50 % av dem med befattningen Maskinförare ska ha Fallskydd på Gata och park.'),
      ).toBeAttached();
      const row = page
        .getByRole('table')
        .nth(2)
        .getByRole('row', { name: /Fallskydd/ })
        .filter({ hasText: 'Gata och park' });
      await expect(row).toContainText('50 %');
      await expect(page.getByRole('link', { name: 'Lägg till andelsmål' })).toBeFocused();
    });

    test('a refusal of the server is an alert in the dialog, and what was chosen stays', async ({ page, api }) => {
      switchedOn(api);
      api.requirementFail = 'Det kravet finns redan.';
      await open(page, `${REQUIREMENTS}?requirement=new`);
      const dialog = requirementDialog(page);
      const competence = dialog.getByRole('combobox', { name: /Kompetens/ });
      await competence.click();
      await page.getByRole('option', { name: 'HLR' }).click();
      await dialog.getByRole('combobox', { name: /Befattning/ }).click();
      await page.getByRole('option', { name: 'Undersköterska' }).click();
      await dialog.getByRole('button', { name: 'Spara', exact: true }).click();
      await expect(dialog.getByRole('alert').filter({ hasText: 'Det kravet finns redan.' })).toBeVisible();
      await expect(competence).toContainText('HLR');
      await expectNoAxeViolations(page);
    });

    test('with the module off the page says so and where to go, and with nothing set each card says what one is', async ({
      page,
      api,
    }) => {
      api.admin = true;
      await open(page, REQUIREMENTS);
      await expect(page.getByRole('heading', { level: 2, name: 'Kraven är inte tillgängliga för dig' })).toBeVisible();
      await expect(page.getByText(/Kompetens är inte påslaget i den här installationen\./).first()).toBeVisible();
      await expect(page.getByRole('link', { name: 'Till Anslutna system' })).toBeVisible();
      await expectNoAxeViolations(page);
      api.competenceTypes = competenceCatalogue();
      await page.reload();
      for (const title of ['Inga krav på befattningar', 'Inga krav på enheter', 'Inga andelsmål'])
        await expect(page.getByRole('heading', { level: 3, name: title })).toBeVisible();
      await settled(page);
      await expectNoAxeViolations(page);
    });

    test('a catalogue that cannot be read is said as an alert, as on the other pages', async ({ page, api }) => {
      switchedOn(api);
      api.catalogueReadFails = true;
      await open(page, REQUIREMENTS);
      await expect(page.getByRole('alert').filter({ hasText: 'Något gick fel. Försök igen.' })).toBeVisible();
      await expectNoAxeViolations(page);
    });

    test("a person's list draws a required competence they lack as missing, with no dates", async ({ page, api }) => {
      switchedOn(api);
      await open(page, `/tools/competence.holdings?title=${encodeURIComponent('Mina kompetenser')}&from=%2F`);
      const missing = page.getByRole('main').getByRole('listitem').filter({ hasText: 'Fallskydd' });
      await expect(missing).toContainText(/saknas/i);
      await expectNoAxeViolations(page);
    });
  });

  test.describe('phone', () => {
    test.use({ viewport: phone });
    test('each card is a list with a way to remove each row, and the dialog fills the screen', async ({
      page,
      api,
    }) => {
      switchedOn(api);
      await open(page, REQUIREMENTS);
      await expect(page.getByRole('table')).toHaveCount(0);
      const positions = page.getByRole('list', { name: 'Krav på befattningar' });
      await expect(positions.getByRole('listitem').filter({ hasText: 'Undersköterska' })).toContainText('HLR');
      await expect(
        page
          .getByRole('list', { name: 'Andelsmål' })
          .getByText('Minst 80 % av Undersköterska (underskoterska) · Hela organisationen'),
      ).toBeVisible();
      await expect(
        positions.getByRole('button', { name: 'Ta bort kravet på HLR för dem med befattningen Undersköterska' }),
      ).toBeVisible();
      await page.getByRole('link', { name: 'Lägg till krav' }).click();
      await expect(requirementDialog(page).getByRole('combobox', { name: /Kompetens/ })).toBeVisible();
      await settled(page);
      await expectNoAxeViolations(page);
    });
  });

  test.describe('1.4.10 reflow', () => {
    test('the requirements and both dialogs reflow at 320 px', async ({ page, api }) => {
      switchedOn(api);
      await page.setViewportSize(narrow);
      await open(page, REQUIREMENTS);
      await expect(page.getByRole('list', { name: 'Krav på befattningar' })).toBeVisible();
      expect(await reflowProblems(page)).toEqual([]);
      await open(page, `${REQUIREMENTS}?requirement=new`);
      await expect(requirementDialog(page).getByRole('button', { name: 'Spara', exact: true })).toBeVisible();
      expect(await reflowProblems(page)).toEqual([]);
      await open(page, `${REQUIREMENTS}?target=new`);
      await targetDialog(page)
        .getByRole('radio', { name: /En enhet/ })
        .check();
      await expect(targetDialog(page).getByRole('spinbutton', { name: /Minst/ })).toBeVisible();
      expect(await reflowProblems(page)).toEqual([]);
    });
  });
});
