import type { Page } from '@playwright/test';
import { desktop, expect, expectNoAxeViolations, narrow, open, phone, reflowProblems, test } from './support';
import { menuRows } from './phonebook';

/**
 * The assistant beside every page (D130; canvas boards AskRegister, AskArende-empty and AskArende-more), on the first
 * page that has it, a register: the phone book's directory, a table, as a tool. The frame draws "Fråga assistenten" at the
 * end of the title's line; it opens the assistant's pane beside the page, in the address (`ask=1`), with the focus in its
 * box. The pane says what it is about and what asking here does, sends every question with the list's chip, as what
 * stands open and with the page's subject, and finds the conversation again after a reload. Back, Esc, ✕ and the button
 * close it. "Öppna som samtal" leads to the conversation's page, which marks it opened, and only then does the rail list
 * it. Below 1340 px the pane is a drawer, and on a phone the button leads to a conversation.
 */
const directory = '/tools/phonebook.directory';
const WIDE = { width: 1440, height: 900 };
/** The conversation the mock makes for the first question beside the directory: one per thing asked in place. */
const ASKED = 'om-capability-phonebook-directory';
const rail = (page: Page) => page.getByRole('navigation', { name: 'Sidonavigering' });
const button = (page: Page) => page.getByRole('main').getByRole('button', { name: 'Fråga assistenten' });
const pane = (page: Page) => page.getByRole('complementary', { name: 'Assistenten' });
const box = (page: Page) => page.getByRole('textbox', { name: 'Fråga om telefonbok' });
const ask = async (page: Page, question: string) => {
  await box(page).fill(question);
  await box(page).press('Enter');
};

test.describe('the assistant’s pane beside a register', () => {
  test.use({ viewport: WIDE });
  test.beforeEach(({ api }) => {
    api.menu = menuRows;
  });

  test('Fråga assistenten ends the title’s line and opens the pane beside the list, with the focus in its box, ask in the address and what asking here does in words', async ({
    page,
  }) => {
    await open(page, directory);
    const title = page.getByRole('heading', { level: 1, name: 'Telefonbok' });
    const ownBadge = page.getByRole('main').getByText('Telefonboken', { exact: true }).first();
    const toggle = button(page);
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    // At the end of the title's line: on the title's line, after the system's badge.
    const [t, b, s] = await Promise.all([title.boundingBox(), toggle.boundingBox(), ownBadge.boundingBox()]);
    expect(b!.y).toBeLessThan(t!.y + t!.height);
    expect(b!.y + b!.height).toBeGreaterThan(t!.y);
    expect(b!.x).toBeGreaterThan(s!.x + s!.width);
    await expect(page.getByRole('table')).toHaveCount(1);
    await toggle.click();
    await expect(page).toHaveURL(/\/tools\/phonebook\.directory\?ask=1$/);
    await expect(pane(page)).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(box(page)).toBeFocused();
    // Its heading and what it is about; "Öppna som samtal" and ✕ at the end of its line.
    await expect(pane(page).getByRole('heading', { level: 2, name: 'Assistenten' })).toBeVisible();
    await expect(pane(page).getByText('Om Telefonbok', { exact: true })).toBeVisible();
    await expect(pane(page).getByRole('link', { name: 'Öppna som samtal' })).toHaveCount(1);
    await expect(pane(page).getByRole('button', { name: 'Stäng' })).toBeVisible();
    // Before anything is asked: what asking here does and what opening it as a conversation adds (rule 10).
    await expect(pane(page).getByText('Fråga om telefonbok', { exact: true }).first()).toBeVisible();
    await expect(
      pane(page).getByText('Svaret visas här, bredvid sidan, och finns kvar när du kommer tillbaka.'),
    ).toBeVisible();
    await expect(pane(page).getByText(/^Öppnar du frågan som ett samtal får den hela sidan/)).toBeVisible();
    // The page stays, and draws its narrow layout while the pane takes its room: the table is its list (rule 11).
    await expect(title).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(0);
    await expect(page.getByRole('list', { name: 'Telefonboken' }).getByRole('listitem').first()).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expectNoAxeViolations(page);
  });

  test('a question goes with the list’s chip, as what stands open and with the page’s subject; the answer is drawn in the pane, and a reload keeps the pane and finds the conversation again', async ({
    page,
    api,
  }) => {
    await open(page, directory);
    await button(page).click();
    await ask(page, 'Vad väntar de på från mig?');
    await expect(pane(page).getByText('Tio personer är på plats i dag.')).toBeVisible();
    await expect(page).toHaveURL(/\/tools\/phonebook\.directory\?ask=1$/);
    const asked = api.asked.at(-1)!;
    expect(asked.chips).toEqual([{ ref: 'capability:phonebook.directory', kind: 'capability', label: 'Telefonbok' }]);
    expect(asked.beside).toBe('capability:phonebook.directory');
    expect(asked.own).toBe(true);
    expect(asked.page).toEqual({ subject: 'view:phonebook.directory', label: 'Om Telefonbok' });
    expect(asked.conversationId).toBeUndefined();
    // The introduction gives way to the conversation.
    await expect(
      pane(page).getByText('Svaret visas här, bredvid sidan, och finns kvar när du kommer tillbaka.'),
    ).toHaveCount(0);
    await expectNoAxeViolations(page);
    // A reload opens the pane again with the conversation in it, and moves no focus.
    await page.reload();
    await expect(pane(page).getByText('Vad väntar de på från mig?', { exact: true })).toBeVisible();
    await expect(pane(page).getByText('Tio personer är på plats i dag.')).toBeVisible();
    await expect(box(page)).not.toBeFocused();
    // The next question goes on in the same conversation.
    await ask(page, 'Och i morgon?');
    await expect(pane(page).getByText('Och i morgon?', { exact: true })).toBeVisible();
    expect(api.asked.at(-1)!.conversationId).toBe(ASKED);
  });

  test('Back closes the pane and Forward opens it again without moving the focus; Esc, ✕ and the button again close it and give the focus back to the button', async ({
    page,
  }) => {
    await open(page, directory);
    const toggle = button(page);
    await toggle.click();
    await expect(pane(page)).toBeVisible();
    await page.goBack();
    await expect(pane(page)).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`${directory.replace(/\./g, '\\.')}$`));
    await page.goForward();
    await expect(pane(page)).toBeVisible();
    await expect(box(page)).not.toBeFocused();
    // Esc in the box.
    await box(page).focus();
    await page.keyboard.press('Escape');
    await expect(pane(page)).toHaveCount(0);
    await expect(page).not.toHaveURL(/ask=1/);
    await expect(toggle).toBeFocused();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    // ✕.
    await toggle.click();
    await expect(box(page)).toBeFocused();
    await pane(page).getByRole('button', { name: 'Stäng' }).click();
    await expect(pane(page)).toHaveCount(0);
    await expect(toggle).toBeFocused();
    // The button again.
    await page.keyboard.press('Enter');
    await expect(pane(page)).toBeVisible();
    await expect(box(page)).toBeFocused();
    await toggle.click();
    await expect(pane(page)).toHaveCount(0);
    await expect(toggle).toBeFocused();
  });

  test('Öppna som samtal leads to the conversation’s page, which marks it opened, and only then is it among the rail’s latest', async ({
    page,
    api,
  }) => {
    await open(page, directory);
    await button(page).click();
    await ask(page, 'Vad väntar de på från mig?');
    await expect(pane(page).getByText('Tio personer är på plats i dag.')).toBeVisible();
    // The rail's latest, by the conversation's address: the mock gives its conversations one title.
    const inRail = rail(page)
      .getByRole('group', { name: 'Fråga assistenten' })
      .locator(`a[href="/conversations/${ASKED}"]`);
    await expect(inRail).toHaveCount(0);
    expect(api.opened).toEqual([]);
    await pane(page).getByRole('link', { name: 'Öppna som samtal' }).click();
    await expect(page).toHaveURL(new RegExp(`/conversations/${ASKED}$`));
    await expect(page.getByRole('main').getByText('Vad väntar de på från mig?', { exact: true }).first()).toBeVisible();
    await expect.poll(() => api.opened).toEqual([ASKED]);
    await expect(inRail).toHaveAttribute('aria-current', 'page');
    // Back on the list the conversation stays in the rail.
    await page.goBack();
    await expect(pane(page)).toBeVisible();
    await expect(inRail).toBeVisible();
  });

  test('an answer that needs room is one row in the pane, "Visa i samtalet", that leads to the conversation (rule 7)', async ({
    page,
  }) => {
    await open(page, directory);
    await button(page).click();
    await ask(page, 'Sök lärare i telefonboken');
    await expect(pane(page).getByText('Sök i telefonboken: 2 rader.')).toBeVisible();
    const row = pane(page).getByRole('link', { name: 'Visa i samtalet' });
    await expect(row).toHaveCount(1);
    await expect(pane(page).getByRole('table')).toHaveCount(0);
    await expectNoAxeViolations(page);
    await row.click();
    await expect(page).toHaveURL(new RegExp(`/conversations/${ASKED}`));
  });
});

test.describe('the assistant’s pane on smaller screens', () => {
  test.beforeEach(({ api }) => {
    api.menu = menuRows;
  });

  test('below 1340 px the pane is a drawer over the page; Esc closes it and the focus goes back to the button', async ({
    page,
  }) => {
    await page.setViewportSize(desktop);
    await open(page, directory);
    await button(page).click();
    const drawer = page.getByRole('dialog', { name: 'Assistenten' });
    await expect(drawer).toBeVisible();
    await expect(page).toHaveURL(/ask=1/);
    await expect(pane(page)).toHaveCount(0);
    await expect(drawer.getByRole('heading', { level: 2, name: 'Assistenten' })).toBeVisible();
    await expect(drawer.getByText('Om Telefonbok', { exact: true })).toBeVisible();
    await expect(drawer.getByRole('textbox', { name: 'Fråga om telefonbok' })).toBeFocused();
    await expectNoAxeViolations(page);
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await expect(page).not.toHaveURL(/ask=1/);
    await expect(button(page)).toBeFocused();
  });

  test('on a phone the button leads to a conversation about the list, and there is no pane', async ({ page }) => {
    await page.setViewportSize(phone);
    await open(page, directory);
    const toggle = button(page);
    await expect(toggle).toBeVisible();
    await expect(toggle).not.toHaveAttribute('aria-expanded');
    await toggle.click();
    await expect(page).toHaveURL(/\/conversations\/new$/);
    await expect(page.getByRole('complementary', { name: 'Assistenten' })).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: 'Assistenten' })).toHaveCount(0);
  });

  test('at 320 px the register with its button reflows with nothing cut', async ({ page }) => {
    await page.setViewportSize(narrow);
    await open(page, directory);
    await expect(button(page)).toBeVisible();
    expect(await reflowProblems(page)).toEqual([]);
  });

  test('without a model there is no button, and an address with the pane opens nothing', async ({ page, api }) => {
    api.modelChoices = 0;
    await page.setViewportSize(WIDE);
    await open(page, `${directory}?ask=1`);
    await expect(page.getByRole('heading', { level: 1, name: 'Telefonbok' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Fråga assistenten' })).toHaveCount(0);
    await expect(pane(page)).toHaveCount(0);
    await expect(page.getByRole('table')).toHaveCount(1);
  });
});
