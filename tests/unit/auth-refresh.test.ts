import { describe, expect, test } from 'bun:test';
import * as oidc from 'openid-client';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import {
  failureOf,
  grantEnded,
  refreshGrant,
  sessionRefresher,
  type RefreshRow,
} from '../../apps/server/src/auth-refresh';

/**
 * Refreshing a session's IdP tokens (L1 and L4 of the 2026-11-12 users review). The server's own grant (`refreshGrant`)
 * runs the real openid-client against a token endpoint and a key set that answer what each test says over a fake
 * fetch, with the ID token's signature checked as the server checks it, so every class of failure is the error the
 * library throws for it; the session rows live in a map. Only an ending answer, a changed subject and a row that is
 * gone end the session; everything else keeps it and its tokens, and the refresh says `unavailable`, which delegation
 * answers with 503.
 */
type Row = RefreshRow & { personId: string };
const issuer = 'https://idp.example.test';
const keys = await generateKeyPair('RS256');
const jwks = { keys: [{ ...(await exportJWK(keys.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' }] };
/** An ID token the provider signed for `subject`, as a refresh answer carries it. */
const idToken = (subject: string) =>
  new SignJWT({})
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(issuer)
    .setAudience('clew')
    .setSubject(subject)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(keys.privateKey);
const sealed = (access: string, refresh: string) =>
  JSON.stringify({ access_token: access, refresh_token: refresh, id_token: 'id-1' });
function world() {
  let now = 1_000_000;
  let answer: (request: Request) => Response | Promise<Response> = () =>
    Response.json({ access_token: 'access-2', token_type: 'Bearer', expires_in: 120, refresh_token: 'refresh-2' });
  let meanwhile: () => void = () => undefined;
  const calls: string[] = [];
  const pauses: number[] = [];
  const config = new oidc.Configuration(
    { issuer, token_endpoint: issuer + '/token', jwks_uri: issuer + '/jwks' },
    'clew',
    'synthetic-secret',
  );
  // As the server's configuration is: a refreshed ID token's signature is checked against the provider's keys.
  oidc.enableNonRepudiationChecks(config);
  config.timeout = 0.05;
  config[oidc.customFetch] = async (url, init) => {
    if (url === issuer + '/jwks') return Response.json(jwks);
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
    grant: refreshGrant(async () => config),
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
    async sleep(ms) {
      pauses.push(ms);
      meanwhile();
    },
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
    pauses,
    session,
    answer: (next: typeof answer) => {
      answer = next;
    },
    /** What another process does while this one pauses before reading the row again. */
    meanwhile: (next: () => void) => {
      meanwhile = next;
    },
    advance: (ms: number) => {
      now += ms;
    },
    now: () => now,
  };
}
/** Another process stored its own refresh of the row. */
const refreshedElsewhere = (w: ReturnType<typeof world>, row: Row) =>
  w.rows.set(row.digest, {
    ...row,
    tokens: sealed('access-other', 'refresh-other'),
    tokenExpiresAt: new Date(w.now() + 60_000),
  });
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
  test('stores a refreshed ID token for the same subject', async () => {
    const w = world();
    const token = await idToken('sub-anna');
    w.answer(() => Response.json({ access_token: 'access-2', token_type: 'Bearer', expires_in: 120, id_token: token }));
    expect((await w.refresher.refresh(w.session())).state).toBe('fresh');
    expect(JSON.parse(w.rows.get('s1')!.tokens)).toEqual({
      access_token: 'access-2',
      refresh_token: 'refresh-1',
      id_token: token,
    });
  });
  test('requests of one session at the same moment share one refresh', async () => {
    const w = world();
    const row = w.session();
    const [a, b] = await Promise.all([w.refresher.refresh(row), w.refresher.refresh(row)]);
    expect(w.calls).toEqual(['refresh-1']);
    expect(a).toEqual(b);
  });
  describe('ends the session', () => {
    for (const error of ['invalid_grant', 'interaction_required', 'login_required', 'consent_required'])
      test(`when the provider answers ${error}`, async () => {
        const w = world();
        w.answer(() => Response.json({ error, error_description: 'Synthetic' }, { status: 400 }));
        expect(await w.refresher.refresh(w.session())).toEqual({ state: 'ended' });
        expect(w.ended).toEqual(['s1 refresh-failed']);
        expect(w.failures).toEqual([]);
        // The row was read again after a moment, in case another process was still storing a refresh.
        expect(w.pauses).toEqual([2_000]);
      });
    test('when the refreshed ID token names another subject', async () => {
      const w = world();
      const token = await idToken('sub-someone-else');
      w.answer(() => Response.json({ access_token: 'access-2', token_type: 'Bearer', id_token: token }));
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
    const refused = (code: string, own: boolean) => {
      const cause = Object.assign(new Error('connect ' + code), { code });
      // Node's fetch throws `fetch failed` with the network's code on its cause; Bun's carries the code itself.
      throw own ? Object.assign(new TypeError(code), { code }) : new TypeError('fetch failed', { cause });
    };
    const classes: Array<[string, (request: Request) => Response | Promise<Response>, ReturnType<typeof failureOf>]> = [
      [
        'invalid_client, after a secret rotation',
        () => Response.json({ error: 'invalid_client' }, { status: 401 }),
        { code: 'invalid_client', status: 401 },
      ],
      [
        'invalid_client with a challenge',
        () =>
          Response.json(
            { error: 'invalid_client' },
            { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="clew"' } },
          ),
        { code: 'OAUTH_WWW_AUTHENTICATE_CHALLENGE', status: 401 },
      ],
      // openid-client reads an error body only from a 4xx answer in JSON; otherwise its own code and the status say
      // what came back.
      [
        'a 429 without a body',
        () => new Response(null, { status: 429, headers: { 'Retry-After': '30' } }),
        { code: 'OAUTH_RESPONSE_IS_NOT_JSON', status: 429 },
      ],
      [
        'a 429 with an error',
        () => Response.json({ error: 'slow_down' }, { status: 429 }),
        { code: 'slow_down', status: 429 },
      ],
      [
        'a 503 from a proxy',
        () =>
          new Response('<html>Service Unavailable</html>', {
            status: 503,
            headers: { 'Content-Type': 'text/html' },
          }),
        { code: 'OAUTH_RESPONSE_IS_NOT_CONFORM', status: 503 },
      ],
      [
        'a 500 with server_error',
        () => Response.json({ error: 'server_error' }, { status: 500 }),
        { code: 'OAUTH_RESPONSE_IS_NOT_CONFORM', status: 500 },
      ],
      ['a refused connection', () => refused('ECONNREFUSED', false), { code: 'ECONNREFUSED' }],
      ['a refused connection, as Bun reports it', () => refused('ECONNREFUSED', true), { code: 'ECONNREFUSED' }],
      ['a name that does not resolve', () => refused('ENOTFOUND', false), { code: 'ENOTFOUND' }],
      [
        'a timeout',
        request =>
          new Promise<Response>((_, reject) =>
            request.signal.addEventListener('abort', () => reject(request.signal.reason)),
          ),
        { code: 'OAUTH_TIMEOUT' },
      ],
    ];
    for (const [name, answer, failure] of classes)
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
        // The log line says what failed, from the error's codes alone.
        expect(failureOf(w.failures[0])).toEqual(failure);
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
      refreshedElsewhere(w, row);
      return Response.json({ error: 'invalid_grant' }, { status: 400 });
    });
    const refreshed = await w.refresher.refresh(row);
    expect(refreshed.state).toBe('fresh');
    expect(refreshed.state === 'fresh' && JSON.parse(refreshed.row.tokens).access_token).toBe('access-other');
    expect(w.ended).toEqual([]);
    expect(w.pauses).toEqual([]);
  });
  test('an invalid_grant while another process is still storing its refresh waits a moment and uses it', async () => {
    const w = world();
    const row = w.session();
    // The provider already refused the reuse, but the other process has not stored its tokens yet: it does so while
    // this one pauses.
    w.answer(() => Response.json({ error: 'invalid_grant' }, { status: 400 }));
    w.meanwhile(() => refreshedElsewhere(w, row));
    const refreshed = await w.refresher.refresh(row);
    expect(refreshed.state === 'fresh' && JSON.parse(refreshed.row.tokens).access_token).toBe('access-other');
    expect(w.pauses).toEqual([2_000]);
    expect(w.ended).toEqual([]);
  });
  test('tokens another process stored while the provider answered stand', async () => {
    const w = world();
    const row = w.session();
    w.answer(() => {
      refreshedElsewhere(w, row);
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
  test('a failure from outside the library is logged by its name alone', () => {
    expect(failureOf(new RangeError('boom'))).toEqual({ code: 'RangeError' });
    expect(failureOf('boom')).toEqual({ code: 'unknown' });
  });
});
