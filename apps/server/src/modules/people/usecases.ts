import { isDeepStrictEqual } from 'node:util';
import {
  CAPABILITIES,
  RELATION_GRANTS,
  contractProblems,
  isCapability,
  isRelationGrant,
  type AuthenticatedContext,
  type Capability,
  type GroupCapabilityInputType,
  type GroupCapability,
  type GroupRelation,
  type GroupRelationInputType,
  type RelationGrant,
  GROUP_SEARCH_LIMIT,
  type GroupSearchResult,
  type OrganisationOverview,
  type OrganisationUnitPeople,
  type ProvisionerIssueInputType,
  type ProvisionerKeyIssued,
  type ProvisionerRotateInputType,
  type Role,
  type StaffOverview,
  type StaffPerson,
  type StaffUnit,
  type UserAdminRow,
  type UsersAdminOverview,
  type UsersAdminPage,
  type UsersAdminQueryType,
  USERS_PAGE_SIZES,
  type PersonProfile,
} from '@clew/contracts';
import { MANAGER_KEY, UNIT_KEY } from '@clew/contracts/scim-group-key';
import { ForbiddenError, InputError } from '../../context';
import { SCIM, ScimError, type ScimGroup, type ScimList, type ScimUser } from './contracts';
import {
  applyGroupPatch,
  applyUserPatch,
  assertAcceptedKey,
  assertAcceptedIdentifiers,
  assertAcceptedParent,
  auditKeysToErase,
  branchOf,
  bySwedish,
  closesCycle,
  sameIdentifiers,
  deriveAuthority,
  grantRelations,
  ERASED,
  erasedProfile,
  givesAuthority,
  groupFields,
  patchOperations,
  groupResource,
  heldFields,
  IDENTIFIERS_ABOUT,
  IDENTIFIERS_AS_HOLDER,
  leadsUnit,
  leavesOut,
  namesHeld,
  organisationOf,
  reportingOf,
  pageOf,
  parseFilter,
  positionOfKey,
  project,
  sameGrant,
  samePositions,
  searchWords,
  unitGroupOf,
  unitOfKey,
  saysInactive,
  titlesOf,
  userFields,
  userFilter,
  userResource,
  type Derived,
  type GroupFields,
  type GroupRecord,
  type GroupCapabilityRule,
  type GroupRelationRule,
  type Projection,
  type TreeUnit,
  type UserFields,
  type UserRecord,
  type UserSearch,
} from './domain';
import type { Provisioner, ProvisionStore, ProvisionTx } from './ports';

/**
 * One organisation's capability and relation mappings as a group write read them, once, after any change it made
 * to them: a group of thousands is not thousands of reads of the same rows. Read only while the rows are held
 * (`lockGroupCapabilities`), so that no change to them commits before the write that derives from them does.
 */
export interface OrganisationRules {
  organisationId: string;
  rules: readonly GroupCapabilityRule[];
  relationRules: readonly GroupRelationRule[];
}
async function organisationRules(tx: ProvisionTx, organisationId: string): Promise<OrganisationRules> {
  return {
    organisationId,
    rules: await tx.groupCapabilities(organisationId),
    relationRules: await tx.groupRelations(organisationId),
  };
}
/**
 * Deriving authority (D68, D85): the only path from memberships and the group-capability rows to the grant a person acts
 * with. Called by whatever changed a membership or such a row, inside that change's transaction, so the grant never lags the
 * fact that produced it: the person is locked before their memberships are read, and the rows are read after that lock
 * or under the organisation's hold on them. An unchanged grant writes no audit row; a changed one writes `grant.derived`
 * on the person with the new unit, role and capabilities, and the placements when they say more than those (D99,
 * D135), or `removed: true` when the person has no unit left (fail closed). A grant carries every unit the person
 * belongs to or leads (D135), so no change of placements leaves it as it was. A `protected` key never reaches these
 * tables (D93), so the derived flag stays false and is never written to the audit row.
 *
 * Three facts are read and none is worked out from another (D149): the units of the person's employments, where
 * they belong; the `unit-manager:` groups they are in, which units they lead; and whether an employment of somebody
 * else names them, which makes them a manager with no unit to lead. The last is another person's fact, so whatever
 * writes an employment derives the managers it names too (`withManagersHeld` and `writeUser` in the SCIM use cases).
 * Whether an employment's unit is one the organisation holds is the unit group's fact, so a write of that group derives
 * the people employed on the unit (`employedOnUnit`).
 */
export function provisioningUsecases(deps: { store: ProvisionStore }) {
  async function deriveWithin(
    tx: ProvisionTx,
    actor: string,
    personId: string,
    known?: OrganisationRules,
  ): Promise<Derived | undefined> {
    // Locked first: a second derivation of the same person waits here and then reads what this one committed. The
    // organisation's rows are the caller's when it read them under `lockGroupCapabilities`, which keeps every change to
    // them out until this transaction commits; otherwise they are read here, after the lock, as committed.
    const person = await tx.lockPerson(personId);
    if (!person) return undefined;
    const memberships = await tx.memberships(personId),
      { rules, relationRules } =
        known?.organisationId === person.organisationId ? known : await organisationRules(tx, person.organisationId);
    // D149: where the person is employed, in the directory's order and each unit once, and only on units the
    // organisation holds. A unit removed since the employment was written places nobody (the check names it), and
    // neither does an employment of somebody who is deactivated: a leaver taken out of their groups has no unit left
    // and so no grant, as before employments placed anybody (fail closed).
    const user = await tx.readUser(person.organisationId, personId),
      jobs = user?.enabled ? [...new Set(user.employments.map(job => job.unitId))] : [],
      nodes = jobs.length ? await tx.unitTree(person.organisationId, jobs) : [],
      employed = jobs.filter(id => nodes.some(node => node.id === id));
    // Every unit the memberships and the employments name, as the unit table knows it: the label of a led unit without
    // a `unit:` group, and the comparison that lets an unchanged derivation write nothing (a reconciliation replays
    // every person).
    const named = [...new Set([...memberships.flatMap(m => unitOfKey(m.externalId) ?? []), ...employed])];
    const knownLabels = named.length ? await tx.unitLabels(named, person.organisationId) : {};
    // A unit the person leads or is employed on without being in its `unit:` group is named by that group, which they
    // are no member of. The unit table has no row for a unit nobody was assigned to before them, so without this read
    // the head of a unit nobody else is placed on would carry the unit's id as its name (D101).
    const placedOn = new Set(memberships.flatMap(m => unitGroupOf(m.externalId) ?? [])),
      pushedLabels: Record<string, string> = Object.fromEntries(nodes.map(node => [node.id, node.label]));
    for (const id of named) {
      const node = placedOn.has(id) || id in pushedLabels ? undefined : await tx.findGroup('externalId', UNIT_KEY + id);
      if (node) pushedLabels[id] = node.label;
    }
    const derived = deriveAuthority(memberships, rules, { ...knownLabels, ...pushedLabels }, relationRules, {
      employed,
      reports: await tx.hasReports(person.organisationId, personId),
    });
    const movedUnits = derived.units.filter(u => knownLabels[u.id] !== u.label);
    if (movedUnits.length) await tx.writeUnits(person.organisationId, movedUnits);
    // Compared as sets: the store and the derivation need not order unit ids alike, and an order alone is no change.
    const held = await tx.assignmentsOf(personId),
      heldBelongs = held.filter(a => a.belongs).map(a => a.unitId),
      heldLeads = held.filter(a => a.role === 'manager').map(a => a.unitId),
      same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every(id => b.includes(id));
    if (!same(heldBelongs, derived.belongs) || !same(heldLeads, derived.leads))
      await tx.replaceUnits(personId, { belongs: derived.belongs, leads: derived.leads });
    // Compared as stored, so a projection that still carries a name outside the closed list is rewritten.
    const before = await tx.grant(personId),
      heldRelations = grantRelations(before),
      previous = before && {
        unitId: before.unitId,
        unitLabel: before.unitLabel,
        role: before.role,
        capabilities: [...before.capabilities].sort() as Capability[],
        ...(heldRelations.length ? { relations: heldRelations } : {}),
        ...(before.assignments?.length ? { assignments: before.assignments } : {}),
      };
    // D99: the history of who was assigned where is the audit rows. Since D135 the grant carries the person's units,
    // so a second unit, or a manager's role on one, changes the grant and is said on its row with the placements; no
    // change of placements leaves the grant as it was.
    const regranted = !sameGrant(previous, derived.grant);
    if (regranted) {
      await tx.writeGrant(personId, derived.grant);
      await tx.audit({
        actor,
        action: 'grant.derived',
        subject: 'person:' + personId,
        details: derived.grant
          ? {
              unitId: derived.grant.unitId,
              role: derived.grant.role,
              capabilities: derived.grant.capabilities,
              assignments: derived.assignments.length,
              // D135: the person's units with the role on each, when they say more than the unit and role above.
              ...(derived.grant.assignments
                ? { placements: derived.assignments.map(a => ({ unitId: a.unitId, role: a.role })) }
                : {}),
              // D121: said whenever the person held one before or holds one now, so its loss is on the row too.
              ...(derived.relations.length || heldRelations.length ? { relations: derived.relations } : {}),
            }
          : { removed: true },
      });
    }
    // D108 item 5: what the person is, from the `position:` groups they are in, whatever unit they are placed on. A
    // position's row is its group's and is written with the group; one pushed before Clew read the key gets its row
    // here, from the group's name. Compared by code, so a renamed position writes nothing on the people who hold it.
    if (derived.positions.length) {
      const known = await tx.positionLabels(
          person.organisationId,
          derived.positions.map(p => p.code),
        ),
        unwritten = derived.positions.filter(p => known[p.code] !== p.label);
      if (unwritten.length) await tx.writePositions(person.organisationId, unwritten);
    }
    if (!samePositions(await tx.positionsOf(personId), derived.positions)) {
      const codes = derived.positions.map(p => p.code);
      await tx.replacePositions(personId, person.organisationId, codes);
      await tx.audit({
        actor,
        action: 'positions.derived',
        subject: 'person:' + personId,
        details: { positions: codes },
      });
    }
    return derived;
  }
  /**
   * Several people in one transaction, each once and in id order: every caller locks in the same order, so two
   * requests that touch the same people queue behind each other instead of waiting on each other. `known` is the
   * organisation's rows, read once by the caller for all of them while it holds them (`OrganisationRules`).
   */
  async function deriveAll(tx: ProvisionTx, actor: string, personIds: Iterable<string>, known?: OrganisationRules) {
    for (const id of [...new Set(personIds)].sort()) await deriveWithin(tx, actor, id, known);
  }
  return {
    deriveWithin,
    deriveAll,
    /** Re-derive one person after their memberships changed. */
    derivePerson: (actor: string, personId: string) => deps.store.transaction(tx => deriveWithin(tx, actor, personId)),
    /** Re-derive every member of a group after the group's meaning changed (a group-capability row, a renamed `unit:` group). */
    deriveGroup: (actor: string, groupExternalId: string) =>
      deps.store.transaction(async tx => {
        const members = await tx.members(groupExternalId);
        await deriveAll(tx, actor, members);
        return members;
      }),
  };
}

/**
 * The SCIM 2.0 server (RFC 7644; D68): one use case per operation, the provisioner first. Each mutation runs in one
 * transaction with its audit row (`scim.user.*`, `scim.group.*`, actor `provisioner:<id>`), re-derives the grants of
 * everyone whose grant it can move, and moves the time of change of every resource it changes, a member's when a
 * group write changes the groups the member's resource lists. `DELETE` on a user deactivates, because audit rows and
 * threads reference the person; `DELETE` on a group removes it and its memberships, and the members lose what the
 * group gave them. Users are read and written within the provisioner's organisation, and so are groups (another
 * organisation's group does not exist for a client), while `userName` and a group's or a person's `externalId` are
 * unique across the installation: a login carries no organisation, and D68's keys are shared vocabulary.
 */
export interface ScimQuery extends Projection {
  filter?: string;
  startIndex?: string;
  count?: string;
}
/** How many times a write of a person starts over when the managers it must hold changed under it (`withManagersHeld`). */
const MANAGER_HOLD_TURNS = 3;
/** A group change names the people it added or removed in its audit row up to this many; past it the count stands alone. */
const NAMED_IN_AUDIT = 50;
/**
 * Who came or went, by id, while the list is short enough to read: a plain group (a connector audience, say) carries no
 * grant, so no other row says it on the person. A `POST` names everyone it put in, a `DELETE` everyone it took out.
 */
const namedInAudit = (key: 'addedPeople' | 'removedPeople', people: readonly string[]) =>
  people.length && people.length <= NAMED_IN_AUDIT ? { [key]: [...people] } : {};
/**
 * A SCIM read (`GET` of one resource, or a list) is answered from one snapshot of the store: a resource with the time it
 * last changed, a group with its members' names, a person with the groups they are in, a page with its total. Read in
 * statements of their own as each was committed, a change that committed between two of them came under the time from
 * before it, which a client takes to mean the resource has not changed (RFC 7643 §3.1).
 */
const SNAPSHOT = { snapshot: true } as const;
/** How often a provisioner's last-seen time is written at most: a push is thousands of requests, the mark one a minute. */
const SEEN_INTERVAL_MS = 60_000;
/** A provisioner seen again after this long is a new run, and a run is what the audit records (`provisioner.seen`). */
const RUN_GAP_MS = 30 * 60_000;
const since = (later: string, earlier: string) => Date.parse(later) - Date.parse(earlier);
export function scimUsecases(deps: {
  store: ProvisionStore;
  clock: () => Date;
  ids: () => string;
  digest: (token: string) => string;
}) {
  const derivation = provisioningUsecases({ store: deps.store });
  const actorOf = (p: Provisioner) => 'provisioner:' + p.id;
  const now = () => deps.clock().toISOString();
  // An id is Clew's own and never holds a NUL, which PostgreSQL would refuse to compare: such an address names nothing.
  const userOr404 = async (tx: ProvisionTx, p: Provisioner, id: string, lock = false) => {
    const user = id.includes('\u0000') ? undefined : await tx.readUser(p.organisationId, id, lock);
    if (!user) throw new ScimError(404, `User '${id}' not found.`);
    return user;
  };
  /** Within the provisioner's organisation, as `userOr404`: another organisation's group does not exist for this client. */
  const groupOr404 = async (tx: ProvisionTx, p: Provisioner, id: string, lock = false) => {
    const group = id.includes('\u0000') ? undefined : await tx.readGroup(p.organisationId, id, lock);
    if (!group) throw new ScimError(404, `Group '${id}' not found.`);
    return group;
  };
  /** Across the installation, `userName` without regard to case (the port says why); a race past this check hits the index and the route answers the same 409. */
  const uniqueUser = async (
    tx: ProvisionTx,
    fields: Partial<Pick<UserFields, 'userName' | 'externalId'>>,
    self?: string,
  ) => {
    for (const by of ['userName', 'externalId'] as const) {
      const value = fields[by];
      if (!value) continue;
      const other = await tx.findUser(by, value);
      if (other && other.id !== self) throw new ScimError(409, `A user with this ${by} already exists.`, 'uniqueness');
    }
  };
  const uniqueGroup = async (tx: ProvisionTx, fields: GroupFields, self?: string) => {
    if (!fields.externalId) return;
    const other = await tx.findGroup('externalId', fields.externalId);
    if (other && other.id !== self)
      throw new ScimError(409, 'A group with this externalId already exists.', 'uniqueness');
  };
  /** Asked of the members a write adds, in one read: a group of ten thousand is not ten thousand questions. */
  const membersExist = async (tx: ProvisionTx, p: Provisioner, members: readonly string[]) => {
    if (!members.length) return;
    const users = new Set(await tx.usersAmong(p.organisationId, members)),
      id = members.find(member => !users.has(member));
    if (id === undefined) return;
    throw new ScimError(
      400,
      (await tx.readGroup(p.organisationId, id))
        ? `Member '${id}' is a group. Nested groups are not supported: send the people as members.`
        : `Member '${id}' is not a user of this organisation.`,
      'invalidValue',
    );
  };
  /**
   * Whether a group write can move anyone's grant, asked of the keys the group had and gets (`givesAuthority`) with the
   * organisation's capability and relation mappings. They are read once and handed on to every derivation. They are
   * held first: read before the people are locked, they would otherwise be what they were before an administrator's
   * change that commits while this write waits for a person, and a capability the change took away would come back.
   */
  const authorityOf = async (tx: ProvisionTx, p: Provisioner, ...keys: Array<string | null>) => {
    await tx.lockGroupCapabilities(p.organisationId, 'read');
    const known = await organisationRules(tx, p.organisationId);
    const mappings = [...known.rules, ...known.relationRules];
    return { gives: keys.some(key => givesAuthority(key, mappings)), known };
  };
  /**
   * The managers of the unit a `unit:` group names. Their grant carries the unit's label without their being members of
   * that group, so a new or renamed unit group re-derives them too; any other group names nobody beyond its members.
   */
  const managersOfUnit = (tx: ProvisionTx, externalId: string | null): Promise<string[]> => {
    const unit = unitGroupOf(externalId);
    return unit === undefined ? Promise.resolve([]) : tx.members(MANAGER_KEY + unit);
  };
  /**
   * The people employed on the unit a `unit:` group names. An employment places them on the unit whether or not they
   * are members of its group (D149), so a unit group that is new, renamed, given another key or removed
   * re-derives them too: they carry the unit's label, and are of the unit only while the organisation holds it.
   */
  const employedOnUnit = (tx: ProvisionTx, p: Provisioner, externalId: string | null): Promise<string[]> => {
    const unit = unitGroupOf(externalId);
    return unit === undefined ? Promise.resolve([]) : tx.employedOn(p.organisationId, unit);
  };
  /**
   * A write of a `unit:` or `unit-manager:` group holds its unit first, under the key it had and the key it gets: the
   * two groups of one unit are written one after the other, so each reads the other's members and name as committed.
   */
  const lockUnitsOf = async (tx: ProvisionTx, ...externalIds: Array<string | null>) => {
    const units = externalIds.flatMap(key => unitOfKey(key) ?? []);
    if (units.length) await tx.lockUnits(units);
  };
  /**
   * D99: a `unit:` group is a node of the organisation tree, and its parent is the unit group above it. The parent
   * must exist in the provisioner's organisation, so a tree is pushed from the root down, and it may not stand below
   * the unit it is given to. Read under the tree's lock, which the caller took.
   */
  const refused = (detail: string) => new ScimError(400, `${detail} The group was not stored.`, 'invalidValue');
  /**
   * D101: a unit belongs to the organisation that pushed it. `unit:<id>` and `unit-manager:<id>` are two keys for one
   * unit, so the uniqueness of each does not stop one organisation from naming a manager of another's unit; this
   * does. Asked after the unit is held (`lockUnitsOf`), so two organisations cannot take one unit at once.
   */
  const unitOfOwnOrganisation = async (tx: ProvisionTx, p: Provisioner, fields: GroupFields) => {
    const unit = unitOfKey(fields.externalId);
    if (unit === undefined) return;
    for (const key of [UNIT_KEY + unit, MANAGER_KEY + unit]) {
      const held = await tx.findGroup('externalId', key);
      if (held && held.organisationId !== p.organisationId)
        throw refused(`The unit '${unit}' is not a unit of this organisation (D101).`);
    }
  };
  const placeInTree = async (tx: ProvisionTx, p: Provisioner, fields: GroupFields) => {
    const unit = unitGroupOf(fields.externalId);
    if (fields.parent === null || unit === undefined) return;
    const parent = await tx.findGroup('externalId', UNIT_KEY + fields.parent);
    if (!parent || parent.organisationId !== p.organisationId)
      throw refused(
        `The parent '${UNIT_KEY}${fields.parent}' is not a unit of this organisation; a tree is pushed from the root down (D99).`,
      );
    // Walked as the tree reads it: a stored parent that names no node of the organisation, such as a unit key written
    // wrong that a group stored before D96 still carries, ends the walk, as it is read as no parent there.
    const above = async (id: string) =>
      id === fields.parent ? parent.parentUnitId : (await tx.unitTree(p.organisationId, [id]))[0]?.parentId;
    if (await closesCycle(unit, fields.parent, above))
      throw refused(
        `The parent '${UNIT_KEY}${fields.parent}' stands below the unit '${unit}' and would close a cycle (D99).`,
      );
  };
  /** The units that name `unit` as their parent, as the text of a refusal: a unit with units below it stays. */
  const unitsBelow = async (tx: ProvisionTx, unit: string) => {
    const below = (await tx.childUnits(unit)).map(c => `'${UNIT_KEY}${c.id}'`);
    return below.length
      ? `The unit '${unit}' still has ${below.length === 1 ? 'a unit' : below.length + ' units'} below it (${below.slice(0, 5).join(', ')}${below.length > 5 ? ', …' : ''}); move or remove them first, a tree is removed from the leaves up (D99).`
      : undefined;
  };
  /**
   * A `unit:` group names its unit. The label is written before anyone is derived, so a manager, who carries the label
   * without being a member of that group, reads the new name whatever order the people are derived in. Only for a unit
   * somebody is assigned to once the write is done (`assigned`: its members and managers): a unit row exists per
   * assignment, not per group.
   */
  const nameUnit = async (tx: ProvisionTx, p: Provisioner, fields: GroupFields, assigned: readonly string[]) => {
    const id = unitGroupOf(fields.externalId);
    if (!id || !assigned.length) return;
    if ((await tx.unitLabels([id], p.organisationId))[id] !== fields.label)
      await tx.writeUnits(p.organisationId, [{ id, label: fields.label }]);
  };
  /**
   * D108 item 5: a `position:` group is a position of the organisation, named by the group's name. Unlike a unit row,
   * the position's row is written whether anyone holds it or not: the organisation's positions are the ones its source
   * sends. A position needs no check of the organisation beyond the group's (D101): it has one key, and a group's key
   * is unique across the installation, so one organisation holds a code at a time. `positionOf` reads the row as it
   * stands, before anyone is held; `namePosition` writes it once everyone the write touches or derives is held
   * (`heldAt`), so a holder's own write, which derives them and writes the same row, waits for this one, and before
   * anyone is derived, so a holder is given the row as it now reads. A group stored before Clew read the key has no row
   * and members who hold nothing yet: its write derives everyone in it (`missing`).
   */
  const positionOf = async (tx: ProvisionTx, p: Provisioner, fields: GroupFields) => {
    const code = positionOfKey(fields.externalId);
    if (code === undefined) return undefined;
    const label = (await tx.positionLabels(p.organisationId, [code]))[code];
    return { code, label, missing: label === undefined };
  };
  const namePosition = async (
    tx: ProvisionTx,
    p: Provisioner,
    fields: GroupFields,
    position: Awaited<ReturnType<typeof positionOf>>,
  ) => {
    if (position && position.label !== fields.label)
      await tx.writePositions(p.organisationId, [{ code: position.code, label: fields.label }]);
  };
  /**
   * The position a group stops carrying, once the people who held it through the group have been derived without it:
   * the group was removed or took another key. Its row goes, and with it nothing a person still holds.
   */
  const dropPosition = async (tx: ProvisionTx, p: Provisioner, was: string | null, now: string | null) => {
    const code = positionOfKey(was);
    if (code !== undefined && code !== positionOfKey(now)) await tx.removePositions(p.organisationId, [code]);
  };
  /**
   * A group write holds everyone it touches or derives before it takes its time of change, in one pass in id order as
   * every writer takes people (a second pass could wait on a writer that waits on the first), after the group, the
   * tree, the units and the capability rows. A person's own write holds them before it takes its time, so one that came
   * first has committed under an earlier time and one that comes later waits: no time this write gives a member, or a
   * group it takes a member out of, is earlier than the member's last change. The time was once taken first, and a
   * member renamed meanwhile, then taken out, left the group, and the member, with a time older than one already read.
   */
  const heldAt = async (tx: ProvisionTx, touched: readonly string[], derived: readonly string[] = []) => {
    await tx.lockPeople([...touched, ...derived]);
    return now();
  };
  /**
   * What a group write does to people once the group is written, everyone of them held (`heldAt`). A User resource
   * lists its person's groups by name, so whoever came or went, and every member of a group that was renamed or
   * removed, gets the write's time of change (`touched`, RFC 7643 §3.1); those whose grant it can move are derived
   * (`derive`).
   */
  const settle = async (
    tx: ProvisionTx,
    p: Provisioner,
    at: string,
    touched: readonly string[],
    derive?: { people: readonly string[]; known: OrganisationRules },
  ) => {
    if (touched.length) await tx.touchUsers(touched, at);
    if (derive?.people.length) await derivation.deriveAll(tx, actorOf(p), derive.people, derive.known);
  };
  /**
   * A person's groups are not read when the client asked to have them left out. The daily comparison lists everybody
   * with three attributes, and reading each person's groups for it was one query a person to answer nothing.
   */
  const userView = async (tx: ProvisionTx, record: UserRecord, base: string, projection?: Projection) =>
    project(
      userResource(record, leavesOut(projection, 'groups') ? [] : await tx.userGroups(record.id), base),
      projection,
    );
  /**
   * A Group resource lists each member's name, so a member's new name changes it as a write of the group does: its time
   * of change is the later of the group's own and the last new name among its current members (RFC 7643 §3.1, the
   * mirror of S13). A user write never writes the group for it, which would take the group after the person, against
   * the order every group write takes them in. The time is read from the rows that carry the names, in one statement,
   * so an answer never shows a name newer than its time; a `GET` and a list read the group and its members from one
   * snapshot besides, so the group's own time and its members hold together too. When the client asked to have the
   * members left out (Entra does, for large groups), only their last new name is read, once for a page of groups, and
   * not even that when it asked to have `meta` left out.
   */
  const groupViews = async (
    tx: ProvisionTx,
    records: readonly GroupRecord[],
    base: string,
    projection?: Projection,
  ): Promise<ScimGroup[]> => {
    const withMembers = !leavesOut(projection, 'members'),
      namesChanged =
        withMembers || leavesOut(projection, 'meta')
          ? new Map<string, string>()
          : await tx.memberNamesChanged(records.map(record => record.id)),
      views: ScimGroup[] = [];
    for (const record of records) {
      const members = withMembers ? await tx.groupMembers(record.id) : [],
        updatedAt = [namesChanged.get(record.id), ...members.map(member => member.nameChangedAt)].reduce<string>(
          (latest, at) => (at && at > latest ? at : latest),
          record.updatedAt,
        );
      views.push(project(groupResource({ ...record, updatedAt }, members, base), projection));
    }
    return views;
  };
  const groupView = async (tx: ProvisionTx, record: GroupRecord, base: string, projection?: Projection) =>
    (await groupViews(tx, [record], base, projection))[0]!;
  const fieldsOf = (u: UserRecord): UserFields => ({
    externalId: u.externalId ?? '',
    userName: u.userName ?? u.id,
    name: u.name,
    email: u.email ?? '',
    phoneNumbers: u.phoneNumbers,
    employments: u.employments,
    title: u.title,
    enabled: u.enabled,
  });
  const changedKeys = <T extends object>(before: T, after: T) =>
    (Object.keys(after) as Array<keyof T>).filter(k => !isDeepStrictEqual(before[k], after[k])).map(String);
  /**
   * D114: an employment names a unit this organisation holds, by the id its `unit:` group carries. One that names no
   * such unit is refused where it is written, with the units it got wrong: stored, it would show a colleague an id
   * where a unit's name belongs. Asked when a request changes the list, so a unit that has since been removed does not
   * stop the person's other changes; the check names such an employment.
   */
  const unknownUnits = async (tx: ProvisionTx, p: Provisioner, employments: UserFields['employments']) => {
    const named = [...new Set(employments.map(job => job.unitId))];
    if (!named.length) return undefined;
    const held = new Set((await tx.unitTree(p.organisationId, named)).map(unit => unit.id)),
      unknown = named.filter(id => !held.has(id));
    if (!unknown.length) return undefined;
    const listed = unknown.slice(0, 5).map(id => `'${id}'`);
    return new ScimError(
      400,
      `${unknown.length === 1 ? 'An employment names' : 'Employments name'} ${listed.join(', ')}${unknown.length > listed.length ? ` and ${unknown.length - listed.length} more` : ''}, which ${unknown.length === 1 ? 'is no unit' : 'are no units'} of this organisation. 'unitId' is what follows '${UNIT_KEY}' in the externalId of the unit's group, and the unit is sent before an employment names it (D114). The user was not stored.`,
      'invalidValue',
    );
  };
  /**
   * D147: an employment names its manager by the id of a user of this organisation, and never the person themselves.
   * One that names anybody else is refused where it is written, as an employment on a unit the organisation does not
   * hold is: stored, it would name someone no reader could open. A manager who has been deactivated is still a user of
   * the organisation and is stored, since the directory says so; what a deactivated manager means is for whatever reads
   * the line. A chain of managers that comes back to the person is not looked for here: two writes can close one between
   * them, so a reader of the line stops at a person it has passed. Asked when a request changes the list.
   */
  const unknownManagers = async (
    tx: ProvisionTx,
    p: Provisioner,
    employments: UserFields['employments'],
    personId?: string,
  ) => {
    const named = [...new Set(employments.flatMap(job => (job.managerId === undefined ? [] : [job.managerId])))];
    if (!named.length) return undefined;
    if (personId !== undefined && named.includes(personId))
      return new ScimError(
        400,
        "An employment names the user as their own manager. 'managerId' is the id of another user of this organisation (D147). The user was not stored.",
        'invalidValue',
      );
    // A NUL is nobody's id, and PostgreSQL refuses to compare one.
    const asked = named.filter(id => !id.includes('\u0000')),
      held = new Set(asked.length ? await tx.usersAmong(p.organisationId, asked) : []),
      unknown = named.filter(id => !held.has(id));
    if (!unknown.length) return undefined;
    const listed = unknown.slice(0, 5).map(id => `'${id.replaceAll('\u0000', '')}'`);
    return new ScimError(
      400,
      `${unknown.length === 1 ? 'An employment names the manager' : 'Employments name the managers'} ${listed.join(', ')}${unknown.length > listed.length ? ` and ${unknown.length - listed.length} more` : ''}, which ${unknown.length === 1 ? 'is no user' : 'are no users'} of this organisation. 'managerId' is the 'id' of the manager's User resource, and the manager is sent before an employment names them (D147). The user was not stored.`,
      'invalidValue',
    );
  };
  /** The managers a list of employments names, each once. A NUL is nobody's id, and PostgreSQL refuses to compare one. */
  const managersIn = (employments: UserFields['employments']) =>
    [...new Set(employments.flatMap(job => (job.managerId === undefined ? [] : [job.managerId])))].filter(
      id => !id.includes('\u0000'),
    );
  /**
   * The units a write of a person must hold (D149): those its employments name, before and after, when the write can
   * change where the person belongs, which is that the list changes or that the person comes or goes. An employment
   * places a person only on a unit the organisation holds, and whether it does is the unit group's fact, which a
   * write of that group changes under the unit's lock. Held here too, the two run one after the other: a unit cannot
   * be removed between the check that it exists and the write of an employment on it, which would leave the person
   * as of a unit that is gone, and its id free for another organisation to take with that person still on it.
   */
  const unitsPlacing = (held: Pick<UserFields, 'employments' | 'enabled'>, sent: UserFields) =>
    held.enabled === sent.enabled && isDeepStrictEqual(held.employments, sent.employments)
      ? []
      : [...new Set([...held.employments, ...sent.employments].map(job => job.unitId))].filter(
          unit => !unit.includes('\u0000'),
        );
  /**
   * A write of a person can move somebody else's grant (D149): whoever the person's employments name is a
   * manager while the person is active and names them. So such a write holds the person together with every manager
   * named before and after it, in id order as every writer takes people, before it writes anything, and derives those
   * managers when it has written (`writeUser`). Whom to hold is read before anybody is held, so it is read again once
   * they are: when a write that came between named somebody else, this one starts over, and after a few such turns it
   * answers 409 for the client to send again.
   */
  const withManagersHeld = async <T>(
    p: Provisioner,
    id: string,
    sentOf: (current: UserRecord) => UserFields,
    write: (tx: ProvisionTx, current: UserRecord, sent: UserFields) => Promise<T>,
  ): Promise<T> => {
    const again = Symbol('again');
    for (let turn = 0; turn < MANAGER_HOLD_TURNS; turn++) {
      const done = await deps.store.transaction(async (tx): Promise<T | typeof again> => {
        const seen = await userOr404(tx, p, id),
          first = sentOf(seen),
          expected = new Set([...managersIn(seen.employments), ...managersIn(first.employments)]),
          units = new Set(unitsPlacing(seen, first));
        // The units before the people, as a group write takes them.
        await tx.lockUnits([...units]);
        await tx.lockPeople([id, ...expected]);
        const current = await userOr404(tx, p, id, true),
          sent = sentOf(current);
        return [...managersIn(current.employments), ...managersIn(sent.employments)].every(m => expected.has(m)) &&
          unitsPlacing(current, sent).every(unit => units.has(unit))
          ? write(tx, current, sent)
          : again;
      });
      if (done !== again) return done as T;
    }
    throw new ScimError(
      409,
      `User '${id}' was changed by other requests while this one was read. Nothing was stored: send the request again.`,
    );
  };
  /**
   * What a write of a person does to the managers their employments name (D149), given whom they named as an active
   * person before it and whom they name as one after it. Somebody no longer named may have no report left, and is
   * derived. Somebody named now has this person as a report: one whose grant says manager already stays one whatever
   * else is true of them, so only one whose grant does not is derived, which keeps a push of a large unit from
   * deriving its manager once for each of its people. That is asked of everyone named now, also one named before, so a
   * grant written before this rule is put right by the next write of anybody who names its person, a write that
   * changes nothing included.
   */
  const deriveManagers = async (
    tx: ProvisionTx,
    p: Provisioner,
    before: readonly string[],
    after: readonly string[],
  ) => {
    const lost = before.filter(id => !after.includes(id)),
      gained: string[] = [];
    for (const id of after) if ((await tx.grant(id))?.role !== 'manager') gained.push(id);
    await derivation.deriveAll(tx, actorOf(p), [...lost, ...gained]);
  };
  async function writeUser(
    tx: ProvisionTx,
    p: Provisioner,
    current: UserRecord,
    sent: UserFields,
    action: string,
    base: string,
  ) {
    const held = fieldsOf(current),
      wrongUnit = isDeepStrictEqual(held.employments, sent.employments)
        ? undefined
        : ((await unknownUnits(tx, p, sent.employments)) ??
          (await unknownManagers(tx, p, sent.employments, current.id)));
    // D113: beside a deactivation the list is left as it was, and the person is deactivated.
    if (wrongUnit && !saysInactive(sent)) throw wrongUnit;
    const fields = wrongUnit ? { ...sent, employments: held.employments } : sent,
      changed = changedKeys(held, fields),
      flipped = current.enabled !== fields.enabled,
      at = now(),
      // Only what changed is checked and written. A row from before provisioning holds no `externalId`: a patch of
      // its name must not store the empty string as its id, nor be refused because another such row has none.
      written = Object.fromEntries(changed.map(key => [key, fields[key as keyof UserFields]])) as Partial<UserFields>;
    await uniqueUser(tx, written, current.id);
    if (changed.length) {
      // A flip of `active` is what an operator reads the audit for, whatever verb carried it (DELETE writes the same);
      // the verb travels in the details.
      const recorded = flipped ? (fields.enabled ? 'scim.user.reactivated' : 'scim.user.deactivated') : action;
      // Whom a leaver reported to is read before their row is written: the same write may clear their employments.
      const line =
        flipped && !fields.enabled ? await lineOf(tx, current.organisationId, current.id, held.employments) : undefined;
      await tx.updateUser(current.id, { ...written, updatedAt: at });
      await tx.audit({
        actor: actorOf(p),
        action: recorded,
        subject: 'person:' + current.id,
        details: {
          changed,
          ...(flipped ? { via: action } : {}),
          userName: fields.userName,
          externalId: fields.externalId,
        },
      });
      // D108 item 14: the domains that keep data about the person hear of it in this transaction, whatever verb it was.
      if (flipped)
        await tx.leavers[fields.enabled ? 'reactivated' : 'deactivated']({
          actor: actorOf(p),
          personId: current.id,
          organisationId: current.organisationId,
          at,
          ...(line ? { managers: line } : {}),
        });
    }
    // Always: silent when nothing moved, and it heals a projection written before provisioning existed.
    await derivation.deriveWithin(tx, actorOf(p), current.id);
    // D149: whoever the person named as manager while active, or names now, has a report fewer or more. They are held
    // already (`withManagersHeld`).
    await deriveManagers(
      tx,
      p,
      current.enabled ? managersIn(held.employments) : [],
      fields.enabled ? managersIn(fields.employments) : [],
    );
    return userView(tx, { ...current, ...written, updatedAt: changed.length ? at : current.updatedAt }, base);
  }
  async function writeGroup(
    tx: ProvisionTx,
    p: Provisioner,
    current: GroupRecord,
    fields: GroupFields,
    action: string,
    base: string,
  ) {
    assertAcceptedKey(fields);
    assertAcceptedParent(fields);
    assertAcceptedIdentifiers(fields);
    // The tree is held only by a write that changes it: a reconciliation replays every unit and moves none.
    const was = unitGroupOf(current.externalId),
      // D148: what other systems know the unit by. Nobody's grant follows from it, so nobody is derived for it.
      identified = !sameIdentifiers(current.unitIdentifiers, fields.identifiers),
      moved = current.parentUnitId !== fields.parent,
      leaves = was !== undefined && was !== unitGroupOf(fields.externalId);
    if (moved || leaves) await tx.lockTree(p.organisationId);
    await lockUnitsOf(tx, current.externalId, fields.externalId);
    await uniqueGroup(tx, fields, current.id);
    await unitOfOwnOrganisation(tx, p, fields);
    if (leaves) {
      const below = await unitsBelow(tx, was);
      if (below) throw refused(below);
    }
    if (moved) await placeInTree(tx, p, fields);
    const before = (await tx.groupMembers(current.id)).map(m => m.id),
      had = new Set(before),
      wanted = new Set(fields.members),
      added = fields.members.filter(id => !had.has(id)),
      removed = before.filter(id => !wanted.has(id)),
      relabelled = current.label !== fields.label,
      rekeyed = current.externalId !== fields.externalId,
      renamed = relabelled || rekeyed;
    // Only who comes is asked about: who is already in the group was asked about when they came.
    await membersExist(tx, p, added);
    // D108 item 5: a `position:` group's row as it stands. A group stored before Clew read the key has none: it gets it
    // on this write, also one that changes nothing else, and everyone in the group is derived in it, so each holds the
    // position and has it in the audit.
    const position = await positionOf(tx, p, fields),
      positionMissing = position?.missing === true;
    if (!renamed && !moved && !identified && !added.length && !removed.length && !positionMissing)
      return groupView(tx, current, base);
    // Who may hold another grant afterwards. Only a group that gives its members something, under the key it had or
    // the key it gets, moves a grant; any other group moves none, whatever the write did to it. A new key changes what
    // every member gets, and a `unit:` group's new name the label its members and the unit's managers carry, as a
    // position's first row does its holders'. A new name of any other group, and a move in the tree, change nobody's
    // grant. Otherwise only those who came or went.
    const unitRenamed = relabelled && unitGroupOf(fields.externalId) !== undefined;
    let derive: { people: string[]; known: OrganisationRules } | undefined,
      assigned: string[] = [];
    if (added.length || removed.length || rekeyed || unitRenamed || positionMissing) {
      const authority = await authorityOf(tx, p, current.externalId, fields.externalId);
      if (authority.gives) {
        derive = { people: [...added, ...removed, ...(positionMissing ? before : [])], known: authority.known };
        if (rekeyed || unitRenamed) {
          // Read before the group is written, to be held with everyone else. A group that gives up the unit's manager
          // key for its unit key names no manager by it: once written, its members manage the unit no more.
          const unit = unitGroupOf(fields.externalId),
            managers =
              unit !== undefined && current.externalId === MANAGER_KEY + unit
                ? []
                : await managersOfUnit(tx, fields.externalId);
          // Whoever is employed on the unit it named, or names now, is of it only while a unit group names it.
          const employed = [
            ...(await employedOnUnit(tx, p, current.externalId)),
            ...(await employedOnUnit(tx, p, fields.externalId)),
          ];
          assigned = [...fields.members, ...managers, ...employed];
          derive.people = [...before, ...assigned];
        }
      }
    }
    // A new key or a move in the tree is not on a member's resource; a new name is, as the display of the group.
    const touched = [...added, ...removed, ...(relabelled ? fields.members : [])],
      at = await heldAt(tx, touched, derive?.people);
    // Nothing of the group itself changed: the position's first row alone, with its holders derived.
    if (!renamed && !moved && !identified && !added.length && !removed.length) {
      await namePosition(tx, p, fields, position);
      await settle(tx, p, at, [], derive);
      return groupView(tx, current, base);
    }
    // The time of the change is the group's whoever caused it: a member who came or went changes the resource a
    // client reads, and `meta.lastModified` once went back to the old time on the next read (RFC 7643 §3.1).
    await tx.updateGroup(current.id, {
      ...(renamed || moved ? { externalId: fields.externalId, label: fields.label, parentUnitId: fields.parent } : {}),
      ...(identified ? { unitIdentifiers: fields.identifiers } : {}),
      updatedAt: at,
    });
    if (added.length || removed.length) await tx.setGroupMembers(current.id, fields.members);
    await tx.audit({
      actor: actorOf(p),
      action,
      subject: 'group:' + current.id,
      details: {
        externalId: fields.externalId,
        displayName: fields.label,
        ...(renamed ? { renamed: true } : {}),
        // D99: a move in the tree, with the unit above before and after; nobody's grant follows from it.
        ...(moved ? { parent: { before: current.parentUnitId, after: fields.parent } } : {}),
        // D148: what other systems know the unit by, before and after. They name a unit, never a person.
        ...(identified ? { identifiers: { before: current.unitIdentifiers, after: fields.identifiers } } : {}),
        added: added.length,
        removed: removed.length,
        members: fields.members.length,
        ...namedInAudit('addedPeople', added),
        ...namedInAudit('removedPeople', removed),
      },
    });
    await nameUnit(tx, p, fields, assigned);
    await namePosition(tx, p, fields, position);
    await settle(tx, p, at, touched, derive);
    await dropPosition(tx, p, current.externalId, fields.externalId);
    return groupView(
      tx,
      {
        ...current,
        externalId: fields.externalId,
        label: fields.label,
        parentUnitId: fields.parent,
        unitIdentifiers: fields.identifiers,
        updatedAt: at,
      },
      base,
    );
  }
  return {
    /**
     * The provisioner behind a bearer token, or undefined when none is active for it. Being seen is recorded: the
     * time at most once a minute, and an audit row (`provisioner.seen`) when a run begins, which is the one trace a
     * push that changes nothing leaves. The time is a liveness mark, not a change to what Clew holds.
     */
    authenticate: (token: string): Promise<Provisioner | undefined> =>
      deps.store.transaction(async tx => {
        const at = now(),
          found = await tx.provisioner(deps.digest(token), at);
        if (!found) return undefined;
        const { lastSeenAt, ...provisioner } = found;
        if (lastSeenAt === null || since(at, lastSeenAt) >= SEEN_INTERVAL_MS) {
          // Of several requests that arrive together, the one that moves the mark records the run.
          const moved = await tx.touchProvisioner(provisioner.id, at, lastSeenAt);
          if (moved && (lastSeenAt === null || since(at, lastSeenAt) >= RUN_GAP_MS))
            await tx.audit({
              actor: actorOf(provisioner),
              action: 'provisioner.seen',
              subject: 'provisioner:' + provisioner.id,
              details: { previous: lastSeenAt },
            });
        }
        return provisioner;
      }),
    createUser: (p: Provisioner, body: unknown, base: string): Promise<ScimUser> =>
      deps.store.transaction(async tx => {
        const fields = userFields(body);
        // D149: the units the new person's employments name are held before they are checked, so none is removed
        // between the check and the write (`unitsPlacing`).
        await tx.lockUnits(unitsPlacing({ employments: [], enabled: fields.enabled }, fields));
        await uniqueUser(tx, fields);
        const wrongUnit =
          (await unknownUnits(tx, p, fields.employments)) ?? (await unknownManagers(tx, p, fields.employments));
        if (wrongUnit) throw wrongUnit;
        // D149: the managers the new person names are held before anything is written, in id order as every
        // writer takes people; nobody else can hold the person, who is not there yet.
        const managers = managersIn(fields.employments);
        await tx.lockPeople(managers);
        const at = now(),
          record: UserRecord = {
            id: deps.ids(),
            organisationId: p.organisationId,
            ...fields,
            createdAt: at,
            updatedAt: at,
          };
        await tx.insertUser(record);
        await tx.audit({
          actor: actorOf(p),
          action: 'scim.user.created',
          subject: 'person:' + record.id,
          details: { userName: fields.userName, externalId: fields.externalId },
        });
        // A person pushed already deactivated is inactive from now on (D108 item 14), as one deactivated later is.
        if (!record.enabled)
          await tx.leavers.deactivated({
            actor: actorOf(p),
            personId: record.id,
            organisationId: p.organisationId,
            at,
            managers: await lineOf(tx, p.organisationId, record.id, record.employments),
          });
        await derivation.deriveWithin(tx, actorOf(p), record.id);
        // Each of them has a report more, and is a manager from now on if they were not.
        await deriveManagers(tx, p, [], record.enabled ? managers : []);
        return userResource(record, [], base);
      }),
    getUser: (p: Provisioner, id: string, base: string, projection?: Projection) =>
      deps.store.transaction(async tx => userView(tx, await userOr404(tx, p, id), base, projection), SNAPSHOT),
    listUsers: (p: Provisioner, query: ScimQuery, base: string): Promise<ScimList<ScimUser>> =>
      deps.store.transaction(async tx => {
        const filter = userFilter(query.filter),
          page = pageOf(query);
        const listed = await tx.listUsers(p.organisationId, page, filter);
        const Resources: ScimUser[] = [];
        for (const row of listed.rows) Resources.push(await userView(tx, row, base, query));
        return {
          schemas: [SCIM.list],
          totalResults: listed.total,
          startIndex: page.startIndex,
          itemsPerPage: Resources.length,
          Resources,
        };
      }, SNAPSHOT),
    replaceUser: (p: Provisioner, id: string, body: unknown, base: string) =>
      withManagersHeld(
        p,
        id,
        current => userFields(body, fieldsOf(current)),
        (tx, current, sent) => writeUser(tx, p, current, sent, 'scim.user.replaced', base),
      ),
    patchUser: (p: Provisioner, id: string, body: unknown, base: string) => {
      const operations = patchOperations(body);
      return withManagersHeld(
        p,
        id,
        current => applyUserPatch(fieldsOf(current), operations, current.id),
        (tx, current, sent) => writeUser(tx, p, current, sent, 'scim.user.patched', base),
      );
    },
    /**
     * D68: a deleted user is deactivated, never erased. Idempotent. The leavers port hears of it in the same transaction
     * (D108 item 14), as it does of a deactivation by `PATCH` or `PUT`.
     */
    deleteUser: (p: Provisioner, id: string) =>
      withManagersHeld(p, id, fieldsOf, async (tx, current) => {
        if (!current.enabled) return;
        const at = now(),
          line = await lineOf(tx, current.organisationId, id, current.employments);
        await tx.updateUser(id, { enabled: false, updatedAt: at });
        await tx.audit({
          actor: actorOf(p),
          action: 'scim.user.deactivated',
          subject: 'person:' + id,
          details: { userName: current.userName, externalId: current.externalId },
        });
        await tx.leavers.deactivated({
          actor: actorOf(p),
          personId: id,
          organisationId: current.organisationId,
          at,
          managers: line,
        });
        await derivation.deriveWithin(tx, actorOf(p), id);
        // D149: whoever they named as manager has a report fewer.
        await deriveManagers(tx, p, managersIn(current.employments), []);
      }),
    createGroup: (p: Provisioner, body: unknown, base: string): Promise<ScimGroup> =>
      deps.store.transaction(async tx => {
        const fields = groupFields(body);
        assertAcceptedKey(fields);
        assertAcceptedParent(fields);
        assertAcceptedIdentifiers(fields);
        if (fields.parent !== null) await tx.lockTree(p.organisationId);
        await lockUnitsOf(tx, fields.externalId);
        await uniqueGroup(tx, fields);
        await unitOfOwnOrganisation(tx, p, fields);
        await placeInTree(tx, p, fields);
        await membersExist(tx, p, fields.members);
        const position = await positionOf(tx, p, fields);
        // Its members are touched; they and the managers of a unit it names are derived when it gives them something.
        const assigned = [
            ...fields.members,
            ...(await managersOfUnit(tx, fields.externalId)),
            ...(await employedOnUnit(tx, p, fields.externalId)),
          ],
          authority = assigned.length ? await authorityOf(tx, p, fields.externalId) : undefined,
          derive = authority?.gives ? { people: assigned, known: authority.known } : undefined,
          at = await heldAt(tx, fields.members, derive?.people),
          record: GroupRecord = {
            id: deps.ids(),
            organisationId: p.organisationId,
            externalId: fields.externalId,
            label: fields.label,
            parentUnitId: fields.parent,
            unitIdentifiers: fields.identifiers,
            createdAt: at,
            updatedAt: at,
          };
        await tx.insertGroup(record);
        await tx.setGroupMembers(record.id, fields.members);
        await tx.audit({
          actor: actorOf(p),
          action: 'scim.group.created',
          subject: 'group:' + record.id,
          details: {
            externalId: fields.externalId,
            displayName: fields.label,
            ...(fields.parent !== null ? { parent: fields.parent } : {}),
            ...(fields.identifiers.length ? { identifiers: fields.identifiers } : {}),
            members: fields.members.length,
            ...namedInAudit('addedPeople', fields.members),
          },
        });
        if (derive) await nameUnit(tx, p, fields, assigned);
        await namePosition(tx, p, fields, position);
        await settle(tx, p, at, fields.members, derive);
        return groupView(tx, record, base);
      }),
    getGroup: (p: Provisioner, id: string, base: string, projection?: Projection) =>
      deps.store.transaction(async tx => groupView(tx, await groupOr404(tx, p, id), base, projection), SNAPSHOT),
    listGroups: (p: Provisioner, query: ScimQuery, base: string): Promise<ScimList<ScimGroup>> =>
      deps.store.transaction(async tx => {
        // SCIM filters on displayName; the column is Clew's `label`.
        const parsed = parseFilter(query.filter, ['externalId', 'displayName']),
          filter = parsed && {
            attribute: (parsed.attribute === 'displayName' ? 'label' : 'externalId') as 'externalId' | 'label',
            value: parsed.value,
          },
          page = pageOf(query);
        const listed = await tx.listGroups(p.organisationId, page, filter);
        const Resources = await groupViews(tx, listed.rows, base, query);
        return {
          schemas: [SCIM.list],
          totalResults: listed.total,
          startIndex: page.startIndex,
          itemsPerPage: Resources.length,
          Resources,
        };
      }, SNAPSHOT),
    replaceGroup: (p: Provisioner, id: string, body: unknown, base: string) =>
      deps.store.transaction(async tx => {
        const current = await groupOr404(tx, p, id, true);
        return writeGroup(tx, p, current, groupFields(body, current), 'scim.group.replaced', base);
      }),
    patchGroup: (p: Provisioner, id: string, body: unknown, base: string) =>
      deps.store.transaction(async tx => {
        // Locked before its members are read: a patch is a read and a write, and two of them must not interleave.
        const operations = patchOperations(body),
          current = await groupOr404(tx, p, id, true),
          members = (await tx.groupMembers(id)).map(m => m.id);
        const next = applyGroupPatch(
          {
            externalId: current.externalId,
            label: current.label,
            parent: current.parentUnitId,
            identifiers: current.unitIdentifiers,
            members,
          },
          operations,
          current.id,
        );
        return writeGroup(tx, p, current, next, 'scim.group.patched', base);
      }),
    /**
     * Removes the group; its members lose what it gave them, and their resources, which no longer list it, the time
     * they last changed. The group-capability rows stay (D85). A `unit:` group with units below it is not removed
     * (D99): the answer is 409 and names them. A `position:` group
     * takes its position with it (D108 item 5), once its members have been derived without it.
     */
    deleteGroup: (p: Provisioner, id: string) =>
      deps.store.transaction(async tx => {
        const current = await groupOr404(tx, p, id, true),
          unit = unitGroupOf(current.externalId);
        if (unit !== undefined) {
          await tx.lockTree(p.organisationId);
          const below = await unitsBelow(tx, unit);
          if (below) throw new ScimError(409, `${below} The group was not removed.`);
        }
        await lockUnitsOf(tx, current.externalId);
        // Its members' resources no longer list it; they are derived when it gave them something, and so are the
        // people employed on a unit it named, who are of the unit no more (D149).
        const members = (await tx.groupMembers(id)).map(m => m.id),
          reached = [...members, ...(await employedOnUnit(tx, p, current.externalId))],
          authority = reached.length ? await authorityOf(tx, p, current.externalId) : undefined,
          derive = authority?.gives ? { people: reached, known: authority.known } : undefined,
          at = await heldAt(tx, members, derive?.people);
        await tx.deleteGroup(id);
        await tx.audit({
          actor: actorOf(p),
          action: 'scim.group.removed',
          subject: 'group:' + id,
          details: {
            externalId: current.externalId,
            displayName: current.label,
            // D148: what other systems knew the unit by goes with it, and is said as every change of the list is.
            ...(current.unitIdentifiers.length ? { identifiers: { before: current.unitIdentifiers, after: [] } } : {}),
            members: members.length,
            ...namedInAudit('removedPeople', members),
          },
        });
        await settle(tx, p, at, members, derive);
        await dropPosition(tx, p, current.externalId, null);
      }),
  };
}
export type ScimUsecases = ReturnType<typeof scimUsecases>;

/**
 * Administration › Användare (D62, D68, D85): what an administrator with `admin.users` sees and may change. Identity,
 * units and roles are read only here; they come from the provisioner. What is written is D85's rows, a group gives a
 * capability, and D121's, a group gives a relation to people by grant (`registrar`), kept apart since a capability is no
 * relation (D118): audited per row (`group-capability.added`, `group-capability.removed`, `group-relation.added`,
 * `group-relation.removed`), and every current member of the group is re-derived in the same transaction, so a grant
 * never lags the row that produced it.
 *
 * The people are read a page at a time (D100): the store narrows, orders and counts, and only the rows of the page are
 * filled in with unit, grant and binding, so a page costs the same in an organisation of two hundred and one of
 * twenty thousand. A read writes nothing, so it has no audit row.
 */
export const USERS_ADMIN_CAPABILITY: Capability = 'admin.users';
/**
 * D109: a provisioner sends a change when it happens and reconciles the whole source at least daily, so it is heard
 * from daily whatever else it sends. One not seen for two days has missed a reconciliation with a day's margin, and
 * the page says so.
 */
const PROVISIONER_SILENT_MS = 48 * 60 * 60 * 1000;
/**
 * How many of the organisation's groups the overview offers, the first by name. A catalogue may push every group it
 * has (D85), so the overview stays one bounded read, and the group picker asks the server for the others.
 */
const GROUPS_OFFERED = 10_000;
/**
 * Whether a value from a request holds a NUL. Nothing stored holds one (SCIM refuses it), and PostgreSQL refuses to
 * compare one, so such a value names nothing and is never handed to the store.
 */
const holdsNul = (value: string) => value.includes('\u0000');
/**
 * D107: a provisioner's key replaced, as the page and the operator's script replace it. The key it replaces answers
 * for the grace period, so the client is switched without a push failing; 0 ends it at once. One replaced key is kept
 * (item 5): a key replaced before that one and still in its own grace period stops answering now, whatever period is
 * chosen, and the audit row says until when it would have (`endedEarlier`). Never the key in the audit.
 */
async function rotateKey(
  tx: ProvisionTx,
  keys: { token: () => string; digest: (token: string) => string },
  actor: string,
  held: { id: string; previousValidUntil: string | null },
  graceHours: number,
  at: string,
): Promise<{ token: string; previousValidUntil: string | null; endedEarlier: string | null }> {
  const token = keys.token(),
    until = graceHours > 0 ? new Date(Date.parse(at) + graceHours * 60 * 60 * 1000).toISOString() : null,
    endedEarlier = held.previousValidUntil !== null && held.previousValidUntil > at ? held.previousValidUntil : null;
  await tx.rotateProvisioner(held.id, keys.digest(token), until);
  await tx.audit({
    actor,
    action: 'provisioner.rotated',
    subject: 'provisioner:' + held.id,
    details: { graceHours, previousValidUntil: until, ...(endedEarlier ? { endedEarlier } : {}) },
  });
  return { token, previousValidUntil: until, endedEarlier };
}
/** D107: every key of a provisioner ended at `at`, audited. Its pushes answer 401 from then on. */
async function revokeKey(tx: ProvisionTx, actor: string, id: string, at: string) {
  await tx.revokeProvisioner(id, at);
  await tx.audit({ actor, action: 'provisioner.revoked', subject: 'provisioner:' + id, details: {} });
}
/**
 * The operator's half of D107 (item 6): `scripts/provisioner-token.ts` replaces and takes back a key through these, in
 * one transaction of the store with the audit row the page writes, the operator as the actor. The operator holds the
 * installation, so a provisioner of any organisation is theirs. An id that names no active provisioner answers
 * undefined and writes nothing.
 */
export function provisionerKeyUsecases(deps: {
  store: ProvisionStore;
  clock: () => Date;
  token: () => string;
  digest: (token: string) => string;
}) {
  const active = async (tx: ProvisionTx, id: string) => {
    const held = await tx.provisionerById(id);
    return held && !held.revoked ? held : undefined;
  };
  return {
    rotate: (actor: string, id: string, graceHours: number) =>
      deps.store.transaction(async tx => {
        const held = await active(tx, id);
        return held && rotateKey(tx, deps, actor, held, graceHours, deps.clock().toISOString());
      }),
    revoke: (actor: string, id: string) =>
      deps.store.transaction(async tx => {
        if (!(await active(tx, id))) return undefined;
        await revokeKey(tx, actor, id, deps.clock().toISOString());
        return { id };
      }),
  };
}
export type ProvisionerKeyUsecases = ReturnType<typeof provisionerKeyUsecases>;
export function usersAdminUsecases(deps: {
  store: ProvisionStore;
  clock: () => Date;
  /** A new bearer token for a provisioner (D107): long and random, made on the server. */
  token: () => string;
  digest: (token: string) => string;
}) {
  const derivation = provisioningUsecases({ store: deps.store });
  const require = (persona: AuthenticatedContext) => {
    if (!persona.capabilities.includes(USERS_ADMIN_CAPABILITY)) throw new ForbiddenError();
  };
  const sorted = (capabilities: readonly string[]) => [...capabilities].filter(isCapability).sort();
  async function rowOf(tx: ProvisionTx, u: UserRecord): Promise<UserAdminRow> {
    const grant = await tx.grant(u.id);
    return {
      id: u.id,
      name: u.name,
      userName: u.userName,
      externalId: u.externalId,
      email: u.email,
      title: titlesOf(u).join(', ') || null,
      positions: await tx.positionsOf(u.id),
      enabled: u.enabled,
      bound: await tx.bound(u.id),
      assignments: (await tx.assignmentsOf(u.id)).map(({ unitId, unitLabel, role }) => ({ unitId, unitLabel, role })),
      active: grant ? { unitId: grant.unitId, unitLabel: grant.unitLabel, role: grant.role } : null,
      capabilities: grant ? sorted(grant.capabilities) : [],
      relationGrants: grantRelations(grant),
    };
  }
  async function overviewWithin(tx: ProvisionTx, persona: AuthenticatedContext): Promise<UsersAdminOverview> {
    const tree = await tx.unitTree(persona.organisationId),
      unitLabel = new Map(tree.map(n => [n.id, n.label])),
      units = tree
        .map(n => ({ id: n.id, label: n.label, parentLabel: (n.parentId && unitLabel.get(n.parentId)) || null }))
        .sort((a, b) => bySwedish(a.label, b.label) || a.id.localeCompare(b.id));
    const groups = (await tx.searchGroups(persona.organisationId, [], GROUPS_OFFERED)).map(g => ({
      id: g.externalId,
      label: g.label,
    }));
    // This organisation's rows, those whose group is gone included (D85: a row outlives its group and applies again
    // when the group returns). A row belongs to the organisation that wrote it, so another's is not here (D101). Each
    // is named by its own group, read in one go, and not by what the bounded list of groups above happens to hold.
    const rules = await tx.groupCapabilities(persona.organisationId),
      relationRules = await tx.groupRelations(persona.organisationId);
    const names = await tx.groupLabels(persona.organisationId, [
      ...new Set([...rules, ...relationRules].map(m => m.groupExternalId)),
    ]);
    const groupCapabilities: GroupCapability[] = rules
      .filter((m): m is GroupCapabilityRule & { capability: Capability } => isCapability(m.capability))
      .map(m => ({
        groupExternalId: m.groupExternalId,
        groupLabel: names.get(m.groupExternalId) ?? null,
        capability: m.capability,
      }))
      .sort(
        (a, b) =>
          (a.groupLabel ?? a.groupExternalId).localeCompare(b.groupLabel ?? b.groupExternalId, 'sv') ||
          a.capability.localeCompare(b.capability),
      );
    // D121: the groups that give a relation to people, by the same rules and kept apart from the capabilities (D118).
    const groupRelations: GroupRelation[] = relationRules
      .filter((m): m is GroupRelationRule & { relation: RelationGrant } => isRelationGrant(m.relation))
      .map(m => ({
        groupExternalId: m.groupExternalId,
        groupLabel: names.get(m.groupExternalId) ?? null,
        relation: m.relation,
      }))
      .sort(
        (a, b) =>
          (a.groupLabel ?? a.groupExternalId).localeCompare(b.groupLabel ?? b.groupExternalId, 'sv') ||
          a.relation.localeCompare(b.relation),
      );
    const at = deps.clock().toISOString(),
      provisioners = (await tx.provisioners(persona.organisationId)).map(p => ({
        id: p.id,
        label: p.label,
        lastSeenAt: p.lastSeenAt,
        silent: p.lastSeenAt === null || since(at, p.lastSeenAt) > PROVISIONER_SILENT_MS,
        previousValidUntil: p.previousValidUntil !== null && p.previousValidUntil > at ? p.previousValidUntil : null,
      }));
    return {
      groupCapabilities,
      groupRelations,
      groups,
      capabilities: [...CAPABILITIES],
      relationGrants: [...RELATION_GRANTS],
      units,
      provisioners,
    };
  }
  /**
   * D85, D121: a group gives, or stops giving, a capability or a relation to people, in one transaction with its audit
   * row (`group-capability.added`/`.removed`, `group-relation.added`/`.removed`) and every current member of the group
   * re-derived, so what the row gives is held exactly while the row and the membership are. Both mappings are decided
   * alike (ID-7 of the review of 2026-11-23). True when a row changed, false when none did, and undefined, with nothing
   * written, for an addition no group of the organisation holds the key for.
   */
  async function mapWithin(
    tx: ProvisionTx,
    actor: string,
    organisationId: string,
    groupExternalId: string,
    present: boolean,
    mapping: { capability: Capability } | { relation: RelationGrant },
  ): Promise<boolean | undefined> {
    // An id that holds a NUL names no group and no row, and the store is never handed it.
    const named = !holdsNul(groupExternalId);
    // D101: another organisation's group does not exist for this administrator, throughout. A row is the organisation's
    // that wrote it (migration 0051), so a row on an id that another organisation's group took over is a row whose
    // group is gone, and it may be removed as any such row may (D85). Only adding needs the group.
    const ownGroup = async () => {
      const found = named ? await tx.findGroup('externalId', groupExternalId) : undefined;
      return found?.organisationId === organisationId ? found : undefined;
    };
    const seen = await ownGroup();
    if (!seen && present) return undefined;
    // Locked as a SCIM write of the group locks it, and before its members are read: a member added while the row is
    // being taken away is derived after this change, and does not keep what no row gives. A write of the group that
    // holds the row now commits first, and what it left is read below.
    if (seen) await tx.readGroup(organisationId, seen.id, true);
    // Then the organisation's rows, before one is written. A group write derives from the rows it read until it commits,
    // so this waits for it and derives the members as it left them; a group write that comes later waits for this change
    // and reads the rows it leaves. That holds for a row whose group is gone and is pushed again meanwhile, which no
    // group lock covers: its members are read after the push commits, or the push reads the rows after this.
    await tx.lockGroupCapabilities(organisationId, 'change');
    // The organisation's group that holds the key now that both are held, which decides the change: a group re-keyed or
    // removed while this change waited holds it no longer, so adding is refused as it would have been after that write,
    // and nothing is written; a group pushed again under the key meanwhile holds it, with its members and name.
    const holder = await ownGroup();
    if (!holder && present) return undefined;
    const changed =
      named &&
      (await ('capability' in mapping
        ? tx.setGroupCapability(organisationId, groupExternalId, mapping.capability, present)
        : tx.setGroupRelation(organisationId, groupExternalId, mapping.relation, present)));
    if (!changed) return false;
    await tx.audit({
      actor,
      action: `${'capability' in mapping ? 'group-capability' : 'group-relation'}.${present ? 'added' : 'removed'}`,
      subject: 'group:' + groupExternalId,
      details: { ...mapping, groupLabel: holder?.label ?? null },
    });
    // The organisation's rows as this change leaves them, read once for every member of the group: they are held, so no
    // other change to them and no group write that reads them runs until this one commits. The row applies to the
    // members of the organisation's own group alone; a key another organisation's group holds names none of this
    // organisation's people (D101).
    if (holder)
      await derivation.deriveAll(
        tx,
        actor,
        await tx.members(groupExternalId),
        await organisationRules(tx, organisationId),
      );
    return true;
  }
  /**
   * The page's change of either mapping, by an administrator with `admin.users`, the name checked against the closed
   * list once they are known to hold it; the overview as the change leaves it.
   */
  async function change(
    persona: AuthenticatedContext,
    groupExternalId: string,
    present: boolean,
    mappingOf: () => { capability: Capability } | { relation: RelationGrant },
  ) {
    require(persona);
    await persona.authorize();
    const mapping = mappingOf();
    return deps.store.transaction(async tx => {
      const done = await mapWithin(
        tx,
        'person:' + persona.id,
        persona.organisationId,
        groupExternalId,
        present,
        mapping,
      );
      if (done === undefined) throw new InputError('Gruppen finns inte bland de provisionerade grupperna.');
      return overviewWithin(tx, persona);
    });
  }
  const capabilityOf = (input: GroupCapabilityInputType) => {
    if (!isCapability(input.capability)) throw new InputError('Okänd behörighet.');
    return { capability: input.capability };
  };
  const relationOf = (input: GroupRelationInputType) => {
    if (!isRelationGrant(input.relation)) throw new InputError('Okänd behörighet.');
    return { relation: input.relation };
  };
  /** An active provisioner of the administrator's own organisation; another organisation's does not exist here. */
  const ownProvisioner = async (tx: ProvisionTx, persona: AuthenticatedContext, id: string) => {
    const held = await tx.provisionerById(id);
    if (!held || held.revoked || held.organisationId !== persona.organisationId)
      throw new InputError('Katalogen finns inte.');
    return held;
  };
  /**
   * A write that answers a new key: the key once, whose it is, and the overview as it is afterwards, with the
   * provisioner's row in it. Where the key is sent is the route's to add: the server's address is no use case's.
   */
  async function keyed(
    persona: AuthenticatedContext,
    write: (tx: ProvisionTx, at: string) => Promise<Omit<ProvisionerKeyIssued, 'address' | 'overview'>>,
  ): Promise<Omit<ProvisionerKeyIssued, 'address'>> {
    require(persona);
    await persona.authorize();
    return deps.store.transaction(async tx => {
      const written = await write(tx, deps.clock().toISOString());
      return { ...written, overview: await overviewWithin(tx, persona) };
    });
  }
  return {
    async overview(persona: AuthenticatedContext) {
      require(persona);
      return deps.store.transaction(tx => overviewWithin(tx, persona));
    },
    /**
     * One page of the organisation's people (D100), by name in Swedish order. A unit is asked for with everything
     * below it in the tree, so the count is the one Organisation gives the unit's branch, deactivated people included
     * here. A page past the end, which a list that became shorter leaves behind, answers with the last page.
     */
    async people(persona: AuthenticatedContext, query: UsersAdminQueryType = {}): Promise<UsersAdminPage> {
      require(persona);
      const pageSize = query.pageSize ?? USERS_PAGE_SIZES[0],
        words = searchWords(query.text),
        // A unit id with a NUL names no unit and a word with one is in no name: such a search matches nobody, and the
        // store is not asked it.
        nobody =
          words.some(holdsNul) ||
          (query.unitId !== undefined && holdsNul(query.unitId)) ||
          (query.personId !== undefined && holdsNul(query.personId));
      return deps.store.transaction(async tx => {
        const search: UserSearch = {
          words,
          ...(query.personId === undefined ? {} : { personId: query.personId }),
          ...(query.unitId === undefined || nobody
            ? {}
            : { unitIds: branchOf(await tx.unitTree(persona.organisationId), query.unitId) }),
          ...(query.role === undefined ? {} : { role: query.role }),
          ...(query.status === undefined ? {} : { status: query.status }),
          ...(query.capability === undefined ? {} : { capability: query.capability }),
        };
        const read = (page: number): Promise<{ total: number; rows: UserRecord[] }> =>
          nobody
            ? Promise.resolve({ total: 0, rows: [] })
            : tx.searchUsers(persona.organisationId, search, {
                startIndex: (page - 1) * pageSize + 1,
                count: pageSize,
              });
        let page = query.page ?? 1,
          listed = await read(page);
        if (!listed.rows.length && listed.total) listed = await read((page = Math.ceil(listed.total / pageSize)));
        if (!listed.total) page = 1;
        const rows: UserAdminRow[] = [];
        for (const u of listed.rows) rows.push(await rowOf(tx, u));
        const all = (await tx.searchUsers(persona.organisationId, {}, { startIndex: 1, count: 0 })).total;
        return { rows, total: listed.total, all, page, pageSize };
      });
    },
    /**
     * D107: an administrator issues a provisioner its key. The id is the installation's, so one that is in use, here
     * or in another organisation, is refused with the same words; a revoked one of this organisation is issued again
     * under its id. The key is made here, answered once and kept as its digest. Audited as the script audits it, with
     * the administrator as the actor and never the key.
     */
    issueProvisioner: (persona: AuthenticatedContext, input: ProvisionerIssueInputType) =>
      keyed(persona, async (tx, at) => {
        const token = deps.token(),
          label = input.label.trim();
        if (!label) throw new InputError('Katalogen behöver ett namn.');
        // Whether the id is free is the store's answer, given with the write: a check made before it would let two
        // issues of one id at once both through, and the second would end the first one's key.
        const taken = !(await tx.issueProvisioner({
          id: input.id,
          organisationId: persona.organisationId,
          label,
          tokenDigest: deps.digest(token),
          createdBy: 'person:' + persona.id,
          createdAt: at,
        }));
        if (taken) throw new InputError('Det finns redan en katalog med det id:t.');
        await tx.audit({
          actor: 'person:' + persona.id,
          action: 'provisioner.added',
          subject: 'provisioner:' + input.id,
          details: { organisationId: persona.organisationId, label },
        });
        return { id: input.id, token };
      }),
    /**
     * D107: a new key for a provisioner of the administrator's organisation, as `rotateKey` replaces it. When the
     * rotation ended a key replaced earlier before its time, the answer says until when that key would have answered
     * (`endedEarlier`), so the page can say so.
     */
    rotateProvisioner: (persona: AuthenticatedContext, id: string, input: ProvisionerRotateInputType) =>
      keyed(persona, async (tx, at) => {
        const held = await ownProvisioner(tx, persona, id),
          { token, endedEarlier } = await rotateKey(tx, deps, 'person:' + persona.id, held, input.graceHours, at);
        return { id, token, ...(endedEarlier ? { endedEarlier } : {}) };
      }),
    /** D107: ends every key of a provisioner of the administrator's organisation, now. Its pushes answer 401 from here on. */
    async revokeProvisioner(persona: AuthenticatedContext, id: string): Promise<UsersAdminOverview> {
      require(persona);
      await persona.authorize();
      return deps.store.transaction(async tx => {
        await ownProvisioner(tx, persona, id);
        await revokeKey(tx, 'person:' + persona.id, id, deps.clock().toISOString());
        return overviewWithin(tx, persona);
      });
    },
    /**
     * The group picker's search (D85): the organisation's groups whose name or external id holds every word, without
     * regard to case, the first `GROUP_SEARCH_LIMIT` by name. Another organisation's groups are not searched (D101). A
     * word with a NUL is in no name and matches nothing. A read writes nothing, so it has no audit row.
     */
    async searchGroups(persona: AuthenticatedContext, text: string): Promise<GroupSearchResult> {
      require(persona);
      const words = searchWords(text);
      if (words.some(holdsNul)) return { groups: [] };
      return deps.store.transaction(async tx => ({
        groups: (await tx.searchGroups(persona.organisationId, words, GROUP_SEARCH_LIMIT)).map(g => ({
          id: g.externalId,
          label: g.label,
        })),
      }));
    },
    addGroupCapability: (persona: AuthenticatedContext, input: GroupCapabilityInputType) =>
      change(persona, input.groupExternalId, true, () => capabilityOf(input)),
    removeGroupCapability: (persona: AuthenticatedContext, input: GroupCapabilityInputType) =>
      change(persona, input.groupExternalId, false, () => capabilityOf(input)),
    addGroupRelation: (persona: AuthenticatedContext, input: GroupRelationInputType) =>
      change(persona, input.groupExternalId, true, () => relationOf(input)),
    removeGroupRelation: (persona: AuthenticatedContext, input: GroupRelationInputType) =>
      change(persona, input.groupExternalId, false, () => relationOf(input)),
    /**
     * D121, for the development seed: an operator maps a group of an organisation to a relation, as the page does, with
     * the same audit row and derivation and the operator as the actor. The group must be provisioned in that organisation.
     */
    async seedGroupRelation(actor: string, organisationId: string, input: GroupRelationInputType): Promise<boolean> {
      const mapping = relationOf(input);
      return deps.store.transaction(
        async tx => (await mapWithin(tx, actor, organisationId, input.groupExternalId, true, mapping)) === true,
      );
    },
  };
}
export type UsersAdminUsecases = ReturnType<typeof usersAdminUsecases>;

/**
 * Personal (D94, D147): a manager's reports, read only. The scope is the server's: who reports to the actor is read
 * from the employments that name them, and the units they lead from their own assignments, never from the request.
 * Nothing is written, so there is no audit row.
 */
const byName = (a: StaffPerson, b: StaffPerson) => bySwedish(a.name, b.name) || a.id.localeCompare(b.id);
/**
 * The names of these units of the organisation, by id. A unit's name is its `unit:` group's. An employment is kept when
 * its unit's group is removed (D114), so one the tree no longer names is called what the unit table still calls it; a
 * unit neither knows is absent, and its caller shows the id.
 */
async function unitNames(tx: ProvisionTx, organisationId: string, ids: readonly string[]) {
  const names = new Map<string, string>();
  if (!ids.length) return names;
  for (const u of await tx.unitTree(organisationId, ids)) names.set(u.id, u.label);
  const rest = ids.filter(id => !names.has(id));
  if (rest.length)
    for (const [id, label] of Object.entries(await tx.unitLabels(rest, organisationId))) names.set(id, label);
  return names;
}
/**
 * D147: whom a person reports to. The managers their current employments name, each once and never the person
 * themselves, who are active people of the organisation. A deactivated manager is nobody's manager, and an employment
 * that names none gives none: nothing is read from the tree.
 */
async function managersOf(tx: ProvisionTx, organisationId: string, personId: string): Promise<string[]> {
  const person = await tx.readUser(organisationId, personId);
  if (!person) return [];
  const named = [...new Set(person.employments.flatMap(job => (job.managerId ? [job.managerId] : [])))].filter(
    id => id !== personId && !id.includes('\u0000'),
  );
  const active: string[] = [];
  for (const id of named) if ((await tx.readUser(organisationId, id))?.enabled) active.push(id);
  return active;
}
/**
 * D147: whom a person reports to as the reporting line reads it, for the employments given: the active people of the
 * organisation they name, never the person themselves and without anyone whose own employments name the person back,
 * by id. `managersOf` keeps those who name the person back, since it says who stands above a reader; this is whom a
 * leaver's records pass to, read before the leaver's own row is changed.
 */
async function lineOf(
  tx: ProvisionTx,
  organisationId: string,
  personId: string,
  employments: UserFields['employments'],
): Promise<string[]> {
  const named = [...new Set(employments.flatMap(job => (job.managerId ? [job.managerId] : [])))].filter(
    id => id !== personId && !id.includes('\u0000'),
  );
  if (!named.length) return [];
  const back = new Set(
    (await tx.managersNamed(organisationId, named))
      .filter(pair => pair.managerId === personId)
      .map(pair => pair.personId),
  );
  const line: string[] = [];
  for (const id of named) if (!back.has(id) && (await tx.readUser(organisationId, id))?.enabled) line.push(id);
  return line.sort();
}
export function staffUsecases(deps: { store: ProvisionStore }) {
  /**
   * The reader's reports (D147): the people whose current employments name the reader as manager, under the unit of
   * each such employment, by name; the units by label. A unit the reader leads has its card whether or not anybody on
   * it reports to them, and a unit they do not lead has one when somebody employed there does. Someone who leads units
   * of their own has the manager's role on the one they are listed under, where they lead it, and carries the others
   * as `below`. The reader is never listed, and neither is anyone in `above`, the reader's own managers: where two
   * people's employments name each other the chain comes round, and neither is the other's report (D147 item 7), so
   * neither is on the other's list, in the talks round or the calendar's team that read it.
   */
  async function reportsBy(
    tx: ProvisionTx,
    persona: AuthenticatedContext,
    led: Array<{ unitId: string; unitLabel: string }>,
    above: readonly string[],
  ): Promise<StaffUnit[]> {
    // Within the reader's organisation, as the tree is: a unit id names nobody elsewhere (D101, a unit belongs to one
    // organisation).
    const rows = (await tx.reportsTo(persona.organisationId, persona.id)).filter(
        p => p.id !== persona.id && !above.includes(p.id),
      ),
      labels = new Map(led.map(u => [u.unitId, u.unitLabel]));
    const named = [...new Set(rows.flatMap(p => [...p.unitIds, ...p.leads]))].filter(id => !labels.has(id));
    for (const [id, label] of await unitNames(tx, persona.organisationId, named)) labels.set(id, label);
    const labelOf = (unitId: string) => labels.get(unitId) ?? unitId,
      byLabel = (a: { unitId: string; unitLabel: string }, b: { unitId: string; unitLabel: string }) =>
        bySwedish(a.unitLabel, b.unitLabel) || a.unitId.localeCompare(b.unitId),
      units = new Map<string, StaffUnit>(
        led.map(u => [u.unitId, { unitId: u.unitId, unitLabel: u.unitLabel, people: [] }]),
      );
    for (const { unitIds, leads, ...person } of rows)
      for (const unitId of unitIds) {
        const unit = units.get(unitId) ?? { unitId, unitLabel: labelOf(unitId), people: [] },
          others = leads
            .filter(id => id !== unitId)
            .map(id => ({ unitId: id, unitLabel: labelOf(id), role: 'manager' as const }))
            .sort(byLabel);
        units.set(unitId, unit);
        unit.people.push({
          ...person,
          role: leads.includes(unitId) ? 'manager' : 'employee',
          ...(others.length ? { below: others } : {}),
        });
      }
    return [...units.values()].map(unit => ({ ...unit, people: unit.people.sort(byName) })).sort(byLabel);
  }
  return {
    overview: (persona: AuthenticatedContext): Promise<StaffOverview> =>
      deps.store.transaction(async tx => {
        const led = (await tx.assignmentsOf(persona.id)).filter(a => a.role === 'manager'),
          units = await reportsBy(tx, persona, led, await managersOf(tx, persona.organisationId, persona.id));
        // Someone who leads no unit and whom nobody active reports to has no page: a report who has been deactivated
        // is nobody's report (D149), so the card such a row makes admits nobody. It is drawn, marked as it is, for a
        // reader the page is for.
        if (!led.length && !units.some(unit => unit.people.some(person => person.enabled)))
          throw new ForbiddenError('Sidan Personal är för den som är chef.');
        return { units };
      }),
    /**
     * Where the reader stands (D97, who may be asked about): every unit they are assigned to with their role there,
     * their reports under the units `overview` lists them on, and who manages them (`above`, `managersOf`, D147). It
     * refuses nobody: someone with no report and no unit to lead has nothing under `managed`.
     */
    reach: (
      persona: AuthenticatedContext,
    ): Promise<{
      units: Array<{ unitId: string; unitLabel: string; role: Role }>;
      managed: StaffUnit[];
      above: string[];
    }> =>
      deps.store.transaction(async tx => {
        const units = (await tx.assignmentsOf(persona.id)).map(({ unitId, unitLabel, role }) => ({
            unitId,
            unitLabel,
            role,
          })),
          above = await managersOf(tx, persona.organisationId, persona.id);
        return {
          units,
          managed: await reportsBy(
            tx,
            persona,
            units.filter(a => a.role === 'manager'),
            above,
          ),
          above,
        };
      }),
    /**
     * An active person in the reader's organisation, found by Clew's key, their id (D97: a colleague is anyone active in
     * the directory; D122: an address names a person by id), with the unit they act in; undefined for nobody, someone in
     * another organisation or a deactivated person. Read on every call, never cached.
     */
    person: (persona: AuthenticatedContext, id: string, includeProfile: boolean) =>
      deps.store.transaction(async tx => {
        const found = await tx.readUser(persona.organisationId, id);
        if (!found || !found.enabled) return undefined;
        const grant = await tx.grant(found.id);
        const nodes =
          includeProfile && found.employments.length
            ? await tx.unitTree(persona.organisationId, [...new Set(found.employments.map(row => row.unitId))])
            : [];
        const labels = new Map(nodes.map(unit => [unit.id, unit.label]));
        const profile = includeProfile
          ? {
              phoneNumbers: found.phoneNumbers,
              email: found.email,
              // The core title where no employment carries one; the employments say their own.
              title: found.employments.some(row => row.title) ? null : found.title,
              // A removed unit has no name to show. Keep any employment details that still describe the job.
              // D147: who an employment reports to is not part of a profile.
              employments: found.employments.flatMap(
                ({ managerId: _manager, ...row }): PersonProfile['employments'] => {
                  const unitLabel = labels.get(row.unitId);
                  if (unitLabel !== undefined) return [{ ...row, unitLabel }];
                  return row.title || row.employmentType || row.startDate || row.employmentPercentage !== undefined
                    ? [row]
                    : [];
                },
              ),
            }
          : undefined;
        return {
          ...(profile ? { profile } : {}),
          id: found.id,
          name: found.name,
          userName: found.userName,
          enabled: true as const,
          unit: grant ? { unitId: grant.unitId, unitLabel: grant.unitLabel } : null,
        };
      }),
    /**
     * The titles of these people of the reader's organisation (`people.reports`, D141 rule 4), by id: the titles their
     * employments carry, each once, or the core title where none does (as the person's page shows them). Someone
     * without a title, deactivated or of another organisation is absent. Nothing else of an employment is read out: no
     * type, date or percentage. Read on every call, never cached.
     */
    titles: (persona: AuthenticatedContext, ids: readonly string[]): Promise<Map<string, string>> =>
      deps.store.transaction(async tx => {
        const titles = new Map<string, string>();
        for (const id of new Set(ids)) {
          const found = await tx.readUser(persona.organisationId, id);
          if (!found || !found.enabled) continue;
          const own = [...new Set(found.employments.flatMap(row => (row.title ? [row.title] : [])))];
          const title = own.length ? own.join(', ') : found.title;
          if (title) titles.set(id, title);
        }
        return titles;
      }),
    /**
     * What other systems know these units by (D148), for the units of the reader's organisation among those named. It
     * says nothing of whether the reader may ask about a unit: the caller has settled that (D117) before it asks.
     */
    unitIdentifiers: (persona: AuthenticatedContext, unitIds: readonly string[]) =>
      deps.store.transaction(tx => tx.unitIdentifiers(persona.organisationId, unitIds)),
  };
}
export type StaffUsecases = ReturnType<typeof staffUsecases>;

/**
 * D62's `people.directory`, "Vilka användare finns i min enhet?": the people who belong to the unit and whoever leads
 * it, each with the role they hold there, as Administration › Organisation reads a unit (`unitPeople`, one read on
 * either adapter). A person on two units, a manager of two units and an employee who leads another unit are on each of
 * their units, though the grant names one (A4). A deactivated person is nobody's colleague to ask about, and neither
 * is a person of another organisation than the reader's. By name in Swedish order.
 * The unit is the reader's own: the capability passes the actor's, and its input names none. Nothing is written.
 */
export function directoryUsecases(deps: { store: ProvisionStore }) {
  return {
    directory: (unitId: string, readerId: string): Promise<Array<{ id: string; name: string; role: Role }>> =>
      deps.store.transaction(async tx => {
        // Within the reader's organisation, as every other read of a unit is: a unit id names a unit of one
        // organisation (D101), and a row another organisation has on the same id is none of the reader's colleagues.
        const organisationId = await tx.organisationOf(readerId);
        if (organisationId === undefined) return [];
        return ((await tx.unitPeople([unitId], organisationId))[unitId] ?? [])
          .filter(person => person.enabled)
          .sort(byName)
          .map(({ id, name, role }) => ({ id, name, role }));
      }),
  };
}

/**
 * Administration › Organisation (D99): the organisation tree as the provisioner pushed it, for an administrator with
 * `admin.users`, read only as Användare is. The tree, who leads each unit and how many are placed on it and below it
 * are one read; the people of one unit are another, asked for when the unit is selected. Nothing is written, so there
 * is no audit row.
 */
export function organisationUsecases(deps: { store: ProvisionStore }) {
  const require = (persona: AuthenticatedContext) => {
    if (!persona.capabilities.includes(USERS_ADMIN_CAPABILITY)) throw new ForbiddenError();
  };
  return {
    async overview(persona: AuthenticatedContext): Promise<OrganisationOverview> {
      require(persona);
      return deps.store.transaction(async tx => {
        const tree = await tx.unitTree(persona.organisationId),
          placements = await tx.placements(persona.organisationId),
          pushed = new Set(tree.map(u => u.id)),
          unnamed = [
            ...new Set(placements.flatMap(p => (p.unitId !== null && !pushed.has(p.unitId) ? [p.unitId] : []))),
          ];
        return organisationOf(
          tree,
          placements,
          unnamed.length ? await tx.unitLabels(unnamed, persona.organisationId) : {},
          await tx.managersNamed(persona.organisationId),
        );
      });
    },
    /**
     * The people of one unit of the administrator's own organisation, each with whom they report to or why to nobody
     * (D147), and the people elsewhere who report to those who lead the unit. The unit is one the organisation pushed
     * or has people on, and the people are the organisation's own: a unit of another organisation does not exist here.
     * A unit nobody leads has no reports. Nothing here is read from the tree.
     */
    async unit(persona: AuthenticatedContext, unitId: string): Promise<OrganisationUnitPeople> {
      require(persona);
      // A unit id is the source's and never holds a NUL, which PostgreSQL would refuse to compare: it names no unit.
      if (holdsNul(unitId)) throw new InputError('Enheten finns inte.');
      return deps.store.transaction(async tx => {
        const organisationId = persona.organisationId;
        // The unit's node as the overview reads it (`unitTree`): the organisation's own, by a key read as the SCIM
        // boundary accepts one, so a unit key written wrong that a group stored before D96 still carries names no unit.
        const [node] = await tx.unitTree(organisationId, [unitId]),
          people = (await tx.unitPeople([unitId], organisationId))[unitId] ?? [];
        if (!node && !people.length) throw new InputError('Enheten finns inte.');
        // Whom each person here names, and whom those people name in turn: someone who names a person back is not
        // their manager (`reportingOf`). A manager is read once, for their name and whether they are active.
        const named = await tx.managersNamed(
            organisationId,
            people.map(p => p.id),
          ),
          managerIds = [...new Set(named.map(n => n.managerId))].filter(id => !holdsNul(id)),
          back = await tx.managersNamed(organisationId, managerIds),
          managers = new Map<string, { id: string; name: string }>();
        for (const id of managerIds) {
          const found = await tx.readUser(organisationId, id);
          if (found?.enabled) managers.set(id, { id, name: found.name });
        }
        const reporting = reportingOf(new Set(managers.keys()), [...named, ...back]);
        // Who reports to those who lead the unit from elsewhere: each once, under the units they lead, else under the
        // units of the employments that name the leader.
        const here = new Set(people.map(p => p.id)),
          elsewhere = new Map<string, Awaited<ReturnType<ProvisionTx['reportsTo']>>[number]>();
        for (const leader of people.filter(leadsUnit)) {
          // Someone the leader reports to is not the leader's report, whatever names them back. Active managers only,
          // as Personal reads it: a deactivated manager is nobody's, so no chain comes round through one.
          const above = new Set(
            named.filter(n => n.personId === leader.id && managers.has(n.managerId)).map(n => n.managerId),
          );
          for (const report of await tx.reportsTo(organisationId, leader.id)) {
            if (here.has(report.id) || above.has(report.id)) continue;
            // One who names two of the unit's leaders is listed once, under the units of every such employment.
            const held = elsewhere.get(report.id);
            if (held) held.unitIds = [...new Set([...held.unitIds, ...report.unitIds])];
            else elsewhere.set(report.id, { ...report, unitIds: [...report.unitIds] });
          }
        }
        const labels = await unitNames(tx, organisationId, [
          ...new Set([...elsewhere.values()].flatMap(r => [...r.unitIds, ...r.leads])),
        ]);
        const rowsOf = (ids: readonly string[], role: Role) =>
          ids
            .map(id => ({ unitId: id, unitLabel: labels.get(id) ?? id, role }))
            .sort((a, b) => bySwedish(a.unitLabel, b.unitLabel) || a.unitId.localeCompare(b.unitId));
        return {
          unitId,
          unitLabel: node?.label ?? (await tx.unitLabels([unitId], organisationId))[unitId] ?? unitId,
          people: people.sort(byName).map(({ belongs, ...p }) => {
            const line = reporting(p.id),
              named = (ids: readonly string[]) =>
                ids.map(id => managers.get(id)!).sort((a, b) => bySwedish(a.name, b.name) || a.id.localeCompare(b.id));
            return {
              ...p,
              // D149: someone who leads the unit and is employed on another is its manager, not one of its people.
              ...(belongs ? {} : { elsewhere: true as const }),
              managers: named(line.managers),
              ...(line.round.length ? { circle: named(line.round) } : {}),
              // A deactivated person reports to nobody anyway: the gap is said of those who work here.
              ...(p.enabled && line.gap ? { gap: line.gap } : {}),
            };
          }),
          reports: [...elsewhere.values()]
            .map(({ unitIds, leads, ...report }): StaffPerson => ({
              ...report,
              role: leads.length ? 'manager' : 'employee',
              below: leads.length ? rowsOf(leads, 'manager') : rowsOf(unitIds, 'employee'),
            }))
            .sort(byName),
        };
      });
    },
  };
}
export type OrganisationUsecases = ReturnType<typeof organisationUsecases>;

/**
 * An operator's erasure of a person (Q7 of the 2026-11-12 users review, D123): `scripts/person-erase.ts` is its one
 * caller, run when the organisation's own retention decision says a leaver's record goes, after the source has stopped
 * sending the person and after the erasures of the person's cards, talks, competence, follow-up dialogue and
 * introduction and leaving, which find the person by this same id. Refused, writing nothing and no audit row, for an id
 * the people table does not hold and for a person who is still active: only a person the source has deactivated is
 * erased (D68 item 1). In one transaction it takes the person out of their groups, removes their placements, grant,
 * sign-in bindings under every issuer and sessions, clears the personal fields and takes the user name and the source
 * key away (`erasedProfile`: the record then reads as its id), so that a later push of the same name or key creates a
 * new person and no key resolves to this one, which refuses a started action about them (D122). It replaces the
 * person's identifiers in the audit trail with `ERASED` and keeps every event: the user names, source keys, claims and
 * sign-in subjects the rows about them hold (`IDENTIFIERS_ABOUT`), the subject a refused sign-in brought when the
 * person held it (`IDENTIFIERS_AS_HOLDER`), and the claims of the authentication log that named one of their user
 * names or their e-mail address. Through the erasure port, which composition binds to the calendar (`ErasureTx`), it
 * clears the name and the address every invitation to them was drawn with, takes the rows that named them off their
 * managers' planning cards and withdraws the times drawn for them and never sent; the invitations stay. The row, its
 * id and every reference to it stay, so the person's id keeps naming them in the records that point at it. One
 * `person.erased` row, counts only, says what went.
 */
export const PERSON_ERASED = 'person.erased';
export interface PersonErased {
  /** The personal fields that held something: name, e-mail, phone numbers, employments, title, source key, user name. */
  fields: number;
  memberships: number;
  assignments: number;
  /** The derived grant, one at most. */
  grants: number;
  bindings: number;
  sessions: number;
  /** Rows of the audit table whose identifiers were replaced. */
  auditRows: number;
  /** Rows of the authentication log whose claim was replaced. */
  signInRows: number;
  /** Invitations to the person (the calendar's proposals) cleared of the name and the address they were drawn with. */
  invitations: number;
  /** Rows that named the person on their managers' planning cards, taken off the cards. */
  planningRows: number;
  /** Times drawn for the person and never sent, withdrawn. */
  drafts: number;
}
export type PersonErasure = { refused: 'unknown' | 'active' } | { erased: PersonErased };
export function personErasureUsecases(deps: { store: ProvisionStore; clock: () => Date }) {
  return {
    async erasePerson(actor: string, personId: string): Promise<PersonErasure> {
      if (holdsNul(personId)) return { refused: 'unknown' };
      return deps.store.transaction(async (tx): Promise<PersonErasure> => {
        // The person's groups before the person, as a group write takes its group before it locks a member.
        await tx.lockGroupsOf(personId);
        const locked = await tx.lockPerson(personId),
          person = locked && (await tx.readUser(locked.organisationId, personId));
        if (!person) return { refused: 'unknown' };
        if (person.enabled) return { refused: 'active' };
        const subject = 'person:' + personId,
          about = await tx.auditRows(Object.keys(IDENTIFIERS_ABOUT), { subject }),
          asHolder = await tx.auditRows(Object.keys(IDENTIFIERS_AS_HOLDER), { key: 'holder', value: subject });
        // A refused sign-in may match both roles. Only pass the keys to erase: another person's erasure can redact
        // the same row before we write it.
        const redactions = new Map<number, string[]>();
        for (const [rows, keys] of [
          [about, IDENTIFIERS_ABOUT],
          [asHolder, IDENTIFIERS_AS_HOLDER],
        ] as const)
          for (const row of rows) {
            const held = auditKeysToErase(row.details, keys[row.action] ?? []);
            if (held.length) redactions.set(row.id, [...(redactions.get(row.id) ?? []), ...held]);
          }
        const at = deps.clock().toISOString(),
          fields = heldFields(person),
          memberships = await tx.removeMemberships(personId, at),
          assignments = (await tx.assignmentsOf(personId)).length,
          grants = (await tx.grant(personId)) ? 1 : 0;
        if (assignments) await tx.replaceUnits(personId, { belongs: [], leads: [] });
        if (grants) await tx.writeGrant(personId, undefined);
        const bindings = await tx.removeBindings(personId),
          sessions = await tx.removeSessions(personId);
        const auditRows = await tx.redactAudit(redactions);
        const signInRows = await tx.eraseClaims(namesHeld(person, about), ERASED);
        // Other people's records that name the person: the invitations a manager sent them, which stay, by the person's
        // id, as the manager's history and the round's count, and the rows of the managers' planning cards (D123).
        const { invitations, planningRows, drafts } = await tx.erasure.invitee({ actor, personId, at });
        // The resource a provisioner reads changes when a field is cleared or a group is no longer listed (S13): a
        // stale push that put the erased person back in a group is undone by a second erasure, which moves it too.
        if (fields || memberships) await tx.updateUser(personId, { ...erasedProfile(), updatedAt: at });
        const erased: PersonErased = {
          fields,
          memberships,
          assignments,
          grants,
          bindings,
          sessions,
          auditRows,
          signInRows,
          invitations,
          planningRows,
          drafts,
        };
        await tx.audit({ actor, action: PERSON_ERASED, subject, details: { ...erased } });
        return { erased };
      });
    },
  };
}
export type PersonErasureUsecases = ReturnType<typeof personErasureUsecases>;
