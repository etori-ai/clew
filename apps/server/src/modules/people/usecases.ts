import { Value } from '@sinclair/typebox/value';
import {
  CAPABILITIES,
  isCapability,
  type AuthenticatedContext,
  type Capability,
  type GroupCapabilityInputType,
  type GroupCapability,
  type StaffOverview,
  type StaffUnit,
  type UserAdminRow,
  type UsersAdminOverview,
} from '@clew/contracts';
import { ForbiddenError, InputError } from '../../context';
import {
  SCIM,
  ScimError,
  ScimGroupInputSchema,
  ScimPatchSchema,
  ScimUserInputSchema,
  type ScimGroup,
  type ScimList,
  type ScimUser,
} from './contracts';
import {
  applyGroupPatch,
  applyUserPatch,
  assertAcceptedKey,
  deriveAuthority,
  groupFields,
  groupResource,
  pageOf,
  parseFilter,
  sameGrant,
  userFields,
  userResource,
  MANAGER_KEY,
  UNIT_KEY,
  type Derived,
  type GroupFields,
  type GroupRecord,
  type GroupCapabilityRule,
  type UserFields,
  type UserRecord,
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
    const person = await tx.person(personId);
    if (!person) return undefined;
    const memberships = await tx.memberships(personId),
      rules = await tx.groupCapabilities();
    // Every unit the memberships name, as the unit table knows it: the label of a managed unit without a `unit:` group,
    // and the comparison that lets an unchanged derivation write nothing (a daily push replays every person).
    const named = [
      ...new Set(
        memberships.flatMap(m =>
          m.externalId.startsWith(MANAGER_KEY)
            ? [m.externalId.slice(MANAGER_KEY.length)]
            : m.externalId.startsWith(UNIT_KEY)
              ? [m.externalId.slice(UNIT_KEY.length)]
              : [],
        ),
      ),
    ];
    const knownLabels = named.length ? await tx.unitLabels(named) : {};
    const derived = deriveAuthority(memberships, rules, knownLabels);
    const movedUnits = derived.units.filter(u => knownLabels[u.id] !== u.label);
    if (movedUnits.length) await tx.writeUnits(person.organisationId, movedUnits);
    const held = await tx.assignmentsOf(personId),
      sameAssignments =
        held.length === derived.assignments.length &&
        held.every((a, i) => a.unitId === derived.assignments[i]!.unitId && a.role === derived.assignments[i]!.role);
    if (!sameAssignments) await tx.replaceAssignments(personId, derived.assignments);
    // Compared as stored, so a projection that still carries a name outside the closed list is rewritten.
    const before = await tx.grant(personId),
      previous = before && { ...before, capabilities: [...before.capabilities].sort() as Capability[] };
    if (!sameGrant(previous, derived.grant)) {
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
  return {
    deriveWithin,
    /** Re-derive one person after their memberships changed. */
    derivePerson: (actor: string, personId: string) => deps.store.transaction(tx => deriveWithin(tx, actor, personId)),
    /** Re-derive every member of a group after the group's meaning changed (a group-capability row, a renamed `unit:` group). */
    deriveGroup: (actor: string, groupExternalId: string) =>
      deps.store.transaction(async tx => {
        const members = await tx.members(groupExternalId);
        for (const id of members) await deriveWithin(tx, actor, id);
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
export interface ScimQuery {
  filter?: string;
  startIndex?: string;
  count?: string;
}
export function scimUsecases(deps: {
  store: ProvisionStore;
  clock: () => Date;
  ids: () => string;
  digest: (token: string) => string;
}) {
  const derivation = provisioningUsecases({ store: deps.store });
  const actorOf = (p: Provisioner) => 'provisioner:' + p.id;
  const now = () => deps.clock().toISOString();
  const checked = <T>(schema: Parameters<typeof Value.Check>[0], body: unknown, name: string): T => {
    if (Value.Check(schema, body)) return body as T;
    const first = Value.Errors(schema, body).First();
    throw new ScimError(
      400,
      `The request body does not match the ${name} schema${first ? ` at '${first.path.replace(/^\//, '').replace(/\//g, '.')}'` : ''}.`,
      'invalidSyntax',
    );
  };
  const userOr404 = async (tx: ProvisionTx, p: Provisioner, id: string) => {
    const user = await tx.readUser(p.organisationId, id);
    if (!user) throw new ScimError(404, `User '${id}' not found.`);
    return user;
  };
  /** Within the provisioner's organisation, as `userOr404`: another organisation's group does not exist for this client. */
  const groupOr404 = async (tx: ProvisionTx, p: Provisioner, id: string) => {
    const group = await tx.readGroup(p.organisationId, id);
    if (!group) throw new ScimError(404, `Group '${id}' not found.`);
    return group;
  };
  /** Across the installation, `userName` without regard to case (the port says why); a race past this check hits the index and the route answers the same 409. */
  const uniqueUser = async (tx: ProvisionTx, fields: UserFields, self?: string) => {
    for (const by of ['userName', 'externalId'] as const) {
      const other = await tx.findUser(by, fields[by]);
      if (other && other.id !== self) throw new ScimError(409, `A user with this ${by} already exists.`, 'uniqueness');
    }
  };
  const uniqueGroup = async (tx: ProvisionTx, fields: GroupFields, self?: string) => {
    if (!fields.externalId) return;
    const other = await tx.findGroup('externalId', fields.externalId);
    if (other && other.id !== self)
      throw new ScimError(409, 'A group with this externalId already exists.', 'uniqueness');
  };
  const membersExist = async (tx: ProvisionTx, p: Provisioner, members: readonly string[]) => {
    for (const id of members)
      if (!(await tx.readUser(p.organisationId, id)))
        throw new ScimError(400, `Member '${id}' is not a user of this organisation.`, 'invalidValue');
  };
  /**
   * The managers of the unit a `unit:` group names. Their grant carries the unit's label without their being members of
   * that group, so a new or renamed unit group re-derives them too; any other group names nobody beyond its members.
   */
  const managersOfUnit = (tx: ProvisionTx, externalId: string | null): Promise<string[]> =>
    externalId?.startsWith(UNIT_KEY)
      ? tx.members(MANAGER_KEY + externalId.slice(UNIT_KEY.length))
      : Promise.resolve([]);
  const userView = async (tx: ProvisionTx, record: UserRecord, base: string) =>
    userResource(record, await tx.userGroups(record.id), base);
  const groupView = async (tx: ProvisionTx, record: GroupRecord, base: string) =>
    groupResource(record, await tx.groupMembers(record.id), base);
  const fieldsOf = (u: UserRecord): UserFields => ({
    externalId: u.externalId ?? '',
    userName: u.userName ?? u.id,
    name: u.name,
    email: u.email ?? '',
    enabled: u.enabled,
  });
  const changedKeys = <T extends object>(before: T, after: T) =>
    (Object.keys(after) as Array<keyof T>).filter(k => before[k] !== after[k]).map(String);
  async function writeUser(
    tx: ProvisionTx,
    p: Provisioner,
    current: UserRecord,
    fields: UserFields,
    action: string,
    base: string,
  ) {
    await uniqueUser(tx, fields, current.id);
    const changed = changedKeys(fieldsOf(current), fields),
      at = now();
    if (changed.length) {
      // A flip of `active` is what an operator reads the audit for, whatever verb carried it (DELETE writes the same);
      // the verb travels in the details.
      const flipped = current.enabled !== fields.enabled,
        recorded = flipped ? (fields.enabled ? 'scim.user.reactivated' : 'scim.user.deactivated') : action;
      await tx.updateUser(current.id, { ...fields, updatedAt: at });
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
    return userView(tx, { ...current, ...fields, updatedAt: changed.length ? at : current.updatedAt }, base);
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
    await uniqueGroup(tx, fields, current.id);
    await membersExist(tx, p, fields.members);
    const before = (await tx.groupMembers(current.id)).map(m => m.id),
      added = fields.members.filter(id => !before.includes(id)),
      removed = before.filter(id => !fields.members.includes(id)),
      renamed = current.label !== fields.label || current.externalId !== fields.externalId,
      at = now();
    if (!renamed && !added.length && !removed.length) return groupView(tx, current, base);
    if (renamed)
      await tx.updateGroup(current.id, {
        externalId: fields.externalId,
        label: fields.label,
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
        added: added.length,
        removed: removed.length,
        members: fields.members.length,
      },
    });
    // A renamed or re-keyed group changes what every member gets, and a unit's label what its managers carry;
    // otherwise only those who came or went.
    const touched = renamed
      ? [...new Set([...before, ...fields.members, ...(await managersOfUnit(tx, fields.externalId))])]
      : [...added, ...removed];
    for (const id of touched) await derivation.deriveWithin(tx, actorOf(p), id);
    return groupView(tx, { ...current, ...fields, updatedAt: at }, base);
  }
  return {
    ...derivation,
    /** The provisioner behind a bearer token, or undefined when none is active for it. */
    authenticate: (token: string) => deps.store.transaction(tx => tx.provisioner(deps.digest(token))),
    createUser: (p: Provisioner, body: unknown, base: string): Promise<ScimUser> =>
      deps.store.transaction(async tx => {
        const fields = userFields(checked(ScimUserInputSchema, body, 'User'));
        await uniqueUser(tx, fields);
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
    getUser: (p: Provisioner, id: string, base: string) =>
      deps.store.transaction(async tx => userView(tx, await userOr404(tx, p, id), base)),
    listUsers: (p: Provisioner, query: ScimQuery, base: string): Promise<ScimList<ScimUser>> =>
      deps.store.transaction(async tx => {
        const filter = parseFilter(query.filter, ['userName', 'externalId']) as
            { attribute: 'userName' | 'externalId'; value: string } | undefined,
          page = pageOf(query);
        const listed = await tx.listUsers(p.organisationId, page, filter);
        const Resources: ScimUser[] = [];
        for (const row of listed.rows) Resources.push(await userView(tx, row, base));
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
          await userOr404(tx, p, id),
          userFields(checked(ScimUserInputSchema, body, 'User')),
          'scim.user.replaced',
          base,
        ),
      ),
    patchUser: (p: Provisioner, id: string, body: unknown, base: string) =>
      deps.store.transaction(async tx => {
        const current = await userOr404(tx, p, id),
          patch = checked<{ Operations: Parameters<typeof applyUserPatch>[1] }>(ScimPatchSchema, body, 'PatchOp');
        return writeUser(
          tx,
          p,
          current,
          applyUserPatch(fieldsOf(current), patch.Operations),
          'scim.user.patched',
          base,
        );
      }),
    /** D68: a deleted user is deactivated, never erased. Idempotent. */
    deleteUser: (p: Provisioner, id: string) =>
      deps.store.transaction(async tx => {
        const current = await userOr404(tx, p, id);
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
        const fields = groupFields(checked(ScimGroupInputSchema, body, 'Group'));
        assertAcceptedKey(fields);
        await uniqueGroup(tx, fields);
        await membersExist(tx, p, fields.members);
        const at = now(),
          record: GroupRecord = {
            id: deps.ids(),
            organisationId: p.organisationId,
            externalId: fields.externalId,
            label: fields.label,
            createdAt: at,
            updatedAt: at,
          };
        await tx.insertGroup(record);
        await tx.setGroupMembers(record.id, fields.members);
        await tx.audit({
          actor: actorOf(p),
          action: 'scim.group.created',
          subject: 'group:' + record.id,
          details: { externalId: fields.externalId, displayName: fields.label, members: fields.members.length },
        });
        for (const id of new Set([...fields.members, ...(await managersOfUnit(tx, fields.externalId))]))
          await derivation.deriveWithin(tx, actorOf(p), id);
        return groupView(tx, record, base);
      }),
    getGroup: (p: Provisioner, id: string, base: string) =>
      deps.store.transaction(async tx => groupView(tx, await groupOr404(tx, p, id), base)),
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
        for (const row of listed.rows) Resources.push(await groupView(tx, row, base));
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
        writeGroup(
          tx,
          p,
          await groupOr404(tx, p, id),
          groupFields(checked(ScimGroupInputSchema, body, 'Group')),
          'scim.group.replaced',
          base,
        ),
      ),
    patchGroup: (p: Provisioner, id: string, body: unknown, base: string) =>
      deps.store.transaction(async tx => {
        const current = await groupOr404(tx, p, id),
          patch = checked<{ Operations: Parameters<typeof applyGroupPatch>[1] }>(ScimPatchSchema, body, 'PatchOp'),
          members = (await tx.groupMembers(id)).map(m => m.id);
        const next = applyGroupPatch(
          { externalId: current.externalId, label: current.label, members },
          patch.Operations,
        );
        return writeGroup(tx, p, current, next, 'scim.group.patched', base);
      }),
    /** Removes the group; its members are re-derived and lose what it gave them. The group-capability rows stay (D85). */
    deleteGroup: (p: Provisioner, id: string) =>
      deps.store.transaction(async tx => {
        const current = await groupOr404(tx, p, id),
          members = (await tx.groupMembers(id)).map(m => m.id);
        await tx.deleteGroup(id);
        await tx.audit({
          actor: actorOf(p),
          action: 'scim.group.removed',
          subject: 'group:' + id,
          details: { externalId: current.externalId, displayName: current.label, members: members.length },
        });
        for (const member of members) await derivation.deriveWithin(tx, actorOf(p), member);
      }),
  };
}
export type ScimUsecases = ReturnType<typeof scimUsecases>;

/**
 * Administration › Användare (D62, D68, D85): what an administrator with `admin.users` sees and may change. Identity,
 * units and roles are read only here; they come from the provisioner. The one thing written is D85's rows, a group gives
 * a capability: audited per row (`group-capability.added`, `group-capability.removed`), and every current member of the
 * group is re-derived in the same transaction, so a grant never lags the row that produced it.
 */
export const USERS_ADMIN_CAPABILITY: Capability = 'admin.users';
export function usersAdminUsecases(deps: { store: ProvisionStore }) {
  const derivation = provisioningUsecases({ store: deps.store });
  const require = (persona: AuthenticatedContext) => {
    if (!persona.capabilities.includes(USERS_ADMIN_CAPABILITY)) throw new ForbiddenError();
  };
  const sorted = (capabilities: readonly string[]) => [...capabilities].filter(isCapability).sort();
  async function overviewWithin(tx: ProvisionTx, persona: AuthenticatedContext): Promise<UsersAdminOverview> {
    const users: UserAdminRow[] = [];
    for (let startIndex = 1; ;) {
      const page = await tx.listUsers(persona.organisationId, { startIndex, count: 200 });
      for (const u of page.rows) {
        const grant = await tx.grant(u.id);
        users.push({
          id: u.id,
          name: u.name,
          userName: u.userName,
          externalId: u.externalId,
          email: u.email,
          enabled: u.enabled,
          bound: await tx.bound(u.id),
          assignments: await tx.assignmentsOf(u.id),
          active: grant ? { unitId: grant.unitId, unitLabel: grant.unitLabel, role: grant.role } : null,
          capabilities: grant ? sorted(grant.capabilities) : [],
          groups: (await tx.userGroups(u.id)).map(g => ({ externalId: g.externalId, label: g.label })),
        });
      }
      startIndex += page.rows.length;
      if (!page.rows.length || startIndex > page.total) break;
    }
    const groups = (await tx.listGroups(persona.organisationId, { startIndex: 1, count: 10_000 })).rows
      .filter(g => g.externalId)
      .map(g => ({ id: g.externalId!, label: g.label }))
      .sort((a, b) => a.label.localeCompare(b.label, 'sv') || a.id.localeCompare(b.id));
    const names = new Map(groups.map(g => [g.id, g.label]));
    const groupCapabilities: GroupCapability[] = (await tx.groupCapabilities())
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
    users.sort((a, b) => a.name.localeCompare(b.name, 'sv') || a.id.localeCompare(b.id));
    return { users, groupCapabilities, groups, capabilities: [...CAPABILITIES] };
  }
  async function change(persona: AuthenticatedContext, input: GroupCapabilityInputType, present: boolean) {
    require(persona);
    await persona.authorize();
    if (!isCapability(input.capability)) throw new InputError('Okänd behörighet.');
    return deps.store.transaction(async tx => {
      const group = await tx.findGroup('externalId', input.groupExternalId);
      if (!group && present) throw new InputError('Gruppen finns inte bland de provisionerade grupperna.');
      const changed = await tx.setGroupCapability(input.groupExternalId, input.capability, present);
      if (changed) {
        await tx.audit({
          actor: 'person:' + persona.id,
          action: present ? 'group-capability.added' : 'group-capability.removed',
          subject: 'group:' + input.groupExternalId,
          details: { capability: input.capability, groupLabel: group?.label ?? null },
        });
        for (const member of await tx.members(input.groupExternalId))
          await derivation.deriveWithin(tx, 'person:' + persona.id, member);
      }
      return overviewWithin(tx, persona);
    });
  }
  return {
    async overview(persona: AuthenticatedContext) {
      require(persona);
      return deps.store.transaction(tx => overviewWithin(tx, persona));
    },
    addGroupCapability: (persona: AuthenticatedContext, input: GroupCapabilityInputType) =>
      change(persona, input, true),
    removeGroupCapability: (persona: AuthenticatedContext, input: GroupCapabilityInputType) =>
      change(persona, input, false),
  };
}
export type UsersAdminUsecases = ReturnType<typeof usersAdminUsecases>;

/**
 * Personal (D94): what a manager sees of the people on the units they manage, read only. The scope is the server's:
 * the actor must manage at least one unit, and the units come from the actor's own assignments, never from the
 * request. A person is listed under every unit they are assigned to, with their role on that unit; the manager is not
 * listed on their own units. Nothing is written, so there is no audit row.
 */
export function staffUsecases(deps: { store: ProvisionStore }) {
  const sv = (a: string, b: string) => a.localeCompare(b, 'sv');
  return {
    overview: (persona: AuthenticatedContext): Promise<StaffOverview> =>
      deps.store.transaction(async tx => {
        const managed = (await tx.assignmentsOf(persona.id)).filter(a => a.role === 'manager');
        if (!managed.length) throw new ForbiddenError('Sidan Personal är för den som är chef för en enhet.');
        const units: StaffUnit[] = [];
        for (const unit of managed)
          units.push({
            unitId: unit.unitId,
            unitLabel: unit.unitLabel,
            people: (await tx.unitPeople(unit.unitId))
              .filter(p => p.id !== persona.id)
              .sort((a, b) => sv(a.name, b.name) || a.id.localeCompare(b.id)),
          });
        return { units: units.sort((a, b) => sv(a.unitLabel, b.unitLabel) || a.unitId.localeCompare(b.unitId)) };
      }),
  };
}
export type StaffUsecases = ReturnType<typeof staffUsecases>;
