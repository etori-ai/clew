import { composer, desktop, open, phone, test } from './support';
import { menuRows } from './phonebook';
import { roomsMenuRow } from './rooms';

/**
 * Not a test: screenshots of artboards 4, 7 and 8 of the canvas "Clew · hierarki, områden och figurer" as built (D71):
 * the view's header on a tool page, in the panel and under an answer, the record, the search hits, the review's drawer (D73 amended),
 * the composer's tokens and the D8 banner. Run on demand with `CLEW_SCREENS=1 … playwright test -c tests/a11y
 * screens.pattern`; the images land in test-results/screens/.
 */
const out = (name: string) => `test-results/screens/${name}.png`;
const at = (text: string) => encodeURIComponent(text);
const NOW = '2026-11-04T09:30:00.000Z';

test.describe('screens', () => {
  test.skip(!process.env.CLEW_SCREENS, 'screenshots are taken on demand: CLEW_SCREENS=1');

  test('artboard 7: the rooms as a tool page, a table under the mark row', async ({ page, api }) => {
    api.menu = [...menuRows, roomsMenuRow];
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, '/tools/calendar.rooms');
    await page.getByRole('table').waitFor();
    await page.screenshot({ path: out('pattern-7-tool-table-1440') });
  });
  test('artboard 7: a list, a record and the hits in the panel', async ({ page, api: _ }) => {
    await page.setViewportSize(desktop);
    // A row goes into a conversation's box beside the conversation (D112 item 7).
    await open(page, `/conversations/fraga?open=phonebook.team&open-title=${at('Mitt teams kontaktlista')}`);
    await page.getByRole('dialog').waitFor();
    await page.screenshot({ path: out('pattern-7-panel-list') });
    await open(
      page,
      `/?open=phonebook.person&open-title=Kontaktkort&via=1&open-input=${at(JSON.stringify({ ref: 'person:p1002' }))}`,
    );
    await page.getByRole('dialog').waitFor();
    await page.screenshot({ path: out('pattern-7-panel-detail') });
    await open(
      page,
      `/?open=clew.search&open-title=${at('Källor')}&open-input=${at(JSON.stringify({ query: 'fall' }))}`,
    );
    await page.getByRole('dialog').waitFor();
    await page.screenshot({ path: out('pattern-7-panel-hits') });
  });
  test('artboard 4: the answer with its view under it', async ({ page, api: _ }) => {
    await page.setViewportSize(desktop);
    await open(page, '/');
    await composer(page).fill('Vem finns i telefonboken?');
    await composer(page).press('Enter');
    await page.getByRole('button', { name: 'Visa allt' }).waitFor();
    await page.screenshot({ path: out('pattern-4-answer'), fullPage: true });
  });
  test('artboard 8: tokens, the review drawer and the banner', async ({ page, api }) => {
    api.sources = [
      { connector: 'finance', state: 'idle', lastSuccess: '2026-11-04T05:00:00.000Z', error: 'unavailable' },
    ];
    await page.setViewportSize(desktop);
    await open(page, '/');
    await page
      .getByText(/svarar inte sedan/)
      .first()
      .waitFor();
    await page.screenshot({ path: out('pattern-8-banner') });
    // A row goes into a conversation's box beside the conversation (D112 item 7).
    await open(page, `/conversations/fraga?open=phonebook.team&open-title=${at('Mitt teams kontaktlista')}`);
    await page.getByRole('dialog').getByRole('button', { name: 'Lägg till i samtalet' }).first().click();
    await page.keyboard.press('Escape');
    await composer(page).fill('@');
    await page.waitForTimeout(400);
    await page.screenshot({ path: out('pattern-8-tokens') });
    const card = api.threads.find(t => t.id === 'fakturor')!;
    card.actions = card.actions.map(a =>
      a.id === 'approve' ? { ...a, review: 'each' as const, preview: 'finance.preview' } : a,
    );
    await open(page, '/');
    await page.getByRole('main').locator('#thread-fakturor').getByRole('link', { name: 'Granska 3' }).click();
    // The review is a drawer over Hem (D73 amended): wait for its document, then for the slide to settle.
    await page
      .getByRole('dialog', { name: 'Granska 3 rader' })
      .getByRole('img', { name: /Energibolaget AB/ })
      .waitFor();
    await page.waitForTimeout(300);
    await page.screenshot({ path: out('pattern-8-review') });
  });
  test('the answer and the banner on a phone', async ({ page, api }) => {
    api.sources = [{ connector: 'finance', state: 'idle', lastSuccess: NOW, error: 'unavailable' }];
    await page.setViewportSize(phone);
    // A row goes into a conversation's box beside the conversation (D112 item 7).
    await open(page, `/conversations/fraga?open=phonebook.team&open-title=${at('Mitt teams kontaktlista')}`);
    await page.getByRole('dialog').waitFor();
    await page.screenshot({ path: out('pattern-phone-panel') });
  });
  test("the review on a phone: a tall sheet stacked over the card's sheet (D73, second amendment)", async ({
    page,
    api,
  }) => {
    const card = api.threads.find(t => t.id === 'fakturor')!;
    card.actions = card.actions.map(a =>
      a.id === 'approve' ? { ...a, review: 'each' as const, preview: 'finance.preview' } : a,
    );
    await page.setViewportSize(phone);
    await open(page, '/?card=fakturor');
    await page
      .getByRole('dialog', { name: /^Ärende: / })
      .getByRole('link', { name: 'Granska 3' })
      .click();
    await page
      .getByRole('dialog', { name: 'Granska 3 rader' })
      .getByRole('img', { name: /Energibolaget AB/ })
      .waitFor();
    await page.waitForTimeout(500);
    await page.screenshot({ path: out('pattern-phone-review') });
    await page
      .getByRole('dialog', { name: 'Granska 3 rader' })
      .getByRole('button', { name: 'Attestera', exact: true })
      .click();
    await page
      .getByRole('dialog', { name: 'Granska 3 rader' })
      .getByRole('img', { name: /Skolmaterial/ })
      .waitFor();
    await page.waitForTimeout(300);
    await page.screenshot({ path: out('pattern-phone-review-step-2'), fullPage: false });
  });
});
