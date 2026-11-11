import { open, phone, test } from './support';
import { TALK_LENS } from './data';

/**
 * Not a test: screenshots of Personal (D97) for the comparison with the canvas: "Alla" (artboard A2) with its Visa menu
 * open, a lens (artboard B), a row's menu (artboard A3), at 1440 × 900 and 390 wide, and one person's cards listed beside
 * the whole list (D107 answer 6), which has no artboard. Run on demand with
 * `CLEW_SCREENS=1 … playwright test -c tests/a11y screens.staff`; the images land in test-results/screens/.
 */
const out = (name: string) => `test-results/screens/${name}.png`;
const wide = { width: 1440, height: 900 };
const narrow = { width: 390, height: 844 };
test.describe('screens', () => {
  test.skip(!process.env.CLEW_SCREENS, 'screenshots are taken on demand: CLEW_SCREENS=1');
  for (const [name, viewport] of [
    ['1440', wide],
    ['390', narrow],
  ] as const) {
    test(`personal alla ${name}`, async ({ page, api: _ }) => {
      await page.setViewportSize(viewport);
      await open(page, '/staff');
      await page.getByRole('link', { name: 'Johan Byström' }).waitFor();
      await page.screenshot({ path: out(`staff-alla-${name}`), fullPage: true });
      await page.getByRole('button', { name: /^Visa: / }).click();
      await page.getByRole('menu').waitFor();
      await page.waitForTimeout(400);
      await page.screenshot({ path: out(`staff-visa-${name}`) });
    });
    test(`personal lens ${name}`, async ({ page, api: _ }) => {
      await page.setViewportSize(viewport);
      await open(page, `/staff?show=${TALK_LENS}`);
      await page.getByRole('link', { name: 'Johan Byström' }).waitFor();
      await page.screenshot({ path: out(`staff-lens-${name}`), fullPage: true });
      await page.getByRole('button', { name: 'Åtgärder för Karin Lindqvist' }).click();
      await page.getByRole('menu').or(page.getByRole('dialog')).first().waitFor();
      await page.waitForTimeout(400);
      await page.screenshot({ path: out(`staff-row-menu-${name}`) });
    });
  }
  test('personal cards beside the list 1840', async ({ page, api: _ }) => {
    await page.setViewportSize({ width: 1840, height: 1000 });
    await open(page, `/staff?show=${TALK_LENS}&cards=johan&cards-kind=act`);
    await page.getByRole('complementary', { name: 'Johan Byström' }).getByRole('link').first().waitFor();
    await page.waitForTimeout(400);
    await page.screenshot({ path: out('staff-cards-1840'), fullPage: true });
  });
  test('personal phone 375', async ({ page, api: _ }) => {
    await page.setViewportSize(phone);
    await open(page, '/staff');
    await page.getByRole('link', { name: 'Johan Byström' }).waitFor();
    await page.screenshot({ path: out('staff-alla-375'), fullPage: true });
  });
});
