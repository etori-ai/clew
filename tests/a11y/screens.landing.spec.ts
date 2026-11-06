import { desktop, open, phone, test } from './support';

/**
 * Not a test: screenshots of Hem (D53) for the comparison with artboard A of the canvas, and with Astryx's `ai-chat-landing` template (D41). Run on demand
 * with `CLEW_SCREENS=1 … playwright test -c tests/a11y screens.landing`; the images land in test-results/screens/.
 */
const out = (name: string) => `test-results/screens/${name}.png`;
test.describe('screens', () => {
  test.skip(!process.env.CLEW_SCREENS, 'screenshots are taken on demand: CLEW_SCREENS=1');
  // 1440 is where the panel stands beside the column at rest (D53); at 1280 the day ends the page.
  for (const [size, viewport] of [['1440', { width: 1440, height: 900 }], ['1280', desktop], ['375', phone]] as const) {
    test(`landing with nothing above the box ${size}`, async ({ page, api }) => {
      api.threads = [];
      await page.setViewportSize(viewport); await open(page, '/');
      await page.screenshot({ path: out(`landing-empty-${size}`) });
    });
    test(`landing with the brief and an area chosen ${size}`, async ({ page, api: _ }) => {
      await page.setViewportSize(viewport); await open(page, '/');
      await page.screenshot({ path: out(`landing-brief-${size}`) });
      await page.getByRole('group', { name: 'Områden' }).getByRole('button', { name: 'Budget' }).click();
      await page.getByRole('group', { name: 'Budget', exact: true }).waitFor();
      await page.screenshot({ path: out(`landing-area-${size}`), fullPage: size === '375' });
    });
  }
});
