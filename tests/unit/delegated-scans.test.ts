import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { memoryRefreshStore } from '../../apps/server/src/threads/adapters/refresh-memory';
import { refreshUsecases } from '../../apps/server/src/threads/usecases/refresh';
import { PRESENCE_MS } from '../../apps/server/src/threads/refresh-model';
import { delegatingHello, fromGrant, sessionDesk, signedIn } from '../session-desk';

/*
 * A scan of a connector that acts as the person (D26) runs with the token of the signed-in session that asked for the
 * refresh, while that session is active, is theirs, and they have been active in it within `PRESENCE_MS` (D100: work
 * reaches a person through an open page). Without one the registry answers `authorization-required` without calling the
 * connector, the request is blocked, and the cards already there stay as they were. `sessionDesk` stands in for
 * `standingSession` in `auth.ts`; the scan is wired as `composition/refresh.ts` wires it.
 */
/** `start`: the scenario's clock. The fixture stamps its observation with the wall clock, and a refresh refuses one from the future (D47), so it defaults to now. */
function world(start = Date.now()) {
  const desk = sessionDesk(),
    { registry, calls } = delegatingHello(),
    store = memoryRefreshStore();
  let now = start,
    n = 0;
  const uc = refreshUsecases({
    store,
    clock: () => new Date(now),
    ids: () => 'thread' + ++n,
    key: x => createHash('sha256').update(JSON.stringify(x)).digest('hex'),
    current: async id => fromGrant(id, 'system:refresh'),
    sources: async () => ['hello'],
    system: () => 'Hello',
    scan: (p, id) => registry.scanOne(p, id, p.delegate ? { delegate: p.delegate } : {}),
    session: desk.find,
  });
  const scans = () => calls.filter(c => c.path === '/clew/scan');
  const audit = (action: string) => store.threads.audit.filter(a => a.action === action);
  const at = () => new Date(now).toISOString();
  return {
    desk,
    store,
    uc,
    scans,
    audit,
    /** Sign in now: the session's last activity is its sign-in. */
    signIn: (binding: string, personId = 'hillevi', token?: string | null) =>
      desk.signIn(binding, personId, token === undefined ? 'token-of-' + binding : token, at()),
    /** The page reports activity in the session now (`POST /api/auth/activity`). */
    touch: (binding: string) => desk.touch(binding, at()),
    advance: (ms = 60_001) => (now += ms),
  };
}

test("a scan the person's live session asked for runs with that session's token and yields their cards", async () => {
  const w = world();
  w.signIn('session-1');
  await w.uc.request(signedIn(w.desk, 'session-1'));
  expect(w.store.requests()[0]).toMatchObject({ connector: 'hello', state: 'pending', session: 'session-1' });
  expect(await w.uc.tick()).toBe(true);
  expect(w.scans()).toEqual([{ path: '/clew/scan', token: 'token-of-session-1', operationId: null }]);
  expect(w.desk.tokens.every(t => t.binding === 'session-1' && t.audience === 'nextcloud')).toBe(true);
  const [card] = w.store.threads.dump();
  expect(card?.thread).toMatchObject({ connector: 'hello', topic: expect.stringContaining('hello:open-items') });
  expect(w.store.requests()[0]).toMatchObject({ state: 'complete', error: null });
  expect(w.audit('refresh.requested')[0]).toMatchObject({
    actor: 'person:hillevi',
    details: { connector: 'hello', session: true },
  });
  expect(w.audit('refresh.completed')[0]).toMatchObject({
    actor: 'system:refresh',
    details: { connector: 'hello', count: 1, session: true },
  });
  expect(JSON.stringify(w.store.threads.audit)).not.toContain('session-1');
});

test('without a live session the scan is authorization-required: the source is not called, the request is blocked and the cards stay', async () => {
  const w = world();
  w.signIn('session-1');
  await w.uc.request(signedIn(w.desk, 'session-1'));
  await w.uc.tick();
  const before = w.store.threads.dump();
  expect(before).toHaveLength(1);
  w.desk.end('session-1');
  w.advance();
  expect(await w.uc.tick()).toBe(true);
  expect(w.scans()).toHaveLength(1);
  expect(w.store.requests()[0]).toMatchObject({ state: 'blocked', error: 'authorization-required' });
  expect(w.store.threads.dump()).toEqual(before);
  expect(w.store.dump().every(o => o.sourceState === 'open')).toBe(true);
  expect(w.audit('work.resolved')).toEqual([]);
  expect(w.audit('thread.source_resolved')).toEqual([]);
  expect(w.audit('refresh.failed').at(-1)).toMatchObject({
    details: { reason: 'authorization-required', connector: 'hello' },
  });
  // A blocked request waits; the person's next session to ask requeues it at once and stands behind the scan.
  w.advance();
  expect(await w.uc.tick()).toBe(false);
  w.signIn('session-2');
  await w.uc.request(signedIn(w.desk, 'session-2'));
  expect(w.store.requests()[0]).toMatchObject({ state: 'pending', session: 'session-2' });
  await w.uc.tick();
  expect(w.scans().at(-1)).toMatchObject({ token: 'token-of-session-2' });
  expect(w.store.requests()[0]).toMatchObject({ state: 'complete' });
  expect(w.store.threads.dump()).toHaveLength(1);
});

test('a request without a session, like the nightly scan, scans nothing as the person', async () => {
  const w = world();
  w.signIn('session-1');
  await w.uc.request(fromGrant('hillevi', 'system:scan'));
  expect(w.store.requests()[0]).toMatchObject({ session: null });
  await w.uc.tick();
  expect(w.scans()).toEqual([]);
  expect(w.desk.tokens).toEqual([]);
  expect(w.store.requests()[0]).toMatchObject({ state: 'blocked', error: 'authorization-required' });
  expect(w.store.threads.dump()).toEqual([]);
});

test("another person's session never stands behind a scan", async () => {
  const w = world();
  w.signIn('session-1');
  w.signIn('session-of-mikael', 'mikael');
  await w.uc.request(signedIn(w.desk, 'session-1'));
  await w.store.transaction(async tx => {
    const row = (await tx.lockRequest(w.store.requests()[0]!.id))!;
    await tx.saveRequest({ ...row, session: 'session-of-mikael' });
  });
  await w.uc.tick();
  expect(w.scans()).toEqual([]);
  expect(w.desk.tokens).toEqual([]);
  expect(w.store.requests()[0]).toMatchObject({ state: 'blocked', error: 'authorization-required' });
});

test('a session without IdP tokens yields no scan', async () => {
  const w = world();
  w.signIn('session-1', 'hillevi', null);
  await w.uc.request(signedIn(w.desk, 'session-1'));
  await w.uc.tick();
  expect(w.scans()).toEqual([]);
  expect(w.store.requests()[0]).toMatchObject({ state: 'blocked', error: 'authorization-required' });
});

test('a person active in the session within the window is scanned for in the background', async () => {
  const w = world();
  w.signIn('session-1');
  await w.uc.request(signedIn(w.desk, 'session-1'));
  await w.uc.tick();
  // No further activity: a completed request is scanned again each minute while the sign-in is within the window.
  w.advance(PRESENCE_MS - 60_000);
  expect(await w.uc.tick()).toBe(true);
  expect(w.scans().map(s => s.token)).toEqual(['token-of-session-1', 'token-of-session-1']);
  expect(w.store.requests()[0]).toMatchObject({ state: 'complete', error: null });
  expect(w.audit('refresh.completed').map(a => a.details?.session)).toEqual([true, true]);
});

test('a person idle in the session beyond the window is not scanned as: blocked, the connector not called, the cards untouched', async () => {
  const w = world();
  w.signIn('session-1');
  await w.uc.request(signedIn(w.desk, 'session-1'));
  await w.uc.tick();
  const cards = w.store.threads.dump(),
    tokens = w.desk.tokens.length,
    lastSuccess = w.store.requests()[0]!.lastSuccess;
  w.advance(PRESENCE_MS + 1000);
  expect(await w.uc.tick()).toBe(true);
  expect(w.scans()).toHaveLength(1);
  expect(w.desk.tokens).toHaveLength(tokens);
  expect(w.store.requests()[0]).toMatchObject({ state: 'blocked', error: 'authorization-required', lastSuccess });
  expect(w.store.threads.dump()).toEqual(cards);
  expect(w.store.dump().every(o => o.sourceState === 'open')).toBe(true);
  expect(w.audit('work.resolved')).toEqual([]);
  expect(w.audit('thread.source_resolved')).toEqual([]);
  expect(w.audit('refresh.failed').at(-1)).toMatchObject({
    actor: 'system:refresh',
    details: { reason: 'authorization-required', connector: 'hello', session: 'idle' },
  });
  // Read without an ask, the status says blocked; nothing claims it again until someone asks.
  expect(await w.uc.statuses(signedIn(w.desk, 'session-1'))).toEqual([
    { connector: 'hello', state: 'blocked', lastSuccess, error: 'authorization-required' },
  ]);
  w.advance(10 * 60_000);
  expect(await w.uc.tick()).toBe(false);
  expect(w.scans()).toHaveLength(1);
});

test('a person who comes back is scanned for on their next ask at once, and the page reads no failure meanwhile', async () => {
  const w = world();
  w.signIn('session-1');
  await w.uc.request(signedIn(w.desk, 'session-1'));
  await w.uc.tick();
  const lastSuccess = w.store.requests()[0]!.lastSuccess;
  w.advance(PRESENCE_MS + 1000);
  await w.uc.tick();
  expect(w.store.requests()[0]).toMatchObject({ state: 'blocked' });
  // Back within the blocked scan's minute: the page asks (a focus refetch) before its first activity report lands.
  w.advance(5000);
  await w.uc.request(signedIn(w.desk, 'session-1'));
  expect(await w.uc.statuses(signedIn(w.desk, 'session-1'))).toEqual([
    { connector: 'hello', state: 'pending', lastSuccess, error: null },
  ]);
  await w.uc.tick();
  expect(w.scans()).toHaveLength(1);
  expect(w.store.requests()[0]).toMatchObject({ state: 'blocked' });
  // The activity report lands and the page asks again, still inside that minute: the scan runs at once.
  w.advance(5000);
  w.touch('session-1');
  await w.uc.request(signedIn(w.desk, 'session-1'));
  expect(await w.uc.statuses(signedIn(w.desk, 'session-1'))).toEqual([
    { connector: 'hello', state: 'pending', lastSuccess, error: null },
  ]);
  await w.uc.tick();
  expect(w.scans().map(s => s.token)).toEqual(['token-of-session-1', 'token-of-session-1']);
  expect(w.store.requests()[0]).toMatchObject({ state: 'complete', error: null });
  expect(w.store.threads.dump()).toHaveLength(1);
});

test('a scan refused for want of a present session is blocked, never stale, even when the last observation is stamped later', async () => {
  // A fixed clock far ahead of the wall clock, and a stored observation stamped by it: a source whose clock runs ahead.
  // The registry stamps the refusal it answers with the wall clock, so the refusal is older than what is stored.
  for (const away of ['idle', 'signed out'] as const) {
    const w = world(Date.parse('2099-06-01T09:00:00.000Z'));
    w.signIn('session-1');
    await w.uc.request(signedIn(w.desk, 'session-1'));
    await w.uc.tick();
    const id = w.store.requests()[0]!.id;
    await w.store.transaction(async tx => {
      const row = (await tx.lockRequest(id))!;
      await tx.saveRequest({ ...row, observedAt: '2099-06-01T09:00:00.000Z' });
    });
    const cards = w.store.threads.dump(),
      occurrences = w.store.dump(),
      tokens = w.desk.tokens.length;
    if (away === 'signed out') w.desk.end('session-1');
    w.advance(PRESENCE_MS + 1000);
    expect(await w.uc.tick()).toBe(true);
    expect(w.store.requests()[0]).toMatchObject({
      state: 'blocked',
      error: 'authorization-required',
      observedAt: '2099-06-01T09:00:00.000Z',
    });
    expect(w.scans()).toHaveLength(1);
    expect(w.desk.tokens).toHaveLength(tokens);
    expect(w.store.threads.dump()).toEqual(cards);
    expect(w.store.dump()).toEqual(occurrences);
    expect(w.audit('refresh.failed').at(-1)).toMatchObject({
      details: {
        reason: 'authorization-required',
        connector: 'hello',
        ...(away === 'idle' ? { session: 'idle' } : {}),
      },
    });
  }
});
