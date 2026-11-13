import {
  announcements,
  composer,
  desktop,
  expect,
  expectNoAxeViolations,
  narrow,
  open,
  phone,
  reflowProblems,
  silentSaidIn,
  test,
} from './support';

import { manifest as communication } from '../../connectors/communication/connector.mjs';

const title = (text: string) => encodeURIComponent(text);
/** A list or a table is its view's page (D116), opened from Hem with Hem as the way back. */
const directory = `/tools/phonebook.directory?title=${title('Sök i telefonboken')}&from=%2F`;
const team = `/tools/phonebook.team?title=${title('Mitt teams kontaktlista')}&from=%2F`;
/** One thing is a peek beside the page it was opened from. */
const card = `/?open=phonebook.person&open-title=Kontaktkort&open-input=${encodeURIComponent(JSON.stringify({ ref: 'person:p1003' }))}`;

/**
 * Declared views (D38): a connector says what its output holds and Startsidan draws it. The phone book is the example:
 * the mocked API is answered by the connector itself, so what is tested is its real manifest drawn by the one renderer.
 * A table or a list is the view's own page, one record lies in the panel beside the page (D116). Everything here works
 * without a model.
 */
test.describe('a declared table or list on its page', () => {
  test.use({ viewport: desktop });

  test('a table is a table: named columns, numbers that call, addresses that write, and no axe violations', async ({
    page,
    api: _,
  }) => {
    await open(page, directory);
    const panel = page.getByRole('main');
    await expect(panel.getByRole('heading', { level: 1, name: 'Sök i telefonboken' })).toBeVisible();
    // No "Samtal" column of chips: a row goes into a conversation only beside a conversation's own box (D112 item 7).
    await expect(panel.getByRole('columnheader')).toHaveText(['Namn', 'Titel', 'Enhet', 'Telefon', 'Mobil', 'E-post']);
    await expect(panel.getByRole('row')).toHaveCount(15);
    await expect(panel.getByRole('link', { name: '0980-319 203' })).toHaveAttribute('href', 'tel:0980319203');
    await expect(panel.getByRole('link', { name: 'anna.lindqvist@kommun.example' })).toHaveAttribute(
      'href',
      'mailto:anna.lindqvist@kommun.example',
    );
    await expect(panel.getByText('14 rader · Telefonboken')).toBeVisible();
    await expect(panel.getByText('Skyddad Person')).toHaveCount(0);
    await expectNoAxeViolations(page);
  });

  test('typing asks the capability again: the field keeps the focus, the address carries the question, and the count is spoken', async ({
    page,
    api: _,
  }) => {
    await open(page, '/');
    await page.goto(directory);
    const panel = page.getByRole('main');
    const field = panel.getByRole('searchbox', { name: 'Sök i telefonboken' });
    await field.fill('lärare');
    await expect(panel.getByRole('row')).toHaveCount(3);
    await expect(field).toBeFocused();
    // The search is in the address with the page's name and its way back kept.
    await expect(page).toHaveURL(/input=.*l%C3%A4rare.*&title=S%C3%B6k.*&from=%2F$/);
    await expect.poll(() => announcements(page)).toContainEqual(expect.stringContaining('2 kontakter'));
    // The choice is the capability's own input too: "Min enhet" narrows to the unit Startsidan knows the person by.
    await field.fill('');
    await panel.getByRole('combobox', { name: 'Sök i', exact: true }).click();
    await page.getByRole('option', { name: 'Min enhet' }).click();
    await expect(panel.getByRole('row')).toHaveCount(6);
    await expect(page).toHaveURL(/scope/);
    await field.fill('xyzzy');
    await expect(panel.getByRole('paragraph').filter({ hasText: 'Inga träffar i telefonboken.' })).toBeVisible();
    await expect
      .poll(() => announcements(page))
      .toContainEqual(expect.stringContaining('Inga träffar i telefonboken.'));
    await expectNoAxeViolations(page);
    // A search replaces the address: one step back leaves the page, however much was typed.
    await page.goBack();
    await expect(page).toHaveURL('/');
  });

  test('a row opens the contact card beside the list, one thing with no way into another, and ✕ returns to the rows as they were', async ({
    page,
    api: _,
  }) => {
    await open(page, directory.replace('?', `?input=${encodeURIComponent(JSON.stringify({ query: 'lärare' }))}&`));
    const panel = page.getByRole('main');
    await expect(panel.getByRole('searchbox')).toHaveValue('lärare');
    await panel.getByRole('link', { name: 'Anna Lindqvist' }).click();
    const contact = page.getByRole('dialog', { name: 'Kontaktkort' });
    await expect(contact.getByText('Anna Lindqvist')).toBeVisible();
    // The contact card is one thing beside the list's page (D116): the focus is on its name at the panel's start, which
    // says it, and there is no "Tillbaka" inside the panel, since the list it came from is the page under it.
    await expect(contact.getByRole('heading', { level: 2, name: 'Kontaktkort', exact: true })).toBeFocused();
    await expect(contact.getByRole('navigation')).toHaveCount(0);
    await expect(contact.getByRole('button', { name: 'Tillbaka' })).toHaveCount(0);
    await expect(contact.getByText('Rum')).toBeVisible();
    await expect(contact.getByRole('link', { name: '0980-319 203' })).toHaveAttribute('href', 'tel:0980319203');
    await expect(contact.getByRole('link', { name: /Öppna i telefonboken/ })).toHaveAttribute('target', '_blank');
    // A contact card is no record: no page of its own is offered in the panel.
    await expect(contact.getByRole('link', { name: 'Öppna som sida' })).toHaveCount(0);
    await expectNoAxeViolations(page);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(panel.getByRole('row')).toHaveCount(3);
    await expect(panel.getByRole('searchbox')).toHaveValue('lärare');
    // Back on the rows, focus is on the name that led away.
    await expect(panel.getByRole('link', { name: 'Anna Lindqvist' })).toBeFocused();
  });

  test('the keyboard reaches the field, the choice, each name and each number, in the order they are read', async ({
    page,
    api: _,
  }) => {
    await open(page, directory.replace('?', `?input=${encodeURIComponent(JSON.stringify({ query: 'lindqvist' }))}&`));
    const panel = page.getByRole('main');
    await panel.getByRole('searchbox').focus();
    const stops: string[] = [];
    for (let i = 0; i < 7; i++) {
      await page.keyboard.press('Tab');
      stops.push(
        await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          return (el?.getAttribute('aria-label') ?? el?.textContent ?? '').trim();
        }),
      );
    }
    // A row goes into a conversation only beside a conversation's own box (D112 item 7); a view's page has none.
    expect(stops.join(' | ')).toContain('Anna Lindqvist | 0980-319 203 | anna.lindqvist@kommun.example');
    expect(stops).not.toContain('Lägg till i samtalet');
  });

  test("the calendar's rooms are a table like any connector's: named columns, seats as numbers, and no axe violations", async ({
    page,
    api: _,
  }) => {
    await open(page, `/tools/calendar.rooms?title=${title('Mötesrum')}`);
    const panel = page.getByRole('main');
    await expect(panel.getByRole('columnheader')).toHaveText(['Rum', 'Platser', 'Utrustning']);
    await expect(panel.getByRole('row')).toHaveCount(8);
    await expect(panel.getByRole('row').filter({ hasText: 'Boken' })).toContainText('projektor, mikrofon, hörslinga');
    await expect(panel.getByText('7 rader · Kalendern')).toBeVisible();
    // The calendar is no search source, so a room is not offered to the conversation as a chip.
    await expect(panel.getByRole('button', { name: 'Lägg till i samtalet' })).toHaveCount(0);
    await expectNoAxeViolations(page);
  });

  test('the combined errand list: rows from two systems that each open in their own, the missing system named, and no axe violations', async ({
    page,
    api: _,
  }) => {
    await open(page, `/tools/clew.errands?title=${title('Mina ärenden')}&from=%2F`);
    const panel = page.getByRole('main');
    await expect(panel.getByRole('listitem')).toHaveCount(3);
    // What waits on the person is first and is the only row with a toned badge; the system is a word on every row.
    const first = panel.getByRole('listitem').first();
    await expect(first).toContainText('IK-26110007 · Behörighet, Beställning');
    await expect(first).toContainText('Dig');
    await expect(first).toContainText('Ärendesystemet');
    await expect(panel.getByRole('listitem').nth(1)).toContainText('Bygglovssystemet');
    // A row is a link into the connector it came from, never into the list's own.
    await expect(panel.getByRole('link', { name: 'IK-26110007 · Behörighet, Beställning' })).toHaveAttribute(
      'href',
      /open=sm\.errand/,
    );
    await expect(panel.getByRole('link', { name: 'BYGG 2026-000317 · Bygglov, Komplettering' })).toHaveAttribute(
      'href',
      /open=permits\.errand/,
    );
    // A short list is never read as the whole truth.
    await expect(panel.getByText('Verksamhetssystemet svarade inte.')).toBeVisible();
    await expectNoAxeViolations(page);
    // Keyboard: the row's link opens the errand beside the list, read live from its own system.
    await panel.getByRole('link', { name: 'IK-26110007 · Behörighet, Beställning' }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/^[^?]*\/tools\/clew\.errands\?.*open=sm\.errand/);
    await expect(page.getByRole('dialog').getByText('Ny medarbetare behöver konto i elevregistret')).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test('a list opened beside a conversation is its page, with the conversation as the way back', async ({
    page,
    api: _,
  }) => {
    // An address from before D116 that opened the list beside the conversation leads to the list's page instead,
    // replacing itself, and names the conversation as the way back.
    await open(page, `/conversations/fraga?open=phonebook.team&open-title=${title('Mitt teams kontaktlista')}`);
    await expect(page).toHaveURL(
      `/tools/phonebook.team?title=${title('Mitt teams kontaktlista').replace(/%20/g, '+')}&from=%2Fconversations%2Ffraga`,
    );
    const panel = page.getByRole('main');
    await expect(panel.getByRole('heading', { level: 1, name: 'Mitt teams kontaktlista' })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(panel.getByRole('listitem')).toHaveCount(5);
    await expect(panel.getByRole('searchbox')).toHaveCount(0);
    await expect(panel.getByRole('listitem').filter({ hasText: 'Hassan Ali' })).toContainText('Lärare');
    await expect(
      panel.getByRole('listitem').filter({ hasText: 'Hassan Ali' }).getByRole('link', { name: '070-174 06 12' }),
    ).toHaveAttribute('href', 'tel:0701740612');
    await expect(panel.getByRole('link', { name: 'Samtalet' })).toHaveAttribute('href', '/conversations/fraga');
    await expectNoAxeViolations(page);
  });

  test('a name typed in the box finds the person: the hit opens the contact card here, and has no review date to miss', async ({
    page,
    api: _,
  }) => {
    // The hits are rows: an address that opened them beside Hem is the search's page (D116).
    await open(
      page,
      `/?open=clew.search&open-title=${title('Källor')}&open-input=${encodeURIComponent(JSON.stringify({ query: 'Anna Lindqvist' }))}`,
    );
    await expect(page).toHaveURL(/^[^?]*\/tools\/clew\.search\?input=.*&title=K%C3%A4llor&from=%2F$/);
    const hits = page.getByRole('main');
    await expect(hits.getByRole('heading', { level: 1, name: 'Källor' })).toBeVisible();
    await expect(hits.getByText('Lärare · Bergsåkers skola')).toBeVisible();
    await expect(hits.getByText('Granskningsdatum saknas')).toHaveCount(0);
    await expect(hits.getByRole('link', { name: 'Öppna i Telefonboken' })).toBeVisible();
    await expectNoAxeViolations(page);
    await hits.getByRole('link', { name: 'Kontaktkort' }).click();
    await expect(
      page.getByRole('dialog', { name: 'Kontaktkort' }).getByRole('link', { name: '0980-319 203' }),
    ).toBeVisible();
  });
});

test.describe("the calendar's own reads in the side panel", () => {
  test.use({ viewport: desktop });

  // D32: a calendar read is drawn by the calendar family, never as label/value pairs. Today is the day strip with its gaps named; the week is the list with a heading per day.
  test('Dagens möten is the day strip with the free gaps under it', async ({ page, api: _ }) => {
    await open(page, `/?open=calendar.today&open-title=${title('Dagens möten')}`);
    const panel = page.getByRole('dialog', { name: 'Dagens möten' });
    await expect(panel.getByText('Du tittar på onsdag 4 november i din kalender.')).toBeVisible();
    await expect(panel.getByRole('group', { name: 'onsdag 4 november' })).toBeVisible();
    await expect(panel.getByText('Rektorsmöte', { exact: true })).toBeVisible();
    await expect(panel.getByText('Lediga luckor: 10:30–12:00.')).toBeVisible();
    await expect(panel.getByText('events', { exact: true })).toHaveCount(0);
    await expect(panel.getByText('gaps', { exact: true })).toHaveCount(0);
    await expectNoAxeViolations(page);
  });

  test('Hela veckan is the list with a heading per day', async ({ page, api: _ }) => {
    await open(page, `/?open=calendar.week&open-title=${title('Hela veckan')}`);
    const panel = page.getByRole('dialog', { name: 'Hela veckan' });
    await expect(panel.getByRole('group', { name: 'Vecka 45, 2–6 november' })).toBeVisible();
    await expect(panel.getByText('Morgonmöte ledningsgrupp')).toHaveCount(5);
    await expect(panel.getByText('events', { exact: true })).toHaveCount(0);
    await expectNoAxeViolations(page);
  });
});

test.describe('a declared view under an answer', () => {
  test.use({ viewport: desktop });
  test('the latest answer draws its view from the source, a few rows of it, and the whole view is one button away', async ({
    page,
    api: _,
  }) => {
    await open(page, '/');
    await composer(page).fill('telefonboken lärare');
    await composer(page).press('Enter');
    const log = page.getByRole('log');
    await expect(log).toContainText('Sök i telefonboken: 2 rader.');
    await expect(
      log.getByRole('listitem').filter({ hasText: 'Anna Lindqvist' }).getByRole('link', { name: '0980-319 203' }),
    ).toHaveAttribute('href', 'tel:0980319203');
    await expect(log.getByRole('searchbox')).toHaveCount(0);
    await expectNoAxeViolations(page);
    // "Visa allt" is a link to the list's page, with the conversation as the way back (D116).
    const all = log.getByRole('link', { name: 'Visa allt' });
    await expect(all).toHaveAttribute('href', /^\/tools\/phonebook\.directory\?input=.*&from=%2Fconversations%2F/);
    await all.click();
    await expect(page.getByRole('main').getByRole('searchbox')).toHaveValue('lärare');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});

/** Viktigt nu as the communication connector really declares it (D71): one status field whose word is its label. */
const notices = (communication as { capabilities: Array<{ name: string; view?: object }> }).capabilities.find(
  c => c.name === 'communication.notices',
)!.view!;
test.describe("the view's header and its values (D71, artboards 4 and 7)", () => {
  test.use({ viewport: desktop });

  test('the page names the view, its system and its count, and a seat count reads with its unit', async ({
    page,
    api: _,
  }) => {
    await open(page, `/tools/calendar.rooms?title=${title('Mötesrum')}`);
    const panel = page.getByRole('main');
    // On the view's page (board Tool): the title with the system's chip on its line, and the count in rooms.
    await expect(panel.getByRole('heading', { level: 1, name: 'Mötesrum' })).toBeVisible();
    await expect(panel.getByText('Kalendern', { exact: true }).first()).toBeVisible();
    await expect(panel.getByText('7 rum', { exact: true })).toBeVisible();
    await expect(panel.getByRole('row').filter({ hasText: 'Tallen' }).getByRole('cell').nth(1)).toHaveText(
      '12 platser',
    );
    await expect(panel.getByText(/Platser: /)).toHaveCount(0);
    await expectNoAxeViolations(page);
  });

  test('a yes or no status reads as one labelled badge, in warning only for the receipt still owed, never "Ja · Ja"', async ({
    page,
    api: _,
  }) => {
    await open(page, '/');
    await page.route('**/api/cap/communication.notices*', route =>
      route.fulfill({
        json: {
          source: 'Kommunikation',
          view: {
            ...notices,
            capability: 'communication.notices',
            connector: 'communication',
            source: 'Kommunikation',
            chip: true,
          },
          output: {
            rows: [
              {
                ref: 'communication:notice:1',
                title: 'Ny rutin vid hot och våld',
                requiresReceipt: true,
                acknowledged: true,
              },
              {
                ref: 'communication:notice:2',
                title: 'Enkät om matsalen',
                requiresReceipt: false,
                acknowledged: false,
              },
            ],
          },
        },
      }),
    );
    await open(page, `/tools/communication.notices?title=${title('Viktigt nu')}&from=%2F`);
    const panel = page.getByRole('main');
    await expect(panel.getByText('2 meddelanden', { exact: true })).toBeVisible();
    const rows = panel.getByRole('listitem');
    await expect(rows.filter({ hasText: 'Ny rutin vid hot och våld' })).toContainText('Kvitterad');
    await expect(rows.filter({ hasText: 'Enkät om matsalen' })).toContainText('Inte kvitterad');
    await expect(panel.getByText(/\bJa\b|\bNej\b/)).toHaveCount(0);
    await expectNoAxeViolations(page);
  });

  test('a system that does not answer is said on its work items, not over the page, and spoken once', async ({
    page,
    api,
  }) => {
    api.sources = [
      { connector: 'finance', state: 'idle', lastSuccess: '2026-11-04T05:00:00.000Z', error: 'unavailable' },
    ];
    await open(page, '/todo');
    // D116, amended 2026-11-12: no banner at the top of the page (D71 artboard 8's rule is replaced); the rows say it.
    await expect(page.locator('#work-fakturor')).toContainText('kan vara gammal');
    expect(await silentSaidIn(page)).toEqual([]);
    await expect.poll(() => announcements(page)).toContainEqual(expect.stringContaining('Ekonomisystemet svarar inte'));
    await expectNoAxeViolations(page);
  });

  test("the announcement waits for the system's name when the areas answer after the statuses", async ({
    page,
    api,
  }) => {
    api.sources = [
      { connector: 'finance', state: 'idle', lastSuccess: '2026-11-04T05:00:00.000Z', error: 'unavailable' },
    ];
    api.areasDelay = 600;
    // Every moment the page shows the connector's id in the name's place, however short.
    await page.addInitScript(() => {
      const shown: string[] = [];
      Object.assign(window, { idShown: shown });
      new MutationObserver(() => {
        if (document.body?.textContent?.includes('finance svarar inte')) shown.push('finance svarar inte');
      }).observe(document, { subtree: true, childList: true, characterData: true });
    });
    await open(page, '/todo');
    await expect.poll(() => announcements(page)).toContainEqual(expect.stringContaining('Ekonomisystemet svarar inte'));
    // Said once, so never with the connector's id.
    expect(await page.evaluate(() => (window as unknown as { idShown: string[] }).idShown)).toEqual([]);
    expect((await announcements(page)).filter(text => text.includes('finance svarar inte'))).toEqual([]);
  });
});

test.describe('1.4.10: a declared view at 320 px', () => {
  for (const [name, path, where] of [
    ['the table on its page, drawn as a list', directory, 'main'],
    ['the list on its page', team, 'main'],
    ['the contact card beside the page', card, 'dialog'],
  ] as const)
    test(`${name} reflows`, async ({ page, api: _ }) => {
      await page.setViewportSize(narrow);
      await open(page, path);
      const surface = page.getByRole(where);
      await expect(surface).toBeVisible();
      await expect(surface.getByRole('table')).toHaveCount(0);
      await expect(surface.getByRole('link', { name: '0980-319 203' })).toBeVisible();
      expect(await reflowProblems(page)).toEqual([]);
      await expectNoAxeViolations(page);
    });
  test('the combined errand list reflows, with the missing system still named', async ({ page, api: _ }) => {
    await page.setViewportSize(narrow);
    await open(page, `/tools/clew.errands?title=${title('Mina ärenden')}&from=%2F`);
    const dialog = page.getByRole('main');
    await expect(dialog.getByRole('link', { name: 'IK-26110007 · Behörighet, Beställning' })).toBeVisible();
    await expect(dialog.getByText('Verksamhetssystemet svarade inte.')).toBeVisible();
    expect(await reflowProblems(page)).toEqual([]);
    await expectNoAxeViolations(page);
  });
});

/**
 * D97 item 6: a view that says which property of a row holds a person's key links the row to the person. The planner's
 * table (`talks.talks`) declares it; a row that also opens a read keeps that on its name and gets the person as a link
 * of its own at the row's end, since one cell cannot be two links. A detail's heading links the same way.
 */
test.describe('a view row that names a person', () => {
  test.use({ viewport: desktop });
  const talks = {
    kind: 'table' as const,
    capability: 'talks.talks',
    connector: 'clew',
    source: 'Utvecklingssamtal',
    chip: false,
    title: 'name',
    noun: { one: 'person', other: 'personer' },
    fields: [
      { key: 'name', label: 'Namn' },
      { key: 'state', label: 'Samtal', format: 'status' as const, tones: { Saknas: 'warn' as const } },
      { key: 'at', label: 'När' },
    ],
    subject: { entity: 'person' as const, key: 'userName' },
  };
  const rows = [
    { userName: 'anna', name: 'Anna Lindqvist', state: 'Bokat', at: 'mån 16 nov' },
    { userName: 'karin', name: 'Karin Lindqvist', state: 'Saknas' },
    // A row without the key names nobody, and is not a link.
    { name: 'Utan användarnamn', state: 'Saknas' },
  ];
  const withOpen = {
    ...talks,
    open: { capability: 'talks.commitments', title: 'Åtgärdspunkter', params: { person: 'userName' } },
  };
  const serve = (page: import('@playwright/test').Page, view: object) =>
    page.route('**/api/cap/talks.talks*', route =>
      route.fulfill({ json: { source: 'Utvecklingssamtal', view, output: { rows } } }),
    );
  const planner = `/tools/talks.talks?title=${title('Utvecklingssamtal')}&from=%2F`;

  test('the name is the link to the person, with the page as the way back; a row without the key is text', async ({
    page,
    api: _,
  }) => {
    await serve(page, talks);
    await open(page, planner);
    const panel = page.getByRole('main');
    await expect(panel.getByRole('columnheader')).toHaveText(['Namn', 'Samtal', 'När']);
    // The way back from the person is the list's page, without a way back of its own.
    await expect(panel.getByRole('link', { name: 'Anna Lindqvist', exact: true })).toHaveAttribute(
      'href',
      /^\/people\/anna\?from=%2Ftools%2Ftalks\.talks/,
    );
    await expect(panel.getByRole('link', { name: 'Karin Lindqvist', exact: true })).toBeVisible();
    await expect(panel.getByRole('link', { name: 'Utan användarnamn' })).toHaveCount(0);
    await expect(panel.getByText('Utan användarnamn')).toBeVisible();
    await expectNoAxeViolations(page);
    await panel.getByRole('link', { name: 'Anna Lindqvist', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Anna Lindqvist' })).toBeVisible();
  });

  test('a row that also opens a read keeps it on its name and has the person as its own link at the end', async ({
    page,
    api: _,
  }) => {
    await serve(page, withOpen);
    await open(page, planner);
    const panel = page.getByRole('main');
    await expect(panel.getByRole('columnheader')).toHaveText(['Namn', 'Samtal', 'När', 'Person']);
    const anna = panel.getByRole('row').filter({ hasText: 'Anna Lindqvist' });
    // The row's own read is a list (the person's action points): its page, with the planner as the way back (D116).
    await expect(anna.getByRole('link', { name: 'Anna Lindqvist', exact: true })).toHaveAttribute(
      'href',
      /^\/tools\/talks\.commitments\?input=.*&from=%2Ftools%2Ftalks\.talks/,
    );
    await expect(anna.getByRole('link', { name: 'Öppna Anna Lindqvist' })).toHaveAttribute(
      'href',
      /^\/people\/anna\?from=/,
    );
    // The row that names nobody and opens nothing has neither.
    const nobody = panel.getByRole('row').filter({ hasText: 'Utan användarnamn' });
    await expect(nobody.getByRole('link')).toHaveCount(0);
    await expectNoAxeViolations(page);
    // On a phone the table is its list: the person's link stands at the row's end.
    await page.setViewportSize(phone);
    const sheet = page.getByRole('main');
    const item = sheet.getByRole('listitem').filter({ hasText: 'Anna Lindqvist' });
    await expect(item.getByRole('link', { name: 'Öppna Anna Lindqvist' })).toHaveAttribute(
      'href',
      /^\/people\/anna\?from=/,
    );
    await expect(item.getByRole('link', { name: 'Anna Lindqvist', exact: true })).toHaveAttribute(
      'href',
      /^\/tools\/talks\.commitments\?/,
    );
    await page.evaluate(() => Promise.all(document.getAnimations().map(a => a.finished)));
    await expectNoAxeViolations(page);
  });

  test("a detail's heading is the link to the person it names", async ({ page, api: _ }) => {
    await page.route('**/api/cap/hr.employee*', route =>
      route.fulfill({
        json: {
          source: 'Personalsystemet',
          view: {
            kind: 'detail',
            capability: 'hr.employee',
            connector: 'hr',
            source: 'Personalsystemet',
            chip: false,
            title: 'name',
            fields: [{ key: 'role', label: 'Befattning' }],
            subject: { entity: 'person', key: 'userName' },
          },
          output: { name: 'Anna Lindqvist', userName: 'anna', role: 'Lärare F–3' },
        },
      }),
    );
    await open(page, `/?open=hr.employee&open-title=${title('Anställning')}`);
    const panel = page.getByRole('dialog', { name: 'Anställning' });
    const name = panel.getByRole('heading', { name: 'Anna Lindqvist' }).getByRole('link', { name: 'Anna Lindqvist' });
    await expect(name).toHaveAttribute('href', /^\/people\/anna\?from=%2F%3Fopen%3Dhr\.employee/);
    await expect(panel.getByText('Lärare F–3')).toBeVisible();
    await expectNoAxeViolations(page);
  });
});
