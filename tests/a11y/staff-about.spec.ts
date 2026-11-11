import { aboutResult } from './about';
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
 * Personal with what the sources say about its people (D97 items 2 and 5): a mark under Behöver dig on the row of a
 * person a source gives a warning or an alert, with the source as the way into its own view of that person, which opens
 * in the panel over the list and is named in the address. The mock's source is the competence module: Anna has a
 * certificate that has run out, Erik one that runs out soon, Lena stands well, the others hold nothing. Keyboard,
 * focus, structure, axe and reflow, at desktop, phone and 320 px.
 */
test.describe('Personal: what needs the manager', () => {
  test.describe('desktop', () => {
    test.use({ viewport: desktop });
    test('a person a source warns about has a mark with the status and the source; the others have none', async ({
      page,
      api,
    }) => {
      api.about = aboutResult();
      await open(page, '/staff');
      const school = page.getByRole('table').first();
      await expect(school.getByRole('columnheader', { name: 'Behöver dig' })).toBeVisible();
      const anna = school.getByRole('row', { name: /Anna Lindqvist/ });
      await expect(anna.getByText('utgånget', { exact: true })).toBeVisible();
      await expect(anna.getByRole('link', { name: 'Kompetens för Anna Lindqvist: utgånget' })).toBeVisible();
      const erik = school.getByRole('row', { name: /Erik Nyström/ });
      await expect(erik.getByText('går ut snart', { exact: true })).toBeVisible();
      await expect(erik.getByRole('link', { name: 'Kompetens för Erik Nyström: går ut snart' })).toBeVisible();
      // Sara holds nothing and Lena stands well: no mark, and no badge that says so.
      await expect(page.getByRole('link', { name: /^Kompetens för/ })).toHaveCount(2);
      await expect(page.getByText('giltigt', { exact: true })).toHaveCount(0);
      await expectNoAxeViolations(page);
      const { unmarked } = await hiddenFocusStops(page);
      expect(unmarked).toEqual([]);
    });
    test('the mark opens the source’s view of the person over the list, by keyboard, and closing gives the focus back', async ({
      page,
      api,
    }) => {
      api.about = aboutResult();
      await open(page, '/staff');
      const mark = page.getByRole('link', { name: 'Kompetens för Anna Lindqvist: utgånget' });
      await mark.focus();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(/\/staff\?open=competence\.holdings/);
      expect(new URL(page.url()).searchParams.get('open-input')).toBe('{"person":"anna.lindqvist"}');
      const panel = page.getByRole('dialog', { name: 'Kompetenser' });
      await expect(panel).toBeVisible();
      await expect(panel.getByText('Heta arbeten')).toBeVisible();
      await expect(panel.getByText('utgånget', { exact: true })).toBeVisible();
      await expect(panel.getByText('Socionomexamen')).toBeVisible();
      await expectNoAxeViolations(page);
      await page.keyboard.press('Escape');
      await expect(panel).toBeHidden();
      await expect(page).toHaveURL(/\/staff$/);
      await expect(mark).toBeFocused();
      // The list is still the page under it.
      await expect(page.getByRole('heading', { level: 1, name: 'Personal' })).toBeVisible();
    });
    test('the address alone opens the view over the list, as a reload or a link does', async ({ page, api }) => {
      api.about = aboutResult();
      await open(
        page,
        '/staff?open=competence.holdings&open-title=Kompetenser&open-input=' +
          encodeURIComponent('{"person":"anna.lindqvist"}'),
      );
      await expect(page.getByRole('dialog', { name: 'Kompetenser' }).getByText('Heta arbeten')).toBeVisible();
      await expect(page.getByRole('heading', { level: 1, name: 'Personal' })).toBeAttached();
    });
    test('with no source about people the page is as it was: no column and no error', async ({ page, api }) => {
      expect(api.about).toBeNull();
      await open(page, '/staff');
      await expect(page.getByText('Anna Lindqvist')).toBeVisible();
      await expect(page.getByRole('columnheader', { name: 'Behöver dig' })).toHaveCount(0);
      await expect(page.getByRole('alert')).toHaveCount(0);
    });
    test('a read that fails says so and the list stays; a source that did not answer is named once', async ({
      page,
      api,
    }) => {
      api.about = aboutResult();
      api.aboutFail = true;
      await open(page, '/staff');
      await expect(page.getByRole('alert').filter({ hasText: 'Källorna svarar inte just nu.' })).toBeVisible();
      await expect(page.getByText('Anna Lindqvist')).toBeVisible();
      const silent = aboutResult();
      silent.sections[0] = { ...silent.sections[0]!, status: 'timeout', rows: [] };
      api.about = silent;
      await page.reload();
      await expect(
        page
          .getByRole('status')
          .filter({ hasText: 'Kompetens svarade inte, så listan kan sakna markeringar därifrån.' }),
      ).toBeVisible();
      await expect(page.getByRole('link', { name: /^Kompetens för/ })).toHaveCount(0);
      await expectNoAxeViolations(page);
    });
  });
  test.describe('phone', () => {
    test.use({ viewport: phone });
    test('the mark is on the person’s row in the list, and opens the view as a sheet over it', async ({
      page,
      api,
    }) => {
      api.about = aboutResult();
      await open(page, '/staff');
      const list = page.getByRole('list', { name: 'Skönsmons skola' });
      const mark = list.getByRole('link', { name: 'Kompetens för Anna Lindqvist: utgånget' });
      await expect(mark).toBeVisible();
      await expectNoAxeViolations(page);
      const { unmarked } = await hiddenFocusStops(page);
      expect(unmarked).toEqual([]);
      await mark.click();
      const panel = page.getByRole('dialog', { name: 'Kompetenser' });
      await expect(panel.getByText('Heta arbeten')).toBeVisible();
      await expectNoAxeViolations(page);
    });
  });
  test.describe('1.4.10 reflow', () => {
    test('the marks and the opened view reflow at 320 px', async ({ page, api }) => {
      api.about = aboutResult();
      await page.setViewportSize(narrow);
      await open(page, '/staff');
      await expect(page.getByRole('link', { name: 'Kompetens för Anna Lindqvist: utgånget' })).toBeVisible();
      expect(await reflowProblems(page)).toEqual([]);
      await page.getByRole('link', { name: 'Kompetens för Anna Lindqvist: utgånget' }).click();
      await expect(page.getByRole('dialog', { name: 'Kompetenser' }).getByText('Heta arbeten')).toBeVisible();
      expect(await reflowProblems(page)).toEqual([]);
    });
  });
});
