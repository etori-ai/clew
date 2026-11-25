import type { Page } from '@playwright/test';
import { organisationPeople } from './data';
import {
  SITE,
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
 * Organisation (D99, D124, D147): the organisation tree as the catalogue pushed it, a ledger on a wide screen, with who
 * leads each unit, how many are placed on it and in its branch, what a push left wrong as one card, and a unit as an
 * overlay over the tree that is walked one step up and one step down. Whom a person reports to is said on the person,
 * from their employments, and never read from the tree: a unit is led by its own managers or by nobody, and the people
 * who report to nobody are counted on their unit and in the card. Keyboard, structure, focus, announcements, axe and
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
      await expect(page).toHaveTitle(`Organisation · ${SITE}`);
      // The section is marked in the administration's own panel (D126), on its row.
      await expect(
        page
          .getByRole('navigation', { name: 'Administration', exact: true })
          .getByRole('listitem')
          .filter({ has: page.getByRole('link', { name: 'Organisation', exact: true }) }),
      ).toHaveAttribute('aria-current', 'true');
      const tree = page.getByRole('tree', { name: 'Organisationsträd' });
      // The roots are open from the start, so the level under each is read without a click; deeper levels are not.
      const kommunen = tree.getByRole('treeitem', { name: /Kommunen/ }).first();
      await expect(kommunen).toHaveAttribute('aria-expanded', 'true');
      // The row reads as a sentence: the name and its mark, who leads the unit, its own count and its branch's.
      await expect(kommunen).toHaveAccessibleName(
        'Kommunen 1 person utan chef , Chef: Yusuf Lundgren , 1 person , 15 med enheterna under',
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
        await expect(row.getByText(/(Chef|Chefer): |Ingen chef$/).first()).not.toContainText('person');
      }
      expect(new Set(edges).size).toBe(1);
      // A unit nobody leads says so where the leader stands, and the marks are beside the name.
      const kultur = tree.getByRole('treeitem', { name: /Kultur och fritid/ }).first();
      await expect(kultur).toHaveAccessibleName(
        'Kultur och fritid Saknar chef 2 personer utan chef , Ingen chef , 2 personer',
      );
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
        /^Utan chef\s*5 personer på 3 enheter har ingen chef: Hagaskolan, Kommunen och Kultur och fritid/,
        /^Saknar chef\s*2 enheter har personer men ingen chef: Hagaskolan och Kultur och fritid/,
        /^Saknar enhetsgrupp\s*1 enhet saknar enhetsgrupp: unit-okand/,
      ]);
      // The tree passes no line on (D147), so nothing says that a unit nobody leads is led from anywhere else.
      await expect(rows.nth(2)).toContainText(
        'Ingen leder enheten. Personerna där kan ändå ha en chef: vem de rapporterar till anges på deras anställningar.',
      );
      await expect(card).not.toContainText('ovanför');
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
      // An area nobody is placed on is a heading, not an emptied unit. Nobody leads it, whatever stands above it, and
      // with nobody on it there is nobody for the mark to be about.
      await kommunenOpen(page, 'Vård och omsorg');
      const hemtjanst = tree.getByRole('treeitem', { name: /^Hemtjänst(?! Centrum)/ }).first();
      await expect(hemtjanst).toHaveAccessibleName('Hemtjänst , Ingen chef , 0 personer , 4 med enheterna under');
      await expect(hemtjanst).not.toContainText('Tom');
      await expect(hemtjanst).not.toContainText('Saknar chef');
    });
    test('a unit that holds people who report to nobody says how many, in the tree, on the unit and where it is listed', async ({
      page,
      api,
    }) => {
      api.admin = true;
      // Nobody reports to Grundskola's manager from elsewhere, so both units below it are listed under it.
      api.organisationReports['unit-grundskola'] = [];
      await open(page, '/admin/organisation?unit=unit-grundskola');
      const grundskola = page.getByRole('dialog', { name: 'Personer på Grundskola' });
      const under = grundskola.getByRole('list', { name: 'Enheter under · Grundskola' }).getByRole('listitem');
      // The mark counts people, in words: one that nobody leads and where two report to nobody has both marks.
      await expect(under).toHaveText([
        /^Bergsåkers skola\s*Chefer: Hillevi Berg och Karin Åberg\s·\s3 personer$/,
        /^Hagaskolan\s*Saknar chef\s*2 personer utan chef\s*Ingen chef\s·\s3 personer$/,
      ]);
      // The step down shows the unit with the same marks beside how many it holds.
      await under.nth(1).getByRole('button').click();
      const hagaskolan = page.getByRole('dialog', { name: 'Personer på Hagaskolan' });
      await expect(hagaskolan.getByRole('status').filter({ hasText: 'personer' })).toHaveText('3 personer på enheten');
      await expect(hagaskolan.getByText('Saknar chef', { exact: true })).toBeVisible();
      await expect(hagaskolan.getByText('2 personer utan chef', { exact: true })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(hagaskolan).toBeHidden();
      const tree = page.getByRole('tree', { name: 'Organisationsträd' });
      const row = (name: RegExp) => tree.getByRole('treeitem', { name }).first();
      // The count is in the row's name, one person in the singular; a unit whose people all have a manager has no mark.
      await expect(row(/^Hagaskolan/)).toHaveAccessibleName(
        'Hagaskolan Saknar chef 2 personer utan chef , Ingen chef , 3 personer',
      );
      // A row is named by its own label, which the rows nested under it are not part of.
      await expect(row(/^Kommunen/)).toHaveAccessibleName(/^Kommunen 1 person utan chef , Chef: Yusuf Lundgren ,/);
      await expect(row(/^Bergsåkers skola/)).not.toHaveAccessibleName(/utan chef/);
      await expect(row(/^Grundskola/)).not.toHaveAccessibleName(/utan chef/);
      await expectRowsNamedByWhatTheyShow(page);
    });
    test('people who report to nobody are a row of the problems card, and a unit it names opens over the tree with each person’s reason', async ({
      page,
      api,
    }) => {
      api.admin = true;
      await open(page, '/admin/organisation');
      const row = page
        .getByRole('region', { name: 'Att rätta i katalogen' })
        .getByRole('listitem')
        .filter({ hasText: /^Utan chef/ });
      // How many, each person once, and the units that hold them; then what it means and where it is mended.
      await expect(row).toContainText(
        '5 personer på 3 enheter har ingen chef: Hagaskolan, Kommunen och Kultur och fritid',
      );
      await expect(row).toContainText(
        'Katalogen anger ingen aktiv chef på deras anställningar, så de står inte på någons lista i Personal och ingen kan agera som deras chef. Rätta chefen på anställningen i katalogen.',
      );
      await expect(row.getByRole('link')).toHaveText(['Hagaskolan', 'Kommunen', 'Kultur och fritid']);
      const link = row.getByRole('link', { name: 'Hagaskolan' });
      await expect(link).toHaveAttribute('href', '/admin/organisation?unit=unit-hagaskolan');
      await link.focus();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(/\/admin\/organisation\?unit=unit-hagaskolan$/);
      const people = page.getByRole('dialog', { name: 'Personer på Hagaskolan' });
      await expect(people.getByRole('heading', { level: 2, name: 'Hagaskolan' })).toBeFocused();
      // Nobody leads the unit, which says nothing of whom its people report to: one of the three has a manager.
      await expect(
        people.getByText(
          'Ingen leder enheten. Personerna här kan ändå ha en chef: vem de rapporterar till anges på deras anställningar.',
        ),
      ).toBeVisible();
      await expect(people.getByRole('heading', { level: 3 })).toHaveText(['Medarbetare']);
      // Each person says whom they report to, or in words why to nobody: a manager who is deactivated, none named.
      await expect(people.getByRole('list', { name: 'Medarbetare · Hagaskolan' }).getByRole('listitem')).toHaveText([
        /^Omar Hosseini\s*Chef: Mattias Eriksson$/,
        // The reason is in words, and a warning at the row's end finds the two among many.
        /^Petra Holm\s*Chefen är avstängd\s*Utan chef$/,
        /^Rut Sand\s*Ingen chef angiven\s*Utan chef$/,
      ]);
      await expectNoAxeViolations(page, { without: TREE_LABEL_RULE });
      // No step was taken, so closing gives the focus back to the link that opened the overlay (rule 7).
      await page.keyboard.press('Escape');
      await expect(people).toBeHidden();
      await expect(link).toBeFocused();
    });
    test('a person on a unit says whom they report to: one manager, two, two who name each other, and nothing for a deactivated person', async ({
      page,
      api,
    }) => {
      api.admin = true;
      await open(page, '/admin/organisation?unit=unit-skola');
      const skola = page.getByRole('dialog', { name: 'Personer på Bergsåkers skola' });
      // A leader's line has the manager before the e-mail, and the manager alone where there is no e-mail.
      await expect(skola.getByRole('list', { name: 'Chefer · Bergsåkers skola' }).getByRole('listitem')).toHaveText([
        /^Hillevi Berg\s*Chef: Mattias Eriksson\s·\shillevi@clew\.test$/,
        /^Karin Åberg\s*Chef: Mattias Eriksson$/,
      ]);
      // Two employments under two managers are two managers. A deactivated person's row is as it was: the employment
      // may still name a manager, and the person reports to nobody.
      await expect(
        skola.getByRole('list', { name: 'Medarbetare · Bergsåkers skola' }).getByRole('listitem'),
      ).toHaveText([/^Anna Lindqvist\s*Chefer: Hillevi Berg och Karin Åberg$/, /^Vera Öst\s*Avstängd$/]);
      // Everybody here has a manager, so the unit has no mark and no note.
      await expect(skola).not.toContainText('utan chef');
      await expect(skola.getByRole('status').filter({ hasText: 'personer' })).toHaveText(
        '3 personer på enheten och 1 avstängd',
      );
      // Two who name each other as manager: neither is the other's, and each row names whom the ring is with.
      await open(page, '/admin/organisation?unit=unit-kultur');
      const kultur = page.getByRole('dialog', { name: 'Personer på Kultur och fritid' });
      await expect(
        kultur.getByRole('list', { name: 'Medarbetare · Kultur och fritid' }).getByRole('listitem'),
      ).toHaveText([
        /^Dalia Nyström\s*Rapporterar i cirkel med Ebbe Holm\s*Utan chef$/,
        /^Ebbe Holm\s*Rapporterar i cirkel med Dalia Nyström\s*Utan chef$/,
      ]);
      await expect(kultur.getByText('2 personer utan chef', { exact: true })).toBeVisible();
      await expectNoAxeViolations(page, { without: TREE_LABEL_RULE });
    });
    test('a unit named in the problems card opens over the tree, says what is wrong with it, and closes back to its link', async ({
      page,
      api,
    }) => {
      api.admin = true;
      await open(page, '/admin/organisation');
      // The unit is named in two rows of the card, one per thing that is wrong with it; this is the row about the unit.
      const link = page
        .getByRole('region', { name: 'Att rätta i katalogen' })
        .getByRole('listitem')
        .filter({ hasText: /^Saknar chef/ })
        .getByRole('link', { name: 'Kultur och fritid' });
      await link.focus();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(/\/admin\/organisation\?unit=unit-kultur$/);
      const people = page.getByRole('dialog', { name: 'Personer på Kultur och fritid' });
      // The overlay opens with the focus on the unit's heading.
      await expect(people.getByRole('heading', { level: 2, name: 'Kultur och fritid' })).toBeFocused();
      await expect(
        people.getByText(
          'Ingen leder enheten. Personerna här kan ändå ha en chef: vem de rapporterar till anges på deras anställningar.',
        ),
      ).toBeVisible();
      await expect(people.getByRole('status').filter({ hasText: 'personer' })).toHaveText('2 personer på enheten');
      await expect(people.getByText('Saknar chef', { exact: true })).toBeVisible();
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
      // nobody reports from another unit and no unit is under it.
      const up = people.getByRole('button', { name: 'Ingår i Grundskola, Chef: Mattias Eriksson' });
      await expect(up).toBeVisible();
      await expect(people.getByRole('heading', { level: 3 })).toHaveText(['Chefer', 'Medarbetare']);
      const leaders = people.getByRole('list', { name: 'Chefer · Bergsåkers skola' }).getByRole('listitem');
      await expect(leaders).toHaveCount(2);
      // A leader's row: the avatar at 48 px, the name, and under it whom they report to and the e-mail. No row shows a
      // user name.
      await expect(leaders.first()).toHaveText(/Hillevi Berg\s*Chef: Mattias Eriksson\s·\shillevi@clew\.test$/);
      expect(await leaders.first().locator('.astryx-avatar').boundingBox()).toMatchObject({ width: 48, height: 48 });
      // The avatar beside a name is decoration, as in the tree: the name is said once, by its link.
      await expect(leaders.first().locator('.astryx-avatar')).toHaveAttribute('aria-hidden', 'true');
      await expect(people.getByRole('img')).toHaveCount(0);
      const others = people.getByRole('list', { name: 'Medarbetare · Bergsåkers skola' }).getByRole('listitem');
      await expect(others).toHaveCount(2);
      // The others: the avatar at 24 px, the name with whom they report to under it, and "Avstängd" at the end where
      // it applies, on a row of one line.
      await expect(others).toHaveText([
        /^Anna Lindqvist\s*Chefer: Hillevi Berg och Karin Åberg$/,
        /^Vera Öst\s*Avstängd$/,
      ]);
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
              {
                id: 'ture',
                name: 'Ture Väst',
                userName: 'ture.vast',
                email: null,
                role: 'employee',
                enabled: false,
                managers: [],
              },
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
    test('a unit says who reports to its manager from other units, each with the unit they lead as the step to it', async ({
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
        /Mattias Eriksson\s*Chef: Elin Lindqvist\s·\smattias\.eriksson@clew\.test/,
      ]);
      const reports = people
        .getByRole('list', { name: 'Rapporterar till Mattias Eriksson · Grundskola' })
        .getByRole('listitem');
      await expect(reports).toHaveCount(3);
      // Two whose employments name the manager and who lead a unit, each named by it, and one who leads none, named
      // by the unit of the employment.
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
      // What the group holds is said as it is read (D147): from the employments, not from the units below.
      await expect(
        people.getByText('Personer på andra enheter som enligt sin anställning rapporterar till enhetens chef.'),
      ).toBeVisible();
      await expect(people).not.toContainText('Från enheterna under');
      await expectNoAxeViolations(page, { without: TREE_LABEL_RULE });
    });
    test('a unit two people lead says that a report names one of them', async ({ page, api }) => {
      api.admin = true;
      api.organisationReports['unit-skola'] = [
        {
          id: 'omar',
          name: 'Omar Hosseini',
          userName: 'omar.hosseini',
          email: null,
          role: 'employee',
          enabled: true,
          below: [{ unitId: 'unit-hagaskolan', unitLabel: 'Hagaskolan', role: 'employee' }],
        },
      ];
      await open(page, '/admin/organisation?unit=unit-skola');
      const people = page.getByRole('dialog', { name: 'Personer på Bergsåkers skola' });
      await expect(people.getByRole('heading', { level: 3 })).toHaveText([
        'Chefer',
        'Rapporterar till Hillevi Berg och Karin Åberg',
        'Medarbetare',
      ]);
      await expect(
        people.getByText(
          'Personer på andra enheter som enligt sin anställning rapporterar till någon av enhetens chefer.',
        ),
      ).toBeVisible();
      // The unit on the row is beside this one in the tree, not below it: the step goes there all the same.
      const reports = people
        .getByRole('list', { name: 'Rapporterar till Hillevi Berg och Karin Åberg · Bergsåkers skola' })
        .getByRole('listitem');
      await expect(reports).toHaveText([/^Omar Hosseini\s*Medarbetare på Hagaskolan$/]);
      await reports.getByRole('link', { name: 'Hagaskolan' }).press('Enter');
      await expect(page).toHaveURL(/\?unit=unit-hagaskolan$/);
      await expect(
        page.getByRole('dialog', { name: 'Personer på Hagaskolan' }).getByRole('heading', { level: 2 }),
      ).toBeFocused();
    });
    test('a unit lists the units below that no reporting row names, after the reports and before the others', async ({
      page,
      api,
    }) => {
      api.admin = true;
      await open(page, '/admin/organisation?unit=unit-omsorg');
      const people = page.getByRole('dialog', { name: 'Personer på Vård och omsorg' });
      // The manager of Hemtjänst Centrum, two levels down, names this unit's manager on their employment and reports
      // here with their own unit as the step; Hemtjänst between them, which nobody leads, is the unit under.
      await expect(people.getByRole('heading', { level: 3 })).toHaveText([
        'Chef',
        'Rapporterar till Amir Sjöberg',
        'Enheter under',
      ]);
      const under = people.getByRole('list', { name: 'Enheter under · Vård och omsorg' }).getByRole('listitem');
      await expect(under).toHaveText([/Hemtjänst\s*Ingen chef\s·\s0 personer, 4 med enheterna under/]);
      // A unit nobody is placed on says so and still offers its steps. It claims no line from the unit above (D147),
      // and with nobody on it there is nobody whose manager a note would be about.
      await under.getByRole('button').click();
      const hemtjanst = page.getByRole('dialog', { name: 'Personer på Hemtjänst' });
      await expect(hemtjanst.getByRole('heading', { name: 'Ingen är placerad på enheten' })).toBeVisible();
      await expect(hemtjanst).not.toContainText('Leds från');
      await expect(hemtjanst).not.toContainText('Ingen leder enheten');
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
      // The walk starts where the focus is, and after the tree only the floating way to the assistant is left: it is
      // taken from the top of the page, so every stop of the page is in it.
      await page.getByRole('link', { name: 'Hoppa till innehåll' }).focus();
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
      api.organisation = { units: [], unplaced: 0, unmanaged: 0 };
      await open(page, '/admin/organisation');
      await expect(page.getByRole('heading', { name: 'Ingen organisation ännu' })).toBeVisible();
      await expect(page.getByRole('tree')).toHaveCount(0);
      await expectNoAxeViolations(page);
      api.usersForbidden = true;
      await open(page, '/admin/organisation');
      await expect(page.getByRole('alert').filter({ hasText: 'behörighet' })).toBeVisible();
      expect(await announcements(page)).not.toContainEqual(expect.stringContaining('undefined'));
      await expectNoAxeViolations(page);
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
      // A unit's marks are in the row with its name, and the people who report to nobody are counted there.
      await expect(tree.getByRole('treeitem', { name: /^Kultur och fritid/ }).first()).toHaveAccessibleName(
        /^Kultur och fritid Saknar chef 2 personer utan chef /,
      );
      // The problems card stacks the mark, the words and the way on.
      const card = page.getByRole('region', { name: 'Att rätta i katalogen' });
      await expect(card.getByRole('listitem')).toHaveCount(4);
      await expect(card.getByRole('listitem').nth(1)).toHaveText(/^Utan chef\s*5 personer på 3 enheter har ingen chef/);
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
      // A unit with a group of its manager, and the people who report to them from other units with the units they
      // lead.
      await open(page, '/admin/organisation?unit=unit-grundskola');
      const reports = page.getByRole('dialog', { name: 'Personer på Grundskola' });
      await expect(reports.getByText('Medarbetare på Hagaskolan')).toBeVisible();
      expect(await reflowProblems(page)).toEqual([]);
      // A unit with the step up, a reporting row and a unit under it.
      await open(page, '/admin/organisation?unit=unit-omsorg');
      const under = page.getByRole('dialog', { name: 'Personer på Vård och omsorg' });
      await expect(under.getByRole('heading', { name: 'Enheter under' })).toBeVisible();
      expect(await reflowProblems(page)).toEqual([]);
      // A unit with two marks and its note, whose people each say whom they report to or why to nobody; its row, four
      // levels down, has both marks behind the sheet.
      await open(page, '/admin/organisation?unit=unit-hagaskolan');
      const gaps = page.getByRole('dialog', { name: 'Personer på Hagaskolan' });
      await expect(gaps.getByText('Chefen är avstängd')).toBeVisible();
      await expect(gaps.getByText('2 personer utan chef', { exact: true })).toBeVisible();
      expect(await reflowProblems(page)).toEqual([]);
      await gaps.getByRole('button', { name: /Stäng/ }).click();
      await expect(gaps).toBeHidden();
      await expect(tree.getByRole('treeitem', { name: /^Hagaskolan/ }).first()).toContainText('2 personer utan chef');
      expect(await reflowProblems(page)).toEqual([]);
      // The card's rows at their narrowest, the new one with three units to name.
      await expect(page.getByRole('region', { name: 'Att rätta i katalogen' }).getByRole('listitem')).toHaveCount(4);
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
