import type { Page } from '@playwright/test';
import type { Area, LinkedAccountEntry } from '@clew/contracts';
import {
  announcements,
  desktop,
  expect,
  expectNoAxeViolations,
  narrow,
  open,
  openSettings,
  reflowProblems,
  test,
} from './support';

/**
 * Linked accounts (D147) as a person meets them: a system that needs their account is said where its content is
 * missing (under the rows of "Behöver dig" on Hem and in the system's own list), never as a banner; a link that was
 * lost and a first link are told apart; several become one line that leads to "Kopplade konton", the page from the
 * person's menu where each is linked and ended. Linking leaves for the system and comes back to the page it left from:
 * the mocked API answers the address the system would have returned the person to.
 */
const entry = (
  connectorId: string,
  source: string,
  state: LinkedAccountEntry['state'],
  more: Partial<LinkedAccountEntry> = {},
): LinkedAccountEntry => ({
  connectorId,
  source,
  state,
  linkedAt: state === 'not-linked' ? null : '2026-10-14T09:00:00.000Z',
  lostAt: state === 'needs-link' ? '2026-11-03T07:30:00.000Z' : null,
  putOff: false,
  revocable: true,
  ...more,
});
const buy = (state: LinkedAccountEntry['state'], more?: Partial<LinkedAccountEntry>) =>
  entry('purchasing', 'Inköpssystemet', state, more);
const lms = (state: LinkedAccountEntry['state'], more?: Partial<LinkedAccountEntry>) =>
  entry('lms', 'Lärplattformen', state, more);
const cloud = (state: LinkedAccountEntry['state'], more?: Partial<LinkedAccountEntry>) =>
  entry('cloud', 'Nextcloud', state, more);

const needs = (page: Page) => page.getByRole('region', { name: 'Behöver dig' });
const toasts = (page: Page) => page.getByRole('region', { name: 'Aviseringar' });
const accounts = (page: Page) => page.getByRole('list', { name: 'Kopplade konton' });
const rowOf = (page: Page, source: string) => accounts(page).getByRole('listitem').filter({ hasText: source });

for (const [layout, viewport] of [
  ['desktop', desktop],
  ['narrow', narrow],
] as const)
  test.describe('a system that needs the person’s account, ' + layout, () => {
    test.use({ viewport });

    test('is said under the rows of Behöver dig, not counted, and linking comes back to Hem and says so once', async ({
      page,
      api,
    }) => {
      api.accounts = [buy('not-linked')];
      const counted = api.threads.filter(t => t.state === 'open').length;
      await open(page, '/');
      const card = needs(page);
      await expect(card.getByText('Inköpssystemet behöver ditt konto', { exact: true })).toBeVisible();
      await expect(
        card.getByText('Du loggar in hos Inköpssystemet en gång och kommer sedan tillbaka hit.', { exact: true }),
      ).toBeVisible();
      // A first link carries no badge, is no row of the list and no banner over the page.
      await expect(card.getByText('Behöver kopplas igen')).toHaveCount(0);
      await expect(card.getByRole('list', { name: 'Behöver dig' }).getByText('Inköpssystemet behöver')).toHaveCount(0);
      expect(counted).toBeGreaterThan(0);
      await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
      expect(await reflowProblems(page)).toEqual([]);
      await expectNoAxeViolations(page);

      // The button is named with the system, since a page may hold two; it leaves and the person comes back linked.
      const link = card.getByRole('button', { name: 'Koppla ditt konto: Inköpssystemet', exact: true });
      await link.focus();
      await page.keyboard.press('Enter');
      await expect(toasts(page).getByText('Ditt konto i Inköpssystemet är kopplat', { exact: true })).toBeVisible();
      expect(api.accountCalls).toEqual([{ method: 'POST', path: '/purchasing/link', body: { returnTo: '/' } }]);
      // The address is Hem's own again, and nothing more says the system needs the account.
      await expect(page).toHaveURL('/');
      await expect(needs(page).getByText('Inköpssystemet behöver ditt konto')).toHaveCount(0);
      await expectNoAxeViolations(page);
    });

    test('a link that was lost carries the badge and cannot be put off; a first link can, and the focus stays in the card', async ({
      page,
      api,
    }) => {
      api.accounts = [buy('needs-link'), lms('not-linked')];
      await open(page, '/');
      const card = needs(page);
      await expect(card.getByText('Inköpssystemet godtar inte längre ditt konto', { exact: true })).toBeVisible();
      await expect(
        card.getByText('Sedan 3 november kan Clew inte läsa det som är ditt där.', { exact: true }),
      ).toBeVisible();
      await expect(card.getByText('Behöver kopplas igen', { exact: true })).toBeVisible();
      await expect(card.getByRole('button', { name: 'Koppla igen: Inköpssystemet', exact: true })).toBeVisible();
      await expect(card.getByText('Lärplattformen behöver ditt konto', { exact: true })).toBeVisible();
      // "Inte nu" stands on the first link alone.
      const later = card.getByRole('button', { name: /^Inte nu/ });
      await expect(later).toHaveCount(1);
      await expect(later).toHaveAccessibleName('Inte nu: Lärplattformen behöver ditt konto');
      expect(await reflowProblems(page)).toEqual([]);
      await expectNoAxeViolations(page);

      await later.focus();
      await page.keyboard.press('Enter');
      await expect(card.getByText('Lärplattformen behöver ditt konto')).toHaveCount(0);
      await expect(card.getByText('Inköpssystemet godtar inte längre ditt konto', { exact: true })).toBeVisible();
      // The button went with its line: the focus is on the card's heading, and where the system went is said (4.1.3).
      await expect(page.getByRole('heading', { level: 2, name: 'Behöver dig' })).toBeFocused();
      await expect(
        toasts(page).getByText('Du kan koppla ditt konto senare under Kopplade konton.', { exact: true }),
      ).toBeVisible();
      expect(api.accountCalls).toEqual([{ method: 'POST', path: '/later', body: { connectors: ['lms'] } }]);
      await expectNoAxeViolations(page);
    });

    test('several systems are one line that leads to Kopplade konton, where each is linked and ended', async ({
      page,
      api,
    }) => {
      api.accounts = [buy('needs-link'), cloud('not-linked', { revocable: false }), lms('not-linked')];
      await open(page, '/');
      const card = needs(page);
      // One lost link is linked from its line; two first links are one line with one way to the page.
      await expect(card.getByText('2 system behöver ditt konto', { exact: true })).toBeVisible();
      await expect(
        card.getByText('Nextcloud och Lärplattformen. Du loggar in hos vart och ett en gång.', { exact: true }),
      ).toBeVisible();
      const toPage = card.getByRole('link', { name: 'Visa kopplade konton', exact: true });
      await expect(toPage).toHaveCount(1);
      await toPage.click();
      await expect(page).toHaveURL('/accounts');
      await expect(page.getByRole('heading', { level: 1, name: 'Kopplade konton' })).toBeVisible();
      await expect(page).toHaveTitle(/^Kopplade konton/);

      // What needs the person stands first: the lost link, then the two not linked.
      await expect(accounts(page).getByRole('listitem')).toHaveCount(3);
      const lost = rowOf(page, 'Inköpssystemet');
      await expect(lost).toContainText('Behöver kopplas igen');
      await expect(lost).toContainText('Kopplat 14 oktober 2026 · Inköpssystemet godtar inte längre kontot');
      await expect(rowOf(page, 'Nextcloud')).toContainText('Inte kopplat');
      expect(await reflowProblems(page)).toEqual([]);
      await expectNoAxeViolations(page);

      // Linking from the page comes back to the page, says so, and the row is among the linked.
      await lost.getByRole('button', { name: 'Koppla igen: Inköpssystemet', exact: true }).click();
      await expect(toasts(page).getByText('Ditt konto i Inköpssystemet är kopplat', { exact: true })).toBeVisible();
      await expect(page).toHaveURL('/accounts');
      await expect(rowOf(page, 'Inköpssystemet')).toContainText('Kopplat 4 november 2026');
      await expect(rowOf(page, 'Inköpssystemet').getByText('Behöver kopplas igen')).toHaveCount(0);

      // A system that can be told is ended at once: the row says so and its new button has the focus.
      const end = rowOf(page, 'Inköpssystemet').getByRole('button', {
        name: 'Koppla från Inköpssystemet',
        exact: true,
      });
      await end.focus();
      await page.keyboard.press('Enter');
      await expect(toasts(page).getByText('Ditt konto i Inköpssystemet är frånkopplat', { exact: true })).toBeVisible();
      await expect(rowOf(page, 'Inköpssystemet')).toContainText('Inte kopplat');
      await expect(
        rowOf(page, 'Inköpssystemet').getByRole('button', { name: 'Koppla Inköpssystemet', exact: true }),
      ).toBeFocused();
      expect(api.accountCalls.at(-1)).toEqual({ method: 'DELETE', path: '/purchasing', body: {} });
      await expectNoAxeViolations(page);
    });

    test('a system that cannot be told asks first, and says what the person does there', async ({ page, api }) => {
      api.accounts = [cloud('linked', { revocable: false })];
      await open(page, '/accounts');
      const end = page.getByRole('button', { name: 'Koppla från Nextcloud', exact: true });
      await end.focus();
      await page.keyboard.press('Enter');
      const dialog = page.getByRole('alertdialog', { name: 'Koppla från Nextcloud?' });
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText('ta också bort Clew i dina inställningar där');
      await expectNoAxeViolations(page);
      // Esc cancels and gives the focus back to the row's button; nothing was asked of the server.
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(end).toBeFocused();
      expect(api.accountCalls).toEqual([]);

      await page.keyboard.press('Enter');
      await dialog.getByRole('button', { name: 'Koppla från', exact: true }).click();
      await expect(dialog).toBeHidden();
      await expect(toasts(page).getByText('Ditt konto i Nextcloud är frånkopplat', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Koppla Nextcloud', exact: true })).toBeFocused();
      expect(await reflowProblems(page)).toEqual([]);
      await expectNoAxeViolations(page);
    });
  });

test.describe('linked accounts beside the rest of the page', () => {
  test.use({ viewport: desktop });

  test('the person’s menu leads to Kopplade konton only when there is a system to list', async ({ page, api }) => {
    await open(page, '/');
    const without = await openSettings(page);
    await expect(without.getByRole('link', { name: 'Min sida', exact: true })).toBeVisible();
    await expect(without.getByRole('link', { name: 'Kopplade konton' })).toHaveCount(0);
    await page.keyboard.press('Escape');

    api.accounts = [buy('linked')];
    await open(page, '/');
    // Everything is linked: Hem says nothing about it.
    await expect(needs(page).getByText(/konto/)).toHaveCount(0);
    const settings = await openSettings(page);
    const way = settings.getByRole('link', { name: 'Kopplade konton', exact: true });
    await expect(way).toHaveAttribute('href', '/accounts');
    await expectNoAxeViolations(page);
    await way.click();
    await expect(page).toHaveURL('/accounts');
    await expect(rowOf(page, 'Inköpssystemet')).toContainText('Kopplat 14 oktober 2026');
  });

  test('a person with no such system is told so on the page', async ({ page, api }) => {
    expect(api.accounts).toEqual([]);
    await open(page, '/accounts');
    await expect(page.getByRole('heading', { level: 1, name: 'Kopplade konton' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Inga konton att koppla' })).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test('a person who declined at the system is told nothing, and a link that failed is said as an error', async ({
    page,
    api,
  }) => {
    api.accounts = [buy('not-linked')];
    api.linkOutcome = 'declined';
    await open(page, '/');
    await needs(page).getByRole('button', { name: 'Koppla ditt konto: Inköpssystemet', exact: true }).click();
    await expect(page).toHaveURL('/');
    await expect(needs(page).getByText('Inköpssystemet behöver ditt konto', { exact: true })).toBeVisible();
    await expect(toasts(page).getByText(/Inköpssystemet/)).toHaveCount(0);

    api.linkOutcome = 'failed';
    await needs(page).getByRole('button', { name: 'Koppla ditt konto: Inköpssystemet', exact: true }).click();
    await expect(
      toasts(page).getByText('Det gick inte att koppla ditt konto i Inköpssystemet. Försök igen.', { exact: true }),
    ).toBeVisible();
    await expect(page).toHaveURL('/');
    await expect(needs(page).getByText('Inköpssystemet behöver ditt konto', { exact: true })).toBeVisible();
    await expectNoAxeViolations(page);
  });

  // The cards' read names the system as blocked where no session stands behind its scan; where one does, the scan is
  // taken up again by the read itself and the status says nothing. The page says the same in both.
  for (const status of ['blocked', 'taken up again'] as const)
    test(`a system that no longer accepts the account is not said to be silent, and its kept cards say they may be old (${status})`, async ({
      page,
      api,
    }) => {
      api.threads = api.threads.filter(t => t.id === 'fakturor');
      api.accounts = [entry('finance', 'Ekonomisystemet', 'needs-link')];
      api.sources = [
        {
          connector: 'finance',
          state: status === 'blocked' ? 'blocked' : 'pending',
          lastSuccess: '2026-11-03T07:00:00.000Z',
          error: status === 'blocked' ? 'authorization-required' : null,
        },
      ];
      await open(page, '/');
      await expect(
        needs(page).getByText('Ekonomisystemet godtar inte längre ditt konto', { exact: true }),
      ).toBeVisible();
      await expect(
        needs(page).getByText('Sedan 3 november kan Clew inte läsa det som är ditt där.', { exact: true }),
      ).toBeVisible();
      // The card Clew kept from the system stands as it was when the account last worked, and says so.
      await expect(page.locator('#work-fakturor')).toContainText('kan vara gammal');
      await expect(page.getByText(/svarar inte/)).toHaveCount(0);
      expect((await announcements(page)).filter(said => said.includes('svarar inte'))).toEqual([]);
    });

  test('the system’s own list says it where its rows would be, with the one button', async ({ page, api }) => {
    const area: Area = {
      id: 'inkop',
      title: 'Inköp',
      connector: 'purchasing',
      source: 'Inköpssystemet',
      icon: 'document',
      figure: null,
      needsYou: 0,
      waiting: 0,
      urgency: null,
      standing: [{ capability: 'purchasing.requests', label: 'Inköp att godkänna', kind: 'read' }],
      schedules: [],
    };
    api.areas.push(area);
    api.views.push({ capability: 'purchasing.requests', title: 'Inköp att godkänna', kind: 'list' });
    api.accounts = [buy('not-linked', { putOff: true })];
    await page.route('**/api/cap/purchasing.requests**', route =>
      route.fulfill({
        status: 400,
        json: {
          error: 'Systemet behöver ditt konto. Koppla ditt konto och försök igen.',
          code: 'authorization-required',
        },
      }),
    );
    await open(page, '/tools/purchasing.requests');
    const main = page.getByRole('main');
    // Put off on Hem, the system still says it here: the list has nothing else to show.
    await expect(page.getByRole('heading', { level: 1, name: 'Inköp att godkänna' })).toBeVisible();
    await expect(main.getByText('Inköpssystemet behöver ditt konto', { exact: true })).toBeVisible();
    await expect(main.getByRole('button', { name: 'Koppla ditt konto: Inköpssystemet', exact: true })).toBeVisible();
    await expect(main.getByRole('button', { name: 'Försök igen' })).toHaveCount(0);
    await expect(main.getByRole('button', { name: /^Inte nu/ })).toHaveCount(0);
    await expectNoAxeViolations(page);
  });

  test('a decision that waits for the account offers the link, and once linked the check that sends it', async ({
    page,
    api,
  }) => {
    const card = api.threads.find(t => t.id === 'fakturor')!;
    card.execution = {
      id: 'execution-fixture',
      decisionId: 'decision-fixture',
      operation: 'finance.approve',
      state: 'pending',
      reason: 'needs-link',
      compensates: null,
    };
    api.threads = [card];
    api.accounts = [entry('finance', 'Ekonomisystemet', 'needs-link')];
    await open(page, '/todo?item=fakturor');
    await expect(page.getByText('Kan inte skickas än', { exact: true })).toBeVisible();
    await expect(
      page.getByText('Ekonomisystemet godtar inte längre ditt konto. Ditt beslut är sparat och inget har skickats.', {
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Kontrollera status' })).toHaveCount(0);
    await expectNoAxeViolations(page);

    await page.getByRole('button', { name: 'Koppla ditt konto igen', exact: true }).click();
    await expect(toasts(page).getByText('Ditt konto i Ekonomisystemet är kopplat', { exact: true })).toBeVisible();
    // Back on the item, nothing was sent by the linking: the notice now offers the check that sends it.
    await expect(page).toHaveURL('/todo?item=fakturor');
    await expect(page.getByText('Har inte skickats', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Kontrollera status', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Koppla ditt konto igen' })).toHaveCount(0);
    await expectNoAxeViolations(page);
  });
});
