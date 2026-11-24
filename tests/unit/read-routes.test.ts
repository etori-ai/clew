import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { AuthenticatedContext, ClewObject } from '../../packages/contracts/src/index';
import { capabilityRoutes } from '../../apps/server/src/routes/capabilities';
import { objectsRoutes } from '../../apps/server/src/routes/objects';
import { protectedRoute } from '../../apps/server/src/context';
import { AuthError, type Session } from '../../apps/server/src/auth';

/**
 * The reads that moved from GET to POST so that what a person typed, and whom a read is about, never travel in an
 * address (WD-M4 of the web review of 2026-11-23; the review of its fixes, batch 12): `@`'s search (`POST
 * /api/objects`) with its body bounded and run as the session's person, and the session guard in front of both, which
 * asks a posted read for the session's origin and CSRF token as it asks any other POST. The session is read by a stub
 * of `authenticate`; nothing here needs the database.
 */
const settings: Record<string, string> = {
  OIDC_ISSUER: 'https://idp.example.test/realms/reads',
  OIDC_CLIENT_ID: 'clew-reads-test',
  OIDC_CLIENT_SECRET: 'synthetic-secret',
  PUBLIC_URL: 'https://clew.example.test',
};
const previous: Record<string, string | undefined> = {};
beforeAll(() => {
  for (const [k, v] of Object.entries(settings)) {
    previous[k] = process.env[k];
    process.env[k] = v;
  }
  delete process.env.FRONTEND_ORIGINS;
});
afterAll(() => {
  for (const [k, v] of Object.entries(previous))
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
});
const ORIGIN = 'https://clew.example.test';
const persona = { id: 'hillevi', name: 'Hillevi Berg', role: 'manager' } as AuthenticatedContext;
/** The session the stub reads for the one cookie it knows. */
const read = async (raw: string | undefined): Promise<Session> => {
  if (raw !== 'cookie-1') throw new AuthError(401, 'expired');
  return { context: persona, csrfToken: 'csrf-1', sessionKey: 'key', policyVersion: 'version', row: {} } as never;
};
function stack(guard: 'session' | 'test') {
  const listed: Array<[string, string, string[]]> = [];
  const ran: Array<[string, string, unknown]> = [];
  const objects: ClewObject[] = [
    { ref: 'thread:c1', kind: 'thread', label: 'Ledighet', detail: 'ärende', visible: true },
  ];
  const session =
    guard === 'session'
      ? protectedRoute(read)
      : ((async (c, next) => {
          c.set('session', { context: persona } as never);
          await next();
        }) satisfies Parameters<typeof objectsRoutes>[0]['guard']);
  // Each as the API mounts it, under `/api/objects` and `/api/cap`: the paths below say which.
  const objectsRoute = objectsRoutes({
    guard: session,
    list: async (p, q, near) => {
      listed.push([p.id, q, near]);
      return objects;
    },
  });
  const capRoutes = capabilityRoutes({
    guard: session,
    registry: {
      findFor: (_actor: unknown, name: string) =>
        name === 'hr.whoIsOn' ? { connector: { source: 'Personalsystemet' }, capability: { kind: 'read' } } : undefined,
      viewFor: () => undefined,
    } as never,
    run: async (p, name, input) => {
      ran.push([p.id, name, input]);
      return { rows: [] };
    },
  });
  // Each served at the part of the path after its mount: `/api/objects?q=…` is `/?q=…` to its routes.
  const ask = (path: string, init: RequestInit = {}) => {
    const [mount, routes] = path.startsWith('/api/objects')
      ? (['/api/objects', objectsRoute] as const)
      : (['/api/cap', capRoutes] as const);
    const rest = path.slice(mount.length);
    return routes.request('http://clew.test' + (rest.startsWith('/') ? rest : '/' + rest), init);
  };
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    ask(path, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers });
  return { ask, post, listed, ran, objects };
}

describe("`@`'s search, `POST /api/objects`", () => {
  test('answers what the person may point at, asked as the session’s person with the words and refs of the body', async () => {
    const { post, listed, objects } = stack('test');
    const response = await post('/api/objects', { q: 'ledig', near: ['thread:c1', 'item:hr:emp:1004'] });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ objects });
    expect(listed).toEqual([['hillevi', 'ledig', ['thread:c1', 'item:hr:emp:1004']]]);
  });
  test('a body of another shape is refused before anything is asked, and nobody else can be named in it', async () => {
    const { post, listed } = stack('test');
    for (const body of [
      '{nope',
      {},
      { q: 'a' },
      { near: [] },
      { q: 1, near: [] },
      { q: 'a', near: 'thread:c1' },
      { q: 'a', near: [1] },
      // The person is the session's: a body that names another is not a search at all.
      { q: 'a', near: [], person: 'anna' },
    ]) {
      const response = await post('/api/objects', body);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'Ogiltig förfrågan.' });
    }
    expect(listed).toEqual([]);
  });
  test('the words typed are at most 80 characters, and a body is read no further than its limit', async () => {
    const { post, listed } = stack('test');
    expect((await post('/api/objects', { q: 'a'.repeat(80), near: [] })).status).toBe(200);
    const long = await post('/api/objects', { q: 'a'.repeat(81), near: [] });
    expect(long.status).toBe(400);
    expect(await long.json()).toEqual({ error: 'För lång sökning.' });
    const big = await post('/api/objects', { q: '', near: [], pad: 'x'.repeat(16_001) });
    expect(big.status).toBe(400);
    expect(await big.json()).toEqual({ error: 'För stor förfrågan.' });
    expect(listed).toHaveLength(1);
  });
  test('what is in view is at most 40 refs, each a ref of at most 200 characters', async () => {
    const { post, listed } = stack('test');
    const ref = (n: number) => `thread:c${n}`;
    expect((await post('/api/objects', { q: '', near: Array.from({ length: 40 }, (_, n) => ref(n)) })).status).toBe(
      200,
    );
    for (const near of [
      Array.from({ length: 41 }, (_, n) => ref(n)),
      ['thread:' + 'c'.repeat(194)],
      ['Thread:c1'],
      ['thread c1'],
      ['thread:'],
      ['https://evil.example/x'],
    ]) {
      const response = await post('/api/objects', { q: '', near });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'Ogiltigt sammanhang.' });
    }
    expect(listed).toHaveLength(1);
  });
  test('a GET, with the words in the address, is no route', async () => {
    const { ask, listed } = stack('test');
    expect((await ask('/api/objects?q=anna&near=')).status).toBe(404);
    expect(listed).toEqual([]);
  });
});

describe('the session guard in front of the reads that are POSTs', () => {
  const cookie = { cookie: '__Host-clew-session=cookie-1' };
  const right = { ...cookie, origin: ORIGIN, 'x-csrf-token': 'csrf-1' };
  test('a read with the session, its origin and its CSRF token is answered', async () => {
    const { post, ran, listed } = stack('session');
    expect((await post('/api/cap/hr.whoIsOn', { date: '2026-11-24' }, right)).status).toBe(200);
    expect((await post('/api/objects', { q: 'anna', near: [] }, right)).status).toBe(200);
    expect(ran).toEqual([['hillevi', 'hr.whoIsOn', { date: '2026-11-24' }]]);
    expect(listed).toEqual([['hillevi', 'anna', []]]);
  });
  test('without the origin, from another origin, without the CSRF token or with another one, nothing is read', async () => {
    const { post, ran, listed } = stack('session');
    for (const headers of [
      { ...cookie, 'x-csrf-token': 'csrf-1' },
      { ...cookie, origin: 'https://evil.example', 'x-csrf-token': 'csrf-1' },
      { ...cookie, origin: ORIGIN },
      { ...cookie, origin: ORIGIN, 'x-csrf-token': 'csrf-2' },
    ])
      for (const [path, body] of [
        ['/api/cap/hr.whoIsOn', { date: '2026-11-24' }],
        ['/api/objects', { q: 'anna', near: [] }],
      ] as const) {
        const response = await post(path, body, headers);
        expect(response.status).toBe(403);
        expect(await response.json()).toEqual({ error: 'Du saknar behörighet för åtgärden.', code: 'invalid' });
      }
    expect(ran).toEqual([]);
    expect(listed).toEqual([]);
  });
  test('without a session the read is the 401 that ends it in the browser', async () => {
    const { post, ran } = stack('session');
    const response = await post('/api/cap/hr.whoIsOn', {}, { origin: ORIGIN, 'x-csrf-token': 'csrf-1' });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Din inloggning har gått ut. Logga in igen.', code: 'expired' });
    expect(ran).toEqual([]);
  });
});
