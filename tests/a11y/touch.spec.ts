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

  // D74, amended 2026-11-23: the title on a line of its own, then the controls as two rows, the steps with the view menu
  // and Förslag with Ny bokning. It holds in each view (the view menu is widest in the month) and at 360 px, the
  // narrowest of the common phones; at 320 px the controls may wrap to a third row, which the reflow specs cover.
  test("the calendar's head stays two rows at that size", async ({ page, api: _ }) => {
    for (const width of [phone.width, 360])
      for (const [path, calendar] of [
        ['/calendar', /^Vecka 45/],
        ['/calendar?view=day', 'Onsdag 4 november'],
        ['/calendar?view=month', 'November 2026'],
      ] as const) {
        const where = `${path} at ${width} px`;
        await page.setViewportSize({ ...phone, width });
        await open(page, path);
        const controls = [
          page.getByRole('group', { name: /^Byt / }),
          page.getByRole('button', { name: /^Vy: / }),
          page.getByRole('button', { name: /^Förslag/ }),
          page.getByRole('button', { name: 'Ny bokning' }),
        ];
        for (const control of controls) await expect(control, where).toBeVisible();
        const tops = await Promise.all(controls.map(async control => Math.round((await control.boundingBox())!.y)));
        expect([...new Set(tops)], where).toHaveLength(2);
        // Measured from the shell's bar, not from the top of the screen: the bar is the shared header's heading row
        // since D88 (61 px with the bell and the person at touch size), and its height is not the calendar's. The
        // frame's inset (24 px), the trail (28 and 12 under it), the title (32 and 8), two rows of 44 px controls with
        // the 8 px between them, the head's foot (24 and its rule) and the column's inset (24) are 249 px; a third row
        // would make it 301.
        const list = await page.getByRole('group', { name: calendar }).boundingBox();
        const bar = await page.getByRole('banner').boundingBox();
        expect(list!.y - (bar!.y + bar!.height), where).toBeLessThan(260);
      }
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
