import type { Page } from '@playwright/test';
import {
  announcements,
  composer,
  desktop,
  expect,
  expectNoAxeViolations,
  narrow,
  open,
  reflowProblems,
  test,
} from './support';
import { hrAssistant } from './data';
import { savedBranding } from './branding-fixtures';

/**
 * Ny fråga (D126 item 14, board NyFraga variant b): a page of its own at `/conversations/new` when the address names
 * nothing to ask about, not Hem. The installation's mark when one is saved, the greeting as the page's one level-1
 * heading, "Vad vill du ha hjälp med?" and the box with the focus; under it "Fortsätt", the person's latest
 * conversations, and "Fråga någon annan", the other systems' assistants, each only when it has something to list. The
 * rail marks Ny fråga; the first question continues on the conversation's own address, and Back leads to where the
 * person was. Keyboard, focus, announcements, axe and reflow at 320 px.
 */
const rail = (page: Page) => page.getByRole('navigation', { name: 'Sidonavigering' });
const greeting = /^God (morgon|förmiddag|eftermiddag|kväll), Testa$/;
const recipient = (page: Page, name: string) => page.getByRole('button', { name: `Till: ${name}`, exact: true });
const others = (page: Page) => page.getByRole('region', { name: 'Fråga någon annan' });
const latest = (page: Page) => page.getByRole('region', { name: 'Fortsätt' });

test.describe('Ny fråga is a page of its own', () => {
  test.use({ viewport: desktop });

  test('the rail leads to a clean page, marked as current, with the greeting and the box focused; Hem is another place', async ({
    page,
    api: _,
  }) => {
    await open(page, '/todo');
    await rail(page).getByRole('link', { name: 'Ny fråga', exact: true }).click();
    await expect(page).toHaveURL('/conversations/new');
    await expect(page).toHaveTitle('Ny fråga · Startsidan');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(greeting);
    await expect(page.getByText('Vad vill du ha hjälp med?', { exact: true })).toBeVisible();
    await expect(composer(page)).toBeFocused();
    await expect(rail(page).getByRole('link', { name: 'Ny fråga', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(rail(page).getByRole('link', { name: 'Hem', exact: true })).not.toHaveAttribute(
      'aria-current',
      'page',
    );
    // Nothing of Hem's: no blocks, no day line; the page's column is named in Swedish.
    await expect(page.getByRole('region', { name: 'Behöver dig' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'I dag' })).toHaveCount(0);
    await expect(page.getByRole('main').getByRole('region', { name: 'Content' })).toHaveCount(0);
    await expectNoAxeViolations(page);
    // Back leads to where the person was.
    await page.goBack();
    await expect(page).toHaveURL('/todo');
  });

  test('the first question continues on the conversation’s own address, in its place, with the box still focused', async ({
    page,
    api,
  }) => {
    await open(page, '/todo');
    await rail(page).getByRole('link', { name: 'Ny fråga', exact: true }).click();
    await composer(page).fill('Vem är på plats i dag?');
    await composer(page).press('Enter');
    await expect(page).toHaveURL(/\/conversations\/(?!new)[^/?]+$/);
    await expect(page.getByRole('log')).toContainText('Vem är på plats i dag?');
    await expect(composer(page)).toBeFocused();
    expect(api.asked.at(-1)?.text).toBe('Vem är på plats i dag?');
    // The new conversation's address took Ny fråga's place: one step back is where the person was.
    await page.goBack();
    await expect(page).toHaveURL('/todo');
  });

  test('the installation’s mark stands over the greeting when a logo is saved, with no name of its own', async ({
    page,
    api,
  }) => {
    Object.assign(api, savedBranding('sundsvall'));
    await open(page, '/conversations/new');
    const mark = page.getByRole('main').locator('img');
    await expect(mark).toBeVisible();
    await expect(mark).toHaveAttribute('alt', '');
  });

  test('without a saved logo there is no mark', async ({ page, api: _ }) => {
    await open(page, '/conversations/new');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(greeting);
    await expect(page.getByRole('main').locator('img')).toHaveCount(0);
  });

  test('an address that names a thing keeps its own "Fråga om …" page with the pane', async ({ page, api: _ }) => {
    await open(page, '/conversations/new?card=omtanke');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Fråga om Omtankesamtal med Anna Lindqvist' }),
    ).toBeVisible();
    await expect(page.getByRole('complementary', { name: 'Omtankesamtal med Anna Lindqvist' })).toBeVisible();
    await expect(rail(page).getByRole('link', { name: 'Ny fråga', exact: true })).not.toHaveAttribute(
      'aria-current',
      'page',
    );
  });
});

test.describe('what stands under the box', () => {
  test.use({ viewport: desktop });

  test('Fortsätt lists the latest conversations as links with when they were last active, and Alla samtal', async ({
    page,
    api: _,
  }) => {
    await open(page, '/conversations/new');
    await expect(latest(page).getByRole('heading', { level: 2, name: 'Fortsätt' })).toBeVisible();
    await expect(latest(page).getByRole('link', { name: 'Alla samtal' })).toHaveAttribute('href', '/conversations');
    const asked = latest(page).getByRole('link', { name: 'Vem är på plats i dag?' });
    await expect(asked).toHaveAttribute('href', '/conversations/fraga');
    await asked.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL('/conversations/fraga');
  });

  test('with no conversation and no other assistant nothing stands under the box', async ({ page, api }) => {
    api.threads = api.threads.filter(t => t.kind !== 'question');
    api.handoverAssistants = [];
    await open(page, '/conversations/new');
    await expect(composer(page)).toBeFocused();
    await expect(latest(page)).toHaveCount(0);
    await expect(others(page)).toHaveCount(0);
    await expect(recipient(page, 'Clew')).toHaveCount(0);
  });

  test('Fråga någon annan: an assistant’s row is a link that opens a conversation with its panel, and sends nothing', async ({
    page,
    api,
  }) => {
    api.handoverAssistants = [hrAssistant];
    await open(page, '/conversations/new');
    await expect(others(page).getByRole('heading', { level: 2, name: 'Fråga någon annan' })).toBeVisible();
    // The box above only ever goes to Clew: it has no recipient menu.
    await expect(recipient(page, 'Clew')).toHaveCount(0);
    const row = others(page).getByRole('link', { name: 'HR-assistenten', exact: true });
    await expect(others(page)).toContainText('Kunskapsbanken · Svarar på frågor om anställning och ledighet.');
    await expectNoAxeViolations(page);
    await row.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/conversations\/new\?assistant=kunskap%3Ahr$/);
    await expect(page.getByRole('textbox', { name: 'Skriv till HR-assistenten i Kunskapsbanken' })).toBeFocused();
    expect(api.asked).toHaveLength(0);
  });

  test('Visa alla shows the rest of the assistants in place, and is offered only when there are more than three', async ({
    page,
    api,
  }) => {
    api.handoverAssistants = [hrAssistant];
    await open(page, '/conversations/new');
    await expect(others(page).getByRole('button', { name: 'Visa alla' })).toHaveCount(0);
    api.handoverAssistants = [
      hrAssistant,
      ...Array.from({ length: 4 }, (_, i) => ({
        id: `kunskap:a${i}`,
        name: `Assistent ${i + 1}`,
        source: 'Kunskapsbanken',
      })),
    ];
    await page.reload();
    await expect(others(page).getByRole('listitem')).toHaveCount(3);
    await others(page).getByRole('button', { name: 'Visa alla' }).click();
    await expect(others(page).getByRole('listitem')).toHaveCount(5);
    await expect(others(page).getByRole('button', { name: 'Visa alla' })).toHaveCount(0);
    await expect(page).toHaveURL('/conversations/new');
    await expectNoAxeViolations(page);
  });
});

test.describe('Ny fråga at 320 px', () => {
  test.use({ viewport: narrow });

  test('reflows without sideways scrolling, both blocks under the box', async ({ page, api }) => {
    api.handoverAssistants = [hrAssistant];
    await open(page, '/conversations/new');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(greeting);
    await expect(latest(page)).toBeVisible();
    await expect(others(page)).toBeVisible();
    expect(await reflowProblems(page)).toEqual([]);
  });
});
