import type { MenuEntry, Thread } from '@clew/contracts';
import { desktop, expect, expectNoAxeViolations, narrow, open, openNav, phone, reflowProblems, test } from './support';
import { menuRow, menuRows } from './phonebook';

/**
 * The rail (D126 item 10, board RailOrder variant b, "Arbetet först"): Sök alone at the top, then "Mitt arbete" (Hem,
 * Att göra, Kalender), "Min enhet" for a manager (Personal, Läget), "Verktyg" (D40, D112 item 1: the views an
 * administrator chose as tools, the first four, then "Alla verktyg", the page of every tool) and "Fråga assistenten" (Ny fråga
 * first, the three newest conversations, then "Alla samtal"). A tool's row leads to
 * the tool's own page (D42), as Kalender does; the page itself and Alla verktyg are tested in `tools.spec.ts`. The test person is a manager; `staff.spec.ts`
 * owns Personal. The shared header (D88) marks Start as the current place on every page of Clew, so "the current row" is
 * asked of the rail, where one row is current at a time.
 * The phone book's rows are named by its real manifest; they are in the menu only where a test puts them, as they are in
 * the product only where an administrator chose them.
 */
const rail = (page: import('@playwright/test').Page) => page.getByRole('navigation', { name: 'Sidonavigering' });
const tool = (label: string, n: number): MenuEntry => ({
  connector: 'verktyg-' + n,
  source: 'System ' + n,
  capability: `verktyg-${n}.open`,
  title: label,
  label,
  icon: (['book', 'document', 'chart', 'people', 'clock', 'link', 'search'] as const)[n % 7]!,
});

test.describe('the rail’s order', () => {
  test.use({ viewport: desktop });

  test('the work first: Sök alone at the top, then Mitt arbete, Min enhet, Verktyg and Fråga assistenten with Ny fråga first, each a named group in one navigation landmark, and the keyboard follows the same order', async ({
    page,
    api,
  }) => {
    api.menu = [menuRow];
    await open(page, '/');
    await expect(page.getByRole('navigation', { name: 'Sidonavigering' })).toHaveCount(1);
    const nav = rail(page);
    // The groups stand in this order, each named; the first holds Sök and nothing else.
    const names = ['Börja', 'Mitt arbete', 'Min enhet', 'Verktyg', 'Fråga assistenten'];
    const tops: number[] = [];
    for (const name of names) tops.push((await nav.getByRole('group', { name, exact: true }).boundingBox())!.y);
    expect(tops).toEqual([...tops].sort((a, b) => a - b));
    const first = nav.getByRole('group', { name: 'Börja', exact: true });
    await expect(first.getByRole('button')).toHaveText(['Sök']);
    await expect(first.getByRole('link')).toHaveCount(0);
    // Ny fråga heads the conversations it starts, and "Samtal" is no longer a group of its own.
    const ask = nav.getByRole('group', { name: 'Fråga assistenten', exact: true });
    await expect(ask.getByRole('link')).toHaveText(['Ny fråga', 'Vem är på plats i dag?', 'Alla samtal']);
    await expect(ask.getByRole('link', { name: 'Ny fråga' })).toHaveAttribute('href', '/conversations/new');
    await expect(nav.getByRole('group', { name: 'Samtal', exact: true })).toHaveCount(0);
    await expectNoAxeViolations(page);
    // From Sök the keyboard reaches every row in the order the rail draws them, top to bottom.
    const drawn = await nav.locator('a[href], button').evaluateAll(list =>
      list
        .filter(el => (el as HTMLElement).checkVisibility())
        .sort((a, b) => a.getBoundingClientRect().y - b.getBoundingClientRect().y)
        .map(el => el.getAttribute('aria-label') ?? (el.textContent ?? '').replace(/\s+/g, ' ').trim()),
    );
    const order = drawn.slice(drawn.indexOf('Sök'));
    await nav.getByRole('button', { name: 'Sök', exact: true }).focus();
    const reached: string[] = [];
    for (let i = 0; i < order.length; i++) {
      reached.push(
        await page.evaluate(() => {
          const el = document.activeElement!;
          return el.getAttribute('aria-label') ?? (el.textContent ?? '').replace(/\s+/g, ' ').trim();
        }),
      );
      await page.keyboard.press('Tab');
    }
    expect(reached).toEqual(order);
  });
});

test.describe('Verktyg in the menu', () => {
  test.use({ viewport: desktop });

  // The suite's person is a manager, so Personal (D94) stands among the places, after the calendar, before the tools.
  test("the section is named and holds the chosen views of a connector in alphabetical order, after Clew's places, and has no axe violations", async ({
    page,
    api,
  }) => {
    api.menu = menuRows;
    await open(page, '/');
    const section = rail(page).getByRole('group', { name: 'Verktyg' });
    await expect(section.getByRole('link')).toHaveText(['Mitt team', 'Telefonbok', 'Alla verktyg']);
    await expect(rail(page).getByRole('link', { name: 'Personal' })).toHaveAttribute('href', '/staff');
    await expect(section.getByRole('link', { name: 'Mitt team' })).toHaveAttribute('href', '/tools/phonebook.team');
    await expect(section.getByRole('link', { name: 'Telefonbok' })).toHaveAttribute(
      'href',
      '/tools/phonebook.directory',
    );
    // The areas, the administration and the way out stay below it.
    const order = await rail(page).getByRole('link').allTextContents();
    expect(order.indexOf('Telefonbok')).toBeGreaterThan(order.indexOf('Kalender'));
    await expectNoAxeViolations(page);
  });

  test('without a tool there is no Verktyg; Mitt arbete holds Hem, Att göra and Kalender, and a manager’s Min enhet Personal and Läget', async ({
    page,
    api: _,
  }) => {
    await open(page, '/');
    await expect(rail(page).getByRole('group', { name: 'Verktyg' })).toHaveCount(0);
    const mine = rail(page).getByRole('group', { name: 'Mitt arbete' });
    await expect(mine.getByRole('link')).toHaveText([/^Hem/, /^Att göra/, 'Kalender']);
    const unit = rail(page).getByRole('group', { name: 'Min enhet' });
    await expect(unit.getByRole('link')).toHaveText(['Personal', 'Läget']);
    await expect(unit.getByRole('link', { name: 'Personal' })).toHaveAttribute('href', '/staff');
    // Läget is the unit the manager follows up, or the list of them when there are several or none is known.
    await expect(unit.getByRole('link', { name: 'Läget' })).toHaveAttribute('href', '/units');
    // Kompetens, Introduktion och avslut and Dialogstöd are tabs of Personal (D126), no rows of their own.
    for (const gone of ['Kompetens', 'Introduktion och avslut', 'Dialogstöd'])
      await expect(rail(page).getByRole('link', { name: gone, exact: true })).toHaveCount(0);
    await expectNoAxeViolations(page);
  });

  test('an employee has no Min enhet', async ({ page, api }) => {
    api.employee = true;
    await open(page, '/');
    await expect(rail(page).getByRole('link', { name: /^Hem/ })).toBeVisible();
    await expect(rail(page).getByRole('group', { name: 'Min enhet' })).toHaveCount(0);
    await expect(rail(page).getByRole('link', { name: 'Personal', exact: true })).toHaveCount(0);
    await expect(rail(page).getByRole('link', { name: 'Läget', exact: true })).toHaveCount(0);
  });

  test('the row opens the tool as a page by keyboard, not in the side panel, and is marked as current', async ({
    page,
    api,
  }) => {
    api.menu = [menuRow];
    await open(page, '/');
    const row = rail(page).getByRole('link', { name: 'Telefonbok' });
    await row.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/tools\/phonebook\.directory$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Telefonbok' })).toBeVisible();
    await expect(page.getByRole('searchbox', { name: 'Sök i telefonboken' })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page).toHaveTitle('Telefonbok · Startsidan');
    await expect(rail(page).locator('a[aria-current="page"]')).toHaveText('Telefonbok');
    await expectNoAxeViolations(page);
    // Kalender is the same kind of row: one tool is current at a time.
    await rail(page).getByRole('link', { name: 'Kalender' }).click();
    await expect(rail(page).locator('a[aria-current="page"]')).toHaveText('Kalender');
  });

  test("from the calendar the row leads to the tool's page too", async ({ page, api }) => {
    api.menu = [menuRow];
    await open(page, '/calendar');
    await rail(page).getByRole('link', { name: 'Telefonbok' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Telefonbok' })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test("the menu's search finds a tool by its name and opens its page", async ({ page, api }) => {
    api.menu = [menuRow];
    await open(page, '/');
    // Sök is a row of the rail (board Sidebar) that opens Astryx's command palette over the page.
    await rail(page).getByRole('button', { name: 'Sök', exact: true }).click();
    const search = page
      .getByRole('dialog', { name: 'Sök i samtal och ärenden' })
      .getByRole('combobox', { name: 'Sök i samtal och ärenden' });
    await expect(search).toBeFocused();
    await search.fill('telefon');
    await page.getByRole('option', { name: /Telefonbok/ }).click();
    await expect(page).toHaveURL(/\/tools\/phonebook\.directory$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Telefonbok' })).toBeVisible();
  });

  test('more than four tools: four show, and Alla verktyg leads to the page of every tool, marked while it is open; the one opened from it is marked in the rail', async ({
    page,
    api,
  }) => {
    api.menu = [menuRow, ...['Avtal', 'Blanketter', 'Diarium', 'Fordon', 'Lokaler'].map(tool)].sort((a, b) =>
      a.label.localeCompare(b.label, 'sv'),
    );
    await open(page, '/');
    const section = rail(page).getByRole('group', { name: 'Verktyg' });
    await expect(section.getByRole('link')).toHaveText(['Avtal', 'Blanketter', 'Diarium', 'Fordon', 'Alla verktyg']);
    const all = section.getByRole('link', { name: 'Alla verktyg' });
    await expect(all).toHaveAttribute('href', '/tools');
    await all.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL('/tools');
    await expect(page.getByRole('heading', { level: 1, name: 'Alla verktyg' })).toBeVisible();
    await expect(all).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // Every tool is a tile, the two the rail does not show among them.
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { level: 3 })).toHaveCount(6);
    await expectNoAxeViolations(page);
    // A tile is pressed where its name is drawn: ClickableCard lays its content over the card's own link.
    await main.getByRole('heading', { level: 3, name: 'Telefonbok' }).click();
    await expect(page).toHaveURL('/tools/phonebook.directory?from=%2Ftools');
    await expect(page.getByRole('heading', { level: 1, name: 'Telefonbok' })).toBeVisible();
    // The tool open now is a row of the rail while it is open, marked as the current page.
    await expect(section.getByRole('link', { name: 'Telefonbok' })).toHaveAttribute('aria-current', 'page');
  });
});

/**
 * Fråga assistenten in the rail (D126 item 10): Ny fråga, the three newest conversations, the open one marked, and "Alla
 * samtal", the register of every conversation, where each title is the link to it.
 */
test.describe('Fråga assistenten in the rail and Alla samtal', () => {
  const conversations = (base: Thread): Thread[] =>
    ['Första frågan', 'Andra frågan', 'Tredje frågan', 'Fjärde frågan'].map((title, i) => ({
      ...base,
      id: `samtal-${i + 1}`,
      title,
      topic: `samtal-${i + 1}`,
      updatedAt: `2026-11-0${4 - i}T07:00:00.000Z`,
    }));

  test('Ny fråga, the three newest and Alla samtal; the register lists every one, each title its link, with no axe violations', async ({
    page,
    api,
  }) => {
    await page.setViewportSize(desktop);
    const base = api.threads.find(t => t.kind === 'question')!;
    api.threads = [...api.threads.filter(t => t.kind !== 'question'), ...conversations(base)];
    await open(page, '/');
    const section = rail(page).getByRole('group', { name: 'Fråga assistenten' });
    await expect(section.getByRole('link')).toHaveText([
      'Ny fråga',
      'Första frågan',
      'Andra frågan',
      'Tredje frågan',
      'Alla samtal',
    ]);
    const all = section.getByRole('link', { name: 'Alla samtal' });
    await expect(all).toHaveAttribute('href', '/conversations');
    await all.click();
    await expect(page).toHaveURL('/conversations');
    await expect(page.getByRole('heading', { level: 1, name: 'Samtal' })).toBeVisible();
    await expect(page).toHaveTitle('Samtal · Startsidan');
    await expect(all).toHaveAttribute('aria-current', 'page');
    const main = page.getByRole('main');
    await expect(main.getByRole('row')).toHaveCount(5);
    const oldest = main.getByRole('link', { name: 'Fjärde frågan', exact: true });
    await expect(oldest).toHaveAttribute('href', '/conversations/samtal-4');
    await expectNoAxeViolations(page);
    // The open conversation is marked in the rail, first in the place of the newest when it is older.
    await oldest.click();
    await expect(page).toHaveURL('/conversations/samtal-4');
    await expect(section.getByRole('link', { name: 'Fjärde frågan' })).toHaveAttribute('aria-current', 'page');
    await expect(section.getByRole('link')).toHaveText([
      'Ny fråga',
      'Fjärde frågan',
      'Första frågan',
      'Andra frågan',
      'Alla samtal',
    ]);
  });

  test('a conversation asked beside a page and never opened as a conversation is not among the rail’s three, and Alla samtal lists it with what it is about (D130 rule 6)', async ({
    page,
    api,
  }) => {
    await page.setViewportSize(desktop);
    const base = api.threads.find(t => t.kind === 'question')!;
    const [first, second, third, fourth] = conversations(base);
    const beside = {
      ...first!,
      id: 'samtal-bredvid',
      title: 'Vad väntar de på från mig?',
      updatedAt: '2026-11-05T07:00:00.000Z',
      askedBeside: { subject: 'view:clew.requests', label: 'Om Beställningar och felanmälningar', openedAt: null },
    };
    api.threads = [...api.threads.filter(t => t.kind !== 'question'), beside, first!, second!, third!, fourth!];
    await open(page, '/');
    const section = rail(page).getByRole('group', { name: 'Fråga assistenten' });
    await expect(section.getByRole('link')).toHaveText([
      'Ny fråga',
      'Första frågan',
      'Andra frågan',
      'Tredje frågan',
      'Alla samtal',
    ]);
    await section.getByRole('link', { name: 'Alla samtal' }).click();
    const main = page.getByRole('main');
    await expect(main.getByRole('row')).toHaveCount(6);
    const row = main.getByRole('row').filter({ has: page.getByRole('link', { name: 'Vad väntar de på från mig?' }) });
    await expect(row.getByRole('cell').nth(1)).toHaveText('Beställningar och felanmälningar');
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
  test("the row is in the drawer and opens the tool's page, its rows as a list", async ({ page, api }) => {
    await page.setViewportSize(phone);
    api.menu = [menuRow];
    await open(page, '/');
    const drawer = await openNav(page);
    await expect(drawer.getByRole('group', { name: 'Verktyg' }).getByRole('link')).toHaveText([
      'Telefonbok',
      'Alla verktyg',
    ]);
    await expect(drawer.getByRole('link', { name: 'Kalender' })).toBeVisible();
    await expectNoAxeViolations(page);
    await drawer.getByRole('link', { name: 'Telefonbok' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Telefonbok' })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Telefonboken' })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
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
