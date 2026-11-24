import {
  SITE,
  answer,
  composer,
  desktop,
  expect,
  expectNoAxeViolations,
  heading,
  hemLine,
  narrow,
  open,
  openNav,
  pagesNav,
  phone,
  reflowProblems,
  searchButton,
  test,
} from './support';
import type { Page } from '@playwright/test';

test.use({ viewport: desktop });

test.describe('2.4.2 page titled', () => {
  const titles = [
    ['/', `Hem · ${SITE}`],
    ['/todo', `Att göra · ${SITE}`],
    ['/todo?tab=done', `Att göra · ${SITE}`],
    ['/calendar', `Vecka 45 · Kalender · ${SITE}`],
    ['/?open=hr.whoIsOn&open-title=Bemanning', `Bemanning · ${SITE}`],
    // A list's own page (D116), placed in the rail or not.
    ['/tools/incidents.deviations?title=Avvikelser&from=%2F', `Avvikelser · ${SITE}`],
  ] as const;
  for (const [path, title] of titles)
    test(`${path} has its own title`, async ({ page, api: _ }) => {
      await open(page, path);
      await expect(page).toHaveTitle(title);
    });
  test('the title follows the week', async ({ page, api: _ }) => {
    await open(page, '/calendar');
    await page.getByRole('button', { name: 'Nästa vecka' }).click();
    await expect(page).toHaveTitle(`Vecka 46 · Kalender · ${SITE}`);
  });
});

test.describe('1.3.1 and 2.4.6 structure', () => {
  // The shared header is every page's banner (D130): its heading row, named by the site, and under the band Clew's own
  // pages, "Mina sidor". A page of its own says where it stands ("Du är här"), and Att göra adds its piles. The header's
  // landmarks with a connector are header.spec.ts's.
  for (const [path, navigations] of [
    ['/', [SITE, 'Mina sidor']],
    ['/todo', [SITE, 'Mina sidor', 'Du är här', 'Urval']],
    ['/todo?tab=done', [SITE, 'Mina sidor', 'Du är här', 'Urval']],
    ['/calendar', [SITE, 'Mina sidor', 'Du är här']],
  ] as const)
    test(`${path} has one h1, one main, one banner, and every navigation landmark named`, async ({ page, api: _ }) => {
      await open(page, path);
      await expect(page.locator('h1:not([aria-level]), [aria-level="1"]')).toHaveCount(1);
      await expect(page.getByRole('main')).toHaveCount(1);
      const banner = page.getByRole('banner');
      await expect(banner).toHaveCount(1);
      expect(
        await page.getByRole('navigation').evaluateAll(list => list.map(nav => nav.getAttribute('aria-label'))),
      ).toEqual(navigations);
      await expect(pagesNav(page)).toHaveCount(1);
      await expect(banner.getByRole('link', { name: SITE })).toHaveAttribute('href', '/');
    });

  test('Clew’s pages are one navigation landmark of places (D50, D130), in the drawer on a phone', async ({
    page,
    api: _,
  }) => {
    await open(page, '/');
    const nav = pagesNav(page);
    await expect(nav).toHaveCount(1);
    // The places (D126 rule 7): Start, Att göra with how much needs the person, then Kalender; the piles and the areas
    // are Att göra's tabs and filter, not pages here, and Start carries no word of its own (rule 8).
    await expect(nav.getByRole('link', { name: 'Start', exact: true })).toHaveAttribute('href', '/');
    await expect(nav.getByRole('link', { name: /^Att göra/ })).toHaveAttribute('href', '/todo');
    await expect(nav.getByRole('link', { name: /^Att göra/ })).toContainText('7');
    await expect(nav.getByRole('link', { name: 'Kalender' })).toHaveAttribute('href', '/calendar');
    // Without a tool an administrator placed there is no Verktyg (D40).
    await expect(nav.getByRole('button', { name: 'Verktyg' })).toHaveCount(0);
    // The conversations are one page away, on Samtal (D126 rule 7): none of them is a page of the row.
    await expect(nav.getByRole('link', { name: 'Samtal', exact: true })).toHaveAttribute('href', '/conversations');
    await expect(nav.getByRole('link', { name: 'Vem är på plats i dag?' })).toHaveCount(0);
    for (const gone of ['Behöver dig', 'Jag föreslår', 'Till kännedom', 'Inte nu'])
      await expect(nav.getByRole('link', { name: gone, exact: true })).toHaveCount(0);
    await expect(nav.getByRole('button', { name: 'Områden' })).toHaveCount(0);
    await nav.getByRole('link', { name: 'Start', exact: true }).click();
    await expect(nav.locator('a[aria-current="page"]')).toHaveText('Start');
    await page.setViewportSize(phone);
    await expect(pagesNav(page)).toHaveCount(0);
    const drawer = await openNav(page);
    await expect(drawer).toHaveCount(1);
    await expect(drawer.getByRole('link', { name: 'Start', exact: true })).toBeVisible();
  });

  test('Hem is one heading over the box and its blocks; a row has one link to its work item; Klart in Att göra is its rows', async ({
    page,
    api: _,
  }) => {
    await open(page, '/');
    await expect(heading(page, 1, 'God morgon, Testa')).toBeVisible();
    await expect(heading(page, 2, 'Behöver dig')).toBeVisible();
    // A row has one link to its work item's page, with Hem as the way back (D126 rule 1): "Öppna", named with the
    // row's title so no two links of the list are called the same (D130 item 13).
    const row = page.locator('#work-omtanke');
    const link = row.getByRole('link');
    await expect(link).toHaveAttribute('href', '/items/omtanke?from=%2F');
    await expect(link).toHaveAccessibleName('Öppna Omtankesamtal med Anna Lindqvist');
    await expect(link).toHaveText('Öppna');
    const rows = page.getByRole('list', { name: 'Behöver dig' }).getByRole('listitem');
    for (let i = 0; i < (await rows.count()); i++) await expect(rows.nth(i).getByRole('link')).toHaveCount(1);
    // The title, the badge and the source stay in the row as text.
    await expect(row).toContainText('Omtankesamtal med Anna Lindqvist');
    await expect(row).toContainText('Personalsystemet');
    // The link is a target of its own size (2.5.8).
    const target = (await link.boundingBox())!;
    expect(target.height).toBeGreaterThanOrEqual(24);
    expect(target.width).toBeGreaterThanOrEqual(24);
    await link.click();
    await expect(page).toHaveURL('/items/omtanke?from=%2F');
    await expect(page.getByRole('heading', { level: 1, name: /^Omtankesamtal med Anna Lindqvist/ })).toBeVisible();
    await open(page, '/todo?tab=done');
    await expect(heading(page, 1, 'Att göra')).toBeVisible();
    // The queue is a table (board Att göra, the `table-inbox` template): its header row and the item done; the
    // decision with a row in doubt waits on the person under Behöver dig.
    await expect(page.getByRole('table', { name: 'Klart' }).getByRole('row')).toHaveCount(2);
  });

  for (const path of ['/', '/todo?item=fakturor'])
    test(`sections on ${path} have distinct names`, async ({ page, api: _ }) => {
      await open(page, path);
      const names = await page
        .locator('section[aria-label]')
        .evaluateAll(list => list.map(el => el.getAttribute('aria-label')));
      expect(new Set(names).size).toBe(names.length);
    });

  test('Hem is one heading over its line, and under the line Läget, then Behöver dig and I dag side by side, and no digest', async ({
    page,
    api: _,
  }) => {
    await open(page, '/');
    // One heading, the greeting (D126, board Hem), with the line to ask Clew under it; nothing sums the day up in a sentence.
    await expect(page.getByText(/behöver dig i dag/)).toHaveCount(0);
    const title = (await heading(page, 1, 'God morgon, Testa').boundingBox())!,
      box = (await hemLine(page).boundingBox())!;
    expect(box.y).toBeGreaterThan(title.y);
    // Under the line the two blocks side by side: the most urgent work items and the day.
    const needs = page.getByRole('region', { name: 'Behöver dig' });
    await expect(needs.getByRole('listitem')).toHaveCount(4);
    await expect(needs.getByRole('link', { name: 'Visa alla' })).toHaveAttribute('href', '/todo');
    const today = page.getByRole('region', { name: 'I dag' });
    const n = (await needs.boundingBox())!,
      d = (await today.boundingBox())!;
    expect(n.y).toBeGreaterThan(box.y + box.height);
    expect(d.x).toBeGreaterThanOrEqual(n.x + n.width);
    expect(Math.abs(d.y - n.y)).toBeLessThan(2);
    // Läget stands over the blocks, as the startsidan prototype opens with its key figures (D130). "Sedan i går" is
    // gone (2026-11-13: no digest sentences on a page): what closed is in Att göra's Klart.
    const lage = heading(page, 2, 'Läget på Skönsmons skola');
    await expect(lage).toBeVisible();
    const l = (await lage.boundingBox())!;
    expect(l.y).toBeGreaterThan(box.y + box.height);
    expect(l.y).toBeLessThan(n.y);
    await expect(page.getByRole('region', { name: 'Sedan i går' })).toHaveCount(0);
    await expect(page.getByRole('tablist')).toHaveCount(0);
    await expect(today.getByRole('heading', { level: 2, name: 'I dag' })).toBeVisible();
    await expect(today.getByText('Rektorsmöte', { exact: true })).toBeVisible();
    // The row level (D71, artboard 6): the time in its cell, the title 14 semibold, the length and the place under it.
    await expect(today.getByText(/^1 tim\s·\sA12\s·\s/)).toBeVisible();
    // A meeting the person pointed at in a conversation says so, one link from its row (D63).
    await expect(today.getByRole('link', { name: 'underlaget ligger i samtalet' })).toHaveAttribute(
      'href',
      '/conversations/fraga',
    );
    await expect(today.getByText('Ledigt till 12:00')).toBeVisible();
    await expect(today.getByText('Längsta luckan · jag bokar inget här utan att fråga')).toBeVisible();
    await expect(today.getByRole('link', { name: 'Kalender' })).toHaveAttribute('href', '/calendar');
    await expectNoAxeViolations(page);
  });

  test('typing in Hem’s line offers nothing under it: no suggestion chips on a page (2026-11-13)', async ({
    page,
    api: _,
  }) => {
    await open(page, '/');
    await hemLine(page).fill('attestera');
    await expect(page.getByText('Menar du')).toHaveCount(0);
    await expect(page.getByRole('link', { name: /Attestera 3 fakturor/ })).toHaveCount(1);
  });

  test('Hem’s line takes no @; the box on Ny fråga does, and a word after it finds a work item', async ({
    page,
    api: _,
  }) => {
    // Hem's line is one plain field (D126 item 4): `@` is a character there, and no list opens.
    await open(page, '/');
    await hemLine(page).pressSequentially('@');
    await expect(hemLine(page)).toHaveValue('@');
    await expect(page.getByRole('listbox', { name: 'Objekt' })).toHaveCount(0);
    await open(page, '/conversations/new');
    await composer(page).pressSequentially('@fakt');
    const menu = page.getByRole('listbox', { name: 'Objekt' });
    await expect(menu.getByRole('option').first()).toBeVisible();
    const offered = await menu.getByRole('option').allTextContents();
    expect(offered.some(o => o.includes('Attestera 3 fakturor, 48 200 kr'))).toBe(true);
  });

  test('the answer is the card: a question that names a card draws it in the turn, a heading under the conversation, with its rows and buttons', async ({
    page,
    api: _,
  }) => {
    await open(page, '/');
    await composer(page).fill('attestera en faktura');
    await composer(page).press('Enter');
    const card = page.getByRole('article', { name: 'Ärende: Attestera 3 fakturor, 48 200 kr' });
    await expect(card).toBeVisible();
    // Under the conversation's h1 the card's title is a level-2 heading (Playwright's role level reads the tag, so the suite reads aria-level).
    await expect(heading(page, 2, 'Attestera 3 fakturor, 48 200 kr')).toBeVisible();
    await expect(card.getByRole('checkbox')).toHaveCount(3);
    await expect(card.getByRole('button', { name: 'Attestera 2 valda' })).toBeVisible();
    await expect(page.getByRole('article', { name: 'Assistenten', exact: true })).toContainText('saknar beställning');
  });

  test('the rail searches conversations and cards and opens what is picked: from Hem the work item’s page', async ({
    page,
    api: _,
  }) => {
    await open(page, '/');
    await searchButton(page).click();
    const search = page.getByRole('combobox', { name: 'Sök i samtal och ärenden' });
    await search.fill('fakturor');
    await page.getByRole('option', { name: /Attestera 3 fakturor/ }).click();
    // The item's own page, with the page the person was on as the way back (D126 rule 1).
    await expect(page).toHaveURL('/items/fakturor?from=%2F');
    await expect(page.getByRole('heading', { level: 1, name: /^Attestera 3 fakturor/ })).toBeVisible();
  });

  test('a card picked in the rail’s search leads to its page from any page, with that page as the way back (D126 rule 1)', async ({
    page,
    api: _,
  }) => {
    await open(page, '/calendar');
    await searchButton(page).click();
    const search = page.getByRole('combobox', { name: 'Sök i samtal och ärenden' });
    await search.fill('fakturor');
    await page.getByRole('option', { name: /Attestera 3 fakturor/ }).click();
    await expect(page).toHaveURL('/items/fakturor?from=%2Fcalendar');
    await expect(page.getByRole('heading', { level: 1, name: /^Attestera 3 fakturor/ })).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Ärende' })).toHaveCount(0);
    await page.goBack();
    await expect(page).toHaveURL(/\/calendar$/);
  });

  test('the calendar names its days as headings', async ({ page, api: _ }) => {
    await open(page, '/calendar');
    await expect(heading(page, 2, 'ons 4 nov')).toBeVisible();
  });

  test('a view opened over Hem by an address from before is its own page, named by its heading (D126 rule 3)', async ({
    page,
    api: _,
  }) => {
    await open(page, '/?open=hr.whoIsOn&open-title=Bemanning');
    await expect(page).toHaveURL(/^[^?]*\/tools\/hr\.whoIsOn\?/);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(heading(page, 1, 'Bemanning')).toBeVisible();
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
    // Clew's turn names itself (board Samtal): the same word in Swedish as in English.
    await expect(page.getByRole('article', { name: 'Assistenten', exact: true })).toBeVisible();
  });

  // On the landing the box has no header and already holds the focus (G); the conversation's scope line carries the shortcut.

  test('a view’s page shows Swedish labels and readable values', async ({ page, api: _ }) => {
    await open(page, '/?open=hr.whoIsOn&open-title=Bemanning');
    const panel = page.getByRole('main');
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
    // "Visa källor" is a link. The search declares no view, so it names the sources beside the conversation, and the
    // panel sends them on to the search's own page when they arrive as rows (D116, views.spec).
    await expect(bubble.getByRole('link', { name: 'Visa källor' })).toHaveAttribute(
      'href',
      /^\/conversations\/[^?]+\?open=clew\.search&open-title=K%C3%A4llor&open-input=/,
    );
    // No suggested follow-up questions are drawn under an answer (D126 rule 8), though the answer carries some.
    await expect(page.getByRole('group', { name: 'Följdfrågor' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Och om hen slagit i huvudet?' })).toHaveCount(0);
    // "Lägg under Behöver dig" proposes; the answer executes nothing. What happened is said in the transcript.
    await bubble.getByRole('button', { name: 'Lägg under Behöver dig' }).click();
    await expect(
      page.getByText(/^Klart\. Ärendet "Ny rutin för läkemedelshantering" ligger under Behöver dig/),
    ).toBeVisible();
  });
  test('the sources view numbers its rows, names owner and review date, warns about a stale one and says which source did not answer', async ({
    page,
    api: _,
  }) => {
    // The hits are rows, so they are the search's page (D116): the address that opened them beside Hem leads there.
    await open(page, '/?open=clew.search&open-title=K%C3%A4llor&open-input=%7B%22query%22%3A%22fall%22%7D');
    await expect(page).toHaveURL(/^[^?]*\/tools\/clew\.search\?/);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const panel = page.getByRole('main');
    await expect(panel.getByRole('heading', { level: 1, name: 'Källor' })).toBeVisible();
    const rows = panel.getByRole('list', { name: 'Källor' }).getByRole('listitem');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText('Rutin vid fall i ordinärt boende · Vid fall');
    await expect(rows.nth(0)).toContainText('Intranätet · MAS · granskad 12 mars 2026');
    // A link out of Clew opens a new tab and says so (D111 rule 8).
    await expect(rows.nth(0).getByRole('link', { name: /^Öppna\s*\(öppnas i ny flik\)$/ })).toHaveAttribute(
      'target',
      '_blank',
    );
    // A passage goes into a conversation only beside a conversation's own box (D112 item 7); the page has "Fråga assistenten".
    await expect(rows.nth(0).getByRole('button', { name: 'Lägg till i samtalet' })).toHaveCount(0);
    await expect(panel.getByRole('button', { name: 'Fråga assistenten' })).toBeVisible();
    await expect(rows.nth(2)).toContainText('2 år sedan');
    await expect(rows.nth(2).getByRole('link', { name: 'Öppna' })).toHaveCount(0);
    await expect(panel.getByText(/^SharePoint svarade inte\./)).toBeVisible();
    await expect(panel).not.toContainText('{');
  });
});

test.describe('D30 the obligation', () => {
  test('the card carries its steps, its judgement calls and its day loads with names', async ({ page, api: _ }) => {
    // The row keeps the thread's id; the work item, open in Att göra's reading pane, has its own (D50, D126 rule 2).
    await open(page, '/todo?item=samtal');
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
    await open(page, '/todo?tab=waiting&item=samtal-svar');
    const card = page.locator('#card-samtal-svar');
    await expect(card).toContainText('1 av 2 svarat');
    await expect(card.getByRole('progressbar')).toHaveCount(0);
    await expect(card.getByRole('list', { name: 'Väntar: 1' })).toContainText('påmind en gång');
    const remind = card.getByRole('button', { name: 'Påminn den som inte svarat' });
    await remind.focus();
    await page.keyboard.press('Enter');
    await expect(card.getByRole('list', { name: 'Väntar: 1' })).toContainText('påmind 2 gånger');
  });
  test('an invitee an erasure cleared is drawn as Okänd, never as an empty row or a nameless avatar (D123)', async ({
    page,
    api,
  }) => {
    // Both invitations were sent, so both stay on the card, by id, without the name and address they were drawn with.
    const erased = { name: '', email: '' };
    api.threads = api.threads.map(t =>
      t.id === 'samtal-svar' ? { ...t, proposals: t.proposals.map(p => ({ ...p, participant: erased })) } : t,
    );
    await open(page, '/todo?tab=waiting&item=samtal-svar');
    const card = page.locator('#card-samtal-svar');
    await expect(card.getByRole('list', { name: 'Väntar: 1' }).getByRole('listitem')).toContainText('Okänd');
    // The one who answered yes: the avatar and the first names beside it; the one waiting: the row of Väntar.
    await expect(card.getByRole('group', { name: 'Avatarer' })).toContainText('Okänd');
    await expect(card.getByText('Okänd', { exact: true })).toHaveCount(3);
    await expectNoAxeViolations(page);
  });
});

test.describe('D54 Läget: the areas’ figures from their connectors, on Hem (D126)', () => {
  const lage = (page: Page) => page.getByRole('region', { name: /^Läget på / });
  /** A tile: a link to its figure's page, or a group where there is none; the link to the unit's page is neither. */
  const TILES = 'a:not([href^="/units/"]), [role="group"]';
  test('one tile per figure with a value, the worst first, at most four; the name carries the label, the value and the status', async ({
    page,
    api,
  }) => {
    api.areas = [...api.areas, { ...api.areas[0]!, id: 'tom', title: 'Tom', figure: null }];
    await open(page, '/');
    const region = lage(page);
    // The sentence ("Inget nytt sedan i går.") and the area without a figure are not tiles on Hem; the unit's page has them.
    const tiles = region.locator(TILES);
    expect(await tiles.evaluateAll(list => list.map(el => el.getAttribute('aria-label')))).toEqual([
      'Öppna tillbud 3, Behöver dig',
      'Sjukfrånvaro 4,2 %, Bevaka',
      'Utvecklingssamtal hållna 1 av 4',
      'Förbrukat av ramen 98 %, Lugnt',
    ]);
    await expect(region.getByText('Inget nytt sedan i går.')).toHaveCount(0);
    const absence = region.getByRole('link', { name: 'Sjukfrånvaro 4,2 %, Bevaka' });
    await expect(absence).toHaveAttribute('href', '/tools/hr.absenceOverview?title=Fr%C3%A5nvaro+per+person&from=%2F');
    // The tile as drawn (D130 item 9): the label, the value, one line with the status in words and what the value is
    // compared with, and last the area the figure is from; no badge, no bar, no view's name.
    const card = region.locator('.astryx-clickable-card').filter({ hasText: 'Sjukfrånvaro' });
    await expect(card.getByText('4,2 %', { exact: true })).toBeVisible();
    await expect(card.getByText('Bevaka · mål ≤ 4,0 % · +0,3 sedan oktober', { exact: true })).toBeVisible();
    await expect(card.getByText('Personal', { exact: true })).toBeVisible();
    await expect(card.getByText('Frånvaro per person', { exact: true })).toHaveCount(0);
    await expect(region.getByRole('progressbar')).toHaveCount(0);
    // A figure with no tone says no status.
    const samtal = region.locator('.astryx-clickable-card').filter({ hasText: 'Utvecklingssamtal hållna' });
    await expect(samtal.getByText(/Lugnt|Bevaka|Behöver dig/)).toHaveCount(0);
    await expectNoAxeViolations(page);
    // The whole tile opens its figure's page, without the model: a click on its text follows the link.
    await card.getByText('4,2 %', { exact: true }).click();
    await expect(page).toHaveURL(/^[^?]*\/tools\/hr\.absenceOverview\?/);
  });
  test('a source that does not answer is no tile on Hem: Visa alla counts it, and the unit’s page says it', async ({
    page,
    api,
  }) => {
    api.areas = api.areas.map(a =>
      a.id === 'budget'
        ? { ...a, figure: { label: 'Ekonomisystemet svarar inte.', tone: 'warn', unavailable: true } }
        : a,
    );
    await open(page, '/');
    await expect(lage(page).locator(TILES)).toHaveCount(3);
    await expect(lage(page).getByText('Ekonomisystemet svarar inte.')).toHaveCount(0);
    await expect(lage(page).getByRole('link', { name: 'Visa alla (5)', exact: true })).toBeVisible();
    await expectNoAxeViolations(page);
  });
  test('an area is one tile however often the page reads again, though it has cards, standing reads and a menu row', async ({
    page,
    api,
  }) => {
    // Every change notice invalidates every read (D46), so a live Hem reads the areas again and again.
    let notices = 0;
    await page.route('**/api/changes', route =>
      route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: `retry: 200\nid: ${++notices}\ndata: {}\n\n`,
      }),
    );
    // Budget has a card that needs the person, two standing reads and a menu row; its figure needs them.
    api.areas = api.areas.map(a =>
      a.id === 'budget'
        ? {
            ...a,
            figure: {
              label: 'Prognos',
              value: '−2,1 mnkr',
              tone: 'alert',
              opens: { capability: 'finance.budget', title: 'Budget mot prognos' },
            },
          }
        : a,
    );
    api.menu = [
      {
        connector: 'finance',
        source: 'Ekonomisystemet',
        capability: 'finance.budget',
        title: 'Budget mot prognos',
        label: 'Budget',
        icon: 'chart',
      },
    ];
    await open(page, '/');
    await expect.poll(() => notices, { timeout: 10_000 }).toBeGreaterThan(5);
    await expect(lage(page).getByText('−2,1 mnkr')).toHaveCount(1);
    await expect(lage(page).locator(TILES)).toHaveCount(4);
  });
  test('while the areas are read the tiles keep their shape', async ({ page, api }) => {
    api.areasDelay = 1500;
    await page.goto('/');
    await expect(lage(page)).toHaveAttribute('aria-busy', 'true');
    await expect(lage(page)).toHaveAttribute('aria-busy', 'false', { timeout: 5000 });
  });
  test('on a phone the tiles stand one under the other, whole, and nothing overflows', async ({ page, api: _ }) => {
    for (const viewport of [phone, narrow]) {
      await page.setViewportSize(viewport);
      await open(page, '/');
      const tops = await lage(page)
        .locator(TILES)
        .evaluateAll(list => list.map(el => Math.round(el.getBoundingClientRect().top)));
      expect(tops).toHaveLength(4);
      // Under 480 px a key figure has a row to itself (`FigureRow`, D130's amendment of 2026-11-23, item 3): two side
      // by side broke a value over two lines.
      for (let i = 1; i < tops.length; i++) expect(tops[i]).toBeGreaterThan(tops[i - 1]! + 50);
      expect(await lage(page).evaluate(el => el.scrollWidth > el.clientWidth)).toBe(false);
      // No word of a tile is cut or pushed outside it (1.4.10).
      expect(await reflowProblems(page, lage(page))).toEqual([]);
    }
  });
});
