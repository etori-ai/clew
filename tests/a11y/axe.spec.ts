import { answer, composer, desktop, expect, expectNoAxeViolations, open, phone, snoozeFirst, test } from './support';

/** axe over every route and over the states a route can reach, at both layouts. */
const routes = [
  ['start', '/'],
  ['Att göra', '/todo'],
  ['an area', '/todo?area=personal'],
  ['the calendar lens', '/todo?area=kalender'],
  ['the log', '/todo?tab=done'],
  ['the calendar page', '/calendar'],
] as const;

for (const [layout, viewport] of [
  ['desktop', desktop],
  ['phone', phone],
] as const)
  test.describe(layout, () => {
    test.use({ viewport });

    for (const [name, path] of routes)
      test(`${name} has no axe violations`, async ({ page, api: _ }) => {
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
      await expect(
        page.getByRole('button', { name: 'Logga in igen' }).or(page.getByRole('link', { name: 'Logga in igen' })),
      ).toBeVisible();
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
      await expect(page.getByRole('article', { name: 'Ärende: Attestera 3 fakturor, 48 200 kr' })).toBeVisible();
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
      await open(page, '/');
      await snoozeFirst(page);
      await expect(page.getByRole('region', { name: 'Aviseringar' })).toBeVisible();
      await expectNoAxeViolations(page);
    });

    test('every work item opened has no axe violations', async ({ page, api: _ }) => {
      // A pile is a tab of Att göra (D111 item 3): Väntar på andra lists what waits.
      await open(page, '/todo?tab=waiting');
      await expect(page.getByRole('list', { name: 'Väntar på andra' })).toBeVisible();
      await expectNoAxeViolations(page);
      // A work item opened from its row: in the reading pane on a desktop, as its page alone on a phone (D111 items 3
      // and 12; the calendar's proposals keep their own card). One of each kind, and the item's own page.
      for (const [id, title] of [
        ['omtanke', 'Omtankesamtal med Anna Lindqvist'],
        ['samtal', ''],
      ] as const) {
        await open(page, `/todo?item=${id}`);
        await expect(
          layout === 'phone' && title
            ? page.getByRole('heading', { level: 1, name: title })
            : page.locator(`#card-${id}`),
        ).toBeVisible();
        await expectNoAxeViolations(page);
      }
      await open(page, '/items/omtanke');
      await expect(page.getByRole('heading', { level: 1, name: 'Omtankesamtal med Anna Lindqvist' })).toBeVisible();
      await expectNoAxeViolations(page);
    });
  });
