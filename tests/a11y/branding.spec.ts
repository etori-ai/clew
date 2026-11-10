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

test.describe(`D97 installation logo and theme (${profile})`, () => {
  // The theme and the logo are what the installation has saved, so they are the API's answer (D97).
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
          // The phone's bar has no band (`shell.tsx`), so there the logo follows the appearance, light here.
          await expect(logo).toHaveAttribute(
            'src',
            viewport === narrow ? expectedLogo.src : (expectedLogo.darkSrc ?? expectedLogo.src),
          );
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

  // With the shared header above (D88) Astryx paints the rail and the page on one surface and parts them with a divider,
  // so the rail's own area is the divider's, not a colour's; the selected row still stands out from its rail.
  test("the rail's selected row stands out, in both appearances and in the phone drawer (D46, D88)", async ({
    page,
    api: _,
  }) => {
    test.skip(
      profile === 'sundsvall',
      'Sundsvall paints body white, so its rail has the page colour; D46 says what to change before switching back.',
    );
    const painted = (target: Locator) =>
      target.evaluate(element => {
        for (let node: Element | null = element; node; node = node.parentElement) {
          const colour = getComputedStyle(node).backgroundColor;
          if (colour !== 'rgba(0, 0, 0, 0)') return colour;
        }
        return 'none';
      });
    // The header's Start row (D88) is current on every page too; the rail's own current row is the page's.
    const selectedIn = (nav: Locator) => nav.locator('a[aria-current="page"]:not([href="/"])');
    const standsOut = async (nav: Locator) =>
      (await painted(selectedIn(nav))) !== (await painted(selectedIn(nav).locator('xpath=..')));
    const rail = page.locator('.astryx-app-shell-sidenav');
    const colours = async () => ({
      page: await painted(page.getByRole('main')),
      rail: await painted(rail),
      selected: await painted(selectedIn(rail)),
    });
    await page.setViewportSize(desktop);
    await open(page, '/calendar');
    for (const appearance of ['light', 'dark'] as const) {
      if (appearance === 'dark') {
        await page.getByRole('button', { name: 'Testa Testsson, inställningar', exact: true }).click();
        await page.getByRole('radio', { name: 'Mörkt', exact: true }).check();
        await page.keyboard.press('Escape');
      }
      await expect
        .poll(async () => {
          const now = await colours();
          return now.selected !== now.rail;
        })
        .toBe(true);
    }
    // The toggle comes a moment after the resize, and `openNav` must run once: a second click lands on the open drawer's backdrop.
    await page.setViewportSize(narrow);
    await expect(page.getByRole('button', { name: 'Öppna navigering' })).toBeVisible();
    const drawer = await openNav(page);
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
