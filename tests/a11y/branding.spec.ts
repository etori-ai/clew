import { desktop, expect, narrow, openNav, reflowProblems, test } from './support';
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
      expect(await reflowProblems(page)).toEqual([]);
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
    await page.getByRole('menuitem', { name: 'Inställningar', exact: true }).click();
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
    expect((await appearance()).mode).toBe(dark.mode);
    await page.reload();
    await expect(profileButton).toBeVisible();
    expect((await appearance()).mode).toBe(dark.mode);
    await profileButton.click();
    await page.getByRole('menuitem', { name: 'Inställningar', exact: true }).click();
    await page.getByRole('radio', { name: 'Ljust', exact: true }).check();
    expect(await appearance()).toEqual(light);
  });
});
