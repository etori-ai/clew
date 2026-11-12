import type { Locator } from '@playwright/test';
import { desktop, expect, narrow, open, openNav, reflowProblems, test } from './support';
import { a11yBrandProfile, brandingFixtures, savedBranding } from './branding-fixtures';

const surfaces = [
  ['start', '/'],
  ['calendar', '/calendar'],
  ['administration', '/admin/connectors'],
] as const;
const profile = a11yBrandProfile(process.env.CLEW_A11Y_BRAND_PROFILE);
const fixture = brandingFixtures[profile];
const expectedLogo = savedBranding(profile).appearance.logo;

test.describe(`D98 installation logo and theme (${profile})`, () => {
  // The theme and the logo are what the installation has saved, so they are the API's answer (D98).
  test.beforeEach(async ({ api }) => {
    Object.assign(api, savedBranding(profile));
  });

  for (const viewport of [desktop, narrow])
    for (const [name, path] of surfaces) {
      test(`the ${name} header identifies the organisation and links home at ${viewport.width}px`, async ({
        page,
        api,
      }) => {
        api.admin = true;
        await page.setViewportSize(viewport);
        await page.goto(path);
        // By level, not by tag: the calendar's month on a phone is an h3 that says level 1.
        await expect(page.getByRole('main').locator('h1:not([aria-level]), [aria-level="1"]')).toBeVisible();
        await page.evaluate(() => document.fonts.ready.then(() => undefined));
        // The logo and the name stand in the shared header's band (D88), the shell's banner, on every width.
        const header = page.getByRole('banner');
        const heading = header.locator('.astryx-top-nav-heading').first();
        const home = header.getByRole('link', { name: /Startsidan/ });
        await expect(home).toBeVisible();
        await expect(home).toHaveAccessibleName(/Startsidan/);
        // The page's own tokens: the band swaps them for its own, so they are read on the page.
        const brand = await page.getByRole('main').evaluate(element => {
          const style = getComputedStyle(element);
          return {
            accent: style.getPropertyValue('--color-accent'),
            text: style.getPropertyValue('--color-text-primary'),
          };
        });
        expect(brand.accent).toContain(fixture.accent);
        expect(brand.text).toContain('#000000');
        if (expectedLogo) {
          const logo = heading.getByRole('img', { name: expectedLogo.alt, exact: true });
          await expect(logo).toBeVisible();
          // On the band the dark variant is drawn (Sundsvall's white dragon); a logo without one keeps its own ground.
          // The band is drawn on a phone too (D115 item 3: the header folds into its own Meny there), so on every width.
          await expect(logo).toHaveAttribute('src', expectedLogo.darkSrc ?? expectedLogo.src);
          await expect(logo).toHaveJSProperty('complete', true);
          const shape = await logo.evaluate((img: HTMLImageElement) => ({
            natural: img.naturalWidth / img.naturalHeight,
            drawn: img.getBoundingClientRect().width / img.getBoundingClientRect().height,
            height: img.getBoundingClientRect().height,
          }));
          expect(shape.natural).toBeGreaterThan(0);
          // Never cropped, stretched or filtered (D37): the mark keeps its proportions at the row's height.
          expect(Math.abs(shape.drawn - shape.natural)).toBeLessThan(0.05);
          expect(shape.height).toBe(28);
        } else {
          await expect(heading.getByRole('img')).toHaveCount(0);
        }
        await expect(home).toHaveAttribute('href', '/');
        expect(await reflowProblems(page, heading)).toEqual([]);
        await home.focus();
        await expect(home).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL('/');
      });
    }

  if (expectedLogo)
    test('a failed image request leaves a named, working home link', async ({ page, api: _ }) => {
      let failedRequests = 0;
      await page.route('**/api/appearance/logo/**', route => {
        failedRequests++;
        return route.abort();
      });
      await page.goto('/calendar');
      const header = page.getByRole('banner');
      const heading = header.locator('.astryx-top-nav-heading').first();
      const home = header.getByRole('link', { name: /Startsidan/ });
      await expect(home).toBeVisible();
      await expect.poll(() => failedRequests).toBeGreaterThan(0);
      await expect(heading.getByRole('img')).toHaveCount(0);
      await expect(home).toHaveAccessibleName(/^Startsidan/);
      await home.click();
      await expect(page).toHaveURL('/');
    });

  // Clew's own pages stand in the row under the header's band (D115 item 3), on the surface colour. The row of the page
  // that is open is marked by more than its colour (1.4.1): the theme draws a line under the word (`top-nav-item`,
  // `selected`, D115), and the drawer paints it on a ground of its own. Either is a mark the other rows do not have.
  test("the current page's row in the header stands out, in both appearances and in the phone drawer (D46, D115)", async ({
    page,
    api: _,
  }) => {
    /** The ground a link is drawn on, and the line drawn under it, if any. */
    const drawn = (target: Locator) =>
      target.evaluate(element => {
        let ground = 'none';
        for (let node: Element | null = element; node; node = node.parentElement) {
          const colour = getComputedStyle(node).backgroundColor;
          if (colour !== 'rgba(0, 0, 0, 0)') {
            ground = node === element ? 'own ' + colour : colour;
            break;
          }
        }
        const style = getComputedStyle(element);
        const line =
          (style.boxShadow !== 'none' && /inset/.test(style.boxShadow)) ||
          (style.borderBottomStyle !== 'none' && parseFloat(style.borderBottomWidth) > 0) ||
          style.textDecorationLine.includes('underline');
        return { ground, line };
      });
    // The place Start (D88) is current on every page of Clew too; the page's own row is the one asked about.
    const selectedIn = (nav: Locator) => nav.locator('a[aria-current="page"]:not([href="/"])');
    const otherIn = (nav: Locator) => nav.locator('a:not([aria-current]):not([href="/"])').first();
    const standsOut = async (nav: Locator) => {
      const [current, other] = [await drawn(selectedIn(nav)), await drawn(otherIn(nav))];
      return (current.line && !other.line) || current.ground !== other.ground;
    };
    await page.setViewportSize(desktop);
    await open(page, '/calendar');
    const row = page.getByRole('banner').getByRole('navigation', { name: 'Start', exact: true });
    await expect(selectedIn(row)).toHaveText('Kalender');
    for (const appearance of ['light', 'dark'] as const) {
      if (appearance === 'dark') {
        await page.getByRole('button', { name: 'Testa Testsson, inställningar', exact: true }).click();
        await page.getByRole('radio', { name: 'Mörkt', exact: true }).check();
        await page.keyboard.press('Escape');
      }
      await expect.poll(() => standsOut(row)).toBe(true);
    }
    // The header's Meny comes with the resize, and `openNav` must run once: a second click lands on the open drawer's backdrop.
    await page.setViewportSize(narrow);
    await expect(page.getByRole('button', { name: 'Meny', exact: true })).toBeVisible();
    const drawer = await openNav(page);
    await expect(selectedIn(drawer)).toHaveText('Kalender');
    await expect.poll(() => standsOut(drawer)).toBe(true);
  });

  test('appearance changes the theme and survives navigation and reload', async ({ page, api: _ }) => {
    await page.goto('/');
    const profileButton = page.getByRole('button', { name: 'Testa Testsson, inställningar', exact: true });
    await expect(profileButton).toBeVisible();
    await expect(page.getByRole('main').getByRole('heading', { level: 1 }).first()).toBeVisible();
    const appearance = () =>
      page
        .getByRole('main')
        .getByRole('heading', { level: 1 })
        .first()
        .evaluate(element => ({
          mode: getComputedStyle(element).colorScheme,
          color: getComputedStyle(element).color,
        }));
    const light = await appearance();
    await profileButton.click();
    await page.getByRole('radio', { name: 'Mörkt', exact: true }).check();
    const dark = await appearance();
    expect(dark.mode).toBe('dark');
    expect(dark.color).not.toBe(light.color);
    if (profile === 'sundsvall') {
      expect(dark.color).toBe('rgb(255, 255, 255)');
      await expect(page.getByRole('img', { name: 'Sundsvalls kommun', exact: true })).toHaveAttribute(
        'src',
        expectedLogo!.darkSrc!,
      );
    }
    await page.keyboard.press('Escape');
    await page.getByRole('link', { name: 'Kalender', exact: true }).click();
    await expect(page).toHaveURL('/calendar');
    // Navigation can detach the previous heading between lookup and style measurement.
    await expect.poll(async () => (await appearance()).mode).toBe(dark.mode);
    await page.reload();
    await expect(profileButton).toBeVisible();
    await expect.poll(async () => (await appearance()).mode).toBe(dark.mode);
    await profileButton.click();
    await page.getByRole('radio', { name: 'Ljust', exact: true }).check();
    // The default follows the computer, so it has both schemes open; Ljust fixes one, with the same colour.
    expect(light.mode).toBe('light dark');
    expect(await appearance()).toEqual({ ...light, mode: 'light' });
  });
});
