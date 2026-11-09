import type { Actor } from '@clew/connectors';
import type { ViewOpen } from '@clew/contracts';

/**
 * The ports of the combined errand list (D25, D35 item 4, D89). The sources come from the registry at call time, so a
 * case system an administrator enables is listed from the next read on; the call handle is the one the registry gives
 * the capability for this run, so scope and the person's delegated token travel with it.
 */
/** `open` is the read a row from this source opens as a view (D38), when the source declares one and the person may call it. */
export interface ErrandSourceRef {
  name: string;
  connectorId: string;
  source: string;
  open?: ViewOpen;
}
export type ErrandSources = (actor: Actor) => ErrandSourceRef[];
export type ErrandCall = <O = unknown>(name: string, input?: unknown) => Promise<O>;
export interface ErrandBudget {
  /** Milliseconds one case system gets before it counts as `timeout`. */
  perSourceMs: number;
  /** Milliseconds the whole fan-out gets; what has answered by then is listed. */
  totalMs: number;
}
export interface ErrandDeps {
  sources: ErrandSources;
  budget?: Partial<ErrandBudget>;
}
export const DEFAULT_BUDGET: ErrandBudget = { perSourceMs: 4_000, totalMs: 5_000 };
