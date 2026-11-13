import { expect, expectNoAxeViolations, heading, open, reflowProblems, test } from './support';
import { ENTITY_UNIT } from './data';
import { BELOW_UNIT, Units } from './unit-data';

/**
 * Dialogstöd (D117): the units the reader follows up side by side at `/units`, their own and those of the managers who
 * report to them, one row per unit and one column per source about a unit, each cell that source's row in short. A
 * unit's name opens its page, whose trail leads back here. `unit-data.ts` answers the list, the units and their sections.
 */
test.describe('Dialogstöd, the units side by side', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('the reader’s units and those below, every source in short, and a name opens the unit with Dialogstöd in its trail', async ({
    page,
    api: _,
  }) => {
    const units = new Units();
    units.withBelow = true;
    await units.route(page);
    await open(page, '/units');
    await expect(heading(page, 1, 'Dialogstöd')).toBeVisible();
    await expect(heading(page, 2, 'Mina enheter')).toBeVisible();
    await expect(heading(page, 2, 'Enheter under dig')).toBeVisible();
    // One column per source about a unit, in each group's table.
    for (const title of ['Sjukfrånvaro', 'Utvecklingssamtal'])
      await expect(page.getByRole('columnheader', { name: title, exact: true })).toHaveCount(2);
    const school = page.getByRole('link', { name: ENTITY_UNIT.label, exact: true });
    await expect(school).toHaveAttribute('href', `/units/${ENTITY_UNIT.id}?from=%2Funits`);
    await expect(page.getByRole('link', { name: BELOW_UNIT.label, exact: true })).toBeVisible();
    await expectNoAxeViolations(page);
    await school.click();
    await expect(heading(page, 1, ENTITY_UNIT.label)).toBeVisible();
    const trail = page.getByRole('navigation', { name: 'Enheter', exact: true });
    await expect(trail.getByRole('link', { name: 'Dialogstöd', exact: true })).toHaveAttribute('href', '/units');
  });

  test('a reader who follows up no unit is told so, not shown an empty table', async ({ page, api: _ }) => {
    await page.route(
      url => url.pathname === '/api/entities/unit',
      route =>
        route.fulfill({ json: { kind: 'unit', groups: [], lenses: [], columns: [], actions: [], attention: [] } }),
    );
    await open(page, '/units');
    await expect(heading(page, 2, 'Du följer inte upp någon enhet')).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(0);
    await expectNoAxeViolations(page);
  });

  test('1.4.10: at 320 px the page reflows and the table scrolls within itself', async ({ page, api: _ }) => {
    await new Units().route(page);
    await page.setViewportSize({ width: 320, height: 640 });
    await open(page, '/units');
    await expect(heading(page, 1, 'Dialogstöd')).toBeVisible();
    await expect(page.getByRole('link', { name: ENTITY_UNIT.label, exact: true })).toBeVisible();
    expect(await reflowProblems(page, undefined, { table: page.getByRole('table').first() })).toEqual([]);
  });
});
