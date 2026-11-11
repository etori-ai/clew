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
 * The opened person (D97 item 5, D110 rule 3: a person is a page only): as a page (artboard C2), on a phone (D) and read
 * by a colleague (G). The shared mock answers the list; `person-data.ts` answers the person and their sections, with
 * Kontakt and the talk's action points beside the mock's sources and Kompetenssystemet silent until a test lets it
 * answer. Keyboard, focus, announcements, axe and reflow. An address that drew the person beside Personal's list leads
 * here (`staff.spec.ts`).
 */
const wide = { width: 1440, height: 900 };
const phoneSize = { width: 390, height: 844 };
const said = async (page: Page, text: string) => (await announcements(page)).filter(t => t.includes(text)).length;
/**
 * Reflow problems but the tab strip's own tabs past the edge: the strip scrolls sideways by the product owner's choice
 * (2026-11-11), each tab reached by the arrows or by scrolling it and the chosen one kept in view, so a tab past the edge
 * is the strip doing its job. The cases check that the strip itself fits.
 */
const STRIP_TABS = ['Behöver dig', 'Utvecklingssamtal', 'Frånvaro', 'Kontakt', 'Kompetenser'];
const outsideTheStrip = (problems: string[]) =>
  problems.filter(p => !STRIP_TABS.some(t => p === `beyond the edge: span "${t}"`));

test.describe('the person as a page', () => {
  test.use({ viewport: wide });

  test('the trail leads back to Personal, the sections are a tab strip under the name with the chosen one current, back and forward choose as a click does, and the chosen source is read in full', async ({
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
      '/units/unit-skola?from=%2Fpeople%2Fjohan',
    );
    const sections = page.getByRole('navigation', { name: 'Om Johan Byström' });
    await expect(sections).toBeVisible();
    // One tab per section in the page's order: Behöver dig with the count of the reader's cards, as Hem's tabs count,
    // then each source by its section's title, a silent one too. No summary line and no source name in the strip.
    const tabs = sections.getByRole('link');
    const names = [/^Behöver dig\s?2$/, 'Utvecklingssamtal', 'Frånvaro', 'Kontakt', 'Kompetenser'];
    await expect(tabs).toHaveCount(names.length);
    for (const [i, name] of names.entries()) await expect(tabs.nth(i)).toHaveAccessibleName(name);
    await expect(sections.getByText('Katalogen')).toHaveCount(0);
    await expect(sections.getByRole('link', { name: 'Kontakt' })).toHaveAttribute(
      'href',
      '/people/johan?section=directory.contact&from=%2Fstaff',
    );
    // Without a section in the address the first tab, Behöver dig, is chosen.
    await expect(sections.locator('[aria-current="true"]')).toContainText('Behöver dig');
    await expect(page.getByRole('heading', { level: 2, name: 'Behöver dig' })).toBeVisible();
    await expectNoAxeViolations(page);
    await sections.getByRole('link', { name: 'Kontakt' }).click();
    await expect(page).toHaveURL('/people/johan?section=directory.contact&from=%2Fstaff');
    await expect(sections.locator('[aria-current="true"]')).toContainText('Kontakt');
    await expect(page.getByRole('heading', { level: 2, name: 'Kontakt' })).toBeVisible();
    await expect(page.getByText('Katalogen · hämtat nu')).toBeVisible();
    await sections.getByRole('link', { name: 'Utvecklingssamtal' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Utvecklingssamtal' })).toBeVisible();
    await expect(page.getByText('Skicka underlag om schemaläggning')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Öppna samtalet' })).toBeVisible();
    await expectNoAxeViolations(page);
    // The address is the choice: back and forward move between the sections as the clicks did.
    await page.goBack();
    await expect(page).toHaveURL('/people/johan?section=directory.contact&from=%2Fstaff');
    await expect(sections.locator('[aria-current="true"]')).toContainText('Kontakt');
    await expect(page.getByRole('heading', { level: 2, name: 'Kontakt' })).toBeVisible();
    await page.goForward();
    await expect(sections.locator('[aria-current="true"]')).toContainText('Utvecklingssamtal');
    await expect(page.getByRole('heading', { level: 2, name: 'Utvecklingssamtal' })).toBeVisible();
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
    await expect(sections.getByRole('link')).toHaveCount(1);
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
    // The person's page stays: its address with the card added, its title, its heading and its trail (D110 rule 3).
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

  test('beside a card the page keeps its tab strip and its section, and the card a section’s action made closes back to that button', async ({
    page,
    api,
  }) => {
    // The panel stands beside every page from 1336 px; the page under it is the same at every width.
    await new People().route(page, api);
    await page.setViewportSize({ width: 1400, height: 900 });
    const here = `/people/johan?section=${PRESENCE_LENS}&from=%2Fstaff`;
    await open(page, here);
    const sections = page.getByRole('navigation', { name: 'Om Johan Byström' });
    const button = page.getByRole('main').getByRole('button', { name: 'Registrera frånvaro', exact: true });
    await button.click();
    await expect(page).toHaveURL(`${here}&card=entity-hr-registerAbsence-johan`);
    expect(api.entityStarts).toEqual([{ key: 'johan', capability: 'hr.registerAbsence' }]);
    const panel = page.getByRole('complementary', { name: 'Kort' });
    await expect(panel.getByText('Registrera frånvaro: Johan Byström').first()).toBeVisible();
    await expect(panel.locator('[aria-level="2"]').filter({ hasText: 'Kort' })).toBeFocused();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(sections).toBeVisible();
    await expect(sections.locator('[aria-current="true"]')).toContainText('Frånvaro');
    await expect(page.getByRole('heading', { level: 2, name: 'Frånvaro', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expectNoAxeViolations(page);
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(here);
    await expect(panel).toHaveCount(0);
    await expect(button).toBeFocused();
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

  test('an action is drawn once, in its source’s section on the heading’s line; beside the name only one whose source has no section; no control chooses where the person is shown', async ({
    page,
    api: _,
  }) => {
    // Frånvaro is Personalsystemet's, which offers Registrera frånvaro; Utvecklingssamtal is Clew's, which offers Boka
    // samtal; Kalendern has no section, so its Boka möte stands beside the name (D97, amended 2026-11-11).
    await new People().route(page);
    await open(page, `/people/johan?from=%2Fstaff&section=${PRESENCE_LENS}`);
    const main = page.getByRole('main');
    const sections = page.getByRole('navigation', { name: 'Om Johan Byström' });
    const heading = page.getByRole('heading', { level: 2, name: 'Frånvaro' });
    const caption = main.getByText(/Personalsystemet · hämtat/);
    await expect(heading).toBeVisible();
    await expect(caption).toBeVisible();
    const button = main.getByRole('button', { name: 'Registrera frånvaro', exact: true });
    await expect(button).toHaveCount(1);
    const [h, c, b] = await Promise.all([heading.boundingBox(), caption.boundingBox(), button.boundingBox()]);
    const middle = b!.y + b!.height / 2;
    expect(middle).toBeGreaterThanOrEqual(h!.y);
    expect(middle).toBeLessThanOrEqual(c!.y + c!.height);
    await expect(main.getByRole('button', { name: 'Boka möte', exact: true })).toHaveCount(1);
    await expect(main.getByRole('button', { name: 'Boka samtal', exact: true })).toHaveCount(0);
    await expect(main.getByRole('button', { name: /Fler åtgärder/ })).toHaveCount(0);
    await expectNoAxeViolations(page);
    await sections.getByRole('link', { name: /Utvecklingssamtal/ }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Utvecklingssamtal' })).toBeVisible();
    await expect(main.getByRole('button', { name: 'Boka samtal', exact: true })).toHaveCount(1);
    await expect(main.getByRole('link', { name: 'Öppna samtalet' })).toBeVisible();
    await expect(main.getByRole('button', { name: 'Registrera frånvaro', exact: true })).toHaveCount(0);
    await expect(main.getByRole('button', { name: 'Boka möte', exact: true })).toHaveCount(1);
    // A section whose source offers no action draws none, and Behöver dig none either.
    await sections.getByRole('link', { name: /Kontakt/ }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Kontakt' })).toBeVisible();
    await sections.getByRole('link', { name: /Behöver dig/ }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Behöver dig' })).toBeVisible();
    for (const name of ['Registrera frånvaro', 'Boka samtal'])
      await expect(main.getByRole('button', { name, exact: true })).toHaveCount(0);
    // A person is a page only (D110 rule 7): nothing offers another place to show them.
    await expect(page.getByText('Öppna som sida')).toHaveCount(0);
    await expect(page.getByText('Visa bredvid')).toHaveCount(0);
  });

  test('a source that refuses an action says why under its section’s buttons, once aloud, and the focus and the page stay', async ({
    page,
    api,
  }) => {
    const refusal = 'Personalsystemet hittar ingen anställning för Johan Byström.';
    api.entityRefusals['hr.registerAbsence'] = refusal;
    await new People().route(page, api);
    const here = `/people/johan?from=%2Fstaff&section=${PRESENCE_LENS}`;
    await open(page, here);
    const main = page.getByRole('main');
    const button = main.getByRole('button', { name: 'Registrera frånvaro', exact: true });
    await button.click();
    await expect(main.getByText(refusal, { exact: true })).toHaveCount(1);
    await expect(main.getByText(refusal, { exact: true })).toBeVisible();
    await expect.poll(() => said(page, refusal)).toBe(1);
    await expect(page).toHaveURL(here);
    await expect(button).toBeFocused();
    await expectNoAxeViolations(page);
    // The refusal belongs to the section whose action it answered.
    await page
      .getByRole('navigation', { name: 'Om Johan Byström' })
      .getByRole('link', { name: /Utvecklingssamtal/ })
      .click();
    await expect(page.getByRole('heading', { level: 2, name: 'Utvecklingssamtal' })).toBeVisible();
    await expect(main.getByText(refusal, { exact: true })).toHaveCount(0);
  });

  test('an action whose source answered without a row stands beside the name, the first two as buttons and the rest under Fler by system; a source that did not answer keeps its tab and its action', async ({
    page,
    api: _,
  }) => {
    const people = new People();
    people.empty = [PRESENCE_LENS, TALK_LENS];
    await people.route(page);
    await open(page, '/people/johan?from=%2Fstaff');
    const main = page.getByRole('main');
    const sections = page.getByRole('navigation', { name: 'Om Johan Byström' });
    await expect(sections.getByRole('link', { name: 'Kontakt' })).toBeVisible();
    // Neither source has a tab: they had nothing about Johan.
    await expect(sections.getByRole('link', { name: 'Frånvaro' })).toHaveCount(0);
    await expect(sections.getByRole('link', { name: 'Utvecklingssamtal' })).toHaveCount(0);
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
    // An address naming a section that has no tab shows the first one.
    await open(page, `/people/johan?from=%2Fstaff&section=${PRESENCE_LENS}`);
    await expect(sections.locator('[aria-current="true"]')).toContainText('Behöver dig');
    await expect(page.getByRole('heading', { level: 2, name: 'Behöver dig' })).toBeVisible();
    // A source that did not answer has its tab, and its section says so beside its action.
    people.empty = [];
    people.silent[PRESENCE_LENS] = 'unavailable';
    await open(page, `/people/johan?from=%2Fstaff&section=${PRESENCE_LENS}`);
    await expect(sections.locator('[aria-current="true"]')).toContainText('Frånvaro');
    await expect(main.getByText('Personalsystemet svarade inte.')).toBeVisible();
    await expect(main.getByRole('button', { name: 'Registrera frånvaro', exact: true })).toHaveCount(1);
    await expect(main.getByRole('button', { name: /Fler åtgärder/ })).toHaveCount(0);
  });

  test('a source that does not answer has its tab, says so in its own place, once aloud, and Försök igen asks it alone', async ({
    page,
    api: _,
  }) => {
    const people = new People();
    await people.route(page);
    await open(page, `/people/johan?from=%2Fstaff&section=${SILENT_SECTION}`);
    const sections = page.getByRole('navigation', { name: 'Om Johan Byström' });
    await expect(sections.locator('[aria-current="true"]')).toContainText('Kompetenser');
    await expect(page.getByRole('main').getByText('Kompetenssystemet svarade inte.')).toBeVisible();
    await expect.poll(() => said(page, 'Kompetenssystemet svarade inte.')).toBe(1);
    const before = [...people.reads];
    delete people.silent[SILENT_SECTION];
    await page.getByRole('main').getByRole('button', { name: 'Försök igen med Kompetenser' }).click();
    await expect(page.getByRole('main').getByText('HLR vuxen').first()).toBeVisible();
    expect(people.reads.slice(before.length)).toEqual([SILENT_SECTION]);
    expect(await said(page, 'Kompetenssystemet svarade inte.')).toBe(1);
  });

  test('each section arrives on its own: a slow source does not hold the others', async ({ page, api: _ }) => {
    const people = new People();
    people.delay[PRESENCE_LENS] = 2_500;
    await people.route(page);
    await page.goto(`/people/johan?from=%2Fstaff&section=${PRESENCE_LENS}`);
    // Frånvaro is chosen and on its way: the strip and the other sections do not wait for it.
    const sections = page.getByRole('navigation', { name: 'Om Johan Byström' });
    await expect(page.getByRole('heading', { level: 2, name: 'Frånvaro' })).toBeVisible();
    await expect(page.getByText('Semester 21–23 dec')).toHaveCount(0);
    await sections.getByRole('link', { name: 'Utvecklingssamtal' }).click();
    await expect(page.getByText('Skicka underlag om schemaläggning')).toBeVisible();
    await page.goBack();
    await expect(page.getByRole('heading', { level: 2, name: 'Frånvaro' })).toBeVisible();
    await expect(page.getByText('Semester 21–23 dec').first()).toBeVisible({ timeout: 10_000 });
    expect(people.reads).toEqual(expect.arrayContaining([TALK_LENS, PRESENCE_LENS, CONTACT, SILENT_SECTION]));
  });
});

test.describe('the person on a phone', () => {
  test.use({ viewport: phoneSize });

  test('Åtgärder holds the actions no section holds; the strip is the one of a wide window, its first tab chosen, and a tab leads to its section and back', async ({
    page,
    api: _,
  }) => {
    await new People().route(page);
    await open(page, '/people/johan?from=%2Fstaff');
    await page.getByRole('main').getByRole('button', { name: 'Åtgärder för Johan Byström' }).click();
    const menu = page.getByRole('menu', { name: 'Åtgärder för Johan Byström' });
    await expect(menu.getByRole('menuitem')).toHaveText(['Boka möte']);
    await page.evaluate(() => Promise.all(document.getAnimations().map(a => a.finished)));
    await expectNoAxeViolations(page);
    await page.keyboard.press('Escape');
    const sections = page.getByRole('navigation', { name: 'Om Johan Byström' });
    await expect(sections.locator('[aria-current="true"]')).toContainText('Behöver dig');
    await expect(page.getByRole('heading', { level: 2, name: 'Behöver dig' })).toBeVisible();
    const talk = sections.getByRole('link', { name: 'Utvecklingssamtal' });
    await talk.click();
    await expect(page).toHaveURL(/section=clew\.talkPeople/);
    await expect(talk).toBeFocused();
    await expect(page.getByText('Skicka underlag om schemaläggning')).toBeVisible();
    await expectNoAxeViolations(page);
    await page.goBack();
    await expect(page).toHaveURL('/people/johan?from=%2Fstaff');
    await expect(page.getByRole('heading', { level: 2, name: 'Behöver dig' })).toBeVisible();
  });

  test('in an opened section its source’s action is a button the width of the column, and not under Åtgärder', async ({
    page,
    api: _,
  }) => {
    await new People().route(page);
    await open(page, `/people/johan?from=%2Fstaff&section=${PRESENCE_LENS}`);
    const main = page.getByRole('main');
    await expect(page.getByRole('heading', { level: 2, name: 'Frånvaro' })).toBeVisible();
    await expect(main.getByText(/Personalsystemet · hämtat/)).toBeVisible();
    const button = main.getByRole('button', { name: 'Registrera frånvaro', exact: true });
    await expect(button).toBeVisible();
    // The strip spans the column.
    const column = page.getByRole('navigation', { name: 'Om Johan Byström' });
    const [b, t] = await Promise.all([button.boundingBox(), column.boundingBox()]);
    expect(Math.abs(b!.width - t!.width)).toBeLessThanOrEqual(1);
    await expectNoAxeViolations(page);
    await main.getByRole('button', { name: 'Åtgärder för Johan Byström' }).click();
    const menu = page.getByRole('menu', { name: 'Åtgärder för Johan Byström' });
    await expect(menu.getByRole('menuitem')).toHaveText(['Boka möte']);
    await expect(
      page
        .getByRole('button', { name: 'Registrera frånvaro', exact: true })
        .or(page.getByRole('menuitem', { name: 'Registrera frånvaro' })),
    ).toHaveCount(1);
  });

  test('the keyboard through the strip: the arrows move between the tabs, Enter opens one, the chosen tab is scrolled into view, and Tab leaves the strip', async ({
    page,
    api: _,
  }) => {
    await new People().route(page);
    await open(page, '/people/johan?from=%2Fstaff');
    const sections = page.getByRole('navigation', { name: 'Om Johan Byström' });
    const last = sections.getByRole('link', { name: 'Kompetenser' });
    await sections.getByRole('link').first().focus();
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
    await expect(last).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(`/people/johan?section=${SILENT_SECTION}&from=%2Fstaff`);
    await expect(last).toHaveAttribute('aria-current', 'true');
    await expect(last).toBeFocused();
    await expect(last).toBeInViewport();
    await expect(page.getByRole('heading', { level: 2, name: 'Kompetenser' })).toBeVisible();
    await expect(page.getByRole('main').getByText('Kompetenssystemet svarade inte.')).toBeVisible();
    await page.keyboard.press('ArrowLeft');
    await expect(sections.getByRole('link', { name: 'Kontakt' })).toBeFocused();
    // The strip is one stop: Tab goes on to the section, not to the next tab.
    await page.keyboard.press('Tab');
    await expect(page.getByRole('main').getByRole('button', { name: 'Försök igen med Kompetenser' })).toBeFocused();
    await expectNoAxeViolations(page);
  });
});

test.describe('1.4.10 reflow', () => {
  test.use({ viewport: narrow });
  test('the person as a page reflows at 320 px: the tab strip fits and scrolls, its chosen tab in view', async ({
    page,
    api: _,
  }) => {
    await new People().route(page);
    await open(page, '/people/johan?from=%2Fstaff');
    const strip = page.getByRole('navigation', { name: 'Om Johan Byström' });
    await expect(strip).toBeVisible();
    const box = (await strip.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(narrow.width);
    expect(outsideTheStrip(await reflowProblems(page))).toEqual([]);
    await open(page, '/people/johan?from=%2Fstaff&section=clew.talkPeople');
    await expect(page.getByText('Skicka underlag om schemaläggning')).toBeVisible();
    expect(outsideTheStrip(await reflowProblems(page))).toEqual([]);
    await open(page, `/people/johan?from=%2Fstaff&section=${SILENT_SECTION}`);
    await expect(strip.getByRole('link', { name: 'Kompetenser' })).toBeInViewport({ ratio: 1 });
    expect(outsideTheStrip(await reflowProblems(page))).toEqual([]);
  });
  test('a card opened on the person’s page lies over it and reflows at 320 px', async ({ page, api: _ }) => {
    await new People().route(page);
    await open(page, '/people/johan?from=%2Fstaff&card=samtal-svar');
    const drawer = page.getByRole('dialog', { name: 'Kort' });
    await expect(drawer.getByRole('article', { name: 'Kort: Planera utvecklingssamtal vecka 45' })).toBeVisible();
    await page.evaluate(() => Promise.all(document.getAnimations().map(a => a.finished)));
    expect(await reflowProblems(page, drawer)).toEqual([]);
    expect(outsideTheStrip(await reflowProblems(page))).toEqual([]);
    await expectNoAxeViolations(page);
  });
});

test.describe('a card row that names the person whose page it is beside', () => {
  test.use({ viewport: wide });

  test('the person the page is about is plain text in the card, another person is a link whose way back holds no way back, and elsewhere the same row leads to the page', async ({
    page,
    api,
  }) => {
    // The card under Behöver dig with two rows that name a person: Johan, whose page it is beside, and Anna.
    const row = (key: string, label: string, detail: string) => ({
      ref: `hr:person:${key}`,
      label,
      detail,
      selectable: false,
      selected: false,
      subject: { entity: 'person' as const, key },
    });
    api.threads = api.threads.map(t =>
      t.id === 'samtal-svar'
        ? {
            ...t,
            proposals: [],
            items: [row('johan', 'Johan Byström', 'Medarbetare'), row('anna', 'Anna Lindqvist', 'Chef')],
          }
        : t,
    );
    await new People().route(page);
    await open(page, '/people/johan?section=needs-you&from=%2Fstaff&card=samtal-svar');
    const panel = page.getByRole('complementary', { name: 'Kort' });
    // Anna's page has this page as its way back, the section and the card kept and this page's own `from` left out.
    await expect(panel.getByRole('link', { name: 'Anna Lindqvist', exact: true })).toHaveAttribute(
      'href',
      '/people/anna?from=%2Fpeople%2Fjohan%3Fsection%3Dneeds-you%26card%3Dsamtal-svar',
    );
    // Johan is named in plain text: a link would lead out of the card to the page the reader is on (the product
    // owner, 2026-11-11).
    await expect(panel.getByText('Johan Byström', { exact: true })).toBeVisible();
    await expect(panel.getByRole('link', { name: 'Johan Byström', exact: true })).toHaveCount(0);
    await expectNoAxeViolations(page);
    // Beside any other page the same row leads to Johan's page, with that page as the way back.
    await open(page, '/?card=samtal-svar');
    await expect(
      page.getByRole('complementary', { name: 'Kort' }).getByRole('link', { name: 'Johan Byström', exact: true }),
    ).toHaveAttribute('href', '/people/johan?from=%2F%3Fcard%3Dsamtal-svar');
  });
});
