import { announcements, desktop, expect, expectNoAxeViolations, focused, heading, narrow, open, phone, reflowProblems, test } from './support';
import { NEXT_WEEK } from './data';

/**
 * The calendar page (D27, D32): three views on two widths, the view switch, a booking of one's own, an entry opened
 * from the grid, and a proposal moved without a mouse. The grid itself is a picture (FullCalendar's time grid is not a
 * WAI-ARIA grid); every action here goes through a dialog, which is the path these tests take.
 */
const views = [['the day', '/kalender?vy=dag'], ['the week', '/kalender?vy=vecka'], ['the month', '/kalender?vy=manad']] as const;

test.describe('the three views', () => {
  for (const viewport of [desktop, phone]) for (const [name, path] of views) test(`${name} at ${viewport.width} px has no axe violations`, async ({ page, api: _ }) => {
    await page.setViewportSize(viewport);
    await open(page, path);
    await expectNoAxeViolations(page);
  });
  for (const [name, path] of views) test(`${name} reflows at 320 px`, async ({ page, api: _ }) => {
    await page.setViewportSize(narrow);
    await open(page, path);
    expect(await reflowProblems(page)).toEqual([]);
  });
  test('the view switch is one choice of three; the title, the address and the spoken page follow it', async ({ page, api: _ }) => {
    await page.setViewportSize(desktop);
    await open(page, '/kalender');
    const group = page.getByRole('radiogroup', { name: 'Vy' });
    await expect(group.getByRole('radio', { name: 'Vecka' })).toBeChecked();
    await group.getByRole('radio', { name: 'Dag' }).click();
    await expect(page).toHaveTitle('Onsdag 4 november · Kalender · Startsidan');
    await expect(page).toHaveURL(/vy=dag/);
    await expect.poll(() => announcements(page)).toContainEqual(expect.stringContaining('Dagvy'));
    await group.getByRole('radio', { name: 'Månad' }).click();
    await expect(page).toHaveTitle('November 2026 · Kalender · Startsidan');
    await expect(heading(page, 1, 'November 2026')).toBeVisible();
  });
  test('the phone week is a list with a heading per day, and the day view fits one column', async ({ page, api: _ }) => {
    await page.setViewportSize(phone);
    await open(page, '/kalender');
    for (const day of ['mån 2 nov', 'tis 3 nov', 'ons 4 nov', 'tors 5 nov', 'fre 6 nov']) await expect(heading(page, 2, day)).toBeVisible();
    // The view switch is an adaptive menu on a phone (D31 §5).
    await page.getByRole('button', { name: 'Vy: Vecka' }).click();
    await page.getByRole('menuitem', { name: 'Dag' }).click();
    await expect(heading(page, 2, 'ons 4 nov')).toBeVisible();
    await expect(page.getByText('Morgonmöte ledningsgrupp')).toHaveCount(1);
  });
});

test.describe('a booking of one\'s own', () => {
  test('Ny bokning is a form dialog with labelled fields; Escape closes it and focus returns to the button', async ({ page, api: _ }) => {
    await page.setViewportSize(desktop);
    await open(page, '/kalender');
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
    await open(page, '/kalender');
    await page.getByRole('button', { name: 'Ny bokning' }).click();
    const dialog = page.getByRole('dialog', { name: 'Ny bokning' });
    await dialog.getByRole('textbox', { name: /Rubrik/ }).fill('Ledningsgrupp');
    await dialog.getByRole('button', { name: 'Boka' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('region', { name: 'Aviseringar' }).getByText(/^Bokat: Ledningsgrupp/)).toBeVisible();
  });
});

test.describe('an entry opened from the grid', () => {
  test('Enter on a meeting opens its details with the day around it; Escape returns focus to the meeting', async ({ page, api: _ }) => {
    await page.setViewportSize(desktop);
    await open(page, '/kalender');
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
    await open(page, '/kalender');
    await page.locator('.clew-cal-event').first().click();
    const dialog = page.getByRole('dialog', { name: 'Morgonmöte ledningsgrupp' });
    await dialog.getByRole('button', { name: 'Ställ in' }).click();
    await expect(dialog.getByText('Ställ in mötet?')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(1);
    await dialog.getByRole('button', { name: 'Ja, ställ in' }).click();
    await expect(dialog).toBeHidden();
    await expect.poll(() => announcements(page)).toContainEqual(expect.stringContaining('Mötet är inställt.'));
  });
  test('a proposal is moved from the keyboard, never only by drag', async ({ page, api: _ }) => {
    await page.setViewportSize(desktop);
    await open(page, `/kalender?datum=${NEXT_WEEK}`);
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
});
