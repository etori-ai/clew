import { composer, desktop, expect, open, phone, test } from './support';

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
    const card = page.getByRole('article', { name: 'Tråd: Attestera 3 fakturor, 48 200 kr' });
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
    await page.getByRole('article', { name: 'Tråd: Attestera 3 fakturor, 48 200 kr' }).getByRole('button', { name: 'Fler val' }).click();
    await page.getByRole('menuitem', { name: 'Påminn mig' }).click();
    await expect(page.getByRole('menuitem', { name: 'Om 10 sekunder' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /^Skriv själv/ })).toBeVisible();
  });
});
