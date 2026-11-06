import type { ExecutionStore } from './model';

/** The outbox only delivers committed IDs into Temporal. PostgreSQL remains the durable intent authority. */
export function executionDispatcher({
  store,
  start,
  clock,
}: {
  store: ExecutionStore;
  start: (id: string, executionId: string) => Promise<void>;
  clock: () => Date;
}) {
  return async function tick(limit = 20) {
    for (let i = 0; i < limit; i++) {
      const now = clock().toISOString();
      const intent = await store.claimDispatch(now, new Date(Date.parse(now) + 30_000).toISOString());
      if (!intent) return;
      let error: string | undefined;
      try {
        await start(intent.id, intent.executionId);
      } catch {
        error = 'workflow-service-unavailable';
      }
      const at = clock().toISOString(),
        retry = new Date(Date.parse(at) + Math.min(60_000, 1000 * 2 ** Math.min(intent.attempt, 6))).toISOString();
      await store.finishDispatch(intent.id, intent.attempt, at, retry, error);
    }
  };
}
