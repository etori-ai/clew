import type { Locator, Page, Route } from '@playwright/test';
import { NOW } from './data';
import {
  SITE,
  announcements,
  expect,
  expectNoAxeViolations,
  hemLine,
  narrow,
  open,
  reflowProblems,
  test,
} from './support';

/**
 * The session in the browser (D46; the web review of 2026-11-23, M1 to M3, L2, L4 and L9, and the review of its fixes,
 * batch 12). Only the server's explicit denial ends a session: Clew out of reach (a 5xx while it restarts, a
 * network error, no answer within ten seconds) is said, and asked again after a wait that grows, while the page and what
 * the person has typed stay. A change of the person's access reads the session again and never ends it. Every end takes
 * one way: the ended card, its words said, the focus on its heading, its tab title, and nothing of the session's work
 * left on screen. A link followed signed out keeps its whole address through sign-in. Waits run on the page's clock.
 */
const UNREACHABLE = `${SITE} går inte att nå just nu. Försöker igen om en stund.`;
const REACHED = `${SITE} går att nå igen.`;
const ENDED = 'Din inloggning har avslutats. Logga in igen för att fortsätta.';
/** How long a question about the session may take (`ASKING` in `packages/ui/src/session.tsx`). */
const ASKING = 10_000;
/** The longest first wait before Clew is asked again: two seconds, a quarter either way (`retryDelay`). */
const FIRST_WAIT = 2_500;
/** How a question fails while Clew is away; `hold` keeps one unanswered until Clew is back. */
type Fail = (route: Route, hold: (route: Route) => void) => Promise<void>;
const outages: Record<string, { fail: Fail; asking: number }> = {
  'a 503': { fail: route => route.fulfill({ status: 503, body: '' }), asking: 0 },
  'a network error': { fail: route => route.abort('failed'), asking: 0 },
  // The request is not answered while Clew is away: the page gives up on it after ten seconds.
  'no answer within ten seconds': { fail: async (route, hold) => hold(route), asking: ASKING },
};
/**
 * The session's read fails as `fail` does until `back()`, and is the mock's own answer again after. A question held
 * unanswered is answered when Clew is back, as a server that comes back answers what it was still being asked: the
 * page's clock runs on while the slow checks of a test take seconds under load, so the page may have asked again just
 * before, and that question would otherwise hold the next for ten seconds. One the page gave up on is gone already.
 */
async function outage(page: Page, fail: Fail) {
  const held: Route[] = [];
  const clew = {
    down: true,
    async back() {
      clew.down = false;
      for (const route of held.splice(0)) await route.fallback().catch(() => undefined);
    },
  };
  await page.route('**/api/auth/session', route =>
    clew.down ? fail(route, unanswered => void held.push(unanswered)) : route.fallback(),
  );
  return clew;
}
const notices = (page: Page) => page.getByRole('region', { name: 'Aviseringar' });
/**
 * Until a toast's row has finished opening. Astryx 0.7.16's `ToastViewport` takes a closed toast away when the row's
 * collapse ends (`transitionend`); a close that lands while the row's entry transition (from `@starting-style`) is
 * still pending starts no collapse, so nothing ends and the row stays, collapsed, with the focus not handed back. A
 * person is never that fast; a test whose frames are starved by the workers beside it is. Two frames make sure the
 * entry has been created, then its transitions are waited out; a transition cancelled is done too.
 */
const opened = (row: Locator) =>
  row.evaluate(async element => {
    for (let frame = 0; frame < 2; frame++) await new Promise(requestAnimationFrame);
    await Promise.all(
      element
        .getAnimations({ subtree: true })
        .filter(animation => animation instanceof CSSTransition)
        .map(animation => animation.finished.catch(() => undefined)),
    );
  });
/** The ended card's heading, which takes the focus as the card takes the page's place. */
const endedHeading = (page: Page) => page.getByRole('main').getByRole('heading', { level: 1, name: SITE });
/** A message on the page's open change stream, as the server sends one. */
const onStream = (page: Page, data: object) =>
  page.evaluate(data => {
    const open = (window as unknown as { changeStreams: Set<EventSource> }).changeStreams;
    for (const stream of open) stream.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(data) }));
  }, data);
/** From here the page's time moves only as the test moves it. */
const pause = async (page: Page) => page.clock.pauseAt(await page.evaluate(() => Date.now() + 1_000));

for (const [name, { fail, asking }] of Object.entries(outages))
  test(`${name} to the session's check keeps the page and what is typed, says so, and says when Clew answers again`, async ({
    page,
    api: _,
  }) => {
    await page.clock.install({ time: new Date(NOW) });
    // At 320 px, where a toast has the least room (1.4.10).
    await page.setViewportSize(narrow);
    await open(page, '/');
    await hemLine(page).fill('Vilka är på plats?');
    const clew = await outage(page, fail);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    if (asking) {
      // Still asking: nothing is said before the ten seconds have passed.
      await page.clock.runFor(asking - 1_000);
      await expect(notices(page).getByText(UNREACHABLE)).toHaveCount(0);
      await page.clock.runFor(1_000);
    }
    await expect(notices(page).getByText(UNREACHABLE)).toBeVisible();
    await expect.poll(() => announcements(page)).toContainEqual(expect.stringContaining(UNREACHABLE));
    // Not a sign-out: the page stays shown, with the question and the focus where they were.
    await expect(hemLine(page)).toHaveValue('Vilka är på plats?');
    await expect(hemLine(page)).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.style.opacity)).toBe('');
    await expect(page.getByRole('link', { name: 'Logga in igen' })).toHaveCount(0);
    await expectNoAxeViolations(page);
    expect(await reflowProblems(page)).toEqual([]);
    // Asked again by itself after the first wait: once Clew answers, the notice goes and that is said.
    await clew.back();
    await page.clock.runFor(FIRST_WAIT);
    await expect(notices(page).getByText(UNREACHABLE)).toHaveCount(0);
    await expect.poll(() => announcements(page)).toContainEqual(REACHED);
    await expect(hemLine(page)).toHaveValue('Vilka är på plats?');
  });

test('the notice of Clew out of reach is reached with F6 and closed by keyboard, and the focus goes back where it was', async ({
  page,
  api: _,
}) => {
  await page.setViewportSize(narrow);
  await open(page, '/');
  await hemLine(page).fill('Vilka är på plats?');
  await outage(page, outages['a 503']!.fail);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(notices(page).getByText(UNREACHABLE)).toBeVisible();
  await opened(notices(page).locator('[data-toast-id]').filter({ hasText: UNREACHABLE }));
  // F6 is Astryx's way to the toasts from anywhere on the page.
  await page.keyboard.press('F6');
  const close = page.getByRole('button', { name: 'Stäng avisering' });
  await expect(close).toBeFocused();
  await page.keyboard.press('Enter');
  // The notice is gone; its words may still stand a moment in the live region that said them.
  await expect(notices(page).getByText(UNREACHABLE)).toHaveCount(0);
  await expect(hemLine(page)).toBeFocused();
  await expect(hemLine(page)).toHaveValue('Vilka är på plats?');
});

test('while Clew is out of reach only the growing wait asks again, two seconds doubling to half a minute; the poll and a return to the window stand still', async ({
  page,
  api: _,
}) => {
  await page.clock.install({ time: new Date(NOW) });
  // When each question about the session left and when its answer came, on the page's clock.
  await page.addInitScript(() => {
    const asked: number[] = [],
      answered: number[] = [];
    Object.assign(window, { sessionAsks: { asked, answered } });
    const native = window.fetch.bind(window);
    window.fetch = Object.assign((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      if (url.pathname !== '/api/auth/session') return native(input, init);
      asked.push(Date.now());
      return native(input, init).finally(() => answered.push(Date.now()));
    }, window.fetch);
  });
  const asks = () =>
    page.evaluate(() => (window as unknown as { sessionAsks: { asked: number[]; answered: number[] } }).sessionAsks);
  const settled = async () => {
    const { asked, answered } = await asks();
    return asked.length === answered.length ? asked.length : -1;
  };
  await open(page, '/');
  await outage(page, outages['a 503']!.fail);
  await pause(page);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(settled).toBe(2);
  // Each wait is the one before doubled, up to half a minute, spread by a quarter either way. A window of a quarter
  // more than the wait holds exactly one question: the poll (every 15 seconds) and the window's focus ask nothing.
  for (const wait of [2_000, 4_000, 8_000, 16_000, 30_000, 30_000]) {
    const before = await asks();
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.clock.runFor(wait * 1.25);
    await expect.poll(settled).toBe(before.asked.length + 1);
    const asked = (await asks()).asked.at(-1)! - before.answered.at(-1)!;
    expect(asked, `the wait after ${before.asked.length - 1} failures`).toBeGreaterThanOrEqual(wait * 0.75);
    expect(asked, `the wait after ${before.asked.length - 1} failures`).toBeLessThanOrEqual(wait * 1.25);
  }
});

test('a first load that finds Clew out of reach says so in the page’s place, asks again by keyboard, and never shows the sign-in', async ({
  page,
  api: _,
}) => {
  const clew = await outage(page, outages['a 503']!.fail);
  await page.goto('/todo?tab=waiting');
  const main = page.getByRole('main');
  await expect(main.getByText(UNREACHABLE)).toBeVisible();
  await expect(main.getByRole('heading', { level: 1 })).toBeVisible();
  await expect.poll(() => announcements(page)).toContainEqual(expect.stringContaining(UNREACHABLE));
  await expect(page.getByRole('link', { name: 'Logga in', exact: true })).toHaveCount(0);
  await expectNoAxeViolations(page);
  await page.setViewportSize(narrow);
  expect(await reflowProblems(page)).toEqual([]);
  // The one move is the first stop of the keyboard; pressed while Clew is still away, the page stays as it is.
  const retry = main.getByRole('button', { name: 'Försök igen' });
  await page.keyboard.press('Tab');
  await expect(retry).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(main.getByText(UNREACHABLE)).toBeVisible();
  await expect(retry).toBeFocused();
  await clew.back();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'Att göra' })).toBeVisible();
  await expect(page).toHaveURL('/todo?tab=waiting');
});

test('a read of the session that answers after a newer one has drawn the page says nothing, and the next change of access reads it again quietly', async ({
  page,
  api,
}) => {
  await page.clock.install({ time: new Date(NOW) });
  let asks = 0;
  const held: Route[] = [];
  await page.route('**/api/auth/session', route => {
    asks++;
    // The first load finds Clew out of reach; the wait's own question is held; the button's is answered.
    if (asks === 1) return route.fulfill({ status: 503, body: '' });
    if (asks === 2) return void held.push(route);
    return route.fallback();
  });
  await page.goto('/todo');
  const main = page.getByRole('main');
  await expect(main.getByText(UNREACHABLE)).toBeVisible();
  await page.clock.runFor(FIRST_WAIT);
  await expect.poll(() => asks).toBe(2);
  await main.getByRole('button', { name: 'Försök igen' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Att göra' })).toBeVisible();
  const said = (await announcements(page)).length;
  // The older question answers now, out of reach: it is no longer the latest, and says nothing.
  await held[0]!.fulfill({ status: 503, body: '' }).catch(() => undefined);
  // The provisioner changes the person's access: the stream's new policy reads the session again.
  api.policyVersion = 'reorganised';
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { changeStreams: Set<unknown> }).changeStreams.size))
    .toBe(1);
  await onStream(page, { revision: '99', policy: '2:2' });
  await expect.poll(() => asks).toBeGreaterThanOrEqual(4);
  await expect(page.getByRole('heading', { level: 1, name: 'Att göra' })).toBeVisible();
  await expect(main.getByText(UNREACHABLE)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Försök igen' })).toHaveCount(0);
  expect((await announcements(page)).slice(said)).not.toContainEqual(expect.stringContaining(UNREACHABLE));
});

test('a check that finds the same session under changed access reads the session again in place and never ends it', async ({
  page,
  api,
}) => {
  const asked: string[] = [];
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/api/auth/session') asked.push(request.url());
  });
  await open(page, '/todo?tab=waiting');
  await expect(page.getByRole('heading', { level: 1, name: 'Att göra' })).toBeVisible();
  expect(asked).toHaveLength(1);
  // The provisioner moved the person's unit: the same session, under a new authorization version.
  api.policyVersion = 'reorganised';
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  // The check, then the read that draws the page again under the access the person has now.
  await expect.poll(() => asked.length).toBe(3);
  await expect(page.getByRole('heading', { level: 1, name: 'Att göra' })).toBeVisible();
  await expect(page).toHaveURL('/todo?tab=waiting');
  await expect(page.getByRole('link', { name: 'Logga in igen' })).toHaveCount(0);
  await expect(page).not.toHaveTitle(/^Inloggningen har avslutats/);
  expect(await announcements(page)).not.toContainEqual(expect.stringContaining(ENDED));
});

/** Each way the server says that the session has ended. */
const ends: Record<string, (page: Page) => Promise<unknown>> = {
  "the session's check answers 401": async page => {
    await page.route('**/api/auth/session', route =>
      route.fulfill({ status: 401, json: { error: 'Din inloggning har gått ut. Logga in igen.', code: 'expired' } }),
    );
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  },
  "the session's check answers 403 denied": async page => {
    await page.route('**/api/auth/session', route =>
      route.fulfill({ status: 403, json: { error: 'Du saknar behörighet för åtgärden.', code: 'denied' } }),
    );
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  },
  'the change stream says the session ended': page => onStream(page, { ended: true }),
};
for (const [name, end] of Object.entries(ends))
  test(`${name}: the ended card takes the page's place, says so and takes the focus`, async ({ page, api: _ }) => {
    await open(page, '/');
    await hemLine(page).fill('Vilka är på plats?');
    await end(page);
    await expect(endedHeading(page)).toBeFocused();
    await expect(page.getByRole('main')).toContainText(ENDED);
    await expect
      .poll(() => announcements(page))
      .toContainEqual(expect.stringContaining('Din inloggning har avslutats'));
    await expect(page).toHaveTitle(`Inloggningen har avslutats · ${SITE}`);
    await expect(hemLine(page)).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Logga in igen' })).toBeVisible();
  });

test('the end of a session takes its title and what its conversations showed, gives its heading the focus, and Logga in igen, reached by Tab, returns to the address with its query', async ({
  page,
  api,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, '/todo?item=ledighet');
  const here = new URL(page.url());
  expect(here.searchParams.get('item')).toBe('ledighet');
  await page.evaluate(() => {
    sessionStorage.setItem('clew:conversation-shown:c1', JSON.stringify({ items: ['ledighet'], views: [] }));
    sessionStorage.setItem('elsewhere', 'kept');
  });
  api.signedIn = false;
  await page.evaluate(() => window.dispatchEvent(new Event('clew-session-ended')));
  await expect(endedHeading(page)).toBeFocused();
  await expect.poll(() => announcements(page)).toContainEqual(expect.stringContaining('Din inloggning har avslutats'));
  await expect(page).toHaveTitle(`Inloggningen har avslutats · ${SITE}`);
  expect(
    await page.evaluate(() => [
      sessionStorage.getItem('clew:conversation-shown:c1'),
      sessionStorage.getItem('elsewhere'),
    ]),
  ).toEqual([null, 'kept']);
  // The card's one move is the next stop of the keyboard, and it leads back to the item with its query.
  await page.keyboard.press('Tab');
  const again = page.getByRole('link', { name: 'Logga in igen' });
  await expect(again).toBeFocused();
  await expect(again).toHaveAttribute(
    'href',
    '/api/auth/login?returnTo=' + encodeURIComponent(here.pathname + here.search),
  );
  await expectNoAxeViolations(page);
  await page.setViewportSize(narrow);
  expect(await reflowProblems(page)).toEqual([]);
});

test('a toast still coming in when the session ends goes with it at once, with nothing waited for', async ({
  page,
  api: _,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, '/todo?item=ledighet');
  const card = page.getByRole('complementary', { name: 'Valt ärende' });
  await card.getByRole('button', { name: 'Fler åtgärder' }).click();
  await page.getByRole('menuitem', { name: 'Inte nu' }).click();
  // The session ends in the same moment the toast's row enters, before any of its entrance has run.
  await page.evaluate(() =>
    new MutationObserver((_, watch) => {
      if (!document.querySelector('[data-toast-id]')) return;
      watch.disconnect();
      window.dispatchEvent(new Event('clew-session-ended'));
    }).observe(document, { childList: true, subtree: true }),
  );
  await page.getByRole('menuitem', { name: /^I morgon/ }).click();
  await expect(endedHeading(page)).toBeFocused();
  // Read once, not waited for: the toast region left with the session.
  expect(await page.locator('[data-toast-id]').count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Ångra' }).count()).toBe(0);
  expect(await notices(page).count()).toBe(0);
});

test('the end of a session stops its change stream: the wait to open it again is cleared and nothing opens it after', async ({
  page,
  api,
}) => {
  await page.clock.install({ time: new Date(NOW) });
  let streams = 0;
  // Every connection meets a restart: a 503 closes an EventSource for good, and the page waits to open it again.
  await page.route('**/api/changes', route => {
    streams++;
    return route.fulfill({ status: 503, body: '' });
  });
  await open(page, '/todo');
  await pause(page);
  const closed = () =>
    page.evaluate(() =>
      [...(window as unknown as { changeStreams: Set<EventSource> }).changeStreams].every(
        s => s.readyState === EventSource.CLOSED,
      ),
    );
  await expect.poll(closed).toBe(true);
  const opened = streams;
  expect(opened).toBeGreaterThan(0);
  api.signedIn = false;
  await page.evaluate(() => window.dispatchEvent(new Event('clew-session-ended')));
  await expect(endedHeading(page)).toBeFocused();
  // Longer than any wait, and the two moves that open a closed stream at once: nothing is opened.
  await page.clock.runFor(120_000);
  await page.evaluate(() => {
    window.dispatchEvent(new Event('online'));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.clock.runFor(120_000);
  expect(streams).toBe(opened);
});

test('a closed change stream waiting to be opened again opens at once when the browser is online again or the tab is shown', async ({
  page,
  api: _,
}) => {
  await page.clock.install({ time: new Date(NOW) });
  let streams = 0;
  await page.route('**/api/changes', route => {
    streams++;
    return route.fulfill({ status: 503, body: '' });
  });
  await open(page, '/todo');
  await pause(page);
  const closed = () =>
    page.evaluate(() =>
      [...(window as unknown as { changeStreams: Set<EventSource> }).changeStreams].every(
        s => s.readyState === EventSource.CLOSED,
      ),
    );
  for (const [event, on] of [
    ['online', 'window'],
    ['visibilitychange', 'document'],
  ] as const) {
    await expect.poll(closed).toBe(true);
    const before = streams;
    // The clock stands still: only the event can open it.
    await page.evaluate(([event, on]) => (on === 'window' ? window : document).dispatchEvent(new Event(event)), [
      event,
      on,
    ] as const);
    await expect.poll(() => streams, `${event} opens the stream again`).toBe(before + 1);
  }
});

test('a change stream whose reconnect is answered with an error is opened again, and its notices arrive', async ({
  page,
  api,
}) => {
  await page.clock.install({ time: new Date(NOW) });
  let streams = 0;
  await page.route('**/api/changes', route => {
    streams++;
    // The first connection meets a restart: a 503 closes an EventSource for good.
    return streams === 1 ? route.fulfill({ status: 503, body: '' }) : route.fallback();
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, '/todo');
  await page.clock.runFor(FIRST_WAIT);
  await expect.poll(() => streams).toBe(2);
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
