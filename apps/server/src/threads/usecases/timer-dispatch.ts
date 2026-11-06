import type { TimerDelivery, TimerIntent } from '../model';

export function timerDispatcher(deps: {
  store: TimerDelivery;
  deliver: (timer: TimerIntent) => Promise<void>;
  clock: () => Date;
}) {
  return async (limit = 20) => {
    for (let i = 0; i < limit; i++) {
      const at = deps.clock().toISOString();
      const timer = await deps.store.claimTimer(at, new Date(Date.parse(at) + 30_000).toISOString());
      if (!timer) return;
      let error: string | undefined;
      try {
        await deps.deliver(timer);
      } catch {
        error = 'timer-service-unavailable';
      }
      await deps.store.finishTimer(
        timer,
        new Date(deps.clock().getTime() + Math.min(60_000, 1000 * 2 ** Math.min(timer.attempt, 6))).toISOString(),
        error,
      );
    }
  };
}
