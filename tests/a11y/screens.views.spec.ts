import { composer, desktop, open, phone, test } from './support';
import { menuRows } from './phonebook';

/**
 * Not a test: screenshots of the phone book's declared views (D38): a table and a list on their pages, one record beside
 * the page it was opened from, the search's hits on their page (D116), a view under an answer, and a tool's page in the
 * rail (D42), for the comparison a canvas row will need. Run on demand with `CLEW_SCREENS=1 … playwright test -c
 * tests/a11y screens.views`; the images land in test-results/screens/.
 */
const out = (name: string) => `test-results/screens/${name}.png`;
const title = (text: string) => encodeURIComponent(text);
/** Each view, where it opens and what shows that it has drawn: a page's heading, or the panel beside Hem. */
const views = [
  ['view-table', `/tools/phonebook.directory?title=${title('Sök i telefonboken')}&from=%2F`, 'page'],
  ['view-list', `/tools/phonebook.team?title=${title('Mitt teams kontaktlista')}&from=%2F`, 'page'],
  [
    'view-detail',
    `/?open=phonebook.person&open-title=Kontaktkort&open-input=${encodeURIComponent(JSON.stringify({ ref: 'person:p1002' }))}`,
    'beside',
  ],
  [
    'view-person-hit',
    `/tools/clew.search?title=${title('Källor')}&input=${encodeURIComponent(JSON.stringify({ query: 'Anna Lindqvist' }))}&from=%2F`,
    'page',
  ],
] as const;
const drawn = (page: import('@playwright/test').Page, where: 'page' | 'beside') =>
  where === 'page' ? page.getByRole('heading', { level: 1 }).waitFor() : page.getByRole('dialog').waitFor();
test.describe('screens', () => {
  test.skip(!process.env.CLEW_SCREENS, 'screenshots are taken on demand: CLEW_SCREENS=1');
  for (const [name, path, where] of views) {
    test(`${name} desktop`, async ({ page, api: _ }) => {
      await page.setViewportSize(desktop);
      await open(page, path);
      await drawn(page, where);
      await page.screenshot({ path: out(`${name}-1280`) });
    });
    test(`${name} phone`, async ({ page, api: _ }) => {
      await page.setViewportSize(phone);
      await open(page, path);
      await drawn(page, where);
      await page.screenshot({ path: out(`${name}-375`) });
    });
  }
  test('verktyg in the menu, and a tool as a page (D42)', async ({ page, api }) => {
    api.menu = menuRows;
    await page.setViewportSize(desktop);
    await open(page, '/');
    await page.screenshot({ path: out('menu-verktyg-1280') });
    await page.getByRole('navigation', { name: 'Sidonavigering' }).getByRole('link', { name: 'Telefonbok' }).click();
    await page.getByRole('heading', { level: 1, name: 'Telefonbok' }).waitFor();
    await page.getByRole('list', { name: 'Telefonboken' }).waitFor();
    await page.screenshot({ path: out('tool-page-1280') });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole('table').waitFor();
    await page.screenshot({ path: out('tool-page-1440') });
    await page.getByRole('link', { name: 'Anna Lindqvist' }).click();
    await page.getByRole('dialog', { name: 'Kontaktkort' }).getByText('Rum').waitFor();
    await page.screenshot({ path: out('tool-page-card-1440') });
    await page.keyboard.press('Escape');
    await page.getByRole('navigation', { name: 'Sidonavigering' }).getByRole('link', { name: 'Mitt team' }).click();
    await page.getByRole('heading', { level: 1, name: 'Mitt team' }).waitFor();
    await page.screenshot({ path: out('tool-page-list-1440') });
    await page.setViewportSize(phone);
    await open(page, '/tools/phonebook.directory');
    await page.getByRole('list', { name: 'Telefonboken' }).waitFor();
    await page.screenshot({ path: out('tool-page-375') });
  });
  test('view under an answer', async ({ page, api: _ }) => {
    await page.setViewportSize(desktop);
    await open(page, '/');
    await composer(page).fill('telefonboken lärare');
    await composer(page).press('Enter');
    await page.getByRole('log').getByRole('listitem').first().waitFor();
    await page.screenshot({ path: out('view-embed-1280') });
  });
  test('focus after a row of the table opens its card beside the page, and after the card closes', async ({
    page,
    api: _,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, views[0][1]);
    await page.getByRole('table').getByRole('link', { name: 'Anna Lindqvist' }).click();
    await page.getByText('Rum').first().waitFor();
    const where = () =>
      page.evaluate(() => {
        const el = document.activeElement;
        return `${el?.tagName} "${(el?.getAttribute('aria-label') ?? el?.textContent ?? '').trim().slice(0, 40)}"`;
      });
    console.log('FOCUS after open:', await where());
    await page.keyboard.press('Escape');
    console.log('FOCUS after close:', await where());
  });
});
