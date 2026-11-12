import type { Position } from '@clew/contracts';
import type {
  Assignment,
  DerivedUnit,
  Grant,
  GroupCapabilityRule,
  GroupRecord,
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
  directory(unitId: string): Promise<Array<{ id: string; name: string; role: string }>>;
  /**
   * The person's provisioned user name (D96 item 8: what another system keys a row on); null for an unknown person or
   * one provisioned without one.
   */
  userName(personId: string): Promise<string | null>;
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
  /** The groups with an external id the person is in; a group without one carries no meaning. */
  memberships(personId: string): Promise<Membership[]>;
  members(groupExternalId: string): Promise<string[]>;
  /** D85's rows of one organisation: a row applies to the groups of the organisation that wrote it, and to no other (D101). */
  groupCapabilities(organisationId: string): Promise<GroupCapabilityRule[]>;
  /** The labels of an organisation's own unit rows. A row another organisation left behind is not known here (D101). */
  unitLabels(ids: readonly string[], organisationId: string): Promise<Record<string, string>>;
  /** Upsert by id, one per assignment, before the assignments that reference them; the label is the derived one. */
  writeUnits(organisationId: string, units: readonly DerivedUnit[]): Promise<void>;
  replaceAssignments(personId: string, assignments: readonly Assignment[]): Promise<void>;
  grant(personId: string): Promise<(Omit<Grant, 'capabilities'> & { capabilities: string[] }) | undefined>;
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
  updateUser(
    id: string,
    fields: Partial<Pick<UserRecord, keyof UserFields>> & {
      updatedAt: string;
    },
  ): Promise<void>;
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
    fields: Partial<Pick<GroupRecord, 'externalId' | 'label' | 'parentUnitId'>> & { updatedAt: string },
  ): Promise<void>;
  /** Removes the group and its memberships; its group-capability rows stay (D85). */
  deleteGroup(id: string): Promise<void>;
  groupMembers(groupId: string): Promise<Array<{ id: string; name: string }>>;
  setGroupMembers(groupId: string, personIds: readonly string[]): Promise<void>;
  // Administration › Användare (D85, D100).
  /**
   * The organisation's users that match the search, by name in Swedish order and then id: one page of them and how
   * many match in all. A `count` of 0 counts and reads no rows.
   */
  searchUsers(organisationId: string, search: UserSearch, page: Page): Promise<Listed<UserRecord>>;
  assignmentsOf(personId: string): Promise<Array<{ unitId: string; unitLabel: string; role: Assignment['role'] }>>;
  /**
   * Personal (D94, D99): everyone assigned to each of the units, under the unit's id, with their role on it and by
   * person id; a unit nobody is assigned to is absent. With `organisationId`, that organisation's people only. The use
   * case sorts and excludes the reader.
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
   * Every person of the organisation with each unit they are assigned to, by person id and then unit id; a person
   * assigned to none is one row with `unitId` and `role` null.
   */
  placements(organisationId: string): Promise<Placement[]>;
  /** Whether an identity binding exists for the person, with any issuer. */
  bound(personId: string): Promise<boolean>;
  /** Add or remove one group-capability row of an organisation; true when the row changed. */
  setGroupCapability(
    organisationId: string,
    groupExternalId: string,
    capability: string,
    present: boolean,
  ): Promise<boolean>;
}
export interface ProvisionStore {
  transaction<T>(fn: (tx: ProvisionTx) => Promise<T>): Promise<T>;
}
