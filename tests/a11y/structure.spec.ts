import { answer, composer, desktop, expect, heading, open, openAreas, openNav, phone, test } from './support';

test.use({ viewport: desktop });

test.describe('2.4.2 page titled', () => {
  const titles = [
    ['/', 'Vad vill du göra · Startsidan'],
    ['/oversikt', 'Hela bilden · Startsidan'],
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
  // No TopNav (the canvas's H1 and H4, the `shell-side-nav` template): the rail is the page's one navigation and carries the product and the person.
  for (const path of ['/', '/oversikt', '/omrade/personal', '/hanterat', '/kalender']) test(`${path} has one h1, one main and one rail`, async ({ page, api: _ }) => {
    await open(page, path);
    await expect(page.locator('h1:not([aria-level]), [aria-level="1"]')).toHaveCount(1);
    await expect(page.getByRole('main')).toHaveCount(1);
    await expect(page.getByRole('navigation')).toHaveCount(1);
    await expect(page.getByRole('navigation', { name: 'Sidonavigering' }).getByRole('link', { name: /Startsidan/ })).toBeVisible();
  });

  test('the rail is one navigation landmark with the areas as lenses, in the drawer on a phone', async ({ page, api: _ }) => {
    await open(page, '/');
    await expect(page.getByRole('navigation', { name: 'Sidonavigering' }).getByRole('link', { name: 'Ny fråga' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Sidonavigering' })).toHaveCount(1);
    await openAreas(page.getByRole('navigation', { name: 'Sidonavigering' }));
    await expect(page.getByRole('navigation', { name: 'Sidonavigering' }).getByRole('link', { name: /^Personal/ })).toBeVisible();
    await page.setViewportSize(phone);
    await expect(page.getByRole('navigation', { name: 'Sidonavigering' })).toHaveCount(0);
    const nav = await openNav(page);
    await expect(nav).toHaveCount(1);
    await openAreas(nav);
    await expect(nav.getByRole('link', { name: /^Personal/ })).toBeVisible();
  });

  test('the open card is a heading, a row is a button that says it is collapsed, the log groups its days', async ({ page, api: _ }) => {
    await open(page, '/oversikt');
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

  for (const path of ['/', '/oversikt']) test(`sections on ${path} have distinct names`, async ({ page, api: _ }) => {
    await open(page, path);
    const names = await page.locator('section[aria-label]').evaluateAll(list => list.map(el => el.getAttribute('aria-label')));
    expect(new Set(names).size).toBe(names.length);
  });

  test('the box is the page: the brief above it has at most three rows, each with its next step, and the chips are a group', async ({ page, api: _ }) => {
    await open(page, '/');
    await expect(heading(page, 1, 'Vad vill du göra?')).toBeVisible();
    const brief = page.getByRole('list', { name: 'Det som behöver dig' });
    await expect(brief.getByRole('listitem')).toHaveCount(3);
    // A card that needs a choice first gets "Granska", which opens it; never a button that starts disabled.
    await expect(brief.getByRole('link', { name: 'Granska 3' })).toHaveAttribute('href', '/oversikt?kort=fakturor');
    await expect(brief.getByRole('link', { name: 'Attestera 3 fakturor, 48 200 kr' })).toHaveAttribute('href', '/oversikt?kort=fakturor');
    await expect(page.getByRole('group', { name: 'Det du brukar göra' }).getByRole('button', { name: 'Budget mot prognos' })).toBeVisible();
    await page.getByRole('link', { name: 'Visa hela bilden' }).click();
    await expect(heading(page, 2, 'Nu · 1')).toBeVisible();
  });

  test('typing in the box offers what the router finds without the model, the open card first, and each row is a button', async ({ page, api: _ }) => {
    await open(page, '/');
    await composer(page).fill('attestera');
    const offers = page.getByRole('list', { name: 'Menar du' });
    await expect(offers.getByRole('listitem').first()).toContainText('Attestera 3 fakturor, 48 200 kr');
    await expect(offers.getByRole('button', { name: /Attestera fakturor/ })).toBeVisible();
    await offers.getByRole('button', { name: /Attestera 3 fakturor/ }).click();
    await expect(page).toHaveURL(/\/oversikt\?kort=fakturor$/);
  });

  test('a brief row puts its card in the box as a token, and @ with nothing typed offers only what the page shows', async ({ page, api: _ }) => {
    await open(page, '/');
    const brief = page.getByRole('list', { name: 'Det som behöver dig' });
    await brief.getByRole('button', { name: 'Lägg till i samtalet' }).first().click();
    await expect(brief.getByRole('button', { name: 'I samtalet', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: /Ta bort|Remove/ }).first()).toBeVisible();
    const titles = await brief.getByRole('listitem').getByRole('link').filter({ hasNotText: /^Granska/ }).allTextContents();
    await composer(page).pressSequentially('@');
    const menu = page.getByRole('listbox', { name: 'Objekt' });
    await expect(menu.getByRole('option').first()).toBeVisible();
    const offered = await menu.getByRole('option').allTextContents();
    expect(offered.some(o => o.includes(titles[0]!))).toBe(true);
    expect(offered.some(o => o.includes('Brandskyddsrond i oktober saknar protokoll'))).toBe(false);
  });

  test('the answer is the card: a question that names a card draws it in the turn, a heading under the conversation, with its rows and buttons', async ({ page, api: _ }) => {
    await open(page, '/');
    await composer(page).fill('attestera en faktura');
    await composer(page).press('Enter');
    const card = page.getByRole('article', { name: 'Tråd: Attestera 3 fakturor, 48 200 kr' });
    await expect(card).toBeVisible();
    // Under the conversation's h1 the card's title is a level-2 heading (Playwright's role level reads the tag, so the suite reads aria-level).
    await expect(heading(page, 2, 'Attestera 3 fakturor, 48 200 kr')).toBeVisible();
    await expect(card.getByRole('checkbox')).toHaveCount(3);
    await expect(card.getByRole('button', { name: 'Attestera · 2' })).toBeVisible();
    await expect(page.getByRole('article', { name: 'Assistenten', exact: true })).toContainText('saknar beställning');
  });

  test('the rail searches conversations and cards and opens what is picked', async ({ page, api: _ }) => {
    await open(page, '/');
    const search = page.getByRole('combobox', { name: 'Sök i samtal och kort' });
    await search.fill('fakturor');
    await page.getByRole('option', { name: /Attestera 3 fakturor/ }).click();
    await expect(page).toHaveURL(/\/oversikt\?kort=fakturor$/);
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

  // On the landing the box has no header and already holds the focus (G); where the box has a scope line, the shortcut sits in it.
  test('the keyboard shortcut is spoken in Swedish', async ({ page, api: _ }) => {
    await open(page, '/oversikt');
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
    await open(page, '/vy/clew.search?titel=K%C3%A4llor&input=%7B%22query%22%3A%22fall%22%7D');
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
    await open(page, '/oversikt');
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
