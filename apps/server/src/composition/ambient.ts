/**
 * The ambient sources a use case takes through `deps` (D25): the wall clock, random ids and a repeating timer. Only the
 * composition root reads them.
 */
export const clock = () => new Date();
export const ids = () => crypto.randomUUID();
/** Calls `tick` every `ms` until the function it returns is called. It never keeps the process alive on its own. */
export const every = (ms: number, tick: () => void) => {
  const timer = setInterval(tick, ms);
  timer.unref();
  return () => clearInterval(timer);
};
