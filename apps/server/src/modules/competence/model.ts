import type {
  AuthenticatedContext,
  CompetenceEvidence,
  CompetenceKind,
  CompetenceReadCounts,
  CompetenceReadOutcome,
  Holding,
  HoldingsOutput,
  HoldingsRow,
  StaffOverview,
} from '@clew/contracts';

/**
 * The ports of the competence module (D108, D25): the catalogue of competence types and the holdings people have of
 * them. A certificate and a competence are one record, a holding (item 1). Everything a use case reads and writes
 * happens inside one `CompetenceStore` transaction together with its audit row. `adapters/postgres.ts` runs in the
 * server, `adapters/memory.ts` in the unit tests, both held to one store contract. Who reports to whom comes in as a
 * function filled in composition, so the module does not import the people module, and so do the sources whose
 * holdings are copied in (`HoldingsPort`, item 9), so it imports no connector and not the registry.
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
 * A holding's state as stored (D108 items 7 and 9). `pending` and `rejected` belong to a person's own registration,
 * which is not written yet; the store takes them so the table does not change shape when it is.
 */
export type HoldingState = 'pending' | 'valid' | 'rejected' | 'revoked';
/**
 * Where a copied row came from (D108 item 9): the connector, the source's own row id (unique per connector, so a read
 * can be repeated), the source's type id and its label as the source says it, and when the row was last read. A copied
 * row is never changed in Clew by a person.
 */
export interface HoldingCopy {
  connectorId: string;
  sourceId: string;
  sourceType: string;
  sourceLabel: string;
  readAt: string;
}
/** What one person holds of one type (D108 item 1). */
export interface HoldingRecord {
  id: string;
  personId: string;
  /** The catalogue type. Null only on a copied row whose source type no administrator has mapped (item 9). */
  typeId: string | null;
  issuedOn: string;
  /** The issuer's own end date (item 3), stored and never recomputed. Null: the type's rule decides, when it has one. */
  expiresOn: string | null;
  evidence: CompetenceEvidence;
  state: HoldingState;
  /** The manager who registered it; null once that person was erased, and always on a copied row. */
  registeredBy: string | null;
  createdAt: string;
  revokedAt: string | null;
  revokedBy: string | null;
  /** Set on a row copied from a source (evidence `system`), null on one registered in Clew. */
  copy: HoldingCopy | null;
}
export type HoldingPatch = Partial<Pick<HoldingRecord, 'state' | 'revokedAt' | 'revokedBy'>>;
/** A source's type mapped to the catalogue for one organisation (D108 item 9). `mappedBy` is an actor string. */
export interface SourceMapping {
  connectorId: string;
  organisationId: string;
  sourceType: string;
  typeId: string;
  mappedBy: string;
  mappedAt: string;
}
/**
 * One source the copy reads (D108 item 9): the read under way as a lease (`run`, `claimedAt`, `leaseUntil`, all null
 * while none is), and the last read that finished (`startedAt` to `finishedAt` with its outcome and counts, all null
 * before the first). Counts only: never a name or a key.
 */
export interface SourceRecord {
  connectorId: string;
  /** The system's name as a person reads it, as it was when last claimed. */
  source: string;
  run: string | null;
  claimedAt: string | null;
  leaseUntil: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  outcome: CompetenceReadOutcome | null;
  counts: SourceReadCounts | null;
}
/**
 * What the last read did, in counts only: the keys that matched nobody (they belong to no organisation), the whole
 * read's counts, and each organisation's own, which is all its administrators are shown (D108 item 9).
 */
export interface SourceReadCounts {
  unmatched: number;
  total: CompetenceReadCounts;
  organisations: Record<string, CompetenceReadCounts>;
}
/** How many copied holdings of one organisation's active people carry a source's type, and the label they carry. */
export interface SourceTypeCount {
  connectorId: string;
  sourceType: string;
  label: string;
  holdings: number;
}
/** A durable workflow start committed with the transaction that decides it (D86); the memory store records it. */
export interface WorkflowStart {
  workflow: string;
  id: string;
  input: unknown;
}
/**
 * A person as the domain needs them: to key a row on the user name, to name them to the reader, and to erase only a
 * person the source has deactivated (D123 item 3).
 */
export interface PersonRef {
  id: string;
  organisationId: string;
  name: string;
  /** Null for a person provisioned without one. */
  userName: string | null;
  /** False once the source has deactivated the person (D68 item 1). */
  enabled: boolean;
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
/**
 * The whole domain for one organisation (D108 item 14), copied rows and the mappings of sources included; the use case
 * turns it into `clew.competence/2`.
 */
export interface CompetenceExport {
  types: TypeRecord[];
  holdings: HoldingRecord[];
  mappings: SourceMapping[];
}
/** What `CompetenceTx.forgetSource` removed (D108 item 9). */
export interface Forgotten {
  holdings: number;
  mappings: number;
}

/** The store's refusal of a type name the organisation already uses; the use case turns it into what the person reads. */
export class TypeNameTaken extends Error {
  constructor() {
    super('The organisation already has a competence type with this name.');
    this.name = 'TypeNameTaken';
  }
}

/**
 * The cards the competence scan put in a person's own stream (D108 item 12), such as "HLR gick ut 1 juni". Composition
 * implements it over the thread store's transaction, which the competence transaction shares, so an erasure removes the
 * cards with the holdings or nothing at all. Held to the same behaviour on both adapters by the store contract.
 */
export interface CompetenceCardsTx {
  /**
   * Remove every card of the competence connector in the person's own stream, with what hangs on it, and write one
   * `thread.removed` row for each by `actor` at `at` (`details: { reason: 'erasure' }`); how many. Another connector's
   * card of theirs and someone else's competence card stay.
   */
  removeOwn(personId: string, actor: string, at: string): Promise<number>;
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
  // Rows copied from a source (D108 item 9).
  /**
   * Every row copied from this connector, whatever its state. Not locked row by row: the copy's write and a mapping
   * of the connector's types both lock the source's row (`source`) first, and nothing else writes a copied row but
   * erasure and the connector's removal.
   */
  copiedFrom(connectorId: string): Promise<HoldingRecord[]>;
  /** The people who have a row copied from this connector, whatever its state, each once. */
  copiedPeople(connectorId: string): Promise<string[]>;
  /** Delete these rows copied from this connector; returns how many there were. */
  removeCopied(connectorId: string, holdingIds: readonly string[]): Promise<number>;
  /**
   * Write copied rows as they are given: a row whose id is new is inserted, one whose id exists is replaced. Every row
   * carries `copy`; the person must exist, and the type when one is named.
   */
  putCopied(rows: readonly HoldingRecord[]): Promise<void>;
  /** Mark these copied rows of the connector as read at `at`, changing nothing else. */
  touchCopied(connectorId: string, sourceIds: readonly string[], at: string): Promise<void>;
  /**
   * Set the catalogue type of every copied row of this connector and source type held by a person of the
   * organisation, whatever its state. Returns how many rows there are.
   */
  retypeCopied(connectorId: string, organisationId: string, sourceType: string, typeId: string | null): Promise<number>;
  /** For one organisation: each connector's source types among the copied rows of its active people that count (not revoked). */
  sourceTypes(organisationId: string): Promise<SourceTypeCount[]>;
  /** The mappings of one organisation, of every connector or one. */
  mappings(organisationId: string, connectorId?: string): Promise<SourceMapping[]>;
  /** The mappings of one connector, of every organisation. */
  mappingsOf(connectorId: string): Promise<SourceMapping[]>;
  /** Write a mapping, replacing the one of the same connector, organisation and source type. */
  putMapping(mapping: SourceMapping): Promise<void>;
  /** Remove a mapping; false when there was none. */
  removeMapping(connectorId: string, organisationId: string, sourceType: string): Promise<boolean>;
  /** Every source the copy has claimed or read. */
  sources(): Promise<SourceRecord[]>;
  /** One source, locked. */
  source(connectorId: string): Promise<SourceRecord | undefined>;
  /**
   * One source, locked, written as `blank` first when it has no record: what a run claims a source through. Of two
   * transactions that open a source nobody has read before, the second waits for the first and is answered what the
   * first wrote, so they never both find it free.
   */
  openSource(blank: SourceRecord): Promise<SourceRecord>;
  /** Write a source's record, replacing the one there. */
  putSource(record: SourceRecord): Promise<void>;
  /**
   * Everything of one connector: its copied rows, its mappings and its record. Takes the source's row lock first, as
   * every writer of copied rows does, so it waits for a read's write rather than meeting it halfway.
   */
  forgetSource(connectorId: string): Promise<Forgotten>;
  /** Start a durable workflow with this transaction's commit (D86). An id that already exists is left as it is. */
  enqueue(start: WorkflowStart): Promise<void>;
  // People.
  /** These people as the domain names them; an unknown id is absent. */
  persons(ids: readonly string[]): Promise<PersonRef[]>;
  /** The active (not deactivated) people whose user name is one of these, without regard to case. */
  activeByUserName(userNames: readonly string[]): Promise<PersonRef[]>;
  /** Of these people, the ones not deactivated now. */
  activeIds(personIds: readonly string[]): Promise<Set<string>>;
  // Erasure and export (D108 item 14).
  /**
   * Remove the person's holdings, copied ones included, and remove them from other people's (null `registeredBy`,
   * `revokedBy`). Takes the row lock of every source first, in the order of their ids, whether the person has rows of
   * it yet or not: a read's write holds its source's row from before it asks who is active until it commits, so an
   * erasure waits for a write under way, the person's very first one included, and a write that starts after the
   * erasure finds the person deactivated.
   */
  erasePerson(personId: string): Promise<Erased>;
  /** Every type of the organisation, archived included, every holding of its people, and its mappings. */
  exportOrganisation(organisationId: string): Promise<CompetenceExport>;
  /** The person's own competence cards, for an erasure. */
  cards: CompetenceCardsTx;
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

/**
 * What a source answers (D108 item 9, D119) is the holdings profile of `@clew/contracts`: a page of `HoldingsRow`s,
 * each an account's `key` (matched to a person's user name without regard to case) and its holdings, with `next` and
 * `withdrawalsReported`. The source's `kind` (`badge` among them) is the source's word and never the catalogue's: a
 * copied row's catalogue type comes from a mapping alone.
 */
export type { Holding as SourceHolding, HoldingsOutput as SourceHoldingsPage, HoldingsRow as SourceHoldingsRow };
/** A system that answers the holdings profile now: its connector id and its name as a person reads it. */
export interface HoldingsSourceRef {
  connectorId: string;
  source: string;
}
/**
 * Why a page of a source gave no answer, in the protocol's error kinds, carried as `code` on what `readHoldings` throws
 * (D119's `InstallationReadError`; read by its shape, so the module imports no connector code). What the copy does with
 * each: `not-found` (no enabled connector declares the read now) stops reading that source; `invalid` (the source no
 * longer knows the cursor) starts the sweep again from the first page, once; `unavailable` retries the same page a
 * bounded number of times; `denied` (an operator's matter) and `unknown` (an answer outside the profile) stop. A read
 * that stops keeps what it read and revokes nothing; the source is read again at the next run.
 */
export const SOURCE_READ_ERRORS = ['invalid', 'denied', 'not-found', 'unavailable', 'unknown'] as const;
export type SourceReadError = (typeof SOURCE_READ_ERRORS)[number];
/**
 * What the copy of D108 item 9 reads, filled by composition: whether the module is switched on for the installation
 * (nothing is read while it is off), and the installation's read of the holdings profile (D119): the sources that
 * answer it, and one page of one of them. `@clew/connectors`' `HoldingsReader` is this port's second half. A read
 * that is aborted (`signal`) is abandoned like one that failed.
 */
export interface HoldingsPort {
  switchedOn(): Promise<boolean>;
  holdingsSources(): Promise<HoldingsSourceRef[]>;
  readHoldings(connectorId: string, cursor?: string, options?: { signal?: AbortSignal }): Promise<HoldingsOutput>;
  /**
   * Of these people, the ones a source's rows may be kept for now (D23): active, with access, and inside both the
   * source connector's audience and the competence module's own. Everyone else's rows of the source are deleted.
   */
  admitted(connectorId: string, personIds: readonly string[]): Promise<ReadonlySet<string>>;
  /** Whether anyone of the organisation would be admitted: only then is the source shown to its administrators. */
  reaches(connectorId: string, organisationId: string): Promise<boolean>;
}
/** The folder's log port (D91): a failed read of a source is logged with the connector's id, never a key or a name. */
export type CompetenceLog = (message: string, ...details: unknown[]) => void;
export interface CompetenceDeps {
  store: CompetenceStore;
  staff: Staff;
  clock: () => Date;
  ids: () => string;
  /** The sources the copy reads (item 9). Absent: there are none, as in the tests of the first slice. */
  holdings?: HoldingsPort;
  /** Waits before a page that did not answer is asked again (item 9); composition waits, a test need not. */
  pause?: (ms: number) => Promise<void>;
  log?: CompetenceLog;
}
