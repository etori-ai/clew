import { composer, desktop, open, phone, test } from './support';
import { menuRows } from './phonebook';
import { roomsMenuRow } from './rooms';

/**
 * Not a test: screenshots of artboards 4, 7 and 8 of the canvas "Clew · hierarki, områden och figurer" as built (D71):
 * the view's header on a view's page and under an answer, a list and the search hits on their pages and a record beside
 * the page (D116), the review's page (D73, amended 2026-11-12), the composer's tokens, and a system that does not answer
 * said on its work items where artboard 8 drew a banner (D116, amended 2026-11-12). Run on demand with `CLEW_SCREENS=1 …
 * playwright test -c tests/a11y screens.pattern`; the images land in test-results/screens/.
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
  test('artboard 7: a list and the hits on their pages, a record beside the page', async ({ page, api: _ }) => {
    await page.setViewportSize(desktop);
    // A list is its view's page, with the conversation it was opened from as the way back (D116).
    await open(page, `/conversations/fraga?open=phonebook.team&open-title=${at('Mitt teams kontaktlista')}`);
    await page.getByRole('heading', { level: 1, name: 'Mitt teams kontaktlista' }).waitFor();
    await page.screenshot({ path: out('pattern-7-page-list') });
    // One record is a peek beside the page: the drawer below the panel's width.
    await open(
      page,
      `/?open=phonebook.person&open-title=Kontaktkort&open-input=${at(JSON.stringify({ ref: 'person:p1002' }))}`,
    );
    await page.getByRole('dialog').waitFor();
    await page.screenshot({ path: out('pattern-7-panel-detail') });
    // The search's hits are a list, on their page.
    await open(page, `/tools/clew.search?title=${at('Källor')}&input=${at(JSON.stringify({ query: 'fall' }))}`);
    await page.getByRole('heading', { level: 1, name: 'Källor' }).waitFor();
    await page.screenshot({ path: out('pattern-7-page-hits') });
  });
  test('artboard 4: the answer with its view under it', async ({ page, api: _ }) => {
    await page.setViewportSize(desktop);
    await open(page, '/');
    await composer(page).fill('Vem finns i telefonboken?');
    await composer(page).press('Enter');
    await page.getByRole('button', { name: 'Visa allt' }).waitFor();
    await page.screenshot({ path: out('pattern-4-answer'), fullPage: true });
  });
  test('artboard 8: a silent system on its work items, the tokens and the review page', async ({ page, api }) => {
    api.sources = [
      { connector: 'finance', state: 'idle', lastSuccess: '2026-11-04T05:00:00.000Z', error: 'unavailable' },
    ];
    await page.setViewportSize(desktop);
    // Where artboard 8 drew a banner over the page, the work items from the silent system say it (D116, amended 2026-11-12).
    await open(page, '/todo?item=fakturor');
    await page.getByText(/^Kan vara gammal · Ekonomisystemet svarar inte sedan/).waitFor();
    await page.screenshot({ path: out('pattern-8-silent') });
    api.sources = [];
    // `@` in a conversation's box lists what the box can point at as tokens.
    await open(page, '/conversations/fraga');
    await composer(page).fill('@');
    await page.waitForTimeout(400);
    await page.screenshot({ path: out('pattern-8-tokens') });
    const card = api.threads.find(t => t.id === 'fakturor')!;
    card.actions = card.actions.map(a =>
      a.id === 'approve' ? { ...a, review: 'each' as const, preview: 'finance.preview' } : a,
    );
    await open(page, '/');
    await page.getByRole('main').locator('#thread-fakturor').getByRole('link', { name: 'Granska 3' }).click();
    // The review is a page of its own (D73, amended 2026-11-12): wait for its document.
    await page
      .getByRole('main')
      .getByRole('img', { name: /Energibolaget AB/ })
      .waitFor();
    await page.screenshot({ path: out('pattern-8-review') });
  });
  test('a list opened from a conversation on a phone is its page', async ({ page, api: _ }) => {
    await page.setViewportSize(phone);
    await open(page, `/conversations/fraga?open=phonebook.team&open-title=${at('Mitt teams kontaktlista')}`);
    await page.getByRole('heading', { level: 1, name: 'Mitt teams kontaktlista' }).waitFor();
    await page.screenshot({ path: out('pattern-phone-page-list') });
  });
  test('the review on a phone: the same page, stacked (D73, amended 2026-11-12)', async ({ page, api }) => {
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
      .getByRole('main')
      .getByRole('img', { name: /Energibolaget AB/ })
      .waitFor();
    await page.screenshot({ path: out('pattern-phone-review') });
    await page.getByRole('main').getByRole('button', { name: 'Attestera', exact: true }).click();
    await page
      .getByRole('main')
      .getByRole('img', { name: /Skolmaterial/ })
      .waitFor();
    await page.screenshot({ path: out('pattern-phone-review-step-2'), fullPage: false });
  });
});
