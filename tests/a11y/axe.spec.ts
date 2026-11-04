import { answer, composer, desktop, expect, expectNoAxeViolations, open, phone, snoozeFirst, test } from './support';

/** axe over every route and over the states a route can reach, at both layouts. */
const routes = [['start', '/'], ['an area', '/omrade/personal'], ['the calendar lens', '/omrade/kalender'], ['the log', '/hanterat'], ['the calendar page', '/kalender']] as const;

for (const [layout, viewport] of [['desktop', desktop], ['phone', phone]] as const) test.describe(layout, () => {
  test.use({ viewport });

  for (const [name, path] of routes) test(`${name} has no axe violations`, async ({ page, api: _ }) => {
    await open(page, path);
    await expectNoAxeViolations(page);
  });

  test('the sign-in page has no axe violations', async ({ page, api }) => {
    api.signedIn = false;
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Startsidan' })).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test('an ended session has no axe violations', async ({ page, api }) => {
    await open(page, '/');
    api.signedIn = false;
    await page.evaluate(() => window.dispatchEvent(new Event('clew-session-ended')));
    await expect(page.getByRole('button', { name: 'Logga in igen' }).or(page.getByRole('link', { name: 'Logga in igen' }))).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test('the open conversation has no axe violations', async ({ page, api: _ }) => {
    await open(page, '/');
    const input = composer(page);
    await input.fill('Vem är på plats?');
    await input.press('Enter');
    await expect(answer(page)).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test('the side panel has no axe violations', async ({ page, api: _ }) => {
    await open(page, '/vy/heroma.whoIsOn?titel=Vem%20%C3%A4r%20p%C3%A5%20plats%3F');
    await expect(page.getByRole('dialog')).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test('the sources view has no axe violations', async ({ page, api: _ }) => {
    await open(page, '/vy/startsidan.search?titel=K%C3%A4llor&input=%7B%22query%22%3A%22fall%22%7D');
    await expect(page.getByRole('dialog').getByRole('list', { name: 'Källor' })).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test('a document answer with steps and citations has no axe violations', async ({ page, api: _ }) => {
    await open(page, '/');
    const input = composer(page);
    await input.fill('Brukaren har ramlat, vad gör jag?');
    await input.press('Enter');
    await expect(page.locator('.astryx-chat-message-bubble').filter({ hasText: 'Lyft inte själv' })).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test('a toast has no axe violations', async ({ page, api: _ }) => {
    await open(page, '/');
    await snoozeFirst(page);
    await expect(page.getByRole('region', { name: 'Aviseringar' })).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test('every card opened has no axe violations', async ({ page, api: _ }) => {
    await open(page, '/');
    // The piles are a toggle group on a desktop and a menu on a phone (D31 item 5).
    const toggle = page.getByRole('button', { name: /Pågår utan dig/ });
    if (await toggle.isVisible()) await toggle.click();
    else { await page.getByRole('button', { name: /^Visa:/ }).click(); await page.getByRole('menuitem', { name: /Pågår utan dig/ }).click(); }
    await expect(page.getByText('Skyddsombudet har fått ärendet.')).toBeVisible();
    for (const title of ['Omtankesamtal med Anna Lindqvist', 'Ledighetsansökan från Johan Byström']) {
      const expand = page.getByRole('button', { name: title, exact: true });
      if (await expand.isVisible()) await expand.click();
    }
    await expectNoAxeViolations(page);
  });
});
