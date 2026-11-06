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
    await expect(rail.getByRole('link', { name: 'Nytt samtal' })).toBeVisible();
    // Hem says how much needs the person (D53); a card's state and the areas are its tabs and its filter, not rows here.
    await expect(rail.getByRole('link', { name: /^Hem/ })).toHaveAttribute('href', '/');
    await expect(rail.getByRole('link', { name: /^Hem/ })).toContainText('6');
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
    await expect(heading(page, 1, 'Hej, Testa')).toBeVisible();
    await expect(heading(page, 2, 'Nu · 1')).toBeVisible();
    const row = page
      .getByRole('listitem')
      .filter({ has: page.getByRole('button', { name: 'Omtankesamtal med Anna Lindqvist', exact: true }) });
    await expect(row.getByRole('button', { name: 'Omtankesamtal med Anna Lindqvist', exact: true })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    await open(page, '/?tab=done');
    await expect(heading(page, 1, 'Hej, Testa')).toBeVisible();
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

  test("Hem is the greeting with the day over the box, and the day's work under the box: the tabs, the groups, Läget, then the day and what happened since yesterday", async ({
    page,
    api: _,
  }) => {
    await open(page, '/');
    // The greeting by first name is the page's one h1 (D53), with the day under it; nothing sums the day up in a sentence.
    const lead = page.getByRole('region', { name: 'Vad vill du göra' });
    await expect(lead.getByRole('heading', { level: 1, name: 'Hej, Testa' })).toBeVisible();
    await expect(lead.getByText('onsdag 4 november', { exact: true })).toBeVisible();
    await expect(page.getByText(/behöver dig i dag/)).toHaveCount(0);
    const greeting = (await heading(page, 1, 'Hej, Testa').boundingBox())!,
      box = (await composer(page).boundingBox())!;
    expect(box.y).toBeGreaterThan(greeting.y);
    // Under the box the day's work: a card's state as four tabs, the groups as the h2s, the figures after them.
    await expect(page.getByRole('tablist').getByRole('tab')).toHaveCount(4);
    const first = heading(page, 2, 'Nu · 1');
    await expect(first).toBeVisible();
    expect((await first.boundingBox())!.y).toBeGreaterThan(box.y + box.height);
    await expect(heading(page, 2, 'Läget · Skönsmons skola')).toBeVisible();
    await expect(page.getByRole('list', { name: 'Det som behöver dig' })).toHaveCount(0);
    // At this width the panel does not fit beside the column, so the day and what happened since yesterday end the page.
    await expect(page.getByRole('complementary', { name: 'Vid sidan av' })).toHaveCount(0);
    const today = page.getByRole('region', { name: 'I dag' }),
      since = page.getByRole('region', { name: 'Sedan i går' });
    await expect(today.getByRole('heading', { level: 2, name: 'I dag' })).toBeVisible();
    await expect(today.getByText('09:30–10:30 Rektorsmöte')).toBeVisible();
    await expect(today.getByRole('link', { name: 'Hela veckan' })).toHaveAttribute('href', '/calendar');
    await expect(since.getByRole('link', { name: /Attesterade fakturor/ })).toHaveAttribute('href', '/?tab=done');
    await expect(since.getByRole('link', { name: /Tillbud 2026-1182/ })).toHaveAttribute('href', '/?card=tillbud');
    await expect(since.getByText(/^Nästa genomgång /)).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test('the areas under the box are toggles for the areas that have something to start, and the chosen one shows its standing actions as cards', async ({
    page,
    api: _,
  }) => {
    await open(page, '/');
    const areas = page.getByRole('group', { name: 'Områden' });
    // Only an area with a standing action is offered (not Kvalitet, which has none), in the order the person's areas come; nothing is chosen at first.
    expect(await areas.getByRole('button').evaluateAll(list => list.map(el => el.getAttribute('aria-label')))).toEqual([
      'Viktigt nu',
      'Kalender',
      'Personal',
      'Budget',
    ]);
    await expect(areas.getByRole('button', { pressed: true })).toHaveCount(0);
    // The icon is the one the connector named for its area; an area that names none is its title alone.
    await expect(areas.getByRole('button', { name: 'Budget' }).locator('svg')).toHaveCount(1);
    await expect(areas.getByRole('button', { name: 'Viktigt nu' }).locator('svg')).toHaveCount(0);
    await areas.getByRole('button', { name: 'Budget' }).click();
    await expect(areas.getByRole('button', { name: 'Budget' })).toHaveAttribute('aria-pressed', 'true');
    const cards = page.getByRole('group', { name: 'Budget', exact: true });
    // A read is a link to its view; the line under the title says which system and what happens.
    await expect(cards.getByRole('link', { name: 'Budget mot prognos' })).toHaveAttribute(
      'href',
      /^\/\?open=finance\.budget&open-title=/,
    );
    await expect(cards.getByText('Ekonomisystemet · öppnar vyn')).toBeVisible();
    await expect(cards.getByRole('button', { name: 'Attestera fakturor' })).toBeVisible();
    // The cards come under the toggles and are brought into view (D41 item 4): the areas stand after the day's work (D53), so the box above is not what the person is looking at.
    await expect(cards.getByText('Attestera fakturor', { exact: true })).toBeInViewport();
    await expectNoAxeViolations(page);
    // Another area takes its place; the chosen one pressed again closes the cards.
    await areas.getByRole('button', { name: 'Personal' }).click();
    // A ClickableCard's link is named by its label and holds no text of its own.
    const links = page.getByRole('group', { name: 'Personal', exact: true }).getByRole('link');
    await expect(links).toHaveCount(2);
    await expect(links.first()).toHaveAccessibleName(/Vem är på plats\?/);
    await expect(links.last()).toHaveAccessibleName(/Frånvaro per person/);
    await expect(cards).toHaveCount(0);
    await areas.getByRole('button', { name: 'Personal' }).click();
    await expect(page.getByRole('group', { name: 'Personal', exact: true })).toHaveCount(0);
  });

  test('a card that reads opens its view in the panel, and the area is still chosen when the panel closes', async ({
    page,
    api: _,
  }) => {
    await open(page, '/');
    await page.getByRole('group', { name: 'Områden' }).getByRole('button', { name: 'Budget' }).click();
    const cards = page.getByRole('group', { name: 'Budget', exact: true });
    // The whole card is the target: a click on its text follows the link.
    await cards.getByText('Budget mot prognos', { exact: true }).click();
    await expect(page).toHaveURL(/\/\?open=finance\.budget&open-title=/);
    await expect(page.getByRole('dialog', { name: 'Budget mot prognos' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/\/$/);
    await expect(cards.getByRole('link', { name: 'Budget mot prognos' })).toBeVisible();
  });

  test('a card that is not a read asks its question in the box, from the keyboard too, and the answer opens as a conversation', async ({
    page,
    api: _,
  }) => {
    await open(page, '/');
    const areas = page.getByRole('group', { name: 'Områden' });
    await areas.getByRole('button', { name: 'Budget' }).focus();
    await page.keyboard.press('Enter');
    const card = page
      .getByRole('group', { name: 'Budget', exact: true })
      .getByRole('button', { name: 'Attestera fakturor' });
    await card.focus();
    await expect(card).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('log')).toContainText('Attestera fakturor');
    await expect(page).toHaveURL(/\/conversations\//);
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
    const rows = page.getByRole('tabpanel', { name: 'Behöver dig' });
    await expect(rows.getByRole('button', { name: 'Lägg till i samtalet' })).toHaveCount(0);
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
    await expect(card.getByRole('button', { name: 'Attestera · 2' })).toBeVisible();
    await expect(page.getByRole('article', { name: 'Assistenten', exact: true })).toContainText('saknar beställning');
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
    await expect(page.getByRole('article', { name: 'Assistenten', exact: true })).toBeVisible();
  });

  // On the landing the box has no header and already holds the focus (G); the conversation's scope line carries the shortcut.
  test('the keyboard shortcut is spoken in Swedish', async ({ page, api: _ }) => {
    await open(page, '/');
    await composer(page).fill('Vem är på plats i dag?');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('img', { name: 'Kontroll + K' })).toBeVisible();
  });

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
