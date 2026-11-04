import { answer, composer, desktop, expect, heading, open, openNav, phone, test } from './support';

test.use({ viewport: desktop });

test.describe('2.4.2 page titled', () => {
  const titles = [
    ['/', 'Behöver dig · Startsidan'],
    ['/omrade/personal', 'Personal · Startsidan'],
    ['/hanterat', 'Redan hanterat · Startsidan'],
    ['/kalender', 'Vecka 45 · Kalender · Startsidan'],
    ['/vy/heroma.whoIsOn?titel=Bemanning', 'Bemanning · Startsidan'],
  ] as const;
  for (const [path, title] of titles) test(`${path} has its own title`, async ({ page, api: _ }) => {
    await open(page, path);
    await expect(page).toHaveTitle(title);
  });
  test('the title follows the week', async ({ page, api: _ }) => {
    await open(page, '/kalender');
    await page.getByRole('button', { name: 'Nästa vecka' }).click();
    await expect(page).toHaveTitle('Vecka 46 · Kalender · Startsidan');
  });
});

test.describe('1.3.1 and 2.4.6 structure', () => {
  for (const path of ['/', '/omrade/personal', '/hanterat', '/kalender']) test(`${path} has one h1, one main and a top navigation`, async ({ page, api: _ }) => {
    await open(page, path);
    await expect(page.locator('h1:not([aria-level]), [aria-level="1"]')).toHaveCount(1);
    await expect(page.getByRole('main')).toHaveCount(1);
    await expect(page.getByRole('navigation', { name: 'Övre navigering' })).toHaveCount(1);
  });

  test('the areas are one navigation landmark, in the drawer on a phone', async ({ page, api: _ }) => {
    await open(page, '/');
    await expect(page.getByRole('navigation', { name: 'Sidonavigering' })).toHaveCount(1);
    await expect(page.getByRole('navigation', { name: 'Sidonavigering' }).getByRole('link', { name: /^Personal/ })).toBeVisible();
    await page.setViewportSize(phone);
    await expect(page.getByRole('navigation', { name: 'Sidonavigering' })).toHaveCount(0);
    const nav = await openNav(page);
    await expect(nav).toHaveCount(1);
    await expect(nav.getByRole('link', { name: /^Personal/ })).toBeVisible();
  });

  test('the open card is a heading, a row is a button that says it is collapsed, the log groups its days', async ({ page, api: _ }) => {
    await open(page, '/');
    await expect(heading(page, 1, 'God morgon')).toBeVisible();
    await expect(heading(page, 2, 'Nu · 1')).toBeVisible();
    await expect(heading(page, 3, 'Attestera 3 fakturor, 48 200 kr')).toBeVisible();
    const row = page.getByRole('listitem').filter({ has: page.getByRole('button', { name: 'Omtankesamtal med Anna Lindqvist', exact: true }) });
    await expect(row.getByRole('button', { name: 'Omtankesamtal med Anna Lindqvist', exact: true })).toHaveAttribute('aria-expanded', 'false');
    await open(page, '/hanterat');
    await expect(heading(page, 1, 'Redan hanterat')).toBeVisible();
    await page.getByRole('radio', { name: 'Veckan' }).click();
    await expect(page.getByRole('list', { name: /november/ }).first()).toBeVisible();
  });

  test('sections have distinct names', async ({ page, api: _ }) => {
    await open(page, '/');
    const names = await page.locator('section[aria-label]').evaluateAll(list => list.map(el => el.getAttribute('aria-label')));
    expect(new Set(names).size).toBe(names.length);
  });

  test('the calendar names its days as headings', async ({ page, api: _ }) => {
    await open(page, '/kalender');
    await expect(heading(page, 2, 'ons 4 nov')).toBeVisible();
  });

  test('the side panel has a heading', async ({ page, api: _ }) => {
    await open(page, '/vy/heroma.whoIsOn?titel=Bemanning');
    await expect(page.getByRole('dialog').getByRole('heading', { name: 'Bemanning' })).toBeVisible();
  });
});

test.describe('3.1.2 language of parts', () => {
  test('the conversation names its speakers in Swedish', async ({ page, api: _ }) => {
    await open(page, '/');
    const input = composer(page);
    await input.fill('Vem är på plats?');
    await input.press('Enter');
    await expect(answer(page)).toBeVisible();
    await expect(page.getByRole('article', { name: 'Du', exact: true })).toBeVisible();
    await expect(page.getByRole('article', { name: 'Assistenten', exact: true })).toBeVisible();
  });

  test('the keyboard shortcut is spoken in Swedish', async ({ page, api: _ }) => {
    await open(page, '/');
    await expect(page.getByRole('img', { name: 'Kontroll + K' })).toBeVisible();
  });

  test('the side panel shows Swedish labels and readable values', async ({ page, api: _ }) => {
    await open(page, '/vy/heroma.whoIsOn?titel=Bemanning');
    const panel = page.getByRole('dialog');
    await expect(panel).toBeVisible();
    await expect(panel.getByText('I tjänst', { exact: true })).toBeVisible();
    await expect(panel.getByText('Frånvarande', { exact: true })).toBeVisible();
    await expect(panel.getByText('Sara Nyström · sjuk', { exact: true })).toBeVisible();
    await expect(panel).not.toContainText('onDuty');
    await expect(panel).not.toContainText('{');
  });
});

test.describe('D30 the obligation', () => {
  test('the card carries its steps, its judgement calls and its day loads with names', async ({ page, api: _ }) => {
    await open(page, '/');
    const card = page.locator('#thread-samtal');
    await expect(card.getByRole('list', { name: 'Steg' })).toBeVisible();
    await expect(card.getByRole('list', { name: 'Steg' }).getByRole('listitem')).toHaveCount(4);
    await expect(card.getByRole('group', { name: 'Oplacerade: 1' })).toContainText('Sara Holm · upptagen hela veckan');
    // The week agenda with its day loads is the phone's calendar page; a laptop gets the event calendar (D27).
    await page.setViewportSize(phone);
    await open(page, '/kalender');
    await expect(page.getByRole('progressbar', { name: /^Belastning ons 4 nov/ })).toBeVisible();
  });
  test('the waiting obligation shows the sum and lets the manager remind from the keyboard', async ({ page, api: _ }) => {
    await open(page, '/pagar');
    const card = page.locator('#thread-samtal-svar');
    await expect(card.getByRole('region', { name: 'Svar' })).toContainText('1 av 2 har svarat.');
    await expect(card.getByRole('progressbar', { name: 'Svar: 1 av 2' })).toBeVisible();
    await expect(card.getByRole('list', { name: 'Väntar: 1' })).toContainText('påmind en gång');
    const remind = card.getByRole('button', { name: 'Påminn de 1 nu' });
    await remind.focus();
    await page.keyboard.press('Enter');
    await expect(card.getByRole('list', { name: 'Väntar: 1' })).toContainText('påmind 2 gånger');
  });
});
