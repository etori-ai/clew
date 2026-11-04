import { answer, composer, desktop, expect, expectNoAxeViolations, open, phone, test } from './support';

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

  test('a toast has no axe violations', async ({ page, api: _ }) => {
    await open(page, '/');
    await page.getByRole('button', { name: 'Inte nu' }).first().click();
    await expect(page.getByRole('region', { name: 'Aviseringar' })).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test('every card opened has no axe violations', async ({ page, api: _ }) => {
    await open(page, '/');
    await page.getByRole('button', { name: /Pågår utan dig/ }).click();
    await expect(page.getByText('Skyddsombudet har fått ärendet.')).toBeVisible();
    for (const title of ['Omtankesamtal med Anna Lindqvist', 'Ledighetsansökan från Johan Byström']) {
      const expand = page.getByRole('button', { name: title, exact: true });
      if (await expand.isVisible()) await expand.click();
    }
    await expectNoAxeViolations(page);
  });
});
