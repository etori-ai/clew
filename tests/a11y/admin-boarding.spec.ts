import type { Page } from '@playwright/test';
import { BoardingMock } from './boarding';
import {
  desktop,
  expect,
  expectNoAxeViolations,
  hiddenFocusStops,
  narrow,
  open,
  phone,
  reflowProblems,
  test,
  type MockApi,
} from './support';

/**
 * Administration › Introduktion och avslut (D124 item 10): the layers, read only, one card per event, and "Importera
 * från fil", a page of its own where the file is read in the browser with the parser the server checks again, what
 * cannot be read is listed by row in Swedish, the layers and the rows are previewed, and a whole file is sent. The row
 * under Administration is drawn while the module is on and the person holds `admin.boarding`; the pages themselves say
 * why when either is not so. Keyboard, axe and reflow.
 */
const IMPORT = '/admin/boarding/import';
const notices = (page: Page) => page.getByRole('region', { name: 'Aviseringar' });
/** Text drawn on the page, not its copy in a live region. */
const drawn = (page: Page, text: string) =>
  page.getByRole('main').getByText(text, { exact: true }).and(page.locator(':not([aria-live])'));
const upload = (page: Page, text: string, name = 'lager.csv') =>
  page
    .getByLabel('Fil med lager', { exact: true })
    .and(page.locator('input[type="file"]'))
    .setInputFiles({ name, mimeType: 'text/csv', buffer: Buffer.from(text, 'utf8') });
const adminRow = (page: Page) =>
  page
    .getByRole('navigation', { name: 'Sidonavigering' })
    .getByRole('group', { name: 'Administration', exact: true })
    .getByRole('link', { name: 'Introduktion och avslut', exact: true });
const goodFile = [
  'layer;event;condition;value;title;kind;owner;offsetDays;tiedTo',
  'Alla nyanställda;introduction;all;;Beställ dator och telefon;order;manager;-14;',
  'Alla nyanställda;Introduktion;Alla;;Välkomstsamtal;Möte;Chef;0;',
  'Undersköterskor;introduction;position;underskoterska;HLR;course;person;30;HLR',
].join('\n');
const badFile = [
  'layer;event;condition;value;title;kind;owner;offsetDays;tiedTo',
  'Alla nyanställda;Start;all;;Beställ dator;order;manager;-14;',
  'Alla nyanställda;introduction;all;;Välkomstsamtal;meeting;manager;x;',
  'Undersköterskor;introduction;position;underskoterska;HLR;course;person;30;',
].join('\n');

const administrator = (api: MockApi) => {
  api.admin = true;
  api.capabilities = [...api.capabilities, 'admin.boarding'];
  api.boarding = new BoardingMock();
};

test.describe('Administration › Introduktion och avslut', () => {
  test.use({ viewport: desktop });

  test('an administrator reaches it from the rail and reads each layer with whom it applies to and its items', async ({
    page,
    api,
  }) => {
    administrator(api);
    await open(page, '/admin/connectors');
    await adminRow(page).click();
    await expect(page).toHaveURL('/admin/boarding');
    await expect(page).toHaveTitle('Introduktion och avslut · Startsidan');
    await expect(adminRow(page)).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('heading', { level: 1, name: 'Introduktion och avslut' })).toBeVisible();
    const intro = page.getByRole('table', { name: 'Lager för introduktion' });
    await expect(intro.getByRole('columnheader')).toHaveText(['Lager', 'Gäller', 'Punkter', 'Ändrad']);
    const everyone = intro.getByRole('row', { name: /Alla nyanställda/ });
    await expect(everyone).toContainText('Alla anställda');
    await expect(everyone).toContainText('2');
    await expect(everyone).toContainText('måndag 2 november');
    await expect(intro.getByRole('row', { name: /Skönsmons skola/ })).toContainText(
      'Enhet: Skönsmons skola och enheterna under den',
    );
    await expect(
      page.getByRole('table', { name: 'Lager för avslut' }).getByRole('row', { name: /Alla som slutar/ }),
    ).toBeVisible();
    // Read only: nothing in the tables is a control; the layers come in from a file.
    await expect(intro.getByRole('button')).toHaveCount(0);
    await expect(intro.getByRole('link')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Importera från fil' })).toHaveAttribute('href', IMPORT);
    await expectNoAxeViolations(page);
    const { unmarked } = await hiddenFocusStops(page);
    expect(unmarked).toEqual([]);
  });

  test('the row is drawn while the module is on and the person holds admin.boarding; the page says why otherwise', async ({
    page,
    api,
  }) => {
    api.admin = true;
    // Switched off: no row, and the page says so for an address from before.
    api.capabilities = [...api.capabilities, 'admin.boarding'];
    await open(page, '/admin/connectors');
    await expect(
      page.getByRole('navigation', { name: 'Sidonavigering' }).getByRole('link', { name: 'Anslutna system' }),
    ).toBeVisible();
    await expect(adminRow(page)).toHaveCount(0);
    await open(page, '/admin/boarding');
    await expect(page.getByRole('heading', { level: 2, name: 'Lagren är inte tillgängliga för dig' })).toBeVisible();
    await expect(
      page.getByRole('main').getByText(/Introduktion och avslut är inte påslaget i den här installationen\./),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Importera från fil' })).toHaveCount(0);
    // On: the row is there.
    api.boarding = new BoardingMock();
    await open(page, '/admin/connectors');
    await expect(adminRow(page)).toBeVisible();
    // On, but without admin.boarding: no row, and the page and its import refuse.
    api.capabilities = ['admin.connectors', 'admin.users', 'admin.appearance'];
    await open(page, '/admin/connectors');
    await expect(adminRow(page)).toHaveCount(0);
    await open(page, '/admin/boarding');
    await expect(page.getByRole('heading', { level: 2, name: 'Lagren är inte tillgängliga för dig' })).toBeVisible();
    await open(page, IMPORT);
    await expect(page.getByRole('heading', { level: 2, name: 'Importen är inte tillgänglig för dig' })).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test('a whole file: its layers and rows previewed, then imported, and what changed said', async ({ page, api }) => {
    administrator(api);
    await open(page, IMPORT);
    await expect(page.getByRole('heading', { level: 1, name: 'Importera lager' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Introduktion och avslut' }).first()).toBeVisible();
    await upload(page, goodFile);
    // The field's status is also said through Astryx's live region: the text drawn under the field is read.
    await expect(drawn(page, '3 rader att importera.')).toBeVisible();
    const layers = page.getByRole('table', { name: 'Lagren i filen' });
    await expect(layers.getByRole('row')).toHaveCount(3);
    await expect(layers.getByRole('row', { name: /Undersköterskor/ })).toContainText('Befattning: underskoterska');
    const rows = page.getByRole('table', { name: 'Raderna i filen' });
    await expect(rows.getByRole('row', { name: /Välkomstsamtal/ })).toContainText('På dagen');
    await expect(rows.getByRole('row', { name: /Beställ dator/ })).toContainText('14 dagar före');
    await expectNoAxeViolations(page);
    const button = page.getByRole('button', { name: 'Importera 2 lager' });
    await button.focus();
    await page.keyboard.press('Enter');
    await expect(
      notices(page).getByText('1 lager lades till, 1 lager ersattes och 0 lager var oförändrade.'),
    ).toBeAttached();
    expect(api.boarding!.imports).toHaveLength(1);
    expect(api.boarding!.imports[0]!.rows.map(r => [r.row, r.layer, r.event, r.kind, r.owner, r.offsetDays])).toEqual([
      [2, 'Alla nyanställda', 'introduction', 'order', 'manager', -14],
      [3, 'Alla nyanställda', 'introduction', 'meeting', 'manager', 0],
      [4, 'Undersköterskor', 'introduction', 'course', 'person', 30],
    ]);
    await expect(button).toBeFocused();
  });

  test('a file with problems lists them by row in Swedish and imports nothing', async ({ page, api }) => {
    administrator(api);
    await open(page, IMPORT);
    await upload(page, badFile);
    await expect(drawn(page, '2 rader kan inte läsas in. Felen står under fältet.')).toBeVisible();
    const problems = page.getByRole('list', { name: 'Det som inte kan läsas in' });
    await expect(problems.getByRole('listitem')).toHaveText([
      /^Rad 2: Händelsen ”Start” finns inte\./,
      /^Rad 3: Antal dagar ska vara ett heltal från -365 till 365\./,
    ]);
    await expect(page.getByRole('button', { name: /^Importera/ })).toHaveCount(0);
    await expect(page.getByRole('table', { name: 'Lagren i filen' })).toHaveCount(0);
    expect(api.boarding!.imports).toEqual([]);
    await expectNoAxeViolations(page);
  });
});

test.describe('Administration › Introduktion och avslut on small screens', () => {
  test('on a phone the layers are lists, and at 320 px the pages reflow', async ({ page, api }) => {
    administrator(api);
    await page.setViewportSize(phone);
    await open(page, '/admin/boarding');
    await expect(page.getByRole('list', { name: 'Lager för introduktion' })).toBeVisible();
    await expectNoAxeViolations(page);
    await page.setViewportSize(narrow);
    expect(await reflowProblems(page)).toEqual([]);
    await open(page, IMPORT);
    await upload(page, goodFile);
    await expect(page.getByRole('list', { name: 'Lagren i filen' })).toBeVisible();
    expect(await reflowProblems(page)).toEqual([]);
    await expectNoAxeViolations(page);
  });
});
