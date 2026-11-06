import { menuRows } from './phonebook';
import { composer, open, test } from './support';

/**
 * Not a test: screenshots of Hem and its flows at the canvas's own sizes (1440 × 1120 for the desktop artboards, 390 × 844
 * for the phone), for the side-by-side comparison with the artboards of "Clew startsida · dagen i ett svep" (D62). Run on
 * demand with `CLEW_SCREENS=1 … playwright test -c tests/a11y screens.hem`; the images land in test-results/screens/.
 */
const out = (name: string) => `test-results/screens/${name}.png`;
const board = { width: 1440, height: 1120 };
const phone = { width: 390, height: 844 };
test.describe('screens', () => {
  test.skip(!process.env.CLEW_SCREENS, 'screenshots are taken on demand: CLEW_SCREENS=1');
  test('A · Hem with the day beside it', async ({ page, api: _ }) => {
    await page.setViewportSize(board);
    await open(page, '/');
    await page.screenshot({ path: out('hem-A-1440') });
  });
  test('B · the quiet page', async ({ page, api }) => {
    api.threads = api.threads.filter(t => t.waitingOn || t.state !== 'open' || t.snoozedUntil);
    await page.setViewportSize(board);
    await open(page, '/');
    await page.screenshot({ path: out('hem-B-1440') });
  });
  test('E · a card beside the column', async ({ page, api: _ }) => {
    await page.setViewportSize(board);
    await open(page, '/?card=fakturor');
    await page.screenshot({ path: out('hem-E-1440') });
  });
  test('E · the panel folded away', async ({ page, api: _ }) => {
    await page.setViewportSize(board);
    await open(page, '/?card=fakturor');
    await page.getByRole('button', { name: 'Fäll ihop panelen' }).click();
    await page.getByRole('button', { name: 'Visa panelen' }).waitFor();
    await page.screenshot({ path: out('hem-E-collapsed-1440') });
  });
  test('G · a question from Hem', async ({ page, api: _ }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await open(page, '/');
    await composer(page).fill('Vem är på plats i dag?');
    await page.keyboard.press('Enter');
    await page.getByRole('log').getByText('Tio personer är på plats i dag.').waitFor();
    await page.screenshot({ path: out('hem-G-1440') });
  });
  test('I · a view as a page with a row beside it', async ({ page, api }) => {
    api.menu = menuRows;
    await page.setViewportSize(board);
    await open(page, '/tools/phonebook.directory');
    await page.screenshot({ path: out('hem-I-1440') });
  });
  test('D · the phone', async ({ page, api: _ }) => {
    await page.setViewportSize(phone);
    await open(page, '/');
    await page.screenshot({ path: out('hem-D-390') });
  });
  test('K · the card on the phone', async ({ page, api: _ }) => {
    await page.setViewportSize(phone);
    await open(page, '/?card=fakturor');
    await page.screenshot({ path: out('hem-K-390') });
  });
});
