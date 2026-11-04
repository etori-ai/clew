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

test.describe('D26 questions answered from documents', () => {
  test('the answer is numbered steps with citations that open the document, its source is named under it, and the follow-ups are a group', async ({ page, api: _ }) => {
    await open(page, '/');
    const input = composer(page);
    await input.fill('Brukaren har ramlat, vad gör jag?');
    await input.press('Enter');
    const bubble = page.locator('.astryx-chat-message-bubble').filter({ hasText: 'Lyft inte själv' });
    await expect(bubble).toBeVisible();
    await expect(bubble.getByRole('list').first().getByRole('listitem')).toHaveCount(3);
    await expect(bubble.getByRole('link').first()).toHaveAttribute('href', /intra\.example/);
    await expect(bubble.getByText('MAS', { exact: true })).toBeVisible();
    await expect(bubble.getByText('12 mars 2026', { exact: true })).toBeVisible();
    await expect(bubble.getByRole('button', { name: 'Visa källor' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Följdfrågor' }).getByRole('button', { name: 'Och om hen slagit i huvudet?' })).toBeVisible();
    // "Gör till ett kort" proposes; the answer executes nothing. What happened is said in the transcript.
    await bubble.getByRole('button', { name: 'Gör till ett kort' }).click();
    await expect(page.getByText(/^Klart\. Kortet "Ny rutin för läkemedelshantering" ligger under Behöver dig/)).toBeVisible();
  });
  test('the sources view numbers its rows, names owner and review date, warns about a stale one and says which source did not answer', async ({ page, api: _ }) => {
    await open(page, '/vy/startsidan.search?titel=K%C3%A4llor&input=%7B%22query%22%3A%22fall%22%7D');
    const panel = page.getByRole('dialog');
    await expect(panel.getByRole('heading', { name: 'Källor' })).toBeVisible();
    const rows = panel.getByRole('list', { name: 'Källor' }).getByRole('listitem');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText('Rutin vid fall i ordinärt boende · Vid fall');
    await expect(rows.nth(0)).toContainText('MAS · granskad 12 mars 2026 · Intranätet');
    await expect(rows.nth(0).getByRole('link', { name: 'Öppna' })).toHaveAttribute('target', '_blank');
    await expect(rows.nth(0).getByRole('button', { name: 'Lägg till i samtalet' })).toBeVisible();
    await expect(rows.nth(2)).toContainText('Granskad för 2 år sedan');
    await expect(rows.nth(2).getByRole('link', { name: 'Öppna' })).toHaveCount(0);
    await expect(panel.getByText(/^SharePoint svarade inte\./)).toBeVisible();
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
    // The phone's calendar week is FullCalendar's list with a heading per day (D32); the day loads live on the card.
    await page.setViewportSize(phone);
    await open(page, '/kalender');
    await expect(heading(page, 2, 'ons 4 nov')).toBeVisible();
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
