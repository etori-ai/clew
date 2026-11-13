import type { Page } from '@playwright/test';
import { competenceCatalogue, competenceSources } from './competence';
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
 * Administration › Kompetens › Källor (D108 item 9): the systems whose holdings Clew copies into its competence register,
 * each with its last read and a way to read it now, and each source's types with how many holdings carry them and the
 * catalogue type they are mapped to. A type is mapped in a dialog with an address, what is missing is said on its field,
 * and a mapping is removed there; the page's own answer when the module is off and when no system answers; and a copied
 * holding drawn on a person's list with its source, the time it was read, and "räknas inte" while its type is not
 * mapped. Keyboard, focus, structure, axe and reflow, at desktop, phone and 320 px.
 */
const SOURCES = '/admin/competence/sources';
const notices = (page: Page) => page.getByRole('region', { name: 'Aviseringar' });
const dialogOf = (page: Page) => page.getByRole('dialog', { name: 'Koppla till katalogen' });
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
const mapAddress = (connectorId: string, type: string) =>
  `${SOURCES}?${new URLSearchParams({ source: connectorId, type })}`;
/** The module on, the catalogue and the sources as the fixtures have them. */
const switchedOn = (api: { admin: boolean; competenceTypes: unknown; competenceSources: unknown }) => {
  api.admin = true;
  api.competenceTypes = competenceCatalogue();
  api.competenceSources = competenceSources();
};

test.describe('Administration › Kompetens › Källor', () => {
  for (const [layout, viewport] of [
    ['desktop', desktop],
    ['phone', phone],
  ] as const)
    test.describe(layout, () => {
      test.use({ viewport });
      test('the sources have no axe violations and every focus stop is marked', async ({ page, api }) => {
        switchedOn(api);
        await open(page, SOURCES);
        await expect(page.getByRole('heading', { level: 1, name: 'Källor för kompetens' })).toBeVisible();
        await expect(page.getByRole('heading', { level: 2, name: 'Lärplattformen' })).toBeVisible();
        await expectNoAxeViolations(page);
        const { unmarked } = await hiddenFocusStops(page);
        expect(unmarked).toEqual([]);
      });
    });

  test.describe('desktop', () => {
    test.use({ viewport: desktop });
    test('reached from the catalogue: each source with its last read, and its types with their holdings and mapping', async ({
      page,
      api,
    }) => {
      switchedOn(api);
      await open(page, '/admin/competence');
      await page.getByRole('main').getByRole('link', { name: 'Källor', exact: true }).click();
      await expect(page).toHaveURL(SOURCES);
      await expect(page).toHaveTitle('Källor för kompetens · Startsidan');
      // The rail keeps Kompetens as the place, and the trail leads back to the catalogue.
      await expect(
        page.getByRole('navigation', { name: 'Sidonavigering' }).getByRole('link', { name: 'Kompetens', exact: true }),
      ).toHaveAttribute('aria-current', 'page');
      await expect(
        page.getByRole('navigation', { name: 'Du är här' }).getByRole('link', { name: 'Kompetens' }),
      ).toHaveAttribute('href', '/admin/competence');
      const table = page.getByRole('table');
      await expect(table).toHaveCount(1);
      await expect(table.getByRole('columnheader')).toHaveText(['Typ i källan', 'Intyg', 'Kopplad till', 'Koppla']);
      const hlr = table.getByRole('row', { name: /Hjärt-lungräddning med hjärtstartare/ });
      await expect(hlr).toContainText('clew-dev:hlr');
      await expect(hlr).toContainText('38 intyg');
      await expect(hlr).toContainText('HLR');
      await expect(table.getByRole('row', { name: /Livsmedelshygien/ }).getByText('Inte kopplad')).toBeVisible();
      // The last read, as facts: when, how it went, how much, and the keys that matched nobody.
      const lms = page.getByRole('toolbar', { name: 'Lärplattformen' });
      await expect(lms).toBeVisible();
      await expect(page.getByText('12 november 2026 kl. 04:02')).toBeVisible();
      await expect(page.getByText('Läst', { exact: true })).toBeVisible();
      await expect(page.getByText('Användarnamn utan person')).toBeVisible();
      // A source that no longer answers keeps its row, says so, and cannot be read now.
      await expect(page.getByRole('heading', { level: 2, name: 'Kursregistret' })).toBeVisible();
      await expect(page.getByText('Läses inte in', { exact: true })).toBeVisible();
      await expect(page.getByText('Kunde inte läsas')).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Inga intyg är inlästa' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Läs in nu: Kursregistret' })).toBeDisabled();
    });

    test('a type is mapped by keyboard: the choice is asked for on its field, then saved, said and listed', async ({
      page,
      api,
    }) => {
      switchedOn(api);
      await open(page, SOURCES);
      const map = page.getByRole('link', { name: 'Koppla Livsmedelshygien' });
      await map.focus();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(mapAddress('lms', 'clew-dev:livsmedelshygien'));
      const dialog = dialogOf(page);
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText('21 intyg')).toBeVisible();
      await settled(page);
      await expectNoAxeViolations(page);
      // No mapping yet: nothing to remove.
      await expect(dialog.getByRole('button', { name: 'Ta bort kopplingen' })).toHaveCount(0);

      await dialog.getByRole('button', { name: 'Spara', exact: true }).focus();
      await page.keyboard.press('Enter');
      await expect(dialog.getByText('Välj en kompetens.', { exact: true })).toBeVisible();
      const choice = dialog.getByRole('combobox', { name: /Kompetens i katalogen/ });
      await expect(choice).toBeFocused();
      expect(api.sourceWrites).toEqual([]);

      await page.keyboard.press('Enter');
      // Archived types take nothing new, so they are not offered.
      await expect(page.getByRole('option', { name: 'Äldre brandskydd' })).toHaveCount(0);
      await page.getByRole('option', { name: 'Fallskydd' }).click();
      await expect(choice).toContainText('Fallskydd');
      await dialog.getByRole('button', { name: 'Spara', exact: true }).click();

      await expect(dialog).toBeHidden();
      await expect(page).toHaveURL(SOURCES);
      expect(api.sourceWrites).toEqual([
        {
          method: 'PUT',
          path: '/competence/sources/lms/mapping',
          body: { sourceType: 'clew-dev:livsmedelshygien', typeId: 't-fall' },
        },
      ]);
      await expect(
        notices(page).getByText('Livsmedelshygien är kopplad till Fallskydd. 21 intyg räknas nu.'),
      ).toBeAttached();
      await expect(page.getByRole('table').getByRole('row', { name: /Livsmedelshygien/ })).toContainText('Fallskydd');
    });

    test('a mapping is removed in its dialog, and Esc closes back to the list without writing', async ({
      page,
      api,
    }) => {
      switchedOn(api);
      await open(page, mapAddress('lms', 'clew-dev:hlr'));
      const dialog = dialogOf(page);
      await expect(dialog.getByRole('combobox', { name: /Kompetens i katalogen/ })).toContainText('HLR');
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(page).toHaveURL(SOURCES);
      expect(api.sourceWrites).toEqual([]);

      await page.getByRole('link', { name: 'Koppla Hjärt-lungräddning med hjärtstartare' }).click();
      await dialog.getByRole('button', { name: 'Ta bort kopplingen' }).click();
      await expect(dialog).toBeHidden();
      expect(api.sourceWrites).toEqual([
        { method: 'PUT', path: '/competence/sources/lms/mapping', body: { sourceType: 'clew-dev:hlr', typeId: null } },
      ]);
      await expect(
        notices(page).getByText('Hjärt-lungräddning med hjärtstartare är inte längre kopplad. 38 intyg räknas inte.'),
      ).toBeAttached();
      await expect(
        page
          .getByRole('table')
          .getByRole('row', { name: /Hjärt-lungräddning/ })
          .getByText('Inte kopplad'),
      ).toBeVisible();
    });

    test('a read is started by hand, said, and the source shows it is being read', async ({ page, api }) => {
      switchedOn(api);
      await open(page, SOURCES);
      const read = page.getByRole('button', { name: 'Läs in nu: Lärplattformen' });
      await read.focus();
      await page.keyboard.press('Enter');
      await expect(notices(page).getByText('Lärplattformen läses in.')).toBeAttached();
      expect(api.sourceWrites).toEqual([{ method: 'POST', path: '/competence/sources/lms/read' }]);
      await expect(page.getByText('Läses in', { exact: true })).toBeVisible();
      await expect(read).toBeDisabled();
    });

    test('a read asked for is followed to its result, which is shown and said without a reload', async ({
      page,
      api,
    }) => {
      switchedOn(api);
      await open(page, SOURCES);
      const read = page.getByRole('button', { name: 'Läs in nu: Lärplattformen' });
      await read.click();
      await expect(notices(page).getByText('Lärplattformen läses in.')).toBeAttached();
      await expect(page.getByText('Läses in', { exact: true })).toBeVisible();
      // The run finishes on the server some time after the page last asked.
      const lms = api.competenceSources.find(s => s.connectorId === 'lms')!;
      lms.reading = false;
      lms.lastRead = {
        ...lms.lastRead!,
        startedAt: '2026-11-13T09:29:00.000Z',
        finishedAt: '2026-11-13T09:30:00.000Z',
        outcome: 'partial',
        counts: { ...lms.lastRead!.counts, read: 431 },
      };
      await expect(page.getByText('13 november 2026 kl. 10:30')).toBeVisible();
      await expect(page.getByText('Delvis läst', { exact: true })).toBeVisible();
      await expect(page.getByText('431', { exact: true })).toBeVisible();
      await expect(notices(page).getByText('Lärplattformen är delvis inläst.')).toBeAttached();
      await expect(page.getByText('Läses in', { exact: true })).toHaveCount(0);
      await expect(read).toBeEnabled();
      await expectNoAxeViolations(page);
    });

    test('a read queued and not yet begun is still followed: the source says it is being read until its result shows', async ({
      page,
      api,
    }) => {
      switchedOn(api);
      await open(page, SOURCES);
      const read = page.getByRole('button', { name: 'Läs in nu: Lärplattformen' });
      await read.click();
      await expect(notices(page).getByText('Lärplattformen läses in.')).toBeAttached();
      // The server has queued the read and no run holds the source yet: it does not say it is being read.
      const lms = api.competenceSources.find(s => s.connectorId === 'lms')!;
      lms.reading = false;
      await page.waitForResponse(r => r.url().endsWith('/competence/sources') && r.request().method() === 'GET');
      await expect(page.getByText('Läses in', { exact: true })).toBeVisible();
      await expect(read).toBeDisabled();
      lms.lastRead = { ...lms.lastRead!, finishedAt: '2026-11-13T09:30:00.000Z' };
      await expect(notices(page).getByText('Lärplattformen är inläst.')).toBeAttached();
      await expect(read).toBeEnabled();
    });

    test('a read under way when the page opens is followed too, without a notice nobody asked for', async ({
      page,
      api,
    }) => {
      switchedOn(api);
      const lms = api.competenceSources.find(s => s.connectorId === 'lms')!;
      lms.reading = true;
      await open(page, SOURCES);
      const read = page.getByRole('button', { name: 'Läs in nu: Lärplattformen' });
      await expect(page.getByText('Läses in', { exact: true })).toBeVisible();
      await expect(read).toBeDisabled();
      lms.reading = false;
      lms.lastRead = { ...lms.lastRead!, finishedAt: '2026-11-13T09:30:00.000Z' };
      await expect(page.getByText('13 november 2026 kl. 10:30')).toBeVisible();
      await expect(read).toBeEnabled();
      await expect(notices(page).getByText('Lärplattformen är inläst.')).toHaveCount(0);
    });

    test('a refusal of the server is an alert in the dialog, and what was chosen stays', async ({ page, api }) => {
      switchedOn(api);
      api.sourceFail = 'Kompetensen är arkiverad och kan inte kopplas.';
      await open(page, mapAddress('lms', 'badge:4'));
      const dialog = dialogOf(page);
      const choice = dialog.getByRole('combobox', { name: /Kompetens i katalogen/ });
      await choice.click();
      await page.getByRole('option', { name: 'Heta arbeten' }).click();
      await dialog.getByRole('button', { name: 'Spara', exact: true }).click();
      await expect(
        dialog.getByRole('alert').filter({ hasText: 'Kompetensen är arkiverad och kan inte kopplas.' }),
      ).toBeVisible();
      await expect(choice).toContainText('Heta arbeten');
      await expectNoAxeViolations(page);
    });

    test('with the module off the page says so and where to go, and with no source it says what makes one appear', async ({
      page,
      api,
    }) => {
      api.admin = true;
      await open(page, SOURCES);
      await expect(
        page.getByRole('heading', { level: 2, name: 'Källorna är inte tillgängliga för dig' }),
      ).toBeVisible();
      await expect(page.getByText(/Kompetens är inte påslaget i den här installationen\./).first()).toBeVisible();
      await expect(page.getByRole('link', { name: 'Till Anslutna system' })).toBeVisible();
      await expectNoAxeViolations(page);
      api.competenceTypes = competenceCatalogue();
      api.competenceSources = [];
      await page.reload();
      await expect(page.getByRole('heading', { name: 'Inget system svarar om intyg' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Till Anslutna system' })).toBeVisible();
      await settled(page);
      await expectNoAxeViolations(page);
    });

    test("a person's list draws a copied holding with its source and when it was read, and one that is not mapped as not counted", async ({
      page,
      api,
    }) => {
      switchedOn(api);
      await open(page, `/tools/competence.holdings?title=${encodeURIComponent('Mina kompetenser')}&from=%2F`);
      const main = page.getByRole('main');
      const brand = main.getByRole('listitem').filter({ hasText: 'Brandskydd' });
      await expect(brand).toContainText('Lärplattformen');
      const waiting = main.getByRole('listitem').filter({ hasText: 'Livsmedelshygien' });
      await expect(waiting).toContainText(/räknas inte/i);
      await expect(waiting).toContainText('Lärplattformen');
      await expectNoAxeViolations(page);
    });
  });

  test.describe('phone', () => {
    test.use({ viewport: phone });
    test("each source's types are a list with a way to map each one, and the dialog fills the screen", async ({
      page,
      api,
    }) => {
      switchedOn(api);
      await open(page, SOURCES);
      const list = page.getByRole('list', { name: 'Typer i Lärplattformen' });
      await expect(list.getByText('38 intyg · Kopplad till HLR')).toBeVisible();
      await expect(list.getByText('21 intyg · Inte kopplad')).toBeVisible();
      await list.getByRole('link', { name: 'Koppla Livsmedelshygien' }).click();
      const dialog = dialogOf(page);
      await expect(dialog.getByRole('combobox', { name: /Kompetens i katalogen/ })).toBeVisible();
      await settled(page);
      await expectNoAxeViolations(page);
    });
  });

  test.describe('1.4.10 reflow', () => {
    test('the sources and the dialog reflow at 320 px', async ({ page, api }) => {
      switchedOn(api);
      await page.setViewportSize(narrow);
      await open(page, SOURCES);
      await expect(page.getByRole('list', { name: 'Typer i Lärplattformen' })).toBeVisible();
      expect(await reflowProblems(page)).toEqual([]);
      await open(page, mapAddress('lms', 'badge:4'));
      await expect(dialogOf(page).getByRole('button', { name: 'Spara', exact: true })).toBeVisible();
      expect(await reflowProblems(page)).toEqual([]);
    });
  });
});
