import { composer, desktop, open, phone, test } from './support';
import { menuRows } from './telefonbok';

/**
 * Not a test: screenshots of the phone book's declared views (D38) in the side panel, under an answer and as a tool's
 * page (D42), for the
 * comparison a canvas row will need. Run on demand with `CLEW_SCREENS=1 … playwright test -c tests/a11y screens.views`;
 * the images land in test-results/screens/.
 */
const out = (name: string) => `test-results/screens/${name}.png`;
const title = (text: string) => encodeURIComponent(text);
const views = [
  ['view-table', `/?open=telefonbok.directory&open-title=${title('Sök i telefonboken')}`],
  ['view-list', `/?open=telefonbok.team&open-title=${title('Mitt teams kontaktlista')}`],
  [
    'view-detail',
    `/?open=telefonbok.person&open-title=Kontaktkort&via=1&open-input=${encodeURIComponent(JSON.stringify({ ref: 'person:p1002' }))}`,
  ],
  [
    'view-person-hit',
    `/?open=clew.search&open-title=${title('Källor')}&open-input=${encodeURIComponent(JSON.stringify({ query: 'Anna Lindqvist' }))}`,
  ],
] as const;
test.describe('screens', () => {
  test.skip(!process.env.CLEW_SCREENS, 'screenshots are taken on demand: CLEW_SCREENS=1');
  for (const [name, path] of views) {
    test(`${name} desktop`, async ({ page, api: _ }) => {
      await page.setViewportSize(desktop);
      await open(page, path);
      await page.getByRole('dialog').waitFor();
      await page.screenshot({ path: out(`${name}-1280`) });
    });
    test(`${name} phone`, async ({ page, api: _ }) => {
      await page.setViewportSize(phone);
      await open(page, path);
      await page.getByRole('dialog').waitFor();
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
    await open(page, '/tools/telefonbok.directory');
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
  test('focus after a row opens its card', async ({ page, api: _ }) => {
    await page.setViewportSize(desktop);
    await open(page, views[0][1]);
    await page.getByRole('dialog').getByRole('link', { name: 'Anna Lindqvist' }).click();
    await page.getByRole('dialog', { name: 'Kontaktkort' }).getByText('Rum').waitFor();
    console.log(
      'FOCUS after open:',
      await page.evaluate(() => {
        const el = document.activeElement;
        return `${el?.tagName} "${(el?.getAttribute('aria-label') ?? el?.textContent ?? '').trim().slice(0, 40)}" inDialog=${!!el?.closest('dialog')}`;
      }),
    );
    await page.getByRole('button', { name: 'Tillbaka' }).click();
    await page.getByRole('dialog').getByRole('table').waitFor();
    console.log(
      'FOCUS after back:',
      await page.evaluate(() => {
        const el = document.activeElement;
        return `${el?.tagName} "${(el?.getAttribute('aria-label') ?? el?.textContent ?? '').trim().slice(0, 40)}" inDialog=${!!el?.closest('dialog')}`;
      }),
    );
  });
});
