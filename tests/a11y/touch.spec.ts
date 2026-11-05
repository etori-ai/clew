import { desktop, expect, open, openNav, phone, test } from './support';
import type { Page } from '@playwright/test';

/**
 * What a finger can reach and what is drawn shorter than `floor`. A link inside a sentence is exempt, as WCAG 2.5.8 says.
 * A checkbox's row is its label and a field's box is around its input, so those are what is measured. A tile's button is a
 * one-pixel element stretched over its card, and Switch and InfoTip carry Astryx's own touch layer that reaches 44 px.
 */
const shortTargets = (page: Page) => page.evaluate(() => [...document.querySelectorAll<HTMLElement>('a[href], button, [role="button"], [role="switch"], [role="tab"], [role="radio"], input, textarea, select')]
  .filter(el => el.checkVisibility() && el.getAttribute('role') !== 'switch' && el.getAttribute('aria-label') !== 'Så här hör jag av mig')
  .filter(el => !(el.tagName === 'A' && el.closest('p, li')?.textContent?.trim() !== el.textContent?.trim()))
  .map(el => {
    const box = el.closest('label') ?? el.closest('.astryx-item') ?? (el.matches('input, textarea') ? el.parentElement!.parentElement! : el);
    return { name: (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 40), height: Math.round(box.getBoundingClientRect().height) };
  })
  .filter(target => target.height > 1 && target.height < 44));

test.describe('a finger reaches every control at 44 px (HANDOVER §6)', () => {
  test.use({ viewport: phone, hasTouch: true, isMobile: true });

  test('the calendar\'s head stays two rows at that size', async ({ page, api: _ }) => {
    await open(page, '/calendar');
    await expect(page.getByRole('button', { name: /^Förslag/ })).toBeVisible();
    const list = await page.getByRole('group', { name: /^Vecka 45/ }).boundingBox();
    expect(list!.y).toBeLessThan(190);
  });

  for (const path of ['/overview', '/areas/personal', '/waiting', '/snoozed', '/handled', '/calendar']) test(`on ${path}`, async ({ page, api: _ }) => {
    await open(page, path);
    expect(await shortTargets(page)).toEqual([]);
  });

  test('in the rail', async ({ page, api: _ }) => {
    await open(page, '/overview');
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
});

test.describe('a mouse', () => {
  test.use({ viewport: desktop });

  test('keeps the compact controls the screens were drawn with', async ({ page, api: _ }) => {
    await open(page, '/overview');
    await expect(page.getByRole('button', { name: 'Fler val' }).first()).toHaveCSS('height', '28px');
  });
});
