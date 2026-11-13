import type { Locator, Page } from '@playwright/test';
import type { Thread } from '@clew/contracts';
import {
  announcements,
  composer,
  desktop,
  expect,
  expectNoAxeViolations,
  heading,
  narrow,
  open,
  phone,
  reflowProblems,
  silentSaidIn,
  test,
  workRowLines,
  type MockApi,
} from './support';
import {
  ENTITY_UNIT,
  NEWS_LINK,
  NOTICE_LINK,
  NOTICE_TEXT,
  TOOLBOX_HREF,
  asNotice,
  newsMenuRow,
  newsOutput,
  siteHeaderWithToolbox,
  user,
} from './data';
import { menuRows } from './phonebook';
import { Units } from './unit-data';

/**
 * Hem with the parts of the prototype's version 1.0 (D112, amended 2026-11-11, board Hem10): the item that asks for a
 * read receipt as a callout between the box and the blocks, "Behöver dig", "I dag" and "Nyheter" side by side, Läget
 * with its way to the unit's page as Dialogstöd's figures, Verktygslådan with the person's tools, and under them what
 * D112 kept. "Anpassa startsidan" is not built, so nothing here looks for it. A work item opened from Hem ("Läs", a row)
 * opens in the panel beside Hem, and the person stays on Hem (amended 2026-11-12).
 */
const rail = (page: Page) => page.getByRole('navigation', { name: 'Sidonavigering' });
const news = (page: Page) => page.getByRole('region', { name: 'Nyheter' });
const callout = (page: Page) => page.getByRole('region', { name: 'Viktigt' });
const toasts = (page: Page) => page.getByRole('region', { name: 'Aviseringar' });
/** The panel from the one width where it stands beside the page (1340 px), and the drawer below it. */
const wide = { width: 1440, height: 900 };
const beside = (page: Page) => page.getByRole('complementary', { name: 'Ärende', exact: true });
/** The panel's name for a work item, the heading that takes the focus when it opens. */
const panelName = (surface: Locator) => surface.locator('[aria-level="2"]').filter({ hasText: /^Ärende$/ });

/** "Ny rutin för läkemedelshantering" as the communication fixture pushes it now: a notice with its read receipt. */
const receiptItem = (api: MockApi, id = 'rutin', over: Partial<Thread> = {}): Thread =>
  asNotice(
    api.threads.find(t => t.id === 'rutin')!,
    id,
    over,
  );
/** Everything the board draws: a receipt to give, news from two sources, two tools in the rail. */
function everything(api: MockApi) {
  api.threads = api.threads.map(t => (t.id === 'rutin' ? receiptItem(api) : t));
  api.news = newsOutput();
  api.menu = menuRows;
}
/** The headings of the page's main column in reading order, each with the level assistive technology gets. */
const headingsOf = (page: Page) =>
  page
    .getByRole('main')
    .locator('h1, h2, h3, h4, h5, h6, [role="heading"]')
    .evaluateAll(list =>
      [...new Set(list)]
        .filter(el => (el as HTMLElement).checkVisibility())
        .map(el => ({
          level: Number(el.getAttribute('aria-level') ?? el.tagName.slice(1)),
          text: (el.textContent ?? '').trim(),
        })),
    );

test.describe('Hem with the parts of version 1.0', () => {
  test.use({ viewport: desktop });

  test('the callout, then Behöver dig, I dag and Nyheter side by side, then Läget, Verktygslådan and what D112 kept, in one heading order', async ({
    page,
    api,
  }) => {
    everything(api);
    await open(page, '/');
    const needs = page.getByRole('region', { name: 'Behöver dig' }),
      day = page.getByRole('region', { name: 'I dag' });
    await expect(callout(page)).toBeVisible();
    await expect(news(page)).toBeVisible();
    // Between the box and the blocks (board Hem10).
    const box = (await composer(page).boundingBox())!,
      lifted = (await callout(page).boundingBox())!,
      n = (await needs.boundingBox())!,
      d = (await day.boundingBox())!,
      w = (await news(page).boundingBox())!;
    expect(lifted.y).toBeGreaterThan(box.y + box.height);
    expect(n.y).toBeGreaterThan(lifted.y + lifted.height);
    // Three across where they fit, in the board's order.
    expect(Math.abs(d.y - n.y)).toBeLessThan(2);
    expect(Math.abs(w.y - n.y)).toBeLessThan(2);
    expect(d.x).toBeGreaterThanOrEqual(n.x + n.width);
    expect(w.x).toBeGreaterThanOrEqual(d.x + d.width);
    // Under them Läget, Verktygslådan, then what D112 kept, the person's own action points last. "Sedan i går" is gone
    // (2026-11-13: no digest sentences on a page).
    const lage = heading(page, 2, `Läget på ${user.unitLabel}`),
      tools = heading(page, 2, 'Verktygslådan'),
      own = heading(page, 2, 'Mina åtgärdspunkter');
    const y = async (l: ReturnType<typeof heading>) => (await l.boundingBox())!.y;
    expect(await y(lage)).toBeGreaterThan(Math.max(n.y + n.height, d.y + d.height, w.y + w.height));
    expect(await y(tools)).toBeGreaterThan(await y(lage));
    expect(await y(own)).toBeGreaterThan(await y(tools));
    await expect(page.getByRole('region', { name: 'Sedan i går' })).toHaveCount(0);
    // One h1, every other heading one level under it or deeper, never a level skipped, in the board's order.
    const headings = await headingsOf(page);
    expect(headings[0]).toEqual({ level: 1, text: 'Vad vill du få gjort?' });
    for (const [i, h] of headings.entries())
      if (i > 0)
        expect(h.level, `${h.text} after ${headings[i - 1]!.text}`).toBeLessThanOrEqual(headings[i - 1]!.level + 1);
    const at = (text: string | RegExp) =>
      headings.findIndex(h => (typeof text === 'string' ? h.text === text : text.test(h.text)));
    const order = [
      at('Behöver dig'),
      at('I dag'),
      at('Nyheter'),
      at(/^Läget på /),
      at('Verktygslådan'),
      at(/^Mina åtgärdspunkter/),
    ];
    expect(order.every(i => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // Not built (D112, amended 2026-11-11): no control arranges the page, and no chips sit under the box.
    await expect(page.getByText(/Anpassa startsidan/)).toHaveCount(0);
    await expectNoAxeViolations(page);
  });

  test('Nyheter: the three newest, each row one target, a link out marked as leaving, and Alla nyheter', async ({
    page,
    api,
  }) => {
    api.news = newsOutput();
    await open(page, '/');
    const block = news(page);
    await expect(block.getByRole('heading', { name: 'Nyheter' })).toBeVisible();
    const rows = block.getByRole('listitem');
    await expect(rows).toHaveCount(3);
    // The headline is the row's one link; the sender and the day are its supporting line.
    await expect(rows.nth(0)).toContainText('Nytt lönesystem från årsskiftet');
    await expect(rows.nth(0)).toContainText('HR · 4 november');
    await expect(rows.nth(1)).toContainText('Barn och utbildning · 3 november');
    await expect(rows.nth(2)).toContainText('Kommunledningen · 2 november');
    await expect(block.getByText('Enkät om matsalen')).toHaveCount(0);
    for (const i of [0, 1, 2]) await expect(rows.nth(i).getByRole('link')).toHaveCount(1);
    // A link out of Clew says so in its name and opens a new tab (D111 rule 8).
    const out = rows.nth(0).getByRole('link');
    await expect(out).toHaveAccessibleName(/^Nytt lönesystem från årsskiftet\s*\(öppnas i ny flik\)$/);
    await expect(out).toHaveAttribute('href', NEWS_LINK);
    await expect(out).toHaveAttribute('target', '_blank');
    // A row that opens in Clew is not marked, and a press anywhere on the row follows its link: the item beside Hem.
    const inClew = rows.nth(1).getByRole('link');
    await expect(inClew).toHaveAccessibleName('Så fungerar vinterns skolskjuts');
    await expect(inClew).toHaveAttribute('href', /open=communication\.newsItem/);
    await expectNoAxeViolations(page);
    await rows.nth(1).getByText('Barn och utbildning · 3 november').click();
    await expect(page).toHaveURL(/open=communication\.newsItem/);
    await expect(page.getByText('Från 1 december går skolbussarna efter vintertidtabellen.')).toBeVisible();

    // Alla nyheter: the joined list as a tool's page, there whether or not an administrator placed it in the rail.
    await open(page, '/');
    const all = news(page).getByRole('link', { name: 'Alla nyheter' });
    await expect(all).toHaveAttribute('href', '/tools/clew.news');
    await all.click();
    await expect(page).toHaveURL(/\/tools\/clew\.news$/);
    await expect(heading(page, 1, 'Nyheter')).toBeVisible();
    await expect(page.getByRole('main').getByText('Enkät om matsalen')).toBeVisible();
    await expect(rail(page).getByRole('link', { name: 'Nyheter' })).toHaveCount(0);
    await expectNoAxeViolations(page);
  });

  test('Alla nyheter placed in the rail by an administrator is a tool like any other, marked current on its page', async ({
    page,
    api,
  }) => {
    api.news = newsOutput();
    api.menu = [newsMenuRow, ...menuRows];
    await open(page, '/');
    const row = rail(page).getByRole('group', { name: 'Verktyg' }).getByRole('link', { name: 'Nyheter' });
    await expect(row).toHaveAttribute('href', '/tools/clew.news');
    await row.click();
    await expect(heading(page, 1, 'Nyheter')).toBeVisible();
    await expect(rail(page).locator('a[aria-current="page"]')).toHaveText('Nyheter');
  });

  test('without a news source there is no Nyheter block, no error, and the two blocks share the row', async ({
    page,
    api: _,
  }) => {
    await open(page, '/');
    await expect(news(page)).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Nyheter' })).toHaveCount(0);
    const n = (await page.getByRole('region', { name: 'Behöver dig' }).boundingBox())!,
      d = (await page.getByRole('region', { name: 'I dag' }).boundingBox())!;
    expect(Math.abs(n.width - d.width)).toBeLessThan(2);
    // Alla nyheter by its address says there is none, as a tool that is not the person's does.
    await open(page, '/tools/clew.news');
    await expect(heading(page, 1, 'Inga nyheter för dig')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Till startsidan' })).toHaveAttribute('href', '/');
    await expectNoAxeViolations(page);
  });

  test('Fokusnyhet: the item that asks for a read receipt, with Läs and its own Jag har läst, announced and then gone', async ({
    page,
    api,
  }) => {
    everything(api);
    await open(page, '/');
    const lifted = callout(page);
    await expect(lifted).toContainText('Ny rutin för läkemedelshantering');
    await expect(lifted).toContainText('Kommunikation · publicerad 3 november · läskvitto krävs');
    // Läs opens the item beside Hem, as every row on Hem does (amended 2026-11-12).
    await expect(lifted.getByRole('link', { name: 'Läs', exact: true })).toHaveAttribute('href', '/?card=rutin');
    // The lifted item is not a row under the blocks too.
    await expect(page.getByRole('region', { name: 'Behöver dig' }).locator('#work-rutin')).toHaveCount(0);
    await expectNoAxeViolations(page);
    // The item's own action, one press: nothing to fill in, nothing asked.
    const ack = lifted.getByRole('button', { name: 'Jag har läst' });
    await ack.focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => api.acted.map(a => [a.threadId, a.body.actionId])).toEqual([['rutin', 'ack']]);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // The receipt is said, and the focus is not left on nothing.
    await expect(toasts(page).getByText(/^Läskvittot är registrerat\. Ärendet ligger under Klart\./)).toBeVisible();
    await expect
      .poll(() => announcements(page))
      .toContainEqual(expect.stringContaining('Läskvittot är registrerat. Ärendet ligger under Klart.'));
    await expect(composer(page)).toBeFocused();
    // Once the receipt has had its moment the callout is gone, and nothing takes its place.
    await expect(callout(page)).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByRole('region', { name: 'Behöver dig' }).locator('#work-rutin')).toHaveCount(0);
  });

  test('with several items that ask for a receipt the most urgent is the callout and the rest are rows; with none, nothing is drawn', async ({
    page,
    api,
  }) => {
    // Only the two receipts are open: the one due tomorrow is the more urgent.
    const open1 = receiptItem(api, 'rutin');
    const open2 = receiptItem(api, 'brandrutin', {
      title: 'Ny brandskyddsrutin',
      deadline: '2026-11-05',
      trigger: {
        reason: 'Nytt meddelande från förvaltningen',
        source: 'Kommunikation',
        at: '2026-11-04T07:00:00.000Z',
      },
    });
    api.threads = [...api.threads.filter(t => t.state !== 'open'), open1, open2];
    await open(page, '/');
    await expect(callout(page)).toContainText('Ny brandskyddsrutin');
    await expect(callout(page)).not.toContainText('Ny rutin för läkemedelshantering');
    const needs = page.getByRole('region', { name: 'Behöver dig' });
    await expect(needs.locator('#work-rutin')).toBeVisible();
    await expect(needs.locator('#work-brandrutin')).toHaveCount(0);
    await expect(callout(page).getByRole('button', { name: 'Jag har läst' })).toHaveCount(1);

    // The same items without the mark are ordinary work items: no callout.
    api.threads = api.threads.map(t => ({ ...t, actions: t.actions.map(({ acknowledgement: _a, ...a }) => a) }));
    await open(page, '/');
    await expect(callout(page)).toHaveCount(0);
    await expect(needs.locator('#work-brandrutin')).toBeVisible();
  });

  test('Läget names the unit, and the name and Öppna dialogstödet both lead to the unit’s page with Hem to go back to', async ({
    page,
    api: _,
  }) => {
    await new Units().route(page);
    await open(page, '/');
    const lage = page.getByRole('region', { name: 'Läget' });
    const href = `/units/${user.unitId}?from=%2F`;
    await expect(lage.getByRole('link', { name: user.unitLabel, exact: true })).toHaveAttribute('href', href);
    const dialogue = lage.getByRole('link', { name: 'Öppna dialogstödet' });
    await expect(dialogue).toHaveAttribute('href', href);
    // A tile opens the view it names (D54): a table is its own page, with Hem as the way back (D116).
    await expect(lage.getByRole('link', { name: /^Personal: Sjukfrånvaro/ })).toHaveAttribute(
      'href',
      '/tools/hr.absenceOverview?title=Fr%C3%A5nvaro+per+person&from=%2F',
    );
    await dialogue.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/units/${user.unitId}\\?from=%2F$`));
    await expect(heading(page, 1, ENTITY_UNIT.label)).toBeVisible();
  });

  test('Verktygslådan: a tile per tool the rail has, the intranet’s page of tools only when the header marks one, none without tools', async ({
    page,
    api,
  }) => {
    api.menu = menuRows;
    await open(page, '/');
    const box = page.getByRole('region', { name: 'Verktygslådan' });
    await expect(box.getByRole('link')).toHaveCount(2);
    await expect(box.getByRole('link', { name: 'Mitt team' })).toHaveAttribute('href', '/tools/phonebook.team');
    await expect(box.getByRole('link', { name: 'Telefonbok' })).toHaveAttribute('href', '/tools/phonebook.directory');
    await expect(box.getByText('Telefonboken').first()).toBeVisible();
    // Clew's default header names no page of tools, so there is no link out.
    await expect(page.getByRole('link', { name: /Fler verktyg på intranätet/ })).toHaveCount(0);
    await expectNoAxeViolations(page);
    // A pointer presses the tile where its name is drawn: Astryx's ClickableCard lays its content over the card's own
    // link and takes the press on its surface.
    await box.getByText('Telefonbok', { exact: true }).click();
    await expect(heading(page, 1, 'Telefonbok')).toBeVisible();

    // The header's connector marks the intranet's page of tools: the link leaves Clew in a new tab and says so.
    api.header = siteHeaderWithToolbox();
    await open(page, '/');
    const more = page
      .getByRole('region', { name: 'Verktygslådan' })
      .getByRole('link', { name: /^Fler verktyg på intranätet/ });
    await expect(more).toHaveAccessibleName(/^Fler verktyg på intranätet\s*\(öppnas i ny flik\)$/);
    await expect(more).toHaveAttribute('href', TOOLBOX_HREF);
    await expect(more).toHaveAttribute('target', '_blank');
    await expectNoAxeViolations(page);

    // No tools, no section: the link out alone is not drawn either.
    api.menu = [];
    await open(page, '/');
    await expect(page.getByRole('region', { name: 'Verktygslådan' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /Fler verktyg på intranätet/ })).toHaveCount(0);
  });
});

/**
 * A work item opened from Hem opens beside Hem (D112, amended 2026-11-12; the product owner: "what I as a user expect,
 * beside Hem"): "Läs" on the callout and every row under "Behöver dig" put the item in the panel every page has
 * (`/?card=<id>`), the same work item Att göra's reading pane draws, with its buttons, its receipt and its box, and the
 * person stays on Hem. A notice leads with its text and its way to the whole of it.
 */
/**
 * D116: a list or a table opened from Hem is its view's page, never the panel; Back returns to Hem with the focus on
 * the link that opened it. One thing (a budget) still opens beside Hem.
 */
test.describe('Läget leads to a list’s page, and one thing beside Hem', () => {
  test.use({ viewport: desktop });
  const talks = {
    kind: 'table' as const,
    capability: 'talks.talks',
    connector: 'talks',
    source: 'Utvecklingssamtal',
    chip: false,
    title: 'name',
    noun: { one: 'person', other: 'personer' },
    fields: [
      { key: 'name', label: 'Namn' },
      { key: 'state', label: 'Samtal', format: 'status' as const, tones: { Saknas: 'warn' as const } },
      { key: 'at', label: 'När' },
    ],
  };
  const rows = [
    { name: 'Anna Lindqvist', state: 'Bokat', at: 'mån 16 nov' },
    { name: 'Karin Lindqvist', state: 'Saknas' },
  ];
  const serve = (page: Page) =>
    page.route('**/api/cap/talks.talks*', route =>
      route.fulfill({ json: { source: 'Utvecklingssamtal', view: talks, output: { rows } } }),
    );
  const tileOf = (page: Page) =>
    page
      .getByRole('region', { name: 'Läget' })
      .getByRole('link', { name: /^Utvecklingssamtal: Utvecklingssamtal hållna/ });
  const PAGE = '/tools/talks.talks?title=Utvecklingssamtal&from=%2F';

  test('a tile whose view is a table leads to the view’s page, which names Hem as its way back; Back returns to Hem with the focus on the tile', async ({
    page,
    api: _,
  }) => {
    await serve(page);
    await open(page, '/');
    const tile = tileOf(page);
    await expect(tile).toHaveAttribute('href', PAGE);
    await tile.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(PAGE);
    const main = page.getByRole('main');
    // The page, not the panel: its heading takes the focus, and nothing lies beside or over it.
    await expect(heading(page, 1, 'Utvecklingssamtal')).toBeFocused();
    await expect(page).toHaveTitle('Utvecklingssamtal · Startsidan');
    await expect(main.getByRole('columnheader')).toHaveText(['Namn', 'Samtal', 'När']);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('complementary')).toHaveCount(0);
    // The way back names Hem, as a person's page names its own, and the rail stands on the place it came from.
    await expect(main.getByRole('link', { name: 'Hem', exact: true })).toHaveAttribute('href', '/');
    await expect(rail(page).locator('a[aria-current="page"]')).toContainText('Hem');
    await expectNoAxeViolations(page);
    await page.goBack();
    await expect(page).toHaveURL('/');
    await expect(tileOf(page)).toBeFocused();
    // The page's own way back does the same. (A tile is pressed where its text is drawn: ClickableCard lays it over the
    // card's own link.)
    await page.getByRole('region', { name: 'Läget' }).getByText('1 av 4', { exact: true }).click();
    await expect(page).toHaveURL(PAGE);
    await page.getByRole('main').getByRole('link', { name: 'Hem', exact: true }).click();
    await expect(page).toHaveURL('/');
    await expect(tileOf(page)).toBeFocused();
  });

  test('the view’s page reached from a tile reflows at 320 px with no axe violations', async ({ page, api: _ }) => {
    await page.setViewportSize(narrow);
    await serve(page);
    await open(page, '/');
    await tileOf(page).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(PAGE);
    const main = page.getByRole('main');
    await expect(heading(page, 1, 'Utvecklingssamtal')).toBeVisible();
    // At 320 px the table is its list.
    await expect(main.getByRole('table')).toHaveCount(0);
    await expect(main.getByRole('listitem').filter({ hasText: 'Karin Lindqvist' })).toContainText('Saknas');
    expect(await reflowProblems(page)).toEqual([]);
    await expectNoAxeViolations(page);
  });

  test('a tile whose view is one thing opens it beside Hem, with no page of its own offered', async ({
    page,
    api: _,
  }) => {
    await open(page, '/');
    const tile = page.getByRole('region', { name: 'Läget' }).getByRole('link', { name: /^Budget: Förbrukat av ramen/ });
    await expect(tile).toHaveAttribute('href', '/?open=finance.budget&open-title=Budget+mot+prognos');
    await tile.focus();
    await page.keyboard.press('Enter');
    const panel = page.getByRole('dialog', { name: 'Budget mot prognos' });
    await expect(panel).toBeVisible();
    await expect(page).toHaveURL('/?open=finance.budget&open-title=Budget+mot+prognos');
    // A budget is no record: no page of its own, so its name in the panel's header is no link.
    await expect(panel.getByRole('heading', { name: 'Budget mot prognos' }).getByRole('link')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(tile).toBeFocused();
  });
});

test.describe('a work item opened from Hem, beside Hem', () => {
  test.use({ viewport: wide });

  test('Läs opens the notice beside Hem, led by its text and its link out, and Esc gives the focus back to Läs', async ({
    page,
    api,
  }) => {
    everything(api);
    api.cardReads.open = { output: { url: NOTICE_LINK } };
    await open(page, '/');
    const read = callout(page).getByRole('link', { name: 'Läs', exact: true });
    await read.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL('/?card=rutin');
    const panel = beside(page);
    const item = panel.getByRole('article', { name: 'Ärende: Ny rutin för läkemedelshantering' });
    await expect(item).toBeVisible();
    await expect(panelName(panel)).toBeFocused();
    // The person is still on Hem: its heading, the callout and the blocks, with nothing over the page.
    await expect(heading(page, 1, 'Vad vill du få gjort?')).toBeVisible();
    await expect(callout(page)).toBeVisible();
    await expect(page.getByRole('region', { name: 'Behöver dig' })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(rail(page).getByRole('link', { name: /^Hem/ })).toHaveAttribute('aria-current', 'page');
    // The same work item as Att göra's pane: its title the link to its page with Hem as the way back, its buttons, the
    // box at the foot.
    await expect(
      item
        .getByRole('heading', { name: 'Ny rutin för läkemedelshantering' })
        .getByRole('link', { name: 'Ny rutin för läkemedelshantering' }),
    ).toHaveAttribute('href', '/items/rutin?from=%2F%3Fcard%3Drutin');
    const ack = item.getByRole('button', { name: 'Jag har läst' });
    await expect(ack).toHaveCount(1);
    await expect(panel.getByRole('textbox', { name: 'Fråga Clew' })).toBeVisible();
    // A notice reads as a notice: its text first, under no heading of its own, then the way to the whole of it, marked
    // as leaving Clew and drawn once; "Varför ser jag detta?" is the provenance line; a row that only repeats the title
    // is not drawn.
    const first = item.getByText(NOTICE_TEXT[0]!, { exact: true });
    const last = item.getByText(NOTICE_TEXT.at(-1)!, { exact: true });
    const whole = item.getByRole('button', { name: /^Läs hela nyheten\s*\(öppnas i ny flik\)$/ });
    const why = item.getByRole('region', { name: 'Varför ser jag detta?' });
    await expect(whole).toHaveCount(1);
    const y = async (l: Locator) => (await l.boundingBox())!.y;
    expect(await y(first)).toBeGreaterThan(await y(ack));
    expect(await y(whole)).toBeGreaterThan(await y(last));
    expect(await y(why)).toBeGreaterThan(await y(whole));
    await expect(why).toContainText(
      'Publicerat av Vård och omsorg 2026-11-03 06:30 · läskvitto krävs. Ärendet kom från Kommunikation',
    );
    await expect(why).not.toContainText(NOTICE_TEXT[0]!);
    await expect(item.getByRole('heading', { name: 'Rader' })).toHaveCount(0);
    await expectNoAxeViolations(page);
    // The way to the whole notice opens it in a new tab, once, and Hem and the panel stay as they were.
    await page.evaluate(() => {
      const opened: string[] = [];
      Object.assign(window, { opened });
      window.open = (url?: string | URL) => {
        opened.push(String(url));
        return null;
      };
    });
    await whole.focus();
    await page.keyboard.press('Enter');
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { opened: string[] }).opened))
      .toEqual([NOTICE_LINK]);
    await expect(page).toHaveURL('/?card=rutin');
    // Esc lets go of the item, and the focus is back on Läs.
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await expect(page).toHaveURL('/');
    await expect(read).toBeFocused();
  });

  test('a row under Behöver dig opens its item beside Hem, marked as the current row; another row takes its place; ✕ gives the focus back to the row', async ({
    page,
    api: _,
  }) => {
    await open(page, '/');
    const needs = page.getByRole('region', { name: 'Behöver dig' });
    await expect(needs.getByRole('listitem')).toHaveCount(3);
    const fakturor = needs.getByRole('link', { name: /^Attestera 3 fakturor/ });
    await expect(fakturor).toHaveAttribute('href', '/?card=fakturor');
    await fakturor.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL('/?card=fakturor');
    const panel = beside(page);
    await expect(panel.locator('#card-fakturor').getByRole('button', { name: 'Attestera 2 valda' })).toBeVisible();
    await expect(panelName(panel)).toBeFocused();
    await expect(needs.locator('#work-fakturor')).toHaveAttribute('aria-current', 'true');
    await expect(heading(page, 1, 'Vad vill du få gjort?')).toBeVisible();
    await expectNoAxeViolations(page);
    // Another row takes its place in the panel; the page stays.
    const omtanke = needs.getByRole('link', { name: /^Omtankesamtal med Anna Lindqvist/ });
    await omtanke.click();
    await expect(page).toHaveURL('/?card=omtanke');
    await expect(panel.locator('#card-omtanke')).toBeVisible();
    await expect(panel.locator('#card-fakturor')).toHaveCount(0);
    await expect(needs.locator('#work-fakturor')).not.toHaveAttribute('aria-current', 'true');
    // ✕ lets go of it, and the focus is back on the row that opened it.
    await panel.getByRole('button', { name: 'Stäng panelen' }).click();
    await expect(page).toHaveURL('/');
    await expect(panel).toHaveCount(0);
    await expect(omtanke).toBeFocused();
    // The address is the state: Back opens it again.
    await page.goBack();
    await expect(page).toHaveURL('/?card=omtanke');
    await expect(beside(page).locator('#card-omtanke')).toBeVisible();
    // All of them are still one link away in Att göra.
    await expect(needs.getByRole('link', { name: 'Alla 6 i Att göra' })).toHaveAttribute('href', '/todo');
  });

  test('the receipt given beside Hem: the item shows it, Hem lets go of the callout as for its own button, and closing leaves the focus on Behöver dig', async ({
    page,
    api,
  }) => {
    everything(api);
    await open(page, '/');
    await callout(page).getByRole('link', { name: 'Läs', exact: true }).click();
    const panel = beside(page);
    const item = panel.locator('#card-rutin');
    const ack = item.getByRole('button', { name: 'Jag har läst' });
    await ack.focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => api.acted.map(a => [a.threadId, a.body.actionId])).toEqual([['rutin', 'ack']]);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // The receipt stands on the item beside Hem, the notice's text still under it, and the focus stays with the item.
    await expect(item.getByText('Läskvittot är registrerat.', { exact: true })).toBeVisible();
    await expect(item.getByRole('list', { name: 'Kvitto, rad för rad' })).toContainText('kvitterat 09:00');
    await expect(item.getByText(NOTICE_TEXT[0]!, { exact: true })).toBeVisible();
    await expect(item.locator('#card-rutin-title')).toBeFocused();
    // Hem says it as it does for the callout's own button, and lets go of the callout once the receipt had its moment.
    await expect(toasts(page).getByText(/^Läskvittot är registrerat\. Ärendet ligger under Klart\./)).toBeVisible();
    await expect(callout(page)).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByRole('region', { name: 'Behöver dig' }).locator('#work-rutin')).toHaveCount(0);
    await expectNoAxeViolations(page);
    // Nothing on Hem leads back to the item now: closing it leaves the focus on Behöver dig.
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await expect(page).toHaveURL('/');
    await expect(page.locator('#behover-dig')).toBeFocused();
  });

  test('a work item in Hem’s address is beside Hem after a load; one that is gone says so there', async ({
    page,
    api: _,
  }) => {
    await open(page, '/?card=ledighet');
    await expect(page).toHaveURL('/?card=ledighet');
    await expect(
      beside(page).getByRole('article', { name: 'Ärende: Ledighetsansökan från Johan Byström' }),
    ).toBeVisible();
    await expect(heading(page, 1, 'Vad vill du få gjort?')).toBeVisible();
    await open(page, '/?card=borta');
    await expect(beside(page).getByText('Ärendet finns inte längre bland dina ärenden.')).toBeVisible();
    await expectNoAxeViolations(page);
  });
});

test.describe('Hem with the parts of version 1.0, narrow', () => {
  test('at 320 px nothing reflows past the edge or is cut', async ({ page, api }) => {
    everything(api);
    // The longest line a row has: the state, the reason and a reminder that waits to be scheduled.
    api.threads.find(t => t.id === 'ledighet')!.timers = [
      { kind: 'reminder', dueAt: '2026-11-05T10:00:00.000Z', state: 'queued' },
    ];
    api.header = siteHeaderWithToolbox();
    await page.setViewportSize(narrow);
    await open(page, '/');
    await expect(callout(page)).toBeVisible();
    await expect(news(page)).toBeVisible();
    expect(await reflowProblems(page)).toEqual([]);
    // `reflowProblems` sees what is cut sideways, not what a line clamp cuts downwards. A work item's supporting line
    // begins with its state in words (1.4.1) and is not clamped: every row under Behöver dig says its state, and the
    // whole line is drawn, the one with the queued reminder too, none of it behind an ellipsis.
    const lines = await workRowLines(page.getByRole('region', { name: 'Behöver dig' }).locator('[id^="work-"]'));
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.map(l => l.text)).toContain(
      'Ska göras\u00a0· Ansökan väntar på beslut\u00a0· påminnelsen väntar på schemaläggning',
    );
    for (const line of lines) {
      expect(line.text).toMatch(/^(Ska göras i dag|Ska göras)\u00a0· \S/);
      expect(line, line.text).toMatchObject({ cut: false });
    }
  });

  test('at 320 px the notice opened from Hem is the drawer over it, and nothing in it reflows past the edge', async ({
    page,
    api,
  }) => {
    everything(api);
    await page.setViewportSize(narrow);
    await open(page, '/');
    await callout(page).getByRole('link', { name: 'Läs', exact: true }).click();
    await expect(page).toHaveURL('/?card=rutin');
    const drawer = page.getByRole('dialog', { name: 'Ärende', exact: true });
    await expect(drawer.getByRole('article', { name: 'Ärende: Ny rutin för läkemedelshantering' })).toBeVisible();
    await expect(drawer.getByText(NOTICE_TEXT[0]!, { exact: true })).toBeVisible();
    await page.evaluate(() => Promise.all(document.getAnimations().map(a => a.finished)));
    expect(await reflowProblems(page, drawer)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expectNoAxeViolations(page);
  });
});

test.describe('Hem with the parts of version 1.0 on a phone', () => {
  test.use({ viewport: phone, hasTouch: true, isMobile: true });

  test('the blocks stand one under the other, and a finger reaches the callout’s buttons and a news row', async ({
    page,
    api,
  }) => {
    everything(api);
    await open(page, '/');
    const needs = (await page.getByRole('region', { name: 'Behöver dig' }).boundingBox())!,
      w = (await news(page).boundingBox())!;
    expect(Math.abs(w.x - needs.x)).toBeLessThan(2);
    expect(w.y).toBeGreaterThan(needs.y + needs.height);
    for (const name of ['Läs', 'Jag har läst']) {
      const target = callout(page).getByRole(name === 'Läs' ? 'link' : 'button', { name, exact: true });
      expect((await target.boundingBox())!.height, name).toBeGreaterThanOrEqual(44);
    }
    const row = news(page).getByRole('listitem').first();
    expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expectNoAxeViolations(page);
  });

  test('Läs opens the item in the end drawer over Hem, as on every page, and ✕ gives the focus back to Läs', async ({
    page,
    api,
  }) => {
    everything(api);
    await open(page, '/');
    const read = callout(page).getByRole('link', { name: 'Läs', exact: true });
    await read.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL('/?card=rutin');
    const drawer = page.getByRole('dialog', { name: 'Ärende', exact: true });
    await expect(drawer.getByRole('button', { name: 'Jag har läst' })).toBeVisible();
    await expect.poll(() => drawer.evaluate(el => el.contains(document.activeElement))).toBe(true);
    await expect(page.getByRole('complementary', { name: 'Ärende', exact: true })).toHaveCount(0);
    await page.evaluate(() => Promise.all(document.getAnimations().map(a => a.finished)));
    await expectNoAxeViolations(page);
    await drawer.getByRole('button', { name: 'Stäng panelen' }).click();
    await expect(drawer).toHaveCount(0);
    await expect(page).toHaveURL('/');
    await expect(read).toBeFocused();
  });
});

/**
 * A system that does not answer is said where its content is missing (D116, amended 2026-11-12), never as a banner at
 * the top of the page: "I dag" stays and says that the calendar does not answer, with Försök igen; the first time in a
 * session it is said aloud once. A person with no calendar is told so in "I dag", with who connects one, and no warning.
 */
test.describe('I dag when the calendar does not answer, and for a person with no calendar', () => {
  test.use({ viewport: desktop });
  const day = (page: Page) => page.getByRole('region', { name: 'I dag' });
  const said = async (page: Page, words: string) =>
    (await announcements(page)).filter(text => text.includes(words)).length;

  test('I dag stays and says that the calendar does not answer, with Försök igen, which reads the day again; it is said once, and nothing tops the page', async ({
    page,
    api,
  }) => {
    api.calendar = 'silent';
    await open(page, '/');
    await expect(day(page).getByRole('heading', { name: 'I dag' })).toBeVisible();
    await expect(day(page).getByText('Kalendern svarar inte', { exact: true })).toBeVisible();
    // Said in the block where the day would be, and nowhere else: no banner above the page.
    expect(await silentSaidIn(page)).toEqual(['I dag']);
    await expect.poll(() => said(page, 'Kalendern svarar inte')).toBe(1);
    await expectNoAxeViolations(page);
    // To Att göra and back by the rail: the session has said it once, so it is not said again.
    const rail = page.getByRole('navigation', { name: 'Sidonavigering' });
    await rail.getByRole('link', { name: /^Att göra/ }).click();
    await expect(page).toHaveURL('/todo');
    await rail.getByRole('link', { name: /^Hem/ }).click();
    await expect(day(page).getByText('Kalendern svarar inte', { exact: true })).toBeVisible();
    expect(await said(page, 'Kalendern svarar inte')).toBe(1);
    // The calendar answers again: Försök igen reads the day, and the meetings stand where the sentence was.
    api.calendar = 'ok';
    await day(page).getByRole('button', { name: 'Försök igen' }).click();
    await expect(day(page).getByText('Rektorsmöte')).toBeVisible();
    await expect(day(page).getByText('Kalendern svarar inte', { exact: true })).toHaveCount(0);
    await expect(day(page).getByRole('link', { name: 'Kalender', exact: true })).toBeVisible();
  });

  test('when the calendar has not answered since a known time it says since when, and once aloud', async ({
    page,
    api,
  }) => {
    api.calendar = 'silent';
    api.sources = [
      { connector: 'calendar', state: 'idle', lastSuccess: '2026-11-04T05:00:00.000Z', error: 'unavailable' },
    ];
    await open(page, '/');
    await expect(day(page).getByText('Kalendern svarar inte sedan 06:00', { exact: true })).toBeVisible();
    // One system, said once, whether the cards' statuses or the day's own read noticed it first.
    await expect.poll(() => said(page, 'Kalendern svarar inte')).toBe(1);
    await expectNoAxeViolations(page);
  });

  test('a person whose calendar is not switched on for them: I dag says so and who connects one, with no warning, and the rail has no Kalender', async ({
    page,
    api,
  }) => {
    api.calendar = 'hidden';
    await open(page, '/');
    await expect(day(page).getByText('Ingen kalender är kopplad till dig.', { exact: true })).toBeVisible();
    await expect(
      day(page).getByText('En administratör kopplar kalendern under Anslutna system.', { exact: true }),
    ).toBeVisible();
    await expect(day(page).getByRole('button', { name: 'Försök igen' })).toHaveCount(0);
    await expect(day(page).getByRole('link', { name: 'Kalender', exact: true })).toHaveCount(0);
    expect(await silentSaidIn(page)).toEqual([]);
    expect(await said(page, 'svarar inte')).toBe(0);
    await expect(
      page.getByRole('navigation', { name: 'Sidonavigering' }).getByRole('link', { name: 'Kalender', exact: true }),
    ).toHaveCount(0);
    await expectNoAxeViolations(page);
  });

  test('an account with no calendar bound: I dag says so and who binds one, and the rail keeps Kalender', async ({
    page,
    api,
  }) => {
    api.calendar = 'unbound';
    await open(page, '/');
    await expect(day(page).getByText('Ingen kalender är kopplad till dig.', { exact: true })).toBeVisible();
    await expect(day(page).getByText('En administratör kopplar ditt kalenderkonto.', { exact: true })).toBeVisible();
    expect(await silentSaidIn(page)).toEqual([]);
    expect(await said(page, 'svarar inte')).toBe(0);
    await expect(
      page.getByRole('navigation', { name: 'Sidonavigering' }).getByRole('link', { name: 'Kalender', exact: true }),
    ).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test('a silent calendar and no calendar reflow at 320 px', async ({ page, api }) => {
    await page.setViewportSize(narrow);
    for (const state of ['silent', 'hidden'] as const) {
      api.calendar = state;
      await open(page, '/');
      await expect(day(page).getByRole('heading', { name: 'I dag' })).toBeVisible();
      expect(await reflowProblems(page, day(page)), state).toEqual([]);
    }
  });
});
