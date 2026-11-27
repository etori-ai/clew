import type { AboutAction, AboutRead, Actor } from '@clew/connectors';
import type {
  AuthenticatedContext,
  EntityCard,
  EntityKind,
  PersonProfile,
  Subject,
  UnitIdentifier,
} from '@clew/contracts';

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
   * The other units this person leads, for a report who leads units of their own (D147); absent for someone who leads
   * none. The unit they are listed under is not among them: their `role` says whether they lead that one.
   */
  below?: Array<DirectoryUnit & { role: 'manager' | 'employee' }>;
}
export interface DirectoryUnit {
  unitId: string;
  unitLabel: string;
}
/** A person on a unit the reader manages, as Personal lists them (D99). */
export interface ReachPerson extends DirectoryPerson {
  /** Their role on the unit they are listed under: `manager` where they lead it. Absent: unknown. */
  role?: 'manager' | 'employee';
}
/**
 * Where the reader stands: every unit they are assigned to, their reports under the unit of the employment that names
 * the reader as manager, a unit the reader leads being there whether or not it has any (D147), and `above`, who manages
 * the reader: the active managers their own employments name. Nothing of it is read from the tree.
 */
export interface Reach {
  units: Array<DirectoryUnit & { role: 'manager' | 'employee' }>;
  managed: Array<DirectoryUnit & { people: ReachPerson[] }>;
  above: readonly string[];
}
/**
 * The directory (composition: the people module's `staffUsecases`). `person` finds an active person of the reader's
 * organisation by Clew's key, their id (D122), with the unit they act in; undefined when there is no such active person.
 */
export interface Directory {
  reach(persona: AuthenticatedContext): Promise<Reach>;
  person(
    persona: AuthenticatedContext,
    id: string,
    includeProfile: boolean,
  ): Promise<(DirectoryPerson & { unit: DirectoryUnit | null; profile?: PersonProfile }) | undefined>;
  /**
   * What other systems know these units by (D148), for the units of the reader's organisation among those named; a
   * unit that carries none is absent. Asked only for units the reader may be told about (D117).
   */
  unitIdentifiers(persona: AuthenticatedContext, unitIds: readonly string[]): Promise<Map<string, UnitIdentifier[]>>;
}
/**
 * What `people.reports` reads of the directory (composition: the people module's `staffUsecases`): where the reader
 * stands, and the titles of the people on their list, by id (someone without one is absent).
 */
export interface ReportDirectory extends Pick<Directory, 'reach'> {
  titles(persona: AuthenticatedContext, ids: readonly string[]): Promise<ReadonlyMap<string, string>>;
}
/**
 * The person behind a call as the directory reads them (D117): their current grant, built for the actor the registry was
 * handed (composition: `systemContext`); undefined for somebody Clew does not know. Throws when it cannot be read.
 */
export type Reader = (actor: Actor) => Promise<AuthenticatedContext | undefined>;
/**
 * Who holds these user names now in the reader's organisation, active or not, keyed by the name as asked (composition:
 * the people module's `holders`, D122). A name nobody holds, or two people hold, is absent.
 */
export type Holders = (readerId: string, userNames: readonly string[]) => Promise<Map<string, string>>;
/** The ports of the rule of who may be asked about (`relations.ts`, D117). */
export interface RelationDeps {
  directory: Pick<Directory, 'reach' | 'person' | 'unitIdentifiers'>;
  reader: Reader;
  holders: Holders;
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
/** "Behöver dig" (D97 item 5): the reader's cards whose rows name this entity, by Clew's key (D122). */
export type Cards = (persona: AuthenticatedContext, subject: Subject) => Promise<EntityCard[]>;
/** A card of the reader's with the entities it names among those asked, by Clew's key. */
export type NamedCard = EntityCard & { subjects: Subject[] };
/**
 * "Just nu" on the list (D97 item 5): the reader's cards still asking for them whose rows name any of these entities,
 * by Clew's key, read once for the whole list (composition: the thread store's index from entity to cards).
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
