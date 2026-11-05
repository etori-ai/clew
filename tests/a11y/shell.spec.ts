import { desktop, expect, expectNoAxeViolations, narrow, open, openNav, reflowProblems, test } from './support';
import { NOW } from './data';

for (const viewport of [desktop, narrow]) test(`the compact header and profile work by keyboard at ${viewport.width}px`, async ({ page, api }) => {
  api.admin = true;
  await page.setViewportSize(viewport);
  await open(page, '/');
  const nav = await openNav(page);
  const header = nav.locator('.astryx-side-nav-heading');
  const headerBounds = (await header.boundingBox())!;
  expect(headerBounds.height).toBeLessThanOrEqual(56);
  const bell = header.getByRole('button', { name: 'Påminnelser (0)', exact: true });
  await expect(bell).toBeVisible();
  const home = header.getByRole('link', { name: /Startsidan/ });
  await expect(home.locator('button')).toHaveCount(0);
  await bell.focus();
  await page.keyboard.press('Enter');
  const reminders = page.getByRole('dialog', { name: 'Påminnelser', exact: true });
  await expect(reminders).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(bell).toBeFocused();
  const profile = nav.getByRole('button', { name: 'Testa Testsson', exact: true });
  await expect(profile).toHaveText('Testa Testsson');
  expect((await profile.boundingBox())!.y).toBeGreaterThan(headerBounds.y + headerBounds.height);
  await profile.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Skönsmons skola', { exact: true })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Inställningar', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Inställningar', exact: true });
  await expect(settings).toBeVisible();
  await page.getByRole('radio', { name: 'Mörkt', exact: true }).check();
  expect(await reflowProblems(page)).toEqual([]);
  await expectNoAxeViolations(page);
  await page.keyboard.press('Escape');
  await expect(settings).not.toBeVisible();
  await expect(profile).toBeFocused();
});

for (const source of ['/calendar', '/areas/budget']) test(`a reminder opens and focuses its card from ${source}`, async ({ page, api }) => {
  api.threads = api.threads.map(t => t.id === 'ledighet' ? { ...t, remindedAt: NOW } : t);
  await open(page, source);
  const bell = page.getByRole('button', { name: 'Påminnelser (1)', exact: true });
  await bell.click();
  const drawer = page.getByRole('dialog', { name: 'Påminnelser', exact: true });
  await expect(drawer).toBeVisible();
  await expectNoAxeViolations(page);
  await drawer.getByRole('link', { name: /Ledighetsansökan/ }).click();
  await expect(page).toHaveURL('/overview?card=ledighet');
  await expect(drawer).not.toBeVisible();
  const card = page.getByRole('article', { name: 'Tråd: Ledighetsansökan från Johan Byström', exact: true });
  await expect(card).toBeVisible();
  await expect.poll(() => card.evaluate(el => el.contains(document.activeElement))).toBe(true);
  // Waiting on others and handled cards never count as outstanding reminders.
  api.threads = api.threads.map(t => t.id === 'ledighet' ? { ...t, state: 'handled' } : t);
  await page.reload();
  await expect(page.getByText('Kortet är inte längre aktuellt på startsidan.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Påminnelser (0)', exact: true })).toBeVisible();
});

test('an empty bell offers working shortcuts and restores focus on Escape', async ({ page, api: _ }) => {
  await page.setViewportSize(narrow);
  await open(page, '/areas/personal');
  const nav = await openNav(page);
  const bell = nav.getByRole('button', { name: 'Påminnelser (0)', exact: true });
  await bell.click();
  const drawer = page.getByRole('dialog', { name: 'Påminnelser', exact: true });
  await expect(drawer.getByText('Du har inga aktuella påminnelser.')).toBeVisible();
  expect(await reflowProblems(page)).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(bell).toBeFocused();
  await bell.click();
  await drawer.getByRole('link', { name: 'Kalender', exact: true }).click();
  await expect(page).toHaveURL('/calendar');
  await expect(drawer).not.toBeVisible();
});

test('a failed reminder read is explicit and can be retried', async ({ page, api: _ }) => {
  await page.route('**/api/threads', route => route.fulfill({ status: 503, json: { error: 'Tillfälligt fel' } }));
  await page.goto('/calendar');
  const bell = page.getByRole('button', { name: 'Påminnelser – kunde inte uppdateras', exact: true });
  await bell.click();
  const drawer = page.getByRole('dialog', { name: 'Påminnelser', exact: true });
  await expect(drawer.getByText('Tillfälligt fel', { exact: true })).toBeVisible();
  await page.unroute('**/api/threads');
  await drawer.getByRole('button', { name: 'Försök igen', exact: true }).click();
  await expect(drawer.getByText('Du har inga aktuella påminnelser.')).toBeVisible();
});

test('a blocked browser preference stays usable without claiming it was saved', async ({ page, api: _ }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Blocked', 'SecurityError'); } });
  });
  await open(page, '/');
  await page.getByRole('button', { name: 'Testa Testsson', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Inställningar', exact: true }).click();
  await page.getByRole('radio', { name: 'Mörkt', exact: true }).check();
  await expect(page.getByText(/Webbläsaren tillåter inte att valet sparas/)).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Mörkt', exact: true })).toBeChecked();
});

test('logout reports failure, then ends the session after a successful retry', async ({ page, api }) => {
  await page.route('**/api/auth/logout', route => route.fulfill({ status: 503 }));
  await open(page, '/');
  const profile = page.getByRole('button', { name: 'Testa Testsson', exact: true });
  await profile.click();
  await page.getByRole('menuitem', { name: 'Logga ut', exact: true }).click();
  await expect(page.getByText('Utloggningen kunde inte bekräftas. Försök igen.')).toBeVisible();
  await page.unroute('**/api/auth/logout');
  await page.route('**/api/auth/logout', route => {
    expect(route.request().headers()['x-csrf-token']).toBe('test');
    api.signedIn = false;
    return route.fulfill({ json: { url: '/' } });
  });
  await profile.click();
  await page.getByRole('menuitem', { name: 'Logga ut', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Logga in', exact: true })).toBeVisible();
  await expect(profile).toHaveCount(0);
});
