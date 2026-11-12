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

  test("the calendar's head stays two rows at that size", async ({ page, api: _ }) => {
    await open(page, '/calendar');
    await expect(page.getByRole('button', { name: /^Förslag/ })).toBeVisible();
    const list = await page.getByRole('group', { name: /^Vecka 45/ }).boundingBox();
    // Measured from the shell's bar, not from the top of the screen: the bar is the shared header's heading row since
    // D88 (61 px with the bell and the person at touch size), and its height is not the calendar's. Two rows of 44 px
    // controls with their gaps and the head's padding are 137 px; a third row would make it 185.
    const bar = await page.getByRole('banner').boundingBox();
    expect(list!.y - (bar!.y + bar!.height)).toBeLessThan(140);
  });

  // The tabs and the area filter are Mina aktiviteter's (D115 item 4), the conversations Min AI's (D115 item 5).
  for (const path of [
    '/',
    '/activities',
    '/activities?area=personal',
    '/activities?tab=waiting',
    '/activities?tab=snoozed',
    '/activities?tab=done',
    '/conversations',
    '/conversations/fraga',
    '/calendar',
  ])
    test(`on ${path}`, async ({ page, api: _ }) => {
      await open(page, path);
      expect(await shortTargets(page)).toEqual([]);
    });

  // On a phone the header's own Meny holds the places and Clew's pages under Start (D115 item 3).
  test("in the header's menu", async ({ page, api: _ }) => {
    await open(page, '/');
    const drawer = await openNav(page);
    await expect(drawer.getByRole('link', { name: 'Kalender' })).toBeVisible();
    expect(await shortTargets(page)).toEqual([]);
  });

  // The floating "Fråga AI" and its panel over the page (D115 item 5), and Min AI's list in its drawer.
  test('on the assistant’s panel and Min AI’s list', async ({ page, api: _ }) => {
    await open(page, '/activities');
    expect(await shortTargets(page)).toEqual([]);
    await page.getByRole('button', { name: 'Fråga AI', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Fråga AI', exact: true })).toBeVisible();
    expect(await shortTargets(page)).toEqual([]);
    await open(page, '/conversations');
    await page.getByRole('button', { name: 'Dina samtal', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Dina samtal', exact: true })).toBeVisible();
    expect(await shortTargets(page)).toEqual([]);
  });

  test('in the administration', async ({ page, api }) => {
    api.admin = true;
    for (const path of ['/admin/connectors', '/admin/connectors/hello', '/admin/models']) {
      await open(page, path);
      expect(await shortTargets(page)).toEqual([]);
    }
  });
});

test.describe('a mouse', () => {
  test.use({ viewport: desktop });

  test('keeps the compact controls the screens were drawn with', async ({ page, api: _ }) => {
    await open(page, '/');
    // A row's one next step (D115 item 4) is the compact button the rows were drawn with.
    await expect(page.locator('#thread-ledighet').getByRole('button', { name: 'Godkänn' })).toHaveCSS('height', '32px');
  });
});
