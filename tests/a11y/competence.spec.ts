import type { Locator, Page } from '@playwright/test';
import { competenceTypes, holdingsWithOwn } from './competence';
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
 * them. The page's own answer with nothing held or required and with the module off. A certificate of the reader's own
 * added in a dialog named in the address (`add=new`, D108 item 7), what waits for the manager's decision in a card of its
 * own with "Ta tillbaka". Keyboard, structure, axe and reflow, at desktop, phone and 320 px.
 */
const OWN = '/competence';
const rail = (page: Page) => page.getByRole('navigation', { name: 'Sidonavigering' });
const tabs = (page: Page) => page.getByRole('navigation', { name: 'Kompetens', exact: true });
const switchedOn = (api: MockApi) => {
  api.competenceTypes = competenceTypes();
};
const notices = (page: Page) => page.getByRole('region', { name: 'Aviseringar' });
const addDialog = (page: Page) => page.getByRole('dialog', { name: 'Lägg till intyg' });
const addLink = (page: Page) => page.getByRole('main').getByRole('link', { name: 'Lägg till', exact: true });
/** A dialog fades in: contrast is measured once every finite animation has run, not in the instant it opens. */
const settled = (page: Page) =>
  page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter(a => a.effect?.getComputedTiming().iterations !== Infinity)
        .map(a => a.finished.catch(() => undefined)),
    ).then(() => undefined),
  );
/** Presses Tab until `target` has the focus, as a person moving through the page does; fails after `max` stops. */
async function tabTo(page: Page, target: Locator, max = 60) {
  for (let i = 0; i < max; i++) {
    if ((await target.count()) && (await target.evaluate(el => el === document.activeElement))) return;
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();
}
const twoWaiting = (api: MockApi) => {
  api.competenceOwn = {
    approver: true,
    pending: [
      {
        holdingId: 'own-1',
        typeId: 't-heta',
        competence: 'Heta arbeten',
        issuedOn: '2026-10-01',
        expiresOn: '2031-09-30',
      },
      { holdingId: 'own-3', typeId: 't-hlr', competence: 'HLR', issuedOn: '2026-09-15' },
    ],
  };
  api.competenceHoldings = holdingsWithOwn;
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

  test.describe('desktop: a certificate of the reader’s own (D108 item 7)', () => {
    test.use({ viewport: desktop });
    test('it is added by keyboard: the dialog has its address and says the manager approves it, what is missing is said on the field, and closing gives the focus back to Lägg till', async ({
      page,
      api,
    }) => {
      switchedOn(api);
      await open(page, OWN);
      const add = addLink(page);
      await tabTo(page, add);
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(`${OWN}?add=new`);
      const dialog = addDialog(page);
      await expect(dialog.getByText('Din chef behöver godkänna intyget innan det räknas.')).toBeVisible();
      await settled(page);
      await expectNoAxeViolations(page);
      // Sent with nothing chosen: what is missing is said on the field itself, which takes the focus.
      const send = dialog.getByRole('button', { name: 'Skicka för godkännande' });
      await send.focus();
      await page.keyboard.press('Enter');
      const competence = dialog.getByRole('combobox', { name: /Kompetens/ });
      await expect(competence).toHaveAttribute('aria-invalid', 'true');
      await expect(competence).toBeFocused();
      expect(api.ownWrites).toEqual([]);
      await page.keyboard.press('Enter');
      await page.getByRole('option', { name: 'HLR' }).click();
      const issued = dialog.getByLabel('Utfärdat', { exact: false }).and(page.locator('input'));
      await issued.focus();
      await page.keyboard.type('2026-10-01');
      await page.keyboard.press('Tab');
      await send.focus();
      await page.keyboard.press('Enter');
      await expect(dialog).toBeHidden();
      await expect(page).toHaveURL(OWN);
      expect(api.ownWrites).toEqual([
        { method: 'POST', path: '/competence/own/holdings', body: { typeId: 't-hlr', issuedOn: '2026-10-01' } },
      ]);
      await expect(notices(page).getByText('HLR är skickat till din chef för godkännande.')).toBeAttached();
      await expect(add).toBeFocused();
      // It waits in a card of its own, with the way to take it back.
      const waiting = page.getByRole('list', { name: 'Väntar på godkännande' });
      await expect(waiting.getByRole('listitem').filter({ hasText: 'HLR' })).toContainText('Utfärdat 1 okt. 2026');
      await expect(waiting.getByRole('button', { name: 'Ta tillbaka HLR' })).toBeVisible();
    });

    test('what waits is taken back by keyboard, the focus going to the card’s heading, then to the page’s once the card is gone', async ({
      page,
      api,
    }) => {
      switchedOn(api);
      twoWaiting(api);
      await open(page, OWN);
      const main = page.getByRole('main');
      await expect(main.getByRole('heading', { level: 2, name: 'Väntar på godkännande' })).toBeVisible();
      // What waits is in the card, not twice in the list; a rejected one stays in the list in words.
      await expect(main.getByText('Heta arbeten')).toHaveCount(2);
      await expect(
        main
          .getByRole('listitem')
          .filter({ hasText: 'Fallskydd' })
          .filter({ hasText: /avvisat/i }),
      ).toHaveCount(1);
      await expectNoAxeViolations(page);
      const first = main.getByRole('button', { name: 'Ta tillbaka Heta arbeten' });
      await tabTo(page, first);
      await page.keyboard.press('Enter');
      await expect(first).toHaveCount(0);
      expect(api.ownWrites).toEqual([{ method: 'DELETE', path: '/competence/own/holdings/own-1' }]);
      await expect(notices(page).getByText('Heta arbeten är tagen tillbaka.')).toBeAttached();
      await expect(main.getByRole('heading', { level: 2, name: 'Väntar på godkännande' })).toBeFocused();
      await tabTo(page, main.getByRole('button', { name: 'Ta tillbaka HLR' }));
      await page.keyboard.press('Enter');
      await expect(main.getByRole('heading', { level: 2, name: 'Väntar på godkännande' })).toHaveCount(0);
      await expect(page.getByRole('heading', { level: 1, name: 'Mina kompetenser' })).toBeFocused();
    });

    test('someone who reports to nobody is told it cannot be sent before anything is filled in, and Esc closes to Lägg till', async ({
      page,
      api,
    }) => {
      switchedOn(api);
      api.competenceOwn = { approver: false, pending: [] };
      await open(page, `${OWN}?add=new`);
      const dialog = addDialog(page);
      await expect(
        dialog.getByText(/Registreringen kan inte skickas: ingen chef är registrerad för dig\./),
      ).toBeVisible();
      await expect(dialog.getByRole('combobox')).toHaveCount(0);
      await expect(dialog.getByRole('button', { name: 'Skicka för godkännande' })).toHaveCount(0);
      await settled(page);
      await expectNoAxeViolations(page);
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(page).toHaveURL(OWN);
      await expect(addLink(page)).toBeFocused();
      expect(api.ownWrites).toEqual([]);
    });

    test('the server’s refusal stands beside the buttons and what was chosen stays', async ({ page, api }) => {
      switchedOn(api);
      api.ownFail = 'Du har redan en registrering av den kompetensen som väntar på godkännande.';
      await open(page, `${OWN}?add=new`);
      const dialog = addDialog(page);
      await dialog.getByRole('combobox', { name: /Kompetens/ }).click();
      await page.getByRole('option', { name: 'Fallskydd' }).click();
      const issued = dialog.getByLabel('Utfärdat', { exact: false }).and(page.locator('input'));
      await issued.focus();
      await page.keyboard.type('2026-09-01');
      await page.keyboard.press('Tab');
      await dialog.getByRole('button', { name: 'Skicka för godkännande' }).click();
      await expect(
        dialog
          .getByRole('alert')
          .filter({ hasText: 'Du har redan en registrering av den kompetensen som väntar på godkännande.' }),
      ).toBeVisible();
      await expect(dialog.getByRole('combobox', { name: /Kompetens/ })).toContainText('Fallskydd');
      await expect(page).toHaveURL(`${OWN}?add=new`);
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
    test('the page, what waits and the dialog reflow at 320 px', async ({ page, api }) => {
      switchedOn(api);
      twoWaiting(api);
      await page.setViewportSize(narrow);
      await open(page, OWN);
      await expect(tabs(page).getByRole('link', { name: 'Medarbetare' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Ta tillbaka HLR' })).toBeVisible();
      expect(await reflowProblems(page)).toEqual([]);
      await open(page, `${OWN}?add=new`);
      await expect(addDialog(page).getByRole('button', { name: 'Skicka för godkännande' })).toBeVisible();
      expect(await reflowProblems(page)).toEqual([]);
    });
  });
});
