import type { Page } from '@playwright/test';
import type { Area, RequestsResult } from '@clew/contracts';
import { desktop, expect, expectNoAxeViolations, heading, narrow, open, reflowProblems, test } from './support';
import { deskRequestTitle, requestsOutput, requestsSpec } from './requests';

/**
 * Beställningar och felanmälningar on Hem (D123): what the person ordered or reported in a service desk and waits for,
 * in the page's own column right after Mina ärenden and apart from it, for a person with such a system. The mocked API
 * answers with the view the core connector really declares.
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
const errandArea: Area = {
  ...requestArea,
  id: 'arenden',
  title: 'Ärenden',
  icon: 'document',
  standing: [{ capability: 'clew.errands', label: 'Mina ärenden', kind: 'read' }],
};
const closed = (n: number): RequestsResult['rows'][number] => ({
  ref: `request:servicedesk:SD-2610040${n}`,
  label: `SD-2610040${n} · Programvara, Beställning`,
  state: 'closed',
  status: 'Levererad',
  since: `2026-10-0${n}T09:00:00.000Z`,
  connector: 'servicedesk',
  system: 'IT-servicedesken',
  view: {
    capability: 'servicedesk.request',
    input: { ref: `request:servicedesk:SD-2610040${n}` },
    title: deskRequestTitle,
    source: 'IT-servicedesken',
  },
});
/** Seven: two more than Hem shows before the way to the list's page. The closed ones newest first, as the server orders them. */
const seven: RequestsResult = {
  ...requestsOutput,
  rows: [...requestsOutput.rows, closed(4), closed(3), closed(2), closed(1)],
};
const section = (page: Page) => page.getByRole('region', { name: 'Beställningar och felanmälningar' });
const showAll = (page: Page) => section(page).getByRole('link', { name: 'Visa allt', exact: true });

test.describe('Beställningar och felanmälningar on Hem', () => {
  test.use({ viewport: desktop });

  test('lists what the person ordered or reported right after Mina ärenden, the first five, the missing system named, and a row opening beside Hem', async ({
    page,
    api,
  }) => {
    api.areas.push(errandArea, requestArea);
    await page.route('**/api/cap/clew.requests**', route =>
      route.fulfill({ json: { output: seven, source: 'Startsidan', view: requestsSpec } }),
    );
    await open(page, '/');
    const requests = section(page);
    // Its own section with its own heading, directly after Mina ärenden: the two lists are never one.
    await expect(requests.getByRole('heading', { name: 'Beställningar och felanmälningar' })).toBeVisible();
    await expect(
      page.locator('section[aria-label="Mina ärenden"] + section[aria-labelledby="my-requests"]'),
    ).toHaveCount(1);
    await expect(page.getByRole('region', { name: 'Mina ärenden' }).getByText('SD-26110042')).toHaveCount(0);
    await expect(requests.getByRole('listitem')).toHaveCount(5);
    await expect(requests.getByText('5 av 7 rader')).toBeVisible();
    // What waits on the person is the first row, marked in Clew's words for the shared state, the only row so marked;
    // the system's own word and the system's name are on every row.
    const first = requests.getByRole('listitem').first();
    await expect(first).toContainText('SD-26110042 · Behörighet, Beställning');
    await expect(first.getByText('Väntar på dig', { exact: true })).toBeVisible();
    await expect(requests.getByText('Väntar på dig', { exact: true })).toHaveCount(1);
    await expect(first).toContainText('Väntar på ditt svar');
    await expect(first).toContainText('IT-servicedesken');
    await expect(requests.getByRole('listitem').nth(1)).toContainText('Pågår');
    await expect(requests.getByRole('listitem').nth(2)).toContainText('Fastighetsjouren');
    await expect(requests.getByText('HR-servicedesken svarade inte.')).toBeVisible();
    await expectNoAxeViolations(page);

    // The rest is on the list's own page, with Hem as the way back (D116).
    await expect(showAll(page)).toHaveAttribute('href', /^\/tools\/clew\.requests\?.*from=%2F/);

    // A row opens the request beside the page, in the system it came from, with the focus on the panel's heading, and
    // the list stays on Hem; closing gives the focus back to the row.
    const link = requests.getByRole('link', { name: 'SD-26110042 · Behörighet, Beställning' });
    await expect(link).toHaveAttribute('href', /open=servicedesk\.request/);
    await link.focus();
    await page.keyboard.press('Enter');
    const panel = page.getByRole('dialog', { name: deskRequestTitle });
    await expect(panel.getByText('Läsbehörighet till ekonomisystemets rapporter')).toBeVisible();
    await expect(panel.getByRole('heading', { level: 2, name: deskRequestTitle, exact: true })).toBeFocused();
    await expect(requests.getByRole('listitem')).toHaveCount(5);
    await expectNoAxeViolations(page);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(link).toBeFocused();
  });

  test('"Visa allt" leads to the list’s page, which names Hem as its way back; Back returns to Hem with the focus on "Visa allt"', async ({
    page,
    api,
  }) => {
    api.areas.push(requestArea);
    await page.route('**/api/cap/clew.requests**', route =>
      route.fulfill({ json: { output: seven, source: 'Startsidan', view: requestsSpec } }),
    );
    await open(page, '/');
    const PAGE = /^[^?]*\/tools\/clew\.requests\?.*from=%2F/;
    await showAll(page).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(PAGE);
    const main = page.getByRole('main');
    // The page, not the panel: its heading takes the focus, and every row is there.
    await expect(heading(page, 1, 'Beställningar och felanmälningar')).toBeFocused();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(main.getByRole('listitem')).toHaveCount(7);
    await expect(main.getByText('HR-servicedesken svarade inte.')).toBeVisible();
    // The way back names Hem.
    await expect(main.getByRole('link', { name: 'Hem', exact: true })).toHaveAttribute('href', '/');
    await expectNoAxeViolations(page);
    await page.goBack();
    await expect(page).toHaveURL('/');
    await expect(section(page).getByRole('listitem')).toHaveCount(5);
    await expect(showAll(page)).toBeFocused();
    // The page's own way back does the same.
    await showAll(page).click();
    await expect(page).toHaveURL(PAGE);
    await page.getByRole('main').getByRole('link', { name: 'Hem', exact: true }).click();
    await expect(page).toHaveURL('/');
    await expect(showAll(page)).toBeFocused();
  });

  test('five or fewer have no way to a page, since every row is on Hem', async ({ page, api }) => {
    api.areas.push(requestArea);
    await open(page, '/');
    await expect(section(page).getByRole('listitem')).toHaveCount(3);
    await expect(showAll(page)).toHaveCount(0);
  });

  test('a person without a service desk has no such section', async ({ page, api: _ }) => {
    await open(page, '/');
    await expect(page.getByRole('heading', { name: 'Behöver dig' })).toBeVisible();
    await expect(section(page)).toHaveCount(0);
  });

  test('when no system answers the section says so and can be tried again, never that there is nothing', async ({
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
    await open(page, '/');
    const requests = section(page);
    await expect(requests.getByRole('alert')).toHaveText(
      'Inget av systemen för beställningar och felanmälningar svarar just nu.',
    );
    await expect(requests.getByRole('listitem')).toHaveCount(0);
    await expectNoAxeViolations(page);
    down = false;
    await requests.getByRole('button', { name: 'Försök igen' }).click();
    await expect(requests.getByRole('listitem')).toHaveCount(3);
  });
});

test.describe('1.4.10: Beställningar och felanmälningar at 320 px', () => {
  test('the section reflows', async ({ page, api }) => {
    api.areas.push(requestArea);
    await page.route('**/api/cap/clew.requests**', route =>
      route.fulfill({ json: { output: seven, source: 'Startsidan', view: requestsSpec } }),
    );
    await page.setViewportSize(narrow);
    await open(page, '/');
    const requests = section(page);
    await expect(requests.getByRole('link', { name: 'SD-26110042 · Behörighet, Beställning' })).toBeVisible();
    await expect(showAll(page)).toBeVisible();
    await expect(requests.getByText('HR-servicedesken svarade inte.')).toBeVisible();
    expect(await reflowProblems(page)).toEqual([]);
    await expectNoAxeViolations(page);
  });
});
