import type { Page } from '@playwright/test';
import { competenceTypes, searchHolders, withSkills } from './competence';
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
  type MockApi,
} from './support';

/**
 * Kompetenssökning (D121) at `/competence/search`: who in the organisation holds a competence, for a reader who holds the
 * relation `registrar` by grant. The type field asks the catalogue on the server as the reader types; a skill adds a
 * least level; a unit narrows to its branch. What is searched for travels in the request body and never in the address,
 * which holds the page; the count is a status read out when it changes; a step to another page brings the head of the
 * result into view and leaves the focus on the pager; a name opens that person's holdings on their own page, and Back
 * returns to the search as it was. The whole result downloads as a file. Anyone without the relation is told so, and the
 * place's tabs offer the search only to the relation's holder. Keyboard, structure, announcements, axe and reflow at
 * desktop, phone and 320 px.
 */
const SEARCH = '/competence/search';
const heading = (page: Page) => page.getByRole('heading', { level: 1, name: 'Kompetenssökning' });
const form = (page: Page) => page.getByRole('search', { name: 'Sök vem som har en kompetens' });
const typeField = (page: Page) => form(page).getByRole('combobox', { name: 'Kompetens' });
const readout = (page: Page) => page.getByRole('status').filter({ hasText: / med / });
const pager = (page: Page) => page.getByRole('navigation', { name: 'Sidor i sökresultatet' });
const tabs = (page: Page) => page.getByRole('navigation', { name: 'Kompetens', exact: true });
const registrar = (api: MockApi, many = false) => {
  api.competenceTypes = withSkills();
  api.relations = ['registrar'];
  api.employee = true;
  api.competenceSearch = searchHolders(many);
};
/**
 * Types words into the type field from the keyboard and takes the one result they find, once the server's answer for
 * them has replaced what the field showed on focus.
 */
async function chooseType(page: Page, words: string, name: string) {
  await typeField(page).focus();
  await page.keyboard.type(words);
  await expect(page.getByRole('option')).toHaveText([new RegExp(name)]);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
}

test.describe('Kompetens › Kompetenssökning', () => {
  for (const [layout, viewport] of [
    ['desktop', desktop],
    ['phone', phone],
  ] as const)
    test.describe(layout, () => {
      test.use({ viewport });
      test('a type is found from the keyboard, the result is said aloud, and the search never enters the address', async ({
        page,
        api,
      }) => {
        registrar(api);
        await open(page, SEARCH);
        await expect(heading(page)).toBeVisible();
        // Before a type is chosen the page says what it does, and that every read is logged.
        await expect(page.getByRole('heading', { level: 2, name: 'Välj en kompetens' })).toBeVisible();
        await expect(page.getByText('Varje sökning, nedladdning och öppnad person loggas')).toBeVisible();
        await expectNoAxeViolations(page);
        await chooseType(page, 'hl', 'HLR');
        await expect(readout(page)).toHaveText('3 personer med HLR');
        await expect.poll(() => announcements(page)).toContainEqual('3 personer med HLR');
        // In the body, never the address (D100 item 5): the type searched for is no log line's business.
        expect(api.searchBodies).toEqual([{ typeId: 't-hlr', page: 1, pageSize: 25 }]);
        await expect(page).toHaveURL(/\/competence\/search$/);
        // Each row says the person, where they are placed, where it stands in words and until when.
        const result =
          layout === 'desktop' ? page.getByRole('table') : page.getByRole('list', { name: 'Personer med HLR' });
        await expect(result).toContainText('Anna Lindqvist');
        await expect(result).toContainText('Går ut snart');
        await expect(result).toContainText('Utgånget');
        await expect(result).toContainText('Hemtjänst Centrum, Bergsåkers skola');
        // Someone without a user name has no page, so their name is text and no link.
        await expect(page.getByRole('link', { name: 'Bo Ek' })).toHaveCount(0);
        await expect(page.getByRole('link', { name: 'Anna Lindqvist' })).toBeVisible();
        await expectNoAxeViolations(page);
        const { unmarked } = await hiddenFocusStops(page);
        expect(unmarked).toEqual([]);
      });
      test('a name opens the person’s holdings on their page, and Back finds the search as it was', async ({
        page,
        api,
      }) => {
        registrar(api);
        await open(page, SEARCH);
        await chooseType(page, 'hlr', 'HLR');
        await expect(readout(page)).toHaveText('3 personer med HLR');
        const anna = page.getByRole('link', { name: 'Anna Lindqvist' });
        await anna.focus();
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL(/\/tools\/competence\.holdings\?/);
        const address = new URL(page.url());
        expect(JSON.parse(address.searchParams.get('input')!)).toEqual({ person: 'anna.lindqvist' });
        expect(address.searchParams.get('from')).toBe(SEARCH);
        await expect(page.getByRole('heading', { level: 1, name: 'Kompetenser för Anna Lindqvist' })).toBeVisible();
        // The way back names the search.
        await expect(page.getByRole('link', { name: 'Kompetenssökning' })).toBeVisible();
        await page.goBack();
        await expect(heading(page)).toBeVisible();
        await expect(form(page)).toContainText('HLR');
        await expect(readout(page)).toHaveText('3 personer med HLR');
      });
      test('a skill asks for a least level, and the person’s own rating is said beside the level', async ({
        page,
        api,
      }) => {
        registrar(api);
        await open(page, SEARCH);
        await expect(form(page).getByRole('combobox', { name: 'Lägsta nivå' })).toHaveCount(0);
        await chooseType(page, 'eng', 'Engelska');
        await expect(readout(page)).toHaveText('2 personer med Engelska');
        await expect(page.getByText('Egen bedömning', { exact: true })).toBeVisible();
        const level = form(page).getByRole('combobox', { name: 'Lägsta nivå' });
        await level.focus();
        await page.keyboard.press('Enter');
        await page.getByRole('option', { name: 'Expert', exact: true }).click();
        await expect(readout(page)).toHaveText('1 person med Engelska');
        expect(api.searchBodies.at(-1)).toEqual({ typeId: 't-eng', minLevel: 3, page: 1, pageSize: 25 });
        await expectNoAxeViolations(page);
      });
      test('the result downloads as a file asked for in a body, and a type nobody holds says so', async ({
        page,
        api,
      }) => {
        registrar(api);
        await open(page, SEARCH);
        await chooseType(page, 'hlr', 'HLR');
        const download = page.waitForEvent('download');
        await page.getByRole('button', { name: 'Ladda ner som CSV' }).click();
        expect((await download).suggestedFilename()).toBe('kompetenssokning-2026-11-04.csv');
        expect(api.searchFiles).toEqual([{ typeId: 't-hlr' }]);
        await expect
          .poll(() => announcements(page))
          .toContainEqual(expect.stringContaining('kompetenssokning-2026-11-04.csv är nedladdad'));
        await typeField(page).fill('');
        await chooseType(page, 'heta', 'Heta arbeten');
        await expect(page.getByRole('heading', { level: 2, name: 'Ingen har den kompetensen' })).toBeVisible();
        await expect(readout(page)).toHaveText('0 personer med Heta arbeten');
        await expect(page.getByRole('button', { name: 'Ladda ner som CSV' })).toHaveCount(0);
        await expectNoAxeViolations(page);
      });
      test('a search that cannot be made says so where the result would be, with Försök igen', async ({
        page,
        api,
      }) => {
        registrar(api);
        api.searchFails = true;
        await open(page, SEARCH);
        await chooseType(page, 'hlr', 'HLR');
        await expect(page.getByRole('alert').filter({ hasText: 'Något gick fel. Försök igen.' })).toBeVisible();
        api.searchFails = false;
        await page.getByRole('button', { name: 'Försök igen' }).click();
        await expect(readout(page)).toHaveText('3 personer med HLR');
      });
      test('without the relation the page says so, and the place offers no search', async ({ page, api }) => {
        api.competenceTypes = competenceTypes();
        api.employee = true;
        await open(page, SEARCH);
        await expect(
          page.getByRole('heading', { level: 2, name: 'Kompetenssökning visas inte för dig' }),
        ).toBeVisible();
        await expect(
          page.getByRole('main').getByText('Kompetenssökning är inte tilldelad dig.', { exact: false }).first(),
        ).toBeVisible();
        await expect(form(page)).toHaveCount(0);
        await expect(tabs(page)).toHaveCount(0);
        expect(api.searchBodies).toEqual([]);
        await expectNoAxeViolations(page);
        // The reader's own page has no tab to it either.
        await open(page, '/competence');
        await expect(page.getByRole('heading', { level: 1, name: 'Mina kompetenser' })).toBeVisible();
        await expect(tabs(page)).toHaveCount(0);
      });
    });

  test.describe('desktop', () => {
    test.use({ viewport: desktop });
    test('a step to another page is in the address, brings the head into view, keeps the focus on the pager and is said', async ({
      page,
      api,
    }) => {
      registrar(api, true);
      await open(page, SEARCH);
      await chooseType(page, 'hlr', 'HLR');
      await expect(readout(page)).toHaveText('63 personer med HLR');
      const next = pager(page).getByRole('button', { name: 'Gå till nästa sida' });
      await next.focus();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(/\/competence\/search\?page=2$/);
      await expect(next).toBeFocused();
      await expect(page.getByRole('table').locator('tbody tr').first()).toContainText('Person 23');
      await expect(readout(page)).toBeInViewport();
      expect(api.searchBodies.at(-1)).toEqual({ typeId: 't-hlr', page: 2, pageSize: 25 });
      // The table says each row's place among all the people (D100 item 7).
      await expect(page.getByRole('table')).toHaveAttribute('aria-rowcount', /6[34]/);
      // Back undoes the step; a unit narrows to its branch and starts again from the first page.
      await page.goBack();
      await expect(page).toHaveURL(/\/competence\/search$/);
      const unit = form(page).getByRole('button', { name: /^Enhet/ });
      await unit.focus();
      await page.keyboard.press('Enter');
      await page.getByRole('option', { name: /Bergsåkers skola/ }).click();
      await expect(readout(page)).toHaveText('2 personer med HLR');
      expect(api.searchBodies.at(-1)).toEqual({ typeId: 't-hlr', unitId: 'unit-skola', page: 1, pageSize: 25 });
      await expectNoAxeViolations(page);
    });
    test('a registrar who manages people too has the place’s three pages as tabs, this one current', async ({
      page,
      api,
    }) => {
      registrar(api);
      api.employee = false;
      await open(page, SEARCH);
      await expect(tabs(page).getByRole('link')).toHaveCount(3);
      for (const name of ['Mina kompetenser', 'Medarbetare', 'Kompetenssökning'])
        await expect(tabs(page).getByRole('link', { name })).toBeVisible();
      await expect(tabs(page).getByRole('link', { name: 'Kompetenssökning' })).toHaveAttribute('aria-current', 'true');
      await tabs(page).getByRole('link', { name: 'Mina kompetenser' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Mina kompetenser' })).toBeVisible();
      await expect(tabs(page).getByRole('link', { name: 'Kompetenssökning' })).toBeVisible();
      // A registrar is shown the Kompetens place, never Administration: the relation is no capability (D118).
      await expect(page.getByRole('link', { name: 'Administration' })).toHaveCount(0);
    });
  });

  test.describe('1.4.10 reflow', () => {
    test('the page reflows at 320 px with a result and its pager', async ({ page, api }) => {
      registrar(api, true);
      await page.setViewportSize(narrow);
      await open(page, SEARCH);
      await chooseType(page, 'eng', 'Engelska');
      await expect(page.getByRole('list', { name: 'Personer med Engelska' })).toBeVisible();
      expect(await reflowProblems(page)).toEqual([]);
      await typeField(page).fill('');
      await chooseType(page, 'hlr', 'HLR');
      await expect(pager(page)).toContainText('Sida 1 av 3');
      expect(await reflowProblems(page)).toEqual([]);
      await expectNoAxeViolations(page);
    });
  });
});
