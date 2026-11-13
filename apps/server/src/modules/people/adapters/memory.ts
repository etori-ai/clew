import {
  bySwedish,
  unitGroupOf,
  type Assignment,
  type Grant,
  type GroupCapabilityRule,
  type GroupRecord,
  type Placement,
  type UserRecord,
} from '../domain';
import type { Provisioner, ProvisionStore, ProvisionTx } from '../ports';

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
  units: Map<string, { organisationId: string; label: string }>;
  assignments: Map<string, Assignment[]>;
  grants: Map<string, Omit<Grant, 'capabilities'> & { capabilities: string[] }>;
  /** By token digest; `previous` is a rotated-out digest that still answers until `until`. */
  provisioners: Map<
    string,
    Provisioner & { revoked?: boolean; lastSeenAt?: string | null; previous?: { digest: string; until: string } }
  >;
  /** `auth_identity_binding`: a sign-in subject under its issuer, bound to a person. */
  bindings: Array<{ issuer: string; subject: string; personId: string }>;
  /** `auth_session`, as far as an erasure reads it: whose session it is. */
  sessions: Array<{ digest: string; personId: string }>;
  /** A row's id is its place in the list. */
  audit: Array<{ actor: string; action: string; subject: string; details: Record<string, unknown> }>;
  /** `auth_audit`, the authentication log. */
  authenticationAudit: Array<{ actor: string | null; action: string }>;
}
export const memberKey = (groupId: string, personId: string) => groupId + '\u0000' + personId;
const splitKey = (key: string) => key.split('\u0000') as [string, string];
export function memoryProvisionStore(): ProvisionStore & { state: MemoryProvisionState } {
  const state: MemoryProvisionState = {
    users: new Map(),
    groups: new Map(),
    members: new Set(),
    groupCapabilities: [],
    units: new Map(),
    assignments: new Map(),
    grants: new Map(),
    provisioners: new Map(),
    bindings: [],
    sessions: [],
    audit: [],
    authenticationAudit: [],
  };
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
  const duplicateKey = (constraint: string) =>
    Object.assign(new Error('duplicate key value violates unique constraint'), {
      code: '23505',
      constraint_name: constraint,
    });
  /** The unique indexes of `auth_person`, so a race the use case did not catch fails here as it does on Postgres. */
  const assertUnique = (record: Pick<UserRecord, 'userName' | 'externalId'>, selfId: string) => {
    for (const u of state.users.values()) {
      if (u.id === selfId) continue;
      const byName = record.userName !== null && userMatches(u, 'userName', record.userName),
        byExternal = record.externalId !== null && u.externalId === record.externalId;
      if (byName || byExternal) throw duplicateKey(byName ? 'auth_person_user_name' : 'auth_person_external_id');
    }
  };
  /**
   * The unique index of `auth_group` (B2): a key is one group's across the installation, any number of groups hold
   * none. A change to group handling that lets a second group take a key fails here as it does on Postgres.
   */
  const assertUniqueGroup = (record: Pick<GroupRecord, 'externalId'>, selfId: string) => {
    if (record.externalId === null) return;
    for (const g of state.groups.values())
      if (g.id !== selfId && g.externalId === record.externalId) throw duplicateKey('auth_group_external_id');
  };
  const groupsOf = (personId: string) =>
    [...state.members]
      .map(splitKey)
      .filter(([, p]) => p === personId)
      .map(([g]) => state.groups.get(g))
      .filter((g): g is GroupRecord => !!g);
  const provisionerRow = (p: Provisioner & { lastSeenAt?: string | null }) => ({
    id: p.id,
    organisationId: p.organisationId,
    label: p.label,
    lastSeenAt: p.lastSeenAt ?? null,
  });
  const tx: ProvisionTx = {
    async lockPerson(id) {
      const p = state.users.get(id);
      return p && { id: p.id, organisationId: p.organisationId };
    },
    async lockUnits() {},
    async lockTree() {},
    async lockGroupCapabilities() {},
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
      if (grant) state.grants.set(personId, { ...grant, capabilities: [...grant.capabilities] });
      else state.grants.delete(personId);
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
    async touchUsers(ids, updatedAt) {
      for (const id of ids) {
        const u = state.users.get(id);
        if (u) state.users.set(id, { ...u, updatedAt });
      }
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
      assertUniqueGroup(record, record.id);
      state.groups.set(record.id, { ...record });
    },
    async updateGroup(id, fields) {
      const g = state.groups.get(id);
      if (!g) return;
      const next = { ...g, ...fields };
      assertUniqueGroup(next, id);
      state.groups.set(id, next);
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
      // Unicode's own lower case, as PostgreSQL folds the search under ICU's root locale (`caseless`).
      const folded = (value: string | null | undefined) => (value ?? '').toLowerCase();
      const matching = [...state.users.values()]
        .filter(u => {
          if (u.organisationId !== organisationId) return false;
          const granted = state.grants.has(u.id),
            bound = state.bindings.some(b => b.personId === u.id),
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
      return state.bindings.some(b => b.personId === personId);
    },
    async lockGroupsOf() {},
    async removeMemberships(personId, at) {
      const gone = [...state.members].filter(key => splitKey(key)[1] === personId);
      for (const key of gone) {
        state.members.delete(key);
        const group = state.groups.get(splitKey(key)[0]);
        if (group) state.groups.set(group.id, { ...group, updatedAt: at });
      }
      return gone.length;
    },
    async removeBindings(personId) {
      const before = state.bindings.length;
      state.bindings = state.bindings.filter(b => b.personId !== personId);
      return before - state.bindings.length;
    },
    async removeSessions(personId) {
      const before = state.sessions.length;
      state.sessions = state.sessions.filter(s => s.personId !== personId);
      return before - state.sessions.length;
    },
    async auditRows(actions, where) {
      return state.audit.flatMap((row, id) =>
        actions.includes(row.action) &&
        ('subject' in where ? row.subject === where.subject : row.details[where.key] === where.value)
          ? [{ id, action: row.action, subject: row.subject, details: structuredClone(row.details) }]
          : [],
      );
    },
    async rewriteAudit(rows) {
      for (const { id, details } of rows) {
        const row = state.audit[id];
        if (row) state.audit[id] = { ...row, details: structuredClone(details) };
      }
    },
    async eraseClaims(names, marker) {
      // Unicode's own lower case of the composed form, as PostgreSQL folds both sides under ICU's root locale.
      const fold = (value: string) => value.normalize('NFC').toLowerCase(),
        held = new Set(names.filter(name => name).map(fold)),
        erased = 'claim:' + marker;
      let changed = 0;
      for (const row of state.authenticationAudit)
        if (row.actor?.startsWith('claim:') && row.actor !== erased && held.has(fold(row.actor.slice(6)))) {
          row.actor = erased;
          changed++;
        }
      return changed;
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
    async groupLabels(organisationId, externalIds) {
      const wanted = new Set(externalIds);
      return new Map(
        [...state.groups.values()]
          .filter(g => g.organisationId === organisationId && g.externalId !== null && wanted.has(g.externalId))
          .map(g => [g.externalId!, g.label]),
      );
    },
    async searchGroups(organisationId, words, limit) {
      const folded = (value: string) => value.toLocaleLowerCase('sv');
      return [...state.groups.values()]
        .filter(
          (g): g is GroupRecord & { externalId: string } =>
            g.organisationId === organisationId &&
            g.externalId !== null &&
            words.every(word => [g.label, g.externalId].some(value => folded(value!).includes(folded(word)))),
        )
        .sort(
          (a, b) =>
            bySwedish(a.label, b.label) || (a.externalId < b.externalId ? -1 : a.externalId > b.externalId ? 1 : 0),
        )
        .slice(0, limit)
        .map(g => ({ externalId: g.externalId, label: g.label }));
    },
  };
  return {
    state,
    async transaction(fn) {
      const before = snapshot();
      try {
        return await fn(tx);
      } catch (error) {
        restore(before);
        throw error;
      }
    },
  };
}
