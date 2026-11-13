import type { AboutAction, AboutRead, Actor } from '@clew/connectors';
import type { AuthenticatedContext, EntityCard, EntityKind, PersonProfile, Subject } from '@clew/contracts';

/**
 * The ports of the entities module (D25, D97). Nothing here stores anything about a person: the directory, the sources
 * and the cards are read on every call, so a change of unit, an administrator's choice or a revoked grant shows from the
 * next read on.
 */

/** A person as the directory holds them: Clew's id, the name, and the user name another system knows them by. */
export interface DirectoryPerson {
  id: string;
  name: string;
  /** Null for a person provisioned without one; such a person cannot be asked about (D97). */
  userName: string | null;
  enabled: boolean;
  /**
   * Set for a person who reports to the unit from a unit below it (D99) rather than being placed on it: the units below
   * that they lead or are placed on.
   */
  below?: Array<DirectoryUnit & { role: 'manager' | 'employee' }>;
}
export interface DirectoryUnit {
  unitId: string;
  unitLabel: string;
}
/** A person on a unit the reader manages, as Personal lists them (D99). */
export interface ReachPerson extends DirectoryPerson {
  /** Their role on the unit itself; for someone who reports to it from below, the role they hold there. Absent: unknown. */
  role?: 'manager' | 'employee';
}
/**
 * Where the reader stands: every unit they are assigned to, the units they manage with the people Personal lists on
 * them except the reader, and their place on D99's line. `above`: who manages the reader, the other leaders of the
 * nearest led unit above a unit they manage or of a unit they are placed on. `lineReports`: the co-managers of a unit
 * the reader manages whose line runs to a unit above it that the reader leads too. Personal lists everyone placed on a
 * managed unit, co-managers included; who reports to the reader is narrower (`reportsTo`).
 */
export interface Reach {
  units: Array<DirectoryUnit & { role: 'manager' | 'employee' }>;
  managed: Array<DirectoryUnit & { people: ReachPerson[] }>;
  above: readonly string[];
  lineReports: readonly string[];
}
/**
 * The directory (composition: the people module's `staffUsecases`). `person` finds an active person of the reader's
 * organisation by user name without regard to case, with the unit they act in; undefined when there is no such active
 * person.
 */
export interface Directory {
  reach(persona: AuthenticatedContext): Promise<Reach>;
  person(
    persona: AuthenticatedContext,
    userName: string,
    includeProfile: boolean,
  ): Promise<(DirectoryPerson & { unit: DirectoryUnit | null; profile?: PersonProfile }) | undefined>;
}
/**
 * The person behind a call as the directory reads them (D117): their current grant, built for the actor the registry was
 * handed (composition: `systemContext`); undefined for somebody Clew does not know. Throws when it cannot be read.
 */
export type Reader = (actor: Actor) => Promise<AuthenticatedContext | undefined>;
/** The ports of the rule of who may be asked about (`relations.ts`, D117). */
export interface RelationDeps {
  directory: Pick<Directory, 'reach' | 'person'>;
  reader: Reader;
}
/** The reads and actions about an entity kind this person may call now (composition: `registry.aboutReads`/`aboutActions`). */
export interface Sources {
  reads(actor: Actor, kind: EntityKind): Promise<AboutRead[]>;
  actions(actor: Actor, kind: EntityKind): Promise<AboutAction[]>;
}
/**
 * One read of a source as the person, through the registry's call path: scope re-checked, input and output validated,
 * and `signal` cancels what still runs when the budget ends (D75).
 */
export type SourceRead = (
  persona: AuthenticatedContext,
  capability: string,
  input: { keys: string[] },
  signal: AbortSignal,
) => Promise<unknown>;
/** "Behöver dig" (D97 item 5): the reader's cards whose rows name this entity. */
export type Cards = (persona: AuthenticatedContext, subject: Subject) => Promise<EntityCard[]>;
/** A card of the reader's with the entities it names among those asked, in the asked spelling. */
export type NamedCard = EntityCard & { subjects: Subject[] };
/**
 * "Just nu" on the list (D97 item 5): the reader's cards still asking for them whose rows name any of these entities,
 * read once for the whole list (composition: the thread store's index from entity to cards).
 */
export type CardsNaming = (persona: AuthenticatedContext, subjects: Subject[]) => Promise<NamedCard[]>;
export interface EntityBudget {
  /** Milliseconds one source gets for all its calls on one request; what has not answered by then is `timeout`. */
  totalMs: number;
  /** How many calls of one source run at once when the keys are more than one call takes. */
  concurrency: number;
}
export interface EntityDeps {
  directory: Directory;
  sources: Sources;
  read: SourceRead;
  cards: Cards;
  /** Absent: the list counts no cards (`attention` is empty). */
  cardsNaming?: CardsNaming;
  budget?: Partial<EntityBudget>;
  /** A source that failed or answered out of shape, by capability and outcome; never a key or a row. */
  log?: (message: string, ...details: unknown[]) => void;
}
export const DEFAULT_BUDGET: EntityBudget = { totalMs: 4_000, concurrency: 4 };
