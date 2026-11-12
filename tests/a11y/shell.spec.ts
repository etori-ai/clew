import type { Locator, Page } from '@playwright/test';
import {
  announcements,
  desktop,
  expect,
  expectNoAxeViolations,
  narrow,
  open,
  openNav,
  reflowProblems,
  test,
} from './support';
import { ENTITY_UNIT, NOW } from './data';
import { menuRows } from './phonebook';
import { Units } from './unit-data';

/** What a person sees of a rail row: where it starts, how wide and tall it is, and its type. */
const rowLook = (row: Locator) =>
  row.evaluate(element => {
    const { x, width, height } = element.getBoundingClientRect();
    return { x, width, height, font: getComputedStyle(element).font };
  });

for (const viewport of [desktop, narrow])
  test(`the bell beside the installation's name works by keyboard at ${viewport.width}px`, async ({ page, api: _ }) => {
    await page.setViewportSize(viewport);
    await open(page, '/');
    // Without a header connector (D112 item 1) the rail's heading is the installation's name with the bell; on a phone
    // the shell draws that heading as its bar.
    const header =
      viewport === narrow ? page.getByRole('banner') : page.getByRole('navigation', { name: 'Sidonavigering' });
    const bell = header.getByRole('button', { name: 'Påminnelser: 0', exact: true });
    await expect(bell).toBeVisible();
    const home = header.getByRole('link', { name: /Startsidan/ });
    await expect(home).toBeVisible();
    await expect(home.locator('button')).toHaveCount(0);
    await bell.focus();
    await page.keyboard.press('Enter');
    const reminders = page.getByRole('dialog', { name: 'Påminnelser', exact: true });
    await expect(reminders).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(bell).toBeFocused();
  });

for (const viewport of [desktop, narrow])
  test(`the person is the last row of the rail and opens the settings by keyboard at ${viewport.width}px`, async ({
    page,
    api,
  }) => {
    api.admin = true;
    await page.setViewportSize(viewport);
    await open(page, '/');
    // Without a header connector the person is the rail's last row, under Administration (D112 item 1, board Sidebar);
    // on a phone in the drawer, which stays under the settings so Escape gives the focus back to the row.
    const nav = await openNav(page);
    const account = nav.getByRole('button', { name: 'Testa Testsson', exact: true });
    await expect(account).toBeVisible();
    await expect(nav.getByRole('button', { name: 'Administration', exact: true })).toBeVisible();
    expect((await account.boundingBox())!.y).toBeGreaterThan(
      (await nav.getByRole('button', { name: 'Administration', exact: true }).boundingBox())!.y,
    );
    await expect(page.getByRole('button', { name: 'Testa Testsson, inställningar', exact: true })).toHaveCount(0);
    await account.focus();
    await page.keyboard.press('Enter');
    const settings = page.getByRole('dialog', { name: 'Testa Testsson', exact: true });
    await expect(settings).toBeVisible();
    await expect(settings.getByText('Skönsmons skola', { exact: true })).toBeVisible();
    await page.getByRole('radio', { name: 'Mörkt', exact: true }).check();
    await expect(settings.getByRole('button', { name: 'Logga ut', exact: true })).toBeVisible();
    expect((await reflowProblems(page)).filter(problem => !problem.startsWith('clipped: '))).toEqual([]);
    await expectNoAxeViolations(page);
    await page.keyboard.press('Escape');
    await expect(settings).not.toBeVisible();
    await expect(account).toBeFocused();
  });

test('the phone bar holds the heading and the bell, and the drawer holds the rail with the person at its foot', async ({
  page,
  api: _,
}) => {
  await page.setViewportSize(narrow);
  await open(page, '/');
  const header = page.getByRole('banner');
  await expect(page.getByRole('button', { name: 'Öppna navigering' })).toBeVisible();
  await expect(header.getByRole('link', { name: /Startsidan/ })).toBeVisible();
  await expect(header.getByRole('button', { name: 'Påminnelser: 0', exact: true })).toBeVisible();
  const nav = await openNav(page);
  await expect(nav.getByRole('link', { name: 'Ny fråga', exact: true })).toBeVisible();
  await expect(nav.getByRole('button', { name: 'Sök', exact: true })).toBeVisible();
  await expect(nav.getByRole('link', { name: /^Att göra/ })).toBeVisible();
  await expect(nav.getByRole('button', { name: 'Testa Testsson', exact: true })).toBeVisible();
  // No header connector, no places of the header's in the drawer.
  await expect(nav.getByRole('group', { name: 'Huvudmeny' })).toHaveCount(0);
});

test('a reminder opens its work item in Att göra’s reading pane, with the focus on it', async ({ page, api }) => {
  api.threads = api.threads.map(t => (t.id === 'ledighet' ? { ...t, remindedAt: NOW } : t));
  await open(page, '/todo?area=budget');
  await page.getByRole('button', { name: 'Påminnelser: 1', exact: true }).click();
  const list = page.getByRole('dialog', { name: 'Påminnelser', exact: true });
  await expect(list).toBeVisible();
  await expectNoAxeViolations(page);
  await list.getByRole('link', { name: /Ledighetsansökan/ }).click();
  // On Att göra the card is the work item in the pane (D112), with the queue's own address kept around it.
  await expect(page).toHaveURL('/todo?area=budget&item=ledighet');
  await expect(list).not.toBeVisible();
  const pane = page.getByRole('complementary', { name: 'Valt ärende' });
  await expect(
    pane.getByRole('article', { name: 'Ärende: Ledighetsansökan från Johan Byström', exact: true }),
  ).toBeVisible();
  await expect.poll(() => pane.evaluate(el => el.contains(document.activeElement))).toBe(true);
  api.threads = api.threads.map(t => (t.id === 'ledighet' ? { ...t, state: 'handled' } : t));
  await page.reload();
  await expect(
    page
      .getByRole('complementary', { name: 'Valt ärende' })
      .getByRole('article', { name: 'Ärende: Ledighetsansökan från Johan Byström', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Påminnelser: 0', exact: true })).toBeAttached();
});

for (const [source, heading] of [['/calendar', 'Vecka']] as const)
  test(`a reminder opens and focuses its card over ${source}`, async ({ page, api }) => {
    api.threads = api.threads.map(t => (t.id === 'ledighet' ? { ...t, remindedAt: NOW } : t));
    await open(page, source);
    const bell = page.getByRole('button', { name: 'Påminnelser: 1', exact: true });
    await bell.click();
    const list = page.getByRole('dialog', { name: 'Påminnelser', exact: true });
    await expect(list).toBeVisible();
    await expectNoAxeViolations(page);
    await list.getByRole('link', { name: /Ledighetsansökan/ }).click();
    // The card opens over the page the person is on, with that page's own address kept (D111 rule 2): on Kalender in
    // the shell's drawer, on Hem in its panel, over the page at this width, and the focus is in it.
    await expect(page).toHaveURL(`${source}${source.includes('?') ? '&' : '?'}card=ledighet`);
    await expect(list).not.toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeAttached();
    const panel = page.getByRole('dialog', { name: 'Ärende', exact: true });
    await expect(
      panel.getByRole('article', { name: 'Ärende: Ledighetsansökan från Johan Byström', exact: true }),
    ).toBeVisible();
    await expect.poll(() => panel.evaluate(el => el.contains(document.activeElement))).toBe(true);
    // Waiting on others and handled cards never count as outstanding reminders; the address still shows the card as it is now.
    api.threads = api.threads.map(t => (t.id === 'ledighet' ? { ...t, state: 'handled' } : t));
    await page.reload();
    await expect(
      page
        .getByRole('dialog', { name: 'Ärende', exact: true })
        .getByRole('article', { name: 'Ärende: Ledighetsansökan från Johan Byström', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Påminnelser: 0', exact: true })).toBeAttached();
  });

test('an empty bell says what will appear, leads to the overview and restores focus on Escape', async ({
  page,
  api: _,
}) => {
  await page.setViewportSize(narrow);
  await open(page, '/todo?area=personal');
  const bell = page.getByRole('banner').getByRole('button', { name: 'Påminnelser: 0', exact: true });
  await bell.click();
  const list = page.getByRole('dialog', { name: 'Påminnelser', exact: true });
  await expect(list.getByText('Inga aktuella påminnelser')).toBeVisible();
  expect(await reflowProblems(page, list)).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(bell).toBeFocused();
  await bell.click();
  await list.getByRole('link', { name: 'Öppna Att göra', exact: true }).click();
  await expect(page).toHaveURL('/todo');
  await expect(list).not.toBeVisible();
});

test('the reminders hang from the bell at the desktop and the count is part of the button', async ({ page, api }) => {
  api.threads = api.threads.map(t => (t.id === 'ledighet' ? { ...t, remindedAt: NOW } : t));
  await page.setViewportSize(desktop);
  await open(page, '/calendar');
  const bell = page.getByRole('button', { name: 'Påminnelser: 1', exact: true });
  await expect(bell).toContainText('1');
  await bell.click();
  const list = page.getByRole('dialog', { name: 'Påminnelser', exact: true });
  await expect(list.and(page.locator('.astryx-popover'))).toBeVisible();
  const trigger = (await bell.boundingBox())!;
  const surface = (await list.boundingBox())!;
  expect(surface.y).toBeGreaterThanOrEqual(trigger.y + trigger.height);
  expect(surface.height).toBeLessThan(desktop.height / 2);
  expect(surface.width).toBeLessThanOrEqual(380);
  await expect(list.getByRole('link', { name: /Ledighetsansökan/ })).toBeVisible();
  await page.mouse.click(desktop.width - 40, desktop.height - 40);
  await expect(list).not.toBeVisible();
});

test.describe('on a touch phone', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: narrow });
  test('the reminders rise as a sheet with the same content', async ({ page, api }) => {
    api.threads = api.threads.map(t => (t.id === 'ledighet' ? { ...t, remindedAt: NOW } : t));
    await open(page, '/calendar');
    const bell = page.getByRole('button', { name: 'Påminnelser: 1', exact: true });
    await bell.click();
    const sheet = page.getByRole('dialog', { name: 'Påminnelser', exact: true });
    await expect(sheet).toBeVisible();
    await expect(sheet.and(page.locator('dialog'))).toBeVisible();
    await expectNoAxeViolations(page);
    expect(await reflowProblems(page, sheet)).toEqual([]);
    await sheet.getByRole('link', { name: /Ledighetsansökan/ }).click();
    await expect(page).toHaveURL('/calendar?card=ledighet');
    await expect(sheet).not.toBeVisible();
    // On a phone the card lies over Kalender in the shell's drawer, and the focus is in it.
    const card = page.getByRole('dialog', { name: 'Ärende', exact: true });
    await expect(
      card.getByRole('article', { name: 'Ärende: Ledighetsansökan från Johan Byström', exact: true }),
    ).toBeVisible();
    await expect.poll(() => card.evaluate(el => el.contains(document.activeElement))).toBe(true);
    expect(await reflowProblems(page, card)).toEqual([]);
  });
});

test('a failed reminder read is explicit and can be retried', async ({ page, api: _ }) => {
  await page.route('**/api/threads', route => route.fulfill({ status: 503, json: { error: 'Tillfälligt fel' } }));
  await page.goto('/calendar');
  const bell = page.getByRole('button', { name: 'Påminnelser – kunde inte uppdateras', exact: true });
  await bell.click();
  const list = page.getByRole('dialog', { name: 'Påminnelser', exact: true });
  await expect(list.getByText('Tillfälligt fel', { exact: true })).toBeVisible();
  await page.unroute('**/api/threads');
  await list.getByRole('button', { name: 'Försök igen', exact: true }).click();
  await expect(list.getByText('Inga aktuella påminnelser')).toBeVisible();
});

test('a blocked browser preference stays usable without claiming it was saved', async ({ page, api: _ }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new DOMException('Blocked', 'SecurityError');
      },
    });
  });
  await open(page, '/');
  await page.getByRole('button', { name: 'Testa Testsson', exact: true }).click();
  await page.getByRole('radio', { name: 'Mörkt', exact: true }).check();
  await expect(page.getByText(/Webbläsaren tillåter inte att valet sparas/)).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Mörkt', exact: true })).toBeChecked();
});

test('logout reports failure, then ends the session after a successful retry', async ({ page, api }) => {
  await page.route('**/api/auth/logout', route => route.fulfill({ status: 503 }));
  await open(page, '/');
  const account = page.getByRole('button', { name: 'Testa Testsson', exact: true });
  await account.click();
  await page.getByRole('button', { name: 'Logga ut', exact: true }).click();
  await expect
    .poll(() => announcements(page))
    .toContainEqual(expect.stringContaining('Utloggningen kunde inte bekräftas. Försök igen.'));
  // The dialog closed with the attempt; the retry opens it again.
  await account.click();
  await page.unroute('**/api/auth/logout');
  await page.route('**/api/auth/logout', route => {
    expect(route.request().headers()['x-csrf-token']).toBe('test');
    api.signedIn = false;
    return route.fulfill({ json: { url: '/' } });
  });
  await page.getByRole('button', { name: 'Logga ut', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Logga in', exact: true })).toBeVisible();
  await expect(account).toHaveCount(0);
});

for (const viewport of [desktop, narrow])
  test(`a row that opens marks its rows with a line under its icon at ${viewport.width}px`, async ({ page, api }) => {
    api.admin = true;
    await page.setViewportSize(viewport);
    await open(page, '/');
    const nav = await openNav(page);
    for (const [name, row] of [['Administration', 'Modeller']] as const) {
      const parent = nav.getByRole('button', { name, exact: true });
      await parent.click();
      const rows = nav.getByRole('group', { name, exact: true });
      await expect(rows.getByText(row, { exact: true })).toBeVisible();
      expect(await reflowProblems(page, rows)).toEqual([]);

      const line = (await rows.locator('[data-orientation="vertical"]').boundingBox())!;
      const icon = (await parent.locator('svg').first().boundingBox())!;
      expect(Math.abs(line.x - (icon.x + icon.width / 2))).toBeLessThan(1);
      expect(line.height).toBe((await rows.boundingBox())!.height);

      const own = (await parent.getByText(name, { exact: true }).boundingBox())!.x;
      expect((await rows.getByText(row, { exact: true }).boundingBox())!.x).toBeGreaterThan(own + 8);
      await expect(rows.getByRole('separator')).toHaveCount(0); // The line is a picture of the group the rows already are.

      await parent.focus();
      await page.keyboard.press('Tab');
      await expect(rows.locator('a, button').first()).toBeFocused();
    }
    await expectNoAxeViolations(page);
  });

test('the person signs out from the drawer on a phone', async ({ page, api }) => {
  await page.route('**/api/auth/logout', route => {
    api.signedIn = false;
    return route.fulfill({ json: { url: '/' } });
  });
  await page.setViewportSize(narrow);
  await open(page, '/');
  const nav = await openNav(page);
  await nav.getByRole('button', { name: 'Testa Testsson', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Logga ut', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Logga in', exact: true })).toBeVisible();
});

/**
 * Every page has the panel (the product owner, 2026-11-11). A page without one beside its own column (Kalender,
 * Administration) gets what its address opens, a card or a view, in the drawer over it from the shell; closing the
 * drawer leaves the page as it was. The bell, a toast and the rail's search lead there (above, `reliability.spec.ts`,
 * `structure.spec.ts`); the first test follows such an address the way the router follows a link inside Clew, with the
 * focus where the person was.
 */
test.describe('the panel over a page that has none of its own', () => {
  test.use({ viewport: desktop });
  test('a card in the address lies in the drawer over Kalender, and Esc leaves Kalender as it was with the focus back', async ({
    page,
    api: _,
  }) => {
    // From Hem, which holds the panel itself and lets go of it when the person leaves.
    await open(page, '/');
    await page
      .getByRole('navigation', { name: 'Sidonavigering' })
      .getByRole('link', { name: 'Kalender', exact: true })
      .click();
    const week = page.getByRole('heading', { level: 1, name: 'Vecka' });
    await expect(week).toBeVisible();
    const title = await page.title();
    const opener = page.getByRole('button', { name: 'Ny bokning' });
    await opener.focus();
    await page.evaluate(() => {
      window.history.pushState(null, '', '/calendar?card=fakturor');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    const drawer = page.getByRole('dialog', { name: 'Ärende' });
    await expect(drawer.locator('#card-fakturor').getByRole('button', { name: 'Attestera 2 valda' })).toBeVisible();
    await expect.poll(() => drawer.evaluate(el => el.contains(document.activeElement))).toBe(true);
    // The card has its own box in the panel (D112 item 7), so it offers no way into another one.
    await expect(drawer.getByRole('button', { name: 'Lägg till i samtalet' })).toHaveCount(0);
    // Kalender stays the page under it: its heading, its title and its path.
    await expect(week).toBeAttached();
    await expect(page).toHaveTitle(title);
    await expectNoAxeViolations(page);
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
    await expect(page).toHaveURL(/\/calendar$/);
    await expect(opener).toBeFocused();
    await expect(week).toBeVisible();
    // On Att göra the card is the work item in the reading pane (D112), drawn once and in no drawer.
    await page.evaluate(() => {
      window.history.pushState(null, '', '/todo?item=fakturor');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await expect(page.getByRole('heading', { level: 1, name: 'Att göra' })).toBeVisible();
    await expect(page.getByRole('complementary', { name: 'Valt ärende' }).locator('#card-fakturor')).toBeVisible();
    await expect(page.locator('#card-fakturor')).toHaveCount(1);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('opened by its address the card is there after a load, and ✕ leaves Kalender without the card', async ({
    page,
    api: _,
  }) => {
    await open(page, '/calendar?card=omtanke');
    const drawer = page.getByRole('dialog', { name: 'Ärende' });
    await expect(drawer.getByRole('article', { name: 'Ärende: Omtankesamtal med Anna Lindqvist' })).toBeVisible();
    await expect.poll(() => drawer.evaluate(el => el.contains(document.activeElement))).toBe(true);
    await expectNoAxeViolations(page);
    await drawer.getByRole('button', { name: 'Stäng panelen' }).click();
    await expect(drawer).toHaveCount(0);
    await expect(page).toHaveURL(/\/calendar$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Vecka' })).toBeVisible();
    // Nothing is left holding the focus inside the drawer that closed.
    expect(await page.evaluate(() => !document.activeElement?.closest('dialog'))).toBe(true);
  });

  test('a card that is not among the person’s cards says so in the drawer over Administration, and the page stays', async ({
    page,
    api,
  }) => {
    api.admin = true;
    await open(page, '/admin/connectors?card=okand');
    const drawer = page.getByRole('dialog', { name: 'Ärende' });
    await expect(drawer.getByText('Ärendet finns inte längre bland dina ärenden.')).toBeVisible();
    await expect(page).toHaveURL('/admin/connectors?card=okand');
    await expectNoAxeViolations(page);
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
    await expect(page).toHaveURL(/\/admin\/connectors$/);
  });

  test('a card’s read unfolds inside the card in the drawer, and the drawer holds the card all along', async ({
    page,
    api: _,
  }) => {
    await open(page, '/calendar?card=omtanke');
    const drawer = page.getByRole('dialog', { name: 'Ärende' });
    const button = drawer.locator('[data-read="pattern"]');
    await button.click();
    await expect(page).toHaveURL('/calendar?card=omtanke&open-card=omtanke&open-action=pattern');
    const section = drawer.locator('#read-card-omtanke');
    await expect(section.getByText('Anna Lindqvist 07:00–16:00')).toBeVisible();
    await expect(button).toBeFocused();
    await expect(drawer.getByRole('button', { name: 'Boka samtalet' })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(1);
    await expectNoAxeViolations(page);
    // Esc lets go of the card, read and all: Kalender as it was.
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/\/calendar$/);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});

/**
 * One panel (the product owner, 2026-11-11: "there are multiple different sidebars"): on every page that holds it, a
 * card stands beside the page from the one width, 1336 px, as a named region that leaves the page in use, and below it
 * is the drawer over the page; either way under the same header, the same small "Kort" at the same level and the same
 * ✕ in the same place. The page gives way to the panel, never the other way round: nothing scrolls sideways.
 */
test.describe('one panel on every page, from one width', () => {
  /** Whether the page under what is open still takes the focus: it does beside the panel, never under the drawer. */
  const pageTakesFocus = (page: Page) =>
    page.evaluate(() => {
      const target = document.querySelector<HTMLElement>('main a[href], [role="main"] a[href]');
      target?.focus();
      return !!target && document.activeElement === target;
    });
  /** The panel's name for a card: drawn small as artboard E draws "KORT", at the outline's second level for everyone. */
  const kort = (surface: Locator) => surface.locator('[aria-level="2"]').filter({ hasText: 'Ärende' });
  /** Where the header's name and ✕ stand in the surface that holds them, and how large the name is drawn. */
  const headerLook = async (surface: Locator) => {
    // Inside the surface's own edge: the drawer draws a 1 px line on its edge, where beside the page the resize
    // handle's divider stands outside the region.
    const edge = await surface.evaluate(el => ({ start: el.clientLeft, top: el.clientTop }));
    const outer = (await surface.boundingBox())!;
    const box = { ...outer, x: outer.x + edge.start, y: outer.y + edge.top, width: outer.width - edge.start };
    const name = kort(surface);
    const close = surface.getByRole('button', { name: 'Stäng panelen' });
    const named = (await name.boundingBox())!;
    const closer = (await close.boundingBox())!;
    return {
      size: await name.evaluate(el => getComputedStyle(el).fontSize),
      nameFromStart: Math.round(named.x - box.x),
      nameFromTop: Math.round(named.y - box.y),
      closeFromEnd: Math.round(box.x + box.width - (closer.x + closer.width)),
      closeFromTop: Math.round(closer.y - box.y),
    };
  };
  for (const [what, path] of [
    ['Personal', '/staff?card=omtanke'],
    ['a person’s page', '/people/johan?card=omtanke'],
    ['a unit’s page', `/units/${ENTITY_UNIT.id}?card=omtanke`],
    ['a tool’s page', '/tools/phonebook.directory?card=omtanke'],
  ] as const)
    test(`a card on ${what} stands beside the page at 1440 px and is the drawer at 1200 px, under the same header`, async ({
      page,
      api,
    }) => {
      api.menu = menuRows;
      await new Units().route(page);
      await page.setViewportSize({ width: 1440, height: 900 });
      await open(page, path);
      const beside = page.getByRole('complementary', { name: 'Ärende' });
      await expect(beside.getByRole('article', { name: 'Ärende: Omtankesamtal med Anna Lindqvist' })).toBeVisible();
      await expect(kort(beside)).toBeFocused();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      expect(await pageTakesFocus(page)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await expectNoAxeViolations(page);
      const besideLook = await headerLook(beside);

      await page.setViewportSize({ width: 1200, height: 900 });
      await open(page, path);
      const drawer = page.getByRole('dialog', { name: 'Ärende' });
      await expect(drawer.getByRole('article', { name: 'Ärende: Omtankesamtal med Anna Lindqvist' })).toBeVisible();
      await expect(kort(drawer)).toBeFocused();
      await expect(page.getByRole('complementary', { name: 'Ärende' })).toHaveCount(0);
      expect(await pageTakesFocus(page)).toBe(false);
      await page.evaluate(() => Promise.all(document.getAnimations().map(a => a.finished)));
      await expectNoAxeViolations(page);
      expect(await headerLook(drawer)).toEqual(besideLook);
    });
});

/**
 * The rail folded to its icons (D112 item 1, board Sidebar, the `shell-side-nav` template): Ny fråga and Sök are rows
 * with icons like every other row, so the rail's own fold draws them as icons named by their labels, never cut at its
 * edge, and the keyboard reaches each in turn.
 */
test.describe('the folded rail', () => {
  test.use({ viewport: desktop });

  test('every top row stays inside the folded rail, keeps its name and is reached by the keyboard; Sök opens the search over the page', async ({
    page,
    api: _,
  }) => {
    await open(page, '/');
    const rail = page.getByRole('navigation', { name: 'Sidonavigering' });
    await page.getByRole('button', { name: 'Komprimera sidofältet' }).click();
    await expect(page.getByRole('button', { name: 'Expandera sidofältet' })).toBeVisible();
    const rows = [
      rail.getByRole('link', { name: 'Ny fråga', exact: true }),
      rail.getByRole('button', { name: 'Sök', exact: true }),
      rail.getByRole('link', { name: /^Hem/ }),
      rail.getByRole('link', { name: /^Att göra/ }),
      rail.getByRole('link', { name: 'Kalender', exact: true }),
    ];
    // The rail's own box, measured once it has finished folding.
    await expect.poll(async () => (await rail.boundingBox())!.width).toBeLessThan(100);
    const edge = (await rail.boundingBox())!;
    for (const row of rows) {
      await expect(row).toBeVisible();
      const box = (await row.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(edge.x - 0.5);
      expect(box.x + box.width).toBeLessThanOrEqual(edge.x + edge.width + 0.5);
      // Nothing inside it is cut off at the rail's edge.
      expect(await row.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    }
    // The keyboard goes from one row to the next, in the rail's order.
    await rows[0]!.focus();
    for (const row of rows.slice(1)) {
      await page.keyboard.press('Tab');
      await expect(row).toBeFocused();
    }
    await expectNoAxeViolations(page);
    // Sök opens Astryx's command palette over the page, the field takes the focus, and a pick opens what was found.
    await rows[1]!.click();
    const palette = page.getByRole('dialog', { name: 'Sök i samtal och ärenden' });
    const field = palette.getByRole('combobox', { name: 'Sök i samtal och ärenden' });
    await expect(field).toBeFocused();
    await expectNoAxeViolations(page);
    await field.fill('fakturor');
    await page.getByRole('option', { name: /Attestera 3 fakturor/ }).click();
    // Picked on Hem, the work item opens over Hem in its panel (D111 rule 2; D112, amended 2026-11-12).
    await expect(page).toHaveURL(/\/\?card=fakturor$/);
    await expect(palette).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: 'Ärende', exact: true }).locator('#card-fakturor')).toBeVisible();
  });

  test('Esc closes the search and gives the focus back to Sök', async ({ page, api: _ }) => {
    await open(page, '/');
    const sok = page
      .getByRole('navigation', { name: 'Sidonavigering' })
      .getByRole('button', { name: 'Sök', exact: true });
    await sok.click();
    const palette = page.getByRole('dialog', { name: 'Sök i samtal och ärenden' });
    await expect(palette).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(palette).toHaveCount(0);
    await expect(sok).toBeFocused();
  });
});

test('a long conversation title stays inside the rail on one line', async ({ page, api }) => {
  const title = 'Anna har varit sjuk i två veckor, vad behöver jag göra nu och vem ska jag kontakta först?';
  const first = api.threads.find(t => t.kind === 'question')!;
  api.threads = api.threads.map(t => (t.id === first.id ? { ...t, title } : t));
  await page.setViewportSize(desktop);
  await open(page, '/');
  const rail = page.getByRole('navigation', { name: 'Sidonavigering' });
  const row = rail.locator(`a[href="/conversations/${first.id}"]`);
  await expect(row).toBeVisible();
  // The whole title is the link's name; what is drawn ends inside the rail and on one row's height.
  await expect(row).toHaveAccessibleName(new RegExp(title.replace(/[?]/g, '\\?')));
  const [railBox, rowBox] = [await rail.boundingBox(), await row.boundingBox()];
  expect(rowBox!.x + rowBox!.width).toBeLessThanOrEqual(railBox!.x + railBox!.width);
  const other = rail.getByRole('link', { name: 'Kalender', exact: true });
  expect(rowBox!.height).toBe((await other.boundingBox())!.height);
  // Nothing inside the row is drawn past the row's own end.
  const spill = await row.evaluate(element => {
    const end = element.getBoundingClientRect().right;
    return [...element.querySelectorAll('*')].some(child => child.getBoundingClientRect().right > end + 1);
  });
  expect(spill).toBe(false);
});

/**
 * The rows under Administration are the ones the person may open (D85): each is drawn for a person holding the
 * capability its page is behind on the server, and Kompetens only while the module is switched on (D108 item 13). With
 * none of them there is no Administration in the rail.
 */
test.describe('Administration in the rail, by what the person may open', () => {
  test.use({ viewport: desktop });
  const rail = (page: Page) => page.getByRole('navigation', { name: 'Sidonavigering' });
  const rows = (page: Page) => rail(page).getByRole('group', { name: 'Administration', exact: true }).getByRole('link');

  test('every capability: every row but Kompetens while it is off', async ({ page, api }) => {
    api.admin = true;
    await open(page, '/admin/connectors');
    await expect(rows(page)).toHaveText(['Anslutna system', 'Modeller', 'Användare', 'Organisation', 'Utseende']);
  });

  test('only admin.appearance: only Utseende', async ({ page, api }) => {
    api.admin = true;
    api.capabilities = ['admin.appearance'];
    await open(page, '/admin/appearance');
    await expect(rows(page)).toHaveText(['Utseende']);
    await expectNoAxeViolations(page);
  });

  test('only admin.users: Användare and Organisation', async ({ page, api }) => {
    api.admin = true;
    api.capabilities = ['admin.users'];
    await open(page, '/admin/users');
    await expect(rows(page)).toHaveText(['Användare', 'Organisation']);
  });

  test('only admin.competence while the module is off: no Administration at all', async ({ page, api }) => {
    api.admin = true;
    api.capabilities = ['admin.competence'];
    await open(page, '/');
    await expect(rail(page).getByRole('button', { name: 'Administration', exact: true })).toHaveCount(0);
  });
});
