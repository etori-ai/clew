import { heading, open, test } from './support';
import { appraisals, appraisalsWithoutKey } from './protocol-preview-data';

/**
 * Not a test: screenshots of the manifest preview (D60, D97) for the comparison with the canvas: artboard J at
 * 1440 × 900, the manifest of artboard I loaded and the variant without `key` refused. Run on demand with
 * `CLEW_SCREENS=1`; the images land in test-results/screens/.
 */
const out = (name: string) => `test-results/screens/${name}.png`;
test.describe('screens', () => {
  test.skip(!process.env.CLEW_SCREENS, 'screenshots are taken on demand: CLEW_SCREENS=1');
  test('manifest preview (J)', async ({ page, api: _ }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, '/protocol/preview');
    const field = page.getByRole('textbox', { name: 'Manifest', exact: true });
    await field.fill(JSON.stringify(appraisals, null, 2));
    await page.getByRole('button', { name: 'Run the dry run' }).click();
    await page.getByRole('region', { name: 'Who would see it' }).waitFor();
    await page.screenshot({ path: out('protocol-preview-1440'), fullPage: true });
    await page.getByRole('region', { name: 'What Clew would do with it' }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: out('protocol-preview-result-1440') });
    await field.fill(JSON.stringify(appraisalsWithoutKey, null, 2));
    await page.getByRole('button', { name: 'Run the dry run' }).click();
    await heading(page, 2, '1 problem, the manifest would be refused').waitFor();
    await page.screenshot({ path: out('protocol-preview-refused-1440'), fullPage: true });
    await page.getByRole('link', { name: /^Manifest reference: / }).click();
    await page.locator('#rule-about-read-rows').waitFor();
    await page.screenshot({ path: out('protocol-reference-rule-1440') });
  });
});
