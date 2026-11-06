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
  ['a bundled connector', '/admin/connectors/finance'],
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
      await expect(page.getByRole('heading', { level: 2, name: 'Senaste kontroll' })).toBeVisible();
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
      await expect(alert.getByText(/öppna kort stängs/)).toBeVisible();
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
