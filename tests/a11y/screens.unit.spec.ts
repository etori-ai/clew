import { open, test } from './support';
import { ENTITY_UNIT } from './data';
import { Units } from './unit-data';

/**
 * Not a test: screenshots of the unit as a page (D97, artboard E) for the comparison with the canvas, at 1440 × 900 and
 * at 390 wide. Run on demand with `CLEW_SCREENS=1`; the images land in test-results/screens/.
 */
const out = (name: string) => `test-results/screens/${name}.png`;
test.describe('screens', () => {
  test.skip(!process.env.CLEW_SCREENS, 'screenshots are taken on demand: CLEW_SCREENS=1');
  test('unit as a page (E)', async ({ page, api: _ }) => {
    await new Units().route(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, `/units/${ENTITY_UNIT.id}`);
    await page.getByText('september 2026').waitFor();
    await page.screenshot({ path: out('unit-page-1440') });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByText('september 2026').waitFor();
    await page.waitForTimeout(300);
    await page.screenshot({ path: out('unit-page-390'), fullPage: true });
  });
});
