import type { Actor } from '@clew/connectors';
import type { SearchKind } from '@clew/contracts';

/**
 * The ports of the composite search (D25, D26). The sources come from the registry at call time, so a connector an
 * administrator enables is searched from the next question on; the call handle is the one the registry gives the
 * capability for this run, so scope and, later, the person's delegated token travel with it.
 */
export interface SearchSourceRef { name: string; connectorId: string; source: string; kinds?: SearchKind[] }
export type SearchSources = (actor: Actor) => SearchSourceRef[];
export type SearchCall = <O = unknown>(name: string, input?: unknown) => Promise<O>;
export interface SearchBudget {
  /** Milliseconds one source gets before it counts as `timeout`. */
  perSourceMs: number;
  /** Milliseconds the whole fan-out gets; what has answered by then is merged. */
  totalMs: number;
}
export interface SearchDeps {
  sources: SearchSources;
  clock: () => Date;
  budget?: Partial<SearchBudget>;
}
export const DEFAULT_BUDGET: SearchBudget = { perSourceMs: 3_000, totalMs: 4_000 };
