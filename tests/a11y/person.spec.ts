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
import { PRESENCE_LENS, SILENT_SECTION, TALK_LENS, usersPeople } from './data';
import { CONTACT, FRITIDS, JOHAN_EMAIL, MELLANSTADIET, People } from './person-data';

/**
 * The person as a page (D126 rule 1, board Person; D97 item 5): the thing's page, with the way back, the avatar, the
 * name with the title and the unit, the actions under the name (the first as the primary, the second as a secondary,
 * Fråga assistenten, the rest under Fler åtgärder), the person's sections as tabs that are links with their own address
 * (`?section=`), and the facts (Anställning, Kontakt, Enhet) in the end panel, above the read where the window is
 * narrow. Nothing opens over or beside the page (rule 3): a work item is its own page, the talk is its tab, and a
 * propose's dialog comes before anything is created (rule 4). `person-data.ts` answers the person and their sections,
 * with Johan's profile, Kontakt and the talk's action points beside the mock's sources and Kompetenssystemet silent
 * until a test lets it answer. Keyboard, focus, announcements, axe and reflow.
 */
const wide = { width: 1440, height: 900 };
const tablet = { width: 1024, height: 768 };
const phoneSize = { width: 390, height: 844 };
const said = async (page: Page, text: string) => (await announcements(page)).filter(t => t.includes(text)).length;
/** The main column's sections in the order a screen reader meets them, each by its heading. */
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
const tabs = (page: Page, name = 'Johan Byström') => page.getByRole('navigation', { name: `Om ${name}` });
/** The way back at the top of the page's header (board Person: "← Personal"). */
const wayBack = (page: Page, name: string) => page.getByRole('main').getByRole('link', { name, exact: true });
const OVERVIEW = ['Behöver dig', 'Utvecklingssamtal', 'Frånvaro', 'Kontakt', 'Kompetenser'];
/** The tabs by their names, in order: Astryx draws a tab's label twice (once for its width), so its text is not its name. */
async function expectTabs(page: Page, names: Array<string | RegExp>, who?: string) {
  const links = tabs(page, who).getByRole('link');
  await expect(links).toHaveCount(names.length);
  for (const [i, name] of names.entries()) await expect(links.nth(i)).toHaveAccessibleName(name);
}

test.describe('the person as a page', () => {
  test.use({ viewport: wide });

  test('the header holds the way back, the name with the title and unit, the actions under it and the tabs; the facts are the end panel; axe holds', async ({
    page,
    api: _,
  }) => {
    await new People().route(page);
    await open(page, '/people/johan?from=%2Fstaff');
    await expect(page).toHaveTitle('Johan Byström · Startsidan');
    const main = page.getByRole('main');
    await expect(page.getByRole('heading', { level: 1, name: 'Johan Byström' })).toBeVisible();
    await expect(wayBack(page, 'Personal')).toHaveAttribute('href', '/staff');
    await expect(main.getByText('Lärare 4–6 · Bergsåkers skola', { exact: true })).toBeVisible();
    // The avatar is decoration: the name beside it says who it is.
    await expect(main.locator('.astryx-avatar').first()).toHaveAttribute('aria-hidden', 'true');
    // The actions: the first as the primary, the second as a secondary, Fråga assistenten, the rest under Fler åtgärder.
    await expect(main.getByRole('button', { name: 'Boka möte', exact: true })).toBeVisible();
    await expect(main.getByRole('button', { name: 'Registrera frånvaro', exact: true })).toBeVisible();
    await expect(main.getByRole('button', { name: 'Fråga assistenten' })).toBeVisible();
    await main.getByRole('button', { name: 'Fler åtgärder för Johan Byström' }).click();
    await expect(page.getByRole('menuitem')).toHaveText(['Boka samtal']);
    await page.keyboard.press('Escape');
    // The tabs, each a link with its own address; Översikt is the current one.
    const strip = tabs(page);
    await expectTabs(page, ['Översikt', 'Utvecklingssamtal', 'Frånvaro', 'Kontakt', 'Kompetenser', /^Ärenden\s*2/]);
    await expect(strip.getByRole('link', { name: 'Översikt' })).toHaveAttribute('aria-current', 'true');
    await expect(strip.getByRole('link', { name: 'Frånvaro' })).toHaveAttribute(
      'href',
      `/people/johan?section=${PRESENCE_LENS}&from=%2Fstaff`,
    );
    // Översikt: Behöver dig and each source in short, each with its way to its tab.
    expect(await sectionsOf(page)).toEqual(OVERVIEW);
    await expect(region(page, 'Frånvaro').getByRole('link', { name: 'Visa allt om frånvaro' })).toHaveAttribute(
      'href',
      `/people/johan?section=${PRESENCE_LENS}&from=%2Fstaff`,
    );
    await expect(region(page, 'Frånvaro').getByText('Personalsystemet', { exact: true })).toBeVisible();
    await expect(region(page, 'Kompetenser').getByText('Kompetenssystemet svarade inte.')).toBeVisible();
    // The facts: Anställning, Kontakt with the user name in code type, and the unit as a link with this page as the way back.
    const facts = page.getByRole('complementary', { name: 'Uppgifter' });
    for (const heading of ['Anställning', 'Kontakt', 'Enhet'])
      await expect(facts.locator('[aria-level="2"]').filter({ hasText: new RegExp(`^${heading}$`) })).toBeVisible();
    await expect(facts).toContainText('Chef');
    await expect(facts.getByRole('link', { name: JOHAN_EMAIL })).toHaveAttribute('href', `mailto:${JOHAN_EMAIL}`);
    await expect(facts.locator('[data-type="code"]')).toHaveText('johan.bystrom');
    await expect(facts.getByRole('link', { name: 'Bergsåkers skola' })).toHaveAttribute(
      'href',
      '/units/unit-skola?from=%2Fpeople%2Fjohan',
    );
    await expectNoAxeViolations(page);
    const { unmarked } = await hiddenFocusStops(page);
    expect(unmarked).toEqual([]);
  });

  test('a tab is a link with its own address: Back returns to the one before, a reload stays, and a source’s tab holds its fuller read', async ({
    page,
    api: _,
  }) => {
    await new People().route(page);
    await open(page, '/people/johan?from=%2Fstaff');
    const strip = tabs(page);
    await strip.getByRole('link', { name: 'Kontakt' }).click();
    await expect(page).toHaveURL(`/people/johan?section=${CONTACT}&from=%2Fstaff`);
    await expect(page).toHaveTitle('Kontakt · Johan Byström · Startsidan');
    await expect(strip.getByRole('link', { name: 'Kontakt' })).toHaveAttribute('aria-current', 'true');
    expect(await sectionsOf(page)).toEqual(['Kontakt']);
    await page.reload();
    await expect(strip.getByRole('link', { name: 'Kontakt' })).toHaveAttribute('aria-current', 'true');
    await page.goBack();
    await expect(page).toHaveURL('/people/johan?from=%2Fstaff');
    expect(await sectionsOf(page)).toEqual(OVERVIEW);
    // A source that does not answer says so in its own tab, once aloud, and Försök igen asks it alone.
    await open(page, `/people/johan?section=${SILENT_SECTION}&from=%2Fstaff`);
    await expect(region(page, 'Kompetenser').getByText('Kompetenssystemet svarade inte.')).toBeVisible();
    await expect(
      region(page, 'Kompetenser').getByRole('button', { name: 'Försök igen med Kompetenser' }),
    ).toBeVisible();
    await expect.poll(() => said(page, 'Kompetenssystemet svarade inte.')).toBe(1);
    await expectNoAxeViolations(page);
  });

  test('Ärenden lists the work items about the person, each title a link to the item’s own page with this page as the way back', async ({
    page,
    api: _,
  }) => {
    await new People().route(page);
    await open(page, '/people/johan?section=needs-you&from=%2Fstaff');
    const rows = page.getByRole('main').getByRole('list', { name: 'Behöver dig' });
    await expect(rows.getByRole('listitem')).toHaveCount(2);
    const title = rows.getByRole('link').first();
    await expect(title).toHaveAttribute('href', /^\/items\/[^?]+\?from=%2Fpeople%2Fjohan%3Fsection%3Dneeds-you$/);
    await title.click();
    await expect(page).toHaveURL(/^http:\/\/[^/]+\/items\//);
    await page.goBack();
    await expect(page).toHaveURL('/people/johan?section=needs-you&from=%2Fstaff');
    await expect(rows.getByRole('link').first()).toBeFocused();
  });

  test('a propose from the header opens its dialog and nothing is started before its last button (D126 rule 4)', async ({
    page,
    api,
  }) => {
    await new People().route(page, api);
    const here = '/people/johan?from=%2Fstaff';
    await open(page, here);
    const button = page.getByRole('main').getByRole('button', { name: 'Registrera frånvaro', exact: true });
    await button.click();
    const dialog = page.getByRole('dialog', { name: 'Registrera frånvaro' });
    await expect(dialog).toBeVisible();
    expect(api.entityStarts).toEqual([]);
    await expectNoAxeViolations(page);
    // Avbryt sends nothing, and the focus goes back to the button.
    await dialog.getByRole('button', { name: 'Avbryt' }).click();
    await expect(dialog).toBeHidden();
    await expect(button).toBeFocused();
    expect(api.entityStarts).toEqual([]);
    // The last button starts it, and its work item opens on its own page with this page as the way back.
    await button.click();
    await dialog.getByRole('button', { name: 'Registrera frånvaro' }).click();
    await expect(dialog).toBeHidden();
    expect(api.entityStarts).toEqual([{ key: 'johan', capability: 'hr.registerAbsence', values: {} }]);
    await expect(page).toHaveURL('/items/entity-hr-registerAbsence-johan?from=%2Fpeople%2Fjohan');
  });

  test('a source that refuses an action says why under the buttons, once aloud, and the page stays', async ({
    page,
    api,
  }) => {
    const refusal = 'Personalsystemet hittar ingen anställning för Johan Byström.';
    api.entityRefusals['hr.registerAbsence'] = refusal;
    await new People().route(page, api);
    const here = `/people/johan?from=%2Fstaff&section=${PRESENCE_LENS}`;
    await open(page, here);
    const main = page.getByRole('main');
    await main.getByRole('button', { name: 'Registrera frånvaro', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Registrera frånvaro' });
    await dialog.getByRole('button', { name: 'Registrera frånvaro' }).click();
    // The dialog places the refusal; the page does not say it a second time.
    await expect(dialog.getByText(refusal)).toBeVisible();
    await expect(page).toHaveURL(here);
    await expectNoAxeViolations(page);
  });

  test('the talk is the person’s talk tab, and an address that laid it over the page leads there (D126 rule 3)', async ({
    page,
    api: _,
  }) => {
    await new People().route(page);
    await open(page, '/people/karin?from=%2Fstaff&talk=karin');
    await expect(page).toHaveURL(`/people/karin?section=${TALK_LENS}&from=%2Fstaff`);
    const talk = region(page, 'Utvecklingssamtal');
    await expect(talk.getByRole('heading', { name: 'Samtalet' })).toBeVisible();
    await expect(talk.getByRole('heading', { name: 'Åtgärdspunkter' })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // The talk's way in is the tab itself: no link leads over the page.
    await expect(talk.getByRole('link', { name: 'Öppna samtalet' })).toHaveCount(0);
    await expectNoAxeViolations(page);
    // From Personal too, with the register as the way back.
    await open(page, '/staff?talk=karin');
    await expect(page).toHaveURL(`/people/karin?section=${TALK_LENS}&from=%2Fstaff`);
  });

  test('a person the reader may not ask about is the page’s own “finns inte”', async ({ page, api: _ }) => {
    await new People().route(page);
    await open(page, '/people/okand');
    await expect(page.getByRole('heading', { level: 1, name: 'Personen finns inte' })).toBeVisible();
    await expect(page).toHaveTitle('Personen finns inte · Startsidan');
    await expect(page.getByRole('complementary', { name: 'Uppgifter' })).toHaveCount(0);
    await expectNoAxeViolations(page);
  });

  test('a colleague’s page has one tab of sources, no way back without an origin, no Chef, and the unit named but not linked', async ({
    page,
    api: _,
  }) => {
    const people = new People();
    people.colleague = true;
    await people.route(page);
    await open(page, '/people/johan');
    await expect(wayBack(page, 'Personal')).toHaveCount(0);
    await expectTabs(page, ['Översikt', 'Kontakt']);
    await expect(page.getByRole('main').getByRole('button', { name: 'Boka möte', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /Fler åtgärder/ })).toHaveCount(0);
    const facts = page.getByRole('complementary', { name: 'Uppgifter' });
    await expect(facts).not.toContainText('Chef');
    await expect(facts.getByText('Bergsåkers skola', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: /Bergsåkers skola/ })).toHaveCount(0);
    await expectNoAxeViolations(page);
  });

  test('someone who reports to the reader from below is placed on the unit they lead, which is a link where the reader follows it up (D99, D117)', async ({
    page,
    api: _,
  }) => {
    const below = new People();
    below.fromBelow = true;
    await below.route(page);
    await open(page, '/people/johan?from=%2Fstaff');
    await expect(page.getByRole('main').getByText(`Lärare 4–6 · ${FRITIDS.label}`)).toBeVisible();
    const facts = page.getByRole('complementary', { name: 'Uppgifter' });
    await expect(facts).toContainText('Chef');
    await expect(facts.getByRole('link', { name: FRITIDS.label })).toHaveAttribute(
      'href',
      `/units/${FRITIDS.id}?from=%2Fpeople%2Fjohan`,
    );
    await expectNoAxeViolations(page);
  });

  test('someone placed on a unit below without a manager of its own names it, not linked (D99, D117)', async ({
    page,
    api: _,
  }) => {
    const people = new People();
    people.placedBelow = true;
    await people.route(page);
    await open(page, '/people/johan?from=%2Fstaff');
    const facts = page.getByRole('complementary', { name: 'Uppgifter' });
    await expect(facts.getByText(MELLANSTADIET.label, { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: new RegExp(MELLANSTADIET.label) })).toHaveCount(0);
    await expectNoAxeViolations(page);
  });

  test('an administrator of users reads under Kontakt whether the person has signed in; nobody else does', async ({
    page,
    api,
  }) => {
    await new People().route(page);
    api.people = [{ ...usersPeople()[0]!, id: 'johan', bound: false }];
    await open(page, '/people/johan?from=%2Fstaff');
    const facts = page.getByRole('complementary', { name: 'Uppgifter' });
    await expect(facts).toContainText('Användarnamn');
    await expect(facts).not.toContainText('Inloggning');
    expect(api.peopleQueries).toEqual([]);
    api.admin = true;
    await page.reload();
    await expect(facts).toContainText('Inloggning');
    await expect(facts.getByText('Inte inloggad ännu', { exact: true })).toBeVisible();
    expect(api.peopleQueries).toContainEqual({ personId: 'johan' });
    await expectNoAxeViolations(page);
  });
});

test.describe('the person’s page where the window is narrow', () => {
  test.use({ viewport: tablet });
  test('the facts stand above the read, in the column, and nothing opens over the page', async ({ page, api: _ }) => {
    await new People().route(page);
    await open(page, '/people/johan?from=%2Fstaff');
    await expect(page.getByRole('complementary', { name: 'Uppgifter' })).toHaveCount(0);
    const facts = page.getByRole('main').getByRole('region', { name: 'Uppgifter' });
    await expect(facts).toContainText('Användarnamn');
    const [top, needs] = await Promise.all([
      facts.boundingBox(),
      page.getByRole('heading', { level: 2, name: 'Behöver dig' }).boundingBox(),
    ]);
    expect(top!.y).toBeLessThan(needs!.y);
    await expect(page.getByRole('button', { name: 'Visa detaljer' })).toHaveCount(0);
    await expectNoAxeViolations(page);
  });
});

test.describe('the person on a phone', () => {
  test.use({ viewport: phoneSize });
  test('Åtgärder holds every action with Fråga assistenten under it, and the tabs scroll in their strip', async ({
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
    await expect(main.getByRole('button', { name: 'Fråga assistenten' })).toBeVisible();
    await expect(tabs(page).getByRole('link', { name: 'Översikt' })).toBeInViewport();
  });
});

/**
 * One conversation per person, not one per tab (the product owner, 2026-11-14): "Fråga assistenten" on any of a person's tabs
 * lands on a conversation about the person, titled "Fråga om <name>" before anything is written, with the person beside
 * it drawn with the page's parts and tabs; the tab it came from is only the pane's first tab. Changing the pane's tab
 * changes its address and nothing else; Esc in the pane lets go of the person and keeps the conversation.
 */
test.describe('a conversation about a person', () => {
  test.use({ viewport: wide });
  const box = (page: Page) => page.getByRole('combobox', { name: 'Svara i samtalet' });
  const pane = (page: Page) => page.getByRole('complementary', { name: 'Johan Byström' });

  test('one subject, two entry tabs: Frånvaro and Kontakt lead to the same person, each first in the pane', async ({
    page,
    api,
  }) => {
    await new People().route(page);
    for (const [section, label] of [
      [PRESENCE_LENS, 'Frånvaro'],
      [CONTACT, 'Kontakt'],
    ] as const) {
      await open(page, `/people/johan?section=${section}&from=%2Fstaff`);
      await page.getByRole('main').getByRole('button', { name: 'Fråga assistenten' }).click();
      // The address carries the person; the tab only says what the pane shows first.
      await expect(page).toHaveURL(`/conversations/new?person=johan&section=${section}`);
      await expect(page.getByRole('heading', { level: 1, name: 'Fråga om Johan Byström' })).toBeVisible();
      await expect(page).toHaveTitle('Fråga om Johan Byström · Startsidan');
      await expect(page.getByText('Samtal med assistenten', { exact: true })).toBeVisible();
      await expect(page.getByText('Fråga om Johan', { exact: true })).toBeVisible();
      await expect(box(page)).toBeFocused();
      // The pane is the person: the name as the link to their page at the same tab, the line under it, the tabs.
      await expect(pane(page).getByRole('link', { name: 'Johan Byström' })).toHaveAttribute(
        'href',
        new RegExp(`^/people/johan\\?section=${section.replace('.', '\\.')}&from=`),
      );
      await expect(pane(page).getByText('Lärare 4–6 · Bergsåkers skola', { exact: true })).toBeVisible();
      await expect(pane(page).getByRole('navigation', { name: 'Om Johan Byström' })).toBeVisible();
      await expect(pane(page).getByRole('region', { name: label, exact: true })).toBeVisible();
      // Only the reads: none of the page's actions.
      await expect(pane(page).getByRole('button', { name: 'Boka möte' })).toHaveCount(0);
      await expect(pane(page).getByRole('button', { name: 'Fråga assistenten' })).toHaveCount(0);
    }
    await expectNoAxeViolations(page);
    // The pane's Översikt is an address of the same conversation: the subject stays, nothing is asked.
    await pane(page).getByRole('link', { name: 'Översikt' }).click();
    await expect(page).toHaveURL('/conversations/new?person=johan');
    await expect(page.getByRole('heading', { level: 1, name: 'Fråga om Johan Byström' })).toBeVisible();
    await expect(pane(page).getByRole('region', { name: 'Frånvaro', exact: true })).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(`/conversations/new?person=johan&section=${CONTACT}`);
    await expect(pane(page).getByRole('region', { name: 'Kontakt', exact: true })).toBeVisible();
    expect(api.asked).toHaveLength(0);
    // Esc in the pane lets go of the person; the conversation stays and the box has the focus.
    await pane(page).getByRole('link', { name: 'Johan Byström' }).focus();
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL('/conversations/new');
    await expect(page.getByRole('complementary', { name: 'Johan Byström' })).toHaveCount(0);
    // A conversation not asked yet that names nothing is Ny fråga's own page (D126 item 14).
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^God (morgon|förmiddag|eftermiddag|kväll), /);
    await expect(page.getByRole('combobox', { name: 'Vad vill du göra' })).toBeFocused();
  });

  test('an address from before, `?person=&section=`, opens the person with that tab first', async ({
    page,
    api: _,
  }) => {
    await new People().route(page);
    await open(page, `/conversations/new?person=johan&section=${PRESENCE_LENS}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Fråga om Johan Byström' })).toBeVisible();
    await expect(pane(page).getByRole('region', { name: 'Frånvaro', exact: true })).toBeVisible();
    // Tab reaches the pane's tabs from the box.
    await box(page).focus();
    const strip = pane(page).getByRole('navigation', { name: 'Om Johan Byström' });
    for (let i = 0; i < 12 && !(await strip.evaluate(el => el.contains(document.activeElement))); i++)
      await page.keyboard.press('Tab');
    expect(await strip.evaluate(el => el.contains(document.activeElement))).toBe(true);
  });
});

test.describe('1.4.10 reflow', () => {
  test.use({ viewport: narrow });
  test('the person as a page reflows at 320 px, at the overview and at a tab', async ({ page, api: _ }) => {
    await new People().route(page);
    await open(page, '/people/johan?from=%2Fstaff');
    await expect(page.getByRole('heading', { level: 1, name: 'Johan Byström' })).toBeVisible();
    expect(await reflowProblems(page)).toEqual([]);
    await open(page, `/people/johan?from=%2Fstaff&section=${TALK_LENS}`);
    await expect(page.getByText('Skicka underlag om schemaläggning')).toBeVisible();
    expect(await reflowProblems(page)).toEqual([]);
    await open(page, `/people/karin?from=%2Fstaff&section=${TALK_LENS}`);
    await expect(page.getByRole('heading', { name: 'Åtgärdspunkter' })).toBeVisible();
    expect(await reflowProblems(page)).toEqual([]);
  });
});
