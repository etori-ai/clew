import { open, test } from './support';
import { People } from './person-data';

/**
 * Not a test: screenshots of the opened person (D97 item 5) for the comparison with the canvas: beside Personal at
 * 1440 × 1100 (artboard C), as a page at 1440 × 900 (C2), on a phone at 390 × 844 (D), and read by a colleague (G).
 * Run on demand with `CLEW_SCREENS=1`; the images land in test-results/screens/.
 */
const out = (name: string) => `test-results/screens/${name}.png`;
test.describe('screens', () => {
  test.skip(!process.env.CLEW_SCREENS, 'screenshots are taken on demand: CLEW_SCREENS=1');
  test('person beside Personal (C)', async ({ page, api: _ }) => {
    await new People().route(page);
    await page.setViewportSize({ width: 1440, height: 1100 });
    await open(page, '/staff?show=clew.talkPeople&person=johan');
    await page.getByRole('complementary', { name: 'Johan Byström' }).getByText('Katalogen').waitFor();
    await page.screenshot({ path: out('person-panel-1440') });
  });
  test('person as a page (C2)', async ({ page, api: _ }) => {
    await new People().route(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, '/people/johan?section=directory.contact&from=%2Fstaff');
    await page.getByRole('heading', { level: 2, name: 'Kontakt' }).waitFor();
    await page.screenshot({ path: out('person-page-1440') });
    await open(page, '/people/johan?section=clew.talkPeople&from=%2Fstaff');
    await page.getByRole('heading', { level: 2, name: 'Utvecklingssamtal' }).waitFor();
    await page.screenshot({ path: out('person-page-talk-1440') });
  });
  test('person on a phone (D)', async ({ page, api: _ }) => {
    await new People().route(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, '/staff?person=johan');
    await page.getByRole('dialog', { name: 'Johan Byström' }).getByText('Katalogen').waitFor();
    await page.waitForTimeout(500);
    await page.screenshot({ path: out('person-phone-390') });
    await open(page, '/staff?person=johan&person-section=clew.talkPeople');
    await page.getByRole('dialog', { name: 'Johan Byström' }).getByText('Alla åtgärdspunkter').waitFor();
    await page.waitForTimeout(500);
    await page.screenshot({ path: out('person-phone-section-390') });
  });
  test('person read by a colleague (G)', async ({ page, api: _ }) => {
    const people = new People();
    people.colleague = true;
    await people.route(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, '/staff?person=johan');
    await page.getByRole('complementary', { name: 'Johan Byström' }).getByText('Katalogen').waitFor();
    await page.screenshot({ path: out('person-colleague-1440') });
    await open(page, '/people/johan');
    await page.getByRole('heading', { level: 2, name: 'Kontakt' }).waitFor();
    await page.screenshot({ path: out('person-colleague-page-1440') });
  });
});
