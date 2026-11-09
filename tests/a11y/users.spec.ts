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
 * Användare (D62, D68, D85): the provisioned people with unit, role, capabilities and whether they have signed in, and the
 * mapping from a group to a capability that an administrator adds and removes. Keyboard, structure, announcements, axe and
 * reflow, at desktop, phone and 320 px.
 */
test.describe('users administration', () => {
  for (const [layout, viewport] of [
    ['desktop', desktop],
    ['phone', phone],
  ] as const)
    test.describe(layout, () => {
      test.use({ viewport });
      test('the page has no axe violations and every focus stop is marked', async ({ page, api }) => {
        api.admin = true;
        await open(page, '/admin/users');
        await expect(page.getByRole('heading', { level: 1, name: 'Användare' })).toBeVisible();
        await expectNoAxeViolations(page);
        const { unmarked } = await hiddenFocusStops(page);
        expect(unmarked).toEqual([]);
      });
    });
  test.describe('desktop', () => {
    test.use({ viewport: desktop });
    test('the list says where each person belongs, what they may do and whether they have signed in', async ({
      page,
      api,
    }) => {
      api.admin = true;
      await open(page, '/admin/users');
      await expect(page).toHaveTitle('Användare · Startsidan');
      await expect(page.getByRole('link', { name: 'Användare', exact: true })).toHaveAttribute('aria-current', 'page');
      const people = page.getByRole('table').first();
      await expect(people.getByText('Hillevi Berg')).toBeVisible();
      await expect(people.getByText('Bergsåkers skola · chef')).toBeVisible();
      await expect(people.getByText('Administrera användare', { exact: true })).toBeVisible();
      await expect(people.getByText('Har loggat in', { exact: true })).toHaveCount(2);
      await expect(people.getByText('Inte inloggad ännu', { exact: true })).toBeVisible();
      await expect(people.getByText('Ingen åtkomst', { exact: true })).toBeVisible();
      await expect(page.getByRole('table').nth(1).getByText('IT-personal')).toBeVisible();
    });
    test('a group is mapped to a capability by keyboard, said aloud, and taken back again', async ({ page, api }) => {
      api.admin = true;
      await open(page, '/admin/users');
      const form = page.getByRole('form', { name: 'Lägg till behörighet från grupp' });
      const group = form.getByRole('combobox', { name: 'Grupp' });
      await group.focus();
      await page.keyboard.press('Enter');
      await page.getByRole('option', { name: 'Rektorer' }).click();
      const gives = form.getByRole('combobox', { name: 'Ger behörigheten' });
      await gives.focus();
      await page.keyboard.press('Enter');
      await page.getByRole('option', { name: 'Administrera anslutna system' }).click();
      await form.getByRole('button', { name: 'Lägg till' }).click();
      await expect
        .poll(() => announcements(page))
        .toContainEqual(expect.stringContaining('Sparat: Rektorer ger administrera anslutna system'));
      const mapping = page.getByRole('table').nth(1);
      await expect(mapping.getByText('Rektorer', { exact: true })).toBeVisible();
      await expectNoAxeViolations(page);
      await mapping.getByRole('button', { name: 'Ta bort: Rektorer ger administrera anslutna system' }).click();
      await expect.poll(() => announcements(page)).toContainEqual(expect.stringContaining('Borttaget: Rektorer'));
      await expect(mapping.getByText('Rektorer', { exact: true })).toHaveCount(0);
    });
    test('without admin.users the server says no and the page says so', async ({ page, api }) => {
      api.admin = true;
      api.usersForbidden = true;
      await open(page, '/admin/users');
      // Astryx keeps an empty assertive live region on every page; the page's own alert is the one with words.
      await expect(page.getByRole('alert').filter({ hasText: 'behörighet' })).toBeVisible();
    });
  });
  test.describe('1.4.10 reflow', () => {
    test('the page reflows at 320 px', async ({ page, api }) => {
      api.admin = true;
      await page.setViewportSize(narrow);
      await open(page, '/admin/users');
      await expect(page.getByRole('list', { name: 'Personer' })).toBeVisible();
      expect(await reflowProblems(page)).toEqual([]);
    });
  });
});
