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

/**
 * A conversation handed to an assistant of another system (the assistants profile): choosing it in the list the button above
 * the field opens, the box saying whom it talks to, the question going there alone, the answer drawn as that
 * assistant's own with its sources and the way on, and a source that does not answer. Keyboard, focus, announcements,
 * axe and reflow, at desktop, phone and 320 px.
 */
// Handed over, the box takes no `@`, so it is a plain text field and not the combobox Clew's own box is.
const handedBox = (page: import('@playwright/test').Page) =>
  page.getByRole('textbox', { name: 'Fråga HR-assistenten' });
const menuButton = (page: import('@playwright/test').Page, name: string | RegExp) => page.getByRole('button', { name });
/** The button above the field that names whom the box talks to and opens the list. */
const recipient = (page: import('@playwright/test').Page, name: string) =>
  page.getByRole('button', { name: `Till: ${name}`, exact: true });
const option = (page: import('@playwright/test').Page, name: string | RegExp) =>
  page.getByRole('menuitemradio', { name });
async function pick(page: import('@playwright/test').Page) {
  await recipient(page, 'Clew').click();
  await option(page, /HR-assistenten/).click();
}
/** What another system's assistant wrote, by the name its turn carries. */
const ANSWERED = 'HR-assistenten Kunskapsbanken';

test.describe('handing a conversation to another system’s assistant', () => {
  test.use({ viewport: desktop });
  test('with no such assistant the box is Clew’s as before: no recipient button, and the model menu', async ({
    page,
    api: _,
  }) => {
    await open(page, '/');
    await expect(composer(page)).toBeVisible();
    await expect(page.getByRole('button', { name: /^Till: / })).toHaveCount(0);
    await menuButton(page, 'Modell: Kapabel').click();
    await expect(page.getByRole('group', { name: 'Modell' }).getByRole('menuitemradio')).toHaveCount(1);
  });
  test('the button above the field names whom the box talks to, and choosing by keyboard is spoken and takes the focus to the field', async ({
    page,
    api,
  }) => {
    api.handoverAssistants = [hrAssistant];
    await open(page, '/');
    // Clew to begin with; the list opens on it, with the assistant under its system and what it is for.
    await recipient(page, 'Clew').focus();
    await page.keyboard.press('Enter');
    await expect(option(page, /^Clew/)).toHaveAttribute('aria-checked', 'true');
    await expect(option(page, /^Clew/)).toBeFocused();
    const hr = page
      .getByRole('group', { name: 'Kunskapsbanken' })
      .getByRole('menuitemradio', { name: /HR-assistenten/ });
    await expect(hr).toContainText('Svarar på frågor om anställning och ledighet.');
    await expect(hr).toHaveAttribute('aria-checked', 'false');
    await expectNoAxeViolations(page);
    await page.keyboard.press('ArrowDown');
    await expect(hr).toBeFocused();
    await page.keyboard.press('Enter');
    await expect
      .poll(() => announcements(page))
      .toContainEqual(expect.stringContaining('Du skriver till HR-assistenten i Kunskapsbanken, inte till Clew.'));
    await expect(handedBox(page)).toBeFocused();
    await expect(recipient(page, 'HR-assistenten')).toBeVisible();
    await expect(
      page.getByText('Du skriver till HR-assistenten i Kunskapsbanken, inte till Clew.').first(),
    ).toBeVisible();
    // No model of Clew's answers now, so its model menu is gone.
    await expect(menuButton(page, 'Modell: Kapabel')).toHaveCount(0);
    await expectNoAxeViolations(page);
    // The one-press way back; the box is Clew's again and says so.
    await page.getByRole('button', { name: 'Tillbaka till Clew' }).click();
    await expect.poll(() => announcements(page)).toContainEqual(expect.stringContaining('Du pratar med Clew igen.'));
    await expect(composer(page)).toBeFocused();
    await expect(recipient(page, 'Clew')).toBeVisible();
    await expect(menuButton(page, 'Modell: Kapabel')).toBeVisible();
    await expect(page.getByText('Du skriver till HR-assistenten i Kunskapsbanken, inte till Clew.')).toHaveCount(0);
  });
  test('with many assistants the list has a field that narrows it, and is grouped by system', async ({ page, api }) => {
    api.handoverAssistants = [
      hrAssistant,
      ...['IT-supporten', 'Löneassistenten', 'Upphandlingsstödet', 'Attestguiden', 'Skoljuristen', 'HSL-stödet'].map(
        (name, i) => ({ id: `kunskap:a${i}`, name, description: `Frågor till ${name}.`, source: 'Kunskapsbanken' }),
      ),
      { id: 'arkiv:diarie', name: 'Diarieguiden', description: 'Registrering och gallring.', source: 'Arkivet' },
    ];
    await open(page, '/');
    await recipient(page, 'Clew').click();
    await expect(page.getByRole('group', { name: 'Kunskapsbanken' }).getByRole('menuitemradio')).toHaveCount(7);
    await expect(page.getByRole('group', { name: 'Arkivet' }).getByRole('menuitemradio')).toHaveCount(1);
    await expectNoAxeViolations(page);
    const search = page.getByRole('textbox', { name: 'Sök assistent' });
    await search.fill('gallring');
    await expect(page.getByRole('menuitemradio')).toHaveCount(1);
    await option(page, /Diarieguiden/).click();
    await expect(recipient(page, 'Diarieguiden')).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Fråga Diarieguiden' })).toBeFocused();
    // Opened again the field is empty and everything is listed.
    await recipient(page, 'Diarieguiden').click();
    await expect(page.getByRole('textbox', { name: 'Sök assistent' })).toHaveValue('');
    await expect(option(page, /Diarieguiden/)).toHaveAttribute('aria-checked', 'true');
  });
  test('the question goes to it alone, and the answer is drawn as its own with its sources and the way on', async ({
    page,
    api,
  }) => {
    api.handoverAssistants = [hrAssistant];
    await open(page, '/');
    await pick(page);
    await handedBox(page).fill('Hur många semesterdagar har jag rätt till?');
    await handedBox(page).press('Enter');
    const answer = page.getByRole('article', { name: ANSWERED, exact: true });
    await expect(answer.getByText('25 semesterdagar')).toBeVisible();
    // Nothing of the conversation went with the question.
    expect(api.asked.at(-1)).toEqual({
      text: 'Hur många semesterdagar har jag rätt till?',
      chips: [],
      assistant: 'kunskap:hr',
    });
    await expect(page.getByText('Skickat till HR-assistenten')).toBeVisible();
    // The transcript says where the person turned to the assistant, once.
    await expect(page.getByRole('log').getByText('Du pratar med HR-assistenten', { exact: true })).toHaveCount(1);
    await expect(answer.getByRole('link', { name: 'Semesterregler' })).toHaveAttribute(
      'href',
      'https://intra.example/semester',
    );
    await expect(answer.getByText('Kollektivavtalet', { exact: true })).toBeVisible();
    await expect(answer.getByRole('link', { name: 'Fortsätt i Kunskapsbanken' })).toHaveAttribute(
      'href',
      'https://kunskap.example/samtal/1',
    );
    // No model wrote it, and Clew offers nothing of its own under it.
    await expect(answer.getByText(/Svar från/)).toHaveCount(0);
    await expect(answer.getByRole('button', { name: 'Lägg under Behöver dig' })).toHaveCount(0);
    await expectNoAxeViolations(page);
    // The conversation stays with the assistant: the follow-up continues it, and the list now holds that one and Clew.
    await expect(handedBox(page)).toBeFocused();
    await handedBox(page).fill('Och om jag är över 40?');
    await handedBox(page).press('Enter');
    await expect(answer.last().getByText('Det är svar 2 i det här samtalet.')).toBeVisible();
    expect(api.asked.at(-1)).toMatchObject({ assistant: 'kunskap:hr', conversationId: 'overlamnad' });
    await expect(page.getByRole('log').getByText('Du pratar med HR-assistenten', { exact: true })).toHaveCount(1);
    await recipient(page, 'HR-assistenten').click();
    await expect(page.getByRole('menuitemradio')).toHaveCount(2);
    await option(page, /HR-assistenten/).click();
    // "Ny fråga i stället" starts over with Clew.
    await page.getByRole('link', { name: 'Ny fråga i stället' }).click();
    await expect(composer(page)).toBeFocused();
    await expect(menuButton(page, 'Modell: Kapabel')).toBeVisible();
  });
  test('a conversation that was handed over opens still talking to the assistant', async ({ page, api }) => {
    api.handoverAssistants = [hrAssistant];
    await open(page, '/');
    await pick(page);
    await handedBox(page).fill('Hur många semesterdagar har jag rätt till?');
    await handedBox(page).press('Enter');
    await expect(page.getByText('25 semesterdagar')).toBeVisible();
    await page.reload();
    await expect(page.getByText('25 semesterdagar')).toBeVisible();
    await expect(recipient(page, 'HR-assistenten')).toBeVisible();
    await expect(handedBox(page)).toBeVisible();
  });
  test('a system that does not answer is said in Clew’s words, not in the assistant’s name', async ({ page, api }) => {
    api.handoverAssistants = [hrAssistant];
    api.handoverFails = true;
    await open(page, '/');
    await pick(page);
    await handedBox(page).fill('Hur många semesterdagar har jag rätt till?');
    await handedBox(page).press('Enter');
    const said = page.getByRole('article', { name: 'Clew · HR-assistenten svarade inte', exact: true });
    await expect(said.getByText('Kunskapsbanken svarar inte just nu.')).toBeVisible();
    await expect(said.getByRole('link')).toHaveCount(0);
    await expectNoAxeViolations(page);
  });
  for (const [layout, viewport] of [
    ['phone', phone],
    ['320 px', narrow],
  ] as const)
    test(`at ${layout} the handed-over box and the answer reflow without a sideways scroll`, async ({ page, api }) => {
      api.handoverAssistants = [hrAssistant];
      await page.setViewportSize(viewport);
      await open(page, '/');
      await pick(page);
      await expect(recipient(page, 'HR-assistenten')).toBeVisible();
      expect(await reflowProblems(page)).toEqual([]);
      await handedBox(page).fill('Hur många semesterdagar har jag rätt till?');
      await handedBox(page).press('Enter');
      await expect(page.getByText('25 semesterdagar')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Tillbaka till Clew' })).toBeVisible();
      expect(await reflowProblems(page)).toEqual([]);
      await expectNoAxeViolations(page);
    });
  test('Clew’s own assistant suggests an assistant and asks first: yes sends the question as written, and the box turns to the assistant', async ({
    page,
    api,
  }) => {
    api.handoverAssistants = [hrAssistant];
    api.routes = /semesterdagar/;
    await open(page, '/');
    await composer(page).fill('Hur många semesterdagar har jag rätt till?');
    await composer(page).press('Enter');
    // Nothing has gone anywhere: the question stands, and Clew asks where it should go.
    const yes = page.getByRole('button', { name: 'Fråga HR-assistenten', exact: true });
    await expect(yes).toBeFocused();
    await expect(page.getByText(/kan svara på det här\. Väljer du det skickas din fråga dit/)).toBeVisible();
    await expect(page.getByRole('log').getByText('Svarar på frågor om anställning och ledighet.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Låt Clew svara', exact: true })).toBeVisible();
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
    expect(api.asked.at(-1)).toEqual({
      text: 'Hur många semesterdagar har jag rätt till?',
      chips: [],
      assistant: 'kunskap:hr',
      suggested: true,
    });
    // The question is on the page once.
    await expect(
      page.getByRole('log').getByText('Hur många semesterdagar har jag rätt till?', { exact: true }),
    ).toHaveCount(1);
    await expect(page.getByText('Clew skickade frågan till HR-assistenten')).toBeVisible();
    await expect(recipient(page, 'HR-assistenten')).toBeVisible();
    await expect(handedBox(page)).toBeFocused();
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
    await page.getByRole('button', { name: 'Låt Clew svara', exact: true }).click();
    await expect(page.getByText(/Du har 18 semesterdagar/)).toBeVisible();
    expect(api.asked.at(-1)).toEqual({ text: 'Hur många semesterdagar har jag?', chips: [], own: true });
    await expect(page.getByRole('button', { name: 'Fråga HR-assistenten', exact: true })).toHaveCount(0);
    await expect(recipient(page, 'Clew')).toBeVisible();
    await expect(composer(page)).toBeFocused();
  });
  test('"Ny fråga" in the rail gives the box back to Clew', async ({ page, api }) => {
    api.handoverAssistants = [hrAssistant];
    await open(page, '/');
    await pick(page);
    await handedBox(page).fill('Hur många semesterdagar har jag rätt till?');
    await handedBox(page).press('Enter');
    await expect(page.getByText('25 semesterdagar')).toBeVisible();
    await expect(recipient(page, 'HR-assistenten')).toBeVisible();
    await page.getByRole('link', { name: 'Ny fråga', exact: true }).click();
    await expect(recipient(page, 'Clew')).toBeVisible();
    await expect(composer(page)).toBeVisible();
    await expect(page.getByText('Du skriver till HR-assistenten i Kunskapsbanken, inte till Clew.')).toHaveCount(0);
  });
  test('an assistant that hands the question back: Clew answers under a line that says so, and the box is Clew’s again', async ({
    page,
    api,
  }) => {
    api.handoverAssistants = [hrAssistant];
    api.handoverReturns = 'declined';
    await open(page, '/');
    await pick(page);
    await handedBox(page).fill('Vad har jag i kalendern i morgon?');
    await handedBox(page).press('Enter');
    await expect(page.getByText('Du har APT 10:00 i morgon.')).toBeVisible();
    await expect(
      page.getByRole('log').getByText('HR-assistenten lämnade tillbaka frågan · Clew svarar', { exact: true }),
    ).toHaveCount(1);
    // Clew's own answer, named as Clew's, on the page and not on the assistant's surface.
    await expect(page.getByRole('article', { name: 'Clew · läste Kalendern', exact: true })).toBeVisible();
    await expect(page.getByRole('article', { name: ANSWERED, exact: true })).toHaveCount(0);
    await expect
      .poll(() => announcements(page))
      .toContainEqual(
        expect.stringContaining('HR-assistenten lämnade tillbaka frågan. Clew svarade, och du pratar med Clew igen.'),
      );
    await expect(recipient(page, 'Clew')).toBeVisible();
    await expect(composer(page)).toBeFocused();
    await expectNoAxeViolations(page);
  });
  test('an assistant that is done: its answer stands, a line says it is done, and the box is Clew’s again', async ({
    page,
    api,
  }) => {
    api.handoverAssistants = [hrAssistant];
    api.handoverReturns = 'completed';
    await open(page, '/');
    await pick(page);
    await handedBox(page).fill('Hur många semesterdagar har jag rätt till?');
    await handedBox(page).press('Enter');
    await expect(
      page.getByRole('article', { name: ANSWERED, exact: true }).getByText('25 semesterdagar'),
    ).toBeVisible();
    await expect(
      page.getByRole('log').getByText('HR-assistenten är klar · du pratar med Clew igen', { exact: true }),
    ).toHaveCount(1);
    await expect
      .poll(() => announcements(page))
      .toContainEqual(expect.stringContaining('HR-assistenten är klar. Du pratar med Clew igen.'));
    await expect(recipient(page, 'Clew')).toBeVisible();
    // The next question is Clew's, and no second line says so.
    api.handoverReturns = undefined;
    await composer(page).fill('Hur många semesterdagar har jag?');
    await composer(page).press('Enter');
    await expect(page.getByText(/Du har 18 semesterdagar/)).toBeVisible();
    await expect(page.getByRole('log').getByText('Du pratar med Clew igen', { exact: true })).toHaveCount(0);
    await expectNoAxeViolations(page);
  });
  test('the box says whom it writes to while it talks to another system’s assistant, with that system’s mark', async ({
    page,
    api,
  }) => {
    api.handoverAssistants = [hrAssistant];
    await open(page, '/');
    await expect(page.getByText('Du skriver till HR-assistenten i Kunskapsbanken, inte till Clew.')).toHaveCount(0);
    await pick(page);
    await expect(
      page.getByText('Du skriver till HR-assistenten i Kunskapsbanken, inte till Clew.').first(),
    ).toBeVisible();
    await expectNoAxeViolations(page);
    await page.getByRole('button', { name: 'Tillbaka till Clew' }).click();
    await expect(page.getByText('Du skriver till HR-assistenten i Kunskapsbanken, inte till Clew.')).toHaveCount(0);
  });
  test('a question that names the person’s staff is held: Clew answers by default, and sending it anyway is the person’s own choice', async ({
    page,
    api,
  }) => {
    api.handoverAssistants = [hrAssistant];
    api.holds = /Anna/;
    await open(page, '/');
    await pick(page);
    await handedBox(page).fill('Hur länge har Anna varit sjukskriven?');
    await handedBox(page).press('Enter');
    // Not sent: the safe choice has the focus, and the other one names where the question would go.
    const stay = page.getByRole('button', { name: 'Låt Clew svara', exact: true });
    await expect(stay).toBeFocused();
    await expect(page.getByRole('log').getByText('Inte skickad')).toBeVisible();
    await expect(page.getByRole('log').getByText(/Frågan ser ut att gälla din personal\./)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Skicka till HR-assistenten ändå', exact: true })).toBeVisible();
    await expect
      .poll(() => announcements(page))
      .toContainEqual(
        expect.stringContaining('Frågan är inte skickad. Den ser ut att gälla din personal. Välj i samtalet.'),
      );
    await expectNoAxeViolations(page);
    // Enter on the focused button: Clew answers, and nothing named the assistant in what was sent.
    await page.keyboard.press('Enter');
    await expect
      .poll(() => api.asked.at(-1))
      .toEqual({ text: 'Hur länge har Anna varit sjukskriven?', chips: [], own: true });
    await expect(page.getByRole('button', { name: 'Skicka till HR-assistenten ändå', exact: true })).toHaveCount(0);
  });
  test('sending a held question anyway says so in what is sent', async ({ page, api }) => {
    api.handoverAssistants = [hrAssistant];
    api.holds = /Anna/;
    await open(page, '/');
    await pick(page);
    await handedBox(page).fill('Vad säger rutinen om Anna?');
    await handedBox(page).press('Enter');
    await page.getByRole('button', { name: 'Skicka till HR-assistenten ändå', exact: true }).click();
    await expect(
      page.getByRole('article', { name: ANSWERED, exact: true }).getByText('25 semesterdagar'),
    ).toBeVisible();
    expect(api.asked.at(-1)).toEqual({
      text: 'Vad säger rutinen om Anna?',
      chips: [],
      assistant: 'kunskap:hr',
      confirmed: true,
    });
  });
});
