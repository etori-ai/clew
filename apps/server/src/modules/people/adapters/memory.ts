import {
  byCode,
  bySwedish,
  unitGroupOf,
  type Assignment,
  type Grant,
  type GroupCapabilityRule,
  type GroupRelationRule,
  type GroupRecord,
  type Placement,
  type UserRecord,
} from '../domain';
import type { LeaverChange, LeaversTx, Provisioner, ProvisionStore, ProvisionTx } from '../ports';

/**
 * The provisioning store in memory: the unit tests' adapter (D25), held to Postgres by
 * `tests/provisioning-store-contract.ts` and `tests/scim-store-contract.ts`. State is plain and seedable; a transaction
 * is a snapshot that a throw rolls back, the audit rows included.
 */
export interface MemoryProvisionState {
  users: Map<string, UserRecord>;
  groups: Map<string, GroupRecord>;
  /** `memberKey(groupId, personId)`. */
  members: Set<string>;
  groupCapabilities: Array<GroupCapabilityRule & { organisationId: string }>;
  /** D121: a group gives its members a relation to people by grant. */
  groupRelations: Array<GroupRelationRule & { organisationId: string }>;
  units: Map<string, { organisationId: string; label: string }>;
  assignments: Map<string, Assignment[]>;
  /** `relations` (D121) only when the person holds one, as the projection stores it. */
  grants: Map<string, Omit<Grant, 'capabilities' | 'relations'> & { capabilities: string[]; relations?: string[] }>;
  /** D108 item 5: the organisations' positions, by the store's id; a code is unique within its organisation. */
  positions: Map<string, { organisationId: string; code: string; label: string }>;
  /** The ids of the positions each person holds, by person id. */
  personPositions: Map<string, string[]>;
  /** By token digest; `previous` is a rotated-out digest that still answers until `until`. */
  provisioners: Map<
    string,
    Provisioner & { revoked?: boolean; lastSeenAt?: string | null; previous?: { digest: string; until: string } }
  >;
  /** Person ids with an identity binding. */
  bindings: Set<string>;
  audit: Array<{ actor: string; action: string; subject: string; details: Record<string, unknown> }>;
  /** What the leavers port was told (D108 item 14), in order; a rollback takes it back with the rest. */
  leavers: Array<LeaverChange & { change: 'deactivated' | 'reactivated' }>;
}
/**
 * What the memory store tells beyond its own state, as `postgresProvisionStore`'s options do: `leavers` is the port a
 * test binds (the competence module's, on its own memory store), handed the list of workflows a change ended, which
 * `cancel` is given after the transaction commits. Every change is also recorded in `state.leavers`.
 */
export interface MemoryProvisionOptions {
  leavers?: (ended: string[]) => LeaversTx;
  cancel?: (workflowId: string) => Promise<void>;
}
export const memberKey = (groupId: string, personId: string) => groupId + '\u0000' + personId;
const splitKey = (key: string) => key.split('\u0000') as [string, string];
export function memoryProvisionStore(
  options: MemoryProvisionOptions = {},
): ProvisionStore & { state: MemoryProvisionState } {
  const state: MemoryProvisionState = {
    users: new Map(),
    groups: new Map(),
    members: new Set(),
    groupCapabilities: [],
    groupRelations: [],
    units: new Map(),
    assignments: new Map(),
    grants: new Map(),
    positions: new Map(),
    personPositions: new Map(),
    provisioners: new Map(),
    bindings: new Set(),
    audit: [],
    leavers: [],
  };
  let ended: string[] = [];
  const snapshot = () => structuredClone(state),
    restore = (s: MemoryProvisionState) => Object.assign(state, s);
  const byId = <T extends { id: string }>(rows: T[]) => rows.sort((a, b) => a.id.localeCompare(b.id));
  const page = <T extends { id: string }>(rows: T[], p: { startIndex: number; count: number }) => ({
    total: rows.length,
    rows: byId(rows).slice(p.startIndex - 1, p.startIndex - 1 + p.count),
  });
  /** `userName` is matched without regard to case (RFC 7643's default), `externalId` exactly: what the Postgres indexes do. */
  const userMatches = (u: UserRecord, by: 'userName' | 'externalId', value: string) =>
    by === 'userName'
      ? u.userName !== null && u.userName.toLowerCase() === value.toLowerCase()
      : u.externalId === value;
  /** The unique indexes of `auth_person`, so a race the use case did not catch fails here as it does on Postgres. */
  const assertUnique = (record: Pick<UserRecord, 'userName' | 'externalId'>, selfId: string) => {
    for (const u of state.users.values()) {
      if (u.id === selfId) continue;
      const byName = record.userName !== null && userMatches(u, 'userName', record.userName),
        byExternal = record.externalId !== null && u.externalId === record.externalId;
      if (byName || byExternal)
        throw Object.assign(new Error('duplicate key value violates unique constraint'), {
          code: '23505',
          constraint_name: byName ? 'auth_person_user_name' : 'auth_person_external_id',
        });
    }
  };
  const groupsOf = (personId: string) =>
    [...state.members]
      .map(splitKey)
      .filter(([, p]) => p === personId)
      .map(([g]) => state.groups.get(g))
      .filter((g): g is GroupRecord => !!g);
  /** The organisation's position rows of these codes, with their ids. */
  const positionRows = (organisationId: string, codes: readonly string[]) =>
    [...state.positions].filter(([, row]) => row.organisationId === organisationId && codes.includes(row.code));
  const provisionerRow = (p: Provisioner & { lastSeenAt?: string | null }) => ({
    id: p.id,
    organisationId: p.organisationId,
    label: p.label,
    lastSeenAt: p.lastSeenAt ?? null,
  });
  const tell = (change: 'deactivated' | 'reactivated') => async (told: LeaverChange) => {
    state.leavers.push({ ...told, change });
    await options.leavers?.(ended)[change](told);
  };
  const tx: ProvisionTx = {
    leavers: { deactivated: tell('deactivated'), reactivated: tell('reactivated') },
    async lockPerson(id) {
      const p = state.users.get(id);
      return p && { id: p.id, organisationId: p.organisationId };
    },
    async lockUnits() {},
    async lockTree() {},
    async memberships(personId) {
      return groupsOf(personId)
        .filter(g => g.externalId !== null)
        .map(g => ({ externalId: g.externalId!, label: g.label }))
        .sort((a, b) => a.externalId.localeCompare(b.externalId));
    },
    async members(groupExternalId) {
      const group = [...state.groups.values()].find(g => g.externalId === groupExternalId);
      return group ? (await tx.groupMembers(group.id)).map(m => m.id) : [];
    },
    async groupCapabilities(organisationId) {
      return state.groupCapabilities
        .filter(m => m.organisationId === organisationId)
        .map(m => ({ groupExternalId: m.groupExternalId, capability: m.capability }));
    },
    async groupRelations(organisationId) {
      return state.groupRelations
        .filter(m => m.organisationId === organisationId)
        .map(m => ({ groupExternalId: m.groupExternalId, relation: m.relation }));
    },
    async unitLabels(ids, organisationId) {
      return Object.fromEntries(
        ids.flatMap(id => {
          const unit = state.units.get(id);
          return unit?.organisationId === organisationId ? [[id, unit.label]] : [];
        }),
      );
    },
    async writeUnits(organisationId, units) {
      for (const u of units) state.units.set(u.id, { organisationId, label: u.label });
    },
    async replaceAssignments(personId, assignments) {
      state.assignments.set(
        personId,
        assignments.map(a => ({ ...a })),
      );
    },
    async grant(personId) {
      const g = state.grants.get(personId);
      return g && structuredClone(g);
    },
    async writeGrant(personId, grant) {
      if (!grant) {
        state.grants.delete(personId);
        return;
      }
      const { relations, ...rest } = grant;
      state.grants.set(personId, {
        ...rest,
        capabilities: [...grant.capabilities],
        ...(relations?.length ? { relations: [...relations] } : {}),
      });
    },
    async positionsOf(personId) {
      return (state.personPositions.get(personId) ?? [])
        .flatMap(id => {
          const row = state.positions.get(id);
          return row ? [{ code: row.code, label: row.label }] : [];
        })
        .sort(byCode);
    },
    async positionLabels(organisationId, codes) {
      return Object.fromEntries(positionRows(organisationId, codes).map(([, row]) => [row.code, row.label]));
    },
    async writePositions(organisationId, positions) {
      for (const p of positions) {
        const [held] = positionRows(organisationId, [p.code]);
        state.positions.set(held?.[0] ?? crypto.randomUUID(), { organisationId, code: p.code, label: p.label });
      }
    },
    async removePositions(organisationId, codes) {
      const gone = new Set(positionRows(organisationId, codes).map(([id]) => id));
      for (const id of gone) state.positions.delete(id);
      for (const [personId, ids] of state.personPositions)
        state.personPositions.set(
          personId,
          ids.filter(id => !gone.has(id)),
        );
    },
    async replacePositions(personId, organisationId, codes) {
      state.personPositions.set(
        personId,
        positionRows(organisationId, codes).map(([id]) => id),
      );
    },
    async audit(entry) {
      state.audit.push(structuredClone(entry));
    },
    async provisioner(tokenDigest, at) {
      const p =
        state.provisioners.get(tokenDigest) ??
        [...state.provisioners.values()].find(o => o.previous?.digest === tokenDigest && o.previous.until > at);
      return p && !p.revoked ? provisionerRow(p) : undefined;
    },
    async touchProvisioner(id, at, seenBefore) {
      let moved = false;
      for (const [digest, p] of state.provisioners)
        if (p.id === id && (p.lastSeenAt ?? null) === seenBefore) {
          state.provisioners.set(digest, { ...p, lastSeenAt: at });
          moved = true;
        }
      return moved;
    },
    async provisioners(organisationId) {
      return [...state.provisioners.values()]
        .filter(p => p.organisationId === organisationId && !p.revoked)
        .map(p => ({ ...provisionerRow(p), previousValidUntil: p.previous?.until ?? null }))
        .sort((a, b) => a.id.localeCompare(b.id));
    },
    async provisionerById(id) {
      const p = [...state.provisioners.values()].find(o => o.id === id);
      return (
        p && {
          id: p.id,
          organisationId: p.organisationId,
          label: p.label,
          revoked: !!p.revoked,
          previousValidUntil: p.previous?.until ?? null,
        }
      );
    },
    async issueProvisioner({ id, organisationId, label, tokenDigest }) {
      const held = [...state.provisioners.values()].find(p => p.id === id);
      if (held && (!held.revoked || held.organisationId !== organisationId)) return false;
      for (const [digest, p] of state.provisioners) if (p.id === id) state.provisioners.delete(digest);
      state.provisioners.set(tokenDigest, { id, organisationId, label, lastSeenAt: null });
      return true;
    },
    async rotateProvisioner(id, tokenDigest, previousValidUntil) {
      for (const [digest, p] of state.provisioners)
        if (p.id === id) {
          state.provisioners.delete(digest);
          state.provisioners.set(tokenDigest, {
            ...p,
            previous: previousValidUntil === null ? undefined : { digest, until: previousValidUntil },
          });
          return;
        }
    },
    async revokeProvisioner(id) {
      for (const [digest, p] of state.provisioners)
        if (p.id === id) state.provisioners.set(digest, { ...p, revoked: true, previous: undefined });
    },
    async usersAmong(organisationId, ids) {
      return ids.filter(id => state.users.get(id)?.organisationId === organisationId);
    },
    async readUser(organisationId, id) {
      const u = state.users.get(id);
      return u && u.organisationId === organisationId ? { ...u } : undefined;
    },
    async findUser(by, value) {
      const u = [...state.users.values()].find(u => userMatches(u, by, value));
      return u && { ...u };
    },
    async listUsers(organisationId, p, filter) {
      return page(
        [...state.users.values()]
          .filter(
            u => u.organisationId === organisationId && (!filter || userMatches(u, filter.attribute, filter.value)),
          )
          .map(u => ({ ...u })),
        p,
      );
    },
    async insertUser(record) {
      if (state.users.has(record.id)) throw new Error('duplicate user id');
      assertUnique(record, record.id);
      state.users.set(record.id, { ...record });
    },
    async updateUser(id, fields) {
      const u = state.users.get(id);
      if (!u) return;
      const next = { ...u, ...fields };
      assertUnique(next, id);
      state.users.set(id, next);
    },
    async userGroups(personId) {
      return byId(groupsOf(personId).map(g => ({ id: g.id, externalId: g.externalId, label: g.label })));
    },
    async readGroup(organisationId, id) {
      const g = state.groups.get(id);
      return g && g.organisationId === organisationId ? { ...g } : undefined;
    },
    async findGroup(by, value) {
      const g = [...state.groups.values()].find(g => g[by] === value);
      return g && { ...g };
    },
    async listGroups(organisationId, p, filter) {
      return page(
        [...state.groups.values()]
          .filter(
            g =>
              g.organisationId === organisationId &&
              (!filter ||
                (filter.attribute === 'label'
                  ? g.label.toLowerCase() === filter.value.toLowerCase()
                  : g[filter.attribute] === filter.value)),
          )
          .map(g => ({ ...g })),
        p,
      );
    },
    async insertGroup(record) {
      if (state.groups.has(record.id)) throw new Error('duplicate group id');
      state.groups.set(record.id, { ...record });
    },
    async updateGroup(id, fields) {
      const g = state.groups.get(id);
      if (g) state.groups.set(id, { ...g, ...fields });
    },
    async deleteGroup(id) {
      state.groups.delete(id);
      for (const key of [...state.members]) if (splitKey(key)[0] === id) state.members.delete(key);
    },
    async groupMembers(groupId) {
      return byId(
        [...state.members]
          .map(splitKey)
          .filter(([g]) => g === groupId)
          .map(([, p]) => state.users.get(p))
          .filter((u): u is UserRecord => !!u)
          .map(u => ({ id: u.id, name: u.name })),
      );
    },
    async setGroupMembers(groupId, personIds) {
      for (const key of [...state.members]) if (splitKey(key)[0] === groupId) state.members.delete(key);
      for (const p of personIds) state.members.add(memberKey(groupId, p));
    },
    async searchUsers(organisationId, search, p) {
      const folded = (value: string | null | undefined) => (value ?? '').toLocaleLowerCase('sv');
      const matching = [...state.users.values()]
        .filter(u => {
          if (u.organisationId !== organisationId) return false;
          const granted = state.grants.has(u.id),
            bound = state.bindings.has(u.id),
            status = !u.enabled ? 'disabled' : !granted ? 'no-access' : bound ? 'signed-in' : 'not-signed-in';
          return (
            (search.words ?? []).every(word =>
              [u.name, u.userName, u.email, u.title, ...u.employments.map(job => job.title)].some(value =>
                folded(value).includes(folded(word)),
              ),
            ) &&
            (!(search.unitIds || search.role) ||
              (state.assignments.get(u.id) ?? []).some(
                a => (!search.unitIds || search.unitIds.includes(a.unitId)) && (!search.role || a.role === search.role),
              )) &&
            (!search.status || search.status === status) &&
            (search.capability === undefined || !!state.grants.get(u.id)?.capabilities.includes(search.capability))
          );
        })
        .sort((a, b) => bySwedish(a.name, b.name) || a.id.localeCompare(b.id));
      return {
        total: matching.length,
        rows: matching.slice(p.startIndex - 1, p.startIndex - 1 + p.count).map(u => ({ ...u })),
      };
    },
    async assignmentsOf(personId) {
      return (state.assignments.get(personId) ?? [])
        .map(a => ({ unitId: a.unitId, unitLabel: state.units.get(a.unitId)?.label ?? a.unitId, role: a.role }))
        .sort((a, b) => a.unitId.localeCompare(b.unitId));
    },
    async unitPeople(unitIds, organisationId) {
      const byUnit: Awaited<ReturnType<ProvisionTx['unitPeople']>> = {};
      for (const [personId, list] of [...state.assignments.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        const u = state.users.get(personId);
        if (!u || (organisationId !== undefined && u.organisationId !== organisationId)) continue;
        const person = { id: u.id, name: u.name, userName: u.userName, email: u.email, enabled: u.enabled };
        for (const a of list)
          if (unitIds.includes(a.unitId)) (byUnit[a.unitId] ??= []).push({ ...person, role: a.role });
      }
      return byUnit;
    },
    async childUnits(unitId) {
      return [...state.groups.values()]
        .filter(g => g.parentUnitId === unitId && unitGroupOf(g.externalId) !== undefined)
        .map(g => ({ id: unitGroupOf(g.externalId)!, label: g.label }))
        .sort((a, b) => a.id.localeCompare(b.id));
    },
    async unitTree(organisationId, ids) {
      const wanted = ids && new Set(ids);
      return [...state.groups.values()]
        .filter(g => g.organisationId === organisationId && unitGroupOf(g.externalId) !== undefined)
        .map(g => ({ id: unitGroupOf(g.externalId)!, label: g.label, parentId: g.parentUnitId }))
        .filter(unit => !wanted || wanted.has(unit.id))
        .sort((a, b) => a.id.localeCompare(b.id));
    },
    async placements(organisationId) {
      return [...state.users.values()]
        .filter(u => u.organisationId === organisationId)
        .sort((a, b) => a.id.localeCompare(b.id))
        .flatMap((u): Placement[] => {
          const person = { personId: u.id, name: u.name, enabled: u.enabled },
            held = [...(state.assignments.get(u.id) ?? [])].sort((a, b) => a.unitId.localeCompare(b.unitId));
          return held.length
            ? held.map(a => ({ ...person, unitId: a.unitId, role: a.role }))
            : [{ ...person, unitId: null, role: null }];
        });
    },
    async bound(personId) {
      return state.bindings.has(personId);
    },
    async setGroupCapability(organisationId, groupExternalId, capability, present) {
      const index = state.groupCapabilities.findIndex(
        m =>
          m.organisationId === organisationId && m.groupExternalId === groupExternalId && m.capability === capability,
      );
      if (present && index === -1) {
        state.groupCapabilities.push({ organisationId, groupExternalId, capability });
        return true;
      }
      if (!present && index !== -1) {
        state.groupCapabilities.splice(index, 1);
        return true;
      }
      return false;
    },
    async setGroupRelation(organisationId, groupExternalId, relation, present) {
      const rows = state.groupRelations;
      const index = rows.findIndex(
        m => m.organisationId === organisationId && m.groupExternalId === groupExternalId && m.relation === relation,
      );
      if (present && index === -1) {
        rows.push({ organisationId, groupExternalId, relation });
        return true;
      }
      if (!present && index !== -1) {
        rows.splice(index, 1);
        return true;
      }
      return false;
    },
  };
  return {
    state,
    async transaction(fn) {
      const before = snapshot();
      ended = [];
      let result;
      try {
        result = await fn(tx);
      } catch (error) {
        restore(before);
        throw error;
      }
      // After the commit, as the Postgres store does: a cancel never follows a rollback.
      const done = ended;
      ended = [];
      for (const id of done) await options.cancel?.(id).catch(() => undefined);
      return result;
    },
  };
}
