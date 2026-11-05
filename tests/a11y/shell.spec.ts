import type { Locator } from '@playwright/test';
import { announcements, desktop, expect, expectNoAxeViolations, narrow, open, openNav, reflowProblems, test } from './support';
import { NOW } from './data';

/** What a person sees of a rail row: where it starts, how wide and tall it is, and its type. */
const rowLook = (row: Locator) => row.evaluate(element => {
  const { x, width, height } = element.getBoundingClientRect();
  return { x, width, height, font: getComputedStyle(element).font };
});

for (const viewport of [desktop, narrow]) test(`the compact header works by keyboard at ${viewport.width}px`, async ({ page, api: _ }) => {
  await page.setViewportSize(viewport);
  await open(page, '/');
  const nav = await openNav(page);
  const header = nav.locator('.astryx-side-nav-heading');
  const headerBounds = (await header.boundingBox())!;
  expect(headerBounds.height).toBeLessThanOrEqual(56);
  const bell = header.getByRole('button', { name: 'Påminnelser: 0', exact: true });
  await expect(bell).toBeVisible();
  const home = header.getByRole('link', { name: /Startsidan/ });
  await expect(home.locator('button')).toHaveCount(0);
  await bell.focus();
  await page.keyboard.press('Enter');
  const reminders = page.getByRole('dialog', { name: 'Påminnelser', exact: true });
  await expect(reminders).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(bell).toBeFocused();
});

for (const viewport of [desktop, narrow]) test(`the account is a rail row like the others and works by keyboard at ${viewport.width}px`, async ({ page, api }) => {
  api.admin = true;
  await page.setViewportSize(viewport);
  await open(page, '/');
  const nav = await openNav(page);
  const account = nav.getByRole('button', { name: 'Testa Testsson', exact: true });
  await expect(account).toHaveText('Testa Testsson');
  await expect(account).toHaveAttribute('aria-expanded', 'false');
  await account.click({ trial: true }); // The phone drawer slides in; measure it where it stops.

  const calendar = nav.getByRole('link', { name: 'Kalender', exact: true });
  const administration = nav.getByRole('button', { name: 'Administration', exact: true });
  expect(await rowLook(account)).toEqual(await rowLook(calendar));
  expect(await rowLook(administration)).toEqual(await rowLook(calendar));
  const calendarIcon = (await calendar.locator('svg').first().boundingBox())!;
  const calendarLabel = (await calendar.getByText('Kalender', { exact: true }).boundingBox())!;
  for (const [row, label] of [[account, 'Testa Testsson'], [administration, 'Administration']] as const) {
    const icon = (await row.locator('svg').first().boundingBox())!;
    expect(icon).toEqual({ ...calendarIcon, y: icon.y });
    expect((await row.getByText(label, { exact: true }).boundingBox())!.x).toBe(calendarLabel.x);
  }
  const accountChevron = (await account.locator('svg').last().boundingBox())!;
  // The areas are a filter on Att göra, not a row here (D50): Administration is the other disclosure the account lines up with.
  expect(accountChevron.x).toBe((await administration.locator('svg').last().boundingBox())!.x);
  const [above, below] = [(await administration.boundingBox())!, (await account.boundingBox())!];
  expect(below.y).toBeGreaterThanOrEqual(above.y + above.height);

  await account.focus();
  await page.keyboard.press('Enter');
  await expect(account).toHaveAttribute('aria-expanded', 'true');
  await expectNoAxeViolations(page);
  const settingsRow = nav.getByRole('button', { name: 'Inställningar', exact: true });
  await page.keyboard.press('Tab');
  await expect(settingsRow).toBeFocused();
  await page.keyboard.press('Enter');
  const settings = page.getByRole('dialog', { name: 'Inställningar', exact: true });
  await expect(settings).toBeVisible();
  await expect(settings.getByText('Skönsmons skola', { exact: true })).toBeVisible();
  await page.getByRole('radio', { name: 'Mörkt', exact: true }).check();
  // The rail behind the dialog shortens long thread titles by design, so this asks only for no sideways scrolling.
  expect((await reflowProblems(page)).filter(problem => !problem.startsWith('clipped: '))).toEqual([]);
  await expectNoAxeViolations(page);
  await page.keyboard.press('Escape');
  await expect(settings).not.toBeVisible();
  await expect(settingsRow).toBeFocused();
});

test('the account stays out of the phone top bar', async ({ page, api: _ }) => {
  await page.setViewportSize(narrow);
  await open(page, '/');
  await expect(page.getByRole('button', { name: 'Öppna navigering' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Testa Testsson', exact: true })).toHaveCount(0);
});

for (const source of ['/calendar', '/todo?area=budget']) test(`a reminder opens and focuses its card from ${source}`, async ({ page, api }) => {
  api.threads = api.threads.map(t => t.id === 'ledighet' ? { ...t, remindedAt: NOW } : t);
  await open(page, source);
  const bell = page.getByRole('button', { name: 'Påminnelser: 1', exact: true });
  await bell.click();
  const list = page.getByRole('dialog', { name: 'Påminnelser', exact: true });
  await expect(list).toBeVisible();
  await expectNoAxeViolations(page);
  await list.getByRole('link', { name: /Ledighetsansökan/ }).click();
  await expect(page).toHaveURL('/todo?card=ledighet');
  await expect(list).not.toBeVisible();
  // The card opens in the panel of Att göra (D50), over the page at this width, and the focus is in it.
  const panel = page.getByRole('dialog', { name: 'Kort', exact: true });
  await expect(panel.getByRole('article', { name: 'Kort: Ledighetsansökan från Johan Byström', exact: true })).toBeVisible();
  await expect.poll(() => panel.evaluate(el => el.contains(document.activeElement))).toBe(true);
  // Waiting on others and handled cards never count as outstanding reminders; the address still shows the card as it is now.
  api.threads = api.threads.map(t => t.id === 'ledighet' ? { ...t, state: 'handled' } : t);
  await page.reload();
  await expect(page.getByRole('dialog', { name: 'Kort', exact: true }).getByRole('article', { name: 'Kort: Ledighetsansökan från Johan Byström', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Påminnelser: 0', exact: true })).toBeAttached();
});

test('an empty bell says what will appear, leads to the overview and restores focus on Escape', async ({ page, api: _ }) => {
  await page.setViewportSize(narrow);
  await open(page, '/todo?area=personal');
  const nav = await openNav(page);
  const bell = nav.getByRole('button', { name: 'Påminnelser: 0', exact: true });
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
  api.threads = api.threads.map(t => t.id === 'ledighet' ? { ...t, remindedAt: NOW } : t);
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
    api.threads = api.threads.map(t => t.id === 'ledighet' ? { ...t, remindedAt: NOW } : t);
    await open(page, '/calendar');
    const bell = page.getByRole('button', { name: 'Påminnelser: 1', exact: true });
    await bell.click();
    const sheet = page.getByRole('dialog', { name: 'Påminnelser', exact: true });
    await expect(sheet).toBeVisible();
    await expect(sheet.and(page.locator('dialog'))).toBeVisible();
    await expectNoAxeViolations(page);
    expect(await reflowProblems(page, sheet)).toEqual([]);
    await sheet.getByRole('link', { name: /Ledighetsansökan/ }).click();
    await expect(page).toHaveURL('/todo?card=ledighet');
    await expect(sheet).not.toBeVisible();
    const card = page.getByRole('article', { name: 'Kort: Ledighetsansökan från Johan Byström', exact: true });
    await expect.poll(() => card.evaluate(el => el.contains(document.activeElement))).toBe(true);
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
    Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Blocked', 'SecurityError'); } });
  });
  await open(page, '/');
  await page.getByRole('button', { name: 'Testa Testsson', exact: true }).click();
  await page.getByRole('button', { name: 'Inställningar', exact: true }).click();
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
  await expect.poll(() => announcements(page)).toContainEqual(expect.stringContaining('Utloggningen kunde inte bekräftas. Försök igen.'));
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

test('the account signs out from the phone drawer', async ({ page, api }) => {
  await page.route('**/api/auth/logout', route => {
    api.signedIn = false;
    return route.fulfill({ json: { url: '/' } });
  });
  await page.setViewportSize(narrow);
  await open(page, '/');
  const nav = await openNav(page);
  await nav.getByRole('button', { name: 'Testa Testsson', exact: true }).click();
  await nav.getByRole('button', { name: 'Logga ut', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Logga in', exact: true })).toBeVisible();
});
