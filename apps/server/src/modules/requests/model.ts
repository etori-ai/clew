import type { Actor } from '@clew/connectors';
import type { ViewOpen } from '@clew/contracts';

/**
 * The ports of the combined request list (D25, D123): what a person ordered or reported in a service desk and waits
 * for. The sources come from the registry at call time, so a service desk an administrator enables is listed from the
 * next read on; the call handle is the one the registry gives the capability for this run, so scope and the person's
 * delegated token travel with it.
 */
/** `open` is the read a row from this source opens as a view (D38), when the source declares one and the person may call it. */
export interface RequestSourceRef {
  name: string;
  connectorId: string;
  source: string;
  open?: ViewOpen;
}
export type RequestSources = (actor: Actor) => RequestSourceRef[];
export type RequestCall = <O = unknown>(name: string, input?: unknown) => Promise<O>;
export interface RequestBudget {
  /** Milliseconds one system gets before it counts as `timeout`. */
  perSourceMs: number;
  /** Milliseconds the whole fan-out gets; what has answered by then is listed. */
  totalMs: number;
}
export interface RequestDeps {
  sources: RequestSources;
  budget?: Partial<RequestBudget>;
}
/** The errand list's budget: both are sections of Hem read at the same time, and neither holds the other up. */
export const DEFAULT_BUDGET: RequestBudget = { perSourceMs: 4_000, totalMs: 5_000 };
