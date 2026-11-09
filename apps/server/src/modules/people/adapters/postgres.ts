import { and, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { database, schema, type Transaction } from '@clew/db';
import { writeAudit } from '@clew/db/threads';
import type { GroupRecord, UserRecord } from '../domain';
import type { ProvisionStore, ProvisionTx, UserReads } from '../ports';

/** Read the local user/grant tables; directory access is restricted to the actor's unit. */
export const postgresUserReads = (): UserReads => ({
  async capabilities(personId) {
    const [row] = await database()
      .select({ capabilities: schema.accessGrants.capabilities })
      .from(schema.accessGrants)
      .where(eq(schema.accessGrants.personId, personId));
    return row?.capabilities ?? [];
  },
  async directory(unitId) {
    return database()
      .select({ id: schema.people.id, name: schema.people.name, role: schema.accessGrants.role })
      .from(schema.people)
      .innerJoin(schema.accessGrants, eq(schema.accessGrants.personId, schema.people.id))
      .where(eq(schema.accessGrants.unitId, unitId));
  },
});
const userColumns = {
  id: schema.people.id,
  organisationId: schema.people.organisationId,
  externalId: schema.people.externalId,
  userName: schema.people.userName,
  name: schema.people.name,
  email: schema.people.email,
  enabled: schema.people.enabled,
  createdAt: schema.people.createdAt,
  updatedAt: schema.people.updatedAt,
};
const groupColumns = {
  id: schema.groups.id,
  externalId: schema.groups.externalId,
  label: schema.groups.label,
  createdAt: schema.groups.createdAt,
  updatedAt: schema.groups.updatedAt,
};
type UserRow = Omit<UserRecord, 'createdAt' | 'updatedAt'> & { createdAt: Date; updatedAt: Date };
type GroupRow = Omit<GroupRecord, 'createdAt' | 'updatedAt'> & { createdAt: Date; updatedAt: Date };
const userRecord = (r: UserRow): UserRecord => ({
  ...r,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});
const groupRecord = (r: GroupRow): GroupRecord => ({
  ...r,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});
const userColumn = { userName: schema.people.userName, externalId: schema.people.externalId } as const;
const groupColumn = { externalId: schema.groups.externalId, label: schema.groups.label } as const;
/** The provisioning tables and the grant projection (D68, D85) inside one Postgres transaction. */
export function postgresProvisionStore(): ProvisionStore {
  const txOf = (tx: Transaction): ProvisionTx => ({
    async person(id) {
      const [row] = await tx
        .select({ id: schema.people.id, organisationId: schema.people.organisationId })
        .from(schema.people)
        .where(eq(schema.people.id, id));
      return row;
    },
    async memberships(personId) {
      const rows = await tx
        .select({ externalId: schema.groups.externalId, label: schema.groups.label })
        .from(schema.groupMembers)
        .innerJoin(schema.groups, eq(schema.groups.id, schema.groupMembers.groupId))
        .where(and(eq(schema.groupMembers.personId, personId), isNotNull(schema.groups.externalId)))
        .orderBy(schema.groups.externalId);
      return rows.map(r => ({ externalId: r.externalId!, label: r.label }));
    },
    async members(groupExternalId) {
      const rows = await tx
        .select({ personId: schema.groupMembers.personId })
        .from(schema.groupMembers)
        .innerJoin(schema.groups, eq(schema.groups.id, schema.groupMembers.groupId))
        .where(eq(schema.groups.externalId, groupExternalId))
        .orderBy(schema.groupMembers.personId);
      return rows.map(r => r.personId);
    },
    async groupCapabilities() {
      return tx
        .select({
          groupExternalId: schema.groupCapabilities.groupExternalId,
          capability: schema.groupCapabilities.capability,
        })
        .from(schema.groupCapabilities);
    },
    async unitLabels(ids) {
      if (!ids.length) return {};
      const rows = await tx
        .select({ id: schema.units.id, label: schema.units.label })
        .from(schema.units)
        .where(inArray(schema.units.id, [...ids]));
      return Object.fromEntries(rows.map(r => [r.id, r.label]));
    },
    async writeUnits(organisationId, units) {
      for (const u of units)
        await tx
          .insert(schema.units)
          .values({ id: u.id, organisationId, label: u.label })
          .onConflictDoUpdate({ target: schema.units.id, set: { label: u.label } });
    },
    async replaceAssignments(personId, assignments) {
      await tx.delete(schema.assignments).where(eq(schema.assignments.personId, personId));
      if (assignments.length)
        await tx
          .insert(schema.assignments)
          .values(assignments.map(a => ({ personId, unitId: a.unitId, role: a.role })));
    },
    async grant(personId) {
      const [row] = await tx
        .select({
          unitId: schema.accessGrants.unitId,
          unitLabel: schema.accessGrants.unitLabel,
          role: schema.accessGrants.role,
          capabilities: schema.accessGrants.capabilities,
        })
        .from(schema.accessGrants)
        .where(eq(schema.accessGrants.personId, personId));
      return row;
    },
    async writeGrant(personId, grant) {
      if (!grant) {
        await tx.delete(schema.accessGrants).where(eq(schema.accessGrants.personId, personId));
        return;
      }
      const values = {
        unitId: grant.unitId,
        unitLabel: grant.unitLabel,
        role: grant.role,
        capabilities: [...grant.capabilities],
      };
      await tx
        .insert(schema.accessGrants)
        .values({ personId, ...values })
        .onConflictDoUpdate({ target: schema.accessGrants.personId, set: values });
    },
    audit: entry => writeAudit(tx, entry),
    async provisioner(tokenDigest) {
      const [row] = await tx
        .select({
          id: schema.provisioners.id,
          organisationId: schema.provisioners.organisationId,
          label: schema.provisioners.label,
        })
        .from(schema.provisioners)
        .where(and(eq(schema.provisioners.tokenDigest, tokenDigest), isNull(schema.provisioners.revokedAt)));
      return row;
    },
    async readUser(organisationId, id) {
      const [row] = await tx
        .select(userColumns)
        .from(schema.people)
        .where(and(eq(schema.people.id, id), eq(schema.people.organisationId, organisationId)));
      return row && userRecord(row);
    },
    async findUser(organisationId, by, value) {
      const [row] = await tx
        .select(userColumns)
        .from(schema.people)
        .where(and(eq(userColumn[by], value), eq(schema.people.organisationId, organisationId)));
      return row && userRecord(row);
    },
    async listUsers(organisationId, page, filter) {
      const where = filter
        ? and(eq(schema.people.organisationId, organisationId), eq(userColumn[filter.attribute], filter.value))
        : eq(schema.people.organisationId, organisationId);
      const [counted] = await tx
        .select({ total: sql<number>`count(*)::int` })
        .from(schema.people)
        .where(where);
      const rows = page.count
        ? await tx
            .select(userColumns)
            .from(schema.people)
            .where(where)
            .orderBy(schema.people.id)
            .limit(page.count)
            .offset(page.startIndex - 1)
        : [];
      return { total: counted?.total ?? 0, rows: rows.map(userRecord) };
    },
    async insertUser(record) {
      await tx.insert(schema.people).values({
        ...record,
        createdAt: new Date(record.createdAt),
        updatedAt: new Date(record.updatedAt),
      });
    },
    async updateUser(id, { updatedAt, ...fields }) {
      await tx
        .update(schema.people)
        .set({ ...fields, updatedAt: new Date(updatedAt) })
        .where(eq(schema.people.id, id));
    },
    async userGroups(personId) {
      return tx
        .select({ id: schema.groups.id, externalId: schema.groups.externalId, label: schema.groups.label })
        .from(schema.groupMembers)
        .innerJoin(schema.groups, eq(schema.groups.id, schema.groupMembers.groupId))
        .where(eq(schema.groupMembers.personId, personId))
        .orderBy(schema.groups.id);
    },
    async readGroup(id) {
      const [row] = await tx.select(groupColumns).from(schema.groups).where(eq(schema.groups.id, id));
      return row && groupRecord(row);
    },
    async findGroup(by, value) {
      const [row] = await tx.select(groupColumns).from(schema.groups).where(eq(groupColumn[by], value));
      return row && groupRecord(row);
    },
    async listGroups(page, filter) {
      const where = filter ? eq(groupColumn[filter.attribute], filter.value) : undefined;
      const [counted] = await tx
        .select({ total: sql<number>`count(*)::int` })
        .from(schema.groups)
        .where(where);
      const rows = page.count
        ? await tx
            .select(groupColumns)
            .from(schema.groups)
            .where(where)
            .orderBy(schema.groups.id)
            .limit(page.count)
            .offset(page.startIndex - 1)
        : [];
      return { total: counted?.total ?? 0, rows: rows.map(groupRecord) };
    },
    async insertGroup(record) {
      await tx.insert(schema.groups).values({
        ...record,
        createdAt: new Date(record.createdAt),
        updatedAt: new Date(record.updatedAt),
      });
    },
    async updateGroup(id, { updatedAt, ...fields }) {
      await tx
        .update(schema.groups)
        .set({ ...fields, updatedAt: new Date(updatedAt) })
        .where(eq(schema.groups.id, id));
    },
    async deleteGroup(id) {
      await tx.delete(schema.groups).where(eq(schema.groups.id, id));
    },
    async groupMembers(groupId) {
      return tx
        .select({ id: schema.people.id, name: schema.people.name })
        .from(schema.groupMembers)
        .innerJoin(schema.people, eq(schema.people.id, schema.groupMembers.personId))
        .where(eq(schema.groupMembers.groupId, groupId))
        .orderBy(schema.people.id);
    },
    async setGroupMembers(groupId, personIds) {
      await tx.delete(schema.groupMembers).where(eq(schema.groupMembers.groupId, groupId));
      if (personIds.length)
        await tx.insert(schema.groupMembers).values([...new Set(personIds)].map(personId => ({ groupId, personId })));
    },
    async assignmentsOf(personId) {
      return tx
        .select({ unitId: schema.assignments.unitId, unitLabel: schema.units.label, role: schema.assignments.role })
        .from(schema.assignments)
        .innerJoin(schema.units, eq(schema.units.id, schema.assignments.unitId))
        .where(eq(schema.assignments.personId, personId))
        .orderBy(schema.assignments.unitId);
    },
    async bound(personId) {
      const [row] = await tx
        .select({ personId: schema.identityBindings.personId })
        .from(schema.identityBindings)
        .where(eq(schema.identityBindings.personId, personId))
        .limit(1);
      return !!row;
    },
    async setGroupCapability(groupExternalId, capability, present) {
      if (present) {
        const inserted = await tx
          .insert(schema.groupCapabilities)
          .values({ groupExternalId, capability })
          .onConflictDoNothing()
          .returning({ capability: schema.groupCapabilities.capability });
        return inserted.length > 0;
      }
      const removed = await tx
        .delete(schema.groupCapabilities)
        .where(
          and(
            eq(schema.groupCapabilities.groupExternalId, groupExternalId),
            eq(schema.groupCapabilities.capability, capability),
          ),
        )
        .returning({ capability: schema.groupCapabilities.capability });
      return removed.length > 0;
    },
  });
  return { transaction: fn => database().transaction(tx => fn(txOf(tx))) };
}
