import { answer, composer, desktop, expect, expectNoAxeViolations, open, phone, snoozeFirst, test } from './support';

/** axe over every route and over the states a route can reach, at both layouts. */
const routes = [['start', '/'], ['the overview', '/todo'], ['an area', '/todo?area=personal'], ['the calendar lens', '/todo?area=kalender'], ['the log', '/todo?tab=done'], ['the calendar page', '/calendar']] as const;

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

  test('a conversation whose answer is a card has no axe violations', async ({ page, api: _ }) => {
    await open(page, '/');
    await composer(page).fill('attestera en faktura');
    await composer(page).press('Enter');
    await expect(page.getByRole('article', { name: 'Kort: Attestera 3 fakturor, 48 200 kr' })).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test('the side panel has no axe violations', async ({ page, api: _ }) => {
    await open(page, '/?open=hr.whoIsOn&open-title=Vem%20%C3%A4r%20p%C3%A5%20plats%3F');
    await expect(page.getByRole('dialog')).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test('the sources view has no axe violations', async ({ page, api: _ }) => {
    await open(page, '/?open=clew.search&open-title=K%C3%A4llor&open-input=%7B%22query%22%3A%22fall%22%7D');
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
    await open(page, '/todo');
    await snoozeFirst(page);
    await expect(page.getByRole('region', { name: 'Aviseringar' })).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test('every card opened has no axe violations', async ({ page, api: _ }) => {
    // A card's state is a tab on Att göra (D50): Pågår lists what waits on someone else.
    await open(page, '/todo?tab=waiting');
    await expect(page.locator('#att-gora-lista')).toHaveAccessibleName('Pågår utan dig');
    await expectNoAxeViolations(page);
    // A card open from its row: in the panel on a desktop, in the list on a phone. One of each kind of card.
    for (const id of ['omtanke', 'samtal']) {
      await open(page, `/todo?card=${id}`);
      await expect(page.locator(`#card-${id}, #thread-${id}[aria-label]`).first()).toBeVisible();
      await expectNoAxeViolations(page);
    }
  });
});
