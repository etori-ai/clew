import type { Page } from '@playwright/test';
import { FAILED, announcements, composer, desktop, expect, expectNoAxeViolations, open, test } from './support';

/*
 * A conversation that cannot be opened, and a question that cannot be asked (WA-M5): the server answers 503 "Något gick
 * fel. Försök igen." (`failure` in `apps/server/src/context.ts`), before any of the turn is streamed. The page says so
 * at the box, as the box's own status, which Astryx speaks in its live region (4.1.3, 3.3.1); a question that was not
 * asked stays in the box with the focus, so it can be sent again (`conversation-context.tsx`).
 */

/** The box's own words, not their copy in Astryx's live region, which holds them for a while. */
const said = (page: Page, text: string) =>
  page.getByRole('main').getByText(text, { exact: true }).and(page.locator(':not([aria-live])'));

test.describe('a conversation that fails says so at its box', () => {
  test.use({ viewport: desktop });

  test('a conversation that cannot be opened', async ({ page, api: _ }) => {
    await page.route(
      url => url.pathname === '/api/threads/fraga',
      route =>
        route.request().method() === 'GET' ? route.fulfill({ status: 503, json: { error: FAILED } }) : route.fallback(),
    );
    await open(page, '/conversations/fraga');
    await expect(said(page, FAILED)).toBeVisible();
    await expect.poll(() => announcements(page)).toContainEqual(expect.stringContaining(FAILED));
    // The page stops saying it is reading the conversation once the read has failed.
    await expect(page.getByRole('status').filter({ hasText: 'Hämtar samtalet …' })).toHaveCount(0);
    await expect(composer(page)).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test('a question that cannot be asked stays in the box, with the focus', async ({ page, api: _ }) => {
    await page.route(
      url => url.pathname === '/api/conversation/stream',
      route => route.fulfill({ status: 503, json: { error: FAILED } }),
    );
    await open(page, '/conversations/new');
    const box = composer(page);
    await box.fill('Vad väntar på mig i dag?');
    await box.press('Enter');
    await expect(said(page, FAILED)).toBeVisible();
    await expect.poll(() => announcements(page)).toContainEqual(expect.stringContaining(FAILED));
    await expect(box).toHaveText('Vad väntar på mig i dag?');
    await expect(box).toBeFocused();
    await expectNoAxeViolations(page);
  });
});
