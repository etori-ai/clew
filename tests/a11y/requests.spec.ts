import type { Page } from '@playwright/test';
import type { Area, RequestsResult } from '@clew/contracts';
import {
  desktop,
  expect,
  expectNoAxeViolations,
  heading,
  narrow,
  open,
  openNav,
  reflowProblems,
  test,
} from './support';
import { requestsOutput, requestsSpec } from './requests';
import { requestCapabilities } from '../../apps/server/src/modules/requests/capabilities';
import { REQUEST_STATE_WORDS } from '../../apps/server/src/modules/requests/domain';

/**
 * Beställningar och felanmälningar (D123) is a tool since Hem has no such block (D126 rule 8): for a person with a
 * service desk, Clew's own list is a row under Verktyg and a tile on Alla verktyg, named as the capability names it for
 * the menu, whether or not an administrator placed it (D40), and it leads to the list's own page, where every request
 * is. A person without a service desk has no such tool. The mocked API answers with the view the core connector really
 * declares.
 */
const requestArea: Area = {
  id: 'requests',
  title: 'Beställningar och felanmälningar',
  connector: 'clew',
  source: 'Startsidan',
  icon: 'clock',
  figure: null,
  needsYou: 0,
  waiting: 0,
  urgency: null,
  standing: [{ capability: 'clew.requests', label: 'Beställningar och felanmälningar', kind: 'read' }],
  schedules: [],
};
/** The row's name under Verktyg: the one the capability declares for the menu, so the suite cannot drift from it. */
const LABEL = requestCapabilities({ list: async () => ({ rows: [], systems: [], unanswered: [] }) }, () => true)
  .capabilities[0]!.menu!.label;
const PAGE = '/tools/clew.requests';
const closed = (n: number): RequestsResult['rows'][number] => ({
  ref: `request:servicedesk:SD-2610040${n}`,
  label: `SD-2610040${n} · Programvara, Beställning`,
  state: REQUEST_STATE_WORDS.closed,
  status: 'Levererad',
  since: `2026-10-0${n}T09:00:00.000Z`,
  connector: 'servicedesk',
  system: 'IT-servicedesken',
  view: {
    capability: 'servicedesk.request',
    input: { ref: `request:servicedesk:SD-2610040${n}` },
    title: 'Beställning eller felanmälan',
    source: 'IT-servicedesken',
  },
});
/** Seven, the closed ones newest first, as the server orders them. */
const seven: RequestsResult = {
  ...requestsOutput,
  rows: [...requestsOutput.rows, closed(4), closed(3), closed(2), closed(1)],
};
const rail = (page: Page) => page.getByRole('navigation', { name: 'Sidonavigering' });
const row = (page: Page) => rail(page).getByRole('group', { name: 'Verktyg' }).getByRole('link', { name: LABEL });
const serve = (page: Page, output: RequestsResult = seven) =>
  page.route('**/api/cap/clew.requests**', route =>
    route.fulfill({ json: { output, source: 'Startsidan', view: requestsSpec } }),
  );

test.describe('Beställningar och felanmälningar as a tool', () => {
  test.use({ viewport: desktop });

  test('a row under Verktyg, not a block on Hem; its page lists every request in Clew’s words, the missing system named, the row marked', async ({
    page,
    api,
  }) => {
    api.areas.push(requestArea);
    await serve(page);
    await open(page, '/');
    await expect(page.getByRole('heading', { name: 'Beställningar och felanmälningar' })).toHaveCount(0);
    await expect(row(page)).toHaveAttribute('href', PAGE);
    await row(page).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(PAGE);
    await expect(heading(page, 1, 'Beställningar och felanmälningar')).toBeVisible();
    const main = page.getByRole('main');
    const items = main.getByRole('listitem');
    await expect(items).toHaveCount(7);
    // What waits on the person is the first row, marked in Clew's words for the shared state, the only row so marked;
    // the system's own word and the system's name are on every row.
    await expect(items.first()).toContainText('SD-26110042 · Behörighet, Beställning');
    await expect(items.first().getByText(REQUEST_STATE_WORDS['waiting-on-me'], { exact: true })).toBeVisible();
    await expect(main.getByText(REQUEST_STATE_WORDS['waiting-on-me'], { exact: true })).toHaveCount(1);
    await expect(items.first()).toContainText('IT-servicedesken');
    await expect(main.getByText('HR-servicedesken svarade inte.')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // The page is the tool's, so its row is the current one, though no administrator placed it.
    await expect(row(page)).toHaveAttribute('aria-current', 'page');
    await expectNoAxeViolations(page);
    // A request's name leads to the request's own page in the system it came from (D126 rule 1), never beside the list.
    await expect(main.getByRole('link', { name: 'SD-26110042 · Behörighet, Beställning' })).toHaveAttribute(
      'href',
      /^\/tools\/servicedesk\.request\?/,
    );
  });

  test('a tile on Alla verktyg under Clew’s own system leads to the list’s page, and Back returns to the tile', async ({
    page,
    api,
  }) => {
    api.areas.push(requestArea);
    await serve(page);
    await open(page, '/tools');
    const own = page.getByRole('region', { name: 'Startsidan' });
    const tile = own.getByRole('link', { name: LABEL, exact: true });
    await expect(tile).toHaveAttribute('href', `${PAGE}?from=%2Ftools`);
    await expect(own.getByText('Beställningar och felanmälningar', { exact: true })).toBeVisible();
    await tile.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(`${PAGE}?from=%2Ftools`);
    await expect(heading(page, 1, 'Beställningar och felanmälningar')).toBeVisible();
    await expect(row(page)).toHaveAttribute('aria-current', 'page');
    await page.goBack();
    await expect(page).toHaveURL('/tools');
    await expect(page.getByRole('region', { name: 'Startsidan' }).getByRole('link', { name: LABEL })).toBeFocused();
  });

  test('a person without a service desk has no such tool, in the rail or on Alla verktyg', async ({ page, api }) => {
    api.menu = [];
    await open(page, '/');
    await expect(rail(page).getByRole('link', { name: LABEL })).toHaveCount(0);
    await open(page, '/tools');
    await expect(page.getByRole('main').getByRole('link', { name: LABEL })).toHaveCount(0);
  });

  test('when no system answers the list’s page says so and can be tried again, never that there is nothing', async ({
    page,
    api,
  }) => {
    api.areas.push(requestArea);
    let down = true;
    await page.route('**/api/cap/clew.requests**', route =>
      down
        ? route.fulfill({
            status: 400,
            json: { error: 'Inget av systemen för beställningar och felanmälningar svarar just nu.' },
          })
        : route.fulfill({ json: { output: requestsOutput, source: 'Startsidan', view: requestsSpec } }),
    );
    await open(page, PAGE);
    const main = page.getByRole('main');
    await expect(
      main.getByText('Inget av systemen för beställningar och felanmälningar svarar just nu.'),
    ).toBeVisible();
    await expect(main.getByRole('listitem')).toHaveCount(0);
    await expectNoAxeViolations(page);
    down = false;
    await main.getByRole('button', { name: 'Försök igen' }).click();
    await expect(main.getByRole('listitem')).toHaveCount(3);
  });
});

test.describe('1.4.10: Beställningar och felanmälningar at 320 px', () => {
  test('the row is in the drawer, and the list’s page reflows', async ({ page, api }) => {
    api.areas.push(requestArea);
    await serve(page);
    await page.setViewportSize(narrow);
    await open(page, '/');
    const drawer = await openNav(page);
    await drawer.getByRole('link', { name: LABEL }).click();
    await expect(page).toHaveURL(PAGE);
    const main = page.getByRole('main');
    await expect(main.getByRole('link', { name: 'SD-26110042 · Behörighet, Beställning' })).toBeVisible();
    await expect(main.getByText('HR-servicedesken svarade inte.')).toBeVisible();
    expect(await reflowProblems(page)).toEqual([]);
    await expectNoAxeViolations(page);
  });
});
