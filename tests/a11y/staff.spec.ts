import type { Page } from '@playwright/test';
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
  type MockApi,
} from './support';

/**
 * Personal (D94): the people on the units the signed-in manager manages, one card per unit, with role on the unit,
 * address and a deactivated mark; the rail's row for it; the page's own answer when the server refuses. Keyboard,
 * structure, axe and reflow, at desktop, phone and 320 px.
 *
 * Utvecklingssamtal (D96 item 7): while a round is open, each person in it has their talk's state, when, the open
 * action points and Samtal (and Boka when missing); read-only with the source named once when another system answers;
 * a status line when the calendar did not answer; and the page as before with no talks system or no open round. The
 * mock's round: Anna held, Erik and Lena booked, Sara missing, Omar outside it. The talk itself is `talk.spec.ts`.
 */
const row = (page: Page, name: string) => page.getByRole('row').filter({ hasText: name });
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
      test('read-only talks have no axe violations and every focus stop is marked', async ({ page, api }) => {
        api.talksWritable = false;
        await open(page, '/staff');
        await expect(page.getByRole('link', { name: /^Samtal med Anna Lindqvist i Personalsystemet/ })).toBeVisible();
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
    test('while a round is open each person has their talk, when, the open action points and a way into it', async ({
      page,
      api,
    }) => {
      expect(api.talksRound?.label).toBe('Utvecklingssamtal hösten 2026');
      await open(page, '/staff');
      await expect(page.getByText('Utvecklingssamtal hösten 2026 · senast mån 30 nov.', { exact: true })).toBeVisible();
      const school = page.getByRole('table').first();
      await expect(school.getByRole('columnheader')).toHaveText([
        'Person',
        'Roll',
        'E-post',
        'Samtal',
        'Åtgärdspunkter',
      ]);
      const anna = row(page, 'Anna Lindqvist');
      await expect(anna.getByText('Hållet', { exact: true })).toBeVisible();
      await expect(anna.getByText('tis 3 nov.', { exact: true })).toBeVisible();
      await expect(anna.getByRole('cell').last()).toHaveText('3');
      const erik = row(page, 'Erik Nyström');
      await expect(erik.getByText('Bokat', { exact: true })).toBeVisible();
      await expect(erik.getByText('ons 11 nov. kl. 09:00', { exact: true })).toBeVisible();
      await expect(erik.getByRole('cell').last()).toHaveText('1');
      const sara = row(page, 'Sara Pettersson');
      await expect(sara.getByText('Saknas', { exact: true })).toBeVisible();
      await expect(sara.getByRole('link', { name: 'Boka samtal med Sara Pettersson' })).toHaveAttribute(
        'href',
        '/calendar?view=week',
      );
      // Only a missing talk is booked from here.
      await expect(anna.getByRole('link', { name: /^Boka/ })).toHaveCount(0);
      await expect(erik.getByRole('link', { name: /^Boka/ })).toHaveCount(0);
      // Omar is outside the round: no badge, no count, no way into a talk.
      const omar = row(page, 'Omar Sjöberg');
      await expect(omar.getByText(/^(Saknas|Bokat|Hållet)$/)).toHaveCount(0);
      await expect(omar.getByRole('link')).toHaveCount(0);
      const link = anna.getByRole('link', { name: 'Samtal med Anna Lindqvist', exact: true });
      await expect(link).toHaveAttribute('href', '/staff?talk=anna');
      await link.focus();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL('/staff?talk=anna');
      await expect(page.getByRole('dialog', { name: 'Samtal med Anna Lindqvist' })).toBeVisible();
    });
    test('when another system answers the columns are read-only, its name is said once and Samtal opens it', async ({
      page,
      api,
    }) => {
      api.talksWritable = false;
      await open(page, '/staff');
      await expect(page.getByText(/samtalen finns i Personalsystemet$/)).toHaveCount(1);
      const anna = row(page, 'Anna Lindqvist');
      await expect(anna.getByText('Hållet', { exact: true })).toBeVisible();
      const link = anna.getByRole('link', { name: 'Samtal med Anna Lindqvist i Personalsystemet (öppnas i ny flik)' });
      await expect(link).toHaveAttribute('href', 'https://personal.clew.test/samtal/anna');
      await expect(link).toHaveAttribute('target', '_blank');
      await expect(page.getByRole('link', { name: /^Boka/ })).toHaveCount(0);
      await expect(page.getByRole('link', { name: /^Samtal med .*[^)]$/ })).toHaveCount(0);
    });
    test('when the calendar did not answer one status line says a booked talk may show as missing', async ({
      page,
      api,
    }) => {
      api.talksBookedUnknown = true;
      await open(page, '/staff');
      await expect(
        page
          .getByRole('status')
          .filter({ hasText: 'Kalendern svarade inte, så ett bokat samtal kan visas som saknat.' }),
      ).toHaveCount(1);
      await expect(row(page, 'Erik Nyström').getByText('Saknas', { exact: true })).toBeVisible();
      await expectNoAxeViolations(page);
    });
    for (const [what, set] of [
      ['no open round', (api: MockApi) => (api.talksRound = null)],
      ['no talks system', (api: MockApi) => (api.talksOffered = false)],
    ] as const)
      test(`with ${what} the page is as before`, async ({ page, api }) => {
        set(api);
        await open(page, '/staff');
        await expect(page.getByRole('table').first().getByRole('columnheader')).toHaveText([
          'Person',
          'Roll',
          'E-post',
        ]);
        await expect(page.getByRole('link', { name: /^(Samtal|Boka)/ })).toHaveCount(0);
        await expect(page.getByRole('main').getByText(/Utvecklingssamtal|Kalendern svarade inte/)).toHaveCount(0);
        await expect(page.getByRole('alert').filter({ hasText: /\S/ })).toHaveCount(0);
        await expect(page.getByRole('status').filter({ hasText: 'medarbetare' })).toHaveText(
          '5 medarbetare på 2 enheter',
        );
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
    test('the talk is in the row: its state, when, the open action points and the links', async ({ page, api }) => {
      expect(api.talksWritable).toBe(true);
      await open(page, '/staff');
      const school = page.getByRole('list', { name: 'Skönsmons skola' });
      const erik = school.getByRole('listitem').filter({ hasText: 'Erik Nyström' });
      await expect(erik.getByText('Bokat', { exact: true })).toBeVisible();
      await expect(erik.getByText('ons 11 nov. kl. 09:00', { exact: true })).toBeVisible();
      await expect(erik.getByText('1 åtgärdspunkt', { exact: true })).toBeVisible();
      const sara = school.getByRole('listitem').filter({ hasText: 'Sara Pettersson' });
      await expect(sara.getByText('0 åtgärdspunkter', { exact: true })).toBeVisible();
      await expect(sara.getByRole('link', { name: 'Boka samtal med Sara Pettersson' })).toBeVisible();
      const omar = page
        .getByRole('list', { name: 'Skönsmons fritidshem' })
        .getByRole('listitem')
        .filter({ hasText: 'Omar Sjöberg' });
      await expect(omar.getByText(/åtgärdspunkt/)).toHaveCount(0);
      await erik.getByRole('link', { name: 'Samtal med Erik Nyström', exact: true }).click();
      await expect(page).toHaveURL('/staff?talk=erik');
      await expect(page.getByRole('dialog', { name: 'Samtal med Erik Nyström' })).toBeVisible();
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
    test('the read-only list reflows at 320 px', async ({ page, api }) => {
      api.talksWritable = false;
      await page.setViewportSize(narrow);
      await open(page, '/staff');
      await expect(page.getByRole('list', { name: 'Skönsmons skola' }).getByText('Hållet')).toBeVisible();
      expect(await reflowProblems(page)).toEqual([]);
    });
  });
});
