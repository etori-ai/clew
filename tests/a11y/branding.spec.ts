import type { Locator } from '@playwright/test';
import { desktop, expect, narrow, open, openNav, reflowProblems, test } from './support';
import { a11yBrandProfile, brandingFixtures } from './branding-fixtures';

const surfaces = [['start', '/'], ['calendar', '/calendar'], ['administration', '/admin/connectors']] as const;
const profile = a11yBrandProfile(process.env.CLEW_A11Y_BRAND_PROFILE);
const fixture = brandingFixtures[profile];
const expectedLogo = fixture.expected.logo;

test.describe(`D37/D38 installation logo and theme (${profile})`, () => {
  test.beforeEach(async ({ page }) => {
    if (profile === 'custom') await page.route('**/branding/test-municipality.svg', route => route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><rect width="24" height="24" fill="#5b1f78"/><circle cx="12" cy="12" r="6" fill="white"/></svg>',
    }));
  });

  for (const viewport of [desktop, narrow]) for (const [name, path] of surfaces) {
    test(`the ${name} header identifies the organisation and links home at ${viewport.width}px`, async ({ page, api }) => {
      api.admin = true;
      await page.setViewportSize(viewport);
      await page.goto(path);
      await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toBeVisible();
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      const nav = await openNav(page);
      const heading = nav.locator('.astryx-side-nav-heading');
      const home = nav.getByRole('link', { name: /Startsidan/ });
      await expect(home).toBeVisible();
      await expect(home).toHaveAccessibleName(/Startsidan/);
      const brand = await home.evaluate(element => {
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
        await expect(logo).toHaveAttribute('src', expectedLogo.src);
        await expect(logo).toHaveJSProperty('complete', true);
        expect(await logo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
        if (profile === 'sundsvall') {
          const clearance = await logo.evaluate((img: HTMLImageElement) => {
            const style = getComputedStyle(img);
            return { padding: parseFloat(style.paddingTop), symbolWidth: parseFloat(style.height) * img.naturalWidth / img.naturalHeight };
          });
          expect(clearance.padding).toBeGreaterThanOrEqual(clearance.symbolWidth);
        }
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

  if (expectedLogo) test('a failed image request leaves a named, working home link', async ({ page, api: _ }) => {
    let failedRequests = 0;
    await page.route(`**${expectedLogo.src}`, route => { failedRequests++; return route.abort(); });
    await page.goto('/calendar');
    const nav = await openNav(page);
    const heading = nav.locator('.astryx-side-nav-heading');
    const home = nav.getByRole('link', { name: /Startsidan/ });
    await expect(home).toBeVisible();
    await expect.poll(() => failedRequests).toBeGreaterThan(0);
    await expect(heading.getByRole('img')).toHaveCount(0);
    await expect(home).toHaveAccessibleName(/^Startsidan/);
    await home.click();
    await expect(page).toHaveURL('/');
  });

  test('the rail reads as its own area and its selected row stands out, in both appearances and in the phone drawer (D46)', async ({ page, api: _ }) => {
    test.skip(profile === 'sundsvall', 'Sundsvall paints body white, so its rail has the page colour; D46 says what to change before switching back.');
    const painted = (target: Locator) => target.evaluate(element => {
      for (let node: Element | null = element; node; node = node.parentElement) {
        const colour = getComputedStyle(node).backgroundColor;
        if (colour !== 'rgba(0, 0, 0, 0)') return colour;
      }
      return 'none';
    });
    const selectedIn = (nav: Locator) => nav.locator('a[aria-current="page"]');
    const standsOut = async (nav: Locator) => await painted(selectedIn(nav)) !== await painted(selectedIn(nav).locator('xpath=..'));
    const rail = page.locator('.astryx-app-shell-sidenav');
    const colours = async () => ({ page: await painted(page.getByRole('main')), rail: await painted(rail), selected: await painted(selectedIn(rail)) });
    await page.setViewportSize(desktop);
    await open(page, '/calendar');
    for (const appearance of ['light', 'dark'] as const) {
      if (appearance === 'dark') {
        await page.getByRole('button', { name: 'Testa Testsson', exact: true }).click();
        await page.getByRole('button', { name: 'Inställningar', exact: true }).click();
        await page.getByRole('radio', { name: 'Mörkt', exact: true }).check();
        await page.keyboard.press('Escape');
      }
      await expect.poll(async () => { const now = await colours(); return now.rail !== now.page && now.selected !== now.rail; }).toBe(true);
    }
    // The toggle comes a moment after the resize, and `openNav` must run once: a second click lands on the open drawer's backdrop.
    await page.setViewportSize(narrow);
    await expect(page.getByRole('button', { name: 'Öppna navigering' })).toBeVisible();
    const drawer = await openNav(page);
    await expect.poll(() => standsOut(drawer)).toBe(true);
  });

  test('appearance changes the theme and survives navigation and reload', async ({ page, api: _ }) => {
    await page.goto('/');
    const profileButton = page.getByRole('button', { name: 'Testa Testsson', exact: true });
    await expect(profileButton).toBeVisible();
    await expect(page.getByRole('main').getByRole('heading', { level: 1 }).first()).toBeVisible();
    const appearance = () => page.getByRole('main').getByRole('heading', { level: 1 }).first().evaluate(element => ({
      mode: getComputedStyle(element).colorScheme, color: getComputedStyle(element).color,
    }));
    const light = await appearance();
    await profileButton.click();
    await page.getByRole('button', { name: 'Inställningar', exact: true }).click();
    await page.getByRole('radio', { name: 'Mörkt', exact: true }).check();
    const dark = await appearance();
    expect(dark.mode).toBe('dark');
    expect(dark.color).not.toBe(light.color);
    if (profile === 'sundsvall') {
      expect(dark.color).toBe('rgb(255, 255, 255)');
      await expect(page.getByRole('img', { name: 'Sundsvalls kommun', exact: true })).toHaveAttribute('src', expectedLogo!.darkSrc!);
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
    await page.getByRole('button', { name: 'Inställningar', exact: true }).click();
    await page.getByRole('radio', { name: 'Ljust', exact: true }).check();
    expect(await appearance()).toEqual(light);
  });
});
