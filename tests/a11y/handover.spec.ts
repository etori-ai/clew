import {
  announcements,
  composer,
  desktop,
  expect,
  expectNoAxeViolations,
  narrow,
  open,
  phone,
  reflowProblems,
  test,
} from './support';
import { hrAssistant } from './data';

type Page = import('@playwright/test').Page;
/**
 * An assistant of another system beside the conversation (the assistants profile; the product owner, 2026-11-16): the
 * transcript and the box under it are Clew's, always, and the assistant is talked to in a panel of its own with a box of
 * its own. The ways to it (a row on Ny fråga, "Andra assistenter" in the conversation's header, "Fortsätt med …" under an
 * answer Clew sent on), a question asked there going to it alone and being drawn there, the way to Clew under an answer
 * there, a system that does not answer, a question Clew holds, and Clew's own suggestion. Keyboard, focus,
 * announcements, axe and reflow, at desktop, phone and 320 px.
 */
const HR = 'kunskap:hr';
/** The panel beside the transcript that holds one assistant's exchange. */
const panel = (page: Page) => page.getByRole('complementary', { name: 'Assistent i ett annat system' });
/** The panel's own box: a plain text field, since nothing can be attached to what goes to another system. */
const sideBox = (page: Page) => page.getByRole('textbox', { name: 'Skriv till HR-assistenten i Kunskapsbanken' });
/** The transcript, Clew's: the first log on the page, before the panel's. */
const transcript = (page: Page) => page.getByRole('log').first();
/** What another system's assistant wrote in the transcript, by the name its turn carries. */
const ANSWERED = 'HR-assistenten Kunskapsbanken';
const QUESTION = 'Hur många semesterdagar har jag rätt till?';
/** A new conversation with the assistant's panel beside it, from its row on Ny fråga. */
async function openBeside(page: Page) {
  await open(page, '/conversations/new');
  await page.getByRole('link', { name: 'HR-assistenten', exact: true }).click();
  await expect(panel(page)).toBeVisible();
}
async function askBeside(page: Page, text: string) {
  await sideBox(page).fill(text);
  await sideBox(page).press('Enter');
}

test.describe('another system’s assistant beside the conversation', () => {
  test.use({ viewport: desktop });
  test('with no such assistant nothing offers one: no row on Ny fråga, no menu in the header, and the box is Clew’s with its model menu', async ({
    page,
    api: _,
  }) => {
    await open(page, '/conversations/new');
    await expect(composer(page)).toBeVisible();
    await expect(page.getByRole('button', { name: /^Till: / })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Fråga någon annan' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Modell: Kapabel' }).click();
    await expect(page.getByRole('group', { name: 'Modell' }).getByRole('menuitemradio')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await composer(page).fill('Vad har jag i kalendern i morgon?');
    await composer(page).press('Enter');
    await expect(page.getByRole('article', { name: 'Assistenten', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Andra assistenter/ })).toHaveCount(0);
  });
  test('Ny fråga’s box has no recipient menu; an assistant’s row opens a conversation with its panel, whose field has the focus and a name', async ({
    page,
    api,
  }) => {
    api.handoverAssistants = [hrAssistant];
    await open(page, '/conversations/new');
    await expect(page.getByRole('button', { name: /^Till: / })).toHaveCount(0);
    await page.getByRole('link', { name: 'HR-assistenten', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/conversations\/new\?assistant=kunskap%3Ahr$/);
    await expect(panel(page).getByRole('heading', { name: 'HR-assistenten', exact: true })).toBeVisible();
    await expect(panel(page).getByText('Svarar på frågor om anställning och ledighet.')).toBeVisible();
    await expect(
      panel(page).getByText('Det du skriver här skickas till Kunskapsbanken. Inget annat ur samtalet följer med.'),
    ).toBeVisible();
    await expect(sideBox(page)).toBeFocused();
    // Nothing was sent by opening it, and the box under the transcript is still Clew's.
    expect(api.asked).toHaveLength(0);
    await expect(composer(page)).toBeVisible();
    await expect(page.getByText('Samtal med assistenten', { exact: true })).toBeVisible();
    await expectNoAxeViolations(page);
  });
  test('a question asked in the panel goes to the assistant alone and is drawn there; the transcript says once that the exchange exists', async ({
    page,
    api,
  }) => {
    api.handoverAssistants = [hrAssistant];
    await openBeside(page);
    await askBeside(page, QUESTION);
    await expect(panel(page).getByText('25 semesterdagar')).toBeVisible();
    // Nothing of the conversation went with the question, and it is marked as asked at the side.
    expect(api.asked.at(-1)).toEqual({ text: QUESTION, assistant: HR, side: true });
    await expect(page).toHaveURL(/\/conversations\/overlamnad\?assistant=kunskap%3Ahr$/);
    await expect(panel(page).getByRole('link', { name: 'Semesterregler' })).toHaveAttribute(
      'href',
      'https://intra.example/semester',
    );
    await expect(panel(page).getByText('Kollektivavtalet', { exact: true })).toBeVisible();
    await expect(panel(page).getByRole('link', { name: 'Öppna i Kunskapsbanken' })).toHaveAttribute(
      'href',
      'https://kunskap.example/samtal/1',
    );
    await expect
      .poll(() => announcements(page))
      .toContainEqual(expect.stringContaining('HR-assistenten har svarat i sidofältet.'));
    // The transcript is Clew's: neither the question nor the answer is drawn in it, and one line says where to look.
    await expect(transcript(page).getByText(QUESTION, { exact: true })).toHaveCount(0);
    await expect(transcript(page).getByText('25 semesterdagar')).toHaveCount(0);
    await expect(transcript(page).getByText('Du frågade HR-assistenten i sidofältet', { exact: true })).toHaveCount(1);
    await expectNoAxeViolations(page);
    // The follow-up continues the same conversation, and the line is not said twice.
    await askBeside(page, 'Och om jag är över 40?');
    await expect(panel(page).getByText('Det är svar 2 i det här samtalet.')).toBeVisible();
    expect(api.asked.at(-1)).toEqual({
      text: 'Och om jag är över 40?',
      conversationId: 'overlamnad',
      assistant: HR,
      side: true,
    });
    await expect(transcript(page).getByText('Du frågade HR-assistenten i sidofältet', { exact: true })).toHaveCount(1);
  });
  test('Esc in the panel closes it: the conversation stays, the address lets go of the assistant, and Clew’s box has the focus', async ({
    page,
    api,
  }) => {
    api.handoverAssistants = [hrAssistant];
    await openBeside(page);
    await askBeside(page, QUESTION);
    await expect(panel(page).getByText('25 semesterdagar')).toBeVisible();
    await sideBox(page).press('Escape');
    await expect(panel(page)).toHaveCount(0);
    await expect(page).toHaveURL(/\/conversations\/overlamnad$/);
    await expect(composer(page)).toBeFocused();
    // "Visa" on the transcript's line is the way back to it.
    await transcript(page).getByRole('link', { name: 'Visa' }).click();
    await expect(panel(page).getByText('25 semesterdagar')).toBeVisible();
    await panel(page).getByRole('button', { name: 'Stäng' }).click();
    await expect(panel(page)).toHaveCount(0);
  });
  test('"Andra assistenter" in a conversation’s header lists the ones the person may ask, and choosing by keyboard opens the panel', async ({
    page,
    api,
  }) => {
    api.handoverAssistants = [hrAssistant];
    await open(page, '/conversations/new');
    await composer(page).fill('Vad har jag i kalendern i morgon?');
    await composer(page).press('Enter');
    await expect(page.getByRole('article', { name: 'Assistenten', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Andra assistenter', exact: true }).focus();
    await page.keyboard.press('Enter');
    const row = page.getByRole('menuitemradio', { name: /HR-assistenten/ });
    await expect(page.getByRole('group', { name: 'Du kan fråga', exact: true })).toBeVisible();
    await expect(row).toContainText('Kunskapsbanken');
    await row.focus();
    await page.keyboard.press('Enter');
    await expect(panel(page).getByRole('heading', { name: 'HR-assistenten', exact: true })).toBeVisible();
    await expect(sideBox(page)).toBeFocused();
    await expectNoAxeViolations(page);
  });
  test('a system that does not answer is said in Clew’s words in the panel, not in the assistant’s name', async ({
    page,
    api,
  }) => {
    api.handoverAssistants = [hrAssistant];
    api.handoverFails = true;
    await openBeside(page);
    await askBeside(page, QUESTION);
    await expect(panel(page).getByText('Kunskapsbanken svarar inte just nu.')).toBeVisible();
    await expect(panel(page).getByRole('log').getByRole('link')).toHaveCount(0);
    await expectNoAxeViolations(page);
  });
  test('while the panel’s question is answered it stands in the panel’s log, the log is busy, and the box rests with no Stoppa', async ({
    page,
    api,
  }) => {
    api.handoverAssistants = [hrAssistant];
    await openBeside(page);
    const release = api.holdAnswer();
    await askBeside(page, QUESTION);
    const log = panel(page).getByRole('log');
    await expect(log.getByText(QUESTION, { exact: true })).toBeVisible();
    await expect(log).toHaveAttribute('aria-busy', 'true');
    await expect(sideBox(page)).toBeDisabled();
    await expect(panel(page).getByRole('button', { name: 'Stoppa' })).toHaveCount(0);
    release();
    await expect(log.getByText('25 semesterdagar')).toBeVisible();
    await expect(log).not.toHaveAttribute('aria-busy', 'true');
    await expect(log.getByText(QUESTION, { exact: true })).toHaveCount(1);
    await expect(sideBox(page)).toBeEnabled();
  });
  test('a question the panel cannot send comes back into its box, and the box says why', async ({ page, api }) => {
    api.handoverAssistants = [hrAssistant];
    await openBeside(page);
    await page.route('**/api/conversation/stream', route =>
      route.fulfill({ status: 503, json: { error: 'Något gick fel. Försök igen.' } }),
    );
    await askBeside(page, QUESTION);
    await expect(panel(page).getByText('Något gick fel. Försök igen.')).toBeVisible();
    await expect(sideBox(page)).toHaveText(QUESTION);
    await expect(panel(page).getByRole('log')).toHaveCount(0);
    await expectNoAxeViolations(page);
  });
  test('nothing goes from the panel to Clew: no button under an answer puts a question to Clew, and Clew’s box is where Clew is asked', async ({
    page,
    api,
  }) => {
    api.handoverAssistants = [hrAssistant];
    await openBeside(page);
    await askBeside(page, QUESTION);
    await expect(panel(page).getByText('25 semesterdagar')).toBeVisible();
    // Clew was not asked, and the panel offers no way to ask it.
    expect(api.asked).toHaveLength(1);
    await expect(panel(page).getByRole('button', { name: /Fråga assistenten/ })).toHaveCount(0);
    // The panel's box is one row, with what leaves Clew said once at the panel's head.
    await expect(
      panel(page).getByText('Det du skriver här skickas till Kunskapsbanken. Inget annat ur samtalet följer med.'),
    ).toBeVisible();
    await composer(page).fill(QUESTION);
    await composer(page).press('Enter');
    await expect.poll(() => api.asked.at(-1)).toMatchObject({ text: QUESTION, conversationId: 'overlamnad' });
    expect(api.asked.at(-1)).not.toHaveProperty('assistant');
    await expectNoAxeViolations(page);
  });
  test('Clew’s own assistant suggests an assistant and asks first: yes sends the question as written, it stands once marked as sent on, and the box stays Clew’s', async ({
    page,
    api,
  }) => {
    api.handoverAssistants = [hrAssistant];
    api.routes = /semesterdagar/;
    await open(page, '/');
    await composer(page).fill(QUESTION);
    await composer(page).press('Enter');
    // Nothing has gone anywhere: the question stands, and Clew asks where it should go (board SamtalEneoFraga).
    const yes = page.getByRole('button', { name: 'Skicka till HR-assistenten', exact: true });
    await expect(yes).toBeFocused();
    await expect(page.getByText(/kan svara på det här\. Vill du att jag skickar frågan dit\?/)).toBeVisible();
    await expect(page.getByRole('log').getByText('Svarar på frågor om anställning och ledighet.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Svara själv', exact: true })).toBeVisible();
    await expect
      .poll(() => announcements(page))
      .toContainEqual(
        expect.stringContaining('HR-assistenten i Kunskapsbanken kan svara på det här. Välj i samtalet.'),
      );
    await expect(page.getByRole('button', { name: 'Stoppa' })).toHaveCount(0);
    expect(api.asked).toHaveLength(1);
    await expectNoAxeViolations(page);
    await page.keyboard.press('Enter');
    const answer = page.getByRole('article', { name: ANSWERED, exact: true });
    await expect(answer.getByText('25 semesterdagar')).toBeVisible();
    // The same words, now with the assistant named and that Clew suggested it.
    expect(api.asked.at(-1)).toEqual({ text: QUESTION, chips: [], assistant: HR, suggested: true });
    // The question is on the page once (D126 item 6): the same message says it was sent on, and the suggestion is one
    // line under it.
    const log = transcript(page);
    await expect(log.getByText(QUESTION, { exact: true })).toHaveCount(1);
    await expect(log.getByText('Skickad vidare till HR-assistenten i Kunskapsbanken')).toHaveCount(1);
    await expect(
      log.getByText('Assistenten föreslog HR-assistenten i Kunskapsbanken · du valde att fråga den', { exact: true }),
    ).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Skicka till HR-assistenten', exact: true })).toHaveCount(0);
    // The answer is the assistant's, with its sources; no model wrote it and Clew offers nothing of its own under it.
    await expect(answer.getByRole('link', { name: 'Semesterregler' })).toBeVisible();
    await expect(answer.getByText(/Svar från/)).toHaveCount(0);
    await expect(answer.getByRole('button', { name: 'Lägg under Behöver dig' })).toHaveCount(0);
    // Nothing sticks: the box under the transcript is Clew's and has the focus, and nothing opened by itself.
    await expect(composer(page)).toBeFocused();
    await expect(page.getByRole('button', { name: /^Till: / })).toHaveCount(0);
    await expect(page.getByText('Samtal med assistenten', { exact: true })).toBeVisible();
    await expect(panel(page)).toHaveCount(0);
    await expectNoAxeViolations(page);
    // The way on with the assistant is under its answer: its exchange beside the transcript, with what Clew sent on.
    await answer.getByRole('link', { name: 'Fortsätt med HR-assistenten' }).click();
    await expect(sideBox(page)).toBeFocused();
    await expect(panel(page).getByText(QUESTION, { exact: true })).toBeVisible();
    await expect(panel(page).getByText('Från samtalet med assistenten')).toBeVisible();
    await askBeside(page, 'Och om jag är över 40?');
    await expect(panel(page).getByText('Det är svar 2 i det här samtalet.')).toBeVisible();
    await expect(answer.getByText('1 fråga i sidofältet')).toBeVisible();
    await expect(log.getByText('Och om jag är över 40?', { exact: true })).toHaveCount(0);
    // A question to Clew is typed under the transcript and goes to Clew.
    await composer(page).fill('Vad har jag i kalendern i morgon?');
    await composer(page).press('Enter');
    await expect.poll(() => api.asked.at(-1)).toMatchObject({ text: 'Vad har jag i kalendern i morgon?' });
    expect(api.asked.at(-1)).not.toHaveProperty('assistant');
    await expectNoAxeViolations(page);
  });
  test('no to the suggestion: Clew answers the same question, and is not asked to hand it over again', async ({
    page,
    api,
  }) => {
    api.handoverAssistants = [hrAssistant];
    api.routes = /semesterdagar/;
    await open(page, '/');
    await composer(page).fill('Hur många semesterdagar har jag?');
    await composer(page).press('Enter');
    await page.getByRole('button', { name: 'Svara själv', exact: true }).click();
    await expect(page.getByText(/Du har 18 semesterdagar/)).toBeVisible();
    expect(api.asked.at(-1)).toEqual({ text: 'Hur många semesterdagar har jag?', chips: [], own: true });
    await expect(page.getByRole('button', { name: 'Skicka till HR-assistenten', exact: true })).toHaveCount(0);
    await expect(composer(page)).toBeFocused();
  });
  test('a question in the panel that names the person’s staff is held: Clew answers by default, and sending it anyway is the person’s own choice', async ({
    page,
    api,
  }) => {
    api.handoverAssistants = [hrAssistant];
    api.holds = /Anna/;
    await openBeside(page);
    await askBeside(page, 'Hur länge har Anna varit sjukskriven?');
    // Not sent: the safe choice has the focus, and the other one names where the question would go.
    const stay = panel(page).getByRole('button', { name: 'Låt assistenten svara', exact: true });
    await expect(stay).toBeFocused();
    await expect(panel(page).getByText('Inte skickad')).toBeVisible();
    await expect(panel(page).getByText(/Frågan ser ut att gälla din personal\./)).toBeVisible();
    await expect(
      panel(page).getByRole('button', { name: 'Skicka till HR-assistenten ändå', exact: true }),
    ).toBeVisible();
    await expect
      .poll(() => announcements(page))
      .toContainEqual(expect.stringContaining('Frågan är inte skickad. Välj i sidofältet.'));
    await expectNoAxeViolations(page);
    // Enter on the focused button: Clew answers, and nothing named the assistant in what was sent.
    await page.keyboard.press('Enter');
    await expect
      .poll(() => api.asked.at(-1))
      .toEqual({ text: 'Hur länge har Anna varit sjukskriven?', chips: [], own: true });
    await expect(panel(page).getByRole('button', { name: 'Skicka till HR-assistenten ändå', exact: true })).toHaveCount(
      0,
    );
  });
  test('sending a held question anyway says so in what is sent', async ({ page, api }) => {
    api.handoverAssistants = [hrAssistant];
    api.holds = /Anna/;
    await openBeside(page);
    await askBeside(page, 'Vad säger rutinen om Anna?');
    await panel(page).getByRole('button', { name: 'Skicka till HR-assistenten ändå', exact: true }).click();
    await expect(panel(page).getByText('25 semesterdagar')).toBeVisible();
    expect(api.asked.at(-1)).toEqual({
      text: 'Vad säger rutinen om Anna?',
      assistant: HR,
      side: true,
      confirmed: true,
    });
  });
  test('a conversation opened again is with Clew, and the assistant’s exchange is one press away', async ({
    page,
    api,
  }) => {
    api.handoverAssistants = [hrAssistant];
    await openBeside(page);
    await askBeside(page, QUESTION);
    await expect(panel(page).getByText('25 semesterdagar')).toBeVisible();
    await page.goto('/conversations/overlamnad');
    await expect(page.getByText('Samtal med assistenten', { exact: true })).toBeVisible();
    await expect(panel(page)).toHaveCount(0);
    await expect(composer(page)).toBeVisible();
    await page.getByRole('button', { name: /^Andra assistenter/ }).click();
    await expect(page.getByRole('group', { name: 'I det här samtalet', exact: true })).toBeVisible();
    await page.getByRole('menuitemradio', { name: /HR-assistenten/ }).click();
    await expect(panel(page).getByText('25 semesterdagar')).toBeVisible();
  });
  for (const [layout, viewport] of [
    ['phone', phone],
    ['320 px', narrow],
  ] as const)
    test(`at ${layout} the assistant’s exchange takes the column until it is closed, and reflows without a sideways scroll`, async ({
      page,
      api,
    }) => {
      api.handoverAssistants = [hrAssistant];
      await page.setViewportSize(viewport);
      await open(page, '/conversations/new');
      await page.getByRole('link', { name: 'HR-assistenten', exact: true }).click();
      await expect(sideBox(page)).toBeVisible();
      expect(await reflowProblems(page)).toEqual([]);
      await askBeside(page, QUESTION);
      await expect(page.getByText('25 semesterdagar')).toBeVisible();
      expect(await reflowProblems(page)).toEqual([]);
      await expectNoAxeViolations(page);
      await page.getByRole('button', { name: 'Stäng' }).click();
      await expect(composer(page)).toBeVisible();
      await expect(page.getByText('Du frågade HR-assistenten i sidofältet', { exact: true })).toBeVisible();
      expect(await reflowProblems(page)).toEqual([]);
    });
  test('at 320 px the question sent on, the line in the suggestion’s place and the answer reflow without a sideways scroll', async ({
    page,
    api,
  }) => {
    api.handoverAssistants = [hrAssistant];
    api.routes = /semesterdagar/;
    await page.setViewportSize(narrow);
    await open(page, '/');
    await composer(page).fill(QUESTION);
    await composer(page).press('Enter');
    await page.getByRole('button', { name: 'Skicka till HR-assistenten', exact: true }).click();
    await expect(
      page.getByRole('article', { name: ANSWERED, exact: true }).getByText('25 semesterdagar'),
    ).toBeVisible();
    await expect(page.getByText(/^Assistenten föreslog HR-assistenten i Kunskapsbanken/)).toBeVisible();
    await expect(page.getByText('Fortsätt med HR-assistenten')).toBeVisible();
    expect(await reflowProblems(page)).toEqual([]);
    await expectNoAxeViolations(page);
  });
});
