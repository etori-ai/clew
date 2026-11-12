import type { Page } from '@playwright/test';
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
  test,
  type MockApi,
} from './support';
import { ENTITY_UNIT, NEWS_LINK, TOOLBOX_HREF, newsMenuRow, newsOutput, siteHeaderWithToolbox, user } from './data';
import { menuRows } from './phonebook';
import { Units } from './unit-data';

/**
 * Hem with the parts of the prototype's version 1.0 (D111, amended 2026-11-11, board Hem10): the item that asks for a
 * read receipt as a callout between the box and the blocks, "Behöver dig", "I dag" and "Nyheter" side by side, Läget
 * with its way to the unit's page as Dialogstöd's figures, Verktygslådan with the person's tools, and under them what
 * D111 kept. "Anpassa startsidan" is not built, so nothing here looks for it.
 */
const rail = (page: Page) => page.getByRole('navigation', { name: 'Sidonavigering' });
const news = (page: Page) => page.getByRole('region', { name: 'Nyheter' });
const callout = (page: Page) => page.getByRole('region', { name: 'Viktigt' });
const toasts = (page: Page) => page.getByRole('region', { name: 'Aviseringar' });

/** "Ny rutin för läkemedelshantering" as the communication fixture pushes it now: its "Jag har läst" is the read receipt. */
const PUBLISHED = '2026-11-03T05:30:00.000Z';
const receiptItem = (api: MockApi, id = 'rutin', over: Partial<Thread> = {}): Thread => {
  const base = api.threads.find(t => t.id === 'rutin')!;
  return {
    ...base,
    id,
    topic: id,
    items: [
      {
        ref: `communication:notice:${id}`,
        label: base.title,
        detail: 'kräver läskvitto',
        selectable: false,
        selected: true,
      },
    ],
    actions: [
      {
        id: 'ack',
        label: 'Jag har läst',
        capability: 'communication.acknowledge',
        kind: 'execute',
        role: 'primary',
        usesItems: true,
        acknowledgement: { publishedAt: PUBLISHED },
      },
    ],
    ...over,
  };
};
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

  test('the callout, then Behöver dig, I dag and Nyheter side by side, then Läget, Verktygslådan and what D111 kept, in one heading order', async ({
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
    // Under them Läget, Verktygslådan, then what D111 kept, Sedan i går last.
    const lage = heading(page, 2, `Läget på ${user.unitLabel}`),
      tools = heading(page, 2, 'Verktygslådan'),
      own = heading(page, 2, 'Mina åtgärdspunkter'),
      since = heading(page, 2, 'Sedan i går');
    const y = async (l: ReturnType<typeof heading>) => (await l.boundingBox())!.y;
    expect(await y(lage)).toBeGreaterThan(Math.max(n.y + n.height, d.y + d.height, w.y + w.height));
    expect(await y(tools)).toBeGreaterThan(await y(lage));
    expect(await y(own)).toBeGreaterThan(await y(tools));
    expect(await y(since)).toBeGreaterThan(await y(own));
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
      at('Sedan i går'),
    ];
    expect(order.every(i => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // Not built (D111, amended 2026-11-11): no control arranges the page, and no chips sit under the box.
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
    // A link out of Clew says so in its name and opens a new tab (D110 rule 8).
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
    // Läs opens the item in Att göra, as every row on Hem does.
    await expect(lifted.getByRole('link', { name: 'Läs', exact: true })).toHaveAttribute('href', '/todo?item=rutin');
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
    // A tile keeps opening what it opened before (D54): the view beside Hem.
    await expect(lage.getByRole('link', { name: /^Personal: Sjukfrånvaro/ })).toHaveAttribute(
      'href',
      /^\/\?open=hr\.absenceOverview/,
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

test.describe('Hem with the parts of version 1.0, narrow', () => {
  test('at 320 px nothing reflows past the edge or is cut', async ({ page, api }) => {
    everything(api);
    api.header = siteHeaderWithToolbox();
    await page.setViewportSize(narrow);
    await open(page, '/');
    await expect(callout(page)).toBeVisible();
    await expect(news(page)).toBeVisible();
    expect(await reflowProblems(page)).toEqual([]);
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
});
