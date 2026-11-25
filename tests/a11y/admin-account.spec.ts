import type { Page } from '@playwright/test';
import type { LinkedAccountAdminView, ManifestDiff } from '@clew/contracts';
import { connectorDetail } from './data';
import {
  announcements,
  desktop,
  expect,
  expectNoAxeViolations,
  narrow,
  open,
  reflowProblems,
  test,
  type MockApi,
} from './support';

/**
 * A connector's linked account on its administrator's page (D147 items 3 and 4), as the canvas of 2026-11-25 chose
 * (A): the fact and the block "Personernas konton" under Översikt, the notice while nobody can link, the dialog that
 * asks for a client and a system's addresses, the review of another server, and the row the review of a changed system
 * says the account in. The mocked API answers the account as the server would after an approval.
 */
const ISSUER = 'https://id.inkop.example';
const account = (more: Partial<LinkedAccountAdminView> = {}): LinkedAccountAdminView => ({
  connectorId: 'hello',
  resource: 'https://hello.kommunen.example',
  scopes: ['notes.read', 'notes.write'],
  state: 'approved',
  approved: {
    issuer: ISSUER,
    origin: 'discovered',
    client: 'registered',
    clientId: null,
    authorizationEndpoint: ISSUER + '/authorize',
    tokenEndpoint: ISSUER + '/token',
    revocationEndpoint: ISSUER + '/revoke',
    by: 'Mikael Lund',
    at: '2026-11-03T13:02:00.000Z',
  },
  found: { issuer: ISSUER, registers: true, revocable: true },
  answered: true,
  people: { linked: 14, again: 2 },
  returnAddress: 'https://startsidan.kommunen.example/api/linked-accounts/callback',
  offered: null,
  ...more,
});
/** Hello as a connector whose people link their own account, with the account its administrator's page reads. */
async function linked(page: Page, api: MockApi, view: LinkedAccountAdminView, offered?: { diff: ManifestDiff }) {
  api.admin = true;
  api.adminAccounts = { hello: view };
  await page.route('**/api/admin/connectors/hello', route =>
    route.request().method() === 'GET'
      ? route.fulfill({
          json: {
            ...connectorDetail(api.connectors.find(c => c.id === 'hello')!),
            linkedAccount: true,
            offered: offered ? { at: '2026-11-04T07:00:00.000Z', revision: 'a'.repeat(64), ...offered } : null,
          },
        })
      : route.fallback(),
  );
  await open(page, '/admin/connectors/hello');
}
const overview = (page: Page) => page.getByRole('main');
const fact = (page: Page, label: string) =>
  overview(page).getByRole('term').filter({ hasText: label }).locator('xpath=following-sibling::*[1]');

for (const [layout, viewport] of [
  ['desktop', desktop],
  ['narrow', narrow],
] as const)
  test.describe('a connector whose people link their own account, ' + layout, () => {
    test.use({ viewport });

    test('says under Översikt where they are sent, how Clew is known there and how many have linked', async ({
      page,
      api,
    }) => {
      await linked(page, api, account());
      const main = overview(page);
      await expect(main.getByText('Ja, hos https://id.inkop.example', { exact: true })).toBeVisible();
      await expect(main.getByRole('heading', { name: 'Personernas konton' })).toBeVisible();
      await expect(main.getByText('Systemet uppger den', { exact: true })).toBeVisible();
      await expect(main.getByText('Clew registrerade sig själv', { exact: true })).toBeVisible();
      await expect(main.getByText('14 kopplade · 2 behöver koppla igen')).toBeVisible();
      await expect(main.getByText(/Mikael Lund/).last()).toBeVisible();
      // People can link: nothing waits, so no notice stands over the page.
      await expect(main.getByText(/kan inte koppla|väntar på ditt godkännande/)).toHaveCount(0);
      expect(await reflowProblems(page)).toEqual([]);
      await expectNoAxeViolations(page);

      // "Ändra" asks for a client of the administrator's own; the server the system names is a fact, not a field.
      const change = main.getByRole('button', { name: 'Ändra personernas konton', exact: true });
      await change.focus();
      await page.keyboard.press('Enter');
      const dialog = page.getByRole('dialog', { name: 'Personernas konton i Hello' });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText('https://startsidan.kommunen.example/api/linked-accounts/callback')).toBeVisible();
      await expect(dialog.getByText(ISSUER, { exact: true })).toBeVisible();
      await expect(dialog.getByRole('textbox', { name: /^Klientens id/ })).toBeVisible();
      await expect(dialog.getByRole('textbox', { name: /^Adress/ })).toHaveCount(0);
      expect(await reflowProblems(page)).toEqual([]);
      await expectNoAxeViolations(page);
      // Esc saves nothing and gives the focus back to the button that opened the dialog.
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(change).toBeFocused();
      expect(api.adminAccountCalls).toEqual([]);
    });

    test('a system that names no server says nobody can link yet, and is approved with what the administrator enters', async ({
      page,
      api,
    }) => {
      await linked(
        page,
        api,
        account({ state: 'no-server', approved: null, found: null, people: { linked: 0, again: 0 } }),
      );
      const main = overview(page);
      await expect(main.getByText('Hello: personer kan inte koppla sina konton än', { exact: true })).toBeVisible();
      await expect(
        main.getByText('Systemet uppger ingen inloggningsserver. Registrera Clew i Hello och ange uppgifterna här.', {
          exact: true,
        }),
      ).toBeVisible();
      await expect(main.getByText('Inte klart: uppgifter saknas', { exact: true })).toBeVisible();
      await expect(main.getByText('Ingen har kopplat än', { exact: true })).toBeVisible();
      expect(await reflowProblems(page)).toEqual([]);
      await expectNoAxeViolations(page);

      await main.getByRole('button', { name: 'Ange uppgifter', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Personernas konton i Hello' });
      await expect(dialog.getByText('Adress att ange i Hello')).toBeVisible();
      const save = dialog.getByRole('button', { name: 'Spara och godkänn', exact: true });
      // Nothing is saved until what is required is there; every field is named.
      await expect(save).toBeDisabled();
      await dialog.getByRole('textbox', { name: /^Klientens id/ }).fill('xK2v9QmP');
      await dialog.getByLabel(/^Klientens hemlighet/).fill('en-hemlighet-som-hello-gav');
      await dialog
        .getByRole('textbox', { name: /^Adress där personer loggar in/ })
        .fill('https://hello.kommunen.example/apps/oauth2/authorize');
      await expect(save).toBeDisabled();
      await dialog
        .getByRole('textbox', { name: /^Adress där Clew hämtar kontot/ })
        .fill('https://hello.kommunen.example/apps/oauth2/api/v1/token');
      await expect(dialog.getByRole('textbox', { name: /^Adress för att ta bort en koppling/ })).toHaveValue('');
      await expect(save).toBeEnabled();
      expect(await reflowProblems(page)).toEqual([]);
      await expectNoAxeViolations(page);
      await save.click();
      await expect(dialog).toBeHidden();
      expect(api.adminAccountCalls).toEqual([
        {
          id: 'hello',
          body: {
            client: { id: 'xK2v9QmP', secret: 'en-hemlighet-som-hello-gav' },
            server: {
              authorizationEndpoint: 'https://hello.kommunen.example/apps/oauth2/authorize',
              tokenEndpoint: 'https://hello.kommunen.example/apps/oauth2/api/v1/token',
            },
          },
        },
      ]);
      // Said where the administrator is (4.1.3); the notice is gone and the facts say what was approved.
      await expect
        .poll(() => announcements(page))
        .toContainEqual(expect.stringContaining('Uppgifterna är sparade och godkända'));
      await expect(main.getByText('Hello: personer kan inte koppla sina konton än')).toHaveCount(0);
      await expect(main.getByText('Ja, hos https://hello.kommunen.example', { exact: true })).toBeVisible();
      await expect(main.getByText('Angiven av en administratör', { exact: true })).toBeVisible();
      await expect(main.getByText('Som en klient en administratör har registrerat', { exact: true })).toBeVisible();
      // The notice's button went with the notice: the focus is on the block's button, where the account now stands.
      await expect(main.getByRole('button', { name: 'Ändra personernas konton', exact: true })).toBeFocused();
      // The secret is never shown again: the dialog opens with the client and the addresses, and an empty secret.
      await page.keyboard.press('Enter');
      await expect(dialog.getByRole('textbox', { name: /^Klientens id/ })).toHaveValue('xK2v9QmP');
      await expect(dialog.getByLabel(/^Klientens hemlighet/)).toHaveValue('');
      await expect(
        dialog.getByText('Lämna tom för att behålla den som är sparad. Den visas aldrig igen.'),
      ).toBeVisible();
      await expect(save).toBeEnabled();
      await expectNoAxeViolations(page);
    });

    test('another server than the approved one waits for a review that says what it costs', async ({ page, api }) => {
      await linked(
        page,
        api,
        account({
          state: 'changed',
          found: { issuer: 'https://login.inkop.example', registers: true, revocable: true },
        }),
      );
      const main = overview(page);
      await expect(
        main.getByText('Hello: en annan inloggningsserver väntar på ditt godkännande', { exact: true }),
      ).toBeVisible();
      await expect(
        main.getByText(
          'Ingen skickas dit förrän du har granskat och godkänt den. De 14 kopplade kontona används som förut så länge systemet godtar dem.',
          { exact: true },
        ),
      ).toBeVisible();
      expect(await reflowProblems(page)).toEqual([]);
      await expectNoAxeViolations(page);

      const review = main.getByRole('button', { name: 'Granska', exact: true });
      await review.click();
      const dialog = page.getByRole('dialog', { name: 'Systemet uppger en annan inloggningsserver' });
      const rows = dialog.getByRole('list', { name: 'Ändringar' }).getByRole('listitem');
      await expect(rows).toHaveCount(2);
      await expect(rows.nth(0)).toContainText('Personer loggar in hos https://login.inkop.example');
      await expect(rows.nth(0)).toContainText('I dag: https://id.inkop.example.');
      await expect(rows.nth(1)).toContainText('16 personer behöver koppla sina konton igen');
      await expect(rows.nth(1)).toContainText('De får veta det där systemets innehåll saknas.');
      expect(await reflowProblems(page)).toEqual([]);
      await expectNoAxeViolations(page);
      // Keeping the old one leaves it waiting: nothing is sent, and the notice stands.
      await dialog.getByRole('button', { name: 'Behåll den gamla', exact: true }).click();
      await expect(dialog).toBeHidden();
      expect(api.adminAccountCalls).toEqual([]);
      await expect(review).toBeFocused();

      await review.click();
      await dialog.getByRole('button', { name: 'Godkänn den nya', exact: true }).click();
      await expect(dialog).toBeHidden();
      expect(api.adminAccountCalls).toEqual([{ id: 'hello', body: {} }]);
      await expect
        .poll(() => announcements(page))
        .toContainEqual(expect.stringContaining('Inloggningsservern är godkänd'));
      await expect(main.getByText('Ja, hos https://login.inkop.example', { exact: true })).toBeVisible();
      await expect(main.getByText('0 kopplade · 16 behöver koppla igen')).toBeVisible();
      await expect(main.getByText(/väntar på ditt godkännande/)).toHaveCount(0);
      await expect(main.getByRole('button', { name: 'Ändra personernas konton', exact: true })).toBeFocused();
    });
  });

test.describe('the account beside the rest of the connector’s page', () => {
  test.use({ viewport: desktop });

  test('the review of a changed system names the account, and a connector without one says Nej', async ({
    page,
    api,
  }) => {
    const to = { resource: 'https://hello.kommunen.example', scopes: ['notes.read', 'notes.write'] };
    const diff: ManifestDiff = {
      added: ['hello.notes'],
      removed: [],
      changed: [],
      areasAdded: [],
      areasRemoved: [],
      areasChanged: [],
      usesAdded: [],
      usesRemoved: [],
      linkedAccount: { from: null, to },
      fields: [],
      same: false,
    };
    await linked(
      page,
      api,
      account({
        resource: null,
        scopes: [],
        state: 'waiting',
        approved: null,
        found: null,
        answered: false,
        people: { linked: 0, again: 0 },
        offered: { ...to, found: { issuer: ISSUER, registers: true, revocable: true }, answered: true },
      }),
      { diff },
    );
    const main = overview(page);
    // Nothing of it is approved: the fact is Nej, there is no block, and no notice of its own beside the change's.
    await expect(fact(page, 'Personer kopplar eget konto')).toHaveText('Nej');
    await expect(main.getByRole('heading', { name: 'Personernas konton' })).toHaveCount(0);
    await expect(main.getByText(/kan inte koppla/)).toHaveCount(0);
    await main.getByRole('button', { name: 'Granska ändringen', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Systemet har ändrats' });
    const row = dialog.getByRole('listitem').filter({ hasText: 'Personer kopplar ett eget konto i systemet' });
    await expect(row).toContainText('De loggar in hos https://id.inkop.example, som systemet uppger.');
    await expect(row).toContainText('Clew ber om: notes.read, notes.write.');
    await expect(row).toContainText('Clew registrerar sig själv där.');
    await expectNoAxeViolations(page);
  });

  test('a connector that declares no account says Nej and asks nothing about one', async ({ page, api }) => {
    api.admin = true;
    await open(page, '/admin/connectors/hello');
    await expect(fact(page, 'Personer kopplar eget konto')).toHaveText('Nej');
    await expect(overview(page).getByRole('heading', { name: 'Personernas konton' })).toHaveCount(0);
  });

  test('on a short screen the dialog scrolls its fields and keeps its buttons on screen', async ({ page, api }) => {
    await page.setViewportSize({ width: 1280, height: 520 });
    await linked(page, api, account({ state: 'no-server', approved: null, found: null }));
    await overview(page).getByRole('button', { name: 'Ange uppgifter', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Personernas konton i Hello' });
    await expect(dialog.getByRole('button', { name: 'Avbryt', exact: true })).toBeInViewport();
    await expect(dialog.getByRole('button', { name: 'Spara och godkänn', exact: true })).toBeInViewport();
    // The last field is reached with the keyboard, which scrolls it into view.
    const last = dialog.getByRole('textbox', { name: /^Adress för att ta bort en koppling/ });
    await last.focus();
    await expect(last).toBeInViewport();
    await expect(dialog.getByRole('button', { name: 'Spara och godkänn', exact: true })).toBeInViewport();
  });
});
