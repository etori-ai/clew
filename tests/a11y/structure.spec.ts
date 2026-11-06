import {
  answer,
  composer,
  desktop,
  expect,
  expectNoAxeViolations,
  heading,
  open,
  openNav,
  phone,
  test,
} from './support';

test.use({ viewport: desktop });

test.describe('2.4.2 page titled', () => {
  const titles = [
    ['/', 'Hem · Startsidan'],
    ['/?area=personal', 'Hem · Startsidan'],
    ['/?tab=done', 'Hem · Startsidan'],
    ['/calendar', 'Vecka 45 · Kalender · Startsidan'],
    ['/?open=hr.whoIsOn&open-title=Bemanning', 'Bemanning · Startsidan'],
  ] as const;
  for (const [path, title] of titles)
    test(`${path} has its own title`, async ({ page, api: _ }) => {
      await open(page, path);
      await expect(page).toHaveTitle(title);
    });
  test('the title follows the week', async ({ page, api: _ }) => {
    await open(page, '/calendar');
    await page.getByRole('button', { name: 'Nästa vecka' }).click();
    await expect(page).toHaveTitle('Vecka 46 · Kalender · Startsidan');
  });
});

test.describe('1.3.1 and 2.4.6 structure', () => {
  // No TopNav (the canvas's H1 and H4, the `shell-side-nav` template): the rail is the page's one navigation and carries the product and the person.
  for (const path of ['/', '/?area=personal', '/?tab=done', '/calendar'])
    test(`${path} has one h1, one main and one rail`, async ({ page, api: _ }) => {
      await open(page, path);
      await expect(page.locator('h1:not([aria-level]), [aria-level="1"]')).toHaveCount(1);
      await expect(page.getByRole('main')).toHaveCount(1);
      await expect(page.getByRole('navigation')).toHaveCount(1);
      await expect(
        page.getByRole('navigation', { name: 'Sidonavigering' }).getByRole('link', { name: /Startsidan/ }),
      ).toBeVisible();
    });

  test('the rail is one navigation landmark of places and conversations (D50), in the drawer on a phone', async ({
    page,
    api: _,
  }) => {
    await open(page, '/');
    const rail = page.getByRole('navigation', { name: 'Sidonavigering' });
    await expect(rail).toHaveCount(1);
    await expect(rail.getByRole('link', { name: 'Ny fråga' })).toBeVisible();
    // Hem says how much needs the person (D53); a card's state and the areas are its tabs and its filter, not rows here.
    await expect(rail.getByRole('link', { name: /^Hem/ })).toHaveAttribute('href', '/');
    await expect(rail.getByRole('link', { name: /^Hem/ })).toContainText('1 i dag');
    await expect(rail.getByRole('group', { name: 'Verktyg' }).getByRole('link', { name: 'Kalender' })).toBeVisible();
    await expect(rail.getByRole('link', { name: 'Vem är på plats i dag?' })).toHaveAttribute(
      'href',
      '/conversations/fraga',
    );
    await expect(rail.getByRole('link', { name: 'Alla samtal' })).toHaveAttribute('href', '/?tab=done');
    for (const gone of ['Behöver dig', 'Jag föreslår', 'Till kännedom', 'Inte nu'])
      await expect(rail.getByRole('link', { name: gone })).toHaveCount(0);
    await expect(rail.getByRole('button', { name: 'Områden' })).toHaveCount(0);
    await rail.getByRole('link', { name: /^Hem/ }).click();
    await expect(page.locator('nav a[aria-current="page"]')).toHaveText(/^Hem/);
    await page.setViewportSize(phone);
    await expect(page.getByRole('navigation', { name: 'Sidonavigering' })).toHaveCount(0);
    const nav = await openNav(page);
    await expect(nav).toHaveCount(1);
    await expect(nav.getByRole('link', { name: /^Hem/ })).toBeVisible();
  });

  test('Hem is one greeting over its groups, a row is a button that says whether its card is open, the log groups its days', async ({
    page,
    api: _,
  }) => {
    await open(page, '/');
    await expect(heading(page, 1, 'Hej Testa')).toBeVisible();
    await expect(heading(page, 2, 'Nu · 1')).toBeVisible();
    // A row's title is the link to its card beside the column (artboard A); the open row is the current one.
    const row = page
      .getByRole('listitem')
      .filter({ has: page.getByRole('link', { name: 'Omtankesamtal med Anna Lindqvist', exact: true }) });
    await expect(row.getByRole('link', { name: 'Omtankesamtal med Anna Lindqvist', exact: true })).toHaveAttribute(
      'href',
      '/?card=omtanke',
    );
    await expect(row).not.toHaveAttribute('aria-current', 'true');
    await open(page, '/?tab=done');
    await expect(heading(page, 1, 'Hej Testa')).toBeVisible();
    await expect(heading(page, 2, 'Redan hanterat')).toBeVisible();
    await page.getByRole('radio', { name: 'Veckan' }).click();
    await expect(page.getByRole('list', { name: /november/ }).first()).toBeVisible();
  });

  for (const path of ['/', '/?card=fakturor'])
    test(`sections on ${path} have distinct names`, async ({ page, api: _ }) => {
      await open(page, path);
      const names = await page
        .locator('section[aria-label]')
        .evaluateAll(list => list.map(el => el.getAttribute('aria-label')));
      expect(new Set(names).size).toBe(names.length);
    });

  test("Hem is the greeting with the day over the box, and the day's work under the box: the tabs, the groups, then the day and what happened since yesterday", async ({
    page,
    api: _,
  }) => {
    await open(page, '/');
    // The greeting by first name is the page's one h1 (D53), with the day under it; nothing sums the day up in a sentence.
    const lead = page.getByRole('region', { name: 'Vad vill du göra' });
    await expect(lead.getByRole('heading', { level: 1, name: 'Hej Testa' })).toBeVisible();
    await expect(lead.getByText('Onsdag 4 november · vecka 45 · Skönsmons skola', { exact: true })).toBeVisible();
    await expect(page.getByText(/behöver dig i dag/)).toHaveCount(0);
    const greeting = (await heading(page, 1, 'Hej Testa').boundingBox())!,
      box = (await composer(page).boundingBox())!;
    expect(box.y).toBeGreaterThan(greeting.y);
    // Under the box the day's work: a card's state as four tabs, the groups as the h2s, the figures after them.
    await expect(page.getByRole('tablist').getByRole('tab')).toHaveCount(4);
    const first = heading(page, 2, 'Nu · 1');
    await expect(first).toBeVisible();
    expect((await first.boundingBox())!.y).toBeGreaterThan(box.y + box.height);
    // Läget is not on Hem until D54 is decided (the product owner, 2026-11-06).
    await expect(page.getByRole('heading', { name: /^Läget/ })).toHaveCount(0);
    await expect(page.getByRole('list', { name: 'Det som behöver dig' })).toHaveCount(0);
    // At this width the panel does not fit beside the column, so the day and what happened since yesterday end the page.
    await expect(page.getByRole('complementary', { name: 'Vid sidan av' })).toHaveCount(0);
    const today = page.getByRole('region', { name: 'I dag' }),
      since = page.getByRole('region', { name: 'Sedan i går' });
    await expect(today.locator('[aria-level="2"]').filter({ hasText: 'I dag' })).toBeVisible();
    await expect(today.getByText('Rektorsmöte', { exact: true })).toBeVisible();
    // The row level (D71, artboard 6): the time in its cell, the title 14 semibold, the length and the place under it.
    await expect(today.getByText(/^1 tim · A12 · /)).toBeVisible();
    // A meeting the person pointed at in a conversation says so, one link from its row (D63).
    await expect(today.getByRole('link', { name: 'underlaget ligger i samtalet' })).toHaveAttribute(
      'href',
      '/conversations/fraga',
    );
    await expect(today.getByText('Ledigt till 12:00')).toBeVisible();
    await expect(today.getByText('Längsta luckan · jag bokar inget här utan att fråga')).toBeVisible();
    await expect(today.getByRole('link', { name: 'Hela veckan' })).toHaveAttribute('href', '/calendar');
    // Sedan i går is three sentences (artboard A): what closed with its receipt, what waits with who has answered, the next review.
    await expect(
      since.getByText(/^2 klara: attesterade fakturor, kvitto läst från ekonomisystemet 09:00 och påminnelse om/),
    ).toBeVisible();
    await expect(
      since.getByText(/^2 väntar på andra: planera utvecklingssamtal vecka 45 \(1 av 2 har svarat\) och tillbud/),
    ).toBeVisible();
    await expect(since.getByText(/^Nästa genomgång /)).toBeVisible();
    await expect(since.getByRole('link', { name: 'Allt som är klart' })).toHaveAttribute('href', '/?tab=done');
    await expectNoAxeViolations(page);
  });

  test('when many cards closed since the day began, Sedan i går names three and sums the rest in one sentence (D65)', async ({
    page,
    api,
  }) => {
    // Five more closed today, newest first, two of them the same card closed twice.
    const done = api.threads.find(t => t.id === 'attest')!;
    const more = [
      ['Godkänn en ledighetsansökan', '2026-11-04T09:00:00.000Z'],
      ['Tillbud 2026-1182', '2026-11-04T08:30:00.000Z'],
      ['Boka ett omtankesamtal', '2026-11-04T08:20:00.000Z'],
      ['Lönesystemet har inte visat det som bevakades', '2026-11-04T08:10:00.000Z'],
      ['Lönesystemet har inte visat det som bevakades', '2026-11-04T08:10:00.000Z'],
    ] as const;
    api.threads = [
      ...api.threads,
      ...more.map(([title, handledAt], i) => ({
        ...done,
        id: `klar-${i}`,
        topic: `klar-${i}`,
        title,
        handledAt,
        receipt: null,
      })),
    ];
    await open(page, '/');
    const since = page.getByRole('region', { name: 'Sedan i går' });
    await expect(
      since.getByText(
        '7 klara: godkänn en ledighetsansökan 10:00, tillbud 2026-1182 09:30, boka ett omtankesamtal 09:20 och 4 till.',
        { exact: true },
      ),
    ).toBeVisible();
    await expect(since.getByRole('link', { name: 'Allt som är klart' })).toHaveAttribute('href', '/?tab=done');
    await expect(page.getByRole('tab', { name: /^Klart/ })).toContainText('7');
    await expectNoAxeViolations(page);
  });

  test('typing in the box offers what the router finds without the model, the open card first, and each row is a button', async ({
    page,
    api: _,
  }) => {
    await open(page, '/');
    await composer(page).fill('attestera');
    const offers = page.getByRole('list', { name: 'Menar du' });
    await expect(offers.getByRole('listitem').first()).toContainText('Attestera 3 fakturor, 48 200 kr');
    await expect(offers.getByRole('button', { name: /Attestera fakturor/ })).toBeVisible();
    await offers.getByRole('button', { name: /Attestera 3 fakturor/ }).click();
    await expect(page).toHaveURL(/^[^?]*\/\?card=fakturor$/);
  });

  test('a row reaches the box by @, which with nothing typed offers only what the page shows', async ({
    page,
    api: _,
  }) => {
    await open(page, '/');
    await composer(page).pressSequentially('@');
    const menu = page.getByRole('listbox', { name: 'Objekt' });
    await expect(menu.getByRole('option').first()).toBeVisible();
    const offered = await menu.getByRole('option').allTextContents();
    // The cards in the tab on screen are offered; a card set aside (Inte nu) is not.
    expect(offered.some(o => o.includes('Attestera 3 fakturor, 48 200 kr'))).toBe(true);
    expect(offered.some(o => o.includes('Brandskyddsrond i oktober saknar protokoll'))).toBe(false);
  });

  test('the answer is the card: a question that names a card draws it in the turn, a heading under the conversation, with its rows and buttons', async ({
    page,
    api: _,
  }) => {
    await open(page, '/');
    await composer(page).fill('attestera en faktura');
    await composer(page).press('Enter');
    const card = page.getByRole('article', { name: 'Kort: Attestera 3 fakturor, 48 200 kr' });
    await expect(card).toBeVisible();
    // Under the conversation's h1 the card's title is a level-2 heading (Playwright's role level reads the tag, so the suite reads aria-level).
    await expect(heading(page, 2, 'Attestera 3 fakturor, 48 200 kr')).toBeVisible();
    await expect(card.getByRole('checkbox')).toHaveCount(3);
    await expect(card.getByRole('button', { name: 'Attestera 2 valda' })).toBeVisible();
    await expect(page.getByRole('article', { name: /^Assistenten/ })).toContainText('saknar beställning');
  });

  test('the rail searches conversations and cards and opens what is picked', async ({ page, api: _ }) => {
    await open(page, '/');
    const search = page.getByRole('combobox', { name: 'Sök i samtal och kort' });
    await search.fill('fakturor');
    await page.getByRole('option', { name: /Attestera 3 fakturor/ }).click();
    await expect(page).toHaveURL(/\/\?card=fakturor$/);
  });

  test('the calendar names its days as headings', async ({ page, api: _ }) => {
    await open(page, '/calendar');
    await expect(heading(page, 2, 'ons 4 nov')).toBeVisible();
  });

  test('the side panel has a heading', async ({ page, api: _ }) => {
    await open(page, '/?open=hr.whoIsOn&open-title=Bemanning');
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
    await expect(page.getByRole('article', { name: /^Assistenten/ })).toBeVisible();
  });

  // On the landing the box has no header and already holds the focus (G); the conversation's scope line carries the shortcut.

  test('the side panel shows Swedish labels and readable values', async ({ page, api: _ }) => {
    await open(page, '/?open=hr.whoIsOn&open-title=Bemanning');
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
  test('the answer is numbered steps with citations that open the document, its source is named under it, and the follow-ups are a group', async ({
    page,
    api: _,
  }) => {
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
    await expect(
      page.getByRole('group', { name: 'Följdfrågor' }).getByRole('button', { name: 'Och om hen slagit i huvudet?' }),
    ).toBeVisible();
    // "Lägg under Behöver dig" proposes; the answer executes nothing. What happened is said in the transcript.
    await bubble.getByRole('button', { name: 'Lägg under Behöver dig' }).click();
    await expect(
      page.getByText(/^Klart\. Kortet "Ny rutin för läkemedelshantering" ligger under Behöver dig/),
    ).toBeVisible();
  });
  test('the sources view numbers its rows, names owner and review date, warns about a stale one and says which source did not answer', async ({
    page,
    api: _,
  }) => {
    await open(page, '/?open=clew.search&open-title=K%C3%A4llor&open-input=%7B%22query%22%3A%22fall%22%7D');
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
    // The row keeps the thread's id; its card, open in the panel, has its own (D50).
    await open(page, '/?card=samtal');
    const card = page.locator('#card-samtal');
    await expect(card.getByRole('list', { name: 'Steg' })).toBeVisible();
    await expect(card.getByRole('list', { name: 'Steg' }).getByRole('listitem')).toHaveCount(4);
    await expect(card.getByRole('group', { name: 'Oplacerade: 1' })).toContainText('Sara Holm · upptagen hela veckan');
    // The phone's calendar week is FullCalendar's list with a heading per day (D32); the day loads live on the card.
    await page.setViewportSize(phone);
    await open(page, '/calendar');
    await expect(heading(page, 2, 'ons 4 nov')).toBeVisible();
  });
  test('the waiting obligation shows the sum and lets the manager remind from the keyboard', async ({
    page,
    api: _,
  }) => {
    await open(page, '/?tab=waiting&card=samtal-svar');
    const card = page.locator('#card-samtal-svar');
    await expect(card).toContainText('1 av 2 svarat');
    await expect(card.getByRole('progressbar')).toHaveCount(0);
    await expect(card.getByRole('list', { name: 'Väntar: 1' })).toContainText('påmind en gång');
    const remind = card.getByRole('button', { name: 'Påminn den som inte svarat' });
    await remind.focus();
    await page.keyboard.press('Enter');
    await expect(card.getByRole('list', { name: 'Väntar: 1' })).toContainText('påmind 2 gånger');
  });
});
