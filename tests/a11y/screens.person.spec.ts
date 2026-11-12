import { open, test } from './support';
import { People } from './person-data';

/**
 * Not a test: screenshots of the opened person (D97 item 5) for the comparison with the canvas: as a page at 1440 × 900
 * (C2), on a phone at 390 × 844 (D), and read by a colleague (G). A person is a page only (D111 rule 3), so artboard C,
 * the person beside Personal, has no screenshot. Run on demand with `CLEW_SCREENS=1`; the images land in
 * test-results/screens/.
 */
const out = (name: string) => `test-results/screens/${name}.png`;
test.describe('screens', () => {
  test.skip(!process.env.CLEW_SCREENS, 'screenshots are taken on demand: CLEW_SCREENS=1');
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
    await open(page, '/people/johan?from=%2Fstaff');
    await page.getByRole('heading', { level: 2, name: 'Behöver dig' }).waitFor();
    await page.waitForTimeout(500);
    await page.screenshot({ path: out('person-phone-390') });
    await open(page, '/people/johan?from=%2Fstaff&section=clew.talkPeople');
    await page.getByRole('link', { name: 'Öppna samtalet' }).waitFor();
    await page.waitForTimeout(500);
    await page.screenshot({ path: out('person-phone-section-390') });
  });
  test('person read by a colleague (G)', async ({ page, api: _ }) => {
    const people = new People();
    people.colleague = true;
    await people.route(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, '/people/johan');
    await page.getByRole('heading', { level: 2, name: 'Kontakt' }).waitFor();
    await page.screenshot({ path: out('person-colleague-page-1440') });
  });
});
