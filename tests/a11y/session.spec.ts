import type { Page, Route } from '@playwright/test';
import {
  announcements,
  expect,
  expectNoAxeViolations,
  hemLine,
  narrow,
  open,
  reflowProblems,
  snoozeFirst,
  test,
} from './support';

/**
 * The session in the browser (D46; the web review of 2026-11-23, M1 to M3, L2, L4 and L9). Only the server's explicit
 * denial ends a session: Startsidan out of reach (a 5xx while it restarts, no answer at all) is said, and asked again,
 * while the page and what the person has typed stay. A link followed signed out keeps its whole address through
 * sign-in, and the end of a session takes its toasts, its tab title and what its conversations showed.
 */
const UNREACHABLE = 'Startsidan går inte att nå just nu. Försöker igen om en stund.';
const REACHED = 'Startsidan går att nå igen.';
const outages: Record<string, (route: Route) => Promise<void>> = {
  'a 503': route => route.fulfill({ status: 503, body: '' }),
  'no answer': route => route.abort('failed'),
};
/** The session's read fails as `fail` does while `down` holds, and is the mock's own answer again after. */
async function outage(page: Page, fail: (route: Route) => Promise<void>) {
  const clew = { down: true };
  await page.route('**/api/auth/session', route => (clew.down ? fail(route) : route.fallback()));
  return clew;
}
const notices = (page: Page) => page.getByRole('region', { name: 'Aviseringar' });

for (const [name, fail] of Object.entries(outages))
  test(`${name} to the session's check keeps the page and what is typed, says so, and says when Startsidan answers again`, async ({
    page,
    api: _,
  }) => {
    // At 320 px, where a toast has the least room (1.4.10).
    await page.setViewportSize(narrow);
    await open(page, '/');
    await hemLine(page).fill('Vilka är på plats?');
    const clew = await outage(page, fail);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(notices(page).getByText(UNREACHABLE)).toBeVisible();
    await expect.poll(() => announcements(page)).toContainEqual(expect.stringContaining(UNREACHABLE));
    // Not a sign-out: the page stays shown, with the question and the focus where they were.
    await expect(hemLine(page)).toHaveValue('Vilka är på plats?');
    await expect(hemLine(page)).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.style.opacity)).toBe('');
    await expect(page.getByRole('link', { name: 'Logga in igen' })).toHaveCount(0);
    await expectNoAxeViolations(page);
    expect(await reflowProblems(page)).toEqual([]);
    // Asked again by itself, after a wait that grows: once Startsidan answers, the notice goes and that is said.
    clew.down = false;
    await expect(notices(page).getByText(UNREACHABLE)).toHaveCount(0, { timeout: 15_000 });
    await expect.poll(() => announcements(page)).toContainEqual(REACHED);
    await expect(hemLine(page)).toHaveValue('Vilka är på plats?');
  });

test('a first load that finds Startsidan out of reach says so in the page’s place, asks again by keyboard, and never shows the sign-in', async ({
  page,
  api: _,
}) => {
  const clew = await outage(page, outages['a 503']!);
  await page.goto('/todo?tab=waiting');
  const main = page.getByRole('main');
  await expect(main.getByText(UNREACHABLE)).toBeVisible();
  await expect(main.getByRole('heading', { level: 1 })).toBeVisible();
  await expect.poll(() => announcements(page)).toContainEqual(expect.stringContaining(UNREACHABLE));
  await expect(page.getByRole('link', { name: 'Logga in', exact: true })).toHaveCount(0);
  await expectNoAxeViolations(page);
  await page.setViewportSize(narrow);
  expect(await reflowProblems(page)).toEqual([]);
  // The one move is the first stop of the keyboard; pressed while Startsidan is still away, the page stays as it is.
  const retry = main.getByRole('button', { name: 'Försök igen' });
  await page.keyboard.press('Tab');
  await expect(retry).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(main.getByText(UNREACHABLE)).toBeVisible();
  await expect(retry).toBeFocused();
  clew.down = false;
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'Att göra' })).toBeVisible();
  await expect(page).toHaveURL('/todo?tab=waiting');
});

test('a change stream whose reconnect is answered with an error is opened again, and its notices arrive', async ({
  page,
  api,
}) => {
  let streams = 0;
  await page.route('**/api/changes', route => {
    streams++;
    // The first connection meets a restart: a 503 closes an EventSource for good.
    return streams === 1 ? route.fulfill({ status: 503, body: '' }) : route.fallback();
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, '/todo');
  await expect.poll(() => streams, { timeout: 10_000 }).toBe(2);
  const card = api.threads.find(t => t.id === 'ledighet')!;
  card.title = card.title + ' (ändrad)';
  card.updatedAt = new Date(Date.parse(card.updatedAt) + 60_000).toISOString();
  await api.changed();
  await expect(page.getByText(card.title, { exact: true }).first()).toBeAttached();
});

test('a link opened signed out keeps its whole address through sign-in', async ({ page, api }) => {
  api.signedIn = false;
  const address = '/todo?item=ledighet&tab=waiting';
  await page.goto(address);
  await expect(page.getByRole('link', { name: 'Logga in', exact: true })).toHaveAttribute(
    'href',
    '/api/auth/login?returnTo=' + encodeURIComponent(address),
  );
  await expect(page).toHaveTitle(/^Logga in/);
});

test('the end of a session takes its toasts, its title and what its conversations showed; Logga in igen returns to the address', async ({
  page,
  api,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, '/todo');
  await snoozeFirst(page);
  await expect(notices(page).getByRole('button', { name: 'Ångra' })).toBeVisible();
  // The toast has finished coming in: a toast dismissed in its first moments is Astryx's own case, not the session's.
  await page.waitForFunction(() => document.getAnimations().every(a => a.playState !== 'running'));
  await page.evaluate(() => {
    sessionStorage.setItem('clew:conversation-shown:c1', JSON.stringify({ items: ['ledighet'], views: [] }));
    sessionStorage.setItem('elsewhere', 'kept');
  });
  const here = new URL(page.url());
  api.signedIn = false;
  await page.evaluate(() => window.dispatchEvent(new Event('clew-session-ended')));
  const again = page.getByRole('link', { name: 'Logga in igen' });
  await expect(again).toHaveAttribute(
    'href',
    '/api/auth/login?returnTo=' + encodeURIComponent(here.pathname + here.search),
  );
  await expect.poll(() => announcements(page)).toContainEqual(expect.stringContaining('Din inloggning har avslutats'));
  await expect(page.getByRole('button', { name: 'Ångra' })).toHaveCount(0);
  await expect(page).toHaveTitle('Inloggningen har avslutats · Startsidan');
  expect(
    await page.evaluate(() => [
      sessionStorage.getItem('clew:conversation-shown:c1'),
      sessionStorage.getItem('elsewhere'),
    ]),
  ).toEqual([null, 'kept']);
  await again.focus();
  await expect(again).toBeFocused();
  await expectNoAxeViolations(page);
  await page.setViewportSize(narrow);
  expect(await reflowProblems(page)).toEqual([]);
});

test('the first load asks for the session once', async ({ page, api: _ }) => {
  const asked: string[] = [];
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (path === '/api/auth/session') asked.push(path);
  });
  await open(page, '/');
  await expect(hemLine(page)).toBeVisible();
  expect(asked).toHaveLength(1);
});
