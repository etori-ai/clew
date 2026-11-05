import { answer, composer, desktop, expect, expectNoAxeViolations, heading, open, phone, test } from './support';
import { menuRow } from './telefonbok';

/** Wide enough for the panel to stand beside the page's column (D50); at the suite's desktop width it lies over it. */
const wide = { width: 1440, height: 900 };

/**
 * D50: the column is where the person is, the panel is what they hold beside it, and the conversation is never in the
 * panel. Att göra is one page with a card's state as tabs and the areas as a filter; a row opens its card in the
 * panel; the box at the foot of a page asks about what the page shows, and the answer opens as a conversation with
 * that beside the transcript.
 */
test.describe('Att göra', () => {
  test.use({ viewport: desktop });

  test('a card\'s state is a tab: the tabs speak the tabs pattern, the address names the tab, and each tab has its rows', async ({ page, api: _ }) => {
    await open(page, '/todo');
    await expect(page.getByRole('tablist').getByRole('tab')).toHaveCount(4);
    for (const name of ['Behöver dig · 6', 'Pågår · 2', 'Inte nu · 1', 'Klart']) await expect(page.getByRole('tab', { name, exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: /^Behöver dig/ })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tabpanel', { name: 'Behöver dig' })).toBeVisible();
    await page.getByRole('tab', { name: /^Pågår/ }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/todo\?tab=waiting$/);
    const waiting = page.getByRole('tabpanel', { name: 'Pågår utan dig' });
    await expect(waiting.getByRole('button', { name: 'Tillbud 2026-1182, halkolycka i duschen', exact: true })).toBeVisible();
    await expect(heading(page, 2, 'Pågår utan dig · 2')).toBeVisible();
    await page.getByRole('tab', { name: /^Inte nu/ }).click();
    await expect(page).toHaveURL(/\/todo\?tab=snoozed$/);
    await expect(heading(page, 2, 'Inte nu · 1')).toBeVisible();
    await expect(page.getByRole('tabpanel', { name: 'Inte nu' }).getByRole('button', { name: 'Ta upp nu' })).toBeVisible();
    await page.getByRole('tab', { name: 'Klart' }).click();
    await expect(page).toHaveURL(/\/todo\?tab=done$/);
    await expect(heading(page, 2, 'Redan hanterat')).toBeVisible();
    // Back is the tab before: the address is the state.
    await page.goBack();
    await expect(page.getByRole('tab', { name: /^Inte nu/ })).toHaveAttribute('aria-selected', 'true');
  });

  test('the area filter narrows every tab and stays in the address', async ({ page, api: _ }) => {
    await open(page, '/todo?area=personal');
    await expect(page.getByRole('combobox', { name: 'Område' })).toContainText('Personal');
    const rows = page.getByRole('tabpanel', { name: 'Behöver dig' });
    await expect(rows.getByRole('button', { name: 'Omtankesamtal med Anna Lindqvist', exact: true })).toBeVisible();
    await expect(rows.getByRole('button', { name: 'Attestera 3 fakturor, 48 200 kr', exact: true })).toHaveCount(0);
    await page.getByRole('tab', { name: /^Pågår/ }).click();
    await expect(page).toHaveURL(/\/todo\?area=personal&tab=waiting$/);
    await page.getByRole('combobox', { name: 'Område' }).click();
    await page.getByRole('option', { name: 'Alla områden' }).click();
    await expect(page).toHaveURL(/\/todo\?tab=waiting$/);
  });

  test('on a phone every thread is a card in the list, and the one the address names has the focus', async ({ page, api: _ }) => {
    await page.setViewportSize(phone);
    await open(page, '/todo?card=ledighet');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const card = page.locator('#thread-ledighet');
    await expect(card).toBeInViewport();
    await expect.poll(() => card.evaluate(el => el.contains(document.activeElement))).toBe(true);
  });
});

test.describe('the panel beside the page', () => {
  test.use({ viewport: wide });

  test('a row opens its card beside the list: a named region, not a dialog, with the focus on its heading; Esc gives the focus back', async ({ page, api: _ }) => {
    await open(page, '/todo');
    const title = page.getByRole('button', { name: 'Attestera 3 fakturor, 48 200 kr', exact: true });
    await title.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/todo\?card=fakturor$/);
    const panel = page.getByRole('complementary', { name: 'Kort' });
    await expect(panel).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(panel.getByRole('heading', { level: 2, name: 'Kort' })).toBeFocused();
    // The row is marked as the one whose card is open, and its card has the card's own controls.
    await expect(title).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#thread-fakturor')).toHaveAttribute('aria-current', 'true');
    await expect(panel.locator('#card-fakturor').getByRole('checkbox')).toHaveCount(3);
    await expect(panel.locator('#card-fakturor').getByRole('button', { name: 'Attestera · 2' })).toBeVisible();
    await expectNoAxeViolations(page);
    // The list is still in use beside it: another row takes the panel, and the new card is named by its own title.
    await page.getByRole('button', { name: 'Omtankesamtal med Anna Lindqvist', exact: true }).click();
    await expect(panel.locator('#card-omtanke')).toBeVisible();
    await expect(panel.locator('#card-fakturor')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await expect(page).toHaveURL(/\/todo$/);
  });

  test('a card\'s own read lies over the card: closing the view leaves the card', async ({ page, api: _ }) => {
    await open(page, '/todo?card=omtanke');
    const card = page.getByRole('complementary', { name: 'Kort' });
    await card.getByRole('button', { name: 'Se mönstret' }).click();
    await expect(page).toHaveURL(/card=omtanke&open-card=omtanke&open-action=pattern$/);
    const view = page.getByRole('complementary', { name: 'Se mönstret' });
    await expect(view).toBeVisible();
    await view.getByRole('button', { name: 'Stäng panelen' }).click();
    await expect(page.getByRole('complementary', { name: 'Kort' }).locator('#card-omtanke')).toBeVisible();
    await expect(page).toHaveURL(/\/todo\?card=omtanke$/);
  });

  test('the box on Att göra asks about the open card: the conversation takes the column, the card stays beside it, and closing leads back', async ({ page, api }) => {
    await open(page, '/todo?card=fakturor');
    await expect(page.getByText('Fråga om kortet Attestera 3 fakturor, 48 200 kr …')).toBeVisible();
    api.answerDelay = 300;
    const box = composer(page);
    await box.fill('Vem är på plats?');
    await box.press('Enter');
    // At once, before the answer: the transcript is the column and the card has not moved.
    await expect(page).toHaveURL(/\/conversations\/new\?card=fakturor$/);
    await expect(page.getByRole('log')).toContainText('Vem är på plats?');
    await expect(page.getByRole('complementary', { name: 'Kort' }).locator('#card-fakturor')).toBeVisible();
    await expect(composer(page)).toBeFocused();
    await expect(answer(page)).toBeVisible();
    await expect(page).toHaveURL(/\/conversations\/[^/?]+\?card=fakturor$/);
    await expect(page).not.toHaveURL(/\/conversations\/new/);
    await expectNoAxeViolations(page);
    // The card went along as what the question is about.
    expect(api.asked.at(-1)?.chips?.map(c => c.ref)).toEqual(['thread:fakturor']);
    await page.getByRole('button', { name: 'Stäng samtalet' }).click();
    await expect(page).toHaveURL(/\/todo\?card=fakturor$/);
    await expect(heading(page, 1, 'Att göra')).toBeVisible();
  });

  test('a view an answer names opens beside the transcript, the conversation stays, and a view that is a tool offers its page', async ({ page, api }) => {
    api.menu = [menuRow];
    await open(page, '/');
    await composer(page).fill('telefonboken lärare');
    await composer(page).press('Enter');
    const log = page.getByRole('log');
    await expect(log).toContainText('Sök i telefonboken: 2 rader.');
    const address = page.url();
    await log.getByRole('button', { name: 'Visa allt' }).click();
    const panel = page.getByRole('complementary', { name: 'Sök i telefonboken' });
    await expect(panel.getByRole('searchbox')).toHaveValue('lärare');
    // Beside the transcript a table is its list: the panel is as narrow as a phone.
    await expect(panel.getByRole('table')).toHaveCount(0);
    await expect(panel.getByRole('listitem').filter({ hasText: 'Anna Lindqvist' })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(page.url().startsWith(address)).toBe(true);
    await expect(log).toContainText('Sök i telefonboken: 2 rader.');
    await expect(panel.getByRole('heading', { level: 2, name: 'Sök i telefonboken' })).toBeFocused();
    await expectNoAxeViolations(page);
    await expect(panel.getByRole('link', { name: 'Öppna som sida' })).toHaveAttribute('href', /^\/tools\/telefonbok\.directory\?input=/);
    // The box is in use while the panel is open, and typing there never loses the panel.
    await composer(page).fill('Vem är på plats?');
    await composer(page).press('Enter');
    await expect(answer(page)).toBeVisible();
    await expect(panel).toBeVisible();
    // Esc in the panel lets go of the panel, not of the conversation.
    await panel.getByRole('searchbox').focus();
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await expect(answer(page)).toBeVisible();
  });

  test('the box on a tool\'s page asks about the page: the conversation opens with the view beside it, searched as it was', async ({ page, api }) => {
    api.menu = [menuRow];
    await open(page, `/tools/telefonbok.directory?input=${encodeURIComponent(JSON.stringify({ query: 'lärare' }))}`);
    await expect(page.getByText('Fråga om Telefonbok …')).toBeVisible();
    await composer(page).fill('Vem är på plats?');
    await composer(page).press('Enter');
    await expect(answer(page)).toBeVisible();
    await expect(page).toHaveURL(/\/conversations\/[^/?]+\?open=telefonbok\.directory&open-title=Telefonbok&open-input=/);
    const panel = page.getByRole('complementary', { name: 'Telefonbok' });
    await expect(panel.getByRole('searchbox')).toHaveValue('lärare');
    await expect(composer(page)).toBeFocused();
    expect(api.asked.at(-1)?.chips?.map(c => c.ref)).toEqual(['capability:telefonbok.directory']);
    await expectNoAxeViolations(page);
    // "Öppna som sida" is the way back to the view at full width; "Stäng samtalet" leads to the page it was asked on.
    await page.getByRole('button', { name: 'Stäng samtalet' }).click();
    await expect(page).toHaveURL(/\/tools\/telefonbok\.directory\?input=/);
    await expect(page.getByRole('heading', { level: 1, name: 'Telefonbok' })).toBeVisible();
  });
});

test.describe('asking from a page on a narrower screen', () => {
  test.use({ viewport: desktop });

  test('the conversation opens alone: nothing is laid over the transcript, and the view went along as a chip', async ({ page, api }) => {
    api.menu = [menuRow];
    await open(page, '/tools/telefonbok.directory');
    await composer(page).fill('Vem är på plats?');
    await composer(page).press('Enter');
    await expect(answer(page)).toBeVisible();
    await expect(page).toHaveURL(/\/conversations\/[^/?]+$/);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(api.asked.at(-1)?.chips?.map(c => c.ref)).toEqual(['capability:telefonbok.directory']);
  });

  test('a question on the landing after a closed conversation starts a new one', async ({ page, api }) => {
    await open(page, '/');
    await composer(page).fill('Vem är på plats?');
    await composer(page).press('Enter');
    await expect(answer(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(answer(page)).toBeHidden();
    await composer(page).fill('Vem är på plats?');
    await composer(page).press('Enter');
    await expect(answer(page).first()).toBeVisible();
    // Neither question named a conversation to continue (the mock answers both under one id, so both turns are drawn).
    expect(api.asked.map(a => a.conversationId ?? null)).toEqual([null, null]);
  });
});
