import { announcements, composer, desktop, expect, open, snoozeFirst, test } from './support';

test.use({ viewport: desktop });

test.describe('4.1.3 status messages', () => {
  test('a week change is spoken', async ({ page, api: _ }) => {
    await open(page, '/calendar');
    await page.getByRole('button', { name: 'Nästa vecka' }).click();
    await expect.poll(() => announcements(page)).toContainEqual(expect.stringContaining('Vecka 46'));
  });

  test('the first answer in a conversation is spoken', async ({ page, api }) => {
    await open(page, '/');
    api.answerDelay = 150;
    const input = composer(page);
    await input.fill('Vem är på plats?');
    await input.press('Enter');
    await expect.poll(() => announcements(page)).toContainEqual(expect.stringContaining('Söker svar'));
    await expect
      .poll(() => announcements(page))
      .toContainEqual(expect.stringContaining('Tio personer är på plats i dag.'));
  });

  test('moving between pages is spoken, and so is the area Mina aktiviteter is narrowed to', async ({
    page,
    api: _,
  }) => {
    await open(page, '/');
    const pages = page.getByRole('navigation', { name: 'Start', exact: true });
    // Clew's own pages in the header move inside the app without a page load (D115 item 3), so the change is said:
    // the calendar says the week it shows.
    await pages.getByRole('link', { name: 'Kalender' }).click();
    await expect.poll(() => announcements(page)).toContainEqual(expect.stringContaining('Vecka 45'));
    // The header's way to Hem loads the page, which a screen reader reads by itself; the step back does not load one.
    await page.goBack();
    await expect.poll(() => announcements(page)).toContainEqual(expect.stringContaining('Hem'));
    // The area filter stands with the tabs on Mina aktiviteter (D115 item 4), a page of its own that is said too.
    await pages.getByRole('link', { name: 'Mina aktiviteter' }).click();
    await expect(page).toHaveURL(/\/activities$/);
    await expect.poll(() => announcements(page)).toContainEqual(expect.stringContaining('Mina aktiviteter'));
    await page.getByRole('button', { name: 'Alla områden' }).click();
    await page.getByRole('menuitemradio', { name: 'Personal' }).click();
    await expect(page).toHaveURL(/\/activities\?area=personal$/);
    await expect.poll(() => announcements(page)).toContainEqual(expect.stringContaining('Visar området Personal'));
  });

  test('a card leaving the stream is spoken with its way back', async ({ page, api: _ }) => {
    await open(page, '/');
    await snoozeFirst(page);
    await expect
      .poll(() => announcements(page))
      .toContainEqual(expect.stringContaining('Jag påminner dig i morgon 06:00.'));
  });
});
