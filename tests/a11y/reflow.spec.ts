import {
  composer,
  desktop,
  dockOf,
  expect,
  heading,
  hiddenFocusStops,
  narrow,
  open,
  reflowProblems,
  short,
  snoozeFirst,
  test,
} from './support';

const routes = [
  ['start', '/'],
  ['Att göra', '/todo'],
  ['an area', '/todo?area=personal'],
  ['the log', '/todo?tab=done'],
  ['a work item', '/todo?item=fakturor'],
  ['the calendar page', '/calendar'],
] as const;

test.describe('1.4.10 reflow', () => {
  for (const viewport of [narrow, short])
    for (const [name, path] of routes)
      test(`${name} reflows at ${viewport.width}×${viewport.height}`, async ({ page, api: _ }) => {
        await page.setViewportSize(viewport);
        await open(page, path);
        expect(await reflowProblems(page)).toEqual([]);
      });

  test('the side panel reflows at 320×640', async ({ page, api: _ }) => {
    await page.setViewportSize(narrow);
    await open(page, '/?open=hr.whoIsOn&open-title=Bemanning');
    await expect(page.getByRole('dialog')).toBeVisible();
    expect(await reflowProblems(page)).toEqual([]);
  });

  test('the sources view, its own page, reflows at 320×640', async ({ page, api: _ }) => {
    await page.setViewportSize(narrow);
    await open(page, '/tools/clew.search?title=K%C3%A4llor&input=%7B%22query%22%3A%22fall%22%7D&from=%2F');
    await expect(page.getByRole('main').getByRole('list', { name: 'Källor' })).toBeVisible();
    expect(await reflowProblems(page)).toEqual([]);
  });

  test('the piles and the system filter of Att göra fit a phone: every pile is a tab, every area is offered and nothing scrolls sideways', async ({
    page,
    api: _,
  }) => {
    await page.setViewportSize(narrow);
    await open(page, '/todo');
    // The three piles fit 320 px with their short names (board PhoneInbox), so they stay tabs.
    const tabs = page.getByRole('navigation', { name: 'Urval' });
    await expect(tabs.getByRole('link')).toHaveCount(3);
    for (const tab of await tabs.getByRole('link').all()) await expect(tab).toBeInViewport({ ratio: 1 });
    await tabs.getByRole('link', { name: /^Väntar/ }).click();
    await expect(page).toHaveURL(/\/todo\?tab=waiting$/);
    await expect(page.getByRole('list', { name: 'Väntar på andra' })).toBeVisible();
    expect(await reflowProblems(page)).toEqual([]);
    await page.getByRole('button', { name: 'Alla system' }).click();
    expect(await page.getByRole('menuitemradio').count()).toBeGreaterThanOrEqual(6);
    expect(await reflowProblems(page)).toEqual([]);
    await page.getByRole('menuitemradio', { name: 'Personal' }).click();
    await expect(page).toHaveURL(/\/todo\?tab=waiting&area=personal$/);
    expect(await reflowProblems(page)).toEqual([]);
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
  for (const [name, path] of routes)
    test(`${name} survives the spacing overrides`, async ({ page, api: _ }) => {
      await page.setViewportSize(narrow);
      await open(page, path);
      await page.addStyleTag({
        content:
          '* { line-height: 1.5 !important; letter-spacing: .12em !important; word-spacing: .16em !important; } p { margin-bottom: 2em !important; }',
      });
      expect(await reflowProblems(page)).toEqual([]);
    });
});

test.describe('an area’s whole name on its figure tile', () => {
  // The chip is Astryx's Badge, one line, and a name wider than its room would end in an ellipsis: at 320 px the tiles
  // stand one per row, so every area name of the mock ("Utvecklingssamtal" the longest) is drawn whole, with or without
  // the text-spacing overrides. At 350 px, just under where two tiles start, the spaced name still fits its one tile.
  const spacing =
    '* { line-height: 1.5 !important; letter-spacing: .12em !important; word-spacing: .16em !important; } p { margin-bottom: 2em !important; }';
  test('every figure tile shows its whole area name at 320 px, 640 and 256 high, and spaced at 350 px', async ({
    page,
    api,
  }) => {
    const names = api.areas.filter(a => a.figure).map(a => a.title);
    expect(names).toContain('Utvecklingssamtal');
    const lage = page.getByRole('region', { name: 'Läget' });
    const runs = [
      ...[narrow, short].flatMap(viewport => [null, spacing].map(overrides => ({ viewport, overrides }))),
      { viewport: { width: 350, height: 640 }, overrides: spacing },
    ];
    for (const { viewport, overrides } of runs) {
      await page.setViewportSize(viewport);
      await open(page, '/');
      if (overrides) await page.addStyleTag({ content: overrides });
      const chips = await lage.locator('.astryx-badge').evaluateAll(list =>
        list.map(el => {
          const label = el.lastElementChild as HTMLElement;
          const box = el.getBoundingClientRect();
          return {
            name: label.textContent,
            cut: label.scrollWidth > label.clientWidth + 1,
            inside: box.left >= 0 && box.right <= document.documentElement.clientWidth,
          };
        }),
      );
      for (const name of names)
        expect(
          chips.find(chip => chip.name === name),
          `${name} at ${viewport.width}×${viewport.height}, ${overrides ? 'spaced' : 'plain'}`,
        ).toEqual({
          name,
          cut: false,
          inside: true,
        });
      expect(await reflowProblems(page, lage)).toEqual([]);
    }
  });
});

test.describe('2.4.11 focus not obscured', () => {
  for (const viewport of [desktop, narrow, short])
    for (const path of ['/', '/todo', '/todo?item=fakturor'])
      test(`every stop on ${path} is visible at ${viewport.width}×${viewport.height}`, async ({ page, api: _ }) => {
        await page.setViewportSize(viewport);
        await open(page, path);
        const { hidden } = await hiddenFocusStops(page);
        expect(hidden).toEqual([]);
      });

  test('a toast covers no focus stop on a phone', async ({ page, api: _ }) => {
    await page.setViewportSize(narrow);
    await open(page, '/');
    await snoozeFirst(page);
    await expect(page.getByRole('region', { name: 'Aviseringar' })).toBeVisible();
    const { hidden } = await hiddenFocusStops(page);
    expect(hidden).toEqual([]);
  });

  test('the row keeps what needs the person readable on a short screen', async ({ page, api: _ }) => {
    await page.setViewportSize(short);
    await open(page, '/');
    const title = heading(page, 2, 'Behöver dig');
    await title.evaluate(el => el.scrollIntoView({ block: 'start' }));
    // With 256 px of height nothing is docked (D31 item 7): the row is in the page flow and the stream has the screen.
    expect(await dockOf(page), 'the row is in the page flow').toBeNull();
    const below = await title.evaluate(el => innerHeight - el.getBoundingClientRect().bottom);
    expect(below, 'room for the stream under its heading').toBeGreaterThanOrEqual(100);
  });
});
