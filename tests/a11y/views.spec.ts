import {
  announcements,
  composer,
  desktop,
  expect,
  expectNoAxeViolations,
  narrow,
  open,
  reflowProblems,
  test,
} from './support';

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
    await expect.poll(() => announcements(page)).toContainEqual(expect.stringContaining('2 rader'));
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
});
