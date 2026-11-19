import type { Page } from '@playwright/test';
import {
  announcements,
  bell,
  desktop,
  expect,
  expectNoAxeViolations,
  narrow,
  open,
  openNav,
  pagesNav,
  personButton,
  reflowProblems,
  searchButton,
  test,
} from './support';
import { NOW, user } from './data';

/**
 * The shell (D130): no rail. The shared header is the top bar on every page: the band with the installation's name,
 * the search, the reminders' bell and the person, and under it Clew's own pages as one row, "Mina sidor". Below the
 * header's breakpoint the bar keeps the name, the search, the bell and the person, and "Meny" opens the pages in a
 * drawer. With a header connector the band also lists the connector's places (`header.spec.ts`).
 */
for (const viewport of [desktop, narrow])
  test(`Påminnelser is the band's bell, not a page among the pages, and works by keyboard at ${viewport.width}px`, async ({
    page,
    api: _,
  }) => {
    await page.setViewportSize(viewport);
    await open(page, '/');
    const banner = page.getByRole('banner');
    const home = banner.getByRole('link', { name: /Startsidan/ });
    await expect(home).toBeVisible();
    await expect(home).toHaveAttribute('href', '/');
    await expect(home.locator('button')).toHaveCount(0);
    const reminders = bell(page);
    await expect(reminders).toHaveAccessibleName('Påminnelser: 0');
    await reminders.focus();
    await page.keyboard.press('Enter');
    const list = page.getByRole('dialog', { name: 'Påminnelser', exact: true });
    await expect(list).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(reminders).toBeFocused();
    const nav = await openNav(page);
    await expect(nav.getByRole('link', { name: 'Kalender', exact: true })).toBeVisible();
    await expect(nav.getByRole('button', { name: /^Påminnelser/ })).toHaveCount(0);
  });

for (const viewport of [desktop, narrow])
  test(`the person on the band is named by what it shows and opens the settings, where "Min sida" leads to their own page, at ${viewport.width}px`, async ({
    page,
    api,
  }) => {
    api.admin = true;
    await page.setViewportSize(viewport);
    await open(page, '/');
    const person = personButton(page);
    // A wide window shows the name over the unit, so both are in the name (2.5.3); a phone shows a glyph alone.
    await expect(person).toHaveAccessibleName(
      viewport === narrow ? 'Testa Testsson, inställningar' : 'Testa Testsson, Skönsmons skola, inställningar',
    );
    await person.focus();
    await page.keyboard.press('Enter');
    const settings = page.getByRole('dialog', { name: 'Testa Testsson', exact: true });
    await expect(settings).toBeVisible();
    await expect(settings.getByRole('radiogroup', { name: 'Utseende' })).toBeVisible();
    await expect(settings.getByRole('button', { name: 'Logga ut', exact: true })).toBeVisible();
    // The person's own page (D126 rule 1): with no rail, this is the shell's way to it.
    await expect(settings.getByRole('link', { name: 'Min sida', exact: true })).toHaveAttribute(
      'href',
      '/people/testperson',
    );
    await expectNoAxeViolations(page);
    await page.keyboard.press('Escape');
    await expect(settings).toBeHidden();
    await expect(person).toBeFocused();
    // The person is not a page among the pages; Administration is, for a person who holds a section of it.
    const nav = await openNav(page);
    await expect(nav.getByRole('link', { name: 'Testa Testsson', exact: true })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Administration', exact: true })).toHaveAttribute('href', '/admin');
  });

for (const viewport of [desktop, narrow])
  test(`the settings open over the page from their address and close by keyboard at ${viewport.width}px`, async ({
    page,
    api: _,
  }) => {
    await page.setViewportSize(viewport);
    // The person's own page links here (`?settings=1`, D39); closing replaces the address, so Back never opens them again.
    await open(page, '/todo?settings=1');
    const settings = page.getByRole('dialog', { name: 'Testa Testsson', exact: true });
    await expect(settings).toBeVisible();
    await expect(settings.getByText('Skönsmons skola', { exact: true })).toBeVisible();
    await page.getByRole('radio', { name: 'Mörkt', exact: true }).check();
    await expect(settings.getByRole('button', { name: 'Logga ut', exact: true })).toBeVisible();
    expect((await reflowProblems(page)).filter(problem => !problem.startsWith('clipped: '))).toEqual([]);
    await expectNoAxeViolations(page);
    await page.keyboard.press('Escape');
    await expect(settings).not.toBeVisible();
    await expect(page).toHaveURL('/todo');
  });

for (const viewport of [desktop, narrow])
  test(`from the person’s own page Inställningar opens the settings over it, and Esc gives the focus back to the button at ${viewport.width}px`, async ({
    page,
    api: _,
  }) => {
    // The reader's own page, as the server answers it (relation `self`), with nothing about them from a source.
    await page.route(
      url => url.pathname === `/api/entities/person/${user.id}`,
      route =>
        route.fulfill({
          json: {
            entity: { kind: 'person', key: user.id, sourceKey: 'testa', name: user.name, id: user.id },
            relation: 'self',
            actions: [],
            sections: [],
            cards: [],
          },
        }),
    );
    await page.setViewportSize(viewport);
    await open(page, '/');
    // The band's person leads to the person's own page (D126 rule 10), where their settings are too (D39).
    await personButton(page).click();
    const fromBand = page.getByRole('dialog', { name: user.name, exact: true });
    await fromBand.getByRole('link', { name: 'Min sida', exact: true }).click();
    await expect(page).toHaveURL(`/people/${user.id}`);
    await expect(fromBand).toBeHidden();
    await expect(page.getByRole('heading', { level: 1, name: user.name })).toBeVisible();
    const main = page.getByRole('main');
    const button = main
      .getByRole('link', { name: 'Inställningar', exact: true })
      .or(main.getByRole('button', { name: 'Inställningar', exact: true }));
    await expect(button).toBeVisible();
    await expectNoAxeViolations(page);
    // By keyboard: the settings open over the page, the page's address with `settings` added.
    await button.focus();
    await page.keyboard.press('Enter');
    const settings = page.getByRole('dialog', { name: user.name, exact: true });
    await expect(settings).toBeVisible();
    await expect(page).toHaveURL(`/people/${user.id}?settings=1`);
    await expect(settings.getByRole('button', { name: 'Logga ut', exact: true })).toBeVisible();
    await expectNoAxeViolations(page);
    // Esc closes them, the page keeps its address without them, and the focus is back where they were opened (2.4.3).
    await page.keyboard.press('Escape');
    await expect(settings).toBeHidden();
    await expect(page).toHaveURL(`/people/${user.id}`);
    await expect(button).toBeFocused();
  });

test('the phone bar holds the name, the search, the bell and the person, and "Meny" opens the pages in a drawer', async ({
  page,
  api: _,
}) => {
  await page.setViewportSize(narrow);
  await open(page, '/');
  const banner = page.getByRole('banner');
  await expect(banner.getByRole('link', { name: /Startsidan/ })).toBeVisible();
  await expect(searchButton(page)).toBeVisible();
  await expect(bell(page)).toBeVisible();
  await expect(personButton(page)).toBeVisible();
  // The pages' row is not drawn on a phone: "Meny" opens them.
  await expect(pagesNav(page)).toHaveCount(0);
  const toggle = banner.getByRole('button', { name: 'Meny', exact: true });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(await reflowProblems(page, banner)).toEqual([]);
  await toggle.focus();
  await page.keyboard.press('Enter');
  const drawer = page.getByRole('dialog', { name: 'Startsidan', exact: true });
  await expect(drawer).toBeVisible();
  // Every page of Clew's, in the row's order, the one that is the page marked; a manager has Personal and Läget.
  const pages = drawer.getByRole('group', { name: 'Mina sidor' }).getByRole('link');
  await expect(pages).toHaveText([/^Start$/, /^Att göra/, /^Kalender$/, /^Personal$/, /^Läget$/, /^Samtal$/]);
  await expect(drawer.getByRole('link', { name: 'Start', exact: true })).toHaveAttribute('aria-current', 'page');
  // How much needs the person is said with the page's name.
  await expect(drawer.getByRole('link', { name: /^Att göra/ })).toHaveAccessibleName(/^Att göra\s*6\s*behöver dig$/);
  // No header connector, no places of the header's in the drawer.
  await expect(drawer.getByRole('group', { name: 'Huvudmeny' })).toHaveCount(0);
  await expectNoAxeViolations(page);
  expect(await reflowProblems(page, drawer)).toEqual([]);
  // Esc closes the drawer and gives the focus back to "Meny" (2.4.3).
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await expect(toggle).toBeFocused();
  // A page chosen in the drawer opens, and the drawer is gone.
  await toggle.click();
  await drawer.getByRole('link', { name: 'Kalender', exact: true }).click();
  await expect(page).toHaveURL('/calendar');
  await expect(drawer).toBeHidden();
  await expect(page.getByRole('heading', { level: 1, name: 'Vecka' })).toBeVisible();
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
  test(`a reminder from ${source} opens its work item's page, with ${source} as the way back`, async ({
    page,
    api,
  }) => {
    api.threads = api.threads.map(t => (t.id === 'ledighet' ? { ...t, remindedAt: NOW } : t));
    await open(page, source);
    const reminders = page.getByRole('button', { name: 'Påminnelser: 1', exact: true });
    await reminders.click();
    const list = page.getByRole('dialog', { name: 'Påminnelser', exact: true });
    await expect(list).toBeVisible();
    await expectNoAxeViolations(page);
    await list.getByRole('link', { name: /Ledighetsansökan/ }).click();
    // The work item's own page, with the page the person was on as the way back (D126 rules 1 and 3): nothing over it.
    await expect(page).toHaveURL(`/items/ledighet?from=${encodeURIComponent(source)}`);
    await expect(list).not.toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: /^Ledighetsansökan från Johan Byström/ })).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Ärende', exact: true })).toHaveCount(0);
    // Waiting on others and handled cards never count as outstanding reminders; the address still shows the item as it is now.
    api.threads = api.threads.map(t => (t.id === 'ledighet' ? { ...t, state: 'handled' } : t));
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: /^Ledighetsansökan från Johan Byström/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Påminnelser: 0', exact: true })).toBeAttached();
    await page.goBack();
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeAttached();
  });

test('an empty list of reminders says what will appear, leads to the overview and restores focus on Escape', async ({
  page,
  api: _,
}) => {
  await page.setViewportSize(narrow);
  await open(page, '/todo?area=personal');
  const reminders = bell(page);
  await reminders.click();
  const list = page.getByRole('dialog', { name: 'Påminnelser', exact: true });
  await expect(list.getByText('Inga aktuella påminnelser')).toBeVisible();
  expect(await reflowProblems(page, list)).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(reminders).toBeFocused();
  await reminders.click();
  await list.getByRole('link', { name: 'Öppna Att göra', exact: true }).click();
  await expect(page).toHaveURL('/todo');
  await expect(list).not.toBeVisible();
});

test('the reminders open under the bell at the desktop and the count is part of the bell', async ({ page, api }) => {
  api.threads = api.threads.map(t => (t.id === 'ledighet' ? { ...t, remindedAt: NOW } : t));
  await page.setViewportSize(desktop);
  await open(page, '/calendar');
  const reminders = page.getByRole('button', { name: 'Påminnelser: 1', exact: true });
  await expect(reminders).toContainText('1');
  await reminders.click();
  const list = page.getByRole('dialog', { name: 'Påminnelser', exact: true });
  await expect(list.and(page.locator('.astryx-popover'))).toBeVisible();
  const trigger = (await reminders.boundingBox())!;
  const surface = (await list.boundingBox())!;
  // Under the bell, never over it, and inside the window.
  expect(surface.y).toBeGreaterThanOrEqual(trigger.y + trigger.height - 1);
  expect(surface.x).toBeGreaterThanOrEqual(0);
  expect(surface.x + surface.width).toBeLessThanOrEqual(desktop.width);
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
    await bell(page).click();
    const sheet = page.getByRole('dialog', { name: 'Påminnelser', exact: true });
    await expect(sheet).toBeVisible();
    await expect(sheet.and(page.locator('dialog'))).toBeVisible();
    await expectNoAxeViolations(page);
    expect(await reflowProblems(page, sheet)).toEqual([]);
    await sheet.getByRole('link', { name: /Ledighetsansökan/ }).click();
    // The work item's page, as from a wide screen (D126 rule 1), and it reflows at 320 px.
    await expect(page).toHaveURL('/items/ledighet?from=%2Fcalendar');
    await expect(sheet).not.toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: /^Ledighetsansökan från Johan Byström/ })).toBeVisible();
    expect(await reflowProblems(page)).toEqual([]);
  });
});

test('a failed reminder read is explicit and can be retried', async ({ page, api: _ }) => {
  await page.route('**/api/threads', route => route.fulfill({ status: 503, json: { error: 'Tillfälligt fel' } }));
  await page.goto('/calendar');
  await page.getByRole('button', { name: 'Påminnelser – kunde inte uppdateras', exact: true }).click();
  const list = page.getByRole('dialog', { name: 'Påminnelser', exact: true });
  await expect(list.getByText('Tillfälligt fel', { exact: true })).toBeVisible();
  await page.unroute('**/api/threads');
  await list.getByRole('button', { name: 'Försök igen', exact: true }).click();
  await expect(list.getByText('Inga aktuella påminnelser')).toBeVisible();
});

test('a failed refresh keeps the visible reminder count in the bell’s accessible name', async ({ page, api }) => {
  api.threads = api.threads.map(t => (t.id === 'ledighet' || t.id === 'fakturor' ? { ...t, remindedAt: NOW } : t));
  await open(page, '/calendar');
  const reminders = bell(page);
  await expect(reminders).toHaveAccessibleName('Påminnelser: 2');
  await page.route('**/api/threads', route => route.fulfill({ status: 503, json: { error: 'Tillfälligt fel' } }));
  // Opening the queue after the cached read is stale refreshes it in the same session.
  await page.clock.setFixedTime(new Date(Date.parse(NOW) + 60_000));
  await pagesNav(page)
    .getByRole('link', { name: /^Att göra/ })
    .click();
  await expect(reminders).toHaveAccessibleName('Påminnelser: 2 – kunde inte uppdateras');
  await expect(reminders).toContainText('2');
  await reminders.click();
  const list = page.getByRole('dialog', { name: 'Påminnelser', exact: true });
  await expect(list.getByText('Tillfälligt fel')).toBeVisible();
  await expect(list.getByRole('list', { name: 'Aktuella påminnelser' }).getByRole('link')).toHaveCount(2);
});

test('a blocked browser preference stays usable without claiming it was saved', async ({ page, api: _ }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new DOMException('Blocked', 'SecurityError');
      },
    });
  });
  await open(page, '/?settings=1');
  await page.getByRole('radio', { name: 'Mörkt', exact: true }).check();
  await expect(page.getByRole('dialog').getByText(/Webbläsaren tillåter inte att valet sparas/)).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Mörkt', exact: true })).toBeChecked();
});

test('logout reports failure, then ends the session after a successful retry', async ({ page, api }) => {
  await page.route('**/api/auth/logout', route => route.fulfill({ status: 503 }));
  await open(page, '/?settings=1');
  const account = personButton(page);
  await expect(account).toBeVisible();
  await page.getByRole('button', { name: 'Logga ut', exact: true }).click();
  await expect
    .poll(() => announcements(page))
    .toContainEqual(expect.stringContaining('Utloggningen kunde inte bekräftas. Försök igen.'));
  // The dialog closed with the attempt; the retry opens it again from its address.
  await open(page, '/?settings=1');
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

/**
 * Nothing opens over a page (D126 rule 3): an address from before that opened a work item over a page (a saved link, a
 * toast in an older tab) leads to the item's own page, with the page it lay over as the way back, in its place in the
 * history; on Att göra it is the item in the reading pane.
 */
test.describe('an address that opened a thing over a page', () => {
  test.use({ viewport: desktop });
  test('leads to the thing’s own page, with the page as the way back', async ({ page, api: _ }) => {
    await open(page, '/calendar?card=omtanke');
    await expect(page).toHaveURL('/items/omtanke?from=%2Fcalendar');
    await expect(page.getByRole('heading', { level: 1, name: /^Omtankesamtal med Anna Lindqvist/ })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Kalender', exact: true }).first()).toHaveAttribute(
      'href',
      '/calendar',
    );
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await open(page, '/todo?card=fakturor');
    await expect(page).toHaveURL('/todo?item=fakturor');
    await expect(page.getByRole('complementary', { name: 'Valt ärende' }).locator('#card-fakturor')).toBeVisible();
  });
});

/**
 * Clew's pages under the band (D130): one navigation landmark, "Mina sidor", with Start first where no header connector
 * lists it, the page that is open marked, and how much needs the person said with Att göra's name. Sök stands on the
 * band and opens Astryx's command palette over the page.
 */
test.describe('the pages under the band', () => {
  test.use({ viewport: desktop });

  test('every page is a link in the row, in order, the open one marked, and the keyboard reaches each in turn', async ({
    page,
    api: _,
  }) => {
    await open(page, '/');
    const nav = pagesNav(page);
    await expect(nav).toHaveCount(1);
    const rows = [
      nav.getByRole('link', { name: 'Start', exact: true }),
      nav.getByRole('link', { name: /^Att göra/ }),
      nav.getByRole('link', { name: 'Kalender', exact: true }),
      nav.getByRole('link', { name: 'Personal', exact: true }),
      nav.getByRole('link', { name: 'Läget', exact: true }),
      nav.getByRole('link', { name: 'Samtal', exact: true }),
    ];
    await expect(nav.getByRole('link')).toHaveCount(rows.length);
    for (const row of rows) await expect(row).toBeVisible();
    await expect(rows[0]!).toHaveAttribute('aria-current', 'page');
    // The count is a badge, and what it counts is said with the page's name.
    await expect(rows[1]!).toHaveAccessibleName(/^Att göra\s*6\s*behöver dig$/);
    // The keyboard goes from one page to the next, in the row's order.
    await rows[0]!.focus();
    for (const row of rows.slice(1)) {
      await page.keyboard.press('Tab');
      await expect(row).toBeFocused();
    }
    await expectNoAxeViolations(page);
    // A page chosen is the page marked, and the only one.
    await rows[2]!.click();
    await expect(page).toHaveURL('/calendar');
    await expect(nav.locator('a[aria-current="page"]')).toHaveText('Kalender');
  });

  test('the row wraps and nothing is cut at 400 % zoom of a wide window (1.4.10)', async ({ page, api }) => {
    api.admin = true;
    // Above the header's breakpoint and as narrow as the row is ever drawn: the pages wrap to a second line.
    await page.setViewportSize({ width: 768, height: 800 });
    await open(page, '/');
    const nav = pagesNav(page);
    for (const name of ['Start', 'Kalender', 'Personal', 'Läget', 'Samtal', 'Administration'])
      await expect(nav.getByRole('link', { name, exact: true })).toBeInViewport({ ratio: 1 });
    expect(await reflowProblems(page, page.getByRole('banner'))).toEqual([]);
  });

  test('Sök on the band opens the search over the page, the field takes the focus, and a pick opens what was found', async ({
    page,
    api: _,
  }) => {
    await open(page, '/');
    await searchButton(page).focus();
    await page.keyboard.press('Enter');
    const palette = page.getByRole('dialog', { name: 'Sök i samtal och ärenden' });
    const field = palette.getByRole('combobox', { name: 'Sök i samtal och ärenden' });
    await expect(field).toBeFocused();
    await expectNoAxeViolations(page);
    await field.fill('fakturor');
    await page.getByRole('option', { name: /Attestera 3 fakturor/ }).click();
    // Picked on Hem, the work item opens on its own page with Hem as the way back (D126 rule 1).
    await expect(page).toHaveURL('/items/fakturor?from=%2F');
    await expect(palette).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1, name: /^Attestera 3 fakturor/ })).toBeVisible();
  });

  test('Esc closes the search and gives the focus back to Sök', async ({ page, api: _ }) => {
    await open(page, '/');
    const sok = searchButton(page);
    await sok.click();
    const palette = page.getByRole('dialog', { name: 'Sök i samtal och ärenden' });
    await expect(palette).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(palette).toHaveCount(0);
    await expect(sok).toBeFocused();
  });
});

/**
 * The floating way to the assistant (D130 item 14): "Fråga AI" in the lower corner of every page but a conversation's,
 * which has its own box. On Hem it leads to Hem's line; elsewhere it starts a new question about the page the person is
 * on. It stands over the page, so it moves to the other corner while the keyboard is on a control it would hide
 * (2.4.11), and it comes after the page's content in the keyboard's order.
 */
test.describe('the floating way to the assistant', () => {
  /**
   * The corner's control: a link elsewhere, and on Hem a button named by what it does there ("Fråga AI: gå till
   * frågefältet"), since Hem's line has a "Fråga AI" of its own.
   */
  const corner = (page: Page) =>
    page
      .getByRole('link', { name: 'Fråga AI', exact: true })
      .or(page.getByRole('button', { name: 'Fråga AI: gå till frågefältet', exact: true }));
  /** Tabs through the page and names every stop that lies entirely under the corner's control (2.4.11). */
  async function stopsUnderTheCorner(page: Page, limit = 150) {
    await page.evaluate(() => {
      (document.activeElement as HTMLElement | null)?.blur();
      window.scrollTo(0, 0);
    });
    const under: string[] = [];
    let stops = 0;
    for (let i = 0; i < limit; i++) {
      await page.keyboard.press('Tab');
      const stop = await page.evaluate(async () => {
        const active = document.activeElement as HTMLElement | null;
        if (!active || active === document.body) return null;
        if (active.dataset.walked) return 'again';
        active.dataset.walked = '1';
        const control = [...document.querySelectorAll<HTMLElement>('a, button')].find(
          el => el.textContent?.trim() === 'Fråga AI' && getComputedStyle(el.parentElement!).position === 'fixed',
        );
        if (!control) return 'no corner';
        if (control === active) return '';
        // Where the button stands once it has answered the move of the focus (it reads it on the next frame).
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const a = active.getBoundingClientRect();
        const c = control.getBoundingClientRect();
        return a.top >= c.top && a.bottom <= c.bottom && a.left >= c.left && a.right <= c.right
          ? `${active.tagName.toLowerCase()} "${(active.getAttribute('aria-label') ?? active.textContent ?? '').trim().slice(0, 50)}"`
          : '';
      });
      if (stop === 'again') break;
      if (stop === null) {
        if (stops) break;
        continue;
      }
      stops++;
      if (stop) under.push(stop);
    }
    expect(stops, 'the walk reached the controls').toBeGreaterThan(3);
    return under;
  }

  for (const viewport of [desktop, narrow])
    test(`on Hem it gives the focus to Hem's line at ${viewport.width}px`, async ({ page, api: _ }) => {
      await page.setViewportSize(viewport);
      await open(page, '/');
      const line = page.getByRole('textbox', { name: 'Fråga assistenten', exact: true });
      const button = corner(page);
      await expect(button).toBeInViewport({ ratio: 1 });
      // What is drawn is "Fråga AI", and the name starts with it (2.5.3); the line's own button keeps the short name.
      await expect(button).toHaveText('Fråga AI');
      await expect(page.getByRole('main').getByRole('button', { name: 'Fråga AI', exact: true })).toHaveCount(1);
      await button.focus();
      await page.keyboard.press('Enter');
      await expect(line).toBeFocused();
      await expect(line).toBeInViewport({ ratio: 1 });
      await expect(page).toHaveURL('/');
    });

  for (const viewport of [desktop, narrow])
    test(`on another page it starts a new question about that page, by keyboard, at ${viewport.width}px`, async ({
      page,
      api: _,
    }) => {
      await page.setViewportSize(viewport);
      await open(page, '/todo');
      const button = corner(page);
      await expect(button).toBeInViewport({ ratio: 1 });
      await expect(button).toHaveAttribute('href', '/conversations/new');
      await expectNoAxeViolations(page);
      await button.focus();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(/\/conversations\/new/);
      // The conversation's page has its own box, so the corner is not drawn there.
      await expect(page.getByRole('combobox', { name: 'Vad vill du göra' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Fråga AI', exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Fråga AI', exact: true })).toHaveCount(0);
    });

  test('the conversation register offers the corner and a pending first answer on Hem hides it', async ({
    page,
    api,
  }) => {
    await open(page, '/conversations');
    await expect(corner(page)).toHaveAttribute('href', '/conversations/new');
    await pagesNav(page).getByRole('link', { name: 'Start', exact: true }).click();
    const line = page.getByRole('textbox', { name: 'Fråga assistenten', exact: true });
    const release = api.holdAnswer();
    await line.fill('Vem är på plats?');
    await line.press('Enter');
    await expect(page.getByRole('log')).toContainText('Vem är på plats?');
    await expect(page).toHaveURL('/');
    await expect(corner(page)).toHaveCount(0);
    release();
    await expect(page).toHaveURL('/conversations/konversation');
    await expect(corner(page)).toHaveCount(0);
  });

  test('the corner follows a focused link as scrolling and resizing change its position', async ({ page, api: _ }) => {
    await page.setViewportSize(narrow);
    await open(page, '/');
    const link = page.getByRole('region', { name: 'I dag' }).getByRole('link', { name: 'Kalender', exact: true });
    const button = corner(page);
    const cornerSide = () =>
      button.evaluate(el => {
        const r = el.getBoundingClientRect();
        return r.left + r.width / 2 < document.documentElement.clientWidth / 2 ? 'left' : 'right';
      });
    await page.keyboard.press('Tab');
    await link.evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
    await link.focus();
    const center = await link.evaluate(async el => {
      // Let the focus settle before the wheel moves the same link under the resting button.
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await expect(link).toBeFocused();
    expect(await cornerSide()).toBe('right');
    const resting = (await button.boundingBox())!;
    await page.mouse.move(center.x, center.y);
    await page.mouse.wheel(0, center.y - (resting.y + resting.height / 2));
    await expect.poll(cornerSide).toBe('left');
    await expect(link).toBeFocused();

    await page.setViewportSize({ ...narrow, height: narrow.height + 160 });
    await expect.poll(cornerSide).toBe('right');
    await expect(link).toBeFocused();
  });

  for (const [path, viewport] of [
    ['/', desktop],
    ['/', narrow],
    ['/todo', desktop],
    ['/todo', narrow],
    ['/staff', desktop],
    ['/staff', narrow],
    ['/units', narrow],
  ] as const)
    test(`no focus stop of ${path} lies entirely under it at ${viewport.width}px (2.4.11)`, async ({
      page,
      api: _,
    }) => {
      await page.setViewportSize(viewport);
      await open(page, path);
      expect(await stopsUnderTheCorner(page)).toEqual([]);
    });

  test('it is the last stop of the page, after the content it stands over', async ({ page, api: _ }) => {
    await open(page, '/todo');
    const last = await page.evaluate(() => {
      const stops = [...document.querySelectorAll<HTMLElement>('[role="main"] a[href], [role="main"] button')].filter(
        el => el.checkVisibility(),
      );
      return stops.at(-1)?.textContent?.trim();
    });
    expect(last).toBe('Fråga AI');
  });
});

/**
 * Administration among the pages (D126 rule 7, D130): one link, to the administration, drawn for a person who holds any of its
 * sections (D85), Kompetens counting only while the module is switched on (D108 item 13). Its sections are listed by the
 * administration itself (`admin.spec.ts`).
 */
test.describe('Administration among the pages, by what the person may open', () => {
  test.use({ viewport: desktop });
  const row = (page: Page) => pagesNav(page).getByRole('link', { name: 'Administration', exact: true });

  test('every capability: one row to the administration, marked there', async ({ page, api }) => {
    api.admin = true;
    await open(page, '/');
    await expect(row(page)).toHaveAttribute('href', '/admin');
    // Its sections are not pages of the row: the administration lists them itself.
    await expect(pagesNav(page).getByRole('link', { name: 'Modeller', exact: true })).toHaveCount(0);
    await open(page, '/admin/connectors');
    await expect(row(page)).toHaveAttribute('aria-current', 'page');
  });

  test('only admin.appearance: the row is there', async ({ page, api }) => {
    api.admin = true;
    api.capabilities = ['admin.appearance'];
    await open(page, '/');
    await expect(row(page)).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test('only admin.competence while the module is off: no Administration at all', async ({ page, api }) => {
    api.admin = true;
    api.capabilities = ['admin.competence'];
    await open(page, '/');
    await expect(row(page)).toHaveCount(0);
  });
});
