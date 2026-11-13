import type { Locator, Page } from '@playwright/test';
import { entityDetail } from './data';
import { ANNA, BoardingMock, BOARDING_LENS, MARIA, PLAN, boardingRows, boardingSource } from './boarding';
import {
  announcements,
  expect,
  expectNoAxeViolations,
  hiddenFocusStops,
  narrow,
  open,
  phone,
  reflowProblems,
  test,
} from './support';

/**
 * One person's introduction or leaving as a page (D124, D116 rule 11), `/boarding/<personId>`: the plan's header with
 * the way back, its day, its progress and its counts; one section per phase with each item a row; the facts, the
 * person's plans and "Tillhör" in the rail. For the manager every item ticks, "Lägg till punkt" adds one and "Avsluta
 * planen" closes the plan after Astryx's confirmation; the person ticks their own; an item's owner sees their own items
 * and is told so. Without a plan a manager is offered the two starts, anyone else gets "Planen finns inte", as does an
 * unknown person and a module switched off. The ways in: a person's page and Personal's lens lead here with `from`, and
 * the pages of the module's two reads (an item's card, the suggestion's card) lead here too. Keyboard, focus,
 * announcements, axe and reflow at 320 px. The mock's clock stands at 2026-11-04; Anna's first day is 16 November.
 */
const wide = { width: 1440, height: 900 };
const PAGE = `/boarding/${ANNA}?from=%2Fstaff`;
const notices = (page: Page) => page.getByRole('region', { name: 'Aviseringar' });
const said = async (page: Page, text: string) => (await announcements(page)).some(t => t.includes(text));
const heading = (page: Page, name: string) => page.getByRole('heading', { level: 1, name, exact: true });
const item = (page: Page, title: string) => page.getByRole('checkbox', { name: title, exact: true });
/** Text drawn in the page, not its copy in a live region (a field's status is also said through Astryx's region). */
const drawn = (page: Page, scope: Locator, text: string) =>
  scope.getByText(text, { exact: true }).and(page.locator(':not([aria-live])'));
/** The main column's sections, by their headings, as a screen reader meets them. */
const sectionsOf = (page: Page) =>
  page
    .getByRole('main')
    .locator('section[aria-labelledby]')
    .evaluateAll(els =>
      els
        .filter(el => !el.closest('[role="complementary"], [role="dialog"], dialog'))
        .map(el => document.getElementById(el.getAttribute('aria-labelledby') ?? '')?.textContent?.trim() ?? ''),
    );

test.describe('the plan for its manager', () => {
  test.use({ viewport: wide });

  test('the header holds the way back, the plan and its day, its progress and counts; a section per phase; the facts and Tillhör in the rail', async ({
    page,
    api,
  }) => {
    api.boarding = new BoardingMock();
    await open(page, PAGE);
    await expect(page).toHaveTitle('Introduktion för Anna Lindqvist · Startsidan');
    await expect(heading(page, 'Introduktion för Anna Lindqvist')).toBeVisible();
    const main = page.getByRole('main');
    await expect(main.getByRole('link', { name: 'Personal', exact: true })).toHaveAttribute('href', '/staff');
    await expect(main.getByText('Första dagen måndag 16 november', { exact: true })).toBeVisible();
    await expect(main.getByText('Börjar om 12 dagar', { exact: true })).toBeVisible();
    await expect(main.getByText('2 väntar på dig', { exact: true })).toBeVisible();
    await expect(main.getByText('1 försenad', { exact: true })).toBeVisible();
    await expect(main.getByText('1 av 6 klara', { exact: true })).toBeVisible();
    const progress = main.getByRole('progressbar', { name: 'Klara punkter' });
    await expect(progress).toHaveAttribute('aria-valuenow', '1');
    await expect(progress).toHaveAttribute('aria-valuemax', '6');
    expect(await sectionsOf(page)).toEqual(['Före första dagen', 'Första dagen', 'Första veckan']);
    // Every item is the manager's to tick: a checkbox named by its title, its line saying kind, owner and day.
    await expect(main.getByRole('checkbox')).toHaveCount(6);
    await expect(item(page, 'Beställ dator och telefon')).toBeChecked();
    await expect(item(page, 'Beställ passerkort')).not.toBeChecked();
    await expect(main.getByText('Beställning · Du · senast mån 2 nov.', { exact: true })).toBeVisible();
    await expect(
      main.getByText('Att göra · Fadder, Erik Sandström · senast mån 16 nov.', { exact: true }),
    ).toBeVisible();
    // An order is a plain to-do in this version: no row orders or books anything.
    await expect(main.getByRole('button', { name: /^(Beställ|Föreslå tid)$/ })).toHaveCount(0);
    const rail = page.getByRole('complementary', { name: 'Detaljer' });
    await expect(rail.getByText('Erik Sandström', { exact: true })).toBeVisible();
    await expect(rail.getByText('måndag 16 november 2026', { exact: true })).toBeVisible();
    await expect(rail.getByRole('link', { name: 'Person: Anna Lindqvist' })).toHaveAttribute(
      'href',
      `/people/anna?from=%2Fboarding%2Fanna`,
    );
    await expectNoAxeViolations(page);
    const { hidden, unmarked } = await hiddenFocusStops(page);
    expect(hidden).toEqual([]);
    expect(unmarked).toEqual([]);
    // The way back is Personal, with the lens it was opened under kept.
    await main.getByRole('link', { name: 'Personal', exact: true }).click();
    await expect(page).toHaveURL('/staff');
  });

  test('an item is ticked off and opened again on the page: drawn at once, said with the new count, the focus kept', async ({
    page,
    api,
  }) => {
    const boarding = (api.boarding = new BoardingMock());
    await open(page, PAGE);
    const late = item(page, 'Beställ passerkort');
    await late.focus();
    await page.keyboard.press('Space');
    await expect(late).toBeChecked();
    await expect(late).toBeFocused();
    await expect.poll(() => said(page, 'Beställ passerkort är klar. 2 av 6 klara.')).toBe(true);
    await expect(page.getByRole('main').getByText('2 av 6 klara', { exact: true })).toBeVisible();
    await expect(page.getByRole('main').getByText('1 försenad')).toHaveCount(0);
    expect(boarding.writes).toEqual([{ method: 'POST', path: '/boarding/items/i-kort/done', body: {} }]);
    await page.keyboard.press('Space');
    await expect(late).not.toBeChecked();
    await expect(late).toBeFocused();
    await expect.poll(() => said(page, 'Beställ passerkort är inte klar. 1 av 6 klara.')).toBe(true);
    expect(boarding.writes.at(-1)).toEqual({ method: 'DELETE', path: '/boarding/items/i-kort/done', body: undefined });
    await expect(page.getByRole('main').getByText('1 försenad', { exact: true })).toBeVisible();
  });

  test('a tick the server refuses is put back and said, and the focus stays', async ({ page, api }) => {
    const boarding = (api.boarding = new BoardingMock());
    boarding.refusal = 'Planen är avslutad och kan inte ändras.';
    await open(page, PAGE);
    const box = item(page, 'Boka välkomstmöte första dagen');
    await box.focus();
    await page.keyboard.press('Space');
    await expect(box).not.toBeChecked();
    await expect(box).toBeFocused();
    await expect.poll(() => said(page, 'Planen är avslutad och kan inte ändras.')).toBe(true);
    await expect(page.getByRole('main').getByText('Planen är avslutad och kan inte ändras.')).toBeVisible();
  });

  test('Lägg till punkt: what is missing is said on its field, the item is added and the focus returns to the button', async ({
    page,
    api,
  }) => {
    const boarding = (api.boarding = new BoardingMock());
    await open(page, PAGE);
    const add = page.getByRole('main').getByRole('button', { name: 'Lägg till punkt' });
    await add.click();
    const dialog = page.getByRole('dialog', { name: 'Lägg till punkt' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Introduktion för Anna Lindqvist')).toBeVisible();
    await dialog.getByRole('button', { name: 'Lägg till', exact: true }).click();
    await expect(drawn(page, dialog, 'Skriv vad som ska göras.')).toBeVisible();
    await expect(drawn(page, dialog, 'Välj dagen då punkten ska vara klar.')).toBeVisible();
    await expect(dialog.getByRole('textbox', { name: /^Punkt/ })).toBeFocused();
    await page.keyboard.type('Visa var kaffet finns');
    await dialog.getByRole('radio', { name: 'Faddern, Erik Sandström' }).check();
    const due = dialog.getByLabel('Senast', { exact: false }).and(page.locator('input'));
    await due.focus();
    await page.keyboard.type('2026-11-17');
    await page.keyboard.press('Tab');
    await expectNoAxeViolations(page);
    await dialog.getByRole('button', { name: 'Lägg till', exact: true }).click();
    await expect(dialog).toBeHidden();
    expect(boarding.writes).toEqual([
      {
        method: 'POST',
        path: `/boarding/plans/${PLAN}/items`,
        body: { title: 'Visa var kaffet finns', kind: 'todo', ownerRole: 'buddy', dueOn: '2026-11-17' },
      },
    ]);
    await expect(notices(page).getByText('Punkten är tillagd.')).toBeAttached();
    await expect(item(page, 'Visa var kaffet finns')).toBeVisible();
    await expect(add).toBeFocused();
  });

  test('Avsluta planen asks first; Avbryt keeps it, and closing makes the plan read-only with the focus on the heading', async ({
    page,
    api,
  }) => {
    const boarding = (api.boarding = new BoardingMock());
    await open(page, PAGE);
    const more = page.getByRole('main').getByRole('button', { name: 'Fler åtgärder' });
    await more.click();
    // An open introduction: the menu closes the plan or starts a leaving, never a second introduction.
    await expect(page.getByRole('menuitem')).toHaveText(['Avsluta planen', 'Starta avslut']);
    await page.getByRole('menuitem', { name: 'Avsluta planen' }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Avsluta planen?' });
    await expect(confirm).toBeVisible();
    await expect(confirm.getByRole('button', { name: 'Avbryt' })).toBeFocused();
    await expectNoAxeViolations(page);
    await page.keyboard.press('Escape');
    await expect(confirm).toBeHidden();
    expect(boarding.writes).toEqual([]);
    await more.click();
    await page.getByRole('menuitem', { name: 'Avsluta planen' }).click();
    await confirm.getByRole('button', { name: 'Avsluta planen' }).click();
    await expect(confirm).toBeHidden();
    expect(boarding.writes).toEqual([{ method: 'POST', path: `/boarding/plans/${PLAN}/close`, body: {} }]);
    await expect(notices(page).getByText('Planen är avslutad.')).toBeAttached();
    await expect(heading(page, 'Introduktion för Anna Lindqvist')).toBeFocused();
    const main = page.getByRole('main');
    await expect(main.getByText('Avslutad', { exact: true }).first()).toBeVisible();
    await expect(main.getByRole('checkbox')).toHaveCount(0);
    await expect(main.getByRole('button', { name: 'Lägg till punkt' })).toHaveCount(0);
    await expectNoAxeViolations(page);
  });
});

test.describe('the plan for others who read it', () => {
  test.use({ viewport: wide });

  test('the person themselves reads every item and ticks their own; the way back is Hem', async ({ page, api }) => {
    api.employee = true;
    const boarding = (api.boarding = new BoardingMock());
    boarding.reader = 'person';
    await open(page, `/boarding/${ANNA}`);
    await expect(heading(page, 'Introduktion för Anna Lindqvist')).toBeVisible();
    const main = page.getByRole('main');
    await expect(main.getByRole('link', { name: 'Hem', exact: true })).toHaveAttribute('href', '/');
    await expect(main.getByRole('checkbox')).toHaveCount(2);
    await expect(item(page, 'Logga in och byt lösenord')).toBeVisible();
    // Another's item is read, its state said by its dot's name; nothing of the manager's is offered.
    await expect(main.getByRole('img', { name: 'Klar', exact: true })).toHaveCount(1);
    await expect(main.getByRole('img', { name: 'Inte klar', exact: true })).toHaveCount(3);
    await expect(main.getByRole('button', { name: 'Lägg till punkt' })).toHaveCount(0);
    await expect(main.getByRole('button', { name: 'Fler åtgärder' })).toHaveCount(0);
    await item(page, 'Logga in och byt lösenord').click();
    await expect(item(page, 'Logga in och byt lösenord')).toBeChecked();
    await expect.poll(() => said(page, 'Logga in och byt lösenord är klar.')).toBe(true);
    expect(boarding.writes).toEqual([{ method: 'POST', path: '/boarding/items/i-logga/done', body: {} }]);
    await expectNoAxeViolations(page);
  });

  test("an item's owner who is neither sees their own items and is told so, from the card's read", async ({
    page,
    api,
  }) => {
    api.employee = true;
    const boarding = (api.boarding = new BoardingMock());
    boarding.reader = 'owner';
    // The card's "Visa planen" leads to the read's page, which is the plan's page with the way back to the card.
    const input = encodeURIComponent(JSON.stringify({ plan: PLAN }));
    await open(page, `/tools/boarding.plan?input=${input}&from=%2Ftodo%3Fitem%3Dt1`);
    await expect(page).toHaveURL(`/boarding/${ANNA}?plan=${PLAN}&from=%2Ftodo%3Fitem%3Dt1`);
    await expect(heading(page, 'Introduktion för Anna Lindqvist')).toBeVisible();
    const main = page.getByRole('main');
    await expect(main.getByText(/^Du ser bara dina egna punkter i planen/)).toBeVisible();
    await expect(main.getByRole('checkbox')).toHaveCount(1);
    await expect(item(page, 'Rundvandring, nycklar och arbetsplats')).toBeVisible();
    await expect(main.getByText('0 av 1 klara', { exact: true })).toBeVisible();
    await expect(main.getByRole('link', { name: 'Att göra', exact: true })).toHaveAttribute('href', '/todo?item=t1');
    await expectNoAxeViolations(page);
  });
});

test.describe('no plan, and no page', () => {
  test.use({ viewport: wide });

  test('a manager with no plan for the person is offered both starts, the suggested day said', async ({
    page,
    api,
  }) => {
    api.boarding = new BoardingMock();
    await open(page, `/boarding/${MARIA}?from=%2Fstaff`);
    await expect(heading(page, 'Introduktion och avslut för Maria Källström')).toBeVisible();
    const main = page.getByRole('main');
    await expect(
      main.getByRole('heading', { level: 2, name: 'Maria Källström har ingen introduktion eller något avslut' }),
    ).toBeVisible();
    await expect(main.getByText(/Anställningen börjar tisdag 1 december enligt katalogen/)).toBeVisible();
    await expect(main.getByRole('button', { name: 'Starta introduktion' })).toBeVisible();
    await expect(main.getByRole('button', { name: 'Starta avslut' })).toBeVisible();
    await expectNoAxeViolations(page);
  });

  for (const [what, arrange, path] of [
    [
      'the person with no plan of their own',
      (api: { boarding: BoardingMock | null; employee: boolean }) => {
        api.employee = true;
        api.boarding = new BoardingMock();
        api.boarding.reader = 'person';
        api.boarding.plans = [];
      },
      `/boarding/${ANNA}`,
    ],
    [
      'someone the reader may not see',
      (api: { boarding: BoardingMock | null; employee: boolean }) => {
        api.boarding = new BoardingMock();
      },
      '/boarding/okand',
    ],
    [
      'the module switched off',
      (api: { boarding: BoardingMock | null; employee: boolean }) => {
        api.boarding = null;
      },
      PAGE,
    ],
  ] as const)
    test(`${what} is the page's own "Planen finns inte"`, async ({ page, api }) => {
      arrange(api);
      await open(page, path);
      await expect(heading(page, 'Planen finns inte')).toBeVisible();
      await expect(page).toHaveTitle('Planen finns inte · Startsidan');
      await expect(page.getByRole('main').getByRole('button', { name: /^Starta/ })).toHaveCount(0);
      await expectNoAxeViolations(page);
    });
});

test.describe('the ways in', () => {
  test.use({ viewport: wide });

  test("a person's page leads here with itself as the way back, and Back gives the focus to the link", async ({
    page,
    api,
  }) => {
    api.boarding = new BoardingMock();
    api.entityRows[BOARDING_LENS] = boardingRows();
    api.entityDetailOf = key => {
      const detail = entityDetail(api.entityList, key);
      return detail && { ...detail, sections: [...detail.sections, boardingSource] };
    };
    await open(page, '/people/anna?from=%2Fstaff');
    const way = page.getByRole('region', { name: 'Introduktion och avslut', exact: true }).getByRole('link', {
      name: 'Öppna planen',
    });
    await expect(way).toHaveAttribute('href', '/boarding/anna?from=%2Fpeople%2Fanna');
    await way.click();
    await expect(heading(page, 'Introduktion för Anna Lindqvist')).toBeVisible();
    await expect(page.getByRole('main').getByRole('link', { name: 'Anna Lindqvist', exact: true })).toHaveAttribute(
      'href',
      '/people/anna',
    );
    await page.goBack();
    await expect(way).toBeFocused();
  });

  test("Personal's lens offers the plan in each row's menu, with the lens as the way back", async ({ page, api }) => {
    api.boarding = new BoardingMock();
    api.entityRows[BOARDING_LENS] = boardingRows();
    api.entityList = { ...api.entityList, lenses: [...api.entityList.lenses, boardingSource] };
    await open(page, `/staff?show=${BOARDING_LENS}`);
    await page.getByRole('button', { name: 'Åtgärder för Maria Källström' }).click();
    const way = page.getByRole('menuitem', { name: 'Öppna planen' });
    await expect(way).toHaveAttribute('href', `/boarding/maria?from=%2Fstaff%3Fshow%3D${BOARDING_LENS}`);
    await way.click();
    await expect(heading(page, 'Introduktion och avslut för Maria Källström')).toBeVisible();
    await expect(page.getByRole('main').getByRole('link', { name: 'Personal', exact: true })).toHaveAttribute(
      'href',
      `/staff?show=${BOARDING_LENS}`,
    );
  });

  test("the suggestion's card leads to the person's page, where Starta introduktion is one press away", async ({
    page,
    api,
  }) => {
    api.boarding = new BoardingMock();
    const input = encodeURIComponent(JSON.stringify({ keys: [MARIA] }));
    await open(page, `/tools/boarding.person?input=${input}&from=%2Ftodo`);
    await expect(page).toHaveURL(`/boarding/${MARIA}?from=%2Ftodo`);
    await expect(page.getByRole('main').getByRole('button', { name: 'Starta introduktion' })).toBeVisible();
    await expect(page.getByRole('main').getByRole('link', { name: 'Att göra', exact: true })).toBeVisible();
  });
});

test.describe('small screens', () => {
  test('at 320 px the plan reflows, its facts behind Visa detaljer', async ({ page, api }) => {
    api.boarding = new BoardingMock();
    await page.setViewportSize(narrow);
    await open(page, PAGE);
    await expect(heading(page, 'Introduktion för Anna Lindqvist')).toBeVisible();
    expect(await reflowProblems(page)).toEqual([]);
    await page.getByRole('button', { name: 'Visa detaljer' }).click();
    const details = page.getByRole('dialog', { name: 'Detaljer' });
    await expect(details.getByText('Erik Sandström', { exact: true })).toBeVisible();
    expect(await reflowProblems(page)).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Visa detaljer' })).toBeFocused();
    await expectNoAxeViolations(page);
  });

  test('on a phone the actions stand under the name and the page has no axe violations', async ({ page, api }) => {
    api.boarding = new BoardingMock();
    await page.setViewportSize(phone);
    await open(page, PAGE);
    await expect(page.getByRole('main').getByRole('button', { name: 'Lägg till punkt' })).toBeVisible();
    expect(await reflowProblems(page)).toEqual([]);
    await expectNoAxeViolations(page);
  });
});
