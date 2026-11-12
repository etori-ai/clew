import { describe, expect, test } from 'bun:test';
import * as oidc from 'openid-client';
import {
  grantEnded,
  sessionRefresher,
  type RefreshedTokens,
  type RefreshRow,
} from '../../apps/server/src/auth-refresh';

/**
 * Refreshing a session's IdP tokens (L1 and L4 of the 2026-11-12 users review). The real openid-client asks a token
 * endpoint that answers what each test says over a fake fetch, so every class of failure is the error the library
 * throws for it; the session rows live in a map. Only `invalid_grant`, a changed subject and a row that is gone end the
 * session; everything else keeps it and its tokens, and the refresh says `unavailable`, which delegation answers with
 * 503.
 */
type Row = RefreshRow & { personId: string };
const issuer = 'https://idp.example.test';
const sealed = (access: string, refresh: string) =>
  JSON.stringify({ access_token: access, refresh_token: refresh, id_token: 'id-1' });
function world(options: { grant?: (refreshToken: string) => Promise<RefreshedTokens> } = {}) {
  let now = 1_000_000;
  let answer: (request: Request) => Response | Promise<Response> = () =>
    Response.json({ access_token: 'access-2', token_type: 'Bearer', expires_in: 120, refresh_token: 'refresh-2' });
  const calls: string[] = [];
  const config = new oidc.Configuration({ issuer, token_endpoint: issuer + '/token' }, 'clew', 'synthetic-secret');
  config.timeout = 0.05;
  config[oidc.customFetch] = async (url, init) => {
    const request = new Request(url, init as RequestInit);
    calls.push(new URLSearchParams(await request.clone().text()).get('refresh_token') ?? '');
    return answer(request);
  };
  const rows = new Map<string, Row>();
  const ended: string[] = [];
  const failures: unknown[] = [];
  const refresher = sessionRefresher<Row>({
    clock: () => now,
    read: async digest => rows.get(digest),
    grant:
      options.grant ??
      (async refreshToken => {
        const tokens = await oidc.refreshTokenGrant(config, refreshToken);
        return {
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          id_token: tokens.id_token,
          expires_in: tokens.expires_in,
          subject: tokens.claims()?.sub,
        };
      }),
    ended: grantEnded,
    async store(digest, previous, next) {
      const row = rows.get(digest);
      if (!row || row.tokens !== previous) return undefined;
      const stored = { ...row, ...next };
      rows.set(digest, stored);
      return stored;
    },
    async end(digest, action) {
      ended.push(digest + ' ' + action);
      rows.delete(digest);
    },
    open: value => JSON.parse(value),
    seal: tokens => JSON.stringify(tokens),
    failed: error => failures.push(error),
  });
  /** A session whose access token expires in ten seconds, inside the fifteen-second refresh window. */
  const session = (digest = 's1'): Row => {
    const row = {
      digest,
      personId: 'anna',
      subject: 'sub-anna',
      tokens: sealed('access-1', 'refresh-1'),
      tokenExpiresAt: new Date(now + 10_000),
    };
    rows.set(digest, row);
    return row;
  };
  return {
    refresher,
    rows,
    ended,
    failures,
    calls,
    session,
    answer: (next: typeof answer) => {
      answer = next;
    },
    advance: (ms: number) => {
      now += ms;
    },
    now: () => now,
  };
}
describe('a session refresh', () => {
  test('stores the new tokens over the ones they were refreshed from', async () => {
    const w = world();
    const row = w.session();
    const refreshed = await w.refresher.refresh(row);
    expect(refreshed.state).toBe('fresh');
    expect(w.calls).toEqual(['refresh-1']);
    expect(JSON.parse(w.rows.get('s1')!.tokens)).toEqual({
      access_token: 'access-2',
      refresh_token: 'refresh-2',
      id_token: 'id-1',
    });
    expect(w.rows.get('s1')!.tokenExpiresAt.getTime()).toBe(w.now() + 120_000);
    // Outside the window nothing is asked.
    expect(await w.refresher.refresh(w.rows.get('s1')!)).toEqual({ state: 'fresh', row: w.rows.get('s1')! });
    expect(w.calls).toHaveLength(1);
  });
  test('requests of one session at the same moment share one refresh', async () => {
    const w = world();
    const row = w.session();
    const [a, b] = await Promise.all([w.refresher.refresh(row), w.refresher.refresh(row)]);
    expect(w.calls).toEqual(['refresh-1']);
    expect(a).toEqual(b);
  });
  describe('ends the session', () => {
    test('when the provider answers invalid_grant', async () => {
      const w = world();
      w.answer(() =>
        Response.json({ error: 'invalid_grant', error_description: 'Session not active' }, { status: 400 }),
      );
      expect(await w.refresher.refresh(w.session())).toEqual({ state: 'ended' });
      expect(w.ended).toEqual(['s1 refresh-failed']);
      expect(w.failures).toEqual([]);
    });
    test('when the refreshed ID token names another subject', async () => {
      const w = world({ grant: async () => ({ access_token: 'access-2', subject: 'sub-someone-else' }) });
      expect(await w.refresher.refresh(w.session())).toEqual({ state: 'ended' });
      expect(w.ended).toEqual(['s1 refresh-failed']);
    });
    test('when the session row is gone', async () => {
      const w = world();
      const row = w.session();
      w.rows.delete('s1');
      expect(await w.refresher.refresh(row)).toEqual({ state: 'ended' });
      expect(w.ended).toEqual(['s1 expired']);
      expect(w.calls).toEqual([]);
    });
  });
  describe('keeps the session and its tokens', () => {
    const classes: Array<[string, (request: Request) => Response | Promise<Response>]> = [
      ['invalid_client, after a secret rotation', () => Response.json({ error: 'invalid_client' }, { status: 401 })],
      [
        'invalid_client with a challenge',
        () =>
          Response.json(
            { error: 'invalid_client' },
            { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="clew"' } },
          ),
      ],
      ['a 429 without a body', () => new Response(null, { status: 429, headers: { 'Retry-After': '30' } })],
      ['a 429 with an error', () => Response.json({ error: 'slow_down' }, { status: 429 })],
      [
        'a 503 from a proxy',
        () =>
          new Response('<html>Service Unavailable</html>', { status: 503, headers: { 'Content-Type': 'text/html' } }),
      ],
      ['a 500 with server_error', () => Response.json({ error: 'server_error' }, { status: 500 })],
      [
        'a refused connection',
        () => {
          throw new TypeError('fetch failed', {
            cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
          });
        },
      ],
      [
        'a timeout',
        request =>
          new Promise<Response>((_, reject) =>
            request.signal.addEventListener('abort', () => reject(request.signal.reason)),
          ),
      ],
    ];
    for (const [name, answer] of classes)
      test(name, async () => {
        const w = world();
        const row = w.session();
        w.answer(answer);
        const refreshed = await w.refresher.refresh(row);
        expect(refreshed).toEqual({ state: 'unavailable', row });
        expect(w.rows.get('s1')).toEqual(row);
        expect(w.ended).toEqual([]);
        expect(w.failures).toHaveLength(1);
        expect(grantEnded(w.failures[0])).toBe(false);
      });
  });
  test('after the provider could not answer, the session waits before asking again', async () => {
    const w = world();
    const row = w.session();
    w.answer(() => new Response(null, { status: 502 }));
    expect((await w.refresher.refresh(row)).state).toBe('unavailable');
    w.advance(5_000);
    expect((await w.refresher.refresh(row)).state).toBe('unavailable');
    expect(w.calls).toHaveLength(1);
    // Another session is not held back by this one.
    expect((await w.refresher.refresh(w.session('s2'))).state).toBe('unavailable');
    expect(w.calls).toHaveLength(2);
    w.advance(30_000);
    w.answer(() =>
      Response.json({ access_token: 'access-3', token_type: 'Bearer', expires_in: 60, refresh_token: 'refresh-3' }),
    );
    const refreshed = await w.refresher.refresh(row);
    expect(refreshed.state).toBe('fresh');
    expect(w.calls).toHaveLength(3);
    expect(JSON.parse(w.rows.get('s1')!.tokens).access_token).toBe('access-3');
  });
  test('an invalid_grant after another process refreshed with the same token uses that refresh', async () => {
    const w = world();
    const row = w.session();
    w.answer(() => {
      // The other process stored its tokens, and the provider refuses the refresh token's reuse.
      w.rows.set('s1', {
        ...row,
        tokens: sealed('access-other', 'refresh-other'),
        tokenExpiresAt: new Date(w.now() + 60_000),
      });
      return Response.json({ error: 'invalid_grant' }, { status: 400 });
    });
    const refreshed = await w.refresher.refresh(row);
    expect(refreshed.state).toBe('fresh');
    expect(refreshed.state === 'fresh' && JSON.parse(refreshed.row.tokens).access_token).toBe('access-other');
    expect(w.ended).toEqual([]);
  });
  test('tokens another process stored while the provider answered stand', async () => {
    const w = world();
    const row = w.session();
    w.answer(() => {
      w.rows.set('s1', {
        ...row,
        tokens: sealed('access-other', 'refresh-other'),
        tokenExpiresAt: new Date(w.now() + 60_000),
      });
      return Response.json({
        access_token: 'access-2',
        token_type: 'Bearer',
        expires_in: 120,
        refresh_token: 'refresh-2',
      });
    });
    const refreshed = await w.refresher.refresh(row);
    expect(refreshed.state === 'fresh' && JSON.parse(refreshed.row.tokens).access_token).toBe('access-other');
    expect(JSON.parse(w.rows.get('s1')!.tokens).access_token).toBe('access-other');
  });
});
