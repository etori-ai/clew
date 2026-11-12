import type { Page } from '@playwright/test';
import { competenceTypes } from './competence';
import {
  desktop,
  expect,
  expectNoAxeViolations,
  hiddenFocusStops,
  narrow,
  open,
  openNav,
  phone,
  reflowProblems,
  test,
  type MockApi,
} from './support';

/**
 * Kompetens › Mina kompetenser (D120 item 8) at `/competence`: a place in the rail for everyone while the competence
 * module is switched on for them, the reader's own holdings drawn from `competence.holdings` by the declared view, a
 * required type they lack as "Saknas", and for a manager the place's pages as tabs that are links, the matrix one of
 * them. The page's own answer with nothing held or required and with the module off. Keyboard, structure, axe and
 * reflow, at desktop, phone and 320 px.
 */
const OWN = '/competence';
const rail = (page: Page) => page.getByRole('navigation', { name: 'Sidonavigering' });
const tabs = (page: Page) => page.getByRole('navigation', { name: 'Kompetens', exact: true });
const switchedOn = (api: MockApi) => {
  api.competenceTypes = competenceTypes();
};

test.describe('Kompetens › Mina kompetenser', () => {
  for (const [layout, viewport] of [
    ['desktop', desktop],
    ['phone', phone],
  ] as const)
    test.describe(layout, () => {
      test.use({ viewport });
      test('the page has no axe violations and every focus stop is marked', async ({ page, api }) => {
        switchedOn(api);
        await open(page, OWN);
        await expect(page.getByRole('heading', { level: 1, name: 'Mina kompetenser' })).toBeVisible();
        await expect(page.getByRole('main').getByRole('listitem').filter({ hasText: 'Fallskydd' })).toBeVisible();
        await expectNoAxeViolations(page);
        const { unmarked } = await hiddenFocusStops(page);
        expect(unmarked).toEqual([]);
      });
    });

  test.describe('desktop', () => {
    test.use({ viewport: desktop });
    test('reached from the rail: the own holdings, what is missing said in words, and the tab that leads to the matrix', async ({
      page,
      api,
    }) => {
      switchedOn(api);
      await open(page, '/');
      const place = rail(page).getByRole('link', { name: 'Kompetens', exact: true });
      await place.focus();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(OWN);
      await expect(page).toHaveTitle('Mina kompetenser · Startsidan');
      await expect(place).toHaveAttribute('aria-current', 'page');
      const main = page.getByRole('main');
      // A required type the reader lacks is a row of its own, its status in words beside the badge's colour.
      await expect(main.getByRole('listitem').filter({ hasText: 'Fallskydd' })).toContainText(/saknas/i);
      await expect(main.getByRole('listitem').filter({ hasText: 'Heta arbeten' })).toContainText(/utgånget/i);
      // The place's pages as tabs that are links, the current one marked; the matrix is one of them for a manager.
      await expect(tabs(page).getByRole('link')).toHaveCount(2);
      await expect(tabs(page).getByRole('link', { name: 'Mina kompetenser' })).toHaveAttribute('aria-current', 'true');
      const matrix = tabs(page).getByRole('link', { name: 'Medarbetare' });
      await expect(matrix).toHaveAttribute('href', '/competence/matrix');
      await matrix.focus();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL('/competence/matrix');
      await expect(page.getByRole('heading', { level: 1, name: 'Medarbetarnas kompetens' })).toBeVisible();
      // The rail keeps Kompetens as the place on both pages.
      await expect(place).toHaveAttribute('aria-current', 'page');
      await page.goBack();
      await expect(page).toHaveURL(OWN);
      await expect(page.getByRole('heading', { level: 1, name: 'Mina kompetenser' })).toBeVisible();
    });

    test('the rail draws Kompetens only while the module is on, and an address from before gets the page’s answer', async ({
      page,
      api,
    }) => {
      await open(page, '/');
      await expect(rail(page).getByRole('link', { name: /^Hem/ })).toBeVisible();
      await expect(rail(page).getByRole('link', { name: 'Kompetens', exact: true })).toHaveCount(0);
      await open(page, OWN);
      await expect(page.getByRole('heading', { level: 2, name: 'Kompetens är inte påslaget för dig' })).toBeVisible();
      await expect(tabs(page)).toHaveCount(0);
      await expectNoAxeViolations(page);
      switchedOn(api);
      await open(page, '/');
      await expect(rail(page).getByRole('link', { name: 'Kompetens', exact: true })).toBeVisible();
    });

    test('someone who manages nobody has the page without tabs, and nothing held or required is said as such', async ({
      page,
      api,
    }) => {
      switchedOn(api);
      api.employee = true;
      api.competenceHoldings = { rows: [] };
      await open(page, OWN);
      await expect(page.getByRole('heading', { level: 1, name: 'Mina kompetenser' })).toBeVisible();
      await expect(tabs(page)).toHaveCount(0);
      await expect(
        page.getByRole('heading', { level: 2, name: 'Inget registrerat och inget som krävs' }),
      ).toBeVisible();
      await expectNoAxeViolations(page);
    });
  });

  test.describe('phone', () => {
    test.use({ viewport: phone });
    test('the place is in the rail’s drawer and the page reads as a list', async ({ page, api }) => {
      switchedOn(api);
      await open(page, '/');
      const nav = await openNav(page);
      await nav.getByRole('link', { name: 'Kompetens', exact: true }).click();
      await expect(page).toHaveURL(OWN);
      await expect(page.getByRole('main').getByRole('listitem').filter({ hasText: 'HLR' })).toBeVisible();
      await expectNoAxeViolations(page);
    });
  });

  test.describe('1.4.10 reflow', () => {
    test('the page reflows at 320 px', async ({ page, api }) => {
      switchedOn(api);
      await page.setViewportSize(narrow);
      await open(page, OWN);
      await expect(tabs(page).getByRole('link', { name: 'Medarbetare' })).toBeVisible();
      expect(await reflowProblems(page)).toEqual([]);
    });
  });
});
