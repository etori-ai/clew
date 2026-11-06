/** Fail closed for business requests, but recover automatically when a startup dependency returns. */
export function startupReadiness(deps: {
  initialize: () => Promise<void>;
  onReady: () => void;
  onError: (error: unknown) => void;
  retry: (run: () => void) => void;
}) {
  let ready = false;
  let pending: Promise<void> | undefined;
  const start = (): Promise<void> => {
    if (ready) return Promise.resolve();
    if (pending) return pending;
    pending = Promise.resolve()
      .then(deps.initialize)
      .then(() => {
        ready = true;
        deps.onReady();
      })
      .catch(error => {
        deps.onError(error);
        if (!ready)
          deps.retry(() => {
            void start();
          });
      })
      .finally(() => {
        pending = undefined;
      });
    return pending;
  };
  return { start, ready: () => ready };
}
