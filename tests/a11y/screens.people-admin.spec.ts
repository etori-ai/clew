import { open, test } from './support';

/**
 * Not a test: screenshots of Administration › Organisation and Administration › Användare for the comparison with their
 * canvas (D121; boards Main, OrgCare, OrgNoManager, OrgNobodyPlaced, OrgPhoneTree, OrgPhoneSheet, UsersAll, PhoneUsers),
 * on the suite's routed data. Run on demand with `CLEW_SCREENS=1`; the images land in test-results/screens/.
 */
const out = (name: string) => `test-results/screens/${name}.png`;
const settled = (page: import('@playwright/test').Page) =>
  page.evaluate(() => Promise.all(document.getAnimations().map(a => a.finished.catch(() => undefined))));
test.describe('screens', () => {
  test.skip(!process.env.CLEW_SCREENS, 'screenshots are taken on demand: CLEW_SCREENS=1');
  test('organisation: the tree, and a unit in the drawer', async ({ page, api }) => {
    api.admin = true;
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, '/admin/organisation');
    await page.screenshot({ path: out('organisation-tree-1440'), fullPage: true });
    for (const [unit, name] of [
      ['unit-skola', 'organisation-unit-1440'],
      ['unit-omsorg', 'organisation-unit-steps-1440'],
      ['unit-kultur', 'organisation-unit-no-manager-1440'],
      ['unit-hemtjanst', 'organisation-unit-nobody-1440'],
    ] as const) {
      await open(page, `/admin/organisation?unit=${unit}`);
      await page.getByRole('dialog').getByRole('heading', { level: 2 }).waitFor();
      await settled(page);
      await page.screenshot({ path: out(name) });
    }
  });
  test('organisation on a phone: the tree, and a unit in the sheet', async ({ page, api }) => {
    api.admin = true;
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, '/admin/organisation');
    await page.screenshot({ path: out('organisation-tree-390'), fullPage: true });
    await open(page, '/admin/organisation?unit=unit-grundskola');
    await page.getByRole('dialog').getByRole('heading', { level: 2 }).waitFor();
    await settled(page);
    await page.screenshot({ path: out('organisation-unit-390') });
  });
  test('users: the whole page, the add form with a field left empty, and a phone', async ({ page, api }) => {
    api.admin = true;
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, '/admin/users');
    await page.screenshot({ path: out('users-1440'), fullPage: true });
    await page
      .getByRole('form', { name: 'Lägg till behörighet från grupp' })
      .getByRole('button', { name: 'Lägg till' })
      .click();
    await page.getByText('Välj en grupp.').waitFor();
    await page.getByRole('form', { name: 'Lägg till behörighet från grupp' }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: out('users-add-form-1440') });
    await page.setViewportSize({ width: 1280, height: 800 });
    await open(page, '/admin/users');
    await page.screenshot({ path: out('users-1280') });
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, '/admin/users');
    await page.screenshot({ path: out('users-390'), fullPage: true });
  });
});
