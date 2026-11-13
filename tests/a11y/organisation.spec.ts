import type { Page } from '@playwright/test';
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
 * Organisation (D99): the organisation tree as the catalogue pushed it, with who leads each unit, how many are placed
 * on it and in its branch, what a push left wrong, and a unit's people as an overlay over the tree. Keyboard,
 * structure, focus, axe and reflow, at desktop, phone and 320 px.
 */
/**
 * 2.5.3 Label in Name on the tree (D99 item 6). axe's rule for it, `label-content-name-mismatch`, is experimental and
 * reads everything inside a `treeitem` as that row's visible label: the rows nested under it and the name of its
 * expander. A tree nests its rows, so the rule fails every row that has rows under it whatever the row is named. It is
 * left out on this page and the criterion is checked here in its place, on each row by itself: the row's accessible
 * name is exactly the text a person sees on the row, the unit's name, who leads it, how many it holds and its marks.
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
      await expect(kommunen).toContainText('Chef: Yusuf Lundgren · 1 person, 15 med enheterna under');
      const utbildning = tree.getByRole('treeitem', { name: /Barn och utbildning/ }).first();
      await expect(utbildning).toBeVisible();
      await expect(utbildning).toHaveAttribute('aria-expanded', 'false');
      await expect(tree.getByText('Grundskola', { exact: true })).toHaveCount(0);
      await expect(page.getByRole('status').filter({ hasText: 'enheter' })).toHaveText('11 enheter');
    });
    test('what a push left wrong is said above the tree and marked on the unit', async ({ page, api }) => {
      api.admin = true;
      await open(page, '/admin/organisation');
      await expect(page.getByText('2 personer saknar enhet')).toBeVisible();
      // The link lands on the people it is about: the list narrowed to those without access (D100).
      await expect(page.getByRole('link', { name: 'Till Användare' })).toHaveAttribute(
        'href',
        '/admin/users?status=no-access',
      );
      await expect(page.getByText('1 enhet har personer men ingen chef')).toBeVisible();
      await expect(page.getByText('1 enhet saknar enhetsgrupp')).toBeVisible();
      const tree = page.getByRole('tree', { name: 'Organisationsträd' });
      const kultur = tree.getByRole('treeitem', { name: /Kultur och fritid/ }).first();
      await expect(kultur).toContainText('Ingen chef · 2 personer');
      await expect(kultur).toContainText('Saknar chef');
      // A unit under a unit nobody leads, with nobody on it and nothing under it.
      await expect(tree.getByRole('treeitem', { name: /Arkivet/ })).toContainText('Tom');
      await expect(tree.getByRole('treeitem', { name: /unit-okand/ })).toContainText('Saknar enhetsgrupp');
      // An area nobody is placed on is a heading, not an emptied unit, and its unit is led from above.
      await kommunenOpen(page, 'Vård och omsorg');
      const hemtjanst = tree.getByRole('treeitem', { name: /^Hemtjänst(?! Centrum)/ }).first();
      await expect(hemtjanst).toContainText('Leds från enheten ovanför · 0 personer, 4 med enheterna under');
      await expect(hemtjanst).not.toContainText('Tom');
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
      await expect(row(/Bergsåkers skola/)).toContainText('Chefer: Hillevi Berg och Karin Åberg · 3 personer');
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(/\/admin\/organisation\?unit=unit-skola$/);
      const people = page.getByRole('dialog', { name: 'Personer på Bergsåkers skola' });
      await expect(people.getByRole('heading', { name: 'Bergsåkers skola' })).toBeVisible();
      // Where the unit is: the units above it, outermost first.
      await expect(people.getByText('Kommunen › Barn och utbildning › Grundskola')).toBeVisible();
      await expect(people.getByRole('status').filter({ hasText: 'personer' })).toHaveText(
        '3 personer på enheten och 1 avstängd',
      );
      // Who leads the unit first, in a group of their own, then the others placed on it; nobody reports from below.
      await expect(people.getByRole('heading', { level: 3 })).toHaveText(['Chefer', 'Medarbetare']);
      const leaders = people.getByRole('list', { name: 'Chefer · Bergsåkers skola' }).getByRole('listitem');
      await expect(leaders).toHaveCount(2);
      await expect(leaders.first()).toContainText('Hillevi Berg');
      await expect(leaders.first()).toContainText('Chef · hillevi@clew.test');
      // The avatar beside a name is decoration, as in the tree: the name is said once, by its link.
      await expect(leaders.first().locator('.astryx-avatar')).toHaveAttribute('aria-hidden', 'true');
      await expect(people.getByRole('img')).toHaveCount(0);
      const others = people.getByRole('list', { name: 'Medarbetare · Bergsåkers skola' }).getByRole('listitem');
      await expect(others).toHaveCount(2);
      await expect(others.first()).toContainText('Anna Lindqvist');
      await expect(others.nth(1)).toContainText('Avstängd');
      await expect(row(/Bergsåkers skola/)).toHaveAttribute('aria-selected', 'true');
      await page.keyboard.press('Escape');
      await expect(people).toBeHidden();
      await expect(page).toHaveURL(/\/admin\/organisation$/);
      // The tree kept what was opened in it, and the row that opened the overlay has the focus again.
      await expect(row(/Bergsåkers skola/)).toBeFocused();
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
      // A unit that is not in the tree is answered in words, not with an empty overlay.
      await open(page, '/admin/organisation?unit=finns-inte');
      await expect(page.getByRole('dialog', { name: 'Personer på Enheten finns inte' })).toContainText(
        'Enheten finns inte.',
      );
    });
    test('a unit says who reports to its manager from the units below, after the manager and before nothing else', async ({
      page,
      api,
    }) => {
      api.admin = true;
      await open(page, '/admin/organisation?unit=unit-grundskola');
      const people = page.getByRole('dialog', { name: 'Personer på Grundskola' });
      // One manager and nobody else placed here: a group for the manager, none for the others, then the reports.
      await expect(people.getByRole('heading', { level: 3 })).toHaveText(['Chef', 'Rapporterar till Mattias Eriksson']);
      await expect(people.getByRole('list', { name: 'Chef · Grundskola' }).getByRole('listitem')).toHaveText([
        /Mattias Eriksson/,
      ]);
      const reports = people
        .getByRole('list', { name: 'Rapporterar till Mattias Eriksson · Grundskola' })
        .getByRole('listitem');
      await expect(reports).toHaveCount(3);
      // The managers of the nearest led unit, each named by the unit they lead, and a person on a unit nobody leads.
      await expect(reports.nth(0)).toContainText('Chef för Bergsåkers skola · hillevi@clew.test');
      await expect(reports.nth(1)).toContainText('Karin Åberg');
      await expect(reports.nth(2)).toContainText('Medarbetare på Hagaskolan');
      await expect(people.getByText('Från enheterna under')).toBeVisible();
      await expectNoAxeViolations(page, { without: TREE_LABEL_RULE });
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
