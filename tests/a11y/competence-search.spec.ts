import type { Page } from '@playwright/test';
import { competenceTypes, searchHolders, withSkills } from './competence';
import { NOW } from './data';
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
 * Kompetenssökning (D121) at `/competence/search`: who in the organisation holds every one of up to five competences,
 * for a reader who holds the relation `registrar` by grant. The type field (Astryx's Tokenizer) asks the catalogue on
 * the server as the reader types; a skill adds a least level, last, so nothing moves for it; a unit narrows to its
 * branch; a status and a validity window filter the types that can end. The whole search is in the address, by ids and
 * codes, so a reload or a link reads it again (and that read is logged) and Back undoes each change; a removed token is
 * one such step. The result is sorted on the server by Astryx's sortable headers, or "Sortera" where the rows are a
 * list; the count is a status read out when it changes, on a line of its own; a step to another page brings the head of
 * the search into view and leaves the focus on the pager; a name opens the person and the row's own link ("Kompetenser")
 * their holdings on the read's page, and Back returns to the search as it was. The file holds what the screen shows and says how many rows. Anyone without the
 * relation is told so, even from a link, and nothing is searched. Keyboard, structure, announcements, axe and reflow at
 * desktop, phone and 320 px.
 */
const SEARCH = '/competence/search';
const heading = (page: Page) => page.getByRole('heading', { level: 1, name: 'Kompetenssökning' });
const form = (page: Page) => page.getByRole('search', { name: 'Sök vem som har en kompetens' });
const typeField = (page: Page) => form(page).getByRole('combobox', { name: 'Kompetens' });
/** The count, a status that begins with a number; not Astryx's live region, which mirrors an empty state's text. */
const readout = (page: Page) =>
  page.getByRole('status').filter({ hasText: /^\d[\d\s\u00a0\u202f]*( av \d[\d\s\u00a0\u202f]*)? person(er)? med / });
const pager = (page: Page) => page.getByRole('navigation', { name: 'Sidor i sökresultatet' });
const tabs = (page: Page) => page.getByRole('navigation', { name: 'Kompetens', exact: true });
const registrar = (api: MockApi, many = false) => {
  api.competenceTypes = withSkills();
  api.relations = ['registrar'];
  api.employee = true;
  api.competenceSearch = searchHolders(many);
  // The person a hit opens, as the directory names them to a colleague: their page's own lookup.
  api.entityDetailOf = key =>
    key === 'anna.lindqvist'
      ? {
          entity: { kind: 'person', key, name: 'Anna Lindqvist' },
          relation: 'colleague',
          actions: [],
          sections: [],
          cards: [],
        }
      : undefined;
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
/** Takes an order from "Sortera", which stands beside the file's button, not among the fields. */
async function sortBy(page: Page, option: string) {
  await page.getByRole('main').getByRole('combobox', { name: 'Sortera' }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('option', { name: option }).click();
}
/** Opens a selector of the search from the keyboard and takes the option. */
async function choose(page: Page, field: RegExp, option: RegExp | string) {
  const trigger = form(page)
    .getByRole('combobox', { name: field })
    .or(form(page).getByRole('button', { name: field }));
  await trigger.first().focus();
  await page.keyboard.press('Enter');
  await page.getByRole('option', { name: option }).click();
}

test.describe('Kompetens › Kompetenssökning', () => {
  for (const [layout, viewport] of [
    ['desktop', desktop],
    ['phone', phone],
  ] as const)
    test.describe(layout, () => {
      test.use({ viewport });
      test('a type is found from the keyboard, the result is said aloud, and the search is the address', async ({
        page,
        api,
      }) => {
        registrar(api);
        await open(page, SEARCH);
        await expect(heading(page)).toBeVisible();
        // Before a type is chosen the page says what it does, and that every read is logged, from a link too.
        await expect(page.getByRole('heading', { level: 2, name: 'Välj en kompetens' })).toBeVisible();
        await expect(page.getByText('Varje sökning, nedladdning och öppnad person loggas')).toBeVisible();
        await expect(page.getByText('också när en sökning öppnas från en länk eller laddas om')).toBeVisible();
        const card = (await page
          .locator('.astryx-card')
          .filter({ has: form(page) })
          .boundingBox())!;
        const fields = (await form(page).boundingBox())!;
        // The card's own padding is all that stands above the fields.
        expect(fields.y - card.y).toBeLessThanOrEqual(16);
        const unit = form(page).getByRole('button', { name: /^Enhet/ });
        const field = (await unit.boundingBox())!;
        await expectNoAxeViolations(page);
        await chooseType(page, 'hl', 'HLR');
        await expect(readout(page)).toHaveText('3 personer med HLR');
        // The fields have not moved for it: the count came in under them, on a line of its own.
        const now = (await unit.boundingBox())!;
        expect([now.x, now.y]).toEqual([field.x, field.y]);
        expect((await readout(page).boundingBox())!.y).toBeGreaterThan(fields.y + fields.height - 1);
        await expect.poll(() => announcements(page)).toContainEqual('3 personer med HLR');
        // Asked in a body, once, and named in the address by its id alone, never its name.
        expect(api.searchBodies).toEqual([{ typeIds: ['t-hlr'], page: 1, pageSize: 25 }]);
        await expect(page).toHaveURL(/\/competence\/search\?type=t-hlr$/);
        expect(page.url()).not.toContain('HLR');
        // Each row says the person, where they are placed, where it stands in words and until when.
        const result =
          layout === 'desktop' ? page.getByRole('table') : page.getByRole('list', { name: 'Personer med HLR' });
        await expect(result).toContainText('Anna Lindqvist');
        await expect(result).toContainText('Går ut snart');
        await expect(result).toContainText('Utgånget');
        await expect(result).toContainText('Hemtjänst Centrum, Bergsåkers skola');
        // Someone without a user name has no page, so their name is text and no link.
        await expect(page.getByRole('link', { name: 'Bo Ek', exact: true })).toHaveCount(0);
        await expect(page.getByRole('link', { name: 'Anna Lindqvist', exact: true })).toBeVisible();
        await expectNoAxeViolations(page);
        const { unmarked } = await hiddenFocusStops(page);
        expect(unmarked).toEqual([]);
      });
      test('a name opens the person, the row’s own link their holdings, and Back finds the search as it was, read once', async ({
        page,
        api,
      }) => {
        registrar(api);
        await open(page, SEARCH);
        await chooseType(page, 'hlr', 'HLR');
        await expect(readout(page)).toHaveText('3 personer med HLR');
        // The holdings are the row's own link, named for the read and the person; someone without a user name has none.
        await expect(page.getByRole('link', { name: 'Kompetenser för Bo Ek' })).toHaveCount(0);
        const holdings = page.getByRole('link', { name: 'Kompetenser för Anna Lindqvist' });
        await expect(holdings).toHaveText('Kompetenser');
        await holdings.focus();
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL(/\/tools\/competence\.holdings\?/);
        const address = new URL(page.url());
        expect(JSON.parse(address.searchParams.get('input')!)).toEqual({ person: 'anna.lindqvist' });
        expect(address.searchParams.get('from')).toBe(`${SEARCH}?type=t-hlr`);
        // No name rides in the address: the page names her from the directory, as her own page does.
        expect(address.searchParams.has('title')).toBe(false);
        expect(page.url()).not.toContain('Lindqvist');
        await expect(page.getByRole('heading', { level: 1, name: 'Kompetenser för Anna Lindqvist' })).toBeVisible();
        await expect(page.getByRole('link', { name: 'Kompetenssökning' })).toBeVisible();
        await page.goBack();
        await expect(heading(page)).toBeVisible();
        await expect(form(page)).toContainText('HLR');
        await expect(readout(page)).toHaveText('3 personer med HLR');
        // What was read a moment ago is shown as it was read: no second read, so no second row of the log.
        expect(api.searchBodies).toHaveLength(1);
        // The name opens the person, as a name does on every list, with the search as the way back.
        await page.getByRole('link', { name: 'Anna Lindqvist', exact: true }).click();
        await expect(page).toHaveURL(/\/people\/anna\.lindqvist\?/);
        expect(new URL(page.url()).searchParams.get('from')).toBe(`${SEARCH}?type=t-hlr`);
        await page.goBack();
        await expect(readout(page)).toHaveText('3 personer med HLR');
        expect(api.searchBodies).toHaveLength(1);
      });
      test('a skill asks for a least level, last among the fields, so the unit stays where it was', async ({
        page,
        api,
      }) => {
        registrar(api);
        await open(page, SEARCH);
        await expect(form(page).getByRole('combobox', { name: 'Lägsta nivå' })).toHaveCount(0);
        const unit = form(page).getByRole('button', { name: /^Enhet/ });
        const before = (await unit.boundingBox())!;
        await chooseType(page, 'eng', 'Engelska');
        await expect(readout(page)).toHaveText('2 personer med Engelska');
        await expect(page.getByText('Egen bedömning', { exact: true })).toBeVisible();
        const level = form(page).getByRole('combobox', { name: 'Lägsta nivå' });
        await expect(level).toBeVisible();
        const after = (await unit.boundingBox())!;
        expect([after.x, after.y]).toEqual([before.x, before.y]);
        // A skill never ends: the status and the window stay where they are, disabled with the reason.
        await expect(
          form(page)
            .getByRole('combobox', { name: /^Status/ })
            .or(form(page).getByRole('button', { name: /^Status/ }))
            .first(),
        ).toHaveAttribute('aria-disabled', 'true');
        await level.focus();
        await page.keyboard.press('Enter');
        await page.getByRole('option', { name: 'Expert', exact: true }).click();
        await expect(readout(page)).toHaveText('1 person med Engelska, minst expert');
        expect(api.searchBodies.at(-1)).toEqual({ typeIds: ['t-eng'], minLevel: 3, page: 1, pageSize: 25 });
        await expect(page).toHaveURL(/\?type=t-eng&level=3$/);
        await expectNoAxeViolations(page);
      });
      test('the file holds what the screen shows and says how many rows; a type nobody holds says so', async ({
        page,
        api,
      }) => {
        registrar(api);
        await open(page, SEARCH);
        await chooseType(page, 'hlr', 'HLR');
        const download = page.waitForEvent('download');
        await page.getByRole('button', { name: 'Ladda ner 3 rader som CSV' }).click();
        expect((await download).suggestedFilename()).toBe('kompetenssokning-2026-11-04.csv');
        expect(api.searchFiles).toEqual([{ typeIds: ['t-hlr'] }]);
        await expect
          .poll(() => announcements(page))
          .toContainEqual(expect.stringContaining('kompetenssokning-2026-11-04.csv är hämtad'));
        // The same filter and order as the screen.
        await choose(page, /^Status/, 'Utgånget');
        await page.keyboard.press('Escape');
        await expect(readout(page)).toHaveText('1 av 3 personer med HLR, status utgånget');
        await page.getByRole('button', { name: 'Ladda ner 1 rad som CSV' }).click();
        await expect.poll(() => api.searchFiles.length).toBe(2);
        expect(api.searchFiles.at(-1)).toEqual({ typeIds: ['t-hlr'], status: ['expired'] });
        await open(page, `${SEARCH}?type=t-heta`);
        await expect(page.getByRole('heading', { level: 2, name: 'Ingen har den kompetensen' })).toBeVisible();
        await expect(page.getByText('Ingen i organisationen har den registrerad.', { exact: true })).toBeVisible();
        await expect(readout(page)).toHaveText('0 personer med Heta arbeten');
        await expect(page.getByRole('button', { name: /^Ladda ner/ })).toHaveCount(0);
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
      test('without the relation the page says so, from a link too, and nothing is searched or named', async ({
        page,
        api,
      }) => {
        api.competenceTypes = competenceTypes();
        api.employee = true;
        await open(page, `${SEARCH}?type=t-hlr&status=expired`);
        await expect(
          page.getByRole('heading', { level: 2, name: 'Kompetenssökning visas inte för dig' }),
        ).toBeVisible();
        await expect(
          page.getByRole('main').getByText('Kompetenssökning är inte tilldelad dig.', { exact: false }).first(),
        ).toBeVisible();
        await expect(form(page)).toHaveCount(0);
        await expect(tabs(page)).toHaveCount(0);
        expect(api.searchBodies).toEqual([]);
        expect(api.typesNamed).toEqual([]);
        await expectNoAxeViolations(page);
        // The reader's own page has no tab to it either.
        await open(page, '/competence');
        await expect(page.getByRole('heading', { level: 1, name: 'Mina kompetenser' })).toBeVisible();
        await expect(tabs(page)).toHaveCount(0);
      });
    });

  test.describe('desktop', () => {
    test.use({ viewport: desktop });
    test('a step to another page is in the address, brings the fields into view, keeps the focus on the pager and is said', async ({
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
      await expect(page).toHaveURL(/\/competence\/search\?type=t-hlr&page=2$/);
      await expect(next).toBeFocused();
      await expect(page.getByRole('table').locator('tbody tr').first()).toContainText('Person 23');
      // The head of the search, its fields first, is in view, not cut under the top of the page.
      await expect(typeField(page)).toBeInViewport();
      await expect(readout(page)).toBeInViewport();
      expect(api.searchBodies.at(-1)).toEqual({ typeIds: ['t-hlr'], page: 2, pageSize: 25 });
      // The table says each row's place among all the people (D100 item 7).
      await expect(page.getByRole('table')).toHaveAttribute('aria-rowcount', /6[34]/);
      // The page size has a name a screen reader says.
      await expect(pager(page).getByRole('combobox', { name: 'Objekt per sida' })).toBeVisible();
      // Back undoes the step; a unit narrows to its branch and starts again from the first page.
      await page.goBack();
      await expect(page).toHaveURL(/\/competence\/search\?type=t-hlr$/);
      await expect(form(page).getByText('Med enheterna under den.')).toBeVisible();
      await choose(page, /^Enhet/, /Bergsåkers skola/);
      await expect(readout(page)).toHaveText('2 personer med HLR på Bergsåkers skola');
      expect(api.searchBodies.at(-1)).toEqual({ typeIds: ['t-hlr'], unitId: 'unit-skola', page: 1, pageSize: 25 });
      await expect(page).toHaveURL(/\?type=t-hlr&unit=unit-skola$/);
      await expectNoAxeViolations(page);
    });
    test('the headers sort on the server, say their order, and each order is a step Back undoes', async ({
      page,
      api,
    }) => {
      registrar(api);
      await open(page, SEARCH);
      await chooseType(page, 'hlr', 'HLR');
      await expect(readout(page)).toHaveText('3 personer med HLR');
      const name = page.getByRole('columnheader', { name: 'Person' });
      const until = page.getByRole('columnheader', { name: 'Giltigt till' });
      await expect(name).toHaveAttribute('aria-sort', 'ascending');
      await until.getByRole('button').focus();
      await page.keyboard.press('Enter');
      await expect(readout(page)).toHaveText('3 personer med HLR, sorterat tidigast slutdatum först');
      await expect(until).toHaveAttribute('aria-sort', 'ascending');
      await expect(name).not.toHaveAttribute('aria-sort', 'ascending');
      expect(api.searchBodies.at(-1)).toEqual({ typeIds: ['t-hlr'], sort: 'until', page: 1, pageSize: 25 });
      await expect(page.getByRole('table').locator('tbody tr').first()).toContainText('Bo Ek');
      await until.getByRole('button').press('Enter');
      await expect(until).toHaveAttribute('aria-sort', 'descending');
      await expect(page).toHaveURL(/\?type=t-hlr&sort=until&order=desc$/);
      await expect(page.getByRole('table').locator('tbody tr').first()).toContainText('Hassan Ali');
      // One press, one read: three orders, three reads.
      expect(api.searchBodies).toHaveLength(3);
      await page.goBack();
      await expect(until).toHaveAttribute('aria-sort', 'ascending');
      await expect(page).toHaveURL(/\?type=t-hlr&sort=until$/);
      await expectNoAxeViolations(page);
    });
    test('the status and the window filter on the server; an empty result says which to loosen, and Rensa filter returns to the field', async ({
      page,
      api,
    }) => {
      registrar(api);
      await open(page, SEARCH);
      await chooseType(page, 'hlr', 'HLR');
      await choose(page, /^Giltigt till/, 'Inom 90 dagar');
      await expect(readout(page)).toHaveText('1 av 3 personer med HLR, giltigt till inom 90 dagar');
      expect(api.searchBodies.at(-1)).toEqual({ typeIds: ['t-hlr'], until: 90, page: 1, pageSize: 25 });
      await choose(page, /^Status/, 'Giltigt');
      await page.keyboard.press('Escape');
      await expect(page.getByRole('heading', { level: 2, name: 'Ingen matchar filtret' })).toBeVisible();
      await expect(
        page.getByText(
          '3 personer har den, men ingen av dem med vald status och giltighetstid. Ändra Status eller Giltigt till för att se dem.',
          { exact: true },
        ),
      ).toBeVisible();
      await expect(page).toHaveURL(/\?type=t-hlr&status=valid&until=90$/);
      // Back undoes the status alone.
      await page.goBack();
      await expect(readout(page)).toHaveText('1 av 3 personer med HLR, giltigt till inom 90 dagar');
      await page.goForward();
      await page.getByRole('button', { name: 'Rensa filter' }).first().click();
      await expect(readout(page)).toHaveText('3 personer med HLR');
      await expect(page.getByRole('button', { name: 'Rensa filter' })).toHaveCount(0);
      await expect(typeField(page)).toBeFocused();
      await expectNoAxeViolations(page);
    });
    test('several types find who holds them all, one column each; a removed token is one step Back restores without a new read', async ({
      page,
      api,
    }) => {
      registrar(api);
      await open(page, SEARCH);
      await chooseType(page, 'hlr', 'HLR');
      await chooseType(page, 'eng', 'Engelska');
      await expect(readout(page)).toHaveText('2 personer med HLR och Engelska');
      await expect(page).toHaveURL(/\?type=t-hlr,t-eng$/);
      for (const header of ['Person', 'Enhet', 'HLR', 'Engelska'])
        await expect(page.getByRole('columnheader', { name: header })).toBeVisible();
      // The orders that have no column of their own are offered by "Sortera".
      await sortBy(page, 'Utgånget först');
      await expect(readout(page)).toHaveText('2 personer med HLR och Engelska, sorterat utgånget först');
      await expect(page.getByRole('table').locator('tbody tr').first()).toContainText('Anna Lindqvist');
      const reads = api.searchBodies.length;
      // A stray Backspace in the empty field removes the last token: one step, said, and Back brings it back.
      await typeField(page).focus();
      await page.keyboard.press('Backspace');
      await expect(page).toHaveURL(/\?type=t-hlr&sort=status$/);
      await expect(readout(page)).toHaveText('3 personer med HLR, sorterat utgånget först');
      await page.goBack();
      await expect(readout(page)).toHaveText('2 personer med HLR och Engelska, sorterat utgånget först');
      await expect(form(page)).toContainText('Engelska');
      // The search of both was read before: shown as read, with no new row of the log.
      expect(api.searchBodies).toHaveLength(reads + 1);
      await expectNoAxeViolations(page);
    });
    test('a reload or a link reads the search the address names once, its types named before the answer', async ({
      page,
      api,
    }) => {
      registrar(api);
      await open(page, `${SEARCH}?type=t-hlr,t-eng&status=valid&sort=until&order=desc`);
      await expect(readout(page)).toHaveText(
        '1 av 2 personer med HLR och Engelska, status giltigt, sorterat senast slutdatum först',
      );
      await expect(form(page)).toContainText('HLR');
      await expect(form(page)).toContainText('Engelska');
      expect(api.searchBodies).toEqual([
        { typeIds: ['t-hlr', 't-eng'], status: ['valid'], sort: 'until', order: 'desc', page: 1, pageSize: 25 },
      ]);
      await page.reload();
      await expect(readout(page)).toHaveText(
        '1 av 2 personer med HLR och Engelska, status giltigt, sorterat senast slutdatum först',
      );
      // A reload is a read like any other, and is logged: one more, no more.
      expect(api.searchBodies).toHaveLength(2);
    });
    test('an address the catalogue cannot meet says so, asks nothing it cannot, and offers the way out', async ({
      page,
      api,
    }) => {
      registrar(api);
      await open(page, `${SEARCH}?type=t-hlr,t-borta`);
      await expect(page.getByRole('alert').filter({ hasText: 'Kompetensen finns inte i katalogen.' })).toBeVisible();
      // The field names the type it knows and leaves out the one it does not.
      await expect(form(page)).toContainText('HLR');
      expect(api.searchBodies).toEqual([]);
      await page.getByRole('button', { name: 'Sök utan den' }).click();
      await expect(readout(page)).toHaveText('3 personer med HLR');
      await expect(page).toHaveURL(/\?type=t-hlr$/);
      // More types than one search takes, or an id that is no id: said, and nothing asked.
      await open(page, `${SEARCH}?type=a,b,c,d,e,f`);
      await expect(page.getByRole('alert').filter({ hasText: 'fler än 5 kompetenser' })).toBeVisible();
      await open(page, `${SEARCH}?type=t-hlr&unit=u%0A1`);
      await expect(
        page.getByRole('alert').filter({ hasText: 'Adressen anger en enhet som inte finns.' }),
      ).toBeVisible();
      expect(api.searchBodies).toHaveLength(1);
      await page.getByRole('button', { name: 'Sök utan enheten' }).click();
      await expect(readout(page)).toHaveText('3 personer med HLR');
      await expectNoAxeViolations(page);
    });
    test('a search is read when asked and no more: the tab shown again or focused asks nothing; a new one is said even with the same count', async ({
      page,
      api,
    }) => {
      registrar(api);
      await open(page, SEARCH);
      await chooseType(page, 'hlr', 'HLR');
      await expect(readout(page)).toHaveText('3 personer med HLR');
      expect(api.searchBodies).toHaveLength(1);
      // Past the age at which an ordinary read is read again when the tab is shown (15 s; the suite's clock stands
      // still), then the tab hidden and shown, the window focused and the network back, as a person coming back.
      const optionsRead = api.searchOptionsReads;
      await page.clock.setFixedTime(new Date(Date.parse(NOW) + 30_000));
      await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
        document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
        document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
        window.dispatchEvent(new Event('focus'));
        window.dispatchEvent(new Event('online'));
      });
      // An ordinary read on the page is read again, so the tab was seen to come back; the search is not.
      await expect.poll(() => api.searchOptionsReads).toBeGreaterThan(optionsRead);
      expect(api.searchBodies).toHaveLength(1);
      // Two units that each hold two: the second is said too, by its unit, after "Söker …".
      await choose(page, /^Enhet/, /Hemtjänst Centrum/);
      await expect(readout(page)).toHaveText('2 personer med HLR på Hemtjänst Centrum');
      await choose(page, /^Enhet/, /Bergsåkers skola/);
      await expect(readout(page)).toHaveText('2 personer med HLR på Bergsåkers skola');
      await expect
        .poll(() => announcements(page))
        .toEqual(
          expect.arrayContaining(['2 personer med HLR på Hemtjänst Centrum', '2 personer med HLR på Bergsåkers skola']),
        );
      expect(api.searchBodies).toHaveLength(3);
    });
    test('a file that cannot be made is said, and nothing is said to be fetched', async ({ page, api }) => {
      registrar(api);
      await open(page, SEARCH);
      await chooseType(page, 'hlr', 'HLR');
      await expect(readout(page)).toHaveText('3 personer med HLR');
      api.searchFails = true;
      await page.getByRole('button', { name: 'Ladda ner 3 rader som CSV' }).click();
      await expect
        .poll(() => announcements(page))
        .toContainEqual(expect.stringContaining('Något gick fel. Försök igen.'));
      expect(await announcements(page)).not.toContainEqual(expect.stringContaining('är hämtad'));
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

  test.describe('phone', () => {
    test.use({ viewport: phone });
    test('where the rows are a list, "Sortera" orders them on the server', async ({ page, api }) => {
      registrar(api);
      await open(page, `${SEARCH}?type=t-hlr`);
      await expect(page.getByRole('list', { name: 'Personer med HLR' })).toBeVisible();
      await sortBy(page, 'Tidigast slutdatum först');
      await expect(readout(page)).toHaveText('3 personer med HLR, sorterat tidigast slutdatum först');
      await expect(page.getByRole('list', { name: 'Personer med HLR' }).getByRole('listitem').first()).toContainText(
        'Bo Ek',
      );
      await expect(page).toHaveURL(/\?type=t-hlr&sort=until$/);
      await expectNoAxeViolations(page);
    });
  });

  test.describe('1.4.10 reflow', () => {
    test('the page reflows at 320 px with a result of several types, its filters and its pager', async ({
      page,
      api,
    }) => {
      registrar(api, true);
      await page.setViewportSize(narrow);
      await open(page, `${SEARCH}?type=t-hlr,t-eng&level=2`);
      await expect(page.getByRole('list', { name: 'Personer med HLR och Engelska' })).toBeVisible();
      expect(await reflowProblems(page)).toEqual([]);
      await open(page, `${SEARCH}?type=t-hlr&status=valid,expiring`);
      await expect(pager(page)).toContainText('Sida 1 av 3');
      expect(await reflowProblems(page)).toEqual([]);
      await expectNoAxeViolations(page);
    });
  });
});
