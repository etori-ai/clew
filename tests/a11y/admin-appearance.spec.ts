import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import {
  announcements,
  desktop,
  expect,
  expectNoAxeViolations,
  hiddenFocusStops,
  narrow,
  open,
  phone,
  reflowProblems,
  test,
} from './support';
import { savedBranding } from './branding-fixtures';

/**
 * Utseende (D97): the installation's theme and logo, chosen by an administrator. A theme file is read and checked in the
 * page, shown in both appearances and saved, and the whole app is redrawn at once; a file that does not hold names every
 * problem and saves nothing; a logo is uploaded with the name a screen reader reads. Keyboard, structure, announcements,
 * axe and reflow, at desktop, phone and 320 px.
 */
const sundsvall = readFileSync(resolve(import.meta.dirname, '../../themes/sundsvall/theme.tokens.json'));
// Astryx's FileInput names both its button and the native input it opens; a test fills the input.
const upload = (page: Page, label: string | RegExp, name: string, mimeType: string, buffer: Buffer) =>
  page
    .getByLabel(label, { exact: true })
    .and(page.locator('input[type="file"]'))
    .setInputFiles({ name, mimeType, buffer });
const themeFile = (page: Page, buffer: Buffer) =>
  upload(page, 'Temafil', 'tema.tokens.json', 'application/json', buffer);
const accent = (page: Page) =>
  page.getByRole('main').evaluate(element => getComputedStyle(element).getPropertyValue('--color-accent'));
// The field's label carries its required mark; the dark variant's label begins with the same word.
const logoField = /^Logotyp(?! för)/;
const svg = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><rect width="24" height="24" fill="#005595"/></svg>',
);

test.describe('appearance administration', () => {
  for (const [layout, viewport] of [
    ['desktop', desktop],
    ['phone', phone],
  ] as const)
    test.describe(layout, () => {
      test.use({ viewport });
      test('the page has no axe violations and every focus stop is marked, with a preview open too', async ({
        page,
        api,
      }) => {
        api.admin = true;
        await open(page, '/admin/appearance');
        await expect(page.getByRole('heading', { level: 1, name: 'Utseende' })).toBeVisible();
        await expectNoAxeViolations(page);
        await themeFile(page, sundsvall);
        // The preview is drawn in the candidate's own colours, in both appearances: axe checks their contrast as drawn.
        await expect(page.getByRole('heading', { level: 3, name: 'Mörkt läge' })).toBeVisible();
        // The field answers the file with a status that fades in (165 ms): its contrast is what it settles at.
        await expect(page.getByText('Temat håller: Sundsvalls kommun, 50 färger.', { exact: true })).toBeVisible();
        await page.evaluate(() =>
          Promise.all(
            document
              .getAnimations()
              .filter(a => a.effect?.getComputedTiming().iterations !== Infinity)
              .map(a => a.finished.catch(() => undefined)),
          ),
        );
        await expectNoAxeViolations(page);
        const { unmarked } = await hiddenFocusStops(page);
        expect(unmarked).toEqual([]);
      });
    });

  test.describe('desktop', () => {
    test.use({ viewport: desktop });

    test('a theme file is previewed, saved, and the whole app is redrawn without a reload', async ({ page, api }) => {
      api.admin = true;
      await open(page, '/admin/appearance');
      await expect(page).toHaveTitle('Utseende · Startsidan');
      await expect(page.getByRole('link', { name: 'Utseende', exact: true })).toHaveAttribute('aria-current', 'page');
      await expect(page.getByText('Nuvarande tema: Neutral, Clews standardtema.')).toBeVisible();
      const use = page.getByRole('button', { name: 'Använd temat' });
      // Nothing to save yet: the button says so and stays a focus stop (aria-disabled, not removed).
      await expect(use).toHaveAttribute('aria-disabled', 'true');
      expect(await accent(page)).toContain('#1b1b1b');

      await themeFile(page, sundsvall);
      await expect(page.getByRole('heading', { level: 3, name: 'Ljust läge' })).toBeVisible();
      await expect(page.getByRole('heading', { level: 3, name: 'Mörkt läge' })).toBeVisible();
      await expect.poll(() => announcements(page)).toContainEqual(expect.stringContaining('Temat håller'));
      // A preview is not a save: the page itself is still Neutral.
      expect(await accent(page)).toContain('#1b1b1b');

      await use.click();
      await expect.poll(() => announcements(page)).toContainEqual(expect.stringContaining('Temat är sparat'));
      await expect(page.getByText(/Nuvarande tema: Sundsvalls kommun, \d+ färger\./)).toBeVisible();
      await expect.poll(() => accent(page)).toContain('#005595');
      await expect(page.getByText(/Senast ändrat av Mikael Lund/)).toBeVisible();
      await expect(page.getByRole('heading', { level: 3, name: 'Ljust läge' })).toHaveCount(0);
      // The saved theme is every page's, and the next visit starts in it.
      await page.getByRole('link', { name: 'Kalender', exact: true }).click();
      await expect(page).toHaveURL('/calendar');
      expect(await accent(page)).toContain('#005595');
      await page.reload();
      await expect.poll(() => accent(page)).toContain('#005595');
    });

    test('a file that does not hold names every problem, is announced, and cannot be saved', async ({ page, api }) => {
      api.admin = true;
      await open(page, '/admin/appearance');
      await themeFile(
        page,
        Buffer.from(
          JSON.stringify({
            light: { color: { $type: 'color', error: { $value: '#ff0000' }, accent: { $value: '#7fb2d9' } } },
            dark: { color: { $type: 'color' } },
          }),
        ),
      );
      const problems = page.getByRole('list', { name: 'Fel i temat' });
      await expect(problems.getByRole('listitem')).toHaveCount(2);
      await expect(problems).toContainText('error är inte en färg som ett tema kan sätta.');
      await expect(problems).toContainText('accent saknas i mörkt läge.');
      await expect
        .poll(() => announcements(page))
        .toContainEqual(expect.stringContaining('Temat kan inte användas. 2 fel hittades.'));
      await expect(page.getByRole('button', { name: 'Använd temat' })).toHaveAttribute('aria-disabled', 'true');
      await expect(page.getByRole('heading', { level: 3, name: 'Ljust läge' })).toHaveCount(0);
      await expectNoAxeViolations(page);

      await themeFile(page, Buffer.from('{ not json'));
      await expect(problems).toContainText('Filen är inte giltig JSON.');
      expect(api.appearance.theme).toBeNull();
    });

    test('two colours make a theme by keyboard, and Neutral comes back with one button', async ({ page, api }) => {
      api.admin = true;
      await open(page, '/admin/appearance');
      await page.getByRole('radio', { name: 'Två färger' }).check();
      const preview = page.getByRole('button', { name: 'Förhandsvisa' });
      await expect(preview).toHaveAttribute('aria-disabled', 'true');
      await page.getByRole('textbox', { name: 'Stark färg' }).fill('blå');
      await expect(page.getByRole('main').getByText('Skriv färgen som sex hexadecimala siffror')).toBeVisible();
      await page.getByRole('textbox', { name: 'Stark färg' }).fill('#5b1f78');
      await page.getByRole('textbox', { name: 'Ljus färg' }).fill('#d7dbf2');
      await preview.focus();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('heading', { level: 3, name: 'Ljust läge' })).toBeVisible();
      await page.getByRole('button', { name: 'Använd temat' }).focus();
      await page.keyboard.press('Enter');
      await expect.poll(() => accent(page)).toContain('#5b1f78');
      await expect(page.getByText('Nuvarande tema: Egna färger, 9 färger.')).toBeVisible();
      expect(api.appearance.theme?.colors.accent).toEqual(['#5b1f78', '#d7dbf2']);

      await page.getByRole('button', { name: 'Återställ till Neutral' }).click();
      await expect.poll(() => announcements(page)).toContainEqual(expect.stringContaining('återställt till Neutral'));
      await expect.poll(() => accent(page)).toContain('#1b1b1b');
      await expect(page.getByRole('button', { name: 'Återställ till Neutral' })).toHaveCount(0);
    });

    test('the theme file is there to fetch: a template before anything is saved, the saved theme after', async ({
      page,
      api,
    }) => {
      api.admin = true;
      await open(page, '/admin/appearance');
      // A plain link to Clew's own route, not a client-side navigation.
      await expect(page.getByRole('link', { name: 'Hämta mall för temafil' })).toHaveAttribute(
        'href',
        '/api/appearance/theme-file',
      );
      Object.assign(api, savedBranding('custom'));
      await page.reload();
      await expect(page.getByRole('link', { name: 'Hämta nuvarande temafil' })).toBeVisible();
    });

    test('a logo is saved with the name a screen reader reads, shown in the header, and removed again', async ({
      page,
      api,
    }) => {
      api.admin = true;
      await open(page, '/admin/appearance');
      // The logo stands in the band's heading; the person's avatar further along the bar is an image of its own.
      const header = page.getByRole('banner').locator('.astryx-top-nav-heading').first();
      await expect(page.getByText('Ingen logotyp är vald.')).toBeVisible();
      await expect(header.getByRole('img')).toHaveCount(0);
      const save = page.getByRole('button', { name: 'Spara logotypen' });
      await expect(save).toHaveAttribute('aria-disabled', 'true');

      await upload(page, logoField, 'kommun.gif', 'image/gif', Buffer.from('GIF89a'));
      // The field itself refuses a type it does not accept, by name, and nothing is chosen.
      await expect(page.getByRole('main').getByText('”kommun.gif” är inte en tillåten filtyp')).toBeVisible();
      await upload(page, logoField, 'kommun.svg', 'image/svg+xml', svg);
      await expect(page.getByRole('main').getByText('är inte en tillåten filtyp')).toHaveCount(0);
      // An image alone is not enough: the logo needs its name.
      await expect(save).toHaveAttribute('aria-disabled', 'true');
      await page.getByRole('textbox', { name: 'Logotypens namn' }).fill('Exempelkommunen');
      await save.click();
      await expect.poll(() => announcements(page)).toContainEqual(expect.stringContaining('Logotypen är sparad'));
      const logo = header.getByRole('img', { name: 'Exempelkommunen', exact: true });
      await expect(logo).toBeVisible();
      await expect(logo).toHaveAttribute('src', '/api/appearance/logo/light?v=1');
      await expect(logo).toHaveJSProperty('complete', true);
      await expect(page.getByText('Nuvarande logotyp: Exempelkommunen.')).toBeVisible();
      await expectNoAxeViolations(page);

      await page.getByRole('button', { name: 'Ta bort logotypen' }).click();
      await expect.poll(() => announcements(page)).toContainEqual(expect.stringContaining('Logotypen är borttagen'));
      await expect(header.getByRole('img')).toHaveCount(0);
      await expect(page.getByRole('textbox', { name: 'Logotypens namn' })).toHaveValue('');
    });

    test('without admin.appearance the server says no and the page says so', async ({ page, api }) => {
      api.admin = true;
      api.appearanceForbidden = true;
      await open(page, '/admin/appearance');
      await expect(page.getByRole('alert').filter({ hasText: 'behörighet' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Använd temat' })).toHaveCount(0);
    });

    test('the sign-in page is drawn in the saved theme, before anyone has signed in', async ({ page, api }) => {
      Object.assign(api, savedBranding('custom'));
      api.signedIn = false;
      await page.goto('/login');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      expect(await page.evaluate(() => getComputedStyle(document.body).getPropertyValue('--color-accent'))).toContain(
        '#5b1f78',
      );
    });
  });

  test.describe('1.4.10 reflow', () => {
    test('the page reflows at 320 px, with a preview and a refusal open', async ({ page, api }) => {
      api.admin = true;
      await page.setViewportSize(narrow);
      await open(page, '/admin/appearance');
      await themeFile(page, sundsvall);
      await expect(page.getByRole('heading', { level: 3, name: 'Mörkt läge' })).toBeVisible();
      expect(await reflowProblems(page)).toEqual([]);
      await themeFile(page, Buffer.from('{}'));
      await expect(page.getByRole('list', { name: 'Fel i temat' })).toBeVisible();
      expect(await reflowProblems(page)).toEqual([]);
    });
  });
});
