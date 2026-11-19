import type { Page } from '@playwright/test';
import { user } from './data';
import { ANNA, BoardingMock, MARIA, PLAN } from './boarding';
import { expect, expectNoAxeViolations, hiddenFocusStops, narrow, open, phone, reflowProblems, test } from './support';

/**
 * Introduktion och avslut (D124 item 12) as Personal's tab of that name (D126 rule 8); a person's own plan is a tab of
 * their own page (rule 7). The list `/boarding` (D116: a list is a page): the reader's own plan apart and above, the
 * reports Clew suggests an introduction for, and the open plans they manage, each row's name the link to the plan,
 * whose way back is the list. Focus on arrival and on the way back, the empty states, 30 rows, reflow at 320 px and axe.
 * The mock's clock stands at 2026-11-04; Anna's first day is 16 November, one of her items is late, and Maria's
 * employment starts 1 December with no introduction.
 */
const wide = { width: 1440, height: 900 };
const LIST = '/boarding';
const TITLE = 'Introduktion och avslut';
const rail = (page: Page) => page.getByRole('navigation', { name: 'Mina sidor', exact: true });
/** The place among the rail's places (no spec here holds `admin.boarding`, so there is no row of that name under Administration). */
const place = (page: Page) => rail(page).getByRole('link', { name: TITLE, exact: true });
const heading = (page: Page, name: string) => page.getByRole('heading', { name, exact: true });
const plans = (page: Page) => page.getByRole('table', { name: 'Medarbetarnas planer' });
const suggested = (page: Page) => page.getByRole('list', { name: 'Nya medarbetare utan introduktion' });
/** The page's sections in the order a screen reader meets them, by their headings. */
const sections = (page: Page) => page.getByRole('main').getByRole('heading', { level: 2 }).allTextContents();

test.describe('Personal’s tab', () => {
  test.use({ viewport: wide });

  test('a manager is led to the list by Personal’s tab Introduktion och avslut, which is marked; the rail marks Personal', async ({
    page,
    api,
  }) => {
    api.boarding = new BoardingMock();
    await open(page, '/staff');
    const tab = page.getByRole('navigation', { name: 'Personal' }).getByRole('link', { name: TITLE, exact: true });
    await expect(tab).toHaveAttribute('href', LIST);
    await tab.click();
    await expect(page).toHaveURL(LIST);
    await expect(page).toHaveTitle(`${TITLE} · Personal · Startsidan`);
    await expect(tab).toHaveAttribute('aria-current', 'true');
    await expect(tab).toBeFocused();
    await expect(rail(page).getByRole('link', { name: 'Personal', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(place(page)).toHaveCount(0);
  });

  test('switched off, the list’s address says so', async ({ page, api }) => {
    api.boarding = null;
    await open(page, LIST);
    await expect(
      page.getByRole('heading', { level: 2, name: 'Introduktion och avslut är inte påslaget för dig' }),
    ).toBeVisible();
    await expectNoAxeViolations(page);
  });
});

test.describe('the list', () => {
  test.use({ viewport: wide });

  test("each open plan a row of facts, the person's name the link to it; the suggested start above; axe", async ({
    page,
    api,
  }) => {
    api.boarding = new BoardingMock();
    await open(page, LIST);
    await expect(heading(page, 'Personal')).toBeVisible();
    expect(await sections(page)).toEqual(['Nya medarbetare utan introduktion', 'Medarbetarnas planer']);
    const table = plans(page);
    await expect(table.getByRole('columnheader')).toHaveText(['Medarbetare', 'Plan', 'Dag', 'Klara', 'Status']);
    const anna = table.getByRole('row', { name: /Anna Lindqvist/ });
    await expect(anna.getByRole('cell')).toHaveText([
      'Anna Lindqvist',
      'Introduktion',
      'Första dagen mån 16 nov.',
      '1 av 6',
      '1 försenad',
    ]);
    await expect(anna.getByRole('link', { name: 'Anna Lindqvist', exact: true })).toHaveAttribute(
      'href',
      `/boarding/${ANNA}?plan=${PLAN}&from=%2Fboarding`,
    );
    // Facts only: the name is the row's one control.
    await expect(table.getByRole('button')).toHaveCount(0);
    await expect(table.getByRole('link')).toHaveCount(1);
    // Maria starts 1 December with no introduction: her name leads to her page, the start to its dialog over it.
    const maria = suggested(page).getByRole('listitem');
    await expect(maria).toContainText('Börjar tis 1 dec. enligt katalogen');
    await expect(maria.getByRole('link', { name: 'Maria Källström', exact: true })).toHaveAttribute(
      'href',
      `/boarding/${MARIA}?from=%2Fboarding`,
    );
    const start = maria.getByRole('link', { name: 'Starta introduktion för Maria Källström' });
    await expect(start).toHaveAttribute('href', `/boarding/${MARIA}?start=introduction&from=%2Fboarding`);
    await expectNoAxeViolations(page);
    const { hidden, unmarked } = await hiddenFocusStops(page);
    expect(hidden).toEqual([]);
    expect(unmarked).toEqual([]);
    await start.click();
    await expect(page.getByRole('dialog', { name: 'Förbered introduktionen' })).toBeVisible();
  });

  test('a plan opened from the list has the list as its way back, which gives the focus to its name; so does Back', async ({
    page,
    api,
  }) => {
    api.boarding = new BoardingMock();
    await open(page, LIST);
    const name = plans(page).getByRole('link', { name: 'Anna Lindqvist', exact: true });
    await name.click();
    await expect(page).toHaveURL(`/boarding/${ANNA}?plan=${PLAN}&from=%2Fboarding`);
    await expect(heading(page, 'Introduktion för Anna Lindqvist')).toBeVisible();
    await expect(rail(page).getByRole('link', { name: 'Personal', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    const back = page.getByRole('main').getByRole('link', { name: TITLE, exact: true });
    await expect(back).toHaveAttribute('href', LIST);
    await back.click();
    await expect(page).toHaveURL(LIST);
    await expect(name).toBeFocused();
    await name.click();
    await expect(heading(page, 'Introduktion för Anna Lindqvist')).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(LIST);
    await expect(name).toBeFocused();
  });

  test("the reader's own plan stands apart, above the plans they manage, and never among them", async ({
    page,
    api,
  }) => {
    const boarding = (api.boarding = new BoardingMock());
    const mine = boarding.ownPlan();
    await open(page, LIST);
    expect(await sections(page)).toEqual(['Din plan', 'Nya medarbetare utan introduktion', 'Medarbetarnas planer']);
    const own = page.getByRole('list', { name: 'Din plan' });
    await expect(own.getByRole('link', { name: 'Avslut', exact: true })).toHaveAttribute(
      'href',
      `/boarding/${user.id}?plan=${mine}&from=%2Fboarding`,
    );
    await expect(own.getByRole('listitem')).toContainText('Sista dagen tors 31 dec. · 0 av 1 klara');
    await expect(plans(page).getByRole('row')).toHaveCount(2);
    await expect(plans(page).getByText(user.name)).toHaveCount(0);
    await expectNoAxeViolations(page);
  });

  test('a manager with no open plan is told where plans are started; the row stays', async ({ page, api }) => {
    const boarding = (api.boarding = new BoardingMock());
    boarding.plans = [];
    boarding.reports = boarding.reports.filter(r => !r.startOn);
    await open(page, LIST);
    expect(await sections(page)).toEqual(['Medarbetarnas planer']);
    await expect(page.getByRole('main').getByRole('heading', { level: 3, name: 'Inga pågående planer' })).toBeVisible();
    await expect(page.getByRole('main').getByRole('link', { name: 'Till Personal' })).toHaveAttribute('href', '/staff');
    await expect(plans(page)).toHaveCount(0);
    await expectNoAxeViolations(page);
  });

  test('someone it does not apply to is told so on the page', async ({ page, api }) => {
    api.employee = true;
    const boarding = (api.boarding = new BoardingMock());
    boarding.reader = 'owner';
    await open(page, LIST);
    await expect(
      page.getByRole('heading', { level: 2, name: 'Ingen introduktion eller något avslut för dig' }),
    ).toBeVisible();
    // The page's links: where it stands, the one way on, and the floating way to the assistant.
    await expect(page.getByRole('main').getByRole('link')).toHaveText(['Startsidan', 'Till startsidan', 'Fråga AI']);
    await expectNoAxeViolations(page);
  });
});

test.describe('a realistic size, and small screens', () => {
  test('thirty plans read as a table beside the rail, and on a phone as rows', async ({ page, api }) => {
    const boarding = (api.boarding = new BoardingMock());
    boarding.addPlans(29);
    await page.setViewportSize(wide);
    await open(page, LIST);
    await expect(page.getByRole('main').getByText('30 planer', { exact: true })).toBeVisible();
    await expect(plans(page).getByRole('row')).toHaveCount(31);
    // Nearest day first, as the server orders them: the first of the added introductions, 8 November, before Anna's.
    await expect(plans(page).getByRole('row').nth(1)).toContainText('Första dagen sön 8 nov.');
    expect(await reflowProblems(page)).toEqual([]);
    await expectNoAxeViolations(page);
    await page.setViewportSize(phone);
    const rows = page.getByRole('list', { name: 'Medarbetarnas planer' }).getByRole('listitem');
    await expect(rows).toHaveCount(30);
    await expect(plans(page)).toHaveCount(0);
    expect(await reflowProblems(page)).toEqual([]);
    await expectNoAxeViolations(page);
  });

  test('at 320 px the list reflows: each plan a row with its name, its late badge and its facts', async ({
    page,
    api,
  }) => {
    const boarding = (api.boarding = new BoardingMock());
    boarding.ownPlan();
    await page.setViewportSize(narrow);
    await open(page, LIST);
    await expect(heading(page, 'Personal')).toBeVisible();
    const anna = page.getByRole('list', { name: 'Medarbetarnas planer' }).getByRole('listitem');
    await expect(anna.getByRole('link', { name: 'Anna Lindqvist', exact: true })).toBeVisible();
    await expect(anna).toContainText('1 försenad');
    await expect(anna).toContainText('Introduktion · Första dagen mån 16 nov. · 1 av 6 klara');
    expect(await reflowProblems(page)).toEqual([]);
    await expectNoAxeViolations(page);
  });
});
