import type { Page } from '@playwright/test';
import { organisationPeople } from './data';
import {
  announcements,
  desktop,
  expect,
  expectNoAxeViolations,
  hiddenFocusStops,
  narrow,
  open,
  phone,
  reflowProblems,
  test,
} from './support';

/**
 * Organisation (D99, D124): the organisation tree as the catalogue pushed it, a ledger on a wide screen, with who leads
 * each unit, how many are placed on it and in its branch, what a push left wrong as one card, and a unit as an overlay
 * over the tree that is walked one step up and one step down. Keyboard, structure, focus, announcements, axe and
 * reflow, at desktop, phone and 320 px.
 */
/**
 * 2.5.3 Label in Name on the tree (D99 item 6). axe's rule for it, `label-content-name-mismatch`, is experimental and
 * reads everything inside a `treeitem` as that row's visible label: the rows nested under it and the name of its
 * expander. A tree nests its rows, so the rule fails every row that has rows under it whatever the row is named. It is
 * left out on this page and the criterion is checked here in its place, on each row by itself: the row's accessible
 * name is exactly the text a person sees on the row, the unit's name, who leads it, how many it holds and its marks,
 * with the commas only a screen reader is given between them.
 */
const TREE_LABEL_RULE = ['label-content-name-mismatch'];
async function expectRowsNamedByWhatTheyShow(page: Page) {
  const rows = page.getByRole('tree', { name: 'Organisationsträd' }).getByRole('treeitem');
  const count = await rows.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    const row = rows.nth(i),
      shown = await row.evaluate(el =>
        (document.getElementById(el.getAttribute('aria-labelledby') ?? '')?.innerText ?? '')
          .replace(/\s+/g, ' ')
          .trim(),
      );
    expect(shown).not.toBe('');
    await expect(row).toHaveAccessibleName(shown);
  }
}
test.describe('organisation', () => {
  for (const [layout, viewport] of [
    ['desktop', desktop],
    ['phone', phone],
  ] as const)
    test.describe(layout, () => {
      test.use({ viewport });
      test('the page and a unit opened over it have no axe violations and every focus stop is marked', async ({
        page,
        api,
      }) => {
        api.admin = true;
        await open(page, '/admin/organisation');
        await expect(page.getByRole('heading', { level: 1, name: 'Organisation' })).toBeVisible();
        await expect(page.getByRole('tree', { name: 'Organisationsträd' })).toBeVisible();
        await expectNoAxeViolations(page, { without: TREE_LABEL_RULE });
        await expectRowsNamedByWhatTheyShow(page);
        expect((await hiddenFocusStops(page)).unmarked).toEqual([]);
        await open(page, '/admin/organisation?unit=unit-skola');
        const people = page.getByRole('dialog', { name: 'Personer på Bergsåkers skola' });
        await expect(people.getByText('Anna Lindqvist')).toBeVisible();
        await expectNoAxeViolations(page, { without: TREE_LABEL_RULE });
        await expectRowsNamedByWhatTheyShow(page);
      });
    });
  test.describe('desktop', () => {
    test.use({ viewport: desktop });
    test('the tree says how the units hang together, who leads each and how many it holds', async ({ page, api }) => {
      api.admin = true;
      await open(page, '/admin/organisation');
      await expect(page).toHaveTitle('Organisation · Startsidan');
      await expect(page.getByRole('link', { name: 'Organisation', exact: true })).toHaveAttribute(
        'aria-current',
        'page',
      );
      const tree = page.getByRole('tree', { name: 'Organisationsträd' });
      // The roots are open from the start, so the level under each is read without a click; deeper levels are not.
      const kommunen = tree.getByRole('treeitem', { name: /Kommunen/ }).first();
      await expect(kommunen).toHaveAttribute('aria-expanded', 'true');
      // The row reads as a sentence: the name, who leads the unit, its own count and its branch's.
      await expect(kommunen).toHaveAccessibleName(
        'Kommunen , Chef: Yusuf Lundgren , 1 person , 15 med enheterna under',
      );
      const utbildning = tree.getByRole('treeitem', { name: /Barn och utbildning/ }).first();
      await expect(utbildning).toBeVisible();
      await expect(utbildning).toHaveAttribute('aria-expanded', 'false');
      await expect(tree.getByText('Grundskola', { exact: true })).toHaveCount(0);
      await expect(page.getByRole('status').filter({ hasText: 'enheter' })).toHaveText('11 enheter');
      // The tree is a part of the page with a heading of its own, the count on the heading's line.
      await expect(page.getByRole('region', { name: 'Enheter' }).getByRole('tree')).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Enheter', exact: true })).toHaveAttribute('aria-level', '2');
    });
    test('the tree is a ledger: each unit’s count and its branch’s stand in one column at the row’s end, on every level', async ({
      page,
      api,
    }) => {
      api.admin = true;
      await open(page, '/admin/organisation?unit=unit-skola');
      await page.keyboard.press('Escape');
      const tree = page.getByRole('tree', { name: 'Organisationsträd' });
      // Four levels are open: Kommunen, Barn och utbildning, Grundskola and Bergsåkers skola.
      const edges: number[] = [];
      for (const [name, own, branch] of [
        [/^Kommunen/, '1 person', '15 med enheterna under'],
        [/^Barn och utbildning/, '2 personer', '9 med enheterna under'],
        [/^Grundskola/, '1 person', '7 med enheterna under'],
        [/^Bergsåkers skola/, '3 personer', null],
        [/^Hagaskolan/, '3 personer', null],
      ] as const) {
        const row = tree.getByRole('treeitem', { name }).first();
        // The count's own words, after the comma only a screen reader is given.
        const count = row.getByText(new RegExp(`${own}$`)).first();
        await expect(count).toBeVisible();
        const box = (await count.boundingBox())!;
        edges.push(Math.round(box.x + box.width));
        if (branch) {
          const under = (await row
            .getByText(new RegExp(`${branch}$`))
            .first()
            .boundingBox())!;
          // The branch stands under the unit's own count, ending where it ends.
          expect(Math.round(under.x + under.width)).toBe(Math.round(box.x + box.width));
          expect(under.y).toBeGreaterThan(box.y);
        }
        // The line under the name says who leads the unit, and no count.
        await expect(row.getByText(/(Chef|Chefer): |Leds från|Ingen chef$/).first()).not.toContainText('person');
      }
      expect(new Set(edges).size).toBe(1);
      // A unit nobody leads says so where the leader stands, and the mark is beside the name.
      const kultur = tree.getByRole('treeitem', { name: /Kultur och fritid/ }).first();
      await expect(kultur).toHaveAccessibleName('Kultur och fritid Saknar chef , Ingen chef , 2 personer');
    });
    test('what a push left wrong is one card above the tree, a row per problem, and is marked on the unit', async ({
      page,
      api,
    }) => {
      api.admin = true;
      await open(page, '/admin/organisation');
      const card = page.getByRole('region', { name: 'Att rätta i katalogen' });
      await expect(card.getByRole('heading', { name: 'Att rätta i katalogen' })).toHaveAttribute('aria-level', '2');
      const rows = card.getByRole('list', { name: 'Att rätta i katalogen' }).getByRole('listitem');
      // One row per problem, the state's mark first: colour never says it alone.
      await expect(rows).toHaveText([
        /^Ingen åtkomst\s*2 personer saknar enhet/,
        /^Saknar chef\s*1 enhet har personer men ingen chef: Kultur och fritid/,
        /^Saknar enhetsgrupp\s*1 enhet saknar enhetsgrupp: unit-okand/,
      ]);
      // One card, where three warnings stood one over the other.
      await expect(page.locator('.astryx-banner')).toHaveCount(0);
      // The link lands on the people it is about: the list narrowed to those without access (D100).
      await expect(card.getByRole('link', { name: 'Till Användare' })).toHaveAttribute(
        'href',
        '/admin/users?status=no-access',
      );
      const tree = page.getByRole('tree', { name: 'Organisationsträd' });
      const kultur = tree.getByRole('treeitem', { name: /Kultur och fritid/ }).first();
      await expect(kultur).toContainText('Ingen chef');
      await expect(kultur).toContainText('2 personer');
      await expect(kultur).toContainText('Saknar chef');
      // A unit under a unit nobody leads, with nobody on it and nothing under it.
      await expect(tree.getByRole('treeitem', { name: /Arkivet/ })).toContainText('Tom');
      await expect(tree.getByRole('treeitem', { name: /unit-okand/ })).toContainText('Saknar enhetsgrupp');
      // An area nobody is placed on is a heading, not an emptied unit, and its unit is led from above.
      await kommunenOpen(page, 'Vård och omsorg');
      const hemtjanst = tree.getByRole('treeitem', { name: /^Hemtjänst(?! Centrum)/ }).first();
      await expect(hemtjanst).toHaveAccessibleName(
        'Hemtjänst , Leds från enheten ovanför , 0 personer , 4 med enheterna under',
      );
      await expect(hemtjanst).not.toContainText('Tom');
    });
    test('a unit named in the problems card opens over the tree, says what is wrong with it, and closes back to its link', async ({
      page,
      api,
    }) => {
      api.admin = true;
      await open(page, '/admin/organisation');
      const link = page
        .getByRole('region', { name: 'Att rätta i katalogen' })
        .getByRole('link', { name: 'Kultur och fritid' });
      await link.focus();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(/\/admin\/organisation\?unit=unit-kultur$/);
      const people = page.getByRole('dialog', { name: 'Personer på Kultur och fritid' });
      // The overlay opens with the focus on the unit's heading.
      await expect(people.getByRole('heading', { level: 2, name: 'Kultur och fritid' })).toBeFocused();
      await expect(people.getByText('Varken enheten eller någon enhet ovanför har en chef')).toBeVisible();
      // The unit under it is a step down; it is empty, and says so.
      const under = people.getByRole('list', { name: 'Enheter under · Kultur och fritid' }).getByRole('listitem');
      await expect(under).toHaveText([/Arkivet\s*Tom\s*Ingen chef\s·\s0 personer/]);
      await expectNoAxeViolations(page, { without: TREE_LABEL_RULE });
      // No step was taken, so closing gives the focus back to what opened the overlay (rule 7).
      await page.keyboard.press('Escape');
      await expect(people).toBeHidden();
      await expect(link).toBeFocused();
    });
    test('the tree is walked and a unit opened by keyboard, and closing gives the focus back to its row', async ({
      page,
      api,
    }) => {
      api.admin = true;
      await open(page, '/admin/organisation');
      const tree = page.getByRole('tree', { name: 'Organisationsträd' });
      const row = (name: RegExp) => tree.getByRole('treeitem', { name }).first();
      await row(/Kommunen/).focus();
      await page.keyboard.press('ArrowDown');
      await expect(row(/Barn och utbildning/)).toBeFocused();
      await page.keyboard.press('ArrowRight');
      await expect(row(/Barn och utbildning/)).toHaveAttribute('aria-expanded', 'true');
      await page.keyboard.press('ArrowDown');
      await expect(row(/Grundskola/)).toBeFocused();
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowDown');
      await expect(row(/Bergsåkers skola/)).toBeFocused();
      await expect(row(/Bergsåkers skola/)).toHaveAccessibleName(
        'Bergsåkers skola , Chefer: Hillevi Berg och Karin Åberg , 3 personer',
      );
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(/\/admin\/organisation\?unit=unit-skola$/);
      const people = page.getByRole('dialog', { name: 'Personer på Bergsåkers skola' });
      await expect(people.getByRole('heading', { name: 'Bergsåkers skola' })).toBeVisible();
      // Where the unit is: the units above it, outermost first.
      await expect(people.getByText('Kommunen › Barn och utbildning › Grundskola')).toBeVisible();
      await expect(people.getByRole('status').filter({ hasText: 'personer' })).toHaveText(
        '3 personer på enheten och 1 avstängd',
      );
      // The step up stands first, then the status line, then who leads the unit and last the others placed on it;
      // nobody reports from below and no unit is under it.
      const up = people.getByRole('button', { name: 'Ingår i Grundskola, Chef: Mattias Eriksson' });
      await expect(up).toBeVisible();
      await expect(people.getByRole('heading', { level: 3 })).toHaveText(['Chefer', 'Medarbetare']);
      const leaders = people.getByRole('list', { name: 'Chefer · Bergsåkers skola' }).getByRole('listitem');
      await expect(leaders).toHaveCount(2);
      // A leader's row: the avatar at 48 px, the name and the e-mail under it. No row shows a user name.
      await expect(leaders.first()).toHaveText(/Hillevi Berg\s*hillevi@clew\.test$/);
      expect(await leaders.first().locator('.astryx-avatar').boundingBox()).toMatchObject({ width: 48, height: 48 });
      // The avatar beside a name is decoration, as in the tree: the name is said once, by its link.
      await expect(leaders.first().locator('.astryx-avatar')).toHaveAttribute('aria-hidden', 'true');
      await expect(people.getByRole('img')).toHaveCount(0);
      const others = people.getByRole('list', { name: 'Medarbetare · Bergsåkers skola' }).getByRole('listitem');
      await expect(others).toHaveCount(2);
      // The others are one line each: the avatar at 24 px, the name, and "Avstängd" at the end where it applies.
      await expect(others).toHaveText(['Anna Lindqvist', /^Vera Öst\s*Avstängd$/]);
      expect(await others.first().locator('.astryx-avatar').boundingBox()).toMatchObject({ width: 24, height: 24 });
      await expect(people).not.toContainText('anna.lindqvist');
      await expect(people).not.toContainText('karin.aberg');
      // Each group's count ends its heading's line, for the eye only: the list says how many rows it has.
      const counts = people.locator('section').filter({ has: page.getByRole('heading', { name: 'Chefer' }) });
      await expect(counts.getByText('2', { exact: true })).toHaveAttribute('aria-hidden', 'true');
      // In the order it is read and tabbed: the step up, the status, the leaders, the others.
      const order = await people.evaluate(el => {
        const stops = [...el.querySelectorAll('[aria-label^="Ingår i"], [role="status"], h3')];
        const at = (find: string) =>
          stops.findIndex(n => `${n.getAttribute('aria-label') ?? ''} ${n.textContent ?? ''}`.includes(find));
        return [at('Ingår i'), at('på enheten'), at('Chefer'), at('Medarbetare')];
      });
      expect(order).toEqual([...order].sort((a, b) => a - b));
      expect(order).not.toContain(-1);
      await expect(row(/Bergsåkers skola/)).toHaveAttribute('aria-selected', 'true');
      await page.keyboard.press('Escape');
      await expect(people).toBeHidden();
      await expect(page).toHaveURL(/\/admin\/organisation$/);
      // The tree kept what was opened in it, and the row that opened the overlay has the focus again.
      await expect(row(/Bergsåkers skola/)).toBeFocused();
    });
    test('more than one deactivated person on a unit is counted in the plural', async ({ page, api }) => {
      api.admin = true;
      // The unit's people as the fixture has them, and one more who is deactivated.
      await page.route('**/api/admin/organisation/units/unit-skola', route =>
        route.fulfill({
          json: {
            unitId: 'unit-skola',
            unitLabel: 'Bergsåkers skola',
            people: [
              ...organisationPeople['unit-skola']!,
              { id: 'ture', name: 'Ture Väst', userName: 'ture.vast', email: null, role: 'employee', enabled: false },
            ],
            reports: [],
          },
        }),
      );
      await open(page, '/admin/organisation?unit=unit-skola');
      const people = page.getByRole('dialog', { name: 'Personer på Bergsåkers skola' });
      await expect(people.getByRole('status').filter({ hasText: 'personer' })).toHaveText(
        '3 personer på enheten och 2 avstängda',
      );
    });
    test('an address that names a unit opens it over the tree with the units above it open, and a unit with nobody on it says so', async ({
      page,
      api,
    }) => {
      api.admin = true;
      await open(page, '/admin/organisation?unit=unit-hemtjanst');
      const people = page.getByRole('dialog', { name: 'Personer på Hemtjänst' });
      await expect(people.getByRole('heading', { name: 'Ingen är placerad på enheten' })).toBeVisible();
      await expect(people.getByText('Kommunen › Vård och omsorg')).toBeVisible();
      await people.getByRole('button', { name: /Stäng/ }).click();
      await expect(people).toBeHidden();
      await expect(page).toHaveURL(/\/admin\/organisation$/);
      const tree = page.getByRole('tree', { name: 'Organisationsträd' });
      await expect(tree.getByRole('treeitem', { name: /Vård och omsorg/ }).first()).toHaveAttribute(
        'aria-expanded',
        'true',
      );
      // Nothing opened the overlay after a load, so the tree takes the focus rather than the page's body.
      await expect(
        tree
          .getByRole('treeitem')
          .filter({ has: page.locator(':focus') })
          .or(tree.locator(':focus')),
      ).not.toHaveCount(0);
      // A unit the server does not know is answered in its words, not with an empty overlay, under a name that claims
      // nothing, and without a retry, which cannot help (W7).
      await open(page, '/admin/organisation?unit=finns-inte');
      const gone = page.getByRole('dialog', { name: 'Personer på enheten' });
      await expect(gone).toContainText('Enheten finns inte.');
      await expect(gone.getByRole('heading', { name: 'Enheten', exact: true })).toBeVisible();
      await expect(gone.getByRole('button', { name: 'Försök igen' })).toHaveCount(0);
      await expectNoAxeViolations(page, { without: TREE_LABEL_RULE });
    });
    test('a unit that could not be read for another reason is not said to be gone, and is asked for again (W7)', async ({
      page,
      api,
    }) => {
      api.admin = true;
      api.organisationFails = true;
      await open(page, '/admin/organisation?unit=unit-skola');
      // Neither the tree nor the unit's own read names it, so the overlay is named for a unit, and says what failed.
      const people = page.getByRole('dialog', { name: 'Personer på enheten' });
      await expect(people).toContainText('Något gick fel. Försök igen.');
      await expect(people.getByRole('heading', { name: 'Enheten', exact: true })).toBeVisible();
      await expect(people).not.toContainText('finns inte');
      await expectNoAxeViolations(page, { without: TREE_LABEL_RULE });
      api.organisationFails = false;
      await people.getByRole('button', { name: 'Försök igen' }).click();
      const named = page.getByRole('dialog', { name: 'Personer på Bergsåkers skola' });
      await expect(named.getByText('Anna Lindqvist')).toBeVisible();
      await expect(named.getByRole('heading', { name: 'Bergsåkers skola' })).toBeVisible();
    });
    test('a unit says who reports to its manager from the units below, each with the unit they lead as the step down', async ({
      page,
      api,
    }) => {
      api.admin = true;
      await open(page, '/admin/organisation?unit=unit-grundskola');
      const people = page.getByRole('dialog', { name: 'Personer på Grundskola' });
      // One manager and nobody else placed here: a group for the manager, then the reports. Both units below are the
      // step down on a reporting row, so no "Enheter under" repeats them.
      await expect(people.getByRole('heading', { level: 3 })).toHaveText(['Chef', 'Rapporterar till Mattias Eriksson']);
      await expect(people.getByRole('list', { name: 'Chef · Grundskola' }).getByRole('listitem')).toHaveText([
        /Mattias Eriksson\s*mattias\.eriksson@clew\.test/,
      ]);
      const reports = people
        .getByRole('list', { name: 'Rapporterar till Mattias Eriksson · Grundskola' })
        .getByRole('listitem');
      await expect(reports).toHaveCount(3);
      // The managers of the nearest led unit, each named by the unit they lead, and a person on a unit nobody leads.
      await expect(reports.nth(0)).toContainText('Chef för Bergsåkers skola · hillevi@clew.test');
      // A reporting row is two lines, with the avatar at 36 px.
      expect(await reports.nth(0).locator('.astryx-avatar').boundingBox()).toMatchObject({ width: 36, height: 36 });
      await expect(reports.nth(1)).toHaveText(/Karin Åberg\s*Chef för Bergsåkers skola$/);
      await expect(reports.nth(2)).toContainText('Medarbetare på Hagaskolan · omar.hosseini@clew.test');
      // The unit on the row is the step down.
      await expect(reports.nth(0).getByRole('link', { name: 'Bergsåkers skola' })).toHaveAttribute(
        'href',
        '/admin/organisation?unit=unit-skola',
      );
      await expect(reports.nth(2).getByRole('link', { name: 'Hagaskolan' })).toBeVisible();
      await expect(people.getByText('Från enheterna under')).toBeVisible();
      await expectNoAxeViolations(page, { without: TREE_LABEL_RULE });
    });
    test('a unit lists the units below that no reporting row names, after the reports and before the others', async ({
      page,
      api,
    }) => {
      api.admin = true;
      await open(page, '/admin/organisation?unit=unit-omsorg');
      const people = page.getByRole('dialog', { name: 'Personer på Vård och omsorg' });
      // Hemtjänst has no manager of its own, so the manager two levels down reports here, with their own unit as the
      // step; Hemtjänst itself is the unit under.
      await expect(people.getByRole('heading', { level: 3 })).toHaveText([
        'Chef',
        'Rapporterar till Amir Sjöberg',
        'Enheter under',
      ]);
      const under = people.getByRole('list', { name: 'Enheter under · Vård och omsorg' }).getByRole('listitem');
      await expect(under).toHaveText([/Hemtjänst\s*Leds från enheten ovanför\s·\s0 personer, 4 med enheterna under/]);
      // A unit nobody is placed on says so, says where its people's line goes, and still offers its steps.
      await under.getByRole('button').click();
      const hemtjanst = page.getByRole('dialog', { name: 'Personer på Hemtjänst' });
      await expect(hemtjanst.getByRole('heading', { name: 'Ingen är placerad på enheten' })).toBeVisible();
      await expect(hemtjanst.getByText('Enheten har ingen egen chef. Den leds från enheten ovanför.')).toBeVisible();
      await expect(hemtjanst.getByRole('button', { name: /^Ingår i Vård och omsorg/ })).toBeVisible();
      await expect(hemtjanst.getByRole('list', { name: 'Enheter under · Hemtjänst' }).getByRole('listitem')).toHaveText(
        [/Hemtjänst Centrum\s*Chef: Sara Pettersson\s·\s4 personer/],
      );
      await expectNoAxeViolations(page, { without: TREE_LABEL_RULE });
    });
    test('a unit is walked one step up and one step down by keyboard: the address is replaced, the heading takes the focus and the unit is said', async ({
      page,
      api,
    }) => {
      api.admin = true;
      await open(page, '/admin/organisation');
      const tree = page.getByRole('tree', { name: 'Organisationsträd' });
      const row = (name: RegExp) => tree.getByRole('treeitem', { name }).first();
      // Opened from the tree's first row, far from where the walk ends.
      await row(/^Kommunen/).focus();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(/\?unit=unit-kommun$/);
      const dialog = (unit: string) => page.getByRole('dialog', { name: `Personer på ${unit}` });
      await expect(dialog('Kommunen').getByRole('heading', { level: 2, name: 'Kommunen' })).toBeFocused();
      const entries = await page.evaluate(() => history.length);
      // A step down: the first unit under Kommunen.
      await page.keyboard.press('Tab');
      await expect(dialog('Kommunen').getByRole('button', { name: 'Stäng' })).toBeFocused();
      await page.keyboard.press('Tab');
      const first = dialog('Kommunen')
        .getByRole('list', { name: 'Enheter under · Kommunen' })
        .getByRole('button')
        .first();
      await expect(first).toBeFocused();
      await expect(first).toHaveAccessibleName(/^Barn och utbildning/);
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(/\?unit=unit-utbildning$/);
      // The same overlay shows the unit, its heading has the focus, and the step is said aloud.
      await expect(dialog('Barn och utbildning').getByRole('heading', { level: 2 })).toHaveText('Barn och utbildning');
      await expect(dialog('Barn och utbildning').getByRole('heading', { level: 2 })).toBeFocused();
      await expect.poll(() => announcements(page)).toContainEqual(expect.stringContaining('Visar Barn och utbildning'));
      // The row of the unit shown is the selected one, and the tree behind is open down to it.
      await expect(row(/^Barn och utbildning/)).toHaveAttribute('aria-selected', 'true');
      // Another step down, then one up through "Ingår i …", the first stop after the close button.
      await dialog('Barn och utbildning')
        .getByRole('list', { name: 'Enheter under · Barn och utbildning' })
        .getByRole('button', { name: /^Grundskola/ })
        .press('Enter');
      await expect(page).toHaveURL(/\?unit=unit-grundskola$/);
      await expect(dialog('Grundskola').getByRole('heading', { level: 2 })).toBeFocused();
      await expect.poll(() => announcements(page)).toContainEqual(expect.stringContaining('Visar Grundskola'));
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      await expect(dialog('Grundskola').getByRole('button', { name: /^Ingår i Barn och utbildning/ })).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(/\?unit=unit-utbildning$/);
      await expect(dialog('Barn och utbildning').getByRole('heading', { level: 2 })).toBeFocused();
      await dialog('Barn och utbildning')
        .getByRole('list', { name: 'Enheter under · Barn och utbildning' })
        .getByRole('button', { name: /^Grundskola/ })
        .press('Enter');
      await expect(dialog('Grundskola').getByRole('heading', { level: 2 })).toBeFocused();
      // And down again through the unit a reporting row names.
      await dialog('Grundskola').getByRole('link', { name: 'Hagaskolan' }).press('Enter');
      await expect(page).toHaveURL(/\?unit=unit-hagaskolan$/);
      await expect(dialog('Hagaskolan').getByRole('heading', { level: 2 })).toBeFocused();
      await expect.poll(() => announcements(page)).toContainEqual(expect.stringContaining('Visar Hagaskolan'));
      // No step added an entry to the history, so Back still closes the overlay.
      expect(await page.evaluate(() => history.length)).toBe(entries);
      // After a walk, closing gives the focus to the row of the unit shown, not to the row that opened the overlay,
      // and the tree is open down to it (D124 item 3).
      await page.keyboard.press('Escape');
      await expect(dialog('Hagaskolan')).toBeHidden();
      await expect(page).toHaveURL(/\/admin\/organisation$/);
      await expect(row(/^Hagaskolan/)).toBeFocused();
      await expect(row(/^Grundskola/)).toHaveAttribute('aria-expanded', 'true');
      expect((await hiddenFocusStops(page)).unmarked).toEqual([]);
    });
    test('Back closes an overlay that was walked, and a branch the person folded is opened again for the unit they stand on', async ({
      page,
      api,
    }) => {
      api.admin = true;
      await open(page, '/admin/organisation');
      const tree = page.getByRole('tree', { name: 'Organisationsträd' });
      const row = (name: RegExp) => tree.getByRole('treeitem', { name }).first();
      // The person opens a branch and folds it again: that choice is the tree's own.
      await kommunenOpen(page, 'Barn och utbildning');
      await page.keyboard.press('ArrowLeft');
      await expect(row(/^Barn och utbildning/)).toHaveAttribute('aria-expanded', 'false');
      await row(/^Kommunen/).focus();
      await page.keyboard.press('Enter');
      const dialog = (unit: string) => page.getByRole('dialog', { name: `Personer på ${unit}` });
      await dialog('Kommunen')
        .getByRole('button', { name: /^Barn och utbildning/ })
        .click();
      await dialog('Barn och utbildning')
        .getByRole('button', { name: /^Grundskola/ })
        .click();
      await expect(dialog('Grundskola').getByRole('heading', { level: 2 })).toBeFocused();
      await dialog('Grundskola').getByRole('button', { name: 'Stäng' }).click();
      await expect(dialog('Grundskola')).toBeHidden();
      // The row is inside the branch that was folded by hand: the tree is open down to it, and it has the focus.
      await expect(row(/^Grundskola/)).toBeFocused();
      await expect(row(/^Barn och utbildning/)).toHaveAttribute('aria-expanded', 'true');
      // Open, walk, and go Back: one step in the history closes the overlay, however many steps were taken in it.
      await page.keyboard.press('Enter');
      // A press anywhere on the step up takes it, as a card's surface does.
      await dialog('Grundskola').getByText('Ingår i Barn och utbildning').click();
      await expect(page).toHaveURL(/\?unit=unit-utbildning$/);
      await page.goBack();
      await expect(page).toHaveURL(/\/admin\/organisation$/);
      await expect(dialog('Barn och utbildning')).toBeHidden();
    });
    test('an organisation nobody has pushed says so, and without admin.users the server says no and the page says so', async ({
      page,
      api,
    }) => {
      api.admin = true;
      api.organisation = { units: [], unplaced: 0 };
      await open(page, '/admin/organisation');
      await expect(page.getByRole('heading', { name: 'Ingen organisation ännu' })).toBeVisible();
      await expect(page.getByRole('tree')).toHaveCount(0);
      api.usersForbidden = true;
      await open(page, '/admin/organisation');
      await expect(page.getByRole('alert').filter({ hasText: 'behörighet' })).toBeVisible();
      expect(await announcements(page)).not.toContainEqual(expect.stringContaining('undefined'));
    });
  });
  test.describe('phone', () => {
    test.use({ viewport: phone });
    test('a phone keeps the counts in the sentence under the name, and walks the unit in the sheet', async ({
      page,
      api,
    }) => {
      api.admin = true;
      await open(page, '/admin/organisation');
      const tree = page.getByRole('tree', { name: 'Organisationsträd' });
      await expect(tree.getByRole('treeitem', { name: /^Kommunen/ }).first()).toContainText(
        'Chef: Yusuf Lundgren\u00a0· 1 person, 15 med enheterna under',
      );
      // The problems card stacks the mark, the words and the way on.
      const card = page.getByRole('region', { name: 'Att rätta i katalogen' });
      await expect(card.getByRole('listitem')).toHaveCount(3);
      await open(page, '/admin/organisation?unit=unit-grundskola');
      const sheet = page.getByRole('dialog', { name: 'Personer på Grundskola' });
      await expect(sheet.getByRole('heading', { level: 2, name: 'Grundskola' })).toBeVisible();
      await sheet.getByRole('link', { name: 'Bergsåkers skola' }).first().click();
      const skola = page.getByRole('dialog', { name: 'Personer på Bergsåkers skola' });
      await expect(skola.getByRole('heading', { level: 2, name: 'Bergsåkers skola' })).toBeFocused();
      await expect.poll(() => announcements(page)).toContainEqual(expect.stringContaining('Visar Bergsåkers skola'));
      await expect(skola.getByRole('button', { name: /^Ingår i Grundskola/ })).toBeVisible();
      await expectNoAxeViolations(page, { without: TREE_LABEL_RULE });
      await skola.getByRole('button', { name: /Stäng/ }).click();
      await expect(skola).toBeHidden();
      await expect(tree.getByRole('treeitem', { name: /^Bergsåkers skola/ }).first()).toBeFocused();
    });
  });
  test.describe('1.4.10 reflow', () => {
    test('the tree and a unit opened over it reflow at 320 px', async ({ page, api }) => {
      api.admin = true;
      await page.setViewportSize(narrow);
      await open(page, '/admin/organisation');
      const tree = page.getByRole('tree', { name: 'Organisationsträd' });
      await expect(tree.getByRole('treeitem', { name: /Kultur och fritid/ }).first()).toContainText('Saknar chef');
      expect(await reflowProblems(page)).toEqual([]);
      // Four levels down, where the indentation leaves the least room.
      await open(page, '/admin/organisation?unit=unit-skola');
      const people = page.getByRole('dialog', { name: 'Personer på Bergsåkers skola' });
      await expect(people.getByText('Anna Lindqvist')).toBeVisible();
      expect(await reflowProblems(page)).toEqual([]);
      await people.getByRole('button', { name: /Stäng/ }).click();
      await expect(people).toBeHidden();
      await expect(tree.getByRole('treeitem', { name: /Bergsåkers skola/ }).first()).toBeVisible();
      expect(await reflowProblems(page)).toEqual([]);
      // A unit with a group of its manager, and the people who report to them from below with the units they lead.
      await open(page, '/admin/organisation?unit=unit-grundskola');
      const reports = page.getByRole('dialog', { name: 'Personer på Grundskola' });
      await expect(reports.getByText('Medarbetare på Hagaskolan')).toBeVisible();
      expect(await reflowProblems(page)).toEqual([]);
      // A unit with the step up, a reporting row and a unit under it.
      await open(page, '/admin/organisation?unit=unit-omsorg');
      const under = page.getByRole('dialog', { name: 'Personer på Vård och omsorg' });
      await expect(under.getByRole('heading', { name: 'Enheter under' })).toBeVisible();
      expect(await reflowProblems(page)).toEqual([]);
    });
  });
});
/** Opens one unit under Kommunen with its chevron, as a person with a mouse would. */
async function kommunenOpen(page: Page, name: string) {
  const row = page
    .getByRole('tree', { name: 'Organisationsträd' })
    .getByRole('treeitem', { name: new RegExp(name) })
    .first();
  await row.focus();
  await page.keyboard.press('ArrowRight');
  await expect(row).toHaveAttribute('aria-expanded', 'true');
}
