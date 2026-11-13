import {
  announcements,
  desktop,
  expect,
  expectNoAxeViolations,
  focused,
  hiddenFocusStops,
  narrow,
  open,
  phone,
  reflowProblems,
  test,
} from './support';
import { connectorDetail } from './data';

/**
 * Administration (D23): the connectors list, the add dialog, one connector's tabs and the remove confirmation, as an
 * administrator sees them. Keyboard, structure, announcements, axe and reflow, at desktop, phone and 320 px.
 */
/** A section of a connector: a tab on desktop, an item in the "Visa" menu on a phone, the same panel either way. */
async function pickSection(page: import('@playwright/test').Page, name: string) {
  const tab = page.getByRole('tab', { name });
  if (await tab.count()) {
    await tab.click();
    return page.getByRole('tabpanel', { name });
  }
  await page.getByRole('button', { name: /^Visa: / }).click();
  await page.getByRole('menuitem', { name }).click();
  return page.getByRole('region', { name });
}
const routes = [
  ['the connectors list', '/admin/connectors'],
  ['a bundled connector', '/admin/connectors/calendar'],
  ['a remote connector', '/admin/connectors/finance'],
  ['a remote connector that is down', '/admin/connectors/hello'],
] as const;

test.describe('administration', () => {
  for (const [layout, viewport] of [
    ['desktop', desktop],
    ['phone', phone],
  ] as const)
    test.describe(layout, () => {
      test.use({ viewport });
      for (const [name, path] of routes)
        test(`${name} has no axe violations`, async ({ page, api }) => {
          api.admin = true;
          await open(page, path);
          await expectNoAxeViolations(page);
        });
      test('every tab of a connector has no axe violations', async ({ page, api }) => {
        api.admin = true;
        await open(page, '/admin/connectors/finance');
        for (const tab of ['Funktioner', 'Områden', 'Vem ser det', 'Historik']) {
          await expect(await pickSection(page, tab)).toBeVisible();
          await expectNoAxeViolations(page);
        }
      });
    });

  test.describe('desktop', () => {
    test.use({ viewport: desktop });
    test('"Ger sidhuvudet" is a switch on a connector that declares a header capability, and the status line says so (D88)', async ({
      page,
      api,
    }) => {
      api.admin = true;
      await open(page, '/admin/connectors/finance');
      await expect(page.getByText('Kan ge sidhuvudet', { exact: true })).toBeVisible();
      await pickSection(page, 'Områden');
      const toggle = page.getByRole('switch', { name: 'Ger sidhuvudet', exact: true });
      await expect(toggle).toBeEnabled();
      let sent: unknown;
      await page.route('**/api/admin/connectors/finance', async route => {
        if (route.request().method() === 'PATCH') sent = route.request().postDataJSON();
        await route.fallback();
      });
      await toggle.focus();
      await page.keyboard.press('Space');
      await expect(
        page.getByRole('region', { name: 'Aviseringar' }).getByText('Anslutningen ger sidhuvudet nu.'),
      ).toBeVisible();
      expect(sent).toEqual({ header: true });
      await expect(toggle).toBeChecked();
      await expectNoAxeViolations(page);
      // The status line in the page's head says so on the next visit; the other connectors no longer hold it.
      await open(page, '/admin/connectors/finance');
      await expect(page.getByText('Kan ge sidhuvudet', { exact: true })).toHaveCount(0);
      await expect(page.getByText('Ja', { exact: true })).toHaveCount(2);
      // A connector without a header capability has the switch, disabled, and says why in its status line.
      await open(page, '/admin/connectors/hr');
      await expect(page.getByText('Anslutningen kan inte ge sidhuvudet', { exact: true })).toBeVisible();
      await pickSection(page, 'Områden');
      await expect(page.getByRole('switch', { name: 'Ger sidhuvudet', exact: true })).toBeDisabled();
    });
    test('a person without the grant sees no data and one way back', async ({ page, api: _ }) => {
      await page.goto('/admin/connectors');
      await expect(
        page.getByRole('heading', { level: 1, name: 'Du saknar behörighet till administrationen' }),
      ).toBeVisible();
      await expect(page.getByRole('link', { name: 'Till startsidan' })).toBeVisible();
      await expectNoAxeViolations(page);
    });
    test('the entry point shows only to an administrator', async ({ page, api }) => {
      await open(page, '/');
      await expect(page.getByRole('button', { name: 'Administration' })).toHaveCount(0);
      api.admin = true;
      await open(page, '/');
      await expect(page.getByRole('button', { name: 'Administration' })).toBeVisible();
    });
    test('Administration opens and closes like Områden, and its rows change the page and keep the rail', async ({
      page,
      api,
    }) => {
      api.admin = true;
      await open(page, '/');
      const rail = page.getByRole('navigation', { name: 'Sidonavigering' });
      const administration = rail.getByRole('button', { name: 'Administration', exact: true });
      await expect(administration).toHaveAttribute('aria-expanded', 'false');
      await expect(rail.getByRole('link', { name: 'Modeller', exact: true })).toHaveCount(0);
      await administration.click();
      await expect(administration).toHaveAttribute('aria-expanded', 'true');
      await rail.getByRole('link', { name: 'Anslutna system', exact: true }).click();
      await expect(page).toHaveURL('/admin/connectors');
      await expect(page.getByRole('heading', { level: 1, name: 'Anslutna system' })).toBeVisible();
      await expect(rail.getByRole('link', { name: 'Ny fråga', exact: true })).toBeVisible();
      await expect(rail.getByRole('link', { name: 'Kalender', exact: true })).toBeVisible();
      await expect(rail.getByRole('link', { name: 'Anslutna system', exact: true })).toHaveAttribute(
        'aria-current',
        'page',
      );
      await rail.getByRole('link', { name: 'Modeller', exact: true }).click();
      await expect(page).toHaveURL('/admin/models');
      await expect(page.getByRole('heading', { level: 1, name: 'Modeller' })).toBeVisible();
      await expect(rail.getByRole('link', { name: 'Ny fråga', exact: true })).toBeVisible();
      await expect(rail.getByRole('link', { name: 'Modeller', exact: true })).toHaveAttribute('aria-current', 'page');
      await expectNoAxeViolations(page);
      await administration.focus();
      await page.keyboard.press('Enter');
      await expect(administration).toHaveAttribute('aria-expanded', 'false');
      await expect(rail.getByRole('link', { name: 'Modeller', exact: true })).toHaveCount(0);
      await page.keyboard.press('Enter');
      await expect(administration).toHaveAttribute('aria-expanded', 'true');
    });
    test('the list is in registration order with each system’s colour named; the area chip names the area (D71)', async ({
      page,
      api,
    }) => {
      api.admin = true;
      await open(page, '/admin/connectors');
      const table = page.getByRole('table');
      const names = await table.getByRole('link').allTextContents();
      expect(names).toEqual(['Personalsystemet', 'Ekonomisystemet', 'Hello', 'SupportManagement', 'Kalendern']);
      await expect(table.getByRole('img', { name: 'Färg blågrön, 1:a anslutna systemet' })).toBeVisible();
      await expect(table.getByRole('img', { name: 'Färg lila, 2:a anslutna systemet' })).toBeVisible();
      await expect(table.getByRole('img', { name: 'Vit, Clews egen' })).toBeVisible();
      await expect(table.getByText('calendar · Clews egen')).toBeVisible();
      await open(page, '/admin/connectors/finance');
      await expect(page.getByRole('img', { name: 'Färg lila, 2:a anslutna systemet' })).toBeVisible();
      await expect(
        page.getByText('2:a anslutna systemet · färg lila · direkt från källan · protokoll 1'),
      ).toBeVisible();
      const areas = (await pickSection(page, 'Områden')).getByRole('list', { name: 'Områden' });
      await expect(areas.getByRole('listitem').first()).toContainText('Budget');
      await expectNoAxeViolations(page);
    });
    test('"Visa nyckeltalet" switches an area\'s figure on Hem per area, says so aloud and keeps focus (D54)', async ({
      page,
      api,
    }) => {
      api.admin = true;
      await open(page, '/admin/connectors/finance');
      const areas = (await pickSection(page, 'Områden')).getByRole('list', { name: 'Områden' });
      const row = areas.getByRole('listitem').filter({ hasText: 'Budget' });
      const toggle = row.getByRole('switch', { name: 'Visa nyckeltalet' });
      await expect(toggle).toBeChecked();
      await expect(row.getByText(/nyckeltalet är en ruta på Hem/)).toBeVisible();
      await expectNoAxeViolations(page);
      await toggle.focus();
      await page.keyboard.press('Space');
      await expect(toggle).not.toBeChecked();
      await expect.poll(() => api.figuresOff).toEqual(['finance']);
      await expect(
        page.getByRole('region', { name: 'Aviseringar' }).getByText('Nyckeltalet för Budget visas inte längre på Hem.'),
      ).toBeVisible();
      await expect(row.getByText(/nyckeltalet visas inte/)).toBeVisible();
      await expect(toggle).toBeFocused();
      await toggle.click();
      await expect.poll(() => api.figuresOff).toEqual([]);
    });
    test('"På Personal och andra listor" offers a read about a person under Visa and one of its fields as a column, and shows the refusal (D97)', async ({
      page,
      api,
    }) => {
      api.admin = true;
      // The connector's reads about a person, as the admin read gives them (D97 items 3 and 4); the PATCHes are kept.
      const patches: unknown[] = [];
      let lens = false;
      let column: string | null = null;
      let refuse = false;
      const detail = () => {
        const base = connectorDetail(api.connectors.find(c => c.id === 'hr')!);
        return {
          ...base,
          capabilities: [
            ...base.capabilities,
            {
              name: 'hr.presence',
              kind: 'read' as const,
              title: 'Frånvaro',
              description: 'Närvaro i dag och kommande frånvaro.',
              model: false,
              roles: null,
              enabled: true,
              tool: false,
              menu: null,
              about: 'person' as const,
              lens: { on: lens },
              column: {
                fields: [
                  { key: 'today', label: 'Närvaro' },
                  { key: 'upcoming', label: 'Kommande' },
                ],
                on: column,
              },
            },
          ],
        };
      };
      await page.route('**/api/admin/connectors/hr', async route => {
        if (route.request().method() !== 'PATCH') return route.fulfill({ json: detail() });
        const body = route.request().postDataJSON() as {
          lens?: Record<string, boolean>;
          column?: Record<string, string | null>;
        };
        patches.push(body);
        if (body.column && refuse)
          return route.fulfill({
            status: 400,
            json: { error: 'Högst 3 kolumner kan visas under Alla för personer. Ta bort en annan kolumn först.' },
          });
        if (body.lens) lens = body.lens['hr.presence'] ?? lens;
        if (body.column) column = body.column['hr.presence'] ?? null;
        return route.fulfill({ json: detail() });
      });
      await open(page, '/admin/connectors/hr');
      const lists = (await pickSection(page, 'Områden')).getByRole('list', { name: 'På Personal och andra listor' });
      const row = lists.getByRole('listitem').filter({ hasText: 'Frånvaro' });
      await expect(row.getByText('Om en person')).toBeVisible();
      await expectNoAxeViolations(page);
      const toggle = row.getByRole('switch', { name: 'Visa Frånvaro under Visa' });
      await expect(toggle).not.toBeChecked();
      await toggle.focus();
      await page.keyboard.press('Space');
      await expect(toggle).toBeChecked();
      await expect.poll(() => patches).toContainEqual({ lens: { 'hr.presence': true } });
      await expect(
        page.getByRole('region', { name: 'Aviseringar' }).getByText('Frånvaro går att välja under Visa.'),
      ).toBeVisible();
      await expect(toggle).toBeFocused();
      // The column: one field of the view, or none.
      const select = row.getByRole('combobox', { name: 'Kolumn på Alla' });
      await expect(select).toContainText('Ingen kolumn');
      await select.click();
      await page.getByRole('option', { name: 'Närvaro' }).click();
      await expect.poll(() => patches).toContainEqual({ column: { 'hr.presence': 'today' } });
      await expect(select).toContainText('Närvaro');
      // The server's limit of three columns is said as the server says it.
      refuse = true;
      await select.click();
      await page.getByRole('option', { name: 'Kommande' }).click();
      await expect(
        page.getByRole('alert').filter({ hasText: 'Högst 3 kolumner kan visas under Alla för personer.' }),
      ).toBeVisible();
      await expectNoAxeViolations(page);
    });
    test('the list names each connector, its status in words and its audience', async ({ page, api }) => {
      api.admin = true;
      await open(page, '/admin/connectors');
      await expect(page).toHaveTitle('Anslutna system · Startsidan');
      const table = page.getByRole('table');
      await expect(table.getByRole('link', { name: 'Ekonomisystemet' })).toBeVisible();
      await expect(table.getByText('Svarar inte')).toBeVisible();
      await expect(table.getByText('Utkast')).toBeVisible();
      await expect(table.getByText('Chefer · 1 enhet')).toBeVisible();
      await expect(page.getByRole('switch', { name: 'Hello på' })).toBeChecked();
      const { unmarked } = await hiddenFocusStops(page);
      expect(unmarked).toEqual([]);
    });
    test('the switch turns a connector off, keeps focus and says so', async ({ page, api }) => {
      api.admin = true;
      await open(page, '/admin/connectors');
      const toggle = page.getByRole('switch', { name: 'Personalsystemet på' });
      await toggle.focus();
      await page.keyboard.press('Space');
      await expect(toggle).not.toBeChecked();
      await expect
        .poll(() => announcements(page))
        .toContainEqual(expect.stringContaining('Personalsystemet är avstängd'));
      expect((await focused(page)).tag).toBe('input');
      await expect(page.getByRole('table').getByText('Avstängd')).toBeVisible();
    });
    test('the add dialog runs through its four steps by keyboard and announces each step', async ({ page, api }) => {
      api.admin = true;
      await open(page, '/admin/connectors');
      await page.getByRole('button', { name: 'Anslut system' }).click();
      const dialog = page.getByRole('dialog', { name: 'Anslut system' });
      await expect(dialog.getByRole('heading', { level: 3, name: 'Adress och nyckel' })).toBeVisible();
      await dialog.getByRole('button', { name: 'Kontrollera' }).click();
      await expect(
        dialog.getByText('Små bokstäver, siffror och bindestreck; börjar med en bokstav.', { exact: true }),
      ).toBeVisible();
      await dialog.getByRole('textbox', { name: /^Id/ }).fill('nytt');
      await dialog.getByRole('textbox', { name: /^Adress/ }).fill('http://nytt:4010');
      await dialog.getByLabel(/Delad nyckel/).fill('en-tillräckligt-lång-nyckel');
      await dialog.getByRole('button', { name: 'Kontrollera' }).click();
      await expect(dialog.getByRole('heading', { level: 3, name: 'Kontroll' })).toBeFocused();
      await expect(dialog.getByText('Anslutningen fungerar.', { exact: true })).toBeVisible();
      // A group that passed stays shut and says so; opening it shows its rows.
      const group = dialog.getByRole('button', { name: /Anslutning.*1 godkänd/ });
      await expect(dialog.getByRole('list', { name: 'Anslutning' })).toHaveCount(0);
      await group.click();
      await expect(dialog.getByRole('list', { name: 'Anslutning' })).toBeVisible();
      await expectNoAxeViolations(page);
      await dialog.getByRole('button', { name: 'Nästa' }).click();
      await expect(dialog.getByRole('heading', { level: 3, name: 'Vem ser det' })).toBeFocused();
      await dialog.getByRole('radio', { name: 'Endast valda' }).check();
      await dialog.getByRole('checkbox', { name: 'Chefer' }).check();
      await expectNoAxeViolations(page);
      await dialog.getByRole('button', { name: 'Nästa' }).click();
      await expect(dialog.getByRole('heading', { level: 3, name: 'Aktivera' })).toBeFocused();
      await expect(dialog.getByText('Chefer')).toBeVisible();
      await expectNoAxeViolations(page);
      await dialog.getByRole('button', { name: 'Slå på' }).click();
      await expect(dialog).toHaveCount(0);
      await expect(page.getByRole('table').getByRole('link', { name: 'Nytt system' })).toBeVisible();
    });
    test('on a short screen the add dialog scrolls its step and keeps its buttons on screen', async ({ page, api }) => {
      api.admin = true;
      await page.setViewportSize({ width: 1280, height: 560 });
      await open(page, '/admin/connectors');
      await page.getByRole('button', { name: 'Anslut system' }).click();
      const dialog = page.getByRole('dialog', { name: 'Anslut system' });
      await dialog.getByRole('textbox', { name: /^Id/ }).fill('nytt');
      await dialog.getByRole('textbox', { name: /^Adress/ }).fill('http://nytt:4010');
      await dialog.getByLabel(/Delad nyckel/).fill('en-tillräckligt-lång-nyckel');
      await dialog.getByRole('button', { name: 'Kontrollera' }).click();
      await dialog.getByRole('button', { name: 'Nästa' }).click();
      // The longest step: the audience editor with every list shown, then the two switches.
      await dialog.getByRole('radio', { name: 'Endast valda' }).check();
      await expect(dialog.getByRole('switch', { name: 'Erbjud assistenten' })).toBeAttached();
      await expect(dialog.getByRole('button', { name: 'Tillbaka' })).toBeInViewport();
      await expect(dialog.getByRole('button', { name: 'Nästa' })).toBeInViewport();
      // axe reads the step as a person first meets it; scrolled to its end, the step's first labels sit outside the
      // dialog's scrollport and axe's best-practice rule would count them as hidden.
      await expectNoAxeViolations(page);
      await dialog.getByRole('switch', { name: 'Erbjud assistenten' }).scrollIntoViewIfNeeded();
      await expect(dialog.getByRole('switch', { name: 'Erbjud assistenten' })).toBeInViewport();
      await expect(dialog.getByRole('button', { name: 'Nästa' })).toBeInViewport();
    });
    test('a manifest with many changes scrolls in its dialog, the two choices stay on screen, and using it is spoken', async ({
      page,
      api,
    }) => {
      api.admin = true;
      await page.setViewportSize({ width: 1280, height: 560 });
      const names = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `hello.${prefix}${i + 1}`);
      await page.route('**/api/admin/connectors/hello/refresh', route =>
        route.fulfill({
          json: {
            diff: {
              added: names('ny', 12),
              removed: names('gammal', 8),
              changed: names('andrad', 4),
              areasAdded: [],
              areasRemoved: [],
              same: false,
            },
            connector: connectorDetail(api.connectors.find(c => c.id === 'hello')!),
          },
        }),
      );
      await open(page, '/admin/connectors/hello');
      await page.getByRole('button', { name: 'Läs in igen från systemet' }).click();
      // Named by its title (4.1.2): the Dialog takes its name from a DialogHeader present when it mounts.
      const dialog = page.getByRole('dialog', { name: 'Systemet har ändrats' });
      await expect(dialog.getByRole('list', { name: 'Ändringar' }).getByRole('listitem')).toHaveCount(24);
      await expect(dialog.getByRole('button', { name: 'Behåll det gamla' })).toBeInViewport();
      await expect(dialog.getByRole('button', { name: 'Använd det nya' })).toBeInViewport();
      await expectNoAxeViolations(page);
      // A list to read has nothing focusable, so the scrolling area itself takes focus and the keyboard scrolls it (2.1.1).
      const changes = dialog.getByRole('group', { name: 'Ändringarna i systemet' });
      await changes.focus();
      await expect(changes).toBeFocused();
      await expect(dialog.getByText('Ändrad funktion: hello.andrad4')).not.toBeInViewport();
      await page.keyboard.press('End');
      await expect(dialog.getByText('Ändrad funktion: hello.andrad4')).toBeInViewport();
      await expect(dialog.getByRole('button', { name: 'Använd det nya' })).toBeInViewport();
      await dialog.getByRole('button', { name: 'Använd det nya' }).click();
      await expect(dialog).toHaveCount(0);
      await expect.poll(() => announcements(page)).toContainEqual(expect.stringContaining('Uppdaterat från systemet'));
    });
    test('a connector page is titled, the health is a sentence, and the tabs follow the tabs pattern', async ({
      page,
      api,
    }) => {
      api.admin = true;
      await open(page, '/admin/connectors/hello');
      await expect(page).toHaveTitle('Hello · Startsidan');
      await expect(page.getByText(/Hello: svarar inte/)).toBeVisible();
      const tablist = page.getByRole('tablist');
      await tablist.getByRole('tab', { name: 'Översikt' }).focus();
      await page.keyboard.press('ArrowRight');
      expect((await focused(page)).text).toContain('Funktioner');
      await page.keyboard.press('Enter');
      await expect(page.getByRole('tabpanel', { name: 'Funktioner' })).toBeVisible();
      await expect(page.getByRole('switch', { name: 'Godkänn valda till assistenten' })).toBeDisabled();
    });
    test('a check that found problems opens their groups, shuts the rest and says the verdict in words', async ({
      page,
      api,
    }) => {
      api.admin = true;
      await open(page, '/admin/connectors/hello');
      await page.getByRole('button', { name: 'Testa anslutning' }).click();
      await expect(page.locator('[aria-level="2"]').filter({ hasText: 'Senaste kontroll' })).toBeVisible();
      await expect(page.getByText('Kontrollen hittade 1 fel.', { exact: true })).toBeVisible();
      await expect(page.getByRole('list', { name: 'Anslutning' }).getByRole('listitem').first()).toContainText(
        'Fel nyckel släpps igenom',
      );
      await expect(page.getByRole('list', { name: 'Funktioner' })).toContainText('hello.dayWithMeetings');
      const passed = page.getByRole('button', { name: /I Startsidan.*1 godkänd/ });
      await expect(passed).toHaveAttribute('aria-expanded', 'false');
      await passed.focus();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('list', { name: 'I Startsidan' })).toBeVisible();
      await expectNoAxeViolations(page);
    });
    test('removing asks first, then returns to the list with focus on its heading and a spoken result', async ({
      page,
      api,
    }) => {
      api.admin = true;
      await open(page, '/admin/connectors/hello');
      await page.getByRole('button', { name: 'Ta bort' }).click();
      const alert = page.getByRole('alertdialog');
      await expect(alert.getByText(/öppna ärenden stängs/)).toBeVisible();
      await alert.getByRole('button', { name: 'Avbryt' }).click();
      await expect(alert).toHaveCount(0);
      await page.getByRole('button', { name: 'Ta bort' }).click();
      await page.getByRole('alertdialog').getByRole('button', { name: 'Ta bort' }).click();
      await expect(page).toHaveURL(/\/admin\/connectors$/);
      await expect.poll(() => announcements(page)).toContainEqual(expect.stringContaining('Hello är borttagen'));
      await expect(page.getByRole('table').getByRole('link', { name: 'Hello' })).toHaveCount(0);
    });
    test('the audience editor saves and the preview says what each role sees', async ({ page, api }) => {
      api.admin = true;
      await open(page, '/admin/connectors/finance');
      await page.getByRole('tab', { name: 'Vem ser det' }).click();
      await expect(page.getByRole('radio', { name: 'Endast valda' })).toBeChecked();
      await expect(page.getByText(/Så här ser det ut för medarbetare/)).toBeVisible();
      await page.getByRole('radio', { name: 'Alla som är inloggade' }).check();
      await page.getByRole('button', { name: 'Spara' }).click();
      await expect.poll(() => announcements(page)).toContainEqual(expect.stringContaining('Sparat: Alla'));
    });
    test('a provisioned group can be chosen for the audience by keyboard (D68)', async ({ page, api }) => {
      api.admin = true;
      await open(page, '/admin/connectors/finance');
      await page.getByRole('tab', { name: 'Vem ser det' }).click();
      await expect(page.getByRole('radio', { name: 'Endast valda' })).toBeChecked();
      const groups = page.getByRole('combobox', { name: 'Grupper' });
      await expect(groups).toBeEnabled();
      await groups.focus();
      await page.keyboard.press('Enter');
      const option = page.getByRole('option', { name: 'IT-personal' });
      await expect(option).toBeVisible();
      await option.click();
      await page.keyboard.press('Escape');
      await expect(groups).toContainText('IT-personal');
      await page.getByRole('button', { name: 'Spara' }).click();
      await expect.poll(() => announcements(page)).toContainEqual(expect.stringContaining('Sparat'));
      await expectNoAxeViolations(page);
    });
    test('the audience editor says that units and groups are on their way or could not be read, never that there are none', async ({
      page,
      api,
    }) => {
      api.admin = true;
      const release = api.holdAudienceLists();
      // The reads are held, so the page is opened without waiting for the network to settle.
      await page.goto('/admin/connectors/finance');
      await page.getByRole('tab', { name: 'Vem ser det' }).click();
      const panel = page.getByRole('tabpanel', { name: 'Vem ser det' });
      const units = panel.getByRole('combobox', { name: 'Enheter' });
      const groups = panel.getByRole('combobox', { name: 'Grupper' });
      // On their way: both fields are busy, and neither says anything about what it has not read.
      await expect(units).toHaveAttribute('aria-busy', 'true');
      await expect(groups).toHaveAttribute('aria-busy', 'true');
      await expect(groups).toBeEnabled();
      await expect(panel).not.toContainText(/Inga enheter|Inga grupper|Grupper visas när|kunde inte läsas/);
      // Both reads fail, the second time too: each field says that its list could not be read, the unit field aloud
      // when it is opened, and the group field, which has nothing to offer, in its place and as its reason.
      api.audienceListsFail = true;
      release();
      await expect(groups).toBeDisabled();
      await expect(groups).toContainText('Grupperna kunde inte läsas.');
      await expect(groups).toHaveAccessibleDescription('Grupperna kunde inte läsas.');
      await units.focus();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('listbox')).toHaveText('Enheterna kunde inte läsas.');
      await expect.poll(() => announcements(page)).toContainEqual('Enheterna kunde inte läsas.');
      await page.keyboard.press('Escape');
      await expect(panel).not.toContainText(/Inga enheter|Inga grupper|Grupper visas när/);
      expect(await announcements(page)).not.toContainEqual('Inga enheter');
      // The unit the saved audience names is still in it, by its id.
      await expect(units).toContainText('unit-skola');
      await expectNoAxeViolations(page);
    });
    test('the audience editor says that there are no units or groups when its reads hold none, never that they could not be read', async ({
      page,
      api,
    }) => {
      api.admin = true;
      api.audienceUnits = [];
      api.audienceGroups = [];
      await open(page, '/admin/connectors/finance');
      await page.getByRole('tab', { name: 'Vem ser det' }).click();
      const panel = page.getByRole('tabpanel', { name: 'Vem ser det' });
      const groups = panel.getByRole('combobox', { name: 'Grupper' });
      await expect(groups).toBeDisabled();
      await expect(groups).toContainText('Inga grupper provisionerade');
      await expect(groups).toHaveAccessibleDescription('Grupper visas när katalogen har provisionerat dem genom SCIM.');
      await panel.getByRole('combobox', { name: 'Enheter' }).focus();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('listbox')).toHaveText('Inga enheter');
      await expect.poll(() => announcements(page)).toContainEqual('Inga enheter');
      await page.keyboard.press('Escape');
      await expect(panel).not.toContainText('kunde inte läsas');
      expect(await announcements(page)).not.toContainEqual(expect.stringContaining('kunde inte läsas'));
    });
  });

  test.describe('1.4.10 reflow', () => {
    test('the list and a connector reflow at 320 px', async ({ page, api }) => {
      api.admin = true;
      await page.setViewportSize(narrow);
      await open(page, '/admin/connectors');
      expect(await reflowProblems(page)).toEqual([]);
      await expect(page.getByRole('list', { name: 'Anslutningar' })).toBeVisible();
      await open(page, '/admin/connectors/finance');
      expect(await reflowProblems(page)).toEqual([]);
      await expect(await pickSection(page, 'Funktioner')).toBeVisible();
      expect(await reflowProblems(page)).toEqual([]);
    });
    test('a check result reflows at 320 px', async ({ page, api }) => {
      api.admin = true;
      await page.setViewportSize(narrow);
      await open(page, '/admin/connectors/hello');
      await page.getByRole('button', { name: 'Testa anslutning' }).click();
      await expect(page.getByRole('list', { name: 'Funktioner' })).toBeVisible();
      expect(await reflowProblems(page)).toEqual([]);
    });
    test('the add dialog reflows at 320 px', async ({ page, api }) => {
      api.admin = true;
      await page.setViewportSize(narrow);
      await open(page, '/admin/connectors');
      await page.getByRole('button', { name: 'Anslut system' }).click();
      await expect(page.getByRole('dialog', { name: 'Anslut system' })).toBeVisible();
      expect(await reflowProblems(page)).toEqual([]);
    });
  });
});
