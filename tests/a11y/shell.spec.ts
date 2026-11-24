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
  openSettings,
  pagesNav,
  personButton,
  reflowProblems,
  searchButton,
  test,
  FAILED,
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

test('a person with several units: the band names both of two, or the first and how many more, and the settings list every one (D135)', async ({
  page,
  api,
}) => {
  const school = { unitId: 'unit-skola', unitLabel: 'Skönsmons skola', role: 'manager' as const };
  api.assignments = [school, { unitId: 'unit-haga', unitLabel: 'Hagaskolan', role: 'manager' }];
  await page.setViewportSize(desktop);
  await open(page, '/');
  await expect(personButton(page)).toHaveAccessibleName(
    'Testa Testsson, Skönsmons skola och Hagaskolan, inställningar',
  );
  api.assignments = [...api.assignments, { unitId: 'unit-forskola', unitLabel: 'Granlo förskola', role: 'employee' }];
  await open(page, '/');
  await expect(personButton(page)).toHaveAccessibleName(
    'Testa Testsson, Skönsmons skola och 2 enheter till, inställningar',
  );
  // The settings under the band's person name every unit, where the band says how many more.
  await personButton(page).click();
  const dialog = page.getByRole('dialog', { name: 'Testa Testsson', exact: true });
  await expect(dialog).toContainText('Skönsmons skola, Hagaskolan och Granlo förskola');
  await expectNoAxeViolations(page);
  await page.keyboard.press('Escape');
  await expect(personButton(page)).toBeFocused();
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
    // The whole of the person is one button: a press on the avatar at its start opens the settings too, and they
    // open directly under the person, at the person's end of the band, never over the middle of the page.
    const target = (await person.boundingBox())!;
    await person.click({ position: { x: 14, y: target.height / 2 } });
    await expect(settings).toBeVisible();
    await expect(settings).toHaveCSS('opacity', '1');
    const under = (await settings.boundingBox())!;
    expect(under.y).toBeGreaterThanOrEqual(target.y + target.height);
    expect(under.y - (target.y + target.height)).toBeLessThanOrEqual(16);
    if (viewport === desktop)
      expect(Math.abs(under.x + under.width - (target.x + target.width))).toBeLessThanOrEqual(8);
    expect((await reflowProblems(page)).filter(problem => !problem.startsWith('clipped: '))).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(settings).toBeHidden();
    // The person is not a page among the pages; Administration is, for a person who holds a section of it.
    const nav = await openNav(page);
    await expect(nav.getByRole('link', { name: 'Testa Testsson', exact: true })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Administration', exact: true })).toHaveAttribute('href', '/admin');
  });

for (const viewport of [desktop, narrow])
  test(`the settings open from the person on any page, change the appearance and close by keyboard at ${viewport.width}px`, async ({
    page,
    api: _,
  }) => {
    await page.setViewportSize(viewport);
    await open(page, '/todo');
    const settings = await openSettings(page);
    await expect(settings.getByText('Skönsmons skola', { exact: true })).toBeVisible();
    await expect(settings).toHaveCSS('opacity', '1');
    // A control in them shows the keyboard's focus in the page's colours, not the band's (2.4.7, 1.4.11): on the band
    // the ring is the band's text colour, white, which on the settings' own light ground is not seen.
    const signOut = settings.getByRole('button', { name: 'Logga ut', exact: true });
    await signOut.focus();
    const ringOnGround = await signOut.evaluate(el => {
      const channels = (colour: string) => (colour.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
      const luminance = (colour: string) =>
        channels(colour)
          .map(v => v / 255)
          .map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
          .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i]!, 0);
      const [ring, ground] = [
        luminance(getComputedStyle(el).outlineColor),
        luminance(getComputedStyle(el.closest('.astryx-popover, dialog')!).backgroundColor),
      ];
      return (Math.max(ring, ground) + 0.05) / (Math.min(ring, ground) + 0.05);
    });
    expect(ringOnGround).toBeGreaterThanOrEqual(3);
    await page.getByRole('radio', { name: 'Mörkt', exact: true }).check();
    // Choosing does not close them, and the ways on are still there.
    await expect(signOut).toBeVisible();
    expect((await reflowProblems(page)).filter(problem => !problem.startsWith('clipped: '))).toEqual([]);
    await expectNoAxeViolations(page);
    // They are not part of the address: Esc closes them where the person is, and the focus is back on the person.
    await page.keyboard.press('Escape');
    await expect(settings).not.toBeVisible();
    await expect(page).toHaveURL('/todo');
    await expect(personButton(page)).toBeFocused();
  });

for (const viewport of [desktop, narrow])
  test(`the band’s person leads to their own page, which has no second way to the settings, at ${viewport.width}px`, async ({
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
    // The band's person leads to the person's own page (D126 rule 10).
    const fromBand = await openSettings(page);
    await fromBand.getByRole('link', { name: 'Min sida', exact: true }).click();
    await expect(page).toHaveURL(`/people/${user.id}`);
    await expect(fromBand).toBeHidden();
    await expect(page.getByRole('heading', { level: 1, name: user.name })).toBeVisible();
    // The settings have one way in, the person on the band, which stands on this page as on every other (D39,
    // amended 2026-11-23): the page has no "Inställningar" of its own, and its buttons are drawn in full at 320 px.
    const main = page.getByRole('main');
    await expect(main.getByText('Inställningar', { exact: true })).toHaveCount(0);
    expect((await reflowProblems(page)).filter(problem => !problem.startsWith('clipped: '))).toEqual([]);
    await expectNoAxeViolations(page);
    const settings = await openSettings(page);
    await expect(settings.getByRole('radiogroup', { name: 'Utseende' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(settings).toBeHidden();
    await expect(page).toHaveURL(`/people/${user.id}`);
    await expect(personButton(page)).toBeFocused();
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
  // One row at 320 px: the name and the four marks stand on one line, no mark under the name.
  const row = await Promise.all(
    [banner.getByRole('link', { name: /Startsidan/ }), searchButton(page), bell(page), personButton(page), toggle].map(
      async control => (await control.boundingBox())!,
    ),
  );
  const [name, ...marks] = row;
  for (const mark of marks) expect(mark.y).toBeLessThan(name!.y + name!.height);
  // The four marks are one size on one line.
  expect(new Set(marks.map(mark => Math.round(mark.y))).size).toBe(1);
  expect(new Set(marks.map(mark => `${Math.round(mark.width)}x${Math.round(mark.height)}`)).size).toBe(1);
  expect(Math.max(...row.map(box => box.x + box.width))).toBeLessThanOrEqual(narrow.width);
  await toggle.focus();
  await page.keyboard.press('Enter');
  const drawer = page.getByRole('dialog', { name: 'Startsidan', exact: true });
  await expect(drawer).toBeVisible();
  // Every page of Clew's, in the row's order, the one that is the page marked; a manager has Personal and Läget.
  const pages = drawer.getByRole('group', { name: 'Mina sidor' }).getByRole('link');
  await expect(pages).toHaveText([/^Start$/, /^Att göra/, /^Kalender$/, /^Personal$/, /^Läget$/, /^Samtal$/]);
  await expect(drawer.getByRole('link', { name: 'Start', exact: true })).toHaveAttribute('aria-current', 'page');
  // How much needs the person is said with the page's name.
  await expect(drawer.getByRole('link', { name: /^Att göra/ })).toHaveAccessibleName(/^Att göra\s*7\s*behöver dig$/);
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
    // A finger has a button that closes it, not only the grab bar.
    await expect(sheet.getByRole('button', { name: 'Stäng', exact: true })).toBeVisible();
    await expectNoAxeViolations(page);
    expect(await reflowProblems(page, sheet)).toEqual([]);
    await sheet.getByRole('link', { name: /Ledighetsansökan/ }).click();
    // The work item's page, as from a wide screen (D126 rule 1), and it reflows at 320 px.
    await expect(page).toHaveURL('/items/ledighet?from=%2Fcalendar');
    await expect(sheet).not.toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: /^Ledighetsansökan från Johan Byström/ })).toBeVisible();
    expect(await reflowProblems(page)).toEqual([]);
  });

  test('the person’s settings rise as a sheet no taller than what it holds, with its ways on as rows and a visible "Stäng"', async ({
    page,
    api: _,
  }) => {
    await open(page, '/calendar');
    const settings = await openSettings(page);
    await expect(settings.and(page.locator('dialog'))).toBeVisible();
    await expect(settings.getByRole('radiogroup', { name: 'Utseende' })).toBeVisible();
    // The ways on and the close are rows as wide as the sheet, one under the other, each a 44 px target.
    const rows = await Promise.all(
      ['Min sida', 'Logga ut', 'Stäng'].map(
        async name =>
          (await settings
            .getByRole('link', { name, exact: true })
            .or(settings.getByRole('button', { name, exact: true }))
            .boundingBox())!,
      ),
    );
    for (const row of rows) {
      expect(row.width).toBeGreaterThan(narrow.width - 48);
      // Rounded: the sheet may still be settling, and a row then measures a hair under its 44 px.
      expect(Math.round(row.height)).toBeGreaterThanOrEqual(44);
    }
    expect(rows[0]!.y).toBeLessThan(rows[1]!.y);
    expect(rows[1]!.y).toBeLessThan(rows[2]!.y);
    // The close is the sheet's last thing: nothing but its padding between it and the window's foot.
    expect(narrow.height - (rows[2]!.y + rows[2]!.height)).toBeLessThanOrEqual(48);
    await expectNoAxeViolations(page);
    expect(await reflowProblems(page, settings)).toEqual([]);
    await settings.getByRole('button', { name: 'Stäng', exact: true }).click();
    await expect(settings).toBeHidden();
    await expect(personButton(page)).toBeFocused();
  });
});

test('a failed reminder read is explicit and can be retried', async ({ page, api: _ }) => {
  await page.route('**/api/threads', route => route.fulfill({ status: 503, json: { error: FAILED } }));
  await page.goto('/calendar');
  await page.getByRole('button', { name: 'Påminnelser – kunde inte uppdateras', exact: true }).click();
  const list = page.getByRole('dialog', { name: 'Påminnelser', exact: true });
  await expect(list.getByText(FAILED, { exact: true })).toBeVisible();
  await page.unroute('**/api/threads');
  await list.getByRole('button', { name: 'Försök igen', exact: true }).click();
  await expect(list.getByText('Inga aktuella påminnelser')).toBeVisible();
});

test('a failed refresh keeps the visible reminder count in the bell’s accessible name', async ({ page, api }) => {
  api.threads = api.threads.map(t => (t.id === 'ledighet' || t.id === 'fakturor' ? { ...t, remindedAt: NOW } : t));
  await open(page, '/calendar');
  const reminders = bell(page);
  await expect(reminders).toHaveAccessibleName('Påminnelser: 2');
  await page.route('**/api/threads', route => route.fulfill({ status: 503, json: { error: FAILED } }));
  // Opening the queue after the cached read is stale refreshes it in the same session.
  await page.clock.setFixedTime(new Date(Date.parse(NOW) + 60_000));
  await pagesNav(page)
    .getByRole('link', { name: /^Att göra/ })
    .click();
  await expect(reminders).toHaveAccessibleName('Påminnelser: 2 – kunde inte uppdateras');
  await expect(reminders).toContainText('2');
  await reminders.click();
  const list = page.getByRole('dialog', { name: 'Påminnelser', exact: true });
  await expect(list.getByText(FAILED)).toBeVisible();
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
  await open(page, '/');
  await openSettings(page);
  await page.getByRole('radio', { name: 'Mörkt', exact: true }).check();
  await expect(page.getByRole('dialog').getByText(/Webbläsaren tillåter inte att valet sparas/)).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Mörkt', exact: true })).toBeChecked();
});

test('logout reports failure, then ends the session after a successful retry', async ({ page, api }) => {
  await page.route('**/api/auth/logout', route => route.fulfill({ status: 503 }));
  await open(page, '/');
  const account = personButton(page);
  await expect(account).toBeVisible();
  await openSettings(page);
  await page.getByRole('button', { name: 'Logga ut', exact: true }).click();
  await expect
    .poll(() => announcements(page))
    .toContainEqual(expect.stringContaining('Utloggningen kunde inte bekräftas. Försök igen.'));
  // The settings closed with the attempt; the retry opens them again from the person.
  await openSettings(page);
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
    await expect(rows[1]!).toHaveAccessibleName(/^Att göra\s*7\s*behöver dig$/);
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
 * The way to the assistant (D130 item 14, D138 as amended 2026-11-20): "Fråga AI" at the end of the title's line on
 * every page with a frame but a conversation's, which has its own box. On a page with a subject it opens the
 * assistant's pane about it (`ask-pane.spec.ts`); on a page with none it starts a new question with that page as the way
 * back. Hem alone keeps the floating button in the lower corner, the mark alone on a phone, which leads to Hem's line: it stands over the page, so
 * it moves to the other corner while the keyboard is on a control it would hide (2.4.11), and it comes after the page's
 * content in the keyboard's order.
 */
test.describe('the way to the assistant', () => {
  /**
   * The corner's control: a link elsewhere, and on Hem a button named by what it does there ("Fråga AI: gå till
   * frågefältet"), since Hem's line has a "Fråga AI" of its own.
   */
  const corner = (page: Page) =>
    page
      .getByRole('link', { name: 'Fråga AI', exact: true })
      .or(page.getByRole('button', { name: 'Fråga AI: gå till frågefältet', exact: true }));
  /** The corner's control on a page with a subject (D138 item 3): a button that opens the assistant's pane. */
  const paneDoor = (page: Page) => page.getByRole('button', { name: 'Fråga AI', exact: true });
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
        // Named "Fråga AI …" on every width; on a phone it is the mark alone, with no text of its own.
        const control = [...document.querySelectorAll<HTMLElement>('a, button')].find(
          el =>
            (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().startsWith('Fråga AI') &&
            getComputedStyle(el.parentElement!).position === 'fixed',
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
      // On a phone it is the mark alone, a round 48 px target, so it lies over a third of what its label did.
      await expect(button).toHaveText(viewport === narrow ? '' : 'Fråga AI');
      if (viewport === narrow) expect((await button.boundingBox())!.width).toBeLessThanOrEqual(56);
      await expect(page.getByRole('main').getByRole('button', { name: 'Fråga AI', exact: true })).toHaveCount(1);
      await button.focus();
      await page.keyboard.press('Enter');
      await expect(line).toBeFocused();
      await expect(line).toBeInViewport({ ratio: 1 });
      await expect(page).toHaveURL('/');
    });

  for (const viewport of [desktop, narrow])
    test(`on a page with a subject it opens the assistant’s pane, or on a phone the conversation’s page, by keyboard, at ${viewport.width}px`, async ({
      page,
      api: _,
    }) => {
      await page.setViewportSize(viewport);
      await open(page, '/todo');
      // A button, not a link: the page stays and the pane opens beside it (D138 item 3).
      const button = paneDoor(page);
      await expect(button).toBeInViewport({ ratio: 1 });
      await expect(page.getByRole('link', { name: 'Fråga AI', exact: true })).toHaveCount(0);
      // On the page, by its title, and not floating over it: above the page's content, in the header.
      expect(await button.evaluate(el => getComputedStyle(el.parentElement!).position)).not.toBe('fixed');
      const [title, at] = await Promise.all([
        page.getByRole('heading', { level: 1, name: 'Att göra' }).boundingBox(),
        button.boundingBox(),
      ]);
      if (viewport === desktop) {
        expect(at!.x).toBeGreaterThan(title!.x + title!.width);
        expect(at!.y).toBeLessThan(title!.y + title!.height);
      } else expect(at!.y).toBeGreaterThanOrEqual(title!.y);
      await expectNoAxeViolations(page);
      await button.focus();
      await page.keyboard.press('Enter');
      if (viewport === desktop) {
        await expect(page).toHaveURL('/todo?ask=1');
        const pane = page.getByRole('complementary', { name: 'Fråga AI', exact: true });
        await expect(pane.getByRole('textbox', { name: 'Fråga om ärendena' })).toBeFocused();
        // The box is on the page now, so the button is not drawn (item 5); closing the pane gives it the focus back.
        await expect(paneDoor(page)).toHaveCount(0);
        await page.keyboard.press('Escape');
        await expect(pane).toHaveCount(0);
        await expect(paneDoor(page)).toBeFocused();
        return;
      }
      // A phone has no pane (item 11): the conversation's page, which has its own box, so no button there.
      await expect(page).toHaveURL(/\/conversations\/new/);
      await expect(page.getByRole('combobox', { name: 'Vad vill du göra' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Fråga AI', exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Fråga AI', exact: true })).toHaveCount(0);
    });

  test('on a page with no subject it starts a new question with that page as the way back, by keyboard', async ({
    page,
    api,
  }) => {
    api.admin = true;
    await open(page, '/admin');
    const link = page.getByRole('link', { name: 'Fråga AI', exact: true });
    await expect(link).toBeInViewport({ ratio: 1 });
    await expect(link).toHaveAttribute('href', '/conversations/new');
    await expect(paneDoor(page)).toHaveCount(0);
    await link.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/conversations\/new/);
    await expect(page.getByRole('combobox', { name: 'Vad vill du göra' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Fråga AI', exact: true })).toHaveCount(0);
  });

  test('the conversation register offers Fråga AI as the door to its pane, and a question asked on Hem’s line keeps the corner, since Hem stays', async ({
    page,
    api,
  }) => {
    await open(page, '/conversations');
    await expect(paneDoor(page)).toBeInViewport({ ratio: 1 });
    await pagesNav(page).getByRole('link', { name: 'Start', exact: true }).click();
    const line = page.getByRole('textbox', { name: 'Fråga assistenten', exact: true });
    const release = api.holdAnswer();
    await line.fill('Vem är på plats?');
    await line.press('Enter');
    // The answer stands under the line (D138 item 9): the address is Hem's and the corner still leads to the line.
    await expect(page.getByRole('heading', { level: 2, name: 'Vem är på plats?' })).toBeVisible();
    await expect(page).toHaveURL('/');
    await expect(corner(page)).toHaveCount(1);
    release();
    await expect(page.getByRole('log')).toContainText('Tio personer är på plats i dag.');
    await expect(page).toHaveURL('/');
    await expect(corner(page)).toHaveCount(1);
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
  ] as const)
    test(`no focus stop of ${path} lies entirely under it at ${viewport.width}px (2.4.11)`, async ({
      page,
      api: _,
    }) => {
      await page.setViewportSize(viewport);
      await open(page, path);
      expect(await stopsUnderTheCorner(page)).toEqual([]);
    });

  test('on Hem it is the last stop of the page, after the content it stands over', async ({ page, api: _ }) => {
    await open(page, '/');
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
