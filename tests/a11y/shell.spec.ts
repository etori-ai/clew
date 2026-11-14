import type { Page } from '@playwright/test';
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
import { NOW, user } from './data';

for (const viewport of [desktop, narrow])
  test(`Påminnelser is a row of the rail under Mitt arbete and works by keyboard at ${viewport.width}px`, async ({
    page,
    api: _,
  }) => {
    await page.setViewportSize(viewport);
    await open(page, '/');
    // Without a header connector (D112 item 1) the rail's heading is the installation's name alone; the reminders are a
    // row of the rail under Mitt arbete (D126, pending the product owner), on a phone in the drawer with the rail.
    const header =
      viewport === narrow ? page.getByRole('banner') : page.getByRole('navigation', { name: 'Sidonavigering' });
    const home = header.getByRole('link', { name: /Startsidan/ });
    await expect(home).toBeVisible();
    await expect(home.locator('button')).toHaveCount(0);
    await expect(header.getByRole('button', { name: /^Påminnelser/ })).toHaveCount(viewport === narrow ? 0 : 1);
    const nav = await openNav(page);
    const row = nav.getByRole('button', { name: 'Påminnelser', exact: true });
    await expect(row).toBeVisible();
    // Under Kalender, the last of Mitt arbete's places.
    expect((await row.boundingBox())!.y).toBeGreaterThan(
      (await nav.getByRole('link', { name: 'Kalender', exact: true }).boundingBox())!.y,
    );
    await row.focus();
    await page.keyboard.press('Enter');
    const reminders = page.getByRole('dialog', { name: 'Påminnelser', exact: true });
    await expect(reminders).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(row).toBeFocused();
  });

for (const viewport of [desktop, narrow])
  test(`the person is the last row of the rail and leads to their own page at ${viewport.width}px`, async ({
    page,
    api,
  }) => {
    api.admin = true;
    await page.setViewportSize(viewport);
    await open(page, '/');
    // Without a header connector the person is the rail's last row, under Administration (D112 item 1, board Shell): the
    // link to their own page (D126 rule 1), where their settings are.
    const nav = await openNav(page);
    const account = nav.getByRole('link', { name: 'Testa Testsson', exact: true });
    await expect(account).toHaveAttribute('href', '/people/testperson');
    await expect(nav.getByRole('link', { name: 'Administration', exact: true })).toHaveAttribute('href', '/admin');
    expect((await account.boundingBox())!.y).toBeGreaterThan(
      (await nav.getByRole('link', { name: 'Administration', exact: true }).boundingBox())!.y,
    );
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
    // The rail's foot row leads to the person's own page (D126 rule 10), where their settings are (D39).
    const nav = await openNav(page);
    await nav.getByRole('link', { name: user.name, exact: true }).click();
    await expect(page).toHaveURL(`/people/${user.id}`);
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

test('the phone bar holds the heading, and the drawer holds the rail with the reminders and the person at its foot', async ({
  page,
  api: _,
}) => {
  await page.setViewportSize(narrow);
  await open(page, '/');
  const header = page.getByRole('banner');
  await expect(page.getByRole('button', { name: 'Öppna navigering' })).toBeVisible();
  await expect(header.getByRole('link', { name: /Startsidan/ })).toBeVisible();
  const nav = await openNav(page);
  await expect(nav.getByRole('button', { name: 'Påminnelser', exact: true })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Ny fråga', exact: true })).toBeVisible();
  await expect(nav.getByRole('button', { name: 'Sök', exact: true })).toBeVisible();
  await expect(nav.getByRole('link', { name: /^Att göra/ })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Testa Testsson', exact: true })).toBeVisible();
  // No header connector, no places of the header's in the drawer.
  await expect(nav.getByRole('group', { name: 'Huvudmeny' })).toHaveCount(0);
});

test('a reminder opens its work item in Att göra’s reading pane, with the focus on it', async ({ page, api }) => {
  api.threads = api.threads.map(t => (t.id === 'ledighet' ? { ...t, remindedAt: NOW } : t));
  await open(page, '/todo?area=budget');
  await page.getByRole('button', { name: /^Påminnelser\s*1$/ }).click();
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
  await expect(page.getByRole('button', { name: 'Påminnelser', exact: true })).toBeAttached();
});

for (const [source, heading] of [['/calendar', 'Vecka']] as const)
  test(`a reminder from ${source} opens its work item's page, with ${source} as the way back`, async ({
    page,
    api,
  }) => {
    api.threads = api.threads.map(t => (t.id === 'ledighet' ? { ...t, remindedAt: NOW } : t));
    await open(page, source);
    const bell = page.getByRole('button', { name: /^Påminnelser\s*1$/ });
    await bell.click();
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
    await expect(page.getByRole('button', { name: 'Påminnelser', exact: true })).toBeAttached();
    await page.goBack();
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeAttached();
  });

test('an empty list of reminders says what will appear, leads to the overview and restores focus on Escape', async ({
  page,
  api: _,
}) => {
  await page.setViewportSize(narrow);
  await open(page, '/todo?area=personal');
  const bell = (await openNav(page)).getByRole('button', { name: 'Påminnelser', exact: true });
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

test('the reminders open beside their row at the desktop and the count is part of the row', async ({ page, api }) => {
  api.threads = api.threads.map(t => (t.id === 'ledighet' ? { ...t, remindedAt: NOW } : t));
  await page.setViewportSize(desktop);
  await open(page, '/calendar');
  const bell = page.getByRole('button', { name: /^Påminnelser\s*1$/ });
  await expect(bell).toContainText('1');
  await bell.click();
  const list = page.getByRole('dialog', { name: 'Påminnelser', exact: true });
  await expect(list.and(page.locator('.astryx-popover'))).toBeVisible();
  const trigger = (await bell.boundingBox())!;
  const surface = (await list.boundingBox())!;
  // Beside the rail, at the row's end, never over the rail's own rows.
  expect(surface.x).toBeGreaterThanOrEqual(trigger.x + trigger.width - 1);
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
    const bell = (await openNav(page)).getByRole('button', { name: /^Påminnelser\s*1$/ });
    await bell.click();
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
  const bell = page.getByRole('button', { name: /^Påminnelser\s*kunde inte uppdateras$/ });
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
  await open(page, '/?settings=1');
  await page.getByRole('radio', { name: 'Mörkt', exact: true }).check();
  await expect(page.getByText(/Webbläsaren tillåter inte att valet sparas/)).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Mörkt', exact: true })).toBeChecked();
});

test('logout reports failure, then ends the session after a successful retry', async ({ page, api }) => {
  await page.route('**/api/auth/logout', route => route.fulfill({ status: 503 }));
  await open(page, '/?settings=1');
  const account = page.getByRole('link', { name: 'Testa Testsson', exact: true });
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
    // Picked on Hem, the work item opens on its own page with Hem as the way back (D126 rule 1).
    await expect(page).toHaveURL('/items/fakturor?from=%2F');
    await expect(palette).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1, name: /^Attestera 3 fakturor/ })).toBeVisible();
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
 * Administration in the rail (D126 rule 7): one row, to the administration, drawn for a person who holds any of its
 * sections (D85), Kompetens counting only while the module is switched on (D108 item 13). Its sections are listed by the
 * administration itself (`admin.spec.ts`).
 */
test.describe('Administration in the rail, by what the person may open', () => {
  test.use({ viewport: desktop });
  const rail = (page: Page) => page.getByRole('navigation', { name: 'Sidonavigering' });
  const row = (page: Page) => rail(page).getByRole('link', { name: 'Administration', exact: true });

  test('every capability: one row to the administration, marked there', async ({ page, api }) => {
    api.admin = true;
    await open(page, '/');
    await expect(row(page)).toHaveAttribute('href', '/admin');
    await expect(rail(page).getByRole('group', { name: 'Administration', exact: true })).toHaveCount(0);
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
