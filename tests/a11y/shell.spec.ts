import type { Locator } from '@playwright/test';
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
import { NOW } from './data';

/** What a person sees of a rail row: where it starts, how wide and tall it is, and its type. */
const rowLook = (row: Locator) =>
  row.evaluate(element => {
    const { x, width, height } = element.getBoundingClientRect();
    return { x, width, height, font: getComputedStyle(element).font };
  });

for (const viewport of [desktop, narrow])
  test(`the header's bell works by keyboard at ${viewport.width}px`, async ({ page, api: _ }) => {
    await page.setViewportSize(viewport);
    await open(page, '/');
    // The shared header (D88) is the shell's banner: the home link, the bell and the person, on a phone as the bar.
    const header = page.getByRole('banner');
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
  test(`the person is a button in the header that opens the settings by keyboard at ${viewport.width}px`, async ({
    page,
    api,
  }) => {
    api.admin = true;
    await page.setViewportSize(viewport);
    await open(page, '/');
    const header = page.getByRole('banner');
    const account = header.getByRole('button', { name: 'Testa Testsson, inställningar', exact: true });
    await expect(account).toBeVisible();
    await expect(account).toHaveAttribute('aria-haspopup', 'dialog');
    // The rail is Clew's places and conversations alone (D50): no heading, no account row.
    const nav = await openNav(page);
    await expect(nav.getByRole('button', { name: 'Testa Testsson', exact: true })).toHaveCount(0);
    await expect(nav.getByRole('button', { name: 'Inställningar', exact: true })).toHaveCount(0);
    await expect(nav.getByRole('button', { name: 'Administration', exact: true })).toBeVisible();
    if (viewport === narrow) {
      await page.keyboard.press('Escape');
      await expect(nav).toBeHidden();
    }
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

test('the phone bar holds the heading, the bell and the person, and the drawer holds the rail', async ({
  page,
  api: _,
}) => {
  await page.setViewportSize(narrow);
  await open(page, '/');
  const header = page.getByRole('banner');
  await expect(page.getByRole('button', { name: 'Öppna navigering' })).toBeVisible();
  await expect(header.getByRole('button', { name: 'Testa Testsson, inställningar', exact: true })).toBeVisible();
  await expect(header.getByRole('button', { name: 'Påminnelser: 0', exact: true })).toBeVisible();
  const nav = await openNav(page);
  await expect(nav.getByRole('link', { name: 'Ny fråga', exact: true })).toBeVisible();
  await expect(
    nav.getByRole('group', { name: 'Huvudmeny' }).getByRole('link', { name: 'Start', exact: true }),
  ).toBeVisible();
});

for (const [source, heading] of [
  ['/calendar', 'Vecka'],
  ['/?area=budget', 'Hej Testa'],
] as const)
  test(`a reminder opens and focuses its card over ${source}`, async ({ page, api }) => {
    api.threads = api.threads.map(t => (t.id === 'ledighet' ? { ...t, remindedAt: NOW } : t));
    await open(page, source);
    const bell = page.getByRole('button', { name: 'Påminnelser: 1', exact: true });
    await bell.click();
    const list = page.getByRole('dialog', { name: 'Påminnelser', exact: true });
    await expect(list).toBeVisible();
    await expectNoAxeViolations(page);
    await list.getByRole('link', { name: /Ledighetsansökan/ }).click();
    // The card opens over the page the person is on, with that page's own address kept (D107 rule 2): on Kalender in
    // the shell's drawer, on Hem in its panel, over the page at this width, and the focus is in it.
    await expect(page).toHaveURL(`${source}${source.includes('?') ? '&' : '?'}card=ledighet`);
    await expect(list).not.toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeAttached();
    const panel = page.getByRole('dialog', { name: 'Kort', exact: true });
    await expect(
      panel.getByRole('article', { name: 'Kort: Ledighetsansökan från Johan Byström', exact: true }),
    ).toBeVisible();
    await expect.poll(() => panel.evaluate(el => el.contains(document.activeElement))).toBe(true);
    // Waiting on others and handled cards never count as outstanding reminders; the address still shows the card as it is now.
    api.threads = api.threads.map(t => (t.id === 'ledighet' ? { ...t, state: 'handled' } : t));
    await page.reload();
    await expect(
      page
        .getByRole('dialog', { name: 'Kort', exact: true })
        .getByRole('article', { name: 'Kort: Ledighetsansökan från Johan Byström', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Påminnelser: 0', exact: true })).toBeAttached();
  });

test('an empty bell says what will appear, leads to the overview and restores focus on Escape', async ({
  page,
  api: _,
}) => {
  await page.setViewportSize(narrow);
  await open(page, '/?area=personal');
  const bell = page.getByRole('banner').getByRole('button', { name: 'Påminnelser: 0', exact: true });
  await bell.click();
  const list = page.getByRole('dialog', { name: 'Påminnelser', exact: true });
  await expect(list.getByText('Inga aktuella påminnelser')).toBeVisible();
  expect(await reflowProblems(page, list)).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(bell).toBeFocused();
  await bell.click();
  await list.getByRole('link', { name: 'Öppna Hem', exact: true }).click();
  await expect(page).toHaveURL('/');
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
    const card = page.getByRole('dialog', { name: 'Kort', exact: true });
    await expect(
      card.getByRole('article', { name: 'Kort: Ledighetsansökan från Johan Byström', exact: true }),
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
  await page.getByRole('button', { name: 'Testa Testsson, inställningar', exact: true }).click();
  await page.getByRole('radio', { name: 'Mörkt', exact: true }).check();
  await expect(page.getByText(/Webbläsaren tillåter inte att valet sparas/)).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Mörkt', exact: true })).toBeChecked();
});

test('logout reports failure, then ends the session after a successful retry', async ({ page, api }) => {
  await page.route('**/api/auth/logout', route => route.fulfill({ status: 503 }));
  await open(page, '/');
  const account = page.getByRole('button', { name: 'Testa Testsson, inställningar', exact: true });
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

test('the person signs out from the phone bar', async ({ page, api }) => {
  await page.route('**/api/auth/logout', route => {
    api.signedIn = false;
    return route.fulfill({ json: { url: '/' } });
  });
  await page.setViewportSize(narrow);
  await open(page, '/');
  await page.getByRole('banner').getByRole('button', { name: 'Testa Testsson, inställningar', exact: true }).click();
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
    await page.getByRole('link', { name: 'Kalender', exact: true }).click();
    const week = page.getByRole('heading', { level: 1, name: 'Vecka' });
    await expect(week).toBeVisible();
    const title = await page.title();
    const opener = page.getByRole('button', { name: 'Ny bokning' });
    await opener.focus();
    await page.evaluate(() => {
      window.history.pushState(null, '', '/calendar?card=fakturor');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    const drawer = page.getByRole('dialog', { name: 'Kort' });
    await expect(drawer.locator('#card-fakturor').getByRole('button', { name: 'Attestera 2 valda' })).toBeVisible();
    await expect.poll(() => drawer.evaluate(el => el.contains(document.activeElement))).toBe(true);
    // Kalender stays the page under it: its heading, its title and its path.
    await expect(week).toBeAttached();
    await expect(page).toHaveTitle(title);
    await expectNoAxeViolations(page);
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
    await expect(page).toHaveURL(/\/calendar$/);
    await expect(opener).toBeFocused();
    await expect(week).toBeVisible();
    // Back on Hem the card is Hem's own again, drawn once.
    await page.evaluate(() => {
      window.history.pushState(null, '', '/?card=fakturor');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await expect(page.getByRole('heading', { level: 1, name: 'Hej Testa' })).toBeVisible();
    await expect(drawer.locator('#card-fakturor')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(1);
  });

  test('opened by its address the card is there after a load, and ✕ leaves Kalender without the card', async ({
    page,
    api: _,
  }) => {
    await open(page, '/calendar?card=omtanke');
    const drawer = page.getByRole('dialog', { name: 'Kort' });
    await expect(drawer.getByRole('article', { name: 'Kort: Omtankesamtal med Anna Lindqvist' })).toBeVisible();
    await expect.poll(() => drawer.evaluate(el => el.contains(document.activeElement))).toBe(true);
    await expectNoAxeViolations(page);
    await drawer.getByRole('button', { name: 'Stäng', exact: true }).click();
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
    const drawer = page.getByRole('dialog', { name: 'Kort' });
    await expect(drawer.getByText('Kortet finns inte längre bland dina kort.')).toBeVisible();
    await expect(page).toHaveURL('/admin/connectors?card=okand');
    await expectNoAxeViolations(page);
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
    await expect(page).toHaveURL(/\/admin\/connectors$/);
  });

  test('a card’s read lies over the card in the same drawer, and closing it leaves the card', async ({
    page,
    api: _,
  }) => {
    await open(page, '/calendar?card=omtanke');
    const drawer = page.getByRole('dialog', { name: 'Kort' });
    await drawer.getByRole('button', { name: 'Se mönstret' }).click();
    await expect(page).toHaveURL('/calendar?card=omtanke&open-card=omtanke&open-action=pattern');
    const read = page.getByRole('dialog', { name: 'Se mönstret' });
    await expect(read).toBeVisible();
    await expect(read.getByRole('heading', { name: 'Se mönstret' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL('/calendar?card=omtanke');
    await expect(
      page
        .getByRole('dialog', { name: 'Kort' })
        .getByRole('article', { name: 'Kort: Omtankesamtal med Anna Lindqvist' }),
    ).toBeVisible();
  });
});
