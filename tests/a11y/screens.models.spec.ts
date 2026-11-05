import { composer, desktop, open, phone, test } from './support';

/**
 * Not a test: screenshots of Administration › Modeller and the composer's model menu (D24), for the comparison a canvas
 * row will need. Run on demand with `CLEW_SCREENS=1 … playwright test -c tests/a11y screens.models`; the images land in
 * test-results/screens/.
 */
const out = (name: string) => `test-results/screens/${name}.png`;
test.describe('screens', () => {
  test.skip(!process.env.CLEW_SCREENS, 'screenshots are taken on demand: CLEW_SCREENS=1');
  for (const [name, path] of [['models', '/admin/modeller'], ['model', '/admin/modeller/gpt-oss-20b'], ['provider', '/admin/modeller/leverantorer/pilot']] as const) {
    test(`${name} desktop`, async ({ page, api }) => { api.admin = true; await page.setViewportSize(desktop); await open(page, path); await page.screenshot({ path: out(`${name}-1280`), fullPage: true }); });
    test(`${name} phone`, async ({ page, api }) => { api.admin = true; await page.setViewportSize(phone); await open(page, path); await page.screenshot({ path: out(`${name}-375`), fullPage: true }); });
  }
  test('add provider dialog', async ({ page, api }) => {
    api.admin = true; await page.setViewportSize(desktop); await open(page, '/admin/modeller');
    await page.getByRole('button', { name: 'Lägg till leverantör' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('textbox', { name: /^Namn/ }).fill('Egen server');
    await dialog.getByRole('textbox', { name: /^Adress/ }).fill('http://egen.test/v1');
    await page.screenshot({ path: out('add-provider-1-1280') });
    await dialog.getByRole('button', { name: 'Testa och spara' }).click();
    await dialog.getByRole('heading', { level: 3, name: 'Modeller' }).waitFor();
    await page.screenshot({ path: out('add-provider-2-1280') });
  });
  test('model menu in the box', async ({ page, api }) => {
    api.modelChoices = 2; await page.setViewportSize(desktop); await open(page, '/');
    await composer(page).waitFor();
    await page.getByRole('button', { name: /^Modell:/ }).click();
    await page.getByRole('group', { name: 'Modell' }).waitFor();
    await page.waitForTimeout(400);
    await page.screenshot({ path: out('model-menu-1280') });
  });
});
