import type { Actor } from '@clew/connectors';
import type { EntityKind, View } from '@clew/contracts';

/**
 * The ports of the read across sources about an entity (D97, D25). The sources come from the registry at call time, so a
 * source an administrator enables answers from the next read on; the call handle is the one the registry gives the
 * capability for this run, so each source's own scope applies to the same person. Who may be asked about is a core rule
 * per entity kind (D97 item 8), filled in composition, so this module imports no other.
 */
export interface AboutSourceRef {
  name: string;
  connectorId: string;
  source: string;
  title: string;
  view: View;
}
export type AboutSources = (actor: Actor, kind: EntityKind) => AboutSourceRef[];
export type AboutCall = <O = unknown>(name: string, input?: unknown) => Promise<O>;
/**
 * The entities of a kind this person may ask about now, by key. For a person: themselves and the people who report to
 * them (D99 item 4), computed when asked. A kind with no rule yet answers nobody.
 */
export type Reach = (actor: Actor, kind: EntityKind) => Promise<ReadonlySet<string>>;
export interface AboutBudget {
  /** Milliseconds one source gets before its section says `timeout`. */
  perSourceMs: number;
  /** Milliseconds the whole fan-out gets; what has answered by then stands. */
  totalMs: number;
}
export interface AboutDeps {
  sources: AboutSources;
  reach: Reach;
  budget?: Partial<AboutBudget>;
}
export const DEFAULT_BUDGET: AboutBudget = { perSourceMs: 4_000, totalMs: 5_000 };
