import { afterEach, describe, expect, jest, test } from 'bun:test';
import {
  ASKING,
  readSession,
  sessionStanding,
  signInAgainHref,
  type SessionAnswer,
} from '../../packages/ui/src/session';
import { signInHref, signInTarget } from '../../packages/ui/src/sign-in-address';

/**
 * The session in the browser (D46; the web review of 2026-11-23, M1 and M3, and the review of its fixes, batch 12): what
 * one answer of `GET /api/auth/session` says of the session, what a check's answer means for the session a page stands
 * in, and where signing in again leads. `fetch` is stubbed: each case answers as the server, a proxy in front of it or
 * the network would.
 */
const network = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = network;
  jest.useRealTimers();
});
/** What the stub was asked with, and the answer it gives. */
function answering(answer: (init: RequestInit | undefined) => Promise<Response> | Response) {
  const asked: Array<{ url: string; init: RequestInit | undefined }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    asked.push({ url: String(input), init });
    return answer(init);
  }) as typeof fetch;
  return asked;
}
/** A request that never answers: it fails as the browser's does once its signal aborts. */
const never = (init: RequestInit | undefined) =>
  new Promise<Response>((_, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
  });
const html = (status: number) =>
  new Response('<html><body>Service Unavailable</body></html>', { status, headers: { 'Content-Type': 'text/html' } });
const session = {
  csrfToken: 'csrf',
  sessionKey: 'key-1',
  policyVersion: 'version-1',
  expiresAt: '2026-11-24T16:00:00.000Z',
  user: { id: 'hillevi', name: 'Hillevi Berg' },
};

describe('one answer of the session endpoint', () => {
  test('a 200 with the session is the session, asked without the cache', async () => {
    const asked = answering(() => Response.json(session));
    expect(await readSession()).toEqual({ state: 'signed-in', session });
    expect(asked).toHaveLength(1);
    expect(asked[0]!.url).toBe('/api/auth/session');
    expect(asked[0]!.init?.cache).toBe('no-store');
  });
  test("only the server's explicit denial is a sign-out: a 401, and a 403 that says `denied`", async () => {
    answering(() =>
      Response.json({ error: 'Din inloggning har gått ut. Logga in igen.', code: 'expired' }, { status: 401 }),
    );
    expect(await readSession()).toEqual({ state: 'signed-out' });
    answering(() => Response.json({ error: 'Du saknar behörighet för åtgärden.', code: 'denied' }, { status: 403 }));
    expect(await readSession()).toEqual({ state: 'signed-out' });
  });
  const outOfReach: Array<[string, () => Response]> = [
    ['a 403 with another code', () => Response.json({ error: 'Nej.', code: 'invalid' }, { status: 403 })],
    ["a proxy's 403 page", () => html(403)],
    ['a 429', () => Response.json({ error: 'För många förfrågningar.' }, { status: 429 })],
    ["a proxy's 502 page", () => html(502)],
    ["the server's 503 in JSON", () => Response.json({ error: 'Tjänsten går inte att nå just nu.' }, { status: 503 })],
    ['a 200 whose body is an HTML page', () => html(200)],
    ['a 200 whose JSON is not an object', () => Response.json(['csrf'])],
    ['a 200 whose JSON is something else', () => Response.json({ ok: true })],
    ['a 200 without the policy version', () => Response.json({ ...session, policyVersion: undefined })],
    ['a 200 with a deadline that is no date', () => Response.json({ ...session, expiresAt: 'snart' })],
    ['a 200 without the person', () => Response.json({ ...session, user: null })],
  ];
  for (const [name, answer] of outOfReach)
    test(`${name} says nothing of the session: Clew is out of reach`, async () => {
      answering(answer);
      expect(await readSession()).toEqual({ state: 'unreachable' });
    });
  test('a request the network refuses is out of reach', async () => {
    answering(() => Promise.reject(new TypeError('Failed to fetch')));
    expect(await readSession()).toEqual({ state: 'unreachable' });
  });
  test('no answer within ten seconds is out of reach, and the request is given up', async () => {
    jest.useFakeTimers();
    const asked = answering(never);
    let settled = false;
    const answer = readSession().then(result => {
      settled = true;
      return result;
    });
    jest.advanceTimersByTime(ASKING - 1);
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(asked[0]!.init?.signal?.aborted).toBe(false);
    jest.advanceTimersByTime(1);
    expect(await answer).toEqual({ state: 'unreachable' });
    expect(asked[0]!.init?.signal?.aborted).toBe(true);
    expect(ASKING).toBe(10_000);
  });
  test("the caller's abort is no answer at all: it is thrown, before the answer and while its body is read", async () => {
    answering(never);
    const before = new AbortController();
    const asked = readSession(before.signal);
    before.abort();
    await expect(asked).rejects.toBeDefined();
    const during = new AbortController();
    answering(() => {
      during.abort();
      return Response.json({ error: 'Nej.', code: 'denied' }, { status: 403 });
    });
    await expect(readSession(during.signal)).rejects.toBeDefined();
  });
});

describe("what a check's answer means for the session the page stands in", () => {
  const known = { sessionKey: 'key-1', policyVersion: 'version-1' };
  const signedIn = (sessionKey: string, policyVersion: string): SessionAnswer<typeof known> => ({
    state: 'signed-in',
    session: { sessionKey, policyVersion },
  });
  test('the same session at the same version stands as it is', () => {
    expect(sessionStanding(known, signedIn('key-1', 'version-1'))).toBe('same');
  });
  test("a change of the person's access is the same session read again, never its end", () => {
    // A provisioner moved the person's unit, role or capabilities: the version changes, the session does not.
    expect(sessionStanding(known, signedIn('key-1', 'version-2'))).toBe('access-changed');
  });
  test('another session, or an explicit denial, ends it; Clew out of reach does not', () => {
    expect(sessionStanding(known, signedIn('key-2', 'version-1'))).toBe('ended');
    expect(sessionStanding(known, signedIn('key-2', 'version-2'))).toBe('ended');
    expect(sessionStanding(known, { state: 'signed-out' })).toBe('ended');
    expect(sessionStanding(known, { state: 'unreachable' })).toBe('unreachable');
  });
});

describe('where signing in leads afterwards (D116; WD-M3)', () => {
  test('an address inside Clew is kept with its query', () => {
    expect(signInTarget('/todo?item=ledighet&tab=waiting')).toBe('/todo?item=ledighet&tab=waiting');
    expect(signInTarget('/people/anna?section=hr.person&from=%2Fstaff')).toBe(
      '/people/anna?section=hr.person&from=%2Fstaff',
    );
    expect(signInHref('/todo?item=ledighet&tab=waiting')).toBe(
      '/api/auth/login?returnTo=' + encodeURIComponent('/todo?item=ledighet&tab=waiting'),
    );
  });
  test('an address that would lead to another site is home: `//`, `/\\`, a backslash, a tab or a line break', () => {
    for (const away of [
      '//evil.example/todo',
      '/\\evil.example/todo',
      '/todo\\..\\evil',
      '/\t/evil.example',
      '/todo\n',
      'https://evil.example/',
      'todo',
      '',
    ])
      expect(signInTarget(away)).toBe('/');
    expect(signInHref('//evil.example')).toBe('/api/auth/login?returnTo=%2F');
  });
  test('an API address and the sign-in page itself are home, as the server has them', () => {
    expect(signInTarget('/api/auth/logout')).toBe('/');
    expect(signInTarget('/login?reason=expired')).toBe('/');
  });
  test('"Logga in igen" returns to the address the session ended on, its query kept, and never to another site', () => {
    expect(signInAgainHref({ pathname: '/todo', search: '?item=ledighet&tab=waiting' })).toBe(
      '/api/auth/login?returnTo=' + encodeURIComponent('/todo?item=ledighet&tab=waiting'),
    );
    expect(signInAgainHref({ pathname: '//evil.example', search: '?x=1' })).toBe('/api/auth/login?returnTo=%2F');
    expect(signInAgainHref({ pathname: '/\\evil.example', search: '' })).toBe('/api/auth/login?returnTo=%2F');
  });
});
