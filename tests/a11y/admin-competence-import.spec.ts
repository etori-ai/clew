import type { Page } from '@playwright/test';
import { ESCO_SKILL_COLUMNS } from '../../packages/contracts/src/competence-import';
import { competenceCatalogue } from './competence';
import {
  announcements,
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
 * Administration › Kompetens › Importera (D120 item 7): a file of types read in the page with the parser the server
 * checks again. The format recognised and said, the count, what cannot be read listed under the field; the rows a page at
 * a time, searchable, each with a checkbox, a row the catalogue holds already marked and not to be chosen; the rows of
 * the page or every row that matches chosen at once, and the choice cleared with the focus kept; for ESCO's file its
 * acknowledgement and the area chosen or made; "Importera N" sending the choice in parts and saying what was added and
 * what was there already. No ESCO file is in the repository: the rows below are written with its published column names.
 * Keyboard, focus, announcements, axe and reflow, at desktop, phone and 320 px.
 */
const IMPORT = '/admin/competence/import';
const notices = (page: Page) => page.getByRole('region', { name: 'Aviseringar' });
// Astryx's FileInput names both its button and the native input it opens; a test fills the input.
const upload = (page: Page, text: string, name = 'kompetenser.csv') =>
  page
    .getByLabel('Fil med kompetenser', { exact: true })
    .and(page.locator('input[type="file"]'))
    .setInputFiles({ name, mimeType: 'text/csv', buffer: Buffer.from(text, 'utf8') });
const uri = (n: number) => `http://data.europa.eu/esco/skill/${String(n).padStart(8, '0')}-test`;
/** ESCO's skills file as published, with `rows` released skills, one draft and one row the catalogue holds by name. */
function escoFile(rows: number) {
  const line = (n: number, label: string, status = 'released') =>
    [
      'KnowledgeSkillCompetence',
      uri(n),
      'skill/competence',
      'cross-sector',
      label,
      '"en etikett\nen till"',
      '',
      status,
      '2024-01-01T00:00:00Z',
      '',
      '',
      'http://data.europa.eu/esco/concept-scheme/member-skills',
      '"En beskrivning, med kommatecken."',
    ].join(',');
  return [
    ESCO_SKILL_COLUMNS.join(','),
    ...Array.from({ length: rows }, (_, i) => line(i + 1, `färdighet ${String(i + 1).padStart(3, '0')}`)),
    line(9001, 'ett utkast', 'draft'),
    line(9002, 'HLR'),
  ].join('\r\n');
}
const clewFile = [
  'name,area,kind,validityMonths,uri',
  'Arbete på väg,Säkerhet,certificate,60,',
  'Truckkort,Fordon,Certifikat,,https://example.org/truck',
  'Heta arbeten,Säkerhet,certificate,,',
  'Engelska,Språk,skill,12,',
].join('\n');

test.describe('Administration › Kompetens › Importera', () => {
  for (const [layout, viewport] of [
    ['desktop', desktop],
    ['phone', phone],
  ] as const)
    test.describe(layout, () => {
      test.use({ viewport });
      test('the page has no axe violations and every focus stop is marked, with a file read too', async ({
        page,
        api,
      }) => {
        api.admin = true;
        api.competenceTypes = competenceCatalogue();
        await open(page, IMPORT);
        await expect(page.getByRole('heading', { level: 1, name: 'Importera kompetenser' })).toBeVisible();
        await expectNoAxeViolations(page);
        await upload(page, escoFile(3));
        await expect(
          page.getByText('ESCO:s färdigheter: 4 rader att välja bland.', { exact: true }).first(),
        ).toBeVisible();
        await page.evaluate(() =>
          Promise.all(
            document
              .getAnimations()
              .filter(a => a.effect?.getComputedTiming().iterations !== Infinity)
              .map(a => a.finished.catch(() => undefined)),
          ),
        );
        await expectNoAxeViolations(page);
        const { unmarked } = await hiddenFocusStops(page);
        expect(unmarked).toEqual([]);
      });
    });

  test.describe('desktop', () => {
    test.use({ viewport: desktop });
    test('it is reached from the catalogue, and the module off or the capability missing is the page’s own answer', async ({
      page,
      api,
    }) => {
      api.admin = true;
      api.competenceTypes = competenceCatalogue();
      await open(page, '/admin/competence');
      await page.getByRole('link', { name: 'Importera' }).click();
      await expect(page).toHaveURL(IMPORT);
      await expect(page).toHaveTitle('Importera kompetenser · Startsidan');
      await expect(page.getByRole('link', { name: 'Kompetens' }).first()).toBeVisible();
      api.competenceTypes = null;
      await open(page, IMPORT);
      await expect(page.getByRole('heading', { level: 2, name: 'Importen är inte tillgänglig för dig' })).toBeVisible();
      await expect(page.getByLabel('Fil med kompetenser')).toHaveCount(0);
      await expectNoAxeViolations(page);
    });
    test("ESCO's file: the format, the count and the acknowledgement; a row already held marked; the area chosen; the choice imported", async ({
      page,
      api,
    }) => {
      api.admin = true;
      api.competenceTypes = competenceCatalogue();
      await open(page, IMPORT);
      await upload(page, escoFile(120));
      await expect
        .poll(() => announcements(page))
        .toContainEqual(expect.stringContaining('ESCO:s färdigheter: 121 rader att välja bland.'));
      await expect(
        page.getByText('Den här tjänsten använder ESCO-klassificeringen från Europeiska kommissionen.', {
          exact: false,
        }),
      ).toBeVisible();
      await expect(page.getByText('1 rad i filen är inte publicerad i ESCO och visas inte.')).toBeVisible();
      await expect(page.getByText('121 rader att välja bland, varav 1 redan finns i katalogen.')).toBeVisible();
      // A page at a time: the first fifty rows, never all.
      const table = page.getByRole('table', { name: 'Raderna i filen' });
      await expect(table.getByRole('row', { name: /färdighet 001/ })).toBeVisible();
      await expect(table.getByRole('row', { name: /färdighet 051/ })).toHaveCount(0);
      // The row the catalogue holds by name is marked and cannot be chosen.
      await page.getByRole('searchbox', { name: 'Sök rad' }).fill('hlr');
      await expect(page.getByRole('status').filter({ hasText: 'matchar sökningen' })).toHaveText(
        '1 av 121 rader matchar sökningen',
      );
      const hlr = table.getByRole('row', { name: /HLR/ });
      await expect(hlr.getByText('Finns redan')).toBeVisible();
      await expect(hlr.getByRole('checkbox', { name: 'Markera HLR' })).toBeDisabled();
      await expect(page.getByRole('button', { name: 'Välj alla 0 som matchar' })).toHaveAttribute(
        'aria-disabled',
        'true',
      );
      // Every row that matches a search is chosen at once; the toolbar says how many, and clears with the focus kept.
      const search = page.getByRole('searchbox', { name: 'Sök rad' });
      await search.fill('färdighet 1');
      await expect(page.getByRole('status').filter({ hasText: 'matchar sökningen' })).toHaveText(
        '21 av 121 rader matchar sökningen',
      );
      const chooseMatching = page.getByRole('button', { name: 'Välj alla 21 som matchar' });
      await chooseMatching.focus();
      await page.keyboard.press('Enter');
      const chosen = page.getByRole('toolbar', { name: 'Valda rader' });
      await expect(chosen).toContainText('21 valda');
      await chosen.getByRole('button', { name: 'Avmarkera alla' }).focus();
      await page.keyboard.press('Enter');
      await expect(chosen).toHaveCount(0);
      await expect(chooseMatching).toBeFocused();
      // The rows of a page with the table's own checkbox; one row by its own; a page turned keeps the choice.
      await search.fill('');
      await table.getByRole('checkbox', { name: 'Markera alla rader' }).check();
      await expect(chosen).toContainText('50 valda');
      await page
        .getByRole('navigation', { name: 'Sidor med rader' })
        .getByRole('button', { name: 'Gå till nästa sida' })
        .click();
      await table.getByRole('checkbox', { name: 'Markera färdighet 051' }).check();
      await expect(chosen).toContainText('51 valda');
      await expectNoAxeViolations(page);
      // The area: asked for on its field when Importera is pressed without one, then a new one is made.
      const importButton = page.getByRole('button', { name: 'Importera 51' });
      await importButton.click();
      // The field's own status; its words are also spoken, so the live region holds them too.
      await expect(page.getByText('Välj ett område.').first()).toBeVisible();
      expect(api.importWrites).toEqual([]);
      const area = page.getByRole('combobox', { name: /Område/ });
      await expect(area).toBeFocused();
      await area.click();
      await page.getByRole('option', { name: 'Nytt område' }).click();
      const newArea = page.getByRole('textbox', { name: /Det nya områdets namn/ });
      await newArea.fill('Digitala färdigheter');
      await importButton.focus();
      await page.keyboard.press('Enter');
      await expect(notices(page).getByText('51 kompetenser lades till i katalogen.')).toBeAttached();
      expect(api.importWrites).toHaveLength(1);
      expect(api.importWrites[0]!.format).toBe('esco');
      expect(api.importWrites[0]!.rows).toHaveLength(51);
      expect(api.importWrites[0]!.rows[0]).toEqual({
        row: 2,
        name: 'färdighet 001',
        area: 'Digitala färdigheter',
        kind: 'skill',
        validityMonths: null,
        uri: uri(1),
      });
      // What was added is the catalogue's now: marked, and the choice is empty.
      await expect(page.getByText('121 rader att välja bland, varav 52 redan finns i katalogen.')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Importera 0' })).toBeFocused();
      await expect(page.getByText('Senaste importen: 51 kompetenser lades till i katalogen.')).toBeVisible();
      await expectNoAxeViolations(page);
    });
    test("Clew's own file: its rows with their area, kind and validity, and what cannot be read listed with its row", async ({
      page,
      api,
    }) => {
      api.admin = true;
      api.competenceTypes = competenceCatalogue();
      await open(page, IMPORT);
      await upload(page, clewFile);
      await expect(
        page.getByText('Clews format: 3 rader att välja bland, 1 kan inte läsas in.', { exact: true }).first(),
      ).toBeVisible();
      const problems = page.getByRole('list', { name: 'Det som inte kan läsas in' });
      await expect(problems.getByRole('listitem')).toHaveText(['Rad 5: En färdighet har ingen giltighetstid.']);
      await expect(page.getByText('1 rad kan inte läsas in')).toBeVisible();
      // No ESCO acknowledgement and no area to choose for Clew's own format.
      await expect(page.getByText('ESCO-klassificeringen', { exact: false })).toHaveCount(0);
      await expect(page.getByRole('combobox', { name: /Område/ })).toHaveCount(0);
      const table = page.getByRole('table', { name: 'Raderna i filen' });
      for (const name of ['Rad', 'Namn', 'Område', 'Typ', 'Giltighet', 'I katalogen'])
        await expect(table.getByRole('columnheader', { name, exact: true })).toBeVisible();
      await expect(table.getByRole('row', { name: /Arbete på väg/ })).toContainText('60 månader');
      await expect(table.getByRole('row', { name: /Truckkort/ })).toContainText('Certifikat');
      await expect(table.getByRole('row', { name: /Heta arbeten/ }).getByText('Finns redan')).toBeVisible();
      await page.getByRole('button', { name: 'Välj alla 2' }).click();
      await page.getByRole('button', { name: 'Importera 2' }).click();
      await expect(notices(page).getByText('2 kompetenser lades till i katalogen.')).toBeAttached();
      expect(api.importWrites[0]).toEqual({
        format: 'clew',
        rows: [
          { row: 2, name: 'Arbete på väg', area: 'Säkerhet', kind: 'certificate', validityMonths: 60, uri: null },
          {
            row: 3,
            name: 'Truckkort',
            area: 'Fordon',
            kind: 'certificate',
            validityMonths: null,
            uri: 'https://example.org/truck',
          },
        ],
      });
    });
    test('a file that is neither format is refused as a whole and nothing can be imported; the server’s refusal is said', async ({
      page,
      api,
    }) => {
      api.admin = true;
      api.competenceTypes = competenceCatalogue();
      await open(page, IMPORT);
      await upload(page, 'förnamn,efternamn\nAnna,Andersson');
      await expect(page.getByText('Filen kan inte läsas in', { exact: true })).toBeVisible();
      await expect
        .poll(() => announcements(page))
        .toContainEqual(expect.stringContaining('Filen kan inte läsas in. Felen står under fältet.'));
      await expect(page.getByRole('table', { name: 'Raderna i filen' })).toHaveCount(0);
      await expectNoAxeViolations(page);
      // A file that holds, and a server that refuses its part: said on the page, nothing reported as added.
      await upload(page, clewFile);
      api.importFail = 'Rad 2: Namn saknas.';
      await page.getByRole('button', { name: 'Välj alla 2' }).click();
      await page.getByRole('button', { name: 'Importera 2' }).click();
      await expect(page.getByText('Rad 2: Namn saknas.')).toBeVisible();
      await expect(
        page.getByText('Ingenting sparades. Försök igen: det som redan finns hoppas över.', { exact: true }),
      ).toBeVisible();
      expect(api.importWrites).toEqual([]);
    });
    test('a choice larger than a part goes in parts, and a part refused says which rows, and that the parts before are saved', async ({
      page,
      api,
    }) => {
      api.admin = true;
      api.competenceTypes = competenceCatalogue();
      await open(page, IMPORT);
      // CR CR LF line ends, as a converted file has them: the rows are numbered by record all the same.
      await upload(page, escoFile(2500).replace(/\r\n/g, '\r\r\n'));
      await expect(
        page.getByText('ESCO:s färdigheter: 2 501 rader att välja bland.', { exact: true }).first(),
      ).toBeVisible();
      await page.getByRole('button', { name: 'Välj alla 2 500' }).click();
      await page.getByRole('combobox', { name: /Område/ }).click();
      await page.getByRole('option', { name: 'Säkerhet' }).click();
      api.importFail = 'Rad 1002: Namn saknas.';
      api.importFailAfter = 1;
      await page.getByRole('button', { name: 'Importera 2 500' }).click();
      const refusal = page.getByText('Rad 1002: Namn saknas.', { exact: true });
      await expect(refusal).toBeVisible();
      await expect(
        page.getByText(
          'Del 2 av 3, rad 1002–2001 i filen, sparades inte. De 1 000 valda raderna i delarna före den är sparade. Försök igen: det som redan finns hoppas över.',
          { exact: true },
        ),
      ).toBeVisible();
      // The first part is saved and its rows are marked; sent again, it is skipped.
      expect(api.importWrites).toHaveLength(1);
      expect(api.importWrites[0]!.rows.at(-1)!.row).toBe(1001);
      await expect(page.getByText('2 501 rader att välja bland, varav 1 001 redan finns i katalogen.')).toBeVisible();
      await expectNoAxeViolations(page);
    });
  });

  test.describe('phone', () => {
    test.use({ viewport: phone });
    test('the rows are a list of checkboxes, a page at a time, with the page chosen at once', async ({ page, api }) => {
      api.admin = true;
      api.competenceTypes = competenceCatalogue();
      await open(page, IMPORT);
      await upload(page, escoFile(60));
      const list = page.getByRole('group', { name: 'Raderna på sidan' });
      await expect(list.getByRole('checkbox', { name: 'färdighet 001' })).toBeVisible();
      await expect(list.getByRole('checkbox', { name: 'färdighet 051' })).toHaveCount(0);
      await page.getByRole('button', { name: 'Välj alla på sidan' }).click();
      await expect(page.getByRole('toolbar', { name: 'Valda rader' })).toContainText('50 valda');
      await expect(list.getByRole('checkbox', { name: 'färdighet 001' })).toBeChecked();
      await expectNoAxeViolations(page);
    });
  });

  test.describe('1.4.10 reflow', () => {
    test('the page, a read file and its rows reflow at 320 px', async ({ page, api }) => {
      api.admin = true;
      api.competenceTypes = competenceCatalogue();
      await page.setViewportSize(narrow);
      await open(page, IMPORT);
      await expect(page.getByRole('heading', { level: 1, name: 'Importera kompetenser' })).toBeVisible();
      expect(await reflowProblems(page)).toEqual([]);
      await upload(page, escoFile(60));
      await expect(page.getByRole('group', { name: 'Raderna på sidan' })).toBeVisible();
      expect(await reflowProblems(page)).toEqual([]);
    });
  });
});
