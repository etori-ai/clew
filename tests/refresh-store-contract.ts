import { describe, expect, test } from 'bun:test';
import {
  projectionVersion,
  type Occurrence,
  type RefreshRequest,
  type RefreshStore,
} from '../apps/server/src/threads/refresh-model';
import { draft } from './store-contract';

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
/** One remembered occurrence of a source's work for the harness's person (D47), on a connector of the test's own. */
export const occurrenceRecord = (
  personId: string,
  connector: string,
  key: string,
  extra: Partial<Occurrence> = {},
): Occurrence => ({
  id: `${personId}:${connector}:${key}`,
  personId,
  connector,
  assignment: 'test:manager',
  sourceKey: `${connector}:item:${key}`,
  period: '2099-11',
  revision: 'r1',
  observedAt: T(0),
  sourceState: 'open',
  disposition: 'visible',
  threadId: null,
  legacy: false,
  ...extra,
});
/**
 * The refresh store's contract for what a request keeps (D47, D26) and what a scan reads and writes in its transaction
 * (DE-M7): one suite over the memory adapter and Postgres. `claim` must only see this harness's person; `requested`
 * lists the `refresh.requested` audit rows of a request id.
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
    test("a scan's occurrences: one request's scope, oldest key first; a save is an upsert, rolled back with its transaction; the open ones of a connector across people", async () => {
      const w = await create(),
        connector = 'contract-' + w.personId.slice(-12),
        request = { ...requestRecord(w.personId, null, T(0)), connector };
      const c = occurrenceRecord(w.personId, connector, 'c'),
        a = occurrenceRecord(w.personId, connector, 'a', { sourceState: 'resolved' }),
        b = occurrenceRecord(w.personId, connector, 'b'),
        elsewhere = occurrenceRecord(w.personId, connector, 'd', { assignment: 'test:employee' }),
        other = occurrenceRecord(w.personId, connector + '-other', 'e');
      await w.store.transaction(async tx => {
        // Written out of order: what is read comes back by id.
        for (const o of [c, a, b, elsewhere, other]) await tx.saveOccurrence(o);
      });
      expect(await w.store.transaction(tx => tx.occurrences(request))).toEqual([a, b, c]);
      expect(await w.store.transaction(tx => tx.occurrences({ ...request, assignment: 'test:employee' }))).toEqual([
        elsewhere,
      ]);
      expect(await w.store.transaction(tx => tx.occurrences({ ...request, personId: w.personId + '-nobody' }))).toEqual(
        [],
      );
      // Saved again: the same id is replaced, never a second row.
      const seen = { ...b, revision: 'r2', observedAt: T(5), sourceState: 'resolved' as const };
      await w.store.transaction(tx => tx.saveOccurrence(seen));
      expect(await w.store.transaction(tx => tx.occurrences(request))).toEqual([a, seen, c]);
      // A throw after the save leaves the occurrence as it was.
      await expect(
        w.store.transaction(async tx => {
          await tx.saveOccurrence({ ...c, disposition: 'dismissed' });
          await tx.saveOccurrence(occurrenceRecord(w.personId, connector, 'f'));
          throw new Error('crash');
        }),
      ).rejects.toThrow('crash');
      expect(await w.store.transaction(tx => tx.occurrences(request))).toEqual([a, seen, c]);
      // The operator's reset reads every open occurrence of the connector, of every assignment, by id; never a resolved one.
      expect(await w.store.transaction(tx => tx.openOccurrences(connector))).toEqual([c, elsewhere]);
      expect(await w.store.transaction(tx => tx.openOccurrences(connector + '-none'))).toEqual([]);
    });
    test("a scan's baseline is the version of each of the person's cards of the request's connector, and a change to a card changes it", async () => {
      const w = await create(),
        connector = 'contract-' + w.personId.slice(-12),
        request = { ...requestRecord(w.personId, null, T(0)), connector };
      const mine = draft(w.personId, { id: w.personId + '-baseline-1', connector }),
        handled = draft(w.personId, { id: w.personId + '-baseline-2', connector }),
        another = draft(w.personId, { id: w.personId + '-baseline-3', connector: connector + '-other' });
      await w.store.transaction(async tx => {
        for (const t of [mine, handled, another]) expect(await tx.insertThread(t)).toBe(true);
        await tx.updateThread(handled.id, { state: 'handled', handledAt: T(1), updatedAt: T(1) });
      });
      const versions = async () =>
        w.store.transaction(async tx =>
          Object.fromEntries(
            await Promise.all(
              [mine.id, handled.id].map(async id => [id, projectionVersion((await tx.lockThread(w.personId, id))!)]),
            ),
          ),
        );
      const before = await w.store.baseline(request);
      expect(before).toEqual(await versions());
      expect(Object.keys(before).sort()).toEqual([mine.id, handled.id].sort());
      expect(await w.store.baseline({ ...request, connector: connector + '-none' })).toEqual({});
      await w.store.transaction(tx => tx.updateThread(mine.id, { waitingOn: 'svar', updatedAt: T(2) }));
      const after = await w.store.baseline(request);
      expect(after[mine.id]).not.toBe(before[mine.id]);
      expect(after[handled.id]).toBe(before[handled.id]);
      expect(after).toEqual(await versions());
    });
    test("a topic's card is the person's newest of that connector and topic, whatever its state; another connector's or person's is not", async () => {
      const w = await create(),
        connector = 'contract-' + w.personId.slice(-12),
        topic = connector + ':file:1';
      const first = draft(w.personId, { id: w.personId + '-topic-1', connector, topic }),
        second = draft(w.personId, {
          id: w.personId + '-topic-2',
          connector,
          topic,
          createdAt: T(10),
          updatedAt: T(10),
        });
      await w.store.transaction(async tx => {
        expect(await tx.findTopic(w.personId, connector, topic)).toBeUndefined();
        await tx.insertThread(first);
        expect((await tx.findTopic(w.personId, connector, topic))?.id).toBe(first.id);
        await tx.updateThread(first.id, { state: 'handled', handledAt: T(5), updatedAt: T(5) });
        expect(await tx.findTopic(w.personId, connector, topic)).toMatchObject({ id: first.id, state: 'handled' });
        await tx.insertThread(second);
      });
      expect(await w.store.transaction(tx => tx.findTopic(w.personId, connector, topic))).toMatchObject({
        id: second.id,
        state: 'open',
        title: second.title,
      });
      expect(await w.store.transaction(tx => tx.findTopic(w.personId, connector + '-other', topic))).toBeUndefined();
      expect(await w.store.transaction(tx => tx.findTopic(w.personId + '-nobody', connector, topic))).toBeUndefined();
    });
  });
}
