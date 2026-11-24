import type { MenuEntry, Thread } from '@clew/contracts';
import {
  SITE,
  announcements,
  desktop,
  expect,
  expectNoAxeViolations,
  narrow,
  open,
  openNav,
  openTools,
  pagesNav,
  phone,
  reflowProblems,
  searchButton,
  test,
} from './support';
import { menuRow, menuRows } from './phonebook';

/**
 * Clew's pages and its tools (D130, D126 rule 7): under the shared header's band the row "Mina sidor" holds Start,
 * Att göra, Kalender, for a manager Personal and Läget, and Samtal; at the row's end "Verktyg" is a menu with the views
 * an administrator chose as tools (D40, D112 item 1), the first four, then "Alla verktyg", the page of every tool. A
 * tool leads to its own page (D42), as Kalender does; the page itself and Alla verktyg are tested in `tools.spec.ts`,
 * the row's order and its keyboard in `shell.spec.ts`. The test person is a manager; `staff.spec.ts` owns Personal.
 * While a tool's page is open the menu's button is named by that tool, so the row still says where the person is. On a
 * phone the header's "Meny" lists every page, the tools among them.
 * The phone book's rows are named by its real manifest; they are in the menu only where a test puts them, as they are in
 * the product only where an administrator chose them.
 */
const tool = (label: string, n: number): MenuEntry => ({
  connector: 'verktyg-' + n,
  source: 'System ' + n,
  capability: `verktyg-${n}.open`,
  title: label,
  label,
  icon: (['book', 'document', 'chart', 'people', 'clock', 'link', 'search'] as const)[n % 7]!,
});

test.describe('Verktyg in the menu', () => {
  test.use({ viewport: desktop });

  // The suite's person is a manager, so Personal (D94) stands among the pages, after the calendar.
  test("the menu is named and holds the chosen views of a connector in alphabetical order, after Clew's pages, and has no axe violations", async ({
    page,
    api,
  }) => {
    api.menu = menuRows;
    await open(page, '/');
    const nav = pagesNav(page);
    const button = nav.getByRole('button', { name: 'Verktyg', exact: true });
    await expect(button).toHaveAttribute('aria-haspopup', 'menu');
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await expect(nav.getByRole('link', { name: 'Personal' })).toHaveAttribute('href', '/staff');
    // The tools are not links of the row: the menu holds them.
    await expect(nav.getByRole('link', { name: 'Telefonbok' })).toHaveCount(0);
    // After Clew's pages, at the end of their row.
    expect((await button.boundingBox())!.x).toBeGreaterThan(
      (await nav.getByRole('link', { name: 'Samtal', exact: true }).boundingBox())!.x,
    );
    await button.focus();
    await page.keyboard.press('Enter');
    const menu = page.getByRole('menu');
    await expect(menu.getByRole('menuitem')).toHaveText(['Mitt team', 'Telefonbok', 'Alla verktyg']);
    await expect(menu.getByRole('menuitem', { name: 'Mitt team' })).toHaveAttribute('href', '/tools/phonebook.team');
    await expect(menu.getByRole('menuitem', { name: 'Telefonbok' })).toHaveAttribute(
      'href',
      '/tools/phonebook.directory',
    );
    await expectNoAxeViolations(page);
    // Esc closes the menu and gives the focus back to its button (2.4.3).
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(button).toBeFocused();
  });

  test('without a tool there is no Verktyg; the row holds Start, Att göra and Kalender, a manager’s Personal and Läget, and Samtal', async ({
    page,
    api: _,
  }) => {
    await open(page, '/');
    const nav = pagesNav(page);
    await expect(nav.getByRole('button', { name: 'Verktyg', exact: true })).toHaveCount(0);
    await expect(nav.getByRole('link')).toHaveText([/^Start$/, /^Att göra/, 'Kalender', 'Personal', 'Läget', 'Samtal']);
    await expect(nav.getByRole('link', { name: 'Personal' })).toHaveAttribute('href', '/staff');
    // Läget is the unit the manager follows up, or the list of them when there are several or none is known.
    await expect(nav.getByRole('link', { name: 'Läget' })).toHaveAttribute('href', '/units');
    await expect(nav.getByRole('link', { name: 'Samtal', exact: true })).toHaveAttribute('href', '/conversations');
    // Kompetens, Introduktion och avslut and Dialogstöd are tabs of Personal (D126), no pages of their own.
    for (const gone of ['Kompetens', 'Introduktion och avslut', 'Dialogstöd'])
      await expect(nav.getByRole('link', { name: gone, exact: true })).toHaveCount(0);
    await expectNoAxeViolations(page);
  });

  test('an employee has no Personal and no Läget', async ({ page, api }) => {
    api.employee = true;
    await open(page, '/');
    const nav = pagesNav(page);
    await expect(nav.getByRole('link', { name: 'Start', exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Personal', exact: true })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Läget', exact: true })).toHaveCount(0);
  });

  test('the menu opens the tool as a page by keyboard, not in a panel, and its button is named by the open tool', async ({
    page,
    api,
  }) => {
    api.menu = [menuRow];
    await open(page, '/');
    const nav = pagesNav(page);
    await nav.getByRole('button', { name: 'Verktyg', exact: true }).focus();
    await page.keyboard.press('Enter');
    const row = page.getByRole('menu').getByRole('menuitem', { name: 'Telefonbok' });
    await row.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/tools\/phonebook\.directory$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Telefonbok' })).toBeVisible();
    await expect(page.getByRole('searchbox', { name: 'Sök i telefonboken' })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page).toHaveTitle(`Telefonbok · ${SITE}`);
    // No page of the row is the open one; the menu's button says which tool is.
    await expect(nav.locator('a[aria-current="page"]')).toHaveCount(0);
    await expect(nav.getByRole('button', { name: 'Telefonbok', exact: true })).toBeVisible();
    await expectNoAxeViolations(page);
    // Kalender is a page of the row: one place is said to be open at a time.
    await nav.getByRole('link', { name: 'Kalender' }).click();
    await expect(nav.locator('a[aria-current="page"]')).toHaveText('Kalender');
    await expect(nav.getByRole('button', { name: 'Verktyg', exact: true })).toBeVisible();
  });

  test("from the calendar the menu leads to the tool's page too", async ({ page, api }) => {
    api.menu = [menuRow];
    await open(page, '/calendar');
    await (await openTools(page)).getByRole('menuitem', { name: 'Telefonbok' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Telefonbok' })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('the search finds a tool by its name and opens its page', async ({ page, api }) => {
    api.menu = [menuRow];
    await open(page, '/');
    // Sök stands on the band and opens Astryx's command palette over the page.
    await searchButton(page).click();
    const search = page
      .getByRole('dialog', { name: 'Sök i samtal och ärenden' })
      .getByRole('combobox', { name: 'Sök i samtal och ärenden' });
    await expect(search).toBeFocused();
    await search.fill('telefon');
    await page.getByRole('option', { name: /Telefonbok/ }).click();
    await expect(page).toHaveURL(/\/tools\/phonebook\.directory$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Telefonbok' })).toBeVisible();
  });

  test('more than four tools: four show, and Alla verktyg leads to the page of every tool, named by the menu’s button while it is open, as the tool opened from it is', async ({
    page,
    api,
  }) => {
    api.menu = [menuRow, ...['Avtal', 'Blanketter', 'Diarium', 'Fordon', 'Lokaler'].map(tool)].sort((a, b) =>
      a.label.localeCompare(b.label, 'sv'),
    );
    await open(page, '/');
    const nav = pagesNav(page);
    const menu = await openTools(page);
    await expect(menu.getByRole('menuitem')).toHaveText(['Avtal', 'Blanketter', 'Diarium', 'Fordon', 'Alla verktyg']);
    const all = menu.getByRole('menuitem', { name: 'Alla verktyg' });
    await expect(all).toHaveAttribute('href', '/tools');
    await all.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL('/tools');
    await expect(page.getByRole('heading', { level: 1, name: 'Alla verktyg' })).toBeVisible();
    await expect(nav.getByRole('button', { name: 'Alla verktyg', exact: true })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // Every tool is a tile, the two the menu does not show among them.
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { level: 3 })).toHaveCount(6);
    await expectNoAxeViolations(page);
    // A tile is pressed where its name is drawn: ClickableCard lays its content over the card's own link.
    await main.getByRole('heading', { level: 3, name: 'Telefonbok' }).click();
    await expect(page).toHaveURL('/tools/phonebook.directory?from=%2Ftools');
    await expect(page.getByRole('heading', { level: 1, name: 'Telefonbok' })).toBeVisible();
    // The tool open now names the menu's button, whether or not the menu lists it among its first four.
    await expect(nav.getByRole('button', { name: 'Telefonbok', exact: true })).toBeVisible();
  });
});

/**
 * Samtal among the pages (D130): the register of every conversation, where each title is the link to it. The row marks
 * Samtal on the register and on a conversation's own page.
 */
test.describe('Samtal among the pages and the register', () => {
  const conversations = (base: Thread): Thread[] =>
    ['Första frågan', 'Andra frågan', 'Tredje frågan', 'Fjärde frågan'].map((title, i) => ({
      ...base,
      id: `samtal-${i + 1}`,
      title,
      topic: `samtal-${i + 1}`,
      updatedAt: `2026-11-0${4 - i}T07:00:00.000Z`,
    }));

  test('Samtal leads to the register, which lists every conversation, each title its link, with no axe violations; a conversation’s page keeps Samtal marked', async ({
    page,
    api,
  }) => {
    await page.setViewportSize(desktop);
    const base = api.threads.find(t => t.kind === 'question')!;
    api.threads = [...api.threads.filter(t => t.kind !== 'question'), ...conversations(base)];
    await open(page, '/');
    const nav = pagesNav(page);
    const all = nav.getByRole('link', { name: 'Samtal', exact: true });
    await expect(all).toHaveAttribute('href', '/conversations');
    // The conversations themselves are not pages of the row.
    await expect(nav.getByRole('link', { name: 'Första frågan' })).toHaveCount(0);
    await all.click();
    await expect(page).toHaveURL('/conversations');
    await expect(page.getByRole('heading', { level: 1, name: 'Samtal' })).toBeVisible();
    await expect(page).toHaveTitle(`Samtal · ${SITE}`);
    await expect(all).toHaveAttribute('aria-current', 'page');
    const main = page.getByRole('main');
    await expect(main.getByRole('row')).toHaveCount(5);
    const oldest = main.getByRole('link', { name: 'Fjärde frågan', exact: true });
    await expect(oldest).toHaveAttribute('href', '/conversations/samtal-4');
    await expectNoAxeViolations(page);
    await oldest.click();
    await expect(page).toHaveURL('/conversations/samtal-4');
    await expect(all).toHaveAttribute('aria-current', 'page');
  });

  // WD-L1: the register reads the conversations alone, the latest activity first, a page at a time by the server's cursor.
  const fifth = (base: Thread): Thread => ({
    ...base,
    id: 'samtal-5',
    title: 'Femte frågan',
    topic: 'samtal-5',
    updatedAt: '2026-10-31T07:00:00.000Z',
  });
  test('the register steps through its conversations a page at a time: the pager keeps the focus, the page is in the address, and how many is said once every page is read', async ({
    page,
    api,
  }) => {
    await page.setViewportSize(desktop);
    const base = api.threads.find(t => t.kind === 'question')!;
    api.threads = [...api.threads.filter(t => t.kind !== 'question'), ...conversations(base), fifth(base)];
    api.conversationPage = 2;
    await open(page, '/conversations');
    const main = page.getByRole('main');
    const pager = main.getByRole('navigation', { name: 'Sidor med samtal' });
    await expect(main.getByRole('row')).toHaveCount(3);
    await expect(main.getByRole('link', { name: 'Första frågan', exact: true })).toBeVisible();
    // The total is not known until the last page is read: the pager has a way on and no numbers.
    await expect(main.getByText('5 samtal', { exact: true })).toHaveCount(0);
    await expect(pager.getByRole('button', { name: 'Gå till sida 1' })).toHaveCount(0);
    await expectNoAxeViolations(page);
    const next = pager.getByRole('button', { name: 'Gå till nästa sida' });
    await next.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL('/conversations?page=2');
    await expect(main.getByRole('link', { name: 'Tredje frågan', exact: true })).toBeVisible();
    await expect(main.getByRole('link', { name: 'Första frågan', exact: true })).toHaveCount(0);
    // The step is taken at the foot of the list and read from its head: the head is in view, the focus where it was.
    await expect(page.getByRole('heading', { level: 1, name: 'Samtal' })).toBeInViewport();
    await expect(next).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL('/conversations?page=3');
    await expect(main.getByRole('link', { name: 'Femte frågan', exact: true })).toBeVisible();
    await expect(pager.getByRole('button', { name: 'Gå till sida 3' })).toHaveAttribute('aria-current', 'page');
    await expect(next).toBeFocused();
    await expect(main.getByText('5 samtal', { exact: true }).first()).toBeVisible();
    // Each page was read once, from where the last one ended.
    expect(api.conversationReads).toEqual([
      null,
      '2026-11-03T07:00:00.000Z~samtal-2',
      '2026-11-01T07:00:00.000Z~samtal-4',
    ]);
    await expectNoAxeViolations(page);
    // Back is a step back; a link to a page reads the pages before it in turn.
    await page.goBack();
    await expect(page).toHaveURL('/conversations?page=2');
    await expect(main.getByRole('link', { name: 'Tredje frågan', exact: true })).toBeVisible();
    await open(page, '/conversations?page=2');
    await expect(main.getByRole('link', { name: 'Fjärde frågan', exact: true })).toBeVisible();
    await expect(main.getByRole('row')).toHaveCount(3);
  });
  test('the pager says the page it went to; while that page is read its shape is drawn and said, and one that cannot be read says so with a way to try again', async ({
    page,
    api,
  }) => {
    await page.setViewportSize(desktop);
    const base = api.threads.find(t => t.kind === 'question')!;
    api.threads = [...api.threads.filter(t => t.kind !== 'question'), ...conversations(base), fifth(base)];
    api.conversationPage = 2;
    await open(page, '/conversations');
    const main = page.getByRole('main');
    const pager = main.getByRole('navigation', { name: 'Sidor med samtal' });
    await expect(main.getByRole('link', { name: 'Första frågan', exact: true })).toBeVisible();
    const release = api.holdConversations();
    const next = pager.getByRole('button', { name: 'Gå till nästa sida' });
    await next.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL('/conversations?page=2');
    // The page is read: its shape stands in the list's place and says so, and the pager keeps the focus.
    await expect(main.getByText('Hämtar fler samtal …')).toBeAttached();
    await expect(main.getByRole('link', { name: 'Första frågan', exact: true })).toHaveCount(0);
    await expect(next).toBeFocused();
    await expectNoAxeViolations(page);
    release();
    await expect(main.getByRole('link', { name: 'Tredje frågan', exact: true })).toBeVisible();
    await expect(next).toBeFocused();
    await expect.poll(() => announcements(page)).toContainEqual(expect.stringMatching(/^Sida 2/));
    // The next page cannot be read: an alert says so, the pager stays, and the person asks again.
    api.conversationsFail = true;
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL('/conversations?page=3');
    const alert = main.getByRole('alert');
    await expect(alert).toHaveText('Något gick fel. Försök igen.');
    await expect(main.getByRole('link', { name: 'Tredje frågan', exact: true })).toHaveCount(0);
    await expect(pager).toBeVisible();
    await expectNoAxeViolations(page);
    api.conversationsFail = false;
    await main.getByRole('button', { name: 'Försök igen' }).click();
    await expect(main.getByRole('link', { name: 'Femte frågan', exact: true })).toBeVisible();
    await expect(main.getByRole('alert')).toHaveCount(0);
    await expect.poll(() => announcements(page)).toContainEqual(expect.stringMatching(/^Sida 3/));
    // Every read of the third page, the failed ones and the one asked again, went on from where the second ended.
    expect(api.conversationReads.slice(0, 2)).toEqual([null, '2026-11-03T07:00:00.000Z~samtal-2']);
    expect(new Set(api.conversationReads.slice(2))).toEqual(new Set(['2026-11-01T07:00:00.000Z~samtal-4']));
  });
  test('at 320 px the register’s pages are a list of links with the pager under it, and nothing reflows past the edge', async ({
    page,
    api,
  }) => {
    await page.setViewportSize(narrow);
    const base = api.threads.find(t => t.kind === 'question')!;
    api.threads = [...api.threads.filter(t => t.kind !== 'question'), ...conversations(base), fifth(base)];
    api.conversationPage = 2;
    await open(page, '/conversations');
    const list = page.getByRole('main').getByRole('list', { name: 'Samtal' });
    await expect(list.getByRole('listitem')).toHaveCount(2);
    const pager = page.getByRole('main').getByRole('navigation', { name: 'Sidor med samtal' });
    await pager.getByRole('button', { name: 'Gå till nästa sida' }).click();
    await expect(list.getByRole('link', { name: 'Tredje frågan' })).toBeVisible();
    await expect(list.getByRole('listitem')).toHaveCount(2);
    expect(await reflowProblems(page)).toEqual([]);
    await expectNoAxeViolations(page);
  });
  test('at 320 px the register is a list of links and nothing reflows past the edge', async ({ page, api }) => {
    await page.setViewportSize(narrow);
    const base = api.threads.find(t => t.kind === 'question')!;
    api.threads = [...api.threads.filter(t => t.kind !== 'question'), ...conversations(base)];
    await open(page, '/conversations');
    const list = page.getByRole('main').getByRole('list', { name: 'Samtal' });
    await expect(list.getByRole('listitem')).toHaveCount(4);
    await expect(list.getByRole('link', { name: 'Första frågan' })).toHaveAttribute('href', '/conversations/samtal-1');
    expect(await reflowProblems(page)).toEqual([]);
    await expectNoAxeViolations(page);
  });
});

test.describe('Verktyg on a phone', () => {
  test("the tool is a row of the drawer with Clew's pages and opens the tool's page, its rows as a list", async ({
    page,
    api,
  }) => {
    await page.setViewportSize(phone);
    api.menu = [menuRow];
    await open(page, '/');
    const drawer = await openNav(page);
    // Every page, the tools last among them.
    await expect(drawer.getByRole('group', { name: 'Mina sidor' }).getByRole('link')).toHaveText([
      /^Start$/,
      /^Att göra/,
      'Kalender',
      'Personal',
      'Läget',
      'Samtal',
      'Telefonbok',
      'Alla verktyg',
    ]);
    await expectNoAxeViolations(page);
    await drawer.getByRole('link', { name: 'Telefonbok' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Telefonbok' })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Telefonboken' })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // The drawer marks the tool that is open.
    await expect((await openNav(page)).getByRole('link', { name: 'Telefonbok' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });
  test('at 320 px the tool shows its whole name in the drawer and the page does not scroll sideways', async ({
    page,
    api,
  }) => {
    await page.setViewportSize(narrow);
    api.menu = [menuRow];
    await open(page, '/');
    const row = (await openNav(page)).getByRole('link', { name: 'Telefonbok' });
    await page.evaluate(() => Promise.all(document.getAnimations().map(a => a.finished.catch(() => undefined))));
    const { width, needed, right } = await row.evaluate(el => {
      const probe = document.createElement('span');
      probe.textContent = el.textContent;
      probe.style.cssText = `position:absolute;visibility:hidden;white-space:nowrap;font:${getComputedStyle(el).font}`;
      document.body.append(probe);
      const needed = probe.getBoundingClientRect().width;
      probe.remove();
      return { width: el.getBoundingClientRect().width, needed, right: el.getBoundingClientRect().right };
    });
    expect(width).toBeGreaterThanOrEqual(needed);
    expect(right).toBeLessThanOrEqual(320);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  });
});

test.describe('the administrator chooses which views are in the menu', () => {
  test.use({ viewport: desktop });
  test('every view that can be a tool has its own switch under Områden; choosing one is said aloud and shown on the overview', async ({
    page,
    api,
  }) => {
    api.admin = true;
    await open(page, '/admin/connectors/hello');
    await expect(page.getByText('Ingen vy vald')).toBeVisible();
    await page.getByRole('tab', { name: 'Områden' }).click();
    const tools = page.getByRole('list', { name: 'Verktyg i menyn' });
    await expect(tools.getByRole('listitem')).toHaveCount(2);
    await expect(tools.getByRole('switch')).toHaveCount(2);
    const second = tools.getByRole('switch', { name: 'Visa Saker att göra i menyn' });
    await expect(second).not.toBeChecked();
    await expectNoAxeViolations(page);
    await second.focus();
    await page.keyboard.press('Space');
    await expect(second).toBeChecked();
    await expect(tools.getByRole('switch', { name: 'Visa Hello i menyn' })).not.toBeChecked();
    await expect(
      page.getByRole('region', { name: 'Aviseringar' }).getByText('Saker att göra visas i menyn under Verktyg.'),
    ).toBeVisible();
    expect(api.menuOn).toEqual(['hello.openItems']);
    await tools.getByRole('switch', { name: 'Visa Hello i menyn' }).click();
    await expect.poll(() => api.menuOn).toEqual(['hello.openItems', 'hello.overview']);
    await page.getByRole('tab', { name: 'Översikt' }).click();
    await expect(page.getByText('Hello, Saker att göra')).toBeVisible();
  });
  test('the list of views is the same on a phone, with no sideways scrolling', async ({ page, api }) => {
    api.admin = true;
    await page.setViewportSize(narrow);
    await open(page, '/admin/connectors/hello');
    await page.getByRole('button', { name: /^Visa:/ }).click();
    await page.getByRole('menuitem', { name: 'Områden' }).click();
    const tools = page.getByRole('list', { name: 'Verktyg i menyn' });
    await expect(tools.getByRole('switch')).toHaveCount(2);
    await tools.getByRole('switch', { name: 'Visa Hello i menyn' }).click();
    await expect.poll(() => api.menuOn).toEqual(['hello.overview']);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    await expectNoAxeViolations(page);
  });
  test('a connector with no view that can be a tool says so, and adding a connector does not ask about the menu', async ({
    page,
    api,
  }) => {
    api.admin = true;
    await open(page, '/admin/connectors/finance');
    await expect(page.getByText('Ingen vy kan ligga i menyn')).toBeVisible();
    await page.getByRole('tab', { name: 'Områden' }).click();
    await expect(page.getByText('Ingen av anslutningens vyer kan ligga i menyn.')).toBeVisible();
    await expect(page.getByRole('list', { name: 'Verktyg i menyn' })).toHaveCount(0);
    await expectNoAxeViolations(page);
  });
});
