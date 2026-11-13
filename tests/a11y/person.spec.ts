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
import {
  CONTACT,
  FRITIDS,
  JOHAN_EMAIL,
  LONG_PHONE_CATEGORY,
  POINTS,
  People,
  pointsOutput,
  pointsSpec,
} from './person-data';

/**
 * The opened person (D112 item 5, board Person; D97 item 5, D111 rule 3: a person is a page only), in the work item's
 * page shape: the header with the way back, the unit, the name and title, every action and "Fråga Clew"; the main
 * column with "Behöver dig" and then every source's section one under the other, each with its source's badge; the
 * details rail with the directory's facts and the unit, behind "Visa detaljer" where it does not fit or while the panel
 * holds something. `?section=` scrolls to a section and gives its heading the focus. The shared mock answers the list;
 * `person-data.ts` answers the person and their sections, with Johan's profile (D114: Anställningar and
 * Kontaktuppgifter, a long phone category among the numbers), Kontakt and the talk's action points beside the mock's
 * sources and Kompetenssystemet silent until a test lets it answer. Keyboard, focus, announcements, axe and reflow. An
 * address that drew the person beside Personal's list leads here (`staff.spec.ts`).
 */
const wide = { width: 1440, height: 900 };
const tablet = { width: 1024, height: 768 };
const phoneSize = { width: 390, height: 844 };
const said = async (page: Page, text: string) => (await announcements(page)).filter(t => t.includes(text)).length;
/**
 * The main column's sections in the order a screen reader meets them, each by its heading; a work item open in the
 * panel beside the page (inside the main landmark too) or in a dialog over it has sections of its own, left out here.
 */
const sectionsOf = (page: Page) =>
  page
    .getByRole('main')
    .locator('section[aria-labelledby]')
    .evaluateAll(els =>
      els
        .filter(el => !el.closest('[role="complementary"], [role="dialog"], dialog'))
        .map(el => document.getElementById(el.getAttribute('aria-labelledby') ?? '')?.textContent?.trim() ?? ''),
    );
const region = (page: Page, name: string) => page.getByRole('region', { name, exact: true });
/** The way back at the top of the page's header (board Person: "‹ Personal"). */
const wayBack = (page: Page, name: string) => page.getByRole('main').getByRole('link', { name, exact: true });
const EVERY_SECTION = [
  'Behöver dig',
  'Anställningar',
  'Kontaktuppgifter',
  'Utvecklingssamtal',
  'Frånvaro',
  'Kontakt',
  'Kompetenser',
];
/**
 * The e-mail address and each number under Kontaktuppgifter with how many lines its text is drawn on, counted by the
 * tops of its text's line boxes: one each, however long a category is (W2).
 */
const valueLines = (page: Page) =>
  region(page, 'Kontaktuppgifter')
    .locator('a[href^="mailto:"], a[href^="tel:"]')
    .evaluateAll(links =>
      links.map(a => {
        const tops = new Set<number>();
        const walk = document.createTreeWalker(a, NodeFilter.SHOW_TEXT);
        for (let node = walk.nextNode(); node; node = walk.nextNode()) {
          const text = document.createRange();
          text.selectNodeContents(node);
          for (const r of text.getClientRects()) if (r.width > 0) tops.add(Math.round(r.top));
        }
        return [a.textContent?.trim(), tops.size];
      }),
    );
/** Where the first value of a section's labelled facts starts, in px from the window's left edge. */
const valueStart = (page: Page, name: string) =>
  region(page, name)
    .locator('dd')
    .first()
    .evaluate(dd => Math.round(dd.getBoundingClientRect().left));
/** The work item about Johan under Behöver dig, by its title as the stream has it. */
const ITEM = 'Planera utvecklingssamtal vecka 45';

test.describe('the person as a page', () => {
  test.use({ viewport: wide });

  test('the header holds the way back with the unit, the name with the title, the actions and Fråga Clew; every section stands one under the other with its source; the rail holds Detaljer and Tillhör', async ({
    page,
    api: _,
  }) => {
    await new People().route(page);
    await open(page, '/people/johan?from=%2Fstaff');
    await expect(page).toHaveTitle('Johan Byström · Startsidan');
    const main = page.getByRole('main');
    const name = page.getByRole('heading', { level: 1, name: 'Johan Byström' });
    await expect(name).toBeVisible();
    await expect(wayBack(page, 'Personal')).toHaveAttribute('href', '/staff');
    await expect(main.getByText('Lärare 4–6', { exact: true }).first()).toBeVisible();
    // The actions about the person on the name's line: the first two as buttons, the rest under Fler, and Fråga Clew.
    const first = main.getByRole('button', { name: 'Boka möte', exact: true });
    await expect(first).toBeVisible();
    await expect(main.getByRole('button', { name: 'Registrera frånvaro', exact: true })).toBeVisible();
    await expect(main.getByRole('button', { name: 'Fler åtgärder för Johan Byström' })).toBeVisible();
    await expect(main.getByRole('button', { name: 'Boka samtal', exact: true })).toHaveCount(0);
    await expect(main.getByRole('link', { name: 'Fråga Clew' })).toBeVisible();
    const [h, b] = await Promise.all([name.boundingBox(), first.boundingBox()]);
    expect(b!.y).toBeLessThan(h!.y + h!.height);
    // Every section, one under the other in the page's order: no tab strip chooses one.
    expect(await sectionsOf(page)).toEqual(EVERY_SECTION);
    await expect(page.getByRole('navigation', { name: 'Om Johan Byström' })).toHaveCount(0);
    await expect(page.getByRole('tablist')).toHaveCount(0);
    const [talk, presence] = await Promise.all([
      region(page, 'Utvecklingssamtal').boundingBox(),
      region(page, 'Frånvaro').boundingBox(),
    ]);
    expect(presence!.y).toBeGreaterThanOrEqual(talk!.y + talk!.height);
    // Each source's name as a badge on its heading's line, Clew's own as Clew; a silent one says so in its place.
    await expect(region(page, 'Frånvaro').getByText('Personalsystemet', { exact: true }).first()).toBeVisible();
    await expect(region(page, 'Utvecklingssamtal').getByText('Clew', { exact: true }).first()).toBeVisible();
    await expect(region(page, 'Kontakt').getByText('Katalogen', { exact: true }).first()).toBeVisible();
    await expect(region(page, 'Kompetenser').getByText('Kompetenssystemet svarade inte.')).toBeVisible();
    // The profile (D114): each employment an item of a list named for the section, its unit or, for a unit since
    // removed, the word as its name, its first day a date in the house format, its percentage with at most two decimals.
    const jobs = region(page, 'Anställningar').getByRole('list', { name: 'Anställningar' });
    await expect(jobs.getByRole('listitem')).toHaveCount(2);
    // Each item's name exactly, so that "Anställningsform" among the details cannot stand in for it.
    await expect(jobs.getByRole('listitem').nth(0).getByText('Bergsåkers skola', { exact: true })).toBeVisible();
    await expect(jobs.getByRole('listitem').nth(0).locator('time')).toHaveText('15 augusti 2018');
    await expect(jobs.getByRole('listitem').nth(0)).toContainText(/Sysselsättningsgrad\s*57\s%/);
    await expect(jobs.getByRole('listitem').nth(1).getByText('Anställning', { exact: true })).toBeVisible();
    await expect(jobs.getByRole('listitem').nth(1)).toContainText('Vikariat');
    await expect(jobs.getByRole('listitem').nth(1)).toContainText(/43\s%/);
    const contacts = region(page, 'Kontaktuppgifter');
    await expect(contacts.getByText(LONG_PHONE_CATEGORY, { exact: true })).toBeVisible();
    await expect(contacts.getByRole('link', { name: '070-000 00 03' })).toHaveAttribute('href', 'tel:0700000003');
    await expect(contacts.getByRole('link', { name: JOHAN_EMAIL })).toHaveAttribute('href', `mailto:${JOHAN_EMAIL}`);
    // Where the column is wide, the profile's values start where the sources' values do: one label column (W2).
    const sourceStart = await valueStart(page, 'Kontakt');
    expect(await valueStart(page, 'Kontaktuppgifter')).toBe(sourceStart);
    expect(await valueStart(page, 'Anställningar')).toBe(sourceStart);
    // The talks section keeps its fuller read and its way in.
    await expect(region(page, 'Utvecklingssamtal').getByText('Skicka underlag om schemaläggning')).toBeVisible();
    await expect(region(page, 'Utvecklingssamtal').getByRole('link', { name: 'Öppna samtalet' })).toBeVisible();
    // The rail: the directory's facts under its name, and the unit as a link to its page with this page as the way back.
    const details = page.getByRole('complementary', { name: 'Detaljer' });
    await expect(details.locator('[aria-level="2"]').filter({ hasText: /^Detaljer$/ })).toBeVisible();
    await expect(details.locator('[aria-level="2"]').filter({ hasText: /^Tillhör$/ })).toBeVisible();
    await expect(details.getByText('Katalogen', { exact: true })).toBeVisible();
    for (const term of ['Titel', 'Lärare 4–6', 'Användarnamn', 'johan', 'Chef'])
      await expect(details).toContainText(term);
    await expect(details.getByRole('link', { name: 'Enhet: Bergsåkers skola' })).toHaveAttribute(
      'href',
      '/units/unit-skola?from=%2Fpeople%2Fjohan',
    );
    await expectNoAxeViolations(page);
    const { unmarked } = await hiddenFocusStops(page);
    expect(unmarked).toEqual([]);
  });

  test('the keyboard goes from the way back through the header’s buttons, then the sections, then the rail', async ({
    page,
    api: _,
  }) => {
    await new People().route(page);
    await open(page, '/people/johan?from=%2Fstaff');
    await wayBack(page, 'Personal').focus();
    const stops: string[] = [];
    for (let i = 0; i < 40 && !stops.some(s => s.startsWith('Enhet')); i++) {
      await page.keyboard.press('Tab');
      stops.push(
        await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          return (el?.getAttribute('aria-label') ?? el?.textContent ?? '').trim();
        }),
      );
    }
    const at = (name: string) => stops.findIndex(s => s.startsWith(name));
    expect(at('Boka möte')).toBeGreaterThanOrEqual(0);
    expect(at('Boka möte')).toBeLessThan(at(ITEM));
    expect(at(ITEM)).toBeLessThan(at('Öppna samtalet'));
    expect(at('Öppna samtalet')).toBeLessThan(at('Enhet'));
  });

  test('?section= scrolls to that section and gives its heading the focus, so an old link, Personal’s count and a talk’s way back land where they did', async ({
    page,
    api: _,
  }) => {
    const people = new People();
    await people.route(page);
    await open(page, `/people/johan?section=${SILENT_SECTION}&from=%2Fstaff`);
    const last = page.getByRole('heading', { level: 2, name: 'Kompetenser' });
    await expect(last).toBeFocused();
    await expect(last).toBeInViewport();
    // Every section is still there above it.
    expect(await sectionsOf(page)).toEqual(EVERY_SECTION);
    await open(page, '/people/johan?section=needs-you&from=%2Fstaff');
    await expect(page.getByRole('heading', { level: 2, name: 'Behöver dig' })).toBeFocused();
    await open(page, `/people/johan?section=${PRESENCE_LENS}&from=%2Fstaff`);
    await expect(page.getByRole('heading', { level: 2, name: 'Frånvaro', exact: true })).toBeFocused();
    // With a work item open beside the page from the address, the item keeps the focus; the section is only scrolled to.
    await open(page, `/people/johan?section=${CONTACT}&from=%2Fstaff&card=samtal-svar`);
    const panel = page.getByRole('complementary', { name: 'Ärende' });
    await expect(panel.locator('[aria-level="2"]').filter({ hasText: 'Ärende' })).toBeFocused();
    await expect(page.getByRole('heading', { level: 2, name: 'Kontakt', exact: true })).toBeInViewport();
    // An address naming a section that has nothing about the person: the section is left out and the page stands.
    people.empty = [PRESENCE_LENS];
    await open(page, `/people/johan?section=${PRESENCE_LENS}&from=%2Fstaff`);
    await expect(page.getByRole('heading', { level: 2, name: 'Frånvaro', exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1, name: 'Johan Byström' })).toBeInViewport();
  });

  test('the trail names where the person was opened from: Att göra for a work item’s row, Personal for the reader’s own people without one', async ({
    page,
    api: _,
  }) => {
    await new People().route(page);
    await open(page, '/people/johan?from=%2Ftodo%3Fitem%3Dsamtal-svar');
    await expect(wayBack(page, 'Att göra')).toHaveAttribute('href', '/todo?item=samtal-svar');
    await expect(wayBack(page, 'Personal')).toHaveCount(0);
    await open(page, '/people/johan');
    await expect(page.getByRole('heading', { level: 1, name: 'Johan Byström' })).toBeVisible();
    await expect(wayBack(page, 'Personal')).toHaveAttribute('href', '/staff');
  });

  test('a person the reader may not ask about is the page’s own “finns inte”', async ({ page, api: _ }) => {
    await new People().route(page);
    await open(page, '/people/okand');
    await expect(page.getByRole('heading', { level: 1, name: 'Personen finns inte' })).toBeVisible();
    await expect(page).toHaveTitle('Personen finns inte · Startsidan');
    await expect(wayBack(page, 'Personal')).toHaveCount(0);
    await expect(page.getByRole('complementary', { name: 'Detaljer' })).toHaveCount(0);
    await expectNoAxeViolations(page);
  });

  test('a colleague’s page reads well with one section and no work items, no way back without an origin, and the unit named but not linked', async ({
    page,
    api: _,
  }) => {
    const people = new People();
    people.colleague = true;
    await people.route(page);
    await open(page, '/people/johan');
    await expect(wayBack(page, 'Personal')).toHaveCount(0);
    expect(await sectionsOf(page)).toEqual(['Kontakt']);
    // Only what the server gives a colleague (artboard G): one action, no Fler, no work items.
    await expect(page.getByRole('main').getByRole('button', { name: 'Boka möte', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /Fler åtgärder/ })).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 2, name: 'Behöver dig' })).toHaveCount(0);
    // The rail: the directory's facts without "Chef", and their unit named, not linked, since the reader may not open it.
    const details = page.getByRole('complementary', { name: 'Detaljer' });
    await expect(details).toContainText('Användarnamn');
    await expect(details).not.toContainText('Chef');
    await expect(details.getByText('Bergsåkers skola', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: /Bergsåkers skola/ })).toHaveCount(0);
    await expectNoAxeViolations(page);
  });

  test('someone who reports to the reader from below is placed on their own unit, in the header, under Tillhör and in Anställningar alike, named and not linked, with the reader as their manager (D99)', async ({
    page,
    api: _,
  }) => {
    const people = new People();
    people.fromBelow = true;
    await people.route(page);
    await open(page, '/people/johan?from=%2Fstaff');
    const main = page.getByRole('main');
    await expect(page.getByRole('heading', { level: 1, name: 'Johan Byström' })).toBeVisible();
    // The header: the way back to Personal, then his own unit, never the reader's.
    await expect(wayBack(page, 'Personal')).toHaveAttribute('href', '/staff');
    await expect(main.getByText(FRITIDS.label, { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Bergsåkers skola', { exact: true })).toHaveCount(0);
    const jobs = region(page, 'Anställningar').getByRole('list', { name: 'Anställningar' });
    await expect(jobs.getByRole('listitem')).toHaveText([new RegExp(`^${FRITIDS.label}`)]);
    // The rail: the reader is his manager, and his unit is named, not linked, since the reader may not open it.
    const details = page.getByRole('complementary', { name: 'Detaljer' });
    await expect(details).toContainText('Chef');
    await expect(details.locator('[aria-level="2"]').filter({ hasText: /^Tillhör$/ })).toBeVisible();
    await expect(details.getByText(FRITIDS.label, { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: new RegExp(FRITIDS.label) })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /^Enhet:/ })).toHaveCount(0);
    await expectNoAxeViolations(page);
  });

  test('a work item under Behöver dig is the work item’s own row and opens beside the page with the address kept; the details step behind Visa detaljer, and Esc gives the focus back to its title', async ({
    page,
    api: _,
  }) => {
    await new People().route(page);
    await open(page, '/people/johan?section=needs-you&from=%2Fstaff');
    const rows = page.getByRole('main').getByRole('list', { name: 'Behöver dig' });
    await expect(rows.getByRole('listitem')).toHaveCount(2);
    const title = rows.getByRole('link', { name: ITEM, exact: true });
    await expect(title).toHaveAttribute('href', '/people/johan?section=needs-you&from=%2Fstaff&card=samtal-svar');
    // The row's state dot and its why, as the queue draws it.
    await expect(rows.getByText('Väntar på svar från 1 medarbetare')).toBeVisible();
    await title.focus();
    await page.keyboard.press('Enter');
    // The person's page stays: its address with the item added, its title, its heading and its way back (D111 rule 3).
    await expect(page).toHaveURL('/people/johan?section=needs-you&from=%2Fstaff&card=samtal-svar');
    const panel = page.getByRole('complementary', { name: 'Ärende' });
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(panel.locator('[aria-level="2"]').filter({ hasText: 'Ärende' })).toBeFocused();
    await expect(panel.getByRole('article', { name: `Ärende: ${ITEM}` })).toBeVisible();
    await expect(page).toHaveTitle('Johan Byström · Startsidan');
    await expect(page.getByRole('heading', { level: 1, name: 'Johan Byström' })).toBeVisible();
    await expect(wayBack(page, 'Personal')).toHaveAttribute('href', '/staff');
    // The row of the item beside the page is the current one; the details give the column its width.
    await expect(title).toHaveAttribute('aria-current', 'true');
    await expect(page.getByRole('complementary', { name: 'Detaljer' })).toHaveCount(0);
    await expect(page.getByRole('main').getByRole('button', { name: 'Visa detaljer' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expectNoAxeViolations(page);
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL('/people/johan?section=needs-you&from=%2Fstaff');
    await expect(panel).toHaveCount(0);
    await expect(title).toBeFocused();
    await expect(title).not.toHaveAttribute('aria-current', 'true');
    await expect(page.getByRole('complementary', { name: 'Detaljer' })).toBeVisible();
  });

  test('an action in the header opens its work item beside the page and closing gives the focus back to the button', async ({
    page,
    api,
  }) => {
    await new People().route(page, api);
    // The panel stands beside every page from 1340 px; the page under it keeps its header as it was.
    await page.setViewportSize({ width: 1400, height: 900 });
    const here = '/people/johan?from=%2Fstaff';
    await open(page, here);
    const button = page.getByRole('main').getByRole('button', { name: 'Registrera frånvaro', exact: true });
    await button.click();
    await expect(page).toHaveURL(`${here}&card=entity-hr-registerAbsence-johan`);
    expect(api.entityStarts).toEqual([{ key: 'johan', capability: 'hr.registerAbsence' }]);
    const panel = page.getByRole('complementary', { name: 'Ärende' });
    await expect(panel.getByText('Registrera frånvaro: Johan Byström').first()).toBeVisible();
    await expect(panel.locator('[aria-level="2"]').filter({ hasText: 'Ärende' })).toBeFocused();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1, name: 'Johan Byström' })).toBeVisible();
    expect(await sectionsOf(page)).toEqual(EVERY_SECTION);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expectNoAxeViolations(page);
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(here);
    await expect(panel).toHaveCount(0);
    await expect(button).toBeFocused();
    // Boka möte the same way, at the full width.
    await page.setViewportSize(wide);
    const book = page.getByRole('main').getByRole('button', { name: 'Boka möte', exact: true });
    await book.click();
    await expect(page).toHaveURL(`${here}&card=entity-calendar-bookMeeting-johan`);
    await expect(panel.getByText('Boka möte: Johan Byström').first()).toBeVisible();
    await expect(panel.locator('[aria-level="2"]').filter({ hasText: 'Ärende' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(here);
    await expect(book).toBeFocused();
  });

  test('every action is in the header: the first two as buttons, the rest under Fler by system; no section holds a button, and no control chooses where the person is shown', async ({
    page,
    api: _,
  }) => {
    await new People().route(page);
    await open(page, `/people/johan?from=%2Fstaff`);
    const main = page.getByRole('main');
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
    // A section holds its source's read and its way in, never an action (D112 item 5 replaces D97's placement).
    for (const name of EVERY_SECTION)
      await expect(region(page, name).getByRole('button', { name: /^Boka|^Registrera/ })).toHaveCount(0);
    await expect(region(page, 'Utvecklingssamtal').getByRole('link', { name: 'Öppna samtalet' })).toBeVisible();
    // A person is a page only (D111 rule 7): nothing offers another place to show them.
    await expect(page.getByText('Öppna som sida')).toHaveCount(0);
    await expect(page.getByText('Visa bredvid')).toHaveCount(0);
  });

  test('a source that refuses an action says why under the header’s buttons, once aloud, and the focus and the page stay', async ({
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
    // It stands in the header, not in a section.
    await expect(region(page, 'Frånvaro').getByText(refusal, { exact: true })).toHaveCount(0);
    await expectNoAxeViolations(page);
  });

  test('a source that answered without a row has no section, and its action still stands in the header', async ({
    page,
    api: _,
  }) => {
    const people = new People();
    people.empty = [PRESENCE_LENS, TALK_LENS];
    await people.route(page);
    await open(page, '/people/johan?from=%2Fstaff');
    expect(await sectionsOf(page)).toEqual([
      'Behöver dig',
      'Anställningar',
      'Kontaktuppgifter',
      'Kontakt',
      'Kompetenser',
    ]);
    const main = page.getByRole('main');
    await expect(main.getByRole('button', { name: 'Boka möte', exact: true })).toBeVisible();
    await expect(main.getByRole('button', { name: 'Registrera frånvaro', exact: true })).toBeVisible();
    await expect(main.getByRole('button', { name: 'Fler åtgärder för Johan Byström' })).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test('a source that does not answer says so in its own section, once aloud, and Försök igen asks it alone', async ({
    page,
    api: _,
  }) => {
    const people = new People();
    await people.route(page);
    await open(page, `/people/johan?from=%2Fstaff&section=${SILENT_SECTION}`);
    const silent = region(page, 'Kompetenser');
    await expect(silent.getByText('Kompetenssystemet svarade inte.')).toBeVisible();
    await expect(silent.getByText('Kompetenssystemet', { exact: true }).first()).toBeVisible();
    await expect.poll(() => said(page, 'Kompetenssystemet svarade inte.')).toBe(1);
    const before = [...people.reads];
    delete people.silent[SILENT_SECTION];
    await silent.getByRole('button', { name: 'Försök igen med Kompetenser' }).click();
    await expect(silent.getByText('HLR vuxen').first()).toBeVisible();
    expect(people.reads.slice(before.length)).toEqual([SILENT_SECTION]);
    expect(await said(page, 'Kompetenssystemet svarade inte.')).toBe(1);
  });

  test('each section arrives on its own: a slow source does not hold the others', async ({ page, api: _ }) => {
    const people = new People();
    people.delay[PRESENCE_LENS] = 2_500;
    await people.route(page);
    await page.goto(`/people/johan?from=%2Fstaff&section=${PRESENCE_LENS}`);
    // Frånvaro is on its way: its heading stands, and the other sections do not wait for it.
    await expect(page.getByRole('heading', { level: 2, name: 'Frånvaro', exact: true })).toBeVisible();
    await expect(page.getByText('Semester 21–23 dec')).toHaveCount(0);
    await expect(region(page, 'Utvecklingssamtal').getByText('Skicka underlag om schemaläggning')).toBeVisible();
    await expect(page.getByText('Semester 21–23 dec').first()).toBeVisible({ timeout: 10_000 });
    expect(people.reads).toEqual(expect.arrayContaining([TALK_LENS, PRESENCE_LENS, CONTACT, SILENT_SECTION]));
  });

  test('the page has no question box of its own, so no row offers Lägg till i samtalet; a work item beside it keeps its own buttons', async ({
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
    // A work item the page started: its own buttons, and none that leads into a box.
    await page.getByRole('main').getByRole('button', { name: 'Boka möte', exact: true }).click();
    const panel = page.getByRole('complementary', { name: 'Ärende' });
    await expect(panel.getByRole('button', { name: 'Inte nu', exact: true }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Lägg till i samtalet' })).toHaveCount(0);
    // A proposal's work item: its menu keeps its other items and has no "Lägg till i samtalet".
    await open(page, '/people/johan?section=needs-you&from=%2Fstaff&card=samtal-svar');
    await expect(panel.getByRole('article', { name: `Ärende: ${ITEM}` })).toBeVisible();
    await panel.getByRole('button', { name: 'Fler val', exact: true }).click();
    const menu = page.getByRole('menu');
    await expect(menu.getByRole('menuitem', { name: 'Varför ser jag detta?' })).toBeVisible();
    await expect(menu.getByRole('menuitem')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
  });
});

test.describe('the person’s page where the rail does not fit', () => {
  test.use({ viewport: tablet });

  test('the details are behind Visa detaljer in a fullscreen dialog, which takes the focus and gives it back', async ({
    page,
    api: _,
  }) => {
    await new People().route(page);
    await open(page, '/people/johan?from=%2Fstaff');
    await expect(page.getByRole('complementary', { name: 'Detaljer' })).toHaveCount(0);
    const show = page.getByRole('main').getByRole('button', { name: 'Visa detaljer' });
    await show.click();
    const dialog = page.getByRole('dialog', { name: 'Detaljer' });
    await expect(dialog).toBeVisible();
    await expect.poll(() => dialog.evaluate(d => d.contains(document.activeElement))).toBe(true);
    for (const term of ['Titel', 'Användarnamn', 'Chef', 'Tillhör']) await expect(dialog).toContainText(term);
    await expect(dialog.getByRole('link', { name: 'Enhet: Bergsåkers skola' })).toBeVisible();
    await expectNoAxeViolations(page);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(show).toBeFocused();
    // The header's buttons stand on the page.
    await expect(page.getByRole('main').getByRole('button', { name: 'Boka möte', exact: true })).toBeVisible();
  });
});

test.describe('the person on a phone', () => {
  test.use({ viewport: phoneSize });

  test('Åtgärder holds every action, the sections stand one under the other, the details are behind the information button, and nothing is pinned to the foot', async ({
    page,
    api: _,
  }) => {
    await new People().route(page);
    await open(page, '/people/johan?from=%2Fstaff');
    const main = page.getByRole('main');
    await main.getByRole('button', { name: 'Åtgärder för Johan Byström' }).click();
    const menu = page.getByRole('menu', { name: 'Åtgärder för Johan Byström' });
    await expect(menu.getByRole('menuitem')).toHaveText(['Boka möte', 'Registrera frånvaro', 'Boka samtal']);
    await page.evaluate(() => Promise.all(document.getAnimations().map(a => a.finished)));
    await expectNoAxeViolations(page);
    await page.keyboard.press('Escape');
    await expect(main.getByRole('button', { name: 'Boka möte', exact: true })).toHaveCount(0);
    expect(await sectionsOf(page)).toEqual(EVERY_SECTION);
    await expect(page.getByRole('complementary', { name: 'Detaljer' })).toHaveCount(0);
    const show = main.getByRole('button', { name: 'Visa detaljer' });
    await show.click();
    const dialog = page.getByRole('dialog', { name: 'Detaljer' });
    await expect(dialog).toContainText('Användarnamn');
    await page.evaluate(() => Promise.all(document.getAnimations().map(a => a.finished)));
    await expectNoAxeViolations(page);
    await page.keyboard.press('Escape');
    await expect(show).toBeFocused();
    // A person's page has no single next step: no button is pinned to the foot when the column scrolls to its end.
    await page.getByRole('heading', { level: 2, name: 'Kompetenser' }).scrollIntoViewIfNeeded();
    await expect(main.getByRole('button', { name: 'Åtgärder för Johan Byström' })).toHaveCount(1);
  });

  test('?section= lands on its section on a phone, and the talks section’s way in is in it', async ({
    page,
    api: _,
  }) => {
    await new People().route(page);
    await open(page, `/people/johan?from=%2Fstaff&section=${TALK_LENS}`);
    const heading = page.getByRole('heading', { level: 2, name: 'Utvecklingssamtal' });
    await expect(heading).toBeFocused();
    await expect(heading).toBeInViewport();
    await expect(region(page, 'Utvecklingssamtal').getByText('Skicka underlag om schemaläggning')).toBeVisible();
    await expect(region(page, 'Utvecklingssamtal').getByRole('link', { name: 'Öppna samtalet' })).toBeVisible();
    await expectNoAxeViolations(page);
  });
});

test.describe('1.4.10 reflow', () => {
  test.use({ viewport: narrow });
  test('the person as a page reflows at 320 px, from its top and at a section', async ({ page, api: _ }) => {
    await new People().route(page);
    await open(page, '/people/johan?from=%2Fstaff');
    await expect(page.getByRole('heading', { level: 1, name: 'Johan Byström' })).toBeVisible();
    expect(await reflowProblems(page)).toEqual([]);
    // Anställningar and Kontaktuppgifter are drawn. On a phone each contact label stands above its value, so a long
    // phone category narrows nothing, and the address and every number have the column's width, each on one line (W2).
    await expect(region(page, 'Anställningar').getByRole('listitem')).toHaveCount(2);
    await expect(region(page, 'Kontaktuppgifter').getByText(LONG_PHONE_CATEGORY, { exact: true })).toBeVisible();
    expect(await valueLines(page)).toEqual([
      [JOHAN_EMAIL, 1],
      ['060-19 20 00', 1],
      ['070-000 00 00', 1],
      ['070-000 00 03', 1],
    ]);
    await open(page, `/people/johan?from=%2Fstaff&section=${TALK_LENS}`);
    await expect(page.getByText('Skicka underlag om schemaläggning')).toBeVisible();
    expect(await reflowProblems(page)).toEqual([]);
    await open(page, `/people/johan?from=%2Fstaff&section=${SILENT_SECTION}`);
    await expect(page.getByRole('heading', { level: 2, name: 'Kompetenser' })).toBeInViewport();
    expect(await reflowProblems(page)).toEqual([]);
  });
  test('a work item opened on the person’s page lies over it and reflows at 320 px', async ({ page, api: _ }) => {
    await new People().route(page);
    await open(page, '/people/johan?from=%2Fstaff&card=samtal-svar');
    const drawer = page.getByRole('dialog', { name: 'Ärende' });
    await expect(drawer.getByRole('article', { name: `Ärende: ${ITEM}` })).toBeVisible();
    await page.evaluate(() => Promise.all(document.getAnimations().map(a => a.finished)));
    expect(await reflowProblems(page, drawer)).toEqual([]);
    expect(await reflowProblems(page)).toEqual([]);
    await expectNoAxeViolations(page);
  });
});

test.describe('a work item’s row that names the person whose page it is beside', () => {
  test.use({ viewport: wide });

  test('the person the page is about is plain text in the item, another person is a link whose way back holds no way back, and elsewhere the same row leads to the page', async ({
    page,
    api,
  }) => {
    // The item under Behöver dig with two rows that name a person: Johan, whose page it is beside, and Anna.
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
    const panel = page.getByRole('complementary', { name: 'Ärende' });
    // Anna's page has this page as its way back, the section and the item kept and this page's own `from` left out.
    await expect(panel.getByRole('link', { name: 'Anna Lindqvist', exact: true })).toHaveAttribute(
      'href',
      '/people/anna?from=%2Fpeople%2Fjohan%3Fsection%3Dneeds-you%26card%3Dsamtal-svar',
    );
    // Johan is named in plain text: a link would lead out of the item to the page the reader is on (the product
    // owner, 2026-11-11).
    await expect(panel.getByText('Johan Byström', { exact: true })).toBeVisible();
    await expect(panel.getByRole('link', { name: 'Johan Byström', exact: true })).toHaveCount(0);
    await expectNoAxeViolations(page);
    // Beside any other page the same row leads to Johan's page, with that page as the way back.
    await open(page, '/todo?item=samtal-svar');
    await expect(
      page
        .getByRole('complementary', { name: 'Valt ärende' })
        .getByRole('link', { name: 'Johan Byström', exact: true }),
    ).toHaveAttribute('href', '/people/johan?from=%2Ftodo%3Fitem%3Dsamtal-svar');
  });
});
