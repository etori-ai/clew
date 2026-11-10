import { describe, expect, test } from 'bun:test';
import type { RefreshRequest, RefreshStore } from '../apps/server/src/threads/refresh-model';

const T = (seconds: number) => new Date(Date.parse('2099-11-05T09:00:00.000Z') + seconds * 1000).toISOString();
/** One person's request for one source as the refresh use case writes it; `session` is the binding of the session that asks. */
export const requestRecord = (personId: string, session: string | null, at: string): RefreshRequest => ({
  id: personId + ':reference',
  personId,
  connector: 'reference',
  assignment: 'test:manager',
  authorizationVersion: 'v1',
  state: 'pending',
  attempt: 0,
  requestedAt: at,
  nextAt: at,
  leaseUntil: null,
  lastSuccess: null,
  observedAt: null,
  error: null,
  session,
});
/**
 * The refresh store's contract for what a request keeps (D47, D26): one suite over the memory adapter and Postgres.
 * `claim` must only see this harness's person; `requested` lists the `refresh.requested` audit rows of a request id.
 */
export interface RefreshStoreHarness {
  store: RefreshStore;
  personId: string;
  requested(id: string): Promise<Array<Record<string, unknown>>>;
}
export function refreshStoreContract(name: string, create: () => Promise<RefreshStoreHarness>) {
  describe(name + ' refresh store', () => {
    const settle = (w: RefreshStoreHarness, id: string, at: string) =>
      w.store.transaction(async tx => {
        const row = (await tx.lockRequest(id))!;
        await tx.saveRequest({ ...row, state: 'complete', leaseUntil: null, lastSuccess: at, nextAt: T(60) });
      });
    test('a request keeps the session that asked; the same session again changes nothing; another session rebinds a running scan and requeues a settled one at once', async () => {
      const w = await create(),
        first = requestRecord(w.personId, 'synthetic-session-1', T(0));
      await w.store.request(first);
      expect(await w.store.statuses(w.personId)).toEqual([first]);
      await w.store.request(requestRecord(w.personId, 'synthetic-session-1', T(1)));
      expect(await w.requested(first.id)).toHaveLength(1);
      const claimed = await w.store.claim(T(1), T(31));
      expect(claimed).toMatchObject({ id: first.id, state: 'running', session: 'synthetic-session-1' });
      await w.store.request(requestRecord(w.personId, 'synthetic-session-2', T(2)));
      expect((await w.store.statuses(w.personId))[0]).toMatchObject({
        state: 'running',
        requestedAt: T(0),
        session: 'synthetic-session-2',
      });
      await settle(w, first.id, T(3));
      expect((await w.store.statuses(w.personId))[0]).toMatchObject({
        state: 'complete',
        session: 'synthetic-session-2',
      });
      await w.store.request(requestRecord(w.personId, 'synthetic-session-2', T(4)));
      expect((await w.store.statuses(w.personId))[0]).toMatchObject({ state: 'complete', nextAt: T(60) });
      await w.store.request(requestRecord(w.personId, 'synthetic-session-3', T(5)));
      expect((await w.store.statuses(w.personId))[0]).toMatchObject({
        state: 'pending',
        requestedAt: T(5),
        nextAt: T(5),
        session: 'synthetic-session-3',
      });
      const audit = await w.requested(first.id);
      expect(audit).toHaveLength(3);
      expect(audit.every(details => details.session === true && details.connector === 'reference')).toBe(true);
    });
    test('a request without a session never replaces a binding, and the requeue it makes clears it', async () => {
      const w = await create(),
        first = requestRecord(w.personId, 'synthetic-session-1', T(0));
      await w.store.request(first);
      await w.store.claim(T(0), T(30));
      await settle(w, first.id, T(1));
      await w.store.request(requestRecord(w.personId, null, T(10)));
      expect((await w.store.statuses(w.personId))[0]).toMatchObject({
        state: 'complete',
        session: 'synthetic-session-1',
      });
      await w.store.request(requestRecord(w.personId, null, T(61)));
      expect((await w.store.statuses(w.personId))[0]).toMatchObject({ state: 'pending', session: null });
      expect((await w.requested(first.id)).at(-1)).toEqual({ connector: 'reference', assignment: 'test:manager' });
      await w.store.request(requestRecord(w.personId, 'synthetic-session-1', T(62)));
      expect((await w.store.statuses(w.personId))[0]).toMatchObject({
        state: 'pending',
        requestedAt: T(61),
        session: 'synthetic-session-1',
      });
      expect(await w.requested(first.id)).toHaveLength(3);
    });
    test('a request blocked for want of a session is requeued at once when a session asks, with the block cleared; an ask without one waits for the minute', async () => {
      const w = await create(),
        first = requestRecord(w.personId, 'synthetic-session-1', T(0));
      await w.store.request(first);
      await w.store.claim(T(0), T(30));
      await w.store.transaction(async tx => {
        const row = (await tx.lockRequest(first.id))!;
        await tx.saveRequest({
          ...row,
          state: 'blocked',
          error: 'authorization-required',
          leaseUntil: null,
          nextAt: T(60),
        });
      });
      await w.store.request(requestRecord(w.personId, null, T(10)));
      expect((await w.store.statuses(w.personId))[0]).toMatchObject({
        state: 'blocked',
        error: 'authorization-required',
      });
      await w.store.request(requestRecord(w.personId, 'synthetic-session-1', T(11)));
      expect((await w.store.statuses(w.personId))[0]).toMatchObject({
        state: 'pending',
        error: null,
        requestedAt: T(11),
        nextAt: T(11),
        session: 'synthetic-session-1',
      });
      // A source that failed keeps its error until a scan succeeds; only the minute requeues it.
      await w.store.claim(T(11), T(41));
      await w.store.transaction(async tx => {
        const row = (await tx.lockRequest(first.id))!;
        await tx.saveRequest({ ...row, state: 'failed', error: 'unavailable', leaseUntil: null, nextAt: T(71) });
      });
      await w.store.request(requestRecord(w.personId, 'synthetic-session-1', T(12)));
      expect((await w.store.statuses(w.personId))[0]).toMatchObject({ state: 'failed', error: 'unavailable' });
      await w.store.request(requestRecord(w.personId, 'synthetic-session-1', T(72)));
      expect((await w.store.statuses(w.personId))[0]).toMatchObject({ state: 'pending', error: 'unavailable' });
    });
    test('two requests at once coalesce into one stored request and one audit row', async () => {
      const w = await create();
      await Promise.all([
        w.store.request(requestRecord(w.personId, 'synthetic-session-1', T(0))),
        w.store.request(requestRecord(w.personId, 'synthetic-session-1', T(0))),
      ]);
      expect(await w.store.statuses(w.personId)).toHaveLength(1);
      expect(await w.requested(w.personId + ':reference')).toHaveLength(1);
    });
  });
}
