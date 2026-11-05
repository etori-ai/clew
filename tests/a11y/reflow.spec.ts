import { composer, desktop, dockOf, expect, heading, hiddenFocusStops, narrow, open, openNav, reflowProblems, short, snoozeFirst, test } from './support';

const routes = [['start', '/'], ['the overview', '/overview'], ['an area', '/areas/personal'], ['the log', '/handled'], ['the calendar page', '/calendar']] as const;

test.describe('1.4.10 reflow', () => {
  for (const viewport of [narrow, short]) for (const [name, path] of routes) test(`${name} reflows at ${viewport.width}×${viewport.height}`, async ({ page, api: _ }) => {
    await page.setViewportSize(viewport);
    await open(page, path);
    expect(await reflowProblems(page)).toEqual([]);
  });

  test('the areas under the box wrap at 320 px, and the chosen area\'s cards are brought into view above the docked box', async ({ page, api: _ }) => {
    await page.setViewportSize(narrow);
    await open(page, '/');
    const areas = page.getByRole('group', { name: 'Områden' });
    const tops = await areas.getByRole('button').evaluateAll(list => list.map(el => Math.round(el.getBoundingClientRect().top)));
    expect(new Set(tops).size).toBeGreaterThan(1);
    await areas.getByRole('button', { name: 'Budget' }).click();
    const cards = page.getByRole('group', { name: 'Budget', exact: true });
    // The card's link is a hidden element over the card; what the person sees is its text.
    await expect(cards.getByText('Attestera fakturor', { exact: true })).toBeInViewport({ ratio: 1 });
    const box = (await composer(page).boundingBox())!, last = (await cards.boundingBox())!;
    expect(last.y + last.height).toBeLessThanOrEqual(box.y);
    expect(await reflowProblems(page)).toEqual([]);
  });

  test('the side panel reflows at 320×640', async ({ page, api: _ }) => {
    await page.setViewportSize(narrow);
    await open(page, '/views/heroma.whoIsOn?title=Bemanning');
    await expect(page.getByRole('dialog')).toBeVisible();
    expect(await reflowProblems(page)).toEqual([]);
  });

  test('the sources view reflows at 320×640', async ({ page, api: _ }) => {
    await page.setViewportSize(narrow);
    await open(page, '/views/clew.search?title=K%C3%A4llor&input=%7B%22query%22%3A%22fall%22%7D');
    await expect(page.getByRole('dialog').getByRole('list', { name: 'Källor' })).toBeVisible();
    expect(await reflowProblems(page)).toEqual([]);
  });

  test('every area filter on a phone shows its whole name', async ({ page, api: _ }) => {
    await page.setViewportSize(narrow);
    await open(page, '/');
    const filters = (await openNav(page)).locator('a[href^="/areas/"]');
    expect(await filters.count()).toBeGreaterThanOrEqual(5);
    for (const filter of await filters.all()) {
      const text = (await filter.textContent())?.trim() ?? '';
      const { width, needed } = await filter.evaluate(el => {
        const probe = document.createElement('span');
        probe.textContent = el.textContent;
        probe.style.cssText = `position:absolute;visibility:hidden;white-space:nowrap;font:${getComputedStyle(el).font}`;
        document.body.append(probe);
        const needed = probe.getBoundingClientRect().width;
        probe.remove();
        return { width: el.getBoundingClientRect().width, needed };
      });
      expect(width, text).toBeGreaterThanOrEqual(needed);
    }
  });

  test('a calendar week stacks its days on a phone', async ({ page, api: _ }) => {
    await page.setViewportSize(narrow);
    await open(page, '/calendar');
    const days = page.locator('h1, h2, h3, h4, h5, h6').filter({ hasText: /^(mån|tis|ons|tors|fre) \d+ nov/ });
    await expect(days).toHaveCount(5);
    expect((await days.nth(1).boundingBox())!.y).toBeGreaterThan((await days.nth(0).boundingBox())!.y);
  });
});

test.describe('1.4.12 text spacing', () => {
  for (const [name, path] of routes) test(`${name} survives the spacing overrides`, async ({ page, api: _ }) => {
    await page.setViewportSize(narrow);
    await open(page, path);
    await page.addStyleTag({ content: '* { line-height: 1.5 !important; letter-spacing: .12em !important; word-spacing: .16em !important; } p { margin-bottom: 2em !important; }' });
    expect(await reflowProblems(page)).toEqual([]);
  });
});

test.describe('2.4.11 focus not obscured', () => {
  for (const viewport of [desktop, narrow, short]) for (const path of ['/', '/overview']) test(`every stop on ${path} is visible at ${viewport.width}×${viewport.height}`, async ({ page, api: _ }) => {
    await page.setViewportSize(viewport);
    await open(page, path);
    const { hidden } = await hiddenFocusStops(page);
    expect(hidden).toEqual([]);
  });

  test('a toast covers no focus stop on a phone', async ({ page, api: _ }) => {
    await page.setViewportSize(narrow);
    await open(page, '/overview');
    await snoozeFirst(page);
    await expect(page.getByRole('region', { name: 'Aviseringar' })).toBeVisible();
    const { hidden } = await hiddenFocusStops(page);
    expect(hidden).toEqual([]);
  });

  test('the row keeps the stream readable on a short screen', async ({ page, api: _ }) => {
    await page.setViewportSize(short);
    await open(page, '/overview');
    const title = heading(page, 2, 'Nu · ');
    await title.evaluate(el => el.scrollIntoView({ block: 'start' }));
    // With 256 px of height nothing is docked (D31 item 7): the row is in the page flow and the stream has the screen.
    expect(await dockOf(page), 'the row is in the page flow').toBeNull();
    const below = await title.evaluate(el => innerHeight - el.getBoundingClientRect().bottom);
    expect(below, 'room for the stream under its heading').toBeGreaterThanOrEqual(100);
  });
});
