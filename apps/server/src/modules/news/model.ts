import type { Actor } from '@clew/connectors';
import type { ViewOpen } from '@clew/contracts';

/**
 * The ports of the combined news list (D25, D111 amended 2026-11-11). The sources come from the registry at call time,
 * so a news source an administrator enables is listed from the next read on; the call handle is the one the registry
 * gives the capability for this run, so scope and the person's delegated token travel with it.
 */
/** `open` is the read a row from this source opens as a view (D38), when the source declares one and the person may call it. */
export interface NewsSourceRef {
  name: string;
  connectorId: string;
  source: string;
  open?: ViewOpen;
}
export type NewsSources = (actor: Actor) => NewsSourceRef[];
export type NewsCall = <O = unknown>(name: string, input?: unknown) => Promise<O>;
export interface NewsBudget {
  /** Milliseconds one news source gets before it contributes nothing. */
  perSourceMs: number;
  /** Milliseconds the whole fan-out gets; what has answered by then is listed. */
  totalMs: number;
}
export interface NewsDeps {
  sources: NewsSources;
  budget?: Partial<NewsBudget>;
}
/** Shorter than the errand list's: news is a block on Hem, and Hem is not held up for it. */
export const DEFAULT_BUDGET: NewsBudget = { perSourceMs: 2_500, totalMs: 3_000 };
