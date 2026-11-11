import type { Page } from '@playwright/test';
import { TALKS_FAIL_ERROR, TALK_LENS } from './data';
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
} from './support';

/**
 * One person's utvecklingssamtal (D96 item 7) as a focused overlay over Personal (D83): an end Drawer on a desktop, a
 * tall sheet on a phone, at `/staff?talk=<personId>`. Both surfaces are a modal dialog named "Samtal med <name>". Since
 * D97 Personal knows no talk: the way in from the list is the source's page, "Öppna samtalet" in the person's menu. The
 * mock's round (`data.ts`): Anna's talk is held with one action point carried over, two of this round's and one done;
 * Erik's is booked with one carried over; Karin's is missing with none; Lena's is booked with none.
 */
const talk = (page: Page, name: string) => page.getByRole('dialog', { name: `Samtal med ${name}`, exact: true });
const menuOf = (page: Page, name: string) => page.getByRole('button', { name: `Åtgärder för ${name}`, exact: true });
const notices = (page: Page) => page.getByRole('region', { name: 'Aviseringar' });

for (const [layout, viewport] of [
  ['desktop', desktop],
  ['phone', phone],
] as const)
  test.describe(`a talk on ${layout}`, () => {
    test.use({ viewport });
    for (const [id, name, state] of [
      ['anna', 'Anna Lindqvist', 'Hållet'],
      ['erik', 'Erik Sandström', 'Bokat'],
      ['karin', 'Karin Lindqvist', 'Saknas'],
      ['lena', 'Lena Berg', 'Bokat'],
    ] as const)
      test(`${name}'s talk (${state}) has no axe violations and every focus stop in it is marked`, async ({
        page,
        api,
      }) => {
        expect(api.talksWritable).toBe(true);
        await open(page, `/staff?talk=${id}`);
        const dialog = talk(page, name);
        await expect(dialog).toBeVisible();
        await expect(dialog.getByRole('heading', { level: 2, name })).toBeVisible();
        await expect(dialog.getByText(state, { exact: true })).toBeVisible();
        await expect(dialog.getByRole('heading', { name: 'Åtgärdspunkter' })).toBeVisible();
        await expect(page).toHaveTitle(`Samtal med ${name} · Startsidan`);
        await expectNoAxeViolations(page);
        const { unmarked, hidden } = await hiddenFocusStops(page);
        expect(unmarked).toEqual([]);
        expect(hidden).toEqual([]);
      });

    test('the points are grouped: carried over first, then this round, then done, each with who answers and when', async ({
      page,
      api,
    }) => {
      expect(api.commitments.length).toBeGreaterThan(0);
      await open(page, '/staff?talk=anna');
      const dialog = talk(page, 'Anna Lindqvist');
      await expect(dialog.getByText('Utvecklingssamtal hösten 2026', { exact: true })).toBeVisible();
      await expect(dialog.getByText('tis 3 nov.', { exact: true })).toBeVisible();
      const headings = dialog.getByRole('heading', { level: 4 });
      await expect(headings).toHaveText(['Kvar från tidigare samtal', 'Från det här samtalet', 'Klara']);
      const carried = dialog.getByRole('list', { name: 'Kvar från tidigare samtal' });
      await expect(carried.getByRole('listitem')).toHaveCount(1);
      await expect(carried).toContainText('Gå kursen i handledning');
      await expect(carried).toContainText('Medarbetaren · senast');
      await expect(carried.getByText('Försenad', { exact: true })).toBeVisible();
      // Only the reader's own point can be ticked off (D96 item 4: the owner marks their own done).
      await expect(carried.getByRole('button')).toHaveCount(0);
      const open_ = dialog.getByRole('list', { name: 'Från det här samtalet' });
      await expect(open_.getByRole('listitem')).toHaveCount(2);
      await expect(open_.getByRole('button', { name: 'Klar: Boka in auskultation i årskurs 4' })).toBeVisible();
      await expect(open_.getByText(/^Du · senast/)).toBeVisible();
      await expect(open_.getByText('Försenad', { exact: true })).toHaveCount(0);
      const done = dialog.getByRole('list', { name: 'Klara' });
      await expect(done).toContainText('Läsa in sig på den nya kursplanen');
      await expect(done.getByText('Försenad', { exact: true })).toHaveCount(0);
      // Held: undone with Ångra, nothing to mark again.
      await expect(dialog.getByRole('button', { name: 'Ångra', exact: true })).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Markera som hållet' })).toHaveCount(0);
      await expect(dialog.getByRole('form', { name: 'Ny åtgärdspunkt' })).toBeVisible();
    });

    test('a person with no points draws no empty groups', async ({ page, api }) => {
      expect(api.commitments.some(c => c.personId === 'lena')).toBe(false);
      await open(page, '/staff?talk=lena');
      const dialog = talk(page, 'Lena Berg');
      await expect(dialog.getByText('Inga åtgärdspunkter än.')).toBeVisible();
      await expect(dialog.getByRole('heading', { level: 4 })).toHaveCount(0);
      await expect(dialog.getByText('tors 12 nov. kl. 14:30', { exact: true })).toBeVisible();
    });

    test('the whole flow by keyboard: open, add a point, tick it off, open it again, mark held, undo, close', async ({
      page,
      api,
    }) => {
      await open(page, '/staff');
      // The way in is the source's page in the person's menu (D97): open the menu, go to Öppna samtalet, take it.
      const opener = menuOf(page, 'Karin Lindqvist');
      await opener.focus();
      await page.keyboard.press('Enter');
      const item = page.getByRole('menuitem', { name: 'Öppna samtalet' });
      await expect(item).toBeVisible();
      for (let i = 0; i < 3 && !(await item.evaluate(el => el === document.activeElement)); i++)
        await page.keyboard.press('ArrowDown');
      await expect(item).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL('/staff?talk=karin');
      const dialog = talk(page, 'Karin Lindqvist');
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText('Saknas', { exact: true })).toBeVisible();

      // Add a point the reader answers for.
      const text = dialog.getByRole('textbox', { name: /Vad ska göras/ });
      await text.focus();
      await page.keyboard.type('Ta fram en plan för introduktionen');
      await page.keyboard.press('Tab');
      await expect(dialog.getByRole('radio', { name: 'Medarbetaren' })).toBeFocused();
      await page.keyboard.press('ArrowRight');
      await expect(dialog.getByRole('radio', { name: 'Du' })).toBeChecked();
      const date = dialog.getByLabel('Klart senast', { exact: true }).and(page.locator('input'));
      await date.focus();
      await page.keyboard.type('2026-11-20');
      await page.keyboard.press('Tab');
      await expect(date).toHaveValue('20 november 2026');
      await dialog.getByRole('button', { name: 'Lägg till' }).focus();
      await page.keyboard.press('Enter');
      await expect(notices(page).getByText('Åtgärdspunkten är tillagd.')).toBeAttached();
      // The fields empty and the focus is back on the text, ready for the next one.
      await expect(text).toBeFocused();
      await expect(text).toHaveValue('');
      await expect(date).toHaveValue('');
      expect(api.talkWrites.at(-1)).toEqual({
        method: 'POST',
        path: '/talks/karin/commitments',
        body: { owner: 'manager', text: 'Ta fram en plan för introduktionen', dueOn: '2026-11-20' },
      });
      const thisRound = dialog.getByRole('list', { name: 'Från det här samtalet' });
      await expect(thisRound).toContainText('Ta fram en plan för introduktionen');
      await expect(thisRound).toContainText('Du · senast fre 20 nov.');

      // Tick it off: the row moves to Klara and its Öppna igen takes the focus.
      await thisRound.getByRole('button', { name: 'Klar: Ta fram en plan för introduktionen' }).focus();
      await page.keyboard.press('Enter');
      const reopen = dialog
        .getByRole('list', { name: 'Klara' })
        .getByRole('button', { name: 'Öppna igen: Ta fram en plan för introduktionen' });
      await expect(reopen).toBeFocused();
      await expect(notices(page).getByText('Åtgärdspunkten är klar.')).toBeAttached();
      await expect(dialog.getByRole('list', { name: 'Från det här samtalet' })).toHaveCount(0);

      // Open it again: back in this round's group, with Klar focused.
      await page.keyboard.press('Enter');
      await expect(
        dialog
          .getByRole('list', { name: 'Från det här samtalet' })
          .getByRole('button', { name: 'Klar: Ta fram en plan för introduktionen' }),
      ).toBeFocused();
      await expect(notices(page).getByText('Åtgärdspunkten är öppen igen.')).toBeAttached();

      // Mark the talk held, then undo it.
      await dialog.getByRole('button', { name: 'Markera som hållet' }).focus();
      await page.keyboard.press('Enter');
      const undo = dialog.getByRole('button', { name: 'Ångra', exact: true });
      await expect(undo).toBeFocused();
      await expect(dialog.getByText('Hållet', { exact: true })).toBeVisible();
      await expect(dialog.getByText('ons 4 nov.', { exact: true })).toBeVisible();
      await expect(notices(page).getByText('Samtalet är markerat som hållet.')).toBeAttached();
      await page.keyboard.press('Enter');
      await expect(dialog.getByRole('button', { name: 'Markera som hållet' })).toBeFocused();
      await expect(dialog.getByText('Saknas', { exact: true })).toBeVisible();
      await expect(notices(page).getByText('Samtalet är inte längre markerat som hållet.')).toBeAttached();

      // Escape closes the talk; the list is where it was and the focus is on the control that opened it.
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(page).toHaveURL('/staff');
      await expect(opener).toBeFocused();
      await expect(page).toHaveTitle('Personal · Startsidan');
    });

    test('a failing write shows the server sentence as an alert and keeps what was typed', async ({ page, api }) => {
      await open(page, '/staff?talk=erik');
      const dialog = talk(page, 'Erik Sandström');
      const form = dialog.getByRole('form', { name: 'Ny åtgärdspunkt' });
      const text = form.getByRole('textbox', { name: /Vad ska göras/ });
      await text.fill('Gå en kurs i konflikthantering');
      // Nothing chosen as the date: the field says so and takes the focus; nothing is sent.
      const writes = api.talkWrites.length;
      await form.getByRole('button', { name: 'Lägg till' }).click();
      const date = form.getByLabel('Klart senast', { exact: true }).and(page.locator('input'));
      await expect(date).toBeFocused();
      await expect(form.getByText('Välj ett datum.')).toBeVisible();
      expect(api.talkWrites).toHaveLength(writes);
      await date.fill('2026-12-01');
      await date.press('Tab');
      api.talksFail = true;
      await form.getByRole('button', { name: 'Lägg till' }).click();
      // Astryx keeps an empty assertive live region in the date field; the form's own alert is the one with words.
      await expect(form.getByRole('alert').filter({ hasText: /\S/ })).toHaveText(TALKS_FAIL_ERROR);
      await expect(text).toHaveValue('Gå en kurs i konflikthantering');
      await expect(date).toHaveValue('1 december 2026');
      await expect(dialog.getByText('Gå en kurs i konflikthantering', { exact: true })).toHaveCount(0);
      await expectNoAxeViolations(page);
    });

    test('the address survives a reload, Stäng returns to the list with the focus on the person', async ({
      page,
      api,
    }) => {
      expect(api.talksRound).not.toBeNull();
      await open(page, '/staff?talk=erik');
      await expect(talk(page, 'Erik Sandström')).toBeVisible();
      await page.reload();
      const dialog = talk(page, 'Erik Sandström');
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText('Se över schemat för rastvakter')).toBeVisible();
      await dialog.getByRole('button', { name: 'Stäng', exact: true }).click();
      await expect(dialog).toBeHidden();
      await expect(page).toHaveURL('/staff');
      // Nothing on the page opened it after the reload: the person's own link on the list takes the focus.
      await expect(page.getByRole('link', { name: 'Erik Sandström', exact: true })).toBeFocused();
    });

    test('Back closes the talk and Forward opens it again', async ({ page, api }) => {
      expect(api.talksWritable).toBe(true);
      await open(page, `/staff?show=${TALK_LENS}`);
      const opener = menuOf(page, 'Anna Lindqvist');
      await opener.click();
      await page.getByRole('menuitem', { name: 'Öppna samtalet' }).click();
      // The way in keeps the lens the list was under.
      await expect(page).toHaveURL(`/staff?show=${TALK_LENS}&talk=anna`);
      const dialog = talk(page, 'Anna Lindqvist');
      await expect(dialog).toBeVisible();
      await page.goBack();
      await expect(page).toHaveURL(`/staff?show=${TALK_LENS}`);
      await expect(dialog).toBeHidden();
      await expect(opener).toBeFocused();
      await page.goForward();
      await expect(page).toHaveURL(`/staff?show=${TALK_LENS}&talk=anna`);
      await expect(dialog).toBeVisible();
    });

    test('an id that is not on the reader’s units shows an empty state with the way back', async ({ page, api }) => {
      expect(api.staff.units.flatMap(u => u.people).some(p => p.id === 'nobody')).toBe(false);
      await open(page, '/staff?talk=nobody');
      const dialog = page.getByRole('dialog', { name: 'Samtalet finns inte', exact: true });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('heading', { name: 'Personen finns inte på dina enheter' })).toBeVisible();
      await expectNoAxeViolations(page);
      await dialog.getByRole('button', { name: 'Tillbaka till Personal' }).click();
      await expect(dialog).toBeHidden();
      await expect(page).toHaveURL('/staff');
    });

    test('with no open round the carried points are listed and nothing can be written', async ({ page, api }) => {
      api.talksRound = null;
      await open(page, '/staff?talk=anna');
      const dialog = talk(page, 'Anna Lindqvist');
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText(/^Ingen samtalsomgång är öppen\./)).toHaveCount(1);
      await expect(dialog.getByRole('list', { name: 'Kvar från tidigare samtal' })).toContainText(
        'Gå kursen i handledning',
      );
      await expect(dialog.getByRole('button', { name: 'Markera som hållet' })).toHaveCount(0);
      await expect(dialog.getByRole('form', { name: 'Ny åtgärdspunkt' })).toHaveCount(0);
      await expectNoAxeViolations(page);
    });

    test('when the round cannot be read the talk says so with Försök igen and the list stands', async ({
      page,
      api,
    }) => {
      expect(api.talksOffered).toBe(true);
      await page.route('**/api/cap/clew.talks?**', route =>
        route.fulfill({ status: 502, json: { error: 'Utvecklingssamtalen svarar inte just nu.' } }),
      );
      await open(page, '/staff?talk=anna');
      const dialog = page.getByRole('dialog', { name: 'Samtal', exact: true });
      await expect(dialog.getByText('Utvecklingssamtalen svarar inte just nu.')).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Försök igen' })).toBeVisible();
      await expectNoAxeViolations(page);
      await dialog.getByRole('button', { name: 'Stäng', exact: true }).click();
      await expect(dialog).toBeHidden();
      // Personal reads no talk of its own (D97): the list stands as it was, with nothing to say about the round.
      await expect(page.getByRole('link', { name: 'Anna Lindqvist', exact: true })).toBeVisible();
      await expect(page.getByText('Utvecklingssamtalen svarar inte just nu.')).toHaveCount(0);
    });

    test('when the action points cannot be read the talk says so with Försök igen', async ({ page, api }) => {
      expect(api.talksOffered).toBe(true);
      await page.route('**/api/cap/clew.commitments?**', route =>
        route.fulfill({ status: 502, json: { error: 'Åtgärdspunkterna svarar inte just nu.' } }),
      );
      await open(page, '/staff?talk=anna');
      const dialog = talk(page, 'Anna Lindqvist');
      await expect(
        dialog.getByRole('alert').filter({ hasText: 'Åtgärdspunkterna svarar inte just nu.' }),
      ).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Försök igen' })).toBeVisible();
      await expect(dialog.getByText('Hållet', { exact: true })).toBeVisible();
      await expectNoAxeViolations(page);
    });

    test('when another system answers there is no drawer', async ({ page, api }) => {
      api.talksWritable = false;
      await open(page, '/staff?talk=anna');
      await expect(page.getByRole('heading', { level: 1, name: 'Personal' })).toBeVisible();
      await expect(page.getByRole('dialog')).toHaveCount(0);
    });
  });

test.describe('1.4.10 reflow', () => {
  test('the talk reflows at 320 px', async ({ page, api }) => {
    expect(api.talksWritable).toBe(true);
    await page.setViewportSize(narrow);
    await open(page, '/staff?talk=anna');
    const dialog = talk(page, 'Anna Lindqvist');
    await expect(dialog.getByRole('form', { name: 'Ny åtgärdspunkt' })).toBeVisible();
    expect(await reflowProblems(page, dialog)).toEqual([]);
  });
});
