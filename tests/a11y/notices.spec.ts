import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { NEXT_WEEK, assistantStatus } from './data';
import { appraisals } from './protocol-preview-data';
import { FAILED, SITE, desktop, expect, expectNoAxeViolations, open, test } from './support';

/*
 * The notices a page draws when something it asked for was refused or is not there (WA-M5): the sign-in page's
 * reasons, the manifest preview's failed dry run, Hem's Banner for a model that is configured but not answering (D8),
 * a move of a proposal the server refuses, a save Utseende cannot make, and an address Clew has no page for. Each
 * answer is what the server sends; each notice passes axe where it stands, and its one move is reached by keyboard.
 */

const main = (page: Page) => page.getByRole('main');
const sundsvall = readFileSync(resolve(import.meta.dirname, '../../themes/sundsvall/theme.tokens.json'));
/** Astryx's FileInput names both its button and the native input it opens; a test fills the input. */
const upload = (page: Page, label: string | RegExp, name: string, mimeType: string, buffer: Buffer) =>
  page
    .getByLabel(label, { exact: true })
    .and(page.locator('input[type="file"]'))
    .setInputFiles({ name, mimeType, buffer });

test.describe('a notice says what happened where it happened', () => {
  test.use({ viewport: desktop });

  for (const [reason, text] of [
    ['expired', 'Din inloggning har gått ut.'],
    ['denied', `Kontot saknar behörighet till ${SITE}.`],
    ['unavailable', 'Inloggningstjänsten går inte att nå just nu.'],
    ['invalid', 'Inloggningen kunde inte slutföras. Försök igen.'],
  ] as const)
    test(`the sign-in page says why it is shown: ${reason}`, async ({ page, api }) => {
      api.signedIn = false;
      await open(page, `/login?reason=${reason}`);
      // A status of the page's own, said as the page loads; the button's own empty status region is Astryx's.
      await expect(main(page).getByRole('status').filter({ hasText: text })).toHaveText(text);
      await expect(main(page).getByRole('heading', { level: 1 })).toHaveCount(1);
      await expectNoAxeViolations(page);
    });

  test('a dry run the server refuses says why, in English, with Try again in the notice itself', async ({
    page,
    api: _,
  }) => {
    // The route's own refusal of a body over the loader's limit (`routes/protocol.ts`).
    let refuse = true;
    await page.route(
      url => url.pathname === '/api/protocol/manifest',
      route =>
        refuse && route.request().method() === 'POST'
          ? route.fulfill({ status: 413, json: { error: 'The manifest is larger than 500 kB.' } })
          : route.fallback(),
    );
    await open(page, '/protocol/preview');
    await page.getByRole('textbox', { name: 'Manifest', exact: true }).fill(JSON.stringify(appraisals, null, 2));
    await page.getByRole('button', { name: 'Run the dry run' }).click();
    await expect(main(page).getByText('The manifest is larger than 500 kB.')).toBeVisible();
    // The notice speaks the page's language: no toggle in another language stands between it and its one move.
    await expect(main(page).getByRole('button', { name: 'Expandera' })).toHaveCount(0);
    await expectNoAxeViolations(page);
    refuse = false;
    const again = main(page).getByRole('button', { name: 'Try again', exact: true });
    await again.focus();
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('status').filter({ hasText: 'Clew would load it: 3 capabilities, 2 about a person or a unit.' }),
    ).toBeVisible();
    await expect(main(page).getByText('The manifest is larger than 500 kB.')).toHaveCount(0);
  });

  test('Hem says when the model is configured but not answering, and asks again on Försök igen', async ({
    page,
    api: _,
  }) => {
    let available = false;
    await page.route(
      url => url.pathname === '/api/assistant/status',
      route => route.fulfill({ json: { ...assistantStatus(1), available } }),
    );
    await open(page, '/');
    const banner = page.getByText('Modellen svarar inte just nu.');
    await expect(banner).toBeVisible();
    await expect(
      page.getByText('Knapparna, ärendena, pushen och kalendern fungerar som vanligt.', { exact: false }),
    ).toBeVisible();
    await expectNoAxeViolations(page);
    available = true;
    const again = page.getByRole('button', { name: 'Försök igen', exact: true });
    await again.focus();
    await expect(again).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(banner).toHaveCount(0);
  });

  test('a proposal moved on the grid that the server refuses goes back, and the page says why', async ({
    page,
    api: _,
  }) => {
    // The calendar's own refusal of a move whose proposal changed meanwhile (`modules/calendar/usecases/events.ts`).
    const REFUSED = 'Förslaget har ändrats. Läs om sidan.';
    await page.route(
      url => /^\/api\/threads\/[^/]+\/proposals\/[^/]+\/move$/.test(url.pathname),
      route => route.fulfill({ status: 400, json: { error: REFUSED } }),
    );
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, `/calendar?date=${NEXT_WEEK}`);
    const block = page.locator('.clew-cal-event-proposal').first();
    await block.scrollIntoViewIfNeeded();
    const before = (await block.boundingBox())!;
    // The block says its time; the alert drawn above the grid moves the page, so the time is what is compared.
    const time = await block.innerText();
    await page.mouse.move(before.x + before.width / 2, before.y + 6);
    await page.mouse.down();
    await page.mouse.move(before.x + before.width / 2, before.y + 6 + 96, { steps: 8 });
    await page.mouse.up();
    await expect(main(page).getByRole('alert').filter({ hasText: REFUSED })).toBeVisible();
    await expect.poll(() => block.innerText()).toBe(time);
    await expectNoAxeViolations(page);
  });

  test('Utseende says when a theme or a logo cannot be saved, and keeps what was chosen', async ({ page, api }) => {
    api.admin = true;
    // A save that fails on the server's side (`failure` in `context.ts`), and a logo refused to a person whose
    // `admin.appearance` was taken away meanwhile (the routes' 403 with `code: 'denied'`).
    await page.route(
      url => url.pathname === '/api/admin/appearance/theme',
      route =>
        route.request().method() === 'PUT' ? route.fulfill({ status: 503, json: { error: FAILED } }) : route.fallback(),
    );
    await page.route(
      url => url.pathname === '/api/admin/appearance/logo',
      route =>
        route.request().method() === 'PUT'
          ? route.fulfill({ status: 403, json: { error: 'Du saknar behörighet för åtgärden.', code: 'denied' } })
          : route.fallback(),
    );
    await open(page, '/admin/appearance');
    await upload(page, 'Temafil', 'tema.tokens.json', 'application/json', sundsvall);
    await expect(page.getByRole('heading', { level: 3, name: 'Ljust läge' })).toBeVisible();
    await page.getByRole('button', { name: 'Använd temat' }).click();
    await expect(main(page).getByText(FAILED, { exact: true }).first()).toBeVisible();
    // Nothing was saved: the preview stands, and the page is still Neutral.
    await expect(page.getByRole('heading', { level: 3, name: 'Ljust läge' })).toBeVisible();
    await expect(page.getByText('Nuvarande tema: Neutral, Clews standardtema.')).toBeVisible();
    await expectNoAxeViolations(page);

    await upload(
      page,
      /^Logotyp(?! för)/,
      'kommun.svg',
      'image/svg+xml',
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><rect width="24" height="24" fill="#005595"/></svg>',
      ),
    );
    await page.getByRole('textbox', { name: 'Logotypens namn' }).fill('Kommunen');
    await page.getByRole('button', { name: 'Spara logotypen' }).click();
    await expect(main(page).getByText('Du saknar behörighet för åtgärden.', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Ingen logotyp är vald.')).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test('an address Clew has no page for draws Hem, whole, under its own heading', async ({ page, api: _ }) => {
    await open(page, '/finns-inte/alls');
    await expect(page).toHaveURL('/finns-inte/alls');
    await expect(main(page).getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(
      page.getByRole('navigation', { name: 'Mina sidor', exact: true }).getByRole('link', { name: 'Start' }),
    ).toHaveAttribute('aria-current', 'page');
    await expectNoAxeViolations(page);
  });
});
