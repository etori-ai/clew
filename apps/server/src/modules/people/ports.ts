import type {
  Assignment,
  DerivedUnit,
  Grant,
  GroupCapabilityRule,
  GroupRecord,
  Membership,
  UserRecord,
} from './domain';

/** Clew's own user records; identity and unit are always taken from the authenticated actor. */
export interface UserReads {
  capabilities(personId: string): Promise<string[]>;
  directory(unitId: string): Promise<Array<{ id: string; name: string; role: string }>>;
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
  person(id: string): Promise<{ id: string; organisationId: string } | undefined>;
  /** The groups with an external id the person is in; a group without one carries no meaning. */
  memberships(personId: string): Promise<Membership[]>;
  members(groupExternalId: string): Promise<string[]>;
  groupCapabilities(): Promise<GroupCapabilityRule[]>;
  unitLabels(ids: readonly string[]): Promise<Record<string, string>>;
  /** Upsert by id: a unit named by a `unit:` group takes that group's label. */
  writeUnits(organisationId: string, units: readonly DerivedUnit[]): Promise<void>;
  replaceAssignments(personId: string, assignments: readonly Assignment[]): Promise<void>;
  grant(personId: string): Promise<(Omit<Grant, 'capabilities'> & { capabilities: string[] }) | undefined>;
  /** Upsert the projection, or remove it when the person has no active assignment. */
  writeGrant(personId: string, grant: Grant | undefined): Promise<void>;
  audit(entry: { actor: string; action: string; subject: string; details: Record<string, unknown> }): Promise<void>;
  // SCIM: who is calling.
  /** The provisioner whose token has this digest and is not revoked. */
  provisioner(tokenDigest: string): Promise<Provisioner | undefined>;
  // SCIM: users, always within the provisioner's organisation.
  readUser(organisationId: string, id: string): Promise<UserRecord | undefined>;
  findUser(organisationId: string, by: 'userName' | 'externalId', value: string): Promise<UserRecord | undefined>;
  listUsers(
    organisationId: string,
    page: Page,
    filter?: { attribute: 'userName' | 'externalId'; value: string },
  ): Promise<Listed<UserRecord>>;
  insertUser(record: UserRecord): Promise<void>;
  updateUser(
    id: string,
    fields: Partial<Pick<UserRecord, 'externalId' | 'userName' | 'name' | 'email' | 'enabled'>> & { updatedAt: string },
  ): Promise<void>;
  userGroups(personId: string): Promise<Array<{ id: string; externalId: string | null; label: string }>>;
  // SCIM: groups. A group belongs to the installation; its members are people of the provisioner's organisation.
  readGroup(id: string): Promise<GroupRecord | undefined>;
  findGroup(by: 'externalId' | 'label', value: string): Promise<GroupRecord | undefined>;
  listGroups(page: Page, filter?: { attribute: 'externalId' | 'label'; value: string }): Promise<Listed<GroupRecord>>;
  insertGroup(record: GroupRecord): Promise<void>;
  updateGroup(
    id: string,
    fields: Partial<Pick<GroupRecord, 'externalId' | 'label'>> & { updatedAt: string },
  ): Promise<void>;
  /** Removes the group and its memberships; its group-capability rows stay (D85). */
  deleteGroup(id: string): Promise<void>;
  groupMembers(groupId: string): Promise<Array<{ id: string; name: string }>>;
  setGroupMembers(groupId: string, personIds: readonly string[]): Promise<void>;
  // Administration › Användare (D85).
  assignmentsOf(personId: string): Promise<Array<{ unitId: string; unitLabel: string; role: Assignment['role'] }>>;
  /** Whether an identity binding exists for the person, with any issuer. */
  bound(personId: string): Promise<boolean>;
  /** Add or remove one group-capability row; true when the row changed. */
  setGroupCapability(groupExternalId: string, capability: string, present: boolean): Promise<boolean>;
}
export interface ProvisionStore {
  transaction<T>(fn: (tx: ProvisionTx) => Promise<T>): Promise<T>;
}
