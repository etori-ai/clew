import type { Page } from '@playwright/test';
import type { RecordAction } from '@clew/contracts';
import { expect, expectNoAxeViolations, narrow, open, reflowProblems, test, type MockApi } from './support';
import { deskRequestOutput, deskRequestRef, deskRequestTitle } from './requests';

/**
 * An action about a record (D132), on the first record that has one: a request in the IT service desk, with "Lägg till
 * en kommentar". The record's page draws the actions the server lists for it where a person's page draws its own, at the
 * end of the title's line and as one "Åtgärder" menu on a phone, and each opens the action's own dialog: nothing is sent
 * before the dialog's last button. Asked for it in the pane beside the record, the assistant fills the action in and
 * sends nothing (D133 item 8): the answer holds the row "Ifyllt åt dig" with what was filled in and "Granska och
 * skicka", which opens the same dialog at its last step. Sent from there, the draft says so with the way to the work
 * item it became, after a reload too, and offers no button to send it a second time.
 */
const READ = 'servicedesk.request';
const NAME = deskRequestOutput.label;
const RECORD = `/tools/${READ}?input=${encodeURIComponent(JSON.stringify({ ref: deskRequestRef }))}&title=${encodeURIComponent(deskRequestTitle)}`;
const WIDE = { width: 1440, height: 900 };
const COMMENT = 'Lägg till en kommentar';
/** The comment as the registry lists it for the record: an execute that asks for its text and declares an effect read. */
const comment: RecordAction = {
  capability: 'servicedesk.comment',
  connector: 'servicedesk',
  source: 'IT-servicedesken',
  title: COMMENT,
  kind: 'execute',
  path: {
    asks: [{ kind: 'long-text', property: 'text', label: 'Kommentar', required: true }],
    effect: true,
    description: 'Lägger till din kommentar på beställningen eller felanmälan i IT-servicedesken.',
  },
};
const offered = (api: MockApi) => {
  api.recordActions[READ] = [comment];
};
/** What the mock's assistant fills in when asked for a comment beside the record (`support.ts`). */
const FILLED = 'Behörigheten gäller Skönsmons skola.';
/** The conversation the mock makes for the first question beside this record. */
const ASKED = 'om-record-servicedesk-request-ref-request-servicedesk-SD-26110042';
const door = (page: Page) => page.getByRole('button', { name: 'Fråga AI', exact: true });
const pane = (page: Page) => page.getByRole('complementary', { name: 'Fråga AI', exact: true });
const dialog = (page: Page) => page.getByRole('dialog', { name: COMMENT });
const drafted = (page: Page) => page.getByRole('region', { name: `Ifyllt åt dig: ${COMMENT}`, exact: true });
/** Asks for the comment in the pane beside the record and waits for the row the assistant filled in. */
const askForComment = async (page: Page) => {
  await open(page, RECORD);
  await door(page).click();
  const field = pane(page).getByRole('textbox', { name: `Fråga om ${NAME}` });
  await field.fill('Skriv en kommentar om vilken enhet det gäller');
  await field.press('Enter');
  await expect(drafted(page)).toBeVisible();
};

test.describe('a record’s actions on its page (D132)', () => {
  test.use({ viewport: WIDE });

  test('the action stands at the end of the title’s line and opens its own dialog; Nästa reads what will happen and sends nothing, and the last button decides and opens the work item', async ({
    page,
    api,
  }) => {
    offered(api);
    await open(page, RECORD);
    const title = page.getByRole('heading', { level: 1, name: NAME });
    const button = page.getByRole('main').getByRole('button', { name: COMMENT, exact: true });
    await expect(button).toBeVisible();
    // On the title's line, after the title.
    const [t, b] = [(await title.boundingBox())!, (await button.boundingBox())!];
    expect(b.y).toBeLessThan(t.y + t.height);
    expect(b.y + b.height).toBeGreaterThan(t.y);
    expect(b.x).toBeGreaterThan(t.x);
    await expectNoAxeViolations(page);
    await button.focus();
    await page.keyboard.press('Enter');
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page).getByText(`IT-servicedesken · ${NAME}`)).toBeVisible();
    const text = dialog(page).getByRole('textbox', { name: /^Kommentar/ });
    await expect(text).toHaveAttribute('aria-required', 'true');
    await expectNoAxeViolations(page);
    await text.fill('Det gäller Skönsmons skola.');
    await dialog(page).getByRole('button', { name: 'Nästa' }).click();
    await expect(dialog(page).getByText(`När du trycker ${COMMENT}`)).toBeVisible();
    await expect(dialog(page).getByRole('list', { name: 'Det här händer' })).toContainText(
      'Kommentaren läggs till på beställningen',
    );
    expect(api.recordEffects).toEqual([
      {
        read: READ,
        input: { ref: deskRequestRef },
        capability: comment.capability,
        values: { text: 'Det gäller Skönsmons skola.' },
      },
    ]);
    // Nothing is sent before the dialog's last button.
    expect(api.recordDecides).toEqual([]);
    await expectNoAxeViolations(page);
    await dialog(page).getByRole('button', { name: COMMENT, exact: true }).click();
    await expect.poll(() => api.recordDecides.length).toBe(1);
    expect(api.recordDecides[0]).toEqual({
      read: READ,
      input: { ref: deskRequestRef },
      capability: comment.capability,
      values: { text: 'Det gäller Skönsmons skola.' },
    });
    // The work item it became opens, with the record's page as the way back.
    await expect(page).toHaveURL(/\/items\/record-servicedesk-comment-1\?from=/);
    await page.goBack();
    await expect(title).toBeVisible();
    await expect(page.getByRole('main').getByRole('button', { name: COMMENT, exact: true })).toBeVisible();
  });

  test('a record with no action listed, or whose list is refused, has no buttons', async ({ page, api }) => {
    await open(page, RECORD);
    const title = page.getByRole('heading', { level: 1, name: NAME });
    await expect(title).toBeVisible();
    await expect(page.getByRole('main').getByRole('button', { name: COMMENT })).toHaveCount(0);
    await expect(page.getByRole('main').getByRole('button', { name: /^(Fler åtgärder|Åtgärder)/ })).toHaveCount(0);
    await expectNoAxeViolations(page);
    api.recordActions[READ] = null;
    await page.reload();
    await expect(title).toBeVisible();
    await expect(page.getByRole('main').getByRole('button', { name: COMMENT })).toHaveCount(0);
  });

  test('at 320 px the actions are one Åtgärder menu under the title, and the page reflows with nothing cut', async ({
    page,
    api,
  }) => {
    offered(api);
    await page.setViewportSize(narrow);
    await open(page, RECORD);
    const menuButton = page.getByRole('main').getByRole('button', { name: `Åtgärder för ${NAME}` });
    await expect(menuButton).toBeVisible();
    expect(await reflowProblems(page)).toEqual([]);
    await expectNoAxeViolations(page);
    await menuButton.click();
    await expect(page.getByRole('menuitem')).toHaveText([COMMENT]);
    await page.evaluate(() => Promise.all(document.getAnimations().map(a => a.finished)));
    await expectNoAxeViolations(page);
    await page.getByRole('menuitem', { name: COMMENT }).click();
    await expect(dialog(page).getByRole('textbox', { name: /^Kommentar/ })).toBeVisible();
    expect(await reflowProblems(page)).toEqual([]);
  });
});

test.describe('an action the assistant filled in beside a record: the row Ifyllt åt dig (D133 item 8, D132)', () => {
  test.use({ viewport: WIDE });

  test('the pane says it may fill the comment in; asked, the answer holds the row with what was filled in and one Granska och skicka, which opens the action’s dialog at its last step, and nothing is sent', async ({
    page,
    api,
  }) => {
    offered(api);
    api.reach = { prepares: [{ title: COMMENT }] };
    await open(page, RECORD);
    await door(page).click();
    await expect(
      pane(page).getByRole('list', { name: 'Det här kan jag fylla i åt dig' }).getByRole('listitem'),
    ).toHaveText([COMMENT]);
    expect(api.reachAsked.at(-1)).toMatchObject({
      thing: { kind: 'record', capability: READ, input: { ref: deskRequestRef } },
    });
    const field = pane(page).getByRole('textbox', { name: `Fråga om ${NAME}` });
    await field.fill('Skriv en kommentar om vilken enhet det gäller');
    await field.press('Enter');
    const row = drafted(page);
    await expect(row).toBeVisible();
    await expect(pane(page)).toContainText('Jag har fyllt i en kommentar. Inget är skickat.');
    await expect(row.getByText('Ifyllt åt dig', { exact: true })).toBeVisible();
    await expect(row.getByText(COMMENT, { exact: true })).toBeVisible();
    await expect(row.getByText(`Kommentar: ${FILLED}`, { exact: true })).toBeVisible();
    await expect(row.getByRole('button')).toHaveText(['Granska och skicka']);
    expect(api.recordDecides).toEqual([]);
    await expectNoAxeViolations(page);
    await row.getByRole('button', { name: 'Granska och skicka' }).click();
    // The dialog the record's page opens, at "Det här händer", with the drafted values.
    await expect(dialog(page).getByText(`När du trycker ${COMMENT}`)).toBeVisible();
    await expect(dialog(page)).toContainText(FILLED);
    expect(api.recordEffects.at(-1)).toMatchObject({ capability: comment.capability, values: { text: FILLED } });
    expect(api.recordDecides).toEqual([]);
    await expectNoAxeViolations(page);
    await dialog(page).getByRole('button', { name: 'Avbryt' }).click();
    await expect(dialog(page)).toHaveCount(0);
    expect(api.recordDecides).toEqual([]);
  });

  test('sent from the row, the decision names the draft; back beside the record, and after a reload, the row says Skickat with the way to the work item and no button', async ({
    page,
    api,
  }) => {
    offered(api);
    await askForComment(page);
    await drafted(page).getByRole('button', { name: 'Granska och skicka' }).click();
    await dialog(page).getByRole('button', { name: COMMENT, exact: true }).click();
    await expect.poll(() => api.recordDecides.length).toBe(1);
    const answer = api.threads.find(t => t.id === ASKED)!.messages.at(-1)!;
    expect(api.recordDecides[0]).toMatchObject({
      read: READ,
      input: { ref: deskRequestRef },
      capability: comment.capability,
      values: { text: FILLED },
      draft: { conversationId: ASKED, messageId: answer.id },
    });
    await expect(page).toHaveURL(/\/items\/record-servicedesk-comment-1\?from=/);
    for (const again of ['back', 'reload'] as const) {
      if (again === 'back') await page.goBack();
      else await page.reload();
      const row = drafted(page);
      await expect(row).toBeVisible();
      await expect(row.getByText('Skickat', { exact: true })).toBeVisible();
      await expect(row.getByText('Kommentaren är tillagd i IT-servicedesken.')).toBeVisible();
      await expect(row.getByRole('link', { name: 'Visa ärendet' })).toHaveAttribute(
        'href',
        /^\/items\/record-servicedesk-comment-1\?from=/,
      );
      await expect(row.getByRole('button')).toHaveCount(0);
      await expectNoAxeViolations(page);
    }
  });

  test('a stored draft whose action the record no longer offers draws nothing', async ({ page, api }) => {
    offered(api);
    await askForComment(page);
    api.recordActions[READ] = [];
    await page.reload();
    await expect(pane(page)).toContainText('Jag har fyllt i en kommentar. Inget är skickat.');
    await expect(drafted(page)).toHaveCount(0);
    await expect(pane(page).getByRole('button', { name: 'Granska och skicka' })).toHaveCount(0);
  });

  test('on the conversation’s page the draft’s first button is Granska och skicka; once sent it says Skickat with Visa ärendet, and it reflows at 320 px', async ({
    page,
    api,
  }) => {
    offered(api);
    await askForComment(page);
    await pane(page).getByRole('link', { name: 'Öppna som samtal' }).click();
    await expect(page).toHaveURL(new RegExp(`/conversations/${ASKED}`));
    const card = page.getByRole('region', { name: `Utkast: ${COMMENT}`, exact: true });
    await expect(card.getByRole('button').first()).toHaveText('Granska och skicka');
    await expect(card.getByRole('button', { name: 'Ändra' })).toBeVisible();
    await expectNoAxeViolations(page);
    await card.getByRole('button', { name: 'Granska och skicka' }).click();
    await dialog(page).getByRole('button', { name: COMMENT, exact: true }).click();
    await expect.poll(() => api.recordDecides.length).toBe(1);
    // The work item it became stands beside the conversation, and the draft says it was sent at once.
    await expect(page).toHaveURL(new RegExp(`/conversations/${ASKED}\\?card=record-servicedesk-comment-1$`));
    await expect(card.getByText('Skickat', { exact: true })).toBeVisible();
    await expect(card.getByRole('link', { name: 'Visa ärendet' })).toBeVisible();
    await expect(card.getByRole('button')).toHaveCount(0);
    await expectNoAxeViolations(page);
    await page.setViewportSize(narrow);
    await expect(card.getByRole('link', { name: 'Visa ärendet' })).toBeVisible();
    expect(await reflowProblems(page)).toEqual([]);
    await expectNoAxeViolations(page);
  });
});
