import { answer, composer, desktop, open, phone, test } from './support';
import { menuRow, menuRows } from './phonebook';

/**
 * Not a test: screenshots of the structure D50 gave the product, for the comparison with the canvas "Clew · ett
 * sammanhängande flöde" (Hem, Samtal med panel, Att göra, Verktygssida, the phone); since D115 the tabs are
 * Mina aktiviteter's and a tool's page asks in the floating panel. Run on demand with
 * `CLEW_SCREENS=1 … playwright test -c tests/a11y screens.flow`; the images land in test-results/screens/.
 */
const out = (name: string) => `test-results/screens/flow-${name}.png`;
const wide = { width: 1440, height: 900 };
test.describe('screens', () => {
  test.skip(!process.env.CLEW_SCREENS, 'screenshots are taken on demand: CLEW_SCREENS=1');
  test.beforeEach(({ api }) => {
    api.menu = menuRows;
  });

  test('1 hem', async ({ page, api: _ }) => {
    await page.setViewportSize(wide);
    await open(page, '/');
    await page.screenshot({ path: out('1-hem') });
  });
  test('2 samtal med panel', async ({ page, api: _ }) => {
    await page.setViewportSize(wide);
    await open(page, '/');
    await composer(page).fill('telefonboken lärare');
    await composer(page).press('Enter');
    await page.getByRole('log').getByRole('button', { name: 'Visa allt' }).click();
    await page.getByRole('complementary', { name: 'Sök i telefonboken' }).getByRole('searchbox').waitFor();
    await page.screenshot({ path: out('2-samtal-med-panel') });
  });
  test('3 att göra', async ({ page, api: _ }) => {
    // The tabs and the groups are Mina aktiviteter's (D115 item 4).
    await page.setViewportSize(wide);
    await open(page, '/activities');
    await page.screenshot({ path: out('3-att-gora') });
    await open(page, '/activities?card=fakturor');
    await page.getByRole('complementary', { name: 'Kort' }).waitFor();
    await page.screenshot({ path: out('3-att-gora-kort') });
    await page.setViewportSize(desktop);
    await page.getByRole('dialog', { name: 'Kort' }).waitFor();
    await page.screenshot({ path: out('3-att-gora-kort-1280') });
  });
  test('3 samtal om kortet', async ({ page, api: _ }) => {
    await page.setViewportSize(wide);
    await open(page, '/?card=fakturor');
    await composer(page).fill('Vem är på plats?');
    await composer(page).press('Enter');
    await answer(page).waitFor();
    await page.screenshot({ path: out('3-samtal-om-kortet') });
  });
  test('4 verktygssida', async ({ page, api }) => {
    api.menu = [menuRow];
    await page.setViewportSize(wide);
    await open(page, '/tools/phonebook.directory');
    await page.screenshot({ path: out('4-verktygssida') });
    // A tool's page asks in the floating Fråga AI's panel (D115 item 5).
    await page.getByRole('button', { name: 'Fråga AI', exact: true }).click();
    await page.getByRole('dialog', { name: 'Fråga AI', exact: true }).waitFor();
    await page.screenshot({ path: out('4-verktygssida-fraga-ai') });
    await page.keyboard.press('Escape');
    await page.getByRole('link', { name: 'Anna Lindqvist' }).click();
    await page.getByText('Rum').first().waitFor();
    await page.screenshot({ path: out('4-verktygssida-rad') });
  });
  test('5 telefon', async ({ page, api: _ }) => {
    await page.setViewportSize(phone);
    await open(page, '/activities');
    await page.screenshot({ path: out('5-telefon-att-gora') });
    await open(page, '/');
    await composer(page).fill('telefonboken lärare');
    await composer(page).press('Enter');
    await page.getByRole('log').getByRole('button', { name: 'Visa allt' }).click();
    await page.getByRole('dialog', { name: 'Sök i telefonboken' }).waitFor();
    await page.screenshot({ path: out('5-telefon-samtal-med-ark') });
  });
});
