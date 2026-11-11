import type { Locator, Page } from '@playwright/test';
import type { EntityCard } from '@clew/contracts';
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
import { PRESENCE_LENS, TALK_LENS, entityDetail } from './data';
import { phonebook } from './phonebook';

/**
 * Personal (D94, D97, artboards A2, B and A3): the people the reader may ask about, one card per unit. "Alla" has the
 * two columns an administrator chose, each with its source under its label, "Just nu" with the marks of the chosen
 * sources, and each row's menu grouped by source. "Visa" picks a lens: the list is then that source's view, sorted by
 * need, under the source's heading. A source that does not answer is said once with Försök igen; someone who manages
 * nobody gets the page's empty state. Keyboard, structure, axe and reflow, at desktop, phone and 320 px.
 *
 * The mock (`data.ts`): Bergsåkers skola with Anna, Erik, Johan, Karin and Maria; Närvaro from Personalsystemet and
 * Nästa samtal from Utvecklingssamtal (Clew's own) as columns; the lenses Utvecklingssamtal (Karin's talk missing and
 * Johan's two late action points need the reader) and Frånvaro (nothing does); Boka samtal and Registrera frånvaro as
 * actions, each started on the server as a card; a card for Erik and for Johan to act on and a proposal for Karin.
 */
const LENS = `/staff?show=${TALK_LENS}`;
/**
 * Wide enough for the whole table beside the panel: "Alla" and the talk lens each need 1020 px for their table
 * (Astryx's floor for their columns), so the table stays beside the panel from 1780 px. The panel itself stands beside
 * the list from 1336 px, as on every page, and the list gives way to it below 1780 (`MIDDLE`); below 1336 the panel is
 * the drawer over the list.
 */
const WIDE = { width: 1840, height: 1000 };
const MIDDLE = { width: 1440, height: 900 };
const row = (page: Page, name: string) => page.getByRole('row').filter({ hasText: name });
/**
 * Johan with two cards to act on and one of Clew's proposals, as "Just nu" counts them, and one only for information.
 * His Behöver dig is the mock's cards that are still open, so a decision takes its card off his page.
 */
function severalCards(api: MockApi) {
  api.entityList = { ...api.entityList, attention: [{ key: 'johan', act: 2, proposals: 1 }] };
  const cards: EntityCard[] = [
    { threadId: 'ledighet', title: 'Ledighetsansökan från Johan Byström', source: 'Personalsystemet', kind: 'act' },
    {
      threadId: 'samtal-svar',
      title: 'En åtgärdspunkt skulle vara klar 3 nov',
      source: 'Utvecklingssamtal',
      kind: 'act',
    },
    { threadId: 'samtal', title: 'Planera utvecklingssamtal', source: 'Kalendern', kind: 'proposal' },
    { threadId: 'brandskydd', title: 'Intyg i HLR gick ut 15 sep', source: 'Kompetenssystemet', kind: 'fyi' },
  ];
  api.entityDetailOf = key => {
    if (key !== 'johan') return undefined;
    const johan = entityDetail(api.entityList, key)!;
    return { ...johan, cards: cards.filter(c => api.threads.find(t => t.id === c.threadId)?.state === 'open') };
  };
}
const showMenu = (page: Page) => page.getByRole('button', { name: /^Visa: / });
/** The section of a menu titled `title`: Astryx draws it as a named group. */
const section = (menu: Locator, title: string) => menu.getByRole('group', { name: title });
// Every test takes `api` (as `_` where it changes nothing): the fixture is what installs the mock.

test.describe('Personal', () => {
  for (const [layout, viewport] of [
    ['desktop', desktop],
    ['phone', phone],
  ] as const)
    test.describe(layout, () => {
      test.use({ viewport });
      for (const [what, path] of [
        ['Alla', '/staff'],
        ['a lens', LENS],
      ] as const)
        test(`${what} has no axe violations and every focus stop is marked`, async ({ page, api: _ }) => {
          await open(page, path);
          await expect(page.getByRole('heading', { level: 1, name: 'Personal' })).toBeVisible();
          await expect(page.getByRole('link', { name: 'Johan Byström' })).toBeVisible();
          await expectNoAxeViolations(page);
          const { unmarked } = await hiddenFocusStops(page);
          expect(unmarked).toEqual([]);
        });
      test('the Visa menu opens, chooses a lens and gives the focus back', async ({ page, api: _ }) => {
        await open(page, '/staff');
        const button = showMenu(page);
        await expect(button).toHaveText('Visa: Alla');
        await button.focus();
        await page.keyboard.press('Enter');
        const menu = page.getByRole('menu');
        await expect(menu.getByRole('menuitemradio', { name: 'Alla' })).toHaveAttribute('aria-checked', 'true');
        await expect(menu.getByText('Visa medarbetarna efter')).toBeVisible();
        await page.keyboard.press('ArrowDown');
        await expect(menu.getByRole('menuitemradio', { name: /^Utvecklingssamtal/ })).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL(LENS);
        await expect(menu).toBeHidden();
        await expect(showMenu(page)).toHaveText('Visa: Utvecklingssamtal');
        await expect(showMenu(page)).toBeFocused();
        await expect(page.getByRole('heading', { level: 2, name: 'Utvecklingssamtal 2026' })).toBeVisible();
      });
    });

  test.describe('desktop', () => {
    test.use({ viewport: desktop });
    test('a manager reaches it from the rail and sees the unit with its columns and marks', async ({
      page,
      api: _,
    }) => {
      await open(page, '/');
      const rail = page.getByRole('link', { name: 'Personal', exact: true });
      await rail.click();
      await expect(page).toHaveURL(/\/staff$/);
      await expect(page).toHaveTitle('Personal · Startsidan');
      await expect(page.getByRole('link', { name: 'Personal', exact: true })).toHaveAttribute('aria-current', 'page');
      await expect(page.getByText('5 medarbetare på Bergsåkers skola', { exact: true })).toBeVisible();
      await expect(page.getByRole('toolbar', { name: 'Bergsåkers skola' })).toContainText('5 medarbetare');
      const table = page.getByRole('table');
      await expect(table.getByRole('columnheader')).toHaveText([
        'Person',
        'NärvaroPersonalsystemet',
        'Nästa samtalUtvecklingssamtal',
        'Just nu',
        'Åtgärder',
      ]);
      await expect(table.getByRole('row').nth(1)).toContainText('Anna Lindqvist');
      // A column draws one field of the person's row from its source, a toned value as a badge.
      await expect(row(page, 'Erik Sandström').getByText('Sjuk · dag 1', { exact: true })).toBeVisible();
      await expect(row(page, 'Anna Lindqvist').getByText('I tjänst', { exact: true })).toBeVisible();
      await expect(row(page, 'Johan Byström').getByText('tors 12 nov', { exact: true })).toBeVisible();
      await expect(row(page, 'Karin Lindqvist').getByText('Inte bokat', { exact: true })).toBeVisible();
      // "Just nu" (artboard A2): the cards about the person as links, each opening the one card it counts beside the
      // list (D83 rule 1), then what needs the reader from the chosen sources and is not a column, with the source's words.
      const johanNow = row(page, 'Johan Byström').getByRole('cell').nth(3);
      await expect(johanNow.getByRole('link', { name: '1 att agera på' })).toHaveAttribute(
        'href',
        '/staff?card=samtal-svar',
      );
      await expect(johanNow.getByText('2 försenade', { exact: true })).toBeVisible();
      await expect(row(page, 'Erik Sandström').getByRole('link', { name: '1 att agera på' })).toHaveAttribute(
        'href',
        '/staff?card=omtanke',
      );
      // Karin's column already says her talk needs the reader ("Inte bokat"): no mark repeats it; her proposal is a link.
      const karinNow = row(page, 'Karin Lindqvist').getByRole('cell').nth(3);
      await expect(karinNow).toHaveText('1 förslag');
      await expect(karinNow.getByRole('link', { name: '1 förslag' })).toHaveAttribute('href', '/staff?card=samtal');
      await expect(row(page, 'Anna Lindqvist').getByRole('cell').nth(3)).toHaveText('');
      // A value without a tone is ordinary text, as the unit's name is, not the supporting text of its count.
      const colour = (where: Locator, text: string) =>
        where.getByText(text, { exact: true }).evaluate(el => getComputedStyle(el).color);
      const unit = page.getByRole('toolbar', { name: 'Bergsåkers skola' });
      const ordinary = await colour(unit, 'Bergsåkers skola');
      expect(ordinary).not.toBe(await colour(unit, '5 medarbetare'));
      expect(await colour(row(page, 'Anna Lindqvist'), 'I tjänst')).toBe(ordinary);
      expect(await colour(row(page, 'Anna Lindqvist'), 'mån 16 nov')).toBe(ordinary);
      // The name leads to the person's page, with the list as the way back.
      await expect(page.getByRole('link', { name: 'Johan Byström' })).toHaveAttribute(
        'href',
        '/people/johan?from=%2Fstaff',
      );
    });
    test("a column's heading reads in two lines, the label and its source, neither cut", async ({ page, api: _ }) => {
      await open(page, '/staff');
      const header = page.getByRole('columnheader', { name: 'Närvaro Personalsystemet' });
      await expect(header).toBeVisible();
      for (const text of ['Närvaro', 'Personalsystemet']) {
        const line = header.getByText(text, { exact: true });
        await expect(line).toBeVisible();
        expect(await line.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      }
      const [label, source] = await Promise.all(
        ['Närvaro', 'Personalsystemet'].map(t => header.getByText(t, { exact: true }).boundingBox()),
      );
      expect(source!.y).toBeGreaterThan(label!.y);
    });
    test('the Visa menu counts what needs the reader under each lens, and only that', async ({ page, api: _ }) => {
      await open(page, '/staff');
      await showMenu(page).click();
      const menu = page.getByRole('menu');
      await expect(section(menu, 'Visa medarbetarna efter').getByRole('menuitemradio')).toHaveText([
        /^Utvecklingssamtal/,
        /^Frånvaro/,
      ]);
      await expect(
        menu.getByRole('menuitemradio', { name: 'Utvecklingssamtal 2 medarbetare behöver dig' }),
      ).toBeVisible();
      await expect(menu.getByRole('menuitemradio', { name: 'Frånvaro', exact: true })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(showMenu(page)).toBeFocused();
    });
    test('a name leads to the person’s page under the lens, and the trail leads back to the list as it was', async ({
      page,
      api: _,
    }) => {
      await open(page, LENS);
      const name = page.getByRole('link', { name: 'Johan Byström' });
      await expect(name).toHaveAttribute('href', `/people/johan?from=${encodeURIComponent(LENS)}`);
      await name.click();
      await expect(page.getByRole('heading', { level: 1, name: 'Johan Byström' })).toBeVisible();
      await expect(page.getByRole('complementary')).toHaveCount(0);
      await page.getByRole('navigation', { name: 'Du är här' }).getByRole('link', { name: 'Personal' }).click();
      await expect(page).toHaveURL(LENS);
      await expect(showMenu(page)).toHaveText('Visa: Utvecklingssamtal');
    });
    test('“Just nu” with several cards leads to the person’s page at Behöver dig, with the list as the way back, and a card there opens beside that page', async ({
      page,
      api,
    }) => {
      severalCards(api);
      await page.setViewportSize(WIDE);
      await open(page, '/staff');
      // Each count leads to the same place, the person's Behöver dig, with the list as the way back.
      const counts = row(page, 'Johan Byström').getByRole('cell').nth(3).getByRole('link');
      await expect(counts).toHaveText(['2 att agera på', '1 förslag']);
      await expect(counts.nth(1)).toHaveAttribute('href', '/people/johan?section=needs-you&from=%2Fstaff');
      await counts.first().focus();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL('/people/johan?section=needs-you&from=%2Fstaff');
      await expect(page.getByRole('heading', { level: 1, name: 'Johan Byström' })).toBeVisible();
      await expect(page.getByRole('heading', { level: 2, name: 'Behöver dig' })).toBeVisible();
      // Nothing is open beside the page: the panel holds one opened thing, never a list of cards.
      await expect(page.getByRole('complementary')).toHaveCount(0);
      await expect(page.getByRole('dialog')).toHaveCount(0);
      const title = page.getByRole('main').getByRole('link', { name: 'En åtgärdspunkt skulle vara klar 3 nov' });
      await expect(title).toHaveAttribute('href', '/people/johan?section=needs-you&from=%2Fstaff&card=samtal-svar');
      await expectNoAxeViolations(page);
      // A card under Behöver dig opens beside the person's page; Esc gives the page back with the focus on its title.
      await title.focus();
      await page.keyboard.press('Enter');
      const card = page.getByRole('complementary', { name: 'Kort' });
      await expect(card.getByRole('article', { name: 'Kort: Planera utvecklingssamtal vecka 45' })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page).toHaveURL('/people/johan?section=needs-you&from=%2Fstaff');
      await expect(title).toBeFocused();
      // The trail leads back to Personal as it was.
      await page.getByRole('navigation', { name: 'Du är här' }).getByRole('link', { name: 'Personal' }).click();
      await expect(page).toHaveURL('/staff');
      await expect(page.getByRole('table')).toBeVisible();
    });
    test('an address that listed a person’s cards beside the list leads to their page at Behöver dig, in its place, a card kept', async ({
      page,
      api,
    }) => {
      severalCards(api);
      await page.setViewportSize(WIDE);
      await open(page, '/');
      await open(page, `${LENS}&cards=johan&cards-kind=proposal`);
      await expect(page).toHaveURL(`/people/johan?section=needs-you&from=${encodeURIComponent(LENS)}`);
      await expect(page.getByRole('heading', { level: 2, name: 'Behöver dig' })).toBeVisible();
      await expect(
        page.getByRole('navigation', { name: 'Du är här' }).getByRole('link', { name: 'Personal' }),
      ).toHaveAttribute('href', LENS);
      // The old address was replaced, not stepped through: Back is the page before it.
      await page.goBack();
      await expect(page).toHaveURL('/');
      // A card open over the old list stays open, beside the person's page.
      await open(page, '/staff?cards=johan&cards-kind=act&card=samtal-svar');
      await expect(page).toHaveURL('/people/johan?section=needs-you&from=%2Fstaff&card=samtal-svar');
      await expect(
        page
          .getByRole('complementary', { name: 'Kort' })
          .getByRole('article', { name: 'Kort: Planera utvecklingssamtal vecka 45' }),
      ).toBeVisible();
    });
    test('a decision on a card beside the list reads the list again', async ({ page, api }) => {
      severalCards(api);
      await page.setViewportSize(WIDE);
      await open(page, '/staff?card=ledighet');
      const card = page.getByRole('complementary', { name: 'Kort' });
      const before = api.entityReads.length;
      await card.getByRole('button', { name: 'Godkänn', exact: true }).click();
      await expect.poll(() => api.entityReads.slice(before)).toEqual(expect.arrayContaining(['/entities/person']));
      await expect(page.getByRole('table')).toBeVisible();
    });
    test('“Just nu” opens the one card beside the list, which stays; ✕ and Esc give the focus back to the link', async ({
      page,
      api: _,
    }) => {
      await page.setViewportSize(WIDE);
      await open(page, '/staff');
      const link = row(page, 'Erik Sandström').getByRole('link', { name: '1 att agera på' });
      await link.focus();
      await page.keyboard.press('Enter');
      // The list's own page stays: the address, the title and the heading are Personal's, and the card is beside it.
      await expect(page).toHaveURL('/staff?card=omtanke');
      await expect(page).toHaveTitle('Personal · Startsidan');
      await expect(page.getByRole('heading', { level: 1, name: 'Personal' })).toBeVisible();
      const panel = page.getByRole('complementary', { name: 'Kort' });
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(panel.locator('[aria-level="2"]').filter({ hasText: 'Kort' })).toBeFocused();
      // The card says what it asks and why before anything is decided: its title, its lead, its steps.
      await expect(panel.getByRole('article', { name: 'Kort: Omtankesamtal med Anna Lindqvist' })).toBeVisible();
      await expect(panel.locator('[aria-level="3"]')).toHaveText(['Omtankesamtal med Anna Lindqvist']);
      await expect(panel.getByText('Tre korta sjukperioder sedan juni.', { exact: false })).toBeVisible();
      await expect(panel.getByRole('button', { name: 'Boka samtalet' })).toBeVisible();
      await expect(panel.getByRole('button', { name: 'Se mönstret' })).toBeVisible();
      // Personal has no question box, so nothing offers to add the card to one (D110 rule 6).
      await expect(panel.getByRole('button', { name: 'Inte nu', exact: true }).first()).toBeVisible();
      await expect(page.getByRole('button', { name: 'Lägg till i samtalet' })).toHaveCount(0);
      // Beside the card the list is whole, as it was.
      await expect(page.getByRole('table')).toBeVisible();
      await expect(row(page, 'Erik Sandström').getByText('Sjuk · dag 1', { exact: true })).toBeVisible();
      await expectNoAxeViolations(page);
      await panel.getByRole('button', { name: 'Stäng panelen' }).click();
      await expect(page).toHaveURL(/\/staff$/);
      await expect(page.getByRole('complementary', { name: 'Kort' })).toHaveCount(0);
      await expect(link).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(panel.locator('[aria-level="2"]').filter({ hasText: 'Kort' })).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(page).toHaveURL(/\/staff$/);
      await expect(link).toBeFocused();
    });
    test('a card’s own read unfolds in the card beside the list, which stays whole, and folds again', async ({
      page,
      api: _,
    }) => {
      await page.setViewportSize(WIDE);
      await open(page, '/staff?card=omtanke');
      const card = page.getByRole('complementary', { name: 'Kort' });
      const button = card.locator('[data-read="pattern"]');
      await button.click();
      await expect(page).toHaveURL('/staff?card=omtanke&open-card=omtanke&open-action=pattern');
      const section = card.locator('#read-card-omtanke');
      await expect(section.getByText('Anna Lindqvist 07:00–16:00')).toBeVisible();
      await expect(button).toBeFocused();
      // The card, its decision and the list stay where they were: nothing took the card's place.
      await expect(card.getByRole('article', { name: 'Kort: Omtankesamtal med Anna Lindqvist' })).toBeVisible();
      await expect(card.getByRole('button', { name: 'Boka samtalet' })).toBeVisible();
      await expect(page.getByRole('complementary')).toHaveCount(1);
      await expect(page.getByRole('table')).toBeVisible();
      await expectNoAxeViolations(page);
      await section.getByRole('button', { name: 'Se mönstret' }).click();
      await expect(page).toHaveURL('/staff?card=omtanke');
      await expect(section).toHaveCount(0);
      await expect(button).toBeFocused();
    });
    test('a row in a card’s read beside the list leads to its own view in the card’s place, and Tillbaka to the card with its read', async ({
      page,
      api,
    }) => {
      // The read answers with a declared list whose rows each have a view of their own: the phone book's team, each
      // person with a contact card.
      const team = await phonebook('phonebook.team', {});
      if (!('output' in team.body)) throw new Error(team.body.error);
      api.cardReads.pattern = team.body;
      await page.setViewportSize(WIDE);
      await open(page, '/staff?card=omtanke&open-card=omtanke&open-action=pattern');
      const card = page.getByRole('complementary', { name: 'Kort' });
      const name = card.locator('#read-card-omtanke').getByRole('list').getByRole('link').first();
      // Personal's own address with the row's view in the panel, over the card, which keeps its read under it.
      await expect(name).toHaveAttribute(
        'href',
        /^\/staff\?card=omtanke&open-card=omtanke&open-action=pattern&open=phonebook\.person&open-title=Kontaktkort&open-input=[^&]+&via=1$/,
      );
      await expectNoAxeViolations(page);
      await name.focus();
      await page.keyboard.press('Enter');
      const contact = page.getByRole('complementary', { name: 'Kontaktkort' });
      await expect(contact.getByRole('heading', { level: 2, name: 'Kontaktkort' })).toBeFocused();
      await expect(page.getByRole('heading', { level: 1, name: 'Personal' })).toBeVisible();
      await expect(page.getByRole('complementary')).toHaveCount(1);
      // The way back is the view's own, and the focus lands on the row that led away, in the card's read.
      await contact.getByRole('button', { name: 'Tillbaka' }).click();
      await expect(page).toHaveURL('/staff?card=omtanke&open-card=omtanke&open-action=pattern');
      await expect(name).toBeFocused();
    });
    test('a read that answers with a table opens in the card’s place, as every read did before, and ✕ folds it back into the card', async ({
      page,
      api,
    }) => {
      // The one kind of view a card's read declares that the panel's width does not hold yet (`unfoldsInCard`): the
      // phone book's directory, a table, each person with a contact card.
      const directory = await phonebook('phonebook.directory', { query: 'lärare' });
      if (!('output' in directory.body)) throw new Error(directory.body.error);
      api.cardReads.pattern = directory.body;
      await page.setViewportSize(WIDE);
      await open(page, '/staff?card=omtanke');
      await page.getByRole('complementary', { name: 'Kort' }).locator('[data-read="pattern"]').click();
      await expect(page).toHaveURL('/staff?card=omtanke&open-card=omtanke&open-action=pattern');
      const read = page.getByRole('complementary', { name: 'Se mönstret' });
      await expect(read.getByRole('heading', { level: 2, name: 'Se mönstret' })).toBeFocused();
      await expect(page.getByRole('complementary')).toHaveCount(1);
      const name = read.getByRole('link', { name: 'Anna Lindqvist' });
      await expect(name).toHaveAttribute(
        'href',
        /^\/staff\?card=omtanke&open-card=omtanke&open-action=pattern&open=phonebook\.person&open-title=Kontaktkort&open-input=[^&]+&via=1$/,
      );
      await expectNoAxeViolations(page);
      await name.focus();
      await page.keyboard.press('Enter');
      const contact = page.getByRole('complementary', { name: 'Kontaktkort' });
      await expect(contact.getByRole('link', { name: '0980-319 203' })).toBeVisible();
      await contact.getByRole('button', { name: 'Tillbaka' }).click();
      await expect(page).toHaveURL('/staff?card=omtanke&open-card=omtanke&open-action=pattern');
      await expect(name).toBeFocused();
      await read.getByRole('button', { name: 'Stäng panelen' }).click();
      await expect(page).toHaveURL('/staff?card=omtanke');
      const card = page.getByRole('complementary', { name: 'Kort' });
      await expect(card.getByRole('article', { name: 'Kort: Omtankesamtal med Anna Lindqvist' })).toBeVisible();
      await expect(card.locator('#read-card-omtanke')).toHaveCount(0);
    });
    test('the panel stands beside Personal from 1336 px on the window’s edge, and the list gives way to it', async ({
      page,
      api: _,
    }) => {
      // How far the table would scroll sideways inside its own region: never, beside the panel or not.
      const sideways = () =>
        page.getByRole('table').evaluate(el => {
          let n: HTMLElement | null = el.parentElement;
          while (n && !/(auto|scroll)/.test(getComputedStyle(n).overflowX)) n = n.parentElement;
          return n ? n.scrollWidth - n.clientWidth : 0;
        });
      const pageSideways = () => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      // From 1780 px the whole table keeps its 1020 px beside the panel, which docks to the window's edge (it is not
      // framed with the list); it stood 120 px in from the edge when it was.
      for (const width of [1780, 1840]) {
        await page.setViewportSize({ width, height: 1000 });
        await open(page, '/staff?card=omtanke');
        const panel = page.getByRole('complementary', { name: 'Kort' });
        await expect(panel).toBeVisible();
        const box = (await panel.boundingBox())!;
        expect(Math.round(box.x + box.width)).toBe(width);
        const table = (await page.getByRole('table').boundingBox())!;
        // The list takes what is left of the page beside the panel, less the page's padding.
        expect(Math.round(table.x + table.width)).toBeLessThanOrEqual(Math.round(box.x));
        expect(Math.round(table.x + table.width)).toBeGreaterThan(Math.round(box.x) - 64);
        expect(await sideways()).toBeLessThanOrEqual(0);
      }
      // Below that, down to the one width every page has, the panel still stands beside the list, and the list is the
      // rows it is on a phone, with every name, mark and menu: the page gives way, the panel does not.
      for (const [width, lens] of [
        [1779, '/staff'],
        [1440, LENS],
        [1336, '/staff'],
      ] as const) {
        await page.setViewportSize({ width, height: 900 });
        await open(page, `${lens}${lens.includes('?') ? '&' : '?'}card=omtanke`);
        const panel = page.getByRole('complementary', { name: 'Kort' });
        await expect(panel.getByRole('article', { name: 'Kort: Omtankesamtal med Anna Lindqvist' })).toBeVisible();
        const box = (await panel.boundingBox())!;
        expect(Math.round(box.x + box.width)).toBe(width);
        await expect(page.getByRole('dialog')).toHaveCount(0);
        await expect(page.getByRole('table')).toHaveCount(0);
        const school = page.getByRole('list', { name: 'Bergsåkers skola' });
        await expect(school.getByRole('link', { name: 'Johan Byström' })).toBeVisible();
        await expect(school.getByRole('button', { name: 'Åtgärder för Johan Byström' })).toBeVisible();
        expect(await pageSideways()).toBe(false);
        if (width === 1440) await expectNoAxeViolations(page);
      }
      // Closed, the list is the table again.
      await page.keyboard.press('Escape');
      await expect(page.getByRole('complementary', { name: 'Kort' })).toHaveCount(0);
      await expect(page.getByRole('table')).toBeVisible();
      // A pixel narrower than 1336 px the panel is the drawer over the list, as on every page.
      await page.setViewportSize({ width: 1335, height: 900 });
      await open(page, '/staff?card=omtanke');
      await expect(page.getByRole('dialog', { name: 'Kort' })).toBeVisible();
      await expect(page.getByRole('complementary', { name: 'Kort' })).toHaveCount(0);
      await expect(page.getByRole('table')).toBeVisible();
      await page.setViewportSize({ width: 1720, height: 1000 });
      await open(page, '/staff');
      const table = (await page.getByRole('table').boundingBox())!;
      expect(Math.round(table.width)).toBeLessThanOrEqual(1152);
      expect(Math.round(table.width)).toBeGreaterThan(1100);
      expect(await pageSideways()).toBe(false);
    });
    test('opened from “Just nu” in a window where the table and the panel do not both fit, the card stands beside the rows, and Esc gives the table back with the focus on the link', async ({
      page,
      api: _,
    }) => {
      await page.setViewportSize(MIDDLE);
      await open(page, '/staff');
      await expect(page.getByRole('table')).toBeVisible();
      await row(page, 'Erik Sandström').getByRole('link', { name: '1 att agera på' }).focus();
      await page.keyboard.press('Enter');
      const panel = page.getByRole('complementary', { name: 'Kort' });
      await expect(panel.locator('[aria-level="2"]').filter({ hasText: 'Kort' })).toBeFocused();
      await expect(page.getByRole('table')).toHaveCount(0);
      const erik = page
        .getByRole('list', { name: 'Bergsåkers skola' })
        .getByRole('listitem')
        .filter({ hasText: 'Erik Sandström' });
      await expect(erik.getByRole('link', { name: '1 att agera på' })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page).toHaveURL(/\/staff$/);
      await expect(page.getByRole('table')).toBeVisible();
      await expect(row(page, 'Erik Sandström').getByRole('link', { name: '1 att agera på' })).toBeFocused();
    });
    test('beside an open card a name still leads to the person’s page, with the list without the card as the way back', async ({
      page,
      api: _,
    }) => {
      await page.setViewportSize(WIDE);
      await open(page, `${LENS}&card=omtanke`);
      await expect(page.getByRole('complementary', { name: 'Kort' })).toBeVisible();
      await expect(page.getByRole('main').getByRole('link', { name: 'Johan Byström' })).toHaveAttribute(
        'href',
        `/people/johan?from=${encodeURIComponent(LENS)}`,
      );
    });
    test('an address that names a card the reader does not have says so in the card’s place', async ({
      page,
      api: _,
    }) => {
      await page.setViewportSize(WIDE);
      await open(page, '/staff?card=finns-inte');
      const panel = page.getByRole('complementary', { name: 'Kort' });
      await expect(panel.getByText('Kortet finns inte längre bland dina kort.')).toBeVisible();
      await panel.getByRole('button', { name: 'Stäng panelen' }).click();
      await expect(page).toHaveURL(/\/staff$/);
      await expect(page.getByRole('table')).toBeVisible();
    });
    test('under a lens the list is its view, sorted by need, under the source’s heading and counts', async ({
      page,
      api: _,
    }) => {
      await open(page, '/staff');
      await showMenu(page).click();
      await page.getByRole('menuitemradio', { name: /^Utvecklingssamtal/ }).click();
      await expect(page).toHaveURL(LENS);
      await expect(page).toHaveTitle('Personal · Startsidan');
      await expect(page.getByRole('heading', { level: 2, name: 'Utvecklingssamtal 2026' })).toBeVisible();
      // Done first, then the plain, then what needs the reader; Clew's own domain named as Clew (artboard B).
      await expect(
        page.getByText('Senast lör 28 nov · 1 hållet, 3 bokat, 1 saknas · Clew', { exact: true }),
      ).toBeVisible();
      const table = page.getByRole('table');
      // Two cells, as the view places its fields: the time beside the state, the late points beside the open ones, and
      // the next talk, the row in one value, left out where the whole row is drawn (D97).
      await expect(table.getByRole('columnheader')).toHaveText(['Person', 'Samtal', 'Åtgärdspunkter', 'Åtgärder']);
      // A state that needs the reader first (Karin's missing talk), then another field that does (Johan's late
      // points), then the rest, each in the directory's order.
      const names = table.getByRole('row').locator('a');
      await expect(names).toHaveText([
        'Karin Lindqvist',
        'Johan Byström',
        'Anna Lindqvist',
        'Erik Sandström',
        'Maria Källström',
      ]);
      const johan = row(page, 'Johan Byström').getByRole('cell');
      await expect(johan.nth(1).getByText('Bokat', { exact: true })).toBeVisible();
      await expect(johan.nth(1).getByText('tors 12 nov. kl. 09:00', { exact: true })).toBeVisible();
      await expect(johan.nth(2).getByText('3 öppna', { exact: true })).toBeVisible();
      await expect(johan.nth(2).getByText('2 försenade', { exact: true })).toBeVisible();
      // The time beside the badge is supporting text; the count that leads its cell is ordinary text.
      const colour = (cell: number, text: string) =>
        johan
          .nth(cell)
          .getByText(text, { exact: true })
          .evaluate(el => getComputedStyle(el).color);
      expect(await colour(1, 'tors 12 nov. kl. 09:00')).not.toBe(await colour(2, '3 öppna'));
      await expect(row(page, 'Karin Lindqvist').getByText('Saknas', { exact: true })).toBeVisible();
      const maria = row(page, 'Maria Källström');
      await expect(maria.getByText('Hållet', { exact: true })).toBeVisible();
      // A day without a time is the day alone.
      await expect(maria.getByText('ons 4 nov.', { exact: true })).toBeVisible();
      // "Alla" is one step back.
      await page.goBack();
      await expect(page).toHaveURL('/staff');
      await expect(showMenu(page)).toHaveText('Visa: Alla');
    });
    test('a person the lens has no row for comes last with nothing in its columns', async ({ page, api }) => {
      api.entityRows[TALK_LENS]!.rows = api.entityRows[TALK_LENS]!.rows.filter(r => r.key !== 'anna');
      await open(page, LENS);
      const names = page.getByRole('table').getByRole('row').locator('a');
      await expect(names.last()).toHaveText('Anna Lindqvist');
      const anna = row(page, 'Anna Lindqvist').getByRole('cell');
      for (const i of [1, 2]) await expect(anna.nth(i)).toHaveText('');
    });
    test("the row's menu is named for the person and grouped by source, the lens's own first", async ({
      page,
      api,
    }) => {
      await page.setViewportSize(WIDE);
      await open(page, '/staff');
      await page.getByRole('button', { name: 'Åtgärder för Karin Lindqvist' }).click();
      let menu = page.getByRole('menu');
      // What can be done about the person, by system; never a choice of where Clew shows them.
      await expect(menu.getByRole('menuitem', { name: 'Visa bredvid' })).toHaveCount(0);
      await expect(menu.getByRole('group')).toHaveText([/^Utvecklingssamtal/, /^Personalsystemet/]);
      const talk = section(menu, 'Utvecklingssamtal');
      await expect(talk.getByRole('menuitem')).toHaveText(['Boka samtal', 'Öppna samtalet']);
      await expect(talk.getByRole('menuitem', { name: 'Öppna samtalet' })).toHaveAttribute('href', '/staff?talk=karin');
      await expect(section(menu, 'Personalsystemet').getByRole('menuitem')).toHaveText(['Registrera frånvaro']);
      await page.keyboard.press('Escape');
      await expect(page.getByRole('button', { name: 'Åtgärder för Karin Lindqvist' })).toBeFocused();
      // Under Frånvaro its source leads, and a page way in keeps the lens in the address.
      await open(page, `/staff?show=${PRESENCE_LENS}`);
      await page.getByRole('button', { name: 'Åtgärder för Karin Lindqvist' }).click();
      menu = page.getByRole('menu');
      await expect(menu.getByRole('group')).toHaveText([/^Personalsystemet/, /^Utvecklingssamtal/]);
      await expect(menu.getByRole('menuitem', { name: 'Öppna samtalet' })).toHaveAttribute(
        'href',
        `/staff?show=${PRESENCE_LENS}&talk=karin`,
      );
      // An action starts on the server without the model, and its card opens beside the list it was started on, with
      // the lens kept and the focus on the card (D110 rule 4): Personal never gives way to Hem.
      await menu.getByRole('menuitem', { name: 'Boka samtal' }).click();
      await expect(page).toHaveURL(`/staff?show=${PRESENCE_LENS}&card=entity-clew-bookTalk-karin`);
      expect(api.entityStarts).toEqual([{ key: 'karin', capability: 'clew.bookTalk' }]);
      expect(api.asked).toEqual([]);
      await expect(page.getByRole('heading', { level: 1, name: 'Personal' })).toBeVisible();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      const card = page.getByRole('complementary', { name: 'Kort' });
      await expect(card.getByText('Boka samtal: Karin Lindqvist').first()).toBeVisible();
      await expect(card.locator('[aria-level="2"]').filter({ hasText: 'Kort' })).toBeFocused();
      await expectNoAxeViolations(page);
      // Closing leaves the list as it was, under its lens, and gives the focus back to the row's menu button, which
      // stood whole beside the card all along.
      await page.keyboard.press('Escape');
      await expect(page).toHaveURL(`/staff?show=${PRESENCE_LENS}`);
      await expect(card).toHaveCount(0);
      await expect(showMenu(page)).toHaveText('Visa: Frånvaro');
      await expect(page.getByRole('button', { name: 'Åtgärder för Karin Lindqvist' })).toBeFocused();
    });
    test("an action's card in a window narrower than 1336 px is the drawer over the list, and closing it gives the focus back to the row's menu", async ({
      page,
      api,
    }) => {
      await open(page, '/staff');
      const menuButton = page.getByRole('button', { name: 'Åtgärder för Karin Lindqvist' });
      await menuButton.click();
      await page.getByRole('menuitem', { name: 'Boka samtal' }).click();
      await expect(page).toHaveURL('/staff?card=entity-clew-bookTalk-karin');
      expect(api.entityStarts).toEqual([{ key: 'karin', capability: 'clew.bookTalk' }]);
      const drawer = page.getByRole('dialog', { name: 'Kort' });
      await expect(drawer.getByText('Boka samtal: Karin Lindqvist').first()).toBeVisible();
      await expect(page.getByRole('complementary')).toHaveCount(0);
      await page.keyboard.press('Escape');
      await expect(page).toHaveURL('/staff');
      await expect(drawer).toHaveCount(0);
      await expect(menuButton).toBeFocused();
    });
    test('a source that refuses an action says why, aloud and over the list, and nothing opens', async ({
      page,
      api,
    }) => {
      const refusal = 'Personalsystemet hittar ingen anställning för Karin Lindqvist.';
      api.entityRefusals['hr.registerAbsence'] = refusal;
      await open(page, '/staff');
      await page.getByRole('button', { name: 'Åtgärder för Karin Lindqvist' }).click();
      await page.getByRole('menuitem', { name: 'Registrera frånvaro' }).click();
      await expect(page.getByRole('main').getByText(refusal, { exact: true })).toBeVisible();
      await expect.poll(async () => (await announcements(page)).filter(a => a.includes(refusal))).toHaveLength(1);
      await expect(page).toHaveURL('/staff');
      expect(api.entityStarts).toEqual([{ key: 'karin', capability: 'hr.registerAbsence' }]);
      await expect(page.getByRole('button', { name: 'Åtgärder för Karin Lindqvist' })).toBeFocused();
      await expectNoAxeViolations(page);
    });
    test('a source that does not answer is said once, its column stays empty, and Försök igen asks again', async ({
      page,
      api,
    }) => {
      api.entitySilent[PRESENCE_LENS] = 'timeout';
      await open(page, '/staff');
      const said = page.getByText('Personalsystemet svarade inte i tid.', { exact: true });
      await expect(said).toHaveCount(1);
      await expect(row(page, 'Erik Sandström').getByRole('cell').nth(1)).toHaveText('');
      // The other source stands.
      await expect(row(page, 'Johan Byström').getByText('2 försenade', { exact: true })).toBeVisible();
      await expect
        .poll(async () => (await announcements(page)).filter(a => a.includes('Personalsystemet svarade inte')))
        .toHaveLength(1);
      await expectNoAxeViolations(page);
      delete api.entitySilent[PRESENCE_LENS];
      await page.getByRole('button', { name: 'Försök igen' }).click();
      await expect(said).toHaveCount(0);
      await expect(row(page, 'Erik Sandström').getByText('Sjuk · dag 1', { exact: true })).toBeVisible();
    });
    test('under a lens whose source does not answer the sentence takes the table’s place', async ({ page, api }) => {
      api.entitySilent[PRESENCE_LENS] = 'unavailable';
      await open(page, `/staff?show=${PRESENCE_LENS}`);
      await expect(page.getByRole('heading', { level: 2, name: 'Frånvaro' })).toBeVisible();
      await expect(page.getByText('Personalsystemet svarade inte.', { exact: true })).toHaveCount(1);
      await expect(page.getByRole('table')).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Försök igen' })).toBeVisible();
      await expectNoAxeViolations(page);
    });
    test('an address that drew a person beside the list leads to their page, with the list as the way back', async ({
      page,
      api: _,
    }) => {
      await open(page, `${LENS}&person=johan`);
      await expect(page).toHaveURL(`/people/johan?from=${encodeURIComponent(LENS)}`);
      await expect(page.getByRole('heading', { level: 1, name: 'Johan Byström' })).toBeVisible();
      await expect(
        page.getByRole('navigation', { name: 'Du är här' }).getByRole('link', { name: 'Personal' }),
      ).toHaveAttribute('href', LENS);
      // The section drilled into on a phone is the page's section, and a card open over the person stays open.
      await open(page, '/staff?person=johan&person-section=needs-you&card=samtal-svar');
      await expect(page).toHaveURL('/people/johan?section=needs-you&from=%2Fstaff&card=samtal-svar');
      await expect(page.getByRole('heading', { level: 2, name: 'Behöver dig' })).toBeVisible();
      await expect(
        page
          .getByRole('dialog', { name: 'Kort' })
          .getByRole('article', { name: 'Kort: Planera utvecklingssamtal vecka 45' }),
      ).toBeVisible();
    });
    test('a card and its read beside the list log no React error (on the development build, which reports them)', async ({
      page,
      api: _,
    }) => {
      // The production build stays quiet about props that reach the DOM; the web app's development server, which the
      // suite runs for the shared header's stand-in, warns. Its first load may reload once while it prepares modules.
      test.setTimeout(90_000);
      const errors: string[] = [];
      page.on('console', m => {
        if (m.type() === 'error') errors.push(m.text());
      });
      page.on('pageerror', e => errors.push(e.message));
      await page.setViewportSize(MIDDLE);
      const dev = 'http://localhost:4175';
      await page.goto(`${dev}${LENS}&card=omtanke`);
      const card = page.getByRole('complementary', { name: 'Kort' });
      await expect(card.locator('[data-read="pattern"]')).toBeVisible({ timeout: 60_000 });
      errors.length = 0;
      await page.goto(`${dev}${LENS}&card=omtanke`);
      // The read unfolded and folded in the card, and the card closed: Personal's table again.
      await card.locator('[data-read="pattern"]').click();
      await expect(card.locator('#read-card-omtanke').getByText('Anna Lindqvist 07:00–16:00')).toBeVisible();
      await card.locator('[data-read="pattern"]').click();
      await expect(card.locator('#read-card-omtanke')).toHaveCount(0);
      await page.keyboard.press('Escape');
      await expect(page.getByRole('complementary', { name: 'Kort' })).toHaveCount(0);
      await expect(page.getByRole('table')).toBeVisible();
      expect(errors).toEqual([]);
    });
    test('someone who manages nobody gets the page’s empty state and the way back', async ({ page, api }) => {
      api.entitiesEmpty = true;
      await open(page, '/staff');
      await expect(page.getByRole('heading', { level: 2, name: 'Inga medarbetare att visa' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Till startsidan' })).toBeVisible();
      await expect(showMenu(page)).toHaveCount(0);
      await expect(page.getByRole('table')).toHaveCount(0);
      await expectNoAxeViolations(page);
    });
  });

  test.describe('phone', () => {
    test.use({ viewport: phone });
    test('each unit is a list: the name, the columns’ words, the marks and the menu', async ({ page, api: _ }) => {
      await open(page, '/staff');
      const school = page.getByRole('list', { name: 'Bergsåkers skola' });
      const johan = school.getByRole('listitem').filter({ hasText: 'Johan Byström' });
      await expect(johan.getByRole('link', { name: 'Johan Byström' })).toHaveAttribute(
        'href',
        '/people/johan?from=%2Fstaff',
      );
      await expect(johan.getByText('2 försenade', { exact: true })).toBeVisible();
      await expect(
        johan.getByText('Närvaro: I tjänst · Nästa samtal: tors 12 nov · 1 att agera på', { exact: true }),
      ).toBeVisible();
      await expect(johan.getByRole('link', { name: '1 att agera på' })).toHaveAttribute(
        'href',
        '/staff?card=samtal-svar',
      );
      // A toned column value is a badge, as on the table, and the same source marks nothing more.
      const karin = school.getByRole('listitem').filter({ hasText: 'Karin Lindqvist' });
      await expect(karin.getByText('Inte bokat', { exact: true })).toBeVisible();
      await expect(karin.getByText('Samtal saknas', { exact: true })).toHaveCount(0);
      await expect(karin.getByRole('link', { name: '1 förslag' })).toBeVisible();
      await expect(johan.getByRole('button', { name: 'Åtgärder för Johan Byström' })).toBeVisible();
    });
    test('“Just nu” opens the card in the drawer over the list, and closing it returns to the list', async ({
      page,
      api: _,
    }) => {
      await open(page, '/staff');
      const school = page.getByRole('list', { name: 'Bergsåkers skola' });
      const erik = school.getByRole('listitem').filter({ hasText: 'Erik Sandström' });
      await erik.getByRole('link', { name: '1 att agera på' }).click();
      await expect(page).toHaveURL('/staff?card=omtanke');
      const drawer = page.getByRole('dialog', { name: 'Kort' });
      await expect(drawer.getByRole('heading', { name: 'Omtankesamtal med Anna Lindqvist' })).toBeVisible();
      await expect(drawer.getByRole('button', { name: 'Boka samtalet' })).toBeVisible();
      await expectNoAxeViolations(page);
      await page.keyboard.press('Escape');
      await expect(page).toHaveURL(/\/staff$/);
      await expect(drawer).toHaveCount(0);
      await expect(erik.getByRole('link', { name: '1 att agera på' })).toBeFocused();
    });
    test('several cards lead to the person’s page at Behöver dig, and a card there opens over it', async ({
      page,
      api,
    }) => {
      severalCards(api);
      await open(page, '/staff');
      const johan = page
        .getByRole('list', { name: 'Bergsåkers skola' })
        .getByRole('listitem')
        .filter({ hasText: 'Johan Byström' });
      await johan.getByRole('link', { name: '2 att agera på' }).click();
      await expect(page).toHaveURL('/people/johan?section=needs-you&from=%2Fstaff');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      const title = page.getByRole('main').getByRole('link', { name: 'En åtgärdspunkt skulle vara klar 3 nov' });
      await title.click();
      const card = page.getByRole('dialog', { name: 'Kort' });
      await expect(card.getByRole('article', { name: 'Kort: Planera utvecklingssamtal vecka 45' })).toBeVisible();
      await page.evaluate(() => Promise.all(document.getAnimations().map(a => a.finished)));
      await expectNoAxeViolations(page);
      await page.keyboard.press('Escape');
      await expect(page).toHaveURL('/people/johan?section=needs-you&from=%2Fstaff');
      await expect(title).toBeFocused();
    });
    test('the Visa menu works on a phone and the lens draws its rows by need', async ({ page, api: _ }) => {
      await open(page, '/staff');
      await showMenu(page).click();
      await page.getByRole('menuitemradio', { name: /^Utvecklingssamtal/ }).click();
      await expect(page).toHaveURL(LENS);
      const school = page.getByRole('list', { name: 'Bergsåkers skola' });
      await expect(school.getByRole('listitem').first()).toContainText('Karin Lindqvist');
      const karin = school.getByRole('listitem').filter({ hasText: 'Karin Lindqvist' });
      await expect(karin.getByText('Saknas', { exact: true })).toBeVisible();
      await expect(karin.getByText('Åtgärdspunkter: Inga', { exact: true })).toBeVisible();
      // A word beside a badge follows without a label of its own; the late points stand beside the open ones.
      const johan = school.getByRole('listitem').filter({ hasText: 'Johan Byström' });
      await expect(johan.getByText('tors 12 nov. kl. 09:00 · Åtgärdspunkter: 3 öppna', { exact: true })).toBeVisible();
      await expect(johan.getByText('2 försenade', { exact: true })).toBeVisible();
    });
  });

  test.describe('1.4.10 reflow', () => {
    for (const [what, path] of [
      ['Alla', '/staff'],
      ['a lens', LENS],
    ] as const)
      test(`${what} reflows at 320 px`, async ({ page, api: _ }) => {
        await page.setViewportSize(narrow);
        await open(page, path);
        await expect(page.getByRole('list', { name: 'Bergsåkers skola' })).toBeVisible();
        expect(await reflowProblems(page)).toEqual([]);
      });
    test('a card over the list with its read unfolded reflows at 320 px', async ({ page, api: _ }) => {
      await page.setViewportSize(narrow);
      await open(page, '/staff?card=omtanke&open-card=omtanke&open-action=pattern');
      const drawer = page.getByRole('dialog', { name: 'Kort' });
      await expect(drawer.locator('#read-card-omtanke').getByText('Anna Lindqvist 07:00–16:00')).toBeVisible();
      await expect(drawer.getByRole('button', { name: 'Boka samtalet' })).toBeVisible();
      await page.evaluate(() => Promise.all(document.getAnimations().map(a => a.finished)));
      expect(await reflowProblems(page, drawer)).toEqual([]);
      expect(await reflowProblems(page)).toEqual([]);
      await expectNoAxeViolations(page);
    });
  });
});
