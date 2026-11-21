import { desktop, expect, open, openNav, phone, test } from './support';
import type { Page } from '@playwright/test';

/**
 * What a finger can reach and what is drawn shorter than `floor`. A link inside a sentence is exempt, as WCAG 2.5.8 says.
 * A checkbox's row is its label and a field's box is around its input, so those are what is measured. A tile's button is a
 * one-pixel element stretched over its card, and Switch and InfoTip carry Astryx's own touch layer that reaches 44 px.
 */
const shortTargets = (page: Page) =>
  page.evaluate(() =>
    [
      ...document.querySelectorAll<HTMLElement>(
        'a[href], button, [role="button"], [role="switch"], [role="tab"], [role="radio"], input, textarea, select',
      ),
    ]
      .filter(
        el =>
          el.checkVisibility() &&
          el.getAttribute('role') !== 'switch' &&
          el.getAttribute('aria-label') !== 'Så här hör jag av mig',
      )
      .filter(el => !(el.tagName === 'A' && el.closest('p, li')?.textContent?.trim() !== el.textContent?.trim()))
      .map(el => {
        const box =
          el.closest('label') ??
          el.closest('.astryx-item') ??
          (el.matches('input, textarea') ? el.parentElement!.parentElement! : el);
        return {
          name: (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 40),
          height: Math.round(box.getBoundingClientRect().height),
        };
      })
      .filter(target => target.height > 1 && target.height < 44),
  );

test.describe('a finger reaches every control at 44 px (docs/history/handover.md §6)', () => {
  test.use({ viewport: phone, hasTouch: true, isMobile: true });

  // The head in the one page frame (D126, D130) at touch size: the trail's line, the title's line, and the controls.
  // "Fråga AI" is its mark alone at the end of the title's line, 44 px, and adds no row. Since D130's 24 px inset the
  // steps (206 px) and the view's menu (122 px) no longer share a row at 375 px (328 of 327 px), so the controls take
  // three rows where this case once allowed two (140 px under the bar); it holds the head to what is drawn now, so
  // nothing more adds a row.
  test("the calendar's head has Fråga AI on its title's line and no row more than its controls need at that size", async ({
    page,
    api: _,
  }) => {
    await open(page, '/calendar');
    const main = page.getByRole('main');
    const at = async (name: string | RegExp) => (await main.getByRole('button', { name }).boundingBox())!;
    const title = (await page.getByRole('heading', { level: 1, name: 'Vecka 45' }).boundingBox())!;
    const door = await at('Fråga AI');
    expect(door.height).toBeGreaterThanOrEqual(44);
    expect(door.width).toBeGreaterThanOrEqual(44);
    expect(door.y, 'Fråga AI is on the title’s line').toBeLessThanOrEqual(title.y);
    expect(door.y + door.height).toBeGreaterThanOrEqual(title.y + title.height);
    expect((await at('Ny bokning')).y, 'what can be done is one row').toBe((await at(/^Förslag/)).y);
    const list = (await page.getByRole('group', { name: /^Vecka 45/ }).boundingBox())!;
    const lines = await main.getByRole('button').evaluateAll(
      (all, top) => [
        ...new Set(
          all
            .map(b => b.getBoundingClientRect())
            .filter(b => b.height > 0 && b.bottom <= top)
            .map(b => Math.round(b.top + b.height / 2)),
        ),
      ],
      list.y,
    );
    // The title's line, the steps, the view's menu, and what can be done.
    expect(lines.length).toBeLessThanOrEqual(4);
    // Measured from the shell's bar, not from the top of the screen: the bar is the shared header's heading row since
    // D88, and its height is not the calendar's. 321 px as drawn: the trail's line and four lines of 44 px with their
    // gaps and the head's padding; a fifth would make it 369.
    const bar = (await page.getByRole('banner').boundingBox())!;
    expect(list.y - (bar.y + bar.height)).toBeLessThan(330);
  });

  for (const path of [
    '/',
    '/todo',
    '/todo?area=personal',
    '/todo?tab=waiting',
    '/todo?tab=done',
    '/todo?item=fakturor',
    '/calendar',
  ])
    test(`on ${path}`, async ({ page, api: _ }) => {
      await open(page, path);
      expect(await shortTargets(page)).toEqual([]);
    });

  test('in the rail', async ({ page, api: _ }) => {
    await open(page, '/');
    await openNav(page);
    expect(await shortTargets(page)).toEqual([]);
  });

  test('in the administration', async ({ page, api }) => {
    api.admin = true;
    for (const path of ['/admin/connectors', '/admin/connectors/hello', '/admin/models']) {
      await open(page, path);
      expect(await shortTargets(page)).toEqual([]);
    }
  });

  // An option is an Astryx Item inside its row, so the theme's 44 px for `item` under a coarse pointer reaches it and
  // the row needs no rule of its own (52 px with the row's padding, measured 2026-11-13 on Astryx 0.7.13).
  test("a selector's options are 44 px rows", async ({ page, api }) => {
    api.admin = true;
    await open(page, '/admin/users');
    await page.getByRole('combobox', { name: 'Roll' }).click();
    const options = page.getByRole('option');
    await expect(options.first()).toBeVisible();
    const heights = await options.evaluateAll(els => els.map(el => Math.round(el.getBoundingClientRect().height)));
    expect(heights.length).toBeGreaterThan(1);
    expect(heights.filter(height => height < 44)).toEqual([]);
  });
});

test.describe('a mouse', () => {
  test.use({ viewport: desktop });

  test('keeps the compact controls the screens were drawn with', async ({ page, api: _ }) => {
    await open(page, '/todo');
    await expect(page.getByRole('button', { name: 'Alla system' })).toHaveCSS('height', '32px');
  });
});
