import { manyPeople, usersPeople } from './data';
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
import type { Locator, Page } from '@playwright/test';

/**
 * Användare (D62, D68, D85, D100): the provisioned people a page at a time with unit, role, capabilities and whether
 * they have signed in, narrowed by a search and four filters, and the mapping from a group to a capability that an
 * administrator adds and removes, the group found by searching every group of the organisation (D85), and the
 * catalogues' keys: one is issued, replaced and taken back (D107). A person's title stands under the name when the
 * catalogue sent one (D110). Keyboard, structure, focus, announcements, axe and reflow, at desktop, phone and 320 px.
 */
/** The line over the list that counts the people: Astryx's own live regions repeat other words about them. */
const readout = (page: Page) => page.getByRole('status').filter({ hasText: /^\d+ (av \d+ )?person(er)?$/ });
const filters = (page: Page) => page.getByRole('search', { name: 'Sök och filtrera personer' });
const pager = (page: Page) => page.getByRole('navigation', { name: 'Sidor med personer' });
/** Opens a filter from the keyboard and takes the option named. */
async function choose(page: Page, filter: Locator, option: string) {
  await filter.focus();
  await page.keyboard.press('Enter');
  await page.getByRole('option', { name: option, exact: true }).click();
}
test.describe('users administration', () => {
  for (const [layout, viewport] of [
    ['desktop', desktop],
    ['phone', phone],
  ] as const)
    test.describe(layout, () => {
      test.use({ viewport });
      test('a name opens the profile with every employment and contact number, and returns to the filtered list', async ({
        page,
        api,
      }) => {
        api.admin = true;
        api.entityDetailOf = key =>
          key === 'hillevi'
            ? {
                entity: { kind: 'person', key, sourceKey: 'hillevi.berg', name: 'Hillevi Berg' },
                profile: {
                  email: 'hillevi@clew.test',
                  title: null,
                  phoneNumbers: [
                    { type: 'work', value: '010-000 00 01' },
                    { type: 'work', value: '010-000 00 02' },
                    { type: 'Jour', value: '070-000 00 03' },
                  ],
                  employments: [
                    {
                      unitId: 'skola',
                      unitLabel: 'Skolan',
                      title: 'Rektor',
                      employmentType: 'Tillsvidare',
                      startDate: '2019-02-01',
                      employmentPercentage: 60,
                    },
                    { unitId: 'skola', unitLabel: 'Skolan', title: 'Samordnare', employmentPercentage: 40 },
                  ],
                },
                relation: 'self',
                actions: [],
                cards: [],
                sections: [],
              }
            : undefined;
        await open(page, '/admin/users?role=manager');
        // The address is her id, never her user name (D116).
        await expect(page.getByRole('link', { name: 'Hillevi Berg', exact: true })).toHaveAttribute(
          'href',
          '/people/hillevi?from=%2Fadmin%2Fusers%3Frole%3Dmanager',
        );
        await page.getByRole('link', { name: 'Hillevi Berg', exact: true }).click();
        const main = page.getByRole('main');
        await expect(main.getByRole('heading', { name: 'Hillevi Berg' })).toBeVisible();
        const jobs = main.getByRole('region', { name: 'Anställningar' });
        // Astryx's List, named for its section, so VoiceOver on Safari keeps the list and its count (W6).
        await expect(jobs.getByRole('list', { name: 'Anställningar' }).getByRole('listitem')).toHaveCount(2);
        await expect(jobs.getByRole('listitem').nth(0)).toContainText('Rektor');
        await expect(jobs.getByRole('listitem').nth(0)).toContainText('Tillsvidare');
        await expect(jobs.getByRole('listitem').nth(0).locator('time')).toHaveText('1 februari 2019');
        await expect(jobs.getByRole('listitem').nth(1).getByText('Startdatum')).toHaveCount(0);
        await expect(jobs.getByRole('listitem').nth(1)).toContainText('Samordnare');
        await expect(jobs.getByRole('listitem').nth(0)).toContainText('60 %');
        await expect(jobs.getByRole('listitem').nth(1)).toContainText('40 %');
        await expect(jobs.getByText('Skolan', { exact: true })).toHaveCount(2);
        const contacts = main.getByRole('region', { name: 'Kontaktuppgifter' });
        await expect(contacts.locator('a[href^="tel:"]')).toHaveCount(3);
        await expect(contacts.getByRole('link', { name: '010-000 00 02' })).toHaveAttribute('href', 'tel:0100000002');
        await expect(contacts.getByText('Jour', { exact: true })).toBeVisible();
        await expect(contacts.getByRole('link', { name: 'hillevi@clew.test' })).toHaveAttribute(
          'href',
          'mailto:hillevi@clew.test',
        );
        await expectNoAxeViolations(page);
        await main.getByRole('link', { name: 'Användare', exact: true }).click();
        await expect(page).toHaveURL(/\/admin\/users\?role=manager$/);
      });
      test('the page has no axe violations, every focus stop is marked, and its parts are headings under its title', async ({
        page,
        api,
      }) => {
        api.admin = true;
        await open(page, '/admin/users');
        await expect(page.getByRole('heading', { level: 1, name: 'Användare' })).toBeVisible();
        // A list of the headings finds the two cards by their titles (W5): drawn at D71's level for a part of a page and
        // read as level 2 under the title. Playwright gives a heading the level of its tag, so the outline's level is
        // read from the attribute, as admin.spec reads it.
        for (const name of ['Inläsning från katalogen', 'Behörigheter från grupper'])
          await expect(page.getByRole('heading', { name, exact: true })).toHaveAttribute('aria-level', '2');
        await expectNoAxeViolations(page);
        const { unmarked } = await hiddenFocusStops(page);
        expect(unmarked).toEqual([]);
      });
      test('a mapping taken away from the keyboard gives the focus to the next row, else the one before, else the group picker (W4)', async ({
        page,
        api,
      }) => {
        api.admin = true;
        api.users.groupCapabilities = [
          { groupExternalId: 'S-1-5-21-it-staff', groupLabel: 'IT-personal', capability: 'admin.connectors' },
          { groupExternalId: 'S-1-5-21-rektorer', groupLabel: 'Rektorer', capability: 'admin.connectors' },
          { groupExternalId: 'S-1-5-21-rektorer', groupLabel: 'Rektorer', capability: 'admin.users' },
        ];
        await open(page, '/admin/users');
        const remove = (name: string) => page.getByRole('button', { name: `Ta bort: ${name}` });
        await remove('Rektorer ger administrera anslutna system').focus();
        await page.keyboard.press('Enter');
        await expect(remove('Rektorer ger administrera anslutna system')).toHaveCount(0);
        await expect(remove('Rektorer ger administrera användare')).toBeFocused();
        // The last row leaves the focus to the row before it.
        await page.keyboard.press('Enter');
        await expect(remove('Rektorer ger administrera användare')).toHaveCount(0);
        await expect(remove('IT-personal ger administrera anslutna system')).toBeFocused();
        // The only row leaves it to the field that adds the next one.
        await page.keyboard.press('Enter');
        await expect(page.getByText(/^Ingen grupp ger någon behörighet ännu/)).toBeVisible();
        await expect(
          page.getByRole('form', { name: 'Lägg till behörighet från grupp' }).getByRole('combobox', { name: 'Grupp' }),
        ).toBeFocused();
        await expectNoAxeViolations(page);
      });
    });
  test.describe('desktop', () => {
    test.use({ viewport: desktop });
    test('the list says where each person is placed, what they are there, what they may do and whether they have signed in', async ({
      page,
      api,
    }) => {
      api.admin = true;
      await open(page, '/admin/users');
      await expect(page).toHaveTitle('Användare · Startsidan');
      await expect(page.getByRole('link', { name: 'Användare', exact: true })).toHaveAttribute('aria-current', 'page');
      const people = page.getByRole('table').first();
      // The unit and the role are columns of their own: where a person is and what they are there are two questions.
      await expect(people.getByRole('columnheader')).toHaveText(['Person', 'Enhet', 'Roll', 'Behörigheter', 'Status']);
      const hillevi = people.getByRole('row', { name: /Hillevi Berg/ }).getByRole('cell');
      await expect(hillevi.nth(1)).toHaveText('Bergsåkers skola');
      await expect(hillevi.nth(2)).toHaveText('Chef');
      const omar = people.getByRole('row', { name: /Omar Ny/ }).getByRole('cell');
      await expect(omar.nth(1)).toHaveText('Ingen enhet');
      await expect(omar.nth(2)).toHaveText('');
      await expect(people.getByText('Administrera användare', { exact: true })).toBeVisible();
      await expect(people.getByText('Har loggat in', { exact: true })).toHaveCount(2);
      await expect(people.getByText('Inte inloggad ännu', { exact: true })).toBeVisible();
      await expect(people.getByText('Ingen åtkomst', { exact: true })).toBeVisible();
      await expect(page.getByRole('table').nth(1).getByText('IT-personal')).toBeVisible();
      // Four people fit one page, so there is nothing to step through and nothing to clear.
      await expect(readout(page)).toHaveText('4 personer');
      await expect(pager(page)).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Rensa filter' })).toHaveCount(0);
      expect(api.peopleQueries).toEqual([{ page: 1, pageSize: 25 }]);
    });
    test('the list is narrowed from the keyboard, the result is said aloud and kept in the address, and one step clears it', async ({
      page,
      api,
    }) => {
      api.admin = true;
      await open(page, '/admin/users');
      const people = page.getByRole('table').first().locator('tbody tr');
      const role = filters(page).getByRole('combobox', { name: 'Roll' });
      // Enter opens the filter and Enter takes its first choice: a chip that says the whole clause.
      await role.focus();
      await page.keyboard.press('Enter');
      await page.keyboard.press('Enter');
      await expect(role).toContainText('Roll: Chef');
      await expect(page).toHaveURL(/\/admin\/users\?role=manager$/);
      await expect(readout(page)).toHaveText('1 av 4 personer');
      await expect.poll(() => announcements(page)).toContainEqual('1 av 4 personer');
      await expect(people).toHaveText([/Hillevi Berg/]);
      await expectNoAxeViolations(page);
      // A second filter narrows further; together they match nobody, and the page says so with the way out.
      await choose(page, filters(page).getByRole('combobox', { name: 'Status' }), 'Ingen åtkomst');
      await expect(page).toHaveURL(/\?role=manager&status=no-access$/);
      await expect(page.getByRole('heading', { name: 'Inga personer matchar' })).toBeVisible();
      await expect.poll(() => announcements(page)).toContainEqual('0 av 4 personer');
      await expectNoAxeViolations(page);
      // Back undoes one step, and Rensa filter all of them.
      await page.goBack();
      await expect(readout(page)).toHaveText('1 av 4 personer');
      await page.getByRole('button', { name: 'Rensa filter' }).click();
      await expect(page).toHaveURL(/\/admin\/users$/);
      await expect(readout(page)).toHaveText('4 personer');
      await expect(role).not.toContainText('Chef');
      // The button is gone once used, and the focus is on the search box, not lost at the top of the page.
      await expect(page.getByRole('button', { name: 'Rensa filter' })).toHaveCount(0);
      await expect(filters(page).getByRole('searchbox', { name: 'Sök person' })).toBeFocused();
    });
    test('a list that cannot be read keeps its search and filters, and clearing them reads it again', async ({
      page,
      api,
    }) => {
      api.admin = true;
      await open(page, '/admin/users');
      await expect(readout(page)).toHaveText('4 personer');
      api.peopleRefused = true;
      await choose(page, filters(page).getByRole('combobox', { name: 'Roll' }), 'Chef');
      await expect(page.getByRole('alert').filter({ hasText: 'Ogiltig förfrågan.' })).toBeVisible();
      // What was asked for is still there to change: the chip says the clause and the search box is where it was.
      await expect(filters(page).getByRole('combobox', { name: 'Roll' })).toContainText('Roll: Chef');
      await expect(filters(page).getByRole('searchbox', { name: 'Sök person' })).toBeVisible();
      await expectNoAxeViolations(page);
      api.peopleRefused = false;
      await page.getByRole('button', { name: 'Rensa filter' }).click();
      await expect(readout(page)).toHaveText('4 personer');
      await expect(page.getByRole('alert').filter({ hasText: 'Ogiltig förfrågan.' })).toHaveCount(0);
    });
    test('a unit is found by its name and a link to a narrowed list opens it narrowed', async ({ page, api }) => {
      api.admin = true;
      await open(page, '/admin/users');
      const unit = filters(page).getByRole('button', { name: /^Enhet/ });
      await unit.click();
      await page.keyboard.type('hemtj');
      // The unit above tells two units with one name apart.
      await expect(page.getByRole('option')).toHaveText([/Hemtjänst Centrum/]);
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(/\?unit=unit-omsorg$/);
      await expect(unit).toContainText('Enhet: Hemtjänst Centrum');
      await expect(page.getByRole('table').first().locator('tbody tr')).toHaveText([/Hassan Ali/]);
      // The address is the filter: what it names is asked for, and what it cannot mean is left out.
      api.peopleQueries = [];
      await open(page, '/admin/users?unit=unit-skola&role=manager&status=nonsense&page=x&size=7');
      await expect(readout(page)).toHaveText('1 av 4 personer');
      await expect(filters(page).getByRole('button', { name: /^Enhet/ })).toContainText('Enhet: Bergsåkers skola');
      await expect(filters(page).getByRole('combobox', { name: 'Roll' })).toContainText('Roll: Chef');
      expect(api.peopleQueries.at(-1)).toEqual({ unitId: 'unit-skola', role: 'manager', page: 1, pageSize: 25 });
      // A unit the tree no longer names still narrows the list, and the chip says that it does.
      await open(page, '/admin/users?unit=unit-borta');
      await expect(page.getByRole('heading', { name: 'Inga personer matchar' })).toBeVisible();
      await expect(filters(page).getByRole('button', { name: /^Enhet/ })).toContainText('Enhet: unit-borta');
    });
    test('a typed name narrows the list after a pause, as one question, and never enters the address', async ({
      page,
      api,
    }) => {
      api.admin = true;
      await open(page, '/admin/users');
      const search = filters(page).getByRole('searchbox', { name: 'Sök person' });
      await search.pressSequentially('mikael');
      await expect(readout(page)).toHaveText('1 av 4 personer');
      await expect(page.getByRole('table').first().locator('tbody tr')).toHaveText([/Mikael Lund/]);
      // One question for the word, not one for each letter, and the name is in the body and not in the address.
      expect(api.peopleQueries.filter(q => q.text !== undefined)).toEqual([{ text: 'mikael', page: 1, pageSize: 25 }]);
      await expect(page).toHaveURL(/\/admin\/users$/);
      await filters(page).getByRole('button', { name: 'Rensa Sök person' }).click();
      await expect(readout(page)).toHaveText('4 personer');
      await expect(search).toBeFocused();
      // The box holds no more than the server reads, so a pasted text is cut there and never refused.
      await search.fill('x'.repeat(300));
      await expect(search).toHaveValue('x'.repeat(200));
      await expect(readout(page)).toHaveText('0 av 4 personer');
    });
    test('a title from the catalogue stands under the name, a person without one has none, and the search finds it (D110)', async ({
      page,
      api,
    }) => {
      api.admin = true;
      await open(page, '/admin/users');
      const people = page.getByRole('table').first(),
        cells = (name: RegExp) => people.getByRole('row', { name }).getByRole('cell');
      await expect(
        cells(/Hillevi Berg/)
          .first()
          .getByText('Rektor', { exact: true }),
      ).toBeVisible();
      // The title is the catalogue's word and the role is Clew's: both are on the row, and neither stands in for the other.
      await expect(cells(/Hillevi Berg/).nth(2)).toHaveText('Chef');
      // A catalogue that sends no title leaves the name and the user name, and no words about what is missing.
      await expect(cells(/Omar Ny/).first()).toHaveText('Omar Nyomar');
      await filters(page).getByRole('searchbox', { name: 'Sök person' }).pressSequentially('rektor');
      await expect(readout(page)).toHaveText('1 av 4 personer');
      await expect(people.locator('tbody tr')).toHaveText([/Hillevi Berg/]);
    });
    test('a name typed on a later page is one question, from the first page', async ({ page, api }) => {
      api.admin = true;
      api.people = [...usersPeople(), ...manyPeople()];
      await open(page, '/admin/users?page=2');
      await expect(page.getByRole('table').first().locator('tbody tr').first()).toContainText('Person 22');
      api.peopleQueries = [];
      await filters(page).getByRole('searchbox', { name: 'Sök person' }).pressSequentially('person');
      await expect(readout(page)).toHaveText('60 av 64 personer');
      await expect(page).toHaveURL(/\/admin\/users$/);
      expect(api.peopleQueries).toEqual([{ text: 'person', page: 1, pageSize: 25 }]);
    });
    test('many people come a page at a time: the pager steps through them, the list starts over when it is narrowed, and the page size is chosen', async ({
      page,
      api,
    }) => {
      api.admin = true;
      api.people = [...usersPeople(), ...manyPeople()];
      await open(page, '/admin/users');
      const people = page.getByRole('table').first();
      const rows = people.locator('tbody tr');
      await expect(readout(page)).toHaveText('64 personer');
      await expect(rows).toHaveCount(25);
      await expect(pager(page).getByRole('button', { name: 'Gå till sida 1' })).toHaveAttribute('aria-current', 'page');
      const next = pager(page).getByRole('button', { name: 'Gå till nästa sida' });
      await next.focus();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(/\?page=2$/);
      await expect(rows.first()).toContainText('Person 22');
      await expect(pager(page).getByRole('button', { name: 'Gå till sida 2' })).toHaveAttribute('aria-current', 'page');
      // The step is taken at the foot of the list and read from its head: the head is in view, the focus where it was.
      await expect(readout(page)).toBeInViewport();
      await expect(next).toBeFocused();
      // Each row says where it stands among all the people, not on the page.
      await expect(people).toHaveAttribute('aria-rowcount', '64');
      await expect(rows.first()).toHaveAttribute('aria-rowindex', '26');
      await expectNoAxeViolations(page);
      // Narrowing starts over from the first page.
      await choose(page, filters(page).getByRole('combobox', { name: 'Roll' }), 'Medarbetare');
      await expect(page).toHaveURL(/\?role=employee$/);
      await expect(readout(page)).toHaveText('62 av 64 personer');
      await expect(pager(page).getByRole('button', { name: 'Gå till sida 1' })).toHaveAttribute('aria-current', 'page');
      // More on a page, by choice, and that too is in the address.
      await choose(page, pager(page).getByRole('combobox', { name: 'Objekt per sida' }), '50');
      await expect(page).toHaveURL(/\?role=employee&size=50$/);
      await expect(rows).toHaveCount(50);
      await expect(pager(page).getByRole('button', { name: 'Gå till sida 3' })).toHaveCount(0);
      // One choice is one step back, though the pager asks for the first page as well.
      await page.goBack();
      await expect(page).toHaveURL(/\?role=employee$/);
      await expect(rows).toHaveCount(25);
      // A page past the end, which an old link may name, shows the last one.
      await open(page, '/admin/users?page=9');
      await expect(rows).toHaveCount(14);
      await expect(pager(page).getByRole('button', { name: 'Gå till sida 3' })).toHaveAttribute('aria-current', 'page');
    });
    test('the page says when each catalogue last called and warns about one that has gone silent', async ({
      page,
      api,
    }) => {
      api.admin = true;
      await open(page, '/admin/users');
      const pushes = page.getByRole('list', { name: 'Inläsning från katalogen' });
      const rows = pushes.getByRole('listitem');
      await expect(rows).toHaveCount(2);
      await expect(rows.nth(0)).toContainText('HR-systemet');
      await expect(rows.nth(0)).toContainText('Senaste anrop 6 november 2026');
      await expect(rows.nth(0)).toContainText('Tyst i över två dygn');
      await expect(rows.nth(1)).toContainText('Metakatalogen');
      await expect(rows.nth(1)).toContainText('Senaste anrop 10 november 2026 kl. 06:02');
      await expect(rows.nth(1)).toContainText('Läser in');
      // One focus stop a row: its menu, named by the catalogue it acts on (D107).
      await expect(pushes.getByRole('button')).toHaveCount(2);
      await expect(pushes.getByRole('button', { name: 'Åtgärder för Metakatalogen' })).toBeVisible();
      await expect(pushes.getByRole('link')).toHaveCount(0);
    });
    test('a catalogue is added from the keyboard, and its key is shown once, to copy (D107)', async ({ page, api }) => {
      api.admin = true;
      await open(page, '/admin/users');
      const add = page.getByRole('button', { name: 'Lägg till katalog' });
      await add.focus();
      await page.keyboard.press('Enter');
      const dialog = page.getByRole('dialog', { name: 'Lägg till katalog' });
      await expect(dialog.getByRole('heading', { name: 'Katalogen', exact: true })).toBeFocused();
      // What is missing is said in words at the field, and nothing is sent.
      await dialog.getByRole('button', { name: 'Skapa nyckel' }).click();
      await expect(dialog.getByText('Ge katalogen ett namn.', { exact: true })).toBeVisible();
      // A tab pasted with the name becomes a space, since the server takes a label without a control character.
      await dialog.getByRole('textbox', { name: /^Namn/ }).fill('Nya\tKatalogen');
      await expect(dialog.getByRole('textbox', { name: /^Namn/ })).toHaveValue('Nya Katalogen');
      await expect(dialog.getByRole('textbox', { name: /^Id/ })).toHaveValue('nya-katalogen');
      await expectNoAxeViolations(page);
      await dialog.getByRole('button', { name: 'Skapa nyckel' }).click();
      // While the key is on the screen the dialog is one that has to be answered, and is announced as such.
      const shown = page.getByRole('alertdialog', { name: 'Lägg till katalog' });
      // The key replaces the form: its heading takes the focus, and the dialog says it will not be shown again.
      await expect(shown.getByRole('heading', { name: 'Nyckeln', exact: true })).toBeFocused();
      await expect(shown.getByText('Nyckeln visas bara nu.')).toBeVisible();
      await expect(shown.getByText('a11y-key-nya-katalogen')).toBeVisible();
      await expect(shown.getByText('Nyckeln går inte ut av sig själv.')).toBeVisible();
      // Where the key is sent is the server's word for its own address, not the address of this page.
      await expect(shown).toContainText('https://clew.test/scim/v2');
      // The only copy of the key is on the screen: Escape does not close the dialog, and the header has no button
      // that does. The one way out says what it means.
      await page.keyboard.press('Escape');
      await expect(shown.getByText('a11y-key-nya-katalogen')).toBeVisible();
      await expect(shown.getByRole('button', { name: 'Kopiera kod' })).toBeVisible();
      await expect(shown.getByRole('button')).toHaveCount(2);
      await expectNoAxeViolations(page);
      await shown.getByRole('button', { name: 'Jag har sparat nyckeln' }).click();
      await expect(shown).toBeHidden();
      await expect(add).toBeFocused();
      // The catalogue is in the list, and the key is nowhere on the page.
      const rows = page.getByRole('list', { name: 'Inläsning från katalogen' }).getByRole('listitem');
      await expect(rows).toHaveCount(3);
      await expect(rows.filter({ hasText: 'Nya Katalogen' })).toContainText('Har aldrig anropat Clew');
      await expect(page.getByText('a11y-key-nya-katalogen')).toHaveCount(0);
      // An id that is taken is refused in the dialog, in the server's words.
      await add.click();
      await dialog.getByRole('textbox', { name: /^Namn/ }).fill('Metakatalogen');
      await dialog.getByRole('button', { name: 'Skapa nyckel' }).click();
      await expect(
        dialog.getByRole('alert').filter({ hasText: 'Det finns redan en katalog med det id:t.' }),
      ).toHaveCount(1);
    });
    test('a key is replaced from the row menu with a time for the old one, and the row says until when (D107)', async ({
      page,
      api,
    }) => {
      api.admin = true;
      await open(page, '/admin/users');
      const pushes = page.getByRole('list', { name: 'Inläsning från katalogen' });
      const menu = pushes.getByRole('button', { name: 'Åtgärder för Metakatalogen' });
      await menu.focus();
      await page.keyboard.press('Enter');
      await page.getByRole('menuitem', { name: 'Byt nyckel' }).click();
      const dialog = page.getByRole('dialog', { name: 'Byt nyckel' });
      await expect(dialog.getByRole('heading', { name: 'Den gamla nyckeln' })).toBeFocused();
      await expect(dialog).toContainText('Metakatalogen får en ny nyckel, som gäller tills vidare.');
      // The time is for the old key alone, and the group of choices is named so.
      await expect(
        dialog.getByRole('radiogroup', { name: /Hur länge ska den gamla nyckeln fortsätta gälla\?/ }),
      ).toBeVisible();
      // A day's grace is chosen from the start: the choice that breaks no push.
      await expect(dialog.getByRole('radio', { name: 'Ett dygn till' })).toBeChecked();
      await expect(dialog.getByRole('radio')).toHaveCount(3);
      // No key replaced before this one still answers, so nothing is ended at once and the dialog warns of nothing.
      await expect(dialog).not.toContainText('Den förra nyckeln slutar gälla direkt');
      await expectNoAxeViolations(page);
      await dialog.getByRole('button', { name: 'Byt nyckel' }).click();
      const shown = page.getByRole('alertdialog', { name: 'Byt nyckel' });
      await expect(shown.getByRole('heading', { name: 'Den nya nyckeln' })).toBeFocused();
      await expect(shown.getByText('a11y-key-rotated')).toBeVisible();
      // Until when the old key answers, in Swedish time whatever zone the browser is in.
      await expect(shown).toContainText(
        'Den förra nyckeln gäller till 12 november 2026 kl. 06:00. Byt den i katalogen före dess.',
      );
      await expectNoAxeViolations(page);
      await shown.getByRole('button', { name: 'Jag har sparat nyckeln' }).click();
      await expect(shown).toBeHidden();
      await expect(menu).toBeFocused();
      await expect(pushes.getByRole('listitem').filter({ hasText: 'Metakatalogen' })).toContainText(
        'Den förra nyckeln gäller till 12 november 2026 kl. 06:00',
      );
      await expect(page.getByText('a11y-key-rotated')).toHaveCount(0);
    });
    test('a key replaced while the key replaced before it still answers says, before and after, that that key ends at once (K1)', async ({
      page,
      api,
    }) => {
      api.admin = true;
      // Metakatalogen's key was replaced, and the key before it answers until 8 November.
      api.users.provisioners = api.users.provisioners.map(p =>
        p.id === 'metakatalogen' ? { ...p, previousValidUntil: '2026-11-08T05:00:00.000Z' } : p,
      );
      await open(page, '/admin/users');
      const menu = page
        .getByRole('list', { name: 'Inläsning från katalogen' })
        .getByRole('button', { name: 'Åtgärder för Metakatalogen' });
      const shown = page.getByRole('alertdialog', { name: 'Byt nyckel' });
      const replace = async () => {
        await menu.focus();
        await page.keyboard.press('Enter');
        await page.getByRole('menuitem', { name: 'Byt nyckel' }).click();
        const dialog = page.getByRole('dialog', { name: 'Byt nyckel' });
        await expect(dialog.getByRole('heading', { name: 'Den gamla nyckeln' })).toBeFocused();
        return dialog;
      };
      let dialog = await replace();
      // Before anything is confirmed, above the choice: Clew keeps one replaced key, so the one replaced before ends
      // now, whatever time is chosen for the key replaced now.
      await expect(dialog).toContainText('Den förra nyckeln slutar gälla direkt');
      await expect(dialog).toContainText(
        'Den gäller annars till 8 november 2026 kl. 06:00. Clew behåller bara en utbytt nyckel, så när du byter nu slutar den gälla direkt, vilken tid du än väljer nedan.',
      );
      await expect(dialog.getByRole('radio', { name: 'Ett dygn till' })).toBeChecked();
      await expectNoAxeViolations(page);
      await dialog.getByRole('button', { name: 'Byt nyckel' }).click();
      // Afterwards both: until when the key just replaced answers, and that the one before it no longer does.
      await expect(shown.getByRole('heading', { name: 'Den nya nyckeln' })).toBeFocused();
      await expect(shown).toContainText(
        'Den förra nyckeln gäller till 12 november 2026 kl. 06:00. Byt den i katalogen före dess. Den äldre nyckeln, som skulle ha gällt till 8 november 2026 kl. 06:00, har slutat gälla.',
      );
      await shown.getByRole('button', { name: 'Jag har sparat nyckeln' }).click();
      await expect(menu).toBeFocused();
      // Once more, with the key replaced now ended at once too.
      dialog = await replace();
      await expect(dialog).toContainText('Den gäller annars till 12 november 2026 kl. 06:00.');
      await dialog.getByRole('radio', { name: 'Den slutar gälla direkt' }).check();
      await dialog.getByRole('button', { name: 'Byt nyckel' }).click();
      await expect(shown).toContainText(
        'Den förra nyckeln har slutat gälla. Inläsningen står stilla tills katalogen har fått den nya. Den äldre nyckeln, som skulle ha gällt till 12 november 2026 kl. 06:00, har också slutat gälla.',
      );
      await expectNoAxeViolations(page);
    });
    test('a key is taken back after a confirmation, said aloud, and the focus goes to the control that is left (D107)', async ({
      page,
      api,
    }) => {
      api.admin = true;
      await open(page, '/admin/users');
      const pushes = page.getByRole('list', { name: 'Inläsning från katalogen' });
      const menu = pushes.getByRole('button', { name: 'Åtgärder för Metakatalogen' });
      await menu.focus();
      await page.keyboard.press('Enter');
      await page.getByRole('menuitem', { name: 'Återkalla nyckeln' }).click();
      const confirm = page.getByRole('alertdialog', { name: 'Återkalla nyckeln för Metakatalogen' });
      await expect(confirm).toContainText('Katalogen kan inte längre föra in ändringar i Clew');
      await expectNoAxeViolations(page);
      // Changing one's mind leaves everything as it was, and the focus where it came from.
      await confirm.getByRole('button', { name: 'Avbryt' }).click();
      await expect(confirm).toBeHidden();
      await expect(menu).toBeFocused();
      await expect(pushes.getByRole('listitem')).toHaveCount(2);
      await page.keyboard.press('Enter');
      await page.getByRole('menuitem', { name: 'Återkalla nyckeln' }).click();
      await confirm.getByRole('button', { name: 'Återkalla' }).click();
      await expect
        .poll(() => announcements(page))
        .toContainEqual(expect.stringContaining('Nyckeln för Metakatalogen är återkallad.'));
      await expect(pushes.getByRole('listitem')).toHaveCount(1);
      await expect(pushes).not.toContainText('Metakatalogen');
      await expect(page.getByRole('button', { name: 'Lägg till katalog' })).toBeFocused();
    });
    test('a key that cannot be taken back says why in a notice that stays, and the list is read again (D107)', async ({
      page,
      api,
    }) => {
      api.admin = true;
      await open(page, '/admin/users');
      const pushes = page.getByRole('list', { name: 'Inläsning från katalogen' });
      await pushes.getByRole('button', { name: 'Åtgärder för Metakatalogen' }).click();
      await page.getByRole('menuitem', { name: 'Återkalla nyckeln' }).click();
      const confirm = page.getByRole('alertdialog', { name: 'Återkalla nyckeln för Metakatalogen' });
      await expect(confirm).toBeVisible();
      // Somebody else took the key back while the confirmation was open.
      api.users.provisioners = api.users.provisioners.filter(p => p.id !== 'metakatalogen');
      await confirm.getByRole('button', { name: 'Återkalla' }).click();
      await expect.poll(() => announcements(page)).toContainEqual(expect.stringContaining('Katalogen finns inte.'));
      await expect(confirm).toBeHidden();
      // The page shows what is true now, and the focus is on the control that is left.
      await expect(pushes.getByRole('listitem')).toHaveCount(1);
      await expect(page.getByRole('button', { name: 'Lägg till katalog' })).toBeFocused();
      await expectNoAxeViolations(page);
    });
    test('a catalogue that has never called and an installation without one are both said in words', async ({
      page,
      api,
    }) => {
      api.admin = true;
      api.users.provisioners = [
        { id: 'ny', label: 'Ny katalog', lastSeenAt: null, silent: true, previousValidUntil: null },
      ];
      await open(page, '/admin/users');
      const row = page.getByRole('list', { name: 'Inläsning från katalogen' }).getByRole('listitem');
      await expect(row).toContainText('Har aldrig anropat Clew');
      await expect(row).toContainText('Inget anrop ännu');
      api.users.provisioners = [];
      await page.reload();
      await expect(page.getByText('Ingen katalog har fått en nyckel till Clew ännu.')).toBeVisible();
      await expectNoAxeViolations(page);
    });
    test('an organisation nobody has been pushed into says so, without a list to narrow', async ({ page, api }) => {
      api.admin = true;
      api.people = [];
      await open(page, '/admin/users');
      await expect(page.getByRole('heading', { level: 2, name: 'Inga användare ännu' })).toBeVisible();
      await expect(filters(page)).toHaveCount(0);
      await expectNoAxeViolations(page);
    });
    test('a group is found by its name, mapped to a capability by keyboard, said aloud, and taken back again', async ({
      page,
      api,
    }) => {
      api.admin = true;
      await open(page, '/admin/users');
      const form = page.getByRole('form', { name: 'Lägg till behörighet från grupp' });
      const group = form.getByRole('combobox', { name: 'Grupp' });
      await group.focus();
      await page.keyboard.type('rekt');
      // The external id stands under the name, so two groups with one name are told apart.
      await expect(page.getByRole('option')).toHaveCount(1);
      await expect(page.getByRole('option')).toHaveAccessibleName('Rektorer S-1-5-21-rektorer');
      // Escape closes the list before the server has answered, and that stops the search: the list stays closed.
      await page.keyboard.press('Escape');
      await expect(page.getByRole('listbox', { name: 'Sökresultat' })).toBeHidden();
      await page.waitForTimeout(600);
      await expect(page.getByRole('listbox', { name: 'Sökresultat' })).toBeHidden();
      await group.fill('');
      await page.keyboard.type('rekt');
      await expect(page.getByRole('option', { name: /^Rektorer/ })).toBeVisible();
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      // The chosen group stands in the field, which keeps the focus on it.
      await expect(form.getByRole('button', { name: 'Grupp Rektorer' })).toBeFocused();
      const gives = form.getByRole('combobox', { name: 'Ger behörigheten' });
      await gives.focus();
      await page.keyboard.press('Enter');
      await page.getByRole('option', { name: 'Administrera anslutna system' }).click();
      await form.getByRole('button', { name: 'Lägg till' }).click();
      await expect
        .poll(() => announcements(page))
        .toContainEqual(expect.stringContaining('Sparat: Rektorer ger administrera anslutna system'));
      const mapping = page.getByRole('table').nth(1);
      await expect(mapping.getByText('Rektorer', { exact: true })).toBeVisible();
      await expectNoAxeViolations(page);
      await mapping.getByRole('button', { name: 'Ta bort: Rektorer ger administrera anslutna system' }).click();
      await expect.poll(() => announcements(page)).toContainEqual(expect.stringContaining('Borttaget: Rektorer'));
      await expect(mapping.getByText('Rektorer', { exact: true })).toHaveCount(0);
      // With a group chosen, the chosen group is the picker's one focus stop, and takes the focus when no row is left
      // (W4).
      await group.focus();
      await page.keyboard.type('rekt');
      await expect(page.getByRole('option', { name: /^Rektorer/ })).toBeVisible();
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      // The chosen group takes the focus the frame after it is chosen, as above, and the person moves on from there.
      // Moved on before that, the focus went back to the group, and Enter opened it for editing instead of taking the
      // row away.
      await expect(form.getByRole('button', { name: 'Grupp Rektorer' })).toBeFocused();
      await mapping.getByRole('button', { name: 'Ta bort: IT-personal ger administrera anslutna system' }).focus();
      await page.keyboard.press('Enter');
      await expect(page.getByText(/^Ingen grupp ger någon behörighet ännu/)).toBeVisible();
      await expect(form.getByRole('button', { name: 'Grupp Rektorer' })).toBeFocused();
    });
    test('a group beyond those the page holds is found on the server, and a mapping on one is named by its group (K2)', async ({
      page,
      api,
    }) => {
      api.admin = true;
      // An organisation with more groups than the page is sent: only the server's search finds this one.
      api.groupsBeyond = [{ id: 'S-1-5-21-ostra-chefer', label: 'Östra skolområdets chefer' }];
      api.users.groupCapabilities.push({
        groupExternalId: 'S-1-5-21-ostra-chefer',
        groupLabel: 'Östra skolområdets chefer',
        capability: 'admin.users',
      });
      await open(page, '/admin/users');
      // The row is named by its own group, though the groups the page holds do not include it.
      const mapping = page.getByRole('table').nth(1);
      await expect(mapping.getByRole('row', { name: /Östra skolområdets chefer/ })).toContainText(
        'Administrera användare',
      );
      await expect(mapping).not.toContainText('Grupp som inte längre provisioneras');
      const form = page.getByRole('form', { name: 'Lägg till behörighet från grupp' });
      const group = form.getByRole('combobox', { name: 'Grupp' });
      // Nothing matches here or on the server, which the list says once the server has answered.
      await group.focus();
      await page.keyboard.type('zzz');
      await expect(page.getByRole('option', { name: 'Ingen grupp matchar.' })).toBeVisible();
      await group.fill('');
      // No group the page holds matches, and the server's answer is the list.
      await page.keyboard.type('östra');
      await expect(page.getByRole('option')).toHaveAccessibleName('Östra skolområdets chefer S-1-5-21-ostra-chefer');
      // One question for the word, not one for each letter, sent in the body.
      expect(api.groupSearches).toEqual(['zzz', 'östra']);
      await expectNoAxeViolations(page);
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      await expect(form.getByRole('button', { name: 'Grupp Östra skolområdets chefer' })).toBeFocused();
      await form.getByRole('combobox', { name: 'Ger behörigheten' }).focus();
      await page.keyboard.press('Enter');
      await page.getByRole('option', { name: 'Administrera anslutna system' }).click();
      await form.getByRole('button', { name: 'Lägg till' }).click();
      await expect
        .poll(() => announcements(page))
        .toContainEqual(expect.stringContaining('Sparat: Östra skolområdets chefer ger administrera anslutna system'));
      await expect(mapping.getByRole('row', { name: /Östra skolområdets chefer/ })).toHaveCount(2);
    });
    test('a group search the server cannot answer says so and never that no group matches, and new words ask again (K2)', async ({
      page,
      api,
    }) => {
      api.admin = true;
      api.groupsBeyond = [{ id: 'S-1-5-21-ostra-chefer', label: 'Östra skolområdets chefer' }];
      api.groupSearchFails = true;
      await open(page, '/admin/users');
      const form = page.getByRole('form', { name: 'Lägg till behörighet från grupp' });
      const group = form.getByRole('combobox', { name: 'Grupp' });
      const failed = 'Det gick inte att söka bland alla grupper. Försök igen.';
      // No group the page holds matches, and the server does not answer, asked once more as the page's other reads
      // are: the field says the search failed, aloud, and nothing says that no group matches.
      await group.focus();
      await page.keyboard.type('östra');
      await expect(group).toHaveAccessibleDescription(failed);
      await expect(form.getByText(failed, { exact: true }).filter({ visible: true })).toBeVisible();
      await expect.poll(() => announcements(page)).toContainEqual(expect.stringContaining(failed));
      await expect(page.getByText('Ingen grupp matchar.')).toHaveCount(0);
      expect(api.groupSearches).toEqual(['östra', 'östra']);
      // New words take the error away until they too have been asked. The page's own match is listed at once, and
      // stays listed when the server fails, while the field says that the search did not reach every group.
      await group.fill('');
      await expect(group).not.toHaveAccessibleDescription(failed);
      await page.keyboard.type('rekt');
      await expect(page.getByRole('option', { name: /^Rektorer/ })).toBeVisible();
      await expect(group).toHaveAccessibleDescription(failed);
      await expect(page.getByRole('option', { name: /^Rektorer/ })).toBeVisible();
      // An open list that comes back empty says the same in place of its rows.
      await page.keyboard.type('z');
      await expect(page.getByRole('option', { name: failed })).toBeVisible();
      await expect(page.getByText('Ingen grupp matchar.')).toHaveCount(0);
      // A word pasted decomposed, as text copied from a file name arrives, is the same letters to the page's own match.
      await group.fill('bergsåkers'.normalize('NFD'));
      await expect(page.getByRole('option', { name: /^Bergsåkers skola/ })).toBeVisible();
      await expectNoAxeViolations(page);
      // Once the server answers, new words find what it holds, and the field no longer says that a search failed.
      api.groupSearchFails = false;
      await group.fill('');
      await page.keyboard.type('östra');
      await expect(page.getByRole('option')).toHaveAccessibleName('Östra skolområdets chefer S-1-5-21-ostra-chefer');
      await expect(group).not.toHaveAccessibleDescription(failed);
      await expect(group).not.toHaveAttribute('aria-invalid', 'true');
    });
    test('without admin.users the server says no and the page says so, and nothing about groups or catalogues', async ({
      page,
      api,
    }) => {
      api.admin = true;
      api.usersForbidden = true;
      await open(page, '/admin/users');
      // Astryx keeps an empty assertive live region on every page; the page's own alert is the one with words.
      await expect(page.getByRole('alert').filter({ hasText: 'behörighet' })).toHaveCount(1);
      // The cards are drawn from an overview that was not read, so none is drawn (W3).
      await expect(page.getByRole('heading', { name: 'Behörigheter från grupper' })).toHaveCount(0);
      await expect(page.getByText(/^Ingen grupp ger någon behörighet ännu/)).toHaveCount(0);
      await expect(page.getByRole('list', { name: 'Inläsning från katalogen' })).toHaveCount(0);
    });
    test('an overview that cannot be read says so once, and nothing about groups, catalogues or units it has not read (W3)', async ({
      page,
      api,
    }) => {
      api.admin = true;
      api.usersFails = true;
      await open(page, '/admin/users');
      // After the page's one retry, the server's words in place of the cards.
      await expect(page.getByRole('alert').filter({ hasText: 'Något gick fel. Försök igen.' })).toBeVisible();
      await expect(page.getByText('Läser användarna …')).toHaveCount(0);
      await expect(page.getByRole('heading', { name: 'Behörigheter från grupper' })).toHaveCount(0);
      await expect(page.getByRole('form', { name: 'Lägg till behörighet från grupp' })).toHaveCount(0);
      await expect(page.getByText(/^Ingen grupp ger någon behörighet ännu/)).toHaveCount(0);
      await expect(page.getByPlaceholder('Inga grupper provisionerade')).toHaveCount(0);
      await expect(page.getByRole('heading', { name: 'Inläsning från katalogen' })).toHaveCount(0);
      await expect(page.getByText('Ingen katalog har fått en nyckel till Clew ännu.')).toHaveCount(0);
      // The people are a read of their own, and are listed.
      await expect(readout(page)).toHaveText('4 personer');
      // The units come with the overview, so the unit filter says they could not be read, on screen and aloud, and a
      // word typed in its search finds the same; never that the catalogue has pushed none.
      await filters(page)
        .getByRole('button', { name: /^Enhet/ })
        .click();
      const units = page.getByRole('listbox');
      await expect(units).toHaveText('Enheterna kunde inte läsas.');
      await expect.poll(() => announcements(page)).toContainEqual('Enheterna kunde inte läsas.');
      await page.keyboard.type('hem');
      await expect(units).toHaveText('Enheterna kunde inte läsas.');
      await page.keyboard.press('Escape');
      expect(await announcements(page)).not.toContainEqual('Katalogen har inte fört in några enheter.');
      expect(await announcements(page)).not.toContainEqual('Inga resultat hittades');
      // The capabilities are the contract's closed list, so that filter offers every one and narrows the list.
      const capability = filters(page).getByRole('combobox', { name: 'Behörighet' });
      await capability.focus();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('option')).toHaveText([
        'Administrera anslutna system',
        'Administrera användare',
        'Administrera utseende',
        'Administrera kompetenskatalogen',
      ]);
      await page.getByRole('option', { name: 'Administrera användare', exact: true }).click();
      await expect(page).toHaveURL(/\/admin\/users\?capability=admin\.users$/);
      await expect(readout(page)).toHaveText('1 av 4 personer');
      await expect(page.getByRole('table').first().locator('tbody tr')).toHaveText([/Mikael Lund/]);
      await expectNoAxeViolations(page);
    });
  });
  test.describe('phone', () => {
    test.use({ viewport: phone });
    test('the people are rows with unit and role on a line, narrowed and stepped through as on a desktop', async ({
      page,
      api,
    }) => {
      api.admin = true;
      api.people = [...usersPeople(), ...manyPeople()];
      await open(page, '/admin/users?role=manager');
      const people = page.getByRole('list', { name: 'Personer' }).getByRole('listitem');
      // The title first, as the catalogue words it (D110), then where the person is placed and what they are there.
      await expect(people).toHaveText([/Hillevi Berg.*Rektor.*Bergsåkers skola · chef/]);
      await page.getByRole('button', { name: 'Rensa filter' }).click();
      await expect(readout(page)).toHaveText('64 personer');
      await expect(people).toHaveCount(25);
      // The pager says where the list stands in words, since the numbered pages do not fit the width.
      await expect(pager(page)).toContainText('Sida 1 av 3');
      await pager(page).getByRole('button', { name: 'Gå till nästa sida' }).click();
      await expect(pager(page)).toContainText('Sida 2 av 3');
      await expect(people.first()).toContainText('Person 22');
      await expectNoAxeViolations(page);
    });
  });
  test.describe('1.4.10 reflow', () => {
    test('the page reflows at 320 px', async ({ page, api }) => {
      api.admin = true;
      api.people = [...usersPeople(), ...manyPeople()];
      await page.setViewportSize(narrow);
      // With a filter set and a pager under the list: the widest the list's own controls get.
      await open(page, '/admin/users?role=employee&status=not-signed-in');
      await expect(page.getByRole('list', { name: 'Personer' })).toBeVisible();
      await expect(filters(page).getByRole('combobox', { name: 'Status' })).toContainText('Status: Inte inloggad ännu');
      await expect(pager(page)).toContainText('Sida 1 av 3');
      await expect(page.getByRole('list', { name: 'Inläsning från katalogen' })).toContainText('Tyst i över två dygn');
      // A title longer than the column wraps inside its row (D110).
      await expect(page.getByRole('list', { name: 'Personer' })).toContainText('digitalisering och välfärdsteknik');
      expect(await reflowProblems(page)).toEqual([]);
    });
    test('the group picker reflows at 320 px, a long name and a long id wrapped inside their rows (K2)', async ({
      page,
      api,
    }) => {
      api.admin = true;
      api.users.groups.push(
        {
          id: 'S-1-5-21-socialforvaltningen-individ-och-familjeomsorg-handlaggare',
          label: 'Socialförvaltningen Individ- och familjeomsorg handläggare',
        },
        // An id with nothing to break at, as some catalogues key their groups.
        { id: 'b2c1f7e4a9d84f0c9e1a2b3c4d5e6f708b2c1f7e4a9d84f0c', label: 'Socialtjänstens beredskapsgrupp' },
      );
      await page.setViewportSize(narrow);
      await open(page, '/admin/users');
      await page.getByRole('combobox', { name: 'Grupp' }).focus();
      await page.keyboard.type('social');
      const options = page.getByRole('listbox', { name: 'Sökresultat' }).getByRole('option');
      await expect(options).toHaveCount(2);
      await expect(options.first()).toContainText('Socialförvaltningen Individ- och familjeomsorg handläggare');
      expect(await reflowProblems(page)).toEqual([]);
      await expectNoAxeViolations(page);
    });
    test('the dialog that shows a key reflows at 320 px, the key wrapped inside it (D107)', async ({ page, api }) => {
      api.admin = true;
      await page.setViewportSize(narrow);
      await open(page, '/admin/users');
      await page.getByRole('button', { name: 'Lägg till katalog' }).click();
      const dialog = page.getByRole('dialog', { name: 'Lägg till katalog' });
      await dialog.getByRole('textbox', { name: /^Namn/ }).fill('Nya Katalogen');
      expect(await reflowProblems(page)).toEqual([]);
      await dialog.getByRole('button', { name: 'Skapa nyckel' }).click();
      await expect(
        page.getByRole('alertdialog', { name: 'Lägg till katalog' }).getByText('a11y-key-nya-katalogen'),
      ).toBeVisible();
      expect(await reflowProblems(page)).toEqual([]);
      await expectNoAxeViolations(page);
    });
  });
});
