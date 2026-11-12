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
  // The tabs and the area filter are Mina aktiviteter's (D115 item 4), the conversations Min AI's (D115 item 5).
  ['Mina aktiviteter', '/activities'],
  ['an area', '/activities?area=personal'],
  ['the log', '/activities?tab=done'],
  ['Min AI', '/conversations'],
  ['a conversation in Min AI', '/conversations/fraga'],
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

  test('the sources view reflows at 320×640', async ({ page, api: _ }) => {
    await page.setViewportSize(narrow);
    await open(page, '/?open=clew.search&open-title=K%C3%A4llor&open-input=%7B%22query%22%3A%22fall%22%7D');
    await expect(page.getByRole('dialog').getByRole('list', { name: 'Källor' })).toBeVisible();
    expect(await reflowProblems(page)).toEqual([]);
  });

  test('the tabs and the area filter of Mina aktiviteter fit a phone: every area is offered and nothing scrolls sideways', async ({
    page,
    api: _,
  }) => {
    await page.setViewportSize(narrow);
    await open(page, '/activities');
    // A tab strip that scrolls sideways would hide its last tabs: on a phone the same choice is one menu.
    await expect(page.getByRole('tab')).toHaveCount(0);
    await page.getByRole('button', { name: /^Visa: Behöver dig/ }).click();
    await expect(page.getByRole('menuitem')).toHaveCount(4);
    await page.getByRole('menuitem', { name: /^Väntar/ }).click();
    await expect(page).toHaveURL(/\/activities\?tab=waiting$/);
    await expect(page.getByRole('region', { name: 'Väntar på andra' })).toBeVisible();
    expect(await reflowProblems(page)).toEqual([]);
    await page.getByRole('button', { name: 'Område: Alla' }).click();
    expect(await page.getByRole('menuitem').count()).toBeGreaterThanOrEqual(6);
    expect(await reflowProblems(page)).toEqual([]);
    await page.getByRole('menuitem', { name: 'Personal' }).click();
    await expect(page).toHaveURL(/\/activities\?tab=waiting&area=personal$/);
    expect(await reflowProblems(page)).toEqual([]);
  });

  test('the floating Fråga AI and its panel reflow at 320×640 and 320×256', async ({ page, api: _ }) => {
    // On a page without a box of its own the assistant is a button in the corner and a panel over the page (D115 item 5).
    for (const viewport of [narrow, short]) {
      await page.setViewportSize(viewport);
      await open(page, '/activities');
      const ask = page.getByRole('button', { name: 'Fråga AI', exact: true });
      await expect(ask).toBeInViewport();
      expect(await reflowProblems(page)).toEqual([]);
      await ask.click();
      const panel = page.getByRole('dialog', { name: 'Fråga AI', exact: true });
      await expect(panel.getByRole('combobox', { name: 'Vad vill du göra' })).toBeVisible();
      expect(await reflowProblems(page, panel)).toEqual([]);
      await page.keyboard.press('Escape');
      await expect(panel).toBeHidden();
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

test.describe('a key figure’s whole label on its tile', () => {
  // The label is drawn in small capitals (D115 item 4, the theme's `eyebrow`), and a label wider than its room must
  // wrap, never end in an ellipsis. At 320 px the tiles stand one per row and at 1024 px four across beside nothing;
  // every label of the mock ("Utvecklingssamtal hållna" the longest) is drawn whole, with or without the text-spacing
  // overrides. At 350 px, just under where two tiles start, the spaced label still fits its one tile. The area's name
  // is the tile's last line, plain text that wraps.
  const spacing =
    '* { line-height: 1.5 !important; letter-spacing: .12em !important; word-spacing: .16em !important; } p { margin-bottom: 2em !important; }';
  test('every figure tile shows its whole label at 320 px, 640 and 256 high, spaced at 350 px, and at 1024 px', async ({
    page,
    api: _,
  }) => {
    const labels = ['Viktigt nu', 'Utvecklingssamtal hållna', 'Sjukfrånvaro', 'Förbrukat av ramen', 'Öppna tillbud'];
    const lage = page.getByRole('region', { name: 'Läget' });
    const runs = [
      ...[narrow, short].flatMap(viewport => [null, spacing].map(overrides => ({ viewport, overrides }))),
      { viewport: { width: 350, height: 640 }, overrides: spacing },
      { viewport: { width: 1024, height: 768 }, overrides: null },
    ];
    for (const { viewport, overrides } of runs) {
      await page.setViewportSize(viewport);
      await open(page, '/');
      if (overrides) await page.addStyleTag({ content: overrides });
      // Each label as drawn: the innermost element that holds its words, cut when it or a box around it inside the
      // tile hides part of them (an ellipsis, a clipped overflow or a line clamp).
      const badges = await lage.evaluate(
        (region, names) =>
          names.map(name => {
            const leaf = [...region.querySelectorAll<HTMLElement>('*')].find(
              el => el.textContent?.trim() === name && ![...el.children].some(c => c.textContent?.trim() === name),
            );
            if (!leaf) return { name, cut: true, inside: false };
            let cut = false;
            for (let el: HTMLElement | null = leaf; el && el !== region; el = el.parentElement) {
              const style = getComputedStyle(el);
              const clips =
                style.overflowX !== 'visible' || style.textOverflow === 'ellipsis' || style.webkitLineClamp !== 'none';
              if (clips && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)) cut = true;
              if (el.matches('a, [role="group"]')) break;
            }
            const box = leaf.getBoundingClientRect();
            return { name, cut, inside: box.left >= 0 && box.right <= document.documentElement.clientWidth };
          }),
        labels,
      );
      const at = `${viewport.width}×${viewport.height}, ${overrides ? 'spaced' : 'plain'}`;
      for (const name of labels)
        expect
          .soft(
            badges.find(badge => badge.name === name),
            `${name} at ${at}`,
          )
          .toEqual({
            name,
            cut: false,
            inside: true,
          });
      expect.soft(await reflowProblems(page, lage), at).toEqual([]);
    }
  });
});

test.describe('2.4.11 focus not obscured', () => {
  for (const viewport of [desktop, narrow, short])
    for (const path of ['/', '/?card=fakturor', '/activities', '/conversations/fraga'])
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
    const title = heading(page, 2, 'Att agera på · ');
    await title.evaluate(el => el.scrollIntoView({ block: 'start' }));
    // With 256 px of height nothing is docked (D31 item 7): the row is in the page flow and the stream has the screen.
    expect(await dockOf(page), 'the row is in the page flow').toBeNull();
    const below = await title.evaluate(el => innerHeight - el.getBoundingClientRect().bottom);
    expect(below, 'room for the stream under its heading').toBeGreaterThanOrEqual(100);
  });
});
