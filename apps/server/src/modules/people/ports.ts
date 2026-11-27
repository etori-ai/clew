import type { Position, UnitIdentifier } from '@clew/contracts';
import type {
  Assignment,
  DerivedUnit,
  Grant,
  GroupCapabilityRule,
  GroupRelationRule,
  GroupRecord,
  HeldUnit,
  Membership,
  Placement,
  TreeUnit,
  UserFields,
  UserRecord,
  UserSearch,
} from './domain';

/** Clew's own user records; identity and unit are always taken from the authenticated actor. */
export interface UserReads {
  capabilities(personId: string): Promise<string[]>;
  /**
   * The active people of the reader's organisation who belong to the unit or lead it, each with the role they hold
   * there, whatever unit they act in: one read over the provisioning store for either adapter (`directoryUsecases`).
   * A unit id is asked within the reader's organisation and never alone: a person another organisation holds on a
   * unit of the same id is nobody's colleague here. Nobody for a reader the directory does not hold.
   */
  directory(unitId: string, readerId: string): Promise<Array<{ id: string; name: string; role: string }>>;
  /**
   * The person's provisioned user name (D96 item 8: what another system keys a row on); null for an unknown person or
   * one provisioned without one.
   */
  userName(personId: string): Promise<string | null>;
  /**
   * The person's address as the directory holds it (D68, the provisioned `emails`): what makes an event in their
   * calendar theirs (D11). Null for an unknown person or one provisioned without one.
   */
  email(personId: string): Promise<string | null>;
  /**
   * Who holds these user names now in the reader's organisation, active or not (D122: a source's key is resolved to the
   * person's id when a row or an action arrives), compared without regard to case and in the composed form (NFC) on
   * both sides; keyed by the name as asked. A name nobody of the reader's organisation holds is absent, and so is a name
   * more than one of them holds in spellings that compare alike, and every name for a reader the people table does not
   * hold.
   */
  holders(readerId: string, userNames: readonly string[]): Promise<Map<string, string>>;
  /**
   * Whether this person is active: false once the source has deactivated them, undefined for an id the people table
   * does not hold. An erasure refuses an id it does not hold (D122) and a person who is still active (D123).
   */
  enabled(personId: string): Promise<boolean | undefined>;
}
/** A SCIM client (D68): the one thing that fills the provisioning tables, scoped to one organisation. */
export interface Provisioner {
  id: string;
  organisationId: string;
  label: string;
}
export interface Page {
  startIndex: number;
  count: number;
}
export interface Listed<T> {
  total: number;
  rows: T[];
}
/** A row of the audit table as an erasure reads it (D123): its id, what happened, about whom, and what it holds. */
export interface AuditRecord {
  id: number;
  action: string;
  subject: string;
  details: Record<string, unknown>;
}
/**
 * A change of a person's `active` as the leavers port is told it: who made it (`provisioner:<id>`), whom, of which
 * organisation, and when.
 */
export interface LeaverChange {
  actor: string;
  personId: string;
  organisationId: string;
  at: string;
  /**
   * On a deactivation: whom the person reported to when they left (D147), by id, as the reporting line reads it: the
   * active people of the organisation their employments named, without anyone who named them back. Read before the
   * change is applied, so a write that deactivates a person and clears their employments in one says them still.
   */
  managers?: readonly string[];
}
/**
 * What a change of a person's `active` means to a domain that keeps data about them (D68: a person is deactivated,
 * never erased; D108 item 14: the competence of one who left is erased a set time after). The SCIM use cases tell it,
 * inside the transaction that deactivates or activates the person and after the person's row is written, so whatever
 * the domain records there commits or rolls back with the change. It never holds the change up for long or fails it
 * (D113): the store runs each call in a savepoint with a lock timeout, and a call that fails is rolled back to the
 * savepoint and reported, while the change commits; the domain reconciles what it missed from the directory. The people
 * module imports no such domain: composition binds the port (`composition/people.ts`, the competence module's erasure
 * intent), and a store built without a binding tells nobody.
 */
export interface LeaversTx {
  /** The person was deactivated, or created deactivated. */
  deactivated(change: LeaverChange): Promise<void>;
  /** The person was activated again. */
  reactivated(change: LeaverChange): Promise<void>;
}
/** What an erasure cleared of the person in another domain's records about them (D123), counts only. */
export interface InviteeErased {
  /** Invitations to the person (the calendar's proposals) cleared of the name and the address they were drawn with. */
  invitations: number;
  /** Rows that named the person on their managers' planning cards, taken off the cards. */
  planningRows: number;
  /** Times drawn for the person and never sent, withdrawn: their address is gone, so they could not be sent. */
  drafts: number;
}
/**
 * What an operator's erasure of one person clears in the records other domains keep about them on other people's
 * behalf (D123, DE-M6 of the review of 2026-11-23): the calendar's invitations to them and the rows of their managers'
 * planning cards. The erasure tells it inside its own transaction, after the person is locked and before its
 * `person.erased` row, so what the domain writes commits or rolls back with that row. Unlike the leavers port it is not
 * best effort: a domain that cannot clear the person fails the erasure, which writes nothing, and the operator runs it
 * again. The people module imports no such domain: composition binds the calendar's (`composition/people.ts`), and a
 * store built without a binding clears nothing and counts zero.
 */
export interface ErasureTx {
  invitee(input: { actor: string; personId: string; at: string }): Promise<InviteeErased>;
}
/**
 * The ports of provisioning (D68, D85, D25): what the SCIM use cases and the derivation read and write inside one
 * transaction. The grant is the projection `auth_access_grant`; the capabilities it carries are strings there and the
 * closed list in the domain. Instants are ISO strings handed in by the use case. `adapters/postgres.ts` is what the server
 * runs, `adapters/memory.ts` what the unit tests run, held to the same behaviour by `tests/provisioning-store-contract.ts`
 * and `tests/scim-store-contract.ts`.
 */
export interface ProvisionTx {
  // Derivation.
  /**
   * The person, with the row locked for the rest of the transaction: two derivations of one person run one after the
   * other, and the later one reads the memberships the earlier one committed. Without it two requests that each change
   * a membership of the same person would each derive from their own view, and the last writer's grant would miss the
   * other's change. Callers lock several people in id order, so two transactions never wait on each other.
   */
  lockPerson(id: string): Promise<{ id: string; organisationId: string } | undefined>;
  /** The organisation a person is of, read without holding them; undefined for nobody. */
  organisationOf(personId: string): Promise<string | undefined>;
  /**
   * Holds these people for the rest of the transaction, as `lockPerson` holds one, in one pass in id order and a few
   * thousand a statement; an id that names nobody is passed over. A group write holds everyone it touches or derives
   * this way before it takes its time of change: a person's own write holds them before it takes its time, so one that
   * came first has committed under an earlier time, and one that comes later waits and takes a later one.
   */
  lockPeople(ids: readonly string[]): Promise<void>;
  /**
   * Holds the named units for the rest of the transaction, whether or not they have a row yet. A unit's `unit:` and
   * `unit-manager:` groups are two resources that write one unit, so a write of either takes this before it reads the
   * unit's managers or locks a person: the two then run one after the other, and the later reads what the earlier
   * committed. Without it the two wait on each other, or a manager's derivation names the unit by its id.
   */
  lockUnits(unitIds: readonly string[]): Promise<void>;
  /**
   * Holds the organisation's tree for the rest of the transaction (D99). A write that gives a unit a parent, moves it
   * or removes it takes this before it reads the units around it, so two such writes run one after the other: a parent
   * cannot be removed while a child is being placed under it, and two moves cannot close a cycle between them. Taken
   * before `lockUnits`, by every caller.
   */
  lockTree(organisationId: string): Promise<void>;
  /**
   * Holds the organisation's capability and relation mappings for the rest of the transaction: `read` by a group write before it reads them,
   * `change` by a change to them before it writes. A group write reads the rows once and derives everyone it moves from
   * that read, so the rows may not change until it commits: a change waits for the writes that read them, and a write
   * that comes after the change waits for it and reads what it committed. Reads do not wait for each other. Taken after
   * the group's own row (`readGroup` with `lock`), the tree and the units, and before any person.
   */
  lockGroupCapabilities(organisationId: string, mode: 'read' | 'change'): Promise<void>;
  /** The groups with an external id the person is in; a group without one carries no meaning. */
  memberships(personId: string): Promise<Membership[]>;
  members(groupExternalId: string): Promise<string[]>;
  /** D85's rows of one organisation: a row applies to the groups of the organisation that wrote it, and to no other (D101). */
  groupCapabilities(organisationId: string): Promise<GroupCapabilityRule[]>;
  /** D121's rows of one organisation, by the same rule: a group gives its members a relation to people by grant. */
  groupRelations(organisationId: string): Promise<GroupRelationRule[]>;
  /** The labels of an organisation's own unit rows. A row another organisation left behind is not known here (D101). */
  unitLabels(ids: readonly string[], organisationId: string): Promise<Record<string, string>>;
  /** Upsert by id, one per assignment, before the assignments that reference them; the label is the derived one. */
  writeUnits(organisationId: string, units: readonly DerivedUnit[]): Promise<void>;
  /**
   * The person belongs to exactly these units and leads exactly these (D149), written over what was held. The
   * two are kept apart: a unit is in one list, the other or both, and each has a row from `writeUnits`.
   */
  replaceUnits(personId: string, held: { belongs: readonly string[]; leads: readonly string[] }): Promise<void>;
  /**
   * Whether somebody reports to the person (D149): an active person of the organisation other than themselves
   * has a current employment that names them, and no employment of the person names that one back. Two who name each
   * other are neither's report, as the reporting line reads it (`reportingOf`).
   */
  hasReports(organisationId: string, personId: string): Promise<boolean>;
  /**
   * The people of the organisation with a current employment on the unit, by id and each once, a deactivated person
   * among them. An employment places a person on its unit (D149), so a write of the unit's group reaches them
   * as it reaches its members.
   */
  employedOn(organisationId: string, unitId: string): Promise<string[]>;
  /**
   * The projection as stored; `relations` (D121) present only when the person holds one, `assignments` (D135) unless
   * the person's one unit and role say it all.
   */
  grant(
    personId: string,
  ): Promise<
    (Omit<Grant, 'capabilities' | 'relations'> & { capabilities: string[]; relations?: string[] }) | undefined
  >;
  /** Upsert the projection, or remove it when the person has no active assignment. */
  writeGrant(personId: string, grant: Grant | undefined): Promise<void>;
  // Positions (D108 item 5): what a `position:<code>` group says a person is. A code is the organisation's, as a unit
  // id is; the row's id is the store's own and never leaves it here.
  /** The positions the person holds, by code. */
  positionsOf(personId: string): Promise<Position[]>;
  /** The labels of the organisation's position rows for these codes; a code without a row is absent. */
  positionLabels(organisationId: string, codes: readonly string[]): Promise<Record<string, string>>;
  /** Upsert by organisation and code: a code without a row gets one, a known code takes the label given. */
  writePositions(organisationId: string, positions: readonly Position[]): Promise<void>;
  /** Removes the organisation's rows for these codes, and with them every person's hold of them. */
  removePositions(organisationId: string, codes: readonly string[]): Promise<void>;
  /**
   * The person holds exactly the positions of these codes in the organisation, written over what they held. A code
   * without a row is not held, so a position is written before anyone is given it.
   */
  replacePositions(personId: string, organisationId: string, codes: readonly string[]): Promise<void>;
  audit(entry: { actor: string; action: string; subject: string; details: Record<string, unknown> }): Promise<void>;
  /** The domains told of a deactivation or a reactivation on this transaction (D108 item 14). */
  leavers: LeaversTx;
  // SCIM: who is calling.
  /**
   * The provisioner whose token has this digest and is not revoked, with the last time it was seen. A token that was
   * rotated out still answers until its grace period ends (`at` is now), so a client can be switched without a gap.
   */
  provisioner(tokenDigest: string, at: string): Promise<(Provisioner & { lastSeenAt: string | null }) | undefined>;
  /**
   * Record that the provisioner authenticated at `at`, the one sign an operator has that pushes still arrive, if its
   * last-seen time is still `seenBefore`. False when another request moved the mark first: of several that arrive
   * together one records the run.
   */
  touchProvisioner(id: string, at: string, seenBefore: string | null): Promise<boolean>;
  /**
   * The organisation's provisioners that are not revoked, by id, for Administration › Användare. `previousValidUntil`
   * is how long the token rotated out last still answers; null when none does.
   */
  provisioners(
    organisationId: string,
  ): Promise<Array<Provisioner & { lastSeenAt: string | null; previousValidUntil: string | null }>>;
  // Administration › Användare (D107): an administrator issues, rotates and revokes a provisioner's token.
  /**
   * A provisioner by its id, whichever organisation it fills (the id is the installation's), revoked or not, with the
   * row held for the rest of the transaction: an issue, a rotation and a revocation of one provisioner run one after
   * the other.
   */
  provisionerById(
    id: string,
  ): Promise<(Provisioner & { revoked: boolean; previousValidUntil: string | null }) | undefined>;
  /**
   * Writes a provisioner under its id with the digest of a new token: a new provisioner, or a revoked one of the same
   * organisation issued again. It is active, never seen, and no token from before answers for it. False, and nothing
   * written, when the id is held by an active provisioner or by another organisation's. The answer is the store's,
   * given with the write, so two issues of one id at once cannot both be taken.
   */
  issueProvisioner(
    record: Provisioner & { tokenDigest: string; createdBy: string; createdAt: string },
  ): Promise<boolean>;
  /**
   * A new token for a provisioner. The token it replaces answers until `previousValidUntil`, or no longer when that
   * is null; a token rotated out before that one no longer answers either way.
   */
  rotateProvisioner(id: string, tokenDigest: string, previousValidUntil: string | null): Promise<void>;
  /** Ends every token of the provisioner at `at`. */
  revokeProvisioner(id: string, at: string): Promise<void>;
  /** The organisation scopes both reads. A mutation locks the row before reading the fields it will change. */
  readUser(organisationId: string, id: string, lock?: boolean): Promise<UserRecord | undefined>;
  /** Which of `ids` are users of the organisation: one read for a group of any size. */
  usersAmong(organisationId: string, ids: readonly string[]): Promise<string[]>;
  /**
   * Across the installation, because a login carries no organisation: a `userName` matches without regard to case
   * (RFC 7643's default for it), an `externalId` exactly. The unique indexes of `auth_person` say the same.
   */
  findUser(by: 'userName' | 'externalId', value: string): Promise<UserRecord | undefined>;
  /** The organisation's users, paged by id; a `userName` filter matches without regard to case. */
  listUsers(
    organisationId: string,
    page: Page,
    filter?: { attribute: 'userName' | 'externalId'; value: string },
  ): Promise<Listed<UserRecord>>;
  insertUser(record: UserRecord): Promise<void>;
  /**
   * Writes the fields named and the time of change. A name other than the one held is also recorded as changed at
   * `updatedAt`, for the groups whose resource lists the person (`groupMembers`, `memberNamesChanged`); the record reads
   * the same.
   */
  updateUser(
    id: string,
    fields: Partial<Pick<UserRecord, keyof UserFields>> & {
      updatedAt: string;
    },
  ): Promise<void>;
  /**
   * Moves the time of change of these people to `updatedAt` and changes nothing else of them: a group write changes the
   * groups their resource answers (RFC 7643 §3.1). The rows are held for the rest of the transaction, taken in id order
   * as `lockPerson`'s callers take them, a few thousand a statement. An id that names nobody is passed over.
   */
  touchUsers(ids: readonly string[], updatedAt: string): Promise<void>;
  userGroups(personId: string): Promise<Array<{ id: string; externalId: string | null; label: string }>>;
  // SCIM: groups. A group belongs to the organisation of the provisioner that pushed it, as its members do, so a client
  // reads, lists and writes its own organisation's groups only; `externalId` is unique across the installation.
  /** `lock` holds the group's row for the rest of the transaction, so two writes of one group run one after the other. */
  readGroup(organisationId: string, id: string, lock?: boolean): Promise<GroupRecord | undefined>;
  /** Across the installation, for the uniqueness check and the mapping (an `externalId` is shared vocabulary). */
  findGroup(by: 'externalId' | 'label', value: string): Promise<GroupRecord | undefined>;
  listGroups(
    organisationId: string,
    page: Page,
    filter?: { attribute: 'externalId' | 'label'; value: string },
  ): Promise<Listed<GroupRecord>>;
  insertGroup(record: GroupRecord): Promise<void>;
  updateGroup(
    id: string,
    fields: Partial<Pick<GroupRecord, 'externalId' | 'label' | 'parentUnitId' | 'unitIdentifiers'>> & {
      updatedAt: string;
    },
  ): Promise<void>;
  /** Removes the group and its memberships; its group-capability rows stay (D85). */
  deleteGroup(id: string): Promise<void>;
  /**
   * The group's members by id, each with when their name last changed (`updateUser`), null if it has not since they
   * were written: a Group resource lists each member's name, so that is a change of the group (RFC 7643 §3.1), read in
   * the same statement as the names, so no name is newer than the time read with it.
   */
  groupMembers(groupId: string): Promise<Array<{ id: string; name: string; nameChangedAt: string | null }>>;
  /**
   * For each of these groups, when the name of one of its current members last changed (`updateUser`), by group id,
   * for an answer that leaves the members out. A group none of whose members has had a new name since they were written
   * is absent. One read for a page of groups, whatever their size.
   */
  memberNamesChanged(groupIds: readonly string[]): Promise<Map<string, string>>;
  setGroupMembers(groupId: string, personIds: readonly string[]): Promise<void>;
  // Administration › Användare (D85, D100).
  /**
   * The organisation's users that match the search, by name in Swedish order and then id: one page of them and how
   * many match in all. A `count` of 0 counts and reads no rows.
   */
  searchUsers(organisationId: string, search: UserSearch, page: Page): Promise<Listed<UserRecord>>;
  /** Every unit the person belongs to or leads, each once with its label, by unit id (`HeldUnit`). */
  assignmentsOf(personId: string): Promise<Array<HeldUnit & { unitLabel: string }>>;
  /**
   * D147: who the people of the organisation name as manager on their current employments, a pair for each person and
   * manager, each once, by person id and then manager id. With `personIds`, of those people only. The manager is named
   * as stored: a deactivated one, or one of another organisation by a row written before the check, is among them.
   */
  managersNamed(
    organisationId: string,
    personIds?: readonly string[],
  ): Promise<Array<{ personId: string; managerId: string }>>;
  /**
   * D147: the people of the organisation with a current employment that names `managerId`, by person id, each once:
   * with the units of those employments in the employments' order, each once, and the units they lead themselves, by
   * unit id. A deactivated person is among them with `enabled` false, as `unitPeople` gives them; the use case decides.
   */
  reportsTo(
    organisationId: string,
    managerId: string,
  ): Promise<
    Array<{
      id: string;
      name: string;
      userName: string | null;
      email: string | null;
      enabled: boolean;
      unitIds: string[];
      leads: string[];
    }>
  >;
  /**
   * Administration › Organisation (D99): everyone who belongs to or leads each of the units, under the unit's id, with
   * their role on it and whether they belong to it (`HeldUnit`), by person id; a unit with nobody is absent. With
   * `organisationId`, that organisation's people only. The use case sorts.
   */
  unitPeople(
    unitIds: readonly string[],
    organisationId?: string,
  ): Promise<
    Record<
      string,
      Array<{
        id: string;
        name: string;
        userName: string | null;
        email: string | null;
        role: Assignment['role'];
        belongs: boolean;
        enabled: boolean;
      }>
    >
  >;
  // The organisation tree (D99). A node is a `unit:` group; its parent is on the group.
  /** The units directly below a unit: the `unit:` groups that name it as their parent, by unit id. */
  childUnits(unitId: string): Promise<Array<{ id: string; label: string }>>;
  /** Nodes of the organisation's tree, optionally narrowed to the named ids, in unit id order. */
  unitTree(organisationId: string, ids?: readonly string[]): Promise<TreeUnit[]>;
  /**
   * What other systems know these units by (D148): the identifiers on each unit's `unit:` group in the organisation, as
   * the directory sent them and in its order, by unit id. A unit that carries none, and an id that names no unit of the
   * organisation, are absent.
   */
  unitIdentifiers(organisationId: string, unitIds: readonly string[]): Promise<Map<string, UnitIdentifier[]>>;
  /**
   * Every person of the organisation with each unit they belong to or lead, by person id and then unit id; a person
   * with none is one row with `unitId` and `role` null.
   */
  placements(organisationId: string): Promise<Placement[]>;
  /** Whether an identity binding exists for the person, with any issuer. */
  bound(personId: string): Promise<boolean>;
  // An operator's erasure of a deactivated person (D123): the row and its id stay, what names the person goes.
  /**
   * Holds the rows of the groups the person is in, in id order, for the rest of the transaction. Taken before
   * `lockPerson`, as a group write holds its group before it locks a person: an erasure that takes the person out of
   * their groups and a write of one of those groups then run one after the other instead of waiting on each other.
   */
  lockGroupsOf(personId: string): Promise<void>;
  /**
   * Takes the person out of every group they are in and moves the time of change of those groups to `at`, as a group
   * write that takes a member out does (S13); how many memberships there were.
   */
  removeMemberships(personId: string, at: string): Promise<number>;
  /** Removes the person's identity bindings under every issuer; how many there were. */
  removeBindings(personId: string): Promise<number>;
  /** Removes the person's sessions, ended or not, with the tokens they hold; how many there were. */
  removeSessions(personId: string): Promise<number>;
  /**
   * The audit rows with one of these actions about a subject, or whose details hold a value under a key, in the order
   * they were written. No action is no row.
   */
  auditRows(
    actions: readonly string[],
    where: { subject: string } | { key: string; value: string },
  ): Promise<AuditRecord[]>;
  /** Sets the selected identifier keys to ERASED on each current audit row; returns how many rows changed. */
  redactAudit(keysByRow: ReadonlyMap<number, readonly string[]>): Promise<number>;
  /**
   * Rewrites the actor `claim:<value>` of the authentication log's rows (a sign-in whose claim named nobody it could
   * bind) to `claim:<marker>` where the value is one of `names`, compared as user names are, without regard to case
   * and in the composed form (NFC) on both sides; how many rows changed. The rest of each row stays.
   */
  eraseClaims(names: readonly string[], marker: string): Promise<number>;
  /** What other domains clear of a person this transaction erases (D123), as composition binds them. */
  erasure: ErasureTx;
  /** Add or remove one group-capability row of an organisation; true when the row changed. */
  setGroupCapability(
    organisationId: string,
    groupExternalId: string,
    capability: string,
    present: boolean,
  ): Promise<boolean>;
  /** Add or remove one group-relation row of an organisation (D121); true when the row changed. */
  setGroupRelation(
    organisationId: string,
    groupExternalId: string,
    relation: string,
    present: boolean,
  ): Promise<boolean>;
  /**
   * The names of the organisation's groups with these external ids, by external id: one read for any number of them,
   * so every group-capability row is named by its own group. Another organisation's group is not known here (D101),
   * and an id no group holds is absent.
   */
  groupLabels(organisationId: string, externalIds: readonly string[]): Promise<Map<string, string>>;
  /**
   * The organisation's groups with an external id whose name or external id holds every word, without regard to case,
   * by name in Swedish order and then by external id compared character by character; at most `limit` of them. No
   * words is every such group. A word is matched as written.
   */
  searchGroups(
    organisationId: string,
    words: readonly string[],
    limit: number,
  ): Promise<Array<{ externalId: string; label: string }>>;
}
export interface ProvisionStore {
  /**
   * One transaction. With `snapshot`, it only reads, and every read in it sees the store as it was at one moment, so
   * what it answers held together: a resource and its time of change, a group and its members' names, a person and the
   * groups they are in, a page and its total. Without it, each statement sees what had committed when it began.
   */
  transaction<T>(fn: (tx: ProvisionTx) => Promise<T>, options?: { snapshot?: boolean }): Promise<T>;
}
