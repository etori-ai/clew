import type { Locator, Page } from '@playwright/test';
import type { EntityAction } from '@clew/contracts';
import { BOOK_TALK_PATH, PRESENCE_LENS } from './data';
import {
  announcements,
  desktop,
  expect,
  expectNoAxeViolations,
  narrow,
  open,
  phone,
  reflowProblems,
  test,
  type MockApi,
} from './support';

/**
 * The action dialog (D112 item 10, boards ActBook, ActEffect and ActReceipt, the `form-wizard-dialog` template): a write
 * that asks the person something or says beforehand what it writes opens one dialog over the page, from every place its
 * button is drawn. "Uppgifter" asks what the capability's `asks` say (a meeting time from three free times in the
 * person's own calendar, "Annan tid" and the day under it), "Det här händer" lists the values and what the source says it
 * will write, and nothing is sent before the last button. The HR fixture's "Boka samtalet" and "Godkänn" as the server
 * resolves their paths (`data.ts`).
 */
const WIDE = { width: 1440, height: 900 };
const pane = (page: Page) => page.getByRole('complementary', { name: 'Valt ärende' });
const dialogOf = (page: Page, name = 'Boka samtalet') => page.getByRole('dialog', { name });
const when = (dialog: Locator) => dialog.getByRole('radiogroup', { name: /^När/ });
/** The decisions the page sent for one work item, as their bodies. */
const sentTo = (page: Page, thread: string) => {
  const bodies: Array<Record<string, unknown>> = [];
  page.on('request', request => {
    if (request.method() === 'POST' && request.url().endsWith(`/api/threads/${thread}/act`))
      bodies.push(JSON.parse(request.postData() ?? '{}'));
  });
  return bodies;
};
/** Tab, and only Tab, until `target` has the focus. */
async function tabTo(page: Page, target: Locator, max = 25) {
  for (let i = 0; i < max; i++) {
    if (await target.evaluate(el => el === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();
}
/** An execute about a person that asks (D112): the entity's key is its own input, the rest the person gives. */
const bookAbout: EntityAction = {
  capability: 'hr.bookTalk',
  connector: 'hr',
  source: 'Personalsystemet',
  title: 'Boka omtankesamtal',
  kind: 'execute',
  param: 'person',
  path: BOOK_TALK_PATH,
};
const offerExecute = (api: MockApi) => api.entityList.actions.push(bookAbout);

test.describe('the action dialog on a work item', () => {
  test.use({ viewport: desktop });

  test('Boka samtalet asks first: three free times from the own calendar, the day under them, then what happens, and nothing is sent before the last button', async ({
    page,
    api,
  }) => {
    const sent = sentTo(page, 'omtanke');
    await open(page, '/todo?item=omtanke');
    const button = pane(page).getByRole('button', { name: 'Boka samtalet' });
    await button.click();
    const dialog = dialogOf(page);
    await expect(dialog).toBeVisible();
    // The source and what it is about under the title, and where the person is: Uppgifter, then Det här händer.
    await expect(dialog.getByText('Personalsystemet · Omtankesamtal med Anna Lindqvist')).toBeVisible();
    await expect(dialog.getByRole('list', { name: 'Steg' }).getByRole('listitem')).toHaveCount(2);
    // Three free times, each saying its day, its time and that the person is free, then Annan tid; the first is chosen.
    const times = when(dialog);
    await expect(times.getByRole('radio')).toHaveCount(4);
    await expect(times.getByRole('radio', { name: /^Torsdag 5 november 13:15/ })).toBeChecked();
    await expect(times.getByText('Du är ledig 13:15–14:00 enligt din kalender')).toBeVisible();
    await expect(times.getByRole('radio', { name: 'Annan tid' })).toBeVisible();
    // The deadline bounds the times asked for; the person's own day is read for the chosen date and only theirs.
    await expect.poll(() => api.timesReads).toContain('?capability=hr.bookTalk&property=when&before=2026-11-13');
    await expect.poll(() => api.timesReads.some(q => q.includes('date=2026-11-05'))).toBe(true);
    const day = dialog.getByRole('group', { name: 'Din dag, torsdag 5 november' });
    await expect(day).toBeVisible();
    // The day is said in words for a screen reader, with whether the chosen time is free, and the time is drawn in it.
    await expect(day).toContainText(
      'Du har Planeringstid 09:00–11:00 och APT 15:00–16:30. Den valda tiden 13:15–14:00 är ledig.',
    );
    await expect(day).toContainText('Vald tid');
    await expectNoAxeViolations(page);
    await dialog.getByRole('textbox', { name: 'Plats' }).fill('Bergsåkers skola, rum 12');
    await dialog.getByRole('button', { name: 'Nästa' }).click();
    // Det här händer: the values, then what the source says it will write for exactly them, and how long Ångra lasts.
    const effect = dialog.getByRole('heading', { name: 'När du trycker Boka samtalet' });
    await expect(effect).toBeFocused();
    await expect(dialog.getByRole('definition')).toHaveText(['Torsdag 5 november 13:15', 'Bergsåkers skola, rum 12']);
    const rows = dialog.getByRole('list', { name: 'Det här händer' });
    await expect(rows).toContainText('Omtankesamtalet registreras');
    await expect(rows).toContainText('På medarbetaren, torsdag 5 november kl. 13:15, Bergsåkers skola, rum 12');
    await expect(rows).toContainText('Personalsystemet');
    await expect(dialog.getByText('Du kan ångra i 10 minuter.')).toBeVisible();
    expect(api.effectReads.at(-1)?.body).toEqual({
      actionId: 'book',
      values: { when: '2026-11-05T12:15:00.000Z', place: 'Bergsåkers skola, rum 12' },
    });
    await expectNoAxeViolations(page);
    expect(sent).toEqual([]);
    // The last button is the action's own label and the only thing that sends.
    await dialog.getByRole('button', { name: 'Boka samtalet' }).click();
    await expect(dialog).toBeHidden();
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0]).toEqual({
      actionId: 'book',
      values: { when: '2026-11-05T12:15:00.000Z', place: 'Bergsåkers skola, rum 12' },
    });
    // The receipt on the work item, each row read back, Ångra with the minutes left, and the decision under Händelser.
    const item = page.locator('#card-omtanke');
    await expect(item.getByText('Samtalet är registrerat i personalsystemet.')).toBeVisible();
    await expect(item.getByRole('list', { name: 'Kvitto, rad för rad' })).toContainText(
      'registrerat i personalsystemet, torsdag 5 november kl. 13:15, Bergsåkers skola, rum 12',
    );
    await expect(item.getByRole('list', { name: 'Händelser, de senaste först' })).toContainText(
      'beslutade: Boka samtalet',
    );
    await expectNoAxeViolations(page);
    // Ångra while the source allows it: the item is open again with its button, which asks again.
    await item.getByRole('button', { name: 'Ångra · 10 min kvar' }).click();
    await expect(item.getByRole('button', { name: 'Boka samtalet' })).toBeVisible();
    await expect(item.getByText('Samtalet är registrerat i personalsystemet.')).toHaveCount(0);
  });

  test('by keyboard alone: a time chosen with the arrows, the values kept when Esc closes it, and nothing sent', async ({
    page,
    api,
  }) => {
    const sent = sentTo(page, 'omtanke');
    await open(page, '/todo?item=omtanke');
    const button = pane(page).getByRole('button', { name: 'Boka samtalet' });
    await button.focus();
    await page.keyboard.press('Enter');
    const dialog = dialogOf(page);
    // The dialog opens on its title, which names it.
    await expect(dialog.getByRole('heading', { level: 2, name: 'Boka samtalet' })).toBeFocused();
    const first = when(dialog).getByRole('radio', { name: /^Torsdag 5 november/ });
    await tabTo(page, first);
    await page.keyboard.press('ArrowDown');
    const second = when(dialog).getByRole('radio', { name: /^Fredag 6 november 09:00/ });
    await expect(second).toBeChecked();
    // The day follows the chosen time.
    await expect(dialog.getByRole('group', { name: 'Din dag, fredag 6 november' })).toBeVisible();
    const place = dialog.getByRole('textbox', { name: 'Plats' });
    await tabTo(page, place);
    await page.keyboard.type('Rum 12');
    // Esc closes it, sends nothing and gives the focus back to the button that opened it.
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(button).toBeFocused();
    expect(sent).toEqual([]);
    expect(api.effectReads).toEqual([]);
    // Opened again on the same item, what was typed is still there.
    await page.keyboard.press('Enter');
    await expect(place).toHaveValue('Rum 12');
    await expect(second).toBeChecked();
    // Nästa, then Ändra back to the fields, which takes the focus to the first of them.
    await tabTo(page, dialog.getByRole('button', { name: 'Nästa' }));
    await page.keyboard.press('Enter');
    await expect(dialog.getByRole('heading', { name: 'När du trycker Boka samtalet' })).toBeFocused();
    await expect(dialog.getByRole('definition')).toHaveText(['Fredag 6 november 09:00', 'Rum 12']);
    await tabTo(page, dialog.getByRole('button', { name: 'Ändra' }));
    await page.keyboard.press('Enter');
    await expect(second).toBeFocused();
    // The close button sends nothing either, and the focus is back on the button.
    await tabTo(page, dialog.getByRole('button', { name: 'Avbryt' }));
    await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden();
    await expect(button).toBeFocused();
    expect(sent).toEqual([]);
  });

  test('Annan tid: a date and a clock, the day read again for the date, a clash said, and a missing date said on its field', async ({
    page,
    api,
  }) => {
    await open(page, '/todo?item=omtanke');
    await pane(page).getByRole('button', { name: 'Boka samtalet' }).click();
    const dialog = dialogOf(page);
    await when(dialog).getByRole('radio', { name: 'Annan tid' }).check();
    // The fields start from the time that was chosen, so the value stands until the person changes it.
    const date = dialog.getByRole('combobox', { name: /^Datum/ }).or(dialog.getByRole('textbox', { name: /^Datum/ }));
    const clock = dialog
      .getByRole('textbox', { name: /^Klockslag/ })
      .or(dialog.getByRole('spinbutton', { name: /^Klockslag/ }));
    await expect(date.first()).toBeVisible();
    await expect(clock.first()).toHaveValue('13:15');
    // A time over the person's APT is said on the clock, as a warning: it is their own calendar, and it can still be chosen.
    await clock.first().fill('15:00');
    await clock.first().press('Tab');
    await expect(dialog.getByText('Du har APT då.').first()).toBeVisible();
    await expect(dialog.getByRole('group', { name: 'Din dag, torsdag 5 november' })).toContainText(
      'Den valda tiden 15:00–15:45 krockar med APT.',
    );
    // Another date reads that day.
    await date.first().fill('');
    await date.first().pressSequentially('2026-11-10');
    await date.first().press('Tab');
    await expect.poll(() => api.timesReads.some(q => q.includes('date=2026-11-10'))).toBe(true);
    await expect(dialog.getByRole('group', { name: 'Din dag, tisdag 10 november' })).toBeVisible();
    // The step is taller than the window, and axe takes a label scrolled out of the dialog's view for a missing one
    // (label-title-only): the times and the fields under them are brought into view first, as a person scrolls to them.
    await when(dialog).scrollIntoViewIfNeeded();
    await expectNoAxeViolations(page);
    // Without a date there is no time: Nästa says so on the date's field, with the footer's count, and focuses it.
    await date.first().fill('');
    await date.first().press('Tab');
    await dialog.getByRole('button', { name: 'Nästa' }).click();
    await expect(dialog.getByText('När behöver fyllas i.').first()).toBeVisible();
    // Astryx draws a field's status and says it in a live region of its own, so the words are there twice.
    await expect(dialog.getByText('En uppgift ovan behöver rättas först.').first()).toBeVisible();
    await expect(date.first()).toBeFocused();
    await expect(date.first()).toHaveAccessibleDescription(/När behöver fyllas i\./);
    await expect(dialog.getByRole('heading', { name: 'När du trycker Boka samtalet' })).toHaveCount(0);
    await when(dialog).scrollIntoViewIfNeeded();
    await expectNoAxeViolations(page);
  });

  test('a refusal on send is placed: on the field it names with the focus there, else at the top of the step', async ({
    page,
    api,
  }) => {
    const sent = sentTo(page, 'omtanke');
    await open(page, '/todo?item=omtanke');
    await pane(page).getByRole('button', { name: 'Boka samtalet' }).click();
    const dialog = dialogOf(page);
    await dialog.getByRole('button', { name: 'Nästa' }).click();
    // The server says the time has passed: back at Uppgifter, on När, said aloud as it appears.
    api.actRefusal = 'När: tiden har redan passerat.';
    await dialog.getByRole('button', { name: 'Boka samtalet' }).click();
    await expect.poll(() => sent.length).toBe(1);
    const first = when(dialog).getByRole('radio', { name: /^Torsdag 5 november/ });
    await expect(first).toBeFocused();
    await expect(dialog.getByText('När: tiden har redan passerat.').first()).toBeVisible();
    await expect
      .poll(async () => (await announcements(page)).some(a => a.includes('När: tiden har redan passerat.')))
      .toBe(true);
    await expect(dialog).toBeVisible();
    await expectNoAxeViolations(page);
    // Another time clears it; a refusal that names no field stands at the top of Det här händer and takes the focus.
    await when(dialog)
      .getByRole('radio', { name: /^Fredag 6 november/ })
      .check();
    await expect(dialog.getByText('När: tiden har redan passerat.')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Nästa' }).click();
    const refusal = 'Personalsystemet svarade att medarbetaren har slutat.';
    api.actRefusal = refusal;
    await dialog.getByRole('button', { name: 'Boka samtalet' }).click();
    await expect.poll(() => sent.length).toBe(2);
    // The banner's title and description are the alert (Astryx puts the role there); the banner itself has the focus.
    await expect(dialog.getByRole('alert').filter({ hasText: refusal })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.activeElement?.textContent ?? '')).toContain(refusal);
    await expect.poll(async () => (await announcements(page)).some(a => a.includes(refusal))).toBe(true);
    await expectNoAxeViolations(page);
    // The item stands as it was: nothing was decided.
    await page.keyboard.press('Escape');
    await expect(page.locator('#card-omtanke').getByRole('button', { name: 'Boka samtalet' })).toBeFocused();
  });

  test('a failed read of what happens says so with Försök igen, and nothing can be sent until it answers', async ({
    page,
    api,
  }) => {
    const sent = sentTo(page, 'omtanke');
    api.effectFails = true;
    await open(page, '/todo?item=omtanke');
    await pane(page).getByRole('button', { name: 'Boka samtalet' }).click();
    const dialog = dialogOf(page);
    await dialog.getByRole('button', { name: 'Nästa' }).click();
    await expect(dialog.getByText('Personalsystemet svarade inte.')).toBeVisible();
    await expect
      .poll(async () => (await announcements(page)).some(a => a.includes('Personalsystemet svarade inte.')))
      .toBe(true);
    const send = dialog.getByRole('button', { name: 'Boka samtalet' });
    await expect(send).toHaveAttribute('aria-disabled', 'true');
    await send.click({ force: true });
    expect(sent).toEqual([]);
    await expectNoAxeViolations(page);
    api.effectFails = false;
    await dialog.getByRole('button', { name: 'Försök igen' }).click();
    await expect(dialog.getByRole('list', { name: 'Det här händer' })).toContainText('Omtankesamtalet registreras');
    await expect(send).not.toHaveAttribute('aria-disabled', 'true');
  });

  test('without a calendar only a date and a clock are asked, with no error and no day', async ({ page, api }) => {
    api.freeTimes = null;
    await open(page, '/todo?item=omtanke');
    await pane(page).getByRole('button', { name: 'Boka samtalet' }).click();
    const dialog = dialogOf(page);
    await expect(dialog.getByRole('group', { name: /^När/ })).toBeVisible();
    await expect(dialog.getByRole('radio')).toHaveCount(0);
    // Astryx keeps an empty live region under each field; none of them says anything.
    await expect(dialog.getByRole('alert').filter({ hasText: /\S/ })).toHaveCount(0);
    const date = dialog.getByRole('combobox', { name: /^Datum/ }).or(dialog.getByRole('textbox', { name: /^Datum/ }));
    await date.first().pressSequentially('2026-11-10');
    await dialog
      .getByRole('textbox', { name: /^Klockslag/ })
      .or(dialog.getByRole('spinbutton', { name: /^Klockslag/ }))
      .first()
      .fill('10:00');
    await dialog
      .getByRole('textbox', { name: /^Klockslag/ })
      .or(dialog.getByRole('spinbutton', { name: /^Klockslag/ }))
      .first()
      .press('Tab');
    await expect(dialog.getByRole('group', { name: /^Din dag/ })).toHaveCount(0);
    await expectNoAxeViolations(page);
    await dialog.getByRole('button', { name: 'Nästa' }).click();
    await expect(dialog.getByRole('definition')).toHaveText(['Tisdag 10 november 10:00']);
  });

  test('Godkänn with an optional comment is two presses, and the comment is one step back', async ({ page, api }) => {
    const sent = sentTo(page, 'ledighet');
    await open(page, '/todo?item=ledighet');
    const button = pane(page).getByRole('button', { name: 'Godkänn', exact: true });
    await button.click();
    const dialog = dialogOf(page, 'Godkänn');
    // Nothing is required, so it opens at Det här händer: the source's name and the capability's description.
    await expect(dialog.getByRole('heading', { name: 'När du trycker Godkänn' })).toBeVisible();
    const rows = dialog.getByRole('list', { name: 'Det här händer' });
    await expect(rows).toContainText('Beslutar en ledighetsansökan i personalsystemet.');
    await expect(rows).toContainText('Personalsystemet');
    // Without an effect read there is nothing to read first, and no undo is promised.
    expect(api.effectReads).toEqual([]);
    await expect(dialog.getByText(/Du kan ångra/)).toHaveCount(0);
    await expectNoAxeViolations(page);
    // The comment is one step back.
    await dialog.getByRole('button', { name: 'Lägg till kommentar till medarbetaren' }).click();
    const comment = dialog.getByRole('textbox', { name: 'Kommentar till medarbetaren' });
    await expect(comment).toBeFocused();
    await comment.fill('Trevlig jul!');
    await dialog.getByRole('button', { name: 'Nästa' }).click();
    await expect(dialog.getByRole('definition')).toHaveText(['Trevlig jul!']);
    await dialog.getByRole('button', { name: 'Godkänn', exact: true }).click();
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0]).toEqual({ actionId: 'decide', values: { comment: 'Trevlig jul!' } });
    await expect(page.locator('#card-ledighet').getByText('Ansökan är godkänd.')).toBeVisible();
  });

  test('Godkänn without a comment: the button, then Godkänn in the dialog', async ({ page, api: _ }) => {
    const sent = sentTo(page, 'ledighet');
    await open(page, '/todo?item=ledighet');
    await pane(page).getByRole('button', { name: 'Godkänn', exact: true }).click();
    await dialogOf(page, 'Godkänn').getByRole('button', { name: 'Godkänn', exact: true }).click();
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0]).toEqual({ actionId: 'decide', values: {} });
  });

  test('a write that asks nothing but says what it writes is one step, without step markers', async ({ page, api }) => {
    const omtanke = api.threads.find(t => t.id === 'omtanke')!;
    omtanke.actions = omtanke.actions.map(a => (a.id === 'book' ? { ...a, path: { ...BOOK_TALK_PATH, asks: [] } } : a));
    const sent = sentTo(page, 'omtanke');
    await open(page, '/todo?item=omtanke');
    await pane(page).getByRole('button', { name: 'Boka samtalet' }).click();
    const dialog = dialogOf(page);
    await expect(dialog.getByRole('heading', { name: 'När du trycker Boka samtalet' })).toBeVisible();
    await expect(dialog.getByRole('list', { name: 'Steg' })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Ändra' })).toHaveCount(0);
    await expect(dialog.getByRole('list', { name: 'Det här händer' })).toContainText('Omtankesamtalet registreras');
    expect(api.effectReads.at(-1)?.body).toEqual({ actionId: 'book', values: {} });
    await expectNoAxeViolations(page);
    await dialog.getByRole('button', { name: 'Boka samtalet' }).click();
    await expect.poll(() => sent.length).toBe(1);
  });

  test('a write with neither asks nor an effect stays one press', async ({ page, api: _ }) => {
    const sent = sentTo(page, 'fakturor');
    await open(page, '/todo?item=fakturor');
    await pane(page).getByRole('button', { name: 'Attestera 2 valda' }).click();
    await expect.poll(() => sent.length).toBe(1);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});

test.describe('the action dialog on a phone', () => {
  // A finger: Astryx draws its controls at touch size under a coarse pointer, as touch.spec.ts measures them.
  test.use({ viewport: phone, hasTouch: true, isMobile: true });

  test('from the pinned bar it fills the screen with its buttons at the foot, 44 px targets and no axe violations', async ({
    page,
    api: _,
  }) => {
    await open(page, '/items/omtanke');
    const button = page.getByRole('button', { name: 'Boka samtalet' });
    await button.click();
    const dialog = dialogOf(page);
    await expect(dialog.getByRole('radio', { name: /^Torsdag 5 november/ })).toBeChecked();
    // Fullscreen: the dialog is the screen.
    const box = await dialog.boundingBox();
    expect(box?.width).toBe(phone.width);
    expect(box?.height).toBe(phone.height);
    // The day as the family's list, which fits a phone, and in words.
    await expect(dialog.getByRole('group', { name: 'Din dag, torsdag 5 november' })).toContainText('Vald tid');
    for (const name of ['Avbryt', 'Nästa']) {
      const target = await dialog.getByRole('button', { name, exact: true }).boundingBox();
      expect(target!.height).toBeGreaterThanOrEqual(44);
      expect(target!.y + target!.height).toBeLessThanOrEqual(phone.height);
    }
    expect(await reflowProblems(page, dialog)).toEqual([]);
    await expectNoAxeViolations(page);
    await dialog.getByRole('button', { name: 'Nästa' }).click();
    await expect(dialog.getByRole('list', { name: 'Det här händer' })).toContainText('Omtankesamtalet registreras');
    for (const name of ['Ändra', 'Avbryt', 'Boka samtalet']) {
      const target = await dialog.getByRole('button', { name, exact: true }).boundingBox();
      expect(target!.height).toBeGreaterThanOrEqual(44);
    }
    await expectNoAxeViolations(page);
    await page.keyboard.press('Escape');
    await expect(button).toBeFocused();
  });

  test('reflows at 320 px on both steps', async ({ page, api: _ }) => {
    await page.setViewportSize(narrow);
    await open(page, '/items/omtanke');
    await page.getByRole('button', { name: 'Boka samtalet' }).click();
    const dialog = dialogOf(page);
    await when(dialog).getByRole('radio', { name: 'Annan tid' }).check();
    // On a coarse pointer the clock may be the system's own control, so its label is what is looked for.
    await expect(dialog.getByText(/^Klockslag/).first()).toBeVisible();
    expect(await reflowProblems(page, dialog)).toEqual([]);
    await dialog.getByRole('button', { name: 'Nästa' }).click();
    await expect(dialog.getByRole('list', { name: 'Det här händer' })).toBeVisible();
    expect(await reflowProblems(page, dialog)).toEqual([]);
  });
});

test.describe('an action about a person or a unit that asks', () => {
  test('an execute started on a person opens its work item beside the page with the dialog over it, on the item’s own button', async ({
    page,
    api,
  }) => {
    offerExecute(api);
    await page.setViewportSize(WIDE);
    const here = `/people/johan?section=${PRESENCE_LENS}&from=%2Fstaff`;
    await open(page, here);
    // Every action about the person is in the page's header (D112 item 5): the third and on under Fler.
    await page.getByRole('main').getByRole('button', { name: 'Fler åtgärder för Johan Byström' }).click();
    await page.getByRole('menuitem', { name: 'Boka omtankesamtal' }).click();
    // The work item is started first, without the answers: they are given at its decision (D112).
    expect(api.entityStarts).toEqual([{ key: 'johan', capability: 'hr.bookTalk' }]);
    await expect(page).toHaveURL(`${here}&card=entity-hr-bookTalk-johan`);
    const dialog = dialogOf(page, 'Boka omtankesamtal');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Personalsystemet · Boka omtankesamtal: Johan Byström')).toBeVisible();
    await expect(when(dialog).getByRole('radio', { name: /^Torsdag 5 november/ })).toBeChecked();
    await expectNoAxeViolations(page);
    // Closed, the item stays beside the page, and the focus is on its own button, which opens the dialog again.
    await page.keyboard.press('Escape');
    const panel = page.getByRole('complementary', { name: 'Ärende' });
    const decide = panel.getByRole('button', { name: 'Boka omtankesamtal' });
    await expect(decide).toBeFocused();
    await page.keyboard.press('Enter');
    await dialog.getByRole('button', { name: 'Nästa' }).click();
    await dialog.getByRole('button', { name: 'Boka omtankesamtal' }).click();
    await expect(dialog).toBeHidden();
    await expect
      .poll(() => api.acted.map(a => a.body))
      .toEqual([{ actionId: 'decide', values: { when: '2026-11-05T12:15:00.000Z' } }]);
    await expect(panel.getByText('Samtalet är registrerat i personalsystemet.')).toBeVisible();
  });

  test('an execute from a row’s menu on Personal opens its work item over the list with the dialog over it', async ({
    page,
    api,
  }) => {
    offerExecute(api);
    await page.setViewportSize(desktop);
    await open(page, '/staff');
    const menuButton = page.getByRole('button', { name: 'Åtgärder för Karin Lindqvist' });
    await menuButton.click();
    await page.getByRole('menuitem', { name: 'Boka omtankesamtal' }).click();
    await expect(page).toHaveURL('/staff?card=entity-hr-bookTalk-karin');
    expect(api.entityStarts).toEqual([{ key: 'karin', capability: 'hr.bookTalk' }]);
    const dialog = dialogOf(page, 'Boka omtankesamtal');
    await expect(when(dialog).getByRole('radio', { name: /^Torsdag 5 november/ })).toBeChecked();
    await expectNoAxeViolations(page);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    // The item is the drawer over the list here; its own button has the focus, and Esc then closes the item.
    const drawer = page.getByRole('dialog', { name: 'Ärende' });
    await expect(drawer.getByRole('button', { name: 'Boka omtankesamtal' })).toBeFocused();
    expect(api.acted).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL('/staff');
    await expect(menuButton).toBeFocused();
  });

  test('a propose that asks is filled in before it starts, and starts with the answers', async ({ page, api }) => {
    api.entityList.actions = api.entityList.actions.map(a =>
      a.capability === 'hr.registerAbsence'
        ? {
            ...a,
            path: {
              asks: [{ kind: 'date', property: 'from', label: 'Första frånvarodagen', required: true }],
              effect: false,
              description: 'Förbereder en sjukanmälan för en medarbetare i chefens enhet.',
            },
          }
        : a,
    );
    await page.setViewportSize(desktop);
    await open(page, '/staff');
    await page.getByRole('button', { name: 'Åtgärder för Karin Lindqvist' }).click();
    await page.getByRole('menuitem', { name: 'Registrera frånvaro' }).click();
    const dialog = dialogOf(page, 'Registrera frånvaro');
    await expect(dialog.getByText('Personalsystemet · Karin Lindqvist')).toBeVisible();
    // Nothing has started yet.
    expect(api.entityStarts).toEqual([]);
    await dialog.getByRole('button', { name: 'Nästa' }).click();
    const date = dialog
      .getByRole('combobox', { name: /^Första frånvarodagen/ })
      .or(dialog.getByRole('textbox', { name: /^Första frånvarodagen/ }));
    await expect(date.first()).toBeFocused();
    await expect(dialog.getByText('Första frånvarodagen behöver fyllas i.').first()).toBeVisible();
    await date.first().pressSequentially('2026-11-05');
    await date.first().press('Tab');
    await dialog.getByRole('button', { name: 'Nästa' }).click();
    await expect(dialog.getByRole('definition')).toHaveText(['Torsdag 5 november']);
    await expect(dialog.getByRole('list', { name: 'Det här händer' })).toContainText(
      'Förbereder en sjukanmälan för en medarbetare i chefens enhet.',
    );
    await expectNoAxeViolations(page);
    await dialog.getByRole('button', { name: 'Registrera frånvaro' }).click();
    await expect(dialog).toBeHidden();
    expect(api.entityStarts).toEqual([
      { key: 'karin', capability: 'hr.registerAbsence', values: { from: '2026-11-05' } },
    ]);
    await expect(page).toHaveURL('/staff?card=entity-hr-registerAbsence-karin');
  });

  test('a choice left out is said on its selector, which shows its focus over the error (2.4.7)', async ({
    page,
    api,
  }) => {
    // Six options: more than a radio list holds, so the choice is drawn as a selector.
    const options = ['Sjukdom', 'Vård av barn', 'Semester', 'Tjänstledighet', 'Föräldraledighet', 'Annat'];
    api.entityList.actions = api.entityList.actions.map(a =>
      a.capability === 'hr.registerAbsence'
        ? {
            ...a,
            path: {
              asks: [
                {
                  kind: 'choice',
                  property: 'reason',
                  label: 'Orsak',
                  required: true,
                  options: options.map((label, i) => ({ value: `reason-${i}`, label })),
                },
              ],
              effect: false,
              description: 'Förbereder en sjukanmälan för en medarbetare i chefens enhet.',
            },
          }
        : a,
    );
    await page.setViewportSize(desktop);
    await open(page, '/staff');
    await page.getByRole('button', { name: 'Åtgärder för Karin Lindqvist' }).click();
    await page.getByRole('menuitem', { name: 'Registrera frånvaro' }).click();
    const dialog = dialogOf(page, 'Registrera frånvaro');
    await dialog.getByRole('button', { name: 'Nästa' }).click();
    const choice = dialog.getByRole('combobox', { name: /^Orsak/ });
    await expect(choice).toBeFocused();
    await expect(dialog.getByText('Orsak behöver fyllas i.').first()).toBeVisible();
    // Astryx draws a selector's status on its trigger's container and drops the focus inset there; Clew's theme draws
    // one in the error colour while the focus is inside (`packages/ui/src/theme.ts`), and nothing once it has left.
    const box = dialog.locator('.astryx-selector[data-status="error"]');
    await expect(box).toHaveCount(1);
    const shadow = () =>
      box.evaluate(async el => {
        await Promise.all(el.getAnimations().map(a => a.finished.catch(() => undefined)));
        return getComputedStyle(el).boxShadow;
      });
    expect(await shadow()).toMatch(/ 0px 0px 0px 2px inset$/);
    await choice.evaluate(el => el.blur());
    await expect(choice).not.toBeFocused();
    expect(await shadow()).toBe('none');
    await expectNoAxeViolations(page);
  });

  test('free text, a date and a clock left out show their focus over the error too (2.4.7)', async ({ page, api }) => {
    // Without a calendar to suggest from, a meeting is asked as a date and a clock: the one place the dialog asks a clock.
    api.freeTimes = null;
    api.entityList.actions = api.entityList.actions.map(a =>
      a.capability === 'hr.registerAbsence'
        ? {
            ...a,
            path: {
              asks: [
                { kind: 'long-text', property: 'note', label: 'Anteckning', required: true },
                { kind: 'meeting', property: 'when', label: 'När', required: true, durationMinutes: 45 },
              ],
              effect: false,
              description: 'Förbereder en sjukanmälan för en medarbetare i chefens enhet.',
            },
          }
        : a,
    );
    await page.setViewportSize(desktop);
    await open(page, '/staff');
    await page.getByRole('button', { name: 'Åtgärder för Karin Lindqvist' }).click();
    await page.getByRole('menuitem', { name: 'Registrera frånvaro' }).click();
    const dialog = dialogOf(page, 'Registrera frånvaro');
    const note = dialog.getByRole('textbox', { name: /^Anteckning/ });
    const date = dialog
      .getByRole('combobox', { name: /^Datum/ })
      .or(dialog.getByRole('textbox', { name: /^Datum/ }))
      .first();
    const clock = dialog
      .getByRole('textbox', { name: /^Klockslag/ })
      .or(dialog.getByRole('spinbutton', { name: /^Klockslag/ }))
      .first();
    await expect(date).toBeVisible();
    await dialog.getByRole('button', { name: 'Nästa' }).click();
    await expect(note).toBeFocused();
    await expect(dialog.getByText('Anteckning behöver fyllas i.').first()).toBeVisible();
    await expect(dialog.getByText('När behöver fyllas i.').first()).toBeVisible();
    // The same inset as the selector's, on the bordered box of each field: 2 px while the focus is inside it, and
    // nothing once it has left.
    const focusShown = async (box: Locator, control: Locator) => {
      await expect(box).toHaveCount(1);
      const shadow = () =>
        box.evaluate(async el => {
          await Promise.all(el.getAnimations().map(a => a.finished.catch(() => undefined)));
          return getComputedStyle(el).boxShadow;
        });
      await control.focus();
      await expect(control).toBeFocused();
      expect(await shadow()).toMatch(/ 0px 0px 0px 2px inset$/);
      await control.evaluate(el => (el as HTMLElement).blur());
      await expect(control).not.toBeFocused();
      expect(await shadow()).toBe('none');
    };
    await focusShown(dialog.locator('.astryx-text-area[data-status="error"]'), note);
    // Without a date the meeting's problem stands on the date; with one, on the clock.
    await expect(dialog.locator('.astryx-time-input[data-status="error"]')).toHaveCount(0);
    await focusShown(dialog.locator('.astryx-date-input[data-status="error"]'), date);
    await date.pressSequentially('2026-11-10');
    await date.press('Tab');
    await expect(dialog.locator('.astryx-date-input[data-status="error"]')).toHaveCount(0);
    await focusShown(dialog.locator('.astryx-time-input[data-status="error"]'), clock);
    await expectNoAxeViolations(page);
  });
});
