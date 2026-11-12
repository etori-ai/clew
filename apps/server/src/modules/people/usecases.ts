import { isDeepStrictEqual } from 'node:util';
import {
  CAPABILITIES,
  contractProblems,
  isCapability,
  type AuthenticatedContext,
  type Capability,
  type GroupCapabilityInputType,
  type GroupCapability,
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
import { ForbiddenError, InputError } from '../../context';
import { SCIM, ScimError, type ScimGroup, type ScimList, type ScimUser } from './contracts';
import {
  applyGroupPatch,
  applyUserPatch,
  assertAcceptedKey,
  assertAcceptedParent,
  branchOf,
  bySwedish,
  closesCycle,
  deriveAuthority,
  groupFields,
  patchOperations,
  groupResource,
  leadsUnit,
  leavesOut,
  organisationOf,
  pageOf,
  parseFilter,
  project,
  sameGrant,
  searchWords,
  unitGroupOf,
  unitOfKey,
  saysInactive,
  titlesOf,
  userFields,
  userResource,
  MANAGER_KEY,
  UNIT_KEY,
  type Derived,
  type GroupFields,
  type GroupRecord,
  type GroupCapabilityRule,
  type Projection,
  type TreeUnit,
  type UserFields,
  type UserRecord,
  type UserSearch,
} from './domain';
import type { Provisioner, ProvisionStore, ProvisionTx } from './ports';

/**
 * Deriving authority (D68, D85): the only path from memberships and the group-capability rows to the grant a person acts
 * with. Called by whatever changed a membership or such a row, inside that change's transaction, so the grant never lags the
 * fact that produced it. An unchanged grant writes no audit row; a changed one writes `grant.derived` on the person
 * with the new unit, role and capabilities, or `removed: true` when the person has no unit left (fail closed). A
 * `protected` key never reaches these tables (D93), so the derived flag stays false and is never written to the audit row.
 */
export function provisioningUsecases(deps: { store: ProvisionStore }) {
  async function deriveWithin(tx: ProvisionTx, actor: string, personId: string): Promise<Derived | undefined> {
    // Locked first: a second derivation of the same person waits here and then reads what this one committed.
    const person = await tx.lockPerson(personId);
    if (!person) return undefined;
    const memberships = await tx.memberships(personId),
      rules = await tx.groupCapabilities(person.organisationId);
    // Every unit the memberships name, as the unit table knows it: the label of a managed unit without a `unit:` group,
    // and the comparison that lets an unchanged derivation write nothing (a reconciliation replays every person).
    const named = [...new Set(memberships.flatMap(m => unitOfKey(m.externalId) ?? []))];
    const knownLabels = named.length ? await tx.unitLabels(named, person.organisationId) : {};
    // A unit the person leads without being placed on it is named by its `unit:` group, which they are no member of.
    // The unit table has no row for a unit nobody was assigned to before them, so without this read the head of a
    // unit nobody else is placed on would carry the unit's id as its name (D101).
    const placedOn = new Set(memberships.flatMap(m => unitGroupOf(m.externalId) ?? [])),
      pushedLabels: Record<string, string> = {};
    for (const id of named) {
      const node = placedOn.has(id) ? undefined : await tx.findGroup('externalId', UNIT_KEY + id);
      if (node) pushedLabels[id] = node.label;
    }
    const derived = deriveAuthority(memberships, rules, { ...knownLabels, ...pushedLabels });
    const movedUnits = derived.units.filter(u => knownLabels[u.id] !== u.label);
    if (movedUnits.length) await tx.writeUnits(person.organisationId, movedUnits);
    // Compared as a set: the store and the derivation need not order unit ids alike, and an order alone is no change.
    const held = await tx.assignmentsOf(personId),
      roleOn = new Map(held.map(a => [a.unitId, a.role])),
      sameAssignments =
        held.length === derived.assignments.length && derived.assignments.every(a => roleOn.get(a.unitId) === a.role);
    if (!sameAssignments) await tx.replaceAssignments(personId, derived.assignments);
    // Compared as stored, so a projection that still carries a name outside the closed list is rewritten.
    const before = await tx.grant(personId),
      previous = before && { ...before, capabilities: [...before.capabilities].sort() as Capability[] };
    const regranted = !sameGrant(previous, derived.grant);
    // D99: the history of who was assigned where is the audit rows. A second unit, or a manager's role on one, changes
    // what a person sees without changing the unit they act as, so it is said by itself when the grant does not say it.
    if (!sameAssignments && !regranted && derived.grant)
      await tx.audit({
        actor,
        action: 'assignments.derived',
        subject: 'person:' + personId,
        details: { assignments: derived.assignments.map(a => ({ unitId: a.unitId, role: a.role })) },
      });
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
            }
          : { removed: true },
      });
    }
    return derived;
  }
  /**
   * Several people in one transaction, each once and in id order: every caller locks in the same order, so two
   * requests that touch the same people queue behind each other instead of waiting on each other.
   */
  async function deriveAll(tx: ProvisionTx, actor: string, personIds: Iterable<string>) {
    for (const id of [...new Set(personIds)].sort()) await deriveWithin(tx, actor, id);
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
export type ProvisioningUsecases = ReturnType<typeof provisioningUsecases>;

/**
 * The SCIM 2.0 server (RFC 7644; D68): one use case per operation, the provisioner first. Each mutation runs in one
 * transaction with its audit row (`scim.user.*`, `scim.group.*`, actor `provisioner:<id>`) and re-derives the grants
 * of everyone it touched. `DELETE` on a user deactivates, because audit rows and threads reference the person; `DELETE`
 * on a group removes it and its memberships, and the members lose what the group gave them. Users are read and written
 * within the provisioner's organisation, and so are groups (another organisation's group does not exist for a client),
 * while `userName` and a group's or a person's `externalId` are unique across the installation: a login carries no
 * organisation, and D68's keys are shared vocabulary.
 */
export interface ScimQuery extends Projection {
  filter?: string;
  startIndex?: string;
  count?: string;
}
/** A group change names the people it added or removed in its audit row up to this many; past it the count stands alone. */
const NAMED_IN_AUDIT = 50;
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
   * The managers of the unit a `unit:` group names. Their grant carries the unit's label without their being members of
   * that group, so a new or renamed unit group re-derives them too; any other group names nobody beyond its members.
   */
  const managersOfUnit = (tx: ProvisionTx, externalId: string | null): Promise<string[]> =>
    externalId?.startsWith(UNIT_KEY) ? tx.members(MANAGER_KEY + unitOfKey(externalId)) : Promise.resolve([]);
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
    const above = async (id: string) =>
      id === fields.parent ? parent.parentUnitId : (await tx.findGroup('externalId', UNIT_KEY + id))?.parentUnitId;
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
  const userView = async (tx: ProvisionTx, record: UserRecord, base: string) =>
    userResource(record, await tx.userGroups(record.id), base);
  /** The members are not read when the client asked to have them left out (Entra does, for large groups). */
  const groupView = async (tx: ProvisionTx, record: GroupRecord, base: string, projection?: Projection) =>
    project(
      groupResource(record, leavesOut(projection, 'members') ? [] : await tx.groupMembers(record.id), base),
      projection,
    );
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
  async function writeUser(
    tx: ProvisionTx,
    p: Provisioner,
    current: UserRecord,
    read: (held: UserFields) => UserFields,
    action: string,
    base: string,
  ) {
    const held = fieldsOf(current),
      sent = read(held),
      wrongUnit = isDeepStrictEqual(held.employments, sent.employments)
        ? undefined
        : await unknownUnits(tx, p, sent.employments);
    // D113: beside a deactivation the list is left as it was, and the person is deactivated.
    if (wrongUnit && !saysInactive(sent)) throw wrongUnit;
    const fields = wrongUnit ? { ...sent, employments: held.employments } : sent,
      changed = changedKeys(held, fields),
      at = now(),
      // Only what changed is checked and written. A row from before provisioning holds no `externalId`: a patch of
      // its name must not store the empty string as its id, nor be refused because another such row has none.
      written = Object.fromEntries(changed.map(key => [key, fields[key as keyof UserFields]])) as Partial<UserFields>;
    await uniqueUser(tx, written, current.id);
    if (changed.length) {
      // A flip of `active` is what an operator reads the audit for, whatever verb carried it (DELETE writes the same);
      // the verb travels in the details.
      const flipped = current.enabled !== fields.enabled,
        recorded = flipped ? (fields.enabled ? 'scim.user.reactivated' : 'scim.user.deactivated') : action;
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
    }
    // Always: silent when nothing moved, and it heals a projection written before provisioning existed.
    await derivation.deriveWithin(tx, actorOf(p), current.id);
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
    // The tree is held only by a write that changes it: a reconciliation replays every unit and moves none.
    const was = unitGroupOf(current.externalId),
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
      renamed = current.label !== fields.label || current.externalId !== fields.externalId,
      at = now();
    // Only who comes is asked about: who is already in the group was asked about when they came.
    await membersExist(tx, p, added);
    if (!renamed && !moved && !added.length && !removed.length) return groupView(tx, current, base);
    if (renamed || moved)
      await tx.updateGroup(current.id, {
        externalId: fields.externalId,
        label: fields.label,
        parentUnitId: fields.parent,
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
        added: added.length,
        removed: removed.length,
        members: fields.members.length,
        // Who, while the list is short enough to read: a plain group carries no grant to say it on the person.
        ...(added.length && added.length <= NAMED_IN_AUDIT ? { addedPeople: added } : {}),
        ...(removed.length && removed.length <= NAMED_IN_AUDIT ? { removedPeople: removed } : {}),
      },
    });
    // A renamed or re-keyed group changes what every member gets, and a unit's label what its managers carry;
    // otherwise only those who came or went.
    if (renamed) {
      const assigned = [...fields.members, ...(await managersOfUnit(tx, fields.externalId))];
      await nameUnit(tx, p, fields, assigned);
      await derivation.deriveAll(tx, actorOf(p), [...before, ...assigned]);
    } else await derivation.deriveAll(tx, actorOf(p), [...added, ...removed]);
    return groupView(
      tx,
      { ...current, externalId: fields.externalId, label: fields.label, parentUnitId: fields.parent, updatedAt: at },
      base,
    );
  }
  return {
    ...derivation,
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
        await uniqueUser(tx, fields);
        const wrongUnit = await unknownUnits(tx, p, fields.employments);
        if (wrongUnit) throw wrongUnit;
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
        await derivation.deriveWithin(tx, actorOf(p), record.id);
        return userResource(record, [], base);
      }),
    getUser: (p: Provisioner, id: string, base: string, projection?: Projection) =>
      deps.store.transaction(async tx => project(await userView(tx, await userOr404(tx, p, id), base), projection)),
    listUsers: (p: Provisioner, query: ScimQuery, base: string): Promise<ScimList<ScimUser>> =>
      deps.store.transaction(async tx => {
        const filter = parseFilter(query.filter, ['userName', 'externalId']) as
            { attribute: 'userName' | 'externalId'; value: string } | undefined,
          page = pageOf(query);
        const listed = await tx.listUsers(p.organisationId, page, filter);
        const Resources: ScimUser[] = [];
        for (const row of listed.rows) Resources.push(project(await userView(tx, row, base), query));
        return {
          schemas: [SCIM.list],
          totalResults: listed.total,
          startIndex: page.startIndex,
          itemsPerPage: Resources.length,
          Resources,
        };
      }),
    replaceUser: (p: Provisioner, id: string, body: unknown, base: string) =>
      deps.store.transaction(async tx =>
        writeUser(
          tx,
          p,
          await userOr404(tx, p, id, true),
          current => userFields(body, current),
          'scim.user.replaced',
          base,
        ),
      ),
    patchUser: (p: Provisioner, id: string, body: unknown, base: string) =>
      deps.store.transaction(async tx => {
        const operations = patchOperations(body),
          current = await userOr404(tx, p, id, true);
        return writeUser(
          tx,
          p,
          current,
          fields => applyUserPatch(fields, operations, current.id),
          'scim.user.patched',
          base,
        );
      }),
    /** D68: a deleted user is deactivated, never erased. Idempotent. */
    deleteUser: (p: Provisioner, id: string) =>
      deps.store.transaction(async tx => {
        const current = await userOr404(tx, p, id, true);
        if (!current.enabled) return;
        await tx.updateUser(id, { enabled: false, updatedAt: now() });
        await tx.audit({
          actor: actorOf(p),
          action: 'scim.user.deactivated',
          subject: 'person:' + id,
          details: { userName: current.userName, externalId: current.externalId },
        });
        await derivation.deriveWithin(tx, actorOf(p), id);
      }),
    createGroup: (p: Provisioner, body: unknown, base: string): Promise<ScimGroup> =>
      deps.store.transaction(async tx => {
        const fields = groupFields(body);
        assertAcceptedKey(fields);
        assertAcceptedParent(fields);
        if (fields.parent !== null) await tx.lockTree(p.organisationId);
        await lockUnitsOf(tx, fields.externalId);
        await uniqueGroup(tx, fields);
        await unitOfOwnOrganisation(tx, p, fields);
        await placeInTree(tx, p, fields);
        await membersExist(tx, p, fields.members);
        const at = now(),
          record: GroupRecord = {
            id: deps.ids(),
            organisationId: p.organisationId,
            externalId: fields.externalId,
            label: fields.label,
            parentUnitId: fields.parent,
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
            members: fields.members.length,
          },
        });
        const assigned = [...fields.members, ...(await managersOfUnit(tx, fields.externalId))];
        await nameUnit(tx, p, fields, assigned);
        await derivation.deriveAll(tx, actorOf(p), assigned);
        return groupView(tx, record, base);
      }),
    getGroup: (p: Provisioner, id: string, base: string, projection?: Projection) =>
      deps.store.transaction(async tx => groupView(tx, await groupOr404(tx, p, id), base, projection)),
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
        const Resources: ScimGroup[] = [];
        for (const row of listed.rows) Resources.push(await groupView(tx, row, base, query));
        return {
          schemas: [SCIM.list],
          totalResults: listed.total,
          startIndex: page.startIndex,
          itemsPerPage: Resources.length,
          Resources,
        };
      }),
    replaceGroup: (p: Provisioner, id: string, body: unknown, base: string) =>
      deps.store.transaction(async tx =>
        writeGroup(tx, p, await groupOr404(tx, p, id, true), groupFields(body), 'scim.group.replaced', base),
      ),
    patchGroup: (p: Provisioner, id: string, body: unknown, base: string) =>
      deps.store.transaction(async tx => {
        // Locked before its members are read: a patch is a read and a write, and two of them must not interleave.
        const operations = patchOperations(body),
          current = await groupOr404(tx, p, id, true),
          members = (await tx.groupMembers(id)).map(m => m.id);
        const next = applyGroupPatch(
          { externalId: current.externalId, label: current.label, parent: current.parentUnitId, members },
          operations,
          current.id,
        );
        return writeGroup(tx, p, current, next, 'scim.group.patched', base);
      }),
    /**
     * Removes the group; its members are re-derived and lose what it gave them. The group-capability rows stay (D85).
     * A `unit:` group with units below it is not removed (D99): the answer is 409 and names them.
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
        const members = (await tx.groupMembers(id)).map(m => m.id);
        await tx.deleteGroup(id);
        await tx.audit({
          actor: actorOf(p),
          action: 'scim.group.removed',
          subject: 'group:' + id,
          details: { externalId: current.externalId, displayName: current.label, members: members.length },
        });
        await derivation.deriveAll(tx, actorOf(p), members);
      }),
  };
}
export type ScimUsecases = ReturnType<typeof scimUsecases>;

/**
 * Administration › Användare (D62, D68, D85): what an administrator with `admin.users` sees and may change. Identity,
 * units and roles are read only here; they come from the provisioner. The one thing written is D85's rows, a group gives
 * a capability: audited per row (`group-capability.added`, `group-capability.removed`), and every current member of the
 * group is re-derived in the same transaction, so a grant never lags the row that produced it.
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
      enabled: u.enabled,
      bound: await tx.bound(u.id),
      assignments: await tx.assignmentsOf(u.id),
      active: grant ? { unitId: grant.unitId, unitLabel: grant.unitLabel, role: grant.role } : null,
      capabilities: grant ? sorted(grant.capabilities) : [],
    };
  }
  async function overviewWithin(tx: ProvisionTx, persona: AuthenticatedContext): Promise<UsersAdminOverview> {
    const tree = await tx.unitTree(persona.organisationId),
      unitLabel = new Map(tree.map(n => [n.id, n.label])),
      units = tree
        .map(n => ({ id: n.id, label: n.label, parentLabel: (n.parentId && unitLabel.get(n.parentId)) || null }))
        .sort((a, b) => bySwedish(a.label, b.label) || a.id.localeCompare(b.id));
    const groups = (await tx.listGroups(persona.organisationId, { startIndex: 1, count: 10_000 })).rows
      .filter(g => g.externalId)
      .map(g => ({ id: g.externalId!, label: g.label }))
      .sort((a, b) => a.label.localeCompare(b.label, 'sv') || a.id.localeCompare(b.id));
    const names = new Map(groups.map(g => [g.id, g.label]));
    // This organisation's rows, those whose group is gone included (D85: a row outlives its group and applies again
    // when the group returns). A row belongs to the organisation that wrote it, so another's is not here (D101).
    const rules = await tx.groupCapabilities(persona.organisationId);
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
    const at = deps.clock().toISOString(),
      provisioners = (await tx.provisioners(persona.organisationId)).map(p => ({
        id: p.id,
        label: p.label,
        lastSeenAt: p.lastSeenAt,
        silent: p.lastSeenAt === null || since(at, p.lastSeenAt) > PROVISIONER_SILENT_MS,
        previousValidUntil: p.previousValidUntil !== null && p.previousValidUntil > at ? p.previousValidUntil : null,
      }));
    return { groupCapabilities, groups, capabilities: [...CAPABILITIES], units, provisioners };
  }
  async function change(persona: AuthenticatedContext, input: GroupCapabilityInputType, present: boolean) {
    require(persona);
    await persona.authorize();
    if (!isCapability(input.capability)) throw new InputError('Okänd behörighet.');
    return deps.store.transaction(async tx => {
      const group = await tx.findGroup('externalId', input.groupExternalId);
      // D101: another organisation's group does not exist for this administrator, to add a row or to remove one. A
      // row whose group is gone may still be removed.
      if (group ? group.organisationId !== persona.organisationId : present)
        throw new InputError('Gruppen finns inte bland de provisionerade grupperna.');
      // Locked as a SCIM write of the group locks it, and before its members are read: a member added while the row
      // is being taken away is derived after this change, and does not keep a capability no row gives.
      if (group) await tx.readGroup(persona.organisationId, group.id, true);
      const changed = await tx.setGroupCapability(
        persona.organisationId,
        input.groupExternalId,
        input.capability,
        present,
      );
      if (changed) {
        await tx.audit({
          actor: 'person:' + persona.id,
          action: present ? 'group-capability.added' : 'group-capability.removed',
          subject: 'group:' + input.groupExternalId,
          details: { capability: input.capability, groupLabel: group?.label ?? null },
        });
        await derivation.deriveAll(tx, 'person:' + persona.id, await tx.members(input.groupExternalId));
      }
      return overviewWithin(tx, persona);
    });
  }
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
    write: (tx: ProvisionTx, at: string) => Promise<{ id: string; token: string }>,
  ): Promise<Omit<ProvisionerKeyIssued, 'address'>> {
    require(persona);
    await persona.authorize();
    return deps.store.transaction(async tx => {
      const { id, token } = await write(tx, deps.clock().toISOString());
      return { id, token, overview: await overviewWithin(tx, persona) };
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
      const pageSize = query.pageSize ?? USERS_PAGE_SIZES[0];
      return deps.store.transaction(async tx => {
        const search: UserSearch = {
          words: searchWords(query.text),
          ...(query.unitId === undefined
            ? {}
            : { unitIds: branchOf(await tx.unitTree(persona.organisationId), query.unitId) }),
          ...(query.role === undefined ? {} : { role: query.role }),
          ...(query.status === undefined ? {} : { status: query.status }),
          ...(query.capability === undefined ? {} : { capability: query.capability }),
        };
        const read = (page: number) =>
          tx.searchUsers(persona.organisationId, search, { startIndex: (page - 1) * pageSize + 1, count: pageSize });
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
     * D107: a new key for a provisioner of the administrator's organisation. The key it replaces answers for the
     * grace period, so the client is switched without a push failing; 0 ends it at once. One old key is kept: a key
     * rotated out before that one no longer answers, and the audit row says until when it would have.
     */
    rotateProvisioner: (persona: AuthenticatedContext, id: string, input: ProvisionerRotateInputType) =>
      keyed(persona, async (tx, at) => {
        const held = await ownProvisioner(tx, persona, id),
          token = deps.token(),
          until =
            input.graceHours > 0 ? new Date(Date.parse(at) + input.graceHours * 60 * 60 * 1000).toISOString() : null,
          cutOff = held.previousValidUntil !== null && held.previousValidUntil > at ? held.previousValidUntil : null;
        await tx.rotateProvisioner(id, deps.digest(token), until);
        await tx.audit({
          actor: 'person:' + persona.id,
          action: 'provisioner.rotated',
          subject: 'provisioner:' + id,
          details: {
            graceHours: input.graceHours,
            previousValidUntil: until,
            ...(cutOff ? { endedEarlier: cutOff } : {}),
          },
        });
        return { id, token };
      }),
    /** D107: ends every key of a provisioner of the administrator's organisation, now. Its pushes answer 401 from here on. */
    async revokeProvisioner(persona: AuthenticatedContext, id: string): Promise<UsersAdminOverview> {
      require(persona);
      await persona.authorize();
      return deps.store.transaction(async tx => {
        await ownProvisioner(tx, persona, id);
        await tx.revokeProvisioner(id, deps.clock().toISOString());
        await tx.audit({
          actor: 'person:' + persona.id,
          action: 'provisioner.revoked',
          subject: 'provisioner:' + id,
          details: {},
        });
        return overviewWithin(tx, persona);
      });
    },
    addGroupCapability: (persona: AuthenticatedContext, input: GroupCapabilityInputType) =>
      change(persona, input, true),
    removeGroupCapability: (persona: AuthenticatedContext, input: GroupCapabilityInputType) =>
      change(persona, input, false),
  };
}
export type UsersAdminUsecases = ReturnType<typeof usersAdminUsecases>;

/**
 * Personal (D94, D99): a manager's reports, read only. The scope is the server's: the actor must manage at least one
 * unit, and the units come from the actor's own assignments, never from the request. Under each unit they manage: the
 * people assigned to it, with their role on it and never the reader; then, down the tree, the managers of the nearest
 * units that have one, and the people placed on a unit nobody leads, since the line passes through such a unit. Who
 * leads is `leadsUnit`: a deactivated manager does not, so the line passes through their unit too. The walk stops at a
 * unit with a manager, so the people that manager leads are not listed, and at a unit the reader manages too, which
 * has its own card. The tree is read once and the people a level at a time, so a wide layer is one read. Nothing is
 * written, so there is no audit row.
 */
const byName = (a: StaffPerson, b: StaffPerson) => bySwedish(a.name, b.name) || a.id.localeCompare(b.id);
/** The tree as the units directly below each unit. */
const unitsUnder = (tree: readonly TreeUnit[]) => {
  const below = new Map<string, TreeUnit[]>();
  for (const u of tree) if (u.parentId !== null) below.set(u.parentId, [...(below.get(u.parentId) ?? []), u]);
  return below;
};
/**
 * D99 item 4, the walk down from one unit: adds to `people` those who report to the unit's managers from the units
 * below it, each with `below`. `people` holds the unit's own people when it is called, and a person already there
 * keeps their row. Level by level, each unit once: `seen` also ends the walk if a stored chain were ever a cycle. A
 * unit in `skip` is left alone with everything under it, and `reader` is never listed.
 */
async function addReportsFromBelow(
  tx: ProvisionTx,
  below: ReadonlyMap<string, TreeUnit[]>,
  unitId: string,
  people: Map<string, StaffPerson>,
  options: { skip?: ReadonlySet<string>; reader?: string; organisationId?: string } = {},
) {
  const seen = new Set([unitId]);
  for (let level = below.get(unitId) ?? []; level.length;) {
    const visit = level.filter(u => !seen.has(u.id) && !options.skip?.has(u.id));
    if (!visit.length) break;
    for (const u of visit) seen.add(u.id);
    const placedBelow = await tx.unitPeople(
      visit.map(u => u.id),
      options.organisationId,
    );
    level = [];
    for (const next of visit) {
      const there = placedBelow[next.id] ?? [],
        leads = there.filter(leadsUnit),
        report = leads.length ? leads : there;
      for (const p of report) {
        if (p.id === options.reader) continue;
        const held = people.get(p.id) ?? { ...p, below: [] },
          from = { unitId: next.id, unitLabel: next.label, role: p.role };
        // Assigned to the unit itself: the row stays as it is. Else the units they report from, a led one first in the role.
        if (!held.below) continue;
        people.set(p.id, {
          ...held,
          role: held.role === 'manager' || p.role === 'manager' ? 'manager' : 'employee',
          below: [...held.below, from].sort(
            (a, b) => bySwedish(a.unitLabel, b.unitLabel) || a.unitId.localeCompare(b.unitId),
          ),
        });
      }
      if (!leads.length) level.push(...(below.get(next.id) ?? []));
    }
  }
}
export function staffUsecases(deps: { store: ProvisionStore }) {
  /**
   * The people on each of these units except the reader, with those who report to the unit from below (D99), by
   * name; the units by label.
   */
  async function peopleOn(
    tx: ProvisionTx,
    persona: AuthenticatedContext,
    managed: Array<{ unitId: string; unitLabel: string }>,
  ): Promise<StaffUnit[]> {
    const below = unitsUnder(await tx.unitTree(persona.organisationId)),
      own = new Set(managed.map(u => u.unitId)),
      // Within the reader's organisation, as the tree is: a unit id names nobody elsewhere (D101, a unit belongs to
      // one organisation).
      placed = await tx.unitPeople([...own], persona.organisationId),
      units: StaffUnit[] = [];
    for (const unit of managed) {
      const people = new Map<string, StaffPerson>();
      for (const p of placed[unit.unitId] ?? []) if (p.id !== persona.id) people.set(p.id, p);
      // A unit the reader manages too has its own card, so the walk leaves it alone.
      await addReportsFromBelow(tx, below, unit.unitId, people, {
        skip: own,
        reader: persona.id,
        organisationId: persona.organisationId,
      });
      units.push({ unitId: unit.unitId, unitLabel: unit.unitLabel, people: [...people.values()].sort(byName) });
    }
    return units.sort((a, b) => bySwedish(a.unitLabel, b.unitLabel) || a.unitId.localeCompare(b.unitId));
  }
  return {
    overview: (persona: AuthenticatedContext): Promise<StaffOverview> =>
      deps.store.transaction(async tx => {
        const managed = (await tx.assignmentsOf(persona.id)).filter(a => a.role === 'manager');
        if (!managed.length) throw new ForbiddenError('Sidan Personal är för den som är chef för en enhet.');
        return { units: await peopleOn(tx, persona, managed) };
      }),
    /**
     * Where the reader stands (D97, who may be asked about): every unit they are assigned to with their role there, and
     * the units they manage with the people on them as `overview` lists them. It refuses nobody: someone who manages no
     * unit has nothing under `managed`.
     */
    reach: (
      persona: AuthenticatedContext,
    ): Promise<{ units: Array<{ unitId: string; unitLabel: string; role: Role }>; managed: StaffUnit[] }> =>
      deps.store.transaction(async tx => {
        const units = await tx.assignmentsOf(persona.id);
        return {
          units,
          managed: await peopleOn(
            tx,
            persona,
            units.filter(a => a.role === 'manager'),
          ),
        };
      }),
    /**
     * An active person in the reader's organisation, found by user name without regard to case (D97: a colleague is
     * anyone active in the directory), with the unit they act in; undefined for nobody, someone in another organisation
     * or a deactivated person. Read on every call, never cached.
     */
    person: (persona: AuthenticatedContext, userName: string, includeProfile: boolean) =>
      deps.store.transaction(async tx => {
        const found = await tx.findUser('userName', userName);
        if (!found || found.organisationId !== persona.organisationId || !found.enabled) return undefined;
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
              employments: found.employments.flatMap((row): PersonProfile['employments'] => {
                const unitLabel = labels.get(row.unitId);
                if (unitLabel !== undefined) return [{ ...row, unitLabel }];
                return row.title || row.employmentType || row.startDate || row.employmentPercentage !== undefined
                  ? [row]
                  : [];
              }),
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
  };
}
export type StaffUsecases = ReturnType<typeof staffUsecases>;

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
        );
      });
    },
    /**
     * The people of one unit of the administrator's own organisation, and who reports to its managers from the units
     * below (D99 item 4, the same walk Personal makes). The unit is one the organisation pushed or has people on, and
     * the people are the organisation's own: a unit of another organisation does not exist here. A unit nobody leads
     * has no reports: the line passes through it to a manager above.
     */
    async unit(persona: AuthenticatedContext, unitId: string): Promise<OrganisationUnitPeople> {
      require(persona);
      return deps.store.transaction(async tx => {
        const group = await tx.findGroup('externalId', UNIT_KEY + unitId),
          node = group?.organisationId === persona.organisationId ? group : undefined,
          people = (await tx.unitPeople([unitId], persona.organisationId))[unitId] ?? [];
        if (!node && !people.length) throw new InputError('Enheten finns inte.');
        const held = new Map<string, StaffPerson>(people.map(p => [p.id, p]));
        if (people.some(leadsUnit))
          await addReportsFromBelow(tx, unitsUnder(await tx.unitTree(persona.organisationId)), unitId, held, {
            organisationId: persona.organisationId,
          });
        return {
          unitId,
          unitLabel: node?.label ?? (await tx.unitLabels([unitId], persona.organisationId))[unitId] ?? unitId,
          people: people.sort(byName),
          reports: [...held.values()].filter(p => p.below).sort(byName),
        };
      });
    },
  };
}
export type OrganisationUsecases = ReturnType<typeof organisationUsecases>;
