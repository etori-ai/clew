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
import { CONTACT, POINTS, People, pointsOutput, pointsSpec } from './person-data';

/**
 * The opened person (D97 item 5, D107 rule 3: a person is a page only): as a page (artboard C2), on a phone (D) and read
 * by a colleague (G). The shared mock answers the list; `person-data.ts` answers the person and their sections, with
 * Kontakt and the talk's action points beside the mock's sources and Kompetenssystemet silent until a test lets it
 * answer. Keyboard, focus, announcements, axe and reflow. An address that drew the person beside Personal's list leads
 * here (`staff.spec.ts`).
 */
const wide = { width: 1440, height: 900 };
const phoneSize = { width: 390, height: 844 };
const said = async (page: Page, text: string) => (await announcements(page)).filter(t => t.includes(text)).length;

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
    // Only what the server gives a colleague (artboard G): one action, no Fler, no cards, and their unit named, not
    // linked, since it is not one the reader may open.
    await expect(page.getByRole('button', { name: 'Boka möte', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /Fler åtgärder/ })).toHaveCount(0);
    await expect(page.getByRole('main').getByText('Behöver dig')).toHaveCount(0);
    await expect(page.getByText('Lärare 4–6 · Bergsåkers skola')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Bergsåkers skola' })).toHaveCount(0);
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

  test('where the sections and the panel no longer fit side by side the page gives way: its drill-in beside the card, and side by side again when it closes', async ({
    page,
    api: _,
  }) => {
    // The panel stands beside every page from 1336 px; the list of sections and the chosen one need 1432 px beside it.
    await new People().route(page);
    await page.setViewportSize({ width: 1400, height: 900 });
    await open(page, '/people/johan?section=needs-you&from=%2Fstaff');
    const sections = page.getByRole('navigation', { name: 'Om Johan Byström' });
    await expect(sections).toBeVisible();
    await page.getByRole('link', { name: 'En åtgärdspunkt skulle vara klar 3 nov' }).click();
    const panel = page.getByRole('complementary', { name: 'Kort' });
    await expect(panel.getByRole('article', { name: 'Kort: Planera utvecklingssamtal vecka 45' })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // The page is its narrow drill-in: the chosen section, with the way back to the list of sections.
    const back = page.getByRole('link', { name: 'Tillbaka till Om Johan Byström' });
    await expect(back).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Behöver dig' })).toBeVisible();
    await expect(sections).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expectNoAxeViolations(page);
    // The list of sections is one step away, with the card still beside it.
    await back.click();
    await expect(page).toHaveURL('/people/johan?from=%2Fstaff&card=samtal-svar');
    await expect(sections).toBeVisible();
    await expect(panel).toBeVisible();
    // Closed, the page stands side by side again.
    await panel.getByRole('button', { name: 'Stäng panelen' }).click();
    await expect(page).toHaveURL('/people/johan?from=%2Fstaff');
    await expect(sections).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Behöver dig' })).toBeVisible();
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

  test('the page has no question box, so nothing offers Lägg till i samtalet: not a card beside it, its menu, or a row of a section', async ({
    page,
    api,
  }) => {
    await new People().route(page, api);
    // The action points as rows that could go into the box on a page that has one (D12): each with a ref the source
    // reads back. Registered after the person's routes, so this answer is the one the section gets.
    await page.route(
      url => url.pathname === `/api/cap/${POINTS}`,
      route =>
        route.fulfill({
          json: {
            output: { rows: pointsOutput.rows.map((r, i) => ({ ...r, ref: `point-${i}` })) },
            source: 'Utvecklingssamtal',
            view: { ...pointsSpec, chip: true, ref: 'ref' },
          },
        }),
    );
    await open(page, `/people/johan?section=${TALK_LENS}&from=%2Fstaff`);
    await expect(page.getByText('Skicka underlag om schemaläggning')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Lägg till i samtalet' })).toHaveCount(0);
    await expect(page.getByRole('columnheader', { name: 'Samtal' })).toHaveCount(0);
    // A card the page started: its own buttons, and none that leads into a box.
    await page.getByRole('main').getByRole('button', { name: 'Boka möte', exact: true }).click();
    const panel = page.getByRole('complementary', { name: 'Kort' });
    await expect(panel.getByRole('button', { name: 'Inte nu', exact: true }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Lägg till i samtalet' })).toHaveCount(0);
    // A proposal's card: its menu keeps its other items and has no "Lägg till i samtalet".
    await open(page, '/people/johan?section=needs-you&from=%2Fstaff&card=samtal-svar');
    await expect(panel.getByRole('article', { name: 'Kort: Planera utvecklingssamtal vecka 45' })).toBeVisible();
    await panel.getByRole('button', { name: 'Fler val', exact: true }).click();
    const menu = page.getByRole('menu');
    await expect(menu.getByRole('menuitem', { name: 'Varför ser jag detta?' })).toBeVisible();
    await expect(menu.getByRole('menuitem')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
  });

  test('the first two actions are buttons and the rest are under Fler by system; no control chooses where the person is shown', async ({
    page,
    api: _,
  }) => {
    await new People().route(page);
    await open(page, '/people/johan?from=%2Fstaff');
    const main = page.getByRole('main');
    await expect(main.getByRole('button', { name: 'Boka möte', exact: true })).toBeVisible();
    await expect(main.getByRole('button', { name: 'Registrera frånvaro', exact: true })).toBeVisible();
    await main.getByRole('button', { name: 'Fler åtgärder för Johan Byström' }).click();
    const menu = page.getByRole('menu', { name: 'Fler åtgärder för Johan Byström' });
    await expect(menu.getByRole('menuitem', { name: 'Boka samtal' })).toBeVisible();
    await expect(menu.getByText('Utvecklingssamtal')).toBeVisible();
    await page.evaluate(() => Promise.all(document.getAnimations().map(a => a.finished)));
    await expectNoAxeViolations(page);
    // Esc inside the menu is the menu's: the page stays as it was.
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(page).toHaveURL('/people/johan?from=%2Fstaff');
    // A person is a page only (D107 rule 7): nothing offers another place to show them.
    await expect(page.getByText('Öppna som sida')).toHaveCount(0);
    await expect(page.getByText('Visa bredvid')).toHaveCount(0);
  });

  test('a source that refuses an action says why under the buttons, once aloud, and the page stays', async ({
    page,
    api,
  }) => {
    const refusal = 'Personalsystemet hittar ingen anställning för Johan Byström.';
    api.entityRefusals['hr.registerAbsence'] = refusal;
    await new People().route(page, api);
    await open(page, '/people/johan?from=%2Fstaff');
    const button = page.getByRole('main').getByRole('button', { name: 'Registrera frånvaro', exact: true });
    await button.click();
    await expect(page.getByRole('main').getByText(refusal, { exact: true })).toBeVisible();
    await expect.poll(() => said(page, refusal)).toBe(1);
    await expect(page).toHaveURL('/people/johan?from=%2Fstaff');
    await expect(button).toBeFocused();
    await expectNoAxeViolations(page);
  });

  test('an action about the person is drawn once, beside the name, whichever section is open; its refusal stands there', async ({
    page,
    api,
  }) => {
    // Frånvaro is Personalsystemet's, which offers Registrera frånvaro; Utvecklingssamtal is Clew's, which offers Boka
    // samtal under Fler. Neither section draws them again (D97, amended 2026-11-11).
    const refusal = 'Personalsystemet hittar ingen anställning för Johan Byström.';
    api.entityRefusals['hr.registerAbsence'] = refusal;
    await new People().route(page, api);
    await open(page, `/people/johan?from=%2Fstaff&section=${PRESENCE_LENS}`);
    const main = page.getByRole('main');
    await expect(page.getByRole('heading', { level: 2, name: 'Frånvaro' })).toBeVisible();
    await expect(main.getByText(/Personalsystemet · hämtat/)).toBeVisible();
    const button = page.getByRole('button', { name: 'Registrera frånvaro', exact: true });
    await expect(button).toHaveCount(1);
    await button.click();
    await expect(main.getByText(refusal, { exact: true })).toHaveCount(1);
    await expect(main.getByText(refusal, { exact: true })).toBeVisible();
    await expect.poll(() => said(page, refusal)).toBe(1);
    await expect(button).toBeFocused();
    await expectNoAxeViolations(page);
    await open(page, `/people/johan?from=%2Fstaff&section=${TALK_LENS}`);
    await expect(page.getByRole('heading', { level: 2, name: 'Utvecklingssamtal' })).toBeVisible();
    await expect(page.getByText('Skicka underlag om schemaläggning')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Öppna samtalet' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Boka samtal', exact: true })).toHaveCount(0);
    await main.getByRole('button', { name: 'Fler åtgärder för Johan Byström' }).click();
    await expect(
      page
        .getByRole('button', { name: 'Boka samtal', exact: true })
        .or(page.getByRole('menuitem', { name: 'Boka samtal' })),
    ).toHaveCount(1);
  });

  test('a source that does not answer says so in its own place, once aloud, and Försök igen asks it alone', async ({
    page,
    api: _,
  }) => {
    const people = new People();
    await people.route(page);
    await open(page, `/people/johan?from=%2Fstaff&section=${SILENT_SECTION}`);
    await expect(page.getByRole('main').getByText('Kompetenssystemet svarade inte.')).toBeVisible();
    await expect.poll(() => said(page, 'Kompetenssystemet svarade inte.')).toBe(1);
    const before = [...people.reads];
    delete people.silent[SILENT_SECTION];
    await page
      .getByRole('navigation', { name: 'Om Johan Byström' })
      .getByRole('button', { name: 'Försök igen med Kompetenser' })
      .click();
    await expect(page.getByRole('main').getByText('HLR vuxen').first()).toBeVisible();
    expect(people.reads.slice(before.length)).toEqual([SILENT_SECTION]);
    expect(await said(page, 'Kompetenssystemet svarade inte.')).toBe(1);
  });

  test('each section arrives on its own: a slow source does not hold the others', async ({ page, api: _ }) => {
    const people = new People();
    people.delay[PRESENCE_LENS] = 2_500;
    await people.route(page);
    await page.goto(`/people/johan?from=%2Fstaff&section=${PRESENCE_LENS}`);
    const sections = page.getByRole('navigation', { name: 'Om Johan Byström' });
    await expect(sections.getByText('2 försenade')).toBeVisible();
    await expect(sections.getByText('johan@clew.test')).toBeVisible();
    await expect(page.getByText('Semester 21–23 dec')).toHaveCount(0);
    await expect(page.getByText('Semester 21–23 dec').first()).toBeVisible({ timeout: 10_000 });
    expect(people.reads).toEqual(expect.arrayContaining([TALK_LENS, PRESENCE_LENS, CONTACT, SILENT_SECTION]));
  });
});

test.describe('the person on a phone', () => {
  test.use({ viewport: phoneSize });

  test('Åtgärder holds every action by system, and a row leads into its section and back', async ({ page, api: _ }) => {
    await new People().route(page);
    await open(page, '/people/johan?from=%2Fstaff');
    await page.getByRole('main').getByRole('button', { name: 'Åtgärder för Johan Byström' }).click();
    const menu = page.getByRole('menu', { name: 'Åtgärder för Johan Byström' });
    await expect(menu.getByRole('menuitem')).toHaveText(['Boka möte', 'Registrera frånvaro', 'Boka samtal']);
    await page.evaluate(() => Promise.all(document.getAnimations().map(a => a.finished)));
    await expectNoAxeViolations(page);
    await page.keyboard.press('Escape');
    const sections = page.getByRole('navigation', { name: 'Om Johan Byström' });
    await sections.getByRole('link', { name: /Utvecklingssamtal/ }).click();
    await expect(page).toHaveURL(/section=clew\.talkPeople/);
    await expect(page.getByRole('link', { name: 'Tillbaka till Om Johan Byström' })).toBeFocused();
    await expect(page.getByText('Skicka underlag om schemaläggning')).toBeVisible();
    await expectNoAxeViolations(page);
    await page.getByRole('link', { name: 'Tillbaka till Om Johan Byström' }).click();
    await expect(page).toHaveURL('/people/johan?from=%2Fstaff');
    await expect(
      page.getByRole('navigation', { name: 'Om Johan Byström' }).getByRole('link', { name: /Utvecklingssamtal/ }),
    ).toBeFocused();
  });

  test('in an opened section the action about the person is only under Åtgärder beside the name', async ({
    page,
    api: _,
  }) => {
    await new People().route(page);
    await open(page, `/people/johan?from=%2Fstaff&section=${PRESENCE_LENS}`);
    await expect(page.getByRole('heading', { level: 2, name: 'Frånvaro' })).toBeVisible();
    await expect(page.getByRole('main').getByText(/Personalsystemet · hämtat/)).toBeVisible();
    const control = page
      .getByRole('button', { name: 'Registrera frånvaro', exact: true })
      .or(page.getByRole('menuitem', { name: 'Registrera frånvaro' }));
    await expect(control).toHaveCount(0);
    await page.getByRole('main').getByRole('button', { name: 'Åtgärder för Johan Byström' }).click();
    const menu = page.getByRole('menu', { name: 'Åtgärder för Johan Byström' });
    await expect(menu.getByRole('menuitem', { name: 'Registrera frånvaro' })).toBeVisible();
    await expect(control).toHaveCount(1);
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
  test('the person as a page reflows at 320 px', async ({ page, api: _ }) => {
    await new People().route(page);
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
