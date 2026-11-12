import type { Page } from '@playwright/test';
import type { OrganisationUnit, StaffPerson } from '@clew/contracts';
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
  type MockApi,
} from './support';

/**
 * Organisation (D99): the organisation tree as the catalogue pushed it, with who leads each unit, how many are placed
 * on it and in its branch and what a push left wrong; a row leads to the unit's own page (the product owner,
 * 2026-11-12: a panel is for peeking or an instant action, a list that can grow gets a full route), with who leads it,
 * where it stands, its marks and its people as three groups under one search, a page at a time. Keyboard, structure,
 * focus, axe and reflow, at desktop, phone and 320 px.
 */
/**
 * 2.5.3 Label in Name on the tree (D99 item 6). axe's rule for it, `label-content-name-mismatch`, is experimental and
 * reads everything inside a `treeitem` as that row's visible label: the rows nested under it and the name of its
 * expander. A tree nests its rows, so the rule fails every row that has rows under it whatever the row is named. It is
 * left out on the tree and the criterion is checked here in its place, on each row by itself: the row's accessible
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
const tree = (page: Page) => page.getByRole('tree', { name: 'Organisationsträd' });
const row = (page: Page, name: RegExp) => tree(page).getByRole('treeitem', { name }).first();
const title = (page: Page, name: string) => page.getByRole('heading', { level: 1, name, exact: true });
/** A group of the unit's people: its heading, and the table (or, on a phone, the list) it names. */
const group = (page: Page, heading: string) => page.getByRole('table', { name: heading, exact: true });
const groupList = (page: Page, heading: string, unit: string) =>
  page.getByRole('list', { name: `${heading} · ${unit}`, exact: true });
/**
 * The groups' headings, level 2 in the outline (`aria-level`) and drawn at the third size, as the sections of Hem are;
 * Playwright reads a native heading's level from its tag, so they are found by the level they announce.
 */
const groupHeadings = (page: Page) => page.getByRole('main').locator('[aria-level="2"]');
const search = (page: Page) => page.getByRole('search').getByRole('searchbox', { name: 'Sök person' });
/** The line that says what the search found: Astryx's own live regions repeat other words. */
const found = (page: Page) => page.getByRole('status').filter({ hasText: /matchar sökningen$/ });

/** A unit four levels down with several hundred people placed on it, every fiftieth deactivated, and nobody leading it. */
const BIG = 412;
function withBigUnit(api: MockApi) {
  const people: StaffPerson[] = Array.from({ length: BIG }, (_, i) => ({
    id: `stor-${i + 1}`,
    name: `Person ${String(i + 1).padStart(3, '0')}`,
    userName: `person.${i + 1}`,
    email: i % 7 ? `person.${i + 1}@clew.test` : null,
    role: 'employee',
    enabled: i % 50 !== 49,
  }));
  const off = people.filter(p => !p.enabled).length;
  const unit: OrganisationUnit = {
    unitId: 'unit-stor',
    unitLabel: 'Storskolan',
    parentId: 'unit-grundskola',
    managers: [],
    placed: BIG - off,
    branch: BIG - off,
    line: 'above',
    pushed: true,
  };
  api.organisation = { ...api.organisation, units: [...api.organisation.units, unit] };
  api.organisationPeople['unit-stor'] = people;
  return { off };
}

test.describe('organisation', () => {
  for (const [layout, viewport] of [
    ['desktop', desktop],
    ['phone', phone],
  ] as const)
    test.describe(layout, () => {
      test.use({ viewport });
      test('the tree and a unit page have no axe violations and every focus stop is marked', async ({ page, api }) => {
        api.admin = true;
        await open(page, '/admin/organisation');
        await expect(title(page, 'Organisation')).toBeVisible();
        await expect(tree(page)).toBeVisible();
        await expectNoAxeViolations(page, { without: TREE_LABEL_RULE });
        await expectRowsNamedByWhatTheyShow(page);
        expect((await hiddenFocusStops(page)).unmarked).toEqual([]);
        await open(page, '/admin/organisation/unit-skola');
        await expect(title(page, 'Bergsåkers skola')).toBeVisible();
        await expect(page.getByRole('link', { name: 'Anna Lindqvist' })).toBeVisible();
        await expectNoAxeViolations(page);
        expect((await hiddenFocusStops(page)).unmarked).toEqual([]);
        // The phone draws the rows as Användare does there: a list per group, named by the group and the unit.
        if (layout === 'phone') {
          await expect(page.getByRole('table')).toHaveCount(0);
          await expect(groupList(page, 'Medarbetare', 'Bergsåkers skola').getByRole('listitem')).toHaveCount(2);
        } else await expect(group(page, 'Medarbetare').locator('tbody tr')).toHaveCount(2);
      });
      test('a unit with several hundred people shows them a page at a time, and the pager is in the address', async ({
        page,
        api,
      }) => {
        api.admin = true;
        const { off } = withBigUnit(api);
        await open(page, '/admin/organisation/unit-stor');
        await expect(title(page, 'Storskolan')).toBeVisible();
        await expect(page.getByText(`${BIG - off} personer på enheten, ${off} avstängda`).first()).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Medarbetare', exact: true })).toBeVisible();
        await expect(page.getByText(`${BIG} personer`, { exact: true })).toBeVisible();
        const pager = page.getByRole('navigation', { name: 'Sidor: Medarbetare' });
        const rows =
          layout === 'phone'
            ? groupList(page, 'Medarbetare', 'Storskolan').getByRole('listitem')
            : group(page, 'Medarbetare').locator('tbody tr');
        await expect(rows).toHaveCount(25);
        const next = pager.getByRole('button', { name: 'Gå till nästa sida' });
        await next.focus();
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL(/\/admin\/organisation\/unit-stor\?employees-page=2$/);
        await expect(rows.first()).toContainText('Person 026');
        // The step is taken at the foot of the rows and read from their head; the focus stays on the pager.
        await expect(page.getByRole('heading', { name: 'Medarbetare', exact: true })).toBeInViewport();
        await expect(next).toBeFocused();
        if (layout === 'desktop') {
          // Each row says where it stands among the group, not on the page.
          await expect(group(page, 'Medarbetare')).toHaveAttribute('aria-rowcount', String(BIG));
          await expect(rows.first()).toHaveAttribute('aria-rowindex', '26');
        }
        // The address holds the page, so a reload and a person's way back land on the same rows.
        await page.reload();
        await expect(rows.first()).toContainText('Person 026');
        await expect(page.getByRole('link', { name: 'Person 026' })).toHaveAttribute(
          'href',
          `/people/person.26?from=${encodeURIComponent('/admin/organisation/unit-stor?employees-page=2')}`,
        );
        await expectNoAxeViolations(page);
        // A search runs over all of them and starts from the first page, in place of the page it was on.
        await search(page).fill('person.41');
        await expect(found(page)).toHaveText(`4 av ${BIG} personer matchar sökningen`);
        await expect(page).toHaveURL(/\/admin\/organisation\/unit-stor$/);
        await expect(rows).toHaveCount(4);
        await expect(pager).toHaveCount(0);
        expect(await announcements(page)).toContainEqual(expect.stringContaining('matchar sökningen'));
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
      // The roots are open from the start, so the level under each is read without a click; deeper levels are not.
      const kommunen = row(page, /Kommunen/);
      await expect(kommunen).toHaveAttribute('aria-expanded', 'true');
      await expect(kommunen).toContainText('Chef: Yusuf Lundgren · 1 person, 15 med enheterna under');
      const utbildning = row(page, /Barn och utbildning/);
      await expect(utbildning).toBeVisible();
      await expect(utbildning).toHaveAttribute('aria-expanded', 'false');
      await expect(tree(page).getByText('Grundskola', { exact: true })).toHaveCount(0);
      await expect(page.getByRole('status').filter({ hasText: 'enheter' })).toHaveText('11 enheter');
      // A row is a link to the unit's page, and nothing opens over the tree.
      await expect(kommunen.getByRole('link').first()).toHaveAttribute('href', '/admin/organisation/unit-kommun');
      await expect(page.getByRole('dialog')).toHaveCount(0);
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
      const kultur = row(page, /Kultur och fritid/);
      await expect(kultur).toContainText('Ingen chef · 2 personer');
      await expect(kultur).toContainText('Saknar chef');
      // A unit under a unit nobody leads, with nobody on it and nothing under it.
      await expect(tree(page).getByRole('treeitem', { name: /Arkivet/ })).toContainText('Tom');
      await expect(tree(page).getByRole('treeitem', { name: /unit-okand/ })).toContainText('Saknar enhetsgrupp');
      // An area nobody is placed on is a heading, not an emptied unit, and its unit is led from above.
      await kommunenOpen(page, 'Vård och omsorg');
      const hemtjanst = row(page, /^Hemtjänst(?! Centrum)/);
      await expect(hemtjanst).toContainText('Leds från enheten ovanför · 0 personer, 4 med enheterna under');
      await expect(hemtjanst).not.toContainText('Tom');
    });
    test('a unit is reached from its row by keyboard, its heading takes the focus, and the way back lands on the row', async ({
      page,
      api,
    }) => {
      api.admin = true;
      await open(page, '/admin/organisation');
      await row(page, /Kommunen/).focus();
      await page.keyboard.press('ArrowDown');
      await expect(row(page, /Barn och utbildning/)).toBeFocused();
      await page.keyboard.press('ArrowRight');
      await expect(row(page, /Barn och utbildning/)).toHaveAttribute('aria-expanded', 'true');
      await page.keyboard.press('ArrowDown');
      await expect(row(page, /Grundskola/)).toBeFocused();
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowDown');
      await expect(row(page, /Bergsåkers skola/)).toBeFocused();
      await expect(row(page, /Bergsåkers skola/)).toContainText('Chefer: Hillevi Berg och Karin Åberg · 3 personer');
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(/\/admin\/organisation\/unit-skola$/);
      await expect(page).toHaveTitle('Bergsåkers skola · Startsidan');
      await expect(title(page, 'Bergsåkers skola')).toBeFocused();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      // The trail: the tree one step up, the unit where the person is; the rail keeps Organisation marked.
      const trail = page.getByRole('navigation', { name: 'Du är här' });
      await expect(trail.getByRole('link', { name: 'Organisation' })).toHaveAttribute('href', '/admin/organisation');
      await expect(trail.locator('[aria-current="page"]')).toHaveText('Bergsåkers skola');
      // Back: the tree is open down to the unit, its row marked and holding the focus.
      await page.goBack();
      await expect(page).toHaveURL(/\/admin\/organisation$/);
      await expect(row(page, /Bergsåkers skola/)).toBeFocused();
      await expect(row(page, /Bergsåkers skola/)).toHaveAttribute('aria-selected', 'true');
      await expect(row(page, /Grundskola/)).toHaveAttribute('aria-expanded', 'true');
      // Forward and up by the trail: the same.
      await page.goForward();
      await expect(title(page, 'Bergsåkers skola')).toBeVisible();
      await trail.getByRole('link', { name: 'Organisation' }).click();
      await expect(page).toHaveURL(/\/admin\/organisation$/);
      await expect(row(page, /Bergsåkers skola/)).toBeFocused();
      // A tree reached any other way starts from its roots, the focus left where the person put it.
      await open(page, '/admin/organisation');
      await expect(row(page, /Barn och utbildning/)).toHaveAttribute('aria-expanded', 'false');
      await expect(tree(page).locator('[aria-selected="true"]')).toHaveCount(0);
    });
    test('the head says who leads the unit, how many are on it and where it stands, each a link', async ({
      page,
      api,
    }) => {
      api.admin = true;
      await open(page, '/admin/organisation/unit-skola');
      await expect(page.getByText('Chefer', { exact: true }).first()).toBeVisible();
      const hillevi = page.getByRole('link', { name: 'Hillevi Berg' }).first();
      // A name opens the person's page, with the unit as the way back.
      await expect(hillevi).toHaveAttribute(
        'href',
        `/people/hillevi?from=${encodeURIComponent('/admin/organisation/unit-skola')}`,
      );
      await expect(page.getByText('3 personer på enheten, 1 avstängd')).toBeVisible();
      await expect(page.getByRole('link', { name: 'Grundskola', exact: true })).toHaveAttribute(
        'href',
        '/admin/organisation/unit-grundskola',
      );
      // Up one unit, by its link: the units below it are links too, and the new page takes the focus.
      await page.getByRole('link', { name: 'Grundskola', exact: true }).click();
      await expect(title(page, 'Grundskola')).toBeFocused();
      await expect(page.getByText('1 person på enheten, 7 med enheterna under')).toBeVisible();
      await expect(page.getByRole('link', { name: 'Barn och utbildning', exact: true })).toHaveAttribute(
        'href',
        '/admin/organisation/unit-utbildning',
      );
      await expect(page.getByText('Enheter under', { exact: true })).toBeVisible();
      await page.getByRole('link', { name: 'Hagaskolan', exact: true }).click();
      await expect(title(page, 'Hagaskolan')).toBeFocused();
      // Led from above: by the nearest unit above that has a manager.
      await expect(page.getByText('Leds från', { exact: true })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Grundskola', exact: true }).first()).toHaveAttribute(
        'href',
        '/admin/organisation/unit-grundskola',
      );
      // Back steps through the units as they were visited.
      await page.goBack();
      await expect(title(page, 'Grundskola')).toBeVisible();
    });
    test('a name opens the person’s page, with the unit as the way back to the rows it was on', async ({
      page,
      api,
    }) => {
      api.admin = true;
      withBigUnit(api);
      api.entityDetailOf = key =>
        key === 'person.26'
          ? {
              entity: { kind: 'person', key, name: 'Person 026' },
              relation: 'self',
              actions: [],
              cards: [],
              sections: [],
            }
          : undefined;
      await open(page, '/admin/organisation/unit-stor?employees-page=2');
      await page.getByRole('link', { name: 'Person 026', exact: true }).click();
      const main = page.getByRole('main');
      await expect(main.getByRole('heading', { level: 1, name: 'Person 026' })).toBeVisible();
      // The rail keeps Organisation, and the way back is named by the unit it leads to.
      await expect(page.getByRole('link', { name: 'Organisation', exact: true })).toHaveAttribute(
        'aria-current',
        'page',
      );
      await main.getByRole('link', { name: 'Storskolan', exact: true }).click();
      await expect(page).toHaveURL(/\/admin\/organisation\/unit-stor\?employees-page=2$/);
      await expect(group(page, 'Medarbetare').locator('tbody tr').first()).toContainText('Person 026');
    });
    test('the people are three groups: who leads the unit, the others on it, and who reports to its managers from below', async ({
      page,
      api,
    }) => {
      api.admin = true;
      await open(page, '/admin/organisation/unit-skola');
      await expect(groupHeadings(page)).toHaveText(['Chefer', 'Medarbetare']);
      const leaders = group(page, 'Chefer').locator('tbody tr');
      await expect(leaders).toHaveCount(2);
      await expect(leaders.first()).toContainText('Hillevi Berg');
      await expect(leaders.first()).toContainText('hillevi@clew.test');
      const others = group(page, 'Medarbetare').locator('tbody tr');
      await expect(others).toHaveCount(2);
      await expect(others.first()).toContainText('Anna Lindqvist');
      // Deactivated: listed with the mark, the name not a link, since there is no profile to open.
      await expect(others.nth(1)).toContainText('Avstängd');
      await expect(others.nth(1).getByRole('link')).toHaveCount(0);
      await expect(others.first().getByRole('link', { name: 'Anna Lindqvist' })).toHaveAttribute(
        'href',
        `/people/anna.lindqvist?from=${encodeURIComponent('/admin/organisation/unit-skola')}`,
      );
      // One manager and nobody else placed here: a group for the manager, none for the others, then the reports.
      await open(page, '/admin/organisation/unit-grundskola');
      await expect(groupHeadings(page)).toHaveText(['Chef', 'Rapporterar till Mattias Eriksson']);
      await expect(group(page, 'Chef').locator('tbody tr')).toHaveText([/Mattias Eriksson/]);
      const reports = group(page, 'Rapporterar till Mattias Eriksson').locator('tbody tr');
      await expect(reports).toHaveCount(3);
      // The managers of the nearest led unit, each named by the unit they lead, and a person on a unit nobody leads.
      await expect(reports.nth(0)).toContainText('Chef för Bergsåkers skola');
      await expect(reports.nth(0)).toContainText('hillevi@clew.test');
      await expect(reports.nth(1)).toContainText('Karin Åberg');
      await expect(reports.nth(2)).toContainText('Medarbetare på Hagaskolan');
      await expect(
        page.getByText(
          'Från enheterna under: cheferna närmast under, och de som är placerade på en enhet som ingen leder.',
        ),
      ).toBeVisible();
      await expectNoAxeViolations(page);
    });
    test('one search narrows all three groups by name, user name, role and e-mail, and says what it found', async ({
      page,
      api,
    }) => {
      api.admin = true;
      await open(page, '/admin/organisation/unit-grundskola');
      await search(page).fill('hagaskolan');
      await expect(found(page)).toHaveText('1 av 4 personer matchar sökningen');
      await expect(groupHeadings(page)).toHaveText(['Rapporterar till Mattias Eriksson']);
      await expect(group(page, 'Rapporterar till Mattias Eriksson').locator('tbody tr')).toHaveText([/Omar Hosseini/]);
      await expect(page.getByText('1 av 3 personer', { exact: true })).toBeVisible();
      await search(page).fill('karin.aberg');
      await expect(found(page)).toHaveText('1 av 4 personer matchar sökningen');
      await search(page).fill('MATTIAS.ERIKSSON@CLEW');
      await expect(groupHeadings(page)).toHaveText(['Chef']);
      // Nobody: said in words, with the one way out, which gives the focus back to the box.
      await search(page).fill('ingen sådan');
      await expect(page.getByRole('heading', { name: 'Inga personer matchar' })).toBeVisible();
      await expect(found(page)).toHaveText('0 av 4 personer matchar sökningen');
      await page.getByRole('button', { name: 'Rensa sökningen' }).click();
      await expect(search(page)).toBeFocused();
      await expect(search(page)).toHaveValue('');
      await expect(groupHeadings(page)).toHaveText(['Chef', 'Rapporterar till Mattias Eriksson']);
      await expect(found(page)).toHaveCount(0);
    });
    test('what a push left wrong on a unit is said on its page, in the tree’s words, with the way to its people', async ({
      page,
      api,
    }) => {
      api.admin = true;
      api.organisationPeople['unit-kultur'] = [
        { id: 'k1', name: 'Kim Ek', userName: 'kim.ek', email: null, role: 'employee', enabled: true },
        { id: 'k2', name: 'Lo Ström', userName: 'lo.strom', email: null, role: 'employee', enabled: true },
      ];
      await open(page, '/admin/organisation/unit-kultur');
      await expect(page.getByText('Saknar chef', { exact: true })).toBeVisible();
      await expect(page.getByText('Enheten har personer men ingen chef')).toBeVisible();
      await expect(page.getByText('Ingen chef', { exact: true })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Till Användare' })).toHaveAttribute(
        'href',
        '/admin/users?unit=unit-kultur',
      );
      await expectNoAxeViolations(page);
      api.organisationPeople['unit-okand'] = [
        { id: 'nils', name: 'Nils Öberg', userName: 'nils.oberg', email: null, role: 'manager', enabled: true },
      ];
      await open(page, '/admin/organisation/unit-okand');
      await expect(page.getByText('Saknar enhetsgrupp', { exact: true })).toBeVisible();
      await expect(page.getByText('Enheten saknar enhetsgrupp')).toBeVisible();
      // Nobody on it and nothing under it: the mark, and the people's place says so.
      await open(page, '/admin/organisation/unit-arkiv');
      await expect(page.getByText('Tom', { exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Ingen är placerad på enheten' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Kultur och fritid' })).toHaveAttribute(
        'href',
        '/admin/organisation/unit-kultur',
      );
      // A unit nobody is placed on but people are under is no fault: no mark, and its page says where they are.
      await open(page, '/admin/organisation/unit-hemtjanst');
      await expect(page.getByText('Tom', { exact: true })).toHaveCount(0);
      await expect(
        page
          .getByRole('main')
          .getByText('Katalogen har inte fört in någon på just den här enheten, bara på enheterna under den.'),
      ).toBeVisible();
      await expect(page.getByRole('link', { name: 'Hemtjänst Centrum' })).toBeVisible();
      await expect(page.getByText('Leds från', { exact: true })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Vård och omsorg' }).first()).toHaveAttribute(
        'href',
        '/admin/organisation/unit-omsorg',
      );
    });
    test('the overlay’s old address leads to the page in its place, and an unknown unit is answered in words', async ({
      page,
      api,
    }) => {
      api.admin = true;
      await open(page, '/admin/users');
      await page.goto('/admin/organisation?unit=unit-skola');
      await expect(page).toHaveURL(/\/admin\/organisation\/unit-skola$/);
      await expect(title(page, 'Bergsåkers skola')).toBeVisible();
      // Replaced, not added: Back leaves for the page before, never to the old address and its redirect again.
      await page.goBack();
      await expect(page).toHaveURL(/\/admin\/users$/);
      await open(page, '/admin/organisation/finns-inte');
      await expect(title(page, 'Enheten finns inte')).toBeVisible();
      await expect(page).toHaveTitle('Enheten finns inte · Startsidan');
      await expect(page.getByRole('link', { name: 'Till Organisation' })).toHaveAttribute(
        'href',
        '/admin/organisation',
      );
      await expect(page.getByRole('table')).toHaveCount(0);
      await expectNoAxeViolations(page);
      await open(page, '/admin/organisation?unit=finns-inte');
      await expect(title(page, 'Enheten finns inte')).toBeVisible();
    });
    test('a read that fails is said with a second try, and a refusal without one', async ({ page, api }) => {
      api.admin = true;
      api.organisationUnitFails = true;
      await open(page, '/admin/organisation/unit-skola');
      await expect(title(page, 'Bergsåkers skola')).toBeVisible();
      await expect(page.getByText('Personerna kunde inte hämtas just nu.')).toBeVisible({ timeout: 10000 });
      api.organisationUnitFails = false;
      await page.getByRole('button', { name: 'Försök igen' }).click();
      await expect(group(page, 'Medarbetare').locator('tbody tr')).toHaveCount(2);
      api.usersForbidden = true;
      await open(page, '/admin/organisation/unit-skola');
      await expect(page.getByText('Du saknar behörighet för åtgärden.')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Försök igen' })).toHaveCount(0);
      expect(await announcements(page)).not.toContainEqual(expect.stringContaining('undefined'));
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
    test('the tree and a unit page reflow at 320 px', async ({ page, api }) => {
      api.admin = true;
      withBigUnit(api);
      await page.setViewportSize(narrow);
      await open(page, '/admin/organisation');
      await expect(row(page, /Kultur och fritid/)).toContainText('Saknar chef');
      expect(await reflowProblems(page)).toEqual([]);
      // Four levels down, with marks, a search and a pager.
      await open(page, '/admin/organisation/unit-stor');
      await expect(page.getByRole('navigation', { name: 'Sidor: Medarbetare' })).toBeVisible();
      expect(await reflowProblems(page)).toEqual([]);
      await search(page).fill('person 1');
      await expect(found(page)).toBeVisible();
      expect(await reflowProblems(page)).toEqual([]);
      // A unit with its manager, and the people who report to them from below with the units they lead.
      await open(page, '/admin/organisation/unit-grundskola');
      await expect(page.getByText('Medarbetare på Hagaskolan')).toBeVisible();
      expect(await reflowProblems(page)).toEqual([]);
      await open(page, '/admin/organisation/unit-kultur');
      await expect(page.getByText('Enheten har personer men ingen chef')).toBeVisible();
      expect(await reflowProblems(page)).toEqual([]);
    });
  });
});
/** Opens one unit under Kommunen with its chevron, as a person with a mouse would. */
async function kommunenOpen(page: Page, name: string) {
  const unit = row(page, new RegExp(name));
  await unit.focus();
  await page.keyboard.press('ArrowRight');
  await expect(unit).toHaveAttribute('aria-expanded', 'true');
}
