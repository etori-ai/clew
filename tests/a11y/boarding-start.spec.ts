import type { Locator, Page } from '@playwright/test';
import { ANNA, BoardingMock, MARIA } from './boarding';
import { announcements, expect, expectNoAxeViolations, narrow, open, phone, reflowProblems, test } from './support';

/**
 * Starting an introduction or a leaving (D124 items 1, 7 and 8): the manager's dialog over the plan's page, the action
 * dialog's two steps (the `form-wizard-dialog` template). "Uppgifter": the day, an introduction's prefilled from the
 * employment's start date, a leaving's entered; a buddy among the manager's other reports, or none. "Det här händer":
 * the layers that apply and how many items each gives, who gets how many, and that nothing is ordered or sent. Nothing
 * is written before the last button; the page then shows the plan, a toast says it, and the focus is on the heading.
 * `?start=` opens it, so a link can; closing drops it and gives the focus back to what opened it, also when the address
 * did. A refusal of the day is placed on its field, a refusal of the start stands under the buttons. Keyboard only,
 * axe and reflow. The mock's clock stands at 2026-11-04; Maria's employment starts 1 December.
 */
const wide = { width: 1440, height: 900 };
const EMPTY = `/boarding/${MARIA}?from=%2Fstaff`;
const notices = (page: Page) => page.getByRole('region', { name: 'Aviseringar' });
const said = async (page: Page, text: string) => (await announcements(page)).some(t => t.includes(text));
const dialogOf = (page: Page, name: string) => page.getByRole('dialog', { name });
/** Text drawn in the dialog, not its copy in the dialog's live region (a field's status is also said there). */
const drawn = (page: Page, scope: Locator, text: string) =>
  scope.getByText(text, { exact: true }).and(page.locator(':not([aria-live])'));
const dateIn = (page: Page, label: string) =>
  page.getByRole('dialog').getByLabel(label, { exact: false }).and(page.locator('input'));
/** The dialog fades in: contrast is measured once every finite animation has run, not in the instant it opens. */
const settled = (page: Page) =>
  page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter(a => a.effect?.getComputedTiming().iterations !== Infinity)
        .map(a => a.finished.catch(() => undefined)),
    ).then(() => undefined),
  );

test.describe('the start dialog', () => {
  test.use({ viewport: wide });

  test('by keyboard alone: the day prefilled, a buddy chosen, what happens read, the plan started and its heading focused', async ({
    page,
    api,
  }) => {
    const boarding = (api.boarding = new BoardingMock());
    await open(page, EMPTY);
    const start = page.getByRole('main').getByRole('button', { name: 'Starta introduktion' });
    await start.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(`${EMPTY}&start=introduction`);
    const dialog = dialogOf(page, 'Förbered introduktionen');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('För Maria Källström')).toBeVisible();
    await expect(dateIn(page, 'Första dagen')).toHaveValue('1 december 2026');
    await expect(dialog.getByText(/Förslaget är anställningens startdatum i katalogen/)).toBeVisible();
    await settled(page);
    await expectNoAxeViolations(page);

    // The buddy: the field's own keys open it and choose.
    const buddy = dialog.getByRole('combobox', { name: /Fadder/ });
    await buddy.focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(buddy).toContainText('Erik Sandström');
    await dialog.getByRole('button', { name: 'Nästa' }).focus();
    await page.keyboard.press('Enter');

    // Det här händer: the layers, who gets what, and that nothing is ordered or sent; the step's heading has the focus.
    const effect = dialog.getByRole('heading', { name: 'När du trycker Starta introduktionen' });
    await expect(effect).toBeFocused();
    await expect(dialog.getByText('Första dagen', { exact: true })).toBeVisible();
    await expect(dialog.getByText('tisdag 1 december', { exact: true })).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Planen får 3 punkter från 2 lager' })).toBeVisible();
    await expect(dialog.getByText('Alla nyanställda', { exact: true })).toBeVisible();
    await expect(dialog.getByText('Alla anställda', { exact: true })).toBeVisible();
    await expect(dialog.getByText('Enhet: Skönsmons skola och enheterna under den', { exact: true })).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Vem som får vad' })).toBeVisible();
    await expect(
      dialog.getByText('2 punkter i Att göra, den första senast tis 17 nov.', { exact: true }),
    ).toBeVisible();
    await expect(dialog.getByText('1 punkt i Att göra, den första senast fre 4 dec.', { exact: true })).toBeVisible();
    await expect(dialog.getByText(/^Inget beställs, bokas eller skickas till något annat system/)).toBeVisible();
    expect(boarding.writes).toEqual([
      {
        method: 'POST',
        path: '/boarding/preview',
        body: { personId: MARIA, event: 'introduction', anchorOn: '2026-12-01', buddyId: 'erik' },
      },
    ]);
    await expectNoAxeViolations(page);

    await dialog.getByRole('button', { name: 'Starta introduktionen' }).focus();
    await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden();
    expect(boarding.writes.at(-1)).toEqual({
      method: 'POST',
      path: '/boarding/plans',
      body: { personId: MARIA, event: 'introduction', anchorOn: '2026-12-01', buddyId: 'erik' },
    });
    const id = boarding.plans.at(-1)!.id;
    await expect(page).toHaveURL(`/boarding/${MARIA}?from=%2Fstaff&plan=${id}`);
    await expect(notices(page).getByText('Introduktionen för Maria Källström är startad.')).toBeAttached();
    const title = page.getByRole('heading', { level: 1, name: 'Introduktion för Maria Källström' });
    await expect(title).toBeFocused();
    await expect(page.getByRole('main').getByRole('checkbox')).toHaveCount(3);
    // Back does not open the dialog again: the start replaced its address.
    await page.goBack();
    await expect(page).toHaveURL(EMPTY);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('Esc closes it, nothing sent, and gives the focus back to the button; a missing day is said on its field', async ({
    page,
    api,
  }) => {
    const boarding = (api.boarding = new BoardingMock());
    await open(page, EMPTY);
    const start = page.getByRole('main').getByRole('button', { name: 'Starta avslut' });
    await start.click();
    const dialog = dialogOf(page, 'Förbered avslutet');
    await expect(dialog).toBeVisible();
    // A leaving's last day is the manager's to enter: nothing is prefilled.
    const day = dateIn(page, 'Sista dagen');
    await expect(day).toHaveValue('');
    await dialog.getByRole('button', { name: 'Nästa' }).click();
    await expect(drawn(page, dialog, 'Välj sista dagen.')).toBeVisible();
    await expect(day).toBeFocused();
    await expectNoAxeViolations(page);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(EMPTY);
    await expect(start).toBeFocused();
    expect(boarding.writes).toEqual([]);
  });

  test('opened from the address, closing gives the focus to the page’s way into it', async ({ page, api }) => {
    api.boarding = new BoardingMock();
    await open(page, `${EMPTY}&start=leaving`);
    const dialog = dialogOf(page, 'Förbered avslutet');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Avbryt' }).click();
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(EMPTY);
    await expect(page.getByRole('main').getByRole('button', { name: 'Starta avslut' })).toBeFocused();
    // Over a plan, the way in is the plan's menu.
    await open(page, `/boarding/${ANNA}?from=%2Fstaff&start=leaving`);
    const leaving = dialogOf(page, 'Förbered avslutet');
    await expect(leaving).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(leaving).toBeHidden();
    await expect(page.getByRole('main').getByRole('button', { name: 'Fler åtgärder' })).toBeFocused();
    // A second introduction would be refused: the address that asks for one opens nothing and is let go of.
    await open(page, `/boarding/${ANNA}?from=%2Fstaff&start=introduction`);
    await expect(page).toHaveURL(`/boarding/${ANNA}?from=%2Fstaff`);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('a day the server refuses is said on its field; a refused start stands under the buttons and keeps the dialog', async ({
    page,
    api,
  }) => {
    const boarding = (api.boarding = new BoardingMock());
    boarding.previewRefusal = 'Dagen ska ligga högst ett år före eller efter i dag.';
    boarding.refusal = 'Personen har redan en pågående introduktion.';
    await open(page, `${EMPTY}&start=introduction`);
    const dialog = dialogOf(page, 'Förbered introduktionen');
    await dialog.getByRole('button', { name: 'Nästa' }).click();
    await expect(drawn(page, dialog, 'Dagen ska ligga högst ett år före eller efter i dag.')).toBeVisible();
    await expect(dateIn(page, 'Första dagen')).toBeFocused();
    await expect(dialog.getByRole('heading', { name: /^När du trycker/ })).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Nästa' }).click();
    await expect(dialog.getByRole('heading', { name: 'När du trycker Starta introduktionen' })).toBeFocused();
    await dialog.getByRole('button', { name: 'Starta introduktionen' }).click();
    const alert = dialog
      .getByRole('alert')
      .filter({ hasText: 'Personen har redan en pågående introduktion.' })
      .and(page.locator(':not([aria-live])'));
    await expect(alert).toBeVisible();
    await expect.poll(() => said(page, 'Personen har redan en pågående introduktion.')).toBe(true);
    await expect(dialog).toBeVisible();
    await expect(page).toHaveURL(`${EMPTY}&start=introduction`);
    await expectNoAxeViolations(page);
    // "Ändra" goes back to the fields with the day kept.
    await dialog.getByRole('button', { name: 'Ändra' }).click();
    await expect(dateIn(page, 'Första dagen')).toHaveValue('1 december 2026');
  });
});

test.describe('the start dialog on small screens', () => {
  test('on a phone it fills the screen with its buttons at the foot; at 320 px both steps reflow', async ({
    page,
    api,
  }) => {
    api.boarding = new BoardingMock();
    await page.setViewportSize(phone);
    await open(page, `${EMPTY}&start=introduction`);
    const dialog = dialogOf(page, 'Förbered introduktionen');
    await expect(dialog).toBeVisible();
    await settled(page);
    await expectNoAxeViolations(page);
    await page.setViewportSize(narrow);
    expect(await reflowProblems(page, dialog)).toEqual([]);
    await dialog.getByRole('button', { name: 'Nästa' }).click();
    await expect(dialog.getByRole('heading', { name: 'När du trycker Starta introduktionen' })).toBeFocused();
    expect(await reflowProblems(page, dialog)).toEqual([]);
    await expectNoAxeViolations(page);
  });
});
