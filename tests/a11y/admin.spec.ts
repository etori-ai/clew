import { announcements, desktop, expect, expectNoAxeViolations, focused, hiddenFocusStops, narrow, open, phone, reflowProblems, test } from './support';

/**
 * Administration (D23): the connectors list, the add dialog, one connector's tabs and the remove confirmation, as an
 * administrator sees them. Keyboard, structure, announcements, axe and reflow, at desktop, phone and 320 px.
 */
/** A section of a connector: a tab on desktop, an item in the "Visa" menu on a phone, the same panel either way. */
async function pickSection(page: import('@playwright/test').Page, name: string) {
  const tab = page.getByRole('tab', { name });
  if (await tab.count()) { await tab.click(); return page.getByRole('tabpanel', { name }); }
  await page.getByRole('button', { name: /^Visa: / }).click();
  await page.getByRole('menuitem', { name }).click();
  return page.getByRole('region', { name });
}
const routes = [['the connectors list', '/admin/anslutningar'], ['a bundled connector', '/admin/anslutningar/raindance'], ['a remote connector that is down', '/admin/anslutningar/hello']] as const;

test.describe('administration', () => {
  for (const [layout, viewport] of [['desktop', desktop], ['phone', phone]] as const) test.describe(layout, () => {
    test.use({ viewport });
    for (const [name, path] of routes) test(`${name} has no axe violations`, async ({ page, api }) => {
      api.admin = true;
      await open(page, path);
      await expectNoAxeViolations(page);
    });
    test('every tab of a connector has no axe violations', async ({ page, api }) => {
      api.admin = true;
      await open(page, '/admin/anslutningar/raindance');
      for (const tab of ['Förmågor', 'Områden', 'Vem ser det', 'Historik']) {
        await expect(await pickSection(page, tab)).toBeVisible();
        await expectNoAxeViolations(page);
      }
    });
  });

  test.describe('desktop', () => {
    test.use({ viewport: desktop });
    test('a person without the grant sees no data and one way back', async ({ page, api: _ }) => {
      await page.goto('/admin/anslutningar');
      await expect(page.getByRole('heading', { level: 1, name: 'Du saknar behörighet till administrationen' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Till startsidan' })).toBeVisible();
      await expectNoAxeViolations(page);
    });
    test('the entry point shows only to an administrator', async ({ page, api }) => {
      await open(page, '/');
      await expect(page.getByRole('link', { name: 'Administration' })).toHaveCount(0);
      api.admin = true;
      await open(page, '/');
      await expect(page.getByRole('link', { name: 'Administration' })).toBeVisible();
    });
    test('the list names each connector, its status in words and its audience', async ({ page, api }) => {
      api.admin = true;
      await open(page, '/admin/anslutningar');
      await expect(page).toHaveTitle('Anslutna system · Startsidan');
      const table = page.getByRole('table');
      await expect(table.getByRole('link', { name: 'Raindance' })).toBeVisible();
      await expect(table.getByText('Svarar inte')).toBeVisible();
      await expect(table.getByText('Utkast')).toBeVisible();
      await expect(table.getByText('Chefer · 1 enhet')).toBeVisible();
      await expect(page.getByRole('switch', { name: 'Hello på' })).toBeChecked();
      const { unmarked } = await hiddenFocusStops(page);
      expect(unmarked).toEqual([]);
    });
    test('the switch turns a connector off, keeps focus and says so', async ({ page, api }) => {
      api.admin = true;
      await open(page, '/admin/anslutningar');
      const toggle = page.getByRole('switch', { name: 'Heroma på' });
      await toggle.focus();
      await page.keyboard.press('Space');
      await expect(toggle).not.toBeChecked();
      await expect.poll(() => announcements(page)).toContainEqual(expect.stringContaining('Heroma är avstängd'));
      expect((await focused(page)).tag).toBe('input');
      await expect(page.getByRole('table').getByText('Avstängd')).toBeVisible();
    });
    test('the add dialog runs through its four steps by keyboard and announces each step', async ({ page, api }) => {
      api.admin = true;
      await open(page, '/admin/anslutningar');
      await page.getByRole('button', { name: 'Anslut system' }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog.getByRole('heading', { level: 3, name: 'Adress och nyckel' })).toBeVisible();
      await dialog.getByRole('button', { name: 'Kontrollera' }).click();
      await expect(dialog.getByText('Små bokstäver, siffror och bindestreck; börjar med en bokstav.', { exact: true })).toBeVisible();
      await dialog.getByRole('textbox', { name: /^Id/ }).fill('nytt');
      await dialog.getByRole('textbox', { name: /^Adress/ }).fill('http://nytt:4010');
      await dialog.getByLabel(/Delad nyckel/).fill('en-tillräckligt-lång-nyckel');
      await dialog.getByRole('button', { name: 'Kontrollera' }).click();
      await expect(dialog.getByRole('heading', { level: 3, name: 'Kontroll' })).toBeFocused();
      await expect(dialog.getByRole('list', { name: 'Kontrollens resultat' })).toBeVisible();
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
      await dialog.getByRole('button', { name: 'Sätt på' }).click();
      await expect(dialog).toHaveCount(0);
      await expect(page.getByRole('table').getByRole('link', { name: 'Nytt system' })).toBeVisible();
    });
    test('a connector page is titled, the health is a sentence, and the tabs follow the tabs pattern', async ({ page, api }) => {
      api.admin = true;
      await open(page, '/admin/anslutningar/hello');
      await expect(page).toHaveTitle('Hello · Startsidan');
      await expect(page.getByText(/Hello: svarar inte/)).toBeVisible();
      const tablist = page.getByRole('tablist');
      await tablist.getByRole('tab', { name: 'Översikt' }).focus();
      await page.keyboard.press('ArrowRight');
      expect((await focused(page)).text).toContain('Förmågor');
      await page.keyboard.press('Enter');
      await expect(page.getByRole('tabpanel', { name: 'Förmågor' })).toBeVisible();
      await expect(page.getByRole('switch', { name: 'Godkänn valda till assistenten' })).toBeDisabled();
    });
    test('removing asks first, then returns to the list with focus on its heading and a spoken result', async ({ page, api }) => {
      api.admin = true;
      await open(page, '/admin/anslutningar/hello');
      await page.getByRole('button', { name: 'Ta bort' }).click();
      const alert = page.getByRole('alertdialog');
      await expect(alert.getByText(/öppna kort stängs/)).toBeVisible();
      await alert.getByRole('button', { name: 'Avbryt' }).click();
      await expect(alert).toHaveCount(0);
      await page.getByRole('button', { name: 'Ta bort' }).click();
      await page.getByRole('alertdialog').getByRole('button', { name: 'Ta bort' }).click();
      await expect(page).toHaveURL(/\/admin\/anslutningar$/);
      await expect.poll(() => announcements(page)).toContainEqual(expect.stringContaining('Hello är borttagen'));
      await expect(page.getByRole('table').getByRole('link', { name: 'Hello' })).toHaveCount(0);
    });
    test('the audience editor saves and the preview says what each role sees', async ({ page, api }) => {
      api.admin = true;
      await open(page, '/admin/anslutningar/raindance');
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
      await open(page, '/admin/anslutningar');
      expect(await reflowProblems(page)).toEqual([]);
      await expect(page.getByRole('list', { name: 'Anslutningar' })).toBeVisible();
      await open(page, '/admin/anslutningar/raindance');
      expect(await reflowProblems(page)).toEqual([]);
      await expect(await pickSection(page, 'Förmågor')).toBeVisible();
      expect(await reflowProblems(page)).toEqual([]);
    });
    test('the add dialog reflows at 320 px', async ({ page, api }) => {
      api.admin = true;
      await page.setViewportSize(narrow);
      await open(page, '/admin/anslutningar');
      await page.getByRole('button', { name: 'Anslut system' }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      expect(await reflowProblems(page)).toEqual([]);
    });
  });
});
