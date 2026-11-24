import type { Page } from '@playwright/test';
import type { Area, ErrandsResult } from '@clew/contracts';
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
  toolRow,
  toolsButton,
} from './support';
import { errandsOutput, errandsSpec } from './errands';
import { errandCapabilities } from '../../apps/server/src/modules/errands/capabilities';

/**
 * Mina ärenden (D90) is a tool since Hem has no such block (D126 rule 8): for a person with a case system, the combined
 * errand list is a row under Verktyg and a tile on Alla verktyg, named as the capability names it for the menu, whether
 * or not an administrator placed it (D40), and it leads to the list's own page with its own choice between what is
 * assigned and what the person reported. The mocked API answers with the view the core connector really declares.
 */
const errandArea: Area = {
  id: 'arenden',
  title: 'Ärenden',
  connector: 'clew',
  source: 'Clew',
  icon: 'document',
  figure: null,
  needsYou: 0,
  waiting: 0,
  urgency: null,
  standing: [{ capability: 'clew.errands', label: 'Mina ärenden', kind: 'read' }],
  schedules: [],
};
/** The row's name under Verktyg: the one the capability declares for the menu, so the suite cannot drift from it. */
const LABEL = errandCapabilities({ list: async () => errandsOutput }, () => true).capabilities[0]!.menu!.label;
const PAGE = '/tools/clew.errands';
const permit = (n: number): ErrandsResult['rows'][number] => ({
  ref: `errand:permits:2026-00040${n}`,
  label: `BYGG 2026-00040${n} · Bygglov, Ansökan`,
  state: 'active',
  status: 'Pågående',
  since: `2026-10-2${n}T09:00:00.000Z`,
  area: 'Bygglov',
  connector: 'permits',
  system: 'Bygglovssystemet',
  view: {
    capability: 'permits.errand',
    input: { ref: `errand:permits:2026-00040${n}` },
    title: 'Ärende',
    source: 'Bygglovssystemet',
  },
});
const seven: ErrandsResult = {
  ...errandsOutput,
  rows: [...errandsOutput.rows, permit(1), permit(2), permit(3), permit(4)],
};
const rail = (page: Page) => page.getByRole('navigation', { name: 'Mina sidor', exact: true });
/** The tool in the menu at the end of the pages' row (D130), the menu opened first. */
const row = (page: Page) => toolRow(page, LABEL);

test.describe('Mina ärenden as a tool', () => {
  test.use({ viewport: desktop });

  test('a tool under Verktyg, not a block on Hem; its page lists the errands from every system, the missing system named, the menu named by it', async ({
    page,
    api,
  }) => {
    api.areas.push(errandArea);
    await page.route('**/api/cap/clew.errands**', route =>
      route.fulfill({ json: { output: seven, source: 'Clew', view: errandsSpec } }),
    );
    await open(page, '/');
    await expect(page.getByRole('region', { name: 'Mina ärenden' })).toHaveCount(0);
    await expect(await row(page)).toHaveAttribute('href', PAGE);
    await (await row(page)).click();
    await expect(page).toHaveURL(PAGE);
    await expect(heading(page, 1, 'Mina ärenden')).toBeVisible();
    const main = page.getByRole('main');
    const items = main.getByRole('listitem');
    await expect(items).toHaveCount(7);
    // What waits on the person is the first row, and each row says which system it is in.
    await expect(items.first()).toContainText('IK-26110007 · Behörighet, Beställning');
    await expect(items.first()).toContainText('Dig');
    await expect(items.first()).toContainText('Ärendesystemet');
    await expect(main.getByText('Verksamhetssystemet svarade inte.')).toBeVisible();
    // The menu's button is named by the tool that is open.
    await expect(rail(page).getByRole('button', { name: LABEL, exact: true })).toBeVisible();
    await expectNoAxeViolations(page);
    // A row's name leads to the errand's own page, read from the system it came from (D126 rule 1).
    const link = main.getByRole('link', { name: 'IK-26110007 · Behörighet, Beställning' });
    await expect(link).toHaveAttribute('href', /^\/tools\/sm\.errand\?/);
    await link.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/tools\/sm\.errand\?/);
    await expect(page.getByText('Ny medarbetare behöver konto i elevregistret')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('a person without a case system has no such tool', async ({ page, api: _ }) => {
    await open(page, '/');
    await expect(page.getByRole('heading', { name: 'Behöver dig' })).toBeVisible();
    await expect(toolsButton(page)).toHaveCount(0);
  });

  test('when no case system answers the list’s page says so and can be tried again, never "no errands"', async ({
    page,
    api,
  }) => {
    api.areas.push(errandArea);
    let down = true;
    await page.route('**/api/cap/clew.errands**', route =>
      down
        ? route.fulfill({ status: 400, json: { error: 'Inget av ärendesystemen svarar just nu.' } })
        : route.fulfill({ json: { output: errandsOutput, source: 'Clew', view: errandsSpec } }),
    );
    await open(page, PAGE);
    const main = page.getByRole('main');
    await expect(main.getByText('Inget av ärendesystemen svarar just nu.')).toBeVisible();
    await expect(main.getByRole('listitem')).toHaveCount(0);
    await expectNoAxeViolations(page);
    down = false;
    await main.getByRole('button', { name: 'Försök igen' }).click();
    await expect(main.getByRole('listitem')).toHaveCount(3);
  });
});

test.describe('1.4.10: Mina ärenden at 320 px', () => {
  test('the row is in the drawer, and the list’s page reflows', async ({ page, api }) => {
    api.areas.push(errandArea);
    await page.setViewportSize(narrow);
    await open(page, '/');
    await (await openNav(page)).getByRole('link', { name: LABEL }).click();
    await expect(page).toHaveURL(PAGE);
    const main = page.getByRole('main');
    await expect(main.getByRole('link', { name: 'IK-26110007 · Behörighet, Beställning' })).toBeVisible();
    await expect(main.getByText('Verksamhetssystemet svarade inte.')).toBeVisible();
    expect(await reflowProblems(page)).toEqual([]);
    await expectNoAxeViolations(page);
  });
});
