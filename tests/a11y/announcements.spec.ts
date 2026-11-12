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

  test('moving between pages is spoken, and so is the system Att göra is narrowed to', async ({ page, api: _ }) => {
    await open(page, '/calendar');
    await page.getByRole('navigation', { name: 'Sidonavigering' }).getByRole('link', { name: /^Hem/ }).click();
    await expect.poll(() => announcements(page)).toContainEqual(expect.stringContaining('Hem'));
    await page
      .getByRole('navigation', { name: 'Sidonavigering' })
      .getByRole('link', { name: /^Att göra/ })
      .click();
    await expect.poll(() => announcements(page)).toContainEqual(expect.stringContaining('Att göra'));
    await page.getByRole('button', { name: 'Alla system' }).click();
    await page.getByRole('menuitemradio', { name: 'Personal' }).click();
    await expect(page).toHaveURL(/\/todo\?area=personal$/);
    await expect.poll(() => announcements(page)).toContainEqual(expect.stringContaining('Visar Personal'));
  });

  test('a card leaving the stream is spoken with its way back', async ({ page, api: _ }) => {
    await open(page, '/');
    await snoozeFirst(page);
    await expect
      .poll(() => announcements(page))
      .toContainEqual(expect.stringContaining('Jag påminner dig i morgon 06:00.'));
  });

  test('a system that does not answer is said once in the session, politely, from whichever page first shows it', async ({
    page,
    api,
  }) => {
    // Nothing on the page announces itself any more (D116, amended 2026-11-12: no banner), so the first time a system is
    // seen silent it is said once: "<system> svarar inte".
    api.sources = [{ connector: 'hr', state: 'idle', lastSuccess: '2026-11-04T05:00:00.000Z', error: 'unavailable' }];
    const said = async () => (await announcements(page)).filter(text => text.includes('svarar inte'));
    await open(page, '/');
    await expect.poll(said).toEqual(['Personalsystemet svarar inte']);
    const rail = page.getByRole('navigation', { name: 'Sidonavigering' });
    await rail.getByRole('link', { name: /^Att göra/ }).click();
    await expect(page).toHaveURL('/todo');
    await rail.getByRole('link', { name: 'Kalender', exact: true }).click();
    await expect(page).toHaveURL(/\/calendar/);
    await rail.getByRole('link', { name: /^Hem/ }).click();
    await expect(page).toHaveURL('/');
    expect(await said()).toEqual(['Personalsystemet svarar inte']);
  });
});
