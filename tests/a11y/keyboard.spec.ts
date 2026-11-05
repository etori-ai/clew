import { answer, composer, desktop, expect, focused, hiddenFocusStops, open, snoozeFirst, test } from './support';

test.use({ viewport: desktop });

test.describe('2.4.7 focus visible', () => {
  for (const path of ['/', '/oversikt', '/hanterat', '/kalender']) test(`every stop on ${path} shows a focus ring`, async ({ page, api: _ }) => {
    await open(page, path);
    const { unmarked } = await hiddenFocusStops(page);
    expect(unmarked).toEqual([]);
  });

  test('a card that receives focus from the page shows it', async ({ page, api: _ }) => {
    await open(page, '/oversikt');
    await page.getByRole('button', { name: 'Inte nu', exact: true }).first().focus();
    await page.keyboard.press('Enter');
    await page.getByRole('menuitem', { name: /^I morgon/ }).focus();
    await page.keyboard.press('Enter');
    // The next thread is a row (D31): its title button takes the focus, and the ring is on the button.
    const title = page.locator('#thread-omtanke').getByRole('button', { name: 'Omtankesamtal med Anna Lindqvist', exact: true });
    await expect(title).toBeFocused();
    expect(await title.evaluate(el => getComputedStyle(el).outlineStyle !== 'none' || getComputedStyle(el).boxShadow !== 'none')).toBe(true);
  });
});

test.describe('2.4.3 focus order', () => {
  test('regaining the window keeps focus where it was', async ({ page, api }) => {
    await open(page, '/oversikt');
    const button = page.getByRole('button', { name: 'Inte nu', exact: true }).first();
    await button.focus();
    api.sessionDelay = 200;
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForTimeout(350);
    expect((await focused(page)).text).toBe('Inte nu');
  });

  test('a collapsed card says it is collapsed and takes focus to its content', async ({ page, api: _ }) => {
    await open(page, '/oversikt');
    const title = 'Omtankesamtal med Anna Lindqvist';
    const expand = page.getByRole('button', { name: title, exact: true });
    await expect(expand).toHaveAttribute('aria-expanded', 'false');
    await expand.focus();
    await page.keyboard.press('Enter');
    const heading = page.getByRole('heading', { name: title });
    await expect(heading).toBeFocused();
  });

  test('Inte nu moves focus to the next card instead of losing it', async ({ page, api: _ }) => {
    await open(page, '/oversikt');
    await page.getByRole('button', { name: 'Inte nu', exact: true }).first().focus();
    await page.keyboard.press('Enter');
    await page.getByRole('menuitem', { name: /^I morgon/ }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('region', { name: 'Aviseringar' })).toBeVisible();
    await expect(page.locator('#thread-omtanke').getByRole('button', { name: 'Omtankesamtal med Anna Lindqvist', exact: true })).toBeFocused();
  });

  test('Ångra in the toast stays available and reachable by keyboard', async ({ page, api: _ }) => {
    await page.clock.install({ time: new Date('2026-11-04T08:00:00.000Z') });
    await open(page, '/oversikt');
    await snoozeFirst(page);
    const undo = page.getByRole('button', { name: 'Ångra' });
    await expect(undo).toBeVisible();
    await page.clock.fastForward('00:30');
    await expect(undo, 'the toast has no time limit (2.2.1)').toBeVisible();
    const { stops } = await hiddenFocusStops(page);
    expect(stops.some(stop => stop.includes('Ångra')), 'the Tab order reaches the toast').toBe(true);
    await undo.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Attestera · 2' })).toBeVisible();
  });

  test('the side panel can be closed with a button and hands focus back', async ({ page, api: _ }) => {
    await open(page, '/omrade/personal');
    const trigger = page.getByRole('button', { name: 'Vem är på plats?' });
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
  test('Lägg till i samtalet in the sources view puts the passage in the row\'s drawer and says so on the row', async ({ page, api: _ }) => {
    await open(page, '/vy/clew.search?titel=K%C3%A4llor&input=%7B%22query%22%3A%22fall%22%7D');
    const panel = page.getByRole('dialog');
    const add = panel.getByRole('list', { name: 'Källor' }).getByRole('listitem').nth(0).getByRole('button', { name: 'Lägg till i samtalet' });
    await add.focus();
    await page.keyboard.press('Enter');
    await expect(panel.getByRole('button', { name: 'I samtalet', exact: true })).toHaveCount(1);
    await panel.getByRole('button', { name: 'Stäng' }).click();
    await expect(page.getByRole('group', { name: 'Objekt i samtalet' }).or(page.getByText('Rutin vid fall i ordinärt boende').first())).toBeVisible();
  });
});

test.describe('D29 the Inte nu picker', () => {
  test('every row says when the card comes back, and the free text has a label and a live answer', async ({ page, api: _ }) => {
    await open(page, '/oversikt');
    await page.getByRole('button', { name: 'Inte nu', exact: true }).first().click();
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    for (const row of ['Om en timme', 'Efter lunch', 'I morgon', 'Nästa vecka', 'När jag är tillbaka från Ledningsgrupp']) await expect(menu.getByRole('menuitem', { name: new RegExp('^' + row) })).toBeVisible();
    await expect(menu.getByText('06:00 · i genomgången')).toBeVisible();
    await menu.getByRole('menuitem', { name: /^Skriv själv/ }).click();
    const dialog = page.getByRole('dialog');
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
