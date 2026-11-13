import type { Actor } from '@clew/connectors';
import type { SearchKind, ViewOpen } from '@clew/contracts';

/**
 * The ports of the composite search (D25, D26). The sources come from the registry at call time, so a connector an
 * administrator enables is searched from the next question on; the call handle is the one the registry gives the
 * capability for this run, so scope and, later, the person's delegated token travel with it.
 */
/** `open` is the read a hit from this source opens as a view (D38), when the source declares one and the person may call it. */
export interface SearchSourceRef {
  name: string;
  connectorId: string;
  source: string;
  kinds?: SearchKind[];
  open?: ViewOpen;
}
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
  /**
   * Who holds these user names now in the reader's organisation (D119, composition: the people module's user reads): a
   * hit names a person by the source's key, and the list by Clew's. Absent: a hit names no person.
   */
  people?: { holders(readerId: string, userNames: readonly string[]): Promise<Map<string, string>> };
}
export const DEFAULT_BUDGET: SearchBudget = { perSourceMs: 3_000, totalMs: 4_000 };
