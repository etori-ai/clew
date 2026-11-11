import type { AuthenticatedContext, CompetenceEvidence, CompetenceKind, StaffOverview } from '@clew/contracts';

/**
 * The ports of the competence module (D108, D25): the catalogue of competence types and the holdings people have of
 * them. A certificate and a competence are one record, a holding (item 1). Everything a use case reads and writes
 * happens inside one `CompetenceStore` transaction together with its audit row. `adapters/postgres.ts` runs in the
 * server, `adapters/memory.ts` in the unit tests, both held to one store contract. Who reports to whom comes in as a
 * function filled in composition, so the module does not import the people module.
 *
 * Every instant is an ISO string and every date a `YYYY-MM-DD` calendar day in Swedish time, both handed in by the use
 * case from `clock`; every id comes from `ids`. Where a holding stands (valid, expiring, expired) is never stored: the
 * domain computes it from the dates when asked (item 4). No audit entry carries a person's name or a type's name.
 */

/** One row of the catalogue (D108 item 2). Rows per installation, never an enumeration in code. */
export interface TypeRecord {
  id: string;
  organisationId: string;
  /** Swedish, as a person reads it. Unique among the organisation's types that are not archived, without regard to case. */
  name: string;
  area: string;
  kind: CompetenceKind;
  /** The employer's rule (item 3): a holding without a date of the issuer's ends this many months after it was issued. */
  validityMonths: number | null;
  /** Archived, never deleted: an archived type takes no new holdings and keeps the ones it has. */
  archivedAt: string | null;
  /** The actor that added it: a person's principal id, or an operator's such as `operator:cli`. */
  createdBy: string;
  createdAt: string;
}
export type TypePatch = Partial<Pick<TypeRecord, 'name' | 'area' | 'kind' | 'validityMonths' | 'archivedAt'>>;
/**
 * A holding's state as stored (D108 items 7 and 9). `pending` and `rejected` belong to a person's own registration and
 * `system` evidence to a row copied from a source; neither is written yet, and the store takes them so the table does
 * not change shape when they are.
 */
export type HoldingState = 'pending' | 'valid' | 'rejected' | 'revoked';
/** What one person holds of one type (D108 item 1). */
export interface HoldingRecord {
  id: string;
  personId: string;
  typeId: string;
  issuedOn: string;
  /** The issuer's own end date (item 3), stored and never recomputed. Null: the type's rule decides, when it has one. */
  expiresOn: string | null;
  evidence: CompetenceEvidence;
  state: HoldingState;
  /** The manager who registered it; null once that person was erased. */
  registeredBy: string | null;
  createdAt: string;
  revokedAt: string | null;
  revokedBy: string | null;
}
export type HoldingPatch = Partial<Pick<HoldingRecord, 'state' | 'revokedAt' | 'revokedBy'>>;
/** A person as the domain needs them: to key a row on the user name and to name them to the reader. */
export interface PersonRef {
  id: string;
  organisationId: string;
  name: string;
  /** Null for a person provisioned without one. */
  userName: string | null;
}
/** One audit row, written in the same transaction as the change. Metadata only: ids, dates, counts and kinds. */
export interface CompetenceAudit {
  actor: string;
  action: string;
  subject: string;
  at: string;
  details?: Record<string, unknown>;
}
/** What `CompetenceTx.erasePerson` did (D108 item 14). */
export interface Erased {
  /** Holdings removed because they were the person's own. */
  holdings: number;
  /** Other people's holdings from which the person was removed (registered by, revoked by). */
  cleared: number;
}
/** The whole domain for one organisation (D108 item 14); the use case turns it into `clew.competence/1`. */
export interface CompetenceExport {
  types: TypeRecord[];
  holdings: HoldingRecord[];
}

/** The store's refusal of a type name the organisation already uses; the use case turns it into what the person reads. */
export class TypeNameTaken extends Error {
  constructor() {
    super('The organisation already has a competence type with this name.');
    this.name = 'TypeNameTaken';
  }
}

/** Everything a competence use case reads and writes in one transaction. Reads that a write follows take a row lock. */
export interface CompetenceTx {
  // The catalogue.
  /** The organisation's types by area and name in Swedish order; archived ones only when asked for. */
  types(organisationId: string, options?: { archived?: boolean }): Promise<TypeRecord[]>;
  /** One type, locked. */
  type(id: string): Promise<TypeRecord | undefined>;
  /** These types, archived ones included; an unknown id is absent. */
  typesById(ids: readonly string[]): Promise<TypeRecord[]>;
  /**
   * Insert a type. A name another type of the organisation that is not archived already has, without regard to case, is
   * refused with `TypeNameTaken`.
   */
  insertType(type: TypeRecord): Promise<void>;
  /** Change a type; the same name rule as `insertType`. An unknown id changes nothing. */
  updateType(id: string, patch: TypePatch): Promise<void>;
  // Holdings.
  /** Every holding of these people, oldest first, whatever its state. */
  holdingsOf(personIds: readonly string[]): Promise<HoldingRecord[]>;
  /** Every holding of this type, oldest first, whatever its state. */
  holdingsOfType(typeId: string): Promise<HoldingRecord[]>;
  /** One holding, locked. */
  holding(id: string): Promise<HoldingRecord | undefined>;
  insertHolding(holding: HoldingRecord): Promise<void>;
  updateHolding(id: string, patch: HoldingPatch): Promise<void>;
  // People.
  /** These people as the domain names them; an unknown id is absent. */
  persons(ids: readonly string[]): Promise<PersonRef[]>;
  // Erasure and export (D108 item 14).
  /** Remove the person's holdings and remove them from other people's (null `registeredBy`, `revokedBy`). */
  erasePerson(personId: string): Promise<Erased>;
  /** Every type of the organisation, archived included, and every holding of them. */
  exportOrganisation(organisationId: string): Promise<CompetenceExport>;
  audit(entry: CompetenceAudit): Promise<void>;
}
export interface CompetenceStore {
  transaction<T>(fn: (tx: CompetenceTx) => Promise<T>): Promise<T>;
}

/**
 * The manager's reports (D99 item 4), from the assignments and the tree when asked, never stored. Someone who manages
 * no unit gets `{ units: [] }`: composition maps the people module's refusal to that, so this module decides what a
 * non-manager is refused with and never imports another module's error.
 */
export type Staff = (persona: AuthenticatedContext) => Promise<StaffOverview>;
export interface CompetenceDeps {
  store: CompetenceStore;
  staff: Staff;
  clock: () => Date;
  ids: () => string;
}
