import type { Locator, Page } from '@playwright/test';
import { expect, expectNoAxeViolations, heading, open, reflowProblems, test } from './support';
import { ENTITY_UNIT } from './data';
import { BELOW_UNIT, SICK_UNIT, Units } from './unit-data';

/**
 * Dialogstöd (D117): the units the reader follows up side by side at `/units`, their own and those of the managers who
 * report to them. What needs a conversation first: "Att ta upp" counts the units by the states that need action or
 * watching, and within a group the unit with the most of them stands first. On a wide screen one row per unit and one
 * column per source with something for the group, each cell that source's row in short; on a phone a card per unit. A
 * unit's name opens its page, whose trail leads back here. `unit-data.ts` answers the list, the units and their sections:
 * the school watches its sick leave and misses a talk, the fritidshem below it needs action, Hagaskolan has nothing.
 */
const column = (scope: Locator, title: string) => scope.getByRole('columnheader', { name: new RegExp(`^${title}`) });
const tableOf = (page: Page, group: string) =>
  page.getByRole('region', { name: group, exact: true }).getByRole('table');
const rowOf = (table: Locator, unit: string) => table.getByRole('row').filter({ hasText: unit });
test.describe('Dialogstöd, the units side by side', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('what to take up on top, the units with most of it first, a column per source with something, and a name opens the unit', async ({
    page,
    api: _,
  }) => {
    const units = new Units();
    units.withBelow = true;
    await units.route(page);
    await open(page, '/units');
    await expect(heading(page, 1, 'Dialogstöd')).toBeVisible();
    // Dialogstöd is a manager's place in the rail, after Personal, marked here and on every unit's page.
    const rail = page.getByRole('navigation', { name: 'Sidonavigering' });
    const entry = rail.getByRole('link', { name: 'Dialogstöd', exact: true });
    await expect(entry).toHaveAttribute('href', '/units');
    await expect(entry).toHaveAttribute('aria-current', 'page');
    await expect(heading(page, 2, 'Mina enheter')).toBeVisible();
    await expect(heading(page, 2, 'Enheter under dig')).toBeVisible();
    // On top, per source and state, the units it holds, each a link: what needs action before what to watch.
    const attention = page.getByRole('region', { name: 'Att ta upp', exact: true });
    await expect(attention).toContainText(`Sjukfrånvaro · Åtgärd krävs – ${BELOW_UNIT.label}`);
    await expect(attention).toContainText(`Sjukfrånvaro · Bevaka – ${ENTITY_UNIT.label}`);
    await expect(attention).toContainText(`Utvecklingssamtal · 1 saknas – ${ENTITY_UNIT.label}`);
    const lines = await attention.getByText(/ · .* – /).allTextContents();
    expect(lines[0]).toContain('Åtgärd krävs');
    await expect(attention.getByRole('link', { name: BELOW_UNIT.label, exact: true })).toHaveAttribute(
      'href',
      `/units/${BELOW_UNIT.id}?from=%2Funits`,
    );
    // The dot names the level in Clew's words (D54), so a screen reader does not hear the source's word twice.
    await expect(attention.getByRole('img', { name: 'Behöver dig' })).toHaveCount(1);
    // Each heading says what the figure is and where it comes from.
    const mine = tableOf(page, 'Mina enheter');
    const below = tableOf(page, 'Enheter under dig');
    await expect(column(mine, 'Sjukfrånvaro')).toContainText('Qlik');
    await expect(column(mine, 'Utvecklingssamtal')).toContainText('Hållna · Clew');
    // Both groups have the same columns at the same places, so a figure stands under the same figure in the other
    // group; nothing folds away.
    const lefts = (table: Locator) =>
      table.getByRole('columnheader').evaluateAll(cells => cells.map(c => Math.round(c.getBoundingClientRect().x)));
    expect(await lefts(below)).toEqual(await lefts(mine));
    await expect(column(below, 'Utvecklingssamtal')).toHaveCount(1);
    await expect(page.getByRole('main').getByRole('button', { expanded: true })).toHaveCount(0);
    // The fritidshem, which needs action, before Hagaskolan, which the list gives first; each cell the figure and its state.
    await expect(below.getByRole('row').nth(1)).toContainText(BELOW_UNIT.label);
    await expect(below.getByRole('row').nth(1)).toContainText('8,1 %');
    await expect(below.getByRole('row').nth(1)).toContainText('Åtgärd krävs');
    await expect(below.getByRole('row').nth(2)).toContainText('Hagaskolan');
    await expect(mine.getByRole('row').nth(1)).toContainText('4,2 %');
    const school = mine.getByRole('link', { name: ENTITY_UNIT.label, exact: true });
    await expect(school).toHaveAttribute('href', `/units/${ENTITY_UNIT.id}?from=%2Funits`);
    await expect(below.getByRole('link', { name: BELOW_UNIT.label, exact: true })).toBeVisible();
    await expectNoAxeViolations(page);
    await school.click();
    await expect(heading(page, 1, ENTITY_UNIT.label)).toBeVisible();
    const trail = page.getByRole('navigation', { name: 'Enheter', exact: true });
    await expect(trail.getByRole('link', { name: 'Dialogstöd', exact: true })).toHaveAttribute('href', '/units');
    await expect(entry).toHaveAttribute('aria-current', 'page');
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

  test('nothing to take up is said in a line, not an empty list', async ({ page, api: _ }) => {
    await new Units().route(page);
    // Over the suite's sections: the school's sick leave within the target and every talk held.
    await page.route(
      url => url.pathname.endsWith('/section'),
      route => {
        const capability = new URL(route.request().url()).searchParams.get('capability');
        const row =
          capability === SICK_UNIT
            ? { key: ENTITY_UNIT.id, total: 2.9, watch: 'Inom målet', month: 'oktober 2026' }
            : { key: ENTITY_UNIT.id, held: '5 av 5 hållna', booked: '0 bokade' };
        return route.fulfill({ json: { capability, status: 'ok', row } });
      },
    );
    await open(page, '/units');
    await expect(page.getByRole('status').filter({ hasText: 'Inget av nyckeltalen behöver åtgärd' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Att ta upp', exact: true })).toHaveCount(0);
  });

  test('a narrow window scrolls the figures sideways and the unit’s name stays in view', async ({ page, api: _ }) => {
    const units = new Units();
    units.withBelow = true;
    await units.route(page);
    await page.setViewportSize({ width: 900, height: 900 });
    await open(page, '/units');
    const cell = rowOf(tableOf(page, 'Mina enheter'), ENTITY_UNIT.label).getByRole('cell').first();
    await expect(cell).toContainText(ENTITY_UNIT.label);
    const before = (await cell.boundingBox())!.x;
    await tableOf(page, 'Mina enheter').evaluate(table => {
      const scroller = table.closest('[role="group"]')!;
      scroller.scrollLeft = scroller.scrollWidth;
    });
    await expect.poll(async () => (await cell.boundingBox())!.x).toBe(before);
  });

  test('a source that does not answer says so in its own cells, and the rest stand', async ({ page, api: _ }) => {
    const units = new Units();
    units.silent[SICK_UNIT] = 'unavailable';
    await units.route(page);
    await open(page, '/units');
    const school = rowOf(tableOf(page, 'Mina enheter'), ENTITY_UNIT.label);
    await expect(school).toContainText('Svarade inte');
    await expect(school).toContainText('1 av 5 hållna');
    await expectNoAxeViolations(page);
  });

  test('on a phone a card per unit, the figures one under the other with their names; 1.4.10 holds at 320 px', async ({
    page,
    api: _,
  }) => {
    const units = new Units();
    units.withBelow = true;
    await units.route(page);
    await page.setViewportSize({ width: 320, height: 640 });
    await open(page, '/units');
    await expect(heading(page, 1, 'Dialogstöd')).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(0);
    const mine = page.getByRole('region', { name: 'Mina enheter', exact: true });
    await expect(mine.getByRole('link', { name: ENTITY_UNIT.label, exact: true })).toBeVisible();
    // Each figure under its source with what it measures and where it comes from, as the table's headings say.
    for (const text of ['Sjukfrånvaro · Qlik', '4,2 %', 'Bevaka', 'Utvecklingssamtal · Hållna · Clew', '1 av 5 hållna'])
      await expect(mine).toContainText(text);
    // The fritidshem's card before Hagaskolan's, its round of talks left out.
    const below = page.getByRole('region', { name: 'Enheter under dig', exact: true });
    const names = await below.getByRole('link').allTextContents();
    expect(names).toEqual([BELOW_UNIT.label, 'Hagaskolan']);
    await expect(below).not.toContainText('Utvecklingssamtal');
    expect(await reflowProblems(page)).toEqual([]);
    await expectNoAxeViolations(page);
  });
});
