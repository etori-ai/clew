import type { Locator } from '@playwright/test';
import { desktop, expect, narrow, open, openNav, pagesNav, personButton, reflowProblems, test } from './support';
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
      test(`the ${name} band identifies the organisation and links home at ${viewport.width}px`, async ({
        page,
        api,
      }) => {
        api.admin = true;
        await page.setViewportSize(viewport);
        await page.goto(path);
        // By level, not by tag: the calendar's month on a phone is an h3 that says level 1.
        await expect(page.getByRole('main').locator('h1:not([aria-level]), [aria-level="1"]')).toBeVisible();
        await page.evaluate(() => document.fonts.ready.then(() => undefined));
        // The logo and the name are the band's heading (D98, D130), on every width; with a header connector the band
        // draws the connector's own (`header.spec.ts`).
        const heading = page.getByRole('banner');
        const home = heading.getByRole('link', { name: /Startsidan/ });
        await expect(home).toBeVisible();
        await expect(home).toHaveAccessibleName(/Startsidan/);
        // The page's own tokens, read on the page.
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
          // These fixtures have a dark band in both appearances.
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
          await expect(home.getByRole('img')).toHaveCount(0);
        }
        await expect(home).toHaveAttribute('href', '/');
        expect(await reflowProblems(page, home)).toEqual([]);
        await home.focus();
        await expect(home).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL('/');
      });
    }

  for (const savedProfile of ['sundsvall', 'custom'] as const)
    test(`a pale band uses the light-ground ${savedProfile} logo in both appearances`, async ({ page, api }) => {
      const saved = savedBranding(savedProfile);
      const theme = saved.appearance.theme!;
      const logo = saved.appearance.logo!;
      Object.assign(api, saved);
      api.appearance = {
        ...saved.appearance,
        theme: { ...theme, colors: { ...theme.colors, 'background-inverted': ['#ffffff', '#000000'] } },
      };
      await open(page, '/');
      const image = page.getByRole('banner').getByRole('img', { name: logo.alt });
      for (const mode of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme: mode });
        const heading = page.getByRole('main').getByRole('heading', { level: 1 }).first();
        await expect(heading).toHaveCSS('color', mode === 'light' ? 'rgb(0, 0, 0)' : 'rgb(255, 255, 255)');
        await expect(image).toHaveAttribute('src', logo.src);
        await expect(image).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      }
    });

  if (expectedLogo)
    test('a failed image request leaves a named, working home link', async ({ page, api: _ }) => {
      let failedRequests = 0;
      await page.route('**/api/appearance/logo/**', route => {
        failedRequests++;
        return route.abort();
      });
      await page.goto('/calendar');
      const heading = page.getByRole('banner');
      const home = heading.getByRole('link', { name: /Startsidan/ });
      await expect(home).toBeVisible();
      await expect.poll(() => failedRequests).toBeGreaterThan(0);
      await expect(heading.getByRole('img', { name: expectedLogo.alt, exact: true })).toHaveCount(0);
      await expect(home).toHaveAccessibleName(/^Startsidan/);
      await home.click();
      await expect(page).toHaveURL('/');
    });

  // The page that is open is marked among Clew's pages by more than a colour (1.4.1, D130 item 5): a line under the
  // word and a heavier weight in the row, a painted row in the phone's drawer.
  test('the open page stands out among the pages, in both appearances and in the phone drawer (D46, D88, D130)', async ({
    page,
    api: _,
  }) => {
    const painted = (target: Locator) =>
      target.evaluate(element => {
        for (let node: Element | null = element; node; node = node.parentElement) {
          const colour = getComputedStyle(node).backgroundColor;
          if (colour !== 'rgba(0, 0, 0, 0)') return colour;
        }
        return 'none';
      });
    const drawn = (link: Locator) =>
      link.evaluate(element => {
        const style = getComputedStyle(element);
        return { line: style.boxShadow, weight: Number(style.fontWeight) };
      });
    await page.setViewportSize(desktop);
    await open(page, '/calendar');
    const nav = pagesNav(page);
    const selected = nav.locator('a[aria-current="page"]');
    const other = nav.getByRole('link', { name: 'Samtal', exact: true });
    for (const appearance of ['light', 'dark'] as const) {
      if (appearance === 'dark') {
        await open(page, '/calendar?settings=1');
        await page.getByRole('radio', { name: 'Mörkt', exact: true }).check();
        await page.keyboard.press('Escape');
      }
      await expect(selected).toHaveText('Kalender');
      const [marked, rest] = [await drawn(selected), await drawn(other)];
      expect(marked.line).not.toBe('none');
      expect(rest.line).toBe('none');
      expect(marked.weight).toBeGreaterThan(rest.weight);
    }
    // In the drawer the open page is a painted row.
    await page.setViewportSize(narrow);
    await expect(page.getByRole('button', { name: 'Meny', exact: true })).toBeVisible();
    const drawer = await openNav(page);
    const row = drawer.locator('a[aria-current="page"]');
    await expect(row).toHaveText('Kalender');
    await expect.poll(async () => (await painted(row)) !== (await painted(row.locator('xpath=..')))).toBe(true);
  });

  test('appearance changes the theme and survives navigation and reload', async ({ page, api: _ }) => {
    await page.goto('/');
    // The person on the band opens their settings; they open from the address too (D126).
    const profileButton = personButton(page);
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
    await page.goto('/?settings=1');
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
    await pagesNav(page).getByRole('link', { name: 'Kalender', exact: true }).click();
    await expect(page).toHaveURL('/calendar');
    // Navigation can detach the previous heading between lookup and style measurement.
    await expect.poll(async () => (await appearance()).mode).toBe(dark.mode);
    await page.reload();
    await expect(profileButton).toBeVisible();
    await expect.poll(async () => (await appearance()).mode).toBe(dark.mode);
    await page.goto('/calendar?settings=1');
    await page.getByRole('radio', { name: 'Ljust', exact: true }).check();
    // The default follows the computer, so it has both schemes open; Ljust fixes one, with the same colour.
    expect(light.mode).toBe('light dark');
    expect(await appearance()).toEqual({ ...light, mode: 'light' });
  });
});
