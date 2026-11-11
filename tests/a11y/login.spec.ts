import { desktop, expect, expectNoAxeViolations, narrow, reflowProblems, test } from './support';

const personas = [
  { userName: 'hillevi', name: 'Hillevi Berg' },
  { userName: 'hassan', name: 'Hassan Ali' },
  { userName: 'mikael', name: 'Mikael Lund' },
];

test('without the development sign-in the page offers only the provider', async ({ page, api }) => {
  api.signedIn = false;
  await page.goto('/login');
  await expect(page.getByRole('link', { name: 'Logga in', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Logga in som' })).toHaveCount(0);
});

for (const viewport of [desktop, narrow])
  test(`the development sign-in lists the personas as links at ${viewport.width}px`, async ({ page, api }) => {
    api.signedIn = false;
    api.devAccounts = personas;
    await page.setViewportSize(viewport);
    await page.goto('/calendar');
    const list = page.getByRole('list', { name: /Logga in som/ });
    await expect(list).toBeVisible();
    const hillevi = list.getByRole('link', { name: /Hillevi Berg/ });
    await expect(hillevi).toHaveAttribute('href', '/api/auth/dev/login?as=hillevi&returnTo=%2Fcalendar');
    await expect(list.getByRole('link')).toHaveCount(3);
    // The provider's sign-in stays first in tab order; the personas follow it.
    await page.getByRole('link', { name: 'Logga in', exact: true }).focus();
    await page.keyboard.press('Tab');
    await expect(hillevi).toBeFocused();
    await expectNoAxeViolations(page);
    if (viewport === narrow) expect(await reflowProblems(page)).toEqual([]);
  });
