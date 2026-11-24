import type { Page } from '@playwright/test';
import { TALKS_FAIL_ERROR, TALK_LENS, coManagersPoint, entityDetail, entityList, formerManagersPoint } from './data';
import { People } from './person-data';
import {
  SITE,
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
 * One person's utvecklingssamtal (D96 item 7) as the talk tab of the person's page (D126 rule 3: nothing opens over a
 * page), at `/people/<id>?section=<the talks source>`; the address that laid the drawer over a page (`/staff?talk=<id>`)
 * leads there, with the page it lay over as the way back. Since D97 Personal knows no talk: the way in is the source's
 * page, "Öppna samtalet" in the person's menu, and the tab itself on the person's page. The mock's round (`data.ts`):
 * Anna's talk is held with one action point carried over, two of this round's and one done; Erik's is booked by an
 * invitation Clew sent, with one carried over; Karin's is missing with none; Lena's is booked at a time set by hand, with
 * none (D132).
 */
const talk = (page: Page, _name: string) =>
  page.getByRole('main').getByRole('region', { name: 'Utvecklingssamtal', exact: true });
const tabOf = (id: string, from = '%2Fstaff') => `/people/${id}?section=${TALK_LENS}&from=${from}`;
/** Lena is on the reader's units but not among the people the list's mock opens: her page, as the server answers it. */
test.beforeEach(async ({ page, api: _ }) => {
  const anna = entityDetail(entityList(), 'anna')!;
  await page.route(
    url => url.pathname === '/api/entities/person/lena',
    route =>
      route.fulfill({
        json: {
          ...anna,
          entity: { ...anna.entity, key: 'lena', id: 'lena', name: 'Lena Berg', sourceKey: 'lena.berg' },
        },
      }),
  );
});
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
        await expect(page).toHaveURL(tabOf(id));
        const dialog = talk(page, name);
        await expect(dialog).toBeVisible();
        await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
        await expect(dialog.getByText(state, { exact: true })).toBeVisible();
        await expect(dialog.getByRole('heading', { name: 'Åtgärdspunkter' })).toBeVisible();
        await expect(page).toHaveTitle(`Utvecklingssamtal · ${name} · ${SITE}`);
        await expectNoAxeViolations(page);
        const { unmarked, hidden } = await hiddenFocusStops(page);
        expect(unmarked).toEqual([]);
        expect(hidden).toEqual([]);
      });

    test('a talk booked by an invitation says so and its time is not changed here; a time set by hand is (D132)', async ({
      page,
      api,
    }) => {
      await open(page, '/staff?talk=erik');
      const erik = talk(page, 'Erik Sandström');
      await expect(erik.getByText('ons 11 nov. kl. 09:00–10:00', { exact: true })).toBeVisible();
      await expect(
        erik.getByText(
          `Bokat genom en inbjudan från ${SITE}. Flytta eller ställ in mötet i kalendern för att ändra tiden.`,
        ),
      ).toBeVisible();
      await expect(erik.getByRole('button', { name: 'Markera som hållet' })).toBeVisible();
      await expect(erik.getByRole('button', { name: 'Ändra tid' })).toHaveCount(0);
      await expect(erik.getByRole('button', { name: 'Ta bort tiden' })).toHaveCount(0);
      await expectNoAxeViolations(page);

      await open(page, '/staff?talk=lena');
      const lena = talk(page, 'Lena Berg');
      await expect(lena.getByText('tors 12 nov. kl. 14:30–15:30', { exact: true })).toBeVisible();
      await expect(lena.getByText(`Tiden är angiven här. Ingen inbjudan har skickats från ${SITE}.`)).toBeVisible();
      await expect(lena.getByRole('button', { name: 'Ändra tid', exact: true })).toBeVisible();
      await expect(lena.getByRole('button', { name: 'Ta bort tiden', exact: true })).toBeVisible();
      await expectNoAxeViolations(page);
      // A talk that is held has no time to set.
      await open(page, '/staff?talk=anna');
      await expect(talk(page, 'Anna Lindqvist').getByRole('button', { name: /tid/i })).toHaveCount(0);
      expect(api.talkWrites).toEqual([]);
    });

    test('the time of a talk by keyboard: Ange tid, what is missing is said on its field, save, change, cancel, remove (D132)', async ({
      page,
      api,
    }) => {
      await open(page, '/staff?talk=karin');
      const dialog = talk(page, 'Karin Lindqvist');
      await expect(dialog.getByText('Saknas', { exact: true })).toBeVisible();
      await dialog.getByRole('button', { name: 'Ange tid', exact: true }).focus();
      await page.keyboard.press('Enter');
      // The form takes the place of the buttons, and the focus is in its first field.
      const form = dialog.getByRole('form', { name: 'Tid för samtalet' });
      const field = (name: string) => form.getByLabel(name, { exact: true }).and(page.locator('input'));
      await expect(form).toBeVisible();
      await expect(field('Börjar')).toBeFocused();
      await expect(dialog.getByRole('button', { name: 'Markera som hållet' })).toHaveCount(0);
      await expectNoAxeViolations(page);
      const { unmarked, hidden } = await hiddenFocusStops(page);
      expect(unmarked).toEqual([]);
      expect(hidden).toEqual([]);

      // Spara with nothing picked: the field says what is missing and takes the focus; nothing is written.
      await form.getByRole('button', { name: 'Spara', exact: true }).focus();
      await page.keyboard.press('Enter');
      await expect(form.getByText('Välj dag och starttid.')).toBeVisible();
      await expect(field('Börjar')).toBeFocused();
      expect(api.talkWrites).toEqual([]);

      // A day and a start: an hour is suggested for the end, and it follows the start the person picks.
      await page.keyboard.type('2026-11-20');
      // The day's field gives the start a time of its own; the person replaces it with theirs.
      await field('Börjar tid').focus();
      await page.keyboard.press('ControlOrMeta+a');
      await page.keyboard.type('13:00');
      await page.keyboard.press('Tab');
      await expect(field('Börjar')).toHaveValue('20 november 2026');
      await expect(field('Börjar tid')).toHaveValue('13:00');
      await expect(field('Slutar')).toHaveValue('14:00');
      await expect(form.getByText('Välj dag och starttid.')).toHaveCount(0);
      await form.getByRole('button', { name: 'Spara', exact: true }).focus();
      await page.keyboard.press('Enter');
      await expect(notices(page).getByText('Tiden för samtalet är sparad.')).toBeAttached();
      // The form is gone, the talk reads booked, and the button that took Ange tid's place has the focus.
      const change = dialog.getByRole('button', { name: 'Ändra tid', exact: true });
      await expect(change).toBeFocused();
      await expect(form).toHaveCount(0);
      await expect(dialog.getByText('Bokat', { exact: true })).toBeVisible();
      await expect(dialog.getByText('fre 20 nov. kl. 13:00–14:00', { exact: true })).toBeVisible();
      await expect(dialog.getByText(`Tiden är angiven här. Ingen inbjudan har skickats från ${SITE}.`)).toBeVisible();
      expect(api.talkWrites).toEqual([
        {
          method: 'PUT',
          path: '/talks/karin/booking',
          body: { start: '2026-11-20T12:00:00Z', end: '2026-11-20T13:00:00Z' },
        },
      ]);

      // Ändra tid opens the form with the time it has; Avbryt writes nothing and hands the focus back.
      await page.keyboard.press('Enter');
      await expect(field('Börjar')).toBeFocused();
      await expect(field('Börjar')).toHaveValue('20 november 2026');
      await expect(field('Börjar tid')).toHaveValue('13:00');
      await expect(field('Slutar')).toHaveValue('14:00');
      await form.getByRole('button', { name: 'Avbryt', exact: true }).focus();
      await page.keyboard.press('Enter');
      await expect(change).toBeFocused();
      expect(api.talkWrites).toHaveLength(1);

      // An end before the start is said on the end's field.
      await page.keyboard.press('Enter');
      await field('Slutar').focus();
      await page.keyboard.press('ControlOrMeta+a');
      await page.keyboard.type('12:00');
      await form.getByRole('button', { name: 'Spara', exact: true }).focus();
      await page.keyboard.press('Enter');
      await expect(form.getByText('Sluttiden måste vara efter starttiden.')).toBeVisible();
      await expect(field('Slutar')).toBeFocused();
      expect(api.talkWrites).toHaveLength(1);
      await form.getByRole('button', { name: 'Avbryt', exact: true }).focus();
      await page.keyboard.press('Enter');

      // Ta bort tiden: the talk lacks a time again, and Ange tid has the focus.
      await dialog.getByRole('button', { name: 'Ta bort tiden', exact: true }).focus();
      await page.keyboard.press('Enter');
      await expect(notices(page).getByText('Tiden för samtalet är borttagen.')).toBeAttached();
      await expect(dialog.getByRole('button', { name: 'Ange tid', exact: true })).toBeFocused();
      await expect(dialog.getByText('Saknas', { exact: true })).toBeVisible();
      expect(api.talkWrites.at(-1)).toMatchObject({ method: 'DELETE', path: '/talks/karin/booking' });
    });

    test('a time the server refuses is said under the fields, and what was picked stays (D132)', async ({
      page,
      api,
    }) => {
      await open(page, '/staff?talk=lena');
      const dialog = talk(page, 'Lena Berg');
      await dialog.getByRole('button', { name: 'Ändra tid', exact: true }).focus();
      await page.keyboard.press('Enter');
      const form = dialog.getByRole('form', { name: 'Tid för samtalet' });
      api.talksFail = true;
      await form.getByRole('button', { name: 'Spara', exact: true }).focus();
      await page.keyboard.press('Enter');
      await expect(form.getByText(TALKS_FAIL_ERROR, { exact: true })).toHaveAttribute('role', 'alert');
      await expect(form.getByLabel('Slutar', { exact: true }).and(page.locator('input'))).toHaveValue('15:30');
      await expect(dialog.getByText('tors 12 nov. kl. 14:30–15:30', { exact: true })).toBeVisible();
      await expectNoAxeViolations(page);
    });

    test('a meeting moved in the calendar is said beside the talk, which stands; the manager moves the talk there by keyboard (D133)', async ({
      page,
      api,
    }) => {
      const moved = { start: '2026-11-13T12:00:00.000Z', end: '2026-11-13T13:00:00.000Z' };
      api.talkRows = api.talkRows.map(row => (row.personId === 'erik' ? { ...row, calendar: moved } : row));
      await open(page, '/staff?talk=erik');
      const dialog = talk(page, 'Erik Sandström');
      // The talk holds: it reads booked at its own time, and the meeting's new time is said apart from it.
      await expect(dialog.getByText('Bokat', { exact: true })).toBeVisible();
      await expect(dialog.getByText('ons 11 nov. kl. 09:00–10:00', { exact: true })).toBeVisible();
      await expect(dialog.getByText('Mötet har flyttats i kalendern', { exact: true })).toBeVisible();
      await expect(
        dialog.getByText(
          'Mötet i kalendern ligger nu på fre 13 nov. kl. 13:00–14:00. Samtalet i Clew står kvar på ons 11 nov. kl. 09:00–10:00. Stämmer inte den nya tiden flyttar du tillbaka mötet i kalendern.',
        ),
      ).toBeVisible();
      await expectNoAxeViolations(page);
      const { unmarked, hidden } = await hiddenFocusStops(page);
      expect(unmarked).toEqual([]);
      expect(hidden).toEqual([]);
      const adopt = dialog.getByRole('button', { name: 'Flytta samtalet till den nya tiden', exact: true });
      await adopt.focus();
      await page.keyboard.press('Enter');
      await expect(notices(page).getByText('Samtalet har flyttats till den nya tiden.')).toBeAttached();
      // Settled: the talk is at the new time, nothing differs, and the focus is on a control that is still there.
      await expect(dialog.getByText('fre 13 nov. kl. 13:00–14:00', { exact: true })).toBeVisible();
      await expect(dialog.getByText('Mötet har flyttats i kalendern', { exact: true })).toHaveCount(0);
      await expect(dialog.getByRole('button', { name: 'Markera som hållet' })).toBeFocused();
      expect(api.talkWrites).toEqual([
        { method: 'POST', path: '/talks/erik/booking/calendar', body: { decision: 'adopt' } },
      ]);
      await expectNoAxeViolations(page);
    });

    test('a meeting gone from the calendar: the manager keeps the time without an invitation, or takes it off (D133)', async ({
      page,
      api,
    }) => {
      const gone = () =>
        (api.talkRows = api.talkRows.map(row =>
          row.personId === 'erik'
            ? {
                ...row,
                state: 'booked' as const,
                at: '2026-11-11T08:00:00.000Z',
                until: '2026-11-11T09:00:00.000Z',
                invited: true,
                own: true,
                calendar: { gone: true as const },
              }
            : row,
        ));
      gone();
      await open(page, '/staff?talk=erik');
      const dialog = talk(page, 'Erik Sandström');
      await expect(dialog.getByText('Mötet är borta ur kalendern', { exact: true })).toBeVisible();
      await expect(
        dialog.getByText(
          'Mötet finns inte längre i kalendern. Samtalet i Clew står kvar på ons 11 nov. kl. 09:00–10:00. Välj om tiden ska stå kvar utan inbjudan.',
        ),
      ).toBeVisible();
      await expectNoAxeViolations(page);
      // Keep: the time stands as one set by hand, and its button has the focus.
      await dialog.getByRole('button', { name: 'Behåll tiden', exact: true }).focus();
      await page.keyboard.press('Enter');
      await expect(notices(page).getByText('Tiden står kvar, utan inbjudan.')).toBeAttached();
      await expect(dialog.getByRole('button', { name: 'Ändra tid', exact: true })).toBeFocused();
      await expect(dialog.getByText(`Tiden är angiven här. Ingen inbjudan har skickats från ${SITE}.`)).toBeVisible();
      await expect(dialog.getByText('Mötet är borta ur kalendern', { exact: true })).toHaveCount(0);
      // Take it off: the talk lacks a time again, and Ange tid has the focus.
      gone();
      await page.reload();
      await expect(dialog.getByText('Mötet är borta ur kalendern', { exact: true })).toBeVisible();
      const banner = dialog.getByRole('button', { name: 'Ta bort tiden', exact: true });
      await banner.focus();
      await page.keyboard.press('Enter');
      await expect(notices(page).getByText('Tiden för samtalet är borttagen.')).toBeAttached();
      await expect(dialog.getByRole('button', { name: 'Ange tid', exact: true })).toBeFocused();
      await expect(dialog.getByText('Saknas', { exact: true })).toBeVisible();
      expect(api.talkWrites.map(w => w.body)).toEqual([{ decision: 'keep' }, { decision: 'remove' }]);
    });

    test('what the calendar holds against another manager’s booking is said, with nothing to decide (D133)', async ({
      page,
      api,
    }) => {
      api.talkRows = api.talkRows.map(row =>
        row.personId === 'erik' ? { ...row, own: false, calendar: { gone: true as const } } : row,
      );
      await open(page, '/staff?talk=erik');
      const dialog = talk(page, 'Erik Sandström');
      await expect(
        dialog.getByText(
          'Mötet finns inte längre i kalendern. Samtalet i Clew står kvar på ons 11 nov. kl. 09:00–10:00. Chefen som bokade samtalet avgör vad som gäller.',
        ),
      ).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Behåll tiden' })).toHaveCount(0);
      await expect(dialog.getByRole('button', { name: 'Ta bort tiden' })).toHaveCount(0);
      await expectNoAxeViolations(page);
    });

    test('a booked talk whose time has passed asks whether it took place: held on the day it was booked for, or the time taken off (D134)', async ({
      page,
      api,
    }) => {
      // The mock's clock is 4 November: Erik's invitation was for the 3rd, and so was the time Lena's manager set by hand.
      const past = { at: '2026-11-03T08:00:00.000Z', until: '2026-11-03T09:00:00.000Z' };
      const set = () =>
        (api.talkRows = api.talkRows.map(row =>
          row.personId === 'erik'
            ? { ...row, ...past, state: 'booked' as const, invited: true, own: true }
            : row.personId === 'lena'
              ? { ...row, ...past, state: 'booked' as const, invited: false, own: true }
              : row,
        ));
      set();
      await open(page, '/staff?talk=erik');
      const erik = talk(page, 'Erik Sandström');
      await expect(erik.getByText('Tiden för samtalet har passerat', { exact: true })).toBeVisible();
      await expect(
        erik.getByText(
          'Markera samtalet som hållet om det blev av. Annars tar du bort tiden, så kan samtalet bokas igen.',
        ),
      ).toBeVisible();
      await expectNoAxeViolations(page);
      const { unmarked, hidden } = await hiddenFocusStops(page);
      expect(unmarked).toEqual([]);
      expect(hidden).toEqual([]);
      // It took place: held on the day it was booked for, not the day this is pressed.
      await erik.getByRole('button', { name: 'Markera som hållet' }).focus();
      await page.keyboard.press('Enter');
      await expect(erik.getByRole('button', { name: 'Ångra', exact: true })).toBeFocused();
      await expect(erik.getByText('tis 3 nov.', { exact: true })).toBeVisible();
      await expect(erik.getByText('Tiden för samtalet har passerat', { exact: true })).toHaveCount(0);
      expect(api.talkWrites.at(-1)).toEqual({
        method: 'POST',
        path: '/talks/erik/held',
        body: { heldOn: '2026-11-03' },
      });
      // It did not: the invitation is over and the talk lacks a time, with Ange tid focused.
      set();
      await page.reload();
      await erik.getByRole('button', { name: 'Samtalet blev inte av', exact: true }).focus();
      await page.keyboard.press('Enter');
      await expect(notices(page).getByText('Tiden för samtalet är borttagen.')).toBeAttached();
      await expect(erik.getByRole('button', { name: 'Ange tid', exact: true })).toBeFocused();
      await expect(erik.getByText('Saknas', { exact: true })).toBeVisible();
      expect(api.talkWrites.at(-1)).toEqual({
        method: 'POST',
        path: '/talks/erik/booking/calendar',
        body: { decision: 'missed' },
      });
      // A time set by hand is taken off as any such time is: one button for it, not two.
      await open(page, '/staff?talk=lena');
      const lena = talk(page, 'Lena Berg');
      await expect(lena.getByText('Tiden för samtalet har passerat', { exact: true })).toBeVisible();
      await expect(lena.getByRole('button', { name: 'Samtalet blev inte av' })).toHaveCount(0);
      await lena.getByRole('button', { name: 'Ta bort tiden', exact: true }).focus();
      await page.keyboard.press('Enter');
      await expect(lena.getByRole('button', { name: 'Ange tid', exact: true })).toBeFocused();
      expect(api.talkWrites.at(-1)).toMatchObject({ method: 'DELETE', path: '/talks/lena/booking' });
    });

    test('another manager’s invitation whose time has passed is theirs to answer for: held can be marked, the time is not taken off here (D134)', async ({
      page,
      api,
    }) => {
      api.talkRows = api.talkRows.map(row =>
        row.personId === 'erik'
          ? { ...row, at: '2026-11-03T08:00:00.000Z', until: '2026-11-03T09:00:00.000Z', own: false }
          : row,
      );
      await open(page, '/staff?talk=erik');
      const erik = talk(page, 'Erik Sandström');
      await expect(erik.getByText('Tiden för samtalet har passerat', { exact: true })).toBeVisible();
      await expect(erik.getByRole('button', { name: 'Markera som hållet' })).toBeVisible();
      await expect(erik.getByRole('button', { name: 'Samtalet blev inte av' })).toHaveCount(0);
      await expectNoAxeViolations(page);
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
      await expect(open_.getByText(/^Du\s·\ssenast/)).toBeVisible();
      await expect(open_.getByText('Försenad', { exact: true })).toHaveCount(0);
      const done = dialog.getByRole('list', { name: 'Klara' });
      await expect(done).toContainText('Läsa in sig på den nya kursplanen');
      await expect(done.getByText('Försenad', { exact: true })).toHaveCount(0);
      // Held: undone with Ångra, nothing to mark again.
      await expect(dialog.getByRole('button', { name: 'Ångra', exact: true })).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Markera som hållet' })).toHaveCount(0);
      await expect(dialog.getByRole('form', { name: 'Ny åtgärdspunkt' })).toBeVisible();
    });

    test('a former manager’s open point is the reader’s to tick off by keyboard; a co-manager’s and the employee’s are not (Q12)', async ({
      page,
      api,
    }) => {
      api.commitments = [...api.commitments, formerManagersPoint(), coManagersPoint()];
      await open(page, '/staff?talk=anna');
      const dialog = talk(page, 'Anna Lindqvist');
      const thisRound = dialog.getByRole('list', { name: 'Från det här samtalet' });
      const former = thisRound.getByRole('listitem').filter({ hasText: formerManagersPoint().text });
      const co = thisRound.getByRole('listitem').filter({ hasText: coManagersPoint().text });
      // Its owner no longer manages Anna, so it says who wrote it and offers Klar; her other manager's stays theirs.
      await expect(former).toContainText('Tidigare chef · senast ons 25 nov.');
      await expect(co).toContainText('Chefen · senast tors 26 nov.');
      await expect(co.getByRole('button')).toHaveCount(0);
      await expect(dialog.getByRole('list', { name: 'Kvar från tidigare samtal' }).getByRole('button')).toHaveCount(0);
      await expectNoAxeViolations(page);

      await former.getByRole('button', { name: `Klar: ${formerManagersPoint().text}` }).focus();
      await page.keyboard.press('Enter');
      const reopen = dialog
        .getByRole('list', { name: 'Klara' })
        .getByRole('button', { name: `Öppna igen: ${formerManagersPoint().text}` });
      await expect(reopen).toBeFocused();
      await expect(notices(page).getByText('Åtgärdspunkten är klar.')).toBeAttached();
      expect(api.talkWrites.at(-1)).toEqual({ method: 'POST', path: '/talks/commitments/c-anna-5/done', body: {} });
      await expectNoAxeViolations(page);
      const { unmarked, hidden } = await hiddenFocusStops(page);
      expect(unmarked).toEqual([]);
      expect(hidden).toEqual([]);
    });

    test('a person with no points draws no empty groups', async ({ page, api }) => {
      expect(api.commitments.some(c => c.personId === 'lena')).toBe(false);
      await open(page, '/staff?talk=lena');
      const dialog = talk(page, 'Lena Berg');
      await expect(dialog.getByText('Inga åtgärdspunkter än.')).toBeVisible();
      await expect(dialog.getByRole('heading', { level: 4 })).toHaveCount(0);
      await expect(dialog.getByText('tors 12 nov. kl. 14:30–15:30', { exact: true })).toBeVisible();
    });

    test('the whole flow by keyboard: open, add a point, tick it off, open it again, mark held, undo, back', async ({
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
      await expect(page).toHaveURL(tabOf('karin'));
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

      // The talk is the person's tab: Back leads to the list as it was, with the focus on the control that opened it.
      await page.goBack();
      await expect(page).toHaveURL('/staff');
      await expect(page).toHaveTitle(`Personal · ${SITE}`);
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

    test('the tab survives a reload, and Back returns to the list as it was', async ({ page, api }) => {
      expect(api.talksRound).not.toBeNull();
      await open(page, `/staff?show=${TALK_LENS}`);
      await menuOf(page, 'Anna Lindqvist').click();
      await page.getByRole('menuitem', { name: 'Öppna samtalet' }).click();
      // The way in keeps the lens the list was under as the way back.
      await expect(page).toHaveURL(tabOf('anna', encodeURIComponent(`/staff?show=${TALK_LENS}`)));
      const dialog = talk(page, 'Anna Lindqvist');
      await expect(dialog).toBeVisible();
      await page.reload();
      await expect(dialog.getByText('Hållet', { exact: true })).toBeVisible();
      await page.goBack();
      await expect(page).toHaveURL(`/staff?show=${TALK_LENS}`);
      await page.goForward();
      await expect(dialog).toBeVisible();
    });

    test('on the person’s own page the talk is its tab, with no way in that lies over the page', async ({
      page,
      api,
    }) => {
      expect(api.talksWritable).toBe(true);
      await new People().route(page);
      const here = tabOf('karin');
      await open(page, here);
      const section = talk(page, 'Karin Lindqvist');
      await expect(section.getByText('Saknas', { exact: true })).toBeVisible();
      await expect(section.getByRole('link', { name: 'Öppna samtalet' })).toHaveCount(0);
      await expect(page).toHaveTitle(`Utvecklingssamtal · Karin Lindqvist · ${SITE}`);
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expectNoAxeViolations(page);
      // An address that laid the talk over the page leads to the tab, in its place in the history.
      await open(page, '/people/karin?from=%2Fstaff&talk=karin');
      await expect(page).toHaveURL(here);
    });

    test('an id that is not on the reader’s units is the person’s page that is not there', async ({ page, api }) => {
      expect(api.staff.units.flatMap(u => u.people).some(p => p.id === 'nobody')).toBe(false);
      await open(page, '/staff?talk=nobody');
      await expect(page.getByRole('heading', { level: 1, name: 'Personen finns inte' })).toBeVisible();
      await expectNoAxeViolations(page);
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
      await page.route('**/api/cap/clew.talks', route =>
        route.fulfill({ status: 502, json: { error: 'Utvecklingssamtalen svarar inte just nu.' } }),
      );
      await open(page, '/staff?talk=anna');
      const dialog = talk(page, 'Anna Lindqvist');
      await expect(dialog.getByText('Utvecklingssamtalen svarar inte just nu.')).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Försök igen' })).toBeVisible();
      await expect(page.getByRole('heading', { level: 1, name: 'Anna Lindqvist' })).toBeVisible();
      await expectNoAxeViolations(page);
    });

    test('when the action points cannot be read the talk says so with Försök igen', async ({ page, api }) => {
      expect(api.talksOffered).toBe(true);
      await page.route('**/api/cap/clew.commitments', route =>
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

    test('when another system answers the tab is that system’s row, with nothing to write', async ({ page, api }) => {
      api.talksWritable = false;
      await open(page, '/staff?talk=anna');
      await expect(page.getByRole('heading', { level: 1, name: 'Anna Lindqvist' })).toBeVisible();
      await expect(talk(page, 'Anna Lindqvist')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Markera som hållet' })).toHaveCount(0);
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
    expect(await reflowProblems(page)).toEqual([]);
  });
  test('what the calendar holds against a talk reflows at 320 px', async ({ page, api }) => {
    api.talkRows = api.talkRows.map(row =>
      row.personId === 'erik'
        ? { ...row, calendar: { start: '2026-11-13T12:00:00.000Z', end: '2026-11-13T13:00:00.000Z' } }
        : row,
    );
    await page.setViewportSize(narrow);
    await open(page, '/staff?talk=erik');
    await expect(talk(page, 'Erik Sandström').getByText('Mötet har flyttats i kalendern')).toBeVisible();
    expect(await reflowProblems(page)).toEqual([]);
  });
  test('a talk whose time has passed reflows at 320 px', async ({ page, api }) => {
    api.talkRows = api.talkRows.map(row =>
      row.personId === 'erik' ? { ...row, at: '2026-11-03T08:00:00.000Z', until: '2026-11-03T09:00:00.000Z' } : row,
    );
    await page.setViewportSize(narrow);
    await open(page, '/staff?talk=erik');
    await expect(talk(page, 'Erik Sandström').getByText('Tiden för samtalet har passerat')).toBeVisible();
    expect(await reflowProblems(page)).toEqual([]);
  });
  test('the form for the time of a talk reflows at 320 px', async ({ page, api }) => {
    expect(api.talksWritable).toBe(true);
    await page.setViewportSize(narrow);
    await open(page, '/staff?talk=lena');
    const dialog = talk(page, 'Lena Berg');
    await expect(dialog.getByText(`Tiden är angiven här. Ingen inbjudan har skickats från ${SITE}.`)).toBeVisible();
    expect(await reflowProblems(page)).toEqual([]);
    await dialog.getByRole('button', { name: 'Ändra tid', exact: true }).click();
    await expect(dialog.getByRole('form', { name: 'Tid för samtalet' })).toBeVisible();
    expect(await reflowProblems(page)).toEqual([]);
  });
});
