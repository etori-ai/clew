import type { Page } from '@playwright/test';
import {
  answer,
  composer,
  desktop,
  expect,
  focused,
  hiddenFocusStops,
  open,
  quietDay,
  snoozeFirst,
  test,
} from './support';

test.use({ viewport: desktop });

/**
 * Inte nu on the first row, from the keyboard (artboards A and E): the row's title opens its card beside the column, where
 * Inte nu stands in the panel's header. At 1440 px the panel fits beside the column.
 */
async function openSnoozeRows(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('main').getByRole('listitem').getByRole('link').first().focus();
  await page.keyboard.press('Enter');
  const panel = page.getByRole('complementary', { name: 'Kort' });
  await expect(panel.locator('[aria-level="2"]').filter({ hasText: 'Kort' })).toBeFocused();
  await panel.getByRole('button', { name: 'Inte nu', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitem', { name: /^I morgon/ })).toBeVisible();
}

test.describe('2.4.7 focus visible', () => {
  for (const path of ['/', '/?tab=done', '/calendar'])
    test(`every stop on ${path} shows a focus ring`, async ({ page, api: _ }) => {
      await open(page, path);
      const { unmarked } = await hiddenFocusStops(page);
      expect(unmarked).toEqual([]);
    });

  test('a card that receives focus from the page shows it', async ({ page, api: _ }) => {
    await open(page, '/');
    await openSnoozeRows(page);
    await page.getByRole('menuitem', { name: /^I morgon/ }).focus();
    await page.keyboard.press('Enter');
    // The next thread is a row (D31): its title link takes the focus, and the ring is on the link.
    const title = page.locator('#thread-samtal').getByRole('link', { name: 'Planera utvecklingssamtal', exact: true });
    await expect(title).toBeFocused();
    expect(
      await title.evaluate(
        el => getComputedStyle(el).outlineStyle !== 'none' || getComputedStyle(el).boxShadow !== 'none',
      ),
    ).toBe(true);
  });
});

test.describe('2.4.3 focus order', () => {
  test('regaining the window keeps focus where it was', async ({ page, api }) => {
    await open(page, '/');
    const button = page.getByRole('main').getByRole('button', { name: 'Lägg till i samtalet' }).first();
    await button.focus();
    api.sessionDelay = 200;
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForTimeout(350);
    expect((await focused(page)).text).toBe('Lägg till i samtalet');
  });

  test('a row leads to its card in the panel, and gets the focus back when the panel closes', async ({
    page,
    api: _,
  }) => {
    await open(page, '/');
    const title = 'Omtankesamtal med Anna Lindqvist';
    const expand = page.getByRole('link', { name: title, exact: true });
    await expect(page.locator('#thread-omtanke')).not.toHaveAttribute('aria-current', 'true');
    await expand.focus();
    await page.keyboard.press('Enter');
    // At this width the panel is over the page: a dialog named for what it holds, with the focus in it.
    const panel = page.getByRole('dialog', { name: 'Kort', exact: true });
    await expect(panel.getByRole('heading', { name: title })).toBeVisible();
    await expect.poll(() => panel.evaluate(el => el.contains(document.activeElement))).toBe(true);
    await expect(page).toHaveURL(/\/\?card=omtanke$/);
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(expand).toBeFocused();
    await expect(page.locator('#thread-omtanke')).not.toHaveAttribute('aria-current', 'true');
  });

  test('Inte nu moves focus to the next card instead of losing it', async ({ page, api: _ }) => {
    await open(page, '/');
    await openSnoozeRows(page);
    await page.getByRole('menuitem', { name: /^I morgon/ }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('region', { name: 'Aviseringar' })).toBeVisible();
    await expect(
      page.locator('#thread-samtal').getByRole('link', { name: 'Planera utvecklingssamtal', exact: true }),
    ).toBeFocused();
  });

  test('Ångra in the toast stays available and reachable by keyboard', async ({ page, api: _ }) => {
    await page.clock.install({ time: new Date('2026-11-04T08:00:00.000Z') });
    // At 1440 px the card stands beside the column, so the whole page stays reachable after Inte nu.
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, '/');
    await snoozeFirst(page);
    const undo = page.getByRole('button', { name: 'Ångra' });
    await expect(undo).toBeVisible();
    await page.clock.fastForward('00:30');
    await expect(undo, 'the toast has no time limit (2.2.1)').toBeVisible();
    const { stops } = await hiddenFocusStops(page);
    expect(
      stops.some(stop => stop.includes('Ångra')),
      'the Tab order reaches the toast',
    ).toBe(true);
    await undo.focus();
    await page.keyboard.press('Enter');
    // The card is back beside the column, where its next step is drawn in full.
    await expect(page.getByRole('button', { name: 'Attestera 2 valda' })).toBeVisible();
  });

  test('the side panel can be closed with a button and hands focus back', async ({ page, api }) => {
    quietDay(api);
    await open(page, '/');
    await page.getByRole('group', { name: 'Områden' }).getByRole('button', { name: 'Personal' }).click();
    const trigger = page
      .getByRole('group', { name: 'Personal', exact: true })
      .getByRole('link', { name: 'Vem är på plats?' });
    await trigger.focus();
    await page.keyboard.press('Enter');
    const panel = page.getByRole('dialog');
    await expect(panel).toBeVisible();
    await panel.getByRole('button', { name: 'Stäng' }).click();
    await expect(panel).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('Esc closes the conversation and focus stays in the row', async ({ page, api: _ }) => {
    await open(page, '/');
    const input = composer(page);
    await input.fill('Vem är på plats?');
    await input.press('Enter');
    await expect(answer(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(answer(page)).toBeHidden();
    await expect(input).toBeFocused();
  });
});

test.describe('D26 a source becomes a chip', () => {
  test("Lägg till i samtalet in the sources view puts the passage in the row's drawer and says so on the row", async ({
    page,
    api: _,
  }) => {
    await open(page, '/?open=clew.search&open-title=K%C3%A4llor&open-input=%7B%22query%22%3A%22fall%22%7D');
    const panel = page.getByRole('dialog');
    const add = panel
      .getByRole('list', { name: 'Källor' })
      .getByRole('listitem')
      .nth(0)
      .getByRole('button', { name: 'Lägg till i samtalet' });
    await add.focus();
    await page.keyboard.press('Enter');
    await expect(panel.getByRole('button', { name: 'I samtalet', exact: true })).toHaveCount(1);
    await panel.getByRole('button', { name: 'Stäng' }).click();
    await expect(
      page
        .getByRole('group', { name: 'Objekt i samtalet' })
        .or(page.getByText('Rutin vid fall i ordinärt boende').first()),
    ).toBeVisible();
  });
});

test.describe('D29 the Inte nu picker', () => {
  test('every row says when the card comes back, and the free text has a label and a live answer', async ({
    page,
    api: _,
  }) => {
    // The open card's one time action stands in the panel's header (artboard E); a row has only its next step.
    await open(page, '/?card=fakturor');
    await page.getByRole('button', { name: 'Inte nu', exact: true }).first().click();
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    for (const row of [
      'Om en timme',
      'Efter lunch',
      'I morgon',
      'Nästa vecka',
      'När jag är tillbaka från Ledningsgrupp',
    ])
      await expect(menu.getByRole('menuitem', { name: new RegExp('^' + row) })).toBeVisible();
    await expect(menu.getByText('06:00 · i genomgången')).toBeVisible();
    await menu.getByRole('menuitem', { name: /^Skriv själv/ }).click();
    // The card is open in the panel, a dialog too at this width: the picker's own dialog is the one meant.
    const dialog = page.getByRole('dialog', { name: 'När ska jag ta upp det igen?' });
    await expect(dialog).toBeVisible();
    const field = dialog.getByRole('textbox', { name: 'När?' });
    await field.fill('fredag kl 9');
    await expect(dialog.getByRole('button', { name: /^Ta upp fre 09:00/ })).toBeEnabled();
    await field.fill('när grisarna flyger');
    await expect(field).toHaveAttribute('aria-invalid', 'true');
    await expect(dialog.getByRole('button', { name: /^Ta upp/ })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    expect((await focused(page)).text).toBe('Inte nu');
  });
});
