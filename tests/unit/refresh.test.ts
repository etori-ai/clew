import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import type { AuthenticatedContext } from '../../packages/contracts/src';
import type { ScanObservation, ThreadDraft } from '../../packages/connectors/src';
import { memoryRefreshStore } from '../../apps/server/src/threads/adapters/refresh-memory';
import { refreshUsecases } from '../../apps/server/src/threads/usecases/refresh';

const actor = { id: 'a', role: 'manager', unitId: 'unit', authorizationVersion: 'v1', async authorize() {} } as unknown as AuthenticatedContext;
const draft = (revision = '1', period = '2026'): ThreadDraft => ({ topic: 'cases', area: 'work', title: 'Uppgift', summary: 'Gör klart', reason: 'Aktuell', actions: [], occurrences: [{ key: 'case:1', revision, period }] });
function world() {
  let now = Date.parse('2026-11-05T12:00:00.000Z'), n = 0, allowed = true;
  let observation: ScanObservation = { drafts: [draft()] };
  const store = memoryRefreshStore(), clock = () => new Date(now), key = (x: unknown) => createHash('sha256').update(JSON.stringify(x)).digest('hex');
  const deps = { store, clock, key, ids: () => `thread${++n}`, current: async () => allowed ? actor : undefined, sources: async () => ['source'], scan: async () => observation };
  const uc = refreshUsecases(deps);
  return { store, uc, deps, clock, set: (drafts: ThreadDraft[], completeness: 'complete' | 'partial' | 'delta' = 'complete') => { observation = { drafts, observation: { scope: 'unit:manager', observedAt: clock().toISOString(), version: String(now), completeness, exhausted: true } }; },
    advance: () => { now += 60_001; }, revoke: () => { allowed = false; } };
}
test('dismissal suppresses unchanged work, a changed revision explains its return, and a new period is distinct', async () => {
  const w = world(); w.set([draft()]); await w.uc.request(actor); await w.uc.tick();
  const first = w.store.threads.dump()[0]!.thread;
  await w.store.threads.transaction(tx => tx.updateThread(first.id, { state: 'dismissed' }));
  w.advance(); w.set([draft()]); await w.uc.tick();
  expect(w.store.threads.dump()).toHaveLength(1); expect(w.store.dump()[0]).toMatchObject({ disposition: 'dismissed', sourceState: 'open' });
  w.advance(); w.set([draft('2')]); await w.uc.tick();
  expect(w.store.threads.dump()[0]!.thread).toMatchObject({ state: 'open', trigger: { reason: 'Källan har ändrat uppgiften. Aktuell' } });
  w.advance(); w.set([draft('1', '2027')]); await w.uc.tick();
  expect(w.store.dump()).toHaveLength(2); expect(w.store.threads.dump()).toHaveLength(2);
  expect(w.store.dump().find(o => o.period === '2026')?.sourceState).toBe('resolved');
});
test('only an exhausted complete snapshot or an explicit tombstone resolves missing work', async () => {
  const w = world(); w.set([draft()]); await w.uc.request(actor); await w.uc.tick();
  w.advance(); w.set([], 'partial'); await w.uc.tick(); expect(w.store.dump()[0]?.sourceState).toBe('open');
  w.advance(); w.set([], 'complete'); await w.uc.tick(); expect(w.store.dump()[0]?.sourceState).toBe('resolved');
  expect(w.store.threads.dump()[0]?.thread.state).toBe('handled');
  expect(w.store.threads.audit.some(a => a.action === 'work.resolved')).toBe(true);
});
test('a scan cannot overwrite an action accepted after its baseline was captured', async () => {
  const w = world(); w.set([draft()]); await w.uc.request(actor); await w.uc.tick();
  w.advance(); const job = (await w.store.claim(w.clock().toISOString(), w.clock().toISOString()))!, baseline = await w.store.baseline(job);
  const t = w.store.threads.dump()[0]!.thread;
  await w.store.threads.transaction(tx => tx.updateThread(t.id, { state: 'handled', receipt: { at: w.clock().toISOString(), headline: 'Klart', rows: [], undoUntil: null, undoCapability: null } }));
  await w.uc.finish(job, baseline, { drafts: [draft('2')] });
  expect(w.store.threads.dump()[0]!.thread).toMatchObject({ state: 'handled', receipt: { headline: 'Klart' } });
  expect(w.store.dump()[0]?.revision).toBe('1');
});
test('concurrent requests coalesce across worker instances; old leases and revoked assignments cannot commit', async () => {
  const w = world(); await Promise.all([w.uc.request(actor), w.uc.request(actor)]);
  const jobs = await Promise.all([w.store.claim(w.clock().toISOString(), new Date(w.clock().getTime() + 1000).toISOString()), w.store.claim(w.clock().toISOString(), new Date(w.clock().getTime() + 1000).toISOString())]);
  expect(jobs.filter(Boolean)).toHaveLength(1);
  w.advance(); const current = (await w.store.claim(w.clock().toISOString(), w.clock().toISOString()))!;
  await w.uc.finish(jobs.find(Boolean)!, {}, { drafts: [draft()] }); expect(w.store.dump()).toEqual([]);
  await w.uc.finish(current, {}, undefined, 'authorization-required'); expect(w.store.dump()).toEqual([]);
  expect((await w.store.statuses(actor.id))[0]?.state).toBe('blocked');
});
test('source reads are independent of requesting refresh and a revoked actor never scans', async () => {
  const w = world(); let scanned = 0;
  const uc = refreshUsecases({ ...w.deps, scan: async () => { scanned++; return new Promise<never>(() => {}); } });
  await uc.request(actor); expect(scanned).toBe(0);
  w.revoke(); await uc.tick(); expect(scanned).toBe(0);
  expect((await w.store.statuses(actor.id))[0]?.error).toBe('authorization-required');
});
