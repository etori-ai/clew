import { expect, test, type Page } from '@playwright/test';
import { desktop, expectNoAxeViolations, narrow } from './support';
import { brandingFixtures } from './branding-fixtures';

/**
 * The shared header as the intranet loads it (D87): `<site-header>` on the stand-in page the web app's dev server
 * serves at `/intranat/…`, whose own CSS is deliberately loud. Playwright's locators and axe both reach into the
 * element's open shadow root.
 */
const intranet = 'http://localhost:4175/intranat';

async function openIntranet(page: Page, path: string) {
  // The element asks the installation for its saved theme (D98); here that is Sundsvall's example theme file.
  await page.route('**/api/appearance', route =>
    route.fulfill({ json: { revision: 1, theme: brandingFixtures.sundsvall.theme, logo: null } }),
  );
  await page.goto(`${intranet}${path}`);
  await expect(page.getByRole('navigation', { name: 'Huvudmeny' })).toBeVisible();
  await page.waitForLoadState('networkidle');
}

test.describe('shared header on the intranet', () => {
  test('an anonymous visitor sees the public sections, the current one marked, and a way to sign in', async ({
    page,
  }) => {
    await page.setViewportSize(desktop);
    await openIntranet(page, '/organisation');
    const nav = page.getByRole('navigation', { name: 'Huvudmeny' });
    await expect(nav.getByRole('link', { name: 'Organisation' })).toHaveAttribute('aria-current', 'page');
    await expect(nav.getByRole('link', { name: 'Start', exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Anställning och arbetsmiljö' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Ekonomi och styrning' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Logga in' })).toBeVisible();
    // The page's own `* { font-family: Georgia }` stops at the shadow root.
    const font = await nav
      .getByRole('link', { name: 'Organisation' })
      .evaluate(link => getComputedStyle(link).fontFamily);
    expect(font).not.toContain('Georgia');
    await expectNoAxeViolations(page);
  });

  test('a signed-in visitor gets the sections Sitevision lists for them', async ({ page, context }) => {
    await page.setViewportSize(desktop);
    await context.addCookies([{ name: 'site-header-demo', value: 'signed-in', url: 'http://localhost:4175' }]);
    await openIntranet(page, '/ekonomi-styrning');
    const nav = page.getByRole('navigation', { name: 'Huvudmeny' });
    await expect(nav.getByRole('link', { name: 'Ekonomi och styrning' })).toHaveAttribute('aria-current', 'page');
    await expect(nav.getByRole('link', { name: 'Kompetensförsörjning' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Kim Andersson, inställningar' })).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test('the same header reads its places from a WordPress site when the page says so', async ({ page }) => {
    await page.setViewportSize(desktop);
    await openIntranet(page, '/organisation?source=wordpress');
    const nav = page.getByRole('navigation', { name: 'Huvudmeny' });
    const current = nav.getByRole('link', { name: 'Organisation' });
    // WordPress's links are absolute with a trailing slash; the page without one is still the current section.
    await expect(current).toHaveAttribute('href', 'http://localhost:4175/intranat/organisation/');
    await expect(current).toHaveAttribute('aria-current', 'page');
    await expect(nav.getByRole('link', { name: 'Ekonomi och styrning' })).toHaveCount(0);
  });

  test('the header is drawn in the person’s colour choice from Clew, else the system’s, with the light logo on dark', async ({
    page,
  }) => {
    await page.setViewportSize(desktop);
    const header = page.locator('site-header');
    const look = () =>
      header.evaluate(el => {
        const root = el.shadowRoot!;
        return {
          logo: root.querySelector('img')!.getAttribute('src'),
          item: getComputedStyle(root.querySelector('.astryx-top-nav-item')!).color,
        };
      });
    await page.emulateMedia({ colorScheme: 'dark' });
    await openIntranet(page, '/organisation');
    // On the band (D88) the places are white in both appearances; the logo still follows the mode's variant rule.
    expect(await look()).toEqual({ logo: '/branding/sundsvall-dragon-white.png', item: 'rgb(255, 255, 255)' });
    await expectNoAxeViolations(page);

    // A choice made in Clew wins over the system, and is followed when it changes.
    await page.emulateMedia({ colorScheme: 'light' });
    await page.evaluate(() => localStorage.setItem('clew:color-mode', 'dark'));
    await openIntranet(page, '/organisation');
    await expect(header).toHaveAttribute('data-site-header-mode', 'dark');
    expect((await look()).logo).toBe('/branding/sundsvall-dragon-white.png');
    await page.evaluate(() => {
      localStorage.setItem('clew:color-mode', 'light');
      window.dispatchEvent(new StorageEvent('storage', { key: 'clew:color-mode' }));
    });
    await expect(header).toHaveAttribute('data-site-header-mode', 'light');
    await expect.poll(look).toEqual({ logo: '/branding/sundsvall-dragon-white.png', item: 'rgb(255, 255, 255)' });
  });

  test('a signed-in visitor changes the colour by keyboard in their settings, and the dialog stays open', async ({
    page,
    context,
  }) => {
    await page.setViewportSize(desktop);
    await page.emulateMedia({ colorScheme: 'light' });
    await context.addCookies([{ name: 'site-header-demo', value: 'signed-in', url: 'http://localhost:4175' }]);
    await openIntranet(page, '/organisation');
    const person = page.getByRole('button', { name: 'Kim Andersson, inställningar' });
    await person.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Kim Andersson' });
    const system = dialog.getByRole('radio', { name: 'Samma som datorn' });
    await expect(system).toBeChecked();
    await expect(dialog.getByRole('button', { name: 'Logga ut' })).toBeVisible();
    // Astryx fades the dialog in; contrast is measured once it is drawn in full.
    await expect(dialog).toHaveCSS('opacity', '1');
    await expectNoAxeViolations(page);
    await system.focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(dialog.getByRole('radio', { name: 'Mörkt' })).toBeChecked();
    await expect(page.locator('site-header')).toHaveAttribute('data-site-header-mode', 'dark');
    expect(await page.evaluate(() => localStorage.getItem('clew:color-mode'))).toBe('dark');
    await expect(dialog).toBeVisible();
    // The page behind the dialog has the dark mode's colours, not the light ones held over by a transition; the band's
    // own text is white in both modes (D88), so the dialog's text is what tells the modes apart.
    await expect
      .poll(() =>
        page
          .locator('site-header')
          .evaluate(
            el =>
              getComputedStyle(
                el.shadowRoot!.querySelector('[role="dialog"] h2, [role="dialog"] h3, dialog h2, dialog h3')!,
              ).color,
          ),
      )
      .toBe('rgb(255, 255, 255)');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(person).toBeFocused();
  });

  test('at 320 px the places are behind Meny, in a dialog that Escape closes back to its button', async ({ page }) => {
    await page.setViewportSize(narrow);
    await openIntranet(page, '/organisation');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(narrow.width);
    const menu = page.getByRole('button', { name: 'Meny' });
    await menu.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('link', { name: 'Organisation' })).toHaveAttribute('aria-current', 'page');
    await expectNoAxeViolations(page);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(menu).toBeFocused();
  });
});
