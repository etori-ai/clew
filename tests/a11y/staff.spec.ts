import {
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
 * Personal (D94): the people on the units the signed-in manager manages, one card per unit, with role on the unit,
 * address and a deactivated mark; the rail's row for it; the page's own answer when the server refuses. Keyboard,
 * structure, axe and reflow, at desktop, phone and 320 px.
 */
test.describe('Personal', () => {
  for (const [layout, viewport] of [
    ['desktop', desktop],
    ['phone', phone],
  ] as const)
    test.describe(layout, () => {
      test.use({ viewport });
      test('the page has no axe violations and every focus stop is marked', async ({ page, api }) => {
        // The api fixture installs the mock; the session it serves is a manager who is not an administrator.
        api.admin = false;
        await open(page, '/staff');
        await expect(page.getByRole('heading', { level: 1, name: 'Personal' })).toBeVisible();
        await expect(page.getByText('Anna Lindqvist')).toBeVisible();
        await expectNoAxeViolations(page);
        const { unmarked } = await hiddenFocusStops(page);
        expect(unmarked).toEqual([]);
      });
    });
  test.describe('desktop', () => {
    test.use({ viewport: desktop });
    test('a manager reaches it from the rail and sees each unit with its people, their role and a deactivated mark', async ({
      page,
      api,
    }) => {
      expect(api.staff.units).toHaveLength(2);
      await open(page, '/');
      const row = page.getByRole('link', { name: 'Personal', exact: true });
      await expect(row).toBeVisible();
      await row.click();
      await expect(page).toHaveURL(/\/staff$/);
      await expect(page).toHaveTitle('Personal · Startsidan');
      await expect(page.getByRole('link', { name: 'Personal', exact: true })).toHaveAttribute('aria-current', 'page');
      // Astryx keeps empty live regions on every page; the page's own status is the one with words.
      await expect(page.getByRole('status').filter({ hasText: 'medarbetare' })).toHaveText(
        '5 medarbetare på 2 enheter',
      );
      await expect(page.getByRole('toolbar', { name: 'Skönsmons skola' })).toContainText('3 medarbetare');
      const school = page.getByRole('table').first();
      await expect(school.getByText('Anna Lindqvist')).toBeVisible();
      await expect(school.getByText('anna.lindqvist@clew.test')).toBeVisible();
      await expect(school.getByText('Medarbetare', { exact: true })).toHaveCount(3);
      await expect(school.getByText('Avstängd', { exact: true })).toBeVisible();
      const fritids = page.getByRole('table').nth(1);
      await expect(fritids.getByText('Omar Sjöberg')).toBeVisible();
      await expect(fritids.getByText('Chef', { exact: true })).toBeVisible();
      // The manager reading is never listed among their own people (the header still names them).
      await expect(page.getByRole('table').getByText('Testa Testsson')).toHaveCount(0);
    });
    test('when the server refuses, the page says whom it is for and offers the way back', async ({ page, api }) => {
      api.staffForbidden = true;
      await open(page, '/staff');
      await expect(page.getByRole('heading', { level: 2, name: 'Sidan Personal är för chefer' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Till startsidan' })).toBeVisible();
      await expectNoAxeViolations(page);
    });
  });
  test.describe('phone', () => {
    test.use({ viewport: phone });
    test('each unit is a list with the role and the address under the name', async ({ page, api }) => {
      api.admin = false;
      await open(page, '/staff');
      const school = page.getByRole('list', { name: 'Skönsmons skola' });
      await expect(school.getByText('Anna Lindqvist')).toBeVisible();
      await expect(school.getByText('Medarbetare · anna.lindqvist@clew.test')).toBeVisible();
      await expect(school.getByText('Avstängd', { exact: true })).toBeVisible();
      await expect(
        page.getByRole('list', { name: 'Skönsmons fritidshem' }).getByText('Chef · omar.sjoberg@clew.test'),
      ).toBeVisible();
    });
  });
  test.describe('1.4.10 reflow', () => {
    test('the page reflows at 320 px', async ({ page, api }) => {
      api.admin = false;
      await page.setViewportSize(narrow);
      await open(page, '/staff');
      await expect(page.getByRole('list', { name: 'Skönsmons skola' })).toBeVisible();
      expect(await reflowProblems(page)).toEqual([]);
    });
  });
});
