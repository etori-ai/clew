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
  test,
} from './support';

import { manifest as communication } from '../../connectors/communication/connector.mjs';

const title = (text: string) => encodeURIComponent(text);
const directory = `/?open=phonebook.directory&open-title=${title('Sök i telefonboken')}`;
const team = `/?open=phonebook.team&open-title=${title('Mitt teams kontaktlista')}`;
const card = `/?open=phonebook.person&open-title=Kontaktkort&open-input=${encodeURIComponent(JSON.stringify({ ref: 'person:p1003' }))}`;

/**
 * Declared views (D38): a connector says what its output holds and Startsidan draws it. The phone book is the example:
 * the mocked API is answered by the connector itself, so what is tested is its real manifest drawn by the one renderer.
 * Everything here works without a model.
 */
test.describe('a declared view in the side panel', () => {
  test.use({ viewport: desktop });

  test('a table is a table: named columns, numbers that call, addresses that write, and no axe violations', async ({
    page,
    api: _,
  }) => {
    await open(page, directory);
    const panel = page.getByRole('dialog', { name: 'Sök i telefonboken' });
    await expect(panel.getByRole('columnheader')).toHaveText([
      'Namn',
      'Titel',
      'Enhet',
      'Telefon',
      'Mobil',
      'E-post',
      'Samtal',
    ]);
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
    await open(page, directory);
    const panel = page.getByRole('dialog', { name: 'Sök i telefonboken' });
    const field = panel.getByRole('searchbox', { name: 'Sök i telefonboken' });
    await field.fill('lärare');
    await expect(panel.getByRole('row')).toHaveCount(3);
    await expect(field).toBeFocused();
    await expect(page).toHaveURL(/input=.*l%C3%A4rare/);
    await expect.poll(() => announcements(page)).toContainEqual(expect.stringContaining('2 kontakter'));
    // The choice is the capability's own input too: "Min enhet" narrows to the unit Startsidan knows the person by.
    await field.fill('');
    await panel.getByRole('combobox', { name: 'Sök i', exact: true }).click();
    await page.getByRole('option', { name: 'Min enhet' }).click();
    await expect(panel.getByRole('row')).toHaveCount(6);
    await expect(page).toHaveURL(/scope/);
    await field.fill('xyzzy');
    await expect(panel.getByRole('heading', { name: 'Inga träffar i telefonboken.' })).toBeVisible();
    await expect
      .poll(() => announcements(page))
      .toContainEqual(expect.stringContaining('Inga träffar i telefonboken.'));
    await expectNoAxeViolations(page);
    // Back undoes nothing but the view: one step leaves the panel, however much was typed.
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('a row opens the contact card of the same connector, and Tillbaka returns to the rows as they were', async ({
    page,
    api: _,
  }) => {
    await open(page, `${directory}&open-input=${encodeURIComponent(JSON.stringify({ query: 'lärare' }))}`);
    const panel = page.getByRole('dialog', { name: 'Sök i telefonboken' });
    await expect(panel.getByRole('searchbox')).toHaveValue('lärare');
    await panel.getByRole('link', { name: 'Anna Lindqvist' }).click();
    const contact = page.getByRole('dialog', { name: 'Kontaktkort' });
    await expect(contact.getByText('Anna Lindqvist')).toBeVisible();
    // The panel stayed open and the view in it changed: the new view is named aloud and focus is in it, on the way back.
    await expect(contact.getByRole('button', { name: 'Tillbaka' })).toBeFocused();
    await expect.poll(() => announcements(page)).toContainEqual(expect.stringContaining('Kontaktkort'));
    await expect(contact.getByText('Rum')).toBeVisible();
    await expect(contact.getByRole('link', { name: '0980-319 203' })).toHaveAttribute('href', 'tel:0980319203');
    await expect(contact.getByRole('link', { name: /Öppna i telefonboken/ })).toHaveAttribute('target', '_blank');
    await expectNoAxeViolations(page);
    await contact.getByRole('button', { name: 'Tillbaka' }).click();
    await expect(page.getByRole('dialog', { name: 'Sök i telefonboken' }).getByRole('row')).toHaveCount(3);
    await expect(page.getByRole('dialog', { name: 'Sök i telefonboken' }).getByRole('searchbox')).toHaveValue('lärare');
    // Back on the rows, focus is on the name that led away.
    await expect(
      page.getByRole('dialog', { name: 'Sök i telefonboken' }).getByRole('link', { name: 'Anna Lindqvist' }),
    ).toBeFocused();
  });

  test('the keyboard reaches the field, the choice, each name and each number, in the order they are read', async ({
    page,
    api: _,
  }) => {
    await open(page, `${directory}&open-input=${encodeURIComponent(JSON.stringify({ query: 'lindqvist' }))}`);
    const panel = page.getByRole('dialog', { name: 'Sök i telefonboken' });
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
    expect(stops.join(' | ')).toContain(
      'Anna Lindqvist | 0980-319 203 | anna.lindqvist@kommun.example | Lägg till i samtalet',
    );
  });

  test("the calendar's rooms are a table like any connector's: named columns, seats as numbers, and no axe violations", async ({
    page,
    api: _,
  }) => {
    await open(page, `/?open=calendar.rooms&open-title=${title('Mötesrum')}`);
    const panel = page.getByRole('dialog', { name: 'Mötesrum' });
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
    await open(page, `/?open=clew.errands&open-title=${title('Mina ärenden')}`);
    const panel = page.getByRole('dialog', { name: 'Mina ärenden' });
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
    // Keyboard: the row's link opens the errand, read live from its own system.
    await panel.getByRole('link', { name: 'IK-26110007 · Behörighet, Beställning' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Ny medarbetare behöver konto i elevregistret')).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test('a list is a list, and a row goes into the box as any found thing does', async ({ page, api: _ }) => {
    await open(page, team);
    const panel = page.getByRole('dialog', { name: 'Mitt teams kontaktlista' });
    await expect(panel.getByRole('listitem')).toHaveCount(5);
    await expect(panel.getByRole('searchbox')).toHaveCount(0);
    await expect(panel.getByRole('listitem').filter({ hasText: 'Hassan Ali' })).toContainText('Lärare');
    await expect(
      panel.getByRole('listitem').filter({ hasText: 'Hassan Ali' }).getByRole('link', { name: '070-174 06 12' }),
    ).toHaveAttribute('href', 'tel:0701740612');
    await expectNoAxeViolations(page);
    await panel
      .getByRole('listitem')
      .filter({ hasText: 'Hassan Ali' })
      .getByRole('button', { name: 'Lägg till i samtalet' })
      .click();
    await expect(
      panel.getByRole('listitem').filter({ hasText: 'Hassan Ali' }).getByRole('button', { name: 'I samtalet' }),
    ).toBeDisabled();
  });

  test('a name typed in the box finds the person: the hit opens the contact card here, and has no review date to miss', async ({
    page,
    api: _,
  }) => {
    await open(
      page,
      `/?open=clew.search&open-title=${title('Källor')}&open-input=${encodeURIComponent(JSON.stringify({ query: 'Anna Lindqvist' }))}`,
    );
    const hits = page.getByRole('dialog', { name: 'Källor' });
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
    await log.getByRole('button', { name: 'Visa allt' }).click();
    await expect(page.getByRole('dialog', { name: 'Sök i telefonboken' }).getByRole('searchbox')).toHaveValue('lärare');
  });
});

/** Viktigt nu as the communication connector really declares it (D71): one status field whose word is its label. */
const notices = (communication as { capabilities: Array<{ name: string; view?: object }> }).capabilities.find(
  c => c.name === 'communication.notices',
)!.view!;
test.describe("the view's header and its values (D71, artboards 4 and 7)", () => {
  test.use({ viewport: desktop });

  test('the header names the area, the source and the count on one line, and a seat count reads with its unit', async ({
    page,
    api: _,
  }) => {
    await open(page, `/?open=calendar.rooms&open-title=${title('Mötesrum')}`);
    const panel = page.getByRole('dialog', { name: 'Mötesrum' });
    // The calendar is Clew's own: the house chip, the room's word from the menu, the system and the count in rooms.
    await expect(panel.getByText('Kalendern · 7 rum')).toBeVisible();
    await expect(panel.getByText('Mötesrum', { exact: true }).last()).toBeVisible();
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
    await open(page, `/?open=communication.notices&open-title=${title('Viktigt nu')}`);
    const panel = page.getByRole('dialog', { name: 'Viktigt nu' });
    await expect(panel.getByText('Kommunikation · 2 meddelanden')).toBeVisible();
    const rows = panel.getByRole('listitem');
    await expect(rows.filter({ hasText: 'Ny rutin vid hot och våld' })).toContainText('Kvitterad');
    await expect(rows.filter({ hasText: 'Enkät om matsalen' })).toContainText('Inte kvitterad');
    await expect(panel.getByText(/\bJa\b|\bNej\b/)).toHaveCount(0);
    await expectNoAxeViolations(page);
  });

  test('a system that does not answer is a warning banner at the top of the page, and it is spoken once', async ({
    page,
    api,
  }) => {
    api.sources = [
      { connector: 'finance', state: 'idle', lastSuccess: '2026-11-04T05:00:00.000Z', error: 'unavailable' },
    ];
    await open(page, '/');
    await expect(page.getByText('Ekonomisystemet svarar inte sedan 06:00', { exact: true })).toBeVisible();
    await expect(
      page.getByText(
        'Korten under Budget kan vara gamla. Det du skickar köas och läses tillbaka när systemet svarar.',
        {
          exact: true,
        },
      ),
    ).toBeVisible();
    await expect
      .poll(() => announcements(page))
      .toContainEqual(expect.stringContaining('Ekonomisystemet svarar inte sedan 06:00'));
    await expect(page.getByRole('button', { name: 'Försök igen' })).toBeVisible();
    await expectNoAxeViolations(page);
  });
});

test.describe('1.4.10: a declared view at 320 px', () => {
  for (const [name, path] of [
    ['the table, drawn as a list', directory],
    ['the list', team],
    ['the contact card', card],
  ] as const)
    test(`${name} reflows`, async ({ page, api: _ }) => {
      await page.setViewportSize(narrow);
      await open(page, path);
      await expect(page.getByRole('dialog')).toBeVisible();
      await expect(page.getByRole('dialog').getByRole('table')).toHaveCount(0);
      await expect(page.getByRole('dialog').getByRole('link', { name: '0980-319 203' })).toBeVisible();
      expect(await reflowProblems(page)).toEqual([]);
      await expectNoAxeViolations(page);
    });
  test('the combined errand list reflows, with the missing system still named', async ({ page, api: _ }) => {
    await page.setViewportSize(narrow);
    await open(page, `/?open=clew.errands&open-title=${title('Mina ärenden')}`);
    const dialog = page.getByRole('dialog');
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
  const planner = `/?open=talks.talks&open-title=${title('Utvecklingssamtal')}`;

  test('the name is the link to the person, with the page as the way back; a row without the key is text', async ({
    page,
    api: _,
  }) => {
    await serve(page, talks);
    await open(page, planner);
    const panel = page.getByRole('dialog', { name: 'Utvecklingssamtal' });
    await expect(panel.getByRole('columnheader')).toHaveText(['Namn', 'Samtal', 'När']);
    await expect(panel.getByRole('link', { name: 'Anna Lindqvist', exact: true })).toHaveAttribute(
      'href',
      /^\/people\/anna\?from=%2F%3Fopen%3Dtalks\.talks/,
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
    const panel = page.getByRole('dialog', { name: 'Utvecklingssamtal' });
    await expect(panel.getByRole('columnheader')).toHaveText(['Namn', 'Samtal', 'När', 'Person']);
    const anna = panel.getByRole('row').filter({ hasText: 'Anna Lindqvist' });
    await expect(anna.getByRole('link', { name: 'Anna Lindqvist', exact: true })).toHaveAttribute(
      'href',
      /open=talks\.commitments/,
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
    const sheet = page.getByRole('dialog', { name: 'Utvecklingssamtal' });
    const item = sheet.getByRole('listitem').filter({ hasText: 'Anna Lindqvist' });
    await expect(item.getByRole('link', { name: 'Öppna Anna Lindqvist' })).toHaveAttribute(
      'href',
      /^\/people\/anna\?from=/,
    );
    await expect(item.getByRole('link', { name: 'Anna Lindqvist', exact: true })).toHaveAttribute(
      'href',
      /open=talks\.commitments/,
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
