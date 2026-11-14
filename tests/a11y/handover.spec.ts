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
 * A conversation handed to an assistant of another system (the assistants profile): picking it in the box's menu, the
 * box saying whom it talks to and offering the way back, the question going there alone, the answer drawn as that
 * assistant's own with its sources and the way on, and a source that does not answer. Keyboard, focus, announcements,
 * axe and reflow, at desktop, phone and 320 px.
 */
// Handed over, the box takes no `@`, so it is a plain text field and not the combobox Clew's own box is.
const handedBox = (page: import('@playwright/test').Page) =>
  page.getByRole('textbox', { name: 'Fråga HR-assistenten' });
const menuButton = (page: import('@playwright/test').Page, name: string | RegExp) => page.getByRole('button', { name });
async function pick(page: import('@playwright/test').Page) {
  await menuButton(page, 'Modell: Kapabel').click();
  await page
    .getByRole('group', { name: 'Assistenter i andra system' })
    .getByRole('menuitemradio', { name: /HR-assistenten · Kunskapsbanken/ })
    .click();
}

test.describe('handing a conversation to another system’s assistant', () => {
  test.use({ viewport: desktop });
  test('with no such assistant the menu is the model menu as before', async ({ page, api: _ }) => {
    await open(page, '/');
    await menuButton(page, 'Modell: Kapabel').click();
    await expect(page.getByRole('group', { name: 'Modell' }).getByRole('menuitemradio')).toHaveCount(1);
    await expect(page.getByRole('group', { name: 'Assistenter i andra system' })).toHaveCount(0);
  });
  test('the menu lists it under the models with what it is for, and picking it by keyboard is spoken and shown above the field', async ({
    page,
    api,
  }) => {
    api.handoverAssistants = [hrAssistant];
    await open(page, '/');
    const trigger = menuButton(page, 'Modell: Kapabel');
    await trigger.focus();
    await page.keyboard.press('Enter');
    const group = page.getByRole('group', { name: 'Assistenter i andra system' });
    const item = group.getByRole('menuitemradio', { name: /HR-assistenten · Kunskapsbanken/ });
    await expect(item).toContainText('Svarar på frågor om anställning och ledighet.');
    await expect(item).toHaveAttribute('aria-checked', 'false');
    await expectNoAxeViolations(page);
    // From the current model down to the assistant, and Enter picks it.
    await page.keyboard.press('ArrowDown');
    await expect(item).toBeFocused();
    await page.keyboard.press('Enter');
    await expect
      .poll(() => announcements(page))
      .toContainEqual('Du pratar nu med HR-assistenten i Kunskapsbanken. Det du skriver skickas dit.');
    // The box says whom it talks to, takes the focus, and its menu names the assistant.
    await expect(handedBox(page)).toBeFocused();
    await expect(page.getByText('Du pratar med HR-assistenten')).toBeVisible();
    await expect(page.getByText(/Det du skriver skickas dit, inget annat från samtalet\./)).toBeVisible();
    await expect(menuButton(page, 'Svarar: HR-assistenten i Kunskapsbanken')).toBeVisible();
    await expectNoAxeViolations(page);
    // The way back is a link above the field; the box is Clew's again and says so.
    await page.getByRole('link', { name: 'Tillbaka till Clew' }).click();
    await expect.poll(() => announcements(page)).toContainEqual('Du pratar med Clew igen.');
    await expect(composer(page)).toBeFocused();
    await expect(menuButton(page, 'Modell: Kapabel')).toBeVisible();
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
    const answer = page.getByRole('article', { name: 'HR-assistenten · Kunskapsbanken', exact: true });
    await expect(answer.getByText('25 semesterdagar')).toBeVisible();
    // Nothing of the conversation went with the question.
    expect(api.asked.at(-1)).toEqual({
      text: 'Hur många semesterdagar har jag rätt till?',
      chips: [],
      assistant: 'kunskap:hr',
    });
    await expect(page.getByText('Skickat till HR-assistenten')).toBeVisible();
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
    // The conversation stays with the assistant: the follow-up continues it, and the menu now offers that one only.
    await expect(handedBox(page)).toBeFocused();
    await handedBox(page).fill('Och om jag är över 40?');
    await handedBox(page).press('Enter');
    await expect(answer.last().getByText('Det är svar 2 i det här samtalet.')).toBeVisible();
    expect(api.asked.at(-1)).toMatchObject({ assistant: 'kunskap:hr', conversationId: 'overlamnad' });
    await menuButton(page, 'Svarar: HR-assistenten i Kunskapsbanken').click();
    await expect(
      page.getByRole('group', { name: 'Assistenter i andra system' }).getByRole('menuitemradio'),
    ).toHaveCount(1);
    await menuButton(page, 'Svarar: HR-assistenten i Kunskapsbanken').click();
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
    await expect(page.getByText('Du pratar med HR-assistenten')).toBeVisible();
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
      await expect(page.getByText('Du pratar med HR-assistenten')).toBeVisible();
      expect(await reflowProblems(page)).toEqual([]);
      await handedBox(page).fill('Hur många semesterdagar har jag rätt till?');
      await handedBox(page).press('Enter');
      await expect(page.getByText('25 semesterdagar')).toBeVisible();
      await expect(page.getByRole('link', { name: 'Tillbaka till Clew' })).toBeVisible();
      expect(await reflowProblems(page)).toEqual([]);
      await expectNoAxeViolations(page);
    });
});
