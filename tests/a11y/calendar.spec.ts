import {
  announcements,
  desktop,
  expect,
  expectNoAxeViolations,
  focused,
  heading,
  narrow,
  open,
  phone,
  reflowProblems,
  test,
} from './support';
import type { Page } from '@playwright/test';
import { NEXT_WEEK } from './data';

/**
 * The calendar page (D27, D32): three views on two widths, the view switch, a booking of one's own, an entry opened
 * from the grid, and a proposal moved without a mouse. The grid itself is a picture (FullCalendar's time grid is not a
 * WAI-ARIA grid); every action here goes through a dialog, which is the path these tests take.
 */
const views = [
  ['the day', '/calendar?view=day'],
  ['the week', '/calendar?view=week'],
  ['the month', '/calendar?view=month'],
] as const;

test.describe('the three views', () => {
  for (const viewport of [desktop, phone])
    for (const [name, path] of views)
      test(`${name} at ${viewport.width} px has no axe violations`, async ({ page, api: _ }) => {
        await page.setViewportSize(viewport);
        await open(page, path);
        await expectNoAxeViolations(page);
      });
  for (const [name, path] of views)
    test(`${name} reflows at 320 px`, async ({ page, api: _ }) => {
      await page.setViewportSize(narrow);
      await open(page, path);
      expect(await reflowProblems(page)).toEqual([]);
    });
  test('the view switch is one choice of three; the title, the address and the spoken page follow it', async ({
    page,
    api: _,
  }) => {
    await page.setViewportSize(desktop);
    await open(page, '/calendar');
    const group = page.getByRole('radiogroup', { name: 'Vy' });
    await expect(group.getByRole('radio', { name: 'Vecka' })).toBeChecked();
    await group.getByRole('radio', { name: 'Dag' }).click();
    await expect(page).toHaveTitle('Onsdag 4 november · Kalender · Startsidan');
    await expect(page).toHaveURL(/view=day/);
    await expect.poll(() => announcements(page)).toContainEqual(expect.stringContaining('Dagvy'));
    await group.getByRole('radio', { name: 'Månad' }).click();
    await expect(page).toHaveTitle('November 2026 · Kalender · Startsidan');
    await expect(heading(page, 1, 'November 2026')).toBeVisible();
  });
  test('the phone week is a list with a heading per day, and the day view fits one column', async ({
    page,
    api: _,
  }) => {
    await page.setViewportSize(phone);
    await open(page, '/calendar');
    for (const day of ['mån 2 nov', 'tis 3 nov', 'ons 4 nov', 'tors 5 nov', 'fre 6 nov'])
      await expect(heading(page, 2, day)).toBeVisible();
    // The view switch is an adaptive menu on a phone (D31 §5).
    await page.getByRole('button', { name: 'Vy: Vecka' }).click();
    await page.getByRole('menuitem', { name: 'Dag' }).click();
    await expect(heading(page, 2, 'ons 4 nov')).toBeVisible();
    await expect(page.getByText('Morgonmöte ledningsgrupp')).toHaveCount(1);
  });
});

test.describe('the levels and the mark (D71, artboard 6)', () => {
  for (const viewport of [desktop, phone])
    test(`at ${viewport.width} px the page has one h1, and it is the week`, async ({ page, api: _ }) => {
      await page.setViewportSize(viewport);
      await open(page, '/calendar');
      await expect(page.locator('h1, [aria-level="1"]')).toHaveCount(1);
      await expect(heading(page, 1, 'Vecka 45')).toBeVisible();
    });
  test('a meeting in the grid is named by its title and its time, and said to be booked', async ({ page, api: _ }) => {
    await page.setViewportSize(desktop);
    await open(page, '/calendar');
    const block = page.locator('.clew-cal-event').first();
    await expect(block).toHaveAccessibleName(/^Morgonmöte ledningsgrupp\s*08:15–08:45 · A12\s*, bokat$/);
  });
  test('a proposal is the assistant’s: the ✦ is seen, the word förslag is heard', async ({ page, api: _ }) => {
    await page.setViewportSize(desktop);
    await open(page, `/calendar?date=${NEXT_WEEK}`);
    const block = page.locator('.clew-cal-event-proposal').first();
    await expect(block).toContainText('✦ Utvecklingssamtal');
    await expect(block).toHaveAccessibleName(/^Utvecklingssamtal\s*\d\d:\d\d–\d\d:\d\d · Anna Lindqvist\s*, förslag$/);
  });
  test('the panel is the card: the house chip, the source and the week, the one badge, the title at level 2', async ({
    page,
    api: _,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, `/calendar?date=${NEXT_WEEK}`);
    const panel = page.getByRole('complementary', { name: 'Förslag' });
    await expect(panel.getByText('Kalender', { exact: true })).toBeVisible();
    await expect(panel.getByText('Kalendern · vecka 46', { exact: true })).toBeVisible();
    await expect(panel.getByText('Förslag att bekräfta')).toBeVisible();
    await expect(panel.getByRole('heading', { level: 2, name: 'Planera utvecklingssamtal' })).toBeVisible();
    // A proposal row is the row level: the day in its cell, the person, the time under; the ✦ is not read.
    await expect(panel.getByRole('checkbox', { name: 'tis 10 Anna Lindqvist 10:00–10:45' })).toBeChecked();
    await expectNoAxeViolations(page);
  });
});

test.describe("a booking of one's own", () => {
  test('Ny bokning is a form dialog with labelled fields; Escape closes it and focus returns to the button', async ({
    page,
    api: _,
  }) => {
    await page.setViewportSize(desktop);
    await open(page, '/calendar');
    await page.getByRole('button', { name: 'Ny bokning' }).focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Ny bokning' });
    await expect(dialog).toBeVisible();
    // Astryx moves focus to the dialog's title, so the name is read first; the first field is one Tab away.
    await expect(dialog.getByRole('heading', { name: 'Ny bokning' })).toBeFocused();
    await expect(dialog.getByRole('button', { name: 'Boka' })).toBeDisabled();
    await dialog.getByRole('textbox', { name: /Rubrik/ }).fill('Ledningsgrupp');
    await expect(dialog.getByRole('button', { name: 'Boka' })).toBeEnabled();
    await dialog.getByRole('button', { name: 'Kontrollera tillgänglighet' }).click();
    const states = dialog.getByRole('list', { name: 'Tillgänglighet' });
    await expect(states).toContainText('Du');
    await expect(states).toContainText('Anna Lindqvist');
    await expect.poll(() => announcements(page)).toContainEqual(expect.stringContaining('Anna Lindqvist upptagen'));
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    expect(await focused(page)).toMatchObject({ text: 'Ny bokning' });
  });
  test('a booking is told in a toast and the week is read again', async ({ page, api: _ }) => {
    await page.setViewportSize(desktop);
    await open(page, '/calendar');
    await page.getByRole('button', { name: 'Ny bokning' }).click();
    const dialog = page.getByRole('dialog', { name: 'Ny bokning' });
    await dialog.getByRole('textbox', { name: /Rubrik/ }).fill('Ledningsgrupp');
    await dialog.getByRole('button', { name: 'Boka' }).click();
    await expect(dialog).toBeHidden();
    await expect(
      page.getByRole('region', { name: 'Aviseringar' }).getByText(/^Bokningsbeslutet är sparat/),
    ).toBeVisible();
  });
});

test.describe('a booking started on the grid (D58)', () => {
  /** The grid has no cells to name (see the head of this file), so a place on it is a day's column and a row's top. */
  const point = async (page: Page, day: string, time: string, down = 4) => {
    const column = await page.locator(`.clew-cal-day-lane[data-date="${day}"]`).boundingBox();
    const row = await page.locator(`.clew-cal-slot-lane[data-time="${time}:00"]`).boundingBox();
    return { x: column!.x + column!.width / 2, y: row!.y + down };
  };
  const booking = async (page: Page, day: string, start: string, end: string) => {
    const dialog = page.getByRole('dialog', { name: 'Ny bokning' });
    await expect(dialog).toBeVisible();
    // The input under a label: a touch screen draws the two times as comboboxes, with more under the same name.
    const field = (name: string) => dialog.getByLabel(name, { exact: true }).and(page.locator('input'));
    await expect(field('Börjar')).toHaveValue(day);
    await expect(field('Börjar tid')).toHaveValue(start);
    await expect(field('Slutar')).toHaveValue(end);
    return dialog;
  };

  test('a click in the week starts an hour on the row clicked, and the dialog takes focus', async ({
    page,
    api: _,
  }) => {
    await page.setViewportSize(desktop);
    await open(page, '/calendar');
    const { x, y } = await point(page, '2026-11-06', '10:00', 21);
    await page.mouse.click(x, y);
    const dialog = await booking(page, '6 november 2026', '10:00', '11:00');
    await expect(dialog.getByRole('heading', { name: 'Ny bokning' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });
  test('a click outside office hours is heard too', async ({ page, api: _ }) => {
    await page.setViewportSize(desktop);
    await open(page, '/calendar');
    const { x, y } = await point(page, '2026-11-06', '17:30');
    await page.mouse.click(x, y);
    await booking(page, '6 november 2026', '17:30', '18:30');
  });
  test('a press that moves a little is still a click', async ({ page, api: _ }) => {
    await page.setViewportSize(desktop);
    await open(page, '/calendar');
    const { x, y } = await point(page, '2026-11-06', '10:00');
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 3, y + 6, { steps: 3 });
    await page.mouse.up();
    await booking(page, '6 november 2026', '10:00', '11:00');
  });
  test('a drag keeps the span it drew', async ({ page, api: _ }) => {
    await page.setViewportSize(desktop);
    await open(page, '/calendar');
    const from = await point(page, '2026-11-06', '10:00');
    const to = await point(page, '2026-11-06', '11:00', 20);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await page.mouse.up();
    await booking(page, '6 november 2026', '10:00', '11:30');
  });
  test('a click on a day in the month starts at nine that day', async ({ page, api: _ }) => {
    await page.setViewportSize(desktop);
    await open(page, '/calendar?view=month');
    const cell = await page.locator('.clew-cal-day-cell[data-date="2026-11-18"]').boundingBox();
    await page.mouse.click(cell!.x + cell!.width / 2, cell!.y + cell!.height - 6);
    await booking(page, '18 november 2026', '09:00', '10:00');
  });
  test('a drag across days in the month opens nothing: a booking has a clock', async ({ page, api: _ }) => {
    await page.setViewportSize(desktop);
    await open(page, '/calendar?view=month');
    const from = await page.locator('.clew-cal-day-cell[data-date="2026-11-18"]').boundingBox();
    const to = await page.locator('.clew-cal-day-cell[data-date="2026-11-20"]').boundingBox();
    await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height - 6);
    await page.mouse.down();
    await page.mouse.move(to!.x + to!.width / 2, to!.y + to!.height - 6, { steps: 8 });
    await page.mouse.up();
    await expect(page.getByRole('dialog', { name: 'Ny bokning' })).toBeHidden();
  });
  test('a click on a meeting opens the meeting, not a booking', async ({ page, api: _ }) => {
    await page.setViewportSize(desktop);
    await open(page, '/calendar');
    await page.locator('.clew-cal-event').first().click();
    await expect(page.getByRole('dialog', { name: 'Morgonmöte ledningsgrupp' })).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Ny bokning' })).toBeHidden();
  });
  test.describe('on a touch screen wide enough for the grid', () => {
    test.use({ hasTouch: true });
    test('a tap is a click', async ({ page, api: _ }) => {
      await page.setViewportSize(desktop);
      await open(page, '/calendar');
      const { x, y } = await point(page, '2026-11-06', '10:00');
      await page.touchscreen.tap(x, y);
      await booking(page, '6 november 2026', '10:00', '11:00');
    });
  });
});

test.describe('an entry opened from the grid', () => {
  test('Enter on a meeting opens its details with the day around it; Escape returns focus to the meeting', async ({
    page,
    api: _,
  }) => {
    await page.setViewportSize(desktop);
    await open(page, '/calendar');
    const block = page.locator('.clew-cal-event').first();
    await block.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Morgonmöte ledningsgrupp' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('group', { name: /^måndag 2 november/ })).toBeVisible();
    await expect(dialog.getByText('Mona Berg, Per Lindahl')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Flytta', exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Ställ in' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(block).toBeFocused();
  });
  test('cancelling asks once, inline, and is spoken when done', async ({ page, api: _ }) => {
    await page.setViewportSize(desktop);
    await open(page, '/calendar');
    await page.locator('.clew-cal-event').first().click();
    const dialog = page.getByRole('dialog', { name: 'Morgonmöte ledningsgrupp' });
    await dialog.getByRole('button', { name: 'Ställ in' }).click();
    await expect(dialog.getByText('Ställ in mötet?')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(1);
    await dialog.getByRole('button', { name: 'Ja, ställ in' }).click();
    await expect(dialog).toBeHidden();
    await expect
      .poll(() => announcements(page))
      .toContainEqual(expect.stringContaining('Beslutet att ställa in mötet är sparat.'));
  });
  test('a proposal is moved from the keyboard, never only by drag', async ({ page, api: _ }) => {
    await page.setViewportSize(desktop);
    await open(page, `/calendar?date=${NEXT_WEEK}`);
    const block = page.locator('.clew-cal-event-proposal').first();
    await block.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Utvecklingssamtal' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Flytta förslaget' }).click();
    await expect(dialog.getByRole('region', { name: 'Ny tid' })).toBeVisible();
    await expect(dialog.getByText('behåller sin längd')).toBeVisible();
    await dialog.getByRole('button', { name: 'Spara' }).click();
    await expect(dialog).toBeHidden();
    await expect.poll(() => announcements(page)).toContainEqual(expect.stringContaining('Förslaget ligger nu'));
  });
  // The day strip is taller than a low window: the details scroll and the actions stay where they can be reached.
  test('in a low window the actions stay on screen and the details scroll from the keyboard', async ({
    page,
    api: _,
  }) => {
    await page.setViewportSize({ width: desktop.width, height: 600 });
    await open(page, `/calendar?date=${NEXT_WEEK}`);
    await page.locator('.clew-cal-event-proposal').first().click();
    const dialog = page.getByRole('dialog', { name: 'Utvecklingssamtal' });
    await expect(dialog.getByRole('button', { name: 'Flytta förslaget' })).toBeInViewport({ ratio: 1 });
    await expect(dialog.getByRole('button', { name: 'Visa dagen' })).toBeInViewport({ ratio: 1 });
    const details = dialog.getByRole('group', { name: 'Dagen och uppgifterna' });
    await details.focus();
    await expect(details).toBeFocused();
    await page.keyboard.press('End');
    await expect(dialog.getByText('Medarbetare')).toBeInViewport({ ratio: 1 });
  });
  test('Ny bokning keeps its actions on screen in a low window', async ({ page, api: _ }) => {
    await page.setViewportSize({ width: desktop.width, height: 500 });
    await open(page, '/calendar');
    await page.getByRole('button', { name: 'Ny bokning' }).click();
    const dialog = page.getByRole('dialog', { name: 'Ny bokning' });
    await expect(dialog.getByRole('button', { name: 'Boka' })).toBeInViewport({ ratio: 1 });
    await expect(dialog.getByRole('button', { name: 'Avbryt' })).toBeInViewport({ ratio: 1 });
  });
});
