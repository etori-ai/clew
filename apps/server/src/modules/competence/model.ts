import type {
  AuthenticatedContext,
  CompetenceEvidence,
  CompetenceKind,
  CompetenceReadKind,
  CompetenceReadRelation,
  CompetenceReadCounts,
  CompetenceReadOutcome,
  Holding,
  HoldingsOutput,
  HoldingsRow,
  StaffOverview,
  Subject,
} from '@clew/contracts';

/**
 * The ports of the competence module (D108, D25): the catalogue of competence types and the holdings people have of
 * them. A certificate and a competence are one record, a holding (item 1). Everything a use case reads and writes
 * happens inside one `CompetenceStore` transaction together with its audit row. `adapters/postgres.ts` runs in the
 * server, `adapters/memory.ts` in the unit tests, both held to one store contract. Who reports to whom comes in as a
 * function filled in composition, so the module does not import the people module, and so do the sources whose
 * holdings are copied in (`HoldingsPort`, item 9), so it imports no connector and not the registry. What requirements
 * need of the directory (positions, assignments and the tree, items 5 and 6) is read through the store, as the people
 * themselves are, and the branch under a unit is worked out in `domain.ts`.
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
  /**
   * The address the type came with from an imported file (D120 item 7), such as an ESCO concept's URI; null for one
   * added by hand. One per organisation, whatever the type's state, so an import is idempotent on it.
   */
  sourceUri: string | null;
  /** The type this one was merged into (D108 item 2); a merged type is archived, and a merge is not undone. */
  mergedInto: string | null;
}
export type TypePatch = Partial<
  Pick<TypeRecord, 'name' | 'area' | 'kind' | 'validityMonths' | 'archivedAt' | 'mergedInto'>
>;
/**
 * A holding's state as stored (D108 items 7 and 9). `pending` and `rejected` belong to a person's own registration
 * (evidence `self`): it waits for the manager they report to, who approves it (`valid`) or rejects it.
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
  /**
   * Who registered it: the manager, or the person themselves for their own registration (evidence `self`); null once
   * that person was erased, and always on a copied row.
   */
  registeredBy: string | null;
  createdAt: string;
  revokedAt: string | null;
  revokedBy: string | null;
  /** Set on a row copied from a source (evidence `system`), null on one registered in Clew. */
  copy: HoldingCopy | null;
  /**
   * The decision on a person's own registration (D108 item 7): the manager who approved or rejected it (their
   * attestation; null once that manager was erased) and when (null while it waits, and on every other holding).
   */
  decidedBy: string | null;
  decidedAt: string | null;
  /**
   * The approval's key on a person's own registration: each manager's card is the thread `<threadId>:<manager id>`
   * (`approvalCardId`), all of them on one topic, so one decision closes every one. Null on every other holding.
   */
  threadId: string | null;
  /**
   * The level a skill is held at (D120 item 1), 1 to 3; null on every other kind. A holding with a level has no end
   * date, no source and no approval, and is one per person and type while it counts (`SkillTaken`).
   */
  level: number | null;
  /** The person wants to develop the skill (D120 item 3); false on every other kind. Counts towards nothing. */
  interest: boolean;
  /**
   * The manager who confirmed a skill's level (D120 item 2) and when: both null while it is the person's own rating
   * alone; `validatedBy` null with a time once that manager was erased, so it stays confirmed. Null on every other kind.
   */
  validatedBy: string | null;
  validatedAt: string | null;
  /**
   * When a skill's level was last set by a rating, the person's own or a manager's registration (not by a confirmation,
   * which is `validatedAt`): set on every skill, null on every other kind. A required skill that stops meeting its
   * requirement begins a new spell at this moment or at its confirmation, so its card is issued again (D108 item 12).
   */
  ratedAt: string | null;
}
export type HoldingPatch = Partial<
  Pick<
    HoldingRecord,
    | 'state'
    | 'revokedAt'
    | 'revokedBy'
    | 'decidedBy'
    | 'decidedAt'
    | 'level'
    | 'interest'
    | 'validatedBy'
    | 'validatedAt'
    | 'ratedAt'
    | 'evidence'
    | 'registeredBy'
    | 'issuedOn'
  >
>;
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
/**
 * What is required of whom (D108 item 6): a type and exactly one of a position (by its code in the organisation), a unit
 * (by the id of its `unit:` key) or one person. A position and a unit are named by key, not by a row, so one that is
 * pushed again keeps its requirements and one that is gone counts towards nothing until it comes back. `minLevel` is the
 * least level a confirmed skill must reach (D120 item 4), set on a requirement of a skill and null on any other.
 * `createdBy` is an actor string, null once that person was erased.
 */
export interface RequirementRecord {
  id: string;
  organisationId: string;
  typeId: string;
  positionCode: string | null;
  unitId: string | null;
  personId: string | null;
  minLevel: number | null;
  createdBy: string | null;
  createdAt: string;
}
/**
 * A share target (D108 item 6): of the people who hold the position `positionCode`, at least `minShare` percent hold
 * `typeId`, on the branch of `unitId` or, null, across the whole organisation. It names no person.
 */
export interface ShareTargetRecord {
  id: string;
  organisationId: string;
  typeId: string;
  positionCode: string;
  unitId: string | null;
  minShare: number;
  createdBy: string | null;
  createdAt: string;
}
/** A position of the organisation (D108 item 5), as SCIM wrote it. */
export interface PositionRecord {
  id: string;
  organisationId: string;
  code: string;
  label: string;
}
/**
 * A unit of the organisation's tree as pushed (D99): a `unit:` group's unit id, its name and the unit above it, null on a
 * root. Every node is one, also one nobody is placed on.
 */
export interface UnitRecord {
  id: string;
  organisationId: string;
  label: string;
  parentId: string | null;
}
/** Where one person stands in the directory: the units they are assigned to and the codes of the positions they hold. */
export interface Placed {
  personId: string;
  unitIds: string[];
  positionCodes: string[];
}
/** A durable workflow start committed with the transaction that decides it (D86); the memory store records it. */
export interface WorkflowStart {
  workflow: string;
  id: string;
  input: unknown;
}
/** A person as the domain needs them: to key a row on the user name and to name them to the reader. */
export interface PersonRef {
  id: string;
  organisationId: string;
  name: string;
  /** Null for a person provisioned without one. */
  userName: string | null;
}
/**
 * One row of the read log (D108 item 15, D121 item 5): who read competence about people, as which relation, what and
 * when. A search and its export name the type (with the least level and the unit narrowed to, where given) and are a
 * registrar's; one person's holdings opened names whom. `rows` is how many rows the read returned. Ids, a level and a
 * count: never a name and never content. Written in the transaction that reads what it records.
 */
export interface ReadLogEntry {
  id: string;
  organisationId: string;
  /** The person who read, by Clew's id. */
  readerId: string;
  /** `self` only on a row written before a person's own reads stopped being logged (2026-11-13); none is written now. */
  relation: CompetenceReadRelation | 'self';
  kind: CompetenceReadKind;
  typeId: string | null;
  minLevel: number | null;
  unitId: string | null;
  personId: string | null;
  rows: number;
  readAt: string;
}
/** What the read log is read by, for an operator (`scripts/competence-read-log.ts`): every filter narrows further. */
export interface ReadLogQuery {
  organisationId?: string;
  /** The reads of this person's competence. */
  personId?: string;
  /** The reads this person made. */
  readerId?: string;
  /** The reads made as this relation. */
  relation?: CompetenceReadRelation;
  /** The reads of this kind. */
  kind?: CompetenceReadKind;
  /** From this instant on. */
  since?: string;
  /** At most this many rows, the newest first. */
  limit: number;
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
  /**
   * Rows from which the person was removed: other people's holdings they registered, revoked or decided, and the
   * requirements and share targets they set (`createdBy`).
   */
  cleared: number;
  /** Requirements set on the person alone (D108 item 6), removed with them. */
  requirements: number;
  /** The approval keys of the person's own registrations that were removed: their cards go with them (`workItems`). */
  threadIds: string[];
}
/**
 * The whole domain for one organisation (D108 item 14), copied rows, the mappings of sources, the requirements and the
 * share targets included; the use case turns it into `clew.competence/8`.
 */
export interface CompetenceExport {
  types: TypeRecord[];
  holdings: HoldingRecord[];
  mappings: SourceMapping[];
  requirements: RequirementRecord[];
  shareTargets: ShareTargetRecord[];
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

/** The store's refusal of an address another type of the organisation keeps already (D120 item 7). */
export class TypeUriTaken extends Error {
  constructor() {
    super('The organisation already has a competence type with this address.');
    this.name = 'TypeUriTaken';
  }
}

/** The store's refusal of a second registration of one type waiting for the same person (D108 item 7). */
export class PendingTaken extends Error {
  constructor() {
    super('The person has a registration of this type waiting already.');
    this.name = 'PendingTaken';
  }
}

/** The store's refusal of a second skill of one type that counts for the same person (D120 item 1). */
export class SkillTaken extends Error {
  constructor() {
    super('The person holds this skill already.');
    this.name = 'SkillTaken';
  }
}

/** How a person's own registration left the managers' streams (D108 item 7). */
/**
 * How a person's own registration left a manager's stream (D108 item 7): decided, taken back, or set aside by Clew,
 * `reassigned` when that manager can no longer decide it (the person reports to someone else, or the manager left)
 * and `paused` while the person who registered it is not active.
 */
export type ApprovalOutcome = 'approved' | 'rejected' | 'withdrawn' | 'reassigned' | 'paused';
/** One manager's card of one approval, as the reconciliation reads it. */
export interface ApprovalCard {
  /** Whose stream it is in. */
  personId: string;
  open: boolean;
  /**
   * Put away by Clew (`reassigned` or `paused`), not by its owner or a decision: the one kind of closed card Clew opens
   * again when its owner can decide once more.
   */
  setAside: boolean;
}
/**
 * The approval of a person's own registration as work (D108 item 7): one card in the stream of each manager the person
 * reports to when they register it, every card on one topic so that one decision, by any of them or by a manager the
 * person reports to later, or the person taking it back, closes them all. A card's title, summary and messages name
 * nobody and no competence, since they are what the assistant reads; the person is the card's subject (D97 item 6), a
 * key that is never drawn or read, so the card shows on that person for its owner. Its way in is a read that leads to
 * the approval on the matrix. Implemented in composition over the thread store's transaction (`withThreadTx`), on the
 * same database transaction as the `CompetenceTx` it belongs to, as talks implements its `WorkItemTx`; the memory
 * store records the calls.
 */
export interface ApprovalWorkItemTx {
  /**
   * Insert an open card for each of `managers` (`<threadId>:<manager id>`), admit its delivery, write its message and
   * its `thread.pushed` audit row. `subject` is the person who registered it, by user name.
   */
  open(input: {
    threadId: string;
    holdingId: string;
    managers: readonly string[];
    at: string;
    subject?: Subject;
  }): Promise<void>;
  /**
   * Mark every open card of the approval handled (or, with `only`, those of these owners), with a message that says how
   * it ended, and end the reminders the owners set on them. A card that is gone or already put away is no error.
   */
  close(threadId: string, at: string, outcome: ApprovalOutcome, only?: readonly string[]): Promise<void>;
  /** Every card of the approval, whichever stream it is in, locked, by owner. */
  cards(threadId: string): Promise<ApprovalCard[]>;
  /** Open again the cards of these owners that Clew set aside, with a message that says it waits for them again. */
  reopen(threadId: string, personIds: readonly string[], at: string): Promise<void>;
  /** Erasure of the person who registered: every card of these approvals goes, from whichever stream it is in. */
  remove(threadIds: readonly string[]): Promise<void>;
  /**
   * Erasure of the person who registered, by the key the cards are about (their `subject`): every approval card about
   * them goes, a registration's they took back included, whose row is gone and with it the approval's key.
   */
  removeAbout(subject: Subject): Promise<void>;
  /** Erasure of a manager: the approval cards in their own stream go; the other managers' stay. */
  removeOwned(personId: string): Promise<void>;
}

/** The store's refusal of a requirement the type and its target already have (D108 item 6). */
export class RequirementTaken extends Error {
  constructor() {
    super('The requirement exists already.');
    this.name = 'RequirementTaken';
  }
}
/** The store's refusal of a share target the type, position and unit (or the organisation) already have. */
export class ShareTargetTaken extends Error {
  constructor() {
    super('The share target exists already.');
    this.name = 'ShareTargetTaken';
  }
}

/**
 * Everything a competence use case reads and writes in one transaction. Reads that a write follows take a row lock.
 *
 * **The lock order.** A transaction that takes more than one kind of lock takes them in this order, and several of one
 * kind in the order of their ids, so two transactions wait for each other and never deadlock:
 *
 * 1. the organisation's catalogue (`lockCatalogue`), taken by what adds types (an add, an import);
 * 2. the rows of the sources (`source`, `lockSources`), taken by a source's copy and its write, a mapping, forgetting a
 *    source, erasure and a merge;
 * 3. the rows of types (`type`), taken by what registers, rates, maps, requires, changes, archives, restores and merges;
 * 4. the rows of holdings (`holding`, `lockHoldingsOfTypes`), taken by what changes, decides, confirms, revokes or
 *    removes one, and by a merge;
 * 5. the rows of requirements and share targets (`requirement`, `shareTarget`).
 *
 * A use case that knows only a holding and needs its type as well (a person's change of their own skill) reads the
 * holding without a lock to learn the type, locks the type, then locks the holding and reads it again. A write takes
 * its own locks too: inserting a holding, a requirement or a mapping waits on a type a merge has locked, which is the
 * order above. Reads that write nothing (the lists, the search, a merge's preview) take no lock.
 */
export interface CompetenceTx {
  // The catalogue.
  /**
   * Hold the organisation's catalogue for this transaction (the first lock of the order): an add and an import of types
   * take it, so the count they check against `COMPETENCE_CATALOGUE_MAX` is the count they write to.
   */
  lockCatalogue(organisationId: string): Promise<void>;
  /** How many types the organisation has, archived and merged ones included. */
  countTypes(organisationId: string): Promise<number>;
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
  /**
   * Insert these types at once, as an import does (D120 item 7), each that may be: one whose name another type of the
   * organisation in use has (by the store's own comparison without regard to case, which in Postgres is the name index's
   * `lower()`), or whose address another type keeps whatever its state, or that an earlier one of the batch took, is
   * left out without an error. Returns the ids inserted.
   */
  insertTypes(types: readonly TypeRecord[]): Promise<string[]>;
  /**
   * The organisation's types that are not archived whose name or area holds each of these words, without regard to case
   * (D121 item 4: the type field of the search, over a catalogue of thousands), by name in Swedish order and then id, at
   * most `limit`. No words: the first `limit` by name.
   */
  findTypes(organisationId: string, words: readonly string[], limit: number): Promise<TypeRecord[]>;
  // Holdings.
  /** Every holding of these people, oldest first, whatever its state. */
  holdingsOf(personIds: readonly string[]): Promise<HoldingRecord[]>;
  /** Every holding of this type, oldest first, whatever its state. */
  holdingsOfType(typeId: string): Promise<HoldingRecord[]>;
  /** Every holding of these types, whatever its state, locked in the order of their ids (a merge, D108 item 2). */
  lockHoldingsOfTypes(typeIds: readonly string[]): Promise<HoldingRecord[]>;
  /** Every person's own registration that waits for a decision (D108 item 7), of every organisation, oldest first. */
  waitingRegistrations(): Promise<HoldingRecord[]>;
  /** One holding, locked. */
  holding(id: string): Promise<HoldingRecord | undefined>;
  /**
   * Insert a holding. A second `pending` one of the same person and type is refused with `PendingTaken` (D108 item 7);
   * only a holding of evidence `self` may be pending or rejected, and only it is decided or has an approval's key. A
   * second skill of one type that counts for the same person is refused with `SkillTaken` (D120 item 1); a skill has
   * no end date, no source and no approval, and only a skill is confirmed or has an interest mark.
   */
  insertHolding(holding: HoldingRecord): Promise<void>;
  /** Change a holding; the same rules as `insertHolding`. An unknown id changes nothing; returns whether there was one. */
  updateHolding(id: string, patch: HoldingPatch): Promise<boolean>;
  /**
   * Remove one holding registered in Clew, as a person's own registration taken back is (D108 item 7). A copied row is
   * left alone: it goes only with its source or its person.
   */
  deleteHolding(id: string): Promise<void>;
  /**
   * Re-point these holdings, registered or copied and whatever their state, to another type, as a merge does (D108 item
   * 2); the same rules as `insertHolding`. Returns how many there were.
   */
  retypeHoldings(holdingIds: readonly string[], typeId: string): Promise<number>;
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
  /**
   * Map to `intoTypeId` every source type of the organisation mapped to `fromTypeId`, keeping who mapped it and when, as
   * a merge does (D108 item 2). Returns how many mappings there were.
   */
  retypeMappings(organisationId: string, fromTypeId: string, intoTypeId: string): Promise<number>;
  /** Every source the copy has claimed or read. */
  sources(): Promise<SourceRecord[]>;
  /** One source, locked. */
  source(connectorId: string): Promise<SourceRecord | undefined>;
  /** Every source's row, locked in the order of their ids; returns their ids (a merge, D108 item 2). */
  lockSources(): Promise<string[]>;
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
  // The directory as requirements read it (D108 items 5 and 6, D99): read here, as the people above are, so the module
  // imports no other module; written only by the SCIM use cases.
  /** The organisation's positions, by label in Swedish order. */
  positions(organisationId: string): Promise<PositionRecord[]>;
  /**
   * The organisation's tree as pushed, by name in Swedish order: every `unit:` group with the unit above it, a node
   * nobody is placed on included. A unit people are assigned to that no group names is not in it.
   */
  units(organisationId: string): Promise<UnitRecord[]>;
  /** The active people of the organisation assigned to any of these units, each once. */
  placedOn(organisationId: string, unitIds: readonly string[]): Promise<string[]>;
  /**
   * For each of these people of the organisation the units they are assigned to and the codes of the positions they
   * hold; an unknown id, or a person of another organisation, is absent.
   */
  placesOf(organisationId: string, personIds: readonly string[]): Promise<Placed[]>;
  /** The active people of the organisation who hold a position of one of these codes, once per person and code. */
  positionHolders(organisationId: string, codes: readonly string[]): Promise<Array<{ personId: string; code: string }>>;
  // Requirements and share targets (D108 item 6).
  /** Every requirement of the organisation, on a position, a unit or a person, oldest first. */
  requirements(organisationId: string): Promise<RequirementRecord[]>;
  /** One requirement, locked. */
  requirement(id: string): Promise<RequirementRecord | undefined>;
  /** Insert a requirement. One the type and its target already have is refused with `RequirementTaken`. */
  insertRequirement(requirement: RequirementRecord): Promise<void>;
  /** Remove a requirement; false when there was none. */
  removeRequirement(id: string): Promise<boolean>;
  /**
   * Re-point a requirement to another type, or change its least level, as a merge does (D108 item 2). One the type and
   * its target already have is refused with `RequirementTaken`. An unknown id changes nothing; returns whether there was
   * one.
   */
  updateRequirement(id: string, patch: Partial<Pick<RequirementRecord, 'typeId' | 'minLevel'>>): Promise<boolean>;
  /** Every share target of the organisation, oldest first. */
  shareTargets(organisationId: string): Promise<ShareTargetRecord[]>;
  /** One share target, locked. */
  shareTarget(id: string): Promise<ShareTargetRecord | undefined>;
  /** Insert a share target. One the type, position and unit (or the organisation) already have: `ShareTargetTaken`. */
  insertShareTarget(target: ShareTargetRecord): Promise<void>;
  /** Remove a share target; false when there was none. */
  removeShareTarget(id: string): Promise<boolean>;
  /**
   * Re-point a share target to another type, or change its least share, as a merge does (D108 item 2). One the type,
   * position and unit already have is refused with `ShareTargetTaken`. An unknown id changes nothing; returns whether
   * there was one.
   */
  updateShareTarget(id: string, patch: Partial<Pick<ShareTargetRecord, 'typeId' | 'minShare'>>): Promise<boolean>;
  // Erasure and export (D108 item 14).
  /**
   * Remove the person's holdings, copied ones included, and the requirements set on them alone, and remove them from
   * other people's holdings (null `registeredBy`, `revokedBy`, `decidedBy`, `validatedBy`, each keeping its time) and
   * from the requirements and share targets they set (null `createdBy`, which holds `person:<id>`). Takes the row lock of every source the person has copied
   * rows from first, in the order of their ids. Returns the approval keys of the removed holdings, whose cards the use
   * case removes with `workItems` in the same transaction.
   */
  erasePerson(personId: string): Promise<Erased>;
  /**
   * Every type of the organisation, archived included, every holding of its people, its mappings, its requirements and
   * its share targets.
   */
  exportOrganisation(organisationId: string): Promise<CompetenceExport>;
  audit(entry: CompetenceAudit): Promise<void>;
  // The read log (D108 item 15, D121 item 5).
  /** Write one row of the read log. A row the store cannot write throws, and the read it records fails with it. */
  logRead(entry: ReadLogEntry): Promise<void>;
  /** The read log as an operator reads it, the newest first, then by id. */
  readLog(query: ReadLogQuery): Promise<ReadLogEntry[]>;
  /** The approvals' cards in the managers' streams (D108 item 7), on the same transaction. */
  workItems: ApprovalWorkItemTx;
}
export interface CompetenceStore {
  transaction<T>(fn: (tx: CompetenceTx) => Promise<T>): Promise<T>;
}

/**
 * The manager's reports (D99 item 4), from the assignments and the tree when asked, never stored: the units the reader
 * manages, each with exactly the people who report to the reader through it, the `managed` relation of D117. Not
 * Personal's list, which also holds a co-manager of the unit and the reader's own manager where they are placed on it.
 * Someone who manages no unit gets `{ units: [] }`, so this module decides what a non-manager is refused with and never
 * imports another module's error.
 */
export type Staff = (persona: AuthenticatedContext) => Promise<StaffOverview>;
/**
 * The people the reader reports to now (D99 item 4, D117's line): whoever leads the nearest unit above the reader that
 * somebody leads, active, by person id, never the reader. Empty for someone who reports to nobody. Computed when asked,
 * never stored, through the people module's reach bound in composition.
 */
export type Above = (persona: AuthenticatedContext) => Promise<string[]>;

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
  /** Whom the reader reports to (D108 item 7). Absent: everyone reports to nobody, as in the tests of earlier slices. */
  above?: Above;
  /**
   * A person as the use cases take one, built from their current grant (D108 item 7): to count whom a manager reports
   * to as they themselves count their reports, and to tell whether the person who registered is active. Undefined for
   * someone deactivated or without access. Absent: who reports to whom is `above` alone, and approvals are never
   * reconciled, as in the tests of earlier slices.
   */
  personaOf?: (personId: string) => Promise<AuthenticatedContext | undefined>;
  /**
   * A one-way digest of a text (D108 item 12): the manager's card names its cause by one, so its stored identity says
   * nothing of whom or what it counts. Composition hands in SHA-256; absent, a 64-bit FNV-1a, for tests.
   */
  digest?: (text: string) => string;
  clock: () => Date;
  ids: () => string;
  /** The sources the copy reads (item 9). Absent: there are none, as in the tests of the first slice. */
  holdings?: HoldingsPort;
  /** Waits before a page that did not answer is asked again (item 9); composition waits, a test need not. */
  pause?: (ms: number) => Promise<void>;
  log?: CompetenceLog;
}
