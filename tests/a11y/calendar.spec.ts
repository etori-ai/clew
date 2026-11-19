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
  silentSaidIn,
  test,
} from './support';
import type { Page } from '@playwright/test';
import { NEXT_WEEK, events } from './data';

/** Wide enough for the page's own pane to stand beside the grid (1340 px): an entry opens in the end slot. */
const WIDE = { width: 1440, height: 900 };

/**
 * The calendar page (D27, D32, D112 item 9, D126): three views on two widths, the view switch, a booking of one's own,
 * an entry opened from the grid into the page's own pane, the proposals reached from the header, and a proposal moved
 * without a mouse. The grid itself is a picture (FullCalendar's time grid is not a WAI-ARIA grid); every change goes through
 * the fields of a form in the page's pane (a booking, a move) or a dialog (a cancellation), which is the path these tests take.
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
    // The head's two rows are full on a phone: the frame draws no "Fråga assistenten" there (D130, `onPhone: false`).
    await expect(page.getByRole('main').getByRole('button', { name: 'Fråga assistenten' })).toHaveCount(0);
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
    await expect(block).toHaveAccessibleName(/^Morgonmöte ledningsgrupp\s*08:15–08:45\s·\sA12\s*, bokat$/);
  });
  test('a proposal is the assistant’s: the ✦ is seen, the word förslag is heard', async ({ page, api: _ }) => {
    await page.setViewportSize(desktop);
    await open(page, `/calendar?date=${NEXT_WEEK}`);
    const block = page.locator('.clew-cal-event-proposal').first();
    await expect(block).toContainText('✦ Utvecklingssamtal');
    await expect(block).toHaveAccessibleName(
      /^Utvecklingssamtal\s*\d\d:\d\d–\d\d:\d\d\s·\sAnna Lindqvist\s*, förslag$/,
    );
  });
  test('Förslag N in the header lists the proposals that wait; choosing one opens it in the panel with its decisions', async ({
    page,
    api: _,
  }) => {
    await page.setViewportSize(WIDE);
    await open(page, '/calendar');
    // The proposals' list is reached from the header (D112 item 9): the count is part of the button's name.
    const menu = page.getByRole('button', { name: /^Förslag\s*\d+$/ });
    await menu.click();
    await page
      .getByRole('menuitem', { name: /Anna Lindqvist/ })
      .first()
      .click();
    // It leads to the proposal's own day in the view on screen: here the next week, with the proposal in the panel.
    await expect(page).toHaveURL(/[?&]entry=/);
    await expect(heading(page, 1, 'Vecka 46')).toBeVisible();
    const panel = page.getByRole('complementary', { name: 'Utvecklingssamtal' });
    await expect(panel.getByText('Kalendern · Förslag', { exact: true })).toBeVisible();
    await expect(panel.getByText('Förslag, inte bokat', { exact: true })).toBeVisible();
    await expect(panel.getByText('Anna Lindqvist', { exact: true })).toBeVisible();
    // Its buttons are its existing decisions, and moving it has a form, never drag alone.
    await expect(panel.getByRole('button', { name: 'Skicka inbjudan' })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Flytta …' })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Föreslå andra tider' })).toBeVisible();
    // Its name in the panel's header is the way to its work item's page (the name is the way in, 2026-11-13).
    await expect(
      panel.getByRole('heading', { name: 'Utvecklingssamtal' }).getByRole('link', { name: 'Utvecklingssamtal' }),
    ).toHaveAttribute('href', /^\/items\/samtal/);
    await expect(panel.getByRole('link', { name: 'Öppna som sida' })).toHaveCount(0);
    // The old Förslag panel is gone from the end slot.
    await expect(page.getByRole('complementary', { name: 'Förslag' })).toHaveCount(0);
    await expectNoAxeViolations(page);
  });
  test('Skicka inbjudan sends that one time through the proposals’ own decision', async ({ page, api: _ }) => {
    await page.setViewportSize(WIDE);
    const sent: unknown[] = [];
    page.on('request', request => {
      if (request.method() === 'POST' && request.url().endsWith('/api/threads/samtal/confirm'))
        sent.push(request.postDataJSON());
    });
    await open(page, `/calendar?date=${NEXT_WEEK}`);
    await page.locator('.clew-cal-event-proposal').first().click();
    const panel = page.getByRole('complementary', { name: 'Utvecklingssamtal' });
    await panel.getByRole('button', { name: 'Skicka inbjudan' }).click();
    await expect.poll(() => sent.length).toBe(1);
    expect((sent[0] as { proposalIds: string[] }).proposalIds).toHaveLength(1);
  });
});

test.describe("a booking of one's own", () => {
  test('Ny bokning is a form in the pane beside the grid, its time a block on the grid; availability is read by itself; Escape lets go of it and focus returns to the button', async ({
    page,
    api: _,
  }) => {
    await page.setViewportSize(WIDE);
    await open(page, '/calendar');
    await page.getByRole('button', { name: 'Ny bokning' }).focus();
    await page.keyboard.press('Enter');
    const pane = page.getByRole('complementary', { name: 'Ny bokning' });
    await expect(pane.getByRole('heading', { name: 'Ny bokning' })).toBeVisible();
    // A form gives the focus to its first field; the week stays in use beside it: nothing is modal.
    await expect(pane.getByRole('textbox', { name: /Rubrik/ })).toBeFocused();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // The time being booked is a block on the grid, drawn as the person's own and not yet in the calendar.
    const block = page.locator('.clew-cal-draft');
    await expect(block).toContainText('Ny bokning');
    await expect(pane.getByRole('button', { name: 'Boka' })).toBeDisabled();
    await expect(pane.getByText('Skriv en rubrik så går det att boka.')).toBeVisible();
    await pane.getByRole('textbox', { name: /Rubrik/ }).fill('Ledningsgrupp');
    await expect(pane.getByRole('button', { name: 'Boka' })).toBeEnabled();
    await expect(block).toContainText('Ledningsgrupp');
    // Who is free at that time is read without being asked for, each state in words.
    const states = pane.getByRole('list', { name: 'Tillgänglighet' });
    await expect(states).toContainText('Du');
    await expect(states).toContainText('Anna Lindqvist');
    await expect(states).toContainText('upptagen');
    await expect.poll(() => announcements(page)).toContainEqual(expect.stringContaining('Anna Lindqvist upptagen'));
    await expectNoAxeViolations(page);
    await page.keyboard.press('Escape');
    await expect(pane).toHaveCount(0);
    await expect(block).toHaveCount(0);
    expect(await focused(page)).toMatchObject({ text: 'Ny bokning' });
  });
  test('the block on the grid is dragged to another time and the fields follow; a meeting opened meanwhile keeps the booking', async ({
    page,
    api: _,
  }) => {
    await page.setViewportSize(WIDE);
    await open(page, '/calendar');
    // The pane takes its width from the grid when it opens, so a day's column is found again after it has.
    const column = async () => {
      const box = await page.locator('.clew-cal-day-lane[data-date="2026-11-06"]').boundingBox();
      return box!.x + box!.width / 2;
    };
    const row = async (time: string) =>
      (await page.locator(`.clew-cal-slot-lane[data-time="${time}:00"]`).boundingBox())!.y;
    await page.mouse.click(await column(), (await row('10:00')) + 4);
    const pane = page.getByRole('complementary', { name: 'Ny bokning' });
    await expect(pane).toBeVisible();
    const x = await column();
    const field = (name: string) => pane.getByLabel(name, { exact: true }).and(page.locator('input'));
    await expect(field('Börjar')).toHaveValue('10:00');
    // The block is taken by its middle and put three hours later: the fields say the new time.
    await page.mouse.move(x, (await row('10:00')) + 8);
    await page.mouse.down();
    await page.mouse.move(x, (await row('13:00')) + 8, { steps: 8 });
    await page.mouse.up();
    // The drop lands on the quarter under the pointer: the hour moved to, and the booking keeps its length.
    await expect(field('Börjar')).toHaveValue(/^13:(00|15)$/);
    const from = await field('Börjar').inputValue();
    await expect(field('Slutar')).toHaveValue(from.replace('13:', '14:'));
    await expect(field('Dag')).toHaveValue(/^(6 november 2026|2026-11-06)$/);
    // A meeting opened meanwhile takes the pane; the booking's block stays on the grid and leads back to its form.
    await pane.getByRole('textbox', { name: /Rubrik/ }).fill('Ledningsgrupp');
    await page.locator('.clew-cal-event').first().click();
    await expect(page.getByRole('complementary', { name: 'Morgonmöte ledningsgrupp' })).toBeVisible();
    await page.locator('.clew-cal-draft').click();
    await expect(pane.getByRole('textbox', { name: /Rubrik/ })).toHaveValue('Ledningsgrupp');
    await expect(page).not.toHaveURL(/entry=/);
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
    // The grid is as tall as its hours and the page scrolls under the pinned head: with the shared header above the
    // shell (D88) the last rows of the day lie under the fold of an 800 px window, and a mouse reaches only what is on
    // screen. The row is scrolled up first, as a person would.
    const slot = page.locator(`.clew-cal-slot-lane[data-time="${time}:00"]`);
    await slot.scrollIntoViewIfNeeded();
    const column = await page.locator(`.clew-cal-day-lane[data-date="${day}"]`).boundingBox();
    const row = await slot.boundingBox();
    return { x: column!.x + column!.width / 2, y: row!.y + down };
  };
  // Below the width where the pane stands beside the grid, the form is in the drawer over it.
  const booking = async (page: Page, day: string, start: string, end: string) => {
    const dialog = page.getByRole('dialog', { name: 'Ny bokning' });
    await expect(dialog).toBeVisible();
    // The input under a label: a touch screen draws the two times as comboboxes, with more under the same name, and
    // the day as the system's own date field, which holds the date as the address writes it.
    const field = (name: string) => dialog.getByLabel(name, { exact: true }).and(page.locator('input'));
    const [date, , year] = day.split(' ');
    await expect(field('Dag')).toHaveValue(new RegExp(`^(${day}|${year}-11-${date!.padStart(2, '0')})$`));
    await expect(field('Börjar')).toHaveValue(start);
    await expect(field('Slutar')).toHaveValue(end);
    return dialog;
  };

  test('a click in the week starts an hour on the row clicked, and the form takes focus', async ({ page, api: _ }) => {
    await page.setViewportSize(desktop);
    await open(page, '/calendar');
    const { x, y } = await point(page, '2026-11-06', '10:00', 21);
    await page.mouse.click(x, y);
    const dialog = await booking(page, '6 november 2026', '10:00', '11:00');
    await expect(dialog.getByRole('textbox', { name: /Rubrik/ })).toBeFocused();
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

test.describe('an entry opened from the grid (D112 item 9)', () => {
  test('the pane’s width is the person’s own: its grip takes the arrow keys, the grid gives the room, and the width is kept over a reload', async ({
    page,
    api: _,
  }) => {
    await page.setViewportSize(WIDE);
    await open(page, '/calendar');
    await page.locator('.clew-cal-event').first().focus();
    await page.keyboard.press('Enter');
    const panel = page.getByRole('complementary', { name: 'Morgonmöte ledningsgrupp' });
    const grip = page.getByRole('separator', { name: 'Ändra rutans bredd' });
    await expect(grip).toHaveAttribute('aria-valuenow', '440');
    await grip.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(grip).not.toHaveAttribute('aria-valuenow', '440');
    const wider = Number(await grip.getAttribute('aria-valuenow'));
    expect(wider).toBeGreaterThan(440);
    expect(Math.round((await panel.boundingBox())!.width)).toBe(wider);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(
      0,
    );
    await expectNoAxeViolations(page);
    await page.reload();
    await expect(page.getByRole('separator', { name: 'Ändra rutans bredd' })).toHaveAttribute(
      'aria-valuenow',
      String(wider),
    );
  });
  test('Enter on a meeting opens it in the panel beside the grid with its facts and own buttons; Escape returns focus to the meeting', async ({
    page,
    api: _,
  }) => {
    await page.setViewportSize(WIDE);
    await open(page, '/calendar');
    const block = page.locator('.clew-cal-event').first();
    await block.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/entry=/);
    const panel = page.getByRole('complementary', { name: 'Morgonmöte ledningsgrupp' });
    // The header of the pane beside a conversation: the source line, the name, and under it the time and the buttons.
    await expect(panel.getByText('Kalendern · Möte', { exact: true })).toBeVisible();
    await expect(panel.getByText(/^\S+ \d+ november\s· \d\d:\d\d\s?–\s?\d\d:\d\d$/)).toBeVisible();
    await expect(panel.getByText('Mona Berg', { exact: true })).toBeVisible();
    await expect(panel.getByText('Per Lindahl', { exact: true })).toBeVisible();
    await expect(panel.getByText('Du är inbjuden')).toHaveCount(0);
    await expect(panel.getByRole('button', { name: 'Flytta …' })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Ställ in …' })).toBeVisible();
    // The name has the focus; the assistant's box stands at the pane's foot, and no button opens it.
    await expect(panel.getByRole('heading', { name: 'Morgonmöte ledningsgrupp' })).toBeFocused();
    await expect(panel.getByRole('textbox', { name: 'Fråga om mötet, eller be om en ändring' })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Fråga assistenten' })).toHaveCount(0);
    // The grid stays in use beside it: nothing is modal.
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expectNoAxeViolations(page);
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await expect(page).not.toHaveURL(/entry=/);
    await expect(block).toBeFocused();
  });
  test('a meeting someone else organises says so and has no organiser’s buttons; the box under it asks about it in place, and Öppna som samtal leads to the conversation', async ({
    page,
    api,
  }) => {
    await page.setViewportSize(WIDE);
    // One meeting of the week is the school head's, the person invited: the calendar answers it as not theirs.
    await page.route(
      url => url.pathname === '/api/calendar',
      async route => {
        const from = new URL(route.request().url()).searchParams.get('from') ?? '2026-11-02';
        const own = events(from);
        await route.fulfill({
          json: {
            from,
            events: [
              ...own,
              {
                ...own[2]!,
                id: 'rektorsmote',
                title: 'Rektorsmöte',
                start: '2026-11-04T07:30:00.000Z',
                end: '2026-11-04T09:00:00.000Z',
                mine: false,
                canCancel: false,
                room: 'Kommunhuset, rum Selånger',
                organizer: 'Skolchefen',
                ref: 'memory:rektorsmote',
              },
            ],
            proposals: [],
          },
        });
      },
    );
    await open(page, '/calendar');
    await page.locator('.clew-cal-event').filter({ hasText: 'Rektorsmöte' }).click();
    const panel = page.getByRole('complementary', { name: 'Rektorsmöte' });
    await expect(panel.getByText('Du är inbjuden', { exact: true })).toBeVisible();
    await expect(panel.getByText('Skolchefen', { exact: true })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Flytta …' })).toHaveCount(0);
    await expect(panel.getByRole('button', { name: 'Ställ in …' })).toHaveCount(0);
    // The box stands at the pane's foot from the start, in the place "Fråga assistenten" had; the page stays.
    await expect(panel.getByRole('button', { name: 'Fråga assistenten' })).toHaveCount(0);
    const box = panel.getByRole('textbox', { name: 'Fråga om mötet', exact: true });
    await expect(box).toBeVisible();
    await expectNoAxeViolations(page);
    await box.fill('Vad står på agendan?');
    await box.press('Enter');
    // The answer is drawn in the pane, under the meeting's facts.
    await expect(panel.getByText('Tio personer är på plats i dag.')).toBeVisible();
    await expect(panel.getByText('Skolchefen', { exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/calendar/);
    // Asked with the meeting's chip and as what stands open, as Clew's own turn, and as a new conversation.
    const asked = api.asked.at(-1)!;
    expect(asked.chips).toEqual([{ ref: 'event:rektorsmote', kind: 'event', label: 'Rektorsmöte' }]);
    expect(asked.beside).toBe('event:rektorsmote');
    expect(asked.own).toBe(true);
    expect(asked.conversationId).toBeUndefined();
    await expectNoAxeViolations(page);
    await panel.getByRole('link', { name: 'Öppna som samtal' }).click();
    await expect(page).toHaveURL(/\/conversations\/om-event-rektorsmote/);
    await expect(page.getByText('Vad står på agendan?', { exact: true }).first()).toBeVisible();
  });
  test('the pane holds the whole conversation about the meeting, oldest first, and finds it again when the meeting is opened again and after a reload', async ({
    page,
    api,
  }) => {
    await page.setViewportSize(WIDE);
    await open(page, '/calendar');
    const block = page.locator('.clew-cal-event').first();
    await block.click();
    const panel = page.getByRole('complementary', { name: 'Morgonmöte ledningsgrupp', exact: true });
    // Opening the meeting gives the focus to its name, not to the box.
    await expect(panel.getByRole('heading', { name: 'Morgonmöte ledningsgrupp' })).toBeFocused();
    const box = panel.getByRole('textbox', { name: 'Fråga om mötet, eller be om en ändring' });
    await box.fill('Vad står på agendan?');
    await box.press('Enter');
    await expect(panel.getByText('Tio personer är på plats i dag.')).toBeVisible();
    await box.fill('Vem kommer?');
    await box.press('Enter');
    // The second exchange is drawn under the first, which stays.
    await expect(panel.getByText('Vem kommer?', { exact: true })).toBeVisible();
    await expect(panel.getByText('Vad står på agendan?', { exact: true })).toBeVisible();
    await expect(panel.getByText('Tio personer är på plats i dag.')).toHaveCount(2);
    expect(api.asked.at(-2)!.conversationId).toBeUndefined();
    expect(api.asked.at(-1)!.conversationId).toMatch(/^om-event-v\d$/);
    // The meeting's facts stay at the top of the pane, and the conversation has one way to its page.
    await expect(panel.getByText('Mona Berg', { exact: true })).toBeVisible();
    await expect(panel.getByRole('link', { name: 'Öppna som samtal' })).toHaveCount(1);
    await expectNoAxeViolations(page);
    // Closed and opened again, the meeting has its conversation.
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await block.click();
    await expect(panel.getByText('Vad står på agendan?', { exact: true })).toBeVisible();
    await expect(panel.getByText('Vem kommer?', { exact: true })).toBeVisible();
    // After a reload too, and the next question goes on in it.
    await page.reload();
    await expect(panel.getByText('Vem kommer?', { exact: true })).toBeVisible();
    await box.fill('Och i morgon?');
    await box.press('Enter');
    await expect(panel.getByText('Och i morgon?', { exact: true })).toBeVisible();
    await expect(panel.getByText('Vad står på agendan?', { exact: true })).toBeVisible();
    expect(api.asked.at(-1)!.conversationId).toBe(api.asked.at(-2)!.conversationId);
  });
  test('asked to move a meeting of one’s own, the assistant fills in Flytta …: its block stands where it would end up, nothing is saved before Spara, and an earlier answer fills it in only when asked', async ({
    page,
    api: _,
  }) => {
    await page.setViewportSize(WIDE);
    const sent: { start: string; end: string; ref: string }[] = [];
    page.on('request', request => {
      if (request.method() === 'POST' && request.url().endsWith('/api/calendar/events/reschedule'))
        sent.push(request.postDataJSON());
    });
    await open(page, '/calendar');
    await page.locator('.clew-cal-event').first().click();
    const panel = page.getByRole('complementary', { name: 'Morgonmöte ledningsgrupp', exact: true });
    const box = panel.getByRole('textbox', { name: 'Fråga om mötet, eller be om en ändring' });
    await box.fill('Flytta till torsdag eftermiddag');
    await box.press('Enter');
    // The move form: its fields with the prepared time, the conversation under them, the box over its buttons.
    const form = page.getByRole('complementary', { name: 'Flytta Morgonmöte ledningsgrupp' });
    const answer = /^Torsdag 13:00–13:30 är ledigt/;
    await expect(form.getByText(answer)).toBeVisible();
    const field = (name: string) => form.getByLabel(name, { exact: true }).and(page.locator('input'));
    await expect(field('Dag')).toHaveValue(/^(5 november 2026|2026-11-05)$/);
    await expect(field('Börjar')).toHaveValue('13:00');
    await expect(field('Slutar')).toHaveValue('13:30');
    await expect(form.getByText('Tid nu')).toBeVisible();
    // Its block is on the grid where it would end up, drawn as the time being placed.
    await expect(page.locator('.clew-cal-draft')).toHaveCount(1);
    await expect(page.locator('.clew-cal-draft')).toContainText('Morgonmöte ledningsgrupp');
    await expect
      .poll(() => announcements(page))
      .toContainEqual(expect.stringContaining('Inget är sparat förrän du trycker på Spara.'));
    expect(sent).toHaveLength(0);
    // The focus stays in the box, which now asks for another time.
    await expect(form.getByRole('textbox', { name: 'Be om en annan tid' })).toBeFocused();
    await expect(form.getByRole('button', { name: 'Spara' })).toBeVisible();
    await expectNoAxeViolations(page);
    // Esc goes back to the meeting with its conversation; the block leaves the grid and nothing is saved.
    await page.keyboard.press('Escape');
    await expect(form).toHaveCount(0);
    await expect(panel.getByText(answer)).toBeVisible();
    await expect(page.locator('.clew-cal-draft')).toHaveCount(0);
    expect(sent).toHaveLength(0);
    // Under the answer, the time it prepared and the button that fills the form in again.
    await expect(panel.getByText(/^Torsdag 5 november\s·\s13:00–13:30$/)).toBeVisible();
    await panel.getByRole('button', { name: 'Använd tiden' }).click();
    await expect(field('Börjar')).toHaveValue('13:00');
    await form.getByRole('button', { name: 'Spara' }).click();
    await expect.poll(() => sent.length).toBe(1);
    expect(Date.parse(sent[0]!.start)).toBe(Date.parse('2026-11-05T12:00:00.000Z'));
    expect(Date.parse(sent[0]!.end)).toBe(Date.parse('2026-11-05T12:30:00.000Z'));
    expect(sent[0]!.ref).toMatch(/^memory:v\d$/);
  });
  test('Visa i kalendern under the answer in its conversation opens the meeting with the move filled in, once; a reload shows the conversation and opens no form', async ({
    page,
    api: _,
  }) => {
    await page.setViewportSize(WIDE);
    await open(page, '/calendar');
    await page.locator('.clew-cal-event').first().click();
    const panel = page.getByRole('complementary', { name: 'Morgonmöte ledningsgrupp', exact: true });
    const box = panel.getByRole('textbox', { name: 'Fråga om mötet, eller be om en ändring' });
    await box.fill('Flytta till torsdag eftermiddag');
    await box.press('Enter');
    const form = page.getByRole('complementary', { name: 'Flytta Morgonmöte ledningsgrupp' });
    await form.getByRole('link', { name: 'Öppna som samtal' }).click();
    await expect(page).toHaveURL(/\/conversations\/om-event-v\d/);
    // Under the answer: the prepared time in words, and the way to the calendar. Nothing is saved from here.
    await expect(page.getByText(/^Torsdag 5 november\s·\s13:00–13:30$/)).toBeVisible();
    await page.getByRole('button', { name: 'Visa i kalendern' }).click();
    await expect(page).toHaveURL(/\/calendar\?.*entry=v\d/);
    await expect(form).toBeVisible();
    const field = (name: string) => form.getByLabel(name, { exact: true }).and(page.locator('input'));
    await expect(field('Börjar')).toHaveValue('13:00');
    await expect(page.locator('.clew-cal-draft')).toHaveCount(1);
    // The prepared move came in the router's state, never in the address, and a reload does not fill it in again.
    expect(page.url()).not.toMatch(/prepared|13%3A00|T12/);
    await page.reload();
    await expect(panel.getByText(/^Torsdag 13:00–13:30 är ledigt/)).toBeVisible();
    await expect(form).toHaveCount(0);
    await expect(page.locator('.clew-cal-draft')).toHaveCount(0);
  });
  test('asked to cancel a meeting of one’s own, the assistant opens the page’s own question; Avbryt leaves everything as it was and Ja, ställ in cancels', async ({
    page,
    api: _,
  }) => {
    await page.setViewportSize(WIDE);
    const sent: unknown[] = [];
    page.on('request', request => {
      if (request.method() === 'POST' && request.url().endsWith('/api/calendar/events/cancel'))
        sent.push(request.postDataJSON());
    });
    await open(page, '/calendar');
    await page.locator('.clew-cal-event').first().click();
    const panel = page.getByRole('complementary', { name: 'Morgonmöte ledningsgrupp', exact: true });
    const box = panel.getByRole('textbox', { name: 'Fråga om mötet, eller be om en ändring' });
    await box.fill('Ställ in mötet');
    await box.press('Enter');
    // The entry's own question, as "Ställ in …" asks it; nothing is cancelled until the person answers it.
    const dialog = page.getByRole('dialog', { name: 'Morgonmöte ledningsgrupp' });
    await expect(dialog.getByText('Ställ in mötet?')).toBeVisible();
    await expect
      .poll(() => announcements(page))
      .toContainEqual(expect.stringContaining('Inget är inställt förrän du svarar ja.'));
    expect(sent).toHaveLength(0);
    await expectNoAxeViolations(page);
    await dialog.getByRole('button', { name: 'Avbryt' }).click();
    await expect(dialog).toBeHidden();
    await expect(panel).toBeVisible();
    await expect(panel.getByText(/^Mötet kan ställas in/)).toBeVisible();
    expect(sent).toHaveLength(0);
    // Under the answer, the meeting and the button that asks the same question again.
    await panel.getByRole('button', { name: 'Ställ in mötet …' }).click();
    await expect(dialog.getByText('Ställ in mötet?')).toBeVisible();
    await dialog.getByRole('button', { name: 'Ja, ställ in' }).click();
    await expect.poll(() => sent.length).toBe(1);
  });
  test('the frame’s Fråga assistenten gives the pane to the week: the box has the focus, the question goes with the week’s read, and Esc gives the focus back (D130)', async ({
    page,
    api,
  }) => {
    await page.setViewportSize(WIDE);
    await open(page, '/calendar');
    // One button, the same on every page, at the end of the title's line: the old "Fråga om veckan" is gone.
    await expect(page.getByRole('button', { name: 'Fråga om veckan' })).toHaveCount(0);
    const button = page.getByRole('button', { name: 'Fråga assistenten' });
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await button.click();
    const pane = page.getByRole('complementary', { name: 'Assistenten', exact: true });
    await expect(pane.getByText('Om vecka 45', { exact: true })).toBeVisible();
    const box = pane.getByRole('textbox', { name: 'Fråga om veckan' });
    await expect(box).toBeFocused();
    await expect(page).toHaveURL(/\/calendar\?ask=1$/);
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    await expectNoAxeViolations(page);
    await box.fill('Vad händer i veckan?');
    await box.press('Enter');
    await expect(pane.getByText('Tio personer är på plats i dag.')).toBeVisible();
    const asked = api.asked.at(-1)!;
    expect(asked.chips).toEqual([{ ref: 'capability:calendar.week', kind: 'capability', label: 'Vecka 45' }]);
    expect(asked.beside).toBe('capability:calendar.week');
    expect(asked.own).toBe(true);
    expect(asked.page).toEqual({ subject: 'range:week:2026-11-02', label: 'Om vecka 45' });
    await page.keyboard.press('Escape');
    await expect(pane).toHaveCount(0);
    await expect(page).not.toHaveURL(/ask=1/);
    await expect(button).toBeFocused();
  });
  test('an entry opened takes the place of the assistant’s pane, and the button lets go of the entry (D130 rule 5)', async ({
    page,
    api: _,
  }) => {
    await page.setViewportSize(WIDE);
    await open(page, '/calendar');
    const button = page.getByRole('button', { name: 'Fråga assistenten' });
    await button.click();
    const pane = page.getByRole('complementary', { name: 'Assistenten', exact: true });
    await expect(pane).toBeVisible();
    await page.locator('.clew-cal-event').first().click();
    const entry = page.getByRole('complementary', { name: 'Morgonmöte ledningsgrupp', exact: true });
    await expect(entry).toBeVisible();
    await expect(pane).toHaveCount(0);
    await expect(page).toHaveURL(/entry=/);
    await expect(page).not.toHaveURL(/ask=1/);
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await button.click();
    await expect(pane).toBeVisible();
    await expect(entry).toHaveCount(0);
    await expect(page).not.toHaveURL(/entry=/);
    await expect(pane.getByRole('textbox', { name: 'Fråga om veckan' })).toBeFocused();
    // Back gives the entry its place again.
    await page.goBack();
    await expect(entry).toBeVisible();
    await expect(pane).toHaveCount(0);
  });
  test('the pane says in plain words what asking here does, and an answer that needs room is one row that leads to the conversation (D130 rules 7 and 10)', async ({
    page,
    api: _,
  }) => {
    await page.setViewportSize(WIDE);
    await open(page, '/calendar');
    await page.getByRole('button', { name: 'Fråga assistenten' }).click();
    const pane = page.getByRole('complementary', { name: 'Assistenten', exact: true });
    // Before anything is asked: what asking here does, and what opening it as a conversation adds.
    await expect(
      pane.getByText('Svaret visas här, bredvid sidan, och finns kvar när du kommer tillbaka.'),
    ).toBeVisible();
    await expect(pane.getByText(/^Öppnar du frågan som ett samtal får den hela sidan/)).toBeVisible();
    await expect(pane.getByRole('link', { name: 'Öppna som samtal' })).toHaveCount(1);
    const box = pane.getByRole('textbox', { name: 'Fråga om veckan' });
    await box.fill('Sök lärare i telefonboken');
    await box.press('Enter');
    await expect(pane.getByText('Sök i telefonboken: 2 rader.')).toBeVisible();
    await expect(pane.getByText('Svaret visas här, bredvid sidan, och finns kvar när du kommer tillbaka.')).toHaveCount(
      0,
    );
    // The view is drawn on the conversation's page: here one row names it and leads there.
    await expect(pane.getByText('Sök i telefonboken', { exact: true })).toBeVisible();
    const row = pane.getByRole('link', { name: 'Visa i samtalet' });
    await expect(row).toHaveCount(1);
    await expectNoAxeViolations(page);
    await row.click();
    await expect(page).toHaveURL(/\/conversations\/[^/?]+/);
  });
  test('cancelling opens the entry’s dialog at the question, asks once, inline, and is spoken when done', async ({
    page,
    api: _,
  }) => {
    await page.setViewportSize(WIDE);
    await open(page, '/calendar');
    await page.locator('.clew-cal-event').first().click();
    const panel = page.getByRole('complementary', { name: 'Morgonmöte ledningsgrupp' });
    await panel.getByRole('button', { name: 'Ställ in …' }).click();
    const dialog = page.getByRole('dialog', { name: 'Morgonmöte ledningsgrupp' });
    await expect(dialog.getByText('Ställ in mötet?')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(1);
    await dialog.getByRole('button', { name: 'Ja, ställ in' }).click();
    await expect(dialog).toBeHidden();
    await expect
      .poll(() => announcements(page))
      .toContainEqual(expect.stringContaining('Beslutet att ställa in mötet är sparat.'));
  });
  test('a proposal is moved from the keyboard, never only by drag', async ({ page, api: _ }) => {
    await page.setViewportSize(WIDE);
    await open(page, `/calendar?date=${NEXT_WEEK}`);
    const block = page.locator('.clew-cal-event-proposal').first();
    await block.focus();
    await page.keyboard.press('Enter');
    const panel = page.getByRole('complementary', { name: 'Utvecklingssamtal', exact: true });
    await panel.getByRole('button', { name: 'Flytta …' }).click();
    // The move is a form in the same pane: its first field has the focus, and a samtal has no end to set.
    const form = page.getByRole('complementary', { name: 'Flytta Utvecklingssamtal' });
    const field = (name: string) => form.getByLabel(name, { exact: true }).and(page.locator('input'));
    await expect(field('Dag')).toBeFocused();
    await expect(field('Slutar')).toHaveCount(0);
    await expect(form.getByText('behåller sin längd')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expectNoAxeViolations(page);
    await form.getByRole('button', { name: 'Spara' }).click();
    await expect(form).toHaveCount(0);
    await expect.poll(() => announcements(page)).toContainEqual(expect.stringContaining('Förslaget ligger nu'));
    // The entry stands in the pane again.
    await expect(panel).toBeVisible();
  });
  test('a meeting of one’s own is moved in the pane: its block is the one being placed, the fields are the keyboard path, and Escape goes back to the meeting', async ({
    page,
    api: _,
  }) => {
    await page.setViewportSize(WIDE);
    const sent: { start: string; end: string }[] = [];
    page.on('request', request => {
      if (request.method() === 'POST' && request.url().endsWith('/api/calendar/events/reschedule'))
        sent.push(request.postDataJSON());
    });
    await open(page, '/calendar');
    await page.locator('.clew-cal-event').first().click();
    const panel = page.getByRole('complementary', { name: 'Morgonmöte ledningsgrupp', exact: true });
    await panel.getByRole('button', { name: 'Flytta …' }).click();
    const form = page.getByRole('complementary', { name: 'Flytta Morgonmöte ledningsgrupp' });
    await expect(form.getByText('Tid nu')).toBeVisible();
    await expect(page.locator('.clew-cal-draft')).toHaveCount(1);
    // Escape lets go of the move, not of the meeting.
    await page.keyboard.press('Escape');
    await expect(form).toHaveCount(0);
    await expect(panel).toBeVisible();
    await expect(page.locator('.clew-cal-draft')).toHaveCount(0);
    await panel.getByRole('button', { name: 'Flytta …' }).click();
    const end = form.getByLabel('Slutar', { exact: true }).and(page.locator('input'));
    const was = await end.inputValue();
    await end.fill('16:00');
    await end.press('Tab');
    await form.getByRole('button', { name: 'Spara' }).click();
    await expect
      .poll(() => announcements(page))
      .toContainEqual(expect.stringContaining('Beslutet att flytta mötet är sparat.'));
    expect(sent).toHaveLength(1);
    expect(was).not.toBe('16:00');
    expect(new Date(sent[0]!.end).getTime()).toBeGreaterThan(new Date(sent[0]!.start).getTime());
  });
  // The form's buttons are the pane's foot: a low window never cuts them off.
  test('in a low window the move form keeps its actions on screen', async ({ page, api: _ }) => {
    await page.setViewportSize({ width: WIDE.width, height: 600 });
    await open(page, `/calendar?date=${NEXT_WEEK}`);
    await page.locator('.clew-cal-event-proposal').first().click();
    await page
      .getByRole('complementary', { name: 'Utvecklingssamtal' })
      .getByRole('button', { name: 'Flytta …' })
      .click();
    const form = page.getByRole('complementary', { name: 'Flytta Utvecklingssamtal' });
    await expect(form.getByRole('button', { name: 'Spara' })).toBeInViewport({ ratio: 1 });
    await expect(form.getByRole('button', { name: 'Avbryt' })).toBeInViewport({ ratio: 1 });
    await expect(form.getByText('behåller sin längd')).toBeInViewport({ ratio: 1 });
  });
  test('below the beside width the entry is the drawer over the grid, and closing it gives the focus back', async ({
    page,
    api: _,
  }) => {
    await page.setViewportSize(desktop);
    await open(page, '/calendar');
    const block = page.locator('.clew-cal-event').first();
    await block.focus();
    await page.keyboard.press('Enter');
    const drawer = page.getByRole('dialog', { name: 'Morgonmöte ledningsgrupp' });
    await expect(drawer.getByRole('button', { name: 'Flytta …' })).toBeVisible();
    // The same pane as beside the grid: its buttons without "Fråga assistenten", and the box at its foot from the start.
    await expect(drawer.getByRole('button', { name: 'Fråga assistenten' })).toHaveCount(0);
    await expect(drawer.getByRole('textbox', { name: 'Fråga om mötet, eller be om en ändring' })).toBeVisible();
    await expectNoAxeViolations(page);
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
    await expect(block).toBeFocused();
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

/**
 * The calendar that does not answer says so in the page's own head, with since when and Försök igen, and the grid keeps
 * what it has (D116, amended 2026-11-12): no banner over the page. A person with no calendar gets the page's answer, not
 * a warning; the rail draws Kalender while the calendar is the person's to see (D23).
 */
test.describe('Kalender when the calendar does not answer, and for a person with no calendar', () => {
  const said = async (page: Page, words: string) =>
    (await announcements(page)).filter(text => text.includes(words)).length;
  const rail = (page: Page) => page.getByRole('navigation', { name: 'Mina sidor', exact: true });

  test('the head says that the calendar does not answer, with Försök igen, which reads the week again; nothing is drawn as a free week, and it is said once', async ({
    page,
    api,
  }) => {
    await page.setViewportSize(desktop);
    api.calendar = 'silent';
    await open(page, '/calendar?view=week');
    // In the page, not the live region that says it once (4.1.3).
    const notice = page.getByRole('main').getByText('Kalendern svarar inte', { exact: true });
    await expect(notice).toBeVisible();
    // In the page's head, under its title, and nowhere above the page.
    const title = (await page.getByRole('heading', { level: 1 }).boundingBox())!;
    expect((await notice.boundingBox())!.y).toBeGreaterThan(title.y);
    expect(await silentSaidIn(page)).not.toContain('outside main');
    await expect(page.getByRole('button', { name: 'Ny bokning' })).toBeVisible();
    // Nothing read: no empty grid that would pass for a free week, but what the page can say.
    await expect(heading(page, 2, 'Kalendern kan inte visas just nu')).toBeVisible();
    await expect.poll(() => said(page, 'Kalendern svarar inte')).toBe(1);
    await expectNoAxeViolations(page);
    api.calendar = 'ok';
    await page.getByRole('button', { name: 'Försök igen' }).click();
    await expect(notice).toHaveCount(0);
    await expect(page.getByText('Morgonmöte ledningsgrupp').first()).toBeVisible();
    expect(await said(page, 'Kalendern svarar inte')).toBe(1);
  });

  test('since when the calendar last answered, when the statuses say it', async ({ page, api }) => {
    await page.setViewportSize(desktop);
    api.calendar = 'silent';
    api.sources = [
      { connector: 'calendar', state: 'idle', lastSuccess: '2026-11-04T05:00:00.000Z', error: 'unavailable' },
    ];
    await open(page, '/calendar?view=week');
    await expect(page.getByText('Kalendern svarar inte sedan 06:00', { exact: true })).toBeVisible();
    await expect.poll(() => said(page, 'Kalendern svarar inte')).toBe(1);
  });

  test('the head with the notice reflows at 320 px', async ({ page, api }) => {
    await page.setViewportSize(narrow);
    api.calendar = 'silent';
    await open(page, '/calendar?view=week');
    await expect(page.getByRole('main').getByText('Kalendern svarar inte', { exact: true })).toBeVisible();
    expect(await reflowProblems(page)).toEqual([]);
  });

  for (const [state, line, inRail] of [
    ['hidden', 'En administratör kopplar kalendern under Anslutna system.', false],
    ['unbound', 'En administratör kopplar ditt kalenderkonto.', true],
  ] as const)
    test(`with no calendar (${state}) the page says so and who connects one, with no warning and no grid`, async ({
      page,
      api,
    }) => {
      await page.setViewportSize(desktop);
      api.calendar = state;
      await open(page, '/calendar');
      await expect(heading(page, 1, 'Kalender')).toBeVisible();
      await expect(heading(page, 2, 'Ingen kalender är kopplad till dig')).toBeVisible();
      await expect(page.getByText(line, { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Ny bokning' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Försök igen' })).toHaveCount(0);
      expect(await silentSaidIn(page)).toEqual([]);
      expect(await said(page, 'svarar inte')).toBe(0);
      await expect(page).toHaveTitle('Kalender · Startsidan');
      await expect(rail(page).getByRole('link', { name: 'Kalender', exact: true })).toHaveCount(inRail ? 1 : 0);
      await expectNoAxeViolations(page);
    });
});
