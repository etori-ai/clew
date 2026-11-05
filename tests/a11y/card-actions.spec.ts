import type { Locator } from '@playwright/test';
import { NEXT_WEEK } from './data';
import { composer, desktop, expect, open, phone, test } from './support';

/** What a person cannot read because it is cut off with an ellipsis. */
const cutOff = (root: Locator) => root.evaluate(element => [...element.querySelectorAll('*')]
  .filter(e => getComputedStyle(e).textOverflow === 'ellipsis' && e.clientWidth > 0 && e.scrollWidth > e.clientWidth + 1)
  .map(e => (e as HTMLElement).innerText));

test.describe('a row shows the next step and keeps the rest behind Fler val', () => {
  test.use({ viewport: desktop });

  test('the keyboard reaches every action a row tucks away, the two time pickers included', async ({ page, api: _ }) => {
    await open(page, '/overview');
    const row = page.locator('#thread-omtanke');
    await expect(row.getByRole('button', { name: 'Boka samtalet' })).toBeVisible();
    await expect(row.getByRole('button', { name: 'Se mönstret' })).toHaveCount(0);
    await expect(row.getByRole('button', { name: 'Inte nu', exact: true })).toHaveCount(0);
    await row.getByRole('button', { name: 'Fler val' }).focus();
    await page.keyboard.press('Enter');
    for (const name of ['Se mönstret', 'Lägg till i samtalet', 'Avfärda · inte aktuellt', 'Varför ser jag detta?']) await expect(page.getByRole('menuitem', { name })).toBeVisible();
    await page.getByRole('menuitem', { name: 'Påminn mig' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('menuitem', { name: /^I morgon/ })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menuitem', { name: 'Påminn mig' })).toHaveCount(0);
    await expect(row.getByRole('button', { name: 'Fler val' })).toBeFocused();
  });

  test('the card keeps Inte nu in view, and Påminn mig opens from Fler val', async ({ page, api: _ }) => {
    await open(page, '/overview');
    const card = page.getByRole('article', { name: 'Kort: Attestera 3 fakturor, 48 200 kr' });
    await expect(card.getByRole('button', { name: 'Inte nu', exact: true })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Påminn mig' })).toHaveCount(0);
    await card.getByRole('button', { name: 'Fler val' }).click();
    await page.getByRole('menuitem', { name: 'Påminn mig' }).click();
    await expect(page.getByRole('menuitem', { name: 'Om 10 sekunder' })).toBeVisible();
  });

  test('Skriv själv opens its dialog from the sub-menu and the focus lands in the field', async ({ page, api: _ }) => {
    await open(page, '/overview');
    await page.locator('#thread-omtanke').getByRole('button', { name: 'Fler val' }).click();
    await page.getByRole('menuitem', { name: 'Inte nu' }).click();
    await page.getByRole('menuitem', { name: /^Skriv själv/ }).click();
    const dialog = page.getByRole('dialog', { name: 'När ska jag ta upp det igen?' });
    await expect(dialog.getByRole('textbox', { name: 'När?' })).toBeVisible();
    await expect.poll(() => dialog.evaluate(d => d.contains(document.activeElement))).toBe(true);
  });

  test('a card put in the box says so in the menu and on its line', async ({ page, api: _ }) => {
    await open(page, '/overview');
    const row = page.locator('#thread-omtanke');
    await row.getByRole('button', { name: 'Fler val' }).click();
    await page.getByRole('menuitem', { name: 'Lägg till i samtalet' }).click();
    await expect(row).toContainText('I samtalet');
    await expect(composer(page)).toBeVisible();
    await row.getByRole('button', { name: 'Fler val' }).click();
    await expect(page.getByRole('menuitem', { name: 'I samtalet' })).toHaveAttribute('aria-disabled', 'true');
  });
});

test.describe('the page says one thing at a time', () => {
  test.use({ viewport: desktop });

  test('the one filled button on the overview is what is due today', async ({ page, api: _ }) => {
    await open(page, '/overview');
    // Filled means opaque and dark: black in Neutral, the profile's own colour under a municipal one. A secondary button is a translucent tint.
    const filled = await page.getByRole('main').evaluate(main => [...main.querySelectorAll('button')].filter(button => {
      const [r = 255, g = 255, b = 255, a = 1] = (getComputedStyle(button).backgroundColor.match(/[\d.]+/g) ?? []).map(Number);
      return button.checkVisibility() && a > 0.9 && r + g + b < 450;
    }).map(button => button.textContent?.trim()));
    // The box's send button is an icon with no text, and rests dimmed until something is written.
    expect(filled.filter(Boolean)).toEqual(['Attestera · 2']);
  });

  test('how often the assistant interrupts is one press away, from the keyboard too', async ({ page, api: _ }) => {
    await open(page, '/overview');
    await page.getByRole('button', { name: 'Så här hör jag av mig' }).focus();
    await expect(page.getByRole('tooltip')).toContainText('Jag stör högst');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('tooltip')).toHaveCount(0);
  });
});

test.describe('a phone', () => {
  test.use({ viewport: phone });

  test('the day\'s work comes before the figures', async ({ page, api: _ }) => {
    await open(page, '/overview');
    const work = await page.getByRole('heading', { name: 'Nu · 1' }).boundingBox();
    const figures = await page.getByRole('heading', { name: /^Läget/ }).boundingBox();
    expect(work!.y).toBeLessThan(figures!.y);
  });

  test('Påminn mig opens from Fler val and shows its rows', async ({ page, api: _ }) => {
    await open(page, '/overview');
    await page.getByRole('article', { name: 'Kort: Attestera 3 fakturor, 48 200 kr' }).getByRole('button', { name: 'Fler val' }).click();
    await page.getByRole('menuitem', { name: 'Påminn mig' }).click();
    await expect(page.getByRole('menuitem', { name: 'Om 10 sekunder' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /^Skriv själv/ })).toBeVisible();
  });
});

test.describe('the side panel', () => {
  test.use({ viewport: desktop });

  test('a plain read says where it comes from and writes a date as a date', async ({ page, api }) => {
    api.output = { date: '2026-11-04', onDuty: 'Anna Lindqvist' };
    await open(page, '/views/heroma.staffing?title=Bemanning');
    const panel = page.getByRole('dialog', { name: 'Bemanning' });
    await expect(panel).toContainText('4 november 2026');
    await expect(panel).toContainText('Hämtat ur Heroma. Inget av det sparas på Startsidan.');
  });
});

test.describe('Redan hanterat', () => {
  test.use({ viewport: desktop });

  test('when and what are two choices, and the times stand under each other', async ({ page, api: _ }) => {
    await open(page, '/handled');
    await expect(page.getByRole('radiogroup', { name: 'Tid' }).getByRole('radio', { name: 'I dag' })).toBeChecked();
    await page.getByRole('radiogroup', { name: 'Typ' }).getByRole('radio', { name: 'Frågor' }).click();
    const region = page.getByRole('region', { name: 'Redan hanterat' });
    await expect(region).toContainText('Fråga: Vem är på plats i dag?');
    await expect(region).not.toContainText('Attesterade fakturor');
  });
});

test.describe('a booking', () => {
  test.use({ viewport: desktop });

  test('says what is missing while Boka is greyed', async ({ page, api: _ }) => {
    await open(page, '/calendar');
    await page.getByRole('button', { name: 'Ny bokning' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Skriv en rubrik så går det att boka.');
    await expect(dialog.getByRole('button', { name: 'Boka' })).toBeDisabled();
    await dialog.getByRole('textbox').first().fill('Möte');
    await expect(dialog).not.toContainText('Skriv en rubrik så går det att boka.');
    await expect(dialog.getByRole('button', { name: 'Boka' })).toBeEnabled();
  });
});

test.describe('the calendar on a phone', () => {
  test.use({ viewport: phone });

  test('leaves the screen to the calendar: the grid starts in the top third', async ({ page, api: _ }) => {
    await open(page, '/calendar');
    const list = await page.getByRole('group', { name: /^Vecka 45/ }).boundingBox();
    expect(list!.y).toBeLessThan(200);
  });
});

test.describe('nothing is cut off', () => {
  for (const width of [1024, 768]) test(`a row and a card keep their words beside the rail at ${width} px`, async ({ page, api: _ }) => {
    await page.setViewportSize({ width, height: 900 });
    await open(page, '/overview');
    await expect(page.locator('#thread-omtanke').getByRole('button', { name: 'Omtankesamtal med Anna Lindqvist' })).toBeVisible();
    expect(await cutOff(page.getByRole('main'))).toEqual([]);
  });

  test('the action on an administration page keeps its whole label beside a long lead', async ({ page, api }) => {
    await page.setViewportSize(desktop);
    api.admin = true;
    await open(page, '/admin/connectors');
    expect(await cutOff(page.getByRole('main'))).toEqual([]);
    await page.getByRole('button', { name: 'Anslut system' }).click();
    expect(await cutOff(page.getByRole('dialog'))).toEqual([]);
  });

  test('what the box suggests on a phone keeps its whole title', async ({ page, api: _ }) => {
    await page.setViewportSize(phone);
    await open(page, '/');
    await composer(page).fill('attestera');
    await expect(page.getByText('Menar du')).toBeVisible();
    expect(await cutOff(page.getByRole('main'))).toEqual([]);
  });

  test('a proposal in a week says who it is on a line of its own', async ({ page, api: _ }) => {
    await page.setViewportSize(desktop);
    await open(page, `/calendar?date=${NEXT_WEEK}`);
    const block = page.locator('.clew-cal-event-proposal').first();
    await expect(block).toContainText('Anna');
    const words = await block.evaluate(element => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT), found: string[] = [];
      for (let node = walker.nextNode(); node; node = walker.nextNode()) for (const word of node.textContent!.matchAll(/\S+/g)) {
        const range = document.createRange();
        range.setStart(node, word.index); range.setEnd(node, word.index + word[0].length);
        if (new Set([...range.getClientRects()].map(rect => Math.round(rect.top))).size > 1) found.push(word[0]);
      }
      return found;
    });
    expect(words).toEqual([]);
  });
});
