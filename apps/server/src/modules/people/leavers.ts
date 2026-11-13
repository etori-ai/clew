import type { LeaverChange, LeaversTx } from './ports';

/**
 * One domain the leavers port tells (D108 item 14, D124 item 7): its name, for the report of a call that failed, and its
 * port built on the transaction it is given.
 */
export interface LeaversBinding<T> {
  module: string;
  port: (tx: T) => LeaversTx;
}
/**
 * The leavers port of several domains, each told in a savepoint of its own (`savepoint`, composition: the transaction's
 * nested `transaction`), one after the other in the order given. A domain whose call fails is rolled back to its own
 * savepoint and reported with its name (`failed`), and the next is told all the same: one domain never stops another,
 * and none stops the change of `active` (D113). Pure over `T`, so the unit tests hold it to that without a database.
 */
export function combineLeavers<T>(
  bindings: ReadonlyArray<LeaversBinding<T>>,
  savepoint: (tx: T, fn: (inner: T) => Promise<void>) => Promise<void>,
  failed: (error: unknown, change: LeaverChange, kind: keyof LeaversTx, module: string) => void,
): (tx: T) => LeaversTx {
  return tx => {
    const tell = (kind: keyof LeaversTx) => async (change: LeaverChange) => {
      for (const binding of bindings) {
        try {
          await savepoint(tx, inner => binding.port(inner)[kind](change));
        } catch (error) {
          failed(error, change, kind, binding.module);
        }
      }
    };
    return { deactivated: tell('deactivated'), reactivated: tell('reactivated') };
  };
}
