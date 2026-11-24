import {
  SITE,
  announcements,
  composer,
  desktop,
  expect,
  expectNoAxeViolations,
  heading,
  narrow,
  open,
  phone,
  reflowProblems,
  silentSaidIn,
  test,
} from './support';

import { manifest as communication } from '../../connectors/communication/connector.mjs';
import { events, today } from './data';

const title = (text: string) => encodeURIComponent(text);
/** A list or a table is its view's page (D116), opened from Hem with Hem as the way back. */
const directory = `/tools/phonebook.directory?title=${title('Sök i telefonboken')}&from=%2F`;
const team = `/tools/phonebook.team?title=${title('Mitt teams kontaktlista')}&from=%2F`;
/** An address from before D126 that laid one thing beside the page it was opened from. */
const card = `/?open=phonebook.person&open-title=Kontaktkort&open-input=${encodeURIComponent(JSON.stringify({ ref: 'person:p1003' }))}`;

/**
 * Declared views (D38): a connector says what its output holds and Clew draws it. The phone book is the example:
 * the mocked API is answered by the connector itself, so what is tested is its real manifest drawn by the one renderer.
 * A table or a list is the view's own page (D116), and since D126 so is one record. Everything here works without a
 * model.
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

  test('typing asks the capability again: the field keeps the focus, the words go in the read and never in the address, and the count is spoken', async ({
    page,
    api: _,
  }) => {
    await open(page, '/');
    await page.goto(directory);
    const panel = page.getByRole('main');
    const field = panel.getByRole('searchbox', { name: 'Sök i telefonboken' });
    const asked = page.waitForRequest(
      r =>
        r.method() === 'POST' &&
        new URL(r.url()).pathname === '/api/cap/phonebook.directory' &&
        (r.postDataJSON() as { query?: string } | null)?.query === 'lärare',
    );
    await field.fill('lärare');
    expect(new URL((await asked).url()).search).toBe('');
    await expect(panel.getByRole('row')).toHaveCount(3);
    await expect(field).toBeFocused();
    // What is typed is a name as often as not, so it never enters the address (D100 item 5): the page's name and its
    // way back stay as they were.
    await expect(page).toHaveURL(directory);
    await expect.poll(() => announcements(page)).toContainEqual(expect.stringContaining('2 kontakter'));
    // The choice is the capability's own input too: "Min enhet" narrows to the unit Clew knows the person by.
    await field.fill('');
    await panel.getByRole('combobox', { name: 'Sök i', exact: true }).click();
    await page.getByRole('option', { name: 'Min enhet' }).click();
    await expect(panel.getByRole('row')).toHaveCount(6);
    // A view's page names its input `input` (D116); `open-input` was the panel's, which D126 removed.
    await expect(page).toHaveURL(url => url.searchParams.get('input') === JSON.stringify({ scope: 'unit' }));
    await field.fill('xyzzy');
    await expect(panel.getByRole('paragraph').filter({ hasText: 'Inga träffar i telefonboken.' })).toBeVisible();
    const input = new URL(page.url()).searchParams.get('input');
    expect(JSON.parse(input ?? '{}')).toEqual({ scope: 'unit' });
    await expect
      .poll(() => announcements(page))
      .toContainEqual(expect.stringContaining('Inga träffar i telefonboken.'));
    await expectNoAxeViolations(page);
    // A search replaces the address: one step back leaves the page, however much was typed.
    await page.goBack();
    await expect(page).toHaveURL('/');
  });

  test('a name opens the contact card’s own page with the list as its way back, and Back returns to the rows as they were (D126 rule 1)', async ({
    page,
    api: _,
  }) => {
    await open(page, directory.replace('?', `?input=${encodeURIComponent(JSON.stringify({ query: 'lärare' }))}&`));
    const main = page.getByRole('main');
    await expect(main.getByRole('searchbox')).toHaveValue('lärare');
    const name = main.getByRole('link', { name: 'Anna Lindqvist' });
    await name.focus();
    await page.keyboard.press('Enter');
    // One thing is a page of its own (D126 rule 1), nothing over the list: the record's name is its heading, with its
    // room, its number that calls and its way out to the phone book in a new tab.
    await expect(page).toHaveURL(/^[^?]*\/tools\/phonebook\.person\?.*from=/);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(main.getByRole('heading', { level: 1, name: 'Anna Lindqvist' })).toBeVisible();
    await expect(main.getByText('Rum')).toBeVisible();
    await expect(main.getByRole('link', { name: '0980-319 203' })).toHaveAttribute('href', 'tel:0980319203');
    await expect(main.getByRole('link', { name: /Öppna i telefonboken/ })).toHaveAttribute('target', '_blank');
    // Its way back is the list as it was, with its question.
    await expect(main.locator('a[href^="/tools/phonebook.directory?"]').first()).toHaveAttribute('href', /l%C3%A4rare/);
    await expectNoAxeViolations(page);
    await page.goBack();
    await expect(main.getByRole('row')).toHaveCount(3);
    await expect(main.getByRole('searchbox')).toHaveValue('lärare');
    // Back on the rows, focus is on the name that led away.
    await expect(name).toBeFocused();
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
    // A row is a link into the connector it came from, never into the list's own: the errand's own page (D126 rule
    // 1), with the list as the way back.
    await expect(panel.getByRole('link', { name: 'IK-26110007 · Behörighet, Beställning' })).toHaveAttribute(
      'href',
      /^\/tools\/sm\.errand\?input=.*&from=%2Ftools%2Fclew\.errands/,
    );
    await expect(panel.getByRole('link', { name: 'BYGG 2026-000317 · Bygglov, Komplettering' })).toHaveAttribute(
      'href',
      /^\/tools\/permits\.errand\?input=.*&from=%2Ftools%2Fclew\.errands/,
    );
    // A short list is never read as the whole truth.
    await expect(panel.getByText('Verksamhetssystemet svarade inte.')).toBeVisible();
    await expectNoAxeViolations(page);
    // Keyboard: the row's link opens the errand's page, read live from its own system, and nothing over the list.
    await panel.getByRole('link', { name: 'IK-26110007 · Behörighet, Beställning' }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/^[^?]*\/tools\/sm\.errand\?/);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(panel.getByText('Ny medarbetare behöver konto i elevregistret')).toBeVisible();
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

  test('a name typed in the box finds the person: the hit opens the contact card’s page, and has no review date to miss', async ({
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
    // The contact card is a page of its own (D126 rule 1), with the search as its way back; nothing opens over it.
    await hits.getByRole('link', { name: 'Kontaktkort' }).click();
    await expect(page).toHaveURL(/^[^?]*\/tools\/phonebook\.person\?.*from=%2Ftools%2Fclew\.search/);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(hits.getByRole('link', { name: '0980-319 203' })).toBeVisible();
  });
});

test.describe("the calendar's own reads on their page", () => {
  test.use({ viewport: desktop });

  // D32: a calendar read is drawn by the calendar family, never as label/value pairs. Today is the day strip with its
  // gaps named; the week is the list with a heading per day. Each is its own page since D126 rule 3: the address that
  // laid it beside Hem leads there, with nothing over the page.
  test('Dagens möten is the day strip with the free gaps under it', async ({ page, api: _ }) => {
    await open(page, `/?open=calendar.today&open-title=${title('Dagens möten')}`);
    await expect(page).toHaveURL(/^[^?]*\/tools\/calendar\.today\?/);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const panel = page.getByRole('main');
    await expect(panel.getByRole('heading', { level: 1, name: 'Dagens möten' })).toBeVisible();
    await expect(panel.getByText('Du tittar på onsdag 4 november i din kalender.')).toBeVisible();
    await expect(panel.getByRole('group', { name: 'onsdag 4 november' })).toBeVisible();
    await expect(panel.getByText('Rektorsmöte', { exact: true })).toBeVisible();
    await expect(panel.getByText('Lediga luckor: 10:30–12:00.')).toBeVisible();
    await expect(panel.getByText('events', { exact: true })).toHaveCount(0);
    await expect(panel.getByText('gaps', { exact: true })).toHaveCount(0);
    // An entry is a link to its own place in Kalender (D126 rule 1), never a button that does nothing (WA-M2), and the
    // summary's promise of Enter holds.
    const entry = panel.getByRole('link', { name: /Rektorsmöte/ });
    await expect(entry).toHaveAttribute('href', '/calendar?date=2026-11-04&view=day&entry=e1');
    await expect(panel.getByRole('button', { name: /Rektorsmöte/ })).toHaveCount(0);
    await expect(panel.getByText(/Retur på en post öppnar den\./)).toBeAttached();
    await expectNoAxeViolations(page);
    // Kalender's week holds the meeting, and following the link opens it in the page's pane.
    await page.route(
      url => url.pathname === '/api/calendar',
      async route => {
        const from = new URL(route.request().url()).searchParams.get('from') ?? '2026-11-02';
        await route.fulfill({ json: { from, events: [...events(from), ...today.events], proposals: [] } });
      },
    );
    await entry.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/calendar\?date=2026-11-04&view=day&entry=e1$/);
    await expect(
      page.getByRole('dialog', { name: 'Rektorsmöte' }).or(page.getByRole('complementary', { name: 'Rektorsmöte' })),
    ).toBeVisible();
  });

  test('Hela veckan is the list with a heading per day', async ({ page, api: _ }) => {
    await open(page, `/?open=calendar.week&open-title=${title('Hela veckan')}`);
    await expect(page).toHaveURL(/^[^?]*\/tools\/calendar\.week\?/);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const panel = page.getByRole('main');
    await expect(panel.getByRole('heading', { level: 1, name: 'Hela veckan' })).toBeVisible();
    const week = panel.getByRole('group', { name: 'Vecka 45, 2–6 november' });
    await expect(week).toBeVisible();
    await expect(heading(week, 2)).toHaveCount(5);
    await expect(panel.getByText('Morgonmöte ledningsgrupp')).toHaveCount(5);
    await expect(panel.getByText('events', { exact: true })).toHaveCount(0);
    // Each meeting leads to its own day in Kalender's week (WA-M2).
    await expect(panel.getByRole('link', { name: /Morgonmöte ledningsgrupp/ }).first()).toHaveAttribute(
      'href',
      /^\/calendar\?date=2026-11-02&view=week&entry=v0$/,
    );
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
    ['the contact card, its own page from an address that laid it beside Hem', card, 'main'],
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
 *
 * D122: the row holds the source's key, a user name, and the link goes to the person's id, which the server answers in
 * `view.people` for the user names someone of the reader's organisation holds. The ids here differ from the user names,
 * so a link built from the user name would fail, and a row whose user name nobody holds is text.
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
    // The ids of the people the rows name, by the user name the source sent (D122); `bo.ek` is held by nobody.
    people: { 'anna.lindqvist': 'anna', 'karin.lindqvist': 'karin' },
  };
  const rows = [
    { userName: 'anna.lindqvist', name: 'Anna Lindqvist', state: 'Bokat', at: 'mån 16 nov' },
    { userName: 'karin.lindqvist', name: 'Karin Lindqvist', state: 'Saknas' },
    // A row without the key names nobody, and is not a link.
    { name: 'Utan användarnamn', state: 'Saknas' },
    // Nor is a row whose user name nobody of the reader's organisation holds.
    { userName: 'bo.ek', name: 'Bo Ek', state: 'Saknas' },
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

  test('the name is the link to the person by id, with the page as the way back; a row naming nobody is text', async ({
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
    await expect(panel.getByRole('link', { name: 'Karin Lindqvist', exact: true })).toHaveAttribute(
      'href',
      /^\/people\/karin\?from=/,
    );
    await expect(panel.getByRole('link', { name: 'Utan användarnamn' })).toHaveCount(0);
    await expect(panel.getByText('Utan användarnamn')).toBeVisible();
    await expect(panel.getByRole('link', { name: 'Bo Ek' })).toHaveCount(0);
    await expect(panel.getByText('Bo Ek')).toBeVisible();
    await expectNoAxeViolations(page);
    await panel.getByRole('link', { name: 'Anna Lindqvist', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Anna Lindqvist' })).toBeVisible();
  });

  test('a row that also opens a read keeps the person on its name and has the read as its own link, named for the row', async ({
    page,
    api: _,
  }) => {
    await serve(page, withOpen);
    await open(page, planner);
    const panel = page.getByRole('main');
    // A person's name always leads to the person (the app critique of 2026-11-13); the row's own read has a column of
    // its own, headed with the read's title.
    await expect(panel.getByRole('columnheader')).toHaveText(['Namn', 'Samtal', 'När', 'Åtgärdspunkter']);
    const anna = panel.getByRole('row').filter({ hasText: 'Anna Lindqvist' });
    await expect(anna.getByRole('link', { name: 'Anna Lindqvist', exact: true })).toHaveAttribute(
      'href',
      /^\/people\/anna\?from=%2Ftools%2Ftalks\.talks/,
    );
    // The row's own read is a list (the person's action points): its page, with the planner as the way back (D116).
    await expect(anna.getByRole('link', { name: 'Åtgärdspunkter för Anna Lindqvist' })).toHaveAttribute(
      'href',
      /^\/tools\/talks\.commitments\?input=.*&from=%2Ftools%2Ftalks\.talks/,
    );
    // The row without the key names nobody: its name is text, and its read is still its own link.
    const nobody = panel.getByRole('row').filter({ hasText: 'Utan användarnamn' });
    await expect(nobody.getByRole('link', { name: 'Utan användarnamn', exact: true })).toHaveCount(0);
    // A user name nobody holds names nobody: its name is text, and its read is still its own link, to its page.
    const unheld = panel.getByRole('row').filter({ hasText: 'Bo Ek' });
    await expect(unheld.getByRole('link', { name: 'Bo Ek', exact: true })).toHaveCount(0);
    await expect(unheld.getByRole('link', { name: 'Åtgärdspunkter för Bo Ek' })).toHaveAttribute(
      'href',
      /^\/tools\/talks\.commitments\?input=.*&from=%2Ftools%2Ftalks\.talks/,
    );
    await expect(unheld.getByRole('link', { name: 'Öppna Bo Ek' })).toHaveCount(0);
    await expectNoAxeViolations(page);
    // On a phone the table is its list: the read's link stands at the row's end, the name still the person's.
    await page.setViewportSize(phone);
    const sheet = page.getByRole('main');
    const item = sheet.getByRole('listitem').filter({ hasText: 'Anna Lindqvist' });
    await expect(item.getByRole('link', { name: 'Anna Lindqvist', exact: true })).toHaveAttribute(
      'href',
      /^\/people\/anna\?from=/,
    );
    await expect(item.getByRole('link', { name: 'Åtgärdspunkter för Anna Lindqvist' })).toHaveAttribute(
      'href',
      /^\/tools\/talks\.commitments\?/,
    );
    await page.evaluate(() => Promise.all(document.getAnimations().map(a => a.finished)));
    await expectNoAxeViolations(page);
  });

  test('a row whose read is one thing opens its page from its own link, the name still the person’s', async ({
    page,
    api: _,
  }) => {
    // Absence per person as the HR system declares it (`connectors/hr`): the name names the employee (`subject`), the
    // row opens the employee's pattern (`open`, a detail, one thing, its own page since D126 rule 1).
    await page.route('**/api/cap/hr.absenceOverview*', route =>
      route.fulfill({
        json: {
          source: 'Personalsystemet',
          view: {
            kind: 'table',
            capability: 'hr.absenceOverview',
            connector: 'hr',
            source: 'Personalsystemet',
            chip: false,
            external: true,
            title: 'name',
            ref: 'ref',
            noun: { one: 'medarbetare', other: 'medarbetare' },
            subject: { entity: 'person', key: 'person' },
            open: { capability: 'hr.absencePattern', title: 'Mönster', params: { ref: 'ref' } },
            fields: [
              { key: 'name', label: 'Namn' },
              { key: 'periods', label: 'Perioder', format: 'number' },
            ],
            // The id of the person the row names, by the user name the source sent (D122).
            people: { anna: 'anna' },
          },
          output: { rows: [{ ref: 'hr:emp:1', person: 'anna', name: 'Anna Lindqvist', periods: 3 }] },
        },
      }),
    );
    await open(page, `/tools/hr.absenceOverview?title=${title('Frånvaro per person')}&from=%2F`);
    const main = page.getByRole('main');
    const anna = main.getByRole('row').filter({ hasText: 'Anna Lindqvist' });
    await expect(anna.getByRole('link', { name: 'Anna Lindqvist', exact: true })).toHaveAttribute(
      'href',
      /^\/people\/anna\?from=%2Ftools%2Fhr\.absenceOverview/,
    );
    const pattern = anna.getByRole('link', { name: 'Mönster för Anna Lindqvist' });
    await expect(pattern).toHaveAttribute(
      'href',
      /^\/tools\/hr\.absencePattern\?input=.*&from=%2Ftools%2Fhr\.absenceOverview/,
    );
    // A connector outside Clew: what it shows is not stored in Clew, and the page says so.
    await expect(main.getByText(`Inget av det sparas på ${SITE}.`)).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test("a detail's page names the person it is about with a link to them", async ({ page, api }) => {
    // A read the person may open (D116); one that is not in their list of views has no page.
    api.views.push({ capability: 'hr.employee', title: 'Anställning', kind: 'detail' });
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
            people: { 'Anna.Lindqvist': 'anna' },
          },
          output: { name: 'Anna Lindqvist', userName: 'Anna.Lindqvist', role: 'Lärare F–3' },
        },
      }),
    );
    // An address that laid the record beside Hem is the record's page (D126 rule 3), with Hem as its way back.
    await open(page, `/?open=hr.employee&open-title=${title('Anställning')}`);
    await expect(page).toHaveURL(/^[^?]*\/tools\/hr\.employee\?/);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const panel = page.getByRole('main');
    const name = panel.getByRole('link', { name: 'Anna Lindqvist', exact: true });
    await expect(name).toHaveAttribute('href', /^\/people\/anna\?from=%2Ftools%2Fhr\.employee/);
    await expect(panel.getByText('Lärare F–3')).toBeVisible();
    await expectNoAxeViolations(page);
  });
});
