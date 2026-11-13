import { describe, expect, test } from 'bun:test';
import * as oidc from 'openid-client';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import {
  failureOf,
  grantEnded,
  refreshGrant,
  REFRESH_CLAIM_MS,
  sessionRefresher,
  type RefreshRow,
} from '../../apps/server/src/auth-refresh';

/**
 * Refreshing a session's IdP tokens (L1 and L4 of the 2026-11-12 users review). The server's own grant (`refreshGrant`)
 * runs the real openid-client against a token endpoint and a key set that answer what each test says over a fake
 * fetch, with the ID token's signature checked as the server checks it, so every class of failure is the error the
 * library throws for it; the session rows live in a map. Only an ending answer, a changed subject and a row that is
 * gone, unreadable tokens and abandoned ownership end the session; transient provider failures keep it and its tokens,
 * and the refresh says `unavailable`, which delegation
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
  let meanwhile: () => void | Promise<void> = () => undefined;
  let beforeEnd: () => void = () => undefined;
  let claimId = 0;
  let storeFailure = false;
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
  const inactive = new Set<string>();
  const ended: string[] = [];
  const failures: unknown[] = [];
  const replica = () =>
    sessionRefresher<Row>({
      clock: () => now,
      read: async digest => (inactive.has(digest) ? undefined : rows.get(digest)),
      ids: () => 'claim-' + ++claimId,
      async claim(digest, previous, claim) {
        const row = rows.get(digest);
        if (!row || inactive.has(digest) || row.tokens !== previous || row.refreshClaim !== null) return undefined;
        const owned = { ...row, refreshClaim: claim.id, refreshClaimUntil: claim.until };
        rows.set(digest, owned);
        return owned;
      },
      async release(digest, previous, claim) {
        const row = rows.get(digest);
        if (row?.tokens === previous && row.refreshClaim === claim)
          rows.set(digest, { ...row, refreshClaim: null, refreshClaimUntil: null });
      },
      grant: refreshGrant(async () => config),
      ended: grantEnded,
      async store(digest, previous, claim, next) {
        if (storeFailure) throw new Error('database unavailable after the grant');
        const row = rows.get(digest);
        if (!row || inactive.has(digest) || row.tokens !== previous || row.refreshClaim !== claim) return undefined;
        const stored = { ...row, ...next, refreshClaim: null, refreshClaimUntil: null };
        rows.set(digest, stored);
        return stored;
      },
      async end(digest, action, expected) {
        beforeEnd();
        const row = rows.get(digest);
        if (expected && (!row || row.tokens !== expected.tokens || row.refreshClaim !== expected.claim)) return false;
        ended.push(digest + ' ' + action);
        rows.delete(digest);
        return true;
      },
      open: value => JSON.parse(value),
      seal: tokens => JSON.stringify(tokens),
      async sleep(ms) {
        pauses.push(ms);
        await meanwhile();
      },
      failed: error => failures.push(error),
    });
  const refresher = replica();
  /** A session whose access token expires in ten seconds, inside the fifteen-second refresh window. */
  const session = (digest = 's1'): Row => {
    const row = {
      digest,
      personId: 'anna',
      subject: 'sub-anna',
      tokens: sealed('access-1', 'refresh-1'),
      tokenExpiresAt: new Date(now + 10_000),
      refreshClaim: null,
      refreshClaimUntil: null,
    };
    rows.set(digest, row);
    return row;
  };
  return {
    refresher,
    replica,
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
    beforeEnd: (next: () => void) => {
      beforeEnd = next;
    },
    failStore: () => {
      storeFailure = true;
    },
    expire: (digest: string) => inactive.add(digest),
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
    refreshClaim: null,
    refreshClaimUntil: null,
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
        expect(w.pauses).toEqual([]);
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
  test('two independent BFFs share a token generation and never trigger reuse revocation', async () => {
    const w = world();
    const row = w.session();
    const answer = Promise.withResolvers<Response>();
    const entered = Promise.withResolvers<void>();
    const consumed = new Set<string>();
    let revoked = false;
    w.answer(async request => {
      const token = new URLSearchParams(await request.text()).get('refresh_token')!;
      if (revoked || consumed.has(token)) {
        revoked = true;
        return Response.json({ error: 'invalid_grant' }, { status: 400 });
      }
      consumed.add(token);
      entered.resolve();
      return consumed.size === 1
        ? answer.promise
        : Response.json({
            access_token: 'access-3',
            token_type: 'Bearer',
            expires_in: 120,
            refresh_token: 'refresh-3',
          });
    });
    const first = w.refresher.refresh(row);
    await entered.promise;
    w.meanwhile(async () => {
      answer.resolve(
        Response.json({ access_token: 'access-2', token_type: 'Bearer', expires_in: 120, refresh_token: 'refresh-2' }),
      );
      await first;
    });
    const second = w.replica().refresh(row);
    expect((await Promise.all([first, second])).map(r => r.state)).toEqual(['fresh', 'fresh']);
    expect(w.calls).toEqual(['refresh-1']);
    expect(revoked).toBe(false);
    expect(w.pauses).toEqual([2_000]);
    expect(w.ended).toEqual([]);
    w.advance(120_000);
    expect((await w.refresher.refresh(w.rows.get('s1')!)).state).toBe('fresh');
    expect(w.calls).toEqual(['refresh-1', 'refresh-2']);
    expect(revoked).toBe(false);
  });
  test('a live owner keeps the session available locally while delegation waits, without another grant', async () => {
    const w = world(),
      row = w.session();
    w.rows.set(row.digest, { ...row, refreshClaim: 'other', refreshClaimUntil: new Date(w.now() + REFRESH_CLAIM_MS) });
    expect((await w.refresher.refresh(row)).state).toBe('unavailable');
    expect(w.calls).toEqual([]);
    expect(w.ended).toEqual([]);
  });
  test('an abandoned generation ends rather than reusing a refresh token it may have consumed', async () => {
    const w = world(),
      row = w.session();
    w.rows.set(row.digest, { ...row, refreshClaim: 'abandoned', refreshClaimUntil: new Date(w.now() - 1) });
    expect((await w.refresher.refresh(row)).state).toBe('ended');
    expect(w.calls).toEqual([]);
    expect(w.ended).toEqual(['s1 refresh-failed']);
  });
  test('a newer committed generation wins a race with ending an abandoned or refused refresh', async () => {
    for (const abandoned of [false, true]) {
      const w = world(),
        row = w.session();
      if (abandoned)
        w.rows.set(row.digest, { ...row, refreshClaim: 'abandoned', refreshClaimUntil: new Date(w.now() - 1) });
      else w.answer(() => Response.json({ error: 'invalid_grant' }, { status: 400 }));
      w.beforeEnd(() => refreshedElsewhere(w, row));
      const result = await w.refresher.refresh(row);
      expect(result.state).toBe('fresh');
      expect(result.state === 'fresh' && JSON.parse(result.row.tokens).access_token).toBe('access-other');
      expect(w.ended).toEqual([]);
    }
  });
  test('a grant whose answer could not be committed keeps its claim and is never submitted again', async () => {
    const w = world(),
      row = w.session();
    w.failStore();
    await expect(w.refresher.refresh(row)).rejects.toThrow('database unavailable after the grant');
    expect(w.rows.get(row.digest)?.refreshClaim).not.toBeNull();
    w.advance(REFRESH_CLAIM_MS + 1);
    expect((await w.replica().refresh(row)).state).toBe('ended');
    expect(w.calls).toEqual(['refresh-1']);
  });
  test('logout during an owned grant cannot be undone by its late response', async () => {
    const w = world(),
      row = w.session();
    w.answer(() => {
      w.rows.delete(row.digest);
      return Response.json({ access_token: 'late', token_type: 'Bearer', expires_in: 120 });
    });
    expect((await w.refresher.refresh(row)).state).toBe('ended');
    expect(w.rows.has(row.digest)).toBe(false);
  });
  test('expiry during an owned grant is ended with its expiry audit even when the provider answers', async () => {
    const w = world(),
      row = w.session();
    w.answer(() => {
      w.expire(row.digest);
      return Response.json({ access_token: 'late', token_type: 'Bearer', expires_in: 120 });
    });
    expect((await w.refresher.refresh(row)).state).toBe('ended');
    expect(w.ended).toEqual(['s1 expired']);
    expect(w.rows.has(row.digest)).toBe(false);
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
