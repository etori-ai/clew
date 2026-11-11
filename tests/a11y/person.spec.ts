import type { Page } from '@playwright/test';
import {
  announcements,
  expect,
  expectNoAxeViolations,
  hiddenFocusStops,
  narrow,
  open,
  reflowProblems,
  test,
} from './support';
import { PRESENCE_LENS, SILENT_SECTION, TALK_LENS } from './data';
import { CONTACT, People } from './person-data';

/**
 * The opened person (D97 item 5): beside Personal in the panel (artboard C), as a page (C2), on a phone (D) and read
 * by a colleague (G). The shared mock answers the list; `person-data.ts` answers the person and their sections, with
 * Kontakt and the talk's action points beside the mock's sources and Kompetenssystemet silent until a test lets it
 * answer. Keyboard, focus, announcements, axe and reflow.
 */
const wide = { width: 1440, height: 900 };
const phoneSize = { width: 390, height: 844 };
const rowLink = (page: Page, name: string) => page.getByRole('main').getByRole('link', { name, exact: true }).first();
const panelOf = (page: Page, name = 'Johan Byström') => page.getByRole('complementary', { name });
const said = async (page: Page, text: string) => (await announcements(page)).filter(t => t.includes(text)).length;

test.describe('the person beside Personal', () => {
  test.use({ viewport: wide });

  test('the person beside the list takes the focus on their name; ✕ and Esc give it to the row’s name', async ({
    page,
    api: _,
  }) => {
    await new People().route(page);
    // The name in the list leads to the person's page; beside the list they are opened by "Just nu" or by address.
    await open(page, '/staff?person=johan');
    const panel = panelOf(page);
    await expect(panel).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(panel.getByRole('heading', { level: 2, name: 'Johan Byström' })).toBeFocused();
    await expect(panel.getByText('Lärare 4–6 · Bergsåkers skola')).toBeVisible();
    // The unit is the way to its page, which leads back here with the person still open (D97, D83 rule 4).
    await expect(panel.getByRole('link', { name: 'Bergsåkers skola' })).toHaveAttribute(
      'href',
      '/units/unit-skola?from=%2Fstaff%3Fperson%3Djohan',
    );
    await expect(page).toHaveTitle('Johan Byström · Personal · Startsidan');
    // Behöver dig first, then each source named with its own: the order of artboard C.
    const headings = panel.locator('[aria-level="3"]');
    await expect(headings).toHaveText(['Behöver dig', 'Utvecklingssamtal', 'Frånvaro', 'Kontakt', 'Kompetenser']);
    // A card about the person opens over them in the same panel (D83 rule 1): the address keeps the person under it.
    await expect(panel.getByRole('link', { name: 'En åtgärdspunkt skulle vara klar 3 nov' })).toHaveAttribute(
      'href',
      '/staff?person=johan&card=samtal-svar',
    );
    await expect(panel.getByText('Kompetenssystemet · till kännedom')).toBeVisible();
    // Clew's own talks are captioned Clew (artboard C); the action points stand under the state as a plain list, and
    // the one way in is the source's page, not also its fuller read.
    const talk = panel.getByRole('region', { name: 'Utvecklingssamtal' });
    await expect(talk.getByText('Clew', { exact: true })).toBeVisible();
    await expect(talk.getByRole('list', { name: 'Alla åtgärdspunkter' }).getByRole('listitem')).toHaveCount(3);
    await expect(talk.getByText('Boka kurs i NPF-anpassningar')).toBeVisible();
    await expect(talk.getByRole('link')).toHaveText(['Öppna samtalet']);
    await expect(panel.getByRole('link', { name: 'Öppna samtalet' })).toHaveAttribute('href', '/staff?talk=johan');
    // The state badge is as wide as its word, not the section's width.
    const badge = await talk.getByText('Bokat', { exact: true }).boundingBox();
    const box = await talk.boundingBox();
    expect(badge!.width).toBeLessThan(box!.width / 3);
    // Presence is the row in one value: the section reads I dag and Kommande (artboard C).
    const absence = panel.getByRole('region', { name: 'Frånvaro' });
    await expect(absence.getByText('I dag', { exact: true })).toBeVisible();
    await expect(absence.getByText('På plats', { exact: true })).toBeVisible();
    await expect(absence.getByText('I tjänst', { exact: true })).toHaveCount(0);
    await expect(panel.getByRole('link', { name: 'johan@clew.test' })).toHaveAttribute(
      'href',
      'mailto:johan@clew.test',
    );
    await expectNoAxeViolations(page);
    await panel.getByRole('button', { name: 'Stäng panelen' }).click();
    await expect(panelOf(page)).toHaveCount(0);
    await expect(page).toHaveURL(/\/staff$/);
    await expect(rowLink(page, 'Johan Byström')).toBeFocused();
    // Esc inside the panel closes it the same way.
    await expect(rowLink(page, 'Johan Byström')).toHaveAttribute('href', '/people/johan?from=%2Fstaff');
    await open(page, '/staff?person=johan');
    await expect(panel.getByRole('heading', { level: 2, name: 'Johan Byström' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(panelOf(page)).toHaveCount(0);
    await expect(rowLink(page, 'Johan Byström')).toBeFocused();
  });

  test('a card under Behöver dig opens over the person, is named aloud, and closing it leaves the person', async ({
    page,
    api: _,
  }) => {
    await new People().route(page);
    await open(page, '/staff?person=johan');
    const cardLink = panelOf(page).getByRole('link', { name: 'En åtgärdspunkt skulle vara klar 3 nov' });
    await cardLink.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL('/staff?person=johan&card=samtal-svar');
    const card = page.getByRole('complementary', { name: 'Kort' });
    await expect(card.locator('[aria-level="2"]').filter({ hasText: 'Kort' })).toBeFocused();
    await expect(card.getByRole('article', { name: 'Kort: Planera utvecklingssamtal vecka 45' })).toBeVisible();
    await expect(page.getByRole('complementary')).toHaveCount(1);
    await expect.poll(() => said(page, 'Planera utvecklingssamtal vecka 45')).toBeGreaterThan(0);
    // The list beside it keeps the person current, and the tab still names them.
    await expect(page).toHaveTitle('Johan Byström · Personal · Startsidan');
    await expectNoAxeViolations(page);
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/\/staff\?person=johan$/);
    await expect(panelOf(page).getByRole('heading', { level: 2, name: 'Johan Byström' })).toBeVisible();
    await expect(cardLink).toBeFocused();
  });

  test('one person takes the place of another, is named aloud, and closing returns to the row that opened them', async ({
    page,
    api: _,
  }) => {
    await new People().route(page);
    await open(page, '/staff?person=johan');
    await expect(panelOf(page).getByRole('heading', { level: 2, name: 'Johan Byström' })).toBeVisible();
    await rowLink(page, 'Anna Lindqvist').click();
    const anna = panelOf(page, 'Anna Lindqvist');
    await expect(anna.getByRole('heading', { level: 2, name: 'Anna Lindqvist' })).toBeFocused();
    await expect(page.getByRole('complementary')).toHaveCount(1);
    await expect.poll(() => said(page, 'Anna Lindqvist')).toBeGreaterThan(0);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('complementary')).toHaveCount(0);
    await expect(rowLink(page, 'Anna Lindqvist')).toBeFocused();
  });

  test('the first two actions are buttons, the rest are under Fler by system, and Öppna som sida leads to the page', async ({
    page,
    api,
  }) => {
    await new People().route(page, api);
    await open(page, '/staff?person=johan');
    const panel = panelOf(page);
    await expect(panel.getByRole('button', { name: 'Boka möte', exact: true })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Registrera frånvaro', exact: true })).toBeVisible();
    await panel.getByRole('button', { name: 'Fler åtgärder för Johan Byström' }).click();
    const menu = page.getByRole('menu', { name: 'Fler åtgärder för Johan Byström' });
    await expect(menu.getByRole('menuitem', { name: 'Boka samtal' })).toBeVisible();
    await expect(menu.getByText('Utvecklingssamtal')).toBeVisible();
    await page.evaluate(() => Promise.all(document.getAnimations().map(a => a.finished)));
    await expectNoAxeViolations(page);
    // Esc inside the menu is the menu's: the person stays open.
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(panel).toBeVisible();
    // An action starts on the server without the model; its card opens over the person in the same panel, the list
    // and the person kept under it (D107 rule 4), with the focus on the card; closing leaves the person.
    await panel.getByRole('button', { name: 'Boka möte', exact: true }).click();
    await expect(page).toHaveURL('/staff?person=johan&card=entity-calendar-bookMeeting-johan');
    expect(api.entityStarts).toEqual([{ key: 'johan', capability: 'calendar.bookMeeting' }]);
    expect(api.asked).toEqual([]);
    const card = page.getByRole('complementary', { name: 'Kort' });
    await expect(card.getByText('Boka möte: Johan Byström').first()).toBeVisible();
    await expect(card.locator('[aria-level="2"]').filter({ hasText: 'Kort' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL('/staff?person=johan');
    await expect(panel.getByRole('heading', { level: 2, name: 'Johan Byström' })).toBeVisible();
    await panelOf(page).getByRole('link', { name: 'Öppna som sida' }).click();
    await expect(page).toHaveURL(/\/people\/johan\?from=%2Fstaff$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Johan Byström' })).toBeVisible();
  });

  test('a source that refuses an action says why under the buttons, once aloud, and the person stays open', async ({
    page,
    api,
  }) => {
    const refusal = 'Personalsystemet hittar ingen anställning för Johan Byström.';
    api.entityRefusals['hr.registerAbsence'] = refusal;
    await new People().route(page, api);
    await open(page, '/staff?person=johan');
    const panel = panelOf(page);
    await panel.getByRole('button', { name: 'Registrera frånvaro', exact: true }).click();
    await expect(panel.getByText(refusal, { exact: true })).toBeVisible();
    await expect.poll(() => said(page, refusal)).toBe(1);
    await expect(page).toHaveURL('/staff?person=johan');
    await expect(panel.getByRole('button', { name: 'Registrera frånvaro', exact: true })).toBeFocused();
    await expectNoAxeViolations(page);
  });

  test('a source that does not answer says so in its own section, once aloud, and Försök igen asks it alone', async ({
    page,
    api: _,
  }) => {
    const people = new People();
    await people.route(page);
    await open(page, '/staff?person=johan');
    const panel = panelOf(page);
    await expect(panel.getByText('Kompetenssystemet svarade inte.')).toBeVisible();
    await expect(panel.getByText('Semester 21–23 dec')).toBeVisible();
    await expect.poll(() => said(page, 'Kompetenssystemet svarade inte.')).toBe(1);
    const before = [...people.reads];
    delete people.silent[SILENT_SECTION];
    await panel.getByRole('button', { name: 'Försök igen med Kompetenser' }).click();
    await expect(panel.getByText('HLR vuxen')).toBeVisible();
    expect(people.reads.slice(before.length)).toEqual([SILENT_SECTION]);
    expect(await said(page, 'Kompetenssystemet svarade inte.')).toBe(1);
  });

  test('each section arrives on its own: a slow source does not hold the others', async ({ page, api: _ }) => {
    const people = new People();
    people.delay[PRESENCE_LENS] = 2_500;
    await people.route(page);
    await page.goto('/staff?person=johan');
    const panel = panelOf(page);
    await expect(panel.getByText('2 försenade')).toBeVisible();
    await expect(panel.getByText('johan@clew.test')).toBeVisible();
    await expect(panel.getByText('Semester 21–23 dec')).toHaveCount(0);
    await expect(panel.getByText('Semester 21–23 dec')).toBeVisible({ timeout: 10_000 });
    expect(people.reads).toEqual(expect.arrayContaining([TALK_LENS, PRESENCE_LENS, CONTACT, SILENT_SECTION]));
  });

  test("a colleague's reading has only what the server gives: one action, one section, no cards (artboard G)", async ({
    page,
    api: _,
  }) => {
    const people = new People();
    people.colleague = true;
    await people.route(page);
    await open(page, '/staff?person=johan');
    const panel = panelOf(page);
    await expect(panel.locator('[aria-level="3"]')).toHaveText(['Kontakt']);
    // A colleague's unit is not one the reader may open: it is named, not linked.
    await expect(panel.getByText('Lärare 4–6 · Bergsåkers skola')).toBeVisible();
    await expect(panel.getByRole('link', { name: 'Bergsåkers skola' })).toHaveCount(0);
    await expect(panel.getByRole('button', { name: 'Boka möte', exact: true })).toBeVisible();
    await expect(panel.getByRole('button', { name: /Fler åtgärder/ })).toHaveCount(0);
    await expect(panel.getByText('Behöver dig')).toHaveCount(0);
    await expectNoAxeViolations(page);
  });
});

test.describe('the person as a page', () => {
  test.use({ viewport: wide });

  test('the trail leads back to Personal, the sections are a named list with the chosen one current, and the chosen source is read in full', async ({
    page,
    api: _,
  }) => {
    await new People().route(page);
    await open(page, '/people/johan?from=%2Fstaff');
    await expect(page).toHaveTitle('Johan Byström · Startsidan');
    await expect(page.getByRole('heading', { level: 1, name: 'Johan Byström' })).toBeVisible();
    const trail = page.getByRole('navigation', { name: 'Du är här' });
    await expect(trail.getByRole('link', { name: 'Personal' })).toHaveAttribute('href', '/staff');
    await expect(page.getByRole('main').getByRole('link', { name: 'Bergsåkers skola' })).toHaveAttribute(
      'href',
      '/units/unit-skola?from=%2Fpeople%2Fjohan%3Ffrom%3D%252Fstaff',
    );
    const sections = page.getByRole('navigation', { name: 'Om Johan Byström' });
    await expect(sections).toBeVisible();
    // Behöver dig is chosen when there are cards.
    await expect(sections.locator('[aria-current="true"]')).toContainText('Behöver dig');
    await expect(page.getByRole('heading', { level: 2, name: 'Behöver dig' })).toBeVisible();
    await expectNoAxeViolations(page);
    await sections.getByRole('link', { name: /Kontakt/ }).click();
    await expect(page).toHaveURL(/section=directory\.contact/);
    await expect(sections.locator('[aria-current="true"]')).toContainText('Kontakt');
    await expect(page.getByRole('heading', { level: 2, name: 'Kontakt' })).toBeVisible();
    await expect(page.getByText('Katalogen · hämtat nu')).toBeVisible();
    await sections.getByRole('link', { name: /Utvecklingssamtal/ }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Utvecklingssamtal' })).toBeVisible();
    await expect(page.getByText('Skicka underlag om schemaläggning')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Öppna samtalet' })).toBeVisible();
    await expectNoAxeViolations(page);
    const { unmarked } = await hiddenFocusStops(page);
    expect(unmarked).toEqual([]);
  });

  test('the trail names where the person was opened from: Hem for a card row, nothing for an address without one', async ({
    page,
    api: _,
  }) => {
    await new People().route(page);
    await open(page, '/people/johan?from=%2F%3Fcard%3Dsamtal-svar');
    const trail = page.getByRole('navigation', { name: 'Du är här' });
    await expect(trail.getByRole('link', { name: 'Hem' })).toHaveAttribute('href', '/?card=samtal-svar');
    await expect(trail.getByRole('link', { name: 'Personal' })).toHaveCount(0);
    await open(page, '/people/johan');
    await expect(page.getByRole('heading', { level: 1, name: 'Johan Byström' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Du är här' })).toHaveCount(0);
  });

  test('a person the reader may not ask about is the page’s own “finns inte”', async ({ page, api: _ }) => {
    await new People().route(page);
    await open(page, '/people/okand');
    await expect(page.getByRole('heading', { level: 1, name: 'Personen finns inte' })).toBeVisible();
    await expect(page).toHaveTitle('Personen finns inte · Startsidan');
    await expect(page.getByRole('navigation', { name: 'Du är här' })).toHaveCount(0);
    await expectNoAxeViolations(page);
  });

  test('a colleague’s page reads well with one section and no cards, and has no trail without an origin', async ({
    page,
    api: _,
  }) => {
    const people = new People();
    people.colleague = true;
    await people.route(page);
    await open(page, '/people/johan');
    await expect(page.getByRole('navigation', { name: 'Du är här' })).toHaveCount(0);
    const sections = page.getByRole('navigation', { name: 'Om Johan Byström' });
    await expect(sections.getByRole('listitem')).toHaveCount(1);
    await expect(sections.locator('[aria-current="true"]')).toContainText('Kontakt');
    await expect(page.getByRole('heading', { level: 2, name: 'Kontakt' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Boka möte', exact: true })).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test('a card under Behöver dig opens beside the page with the section and the way back kept; Esc gives the focus back to its title', async ({
    page,
    api: _,
  }) => {
    await new People().route(page);
    await open(page, '/people/johan?section=needs-you&from=%2Fstaff');
    const title = page.getByRole('link', { name: 'En åtgärdspunkt skulle vara klar 3 nov' });
    await expect(title).toHaveAttribute('href', '/people/johan?section=needs-you&from=%2Fstaff&card=samtal-svar');
    await title.focus();
    await page.keyboard.press('Enter');
    // The person's page stays: its address with the card added, its title, its heading and its trail (D107 rule 3).
    await expect(page).toHaveURL('/people/johan?section=needs-you&from=%2Fstaff&card=samtal-svar');
    const panel = page.getByRole('complementary', { name: 'Kort' });
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(panel.locator('[aria-level="2"]').filter({ hasText: 'Kort' })).toBeFocused();
    await expect(panel.getByRole('article', { name: 'Kort: Planera utvecklingssamtal vecka 45' })).toBeVisible();
    await expect(page).toHaveTitle('Johan Byström · Startsidan');
    await expect(page.getByRole('heading', { level: 1, name: 'Johan Byström' })).toBeVisible();
    await expect(
      page.getByRole('navigation', { name: 'Du är här' }).getByRole('link', { name: 'Personal' }),
    ).toHaveAttribute('href', '/staff');
    await expectNoAxeViolations(page);
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL('/people/johan?section=needs-you&from=%2Fstaff');
    await expect(panel).toHaveCount(0);
    await expect(title).toBeFocused();
    // Another section is a move within the page: what is open beside it stays open.
    await title.click();
    await page
      .getByRole('navigation', { name: 'Om Johan Byström' })
      .getByRole('link', { name: /Kontakt/ })
      .click();
    await expect(page).toHaveURL('/people/johan?section=directory.contact&from=%2Fstaff&card=samtal-svar');
    await expect(page.getByRole('heading', { level: 2, name: 'Kontakt' })).toBeVisible();
    await expect(panel.getByRole('article', { name: 'Kort: Planera utvecklingssamtal vecka 45' })).toBeVisible();
  });

  test('an action started on the page opens its card beside it, and closing gives the focus back to the button', async ({
    page,
    api,
  }) => {
    await new People().route(page, api);
    await open(page, '/people/johan?from=%2Fstaff');
    const button = page.getByRole('main').getByRole('button', { name: 'Boka möte', exact: true });
    await button.click();
    await expect(page).toHaveURL('/people/johan?from=%2Fstaff&card=entity-calendar-bookMeeting-johan');
    expect(api.entityStarts).toEqual([{ key: 'johan', capability: 'calendar.bookMeeting' }]);
    const panel = page.getByRole('complementary', { name: 'Kort' });
    await expect(panel.getByText('Boka möte: Johan Byström').first()).toBeVisible();
    await expect(panel.locator('[aria-level="2"]').filter({ hasText: 'Kort' })).toBeFocused();
    await expect(page.getByRole('heading', { level: 1, name: 'Johan Byström' })).toBeVisible();
    await expectNoAxeViolations(page);
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL('/people/johan?from=%2Fstaff');
    await expect(button).toBeFocused();
  });
});

test.describe('the person on a phone', () => {
  test.use({ viewport: phoneSize });

  test('the drawer names the way back, Åtgärder holds every action by system, and a row leads into its section and back', async ({
    page,
    api: _,
  }) => {
    await new People().route(page);
    await open(page, '/staff?person=johan');
    const sheet = page.getByRole('dialog', { name: 'Johan Byström' });
    // "‹ Personal" (artboard D) is a link back to the list.
    await expect(sheet.getByRole('link', { name: 'Tillbaka till Personal' })).toHaveAttribute('href', '/staff');
    await expect(sheet.getByText('Kompetenssystemet')).toBeVisible();
    await page.evaluate(() => Promise.all(document.getAnimations().map(a => a.finished)));
    await expectNoAxeViolations(page);
    await sheet.getByRole('button', { name: 'Åtgärder för Johan Byström' }).click();
    const menu = page.getByRole('menu', { name: 'Åtgärder för Johan Byström' });
    await expect(menu.getByRole('menuitem')).toHaveText(['Boka möte', 'Registrera frånvaro', 'Boka samtal']);
    await page.keyboard.press('Escape');
    const row = sheet.getByRole('link', { name: /Utvecklingssamtal/ });
    await row.click();
    await expect(page).toHaveURL(/person-section=clew\.talkPeople/);
    await expect(sheet.getByRole('link', { name: 'Tillbaka till Johan Byström' })).toBeFocused();
    await expect(sheet.getByText('Skicka underlag om schemaläggning')).toBeVisible();
    await expectNoAxeViolations(page);
    await sheet.getByRole('link', { name: 'Tillbaka till Johan Byström' }).click();
    await expect(page).toHaveURL(/\/staff\?person=johan$/);
    await expect(sheet.getByRole('link', { name: /Utvecklingssamtal/ })).toBeFocused();
    await sheet.getByRole('link', { name: 'Tillbaka till Personal' }).click();
    await expect(sheet).toHaveCount(0);
    await expect(page).toHaveURL(/\/staff$/);
  });

  test('the page drills into a section and back on a narrow window', async ({ page, api: _ }) => {
    await new People().route(page);
    await open(page, '/people/johan?from=%2Fstaff');
    const sections = page.getByRole('navigation', { name: 'Om Johan Byström' });
    await expect(sections.locator('[aria-current="true"]')).toHaveCount(0);
    await expectNoAxeViolations(page);
    await sections.getByRole('link', { name: /Kontakt/ }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Kontakt' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Tillbaka till Om Johan Byström' })).toBeFocused();
    await page.getByRole('link', { name: 'Tillbaka till Om Johan Byström' }).click();
    await expect(
      page.getByRole('navigation', { name: 'Om Johan Byström' }).getByRole('link', { name: /Kontakt/ }),
    ).toBeFocused();
  });
});

test.describe('1.4.10 reflow', () => {
  test.use({ viewport: narrow });
  test('the person beside a list and as a page reflow at 320 px', async ({ page, api: _ }) => {
    await new People().route(page);
    await open(page, '/staff?person=johan');
    const sheet = page.getByRole('dialog', { name: 'Johan Byström' });
    await expect(sheet.getByText('Kompetenssystemet')).toBeVisible();
    expect(await reflowProblems(page, sheet)).toEqual([]);
    await open(page, '/people/johan?from=%2Fstaff');
    await expect(page.getByRole('navigation', { name: 'Om Johan Byström' })).toBeVisible();
    expect(await reflowProblems(page)).toEqual([]);
    await open(page, '/people/johan?from=%2Fstaff&section=clew.talkPeople');
    await expect(page.getByText('Skicka underlag om schemaläggning')).toBeVisible();
    expect(await reflowProblems(page)).toEqual([]);
  });
  test('a card opened on the person’s page lies over it and reflows at 320 px', async ({ page, api: _ }) => {
    await new People().route(page);
    await open(page, '/people/johan?from=%2Fstaff&card=samtal-svar');
    const drawer = page.getByRole('dialog', { name: 'Kort' });
    await expect(drawer.getByRole('article', { name: 'Kort: Planera utvecklingssamtal vecka 45' })).toBeVisible();
    await page.evaluate(() => Promise.all(document.getAnimations().map(a => a.finished)));
    expect(await reflowProblems(page, drawer)).toEqual([]);
    expect(await reflowProblems(page)).toEqual([]);
    await expectNoAxeViolations(page);
  });
});
