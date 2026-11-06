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
  quietDay,
  snoozeFirst,
  test,
} from './support';

const routes = [
  ['start', '/'],
  ['an area', '/?area=personal'],
  ['the log', '/?tab=done'],
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

  test("on a quiet day the areas under the box wrap at 320 px, and the chosen area's cards are brought into view above the docked box", async ({
    page,
    api,
  }) => {
    quietDay(api);
    await page.setViewportSize(narrow);
    await open(page, '/');
    const areas = page.getByRole('group', { name: 'Områden' });
    const tops = await areas
      .getByRole('button')
      .evaluateAll(list => list.map(el => Math.round(el.getBoundingClientRect().top)));
    expect(new Set(tops).size).toBeGreaterThan(1);
    await areas.getByRole('button', { name: 'Budget' }).click();
    const cards = page.getByRole('group', { name: 'Budget', exact: true });
    // The card's link is a hidden element over the card; what the person sees is its text.
    await expect(cards.getByText('Attestera fakturor', { exact: true })).toBeInViewport({ ratio: 1 });
    const box = (await composer(page).boundingBox())!,
      last = (await cards.boundingBox())!;
    expect(last.y + last.height).toBeLessThanOrEqual(box.y);
    expect(await reflowProblems(page)).toEqual([]);
  });

  test('the side panel reflows at 320×640', async ({ page, api: _ }) => {
    await page.setViewportSize(narrow);
    await open(page, '/?open=hr.whoIsOn&open-title=Bemanning');
    await expect(page.getByRole('dialog')).toBeVisible();
    expect(await reflowProblems(page)).toEqual([]);
  });

  test('the sources view reflows at 320×640', async ({ page, api: _ }) => {
    await page.setViewportSize(narrow);
    await open(page, '/?open=clew.search&open-title=K%C3%A4llor&open-input=%7B%22query%22%3A%22fall%22%7D');
    await expect(page.getByRole('dialog').getByRole('list', { name: 'Källor' })).toBeVisible();
    expect(await reflowProblems(page)).toEqual([]);
  });

  test('the tabs and the area filter of Hem fit a phone: every area is offered and nothing scrolls sideways', async ({
    page,
    api: _,
  }) => {
    await page.setViewportSize(narrow);
    await open(page, '/');
    // A tab strip that scrolls sideways would hide its last tabs: on a phone the same choice is one menu.
    await expect(page.getByRole('tab')).toHaveCount(0);
    await page.getByRole('button', { name: /^Visa: Behöver dig/ }).click();
    await expect(page.getByRole('menuitem')).toHaveCount(4);
    await page.getByRole('menuitem', { name: /^Väntar/ }).click();
    await expect(page).toHaveURL(/\/\?tab=waiting$/);
    await expect(page.getByRole('region', { name: 'Väntar på andra' })).toBeVisible();
    expect(await reflowProblems(page)).toEqual([]);
    await page.getByRole('button', { name: 'Område: Alla' }).click();
    expect(await page.getByRole('menuitem').count()).toBeGreaterThanOrEqual(6);
    expect(await reflowProblems(page)).toEqual([]);
    await page.getByRole('menuitem', { name: 'Personal' }).click();
    await expect(page).toHaveURL(/\/\?tab=waiting&area=personal$/);
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

test.describe('2.4.11 focus not obscured', () => {
  for (const viewport of [desktop, narrow, short])
    for (const path of ['/', '/?card=fakturor'])
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

  test('the row keeps the stream readable on a short screen', async ({ page, api: _ }) => {
    await page.setViewportSize(short);
    await open(page, '/');
    const title = heading(page, 2, 'Nu · ');
    await title.evaluate(el => el.scrollIntoView({ block: 'start' }));
    // With 256 px of height nothing is docked (D31 item 7): the row is in the page flow and the stream has the screen.
    expect(await dockOf(page), 'the row is in the page flow').toBeNull();
    const below = await title.evaluate(el => innerHeight - el.getBoundingClientRect().bottom);
    expect(below, 'room for the stream under its heading').toBeGreaterThanOrEqual(100);
  });
});
