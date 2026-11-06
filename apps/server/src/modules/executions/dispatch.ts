import type { ExecutionStore, WatchIntent } from './model';

/** One bounded pass over a durable outbox: claim under a lease, deliver, acknowledge or schedule the retry with backoff. */
function outbox<T extends { id: string; attempt: number }>(deps: { claim: (now: string, until: string) => Promise<T | undefined>; finish: (intent: T, now: string, retryAt: string, error?: string) => Promise<void>; deliver: (intent: T) => Promise<void>; clock: () => Date }) {
  return async function tick(limit = 20) {
    for (let i = 0; i < limit; i++) {
      const now = deps.clock().toISOString();
      const intent = await deps.claim(now, new Date(Date.parse(now) + 30_000).toISOString());
      if (!intent) return;
      let error: string | undefined;
      try { await deps.deliver(intent); } catch { error = 'workflow-service-unavailable'; }
      const at = deps.clock().toISOString(), retry = new Date(Date.parse(at) + Math.min(60_000, 1000 * 2 ** Math.min(intent.attempt, 6))).toISOString();
      await deps.finish(intent, at, retry, error);
    }
  };
}
/** The outbox only delivers committed IDs into Temporal. PostgreSQL remains the durable intent authority. */
export function executionDispatcher({ store, start, clock }: { store: ExecutionStore; start: (id: string, executionId: string) => Promise<void>; clock: () => Date }) {
  return outbox({ claim: store.claimDispatch, finish: (i, now, retryAt, error) => store.finishDispatch(i.id, i.attempt, now, retryAt, error), deliver: i => start(i.id, i.executionId), clock });
}
/** A watch step's committed schedule reaches the `jobWatch` workflow the same way (D55, D47): delivered once, by id, never recomputed. */
export function watchDispatcher({ store, start, clock }: { store: Pick<ExecutionStore, 'claimWatch' | 'finishWatch'>; start: (intent: WatchIntent) => Promise<void>; clock: () => Date }) {
  return outbox({ claim: store.claimWatch, finish: (i, now, retryAt, error) => store.finishWatch(i.id, i.attempt, now, retryAt, error), deliver: start, clock });
}
